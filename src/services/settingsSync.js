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
  if (Array.isArray(data.events)) await store.setEvents?.(data.events, ctx);
  if (Array.isArray(data.templates)) await store.setTemplates?.(data.templates, ctx);
  if (Array.isArray(data.frames)) await store.setFrames?.(data.frames, ctx);
  if (Array.isArray(data.palettes)) await store.setPalettes?.(data.palettes, ctx);

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
