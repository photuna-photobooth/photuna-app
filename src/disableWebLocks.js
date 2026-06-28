// src/disableWebLocks.js
// ----------------------------------------------------------------------------
// IMPORT THIS AS THE VERY FIRST LINE OF src/index.js:
//
//     import "./disableWebLocks";          // <-- must be line 1, before App
//     import React from "react";
//     ...
//
// Why:
//   supabase-js uses the browser Web Locks API (navigator.locks) to coordinate
//   token refresh across multiple browser tabs. A single-window Electron app
//   has no other tabs, but concurrent auth calls still make it log:
//       "Lock 'lock:sb-<ref>-auth-token' was released because another request stole it"
//
//   Removing navigator.locks makes supabase-js automatically fall back to its
//   internal in-memory lock (processLock), which is correct for one window and
//   never prints that message. Because this runs before any module creates a
//   Supabase client, it applies to EVERY client in the renderer — including a
//   second client created outside src/services/supabase.js.
//
//   Safe for this app: nothing else here relies on navigator.locks (camera uses
//   navigator.mediaDevices, which is untouched).
// ----------------------------------------------------------------------------

(function disableWebLocks() {
  try {
    if (typeof navigator !== "undefined" && "locks" in navigator) {
      Object.defineProperty(navigator, "locks", {
        configurable: true,
        get: function () {
          return undefined;
        },
      });
    }
  } catch (err) {
    // If the runtime won't let us redefine it, the per-client in-process lock
    // in src/services/supabase.js still covers the main client.
  }
})();

export {};
