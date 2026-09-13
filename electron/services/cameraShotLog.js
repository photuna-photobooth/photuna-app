// electron/services/cameraShotLog.js
//
// Where each booth photo came from when Photo source is the USB camera: the
// camera itself, its last live view frame, or the webcam. The booth never stops
// for a missed shot, so without this an operator would only find out from the
// photos. The dashboard shows a summary of the most recent shots and the last
// reason the camera missed one.

const fs = require("fs");
const path = require("path");

const MAX_ENTRIES = 50;
const SOURCES = new Set(["camera", "liveview", "webcam"]);

function createCameraShotLog({ file, now = Date.now }) {
  function read() {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  function record({ source, code = null, message = null } = {}) {
    if (!SOURCES.has(source)) {
      return { ok: false, error: { code: "BAD_REQUEST", message: "source must be camera, liveview or webcam." } };
    }
    const entry = {
      at: now(),
      source,
      code: typeof code === "string" ? code.slice(0, 40) : null,
      message: typeof message === "string" ? message.slice(0, 300) : null,
    };
    const entries = [...read(), entry].slice(-MAX_ENTRIES);
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temp = `${file}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(entries));
      fs.renameSync(temp, file);
    } catch (err) {
      return { ok: false, error: { code: "WRITE_FAILED", message: err?.message || String(err) } };
    }
    return { ok: true };
  }

  function summary() {
    const entries = read();
    const count = (source) => entries.filter((e) => e.source === source).length;
    const lastFailure = [...entries].reverse().find((e) => e.source !== "camera") || null;
    return {
      ok: true,
      total: entries.length,
      fromCamera: count("camera"),
      fromLiveView: count("liveview"),
      fromWebcam: count("webcam"),
      lastFailure: lastFailure
        ? { at: lastFailure.at, code: lastFailure.code, message: lastFailure.message }
        : null,
    };
  }

  return { record, summary };
}

module.exports = { createCameraShotLog, MAX_ENTRIES };
