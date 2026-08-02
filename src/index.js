import "./disableWebLocks";
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

import AppRouter from "./AppRouter";
import { AuthProvider } from "./context/AuthContext";
import { LicenseProvider } from "./context/LicenseContext";
import { capacitorShim } from './platform/capacitorShim';

// Attach verifier globally for LicenseContext
import * as licenseVerifier from './lib/licenseVerifier';
window.licenseVerifier = licenseVerifier;

// public/index.html installs a mutable placeholder `{}` on window.electron
// before any bundle runs (only in non-Electron contexts). Object.assign
// populates that same object so module-level code that captured
// `const native = window.electron` gains all shim methods — no re-render needed.
// On Electron, window.electron is a contextBridge proxy without _capacitorPlaceholder,
// so this block is skipped and the real preload API is used unchanged.
if (typeof window !== 'undefined' && window.electron?._capacitorPlaceholder) {
  Object.assign(window.electron, capacitorShim);
  delete window.electron._capacitorPlaceholder;
}


ReactDOM.createRoot(document.getElementById("root")).render(
  <AuthProvider>
    <LicenseProvider>
      <AppRouter />
    </LicenseProvider>
  </AuthProvider>
);

