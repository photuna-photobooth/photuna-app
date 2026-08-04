import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { normalizeToFileUrl } from "../utils/mediaUrl";
import { loadGoogleFont } from "../utils/fontLoader";
import { DEFAULT_APPEARANCE } from "../utils/appearance";
import { useLayout } from "../utils/useLayout";

const CONSENT_VERSION = "1.0";

export default function ConsentScreen({ event = null, eventConfig = {}, onAccept, onDecline }) {
  const { isPortrait } = useLayout();
  const [accepted, setAccepted] = useState(false);

  const cfg = event?.config ?? eventConfig ?? {};
  const appearance = event?.appearance ?? {};

  const rawLogo = appearance?.logoPath ?? "";
  const logo = normalizeToFileUrl(rawLogo);
  const centerLogo = normalizeToFileUrl(eventConfig?.centerLogo || "");
  const selectedLogo = logo || centerLogo || "";

  const eventName = appearance?.boothName ?? cfg?.eventName ?? "Studio Photuna";

  const bgColor = appearance?.bgColor ?? "#000000";
  const headerFont = appearance?.headerFont ?? DEFAULT_APPEARANCE.headerFont ?? "Ramillas";
  const generalFont = appearance?.generalFont ?? DEFAULT_APPEARANCE.generalFont ?? "Interphases";
  const buttonFont = appearance?.buttonFont || generalFont;

  const headerFontColor = appearance?.headerFontColor ?? "#ffffff";
  const generalFontColor = appearance?.generalFontColor ?? "#e5e5e5";
  const buttonBgColor = appearance?.buttonBgColor || "#ec4899";
  const buttonHoverColor = appearance?.buttonHoverColor || "#db2777";
  const buttonFontColor = appearance?.buttonFontColor || "#ffffff";

  const contactEmail = appearance?.contactEmail || "support@photuna.app";
  const retentionDays = cfg?.galleryRetentionDays || 7;

  useEffect(() => {
    loadGoogleFont(headerFont);
    loadGoogleFont(generalFont);
    loadGoogleFont(buttonFont);
  }, [headerFont, generalFont, buttonFont]);

  const handleAccept = () => {
    onAccept?.({ consentVersion: CONSENT_VERSION, consentedAt: new Date().toISOString() });
  };

  return (
    <motion.div
      key="consent"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      className="relative w-full h-screen flex flex-col items-center justify-center px-8"
      style={{ backgroundColor: bgColor, fontFamily: generalFont, color: generalFontColor }}
    >
      {/* Logo */}
      {selectedLogo && (
        <img
          src={selectedLogo}
          alt="Logo"
          className="object-contain mb-8"
          style={{ maxHeight: isPortrait ? "12vh" : "10vh", maxWidth: "60vw" }}
        />
      )}

      {/* Card */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.5 }}
        className="w-full rounded-2xl border border-white/10 backdrop-blur-sm"
        style={{
          maxWidth: isPortrait ? "90vw" : "620px",
          backgroundColor: "rgba(0,0,0,0.45)",
          padding: "clamp(24px, 4vh, 48px) clamp(24px, 5vw, 48px)",
        }}
      >
        <h1
          className="font-bold text-center mb-4"
          style={{
            fontFamily: headerFont,
            color: headerFontColor,
            fontSize: "clamp(22px, 4vw, 42px)",
            lineHeight: 1.2,
          }}
        >
          Before we begin
        </h1>

        <p
          className="text-center mb-6 opacity-80"
          style={{ fontSize: "clamp(13px, 1.8vw, 20px)", lineHeight: 1.6 }}
        >
          {eventName} uses a photo booth powered by Studio Photuna.
        </p>

        {/* Notice bullets */}
        <ul
          className="space-y-3 mb-8 text-left"
          style={{ fontSize: "clamp(12px, 1.6vw, 18px)", lineHeight: 1.6 }}
        >
          <li className="flex gap-3 items-start">
            <span className="mt-1 shrink-0 text-lg">📸</span>
            <span>
              <strong style={{ color: headerFontColor }}>Your photos will be captured</strong>{" "}
              and composed into a printed photo strip.
            </span>
          </li>
          <li className="flex gap-3 items-start">
            <span className="mt-1 shrink-0 text-lg">☁️</span>
            <span>
              <strong style={{ color: headerFontColor }}>Your photos are stored securely</strong>{" "}
              in the cloud for up to {retentionDays} day{retentionDays !== 1 ? "s" : ""} so
              you can access them via the gallery link on your receipt.
            </span>
          </li>
          <li className="flex gap-3 items-start">
            <span className="mt-1 shrink-0 text-lg">🗑️</span>
            <span>
              <strong style={{ color: headerFontColor }}>You can request deletion</strong>{" "}
              of your photos at any time at{" "}
              <a
                href="https://www.studiophotuna.com/privacy-request"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: buttonBgColor, textDecoration: "underline" }}
              >
                studiophotuna.com/privacy-request
              </a>{" "}
              or by emailing{" "}
              <span style={{ color: buttonBgColor }}>{contactEmail}</span>.
            </span>
          </li>
          <li className="flex gap-3 items-start">
            <span className="mt-1 shrink-0 text-lg">🔒</span>
            <span>
              Your photos are not sold or shared with third parties.
              You may <strong style={{ color: headerFontColor }}>withdraw this consent at any time</strong>{" "}
              after your session — withdrawal does not affect photos already printed.
              See our{" "}
              <a
                href="https://www.studiophotuna.com/privacy-framework"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: buttonBgColor, textDecoration: "underline" }}
              >
                Privacy Policy
              </a>{" "}
              for full details.
            </span>
          </li>
        </ul>

        {/* Checkbox */}
        <label
          className="flex items-center gap-3 cursor-pointer mb-6"
          style={{ fontSize: "clamp(13px, 1.6vw, 18px)" }}
        >
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="w-5 h-5 rounded cursor-pointer accent-pink-500 shrink-0"
            style={{ width: "clamp(18px, 2.2vw, 28px)", height: "clamp(18px, 2.2vw, 28px)" }}
          />
          <span style={{ color: generalFontColor }}>
            I understand and agree to have my photos taken and stored as described above.
          </span>
        </label>

        {/* Buttons */}
        <div className="flex flex-col gap-3">
          <motion.button
            onClick={handleAccept}
            disabled={!accepted}
            whileTap={accepted ? { scale: 0.97 } : {}}
            className="w-full rounded-full font-semibold transition-all"
            style={{
              padding: "clamp(14px, 2vh, 28px) clamp(24px, 4vw, 48px)",
              fontSize: "clamp(16px, 2.2vw, 28px)",
              fontFamily: buttonFont,
              backgroundColor: accepted ? buttonBgColor : "rgba(255,255,255,0.12)",
              color: accepted ? buttonFontColor : "rgba(255,255,255,0.35)",
              cursor: accepted ? "pointer" : "not-allowed",
            }}
            onMouseEnter={(e) => {
              if (accepted) e.currentTarget.style.backgroundColor = buttonHoverColor;
            }}
            onMouseLeave={(e) => {
              if (accepted) e.currentTarget.style.backgroundColor = buttonBgColor;
            }}
          >
            I Agree — Continue
          </motion.button>

          <button
            onClick={onDecline}
            className="w-full rounded-full font-medium transition-colors"
            style={{
              padding: "clamp(10px, 1.5vh, 20px) clamp(24px, 4vw, 48px)",
              fontSize: "clamp(13px, 1.6vw, 22px)",
              fontFamily: buttonFont,
              color: "rgba(255,255,255,0.4)",
              backgroundColor: "transparent",
              border: "1px solid rgba(255,255,255,0.12)",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.7)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.4)")}
          >
            No thanks — Go back
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
