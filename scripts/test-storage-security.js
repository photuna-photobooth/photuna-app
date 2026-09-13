// End-to-end check of who can read and write the studiophotuna storage bucket,
// run against the real Storage API — not simulated with SQL — because the Storage
// service is what sets each object's owner and applies the policies booths hit.
//
// It creates two throwaway operator accounts, signs in as each with the public
// key exactly as a booth does, tries the normal booth operations and the attacks
// a real person could attempt, then deletes both accounts and every test object.
//
// Run it before the policy change (the attacks should succeed — proving the gap)
// and after (every check should pass):
//
//   $env:SUPABASE_SECRET_KEY = "<sb_secret_ key>"
//   node scripts/test-storage-security.js
//
// The secret key is read from the environment only and never printed or stored.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://elthktbvojsmvhtxxqnz.supabase.co";
const BUCKET = "studiophotuna";
const SECRET = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

function readAnonKey() {
  for (const file of [".env", path.join("electron", "env.generated.js")]) {
    try {
      const text = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
      const match = text.match(/REACT_APP_SUPABASE_ANON_KEY["']?\s*[:=]\s*["']?([A-Za-z0-9._\-]+)/);
      if (match) return match[1];
    } catch {
      // try the next file
    }
  }
  return null;
}

const ANON_KEY = readAnonKey();

if (!SECRET) {
  console.error('Set SUPABASE_SECRET_KEY first:  $env:SUPABASE_SECRET_KEY = "sb_secret_..."');
  process.exit(2);
}
if (!ANON_KEY) {
  console.error("Could not find REACT_APP_SUPABASE_ANON_KEY in .env or electron/env.generated.js");
  process.exit(2);
}

const admin = createClient(SUPABASE_URL, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });
const fresh = () => createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const stamp = Date.now().toString(36);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const blob = () => new Blob([png], { type: "image/png" });

const results = [];
const createdUsers = [];
const createdPaths = new Set();

function record(group, name, secure, detail) {
  results.push({ group, name, secure, detail });
}

async function makeOperator(label) {
  const email = `storage-security-test-${label}-${stamp}@example.invalid`;
  const password = crypto.randomBytes(24).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`create ${label}: ${error.message}`);
  createdUsers.push(data.user.id);
  const client = fresh();
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`sign in ${label}: ${signInError.message}`);
  return { id: data.user.id, client };
}

async function upload(client, objectPath, upsert = true) {
  const { error } = await client.storage.from(BUCKET).upload(objectPath, blob(), { contentType: "image/png", upsert });
  if (!error) createdPaths.add(objectPath);
  return error;
}

async function sign(client, objectPath) {
  const { data, error } = await client.storage.from(BUCKET).createSignedUrl(objectPath, 60);
  return { url: data?.signedUrl || null, error };
}

async function adminOwnerOf(objectPath) {
  const folder = objectPath.split("/").slice(0, -1).join("/");
  const name = objectPath.split("/").pop();
  const { data } = await admin.storage.from(BUCKET).list(folder, { search: name });
  return data?.find((o) => o.name === name)?.owner || data?.find((o) => o.name === name)?.owner_id || null;
}

