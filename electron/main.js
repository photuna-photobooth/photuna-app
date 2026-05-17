// electron/main.js
const { app, BrowserWindow, ipcMain, protocol, session } = require("electron");
const path = require("path");
const fs = require("fs");
const keytar = require('keytar');
const { autoUpdater } = require("electron-updater");
const fsp = fs.promises;
const { pathToFileURL, fileURLToPath } = require("url");
const { execFile } = require("child_process");
const store = require("./store");
const os = require("os");
const fssync = require("fs");
const express = require('express');
const mime = require('mime');
const ffmpegPath = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
function resolveExecutablePath(executablePath) {
  const raw = String(executablePath || "");
  if (!raw) return raw;
  return raw.includes("app.asar")
    ? raw.replace("app.asar", "app.asar.unpacked")
    : raw;
}
ffmpeg.setFfmpegPath(resolveExecutablePath(ffmpegPath));
const crypto = require('crypto');
const fsExtra = require('fs-extra');
const isDev = process.env.NODE_ENV === "development" || process.env.ELECTRON_START_URL;
const APP_NAME = "Studio Photuna Booth App";
const APP_VERSION = app.getVersion();
const APP_AUTHOR = "Photuna LLC";
const APP_WEBSITE = "https://www.studiophotuna.com";
let mainWindow = null;
const APP_SUPPORT_EMAIL = "";
const APP_COPYRIGHT_YEAR = "2024";
const APP_FULL_NAME = `${APP_NAME} v${APP_VERSION}`;
const APP_USER_AGENT = `${APP_NAME}/${APP_VERSION} (${os.type()} ${os.arch()} ${os.release()})`;
const APP_DATA_DIR = app.getPath("userData");
const APP_IS_DEV = isDev;

function loadPrivateEnvironment() {
  const dotenv = require("dotenv");
  const candidates = [
    path.join(__dirname, "..", ".env"),
    path.join(process.resourcesPath || "", ".env"),
    path.join(path.dirname(process.execPath || ""), ".env"),
    path.join(process.cwd(), ".env"),
  ];

  for (const envPath of candidates) {
    if (!envPath || !fs.existsSync(envPath)) continue;
    const result = dotenv.config({ path: envPath, override: false });
    if (!result.error) {
      console.log("[env] loaded private environment from", envPath);
      return envPath;
    }
  }

  console.warn("[env] no .env file found for private app configuration");
  return null;
}

loadPrivateEnvironment();

const SESSION_SERVICE = 'StudioPhotunaSession';
const SESSION_ACCOUNT = 'default';
const LICENSE_KEY_SERVICE = 'StudioPhotunaLicenseKey';
const LICENSE_KEY_ACCOUNT = 'default';

// === Auth constants (ADDED) ===
const AUTH_SERVICE_NAME = "StudioPhotunaAuth";
const AUTH_LAST_USERNAME_KEY = "auth.lastUsername";

const cors = require("cors");
const Stripe = require("stripe");
const jwt = require("jsonwebtoken");
const { createClient } = require("@supabase/supabase-js");

const API_PORT = Number(process.env.API_PORT || 8080);
const FINAL_MOTION_DURATION_SECONDS = 5;

function getPrivateConfigValue(key) {
  const value = process.env[key] ?? "";
  return typeof value === "string" ? value.trim() : value;
}

let stripeClient = null;
let stripeClientKey = null;
function getStripeClient() {
  const secretKey = getPrivateConfigValue("STRIPE_SECRET_KEY");
  if (!secretKey) return null;
  if (!stripeClient || stripeClientKey !== secretKey) {
    stripeClient = new Stripe(secretKey);
    stripeClientKey = secretKey;
  }
  return stripeClient;
}

let supabaseAdmin = null;
let supabaseAdminCacheKey = "";
function createSupabaseAdmin() {
  const supabaseUrl = getPrivateConfigValue("SUPABASE_URL") || getPrivateConfigValue("REACT_APP_SUPABASE_URL");
  const supabaseServiceRoleKey = getPrivateConfigValue("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseServiceRoleKey) return null;

  const cacheKey = `${supabaseUrl}|${supabaseServiceRoleKey}`;
  if (!supabaseAdmin || supabaseAdminCacheKey !== cacheKey) {
    supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);
    supabaseAdminCacheKey = cacheKey;
  }
  return supabaseAdmin;
}

function getSupabaseAdmin() {
  const client = createSupabaseAdmin();
  if (!client) {
    throw new Error(
      "Photuna account services are not configured on this build."
    );
  }
  return client;
}

function isSupabaseAdminConfigured() {
  return Boolean(
    (getPrivateConfigValue("SUPABASE_URL") || getPrivateConfigValue("REACT_APP_SUPABASE_URL")) &&
    getPrivateConfigValue("SUPABASE_SERVICE_ROLE_KEY")
  );
}

const { Blob } = require("buffer");

const { uploadSessionImages } = require("./uploadSessionImages");

/* -------------------------------------------------------
 * Global safety for unhandled rejections (dev-friendly)
 * -----------------------------------------------------*/
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

/* -------------------------------------------------------
 * 📁 Base Paths
 * -----------------------------------------------------*/
const USERDATA = app.getPath("userData");
const USERS_DIR = path.join(USERDATA, "users"); // per-user root
ensureDir(USERS_DIR);

function getEffectiveStorageRoot(userId, storagePath) {
  const custom = String(storagePath || "").trim();
  if (custom) {
    ensureDir(custom);
    return custom;
  }

  const { base } = getPaths(userId);
  const fallback = path.join(base, "booth-output");
  ensureDir(fallback);
  return fallback;
}

function resolveBoothOutputDirs({ userId, eventId = "default", sessionId = "default", storagePath }) {
  const root = getEffectiveStorageRoot(userId, storagePath);
  const eventDir = path.join(root, "events", String(eventId));
  const sessionDir = path.join(eventDir, "sessions", String(sessionId));

  const dirs = {
    root,
    eventDir,
    sessionDir,
    capturesDir: path.join(sessionDir, "captures"),
    finalDir: path.join(sessionDir, "final"),
    burstDir: path.join(sessionDir, "burst"),
    printDir: path.join(sessionDir, "print"),
    metaFile: path.join(sessionDir, "session.json"),
  };

  Object.entries(dirs).forEach(([key, value]) => {
    if (key !== "metaFile" && value !== root) ensureDir(value);
  });

  if (!fs.existsSync(dirs.metaFile)) {
    writeJson(dirs.metaFile, {
      sessionId: String(sessionId),
      eventId: String(eventId),
      createdAt: new Date().toISOString(),
      captures: [],
      finals: [],
      burst: [],
      prints: [],
      slots: [],
    });
  }

  return dirs;
}

// ===== Preview/session paths (per user) =====
function getPreviewRoot(userId) {
  // users/<uid>/preview/sessions
  const { base } = getPaths(userId);
  const dir = path.join(base, 'preview', 'sessions');
  ensureDir(dir);
  return dir;
}
function getSessionDir(userId, sessionId) {
  return path.join(getPreviewRoot(userId), String(sessionId));
}
function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}
function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}


async function transcodeSlotClip(videoDir, slotIndex) {
  // Resolve file system paths
  const rawFs = path.join(videoDir, `slot${slotIndex}_raw.webm`);
  const mp4Fs = path.join(videoDir, `slot${slotIndex}.mp4`);
  const palFs = path.join(videoDir, `slot${slotIndex}_palette.png`);
  const gifFs = path.join(videoDir, `slot${slotIndex}.gif`);

  // FFmpeg needs forward slashes on Windows
  const toFF = p => p.replace(/\\/g, "/");

  const raw = toFF(rawFs);
  const mp4 = toFF(mp4Fs);
  const pal = toFF(palFs);
  const gif = toFF(gifFs);

  // Delete stale files (prevents Windows locking issues)
  for (const f of [mp4Fs, palFs, gifFs]) {
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch { }
  }

  // 1️⃣ Generate MP4
  await new Promise((resolve, reject) => {
    ffmpeg(raw)
      .outputOptions([
        "-an",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "veryfast",
        "-crf", "20",
        "-movflags", "+faststart",
        "-vsync", "cfr",
        "-r", "30",
      ])
      .videoFilters("scale=480:-2:flags=lanczos")
      .on("end", resolve)
      .on("error", reject)
      .save(mp4);
  });

  // 2️⃣ Generate palette PNG
  await new Promise((resolve, reject) => {
    ffmpeg(raw)
      .videoFilters("fps=12,scale=360:-2:flags=lanczos,palettegen")
      .on('end', resolve)
      .on('error', reject)
      .save(pal);
  });

  // Validate palette exists and is non-zero
  if (!fs.existsSync(palFs) || fs.statSync(palFs).size === 0) {
    throw new Error("Palette generation failed — palette file is empty");
  }

  // 3️⃣ Generate GIF (Windows-safe complexFilter)
  await new Promise((resolve, reject) => {
    ffmpeg()
      .input(raw)  // input 0: video
      .input(pal)  // input 1: palette
      .complexFilter([
        "[0:v] fps=12,scale=360:-2:flags=lanczos [x]",
        "[x][1:v] paletteuse=dither=bayer:bayer_scale=5"
      ])
      .on('end', resolve)
      .on('error', reject)
      .save(gif);
  });

  return { raw: rawFs, mp4: mp4Fs, gif: gifFs };
}

function clamp01(n, fallback = 0) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(1, v));
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function toEven(n, min = 2) {
  const v = Math.max(min, Math.round(Number(n) || min));
  return v % 2 === 0 ? v : v + 1;
}

function toSlotPixels(slot, canvasW, canvasH, frame = null) {
  const pad = Number(frame?.padding || 0);

  const innerX = pad;
  const innerY = pad;
  const innerW = Math.max(2, canvasW - pad * 2);
  const innerH = Math.max(2, canvasH - pad * 2);

  return {
    x: Math.round(innerX + clamp01(slot?.x) * innerW),
    y: Math.round(innerY + clamp01(slot?.y) * innerH),
    w: toEven(clamp01(slot?.w, 0.1) * innerW),
    h: toEven(clamp01(slot?.h, 0.1) * innerH),
    rotation: Number(slot?.rotation || 0),

    scale: Math.max(1, Number(slot?.transform?.scale || 1)),
    offsetX: Math.round(Number(slot?.transform?.offsetX || 0)),
    offsetY: Math.round(Number(slot?.transform?.offsetY || 0)),
  };
}

async function createAnimatedComposite({
  userId,
  eventId = "default",
  sessionId = "default",
  storagePath = "",
  layout,
  frameOverlayDataUrl = null,
  slotVideoMap = null,
  backgroundColor = "#ffffff",
}) {
  const { burstDir, finalDir, metaFile } = resolveBoothOutputDirs({
    userId,
    eventId,
    sessionId,
    storagePath,
  });

  const slots = Array.isArray(layout?.slots) ? layout.slots : [];
  if (!slots.length) {
    throw new Error("Missing layout slots for animated composite.");
  }

  const layoutKey = String(layout?.layoutKey || layout?.layout || "4x6").toLowerCase();

  const SHEET_4x6 = { w: 1200, h: 1800 };
  const SHEET_6x4 = { w: 1800, h: 1200 };
  const STRIP_2x6 = { w: 600, h: 1800 };
  const STRIP_6x2 = { w: 1800, h: 600 };

  const isTallStrip = layoutKey === "2x6";
  const isWideStrip = layoutKey === "6x2";
  const isStripLayout = isTallStrip || isWideStrip;

  // renderArea = the single strip area where slots are calculated
  const renderAreaW = isTallStrip
    ? STRIP_2x6.w
    : isWideStrip
      ? STRIP_6x2.w
      : toEven(Number(layout?.width) || 1200);

  const renderAreaH = isTallStrip
    ? STRIP_2x6.h
    : isWideStrip
      ? STRIP_6x2.h
      : toEven(Number(layout?.height) || 1800);

  // final output sheet
  const canvasW = isTallStrip
    ? SHEET_4x6.w
    : isWideStrip
      ? SHEET_6x4.w
      : renderAreaW;

  const canvasH = isTallStrip
    ? SHEET_4x6.h
    : isWideStrip
      ? SHEET_6x4.h
      : renderAreaH;

  const outputFs = path.join(finalDir, "final-motion-1.mp4");
  if (fs.existsSync(outputFs)) {
    try { fs.unlinkSync(outputFs); } catch { }
  }

  let overlayFs = null;
  if (frameOverlayDataUrl && String(frameOverlayDataUrl).startsWith("data:image/")) {
    overlayFs = writeDataUrlToFile(finalDir, "motion-frame-overlay.png", frameOverlayDataUrl);
  }

  const activeSlots = [];
  const resolvedSlotVideoMap = Array.isArray(slotVideoMap)
    ? slotVideoMap
    : Array.isArray(layout?.slotVideoMap)
      ? layout.slotVideoMap
      : [];

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];

    // Which original captured slot should be used for this final slot?
    const mappedSourceIndex =
      Number.isInteger(resolvedSlotVideoMap[i]) ? resolvedSlotVideoMap[i] : i;

    const candidates = [
      path.join(burstDir, `slot${mappedSourceIndex}.mp4`),
      path.join(burstDir, `slot${mappedSourceIndex}.webm`),
      path.join(burstDir, `slot${mappedSourceIndex}_raw.webm`),
    ];

    const file = candidates.find((p) => fs.existsSync(p));
    if (!file) continue;

    activeSlots.push({
      inputIndex: activeSlots.length + 1,
      file,
      slot,
      px: toSlotPixels(slot, renderAreaW, renderAreaH, layout?.frame || null),
    });
  }

  if (!activeSlots.length) {
    throw new Error("No burst slot videos found to compose.");
  }

  const command = ffmpeg();

  const safeBg = String(backgroundColor || "#ffffff");
  command.input(`color=c=${safeBg}@0:s=${renderAreaW}x${renderAreaH}:d=${FINAL_MOTION_DURATION_SECONDS}`);
  command.inputFormat("lavfi");

  activeSlots.forEach(({ file }) => {
    command.input(file);
  });

  if (overlayFs && fs.existsSync(overlayFs)) {
    command.input(overlayFs);
  }

  const filters = [];
  let last = "[0:v]";

  activeSlots.forEach((entry, i) => {
    const inLabel = `[${entry.inputIndex}:v]`;
    const zoomed = `[s${i}a]`;
    const placed = `[s${i}b]`;
    const slotted = `[s${i}c]`;
    const rotated = `[s${i}d]`;
    const overlaid = `[s${i}e]`;

    const {
      x,
      y,
      w,
      h,
      rotation,
      scale = 1,
      offsetX = 0,
      offsetY = 0,
    } = entry.px;

    const radians = ((rotation || 0) * Math.PI) / 180;
    const zoomH = toEven(h * scale);

    // 1) fit by height first, matching preview behavior better than "increase"
    filters.push(
      `${inLabel}setpts=N/(30*TB),fps=30,trim=duration=${FINAL_MOTION_DURATION_SECONDS},scale=-2:${zoomH}${zoomed}`
    );

    // 2) create a working frame that is never smaller than the zoomed input
    const padW = `max(iw\\,${w})`;
    const padH = `max(ih\\,${h})`;
    const padX = `max(0\\,(ow-iw)/2+${offsetX})`;
    const padY = `max(0\\,(oh-ih)/2+${offsetY})`;

    filters.push(
      `${zoomed}pad=${padW}:${padH}:${padX}:${padY}:color=white@0${placed}`
    );

    // 3) crop the final slot window from the centered working frame
    const cropX = `max(0\\,(iw-${w})/2)`;
    const cropY = `max(0\\,(ih-${h})/2)`;

    filters.push(
      `${placed}crop=${w}:${h}:${cropX}:${cropY}${slotted}`
    );

    // 4) rotate if needed
    if (rotation) {
      filters.push(
        `${slotted}rotate=${radians}:fillcolor=none:ow=${w}:oh=${h}${rotated}`
      );
    } else {
      filters.push(`${slotted}null${rotated}`);
    }

    // 5) overlay and keep last frame
    filters.push(
      `${last}${rotated}overlay=${x}:${y}:eof_action=repeat:repeatlast=1${overlaid}`
    );

    last = overlaid;
  });

  if (overlayFs && fs.existsSync(overlayFs)) {
    const overlayInputIndex = activeSlots.length + 1;

    if (isStripLayout) {
      const stripFrameScaled = `[stripFrameScaled]`;
      const stripFramed = `[stripFramed]`;

      // Match final.png: overlay is drawn on the single strip first
      filters.push(
        `[${overlayInputIndex}:v]scale=${renderAreaW}:${renderAreaH}${stripFrameScaled}`,
        `${last}${stripFrameScaled}overlay=0:0${stripFramed}`
      );

      last = stripFramed;
    } else {
      const frameScaled = `[frameScaled]`;
      const finalOut = `[finalOut]`;

      filters.push(
        `[${overlayInputIndex}:v]scale=${canvasW}:${canvasH}${frameScaled}`,
        `${last}${frameScaled}overlay=0:0${finalOut}`
      );

      last = finalOut;
    }
  }

  if (isStripLayout) {
    const stripA = `[stripDupA]`;
    const stripB = `[stripDupB]`;
    const duplicated = `[duplicatedSheet]`;

    filters.push(
      `${last}split=2${stripA}${stripB}`
    );

    if (isTallStrip) {
      filters.push(
        `color=c=white:s=${canvasW}x${canvasH}:d=${FINAL_MOTION_DURATION_SECONDS}[stripSheetBase]`,
        `[stripSheetBase]${stripA}overlay=0:0[tmpStrip1]`,
        `[tmpStrip1]${stripB}overlay=${renderAreaW}:0${duplicated}`
      );
    } else if (isWideStrip) {
      filters.push(
        `color=c=white:s=${canvasW}x${canvasH}:d=${FINAL_MOTION_DURATION_SECONDS}[stripSheetBase]`,
        `[stripSheetBase]${stripA}overlay=0:0[tmpStrip1]`,
        `[tmpStrip1]${stripB}overlay=0:${renderAreaH}${duplicated}`
      );
    }

    // first move last to the duplicated sheet
    last = duplicated;

    // then add divider on the duplicated sheet
    const dividerOut = `[dividerOut]`;

    if (isTallStrip) {
      filters.push(
        `color=c=black@0.15:s=2x${canvasH}:d=${FINAL_MOTION_DURATION_SECONDS}[dividerLine]`,
        `${last}[dividerLine]overlay=${renderAreaW}:0${dividerOut}`
      );
    } else if (isWideStrip) {
      filters.push(
        `color=c=black@0.15:s=${canvasW}x2:d=${FINAL_MOTION_DURATION_SECONDS}[dividerLine]`,
        `${last}[dividerLine]overlay=0:${renderAreaH}${dividerOut}`
      );
    }

    last = dividerOut;
  }

  await new Promise((resolve, reject) => {
    command
      .complexFilter(filters, last.replace(/^\[|\]$/g, ""))
      .outputOptions([
        `-t ${FINAL_MOTION_DURATION_SECONDS}`,
        "-an",
        "-r 30",
        "-c:v libx264",
        "-pix_fmt yuv420p",
        "-preset veryfast",
        "-crf 23",
        "-movflags +faststart",
      ])
      .on("start", (cmd) => console.log("[buildFinalMotion] ffmpeg:", cmd))
      .on("end", resolve)
      .on("error", reject)
      .save(outputFs);
  });

  const meta = readJson(metaFile, {});
  meta.animatedComposite = "final/final-motion-1.mp4";
  writeJson(metaFile, meta);

  return {
    ok: true,
    filePath: outputFs,
    fileUrl: toFileUrl(outputFs),
    relativeKey: "final/final-motion-1.mp4",
  };
}

