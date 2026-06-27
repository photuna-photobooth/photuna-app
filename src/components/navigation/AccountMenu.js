
// src/components/navigation/AccountMenu.jsx
import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useLicense } from "../../context/LicenseContext";
import * as licensingApi from "../../services/licensingApi";

const ACCENT = "#635bff"; // Stripe indigo
const surface = "bg-white border border-gray-200 rounded-lg shadow-lg";

export default function AccountMenu({
  onManageAccount,
  onSetting,  // () => void
  onLogout,          // () => Promise<void> | void
}) {
  const { user, accessToken } = useAuth();
  const { gating, refreshLicense } = useLicense();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const ref = useRef(null);

  const initials =
    (user?.name || user?.email || "User")
      .split("@")[0]
      .split(" ")
      .map((s) => s[0]?.toUpperCase())
      .slice(0, 2)
      .join("") || "U";

  const licensed = !!gating?.allow;
  const planLabel = gating?.plan || "none";

  useEffect(() => {
    const onDocClick = (e) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const run = async (fn, okMsg = "Done.") => {
    setMsg("");
    try {
      await fn();
      setMsg(okMsg);
    } catch (err) {
      const text = err?.message || String(err);
      setMsg(`Error: ${text}`);
    }
  };

  const openBillingPortal = async () => {
    const { url } = await licensingApi.customerPortal();
    await window.system.openExternal(url);
  };

  const handleRefreshLicense = async () => {
    setRefreshing(true);
    setMsg("");
    try {
      await refreshLicense({ hard: true });
      setMsg("License refreshed.");
    } catch (err) {
      setMsg(`Error: ${err?.message || String(err)}`);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      {/* Trigger (avatar chip) */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-2 py-1"
        title="Account"
      >
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-md text-white text-sm">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-4 w-4"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path d="M19 9L14 14.1599C13.7429 14.4323 13.4329 14.6493 13.089 14.7976C12.7451 14.9459 12.3745 15.0225 12 15.0225C11.6255 15.0225 11.2549 14.9459 10.9109 14.7976C10.567 14.6493 10.2571 14.4323 10 14.1599L5 9" stroke="#364153" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path> </g></svg>
        </span>
        <div className="text-sm font-semibold">Studio Photuna</div>
      </button>

      {/* Popover */}
      {open && (
        <div className={`${surface} absolute left-0 mt-2 w-80 z-50`}>
          {/* Header */}
          <div className="p-3 border-b border-gray-200 flex items-center gap-3">
            <div
              className="flex items-center justify-center w-10 h-10 rounded-md text-white"
              style={{ background: ACCENT }}
            >
              {initials}
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium text-gray-900">
                {user?.name || "Account"}
              </div>
              <div className="text-xs text-gray-600">{user?.email || "Signed in"}</div>
              <div className="text-xs text-gray-600">
                Plan: <span className="font-medium">{planLabel}</span>{" "}
                {licensed ? "(Licensed)" : "(Restricted)"}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="p-3 space-y-2">
            <button
              onClick={() => {
                setOpen(false);
                onManageAccount?.();
              }}
              className="w-full bg-gray-900 text-white py-2 rounded-md text-sm hover:opacity-90"
            >
              Manage Account
            </button>
            <button
              onClick={() => {
                setOpen(false);
                onSetting?.();
              }}
              className="w-full bg-gray-900 text-white py-2 rounded-md text-sm hover:opacity-90"
            >
              Settings
            </button>
            <button
              onClick={handleRefreshLicense}
              disabled={refreshing}
              className="w-full bg-white border border-indigo-200 text-indigo-700 py-2 rounded-md text-sm hover:bg-indigo-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {refreshing ? "Refreshing…" : "Refresh License"}
            </button>
            <button
              onClick={onLogout}
              className="w-full bg-white border border-gray-200 text-black py-2 rounded-md text-sm hover:opacity-90"
            >
              Exit account
            </button>

            {/* Feedback */}
            {msg && (
              <div className="text-xs text-gray-600 border border-gray-200 rounded-md p-2 bg-gray-50">
                {msg}
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}
