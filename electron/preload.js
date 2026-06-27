// electron/preload.js
const { contextBridge, ipcRenderer } = require("electron");

/**
 * Auto-inject { userId } into ctx by asking main for identity
 * if ctx is missing or doesn't include userId.
 */
async function withIdentityCtx(ctx) {
  const hasUser = ctx && typeof ctx.userId === 'string' && ctx.userId.length > 0;
  if (hasUser) return ctx;
  try {
    const id = await ipcRenderer.invoke("secureStore:getIdentity");
    const userId = id?.userId ?? null;
    return { ...(ctx || {}), userId };
  } catch {
    return ctx || {};
  }
}

/**
 * Helper: convert a File (<input type="file">) to a Uint8Array of bytes.
 */
async function fileToBytes(file) {
  if (!file) throw new Error("No file provided");
  const ab = await file.arrayBuffer();
  return new Uint8Array(ab);
}

/**
 * Normalize responses from main handlers that may return different shapes.
 * PRESERVES appUrl and relativeKey for rehydrate.
 */
function normalizeSaveResponse(res) {
  if (!res) {
    return {
      ok: false,
      savedPath: null,
      fileUrl: null,
      appUrl: null,
      relativeKey: null,
      error: "no response",
    };
  }
  return {
    ok: res?.ok ?? (res?.savedPath || res?.filePath ? true : false),
    savedPath: res?.savedPath ?? res?.filePath ?? null,
    fileUrl: res?.fileUrl ?? null,
    appUrl: res?.appUrl ?? null,
    relativeKey: res?.relativeKey ?? null,
    error: res?.error ?? null,
  };
}

/**
 * Minimal safe event subscription wrapper.
 * Returns an unsubscribe function.
 */