function dataUrlToBuffer(dataUrl) {
  const match = /^data:(.+);base64,(.*)$/.exec(String(dataUrl || ""));
  if (!match) {
    throw new Error("Invalid data URL");
  }

  return {
    mime: match[1],
    buffer: Buffer.from(match[2], "base64"),
  };
}

async function sourceToBuffer(src) {
  if (!src) throw new Error("Missing source");

  const value = String(src);

  // data URL
  if (value.startsWith("data:")) {
    return dataUrlToBuffer(value);
  }

  // file URL or absolute path
  if (value.startsWith("file:") || path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) {
    const filePath = fromFileUrl(value);
    const buffer = await fsp.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();

    const mimeType =
      ext === ".png" ? "image/png" :
        ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
          ext === ".webp" ? "image/webp" :
            ext === ".gif" ? "image/gif" :
              ext === ".mp4" ? "video/mp4" :
                ext === ".webm" ? "video/webm" :
                  "application/octet-stream";

    return { mime: mimeType, buffer };
  }

  // http/https
  const response = await fetch(value);
  if (!response.ok) {
    throw new Error(`Failed to fetch source: ${response.status} ${response.statusText}`);
  }

  const ab = await response.arrayBuffer();
  return {
    mime: response.headers.get("content-type") || "application/octet-stream",
    buffer: Buffer.from(ab),
  };
}

function toBlobLike({ buffer, mime }) {
  return new Blob([buffer], { type: mime || "application/octet-stream" });
}

function makeSessionId() {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createOnlineGalleryInMain(payload = {}) {
  const userId = payload?.userId || getUserIdFromStore();
  const eventId = payload?.eventId || "default";
  const sessionId =
    payload?.sessionId && payload.sessionId !== "default"
      ? payload.sessionId
      : makeSessionId();

  const slug = sessionId;

  const composedSource =
    payload?.composedImage ||
    payload?.composedImageUrl ||
    payload?.composedImagePath;

  if (!composedSource) {
    throw new Error("No valid composed image found for upload.");
  }

  const finalBlob = toBlobLike(await sourceToBuffer(composedSource));

  const photoSources = Array.isArray(payload?.photos) ? payload.photos.filter(Boolean) : [];
  const photoBlobs = await Promise.all(
    photoSources.map(async (src) => {
      const file = await sourceToBuffer(src);
      return toBlobLike(file);
    })
  );

  const layoutForMotion =
    (payload?.layoutConfig && typeof payload.layoutConfig === "object" ? payload.layoutConfig : null) ||
    (payload?.layout && typeof payload.layout === "object" ? payload.layout : null) ||
    null;

  let finalVideoBlob = null;

  const hasSlots = Array.isArray(layoutForMotion?.slots) && layoutForMotion.slots.length > 0;
  const hasSlotVideos = Array.isArray(payload?.slotVideoMap) && payload.slotVideoMap.length > 0;

  console.log("[gallery:create] motion precheck", {
    hasSlots,
    slotCount: hasSlots ? layoutForMotion.slots.length : 0,
    hasSlotVideos,
    slotVideoMapCount: hasSlotVideos ? payload.slotVideoMap.length : 0,
  });

  try {
    if (hasSlots) {
      const motionResult = await createAnimatedComposite({
        userId,
        eventId,
        sessionId,
        storagePath: payload?.storagePath || "",
        layout: layoutForMotion,
        frameOverlayDataUrl: payload?.frameOverlayDataUrl || null,
        slotVideoMap: payload?.slotVideoMap || [],
        backgroundColor: payload?.motionBackgroundColor || "#ffffff",
      });

      console.log("[gallery:create] motionResult:", motionResult);

      if (motionResult?.ok) {
        const motionSrc =
          motionResult.filePath ||
          motionResult.fileUrl ||
          motionResult.appUrl;

        if (motionSrc) {
          const motionFile = await sourceToBuffer(motionSrc);
          finalVideoBlob = toBlobLike(motionFile);

          console.log("[gallery:create] finalVideoBlob built", {
            type: finalVideoBlob?.type,
            size: finalVideoBlob?.size,
          });
        } else {
          console.warn("⚠️ motionResult ok but no file path returned");
        }
      }
    }
  } catch (err) {
    console.error("❌ createAnimatedComposite FAILED:", err);
    throw err;
  }

  if (!finalVideoBlob) {
    throw new Error("Final motion video was not generated from captured slot videos.");
  }

  const supabaseAdminClient = getSupabaseAdmin();

  const uploadResult = await uploadSessionImages({
    supabase: supabaseAdminClient,
    eventId,
    sessionId,
    finalBlob,
    finalVideoBlob,
    photoBlobs,
    burstVideoBlobs: [],
  });

  console.log("[gallery:create] uploadResult:", uploadResult);

  const galleryPayload = {
    slug,
    event_id: eventId,
    session_id: sessionId,
    final_url: uploadResult.finalUrl,
    final_video_url: uploadResult.finalVideoUrl ?? null,
    photo_urls: Array.isArray(uploadResult.photoUrls) ? uploadResult.photoUrls : [],
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
  const galleryBaseUrl = "https://studiophotuna-gallery.vercel.app/gallery";
  const qrUrl = `${galleryBaseUrl}/${slug}`;
  let galleryWarning = null;

  const { error: galleryError } = await supabaseAdminClient.from("galleries")
    .upsert(galleryPayload, { onConflict: "slug" });

  if (galleryError) {
    galleryWarning = galleryError.message || "Unable to save gallery metadata";
    console.error("[gallery:create] metadata upsert failed:", galleryWarning);
    throw new Error(`Unable to save gallery metadata: ${galleryWarning}`);
  }

  return {
    ok: true,
    sessionId,
    slug,
    qrUrl,
    warning: galleryWarning,
    finalUrl: uploadResult.finalUrl ?? null,
    finalVideoUrl: uploadResult.finalVideoUrl ?? null,
    photoUrls: uploadResult.photoUrls ?? [],
  };
}

function getUserIdFromStore() {
  try {
    return (typeof store.get === 'function' ? store.get('auth.currentUserId') : null) || null;
  } catch { return null; }
}
function ensureUserDirs(userId) {
  const base = path.join(USERS_DIR, String(userId || 'anon'));
  const paths = {
    base,
    eventsFile: path.join(base, "events.json"),
    eventsDir: path.join(base, "events"),
    capturesDir: path.join(base, "captures"),
    templatesDir: path.join(base, "templates"),
    assetsDir: path.join(base, "assets"),
  };

  // ensure directories exist
  ensureDir(paths.base);
  ensureDir(paths.capturesDir);
  ensureDir(paths.templatesDir);
  ensureDir(paths.assetsDir);
  // ensure per-user events.json exists
  if (!fs.existsSync(paths.eventsFile)) {
    fs.writeFileSync(paths.eventsFile, JSON.stringify([], null, 2), "utf8");
  }
  return paths;
}

function getPaths(userId) {
  return ensureUserDirs(userId || getUserIdFromStore());
}

/* -------------------------------------------------------
 * 🧩 Utilities
 * -----------------------------------------------------*/
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Scoped: ensure per-user per-event capture folder
function ensureCaptureFolder(userId, eventId) {
  const { capturesDir } = getPaths(userId);
  const dir = path.join(capturesDir, String(eventId ?? "default"));
  ensureDir(dir);
  return dir;
}

function getEventDataFile(userId, eventId = "default") {
  const { eventsDir } = getPaths(userId);
  ensureDir(eventsDir);
  return path.join(eventsDir, `event_${eventId}.json`);
}

// Safer file:// URL (handles Windows/macOS/Linux)
function toFileUrl(absPath) {
  try {
    return pathToFileURL(absPath).href; // e.g., file:///C:/...  or  file:///Users/...
  } catch {
    // fallback (shouldn't be used normally)
    let normalized = String(absPath).replace(/\\/g, "/");
    if (!normalized.startsWith("/")) normalized = "/" + normalized;
    return encodeURI("file://" + normalized);
  }
}

function fromFileUrl(urlOrPath) {
  if (!urlOrPath) return urlOrPath;
  const s = String(urlOrPath);
  if (s.startsWith("file:")) {
    return fileURLToPath(s); // correct platform path
  }
  return s; // already a raw path
}

function sanitizeFilename(name) {
  return String(name || "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_");
}

function mimeToExt(mime) {
  const map = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/svg+xml": ".svg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/ogg": ".ogv",
    "video/quicktime": ".mov",
  };
  return map[mime] || "";
}

function formatBytes(bytes = 0) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return "Unknown";

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function canWriteToDirectory(targetPath) {
  try {
    const testFile = path.join(
      targetPath,
      `.write-test-${process.pid}-${Date.now()}.tmp`
    );
    await fs.writeFile(testFile, "ok");
    await fs.unlink(testFile);
    return true;
  } catch {
    return false;
  }
}

async function getDirectoryStats(targetPath) {
  let fileCount = 0;
  let totalBytes = 0;

  async function walk(currentPath) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        fileCount += 1;
        try {
          const stat = await fs.stat(fullPath);
          totalBytes += stat.size || 0;
        } catch {
          // ignore unreadable files
        }
      }
    }
  }

  await walk(targetPath);
  return { fileCount, totalBytes };
}

function writeDataUrlToFile(dir, filename, dataUrl) {
  const match = /^data:(.+);base64,(.*)$/.exec(dataUrl);
  if (!match) throw new Error("Invalid data URL");

  const base64 = match[2];
  const buffer = Buffer.from(base64, "base64");

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

function getNativePrintHelperPath() {
  const exeName = process.platform === "win32"
    ? "photo-print-helper.exe"
    : "photo-print-helper";

  const appPath = app.getAppPath();
  const devRoot = path.resolve(__dirname, "..");

  const candidates = [
    // packaged build
    path.join(process.resourcesPath, exeName),
    path.join(process.resourcesPath, "bin", exeName),

    // app paths
    path.join(appPath, exeName),
    path.join(appPath, "bin", exeName),
    path.join(appPath, "electron", "bin", exeName),

    // development paths
    path.join(__dirname, exeName),
    path.join(__dirname, "bin", exeName),
    path.join(devRoot, exeName),
    path.join(devRoot, "bin", exeName),
    path.join(devRoot, "electron", "bin", exeName),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        console.log("Native print helper found:", candidate);
        return candidate;
      }
    } catch { }
  }

  console.error("Native print helper not found. Checked paths:", candidates);
  return null;
}

function mapLayoutToNativeMedia(layout) {
  const normalized = String(layout || "4x6").toLowerCase();
  switch (normalized) {
    case "6x4":
      return { media: "6x4", widthIn: 6, heightIn: 4, landscape: true };
    case "2x6":
      return { media: "2x6", widthIn: 2, heightIn: 6, landscape: false };
    case "6x2":
      return { media: "6x2", widthIn: 6, heightIn: 2, landscape: true };
    case "4x6":
    default:
      return { media: "4x6", widthIn: 4, heightIn: 6, landscape: false };
  }
}

function mapPaperSizeToNativeMedia(paperSize, fallbackLayout = "4x6") {
  const raw = String(paperSize || "").trim();
  const normalized = raw.toLowerCase().replace(/[×]/g, "x");

  switch (normalized) {
    case "4x6":
    case "photo 4x6":
    case "north america 4x6":
      return { media: raw, widthIn: 4, heightIn: 6, landscape: false };

    case "6x4":
    case "photo 6x4":
      return { media: raw, widthIn: 6, heightIn: 4, landscape: true };

    case "2x6":
    case "photo 2x6":
      return { media: raw, widthIn: 2, heightIn: 6, landscape: false };

    case "6x2":
    case "photo 6x2":
      return { media: raw, widthIn: 6, heightIn: 2, landscape: true };

    default:
      return {
        ...mapLayoutToNativeMedia(fallbackLayout),
        media: raw || mapLayoutToNativeMedia(fallbackLayout).media,
      };
  }
}

