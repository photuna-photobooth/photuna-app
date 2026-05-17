
// main/preview-server.js
const express = require('express');
const os = require('os');
const path = require('path');
const { app: electronApp } = require('electron');
const { createPreviewRouter } = require('./previewRouter');

const PORT = 3977;

function getServerAddress() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        return `http://${net.address}:${PORT}`;
      }
    }
  }
  return `http://localhost:${PORT}`;
}

let server = null;
function startPreviewServer() {
  return new Promise((resolve) => {
    const app = express();
    // Hardening: small surface (no auth needed on preview), but keep default headers minimal
    const dataRoot = path.join(electronApp.getPath('userData'), 'users', CURRENT_USER_ID, 'preview', 'sessions');
    const clientDir = path.join(process.resourcesPath, 'preview-client'); // copy SPA build here at pack time
    app.use(createPreviewRouter({ dataRoot, clientDir }));
    server = app.listen(PORT, () => resolve(getServerAddress()));
  });
}

module.exports = { startPreviewServer, getServerAddress };