function onChannel(channel, listener) {
  const wrapped = (event, ...args) => listener(...args);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

/**
 * Small helper to produce a cache-busting suffix for preview URLs.
 * Renderer should NOT persist the suffix into storage.
 */
function previewSuffix() {
  return `?_t=${Date.now()}`;
}

const apiImpl = {

  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  onUpdaterStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("updater:status", listener);
    return () => ipcRenderer.removeListener("updater:status", listener);
  },

  getPreviewSlotClips: (sessionId, options = {}) =>
    ipcRenderer.invoke("get-preview-slot-clips", { sessionId, options }),

  buildFinalMotion: async (payload = {}) => {
    const ctx = await withIdentityCtx();
    const settings = await ipcRenderer.invoke("store:getSettings", ctx);
    const storagePath = settings?.storagePath ?? "";
    return ipcRenderer.invoke("output:build-final-motion", {
      ...payload,
      userId: payload?.userId ?? ctx?.userId ?? null,
      storagePath,
    });
  },

  finalizeCashPayment: (payload) => ipcRenderer.invoke("payment:finalize-cash", payload),
  startQrPayment: (payload) => ipcRenderer.invoke("payment:start-qr", payload),
  startPayPalPayment: (payload) => ipcRenderer.invoke("payment:start-paypal", payload),
  startCardPayment: (payload) => ipcRenderer.invoke("payment:start-card", payload),
  chargeAdditionalPayment: (payload) => ipcRenderer.invoke("payment:charge-additional", payload),
  recordPayment: (record) => ipcRenderer.invoke("payment:record", record),

  /* Store / Events / Settings */
  getEvents: async (ctx) => ipcRenderer.invoke("store:getEvents", await withIdentityCtx(ctx)), // ctx = { userId }
  setEvents: async (events, ctx) => ipcRenderer.invoke("store:setEvents", events, await withIdentityCtx(ctx)),

  listCameras: () => ipcRenderer.invoke("media:listCameras"),
  getCameraCapabilities: (cameraId) => ipcRenderer.invoke("media:getCameraCapabilities", cameraId),

  getAppearance: async (ctx) => ipcRenderer.invoke("store:getAppearance", await withIdentityCtx(ctx)),
  setAppearance: async (appearance, ctx) => ipcRenderer.invoke("store:setAppearance", appearance, await withIdentityCtx(ctx)),

  getSettings: async (ctx) => ipcRenderer.invoke("store:getSettings", await withIdentityCtx(ctx)),
  setSettings: async (settings, ctx) => ipcRenderer.invoke("store:setSettings", settings, await withIdentityCtx(ctx)),

  getCurrentEventId: () => ipcRenderer.invoke("store:getCurrentEventId"),
  setCurrentEventId: (id) => ipcRenderer.invoke("store:setCurrentEventId", id),

  getCurrentSubTab: () => ipcRenderer.invoke("store:getCurrentSubTab"),
  setCurrentSubTab: (tab) => ipcRenderer.invoke("store:setCurrentSubTab", tab),

  createOnlineGallery: async (payload = {}) => {
    const ctx = await withIdentityCtx();
    const settings = await ipcRenderer.invoke("store:getSettings", ctx);
    const storagePath = settings?.storagePath ?? "";
    return ipcRenderer.invoke("gallery:create", {
      ...payload,
      userId: payload?.userId ?? ctx?.userId ?? null,
      storagePath: payload?.storagePath ?? storagePath,
    });
  },

  /* Templates & Palettes */
  getTemplates: async (ctx) => ipcRenderer.invoke("store:getTemplates", await withIdentityCtx(ctx)),
  setTemplates: async (templates, ctx) => ipcRenderer.invoke("store:setTemplates", templates, await withIdentityCtx(ctx)),

  getPalettes: async (ctx) => ipcRenderer.invoke("store:getPalettes", await withIdentityCtx(ctx)),
  setPalettes: async (palettes, ctx) => ipcRenderer.invoke("store:setPalettes", palettes, await withIdentityCtx(ctx)),

  saveTemplateThumbnail: async (dataUrl, filename, userId = null) => {
    const res = await ipcRenderer.invoke("store:saveTemplateThumbnail", { dataUrl, filename, userId });
    return normalizeSaveResponse(res);
  },

  /* Appearance asset uploads */
  saveAppearanceLogoFromFile: async (file, eventId = null, userId = null) => {
    if (!file) throw new Error("No file");
    const bytes = await fileToBytes(file);
    const payload = { bytes, originalName: file.name, mime: file.type, eventId: eventId ?? null, userId };
    const res = await ipcRenderer.invoke("saveAppearanceLogo", payload);
    return normalizeSaveResponse(res);
  },

  saveAppearanceBackgroundFromFile: async (file, eventId = null, userId = null) => {
    if (!file) throw new Error("No file");
    const bytes = await fileToBytes(file);
    const payload = { bytes, originalName: file.name, mime: file.type, eventId: eventId ?? null, userId };
    const res = await ipcRenderer.invoke("saveAppearanceBackground", payload);
    return normalizeSaveResponse(res);
  },

  saveAppearanceBackgroundFromDataUrl: async (dataUrl, originalName = null, mime = null, eventId = null, userId = null) => {
    if (!dataUrl) throw new Error("No dataUrl");
    const payload = { dataUrl, originalName, mime, eventId, userId };
    const res = await ipcRenderer.invoke("saveAppearanceBackground", payload);
    return normalizeSaveResponse(res);
  },

  // Delete an asset file (logo/background/thumb). Main should implement safe unlink.
  async deleteAppearanceAsset(filePath) {
    if (!filePath) return { ok: false, error: "no path" };
    try {
      const res = await ipcRenderer.invoke("deleteAppearanceAsset", filePath);
      return res ?? { ok: false, error: "no response" };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  },

  // Resolve a renderable URL (file:// or app://) from savedPath or relativeKey
  async resolveAppearanceUrl({ savedPath, relativeKey }) {
    const res = await ipcRenderer.invoke("resolveAppearanceUrl", { savedPath, relativeKey });
    return res ?? { ok: false, url: null, error: "no response" };
  },

  /* Capture / Photos / Printing */
  /* Capture / Photos / Printing */

  capturePhoto: async (args = {}) => {
    const settings = await ipcRenderer.invoke("store:getSettings", await withIdentityCtx());
    const storagePath = settings?.storagePath ?? "";
    return ipcRenderer.invoke("capture-photo", { ...args, storagePath });
  },

  capturesList: async (args = {}) => {
    const settings = await ipcRenderer.invoke("store:getSettings", await withIdentityCtx());
    const storagePath = settings?.storagePath ?? "";
    return ipcRenderer.invoke("captures:list", { ...args, storagePath });
  },

  getCapturedPhotos: async (eventId = "default", userId = null) => {
    const settings = await ipcRenderer.invoke("store:getSettings", await withIdentityCtx());
    const storagePath = settings?.storagePath ?? "";
    return ipcRenderer.invoke("captures:list", { eventId, userId, storagePath });
  },

  printPhoto: async (data = {}) => {
    const settings = await ipcRenderer.invoke("store:getSettings", await withIdentityCtx());
    const storagePath = settings?.storagePath ?? "";
    return ipcRenderer.invoke("print-photo", { ...data, storagePath });
  },
  getPrinters: () => ipcRenderer.invoke("get-printers"),
  testPrint: (job) => ipcRenderer.invoke("test-print", job),


  // FRAMES / TONES (added)
  getFrames: async (ctx) => ipcRenderer.invoke("store:getFrames", await withIdentityCtx(ctx)),
  setFrames: async (frames, ctx) => ipcRenderer.invoke("store:setFrames", frames, await withIdentityCtx(ctx)),

  getTones: async (ctx) => ipcRenderer.invoke("store:getTones", await withIdentityCtx(ctx)),
  setTones: async (tones, ctx) => ipcRenderer.invoke("store:setTones", tones, await withIdentityCtx(ctx)),

  // Printers alias (AdminDashboard calls listPrinters)
  listPrinters: () => ipcRenderer.invoke("get-printers"),

  /* Event data helpers */
  saveEventData: async (data, ctx) => {
    const c = await withIdentityCtx(ctx);
    return ipcRenderer.invoke("save-event-data", { ...data, userId: c.userId });
  },
  getEventData: async (eventId = "default", ctx) => {
    const c = await withIdentityCtx(ctx);
    return ipcRenderer.invoke("get-event-data", { eventId, userId: c.userId });
  },
  loadEvents: async (ctx) => ipcRenderer.invoke("load-events", await withIdentityCtx(ctx)),
  syncEvent: async (action, ctx) => {
    const c = await withIdentityCtx(ctx);
    return ipcRenderer.invoke("sync-event", { ...action, userId: c.userId });
  },

  saveFinalPng: async (data = {}) => {
    const ctx = await withIdentityCtx();
    const settings = await ipcRenderer.invoke("store:getSettings", ctx);
    const storagePath = settings?.storagePath ?? "";
    return ipcRenderer.invoke("output:save-final-png", {
      ...data,
      userId: data?.userId ?? ctx?.userId ?? null,
      storagePath,
    });
  },

  savePrintCopy: async (data = {}) => {
    const ctx = await withIdentityCtx();
    const settings = await ipcRenderer.invoke("store:getSettings", ctx);
    const storagePath = settings?.storagePath ?? "";
    return ipcRenderer.invoke("output:save-print-copy", {
      ...data,
      userId: data?.userId ?? ctx?.userId ?? null,
      storagePath,
    });
  },

  // Maintenance helpers
  clearCache: () => ipcRenderer.invoke('app:clear-cache'),
  getStorageInfo: (path) => ipcRenderer.invoke('storage:info', path),
  cleanupStorage: (opts) => ipcRenderer.invoke('storage:cleanup', opts),

  // Software update helpers
  checkUpdates: () => ipcRenderer.invoke('app:check-updates'),
  downloadUpdate: () => ipcRenderer.invoke('app:download-update'),
  installUpdate: () => ipcRenderer.invoke('app:install-update'),

  // Event subscriptions and shutter trigger
  onPrintProgress: (listener) => onChannel('print-progress', listener),
  onEventsUpdated: (listener) => onChannel('eventsUpdated', listener),
  triggerShutter: () => ipcRenderer.send('trigger-shutter'),

  /* Account Center */
  getAccountPreferences: async () => {
    const ctx = await withIdentityCtx();
    return ipcRenderer.invoke("account:getPreferences", ctx);
  },

  saveAccountPreferences: async (preferences = {}) => {
    const ctx = await withIdentityCtx();
    return ipcRenderer.invoke("account:savePreferences", {
      ...preferences,
      userId: preferences?.userId ?? ctx?.userId ?? null,
    });
  },

  changeAccountPassword: async (payload = {}) => {
    return ipcRenderer.invoke("account:changePassword", payload);
  },

  /* Template helpers */
  getActiveTemplate: async (eventId = "default", ctx) =>
    ipcRenderer.invoke("template:get", { eventId, ...(await withIdentityCtx(ctx)) }),
  saveTemplateSelection: async (payload, ctx) =>
    ipcRenderer.invoke("template:saveSelection", { ...(payload || {}), ...(await withIdentityCtx(ctx)) }),

  restartApp: () => ipcRenderer.invoke("app:restart"),

  /* Event subscription helpers */
  on: (channel, listener) => onChannel(channel, listener),
  removeListener: (channel, listener) => ipcRenderer.removeListener(channel, listener),
  off: (channel, listener) => ipcRenderer.removeListener(channel, listener),

  /* Preview helper (cache-busting suffix) */
  previewSuffix,

  /* ====== Preview (QR + mobile page) ====== */
  // Start the lightweight preview server in main; resolves base URL (LAN or localhost)
  previewStartServer: () => ipcRenderer.invoke('preview:startServer'),
  // Create a session directory & token; returns { sessionId, token, previewUrl }
  previewCreateSession: (payload) => ipcRenderer.invoke('preview:createSession', payload),
  // Get full preview URL from a token or sessionId (helper)
  previewGetUrl: (tokenOrSession) => ipcRenderer.invoke('preview:getUrl', tokenOrSession),
  // Save still (data URL) for a slot index
  previewSaveStill: async (sessionId, slotIndex, dataUrl, extra = {}) => {
    const ctx = await withIdentityCtx();
    const settings = await ipcRenderer.invoke("store:getSettings", ctx);
    const storagePath = settings?.storagePath ?? "";
    return ipcRenderer.invoke('preview:saveStill', sessionId, slotIndex, dataUrl, {
      ...extra,
      userId: extra?.userId ?? ctx?.userId ?? null,
      storagePath,
    });
  },

  previewSaveSlotClip: async (sessionId, slotIndex, uint8ArrayOrBuffer, extra = {}) => {
    const ctx = await withIdentityCtx();
    const settings = await ipcRenderer.invoke("store:getSettings", ctx);
    const storagePath = settings?.storagePath ?? "";
    return ipcRenderer.invoke(
      'preview:saveSlotClip',
      sessionId,
      slotIndex,
      Array.from(uint8ArrayOrBuffer || []),
      {
        ...extra,
        userId: extra?.userId ?? ctx?.userId ?? null,
        storagePath,
      }
    );
  },

  buildFinalMotion: async (payload = {}) => {
    const ctx = await withIdentityCtx();
    const settings = await ipcRenderer.invoke("store:getSettings", ctx);
    const storagePath = settings?.storagePath ?? "";
    return ipcRenderer.invoke("output:build-final-motion", {
      ...payload,
      userId: payload?.userId ?? ctx?.userId ?? null,
      storagePath,
    });
  },
};

// Expose both names so older renderer code (window.api) and newer code (window.electron) work


// Session store bridge (renderer -> main)
contextBridge.exposeInMainWorld('sessionStore', {
  // Save tokens in OS keychain
  save: (accessToken, refreshToken) =>
    ipcRenderer.invoke('auth:saveSession', { accessToken, refreshToken }),

  // Load tokens from OS keychain
  load: () => ipcRenderer.invoke('auth:getSession'),

  // Clear tokens
  clear: () => ipcRenderer.invoke('auth:clearSession'),
});

contextBridge.exposeInMainWorld('system', {
  getFingerprint: () => ipcRenderer.invoke('system:getFingerprint'),
  openExternal: (url) => ipcRenderer.invoke('system:openExternal', url),
});

contextBridge.exposeInMainWorld("electron", apiImpl);
contextBridge.exposeInMainWorld("api", apiImpl);

/* ============================================
 * ✅ Secure Auth Bridge (ADDED, non-breaking)
 * Matches main.js handlers:
 *   - secureStore:registerCredentials
 *   - secureStore:validateCredentials
 *   - secureStore:getUsername
 * ============================================ */
contextBridge.exposeInMainWorld("secureStore", {
  getIdentity: () => ipcRenderer.invoke("secureStore:getIdentity"),
  clearIdentity: () => ipcRenderer.invoke("secureStore:clearIdentity"),
  // Called by AuthContext after a valid Supabase session to keep file-path helpers in sync.
  // Pass null on logout to clear the stored userId.
  setCurrentUser: (userId) => ipcRenderer.invoke("auth:syncUser", { userId }),
});

