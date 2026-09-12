// Creates one synthetic session so the render service can be proven end to end
// before any real booth depends on it.
//
// It uploads three short clips and a render recipe under a test prefix, then
// inserts a galleries row left deliberately unfinished (no final_video_url,
// video_status 'pending'). The service should claim it, encode it, upload the
// clip and mark the row ready — either on the next sweep, or immediately if the
// database webhook is wired.
//
// Nothing here touches a real session: the prefix is its own, so a mistake
// cannot overwrite a customer's files.
//
// Run from the repository root:
//
//   $env:SUPABASE_SECRET_KEY = "<your sb_secret_ key>"
//   node scripts/seed-render-test.js
//
// The key is read from the environment and never written anywhere.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://elthktbvojsmvhtxxqnz.supabase.co";
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = "studiophotuna";

if (!KEY) {
  console.error("Set SUPABASE_SECRET_KEY to your sb_secret_ key first.");
  console.error('PowerShell:  $env:SUPABASE_SECRET_KEY = "sb_secret_..."');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const EVENT_ID = "render-service-test";
const SESSION_ID = new Date().toISOString().replace(/[:.]/g, "-");
const PREFIX = `${EVENT_ID}/${SESSION_ID}`;
const SLUG = `render-test-${Date.now().toString(36)}`;

// A 4x6 sheet with three stacked slots, the middle one rotated and zoomed, so
// the test exercises the geometry and not just the happy path.
const RECIPE = {
  layout: {
    layoutKey: "4x6",
    width: 1200,
    height: 1800,
    slots: [
      { x: 0.05, y: 0.04, w: 0.9, h: 0.29 },
      { x: 0.05, y: 0.35, w: 0.9, h: 0.29, rotation: 3, transform: { scale: 1.15, offsetX: 8, offsetY: -6 } },
      { x: 0.05, y: 0.66, w: 0.9, h: 0.29 },
    ],
  },
  slotVideoMap: [0, 1, 2],
  backgroundColor: "#ffffff",
  watermark: false,
};

(async () => {
  const ffmpeg = require("ffmpeg-static");
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "seed-"));

  console.log(`prefix : ${PREFIX}`);
  console.log(`slug   : ${SLUG}`);

  for (let i = 1; i <= 3; i++) {
    const file = path.join(work, `slot-${i}.mp4`);
    execFileSync(ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", `testsrc=size=720x1280:rate=30`,
      "-t", "3", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
      file,
    ]);

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(`${PREFIX}/burst-video/slot-${i}.mp4`, fs.readFileSync(file), {
        contentType: "video/mp4", upsert: true,
      });
    if (error) throw new Error(`upload slot-${i}: ${error.message}`);
    console.log(`  uploaded burst-video/slot-${i}.mp4`);
  }

  const { error: recipeError } = await supabase.storage
    .from(BUCKET)
    .upload(`${PREFIX}/render.json`, Buffer.from(JSON.stringify(RECIPE, null, 2)), {
      contentType: "application/json", upsert: true,
    });
  if (recipeError) throw new Error(`upload render.json: ${recipeError.message}`);
  console.log("  uploaded render.json");

  // burst_video_urls must be non-empty: the claim uses it to tell a session
  // with motion from one without.
  const { error: rowError } = await supabase.from("galleries").insert({
    slug: SLUG,
    event_id: EVENT_ID,
    session_id: SESSION_ID,
    owner_user_id: "0a8b2add-7ab0-4e66-9bee-b1ac03120397",
    final_url: null,
    photo_urls: [],
    burst_video_urls: [1, 2, 3].map((i) => `${PREFIX}/burst-video/slot-${i}.mp4`),
    expires_at: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    video_status: "pending",
  });
  if (rowError) throw new Error(`insert row: ${rowError.message}`);

  console.log("\nSeeded. The sweeper runs every 2 minutes; to trigger it now:");
  console.log(`  curl -X POST https://photuna-gallery-renderer.fly.dev/render \\`);
  console.log(`    -H "content-type: application/json" \\`);
  console.log(`    -H "x-render-secret: <the value in ~/.photuna-render-secret.txt>" \\`);
  console.log(`    -d '{"slug":"${SLUG}"}'`);
})().catch((err) => {
  console.error("\nFailed:", err.message);
  process.exit(1);
});
