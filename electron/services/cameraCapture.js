// electron/services/cameraCapture.js
//
// The booth's "take this shot with the USB camera" step, on top of the camera
// helper process (cameraHelper.js). Brand-neutral: Canon, Sony and Nikon differ
// only inside the helper, so everything here works for whichever backend the
// helper has.
//
// What the booth flow relies on:
//
//   - Nothing here throws or rejects. Every call resolves to { ok:true, ... } or
//     { ok:false, error:{ code, message } }, and failures come back within the
//     shot deadline, so PhotoScreen can take that shot from the webcam instead.
//   - The full-resolution original stays on disk as captures/shot_NN_full.jpg.
//     The booth gets a copy no larger than BOOTH_COPY_MAX_EDGE: every step after
//     capture (retake screen, composing, printing, upload) passes shots around as
//     data URLs, and several 24-megapixel originals as base64 would exhaust the
//     renderer's memory by the end of a session.
//   - A camera that dropped its session (asleep between guests, a USB blip) is
//     reconnected once, silently, before the shot is given up on. A camera that
//     is not there at all is not looked for again on every shot: connecting to a
//     missing camera takes seconds, and each would be a guest waiting for the
//     webcam. After a failed connect, shots fail straight away for
//     CONNECT_RETRY_COOLDOWN_MS; an explicit connect() always tries.

const fs = require("fs");
const path = require("path");

const BOOTH_COPY_MAX_EDGE = 3000;
const BOOTH_COPY_QUALITY = 92;

// How long the helper may spend focusing, firing and downloading one shot. The
// request deadline is 5 s beyond this, so a wedged camera costs the guest at most
// ~10 s before the webcam takes the shot.
const SHOT_TIMEOUT_MS = 5_000;

const CONNECT_RETRY_COOLDOWN_MS = 30_000;

const RECONNECT_CODES = new Set(["NOT_CONNECTED", "DISCONNECTED"]);
const MAX_SLOT_INDEX = 99;
const MAX_SETTING_LENGTH = 40;

function failure(code, message) {
  return { ok: false, error: { code, message } };
}

/**
 * @param {object}   options
 * @param {object}   options.helper      a CameraHelper
 * @param {Function} options.resizeJpeg  async (filePath, { maxEdge, quality }) =>
 *                                       { buffer, width, height }; nativeImage in the
 *                                       app, a stand-in in tests
 * @param {Function} [options.log]
 * @param {Function} [options.now]       clock, for tests
 */
function createCameraCapture({ helper, resizeJpeg, log = () => {}, now = Date.now }) {
  let lastConnectFailure = null; // { at, result }

  async function status() {
    const r = await helper.status();
    if (!r.ok) {
      return { ok: false, available: false, connected: false, error: r.error };
    }
    const s = r.result || {};
    return {
      ok: true,
      // "available" means this build can drive a real camera at all: the helper
      // exists and has a camera SDK. The dashboard only offers the USB camera
      // option when it is true.
      available: Boolean(s.sdkAvailable),
      connected: Boolean(s.connected),
      model: s.model || null,
      batteryPercent: Number.isFinite(s.batteryPercent) ? s.batteryPercent : null,
      shotsRemaining: Number.isFinite(s.shotsRemaining) ? s.shotsRemaining : null,
      backend: s.backend || null,
    };
  }

  async function connect() {
    const r = await helper.connect();
    lastConnectFailure = r.ok ? null : { at: now(), result: r };
    return r;
  }

  function getSettings() {
    return helper.getSettings();
  }

  function setSetting(key, value) {
    if (typeof key !== "string" || typeof value !== "string"
      || !key || !value
      || key.length > MAX_SETTING_LENGTH || value.length > MAX_SETTING_LENGTH) {
      return Promise.resolve(failure("BAD_REQUEST", "key and value must be short strings."));
    }
    return helper.setSetting(key, value);
  }

  async function captureStill({ capturesDir, slotIndex } = {}) {
    try {
      if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > MAX_SLOT_INDEX) {
        return failure("BAD_REQUEST", "slotIndex must be a whole number from 0 to 99.");
      }
      if (typeof capturesDir !== "string" || !path.isAbsolute(capturesDir)) {
        return failure("BAD_REQUEST", "capturesDir must be an absolute path.");
      }
      let isDir = false;
      try { isDir = fs.statSync(capturesDir).isDirectory(); } catch { isDir = false; }
      if (!isDir) {
        return failure("BAD_REQUEST", "capturesDir does not exist.");
      }

      const fileName = `shot_${String(slotIndex).padStart(2, "0")}_full.jpg`;
      const request = { directory: capturesDir, fileName, timeoutMs: SHOT_TIMEOUT_MS };

      let shot = await helper.capture(request);
      if (!shot.ok && RECONNECT_CODES.has(shot.error?.code)) {
        if (lastConnectFailure && now() - lastConnectFailure.at < CONNECT_RETRY_COOLDOWN_MS) {
          return lastConnectFailure.result;
        }
        log(`camera not connected (${shot.error.code}); reconnecting before slot ${slotIndex}`);
        const connected = await connect();
        if (!connected.ok) return connected;
        shot = await helper.capture(request);
      }
      if (!shot.ok) return shot;

      const fullPath = shot.result?.path || path.join(capturesDir, fileName);

      let copy;
      try {
        copy = await resizeJpeg(fullPath, { maxEdge: BOOTH_COPY_MAX_EDGE, quality: BOOTH_COPY_QUALITY });
      } catch (err) {
        return failure("IMAGE_UNREADABLE", `Could not read the camera's photo: ${err?.message || err}`);
      }
      if (!copy?.buffer?.length) {
        return failure("IMAGE_UNREADABLE", "The camera's photo was empty.");
      }

      return {
        ok: true,
        dataUrl: `data:image/jpeg;base64,${Buffer.from(copy.buffer).toString("base64")}`,
        width: copy.width,
        height: copy.height,
        fullPath,
        fullWidth: shot.result?.width ?? null,
        fullHeight: shot.result?.height ?? null,
        elapsedMs: shot.result?.elapsedMs ?? null,
      };
    } catch (err) {
      return failure("INTERNAL", err?.message || String(err));
    }
  }

  return { status, connect, getSettings, setSetting, captureStill };
}

module.exports = { createCameraCapture, BOOTH_COPY_MAX_EDGE, SHOT_TIMEOUT_MS, CONNECT_RETRY_COOLDOWN_MS };
