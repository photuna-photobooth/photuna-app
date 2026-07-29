import { supabase } from './supabase.js';

let _userId = null;
let _pendingTimer = null;

export function initSettingsSync(userId) {
  _userId = userId;
}

function getBridge() {
  if (typeof window === 'undefined') return null;
  return window.electron || window.api || null;
}

// Pull booth settings from Supabase → electron-store (call on app launch).
// Merge strategy:
//   - Events: local always wins (desktop is the authority; Ctrl+R never loses edits).
//     New events from Supabase (added via web app) are appended to local.
//   - Templates / Frames / Palettes: Supabase wins when non-empty (web app is the authority).
//   - Settings / Appearance: Supabase wins when non-empty; the nonEmpty guard
//     blocks an empty {} in Supabase from wiping valid local state.
//   - After merging, push local state back so Supabase stays in sync.
export async function pullSettings() {
  if (!_userId) return null;

  const { data, error } = await supabase
    .from('booth_settings')
    .select('*')
    .eq('user_id', _userId)
    .maybeSingle();

  if (error) {
    console.warn('[settingsSync] pull failed:', error.message);
    return null;
  }

  if (!data) return null;

  const store = getBridge();
  if (!store) return data;

  const ctx = { userId: _userId };
  const nonEmpty = (v) => v && typeof v === 'object' && Object.keys(v).length > 0;
  const hasItems = (v) => Array.isArray(v) && v.length > 0;

  // Read all local data in parallel first — local is the source of truth
  const [localSettings, localAppearance, localEvents, localTemplates, localFrames, localPalettes] =
    await Promise.all([
      store.getSettings?.(ctx),
      store.getAppearance?.(ctx),
      store.getEvents?.(ctx),
      store.getTemplates?.(ctx),
      store.getFrames?.(ctx),
      store.getPalettes?.(ctx),
    ]);

  // Settings / Appearance: Supabase wins when non-empty.
  // The nonEmpty guard blocks empty {} from wiping local (Supabase hadn't been
  // seeded yet), but real data from the web app is always picked up.
  if (nonEmpty(data.settings)) await store.setSettings?.(data.settings, ctx);
  if (nonEmpty(data.appearance)) await store.setAppearance?.(data.appearance, ctx);

  // Events: local always wins — the desktop is the authority for booth events.
  // Edits saved locally are preserved through a Ctrl+R even if the 2-second
  // push debounce hadn't fired yet. New events from Supabase (created on the
  // web app) are added to local, but existing local events are never overwritten.
  const localArr = Array.isArray(localEvents) ? localEvents : [];
  if (hasItems(data.events)) {
    const localById = new Map(localArr.map(le => [String(le.id), le]));
    const onlyInSupabase = data.events.filter(e => !localById.has(String(e.id)));
    if (onlyInSupabase.length > 0) {
      await store.setEvents?.([...localArr, ...onlyInSupabase], ctx);
    }
  }

  // Templates / Frames / Palettes: Supabase wins when non-empty.
  // These are managed from app.studiophotuna.com; updates made there
  // should always sync down to the desktop.
  if (hasItems(data.templates)) await store.setTemplates?.(data.templates, ctx);
  if (hasItems(data.frames)) await store.setFrames?.(data.frames, ctx);
  if (hasItems(data.palettes)) await store.setPalettes?.(data.palettes, ctx);

  // Upload local → Supabase so the cloud stays in sync with whatever is local.
  // Uses the 2-second debounce, so it's a no-op if a push is already queued.
  pushSettings({});

  console.log('[settingsSync] pulled from Supabase (local-first)');
  return data;
}

// Push electron-store → Supabase (debounced 2 s to batch rapid saves)
export function pushSettings(patch = {}) {
  if (!_userId) return;

  if (_pendingTimer) clearTimeout(_pendingTimer);

  _pendingTimer = setTimeout(async () => {
    const store = getBridge();
    const ctx = { userId: _userId };
    const payload = {
      user_id: _userId,
      settings: patch.settings ?? await store?.getSettings?.(ctx) ?? {},
      appearance: patch.appearance ?? await store?.getAppearance?.(ctx) ?? {},
      events: patch.events ?? await store?.getEvents?.(ctx) ?? [],
      templates: patch.templates ?? await store?.getTemplates?.(ctx) ?? [],
      frames: patch.frames ?? await store?.getFrames?.(ctx) ?? [],
      palettes: patch.palettes ?? await store?.getPalettes?.(ctx) ?? [],
      synced_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('booth_settings')
      .upsert(payload, { onConflict: 'user_id' });

    if (error) {
      console.warn('[settingsSync] push failed:', error.message);
    } else {
      console.log('[settingsSync] pushed to Supabase');
    }
  }, 2000);
}

// Call when a specific slice changes (e.g. after store.setSettings)
export const pushSettingsSlice = (key, value) => pushSettings({ [key]: value });
