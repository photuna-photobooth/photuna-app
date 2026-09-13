// Exercises electron/services/cameraHelper.js against the real helper process
// running its pretend camera. Every safety guarantee the booth relies on is
// checked here without any hardware:
//
//   node scripts/test-camera-helper.js
//
// Needs the helper built first:
//   dotnet build -c Release electron/bin/CanonCameraHelper

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { CameraHelper, resolveHelperPath } = require("../electron/services/cameraHelper");

const helperPath = resolveHelperPath({});
if (!helperPath) {
  console.error("canon-camera-helper.exe not found — build it first.");
  process.exit(2);
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "camera-helper-test-"));
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

function makeHelper(env = {}) {
  return new CameraHelper({ helperPath, simulate: true, env });
}

(async () => {
  // ── normal operation ─────────────────────────────────────────────────────
  await check("status before connect reports disconnected", async () => {
    const h = makeHelper();
    const r = await h.status();
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.result.connected, false);
    await h.stop();
  });

  await check("connect, then capture writes a full-resolution JPEG on this PC", async () => {
    const h = makeHelper();
    assert.strictEqual((await h.connect()).ok, true);
    const r = await h.capture({ directory: workDir, fileName: "shot_00.jpg" });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.result.width, 6000);
    assert.strictEqual(r.result.height, 4000);
    const onDisk = fs.statSync(path.join(workDir, "shot_00.jpg")).size;
    assert.ok(onDisk > 50_000, `file too small: ${onDisk}`);
    assert.strictEqual(r.result.bytes, onDisk);
    const head = fs.readFileSync(path.join(workDir, "shot_00.jpg")).subarray(0, 3).toString("hex");
    assert.strictEqual(head, "ffd8ff", "not a JPEG");
    await h.stop();
  });

  await check("settings come with the values the camera allows", async () => {
    const h = makeHelper();
    await h.connect();
    const r = await h.getSettings();
    assert.strictEqual(r.ok, true);
    for (const key of ["iso", "shutterSpeed", "aperture", "whiteBalance"]) {
      assert.ok(Array.isArray(r.result[key]?.allowed) && r.result[key].allowed.length > 0, `${key} has no allowed values`);
    }
    const set = await h.setSetting("iso", "800");
    assert.strictEqual(set.ok, true);
    assert.strictEqual(set.result.iso.current, "800");
    await h.stop();
  });

  await check("a value the camera does not offer is refused", async () => {
    const h = makeHelper();
    await h.connect();
    const r = await h.setSetting("iso", "999999");
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error.code, "VALUE_NOT_ALLOWED");
    const unknown = await h.setSetting("flashPower", "full");
    assert.strictEqual(unknown.error.code, "UNKNOWN_SETTING");
    await h.stop();
  });

  // ── the helper only writes where it is told ──────────────────────────────
  await check("capture refuses path traversal and relative directories", async () => {
    const h = makeHelper();
    await h.connect();
    for (const fileName of ["../escape.jpg", "..\\escape.jpg", "C:\\Windows\\x.jpg", "shot.exe", ""]) {
      const r = await h.capture({ directory: workDir, fileName });
      assert.strictEqual(r.ok, false, `accepted fileName ${JSON.stringify(fileName)}`);
      assert.strictEqual(r.error.code, "BAD_REQUEST");
    }
    const relative = await h.capture({ directory: "relative\\dir", fileName: "a.jpg" });
    assert.strictEqual(relative.error.code, "BAD_REQUEST");
    assert.ok(!fs.existsSync(path.join(workDir, "..", "escape.jpg")));
    await h.stop();
  });

  await check("garbage input does not kill the helper", async () => {
    const h = makeHelper();
    await h.status();
    h.child.stdin.write("this is not json\n");
    h.child.stdin.write(`${JSON.stringify({ id: "x", cmd: "doSomethingEvil" })}\n`);
    const r = await h.status();
    assert.strictEqual(r.ok, true, "helper stopped answering after bad input");
    await h.stop();
  });

  // ── real-world camera failures come back as codes the booth can act on ────
  await check("no camera found → NO_CAMERA", async () => {
    const h = makeHelper({ PHOTUNA_CAMERA_SIM_FAIL: "connect" });
    const r = await h.connect();
    assert.strictEqual(r.error?.code, "NO_CAMERA");
    await h.stop();
  });

  await check("autofocus failure → FOCUS_FAILED, helper keeps working", async () => {
    const h = makeHelper({ PHOTUNA_CAMERA_SIM_FAIL: "focus" });
    await h.connect();
    const r = await h.capture({ directory: workDir, fileName: "focus.jpg" });
    assert.strictEqual(r.error?.code, "FOCUS_FAILED");
    assert.strictEqual((await h.status()).ok, true);
    await h.stop();
  });

  await check("cable pulled mid-session → DISCONNECTED on the next shot", async () => {
    const h = makeHelper({ PHOTUNA_CAMERA_SIM_FAIL: "unplug-after-2" });
    await h.connect();
    assert.strictEqual((await h.capture({ directory: workDir, fileName: "u1.jpg" })).ok, true);
    assert.strictEqual((await h.capture({ directory: workDir, fileName: "u2.jpg" })).ok, true);
    const third = await h.capture({ directory: workDir, fileName: "u3.jpg" });
    assert.strictEqual(third.error?.code, "DISCONNECTED");
    const status = await h.status();
    assert.strictEqual(status.result.connected, false);
    await h.stop();
  });

  // ── the helper itself misbehaving ─────────────────────────────────────────
  await check("a hung capture times out, is killed, and the next request recovers", async () => {
    const h = makeHelper({ PHOTUNA_CAMERA_SIM_FAIL: "hang" });
    await h.connect();
    const started = Date.now();
    const r = await h.capture({ directory: workDir, fileName: "hang.jpg", timeoutMs: 1_000 });
    const waited = Date.now() - started;
    assert.strictEqual(r.error?.code, "TIMEOUT", JSON.stringify(r));
    assert.ok(waited < 10_000, `took ${waited} ms to give up`);
    await new Promise((res) => setTimeout(res, 500));
    const after = await h.status();
    assert.strictEqual(after.ok, true, "did not recover after the hang");
    await h.stop();
  });

  await check("a crash mid-capture resolves HELPER_EXITED instead of hanging", async () => {
    const h = makeHelper({ PHOTUNA_CAMERA_SIM_FAIL: "crash" });
    await h.connect();
    const r = await h.capture({ directory: workDir, fileName: "crash.jpg" });
    assert.strictEqual(r.error?.code, "HELPER_EXITED", JSON.stringify(r));
    await h.stop();
  });

  await check("a helper that keeps crashing is not restarted in a tight loop", async () => {
    const h = makeHelper({ PHOTUNA_CAMERA_SIM_FAIL: "crash" });
    const codes = [];
    for (let i = 0; i < 5; i += 1) {
      await h.connect();
      const r = await h.capture({ directory: workDir, fileName: `loop${i}.jpg` });
      codes.push(r.error?.code);
    }
    assert.ok(codes.includes("HELPER_UNSTABLE"), `never backed off: ${codes.join(", ")}`);
    await h.stop();
  });

  await check("a missing helper answers HELPER_NOT_FOUND instead of throwing", async () => {
    const h = new CameraHelper({ helperPath: null, simulate: true });
    h.helperPath = null;
    const r = await h.status();
    assert.strictEqual(r.error?.code, "HELPER_NOT_FOUND");
  });

  await check("without the Canon SDK the real backend says so", async () => {
    const h = new CameraHelper({ helperPath, simulate: false });
    const status = await h.status();
    assert.strictEqual(status.ok, true);
    assert.strictEqual(status.result.sdkAvailable, false);
    const r = await h.connect();
    assert.strictEqual(r.error?.code, "SDK_NOT_INSTALLED");
    await h.stop();
  });

  // ── report ─────────────────────────────────────────────────────────────
  fs.rmSync(workDir, { recursive: true, force: true });
  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed += 1;
    console.log(`${r.ok ? "ok  " : "FAIL"}  ${r.name}  (${r.ms} ms)${r.ok ? "" : `\n        ${r.error}`}`);
  }
  console.log(failed ? `\n${failed} of ${results.length} checks failed` : `\nAll ${results.length} checks passed.`);
  process.exit(failed ? 1 : 0);
})();
