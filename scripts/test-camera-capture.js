// Exercises electron/services/cameraCapture.js — the booth's "take this shot with
// the USB camera" step — against the real helper process running its pretend
// camera. Checks the promises the booth flow relies on:
//
//   - a good shot leaves the full-resolution original on disk and returns a
//     booth-sized copy the existing pipeline can use;
//   - a camera that dropped its session is reconnected once, silently;
//   - every failure comes back as { ok:false, error:{ code } } quickly enough for
//     the booth to take that shot from the webcam instead;
//   - nothing is written outside the session's captures folder.
//
//   node scripts/test-camera-capture.js
//
// Needs the helper built first:
//   dotnet build -c Release electron/bin/CanonCameraHelper

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { CameraHelper, resolveHelperPath } = require("../electron/services/cameraHelper");
const { createCameraCapture } = require("../electron/services/cameraCapture");

const helperPath = resolveHelperPath({});
if (!helperPath) {
  console.error("canon-camera-helper.exe not found — build it first.");
  process.exit(2);
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "camera-capture-test-"));
const results = [];

async function check(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - started });
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - started, error: err?.message || String(err) });
  }
}

// Stands in for Electron's nativeImage, which only exists inside Electron. It
// records what it was asked to shrink and returns a tiny JPEG-looking buffer.
function fakeResizer() {
  const calls = [];
  return {
    calls,
    resizeJpeg: async (filePath, { maxEdge, quality }) => {
      calls.push({ filePath, maxEdge, quality });
      return { buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), width: maxEdge, height: Math.round((maxEdge * 2) / 3) };
    },
  };
}

function makeCapture({ env = {}, resizer = fakeResizer(), helper } = {}) {
  const h = helper || new CameraHelper({ helperPath, simulate: true, env });
  const capture = createCameraCapture({ helper: h, resizeJpeg: resizer.resizeJpeg, log: () => {} });
  return { h, capture, resizer };
}

