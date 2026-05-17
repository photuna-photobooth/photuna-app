
// src/AppRouter.jsx (optional wrapper)
import React from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import App from "./App";

export default function AppRouter() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
