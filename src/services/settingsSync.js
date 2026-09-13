// src/services/settingsSync.js
//
// Syncs booth setups (events, templates, frames, palettes, settings, appearance)
// between this device and Supabase. The procedure and merge rules live in
// settingsSyncCore.js and syncMerge.js; this file connects them to the real store,
// localStorage and Supabase, and tells other devices when something changed.
//
// Other devices are told with a tiny broadcast carrying no data — a frames list
// can exceed a megabyte — and fetch and merge the row themselves.

import { supabase } from './supabase.js';
import { createSettingsSyncCore } from './settingsSyncCore.js';

const PUSH_DEBOUNCE_MS = 2000;
const REMOTE_SIGNAL_DELAY_MS = 750;
const META_KEY_PREFIX = 'photuna.syncMeta.v1.';

// Identifies this app instance, so it ignores its own "changed" broadcasts.
const deviceId = (typeof crypto !== 'undefined' && crypto.randomUUID)
  ? crypto.randomUUID()
  : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

function getBridge() {
  if (typeof window === 'undefined') return null;
  return window.electron || window.api || null;
}

const metaStore = {
  load(userId) {
    try {
      const raw = localStorage.getItem(META_KEY_PREFIX + userId);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  save(userId, meta) {
    try {
      localStorage.setItem(META_KEY_PREFIX + userId, JSON.stringify(meta));
    } catch (err) {
      console.warn('[settingsSync] could not save sync metadata:', err?.message);
    }
  },
};

const remote = {
  async fetch(userId) {
    const { data, error } = await supabase
      .from('booth_settings')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    return { row: data, error };
  },
  // Writes only if the row is still the version this device merged against.
  async update(userId, expectedUpdatedAt, values) {
    const { data, error } = await supabase
      .from('booth_settings')
      .update(values)
      .eq('user_id', userId)
      .eq('updated_at', expectedUpdatedAt)
      .select('updated_at');
    return { updated: Array.isArray(data) && data.length > 0, error };
  },
  async insert(userId, values) {
    const { error } = await supabase
      .from('booth_settings')
      .insert({ user_id: userId, ...values });
    return { inserted: !error, conflict: error?.code === '23505', error: error?.code === '23505' ? null : error };
  },
};

const storeProxy = new Proxy({}, {
  get(_target, name) {
    const bridge = getBridge();
    const fn = bridge?.[name];
    return typeof fn === 'function' ? fn.bind(bridge) : undefined;
  },
});

const core = createSettingsSyncCore({
  store: storeProxy,
  remote,
  metaStore,
  log: (message) => console.log(`[settingsSync] ${message}`),
});

let pendingTimer = null;
let channel = null;
const listeners = new Set();

function notify(changed) {
  if (!changed?.length) return;
  for (const listener of listeners) {
    try {
      listener(changed);
    } catch (err) {
      console.warn('[settingsSync] listener failed:', err?.message);
    }
  }
}

async function runSync(reason) {
  const result = await core.syncNow();
  if (!result.ok) {
    console.warn(`[settingsSync] ${reason} sync failed:`, result.error || 'unknown');
  } else if (result.pushed) {
    signalOtherDevices();
  }
  notify(result.changed);
  return result;
}

function signalOtherDevices() {
  if (!channel) return;
  channel
    .send({ type: 'broadcast', event: 'settings-changed', payload: { deviceId, at: Date.now() } })
    .catch?.(() => {});
}

function subscribe(userId) {
  if (channel) {
    try { channel.unsubscribe(); } catch {}
    channel = null;
  }
  channel = supabase.channel(`booth-settings:${userId}`, { config: { broadcast: { self: true } } });
  channel
    .on('broadcast', { event: 'settings-changed' }, ({ payload }) => {
      if (payload?.deviceId === deviceId) return;
      clearTimeout(pendingTimer);
      pendingTimer = setTimeout(() => runSync('remote change'), REMOTE_SIGNAL_DELAY_MS);
    })
    .subscribe();
}

export function initSettingsSync(userId) {
  const changedUser = core.userId !== (userId ? String(userId) : null);
  core.init(userId);
  if (userId && changedUser) subscribe(String(userId));
}

// Called at startup. Returns the merged lists, which the dashboard uses as a
// fallback when this device has nothing saved yet.
export async function pullSettings() {
  if (!core.userId) return null;
  const result = await runSync('startup');
  return result.items || null;
}

// Called after local saves. The argument is ignored: the store is read directly,
// so a partial patch can never overwrite the other lists.
export function pushSettings(_patch = {}) {
  if (!core.userId) return;
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => runSync('save'), PUSH_DEBOUNCE_MS);
}

export const pushSettingsSlice = (key, value) => pushSettings({ [key]: value });

// Immediate sync — used after deletions so they reach the cloud before a restart.
export async function pushSettingsNow(_patch = {}) {
  if (!core.userId) return;
  clearTimeout(pendingTimer);
  pendingTimer = null;
  await runSync('immediate');
}

// Call when the operator deletes an event, template, frame or palette, before
// persisting the shorter list. Without it the item would come back from other
// devices, which still have it.
export function recordSettingsDeletion(slice, id) {
  core.recordDeletion(slice, id);
}

// Called with the list names ("events", "templates", …) that changed on this
// device because of another device. Returns an unsubscribe function.
export function onSettingsSynced(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
