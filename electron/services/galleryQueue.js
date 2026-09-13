// electron/services/galleryQueue.js
//
// Keeps guest galleries that could not be uploaded — venue Wi-Fi drops, the
// Supabase request times out — and uploads them later, so a flaky connection
// costs a delay instead of the guest's photos.
//
// Each queued session is one folder under userData/gallery-queue/<sessionId>/
// holding job.json: the original gallery payload (minus the access token, which
// expires) plus retry bookkeeping. Nothing here talks to the network; the main
// process decides when to retry and with which token.
//
// Rules:
//   - Only failures a retry could fix are queued. A session whose composed photo
//     is missing or unreadable will fail identically forever, so it is not.
//   - Retries back off (1, 2, 5, 10, then every 30 minutes) so a long outage does
//     not hammer the connection, and wake() makes everything due at once when the
//     connection comes back.
//   - Jobs belong to the operator who took the session and are only ever retried
//     for that operator.
//   - Nothing is deleted except on a successful upload. A job that fails for a
//     reason retrying cannot fix is kept, marked permanent, and no longer retried.

const fs = require("fs");
const path = require("path");

const JOB_VERSION = 1;
const BACKOFF_MS = [60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 30 * 60_000];
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_\-]{0,119}$/;

// Failures that will never succeed on retry.
const PERMANENT_ERRORS = [
  /No valid composed image/i,
  /Could not read the composed photo/i,
];

function isRetryable(err) {
  const message = String(err?.message || err || "");
  return !PERMANENT_ERRORS.some((pattern) => pattern.test(message));
}

// blob: URLs belong to a renderer page and are dead after a reload, so a stored
// one can only make a retry pick the wrong source. Drop them; a data URL or file
// path alongside is what the retry should use.
function withoutDeadReferences(payload) {
  const clean = { ...payload };
  delete clean.accessToken;

  for (const key of ["composedImageUrl", "composedImagePath", "composedImage"]) {
    if (typeof clean[key] === "string" && clean[key].startsWith("blob:")) delete clean[key];
  }
  if (Array.isArray(clean.photos)) {
    clean.photos = clean.photos.filter((p) => !(typeof p === "string" && p.startsWith("blob:")));
  }
  return clean;
}

function createGalleryQueue({ baseDir, now = () => Date.now() }) {
  const resolveBase = () => (typeof baseDir === "function" ? baseDir() : baseDir);
  const queueDir = () => path.join(resolveBase(), "gallery-queue");
  const jobDir = (id) => path.join(queueDir(), id);
  const jobFile = (id) => path.join(jobDir(id), "job.json");

  function read(id) {
    try {
      const job = JSON.parse(fs.readFileSync(jobFile(id), "utf8"));
      return job && job.version === JOB_VERSION ? job : null;
    } catch {
      return null;
    }
  }

  // Write to a temp file and rename, so a crash or power cut mid-write never
  // leaves a half-written job that would lose the session.
  function write(job) {
    fs.mkdirSync(jobDir(job.id), { recursive: true });
    const tmp = `${jobFile(job.id)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(job));
    fs.renameSync(tmp, jobFile(job.id));
    return job;
  }

  function all() {
    let names = [];
    try {
      names = fs.readdirSync(queueDir());
    } catch {
      return [];
    }
    return names
      .filter((name) => SAFE_ID.test(name))
      .map(read)
      .filter(Boolean)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Queue a session whose upload failed. Returns the job, or null when the
   * session cannot or should not be retried.
   */
  function enqueue(payload, error) {
    const id = String(payload?.sessionId || "");
    const userId = payload?.userId ? String(payload.userId) : "";

    if (!SAFE_ID.test(id) || id === "default") return null;
    if (!userId) return null;
    if (!isRetryable(error)) return null;

    const existing = read(id);
    if (existing && existing.userId !== userId) return null;

    return write({
      version: JOB_VERSION,
      id,
      userId,
      eventId: payload?.eventId ? String(payload.eventId) : null,
      createdAt: existing?.createdAt ?? now(),
      attempts: existing?.attempts ?? 0,
      nextAttemptAt: existing?.nextAttemptAt ?? now() + BACKOFF_MS[0],
      permanent: false,
      lastError: String(error?.message || error || "").slice(0, 500),
      payload: withoutDeadReferences(payload),
    });
  }

  /** Jobs for this operator that are ready to retry. */
  function due(userId) {
    const t = now();
    return all().filter((job) => job.userId === String(userId) && !job.permanent && job.nextAttemptAt <= t);
  }

  function list(userId) {
    return all().filter((job) => job.userId === String(userId));
  }

  function complete(id) {
    if (!SAFE_ID.test(String(id))) return;
    fs.rmSync(jobDir(id), { recursive: true, force: true });
  }

  function fail(id, error) {
    const job = read(id);
    if (!job) return null;
    job.attempts += 1;
    job.lastError = String(error?.message || error || "").slice(0, 500);
    if (!isRetryable(error)) {
      job.permanent = true;
    } else {
      job.nextAttemptAt = now() + BACKOFF_MS[Math.min(job.attempts - 1, BACKOFF_MS.length - 1)];
    }
    return write(job);
  }

  /** The connection is back: make every waiting job for this operator due now. */
  function wake(userId) {
    const t = now();
    for (const job of list(userId)) {
      if (job.permanent || job.nextAttemptAt <= t) continue;
      job.nextAttemptAt = t;
      write(job);
    }
  }

  function status(userId) {
    const jobs = list(userId);
    const waiting = jobs.filter((j) => !j.permanent);
    return {
      pending: waiting.length,
      permanentlyFailed: jobs.length - waiting.length,
      oldestAt: waiting[0]?.createdAt ?? null,
    };
  }

  /** Session ids whose local files must survive automatic storage cleanup. */
  function protectedSessionIds() {
    return new Set(all().map((job) => job.id));
  }

  return { enqueue, due, list, complete, fail, wake, status, protectedSessionIds, isRetryable };
}

module.exports = { createGalleryQueue, isRetryable, BACKOFF_MS };