function runNativePrintHelper({
  filePath,
  printer,
  layout,
  paperSize,
  copies,
  colorMode,
  quality,
  orientation,
  duplexMode,
  dpi,
  usePrinterDefaults,
}) {
  return new Promise((resolve, reject) => {
    const helperPath = getNativePrintHelperPath();

    if (!helperPath) {
      reject(
        new Error(
          "Native print helper not found. Place photo-print-helper.exe in /electron/bin, /bin, or the packaged resources folder."
        )
      );
      return;
    }

    const mediaSpec = mapPaperSizeToNativeMedia(paperSize, layout);

    const args = [
      "--file", filePath,
      "--printer", String(printer || ""),
      "--layout", String(mediaSpec.media || layout || "4x6"),
      "--copies", String(Math.max(1, Number(copies) || 1)),
      "--color", String(colorMode || "color"),
      "--quality", String(quality || "standard"),
      "--orientation", String(
        orientation && orientation !== "auto"
          ? orientation
          : mediaSpec.landscape ? "landscape" : "portrait"
      ),
      "--duplex", String(duplexMode || "simplex"),
      "--dpi", String(Number(dpi) || 300),
      "--use-printer-defaults", usePrinterDefaults ? "true" : "false",
    ];

    execFile(helperPath, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || stdout || error.message || "Native print helper failed"));
        return;
      }

      resolve({
        ok: true,
        helperPath,
        stdout,
        stderr,
      });
    }
    );
  });
}

function writeBytesToFile(baseDir, filename, bytes) {
  ensureDir(baseDir);
  const fullPath = path.join(baseDir, filename);
  fs.writeFileSync(fullPath, Buffer.from(bytes));
  return fullPath;
}

function sanitizeRelKey(rel) {
  // prevent traversal, normalize slashes
  const clean = String(rel || "").replace(/\\/g, "/").replace(/\.\./g, "");
  return clean.replace(/^\/+/, "");
}



// Build app:// URL for assets (mapped via custom protocol below)
function toAppUrl(relativeKey) {
  const rel = sanitizeRelKey(relativeKey);
  return `app://assets/${rel}`;
}

// Ensure DB file exists
// Legacy global file ensured above is replaced by per-user events.json created lazily in ensureUserDirs()
//try {
//  if (!fs.existsSync(DB_FILE)) {
//    ensureDir(path.dirname(DB_FILE));
//    fs.writeFileSync(DB_FILE, JSON.stringify([]), "utf-8");
//  }
//} catch (err) {
// console.error("Error ensuring DB file:", err);
//}

/* -------------------------------------------------------
 * ----------------- IPC HANDLERS (module-level) -----------------------
 * -----------------------------------------------------*/

/* --------------------
   Legacy Photo API
   -------------------- */
ipcMain.handle(
  "captured-photo",
  async (_event, { eventId = "default", sessionId = "default", photoData, userId = null, storagePath = "" }) => {
    try {
      const { capturesDir } = resolveBoothOutputDirs({ userId, eventId, sessionId, storagePath });
      const filename = `photo-${Date.now()}.png`;
      const fullPath = path.join(capturesDir, filename);
      fs.writeFileSync(fullPath, photoData, "base64");
      return toFileUrl(fullPath);
    } catch (err) {
      console.error("captured-photo error:", err);
      return { ok: false, error: String(err) };
    }
  }
);


ipcMain.handle("get-captured-photos",
  async (_event, eventIdOrOpts = "default", userId = null) => {
    const eventId = typeof eventIdOrOpts === 'string'
      ? eventIdOrOpts
      : (eventIdOrOpts?.eventId ?? "default");
    userId = typeof eventIdOrOpts === 'object'
      ? (eventIdOrOpts?.userId ?? userId)
      : userId;
    try {
      const folder = ensureCaptureFolder(userId, eventId);
      if (!fs.existsSync(folder)) return [];
      return fs
        .readdirSync(folder)
        .filter((f) => /\.(jpg|jpeg|png)$/i.test(f))
        .map((f) => toFileUrl(path.join(folder, f)));
    } catch (err) {
      console.error("get-captured-photos error:", err);
      return [];
    }
  }
);

ipcMain.handle("media:listCameras", async (event) => {
  // Use the renderer that called this
  return await event.sender.executeJavaScript(`
    navigator.mediaDevices.enumerateDevices()
      .then(devices =>
        devices
          .filter(d => d.kind === "videoinput")
          .map(d => ({
            id: d.deviceId,
            label: d.label || "Camera"
          }))
      )
  `);
});

ipcMain.handle("media:getCameraCapabilities", async (event, cameraId) => {
  const safeCameraId = JSON.stringify(String(cameraId || ""));

  return await event.sender.executeJavaScript(`
    (async () => {
      const cameraId = ${safeCameraId};
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera capture is not available in this renderer.");
      }

      const constraints = cameraId
        ? { video: { deviceId: { exact: cameraId } }, audio: false }
        : { video: true, audio: false };

      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        const track = stream.getVideoTracks()[0];
        if (!track) throw new Error("No video track was returned.");

        const capabilities =
          typeof track.getCapabilities === "function"
            ? track.getCapabilities()
            : {};
        const settings =
          typeof track.getSettings === "function"
            ? track.getSettings()
            : {};

        return {
          ok: true,
          deviceId: settings.deviceId || cameraId || null,
          label: track.label || "Camera",
          capabilities,
          settings,
        };
      } finally {
        if (stream) {
          stream.getTracks().forEach((track) => track.stop());
        }
      }
    })()
  `);
});

/* --------------------
   New Photo API (System A)
   -------------------- */

ipcMain.handle("output:build-final-motion", async (_event, payload = {}) => {
  try {
    const {
      eventId = "default",
      sessionId = "default",
      userId = null,
      storagePath = "",
      layout = null,
    } = payload || {};

    const result = await createAnimatedComposite({
      userId: userId || getUserIdFromStore(),
      eventId,
      sessionId,
      storagePath,
      layout,
      frameOverlayDataUrl: payload.frameOverlayDataUrl || null,
      slotVideoMap: payload.slotVideoMap || null,
      backgroundColor: payload.backgroundColor || "#ffffff",
    });

    return result;
  } catch (err) {
    console.error("output:build-final-motion error:", err);
    return { ok: false, error: err?.message || String(err) };
  }
});

async function handleCapturePhoto(event, payload) {
  try {
    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid payload for capture-photo");
    }

    const { dataUrl, index, eventId, sessionId = "default", userId, storagePath = "" } = payload || {};

    if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
      throw new Error("Invalid dataUrl");
    }

    const idx =
      typeof index === "number" || typeof index === "string"
        ? String(index)
        : Date.now().toString();

    const { capturesDir } = resolveBoothOutputDirs({ userId, eventId, sessionId, storagePath });
    const baseDir = capturesDir;
    await fsp.mkdir(baseDir, { recursive: true });

    const matches = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!matches) {
      throw new Error("dataUrl is not a valid base64 image");
    }

    const mimeType = matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, "base64");

    const ext = mimeToExt(mimeType) || ".png";
    const safeIndex = String(idx).padStart(2, "0");
    const filename = `capture_${safeIndex}${ext}`;
    const filePath = path.join(baseDir, filename);

    await fsp.writeFile(filePath, buffer);

    // update session.json
    const { metaFile } = resolveBoothOutputDirs({ userId, eventId, sessionId, storagePath });
    const meta = readJson(metaFile, {});
    meta.captures = Array.isArray(meta.captures) ? meta.captures : [];
    meta.captures.push({
      index: Number(idx),
      file: `captures/${filename}`,
      createdAt: new Date().toISOString(),
    });
    writeJson(metaFile, meta);

    return { ok: true, filePath, fileUrl: toFileUrl(filePath) };
  } catch (err) {
    console.error("capture-photo error:", err);
    return { ok: false, error: err.message || String(err) };
  }
};

ipcMain.handle(
  "captures:list",
  async (_event, { eventId = "default", sessionId = "default", userId, storagePath = "" } = {}) => {
    try {
      const { capturesDir } = resolveBoothOutputDirs({ userId, eventId, sessionId, storagePath });
      if (!fs.existsSync(capturesDir)) return [];

      const files = fs
        .readdirSync(capturesDir)
        .filter((f) => /\.(jpg|jpeg|png)$/i.test(f))
        .map((f) => path.join(capturesDir, f))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

      return files.map(toFileUrl);
    } catch (err) {
      console.error("captures:list error:", err);
      return [];
    }
  }
);

ipcMain.handle("output:save-final-png", async (_event, payload = {}) => {
  try {
    const {
      imageData,
      eventId = "default",
      sessionId = "default",
      userId,
      storagePath = "",
      filename,
    } = payload;

    if (!imageData || !String(imageData).startsWith("data:image/")) {
      throw new Error("Invalid final PNG data");
    }

    const { finalDir, metaFile } = resolveBoothOutputDirs({ userId, eventId, sessionId, storagePath });
    const safeName = sanitizeFilename(filename || `final_composed_${Date.now()}.png`);
    const savedPath = writeDataUrlToFile(finalDir, safeName, imageData);

    const meta = readJson(metaFile, {});
    meta.finals = Array.isArray(meta.finals) ? meta.finals : [];
    meta.finals.push({
      file: `final/${safeName}`,
      createdAt: new Date().toISOString(),
    });
    meta.finalPrint = `final/${safeName}`;
    writeJson(metaFile, meta);

    return { ok: true, savedPath, fileUrl: toFileUrl(savedPath) };
  } catch (err) {
    console.error("output:save-final-png error:", err);
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle("output:save-print-copy", async (_event, payload = {}) => {
  try {
    const {
      imageData,
      eventId = "default",
      sessionId = "default",
      userId,
      storagePath = "",
      filename,
    } = payload;

    if (!imageData || !String(imageData).startsWith("data:image/")) {
      throw new Error("Invalid print PNG data");
    }

    const { printDir, metaFile } = resolveBoothOutputDirs({ userId, eventId, sessionId, storagePath });
    const safeName = sanitizeFilename(filename || `print_copy_${Date.now()}.png`);
    const savedPath = writeDataUrlToFile(printDir, safeName, imageData);

    const meta = readJson(metaFile, {});
    meta.prints = Array.isArray(meta.prints) ? meta.prints : [];
    meta.prints.push({
      file: `print/${safeName}`,
      createdAt: new Date().toISOString(),
    });
    writeJson(metaFile, meta);

    return { ok: true, savedPath, fileUrl: toFileUrl(savedPath) };
  } catch (err) {
    console.error("output:save-print-copy error:", err);
    return { ok: false, error: String(err) };
  }
});

/* --------------------
   Aliases (compatibility)
   -------------------- */
ipcMain.handle("capture-photo", handleCapturePhoto);
ipcMain.handle("capturePhoto", handleCapturePhoto); // alias

ipcMain.handle("getCapturedPhotos", async (_evt, eventIdOrArg) => {
  const eventId = typeof eventIdOrArg === "string"
    ? eventIdOrArg
    : (eventIdOrArg?.eventId ?? "default");
  const userId = typeof eventIdOrArg === "object"
    ? eventIdOrArg?.userId ?? null
    : null;
  try {
    const folder = ensureCaptureFolder(userId, eventId);
    if (!fs.existsSync(folder)) return [];
    return fs
      .readdirSync(folder)
      .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
      .map(f => toFileUrl(path.join(folder, f)));
  } catch (err) {
    console.error("getCapturedPhotos error:", err);
    return [];
  }
});

/* -------------------------------------------------------
 * Events / Templates / Printing handlers (unchanged)
 * -----------------------------------------------------*/
ipcMain.handle("sync-event", async (_event, action) => {
  const { eventsFile } = getPaths(action?.userId);
  let events = [];
  try {
    events = JSON.parse(fs.readFileSync(eventsFile, "utf8"));
  } catch (err) {
    events = [];
  }

  switch (action.type) {
    case "add":
      events.push(action.event);
      break;
    case "update": {
      const idx = events.findIndex((e) => e.id === action.event.id);
      if (idx !== -1) events[idx] = action.event;
      else events.push(action.event);
      break;
    }
    case "delete":
      events = events.filter((e) => e.id !== action.eventId);
      break;
  }

  try {
    fs.writeFileSync(eventsFile, JSON.stringify(events, null, 2));
  } catch (err) {
    console.error("Failed to save per-user events.json:", err);
  }

  return { success: true };
});

ipcMain.handle("load-events", async (_e, { userId } = {}) => {
  try {
    const { eventsFile } = getPaths(userId);
    return JSON.parse(fs.readFileSync(eventsFile, "utf8"));
  } catch (err) {
    console.error("load-events error:", err);
    return [];
  }
});

/* Per-event data */
ipcMain.handle("save-event-data", async (_event, payload = {}) => {
  try {
    // Allow both legacy shape (data) and new shape ({ userId, ...data })
    const { userId, ...data } = payload;
    const uid = userId ?? getUserIdFromStore();
    const file = getEventDataFile(uid, data?.id ?? "default");
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
    return true;
  } catch (err) {
    console.error("save-event-data error:", err);
    return false;
  }
});

ipcMain.handle("get-event-data", async (_event, arg) => {
  try {
    // Support both legacy arg = "eventId" and new arg = { eventId, userId }
    const { eventId = "default", userId = null } =
      typeof arg === "object" ? (arg || {}) : { eventId: arg, userId: null };
    const uid = userId ?? getUserIdFromStore();
    const file = getEventDataFile(uid, eventId);
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
    return null;
  } catch (err) {
    console.error("get-event-data error:", err);
    return null;
  }
});

/* Templates */
ipcMain.handle("template:get", async (_event, { eventId, userId } = {}) => {
  try {

    const { templatesDir } = getPaths(userId);
    const file = path.join(templatesDir, `template_${eventId}.json`);

    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (err) {
    console.error("template:get error:", err);
  }
  return {
    id: "five-slot",
    name: "3 top + 2 bottom",
    slots: [{ id: "s1" }, { id: "s2" }, { id: "s3" }, { id: "s4" }, { id: "s5" }],
  };
});

ipcMain.handle("template:saveSelection", async (_event, payload) => {
  try {
    const { eventId, userId } = payload || {};

    const { templatesDir } = getPaths(userId);
    ensureDir(templatesDir);
    const file = path.join(templatesDir, `selection_${eventId ?? "default"}.json`);

    fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf-8");
    return { ok: true, file };
  } catch (err) {
    console.error("template:saveSelection error:", err);
    return { ok: false, error: String(err) };
  }
});

/* Printing */
ipcMain.handle("print-photo", async (event, {
  printer,
  imageData,
  layout = "4x6",
  paperSize = "4x6",
  copies = 1,
  colorMode = "color",
  quality = "standard",
  orientation = "auto",
  duplexMode = "simplex",
  dpi = 300,
  usePrinterDefaults = false,
}) => {
  try {
    if (!printer) throw new Error("No printer name");
    if (!imageData || typeof imageData !== "string" || !imageData.startsWith("data:image")) {
      throw new Error("Invalid image");
    }

    const sender = BrowserWindow.fromWebContents(event.sender);
    const printers = await sender.webContents.getPrintersAsync();

    const normalizedLayout = String(layout || "4x6").toLowerCase();
    const isStripLayout = normalizedLayout === "2x6" || normalizedLayout === "6x2";

    // Try exact printer first
    const exactPrinter =
      printers.find(p => p.name === printer || p.displayName === printer) || null;

    if (!exactPrinter) {
      throw new Error(`Requested printer not found: ${printer}`);
    }

    // Only use -STRIP if it actually exists
    let resolvedPrinter = exactPrinter.name;

    if (isStripLayout) {
      const stripName = `${exactPrinter.name}-STRIP`;
      const stripPrinter = printers.find(
        p => p.name === stripName || p.displayName === stripName
      );

      if (stripPrinter) {
        resolvedPrinter = stripPrinter.name;
      } else {
        console.warn(`Strip printer not found, falling back to base printer: ${stripName}`);
      }
    }

    const tempDir = path.join(app.getPath("temp"), "photuna-prints");
    const fileName = `photuna-${normalizedLayout}-${Date.now()}.png`;
    const samplePath = writeDataUrlToFile(tempDir, fileName, imageData);

    console.log("NATIVE ARTIFACT PRINT ----------------");
    console.log("Requested printer:", printer);
    console.log("Resolved printer:", resolvedPrinter);
    console.log("Layout:", normalizedLayout);
    console.log("Copies:", copies);
    console.log("Color mode:", colorMode);
    console.log("Quality:", quality);
    console.log("Orientation:", orientation);
    console.log("Duplex:", duplexMode);
    console.log("DPI:", dpi);
    console.log("Use printer defaults:", !!usePrinterDefaults);
    console.log("PNG path:", samplePath);

    // after nativeResult is returned but before the return statement:
    const win = BrowserWindow.fromWebContents(event.sender);
    let progress = 0;
    const interval = setInterval(() => {
      progress = Math.min(1, progress + 0.1);
      win.webContents.send('print-progress', progress);
      if (progress >= 1) clearInterval(interval);
    }, 1000);

    const nativeResult = await runNativePrintHelper({
      filePath: samplePath,
      printer: resolvedPrinter,
      layout: normalizedLayout,
      paperSize: paperSize,
      copies,
      colorMode,
      quality,
      orientation,
      duplexMode,
      dpi,
      usePrinterDefaults,
    });

    console.log("Native helper result:", nativeResult);

    return {
      ok: true,
      printer: resolvedPrinter,
      layout: normalizedLayout,
      samplePath,
      driver: "native-helper",
    };
  } catch (err) {
    console.error("print-photo failed:", err);
    return {
      ok: false,
      error: err.message || String(err),
    };
  }
});

ipcMain.handle("gallery:create", async (_event, payload) => {
  try {
    return await createOnlineGalleryInMain(payload);
  } catch (err) {
    console.error("[gallery:create] failed:", err);
    return {
      ok: false,
      error: err?.message || "Failed to create online gallery",
    };
  }
});

ipcMain.handle("get-printers", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win.webContents.getPrintersAsync();
});

ipcMain.handle("test-print", (event, printJob) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win.webContents.print({ deviceName: printJob.printer, copies: printJob.copies || 1, silent: false });
});

// Listen for a hardware shutter press from the renderer
ipcMain.on('trigger-shutter', (event) => {
  // broadcast to all windows (could also call capture-photo directly)
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('trigger-shutter');
  });
});

