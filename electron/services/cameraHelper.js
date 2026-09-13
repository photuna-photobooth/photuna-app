// electron/services/cameraHelper.js
//
// Runs canon-camera-helper.exe as a long-lived child process and talks to it
// over line-delimited JSON (protocol described in the helper's Program.cs).
//
// The whole point of this module is that a camera can never take the booth down.
// Camera SDKs are native code that can crash, hang in a driver call, or simply
// stop answering when a cable is pulled, so:
//
//   - request() never throws and never rejects. It always resolves to
//     { ok: true, result } or { ok: false, error: { code, message } }, so a
//     caller that forgets a try/catch still gets an answer it can act on.
//   - Every command has a timeout. A helper that misses one is assumed wedged in
//     a driver call and is killed; the next request starts a fresh one.
//   - If the helper dies, every pending request resolves with HELPER_EXITED.
//   - A helper that keeps dying is not restarted in a tight loop: after too many
//     exits in a minute requests answer HELPER_UNSTABLE until things calm down,
//     so a broken camera cannot turn into a CPU-burning crash loop at an event.
//
// Deciding what to do about a failure — retry, reconnect, fall back to the
// webcam — belongs to the booth flow, which reads error.code.

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { EventEmitter } = require("events");

const EXE_NAME = "canon-camera-helper.exe";

const TIMEOUTS_MS = {
  status: 5_000,
  connect: 15_000,
  disconnect: 5_000,
  capture: 15_000,
  getSettings: 5_000,
  setSetting: 5_000,
  shutdown: 3_000,
};

const STARTUP_TIMEOUT_MS = 10_000;
const RESTART_WINDOW_MS = 60_000;
const MAX_EXITS_IN_WINDOW = 3;
const MAX_LINE_LENGTH = 1_000_000;

function resolveHelperPath({ resourcesPath, appPath } = {}) {
  const here = __dirname;
  const electronDir = path.resolve(here, "..");
  const devBuild = path.join(electronDir, "bin", "CanonCameraHelper", "bin", "Release", "net8.0-windows", "win-x64");

  const candidates = [
    resourcesPath && path.join(resourcesPath, "bin", EXE_NAME),
    resourcesPath && path.join(resourcesPath, EXE_NAME),
    appPath && path.join(appPath, "electron", "bin", EXE_NAME),
    path.join(electronDir, "bin", EXE_NAME),
    path.join(devBuild, "publish", EXE_NAME),
    path.join(devBuild, EXE_NAME),
  ].filter(Boolean);

  return candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  }) || null;
}

function failure(code, message) {
  return { ok: false, error: { code, message } };
}

class CameraHelper extends EventEmitter {
  /**
   * @param {object}  options
   * @param {string}  [options.helperPath]  explicit path (tests); otherwise resolved
   * @param {boolean} [options.simulate]    use the pretend camera; defaults to
   *                                        PHOTUNA_CAMERA_SIMULATOR=1 so it can
   *                                        only ever be switched on by a developer
   * @param {string}  [options.resourcesPath]
   * @param {string}  [options.appPath]
   * @param {object}  [options.env]         extra environment for the helper (tests)
   */
  constructor(options = {}) {
    super();
    this.simulate = options.simulate ?? process.env.PHOTUNA_CAMERA_SIMULATOR === "1";
    this.helperPath = options.helperPath || resolveHelperPath(options);
    this.extraEnv = options.env || {};

    this.child = null;
    this.ready = null;       // promise resolving true/false once the helper says hello
    this.pending = new Map(); // id -> { resolve, timer, cmd }
    this.nextId = 1;
    this.exitTimes = [];
    this.stopping = false;
  }

