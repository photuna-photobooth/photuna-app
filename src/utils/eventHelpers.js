// src/utils/eventHelpers.js
// Unified helper for safely managing event persistence between React and Electron

/**
 * Safe Electron reference with graceful fallback.
 * Ensures web fallback when running in browser preview mode.
 */
const safeElectron = window.electron || {
  invoke: async () => {},
  ipcRenderer: { invoke: async () => {} },
  saveEventData: async () => {},
  getEventData: async () => null,
};

/* ------------------------------------------------------------ */
/* ✅ 1. Save Event Data (Lightweight Cache Layer)                */
/* ------------------------------------------------------------ */
export async function saveEventCache(eventData) {
  try {
    await safeElectron.saveEventData(eventData);
    localStorage.setItem("lastEventCache", JSON.stringify(eventData));
    return true;
  } catch (err) {
    console.error("Failed to save event cache:", err);
    return false;
  }
}

/* ------------------------------------------------------------ */
/* ✅ 2. Get Event Data (Restores UI state)                       */
/* ------------------------------------------------------------ */
export async function loadEventCache() {
  try {
    const data = await safeElectron.getEventData();
    if (data) return data;

    const local = localStorage.getItem("lastEventCache");
    return local ? JSON.parse(local) : null;
  } catch (err) {
    console.error("Failed to load event cache:", err);
    return null;
  }
}

/* ------------------------------------------------------------ */
/* ✅ 3. Sync Event with File (Persistent Layer)                   */
/* ------------------------------------------------------------ */
export async function syncEventToFile(action) {
  try {
    const response = await safeElectron.ipcRenderer.invoke("sync-event", action);
    if (!response?.success) throw new Error("Sync failed");
    return true;
  } catch (err) {
    console.error("Failed to sync event file:", err);
    return false;
  }
}

/* ------------------------------------------------------------ */
/* ✅ 4. Unified Save Function (Cache + File + Retry)              */
/* ------------------------------------------------------------ */
export async function saveEventWithRetry(eventData, retries = 3) {
  try {
    // Step 1: Cache immediately
    await saveEventCache(eventData);

    // Step 2: File sync with retry logic
    for (let i = 0; i < retries; i++) {
      const ok = await syncEventToFile({ type: "update", event: eventData });
      if (ok) return true;
      console.warn(`Retrying sync (${i + 1}/${retries})...`);
      await new Promise((r) => setTimeout(r, 1000));
    }

    console.warn("Event sync failed after retries; cached locally.");
    return false;
  } catch (err) {
    console.error("Error in saveEventWithRetry:", err);
    return false;
  }
}

/* ------------------------------------------------------------ */
/* ✅ 5. Delete Event (Safe Removal from Disk + Cache)             */
/* ------------------------------------------------------------ */
export async function deleteEventSafe(eventId) {
  try {
    await safeElectron.ipcRenderer.invoke("sync-event", {
      type: "delete",
      eventId,
    });

    const cached = await loadEventCache();
    if (cached && cached.id === eventId) {
      localStorage.removeItem("lastEventCache");
    }

    return true;
  } catch (err) {
    console.error("Failed to delete event:", err);
    return false;
  }
}

/* ------------------------------------------------------------ */
/* ✅ 6. Utility: Get All Events from Electron File                */
/* ------------------------------------------------------------ */
export async function loadAllEvents() {
  try {
    const data = await safeElectron.ipcRenderer.invoke("load-events");
    if (Array.isArray(data)) return data;
    return [];
  } catch (err) {
    console.error("Failed to load all events:", err);
    return [];
  }
}

/* ------------------------------------------------------------ */
/* ✅ 7. Optional Helper: Generate a New Event Skeleton            */
/* ------------------------------------------------------------ */
export function createNewEvent(name = "New Event") {
  return {
    id: Date.now().toString(),
    name,
    mode: "rental",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pricePerCopy: 200,
    maxShots: 3,
    countdownSeconds: 3,
    cameraConfig: {
      source: "webcam",
      resolution: "1920x1080",
      flipHorizontal: false,
    },
  };
}
