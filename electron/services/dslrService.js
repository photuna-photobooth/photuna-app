// electron/services/dslrService.js
// DSLR Service - Scaffold for USB/DSLR Integration

const { exec } = require('child_process');
const { ipcMain } = require('electron');

let isConnected = false;
let currentConfig = {
  port: '',
  delay: 200, // ms
};

/**
 * Initialize DSLR Service
 * Detects camera and stores basic config.
 */
function initDSLR(config = {}) {
  currentConfig = { ...currentConfig, ...config };

  console.log('[DSLR Service] Initializing...');
  // For now we just simulate detection.
  // Later we can run gphoto2 --auto-detect or vendor SDK commands.

  // Simulated detection
  setTimeout(() => {
    isConnected = true;
    console.log('[DSLR Service] DSLR connected (simulated)');
  }, 1000);
}

/**
 * Check if DSLR is connected
 */
function isDSLRConnected() {
  return isConnected;
}

/**
 * Capture a photo
 * For now we simulate capture with a delay.
 */
async function capturePhoto() {
  if (!isConnected) {
    throw new Error('No DSLR detected');
  }

  console.log(`[DSLR Service] Capturing photo with ${currentConfig.delay}ms delay...`);
  await new Promise((resolve) => setTimeout(resolve, currentConfig.delay));

  // Simulated photo path
  const photoPath = `/tmp/photo_${Date.now()}.jpg`;
  console.log(`[DSLR Service] Photo captured: ${photoPath}`);
  return photoPath;
}

/**
 * Release resources
 */
function shutdown() {
  console.log('[DSLR Service] Shutting down DSLR connection...');
  isConnected = false;
}

/* ---------------- IPC LISTENERS ---------------- */
function registerIpcHandlers() {
  ipcMain.handle('dslr:init', async (event, config) => {
    initDSLR(config);
    return { success: true, connected: isConnected };
  });

  ipcMain.handle('dslr:capture', async () => {
    try {
      const result = await capturePhoto();
      return { success: true, path: result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('dslr:status', () => {
    return { connected: isConnected };
  });

  ipcMain.handle('dslr:shutdown', () => {
    shutdown();
    return { success: true };
  });
}

module.exports = {
  initDSLR,
  isDSLRConnected,
  capturePhoto,
  shutdown,
  registerIpcHandlers,
};
