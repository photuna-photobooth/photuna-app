// Checks electron/services/galleryQueue.js without Electron or a network.
//
//   node scripts/test-gallery-queue.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createGalleryQueue, BACKOFF_MS } = require("../electron/services/galleryQueue");

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: err.message });
  }
}

function freshQueue() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gallery-queue-test-"));
  let clock = 1_000_000;
  const queue = createGalleryQueue({ baseDir: dir, now: () => clock });
  return { dir, queue, tick: (ms) => { clock += ms; }, reopen: () => createGalleryQueue({ baseDir: dir, now: () => clock }) };
}

const network = new Error("fetch failed");
const payload = (over = {}) => ({
  sessionId: "2026-09-13T06-00-00-000Z-abc123",
  userId: "user-a",
  eventId: "event-1",
  accessToken: "secret-token-must-not-be-stored",
  composedImagePath: "C:\\booth\\final.png",
  composedImageUrl: "blob:app://page/1234",
  photos: ["file:///C:/booth/p1.jpg", "blob:app://page/5678"],
  frameOverlayDataUrl: "data:image/png;base64,AAAA",
  galleryEnabled: true,
  ...over,
});

check("a network failure is queued", () => {
  const { queue } = freshQueue();
  const job = queue.enqueue(payload(), network);
  assert.ok(job);
  assert.strictEqual(queue.status("user-a").pending, 1);
});

check("the access token is never written to disk", () => {
  const { dir, queue } = freshQueue();
  const job = queue.enqueue(payload(), network);
  const onDisk = fs.readFileSync(path.join(dir, "gallery-queue", job.id, "job.json"), "utf8");
  assert.ok(!onDisk.includes("secret-token-must-not-be-stored"));
});

check("dead blob: URLs are dropped, real sources and the overlay kept", () => {
  const { queue } = freshQueue();
  const job = queue.enqueue(payload(), network);
  assert.strictEqual(job.payload.composedImageUrl, undefined);
  assert.strictEqual(job.payload.composedImagePath, "C:\\booth\\final.png");
  assert.deepStrictEqual(job.payload.photos, ["file:///C:/booth/p1.jpg"]);
  assert.strictEqual(job.payload.frameOverlayDataUrl, "data:image/png;base64,AAAA");
});

check("a missing composed photo is not queued (a retry cannot fix it)", () => {
  const { queue } = freshQueue();
  assert.strictEqual(queue.enqueue(payload(), new Error("No valid composed image found for upload.")), null);
  assert.strictEqual(queue.enqueue(payload(), new Error("Could not read the composed photo (file-url): ENOENT")), null);
});

check("sessions without a usable id or operator are not queued", () => {
  const { queue } = freshQueue();
  assert.strictEqual(queue.enqueue(payload({ sessionId: "default" }), network), null);
  assert.strictEqual(queue.enqueue(payload({ sessionId: "" }), network), null);
  assert.strictEqual(queue.enqueue(payload({ userId: null }), network), null);
});

check("path traversal in the session id is refused", () => {
  const { dir, queue } = freshQueue();
  for (const sessionId of ["../../evil", "..\\evil", "a/b", "C:\\Windows"]) {
    assert.strictEqual(queue.enqueue(payload({ sessionId }), network), null, sessionId);
  }
  assert.ok(!fs.existsSync(path.join(dir, "evil")));
});

check("not due until the first backoff has passed", () => {
  const { queue, tick } = freshQueue();
  queue.enqueue(payload(), network);
  assert.strictEqual(queue.due("user-a").length, 0);
  tick(BACKOFF_MS[0]);
  assert.strictEqual(queue.due("user-a").length, 1);
});

check("wake() makes waiting jobs due immediately when the connection returns", () => {
  const { queue } = freshQueue();
  queue.enqueue(payload(), network);
  queue.wake("user-a");
  assert.strictEqual(queue.due("user-a").length, 1);
});

check("failures back off 1, 2, 5, 10, then 30 minutes, and stay at 30", () => {
  const { queue, tick } = freshQueue();
  const job = queue.enqueue(payload(), network);
  tick(BACKOFF_MS[0]);
  // The clock now equals the first due time; every failure below happens then.
  const failedAt = job.nextAttemptAt;
  const minutes = [];
  for (let i = 0; i < 7; i += 1) {
    const failed = queue.fail(job.id, network);
    minutes.push((failed.nextAttemptAt - failedAt) / 60_000);
  }
  assert.deepStrictEqual(minutes, [1, 2, 5, 10, 30, 30, 30]);
  const last = queue.list("user-a")[0];
  assert.strictEqual(last.attempts, 7);
  assert.ok(!last.permanent, "a network failure must never become permanent");
});

check("a failure retrying cannot fix is kept but no longer retried", () => {
  const { queue } = freshQueue();
  const job = queue.enqueue(payload(), network);
  queue.wake("user-a");
  queue.fail(job.id, new Error("Could not read the composed photo (absolute-path): ENOENT"));
  queue.wake("user-a");
  assert.strictEqual(queue.due("user-a").length, 0);
  assert.deepStrictEqual(queue.status("user-a"), { pending: 0, permanentlyFailed: 1, oldestAt: null });
});

check("jobs are only retried for the operator who took the session", () => {
  const { queue } = freshQueue();
  queue.enqueue(payload(), network);
  queue.wake("user-a");
  assert.strictEqual(queue.due("user-b").length, 0);
  assert.strictEqual(queue.status("user-b").pending, 0);
  assert.strictEqual(queue.enqueue(payload({ userId: "user-b" }), network), null, "another operator overwrote the job");
});

check("a successful upload removes the job and its folder", () => {
  const { dir, queue } = freshQueue();
  const job = queue.enqueue(payload(), network);
  queue.complete(job.id);
  assert.strictEqual(queue.status("user-a").pending, 0);
  assert.ok(!fs.existsSync(path.join(dir, "gallery-queue", job.id)));
});

check("queued sessions are protected from storage cleanup", () => {
  const { queue } = freshQueue();
  const job = queue.enqueue(payload(), network);
  assert.ok(queue.protectedSessionIds().has(job.id));
  queue.complete(job.id);
  assert.ok(!queue.protectedSessionIds().has(job.id));
});

check("the queue survives an app restart", () => {
  const { queue, reopen } = freshQueue();
  queue.enqueue(payload(), network);
  const after = reopen();
  assert.strictEqual(after.status("user-a").pending, 1);
});

check("re-queuing the same session keeps its history", () => {
  const { queue } = freshQueue();
  const job = queue.enqueue(payload(), network);
  queue.wake("user-a");
  queue.fail(job.id, network);
  const again = queue.enqueue(payload(), new Error("timeout"));
  assert.strictEqual(again.attempts, 1);
  assert.strictEqual(again.createdAt, job.createdAt);
});

let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`${r.ok ? "ok  " : "FAIL"}  ${r.name}${r.ok ? "" : `\n        ${r.error}`}`);
}
console.log(failed ? `\n${failed} of ${results.length} checks failed` : `\nAll ${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
