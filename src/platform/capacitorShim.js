/**
 * Capacitor platform shim
 *
 * Polyfills the same API surface as the Electron preload bridge (window.electron)
 * so all existing React screens work unmodified on iPad.
 *
 * Strategy per method type:
 *   - Data storage  → @capacitor/preferences (NSUserDefaults, scoped by userId key)
 *   - Gallery data  → Supabase direct queries (same DB as Windows app)
 *   - Hardware IPC  → Stubs (camera Phase 2, printing Phase 3)
 *   - App updates   → No-ops (App Store manages updates on iOS)
 *   - Event emitters → No-ops returning unsubscribe functions
 */

import { Preferences } from '@capacitor/preferences';
import { supabase } from '../services/supabase';
import { changePassword } from '../services/licensingApi';
import { uploadSessionImages } from '../services/uploadSessionImages';
import { saveGalleryRecord } from '../services/saveGalleryRecord';

const GALLERY_BASE = 'https://studiophotuna-gallery.vercel.app/gallery';

// ── Identity ────────────────────────────────────────────────────────────────

async function getUserId() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
}

// ── Preferences helpers ──────────────────────────────────────────────────────

function scopedKey(name, userId) {
  return userId ? `${name}:${userId}` : name;
}

async function prefGet(name, userId, fallback = null) {
  try {
    const { value } = await Preferences.get({ key: scopedKey(name, userId) });
    return value != null ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

async function prefSet(name, value, userId) {
  try {
    await Preferences.set({ key: scopedKey(name, userId), value: JSON.stringify(value) });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

async function prefRemove(name, userId) {
  try {
    await Preferences.remove({ key: scopedKey(name, userId) });
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

// ── Camera helpers ───────────────────────────────────────────────────────────

function stripWindowsCameraId(settings) {
  if (!settings || typeof settings !== 'object') return settings;
  const s = { ...settings };
  delete s.selectedCameraId;
  delete s.selectedCameraDeviceId;
  return s;
}

// ── Appearance helpers ────────────────────────────────────────────────────────

// Upload an appearance asset (logo or background image) to Supabase Storage.
// Path starts with userId so the UPDATE RLS policy (first folder = auth.uid()) passes.
async function uploadAppearanceAsset(file, userId, slot) {
  const ext = (file.name || '').split('.').pop() || 'png';
  const path = `${userId}/appearance/${slot}.${ext}`;
  const { error } = await supabase.storage
    .from('studiophotuna')
    .upload(path, file, { contentType: file.type || 'image/png', upsert: true });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from('studiophotuna').getPublicUrl(path);
  return data?.publicUrl ?? null;
}

// ── Stubs ────────────────────────────────────────────────────────────────────

const noopUnsub = () => {};
const noop = async () => null;

// ── The shim object ──────────────────────────────────────────────────────────

export const capacitorShim = {

  // ── Identity helper (mirrors preload's secureStore:getIdentity) ────────────
  getIdentity: async () => {
    const userId = await getUserId();
    return { userId };
  },

  // ── Events ─────────────────────────────────────────────────────────────────
  getEvents: async (ctx) => prefGet('events', ctx?.userId ?? await getUserId(), []),
  setEvents: async (events, ctx) => prefSet('events', events, ctx?.userId ?? await getUserId()),
  loadEvents: async (ctx) => prefGet('events', ctx?.userId ?? await getUserId(), []),
  cleanupEventStorage: noop,

  // ── Settings ───────────────────────────────────────────────────────────────
  getSettings: async (ctx) => {
    const s = await prefGet('settings', ctx?.userId ?? await getUserId(), {});
    return stripWindowsCameraId(s);
  },
  setSettings: async (settings, ctx) => prefSet('settings', settings, ctx?.userId ?? await getUserId()),

  // ── Appearance ─────────────────────────────────────────────────────────────
  getAppearance: async (ctx) => prefGet('appearance', ctx?.userId ?? await getUserId(), {}),
  setAppearance: async (appearance, ctx) => prefSet('appearance', appearance, ctx?.userId ?? await getUserId()),

  // ── Templates ──────────────────────────────────────────────────────────────
  getTemplates: async (ctx) => {
    const templates = await prefGet('templates', ctx?.userId ?? await getUserId(), []);
    if (!Array.isArray(templates)) return templates;
    // Strip Windows file:// / C:\ thumbnail paths — they don't resolve on iPad;
    // TemplateScreen falls back to tpl.icon when thumbSrc is null.
    const webSafe = (v) => !v || v.startsWith('https://') || v.startsWith('http://') || v.startsWith('data:');
    return templates.map(t => ({ ...t, thumbSrc: webSafe(t?.thumbSrc) ? t.thumbSrc : null }));
  },
  setTemplates: async (templates, ctx) => prefSet('templates', templates, ctx?.userId ?? await getUserId()),

  // ── Frames ─────────────────────────────────────────────────────────────────
  getFrames: async (ctx) => prefGet('frames', ctx?.userId ?? await getUserId(), []),
  setFrames: async (frames, ctx) => prefSet('frames', frames, ctx?.userId ?? await getUserId()),

  // ── Palettes & Tones ───────────────────────────────────────────────────────
  getPalettes: async (ctx) => prefGet('palettes', ctx?.userId ?? await getUserId(), []),
  setPalettes: async (palettes, ctx) => prefSet('palettes', palettes, ctx?.userId ?? await getUserId()),
  getTones: async (ctx) => prefGet('tones', ctx?.userId ?? await getUserId(), []),
  setTones: async (tones, ctx) => prefSet('tones', tones, ctx?.userId ?? await getUserId()),

  // ── Navigation state ────────────────────────────────────────────────────────
  getCurrentEventId: () => prefGet('currentEventId', null, null),
  setCurrentEventId: (id) => prefSet('currentEventId', id, null),
  getActiveMain: () => prefGet('activeMain', null, null),
  setActiveMain: (tab) => prefSet('activeMain', tab, null),
  getCurrentSubTab: () => prefGet('currentSubTab', null, null),
  setCurrentSubTab: (tab) => prefSet('currentSubTab', tab, null),

  // ── Meta flags ─────────────────────────────────────────────────────────────
  getMetaFlag: async ({ key } = {}) => prefGet(`meta:${key}`, null, null),
  setMetaFlag: async ({ key, value } = {}) => prefSet(`meta:${key}`, value, null),

  // ── Account preferences ────────────────────────────────────────────────────
  getAccountPreferences: async () => {
    const userId = await getUserId();
    return prefGet('accountPreferences', userId, {});
  },
  saveAccountPreferences: async (prefs = {}) => {
    const userId = prefs?.userId ?? await getUserId();
    return prefSet('accountPreferences', prefs, userId);
  },
  changeAccountPassword: async ({ currentPassword, newPassword } = {}) => {
    return changePassword(currentPassword, newPassword);
  },

  // ── Payment keys (stored locally in Preferences) ───────────────────────────
  getPayMongoStatus: async () => {
    const keys = await prefGet('paymongo', null, null);
    return { configured: !!(keys?.secretKey), ...(keys ?? {}) };
  },
  savePayMongoKeys: async (payload) => prefSet('paymongo', payload, null),
  clearPayMongoKeys: async () => prefRemove('paymongo', null),

  getXenditStatus: async () => {
    const keys = await prefGet('xendit', null, null);
    return { configured: !!(keys?.apiKey), ...(keys ?? {}) };
  },
  saveXenditKeys: async (payload) => prefSet('xendit', payload, null),
  clearXenditKeys: async () => prefRemove('xendit', null),

  getPaypalStatus: async () => {
    const keys = await prefGet('paypal', null, null);
    return { configured: !!(keys?.clientId), ...(keys ?? {}) };
  },
  savePaypalKeys: async (payload) => prefSet('paypal', payload, null),
  clearPaypalKeys: async () => prefRemove('paypal', null),

  // ── Gallery — Supabase direct ───────────────────────────────────────────────
  getEventGallerySessions: async ({ eventId } = {}) => {
    try {
      const { data, error } = await supabase
        .from('galleries')
        .select('*')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false });

      if (error) return { sessions: [], error: error.message };

      const sessions = (data ?? []).map(row => ({
        sessionId: row.session_id ?? null,
        slug: row.slug,
        qrUrl: `${GALLERY_BASE}/${row.slug}`,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
      }));

      return { sessions };
    } catch (err) {
      return { sessions: [], error: err?.message };
    }
  },

  createEventGalleryQr: async ({ eventId } = {}) => {
    try {
      const userId = await getUserId();

      const { data: existing } = await supabase
        .from('galleries')
        .select('slug, expires_at')
        .eq('event_id', eventId)
        .is('session_id', null)
        .maybeSingle();

      if (existing?.slug) {
        return {
          ok: true,
          slug: existing.slug,
          qrUrl: `${GALLERY_BASE}/${existing.slug}`,
          expiresAt: existing.expires_at,
          isNew: false,
        };
      }

      const slug = `evt-${String(eventId).replace(/-/g, '').slice(0, 12)}-${Date.now().toString(36)}`;
      const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

      const { error } = await supabase.from('galleries').insert({
        slug,
        event_id: eventId,
        session_id: null,
        owner_user_id: userId,
        final_url: null,
        expires_at: expiresAt,
      });

      if (error) return { ok: false, error: error.message };
      return { ok: true, slug, qrUrl: `${GALLERY_BASE}/${slug}`, expiresAt, isNew: true };
    } catch (err) {
      return { ok: false, error: err?.message };
    }
  },

  // Gallery create — upload composed image to Supabase Storage + create gallery record
  createOnlineGallery: async ({ composedImage, composedImageUrl, photos = [], sessionId, eventId } = {}) => {
    try {
      const finalSrc = composedImage || composedImageUrl;
      if (!finalSrc) return { ok: false, error: 'No composed image provided' };
      if (!eventId) return { ok: false, error: 'Missing eventId' };

      const sid = sessionId || `ipad-${Date.now().toString(36)}`;

      // Convert data URL / remote URL to blob
      const finalBlob = await fetch(finalSrc).then(r => r.blob());

      // Convert individual photo data URLs to blobs (best-effort, non-fatal)
      const photoBlobs = (await Promise.allSettled(
        (photos || []).filter(Boolean).map(p => fetch(p).then(r => r.blob()))
      )).flatMap(r => r.status === 'fulfilled' ? [r.value] : []);

      // Upload to the shared Supabase Storage bucket
      const { finalUrl, photoUrls } = await uploadSessionImages({
        eventId,
        sessionId: sid,
        finalBlob,
        photoBlobs,
      });

      // Deterministic slug: eventId prefix + session fragment + timestamp
      const slug = `${String(eventId).replace(/-/g, '').slice(0, 12)}-${String(sid).replace(/-/g, '').slice(0, 8)}-${Date.now().toString(36)}`;

      await saveGalleryRecord({ slug, eventId, sessionId: sid, finalUrl, photoUrls });

      const qrUrl = `https://studiophotuna-gallery.vercel.app/gallery/${slug}`;
      return { ok: true, slug, qrUrl, finalUrl };
    } catch (err) {
      return { ok: false, error: err?.message || 'Gallery upload failed' };
    }
  },

  // ── Event data ─────────────────────────────────────────────────────────────
  saveEventData: async (data = {}, ctx) => {
    try {
      const userId = ctx?.userId ?? await getUserId();
      const { error } = await supabase
        .from('events')
        .upsert({ ...data, user_id: userId });
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message };
    }
  },
  getEventData: async (eventId = 'default', ctx) => {
    try {
      const userId = ctx?.userId ?? await getUserId();
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('id', eventId)
        .eq('user_id', userId)
        .single();
      if (error) return null;
      return data;
    } catch {
      return null;
    }
  },
  syncEvent: noop,

  // ── Template selection ─────────────────────────────────────────────────────
  getActiveTemplate: async (eventId = 'default', ctx) =>
    prefGet(`template:${eventId}`, ctx?.userId, null),
  saveTemplateSelection: async (payload = {}, ctx) => {
    return prefSet(`template:${payload?.eventId ?? 'default'}`, payload, ctx?.userId);
  },

  // ── Appearance assets ──────────────────────────────────────────────────────
  saveAppearanceLogoFromFile: async (file, eventId, userId) => {
    try {
      const uid = userId ?? await getUserId() ?? 'anon';
      const url = await uploadAppearanceAsset(file, uid, 'logo');
      return { ok: true, savedPath: url, fileUrl: url, relativeKey: `${uid}/appearance/logo` };
    } catch (err) {
      return { ok: false, error: err?.message };
    }
  },
  saveAppearanceBackgroundFromFile: async (file, eventId, userId) => {
    try {
      const uid = userId ?? await getUserId() ?? 'anon';
      if (!file.type?.startsWith('image/')) return { ok: false, error: 'Video backgrounds must be set on Windows' };
      const url = await uploadAppearanceAsset(file, uid, 'background');
      return { ok: true, savedPath: url, fileUrl: url, relativeKey: `${uid}/appearance/background` };
    } catch (err) {
      return { ok: false, error: err?.message };
    }
  },
  saveAppearanceBackgroundFromDataUrl: async () => ({ ok: false, error: 'Use URL-based assets on iPad' }),
  saveTemplateThumbnail: async () => ({ ok: false, savedPath: null }),
  deleteAppearanceAsset: async () => ({ ok: true }),
  resolveAppearanceUrl: async ({ savedPath, relativeKey } = {}) => ({
    ok: true,
    url: savedPath ?? relativeKey ?? null,
  }),

  // ── Camera ────────────────────────────────────────────────────────────────
  // capturePhoto is used both as a persistence bridge (passes dataUrl) and as
  // a hardware trigger (no args). On iPad, camera capture goes through the web
  // media APIs in PhotoScreen; this only needs to ack data-URL payloads.
  capturePhoto: async ({ dataUrl } = {}) => ({ ok: true, dataUrl: dataUrl ?? null }),
  capturesList: async () => ({ items: [] }),
  getCapturedPhotos: async () => [],
  listCameras: async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      return videoDevices.map((d, i) => ({
        id: d.deviceId || `ipad-camera-${i}`,
        label: d.label || (i === 0 ? 'Back Camera' : i === 1 ? 'Front Camera' : `Camera ${i + 1}`),
      }));
    } catch {
      return [];
    }
  },
  getCameraCapabilities: async () => ({}),

  // ── Printing (Phase 3) ─────────────────────────────────────────────────────
  printPhoto: async () => ({ ok: false, error: 'Printing coming in Phase 3' }),
  getPrinters: async () => [],
  listPrinters: async () => [],
  testPrint: async () => ({ ok: false }),
  scanDnpPrinters: async () => [],
  setDnpCutMode: noop,
  detectCardTerminal: async () => ({ found: false }),

  // ── Payments (Windows booth handles transactions; admin views on iPad) ──────
  finalizeCashPayment: async () => ({ ok: false, error: 'Payments run on Windows booth' }),
  startQrPayment: async () => ({ ok: false }),
  startPayPalPayment: async () => ({ ok: false }),
  startCardPayment: async () => ({ ok: false }),
  startGatewayPayment: async () => ({ ok: false }),
  chargeAdditionalPayment: async () => ({ ok: false }),
  recordPayment: async () => ({ ok: false }),
  cancelPayment: async () => ({ ok: false }),

  // ── App control ────────────────────────────────────────────────────────────
  restartApp: async () => { window.location.reload(); },
  checkUpdates: async () => ({ updateAvailable: false }),
  downloadUpdate: noop,
  installUpdate: noop,
  clearCache: async () => { await Preferences.clear(); return { ok: true }; },
  getStorageInfo: async () => ({ available: true }),
  cleanupStorage: async () => ({ ok: true }),
  deleteStoredPhotos: async () => ({ ok: true }),

  // ── Preview server — no local Express on iPad; use in-memory session IDs ──
  previewStartServer: async () => ({ ok: true }),
  previewCreateSession: async () => {
    const sessionId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `ipad-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    return { sessionId, token: null, previewUrl: null };
  },
  previewGetUrl: async () => null,
  // Stills/clips during capture are not streamed to a preview screen on iPad —
  // the gallery is built from the final composed image after the session.
  previewSaveStill: async () => ({ ok: true }),
  previewSaveSlotClip: async () => ({ ok: true }),
  getPreviewSlotClips: async () => [],
  buildFinalMotion: async () => ({ ok: false }),

  // Save the final composed PNG to Supabase Storage so it persists
  // Accepts both `dataUrl` and `imageData` (FrameFilterScreen uses imageData)
  saveFinalPng: async ({ dataUrl, imageData, eventId, sessionId } = {}) => {
    try {
      const src = dataUrl ?? imageData;
      if (!src || !eventId) return { ok: false, error: 'Missing dataUrl or eventId' };
      const sid = sessionId || `ipad-${Date.now().toString(36)}`;
      const blob = await fetch(src).then(r => r.blob());
      const path = `${eventId}/${sid}/final.png`;
      const { error } = await supabase.storage
        .from('studiophotuna')
        .upload(path, blob, { contentType: 'image/png', upsert: true });
      if (error) return { ok: false, error: error.message };
      const { data } = supabase.storage.from('studiophotuna').getPublicUrl(path);
      return { ok: true, fileUrl: data?.publicUrl ?? null };
    } catch (err) {
      return { ok: false, error: err?.message };
    }
  },
  savePrintCopy: async () => ({ ok: true }),

  // eventHelpers.js calls safeElectron.ipcRenderer.invoke("sync-event" / "load-events").
  // Without this stub the missing property throws TypeError (caught silently but noisy).
  // Events on iPad persist via saveEventData / Supabase; these channels are no-ops here.
  ipcRenderer: {
    invoke: async (channel, ...args) => capacitorShim.invoke(channel, ...args),
  },

  // ── Event subscriptions (no IPC on iPad — return unsubscribe fn) ───────────
  onUpdaterStatus: () => noopUnsub,
  onEventsUpdated: () => noopUnsub,
  offEventsUpdated: noop,
  onPrintProgress: () => noopUnsub,
  onPaymentConfirmed: () => noopUnsub,
  onPaymentFailed: () => noopUnsub,
  on: () => noopUnsub,
  off: noop,
  removeListener: noop,
  triggerShutter: () => {},

  // ── Misc ───────────────────────────────────────────────────────────────────
  previewSuffix: () => `?_t=${Date.now()}`,

  // ── General invoke router ──────────────────────────────────────────────────
  // Handles the channels called via window.electron.invoke(channel, ...args)
  invoke: async (channel, ...args) => {
    switch (channel) {

      // Identity
      case 'secureStore:getIdentity': {
        const userId = await getUserId();
        return { userId };
      }

      // Settings via invoke (some screens use the invoke form)
      case 'store:getSettings': {
        const s = await prefGet('settings', args[0]?.userId, {});
        return stripWindowsCameraId(s);
      }
      case 'store:setSettings': {
        const [settings, ctx] = args;
        return prefSet('settings', settings, ctx?.userId);
      }

      // License — query Supabase directly (mirrors the Electron main-process IPC handler).
      // RLS policy "Users can view their own license" allows auth.uid() = user_id reads.
      case 'license:read': {
        const userId = args[0];
        if (!userId) return null;
        try {
          const timeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('license:read timed out')), 9000)
          );
          const { data, error } = await Promise.race([
            supabase.from('licenses').select('*').eq('user_id', userId).maybeSingle(),
            timeout,
          ]);
          if (error) {
            console.warn('[capacitorShim license:read]', error.message);
            return null;
          }
          // null row = confirmed free (no license record). Synthetic flag lets
          // LicenseContext evict a stale paid-plan cache instead of using it offline.
          return data ?? { plan: 'free', state: 'active', _synthetic: true };
        } catch (e) {
          console.warn('[capacitorShim license:read] failed:', e.message);
          return null;
        }
      }
      case 'license:cache-read': {
        const userId = args[0];
        return prefGet(`licenseCache:${userId}`, null, null);
      }
      case 'license:cache-write': {
        const [userId, data] = args;
        return prefSet(`licenseCache:${userId}`, data, null);
      }

      // App updates — iPad uses App Store
      case 'app:check-updates':
        return { updateAvailable: false };
      case 'app:download-update':
      case 'app:install-update':
      case 'app:restart':
      case 'app:clear-cache':
        return { ok: true };

      // Startup / storage — no-ops on iPad
      case 'startup:set':
      case 'storage:select':
      case 'storage:cleanup':
      case 'storage:delete-stored-photos':
      case 'log:export':
      case 'event:cleanupStorage':
        return { ok: true };

      // Storage info
      case 'storage:info':
        return { available: true };

      // Auth OAuth popup — open in Safari on iPad; Supabase handles the redirect
      case 'auth:oauth-popup': {
        const url = args[0];
        if (url) window.open(url, '_blank');
        return { ok: true };
      }

      // Meta flags via invoke form
      case 'store:getMetaFlag': {
        const { key } = args[0] ?? {};
        return prefGet(`meta:${key}`, null, null);
      }
      case 'store:setMetaFlag': {
        const { key, value } = args[0] ?? {};
        return prefSet(`meta:${key}`, value, null);
      }

      // Capabilities check — return empty on iPad
      case 'app:getCapabilities':
        return {};

      // Event file-sync (Electron-only; events persist via Supabase on iPad)
      case 'sync-event':
        return { success: true };
      case 'load-events':
        return { success: true, events: [] };

      default:
        console.warn('[capacitorShim] Unhandled invoke channel:', channel, args);
        return null;
    }
  },
};
