
import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircleIcon } from "@heroicons/react/24/solid";
import { normalizeToFileUrl } from "../utils/mediaUrl";
import { loadGoogleFont } from "../utils/fontLoader";

function getBridge() {
  if (typeof window === "undefined") return null;
  return window.api ?? window.electron ?? null;
}

/* ---------------------- Appearance defaults ---------------------- */
const DEFAULT_APPEARANCE = {
  boothName: "Studio Photuna",
  // ThankYouScreen accepts either 'tagline' or AdminDashboard's 'boothSlogan'
  tagline: "Ahead of the moment.",
  headerFont: "Ramillas",
  generalFont: "Interphases",
  buttonFont: "Interphases",
  headerFontColor: "#ffffff",
  generalFontColor: "#e5e5e5",
  bgColor: "#000000",
  logoPath: null,
  backgroundMediaPath: null,
  buttonBgColor: "#ec4899",
  buttonHoverColor: "#db2777",
  buttonFontColor: "#ffffff",
};

/* ---------------------- i18n (minimal) ---------------------- */
const LOCALES = {
  en: {
    printed: "Printed",
    done: "Done",
    dotAccent: ".",
    ready: "✨ Your print is ready ✨",
    Thankyou: "Thanks for posing with us! We loved capturing your moment. Enjoy your photo and we hope to see you again soon.",
    returningIn: "returning in",
    seconds: "s",
    newSession: "New Session →",
    by: "by",
  },
  tl: {
    printed: "Na-imprenta",
    done: "Tapos",
    dotAccent: ".",
    ready: "Handa na ang iyong print ✨",
    Thankyou: "Salamat sa pag-pose! ...",
    returningIn: "babalik sa",
    seconds: "seg",
    newSession: "Bagong Sesyon →",
    by: "ng",
  },
};

const LOCALE_ALIASES = { tagalog: 'tl', fil: 'tl', filipino: 'tl' };

function resolveLocale(code) {
  if (!code) return LOCALES.en;
  const key = String(code).toLowerCase();
  const resolved = LOCALE_ALIASES[key] ?? key;
  return LOCALES[resolved] ?? LOCALES.en;
}

/**
 * ThankYouScreen (Ultra Minimal, AdminDashboard-aware, No glass)
 *
 * Props:
 * - eventId (optional) for fetching appearance if event not provided
 * - event (optional) preferred: pass selectedEvent for instant appearance
 * - logo (optional) overrides appearance logo
 * - countdownStart (default 10) final fallback if AdminDashboard timers are missing
 * - onRestart (required)
 */
