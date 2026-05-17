import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

import AppRouter from "./AppRouter";
import { AuthProvider } from "./context/AuthContext";
import { LicenseProvider } from "./context/LicenseContext";

// Attach verifier globally for LicenseContext
import * as licenseVerifier from './lib/licenseVerifier';
window.licenseVerifier = licenseVerifier;


ReactDOM.createRoot(document.getElementById("root")).render(
  <AuthProvider>
    <LicenseProvider>
      <AppRouter />
    </LicenseProvider>
  </AuthProvider>
);