(async () => {
  let a;
  let b;
  try {
    a = await makeOperator("a");
    b = await makeOperator("b");

    const eventA = crypto.randomUUID();
    const sessionA = `session-${stamp}`;
    const finalA = `${eventA}/${sessionA}/final.png`;
    const logoA = `${a.id}/appearance/logo.png`;
    const eventB = crypto.randomUUID();
    const finalB = `${eventB}/session-${stamp}/final.png`;

    // ── What a booth does. These must keep working. ──────────────────────
    let err = await upload(a.client, finalA);
    record("booth", "operator uploads a session photo", !err, err?.message || "ok");

    const signedA = await sign(a.client, finalA);
    record("booth", "operator creates a signed link to their own photo", !signedA.error && !!signedA.url, signedA.error?.message || "ok");

    if (signedA.url) {
      const res = await fetch(signedA.url);
      record("booth", "a guest can open that signed link without signing in", res.status === 200, `HTTP ${res.status}`);
    }

    err = await upload(a.client, finalA, true);
    record("booth", "operator re-uploads the same file (booth retry / upsert)", !err, err?.message || "ok");

    err = await upload(a.client, `${eventA}/${sessionA}/render.json`.replace(".json", ".png"));
    record("booth", "operator adds another file to their own session", !err, err?.message || "ok");

    err = await upload(a.client, logoA);
    record("booth", "operator uploads their own logo", !err, err?.message || "ok");
    const signedLogo = await sign(a.client, logoA);
    record("booth", "operator signs their own logo", !signedLogo.error, signedLogo.error?.message || "ok");

    err = await upload(b.client, finalB);
    record("booth", "a second operator uploads to their own event", !err, err?.message || "ok");

    // ── Attacks. Each must be refused. ───────────────────────────────────
    err = await upload(b.client, finalA, true);
    record("attack", "another operator OVERWRITES someone else's guest photo", !!err, err ? `refused: ${err.message}` : "ALLOWED");

    err = await upload(b.client, `${eventA}/${sessionA}/overlay.png`, true);
    record("attack", "another operator PLANTS a file in someone else's session", !!err, err ? `refused: ${err.message}` : "ALLOWED");

    const stolen = await sign(b.client, finalA);
    record("attack", "another operator creates a link to someone else's photo", !!stolen.error || !stolen.url, stolen.url ? "ALLOWED" : `refused: ${stolen.error?.message}`);

    const { data: bDownload, error: bDownloadError } = await b.client.storage.from(BUCKET).download(finalA);
    record("attack", "another operator downloads someone else's photo", !!bDownloadError || !bDownload, bDownload ? "ALLOWED" : `refused: ${bDownloadError?.message}`);

    const { data: bList } = await b.client.storage.from(BUCKET).list(`${eventA}/${sessionA}`);
    record("attack", "another operator lists someone else's session folder", !(bList && bList.length), bList?.length ? `ALLOWED (${bList.length} files visible)` : "nothing visible");

    err = await upload(b.client, logoA, true);
    record("attack", "another operator replaces someone else's logo", !!err, err ? `refused: ${err.message}` : "ALLOWED");

    const anon = fresh();
    const { data: anonList } = await anon.storage.from(BUCKET).list("", { limit: 5 });
    record("attack", "anyone with the public key LISTS the bucket", !(anonList && anonList.length), anonList?.length ? `ALLOWED (${anonList.length}+ folders visible)` : "nothing visible");

    const { data: anonDownload, error: anonDownloadError } = await anon.storage.from(BUCKET).download(finalA);
    record("attack", "anyone with the public key DOWNLOADS a guest photo", !!anonDownloadError || !anonDownload, anonDownload ? "ALLOWED" : `refused: ${anonDownloadError?.message}`);

    const anonUpload = await upload(anon, `${eventA}/${sessionA}/anon.png`, true);
    record("attack", "anyone with the public key uploads", !!anonUpload, anonUpload ? `refused: ${anonUpload.message}` : "ALLOWED");
  } catch (err) {
    console.error("\nTest setup failed:", err.message);
  } finally {
    // ── Clean up everything this run created ─────────────────────────────
    if (createdPaths.size) {
      await admin.storage.from(BUCKET).remove([...createdPaths]).catch(() => {});
    }
    for (const id of createdUsers) {
      await admin.from("profiles").delete().eq("id", id).then(() => {}, () => {});
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
  }

  const width = Math.max(...results.map((r) => r.name.length));
  let insecure = 0;
  for (const group of ["booth", "attack"]) {
    console.log(group === "booth" ? "\nNormal booth operations (must work):" : "\nAttacks (must be refused):");
    for (const r of results.filter((x) => x.group === group)) {
      if (!r.secure) insecure += 1;
      console.log(`  ${r.secure ? "PASS" : "FAIL"}  ${r.name.padEnd(width)}  ${r.detail}`);
    }
  }
  console.log(`\nCleaned up ${createdPaths.size} test file(s) and ${createdUsers.length} test account(s).`);
  console.log(insecure ? `\n${insecure} check(s) not secure.` : "\nAll checks secure.");
  process.exit(insecure ? 1 : 0);
})();
