import "./disableWebLocks";
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

import AppRouter from "./AppRouter";
import { AuthProvider } from "./context/AuthContext";
import { LicenseProvider } from "./context/LicenseContext";

// Attach verifier globally for LicenseContext
import * as licenseVerifier from './lib/licenseVerifier';
window.licenseVerifier = licenseVerifier;

// In any non-Electron context (PWA on iPad Safari, Capacitor, plain browser),
// polyfill window.electron with the bridge shim so all existing screens work
// without modification. Electron's preload sets window.electron before this
// module runs, so the check is safe.
if (typeof window !== 'undefined' && !window.electron && !window.api) {
  import('./platform/capacitorShim').then(({ capacitorShim }) => {
    window.electron = capacitorShim;
    window.api = capacitorShim;
  });
}


ReactDOM.createRoot(document.getElementById("root")).render(
  <AuthProvider>
    <LicenseProvider>
      <AppRouter />
    </LicenseProvider>
  </AuthProvider>
);

