// src/utils/syncManager.js
import { get, set } from 'idb-keyval';

const QUEUE_KEY = 'pendingEventSyncs';

// --- Add an action to the sync queue ---
export const queueSyncAction = async (action) => {
  const queue = (await get(QUEUE_KEY)) || [];
  queue.push({ ...action, timestamp: Date.now() });
  await set(QUEUE_KEY, queue);
};

// --- Retrieve all queued actions ---
export const getPendingSyncs = async () => {
  return (await get(QUEUE_KEY)) || [];
};

// --- Clear queue ---
export const clearSyncQueue = async () => {
  await set(QUEUE_KEY, []);
};

// --- Attempt sync when online ---
export const trySyncEvents = async (syncFn) => {
  const queue = await getPendingSyncs();
  if (queue.length === 0) return;

  console.log(`🔄 Syncing ${queue.length} pending actions...`);

  for (const action of queue) {
    try {
      await syncFn(action); // Perform API or IPC sync
    } catch (err) {
      console.warn('❌ Sync failed for action:', action, err);
      return; // Stop syncing if a request fails
    }
  }

  await clearSyncQueue();
  console.log('✅ All pending actions synced successfully.');
};
