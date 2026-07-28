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

// Pull booth settings from Supabase → electron-store (call on app launch)
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
  if (data.settings) await store.setSettings?.(data.settings, ctx);
  if (data.appearance) await store.setAppearance?.(data.appearance, ctx);
  if (Array.isArray(data.events) && data.events.length > 0) {
    // Preserve sessions recorded locally — Supabase never stores booth-run session records.
    // Only overwrite local when Supabase has events; if Supabase is empty, keep local data
    // (handles the case where the app was closed before the 2-second push debounce fired).
    const localEvents = (await store.getEvents?.(ctx)) ?? [];
    const merged = data.events.map((e) => {
      const local = localEvents.find((le) => String(le.id) === String(e.id));
      return local?.sessions?.length ? { ...e, sessions: local.sessions } : e;
    });
    // Include local events not yet synced to Supabase (created after last successful push)
    const unsynced = localEvents.filter(le => !data.events.find(e => String(e.id) === String(le.id)));
    await store.setEvents?.([...merged, ...unsynced], ctx);
  }
  // For arrays: only overwrite local if Supabase has data.
  // An empty Supabase array means the push hadn't synced yet — don't clobber local.
  if (Array.isArray(data.templates) && data.templates.length > 0) await store.setTemplates?.(data.templates, ctx);
  if (Array.isArray(data.frames) && data.frames.length > 0) await store.setFrames?.(data.frames, ctx);
  if (Array.isArray(data.palettes) && data.palettes.length > 0) await store.setPalettes?.(data.palettes, ctx);

  console.log('[settingsSync] pulled from Supabase');
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
