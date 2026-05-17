// electron/main/store.js
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

// Defensive import for electron-store (handles default vs named export shapes)
let Store;
try {
  const maybe = require("electron-store");
  Store = maybe && maybe.default ? maybe.default : maybe;
} catch (err) {
  console.error("Failed to require electron-store:", err);
  Store = null;
}

/* ---------------- Schema ---------------- */
const schema = {
  currentEventId: {
    anyOf: [{ type: 'string' }, { type: 'null' }],
    default: null
  },
  currentSubTab: { type: "string", default: "appearance" },
  events: { type: "array", default: [] },
  templates: { type: "array", default: [] },
  palettes: { type: "array", default: [] },
  appearance: {
    type: "object",
    properties: {
      headerFont: { type: "string", default: "Ramillas" },
      generalFont: { type: "string", default: "Interphases" },
      bgColor: { type: "string", default: "#ffffff" },
      fontColor: { type: "string", default: "#000000" }
    },
    default: {}
  },
  settings: {
    type: "object",
    properties: {
      countdown: { type: "number", default: 5 },
      screenTimers: { type: "object", default: {} },
      numberOfShots: { type: "number", default: 3 },
      flashEnabled: { type: "boolean", default: true },
      soundEnabled: { type: "boolean", default: true },
      language: { type: "string", default: "en" }
    },
    default: {}
  },
  _licenseCache: {
    anyOf: [{ type: "object" }, { type: "null" }],
    default: null
  }
};

/* ---------------- instantiate store ---------------- */
let store = null;
if (Store) {
  try {
    store = new Store({ schema });
    console.log("electron-store initialized at:", store.path);
  } catch (err) {
    console.error("Failed to instantiate electron-store:", err);
    store = null;
  }
} else {
  console.error("electron-store module not available; falling back to in-memory store.");
}

/* ---------------- Helpers for thumbnail persistence ---------------- */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Save a data URL (base64) to the userData thumbnails folder.
 * @param {string} dataUrl - data:image/...;base64,... string
 * @param {string} filename - suggested filename (e.g., template-123.jpg)
 * @returns {string} savedPath (absolute) or null on failure
 */
function saveDataUrlToFile(dataUrl, filename) {
  try {
    if (!dataUrl || typeof dataUrl !== "string") return null;
    const matches = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    if (!matches) return null;
    const mime = matches[1];
    const base64 = matches[2];
    const ext = mime.split("/")[1].split("+")[0] || "jpg";
    const safeFilename = filename || `thumb-${Date.now()}.${ext}`;
    const userData = app.getPath("userData");
    const thumbsDir = path.join(userData, "thumbnails");
    ensureDir(thumbsDir);
    const outPath = path.join(thumbsDir, safeFilename);
    const buffer = Buffer.from(base64, "base64");
    fs.writeFileSync(outPath, buffer);
    return outPath;
  } catch (err) {
    console.error("saveDataUrlToFile error", err);
    return null;
  }
}

/* ---------------- Public API expected by renderer (window.api) ---------------- */
module.exports = {
  // Generic accessors (fall back to simple in-memory if store missing)
  get: (k, def) => (store ? store.get(k, def) : def),
  set: (k, v) => (store ? store.set(k, v) : null),
  delete: (k) => (store ? store.delete(k) : null),
  all: () => (store ? store.store : {}),

  // Events
  getEvents: () => (store ? store.get("events", []) : []),
  setEvents: (events) => (store ? store.set("events", events) : null),

  // Templates
  getTemplates: () => (store ? store.get("templates", []) : []),
  setTemplates: (templates) => (store ? store.set("templates", templates) : null),

  // Palettes
  getPalettes: () => (store ? store.get("palettes", []) : []),
  setPalettes: (palettes) => (store ? store.set("palettes", palettes) : null),

  // Appearance
  getAppearance: () => (store ? store.get("appearance", {}) : {}),
  setAppearance: (appearance) => (store ? store.set("appearance", appearance) : null),

  // Settings
  getSettings: () => (store ? store.get("settings", {}) : {}),

  // Replace your current setSettings with this
  setSettings: (partial) => {
    if (!store) return null;
    const current = store.get("settings", {});

    // Merge shallowly; keep existing keys unless overwritten
    const next = { ...current, ...partial };

    // Coerce/sanitize to satisfy schema
    if (next.screenTimers == null || typeof next.screenTimers !== "object" || Array.isArray(next.screenTimers)) {
      next.screenTimers = {};
    }
    if (typeof next.countdown !== "number") next.countdown = Number(next.countdown) || 5;
    if (typeof next.numberOfShots !== "number") next.numberOfShots = Number(next.numberOfShots) || 3;
    if (typeof next.flashEnabled !== "boolean") next.flashEnabled = Boolean(next.flashEnabled);
    if (typeof next.soundEnabled !== "boolean") next.soundEnabled = Boolean(next.soundEnabled);
    if (typeof next.language !== "string") next.language = "en";

    return store.set("settings", next);
  },

  // Current event / subtab
  getCurrentEventId: () => (store ? store.get("currentEventId", null) : null),
  setCurrentEventId: (id) => (store ? store.set("currentEventId", id) : null),
  getCurrentSubTab: () => (store ? store.get("currentSubTab", "appearance") : "appearance"),
  setCurrentSubTab: (tab) => (store ? store.set("currentSubTab", tab) : null),

  /**
   * Persist a template thumbnail (data URL) to disk and return saved path.
   * If the main process cannot save, returns null.
   * @param {string} dataUrl - data:image/...;base64,... string
   * @param {string} filename - optional filename suggestion
   * @returns {object} { ok: boolean, filePath: string|null, fileUrl: string|null }
   */
  saveTemplateThumbnail: (dataUrl, filename) => {
    try {
      const saved = saveDataUrlToFile(dataUrl, filename);
      if (!saved) return { ok: false, filePath: null, fileUrl: null };
      // convert to file:// URL for renderer convenience
      const normalized = String(saved).replace(/\\/g, "/").replace(/^\/+/, "");
      const fileUrl = "file:///" + encodeURI(normalized);
      return { ok: true, filePath: saved, fileUrl };
    } catch (err) {
      console.error("saveTemplateThumbnail failed", err);
      return { ok: false, filePath: null, fileUrl: null };
    }
  }
};
