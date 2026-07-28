import { createClient } from "@supabase/supabase-js";

/**
 * Single shared Supabase client (one GoTrue auth instance per app).
 *
 * Two things keep auth quiet and correct in this desktop (single-window) build:
 *
 * 1) A `window`-cached singleton, so the client is only ever created once no
 *    matter how many times this module is imported (HMR, duplicate chunks).
 *
 * 2) A small in-process `lock` that REPLACES supabase-js's default
 *    `navigatorLock` (the browser Web Locks API). The default lock is what
 *    logs:
 *        "Lock 'lock:sb-<ref>-auth-token' was released because another request stole it"
 *    whenever two auth calls (getSession on startup, onAuthStateChange, the
 *    licensing API, etc.) run at the same moment. Web Locks only matter for
 *    coordinating refreshes across multiple browser tabs — which a single
 *    Electron window doesn't have. Serializing auth calls through a simple
 *    promise chain instead removes the message while still preventing
 *    concurrent token refreshes from racing.
 */

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;

const GLOBAL_KEY = "__studioPhotunaSupabase__";

// Cache on `window` so the client is a true singleton across the renderer.
// (We avoid `globalThis`/`self` because some CRA ESLint configs flag them via
// no-undef / no-restricted-globals.) In this Electron renderer `window` always
// exists; the `|| {}` keeps it safe in any non-browser context.
const globalScope = typeof window !== "undefined" ? window : {};

/**
 * In-process replacement for supabase-js's navigatorLock.
 * Serializes auth operations through a single promise chain — no
 * navigator.locks, so no "lock was ... stolen" noise in a single-window app.
 *
 * Signature matches @supabase/auth-js: (name, acquireTimeout, fn) => Promise.
 */
let _authLockChain = Promise.resolve();
function inProcessLock(_name, _acquireTimeout, fn) {
  const run = _authLockChain.then(() => fn());
  // Keep the chain alive whether fn resolves or rejects.
  _authLockChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function createSupabaseClient() {
  // NOTE: storageKey is intentionally left at the supabase-js default
  // (sb-<project-ref>-auth-token) so existing logged-in users keep their
  // session — no forced re-login on update.
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Needed so the Google OAuth redirect back into the app is picked up.
      detectSessionInUrl: true,
      // Replace the Web Locks API coordinator (see file header).
      lock: inProcessLock,
    },
  });
}

export const supabase =
  globalScope[GLOBAL_KEY] ||
  (globalScope[GLOBAL_KEY] = createSupabaseClient());

export default supabase;