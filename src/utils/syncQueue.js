// src/utils/syncQueue.js
// Persistent offline-safe sync queue for events

import { syncEventToFile } from "./eventHelpers";

const QUEUE_KEY = "pendingEventSyncs";

/* ------------------------------------------------------------ */
/* ✅ 1. Load Queue (from localStorage)                           */
/* ------------------------------------------------------------ */
function loadQueue() {
  try {
    const data = localStorage.getItem(QUEUE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (err) {
    console.error("Failed to load sync queue:", err);
    return [];
  }
}

/* ------------------------------------------------------------ */
/* ✅ 2. Save Queue                                               */
/* ------------------------------------------------------------ */
function saveQueue(queue) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch (err) {
    console.error("Failed to save sync queue:", err);
  }
}

/* ------------------------------------------------------------ */
/* ✅ 3. Add Action to Queue                                     */
/* ------------------------------------------------------------ */
export function queueSyncAction(action) {
  try {
    const queue = loadQueue();
    queue.push({ ...action, queuedAt: Date.now() });
    saveQueue(queue);
    console.log("📥 Queued sync action:", action);
  } catch (err) {
    console.error("Failed to queue sync action:", err);
  }
}

/* ------------------------------------------------------------ */
/* ✅ 4. Try Sync All Pending Actions                            */
/* ------------------------------------------------------------ */
export async function trySyncEvents(apiSyncFn) {
  const queue = loadQueue();
  if (queue.length === 0) return;

  console.log(`🔄 Attempting to sync ${queue.length} pending actions...`);

  const remaining = [];

  for (const action of queue) {
    try {
      const ok =
        typeof apiSyncFn === "function"
          ? await apiSyncFn(action)
          : await syncEventToFile(action);
      if (!ok) throw new Error("Sync failed");
      console.log("✅ Synced:", action.type);
    } catch (err) {
      console.warn("❌ Sync failed, requeueing:", err);
      remaining.push(action);
    }
  }

  saveQueue(remaining);
  if (remaining.length === 0) console.log("🎉 All queued actions synced!");
}

/* ------------------------------------------------------------ */
/* ✅ 5. Listen for Online / App Ready Events                     */
/* ------------------------------------------------------------ */
export function initializeAutoSync(apiSyncFn) {
  window.addEventListener("online", () => trySyncEvents(apiSyncFn));

  // Also attempt on app start
  setTimeout(() => trySyncEvents(apiSyncFn), 2000);

  console.log("🔔 Auto-sync initialized (listening for online state)");
}