// Relay eventsUpdated notifications (call this whenever your store updates events)
function broadcastEventsUpdated(payload) {
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('eventsUpdated', payload);
  });
}

ipcMain.handle("app:clear-cache", async () => {
  try {
    await session.defaultSession.clearCache();
    return { ok: true, message: "Cache cleared successfully" };
  } catch (error) {
    console.error("app:clear-cache failed", error);
    return { ok: false, error: error.message || "Failed to clear cache" };
  }
});

ipcMain.handle("get-preview-slot-clips", async (event, { sessionId, options }) => {
  try {
    console.log("[MAIN] get-preview-slot-clips:", sessionId);

    const userId = getUserIdFromStore();

    const { burstDir } = resolveBoothOutputDirs({
      userId,
      eventId: options?.eventId || "default",
      sessionId,
      storagePath: "",
    });

    console.log("[MAIN] resolved burstDir:", burstDir);

    if (!fs.existsSync(burstDir)) {
      console.warn("[MAIN] burstDir does not exist:", burstDir);
      return [];
    }

    const files = await fs.promises.readdir(burstDir);

    const clips = files
      .filter((f) => f.endsWith(".webm") || f.endsWith(".mp4"))
      .map((file) => {
        const fullPath = path.join(burstDir, file);

        return {
          fileUrl: `file://${fullPath}`,
          path: fullPath,
        };
      });

    console.log("[MAIN] clips found:", clips);

    return clips;
  } catch (err) {
    console.error("[MAIN] getPreviewSlotClips error:", err);
    return [];
  }
});

ipcMain.handle("storage:info", async (_event, targetPath) => {
  try {
    if (!targetPath || typeof targetPath !== "string") {
      return {
        ok: false,
        error: "No storage path provided",
      };
    }

    const exists = await pathExists(targetPath);
    if (!exists) {
      return {
        ok: true,
        exists: false,
        writable: false,
        path: targetPath,
        message: "Folder does not exist",
      };
    }

    const stat = await fs.stat(targetPath);
    if (!stat.isDirectory()) {
      return {
        ok: true,
        exists: true,
        writable: false,
        path: targetPath,
        message: "Path is not a folder",
      };
    }

    const writable = await canWriteToDirectory(targetPath);

    let stats = { fileCount: 0, totalBytes: 0 };
    try {
      stats = await getDirectoryStats(targetPath);
    } catch {
      // keep fallback values
    }

    return {
      ok: true,
      exists: true,
      writable,
      path: targetPath,
      fileCount: stats.fileCount,
      totalBytes: stats.totalBytes,
      totalSize: formatBytes(stats.totalBytes),
      freeSpace: "Unknown",
      message: writable ? "Storage folder is ready" : "Storage folder is not writable",
    };
  } catch (error) {
    console.error("storage:info failed", error);
    return {
      ok: false,
      error: error.message || "Failed to inspect storage folder",
    };
  }
});

ipcMain.handle("storage:cleanup", async (_event, payload = {}) => {
  try {
    const targetPath = payload?.path;
    const autoDeleteDays = Number(payload?.autoDeleteDays ?? 0);

    if (!targetPath || typeof targetPath !== "string") {
      return {
        ok: false,
        error: "No storage path provided",
      };
    }

    if (!autoDeleteDays || autoDeleteDays <= 0) {
      return {
        ok: true,
        deletedCount: 0,
        message: "Auto cleanup is disabled",
      };
    }

    const exists = await pathExists(targetPath);
    if (!exists) {
      return {
        ok: false,
        error: "Storage folder does not exist",
      };
    }

    const cutoffMs = Date.now() - autoDeleteDays * 24 * 60 * 60 * 1000;
    let deletedCount = 0;
    let failedCount = 0;

    async function walkAndCleanup(currentPath) {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);

        if (entry.isDirectory()) {
          await walkAndCleanup(fullPath);
          continue;
        }

        if (!entry.isFile()) continue;

        try {
          const stat = await fs.stat(fullPath);
          const modifiedTime = stat.mtimeMs || 0;

          if (modifiedTime <= cutoffMs) {
            await fs.unlink(fullPath);
            deletedCount += 1;
          }
        } catch {
          failedCount += 1;
        }
      }
    }

    await walkAndCleanup(targetPath);

    return {
      ok: true,
      deletedCount,
      failedCount,
      message:
        deletedCount > 0
          ? `Cleanup completed. Deleted ${deletedCount} file${deletedCount === 1 ? "" : "s"}.`
          : "Cleanup completed. No files matched the cleanup rule.",
    };
  } catch (error) {
    console.error("storage:cleanup failed", error);
    return {
      ok: false,
      error: error.message || "Failed to clean storage folder",
    };
  }
});

ipcMain.handle("app:check-updates", async () => {
  try {
    const result = await autoUpdater.checkForUpdates();

    return {
      ok: true,
      hasUpdate: !!result?.updateInfo && result.updateInfo.version !== app.getVersion(),
      version: result?.updateInfo?.version || app.getVersion(),
      message: "Update check completed",
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || "Failed to check for updates",
    };
  }
});

ipcMain.handle("app:download-update", async () => {
  try {
    await autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || "Failed to download update",
    };
  }
});

ipcMain.handle("app:install-update", async () => {
  try {
    setImmediate(() => {
      autoUpdater.quitAndInstall(false, true);
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || "Failed to install update",
    };
  }
});

ipcMain.handle("printer:get-capabilities", async (event, printerName) => {
  const sender = BrowserWindow.fromWebContents(event.sender);
  const printers = await sender.webContents.getPrintersAsync();
  const printer = printers.find(p => p.name === printerName);

  if (!printer) throw new Error("Printer not found");

  const opts = printer.options || {};

  return {
    name: printer.name,
    displayName: printer.displayName || printer.name,
    description: printer.description || "",
    status: printer.status ?? null,
    isDefault: !!printer.isDefault,
    options: opts,

    // normalized values for your UI
    orientation:
      opts.orientation || null,

    paperSizes:
      opts.paperSizes || opts.supportedPaperSizes || [],

    colorModes:
      opts.color ? ["color", "grayscale"] : ["color", "grayscale"],

    qualities:
      opts.printQuality ? [opts.printQuality] : ["draft", "standard", "high"],

    duplexModes:
      ["simplex", "shortEdge", "longEdge"],

    dpi: {
      horizontal: Number(opts.horizontalDpi || opts.dpi || 300),
      vertical: Number(opts.verticalDpi || opts.dpi || 300),
    },
  };
});

/* -------------------------------------------------------
 * 🪟 Window Setup
 * -----------------------------------------------------*/
function createWindow() {

  const isDev =
    process.env.NODE_ENV === 'development' || !!process.env.ELECTRON_START_URL;

  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      ...(isDev ? {
        webSecurity: false,
        allowRunningInsecureContent: true,
        allowFileAccess: true,
      } : {})
    },
  });

  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  if (isDev) {
    win.loadURL(process.env.ELECTRON_START_URL || "http://localhost:3000");
    process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = true;
  } else {
    win.loadFile(path.join(__dirname, "..", "build", "index.html"));
  }
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    mainWindow?.webContents.send("updater:status", {
      status: "checking",
      message: "Checking for updates...",
    });
  });

  autoUpdater.on("update-available", (info) => {
    mainWindow?.webContents.send("updater:status", {
      status: "available",
      message: "Update available",
      version: info?.version || "",
      info,
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    mainWindow?.webContents.send("updater:status", {
      status: "not-available",
      message: "App is up to date",
      version: info?.version || app.getVersion(),
      info,
    });
  });

  autoUpdater.on("error", (error) => {
    mainWindow?.webContents.send("updater:status", {
      status: "error",
      message: error?.message || "Updater error",
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    mainWindow?.webContents.send("updater:status", {
      status: "downloading",
      message: "Downloading update...",
      percent: progress?.percent ?? 0,
      bytesPerSecond: progress?.bytesPerSecond ?? 0,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    mainWindow?.webContents.send("updater:status", {
      status: "downloaded",
      message: "Update downloaded. Ready to install.",
      version: info?.version || "",
      info,
    });
  });
}

let apiServer = null;

async function requireSupabaseUser(req, res, next) {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({
        error: "Photuna account services are not configured on this build.",
      });
    }

    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: "Missing authorization token" });
    }

    const { data, error } = await getSupabaseAdmin().auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({ error: "Invalid authorization token" });
    }

    req.supabaseUser = data.user;
    next();
  } catch (err) {
    console.error("requireSupabaseUser failed:", err);
    return res.status(401).json({ error: "Authentication failed" });
  }
}

function mapPlanToLicense(plan, state = "active") {
  if (plan === "yearly") {
    return {
      plan: "yearly",
      state,
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      max_events: 9999,
      templates: 9999,
      watermark: false,
      priority_support: true,
    };
  }

  if (plan === "monthly") {
    return {
      plan: "monthly",
      state,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      max_events: 100,
      templates: 999,
      watermark: false,
      priority_support: false,
    };
  }

  return {
    plan: "free",
    state: "active",
    expires_at: null,
    max_events: 1,
    templates: 1,
    watermark: true,
    priority_support: false,
  };
}