function freshCapturesDir(name) {
  const dir = path.join(workDir, name, "captures");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

(async () => {
  await check("a good shot keeps the full-resolution original and returns a booth-sized copy", async () => {
    const { h, capture, resizer } = makeCapture();
    const dir = freshCapturesDir("good");
    const r = await capture.captureStill({ capturesDir: dir, slotIndex: 3 });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.ok(r.dataUrl.startsWith("data:image/jpeg;base64,"), "not a JPEG data URL");
    assert.strictEqual(r.fullWidth, 6000);
    assert.strictEqual(r.fullHeight, 4000);
    const full = path.join(dir, "shot_03_full.jpg");
    assert.strictEqual(r.fullPath, full);
    assert.ok(fs.statSync(full).size > 50_000, "full-resolution file missing or tiny");
    assert.strictEqual(resizer.calls.length, 1);
    assert.strictEqual(resizer.calls[0].filePath, full);
    assert.ok(resizer.calls[0].maxEdge <= 3000, "booth copy is not limited in size");
    await h.stop();
  });

  await check("the first shot connects the camera without the booth asking", async () => {
    const { h, capture } = makeCapture();
    const before = await h.status();
    assert.strictEqual(before.result.connected, false);
    const r = await capture.captureStill({ capturesDir: freshCapturesDir("autoconnect"), slotIndex: 0 });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    await h.stop();
  });

  await check("a camera that dropped its session is reconnected once and the shot still succeeds", async () => {
    const { h, capture } = makeCapture();
    const dir = freshCapturesDir("reconnect");
    assert.strictEqual((await capture.captureStill({ capturesDir: dir, slotIndex: 0 })).ok, true);
    await h.disconnect(); // e.g. the camera went to sleep between guests
    const r = await capture.captureStill({ capturesDir: dir, slotIndex: 1 });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    await h.stop();
  });

  await check("autofocus failure → FOCUS_FAILED quickly, so the booth can use the webcam", async () => {
    const { h, capture } = makeCapture({ env: { PHOTUNA_CAMERA_SIM_FAIL: "focus" } });
    const started = Date.now();
    const r = await capture.captureStill({ capturesDir: freshCapturesDir("focus"), slotIndex: 0 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error.code, "FOCUS_FAILED");
    assert.ok(Date.now() - started < 5_000, "took too long to give up");
    await h.stop();
  });

  await check("no camera attached → NO_CAMERA, not a thrown error", async () => {
    const { h, capture } = makeCapture({ env: { PHOTUNA_CAMERA_SIM_FAIL: "connect" } });
    const r = await capture.captureStill({ capturesDir: freshCapturesDir("nocamera"), slotIndex: 0 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error.code, "NO_CAMERA");
    await h.stop();
  });

  await check("a hung camera gives up within the booth's shot deadline", async () => {
    const { h, capture } = makeCapture({ env: { PHOTUNA_CAMERA_SIM_FAIL: "hang" } });
    const started = Date.now();
    const r = await capture.captureStill({ capturesDir: freshCapturesDir("hang"), slotIndex: 0 });
    const waited = Date.now() - started;
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error.code, "TIMEOUT", JSON.stringify(r));
    assert.ok(waited < 12_000, `guest waited ${waited} ms`);
    await h.stop();
  });

  await check("a helper crash mid-shot → HELPER_EXITED, not a hang", async () => {
    const { h, capture } = makeCapture({ env: { PHOTUNA_CAMERA_SIM_FAIL: "crash" } });
    const r = await capture.captureStill({ capturesDir: freshCapturesDir("crash"), slotIndex: 0 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error.code, "HELPER_EXITED", JSON.stringify(r));
    await h.stop();
  });

  await check("a missing camera does not slow every shot: reconnects are retried at most every 30 s", async () => {
    let clock = 1_000_000;
    const h = new CameraHelper({ helperPath, simulate: true, env: { PHOTUNA_CAMERA_SIM_FAIL: "connect" } });
    let connects = 0;
    const realConnect = h.connect.bind(h);
    h.connect = () => { connects += 1; return realConnect(); };
    const capture = createCameraCapture({ helper: h, resizeJpeg: fakeResizer().resizeJpeg, log: () => {}, now: () => clock });
    const dir = freshCapturesDir("cooldown");

    assert.strictEqual((await capture.captureStill({ capturesDir: dir, slotIndex: 0 })).error?.code, "NO_CAMERA");
    assert.strictEqual((await capture.captureStill({ capturesDir: dir, slotIndex: 1 })).error?.code, "NO_CAMERA");
    assert.strictEqual(connects, 1, "looked for the camera again on the very next shot");

    clock += 31_000;
    assert.strictEqual((await capture.captureStill({ capturesDir: dir, slotIndex: 2 })).error?.code, "NO_CAMERA");
    assert.strictEqual(connects, 2, "never looked for the camera again after the cooldown");

    // The operator pressing Connect always tries, whatever the cooldown.
    await capture.connect();
    assert.strictEqual(connects, 3);
    await h.stop();
  });

  await check("live view connects the camera if needed and returns fresh JPEG frames", async () => {
    const { h, capture } = makeCapture();
    const started = await capture.startLiveView();
    assert.strictEqual(started.ok, true, JSON.stringify(started));
    const first = await capture.liveViewFrame();
    const second = await capture.liveViewFrame();
    assert.strictEqual(first.ok, true, JSON.stringify(first));
    assert.strictEqual(first.jpeg[0], 0xff);
    assert.strictEqual(first.jpeg[1], 0xd8);
    assert.ok(second.frameNo > first.frameNo, "frames did not advance");
    assert.strictEqual((await capture.stopLiveView()).ok, true);
    const after = await capture.liveViewFrame();
    assert.strictEqual(after.error?.code, "LIVE_VIEW_OFF");
    await h.stop();
  });

  await check("no live view frame is requested from the helper while a shot is being taken", async () => {
    const { h, capture } = makeCapture();
    await capture.startLiveView();
    const shot = capture.captureStill({ capturesDir: freshCapturesDir("liveview-busy"), slotIndex: 0 });
    const during = await capture.liveViewFrame();
    assert.strictEqual(during.error?.code, "BUSY");
    assert.strictEqual((await shot).ok, true);
    assert.strictEqual((await capture.liveViewFrame()).ok, true, "live view did not continue after the shot");
    await h.stop();
  });

  await check("a camera without live view says so, so the booth uses the webcam preview", async () => {
    const { h, capture } = makeCapture({ env: { PHOTUNA_CAMERA_SIM_FAIL: "liveview" } });
    const r = await capture.startLiveView();
    assert.strictEqual(r.error?.code, "LIVE_VIEW_UNAVAILABLE");
    await h.stop();
  });

  await check("a build without the helper answers HELPER_NOT_FOUND", async () => {
    const helper = new CameraHelper({ helperPath: null, simulate: true });
    helper.helperPath = null;
    const { capture } = makeCapture({ helper });
    const r = await capture.captureStill({ capturesDir: freshCapturesDir("nohelper"), slotIndex: 0 });
    assert.strictEqual(r.error?.code, "HELPER_NOT_FOUND");
    const s = await capture.status();
    assert.strictEqual(s.available, false);
  });

  await check("if the photo cannot be shrunk the shot fails cleanly", async () => {
    const resizer = { calls: [], resizeJpeg: async () => { throw new Error("decode failed"); } };
    const { h, capture } = makeCapture({ resizer });
    const r = await capture.captureStill({ capturesDir: freshCapturesDir("resize"), slotIndex: 0 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error.code, "IMAGE_UNREADABLE");
    await h.stop();
  });

  await check("bad slot numbers and missing folders are refused before the shutter fires", async () => {
    const { h, capture } = makeCapture();
    const dir = freshCapturesDir("bad");
    for (const slotIndex of [-1, 100, 1.5, "../1", null, "3"]) {
      const r = await capture.captureStill({ capturesDir: dir, slotIndex });
      assert.strictEqual(r.ok, false, `accepted slotIndex ${JSON.stringify(slotIndex)}`);
      assert.strictEqual(r.error.code, "BAD_REQUEST");
    }
    const missing = await capture.captureStill({ capturesDir: path.join(workDir, "does-not-exist"), slotIndex: 0 });
    assert.strictEqual(missing.error?.code, "BAD_REQUEST");
    const relative = await capture.captureStill({ capturesDir: "captures", slotIndex: 0 });
    assert.strictEqual(relative.error?.code, "BAD_REQUEST");
    assert.deepStrictEqual(fs.readdirSync(dir), [], "something was written for a refused request");
    await h.stop();
  });

  await check("status reports availability, model and battery for the dashboard", async () => {
    const { h, capture } = makeCapture();
    const before = await capture.status();
    assert.strictEqual(before.available, true);
    assert.strictEqual(before.connected, false);
    const connected = await capture.connect();
    assert.strictEqual(connected.ok, true, JSON.stringify(connected));
    assert.strictEqual(connected.result.connected, true);
    assert.ok(connected.result.model);
    assert.strictEqual(typeof connected.result.batteryPercent, "number");
    await h.stop();
  });

  await check("settings pass through and only camera-offered values are accepted", async () => {
    const { h, capture } = makeCapture();
    await capture.connect();
    const s = await capture.getSettings();
    assert.strictEqual(s.ok, true);
    const iso = s.result.iso.allowed.find((v) => v !== s.result.iso.current);
    const set = await capture.setSetting("iso", iso);
    assert.strictEqual(set.ok, true, JSON.stringify(set));
    assert.strictEqual(set.result.iso.current, iso);
    const refused = await capture.setSetting("iso", "123456");
    assert.strictEqual(refused.error?.code, "VALUE_NOT_ALLOWED");
    const unknown = await capture.setSetting("toString", "x");
    assert.strictEqual(unknown.error?.code, "UNKNOWN_SETTING");
    await h.stop();
  });

  fs.rmSync(workDir, { recursive: true, force: true });
  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed += 1;
    console.log(`${r.ok ? "ok  " : "FAIL"}  ${r.name}  (${r.ms} ms)${r.ok ? "" : `\n        ${r.error}`}`);
  }
  console.log(failed ? `\n${failed} of ${results.length} checks failed` : `\nAll ${results.length} checks passed.`);
  process.exit(failed ? 1 : 0);
})();