export default function ThankYouScreen({
  eventId = "default",
  event = null,
  logo = null,
  countdownStart = 10,
  onRestart,
}) {
  const api = getBridge();

  const [countdown, setCountdown] = useState(countdownStart);
  const [currentEvent, setCurrentEvent] = useState(event ?? null);
  const [globalAppearance, setGlobalAppearance] = useState(null);
  const [globalSettings, setGlobalSettings] = useState(null);
  // Gate countdown start until settings are resolved so the timer never jumps.
  const [settingsLoaded, setSettingsLoaded] = useState(!!event);

  /* ---- Load event + global appearance/settings (fallbacks) ---- */
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        if (!api) { if (mounted) setSettingsLoaded(true); return; }

        // Prefer event prop (already complete from AdminDashboard)
        if (event) {
          if (mounted) setCurrentEvent(event);
        } else if (api.getEvents) {
          const all = await api.getEvents();
          const found = Array.isArray(all)
            ? all.find((e) => String(e.id) === String(eventId))
            : null;
          if (mounted && found) setCurrentEvent(found);
        }

        if (api.getAppearance) {
          const a = await api.getAppearance();
          if (mounted && a) setGlobalAppearance(a);
        }

        if (api.getSettings) {
          const s = await api.getSettings();
          if (mounted && s) setGlobalSettings(s);
        }
      } catch (err) {
        console.warn("ThankYouScreen: failed to load appearance/event/settings", err);
      } finally {
        if (mounted) setSettingsLoaded(true);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [api, eventId, event]);

  /* ---- Resolve appearance ---- */
  const appearance = useMemo(() => {
    const evApp = currentEvent?.appearance ?? {};
    const gApp = globalAppearance ?? {};
    const merged = { ...DEFAULT_APPEARANCE, ...gApp, ...evApp };

    // Support AdminDashboard 'boothSlogan' as an alias to 'tagline'
    const resolvedTagline =
      evApp.boothSlogan ?? gApp.boothSlogan ?? merged.tagline ?? null;

    const resolvedLogo = logo ? logo : merged.logoPath;

    return {
      ...merged,
      tagline: resolvedTagline,
      logoPath: resolvedLogo ? normalizeToFileUrl(resolvedLogo) : null,
      backgroundMediaPath: merged.backgroundMediaPath
        ? normalizeToFileUrl(merged.backgroundMediaPath)
        : null,
    };
  }, [currentEvent, globalAppearance, logo]);

  const {
    boothName,
    tagline,
    headerFont,
    generalFont,
    buttonFont,
    headerFontColor,
    generalFontColor,
    bgColor,
    logoPath,
    backgroundMediaPath,
    buttonBgColor,
    buttonHoverColor,
    buttonFontColor,
  } = appearance;

  /* ---- Resolve language ---- */
  const langCode =
    currentEvent?.settings?.language ??
    globalSettings?.language ??
    "en";
  const t = resolveLocale(langCode);

  /* ---- Resolve ThankYou countdown from AdminDashboard timers ---- */
  const thankyouSeconds =
    currentEvent?.settings?.screenTimers?.thankyou ??
    globalSettings?.screenTimers?.thankyou ??
    countdownStart; // final fallback

  /* ---- Load fonts ---- */
  useEffect(() => {
    loadGoogleFont(headerFont);
    loadGoogleFont(generalFont);
    loadGoogleFont(buttonFont);
  }, [headerFont, generalFont, buttonFont]);

  /* ---- Countdown (starts only after settings are resolved) ---- */
  useEffect(() => {
    if (!settingsLoaded) return;

    const n = Number(thankyouSeconds);
    const start = Number.isFinite(n) && n > 0 ? n : countdownStart;
    setCountdown(start);

    const interval = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(interval);
          onRestart?.();
          return 0;
        }
        return c - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [settingsLoaded, thankyouSeconds, onRestart, countdownStart]);

  const isGif =
    !!backgroundMediaPath && backgroundMediaPath.toLowerCase().endsWith(".gif");

  return (
    <div
      className="relative w-full h-screen overflow-hidden flex items-center justify-center"
      style={{
        backgroundColor: bgColor,
        color: generalFontColor,
        fontFamily: generalFont,
      }}
    >

      {/* Header */}
      <div className="absolute top-24 z-30">
        {logoPath ? (<img src={logoPath} alt="logo" className="max-w-[500px] sm:max-w-[500px] md:max-w-[600px]" />) : (<>
          <h1
            className="text-5xl font-bold"
            style={{ fontFamily: headerFont, color: headerFontColor }}
          >
            {boothName}
          </h1>
          {tagline && <p className="text-lg flex items-center justify-center" style={{ color: generalFontColor }}>
            {tagline}
          </p>}</>)}
      </div>

      {/* Center minimal content */}
      <motion.div
        className="relative z-10 w-[92vw] max-w-2xl text-center px-6"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
      >

        <h1
          className="mt-4 text-6xl font-extrabold tracking-tight"
          style={{ fontFamily: headerFont, color: headerFontColor }}
        >
          {t.ready}
        </h1>

        <p className="mt-10 text-lg opacity-75">{t.Thankyou}</p>

        <p className="mt-6 text-md opacity-50">
          {t.returningIn}{" "}
          <span className="font-bold opacity-80">
            {countdown}
            {t.seconds}
          </span>
        </p>

        <motion.button
          onClick={onRestart}
          whileTap={{ scale: 0.98 }}
          className="mt-6 w-full py-4 text-xl max-w-sm rounded-full font-bold"
          style={{
            backgroundColor: buttonBgColor,
            color: buttonFontColor,
            fontFamily: buttonFont,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor =
              buttonHoverColor || buttonBgColor;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = buttonBgColor;
          }}
        >
          {t.newSession}
        </motion.button>
      </motion.div>
    </div>
  );
}