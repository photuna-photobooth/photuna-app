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

// With a real camera attached:  node scripts/test-camera-helper.js --hardware
// Connects, prints status and settings, takes one photo and leaves it on disk.
if (process.argv.includes("--hardware")) {
  (async () => {
    const h = new CameraHelper({ helperPath, simulate: false });
    h.on("log", (line) => line && console.log(`  helper: ${line}`));
    const step = async (label, fn) => {
      const r = await fn();
      console.log(`${r.ok ? "ok  " : "FAIL"}  ${label}\n${JSON.stringify(r, null, 2)}\n`);
      return r;
    };
    await step("status", () => h.status());
    console.log("connecting (can take up to 25 s)...\n");
    const connected = await step("connect", () => h.connect());
    if (connected.ok) {
      await step("settings", () => h.getSettings());
      const liveView = await step("start live view", () => h.startLiveView());
      if (liveView.ok) {
        let frame = null;
        for (let i = 0; i < 50 && !frame?.ok; i += 1) {
          frame = await h.liveViewFrame();
          if (!frame.ok) await new Promise((res) => setTimeout(res, 100));
        }
        if (frame?.ok) {
          const framePath = path.join(workDir, "hardware_liveview.jpg");
          fs.writeFileSync(framePath, Buffer.from(frame.result.jpeg, "base64"));
          console.log(`ok    live view frame #${frame.result.frameNo} saved at ${framePath}\n`);
        } else {
          console.log(`FAIL  live view frame\n${JSON.stringify(frame, null, 2)}\n`);
        }
        await step("stop live view", () => h.stopLiveView());
      }
      const shot = await step("capture", () => h.capture({ directory: workDir, fileName: "hardware_test.jpg", timeoutMs: 15_000 }));
      if (shot.ok) console.log(`Photo saved at ${shot.result.path} — open it to check it.`);
      await step("disconnect", () => h.disconnect());
    }
    await h.stop();
    process.exit(connected.ok ? 0 : 1);
  })();
}

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

if (!process.argv.includes("--hardware")) (async () => {
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

  // Loads the real camera SDKs present in this build (Nikon's, once unpacked under
  // sdk/) with no camera attached: they must answer cleanly, not crash or hang.
  await check("the real camera backends answer sensibly with no camera attached", async () => {
    const h = new CameraHelper({ helperPath, simulate: false });
    // SDKs print their own diagnostics; none of it may reach the protocol channel.
    const strayOutput = [];
    h.on("log", (line) => { if (/ignored non-JSON output/.test(line)) strayOutput.push(line); });
    const status = await h.status();
    assert.strictEqual(status.ok, true, JSON.stringify(status));
    const started = Date.now();
    const r = await h.connect();
    if (r.ok) {
      // A real camera is plugged into this PC: connecting is the right answer.
      assert.ok(status.result.sdkAvailable, "connected without an SDK");
      assert.strictEqual((await h.disconnect()).ok, true, "could not disconnect the real camera");
    } else {
      const expected = status.result.sdkAvailable ? ["NO_CAMERA", "CAMERA_IN_USE"] : ["SDK_NOT_INSTALLED"];
      assert.ok(expected.includes(r.error?.code), `sdkAvailable=${status.result.sdkAvailable}, got ${JSON.stringify(r)}`);
    }
    assert.ok(Date.now() - started < 25_000, "connect took too long to give up");
    const after = await h.status();
    assert.strictEqual(after.ok, true, "helper stopped answering after trying the real SDKs");
    await h.stop();
    assert.deepStrictEqual(strayOutput, [], "an SDK wrote into the protocol channel");
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