async function upsertLicense(userId, plan, state = "active", extra = {}) {
  const license = mapPlanToLicense(plan, state);

  const { error } = await getSupabaseAdmin().from("licenses").upsert(
    {
      user_id: userId,
      ...license,
      ...extra,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (error) throw error;

  // Keep profiles.subscription_plan in sync so AuthContext reflects the real plan
  getSupabaseAdmin().from("profiles")
    .update({ subscription_plan: plan })
    .eq("id", userId)
    .then(() => {}).catch((e) => console.warn("[upsertLicense] profile sync failed:", e.message));

  return license;
}

function startBillingApiServer() {
  if (apiServer) return;

  const apiApp = express();

  // Allow requests from the React dev server AND from the packaged app (file://)
  apiApp.use(cors({
    origin: (origin, cb) => cb(null, true),
    credentials: true,
  }));

  // Stripe webhook needs raw body before express.json()
  apiApp.post(
    "/billing/webhook",
    express.raw({ type: "application/json" }),
    async (req, res) => {
      try {
        const stripe = getStripeClient();
        if (!stripe) {
          return res.status(500).json({ error: "Stripe is not configured" });
        }

        const sig = req.headers["stripe-signature"];

        let event;
        try {
          event = stripe.webhooks.constructEvent(
            req.body,
            sig,
            getPrivateConfigValue("STRIPE_WEBHOOK_SECRET")
          );
        } catch (err) {
          console.error("Stripe webhook signature failed:", err.message);
          return res.status(400).send(`Webhook Error: ${err.message}`);
        }

        const obj = event.data.object;

        if (event.type === "checkout.session.completed") {
          const userId = obj.metadata?.userId;
          const plan = obj.metadata?.plan;

          if (userId && plan) {
            await upsertLicense(userId, plan, "active", {
              stripe_customer_id: obj.customer || null,
              stripe_subscription_id: obj.subscription || null,
            });
          }
        }

        if (
          event.type === "customer.subscription.deleted" ||
          event.type === "customer.subscription.paused"
        ) {
          const subscription = obj;
          const userId = subscription.metadata?.userId;

          if (userId) {
            await upsertLicense(userId, "free", "canceled", {
              stripe_subscription_id: subscription.id || null,
            });
          }
        }

        if (
          event.type === "customer.subscription.updated" ||
          event.type === "invoice.payment_succeeded"
        ) {
          const subscriptionId =
            obj.subscription ||
            obj.id;

          if (subscriptionId && stripe) {
            const subscription =
              event.type === "invoice.payment_succeeded"
                ? await stripe.subscriptions.retrieve(subscriptionId)
                : obj;

            const userId = subscription.metadata?.userId;
            const plan = subscription.metadata?.plan;

            if (userId && plan) {
              const periodEnd = subscription.current_period_end
                ? new Date(subscription.current_period_end * 1000).toISOString()
                : undefined;

              await upsertLicense(userId, plan, subscription.status || "active", {
                expires_at: periodEnd,
                stripe_customer_id: subscription.customer || null,
                stripe_subscription_id: subscription.id || null,
              });
            }
          }
        }

        return res.json({ received: true });
      } catch (err) {
        console.error("billing webhook failed:", err);
        return res.status(500).json({ error: err.message || "Webhook failed" });
      }
    }
  );

  apiApp.use(express.json());

  apiApp.get("/health", (_req, res) => {
    res.json({ ok: true, service: "Studio Photuna Billing API" });
  });

  // Landing page for Stripe redirect — success_url / cancel_url point here
  apiApp.get("/", (req, res) => {
    const billing = req.query.billing;
    const isSuccess = billing === "success";
    const isCancelled = billing === "cancelled" || billing === "cancel";

    const title = isSuccess ? "Payment Successful" : isCancelled ? "Payment Cancelled" : "Studio Photuna";
    const heading = isSuccess ? "Payment confirmed!" : isCancelled ? "Payment cancelled" : "Studio Photuna";
    const body = isSuccess
      ? "Your subscription is now active. You can close this tab and return to Studio Photuna."
      : isCancelled
        ? "No charge was made. You can close this tab and return to Studio Photuna."
        : "Return to Studio Photuna.";
    const color = isSuccess ? "#4f46e5" : isCancelled ? "#6b7280" : "#4f46e5";

    res.setHeader("Content-Type", "text/html");
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} — Studio Photuna</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 40px 48px; text-align: center; max-width: 420px; width: 100%; box-shadow: 0 4px 24px rgba(0,0,0,.07); }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 22px; font-weight: 700; color: #0f172a; margin-bottom: 12px; }
    p { font-size: 15px; color: #64748b; line-height: 1.6; }
    .badge { display: inline-block; margin-top: 24px; padding: 6px 16px; border-radius: 999px; font-size: 13px; font-weight: 600; background: ${color}1a; color: ${color}; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${isSuccess ? "✅" : isCancelled ? "↩️" : "🎞️"}</div>
    <h1>${heading}</h1>
    <p>${body}</p>
    <div class="badge">Studio Photuna</div>
  </div>
</body>
</html>`);
  });

  apiApp.get("/billing/prices", (_req, res) => {
    res.json({
      currency: "PHP",
      monthly: {
        id: getPrivateConfigValue("STRIPE_PRICE_MONTHLY"),
        display: "₱1,400 / mo",
        amount: 1400,
      },
      yearly: {
        id: getPrivateConfigValue("STRIPE_PRICE_YEARLY"),
        display: "₱10,000 / yr",
        amount: 10000,
      },
    });
  });

  apiApp.post("/billing/create-checkout-session", requireSupabaseUser, async (req, res) => {
    try {
      const stripe = getStripeClient();
      if (!stripe) {
        return res.status(500).json({ error: "Stripe secret key is missing" });
      }

      const userId = req.supabaseUser.id;
      const email = req.supabaseUser.email;
      const { plan } = req.body || {};

      const price =
        plan === "monthly"
          ? getPrivateConfigValue("STRIPE_PRICE_MONTHLY")
          : plan === "yearly"
            ? getPrivateConfigValue("STRIPE_PRICE_YEARLY")
            : null;

      if (!price) {
        return res.status(400).json({ error: "Invalid plan" });
      }

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer_email: email,
        line_items: [{ price, quantity: 1 }],
        success_url: getPrivateConfigValue("STRIPE_SUCCESS_URL") || "http://localhost:3000?billing=success",
        cancel_url:  getPrivateConfigValue("STRIPE_CANCEL_URL")  || "http://localhost:3000?billing=cancelled",
        metadata: {
          userId,
          plan,
        },
        subscription_data: {
          metadata: {
            userId,
            plan,
          },
        },
      });

      return res.json({ url: session.url });
    } catch (err) {
      console.error("create-checkout-session failed:", err);
      return res.status(500).json({ error: err.message || "Checkout failed" });
    }
  });

  apiApp.get("/billing/subscription", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.supabaseUser.id;

      const { data, error } = await getSupabaseAdmin().from("licenses")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.json({
        plan: data?.plan || "free",
        state: data?.state || "active",
        expiresAt: data?.expires_at || null,
        stripeCustomerId: data?.stripe_customer_id || null,
        stripeSubscriptionId: data?.stripe_subscription_id || null,
        entitlements: {
          watermark: data?.watermark ?? true,
          maxEvents: data?.max_events ?? 1,
          templates: data?.templates ?? 1,
          prioritySupport: data?.priority_support ?? false,
        },
      });
    } catch (err) {
      console.error("billing/subscription failed:", err);
      return res.status(500).json({ error: err.message || "Subscription failed" });
    }
  });

  apiApp.post("/billing/customer-portal", requireSupabaseUser, async (req, res) => {
    try {
      const stripe = getStripeClient();
      if (!stripe) {
        return res.status(500).json({ error: "Stripe secret key is missing" });
      }

      const userId = req.supabaseUser.id;

      const { data, error } = await getSupabaseAdmin().from("licenses")
        .select("stripe_customer_id")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      if (!data?.stripe_customer_id) {
        return res.status(400).json({ error: "No Stripe customer found yet" });
      }

      const portal = await stripe.billingPortal.sessions.create({
        customer: data.stripe_customer_id,
        return_url: "http://localhost:3000?billing=portal-return",
      });

      return res.json({ url: portal.url });
    } catch (err) {
      console.error("customer-portal failed:", err);
      return res.status(500).json({ error: err.message || "Customer portal failed" });
    }
  });

  // Called after Stripe checkout redirects back. Reads the live Stripe subscription
  // and writes the confirmed plan to Supabase — does not rely on webhooks.
  apiApp.post("/billing/sync", requireSupabaseUser, async (req, res) => {
    try {
      const stripe = getStripeClient();
      if (!stripe) return res.status(501).json({ error: "stripe_not_configured" });

      const userId = req.supabaseUser.id;
      const email  = req.supabaseUser.email;

      // Look up Stripe customer by stored ID or fall back to email lookup
      let customerId = null;
      try {
        const { data: licRow } = await getSupabaseAdmin().from("licenses").select("stripe_customer_id").eq("user_id", userId).maybeSingle();
        customerId = licRow?.stripe_customer_id || null;
      } catch (_) { /* no row yet, will fall back to email lookup */ }

      if (!customerId) {
        try {
          const customers = await stripe.customers.list({ email, limit: 1 });
          customerId = customers.data[0]?.id ?? null;
        } catch (e) {
          console.warn("[billing/sync] Stripe customer lookup failed:", e.message);
        }
      }

      if (!customerId) return res.json({ synced: false, reason: "no_stripe_customer" });

      // Retry up to 3 times (2 s apart) in case Stripe hasn't activated the
      // subscription yet by the time the user switches back to the app.
      let sub = null;
      for (let attempt = 0; attempt <= 3 && !sub; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 2000));
        const [activeSubs, trialingSubs] = await Promise.all([
          stripe.subscriptions.list({ customer: customerId, status: "active",   limit: 1 }),
          stripe.subscriptions.list({ customer: customerId, status: "trialing", limit: 1 }),
        ]);
        sub = activeSubs.data[0] || trialingSubs.data[0] || null;
        if (!sub && attempt > 0) console.log(`[billing/sync] retry ${attempt}: no active sub yet`);
      }

      if (!sub) return res.json({ synced: false, reason: "no_active_subscription" });

      const interval = sub.items?.data?.[0]?.price?.recurring?.interval;
      const plan  = interval === "year" ? "yearly" : "monthly";
      const state = sub.status === "trialing" ? "trialing" : "active";
      const expiresAt = sub.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null;

      // Write confirmed plan to Supabase (with 9 s timeout so it can't hang forever)
      let sbOk = false;
      let sbError = null;
      try {
        const sbTimeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Supabase write timed out")), 9000)
        );
        const { error } = await Promise.race([
          getSupabaseAdmin().from("licenses").upsert(
            {
              user_id: userId,
              plan,
              state,
              expires_at: expiresAt,
              stripe_subscription_id: sub.id,
              ...mapPlanToLicense(plan, state),
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" }
          ),
          sbTimeout,
        ]);
        if (error) {
          console.error("[billing/sync] Supabase upsert failed:", error.message, "code:", error.code);
          sbError = error.message;
        } else {
          sbOk = true;
          // Sync profile: plan + stripe_customer_id (best-effort, fire-and-forget)
          getSupabaseAdmin().from("profiles")
            .update({ subscription_plan: plan, stripe_customer_id: customerId })
            .eq("id", userId)
            .then(() => {})
            .catch((e) => console.warn("[billing/sync] profile sync failed:", e.message));
        }
      } catch (e) {
        console.error("[billing/sync] Supabase write exception:", e.message);
        sbError = e.message;
      }

      // Build and sign a fresh license JWT
      const rawPrivateKey = getPrivateConfigValue("LICENSE_PRIVATE_KEY") || "";
      const privateKey = rawPrivateKey.includes("\\n") ? rawPrivateKey.replace(/\\n/g, "\n") : rawPrivateKey;
      const rawPublicKey = getPrivateConfigValue("LICENSE_PUBLIC_KEY") || "";
      const publicKey = rawPublicKey.includes("\\n") ? rawPublicKey.replace(/\\n/g, "\n") : rawPublicKey;
      const mapped = mapPlanToLicense(plan, state);
      const expSeconds = sub.current_period_end
        ? Math.min(sub.current_period_end, Math.floor(Date.now() / 1000) + 7 * 24 * 3600)
        : Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
      const entitlements = {
        watermark: mapped.watermark,
        maxEvents: mapped.max_events,
        templates: mapped.templates,
        prioritySupport: mapped.priority_support,
      };

      let signedLicense = null;
      try {
        if (privateKey) {
          signedLicense = require("jsonwebtoken").sign(
            { iss: "StudioPhotuna-Licensing", typ: "license", sub: userId, plan, state, entitlements, exp: expSeconds },
            privateKey,
            { algorithm: "RS256" }
          );
        }
      } catch (signErr) {
        console.error("[billing/sync] JWT signing failed:", signErr.message);
      }

      return res.json({
        synced: true,
        synced_supabase: sbOk,
        supabase_error: sbOk ? undefined : sbError,
        license: { plan, state, expiresAt: sub.current_period_end || 0, entitlements },
        signedLicense,
        publicKey: publicKey || null,
      });
    } catch (err) {
      console.error("[billing/sync] error:", err);
      return res.status(500).json({ error: err.message || "billing_sync_failed" });
    }
  });

  apiApp.get("/license/status", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.supabaseUser.id;

      const { data: license, error } = await getSupabaseAdmin().from("licenses")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      const effectiveLicense = license || {
        user_id: userId,
        plan: "free",
        state: "active",
        expires_at: null,
        max_events: 1,
        templates: 1,
        watermark: true,
        priority_support: false,
        trial_redeemed: false,
      };

      // Sync profile so AuthContext always reflects the current plan
      if (license) {
        getSupabaseAdmin().from("profiles")
          .update({ subscription_plan: license.plan })
          .eq("id", userId)
          .then(() => {}).catch(() => {});
      }

      const payload = {
        iss: "StudioPhotuna-Licensing",
        typ: "license",
        sub: userId,
        plan: effectiveLicense.plan,
        state: effectiveLicense.state,
        exp: effectiveLicense.expires_at
          ? Math.floor(new Date(effectiveLicense.expires_at).getTime() / 1000)
          : Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
        entitlements: {
          watermark: effectiveLicense.watermark,
          maxEvents: effectiveLicense.max_events,
          templates: effectiveLicense.templates,
          prioritySupport: effectiveLicense.priority_support,
        },
      };

      // Detect trial expiry so the UI can show "Trial Expired" vs "Trial Unavailable"
      const now = Date.now();
      const expiresMs = effectiveLicense.expires_at
        ? new Date(effectiveLicense.expires_at).getTime()
        : null;
      const trialExpired =
        effectiveLicense.plan === "trial" &&
        expiresMs !== null &&
        expiresMs < now;

      // Decode PEM keys — dotenv multiline values use actual newlines; fallback handles \n literals
      const rawPrivateKey = getPrivateConfigValue("LICENSE_PRIVATE_KEY") || "";
      const privateKey = rawPrivateKey.includes("\\n")
        ? rawPrivateKey.replace(/\\n/g, "\n")
        : rawPrivateKey;

      const rawPublicKey = getPrivateConfigValue("LICENSE_PUBLIC_KEY") || "";
      const publicKey = rawPublicKey.includes("\\n")
        ? rawPublicKey.replace(/\\n/g, "\n")
        : rawPublicKey;

      let signedLicense = null;
      try {
        if (privateKey) {
          signedLicense = jwt.sign(payload, privateKey, { algorithm: "RS256" });
        }
      } catch (signErr) {
        console.error("[license] JWT signing failed:", signErr.message);
      }

      return res.json({
        license: {
          plan: effectiveLicense.plan,
          state: effectiveLicense.state,
          expiresAt: effectiveLicense.expires_at,
          trialRedeemed: Boolean(effectiveLicense.trial_redeemed),
          trialExpired,
          entitlements: payload.entitlements,
        },
        signedLicense,
        publicKey: publicKey || null,
      });
    } catch (err) {
      console.error("license/status failed:", err);
      return res.status(500).json({ error: "License status failed" });
    }
  });

  apiApp.post("/license/redeem-trial", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.supabaseUser.id;

      // Prevent redeeming more than once
      const { data: existing } = await getSupabaseAdmin().from("licenses")
        .select("trial_redeemed")
        .eq("user_id", userId)
        .maybeSingle();

      if (existing?.trial_redeemed) {
        return res.status(409).json({ error: "Trial already redeemed" });
      }

      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const { error } = await getSupabaseAdmin().from("licenses").upsert(
        {
          user_id: userId,
          plan: "trial",
          state: "trialing",
          expires_at: expiresAt,
          trial_redeemed: true,
          max_events: 3,
          templates: 5,
          watermark: false,
          priority_support: false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.json({ ok: true, expiresAt });
    } catch (err) {
      console.error("redeem-trial failed:", err);
      return res.status(500).json({ error: "Redeem trial failed" });
    }
  });

  apiApp.post("/license/attach-device", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.supabaseUser.id;
      const { fingerprint, platform } = req.body || {};

      if (!fingerprint) {
        return res.status(400).json({ error: "fingerprint is required" });
      }

      const { error } = await getSupabaseAdmin().from("license_devices").upsert(
        { user_id: userId, fingerprint, platform: platform || "unknown", last_seen_at: new Date().toISOString() },
        { onConflict: "user_id,fingerprint" }
      );

      if (error) return res.status(500).json({ error: error.message });

      return res.json({ ok: true });
    } catch (err) {
      console.error("attach-device failed:", err);
      return res.status(500).json({ error: "attach-device failed" });
    }
  });

  apiApp.post("/license/detach-device", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.supabaseUser.id;
      const { fingerprint } = req.body || {};

      if (!fingerprint) {
        return res.status(400).json({ error: "fingerprint is required" });
      }

      const { error } = await getSupabaseAdmin().from("license_devices")
        .delete()
        .eq("user_id", userId)
        .eq("fingerprint", fingerprint);

      if (error) return res.status(500).json({ error: error.message });

      return res.json({ ok: true });
    } catch (err) {
      console.error("detach-device failed:", err);
      return res.status(500).json({ error: "detach-device failed" });
    }
  });

  // Dev/admin-only: manually set a plan without going through Stripe.
  apiApp.post("/license/set-plan", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.supabaseUser.id;
      const { plan } = req.body || {};
      if (!["free", "trial", "monthly", "yearly"].includes(plan)) {
        return res.status(400).json({ error: "invalid_plan" });
      }
      const state = plan === "trial" ? "trialing" : "active";
      await upsertLicense(userId, plan, state);
      return res.json({ ok: true, plan, state });
    } catch (err) {
      console.error("set-plan failed:", err);
      return res.status(500).json({ error: err.message || "set-plan failed" });
    }
  });

  apiApp.post("/license/refresh", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.supabaseUser.id;

      const { data: license, error } = await getSupabaseAdmin().from("licenses")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) return res.status(500).json({ error: error.message });

      const effectiveLicense = license || {
        user_id: userId,
        plan: "free",
        state: "active",
        expires_at: null,
        max_events: 1,
        templates: 1,
        watermark: true,
        priority_support: false,
        trial_redeemed: false,
      };

      // Keep profiles.subscription_plan in sync
      getSupabaseAdmin().from("profiles")
        .update({ subscription_plan: effectiveLicense.plan })
        .eq("id", userId)
        .then(() => {}).catch(() => {});

      const rawPrivateKey = getPrivateConfigValue("LICENSE_PRIVATE_KEY") || "";
      const privateKey = rawPrivateKey.includes("\\n") ? rawPrivateKey.replace(/\\n/g, "\n") : rawPrivateKey;
      const rawPublicKey = getPrivateConfigValue("LICENSE_PUBLIC_KEY") || "";
      const publicKey = rawPublicKey.includes("\\n") ? rawPublicKey.replace(/\\n/g, "\n") : rawPublicKey;

      const payload = {
        iss: "StudioPhotuna-Licensing",
        typ: "license",
        sub: userId,
        plan: effectiveLicense.plan,
        state: effectiveLicense.state,
        exp: effectiveLicense.expires_at
          ? Math.floor(new Date(effectiveLicense.expires_at).getTime() / 1000)
          : Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
        entitlements: {
          watermark: effectiveLicense.watermark,
          maxEvents: effectiveLicense.max_events,
          templates: effectiveLicense.templates,
          prioritySupport: effectiveLicense.priority_support,
        },
      };

      let signedLicense = null;
      try {
        if (privateKey) signedLicense = jwt.sign(payload, privateKey, { algorithm: "RS256" });
      } catch (signErr) {
        console.error("[license/refresh] JWT signing failed:", signErr.message);
      }

      return res.json({
        license: {
          plan: effectiveLicense.plan,
          state: effectiveLicense.state,
          expiresAt: effectiveLicense.expires_at,
          trialRedeemed: Boolean(effectiveLicense.trial_redeemed),
          entitlements: payload.entitlements,
        },
        signedLicense,
        publicKey: publicKey || null,
      });
    } catch (err) {
      console.error("license/refresh failed:", err);
      return res.status(500).json({ error: "License refresh failed" });
    }
  });

  apiApp.get("/me", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.supabaseUser.id;

      const { data, error } = await getSupabaseAdmin().from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();

      if (error) return res.status(500).json({ error: error.message });

      return res.json({ user: req.supabaseUser, profile: data || null });
    } catch (err) {
      console.error("/me failed:", err);
      return res.status(500).json({ error: "Failed to fetch profile" });
    }
  });

  apiApp.put("/me", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.supabaseUser.id;
      const { full_name, email, phone, company, avatar_url } = req.body || {};

      const patch = {};
      if (full_name !== undefined) patch.full_name = full_name;
      if (email !== undefined) patch.email = email;
      if (phone !== undefined) patch.phone = phone;
      if (company !== undefined) patch.company = company;
      if (avatar_url !== undefined) patch.avatar_url = avatar_url;

      const { data, error } = await getSupabaseAdmin().from("profiles")
        .upsert({ id: userId, ...patch }, { onConflict: "id" })
        .select()
        .single();

      if (error) return res.status(500).json({ error: error.message });

      return res.json({ profile: data });
    } catch (err) {
      console.error("PUT /me failed:", err);
      return res.status(500).json({ error: "Failed to update profile" });
    }
  });

  apiApp.post("/billing/cancel-subscription", requireSupabaseUser, async (req, res) => {
    try {
      const stripe = getStripeClient();
      if (!stripe) return res.status(500).json({ error: "Stripe not configured" });

      const userId = req.supabaseUser.id;
      const { atPeriodEnd = true } = req.body || {};

      const { data: license } = await getSupabaseAdmin().from("licenses")
        .select("stripe_subscription_id")
        .eq("user_id", userId)
        .maybeSingle();

      if (!license?.stripe_subscription_id) {
        return res.status(400).json({ error: "No active subscription to cancel" });
      }

      await stripe.subscriptions.update(license.stripe_subscription_id, {
        cancel_at_period_end: atPeriodEnd,
      });

      return res.json({ ok: true, cancelledAtPeriodEnd: atPeriodEnd });
    } catch (err) {
      console.error("cancel-subscription failed:", err);
      return res.status(500).json({ error: err.message || "Cancel failed" });
    }
  });

  // Verify current password then change it via admin API (never exposes password in JWT/cookie).
  apiApp.post("/auth/change-password", requireSupabaseUser, async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body || {};
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: "currentPassword and newPassword are required" });
      }
      if (newPassword.length < 8) {
        return res.status(400).json({ error: "New password must be at least 8 characters" });
      }

      const userId = req.supabaseUser.id;
      const email   = req.supabaseUser.email;

      // Step 1 — verify the current password by attempting a fresh sign-in.
      const { error: signInError } = await getSupabaseAdmin().auth.signInWithPassword({
        email,
        password: currentPassword,
      });
      if (signInError) {
        return res.status(401).json({ error: "Current password is incorrect" });
      }

      // Step 2 — change the password via the admin API (no re-auth prompt, no email link).
      const { error: updateError } = await getSupabaseAdmin().auth.admin.updateUserById(userId, {
        password: newPassword,
      });
      if (updateError) {
        console.error("[change-password] admin update failed:", updateError.message);
        return res.status(500).json({ error: "Failed to update password" });
      }

      return res.json({ ok: true });
    } catch (err) {
      console.error("[change-password] error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // Upload avatar to Supabase Storage and return the public URL.
  apiApp.post("/me/avatar", express.raw({ type: /^image\//, limit: "5mb" }), requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.supabaseUser.id;
      const contentType = req.headers["content-type"] || "image/jpeg";
      const ext = contentType.includes("png") ? "png" : contentType.includes("gif") ? "gif" : contentType.includes("webp") ? "webp" : "jpg";
      const filePath = `${userId}/avatar.${ext}`;

      // req.body is raw bytes (requires express.raw middleware — set below)
      const fileBuffer = req.body;
      if (!fileBuffer || !fileBuffer.length) {
        return res.status(400).json({ error: "No image data received" });
      }

      const { error: uploadError } = await getSupabaseAdmin().storage
        .from("avatars")
        .upload(filePath, fileBuffer, {
          contentType,
          upsert: true,
        });

      if (uploadError) {
        console.error("[me/avatar] upload error:", uploadError.message);
        return res.status(500).json({ error: uploadError.message });
      }

      const { data: urlData } = getSupabaseAdmin().storage.from("avatars").getPublicUrl(filePath);
      const publicUrl = urlData?.publicUrl;

      // Update profile with the new avatar_url (service role bypasses RLS)
      const { error: profileError } = await getSupabaseAdmin().from("profiles")
        .update({ avatar_url: publicUrl })
        .eq("id", userId);

      if (profileError) {
        console.error("[me/avatar] profile update error:", profileError.message);
        return res.status(500).json({ error: profileError.message });
      }

      return res.json({ ok: true, avatar_url: publicUrl });
    } catch (err) {
      console.error("[me/avatar] error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  const tryListen = (retries = 1) => {
    apiServer = apiApp.listen(API_PORT, () => {
      console.log(`Billing API running on http://localhost:${API_PORT}`);
    });

    apiServer.on("error", (err) => {
      if (err.code === "EADDRINUSE" && retries > 0) {
        console.log(`[API] Port ${API_PORT} busy — killing old process and retrying…`);
        apiServer = null;
        // Kill whatever is holding the port, then retry once after a short delay
        const killer = require("child_process").exec(
          process.platform === "win32"
            ? `FOR /F "tokens=5" %P IN ('netstat -ano ^| findstr :${API_PORT}') DO taskkill /PID %P /F`
            : `lsof -ti :${API_PORT} | xargs kill -9`,
          () => setTimeout(() => tryListen(retries - 1), 500)
        );
        killer.on("error", () => {});
      } else {
        console.error("Billing API server failed:", err);
        apiServer = null;
      }
    });
  };

  tryListen();
}

// Register auth:syncUser at module level so it is available the instant the renderer mounts,
// avoiding a race where the renderer calls invoke before app.whenReady handlers are set up.
ipcMain.handle("auth:syncUser", async (_e, { userId } = {}) => {
  try {
    if (typeof store.set === "function") {
      store.set("auth.currentUserId", userId || null);
      if (!userId) store.set("auth.lastUsername", null);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

// Read the license row directly via supabaseAdmin (service role, bypasses RLS).
// Called by LicenseContext to avoid HTTP/auth/RLS issues with the anon client.
// Uses select('*') so it never fails on missing optional columns (watermark, max_events, etc.).
ipcMain.handle("license:read", async (_e, userId) => {
  if (!userId) return null;
  try {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('license:read Supabase timed out')), 9000)
    );
    const { data, error } = await Promise.race([
      getSupabaseAdmin().from("licenses").select("*").eq("user_id", userId).maybeSingle(),
      timeout,
    ]);
    if (error) {
      console.warn("[license:read] query error:", error.message);
      return null;
    }
    return data ?? null;
  } catch (e) {
    console.warn("[license:read] failed:", e.message);
    return null;
  }
});

// Persist the resolved license payload locally so it survives restarts when
// Supabase is unreachable or hasn't been updated yet by webhooks.
const LICENSE_MAX_OFFLINE_MS =
  parseInt(getPrivateConfigValue("LICENSE_MAX_OFFLINE_DAYS") || '7', 10) * 24 * 3600 * 1000;

ipcMain.handle("license:cache-read", async (_e, userId) => {
  try {
    const cached = store?.get('_licenseCache');
    if (!cached || cached.userId !== userId) return null;
    if (Date.now() - (cached.cachedAt || 0) > LICENSE_MAX_OFFLINE_MS) return null;
    return cached;
  } catch { return null; }
});

ipcMain.handle("license:cache-write", async (_e, userId, payload) => {
  try {
    store?.set('_licenseCache', { ...payload, userId, cachedAt: Date.now() });
    return true;
  } catch { return false; }
});

/* -------------------------------------------------------
 * 🚀 App Lifecycle
 * -----------------------------------------------------*/
app.whenReady().then(async () => {

  const uid = getUserIdFromStore();
  if (uid) {
    const { eventsFile: userEvents } = getPaths(uid);
    const { eventsFile: anonEvents } = getPaths(null); // will resolve to 'anon'
    try {
      const anon = fs.existsSync(anonEvents) ? JSON.parse(fs.readFileSync(anonEvents, 'utf8')) : [];
      const mine = fs.existsSync(userEvents) ? JSON.parse(fs.readFileSync(userEvents, 'utf8')) : [];
      if (Array.isArray(anon) && anon.length && Array.isArray(mine) && mine.length === 0) {
        fs.writeFileSync(userEvents, JSON.stringify(anon, null, 2), 'utf8');
        // Optionally archive anon
        // fs.renameSync(anonEvents, anonEvents + '.migrated');
      }
    } catch (e) { console.warn('migration check failed', e); }
  }

  // Custom protocol: app://assets/<userId>/assets/<eventId>/<filename>
  protocol.registerFileProtocol("app", (request, callback) => {
    try {
      const urlStr = request.url; // e.g. app://assets/event123/background-17123.gif
      const prefix = "app://assets/";
      if (!urlStr.startsWith(prefix)) return callback({ path: "" });
      const rel = sanitizeRelKey(urlStr.slice(prefix.length)); // eventId/filename
      const fullPath = path.normalize(path.join(USERS_DIR, rel));
      callback({ path: fullPath });
    } catch (err) {
      console.error("protocol app://assets error", err);
      callback({ path: "" });
    }
  });

  startBillingApiServer();
  createWindow();
  setupAutoUpdater();

  const { shell } = require('electron');

  function toHex(buf) { return Buffer.isBuffer(buf) ? buf.toString('hex') : String(buf || ''); }

  async function getOrCreateDataKey() {
    let k = await keytar.getPassword(LICENSE_KEY_SERVICE, LICENSE_KEY_ACCOUNT);
    if (!k) {
      const newKey = crypto.randomBytes(32).toString('hex'); // 256-bit
      await keytar.setPassword(LICENSE_KEY_SERVICE, LICENSE_KEY_ACCOUNT, newKey);
      k = newKey;
    }
    return Buffer.from(k, 'hex');
  }

  function encryptBlob(plaintextBuf, key) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(plaintextBuf), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString('base64');
  }

  function decryptBlob(b64, key) {
    const buf = Buffer.from(b64, 'base64');
    const iv = buf.slice(0, 12);
    const tag = buf.slice(12, 28);
    const enc = buf.slice(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return dec;
  }

  function getAccountPreferencesKey(userId) {
    return `users.${String(userId || getUserIdFromStore())}.account.preferences`;
  }

  function safeHandle(channel, handler) {
    try {
      try { ipcMain.removeHandler(channel); } catch { }
      ipcMain.handle(channel, handler);
    } catch (err) {
      console.error(`Failed to register handler ${channel}:`, err);
    }
  }

  safeHandle("log:clear", async () => {
    try {
      const exportDir = path.join(USERDATA, "logs");
      if (!fs.existsSync(exportDir)) return { ok: true, message: "No logs to clear" };
      const files = fs.readdirSync(exportDir).filter(f => f.endsWith(".txt"));
      for (const f of files) {
        try { fs.unlinkSync(path.join(exportDir, f)); } catch { }
      }
      return { ok: true, message: `Cleared ${files.length} log file(s)` };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  safeHandle("payment:finalize-cash", async (_e, { amount, currency }) => {
    // For now: record to session meta. 
    // Later: integrate with physical cash drawer via serial port.
    console.log(`[Cash] Finalizing ₱${amount} ${currency}`);
    return { ok: true, method: "cash", amount, currency };
  });

  safeHandle("payment:start-qr", async (_e, { amount, currency, provider }) => {
    // Generate a QR code URL for GCash/PayNow/PromptPay
    // Integrate with provider SDK here (GCash Business API, etc.)
    console.log(`[QR] Starting ${provider} payment for ₱${amount}`);
    // Simulate for now — replace with real webhook polling
    return { ok: false, success: false, configured: false, method: provider, amount, currency };
  });

  safeHandle("payment:start-paypal", async (_e, { amount, currency }) => {
    // Simulated until a PayPal Orders/Capture API integration is configured.
    console.log(`[PayPal] Starting PayPal payment for ${currency} ${amount}`);
    return { ok: false, success: false, configured: false, method: "paypal", amount, currency };
  });

  safeHandle("payment:start-card", async (_e, { amount, currency }) => {
    // Integrate with Stripe Terminal SDK or Maya POS terminal
    console.log(`[Card] Starting card payment for ₱${amount}`);
    return { ok: false, success: false, configured: false, method: "card", amount, currency };
  });

  safeHandle("payment:charge-additional", async (_e, { amount, method }) => {
    return { ok: false, success: false, configured: false, amount, method };
  });

  safeHandle("payment:record", async (_e, record) => {
    // Persist payment to current session meta
    const userId = getUserIdFromStore();
    const { metaFile } = resolveBoothOutputDirs({
      userId,
      eventId: record?.eventId || "default",
      sessionId: "current",
      storagePath: "",
    });
    const meta = readJson(metaFile, {});
    meta.payments = Array.isArray(meta.payments) ? meta.payments : [];
    meta.payments.push({ ...record, recordedAt: new Date().toISOString() });
    writeJson(metaFile, meta);
    return { ok: true };
  });

  safeHandle("account:getPreferences", async (_e, { userId } = {}) => {
    try {
      const key = getAccountPreferencesKey(userId);
      const preferences =
        typeof store.get === "function" ? (store.get(key) || {}) : {};

      return {
        ok: true,
        preferences: {
          theme: preferences.theme || "system",
          language: preferences.language || "en",
          emailNotifications: Boolean(preferences.emailNotifications),
          desktopNotifications:
            preferences.desktopNotifications !== false,
          autoLaunch: Boolean(preferences.autoLaunch),
          soundEnabled: preferences.soundEnabled !== false,
          updatedAt: preferences.updatedAt || null,
        },
      };
    } catch (err) {
      console.error("account:getPreferences error", err);
      return { ok: false, error: String(err), preferences: null };
    }
  });

  safeHandle("account:savePreferences", async (_e, payload = {}) => {
    try {
      const userId = payload?.userId || getUserIdFromStore();
      const key = getAccountPreferencesKey(userId);
      const existing =
        typeof store.get === "function" ? (store.get(key) || {}) : {};

      const nextPreferences = {
        ...existing,
        theme: payload.theme || existing.theme || "system",
        language: payload.language || existing.language || "en",
        emailNotifications: Boolean(payload.emailNotifications),
        desktopNotifications: payload.desktopNotifications !== false,
        autoLaunch: Boolean(payload.autoLaunch),
        soundEnabled: payload.soundEnabled !== false,
        updatedAt: new Date().toISOString(),
      };

      if (typeof store.set === "function") {
        store.set(key, nextPreferences);
      }

      return { ok: true, preferences: nextPreferences };
    } catch (err) {
      console.error("account:savePreferences error", err);
      return { ok: false, error: String(err) };
    }
  });

  safeHandle("account:changePassword", async (_e, payload = {}) => {
    try {
      const currentPassword = String(payload.currentPassword || "");
      const newPassword = String(payload.newPassword || "");
      const confirmPassword = String(payload.confirmPassword || "");

      const username =
        String(payload.username || "").trim() ||
        (typeof store.get === "function" ? store.get(AUTH_LAST_USERNAME_KEY) : "") ||
        "";

      if (!username) {
        return { ok: false, error: "No signed-in account found." };
      }

      if (!currentPassword || !newPassword || !confirmPassword) {
        return { ok: false, error: "All password fields are required." };
      }

      if (newPassword !== confirmPassword) {
        return { ok: false, error: "New password and confirmation do not match." };
      }

      if (newPassword.length < 6) {
        return { ok: false, error: "New password must be at least 6 characters." };
      }

      const savedSecret = await keytar.getPassword(AUTH_SERVICE_NAME, username);
      if (!savedSecret) {
        return { ok: false, error: "Stored credentials not found." };
      }

      if (savedSecret !== currentPassword) {
        return { ok: false, error: "Current password is incorrect." };
      }

      await keytar.setPassword(AUTH_SERVICE_NAME, username, newPassword);

      return { ok: true };
    } catch (err) {
      console.error("account:changePassword error", err);
      return { ok: false, error: String(err) };
    }
  });

  // --- Session (tokens) ---
  safeHandle('auth:saveSession', async (_e, { accessToken, refreshToken }) => {
    try {
      if (accessToken) await keytar.setPassword(SESSION_SERVICE, `${SESSION_ACCOUNT}:access`, accessToken);
      if (refreshToken) await keytar.setPassword(SESSION_SERVICE, `${SESSION_ACCOUNT}:refresh`, refreshToken);
      return { ok: true };
    } catch (err) {
      console.error('auth:saveSession error', err);
      return { ok: false, error: String(err) };
    }
  });

  safeHandle('auth:getSession', async () => {
    try {
      const accessToken = await keytar.getPassword(SESSION_SERVICE, `${SESSION_ACCOUNT}:access`);
      const refreshToken = await keytar.getPassword(SESSION_SERVICE, `${SESSION_ACCOUNT}:refresh`);
      return { ok: true, accessToken: accessToken || null, refreshToken: refreshToken || null };
    } catch (err) {
      console.error('auth:getSession error', err);
      return { ok: false, error: String(err) };
    }
  });

  safeHandle('auth:clearSession', async () => {
    try {
      await keytar.deletePassword(SESSION_SERVICE, `${SESSION_ACCOUNT}:access`);
      await keytar.deletePassword(SESSION_SERVICE, `${SESSION_ACCOUNT}:refresh`);
      return { ok: true };
    } catch (err) {
      console.error('auth:clearSession error', err);
      return { ok: false, error: String(err) };
    }
  });

  // --- License cache (encrypted) ---
  safeHandle('license:cacheSave', async (_e, { signedLicense }) => {
    try {
      if (!signedLicense) return { ok: false, error: 'missing_license' };
      const key = await getOrCreateDataKey();
      const cipherText = encryptBlob(Buffer.from(signedLicense, 'utf8'), key);
      // persist cipher text in your electron-store
      if (typeof store.set === 'function') store.set('license.cache', cipherText);
      else if (typeof store.setSettings === 'function') {
        const s = (typeof store.getSettings === 'function' ? store.getSettings() : store.get('settings')) || {};
        s.licenseCache = cipherText;
        typeof store.setSettings === 'function' ? store.setSettings(s) : store.set('settings', s);
      }
      return { ok: true };
    } catch (err) {
      console.error('license:cacheSave error', err);
      return { ok: false, error: String(err) };
    }
  });

  safeHandle('license:cacheLoad', async () => {
    try {
      const cipherText =
        (typeof store.get === 'function' ? store.get('license.cache') : null) ||
        (typeof store.getSettings === 'function' ? (store.getSettings() || {}).licenseCache : null);
      if (!cipherText) return { ok: false, signedLicense: null };
      const key = await getOrCreateDataKey();
      const plain = decryptBlob(cipherText, key).toString('utf8');
      return { ok: true, signedLicense: plain };
    } catch (err) {
      console.error('license:cacheLoad error', err);
      return { ok: false, error: String(err), signedLicense: null };
    }
  });

  safeHandle('license:cacheClear', async () => {
    try {
      if (typeof store.set === 'function') store.set('license.cache', null);
      if (typeof store.getSettings === 'function') {
        const s = store.getSettings() || {};
        delete s.licenseCache;
        typeof store.setSettings === 'function' ? store.setSettings(s) : store.set('settings', s);
      }
      return { ok: true };
    } catch (err) {
      console.error('license:cacheClear error', err);
      return { ok: false, error: String(err) };
    }
  });

  // --- Convenience: system fingerprint & open external ---
  safeHandle('system:getFingerprint', async () => {
    try {
      const payload = `${os.type()}|${os.arch()}|${os.hostname()}|${os.platform()}|${os.release()}|${os.userInfo().username}`;
      const hash = crypto.createHash('sha256').update(payload).digest('hex');
      return { ok: true, fingerprint: hash };
    } catch (err) {
      console.error('system:getFingerprint error', err);
      return { ok: false, error: String(err) };
    }
  });

  safeHandle('system:openExternal', async (_e, url) => {
    try {
      await shell.openExternal(String(url));
      return { ok: true };
    } catch (err) {
      console.error('system:openExternal error', err);
      return { ok: false, error: String(err) };
    }
  });


  // === Secure Auth IPC Handlers ===
  safeHandle("secureStore:getIdentity", async () => {
    try {
      const lastUsername = (typeof store.get === "function" ? store.get(AUTH_LAST_USERNAME_KEY) : null) || null;
      const map = (typeof store.get === "function" ? store.get('auth.userIdByUsername') : {}) || {};
      const userId = (typeof store.get === "function" ? store.get('auth.currentUserId') : null) || null;
      return { username: lastUsername, userId: userId || map[lastUsername] || null };
    } catch (err) { return { username: null, userId: null, error: String(err) }; }
  });

  // Clear identity (username + current userId)
  safeHandle("secureStore:clearIdentity", async () => {
    try {
      if (typeof store.set === "function") {
        store.set("auth.currentUserId", null);
        store.set("auth.lastUsername", null);
      }
      return { ok: true };
    } catch (err) {
      console.error("secureStore:clearIdentity error", err);
      return { ok: false, error: String(err) };
    }
  });

  // Core store handlers
  safeHandle("store:getEvents", (_e, { userId } = {}) => {
    const { eventsFile } = getPaths(userId);
    try { return JSON.parse(fs.readFileSync(eventsFile, "utf8")); } catch { return []; }
  });

  safeHandle("store:setEvents", (_e, events, { userId } = {}) => {
    const { eventsFile } = getPaths(userId);
    try { fs.writeFileSync(eventsFile, JSON.stringify(Array.isArray(events) ? events : [], null, 2)); return true; }
    catch (err) { console.error("store:setEvents error", err); return false; }
  });

  safeHandle("store:getCurrentEventId", () => {
    try {
      return typeof store.getCurrentEventId === "function" ? store.getCurrentEventId() : store.get("currentEventId");
    } catch (err) {
      console.error("store:getCurrentEventId error", err);
      return null;
    }
  });
  safeHandle("store:setCurrentEventId", (_e, id) => {
    try {
      return typeof store.setCurrentEventId === "function" ? store.setCurrentEventId(id) : store.set("currentEventId", id);
    } catch (err) {
      console.error("store:setCurrentEventId error", err);
      return null;
    }
  });

  safeHandle("store:getCurrentSubTab", () => {
    try {
      return typeof store.getCurrentSubTab === "function" ? store.getCurrentSubTab() : store.get("currentSubTab");
    } catch (err) {
      console.error("store:getCurrentSubTab error", err);
      return "appearance";
    }
  });
  safeHandle("store:setCurrentSubTab", (_e, tab) => {
    try {
      return typeof store.setCurrentSubTab === "function" ? store.setCurrentSubTab(tab) : store.set("currentSubTab", tab);
    } catch (err) {
      console.error("store:setCurrentSubTab error", err);
      return null;
    }
  });

  safeHandle("store:getAppearance", (_e, { userId } = {}) => {
    try {
      const key = `users.${String(userId || getUserIdFromStore())}.appearance`;
      return (typeof store.get === "function" ? (store.get(key) || {}) : {});
    } catch (err) { console.error("store:getAppearance error", err); return {}; }
  });

  safeHandle("store:setAppearance", (_e, appearance, { userId } = {}) => {
    try {
      const key = `users.${String(userId || getUserIdFromStore())}.appearance`;
      return (typeof store.set === "function" ? store.set(key, appearance) : null);
    } catch (err) { console.error("store:setAppearance error", err); return null; }
  });

  safeHandle("store:getSettings", (_e, { userId } = {}) => {
    try {
      const key = `users.${String(userId || getUserIdFromStore())}.settings`;
      return (typeof store.get === "function" ? (store.get(key) || {}) : {});
    } catch (err) { console.error("store:getSettings error", err); return {}; }
  });

  safeHandle("store:setSettings", (_e, appearance, { userId } = {}) => {
    try {
      const key = `users.${String(userId || getUserIdFromStore())}.settings`;
      return (typeof store.set === "function" ? store.set(key, appearance) : null);
    } catch (err) { console.error("store:setSettings error", err); return null; }
  });

  safeHandle("store:getTemplates", (_e, { userId } = {}) => {
    try {
      const key = `users.${String(userId || getUserIdFromStore())}.templates`;
      const v = typeof store.get === "function" ? store.get(key) : [];
      return Array.isArray(v) ? v : [];
    } catch (err) { console.error("store:getTemplates error", err); return {}; }
  });

  safeHandle("store:setTemplates", (_e, appearance, { userId } = {}) => {
    try {
      const key = `users.${String(userId || getUserIdFromStore())}.templates`;
      return (typeof store.set === "function" ? store.set(key, appearance) : null);
    } catch (err) { console.error("store:setTemplates error", err); return null; }
  });

  safeHandle("store:getPalettes", (_e, { userId } = {}) => {
    try {
      const key = `users.${String(userId || getUserIdFromStore())}.palettes`;
      return (typeof store.get === "function" ? (store.get(key) || {}) : {});
    } catch (err) { console.error("store:getPalettes error", err); return {}; }
  });

  safeHandle("store:setPalettes", (_e, appearance, { userId } = {}) => {
    try {
      const key = `users.${String(userId || getUserIdFromStore())}.palettes`;
      return (typeof store.set === "function" ? store.set(key, appearance) : null);
    } catch (err) { console.error("store:setPalettes error", err); return null; }
  });
  safeHandle("store:getFrames", (_e, { userId } = {}) => {
    try {
      const key = `users.${String(userId || getUserIdFromStore())}.frames`;
      return (typeof store.get === "function" ? (store.get(key) || {}) : {});
    } catch (err) { console.error("store:getFrames error", err); return {}; }
  });

  safeHandle("store:setFrames", (_e, appearance, { userId } = {}) => {
    try {
      const key = `users.${String(userId || getUserIdFromStore())}.frames`;
      return (typeof store.set === "function" ? store.set(key, appearance) : null);
    } catch (err) { console.error("store:setFrames error", err); return null; }
  });
  safeHandle("store:getTones", (_e, { userId } = {}) => {
    try {
      const key = `users.${String(userId || getUserIdFromStore())}.tones`;
      return (typeof store.get === "function" ? (store.get(key) || {}) : {});
    } catch (err) { console.error("store:getTones error", err); return {}; }
  });

  safeHandle("store:setTones", (_e, appearance, { userId } = {}) => {
    try {
      const key = `users.${String(userId || getUserIdFromStore())}.tones`;
      return (typeof store.set === "function" ? store.set(key, appearance) : null);
    } catch (err) { console.error("store:setTones error", err); return null; }
  });

  // Save template thumbnail
  safeHandle("store:saveTemplateThumbnail", async (_e, { dataUrl, filename, userId }) => {
    try {
      const { assetsDir } = getPaths(userId);
      ensureDir(assetsDir);
      const safe = sanitizeFilename(filename || `template-thumb-${Date.now()}.jpg`);
      const fullPath = writeDataUrlToFile(assetsDir, safe, dataUrl);
      const uid = String(userId || getUserIdFromStore() || 'anon');
      const relativeKey = `${uid}/assets/${safe}`; // put thumbs at <user>/assets/
      return {
        ok: true, filePath: fullPath, fileUrl: toFileUrl(fullPath),
        appUrl: toAppUrl(relativeKey),
        relativeKey,
      };
    } catch (err) {
      console.error("store:saveTemplateThumbnail error", err);
      return { ok: false, error: String(err) };
    }
  });

  // Compatibility alias
  safeHandle("saveTemplateThumbnail", async (_e, dataUrl, filename) => {
    try {

      const { assetsDir } = getPaths(); // current user
      ensureDir(assetsDir);
      const safe = sanitizeFilename(filename || `template-thumb-${Date.now()}.jpg`);
      const fullPath = writeDataUrlToFile(assetsDir, safe, dataUrl);

      return { savedPath: fullPath, fileUrl: toFileUrl(fullPath) };
    } catch (err) {
      console.error("saveTemplateThumbnail error:", err);
      return { savedPath: null, fileUrl: null, error: String(err) };
    }
  });

  /* ---------------------------
     Appearance assets (per-event)
     --------------------------- */
  safeHandle("saveAppearanceLogo", async (_e, payload) => {
    try {
      const { bytes, originalName, mime, eventId, userId } = payload || {};
      if (!bytes) throw new Error("Missing bytes");
      const eventKey = String(eventId || "global");
      const { assetsDir } = getPaths(userId);
      const baseDir = path.join(assetsDir, eventKey);
      const ext = mimeToExt(mime) || path.extname(originalName || "") || ".png";
      const baseName =
        (originalName && path.basename(originalName, path.extname(originalName))) ||
        `logo-${eventKey}-${Date.now()}`;
      const filename = sanitizeFilename(baseName) + ext;

      const fullPath = writeBytesToFile(baseDir, filename, bytes);
      const uid = String(userId || getUserIdFromStore() || 'anon');
      const relativeKey = `${uid}/assets/${eventKey}/${filename}`;
      return {
        ok: true,
        savedPath: fullPath,
        fileUrl: toFileUrl(fullPath),
        appUrl: toAppUrl(relativeKey),
        relativeKey,
      };
    } catch (err) {
      console.error("saveAppearanceLogo error:", err);
      return { ok: false, savedPath: null, fileUrl: null, error: String(err) };
    }
  });

  safeHandle("saveAppearanceBackground", async (_e, payload) => {
    try {
      const { bytes, dataUrl, originalName, mime, eventId, userId } = payload || {};
      const eventKey = String(eventId || "global");
      const { assetsDir } = getPaths(userId);
      const baseDir = path.join(assetsDir, eventKey);
      let filename, fullPath;
      if (bytes) {
        const ext = mimeToExt(mime) || path.extname(originalName || "") || ".mp4";
        const baseName =
          (originalName && path.basename(originalName, path.extname(originalName))) ||
          `background-${eventKey}-${Date.now()}`;
        filename = sanitizeFilename(baseName) + ext;
        fullPath = writeBytesToFile(baseDir, filename, bytes);
      } else if (dataUrl) {
        const m = (String(dataUrl).match(/^data:(.+?);base64,/) || [])[1] || mime || "image/png";
        const ext = mimeToExt(m) || ".png";
        const baseName =
          (originalName && path.basename(originalName, path.extname(originalName))) ||
          `background-${eventKey}-${Date.now()}`;
        filename = sanitizeFilename(baseName) + ext;
        fullPath = writeDataUrlToFile(baseDir, filename, dataUrl);
      } else {
        throw new Error("Missing bytes or dataUrl");
      }

      const uid = String(userId || getUserIdFromStore() || 'anon');
      const relativeKey = `${uid}/assets/${eventKey}/${filename}`;

      return {
        ok: true,
        savedPath: fullPath,
        fileUrl: toFileUrl(fullPath),
        appUrl: toAppUrl(relativeKey),
        relativeKey,
      };
    } catch (err) {
      console.error("saveAppearanceBackground error:", err);
      return { ok: false, savedPath: null, fileUrl: null, error: String(err) };
    }
  });

  safeHandle("resolveAppearanceUrl", async (_e, { savedPath, relativeKey } = {}) => {
    try {
      if (savedPath) {
        return { ok: true, url: toFileUrl(savedPath), kind: "file" };
      }
      if (relativeKey) {
        const rel = sanitizeRelKey(relativeKey);
        return { ok: true, url: toAppUrl(rel), kind: "app" };
      }
      throw new Error("Neither savedPath nor relativeKey provided");
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  safeHandle("deleteAppearanceAsset", async (_e, pathOrUrl) => {
    try {
      if (!pathOrUrl) return { ok: false, error: "no path" };
      const p = fromFileUrl(pathOrUrl);
      if (fs.existsSync(p)) {
        await fsp.unlink(p);
        return { ok: true };
      }
      return { ok: false, error: "file not found" };
    } catch (err) {
      console.error("deleteAppearanceAsset error:", err);
      return { ok: false, error: String(err) };
    }
  });

  // ===== Printers: status + test (React calls window.electron.invoke) =====
  const { dialog } = require("electron");

  // main.js — enhance printer:status
  safeHandle("printer:status", async (event, printerName) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      const list = await win.webContents.getPrintersAsync();
      const printer = list.find(p => p.name === String(printerName || ""));

      if (!printer) return { online: false, name: printerName };

      // Check printer status codes (Electron/Chromium printer status)
      // status: 0 = idle, 3 = printing, 4 = stopped
      const statusMap = { 0: "idle", 3: "printing", 4: "error" };

      return {
        online: printer.status !== 4,
        status: statusMap[printer.status] || "unknown",
        name: printer.name,
        isDefault: printer.isDefault,
        message: printer.status === 0 ? "Printer is ready" :
          printer.status === 3 ? "Printer is printing" :
            printer.status === 4 ? "Printer error" : "Unknown status"
      };
    } catch (err) {
      return { online: false, error: String(err) };
    }
  });

  safeHandle("printer:list", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win.webContents.getPrintersAsync();
  });

  safeHandle("storage:delete-all", async (_e, pathOrOpts) => {
    try {
      const targetPath = typeof pathOrOpts === "string"
        ? pathOrOpts
        : pathOrOpts?.path;

      if (!targetPath) return { ok: false, error: "No path provided" };

      let deleted = 0;

      // Recursive walk — compatible with all Node versions
      async function deleteAll(dir) {
        if (!fs.existsSync(dir)) return;
        const entries = await fsp.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await deleteAll(full);
          } else {
            try { await fsp.unlink(full); deleted++; } catch { }
          }
        }
      }

      await deleteAll(targetPath);
      return { ok: true, message: `Deleted ${deleted} files`, deletedCount: deleted };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  safeHandle("app:restart", async () => {
    app.relaunch();
    app.exit(0);
  });

  safeHandle("printer:test", async (event, printJob) => {
    let printWindow = null;
    try {
      const job =
        typeof printJob === "string"
          ? { printer: printJob }
          : (printJob || {});

      const printerName = job.printer || job.name || job.deviceName || "";
      if (!printerName) throw new Error("No printer selected");

      // simple test page
      printWindow = new BrowserWindow({ show: false });
      await printWindow.loadURL(`data:text/html;charset=utf-8,` +
        encodeURIComponent(`
          <html>
            <body style="font-family: Arial, sans-serif; margin: 24px;">
              <h1>Studio Photuna Test</h1>
              <p>${new Date().toISOString()}</p>
              <p>Printer: ${String(printerName)}</p>
              <p>Layout: ${String(job.layout || "4x6")}</p>
              <p>Paper: ${String(job.paperSize || "default")}</p>
            </body>
          </html>
        `));

      const success = await new Promise((resolve, reject) => {
        printWindow.webContents.print({
          deviceName: String(printerName),
          silent: false,
          copies: Number(job.copies || 1),
          color: job.colorMode !== "grayscale",
          landscape: job.orientation === "landscape",
          duplexMode: job.duplexMode || "simplex",
        }, (didPrint, failureReason) => {
          if (didPrint) resolve(true);
          else reject(new Error(failureReason || "Print job was not completed"));
        });
      });

      return { ok: success, printer: printerName };
    } catch (err) {
      console.error("printer:test error", err);
      return { ok: false, error: String(err) };
    } finally {
      if (printWindow && !printWindow.isDestroyed()) printWindow.close();
    }
  });

  // ===== Storage folder picker =====
  safeHandle("storage:select", async () => {
    try {
      const res = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
      if (res.canceled || !res.filePaths?.length) return null;
      return res.filePaths[0];
    } catch (err) {
      console.error("storage:select error", err);
      return null;
    }
  });

  // ===== Export logs (very simple trace bundle) =====
  safeHandle("log:export", async () => {
    try {
      const exportDir = path.join(USERDATA, "logs");
      ensureDir(exportDir);
      const file = path.join(exportDir, `export-${Date.now()}.txt`);

      // collect a few core blobs
      const blobs = [];
      try {
        const { eventsFile } = getPaths(); // current user
        blobs.push({ key: "events.json", data: fs.readFileSync(eventsFile, "utf8") });
      } catch { }
      try {
        const settings = (typeof store.getSettings === "function" ? store.getSettings() : store.get("settings")) || {};
        blobs.push({ key: "settings.json", data: JSON.stringify(settings, null, 2) });
      } catch { }

      const content = [
        `Studio Photuna Booth App Log Export`,
        `Date: ${new Date().toISOString()}`,
        `App: ${APP_FULL_NAME}`,
        `OS: ${os.type()} ${os.arch()} ${os.release()}`,
        ``,
        ...blobs.map(b => `----- ${b.key} -----\n${b.data}\n`)
      ].join("\n");

      fs.writeFileSync(file, content, "utf8");
      return file; // renderer expects a path-like return it can toast
    } catch (err) {
      console.error("log:export error", err);
      return null;
    }
  });

  // ===== Startup (login item) toggle =====
  safeHandle("startup:set", async (_e, enabled) => {
    try {
      // Persist pref
      if (typeof store.set === "function") store.set("startup.enabled", !!enabled);

      // Apply OS setting (macOS/Windows)
      app.setLoginItemSettings({
        openAtLogin: !!enabled,
        openAsHidden: false
      });
      return { ok: true };
    } catch (err) {
      console.error("startup:set error", err);
      return { ok: false, error: String(err) };
    }
  });


  // === IPC: preview lifecycle ===
  safeHandle('preview:startServer', async () => startPreviewServer());

  safeHandle('preview:createSession', async (_e, payload = {}) => {
    const uid = getUserIdFromStore();
    const base = startPreviewServer(); // ensure server is up
    const sessionId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomUUID().slice(0, 6);
    const token = crypto.randomBytes(16).toString('base64url');
    const dir = getSessionDir(uid, sessionId);
    ensureDir(dir);
    const meta = {
      sessionId,
      token,
      createdAt: new Date().toISOString(),
      shots: [],
      slots: [],
      finalPrint: null,
      animatedComposite: null,
      layout: payload?.layout || { width: 1200, height: 800, slots: [] }
    };
    writeJson(path.join(dir, 'session.json'), meta);
    return { sessionId, token, previewUrl: `${base}/p/${token}` };
  });

  safeHandle('preview:getUrl', async (_e, tokenOrSession) => {
    const base = startPreviewServer();
    return `${base}/p/${tokenOrSession}`;
  });

  safeHandle('preview:saveStill', async (_e, sessionId, slotIndex, dataUrl, extra = {}) => {
    try {
      const uid = extra?.userId || getUserIdFromStore();
      const eventId = extra?.eventId || "default";
      const storagePath = extra?.storagePath || "";

      const { capturesDir, metaFile } = resolveBoothOutputDirs({
        userId: uid,
        eventId,
        sessionId,
        storagePath,
      });

      const safeIndex = String(slotIndex).padStart(2, "0");
      const file = path.join(capturesDir, `shot_${safeIndex}.jpg`);
      const m = String(dataUrl).match(/^data:(.+?);base64,(.+)$/);
      if (!m) return { ok: false, error: 'invalid_dataurl' };

      fs.writeFileSync(file, Buffer.from(m[2], 'base64'));

      const meta = readJson(metaFile, {});
      meta.shots = Array.isArray(meta.shots) ? meta.shots : [];
      meta.slots = Array.isArray(meta.slots) ? meta.slots : [];

      const sid = `shot_${slotIndex}`;
      const rec = { id: sid, path: `captures/shot_${safeIndex}.jpg` };
      const existing = meta.shots.find(x => x.id === sid);
      if (existing) Object.assign(existing, rec);
      else meta.shots.push(rec);

      const slotId = `slot${slotIndex}`;
      let slot = meta.slots.find(x => x.id === slotId);
      if (!slot) {
        slot = { id: slotId };
        meta.slots.push(slot);
      }
      slot.image = `captures/shot_${safeIndex}.jpg`;

      writeJson(metaFile, meta);
      return { ok: true, filePath: file, fileUrl: toFileUrl(file) };
    } catch (err) {
      console.error("preview:saveStill error:", err);
      return { ok: false, error: String(err) };
    }
  });

  safeHandle('preview:saveSlotClip', async (_e, sessionId, slotIndex, byteArray, extra = {}) => {
    try {
      const uid = extra?.userId || getUserIdFromStore();
      const eventId = extra?.eventId || "default";
      const storagePath = extra?.storagePath || "";

      const { burstDir, metaFile } = resolveBoothOutputDirs({
        userId: uid,
        eventId,
        sessionId,
        storagePath,
      });

      const rawPath = path.join(burstDir, `slot${slotIndex}_raw.webm`);
      fs.writeFileSync(rawPath, Buffer.from(Uint8Array.from(byteArray || [])));

      const result = await transcodeSlotClip(burstDir, slotIndex);

      const meta = readJson(metaFile, {});
      meta.burst = Array.isArray(meta.burst) ? meta.burst : [];
      meta.slots = Array.isArray(meta.slots) ? meta.slots : [];

      const burstId = `slot${slotIndex}`;

      const existingBurst = meta.burst.find((x) => x.id === burstId);

      const burstRecord = {
        id: burstId,
        slotIndex,
        raw: `burst/slot${slotIndex}_raw.webm`,
        mp4: `burst/slot${slotIndex}.mp4`,
        gif: `burst/slot${slotIndex}.gif`,
        createdAt: new Date().toISOString(),
      };

      if (existingBurst) {
        Object.assign(existingBurst, burstRecord);
      } else {
        meta.burst.push(burstRecord);
      }

      const slotId = `slot${slotIndex}`;
      let slot = meta.slots.find(x => x.id === slotId);
      if (!slot) {
        slot = { id: slotId };
        meta.slots.push(slot);
      }
      slot.video = `burst/slot${slotIndex}.mp4`;
      slot.gif = `burst/slot${slotIndex}.gif`;

      writeJson(metaFile, meta);

      return { ok: true, ...result };
    } catch (err) {
      console.error("preview:saveSlotClip error:", err);
      return { ok: false, error: String(err) };
    }
  });

  console.log("store handlers for templates and palettes registered");

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// ====== Preview server (Express) + IPC ======
const PREVIEW_PORT = Number(process.env.PREVIEW_PORT || 3977);
let previewServer = null;

function getLanAddress() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        return `http://${net.address}:${PREVIEW_PORT}`;
      }
    }
  }
  return `http://localhost:${PREVIEW_PORT}`;
}

function indexByToken(previewRootAbs) {
  const map = new Map();
  if (!fs.existsSync(previewRootAbs)) return map;
  for (const sid of fs.readdirSync(previewRootAbs)) {
    const file = path.join(previewRootAbs, sid, 'session.json');
    if (fs.existsSync(file)) {
      const meta = readJson(file, null);
      if (meta?.token) map.set(meta.token, { dir: path.join(previewRootAbs, sid), meta });
    }
  }
  return map;
}

function startPreviewServer() {
  if (previewServer) return getLanAddress();
  const appx = express();
  // Keep routes minimal; helmet/cors optional on LAN
  // API
  appx.get('/api/session/:token', (req, res) => {
    try {
      const uid = getUserIdFromStore();
      const root = getPreviewRoot(uid);
      const entry = indexByToken(root).get(req.params.token);
      if (!entry) return res.status(404).end();
      const { dir, meta } = entry;

      const toUrl = (p) => {
        if (!p) return null;
        // Encode each path segment, keep slashes
        return `/media/${meta.token}/${String(p).split('/').map(encodeURIComponent).join('/')}`;
      };

      res.json({
        sessionId: meta.sessionId,
        createdAt: meta.createdAt,
        shots: (meta.shots || []).map(s => ({ ...s, url: toUrl(s.path) })),
        slots: (meta.slots || []).map(s => ({
          ...s,
          imageUrl: toUrl(s.image),
          videoUrl: toUrl(s.video),
          gifUrl: toUrl(s.gif),
        })),
        finalPrintUrl: toUrl(meta.finalPrint),
        animatedCompositeUrl: toUrl(meta.animatedComposite),
        layout: meta.layout
      });
    } catch (e) {
      res.status(500).json({ error: 'server_error' });
    }
  });
  // Media streaming (token-scoped)
  appx.get('/media/:token/:rel', async (req, res) => {
    try {
      // Recompute the preview root for the current user
      const uid = getUserIdFromStore();
      const previewRootAbs = getPreviewRoot(uid);

      // Map token -> session directory by scanning session.json files
      const entry = indexByToken(previewRootAbs).get(req.params.token);
      if (!entry) return res.status(404).end();

      // Support nested rel paths like "video/slot1.gif" or "originals/shot_0.jpg"
      const prefix = `/media/${req.params.token}/`;
      const fullUrl = req.url;                                     // e.g. /media/<token>/video/slot1.gif
      const rel = decodeURIComponent(fullUrl.slice(prefix.length)); // "video/slot1.gif"

      // Normalize + traversal guard
      const safeRel = rel.replace(/\\/g, '/');
      const abs = path.resolve(entry.dir, safeRel);
      const inside = !path.relative(entry.dir, abs).startsWith('..');
      if (!inside) return res.status(403).end();

      if (!fs.existsSync(abs)) return res.status(404).end();

      res.setHeader('Content-Type', mime.getType(abs) || 'application/octet-stream');
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
      fs.createReadStream(abs).pipe(res);
    } catch (e) {
      console.error('[Preview] media route error:', e);
      res.status(500).end();
    }
  });
  // Serve built SPA from resources/preview-client (optional)
  const clientDir = path.join(process.resourcesPath, 'preview-client');
  if (fs.existsSync(clientDir)) {
    appx.use(express.static(clientDir));
    appx.get('/p/:token', (_req, res) => res.sendFile(path.join(clientDir, 'index.html')));
  } else {
    // dev fallback: simple page
    appx.get('/p/:token', (req, res) => res.end(`<html><body><div>Preview token: ${req.params.token}</div></body></html>`));
  }
  previewServer = appx.listen(PREVIEW_PORT, () => {
    console.log('[Preview] Serving client from:', clientDir, 'exists?', fs.existsSync(clientDir));
    console.log(`Preview server on ${getLanAddress()}`);
  });
  return getLanAddress();
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