  /** Resolves to { ok, result | error } — never rejects. */
  async request(cmd, args = {}, timeoutMs = TIMEOUTS_MS[cmd] ?? 5_000) {
    if (!this.helperPath) {
      return failure("HELPER_NOT_FOUND", `${EXE_NAME} was not found in this build.`);
    }

    if (this._isUnstable()) {
      return failure("HELPER_UNSTABLE", "The camera helper keeps stopping; waiting before trying again.");
    }

    const started = await this._ensureStarted();
    if (!started) {
      return failure("HELPER_START_FAILED", "The camera helper did not start.");
    }

    const id = String(this.nextId++);

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        resolve(failure("TIMEOUT", `Camera did not answer '${cmd}' within ${timeoutMs} ms.`));
        // A helper that misses a deadline is presumed stuck inside a driver call.
        // Killing it is the only reliable way to get the camera back.
        this._kill(`timeout on ${cmd}`);
      }, timeoutMs);

      this.pending.set(id, { resolve, timer, cmd });

      try {
        this.child.stdin.write(`${JSON.stringify({ id, cmd, args })}\n`);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve(failure("HELPER_WRITE_FAILED", err?.message || String(err)));
      }
    });
  }

  status() { return this.request("status"); }
  connect() { return this.request("connect"); }
  disconnect() { return this.request("disconnect"); }
  getSettings() { return this.request("getSettings"); }
  setSetting(key, value) { return this.request("setSetting", { key, value }); }

  capture({ directory, fileName, timeoutMs = 10_000 }) {
    // The helper gets its own deadline slightly inside ours, so it can report
    // a clean camera error before we have to kill it.
    return this.request("capture", { directory, fileName, timeoutMs }, timeoutMs + 5_000);
  }

  /** Asks the helper to exit, then makes sure it has. Safe to call repeatedly. */
  async stop() {
    this.stopping = true;
    if (!this.child) return;
    await this.request("shutdown").catch(() => {});
    this._kill("stop");
  }

  _isUnstable() {
    const now = Date.now();
    this.exitTimes = this.exitTimes.filter((t) => now - t < RESTART_WINDOW_MS);
    return this.exitTimes.length >= MAX_EXITS_IN_WINDOW;
  }

  _ensureStarted() {
    if (this.child && this.ready) return this.ready;

    this.stopping = false;
    const args = this.simulate ? ["--simulate"] : [];

    let child;
    try {
      child = spawn(this.helperPath, args, {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...this.extraEnv },
      });
    } catch (err) {
      this.emit("log", `spawn failed: ${err?.message || err}`);
      return Promise.resolve(false);
    }

    this.child = child;

    this.ready = new Promise((resolveReady) => {
      const startupTimer = setTimeout(() => {
        this.emit("log", "helper did not report ready in time");
        resolveReady(false);
        this._kill("startup timeout");
      }, STARTUP_TIMEOUT_MS);

      const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });

      lines.on("line", (line) => {
        if (line.length > MAX_LINE_LENGTH) {
          this.emit("log", "ignored oversized line from helper");
          return;
        }

        let message;
        try {
          message = JSON.parse(line);
        } catch {
          this.emit("log", `ignored non-JSON output: ${line.slice(0, 200)}`);
          return;
        }

        if (message.event === "ready") {
          clearTimeout(startupTimer);
          this.emit("ready", message);
          resolveReady(true);
          return;
        }

        if (message.event) {
          this.emit("event", message);
          return;
        }

        const entry = this.pending.get(String(message.id));
        if (!entry) return; // a reply to a request that already timed out

        clearTimeout(entry.timer);
        this.pending.delete(String(message.id));
        entry.resolve(message.ok
          ? { ok: true, result: message.result }
          : failure(message.error?.code || "UNKNOWN", message.error?.message || "Camera error"));
      });

      child.stderr.on("data", (chunk) => this.emit("log", String(chunk).trim()));

      child.on("error", (err) => {
        clearTimeout(startupTimer);
        this.emit("log", `helper error: ${err?.message || err}`);
        resolveReady(false);
      });

      child.on("exit", (code, signal) => {
        clearTimeout(startupTimer);
        resolveReady(false);
        if (this.child === child) {
          this.child = null;
          this.ready = null;
        }
        if (!this.stopping) this.exitTimes.push(Date.now());

        for (const [id, entry] of this.pending) {
          clearTimeout(entry.timer);
          entry.resolve(failure("HELPER_EXITED", `Camera helper stopped during '${entry.cmd}'.`));
          this.pending.delete(id);
        }

        this.emit("exit", { code, signal });
      });
    });

    return this.ready;
  }

  _kill(reason) {
    const child = this.child;
    if (!child) return;
    this.emit("log", `stopping helper: ${reason}`);
    try {
      child.kill();
    } catch {
      // already gone
    }
  }
}

module.exports = { CameraHelper, resolveHelperPath, TIMEOUTS_MS };
