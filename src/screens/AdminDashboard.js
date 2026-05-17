// src/pages/AdminDashboard.jsx
// NOTE: Kept ALL original logic/handlers. Only adjusted layout & tokens to match the screenshot.
// Look for // UPDATED: comments for changes.

import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { supabase } from "../services/supabase.js";
import { useNavigate } from "react-router-dom";
import { useLicense } from "../context/LicenseContext";
import AccountMenu from "../components/navigation/AccountMenu";
import WebFont from "webfontloader";
import PlanCards from "../components/subscription/PlanCards";
import { useAuth } from "../context/AuthContext";
import * as licensingApi from "../services/licensingApi";
import SubscriptionSummary from "../components/subscription/SubscriptionSummary";
import TemplateEditor from "../components/TemplateEditor";
import { initSettingsSync, pullSettings, pushSettings } from "../services/settingsSync.js";

const native =
  typeof window !== "undefined"
    ? window.api || window.electron || null
    : null;

// A small, sensible starter list — add/remove as you like:
const GOOGLE_FONTS = [
  "Inter",
  "Plus Jakarta Sans",
  "Manrope",
  "Outfit",
  "Space Grotesk",
  "Sora",
  "Urbanist",
  "Roboto",
  "Poppins",
  "Montserrat",
  "Lato",
  "Raleway",
  "Nunito",
  "Rubik",
  "Source Sans 3",
  "Noto Sans",
  "Playfair Display",
  "Cormorant Garamond",
  "Libre Baskerville",
  "Fraunces",
  "Merriweather",
  "Oswald",
  "DM Sans",
  "Lexend",
  "Work Sans",
  "Bebas Neue",
  "Kanit",
  "Fira Sans",
  "Josefin Sans",
  "Abril Fatface",
  "Caveat",
  "Pacifico",
  "Dancing Script",
];

// Load a font family (all common weights so your UI has choices)
function loadGoogleFont(family) {
  if (!family) return;
  WebFont.load({
    google: {
      families: [`${family}:100,200,300,400,500,600,700,800,900`],
    },
  });
}

// A robust fallback stack
const FALLBACK_STACK =
  "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif";

const PAGE_TITLES = {
  home: "Dashboard",
  events: "Events",
  settings: "Settings",
  reports: "Reports",
  account: "Account",
  helpcenter: "Help Center",
  subscription: "Subscription",
  dashboard: "Event Dashboard",
  remotebooth: "Remote Booth",
};

function getStatusTone(value) {
  if (value === true) return "bg-emerald-400";
  if (value === false) return "bg-red-400";
  return "bg-amber-400";
}

function getSettingsSectionMeta(tab) {
  switch (tab) {
    case "camera":
      return {
        title: "Camera Settings",
        description: "Configure your connected camera device and resolution.",
      };
    case "printing":
      return {
        title: "Printer Settings",
        description: "Manage your printer, paper size, quality, and print output behavior.",
      };
    case "storage":
      return {
        title: "Storage Settings",
        description: "Choose where sessions are stored and control cleanup behavior.",
      };
    case "general":
      return {
        title: "General Settings",
        description: "Adjust booth idle behavior, language, and core preferences.",
      };
    case "logs":
      return {
        title: "Audit & Logs",
        description: "Review exported logs and maintenance records for troubleshooting.",
      };
    case "system":
      return {
        title: "System Settings",
        description: "Control startup, recovery, updates, and system maintenance options.",
      };
    default:
      return {
        title: "Settings",
        description: "Configure hardware, storage, printing behavior, recovery options, and overall booth preferences.",
      };
  }
}

/** Theme tokens — aligned with AuthGate design language */
const ACCENT_COLOR = "#4f46e5"; // indigo-600
const BODY_BG = "bg-slate-50";
const SURFACE_BG = "bg-white";
const SURFACE_BORDER = "border border-slate-200";
const BODY_TEXT = "text-slate-900";
const MUTED_TEXT = "text-slate-600";
const SOFT_TEXT = "text-slate-500";
const CARD_RADIUS = "rounded-3xl";
const SMALL_CARD_RADIUS = "rounded-2xl";
const INPUT_RADIUS = "rounded-xl";
const TOOLBAR_RADIUS = "rounded-2xl";
const CHIP_RADIUS = "rounded-full";
const FOCUS_RING_INDIGO = "focus:ring-2 focus:ring-indigo-200";
const BTN_PRIMARY = "inline-flex items-center justify-center rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-200 transition hover:-translate-y-0.5 hover:bg-indigo-700 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60";
const BTN_SECONDARY = "inline-flex items-center justify-center rounded-full border border-indigo-200 bg-indigo-50 px-5 py-2.5 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60";
const BTN_GHOST = "inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60";
const EYEBROW = "text-xs font-semibold uppercase tracking-[0.18em] text-slate-500";

// Shadows
const SHADOW_SOFT = "shadow-[0_8px_30px_rgba(15,23,42,0.06)]";
const SHADOW_CARD = "shadow-[0_24px_64px_rgba(15,23,42,0.08)]";

const DEFAULT_SCREEN_TIMERS = {
  template: 60,
  payment: 90,
  retake: 30,
  photoselect: 60,
  framefilter: 90,
  printing: 30,
  thankyou: 15,
};

const CUSTOM_PAPER_SIZE_OPTIONS = [
  { value: "2x6", label: "Photo 2 × 6", source: "app", widthIn: 2, heightIn: 6 },
  { value: "4x6", label: "Photo 4 × 6", source: "app", widthIn: 4, heightIn: 6 },
  { value: "6x4", label: "Photo 6 × 4", source: "app", widthIn: 6, heightIn: 4 },
  { value: "6x2", label: "Photo 6 × 2", source: "app", widthIn: 6, heightIn: 2 },
];

function normalizePaperName(value = "") {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[×x]/g, "x");
}

function extractPrinterPaperOptions(caps) {
  const raw =
    caps?.paperSizes ||
    caps?.papers ||
    caps?.mediaOptions ||
    caps?.media ||
    [];

  const printerItems = Array.isArray(raw)
    ? raw.map((item) => {
      if (typeof item === "string") {
        return {
          value: item,
          label: item,
          source: "printer",
        };
      }

      const name =
        item?.name ||
        item?.label ||
        item?.paperName ||
        item?.media ||
        "Unknown";

      return {
        value: name,
        label: name,
        source: "printer",
        width: item?.width ?? item?.w ?? null,
        height: item?.height ?? item?.h ?? null,
        raw: item,
      };
    })
    : [];

  const map = new Map();

  [...printerItems, ...CUSTOM_PAPER_SIZE_OPTIONS].forEach((item) => {
    const key = normalizePaperName(item.value);
    if (!map.has(key)) map.set(key, item);
  });

  return Array.from(map.values());
}

const CUSTOM_ORIENTATION_OPTIONS = [
  { value: "portrait", label: "Portrait" },
  { value: "landscape", label: "Landscape" },
];

// safe unique id
function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

function notify(showToast, message) {
  showToast?.(message);
}

function WavePattern() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 600 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <pattern id="dash-waves" x="0" y="0" width="600" height="120" patternUnits="userSpaceOnUse">
          <path d="M0 60 Q 75 20, 150 60 T 300 60 T 450 60 T 600 60" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="3" />
          <path d="M0 90 Q 75 50, 150 90 T 300 90 T 450 90 T 600 90" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
        </pattern>
      </defs>
      <rect width="600" height="200" fill="url(#dash-waves)" />
    </svg>
  );
}

export default function AdminDashboard({ onLogout, onStartPhotobooth }) {

  const { user, profile, loading: authLoading, logout } = useAuth();

  const identity = useMemo(() => ({
    username:
      profile?.full_name ||
      user?.user_metadata?.full_name ||
      user?.email ||
      null,
    userId: user?.id || null,
  }), [profile?.full_name, user?.user_metadata?.full_name, user?.email, user?.id]);

  // --- state  --------------------
  const ready = !!identity.userId;
  const [hydrated, setHydrated] = useState(false);

  const [reportEventId, setReportEventId] = useState("all");

  const [booths, setBooths] = useState([]);
  const [boothsLoading, setBoothsLoading] = useState(false);

  /** Primary nav */
  const [activeMain, setActiveMain] = useState("home"); // "events" | "dashboard" | "account"
  const [activeSettingsTab, setActiveSettingsTab] = useState("camera");
  const [activeSub, setActiveSub] = useState("branding"); // dashboard sub-tabs
  const [helpArticle, setHelpArticle] = useState(null);
  const navigate = useNavigate();
  const { license, gating, loading: licenseLoading, refreshLicense: ctxRefreshLicense } = useLicense();
  const [accountTab, setAccountTab] = useState("profile");
  const [accountForm, setAccountForm] = useState({
    displayName: profile?.full_name || user?.user_metadata?.full_name || user?.email || "",
    email: profile?.email || user?.email || "",
    phone: profile?.phone || "",
    company: profile?.company || "",
    role: profile?.role || "Administrator",
    badgePhoto: profile?.avatar_url || "",
  });
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  const [accountPreferences, setAccountPreferences] = useState({
    theme: "system",
    language: "en",
    emailNotifications: false,
    desktopNotifications: true,
    autoLaunch: false,
    soundEnabled: true,
  });

  const [profileSaving, setProfileSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [prefsSaving, setPrefsSaving] = useState(false);
  // Legacy alias so shared UI references still compile
  const accountSaving = profileSaving || passwordSaving || prefsSaving;

  /** State: events, templates, palettes */
  const [events, setEvents] = useState([]);
  const [currentEvent, setCurrentEvent] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [frames, setFrames] = useState([]);
  const [tones, setTones] = useState([]);
  const [palettes, setPalettes] = useState([]);

  // === BG COLOR STATE ===========================
  const [isNewBgColorOpen, setIsNewBgColorOpen] = useState(false);
  const [newBgHex, setNewBgHex] = useState("#ffffff");
  const [newBgName, setNewBgName] = useState("");

  const getEffectiveStoragePath = () => storagePath?.trim() || "";

  const PRINT_LAYOUTS = [
    { value: "4x6", label: "4 × 6 Portrait" },
    { value: "6x4", label: "6 × 4 Landscape" },
    { value: "2x6", label: "2 × 6 Strip" },
    { value: "6x2", label: "6 × 2 Strip" },
  ];

  const PRINT_QUALITY_OPTIONS = [
    { value: "draft", label: "Draft" },
    { value: "standard", label: "Standard" },
    { value: "high", label: "High" },
  ];

  const PRINT_COLOR_OPTIONS = [
    { value: "color", label: "Color" },
    { value: "grayscale", label: "Grayscale" },
  ];

  const PRINT_ORIENTATION_OPTIONS = [
    { value: "auto", label: "Auto" },
    { value: "portrait", label: "Portrait" },
    { value: "landscape", label: "Landscape" },
  ];
  const [availablePrinterOptions, setAvailablePrinterOptions] = useState(null);

  const CAMERA_RESOLUTION_OPTIONS = [
    { value: "720p", label: "1280 × 720 (HD)", width: 1280, height: 720 },
    { value: "1080p", label: "1920 × 1080 (Full HD)", width: 1920, height: 1080 },
    { value: "1440p", label: "2560 × 1440 (QHD)", width: 2560, height: 1440 },
    { value: "4k", label: "3840 × 2160 (4K)", width: 3840, height: 2160 },
  ];

  const CAMERA_FACING_OPTIONS = [
    { value: "user", label: "Front / User" },
    { value: "environment", label: "Rear / Environment" },
    { value: "left", label: "Left" },
    { value: "right", label: "Right" },
  ];

  const getResolutionMeta = (value) =>
    CAMERA_RESOLUTION_OPTIONS.find((r) => r.value === value) ||
    CAMERA_RESOLUTION_OPTIONS.find((r) => r.value === "1080p");

  // The active bg color to attach to frames when a frame is applied
  const [selectedBgColorId, setSelectedBgColorId] = useState(null);

  // === BG color picker per-frame (popover) =======================
  const [frameColorPickerOpenId, setFrameColorPickerOpenId] = useState(null);

  /** Return array of hex colors from a palette-like record (robust to mixed shapes) */
  function extractHexes(p) {
    if (!p) return [];
    if (Array.isArray(p.colors)) return p.colors.filter(Boolean);
    const single =
      p.value || p.hex || p.color || (typeof p === "string" ? p : null);
    return single ? [single] : [];
  }

  /** Pretty name for palette/color */
  function paletteName(p) {
    return p?.name || (extractHexes(p)[0] ?? "Color");
  }

  const loadAccountCenterData = React.useCallback(async () => {
    if (!user?.id) return;

    try {
      const [meRes, prefRes] = await Promise.all([
        typeof licensingApi.me === "function"
          ? licensingApi.me().catch(() => null)
          : Promise.resolve(null),
        window.electron?.getAccountPreferences?.().catch(() => null),
      ]);

      const resolvedProfile = meRes?.profile || profile || null;
      const resolvedUser = meRes?.user || user;

      setAccountForm((prev) => ({
        ...prev,
        displayName:
          resolvedProfile?.full_name ||
          resolvedUser?.user_metadata?.full_name ||
          resolvedUser?.email ||
          "",
        email: resolvedProfile?.email || resolvedUser?.email || "",
        phone: resolvedProfile?.phone || "",
        role: resolvedProfile?.role || "Administrator",
        company: resolvedProfile?.company || "",
        badgePhoto: resolvedProfile?.avatar_url || "",
      }));

      if (prefRes?.ok && prefRes.preferences) {
        setAccountPreferences((prev) => ({
          ...prev,
          ...prefRes.preferences,
        }));
      }
    } catch (err) {
      console.error("Failed to load account center:", err);
    }
  }, [profile, user]);

  /** Appearance */
  const [headerFont, setHeaderFont] = useState("Inter");
  const [generalFont, setGeneralFont] = useState("Inter");
  const [headerFontColor, setHeaderFontColor] = useState("#111827");
  const [generalFontColor, setGeneralFontColor] = useState("#374151");
  const [bgColor, setBgColor] = useState("#ffffff");
  const [logoPath, setLogoPath] = useState(null); // {url, name, previewUrl?}
  const [backgroundMediaPath, setBackgroundMediaPath] = useState(null); // {url, name, previewUrl?}
  const [boothName, setBoothName] = useState("");
  const [boothSlogan, setBoothSlogan] = useState("");

  /** Button theming */
  const [buttonBgColor, setButtonBgColor] = useState(ACCENT_COLOR);
  const [buttonHoverColor, setButtonHoverColor] = useState("#5348ff");
  const [buttonFont, setbuttonFont] = useState("Inter");
  const [buttonFontColor, setButtonFontColor] = useState("#ffffff");

  // NEW: Start button options
  const [startButtonHidden, setStartButtonHidden] = useState(false);
  const [startButtonText, setStartButtonText] = useState("Tap to Start");

  /** Session settings */
  const [countdown, setCountdown] = useState(5);
  const [screenTimers, setScreenTimers] = useState(DEFAULT_SCREEN_TIMERS);
  const [timersEnabled, setTimersEnabled] = useState(false);
  const [numberOfShots, setNumberOfShots] = useState(3);
  const [retakeLimit, setRetakeLimit] = useState(0);

  /** Features */
  const [flashEnabled, setFlashEnabled] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [language, setLanguage] = useState("en");
  const [price, setPrice] = useState(0); // legacy/global default

  /** Booth identity */
  const [boothIdentityName, setBoothIdentityName] = useState("");
  const [boothLocation, setBoothLocation] = useState("");
  const [operatorName, setOperatorName] = useState("");

  // --- Map Admin names/ids to FrameFilterScreen constants ---
  function mapFrameNameToStyleId(name = "") {
    const k = String(name).trim().toLowerCase();
    if (k === "white") return "white";
    if (k === "black") return "black";
    if (k === "gold") return "gold";
    if (k === "silver") return "silver";
    if (k === "bronze") return "bronze";
    if (k === "pink") return "pink";
    if (k === "purple") return "purple";
    if (k === "pastel pink") return "pastel-pink";
    if (k === "pastel blue") return "pastel-blue";
    if (k === "pastel green") return "pastel-green";
    return null; // unknown graphic frame name -> no color style gate
  }

  function mapToneToEffectId(tone) {
    // Prefer explicit mapping using preset tone IDs
    switch (tone?.id) {
      case "pb-blackwhite": return "bw";
      case "pb-vintage": return "vintage";
      case "pb-warm": return "warm";
      case "pb-cool": return "cool";
      case "pb-bright": return "normal";
      case "pb-party": return "sepia";
      default:
        // If it's a custom tone, you can try name-based mapping:
        const k = String(tone?.name || "").trim().toLowerCase();
        if (k.includes("black") && k.includes("white")) return "bw";
        if (k.includes("vintage")) return "vintage";
        if (k.includes("warm")) return "warm";
        if (k.includes("cool")) return "cool";
        if (k.includes("sepia")) return "sepia";
        if (k.includes("normal")) return "normal";
        return null;
    }
  }

  // === CAMERA STATE ==========================================
  // (was lower in the file; move it up to the other useState blocks)
  const [cameraList, setCameraList] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [mirrorCamera, setMirrorCamera] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraStatusText, setCameraStatusText] = useState("Not checked");
  const [cameraOnline, setCameraOnline] = useState(false);
  const [cameraCapabilities, setCameraCapabilities] = useState(null);
  const [cameraError, setCameraError] = useState("");

  // === PRINTER STATE ==========================================
  const [printers, setPrinters] = useState([]);
  const [selectedPrinter, setSelectedPrinter] = useState("");
  const [paperSize, setPaperSize] = useState("4x6");
  const [printCopies, setPrintCopies] = useState(1);
  const [printColorMode, setPrintColorMode] = useState("color");
  const [printQuality, setPrintQuality] = useState("high");
  const [printOrientation, setPrintOrientation] = useState("landscape");
  const [printDuplexMode, setPrintDuplexMode] = useState("simplex");
  const [printDpi, setPrintDpi] = useState(300);

  const [printerOnline, setPrinterOnline] = useState(false);
  const [printerLoading, setPrinterLoading] = useState(false);
  const [printerStatusText, setPrinterStatusText] = useState("Not checked");
  const [printerCapabilities, setPrinterCapabilities] = useState(null);
  const [printerError, setPrinterError] = useState("");

  const [printerSystemLayout, setPrinterSystemLayout] = useState("Unknown");
  const [printerSystemOrientation, setPrinterSystemOrientation] = useState("Unknown");
  const [usePrinterDefaults, setUsePrinterDefaults] = useState(false);

  // -------------------- States --------------------
  const [cameraResolution, setCameraResolution] = useState("1080p");
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(true);
  const [paperSizeOptions, setPaperSizeOptions] = useState(CUSTOM_PAPER_SIZE_OPTIONS);

  // frame settings

  const handleThumb25Upload = async ({ frameId, file }) => {
    const err = validateImage(file);
    if (err) {
      notify(showToast, err);
      return;
    }

    try {
      const dataUrl = await fileToDataUrl(file);
      const thumb25DataUrl = await to25x25(dataUrl);

      const updatedFrames = frames.map((fr) => {
        if (fr.id !== frameId) return fr;
        return {
          ...fr,
          thumbnail25: {
            thumb25DataUrl,
            fileName: file.name,
            updatedAt: new Date().toISOString()
          },
          // If other parts of the app still read `previewMeta.thumbnailDataUrl`,
          // optionally mirror it here, otherwise omit previewMeta entirely.
          // previewMeta: { thumbnailDataUrl: thumb25DataUrl }
        };
      });

      await persistAll({ nextFrames: updatedFrames });
      notify(showToast, "25×25 thumbnail updated.");
    } catch (e) {
      console.error(e);
      notify(showToast, "Failed to create 25×25 thumbnail.");
    }
  };


  const handleLayoutUpload = async ({ frameId, layout, file }) => {
    const err = validateImage(file);
    if (err) {
      notify(showToast, err);
      return;
    }

    try {
      const originalDataUrl = await fileToDataUrl(file);

      const nextFrames = frames.map((fr) => {
        if (fr.id !== frameId) return fr;

        return {
          ...fr,
          previews: {
            ...(fr.previews || {}),
            [layout]: {
              ...(fr.previews?.[layout] || {}),
              originalDataUrl,
              fileName: file.name,
              updatedAt: new Date().toISOString(),
            },
          },
        };
      });

      await persistAll({ nextFrames });
      notify(showToast, `Uploaded ${layout.toUpperCase()} layout.`);
    } catch (e) {
      console.error(e);
      notify(showToast, "Failed to process layout image.");
    }
  };

  // Remove a specific layout preview from a frame
  async function handleLayoutRemove({ frameId, layout }) {
    try {
      const next = frames.map((f) => {
        if (f.id !== frameId) return f;
        const nextPreviews = { ...(f.previews || {}) };
        delete nextPreviews[layout];
        return { ...f, previews: nextPreviews };
      });

      await persistAll({ nextFrames: next });
      notify(showToast, `Removed ${layout.toUpperCase()} overlay from frame`);
    } catch (err) {
      console.error("handleLayoutRemove failed:", err);
      notify(showToast, "Failed to remove overlay. Please try again.");
    }
  }

  // file -> DataURL
  const fileToDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  // Create a 25x25 square thumbnail (center-cropped)
  const to25x25 = (dataUrl) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const size = 25;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");

        const sw = img.naturalWidth;
        const sh = img.naturalHeight;
        const side = Math.min(sw, sh);
        const sx = (sw - side) / 2;
        const sy = (sh - side) / 2;

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);

        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = reject;
      img.src = dataUrl;
    });

  // Add near the other helpers (e.g., under validateImage)
  function suggestLayoutFromWH(w, h) {
    const targets = [
      { id: "4x6", ratio: 2 / 3 }, // portrait
      { id: "2x6", ratio: 1 / 3 }, // portrait strip
      { id: "6x4", ratio: 3 / 2 }, // landscape
      { id: "6x2", ratio: 3 / 1 }, // landscape strip
    ];
    const r = w / h;
    let best = targets[0], diff = Infinity;
    for (const t of targets) {
      const d = Math.abs(r - t.ratio);
      if (d < diff) { best = t; diff = d; }
    }
    return best.id; // "4x6" | "2x6" | "6x4" | "6x2"
  }

  async function readImageWH(file) {
    const dataUrl = await fileToDataUrl(file); // you already have this helper
    const img = new Image();
    img.crossOrigin = "anonymous";
    return await new Promise((resolve, reject) => {
      img.onload = () => resolve({ dataUrl, w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  const validateImage = (file) => {
    if (!file) return "No file selected.";
    const okTypes = ["image/png", "image/jpeg", "image/webp"];
    if (!okTypes.includes(file.type)) return "Unsupported file type.";
    const maxMB = 5;
    if (file.size > maxMB * 1024 * 1024) return `File too large (max ${maxMB}MB).`;
    return null;
  };

  /** Modes */
  const DEFAULT_APP_MODE = "rental";
  const DEFAULT_RENTAL = {
    timerEnabled: false,
    timerHours: 2,
    sessionLimitEnabled: false,
    sessionLimit: 100,
    offlineModeEnabled: true,
    autoSaveTarget: "local", // "local" | "usb" | "cloud"
    endSessionSummaryEnabled: true,
  };
  const DEFAULT_BUSINESS = {
    paymentEnabled: true,
    payment: {
      providers: { gcash: true, paypal: false, stripe: false, cash: true },
    },
    pricing: {
      model: "perSession", // "perSession" | "perPhoto"
      pricePerSession: 0,
      additionalPrintPrice: 0,
      currency: "PHP",
      taxEnabled: false,
      taxRate: 0,
    },
  };

  const DEFAULT_APPEARANCE = {
    headerFont: "Inter",
    generalFont: "Inter",
    headerFontColor: "#111827",
    generalFontColor: "#374151",
    bgColor: "#ffffff",
    logoPath: null,
    backgroundMediaPath: null,
    boothName: "",
    boothSlogan: "",
    buttonBgColor: ACCENT_COLOR,
    buttonHoverColor: "#5348ff",
    buttonFont: "Inter",
    buttonFontColor: "#ffffff",
    startButtonHidden: false,
    startButtonText: "Tap to Start",
  };

  const normalizeCameraList = (list) => {
    if (!Array.isArray(list)) return [];
    return list
      .filter(Boolean)
      .map((d, index) => ({
        id: d.id || d.deviceId || `camera-${index}`,
        label: d.label || d.name || `Camera ${index + 1}`,
        kind: d.kind || "videoinput",
        facingMode: d.facingMode || null,
      }));
  };

  const refreshCameras = async () => {
    setCameraLoading(true);
    setCameraError("");

    try {
      const devices = (await native?.listCameras?.()) ?? [];
      const normalized = normalizeCameraList(devices);

      setCameraList(normalized);

      if (!normalized.length) {
        setSelectedCameraId("");
        setCameraOnline(false);
        setCameraStatusText("No cameras detected");
        showToast("No cameras found");
        return;
      }

      const saved = (() => {
        try {
          return JSON.parse(localStorage.getItem("boothSettings") || "{}");
        } catch {
          return {};
        }
      })();

      const currentStillExists = normalized.some((d) => d.id === selectedCameraId);
      const savedCameraId = saved.selectedCameraId ?? "";
      const savedStillExists = normalized.some((d) => d.id === savedCameraId);

      let nextCameraId = "";

      if (currentStillExists) {
        nextCameraId = selectedCameraId;
      } else if (savedStillExists) {
        nextCameraId = savedCameraId;
      } else {
        nextCameraId = normalized[0]?.id ?? "";
      }

      if (nextCameraId !== selectedCameraId) {
        setSelectedCameraId(nextCameraId);
      }

      if (currentStillExists) {
        setCameraStatusText("Camera list refreshed");
      } else if (savedStillExists) {
        setCameraStatusText("Restored saved camera");
      } else {
        setCameraStatusText("Camera changed to first available device");
      }

      setCameraOnline(true);
    } catch (e) {
      console.warn("listCameras failed", e);
      setCameraList([]);
      setSelectedCameraId("");
      setCameraOnline(false);
      setCameraStatusText("Unable to load cameras");
      setCameraError(e?.message || "Unable to load cameras from the native bridge."); // FIX 3: surface native bridge failure inline in settings UI.
      showToast("Failed to load cameras");
    } finally {
      setCameraLoading(false);
    }
  };

  const loadCameraCapabilities = async (cameraId) => {
    if (!cameraId) {
      setCameraCapabilities(null);
      setCameraOnline(false);
      setCameraStatusText("No camera selected");
      return;
    }

    try {
      const caps = await native?.getCameraCapabilities?.(cameraId);

      if (caps) {
        setCameraCapabilities(caps);
        setCameraOnline(true);
        setCameraStatusText("Camera ready");
        return;
      }

      setCameraCapabilities(null);
      setCameraOnline(true);
      setCameraStatusText("Camera selected");
    } catch (err) {
      console.warn("getCameraCapabilities failed", err);
      setCameraCapabilities(null);
      setCameraOnline(false);
      setCameraStatusText("Unable to read camera capabilities");
    }
  };

  useEffect(() => {
    setAccountForm((prev) => ({
      ...prev,
      displayName:
        prev.displayName ||
        profile?.full_name ||
        user?.user_metadata?.full_name ||
        user?.email ||
        "",
      email: prev.email || profile?.email || user?.email || "",
      phone: prev.phone || profile?.phone || "",
      company: prev.company || profile?.company || "",
      role: prev.role || profile?.role || "Administrator",
      badgePhoto: prev.badgePhoto || profile?.avatar_url || "",
    }));
  }, [
    profile?.full_name,
    profile?.email,
    profile?.phone,
    profile?.company,
    profile?.role,
    profile?.avatar_url,
    user?.email,
    user?.user_metadata?.full_name,
  ]);

  useEffect(() => {
    if (!window.electron?.onUpdaterStatus) return;

    const unsubscribe = window.electron.onUpdaterStatus((payload) => {
      setUpdateState(payload.status || "idle");
      setUpdateStatusText(payload.message || "Updater status changed");

      if (payload.status === "downloading") {
        setUpdatePercent(Math.round(payload.percent || 0));
      }
    });

    return unsubscribe;
  }, []);

  const checkForUpdates = async () => {
    const result = await window.electron.invoke("app:check-updates");

    if (!result?.ok) {
      setUpdateStatusText(result?.error || "Failed to check for updates");
      return;
    }

    setUpdateStatusText(result.message || "Update check completed");
  };

  const downloadUpdate = async () => {
    const result = await window.electron.invoke("app:download-update");
    if (!result?.ok) {
      setUpdateStatusText(result?.error || "Failed to download update");
    }
  };

  const installUpdate = async () => {
    const result = await window.electron.invoke("app:install-update");
    if (!result?.ok) {
      setUpdateStatusText(result?.error || "Failed to install update");
    }
  };

  const clearCache = async () => {
    try {
      const result = await safeInvoke("app:clear-cache");

      if (!result) {
        setCacheStatusText("Cache clearing is unavailable");
        showToast("Cache clearing is unavailable");
        return;
      }

      if (result.ok === false) {
        setCacheStatusText(result.error || "Failed to clear cache");
        showToast(result.error || "Failed to clear cache");
        return;
      }

      setCacheStatusText(result.message || "Cache cleared");
      showToast(result.message || "Cache cleared");
    } catch (err) {
      console.error("clearCache failed", err);
      setCacheStatusText("Failed to clear cache");
      showToast("Failed to clear cache");
    }
  };

  const deleteStoredPhotos = async () => {
    const targetPath = getEffectiveStoragePath();

    if (!targetPath) {
      setStorageStatusText("No storage folder selected");
      showToast("Select a storage folder first");
      return;
    }

    const confirmed = window.confirm?.(
      `Delete all stored photos in:
${targetPath}

This cannot be undone.`
    );

    if (confirmed === false) return;

    setStorageLoading(true);

    try {
      const attempts = [
        () => safeInvoke("storage:delete-all", targetPath),
        () => safeInvoke("storage:delete-all", { path: targetPath }),
        () =>
          safeInvoke("storage:cleanup", {
            path: targetPath,
            autoDeleteDays: 0,
            deleteAll: true,
          }),
        () => native?.deleteStoredPhotos?.({ path: targetPath, userId: identity?.userId }),
        () => native?.deleteStoredPhotos?.(targetPath),
      ];

      let result = null;

      for (const attempt of attempts) {
        try {
          result = await attempt();
          if (result) break;
        } catch (err) {
          console.warn("deleteStoredPhotos attempt failed", err);
        }
      }

      if (!result) {
        setStorageStatusText("Delete stored photos is unavailable");
        showToast("Delete stored photos is unavailable");
        return;
      }

      if (result.ok === false) {
        setStorageStatusText(result.error || "Failed to delete stored photos");
        showToast(result.error || "Failed to delete stored photos");
        return;
      }

      setStorageStatusText(result.message || "Stored photos deleted");
      showToast(result.message || "Stored photos deleted");
      await loadStorageInfo(targetPath);
    } catch (err) {
      console.error("deleteStoredPhotos failed", err);
      setStorageStatusText("Failed to delete stored photos");
      showToast("Failed to delete stored photos");
    } finally {
      setStorageLoading(false);
    }
  };

  const openHelpArticle = (articleKey) => {
    const articles = {
      docs: {
        title: "Help Center",
        sections: [
          "Use Getting Started for first-time setup, Template Editor for layout adjustments, and Payments when the booth is running in business mode.",
          "To make changes that affect the live booth flow, open an event first and save the event after updating its dashboard tabs.",
          "For hardware-related issues, use the Settings area to refresh devices, run checks, and save the final configuration.",
        ],
      },
      gettingStarted: {
        title: "Getting Started",
        sections: [
          "1. Create or open an event from the Events page.",
          "2. Go to Dashboard > Branding to set booth name, logo, welcome text, and background media.",
          "3. Open Dashboard > Controls to configure countdown, number of shots, retakes, timers, and sharing behavior.",
          "4. Go to Settings to select the camera, printer, storage path, and general booth behavior, then click Save settings.",
          "5. Run a test session before going live so you can confirm camera, template, printer, and storage output are all working together.",
        ],
      },
      templateEditor: {
        title: "Template Editor",
        sections: [
          "Open an event first, then go to Dashboard > Templates.",
          "Create or edit a template to drag, resize, rotate, and align photo slots for each print layout.",
          "Save the template, apply it to the event, and run a preview or test print to verify slot positions before production use.",
        ],
      },
      payments: {
        title: "Payments",
        sections: [
          "Payment options are configured per event when the booth is using Business mode.",
          "Open an event, go to Dashboard > Analytics, enable payment, then choose the methods you want such as GCash, PayPal, Stripe, or Cash.",
          "Set the session price and any additional print price, then save the event so the payment flow uses the updated values.",
        ],
      },
    };

    setHelpArticle(articles[articleKey] || articles.docs);
  };

  const openAllDocs = () => {
    openHelpArticle("docs");
  };

  const openGettingStartedGuide = () => {
    openHelpArticle("gettingStarted");
  };

  const openTemplateEditorGuide = () => {
    if (currentEvent) {
      setActiveMain("dashboard");
      setActiveSub("templates");
      showToast(`Opened Templates for ${currentEvent.name || "current event"}`);
      return;
    }

    openHelpArticle("templateEditor");
    showToast("Create or open an event to use the template editor");
  };

  const openPaymentsGuide = () => {
    if (currentEvent) {
      setActiveMain("dashboard");
      setActiveSub("analytics");
      showToast(`Opened Analytics for ${currentEvent.name || "current event"}`);
      return;
    }

    openHelpArticle("payments");
    showToast("Create or open an event to configure payments");
  };

  const resetSettingsToDefault = async () => {
    setSelectedCameraId(cameraList[0]?.id || "");
    setCameraResolution("1080p");
    setMirrorCamera(false);
    setFlashEnabled(true);
    setSoundEnabled(true);

    const defaultPrinter = printers.find((p) => p.isDefault) || printers[0] || null;
    setSelectedPrinter(defaultPrinter?.name || "");
    setPaperSize("4x6");
    setPrintCopies(1);
    setPrintColorMode("color");
    setPrintQuality("high");
    setPrintOrientation("landscape");

    setStoragePath("");
    setAutoDeleteDays(14);

    setDimWhenIdle(true);
    setIdleTimeout(60);

    setLaunchOnStartup(true);
    setAutoRestart(true);

    setLanguage("en");
    setAutoUpdateEnabled(true);

    setBoothIdentityName("");
    setBoothLocation("");
    setOperatorName("");

    setPrinterOnline(false);
    setPrinterStatusText("Not checked");
    setPrinterCapabilities(null);
    setUsePrinterDefaults(false);
    setPrintDuplexMode("simplex");
    setPrintDpi(300);
    setPrinterSystemLayout("Unknown");
    setPrinterSystemOrientation("Unknown");

    await saveSettings();
    showToast("Settings reset to default");
  };

  const prices = {
    currency: "PHP",
    monthly: { display: "₱1,400 / mo", amount: 1400 },
    yearly: { display: "₱10,000 / yr", amount: 10000 },
  };

  const [appMode, setAppMode] = useState(DEFAULT_APP_MODE);
  // Rental
  const [rentalTimerEnabled, setRentalTimerEnabled] = useState(DEFAULT_RENTAL.timerEnabled);
  const [rentalTimerHours, setRentalTimerHours] = useState(DEFAULT_RENTAL.timerHours);
  const [rentalSessionLimitEnabled, setRentalSessionLimitEnabled] = useState(DEFAULT_RENTAL.sessionLimitEnabled);
  const [rentalSessionLimit, setRentalSessionLimit] = useState(DEFAULT_RENTAL.sessionLimit);
  const [offlineModeEnabled, setOfflineModeEnabled] = useState(DEFAULT_RENTAL.offlineModeEnabled);
  const [autoSaveTarget, setAutoSaveTarget] = useState(DEFAULT_RENTAL.autoSaveTarget);
  const [endSessionSummaryEnabled, setEndSessionSummaryEnabled] = useState(DEFAULT_RENTAL.endSessionSummaryEnabled);
  // Business
  const [paymentEnabled, setPaymentEnabled] = useState(DEFAULT_BUSINESS.paymentEnabled);
  const [paymentProviders, setPaymentProviders] = useState({ ...DEFAULT_BUSINESS.payment.providers });
  const [pricingModel, setPricingModel] = useState(DEFAULT_BUSINESS.pricing.model);
  const [pricePerSession, setPricePerSession] = useState(DEFAULT_BUSINESS.pricing.pricePerSession);
  const [additionalPrintPrice, setAdditionalPrintPrice] = useState(DEFAULT_BUSINESS.pricing.additionalPrintPrice);
  const [currency, setCurrency] = useState(DEFAULT_BUSINESS.pricing.currency);
  const [taxEnabled, setTaxEnabled] = useState(DEFAULT_BUSINESS.pricing.taxEnabled);
  const [taxRate, setTaxRate] = useState(DEFAULT_BUSINESS.pricing.taxRate);
  const [msg, setMsg] = useState("");

  /** New event state */
  const [newEventName, setNewEventName] = useState("");
  const [newEventNotes, setNewEventNotes] = useState("");

  const getTemplateSlotCount = (tpl) =>
    tpl.previewMeta?.slots?.length ?? 0;

  /** Template editor state */
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [isFrameModalOpen, setIsFrameModalOpen] = useState(false);
  const [isToneModalOpen, setIsToneModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [editingFrame, setEditingFrame] = useState(null);
  const [editingTone, setEditingTone] = useState(null);
  const [templateName, setTemplateName] = useState("");
  const [templateSlotsState, setTemplateSlotsState] = useState([]); // [{id,slotNumber,x,y,w,h,rotation}]
  const [templateError, setTemplateError] = useState("");
  const [thumbnailUploadPreview, setThumbnailUploadPreview] = useState(null);
  const [addTemplateToScreen, setAddTemplateToScreen] = useState(false);

  // State for new frame modal
  const [isNewFrameOpen, setIsNewFrameOpen] = useState(false);
  const [newFrameName, setNewFrameName] = useState("");

  // Add in top-level state (Frames section scope is OK; keep near isNewFrameOpen)
  const [isCreateFrameOpen, setIsCreateFrameOpen] = useState(false);
  const [createFrameName, setCreateFrameName] = useState("");
  const [createDraft, setCreateDraft] = useState({
    file: null, dataUrl: null, w: 0, h: 0, layout: "4x6", error: ""
  });

  // At the top of your component:
  const [editingFrameId, setEditingFrameId] = useState(null);
  const [editingName, setEditingName] = useState("");


  // helper: choose proper frame preview given layout
  const getFramePreviewForLayout = (frame, layout) =>
    frame?.previews?.[layout]?.originalDataUrl ??
    frame?.previews?.["4x6"]?.originalDataUrl ?? // fallback
    null;

  // Helper for IDs
  const persistFrames = async (nextFrames) => {
    setFrames(nextFrames);
    try {
      await native?.setFrames?.(nextFrames, ctx);
    } catch { }
    return nextFrames;
  };

  const persistEvents = async (nextEvents) => {
    setEvents(nextEvents);
    syncCurrentEventFromEvents(nextEvents);

    if (currentEvent?.id && !nextEvents.some((e) => e.id === currentEvent.id)) {
      setActiveMain("events");
    }

    try {
      await native?.setEvents?.(nextEvents, ctx);
    } catch { }
    return nextEvents;
  };

  const syncCurrentEventFromEvents = React.useCallback((nextEvents) => {
    if (!currentEvent?.id) return;
    const freshCurrent = nextEvents.find((e) => e.id === currentEvent.id) || null;
    setCurrentEvent(freshCurrent ? JSON.parse(JSON.stringify(freshCurrent)) : null);
  }, [currentEvent?.id]);

  const persistTemplates = async (nextTemplates) => {
    setTemplates(nextTemplates);
    try {
      await native?.setTemplates?.(nextTemplates, ctx);
    } catch { }
    return nextTemplates;
  };

  const persistPalettes = async (nextPalettes) => {
    setPalettes(nextPalettes);
    try {
      await native?.setPalettes?.(nextPalettes, ctx);
    } catch { }
    return nextPalettes;
  };

  const persistAll = async ({
    nextEvents = null,
    nextTemplates = null,
    nextFrames = null,
    nextPalettes = null,
  } = {}) => {
    if (nextTemplates) {
      setTemplates(nextTemplates);
      try { await native?.setTemplates?.(nextTemplates, ctx); } catch { }
    }

    if (nextFrames) {
      setFrames(nextFrames);
      try { await native?.setFrames?.(nextFrames, ctx); } catch { }
    }

    if (nextPalettes) {
      setPalettes(nextPalettes);
      try { await native?.setPalettes?.(nextPalettes, ctx); } catch { }
    }

    if (nextEvents) {
      setEvents(nextEvents);
      syncCurrentEventFromEvents(nextEvents);
      try { await native?.setEvents?.(nextEvents, ctx); } catch { }
    }

    // Debounced push to Supabase booth_settings table
    pushSettings({
      ...(nextEvents && { events: nextEvents }),
      ...(nextTemplates && { templates: nextTemplates }),
      ...(nextFrames && { frames: nextFrames }),
      ...(nextPalettes && { palettes: nextPalettes }),
    });
  };

  const toggleTemplateOnEvent = async (tpl) => {
    if (!currentEvent) return;

    const evCopy = JSON.parse(JSON.stringify(currentEvent));
    evCopy.appliedTemplates = evCopy.appliedTemplates ?? [];

    const alreadyApplied = evCopy.appliedTemplates.some((t) => t.id === tpl.id);

    if (alreadyApplied) {
      evCopy.appliedTemplates = evCopy.appliedTemplates.filter((t) => t.id !== tpl.id);
    } else {
      evCopy.appliedTemplates.push({
        id: tpl.id,
        name: tpl.name,
        previewMeta: tpl.previewMeta ?? null,
      });
    }

    const nextEvents = events.map((e) => (e.id === evCopy.id ? evCopy : e));
    await persistAll({ nextEvents });

    showToast(
      alreadyApplied
        ? `Removed "${tpl.name}" from ${evCopy.name}`
        : `Applied "${tpl.name}" to ${evCopy.name}`
    );
  };

  // toggletone
  // Preset Tones for Photo Booth
  const presetTones = [
    {
      id: "pb-bright",
      name: "Bright & Cheerful",
      previewMeta: {
        brightness: 1.2,
        contrast: 1.1,
        saturation: 1.3,
        hue: 0
      },
    },
    {
      id: "pb-vintage",
      name: "Vintage",
      previewMeta: {
        brightness: 0.9,
        contrast: 1.0,
        saturation: 0.7,
        hue: -10
      },
    },
    {
      id: "pb-blackwhite",
      name: "Black & White",
      previewMeta: {
        brightness: 1.0,
        contrast: 1.2,
        saturation: 0,
        hue: 0
      },
    },
    {
      id: "pb-cool",
      name: "Cool Tone",
      previewMeta: {
        brightness: 1.0,
        contrast: 1.0,
        saturation: 1.0,
        hue: 20
      },
    },
    {
      id: "pb-warm",
      name: "Warm Tone",
      previewMeta: {
        brightness: 1.1,
        contrast: 1.0,
        saturation: 1.1,
        hue: -15
      },
    },
    {
      id: "pb-party",
      name: "Party Pop",
      previewMeta: {
        brightness: 1.3,
        contrast: 1.2,
        saturation: 1.4,
        hue: 5
      },
    },
  ];

  const safeInvoke = async (channel, ...args) => {
    try {
      if (window.electron?.invoke) {
        return await window.electron.invoke(channel, ...args);
      }
      if (window.api?.invoke) {
        return await window.api.invoke(channel, ...args);
      }
      return null;
    } catch (err) {
      console.warn(`IPC call failed: ${channel}`, err);
      return null;
    }
  };

  const normalizePrinterList = (list) => {
    if (!Array.isArray(list)) return [];
    return list
      .filter(Boolean)
      .map((p) => ({
        name: p.name || p.displayName || "Unknown printer",
        displayName: p.displayName || p.name || "Unknown printer",
        isDefault: !!p.isDefault,
        status: p.status ?? null,
        options: p.options || {},
      }));
  };

  const clamp = (value, min, max, fallback) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };

  // Merge preset tones with custom tones in your component
  const allTones = [...presetTones, ...tones];

  const ctx = useMemo(() => ({ userId: identity.userId }), [identity.userId]);

  useEffect(() => {
    if (authLoading) return;

    if (!identity?.userId) {
      setEvents([]);
      setCurrentEvent(null);
      setHydrated(false);
      setAccountForm({
        displayName: "",
        email: "",
        phone: "",
        company: "",
        role: "Administrator",
        badgePhoto: "",
      });
      return;
    }

    loadAccountCenterData();
  }, [authLoading, identity?.userId, loadAccountCenterData]);

  const handleSaveFrame = async (frame) => {
    const existingIndex = frames.findIndex((f) => f.id === frame.id);

    const nextFrames =
      existingIndex !== -1
        ? frames.map((f) => (f.id === frame.id ? frame : f))
        : [...frames, frame];

    await persistAll({ nextFrames });

    return frame;
  };

  const handleCreateFrame = async (name) => {
    const trimmed = (name ?? "").trim();
    if (!trimmed) { notify(showToast, "Frame name is required."); return; }

    const exists = frames.some((f) => (f.name ?? "").trim().toLowerCase() === trimmed.toLowerCase());
    if (exists) { notify(showToast, "A frame with that name already exists."); return; }

    const newFrame = { id: makeId(), name: trimmed, previews: {} };
    const nextFrames = [newFrame, ...frames];
    await persistAll({ nextFrames });
    notify(showToast, `Created frame "${trimmed}".`);
  };

  const handleCreateFrameWithUpload = async ({ name, file, layout }) => {
    const trimmed = (name ?? "").trim();
    if (!trimmed) { notify(showToast, "Frame name is required."); return; }
    const err = validateImage(file); // existing helper
    if (err) { notify(showToast, err); return; }

    // Read image to get a stable DataURL
    const { dataUrl } = await readImageWH(file);

    // Build frame with a single layout populated
    const newFrame = {
      id: makeId(),   // you have this helper
      name: trimmed,
      previews: {
        [layout]: {
          originalDataUrl: dataUrl,
          fileName: file.name,
          updatedAt: new Date().toISOString(),
        },
      },
    };

    const nextFrames = [newFrame, ...frames];
    await persistAll({ nextFrames });
    notify(showToast, `Created frame "${trimmed}"`);
    return newFrame;
  };

  const handleDeleteFrame = async (frameId) => {
    // Optional confirm
    const ok = window.confirm?.("Delete this frame? This cannot be undone.");
    if (ok === false) return;

    const nextFrames = frames.filter((f) => f.id !== frameId);

    // Remove from appliedFrames in ALL events (including currentEvent)
    const updatedEvents = events.map((ev) => {
      const applied = (ev.appliedFrames || []).filter((af) => af.id !== frameId);
      return { ...ev, appliedFrames: applied };
    });

    await persistAll({
      nextFrames,
      nextEvents: updatedEvents
    });

    notify(showToast, "Frame deleted.");
  };

  const handleRenameFrame = async ({ frameId, newName }) => {
    const trimmed = (newName || "").trim();
    if (!trimmed) {
      notify(showToast, "Name cannot be empty.");
      return;
    }

    const nextFrames = frames.map((f) =>
      f.id === frameId ? { ...f, name: trimmed } : f
    );

    // Sync the name in appliedFrames snapshots across ALL events
    const updatedEvents = events.map((ev) => {
      const applied = (ev.appliedFrames || []).map((af) =>
        af.id === frameId ? { ...af, name: trimmed } : af
      );
      return { ...ev, appliedFrames: applied };
    });

    await persistAll({
      nextFrames,
      nextEvents: updatedEvents
    });

    setEditingFrameId(null);
    setEditingName("");
    notify(showToast, `Renamed frame to "${trimmed}".`);
  };

  /** Grid & snap */
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapPercent, setSnapPercent] = useState(1);
  const [showGrid, setShowGrid] = useState(true);

  /** Selection */
  const [selectionIds, setSelectionIds] = useState([]);
  const [aspectLock, setAspectLock] = useState(false);
  const [presetAspect, setPresetAspect] = useState(null);

  const [templateLayout, setTemplateLayout] = useState("4x6"); // "4x6" | "2x6"

  /** Delete confirmation */
  const [deleteTarget, setDeleteTarget] = useState(null);

  /** Autosave & toast */
  const [autosaveEnabled, setAutosaveEnabled] = useState(false);
  const autosaveTimer = useRef(null);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  /** Settings */
  /* ================= Settings State ================= */

  /* -------- Printer -------- */

  const refreshPrinters = async () => {
    setPrinterLoading(true);
    setPrinterError("");

    try {
      let found = [];

      if (typeof native?.getPrinters === "function") {
        found = await native.getPrinters();
      } else {
        found = await safeInvoke("printer:list");
      }

      const normalized = normalizePrinterList(found);
      setPrinters(normalized);

      if (!normalized.length) {
        setSelectedPrinter("");
        setPrinterOnline(false);
        setPrinterStatusText("No printers detected");
        showToast("No printers found");
        return;
      }

      const saved = (() => {
        try {
          return JSON.parse(localStorage.getItem("boothSettings") || "{}");
        } catch {
          return {};
        }
      })();

      const currentStillExists = normalized.some((p) => p.name === selectedPrinter);
      const savedPrinter = saved.selectedPrinter ?? "";
      const savedStillExists = normalized.some((p) => p.name === savedPrinter);

      let nextPrinter = "";

      if (currentStillExists) {
        nextPrinter = selectedPrinter;
      } else if (savedStillExists) {
        nextPrinter = savedPrinter;
      } else {
        nextPrinter = (normalized.find((p) => p.isDefault) || normalized[0])?.name || "";
      }

      if (nextPrinter !== selectedPrinter) {
        setSelectedPrinter(nextPrinter);
      }

      setPrinterOnline(true);
      setPrinterStatusText("Printer list refreshed");
    } catch (err) {
      console.error("refreshPrinters failed", err);
      setPrinters([]);
      setSelectedPrinter("");
      setPrinterOnline(false);
      setPrinterStatusText("Unable to load printers");
      setPrinterError(err?.message || "Unable to load printers from the native bridge."); // FIX 3: surface native bridge failure inline in settings UI.
      showToast("Failed to load printers");
    } finally {
      setPrinterLoading(false);
    }
  };

  const inferOrientationFromPaper = (paper) => {
    const value = String(paper || "").toLowerCase();

    if (value.includes("6x4")) return "Landscape";
    if (value.includes("4x6")) return "Portrait";
    if (value.includes("6x2")) return "Landscape";
    if (value.includes("2x6")) return "Portrait";

    return "Unknown";
  };

  const normalizeSystemPrinterSettings = (caps) => {
    const rawOrientation =
      caps?.orientation ||
      caps?.options?.orientation ||
      caps?.options?.printerOrientation ||
      "";

    const rawPaper =
      caps?.defaultPaperSize ||
      caps?.paperSize ||
      caps?.options?.paperSize ||
      caps?.options?.media ||
      caps?.options?.defaultMedia ||
      caps?.options?.pageSize ||
      "";

    const orientation =
      ["portrait", "landscape"].includes(String(rawOrientation).toLowerCase())
        ? String(rawOrientation).charAt(0).toUpperCase() +
        String(rawOrientation).slice(1).toLowerCase()
        : inferOrientationFromPaper(rawPaper);

    return {
      layout: rawPaper || "System default",
      orientation,
    };
  };

  const loadPrinterCapabilities = async (printerName) => {
    if (!printerName) {
      setPrinterCapabilities(null);
      setPrinterSystemLayout("Unknown");
      setPrinterSystemOrientation("Unknown");
      setPaperSizeOptions(CUSTOM_PAPER_SIZE_OPTIONS);
      return;
    }

    try {
      const caps = await safeInvoke("printer:get-capabilities", printerName);
      setPrinterCapabilities(caps || null);

      const normalized = normalizeSystemPrinterSettings(caps || {});
      setPrinterSystemLayout(normalized.layout);
      setPrinterSystemOrientation(normalized.orientation);

      const nextPaperOptions = extractPrinterPaperOptions(caps || {});
      setPaperSizeOptions(nextPaperOptions);

      const hasCurrentPaper = nextPaperOptions.some(
        (opt) => normalizePaperName(opt.value) === normalizePaperName(paperSize)
      );

      if (!hasCurrentPaper && nextPaperOptions.length) {
        setPaperSize(nextPaperOptions[0].value);
      }
    } catch (err) {
      console.warn("loadPrinterCapabilities failed", err);
      setPrinterCapabilities(null);
      setPrinterSystemLayout("Unknown");
      setPrinterSystemOrientation("Unknown");
      setPaperSizeOptions(CUSTOM_PAPER_SIZE_OPTIONS);
    }
  };

  const checkPrinterHealth = async () => {
    if (!selectedPrinter) {
      setPrinterOnline(false);
      setPrinterStatusText("No printer selected");
      showToast("Select a printer first");
      return;
    }

    setPrinterLoading(true);

    try {
      const status = await safeInvoke("printer:status", selectedPrinter);
      const online = !!status?.online;

      setPrinterOnline(online);
      setPrinterStatusText(
        status?.message ||
        status?.status ||
        (online ? "Printer is online" : "Printer is offline")
      );

      if (!status) {
        setPrinterStatusText("Printer status unavailable");
      }
    } catch (err) {
      console.error("checkPrinterHealth failed", err);
      setPrinterOnline(false);
      setPrinterStatusText("Printer status check failed");
      showToast("Failed to check printer status");
    } finally {
      setPrinterLoading(false);
    }
  };

  const testPrint = async () => {
    if (!selectedPrinter) {
      showToast("Select a printer first");
      return;
    }

    try {
      const result = await safeInvoke("printer:test", {
        printer: selectedPrinter,
        layout: "4x6", // safe booth layout for test output
        paperSize,
        colorMode: printColorMode,
        quality: printQuality,
        orientation: printOrientation,
        copies: printCopies,
        duplexMode: printDuplexMode,
        dpi: printDpi,
        usePrinterDefaults,
      });

      if (result?.ok === false) {
        showToast(result.error || "Test print failed");
        return;
      }

      showToast("Test print sent");
    } catch (err) {
      console.error("testPrint failed", err);
      showToast("Test print failed");
    }
  };

  /* -------- Storage -------- */
  const [storagePath, setStoragePath] = useState("");
  const [autoDeleteDays, setAutoDeleteDays] = useState(14);
  const [storageLoading, setStorageLoading] = useState(false);
  const [storageStatusText, setStorageStatusText] = useState("No storage folder selected");
  const [storageInfo, setStorageInfo] = useState(null);

  const loadStorageInfo = async (pathOverride = storagePath) => {
    if (!pathOverride) {
      setStorageInfo(null);
      setStorageStatusText("No storage folder selected");
      return;
    }

    try {
      const info = await safeInvoke("storage:info", pathOverride);

      if (!info) {
        setStorageInfo(null);
        setStorageStatusText("Storage inspection unavailable");
        return;
      }

      if (info.ok === false) {
        setStorageInfo(null);
        setStorageStatusText(info.error || "Unable to validate storage folder");
        return;
      }

      setStorageInfo(info);
      setStorageStatusText(info.message || "Storage folder checked");
    } catch (err) {
      console.error("loadStorageInfo failed", err);
      setStorageInfo(null);
      setStorageStatusText("Unable to validate storage folder");
    }
  };

  const selectStoragePath = async () => {
    setStorageLoading(true);
    try {
      const path = await window.electron.invoke("storage:select");
      if (!path) return;

      setStoragePath(path);
      await loadStorageInfo(path);

      const nextSettings = sanitizeSettings({
        selectedCameraId,
        mirrorCamera,
        cameraResolution,
        cameraWidth,
        cameraHeight,
        facingMode,
        selectedPrinter,
        paperSize,
        printCopies,
        printColorMode,
        printQuality,
        printOrientation,
        printDuplexMode,
        printDpi,
        usePrinterDefaults,
        storagePath: path,
        autoDeleteDays,
        dimWhenIdle,
        idleTimeout,
        launchOnStartup,
        autoRestart,
        autoUpdateEnabled,
        countdown,
        retakeLimit,
        screenTimers,
        numberOfShots,
        flashEnabled,
        soundEnabled,
        language,
        price,
        appMode,
        timersEnabled,
        rental: {
          timerEnabled: rentalTimerEnabled,
          timerHours: rentalTimerHours,
          sessionLimitEnabled: rentalSessionLimitEnabled,
          sessionLimit: rentalSessionLimit,
          offlineModeEnabled,
          autoSaveTarget,
          endSessionSummaryEnabled,
        },
        business: {
          paymentEnabled,
          payment: { providers: { ...paymentProviders } },
          pricing: {
            model: pricingModel,
            pricePerSession,
            additionalPrintPrice,
            currency,
            taxEnabled,
            taxRate,
          },
        },
      });

      localStorage.setItem("boothSettings", JSON.stringify(nextSettings));
      await native?.setSettings?.(nextSettings);

      showToast("Storage folder updated");
    } catch (err) {
      console.error("selectStoragePath failed", err);
      setStorageStatusText("Failed to choose storage folder");
      showToast("Failed to choose folder");
    } finally {
      setStorageLoading(false);
    }
  };

  const runStorageCleanup = async () => {
    try {
      const result = await safeInvoke("storage:cleanup", {
        path: storagePath,
        autoDeleteDays,
      });

      if (!result) {
        showToast("Storage cleanup is unavailable");
        return;
      }

      if (result.ok === false) {
        showToast(result.error || "Cleanup failed");
        return;
      }

      showToast(result.message || "Storage cleanup completed");
      await loadStorageInfo();
    } catch (err) {
      console.error("runStorageCleanup failed", err);
      showToast("Cleanup failed");
    }
  };

  /* -------- General / Idle -------- */
  const [dimWhenIdle, setDimWhenIdle] = useState(true);
  const [idleTimeout, setIdleTimeout] = useState(60);
  const [cameraWidth, setCameraWidth] = useState(1920);
  const [cameraHeight, setCameraHeight] = useState(1080);
  const [facingMode, setFacingMode] = useState("user");

  const handleIdleTimeoutChange = (value) => {
    setIdleTimeout(clamp(value, 5, 3600, 60));
  };

  const generalStatusText = !dimWhenIdle
    ? "Idle dimming is disabled"
    : `Screen dims after ${idleTimeout} seconds of inactivity`;

  /* -------- Audit & Logs -------- */
  const [logsLoading, setLogsLoading] = useState(false);
  const [lastExportedLogPath, setLastExportedLogPath] = useState("");
  const [logsStatusText, setLogsStatusText] = useState("Ready to export logs");

  const exportLogs = async () => {
    setLogsLoading(true);

    try {
      const logPath = await window.electron.invoke("log:export");

      if (!logPath) {
        setLogsStatusText("Log export cancelled");
        return;
      }

      setLastExportedLogPath(logPath);
      setLogsStatusText("Logs exported successfully");
      showToast(`Logs exported: ${logPath}`);
    } catch (err) {
      console.error("exportLogs failed", err);
      setLogsStatusText("Log export failed");
      showToast("Failed to export logs");
    } finally {
      setLogsLoading(false);
    }
  };

  const clearLogs = async () => {
    try {
      const result = await safeInvoke("log:clear");
      if (result?.ok === false) {
        showToast(result.error || "Failed to clear logs");
        return;
      }

      setLogsStatusText("Logs cleared");
      showToast("Logs cleared");
    } catch (err) {
      console.error("clearLogs failed", err);
      showToast("Failed to clear logs");
    }
  };

  /* -------- Startup & Recovery -------- */
  const [systemLoading, setSystemLoading] = useState(false);
  const [updateStatusText, setUpdateStatusText] = useState("No update check yet");
  const [updateState, setUpdateState] = useState("idle");
  const [updatePercent, setUpdatePercent] = useState(0);
  const [cacheStatusText, setCacheStatusText] = useState("Cache status unknown");
  const [launchOnStartup, setLaunchOnStartup] = useState(true);

  const toggleLaunchOnStartup = async (enabled) => {
    try {
      setLaunchOnStartup(enabled);
      const result = await window.electron.invoke("startup:set", enabled);

      if (result?.ok === false) {
        setLaunchOnStartup(!enabled);
        showToast(result.error || "Failed to update startup setting");
      }
    } catch (err) {
      console.error("toggleLaunchOnStartup failed", err);
      setLaunchOnStartup(!enabled);
      showToast("Failed to update startup setting");
    }
  };

  const [autoRestart, setAutoRestart] = useState(true);

  /* -------- Save Settings -------- */
  const saveSettings = async () => {
    const rawSettings = {
      // CAMERA
      selectedCameraId,
      mirrorCamera,
      cameraResolution,
      cameraWidth,
      cameraHeight,
      facingMode,

      // CAPTURE
      flashEnabled,
      soundEnabled,

      // PRINTING
      selectedPrinter,
      paperSize,
      printCopies: clamp(printCopies, 1, 20, 1),
      printColorMode,
      printQuality,
      printOrientation,
      printDuplexMode,
      printDpi,
      usePrinterDefaults,

      // STORAGE
      storagePath,
      autoDeleteDays,

      // GENERAL
      dimWhenIdle,
      idleTimeout,

      // SYSTEM
      launchOnStartup,
      autoRestart,
      autoUpdateEnabled,

      // BOOTH IDENTITY
      boothIdentityName,
      boothLocation,
      operatorName,

      // EXISTING BOOTH FLOW SETTINGS
      countdown,
      retakeLimit,
      screenTimers,
      numberOfShots,
      language,
      price,
      appMode,
      timersEnabled,
      rental: {
        timerEnabled: rentalTimerEnabled,
        timerHours: rentalTimerHours,
        sessionLimitEnabled: rentalSessionLimitEnabled,
        sessionLimit: rentalSessionLimit,
        offlineModeEnabled,
        autoSaveTarget,
        endSessionSummaryEnabled,
      },
      business: {
        paymentEnabled,
        payment: { providers: { ...paymentProviders } },
        pricing: {
          model: pricingModel,
          pricePerSession,
          additionalPrintPrice,
          currency,
          taxEnabled,
          taxRate,
        },
      },
    };

    const settings = sanitizeSettings(rawSettings);

    localStorage.setItem("boothSettings", JSON.stringify(settings));
    await native?.setSettings?.(settings);

    pushSettings({ settings });

    // Re-apply sanitized values to state so UI immediately reflects clamped values
    setPrintCopies(settings.printCopies);
    setPrintDpi(settings.printDpi);
    setCountdown(settings.countdown);
    setRetakeLimit(settings.retakeLimit);
    setNumberOfShots(settings.numberOfShots);
    setIdleTimeout(settings.idleTimeout);
    setAutoDeleteDays(settings.autoDeleteDays);
    setBoothIdentityName(settings.boothIdentityName ?? "");
    setBoothLocation(settings.boothLocation ?? "");
    setOperatorName(settings.operatorName ?? "");

    notify(showToast, "Settings saved");

    // Also apply to the current event if one is loaded,
    // so PhotoBooth (which reads event.settings) picks it up.
    if (currentEvent) {
      const updatedEvent = {
        ...currentEvent,
        settings,
      };
      const updatedEvents = events.map((e) =>
        e.id === updatedEvent.id ? updatedEvent : e
      );

      await persistEvents(updatedEvents);
      notify(showToast, "Event settings updated");
    }
  };

  useEffect(() => {
    if (activeMain === "settings" && activeSettingsTab === "printing") {
      refreshPrinters();
    }
  }, [activeMain, activeSettingsTab]);

  useEffect(() => {
    if (selectedPrinter) {
      loadPrinterCapabilities(selectedPrinter);
      checkPrinterHealth();
    } else {
      setPrinterCapabilities(null);
      setPrinterOnline(false);
      setPrinterStatusText("No printer selected");
    }
  }, [selectedPrinter]);

  const loadSettingsFromStorage = useCallback(async () => {
    try {
      let s = null;

      if (native?.getSettings && identity?.userId) {
        s = await native.getSettings({ userId: identity.userId });
      }

      if (!s) {
        const saved = localStorage.getItem("boothSettings");
        if (!saved) return;
        s = JSON.parse(saved);
      }

      // CAMERA
      setSelectedCameraId(s.selectedCameraId ?? "");
      setMirrorCamera(s.mirrorCamera ?? false);
      setCameraResolution(s.cameraResolution ?? "1080p");
      setCameraWidth(s.cameraWidth ?? 1920);
      setCameraHeight(s.cameraHeight ?? 1080);
      setFacingMode(s.facingMode ?? "user");

      // CAPTURE
      setFlashEnabled(s.flashEnabled ?? true);
      setSoundEnabled(s.soundEnabled ?? true);

      // PRINTING
      setSelectedPrinter(s.selectedPrinter ?? "");
      setPaperSize(s.paperSize ?? "4x6");
      setPrintCopies(s.printCopies ?? 1);
      setPrintColorMode(s.printColorMode ?? "color");
      setPrintQuality(s.printQuality ?? "high");
      setPrintOrientation(s.printOrientation ?? "landscape");
      setPrintDuplexMode(s.printDuplexMode ?? "simplex");
      setPrintDpi(s.printDpi ?? 300);
      setUsePrinterDefaults(s.usePrinterDefaults ?? false);

      // STORAGE
      setStoragePath(s.storagePath ?? "");
      setAutoDeleteDays(s.autoDeleteDays ?? 14);

      // GENERAL
      setDimWhenIdle(s.dimWhenIdle ?? true);
      setIdleTimeout(s.idleTimeout ?? 60);
      setLanguage(s.language ?? "en");

      // BOOTH IDENTITY
      setBoothIdentityName(s.boothIdentityName ?? "");
      setBoothLocation(s.boothLocation ?? "");
      setOperatorName(s.operatorName ?? "");

      // SYSTEM
      setLaunchOnStartup(s.launchOnStartup ?? true);
      setAutoRestart(s.autoRestart ?? true);
      setAutoUpdateEnabled(s.autoUpdateEnabled ?? true);

      // FLOW
      setCountdown(s.countdown ?? 5);
      setRetakeLimit(s.retakeLimit ?? 0);
      setScreenTimers(s.screenTimers ?? DEFAULT_SCREEN_TIMERS);
      setNumberOfShots(s.numberOfShots ?? 3);
      setPrice(s.price ?? 0);
      setAppMode(s.appMode ?? DEFAULT_APP_MODE);
      setTimersEnabled(s.timersEnabled ?? false);

      // RENTAL
      setRentalTimerEnabled(s.rental?.timerEnabled ?? DEFAULT_RENTAL.timerEnabled);
      setRentalTimerHours(s.rental?.timerHours ?? DEFAULT_RENTAL.timerHours);
      setRentalSessionLimitEnabled(s.rental?.sessionLimitEnabled ?? DEFAULT_RENTAL.sessionLimitEnabled);
      setRentalSessionLimit(s.rental?.sessionLimit ?? DEFAULT_RENTAL.sessionLimit);
      setOfflineModeEnabled(s.rental?.offlineModeEnabled ?? DEFAULT_RENTAL.offlineModeEnabled);
      setAutoSaveTarget(s.rental?.autoSaveTarget ?? DEFAULT_RENTAL.autoSaveTarget);
      setEndSessionSummaryEnabled(s.rental?.endSessionSummaryEnabled ?? DEFAULT_RENTAL.endSessionSummaryEnabled);

      // BUSINESS
      setPaymentEnabled(s.business?.paymentEnabled ?? DEFAULT_BUSINESS.paymentEnabled);
      setPaymentProviders(s.business?.payment?.providers ?? { ...DEFAULT_BUSINESS.payment.providers });
      setPricingModel(s.business?.pricing?.model ?? DEFAULT_BUSINESS.pricing.model);
      setPricePerSession(s.business?.pricing?.pricePerSession ?? DEFAULT_BUSINESS.pricing.pricePerSession);
      setAdditionalPrintPrice(s.business?.pricing?.additionalPrintPrice ?? DEFAULT_BUSINESS.pricing.additionalPrintPrice);
      setCurrency(s.business?.pricing?.currency ?? DEFAULT_BUSINESS.pricing.currency);
      setTaxEnabled(s.business?.pricing?.taxEnabled ?? DEFAULT_BUSINESS.pricing.taxEnabled);
      setTaxRate(s.business?.pricing?.taxRate ?? DEFAULT_BUSINESS.pricing.taxRate);
    } catch (err) {
      console.error("Failed to restore settings", err);
    }
  }, [identity?.userId, native]);

  useEffect(() => {
    loadSettingsFromStorage();
  }, [loadSettingsFromStorage]);

  useEffect(() => {
    if (activeMain === "settings") {
      loadSettingsFromStorage();
    }
  }, [activeMain]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeMain === "settings" && activeSettingsTab === "camera") {
      refreshCameras();
    }
  }, [activeMain, activeSettingsTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const plan = license?.plan ?? gating?.plan ?? null; // null | 'trial' | 'monthly' | 'yearly'
  const ent = license?.entitlements ?? {};
  const expiresAt = license?.expiresAt ?? 0;
  const eventLimit = Number(gating?.maxEvents ?? ent?.maxEvents ?? 1);
  const templateLimit = Number(gating?.templates ?? ent?.templates ?? 1);
  const galleryAddonEnabled = Boolean(gating?.galleryEnabled || gating?.galleryAddon || ent?.galleryEnabled || ent?.galleryAddon);
  const settingsToSave = sanitizeSettings({
    selectedCameraId,
    mirrorCamera,
    cameraResolution,
    cameraWidth,
    cameraHeight,
    facingMode,
    selectedPrinter,
    paperSize,
    printCopies,
    printColorMode,
    printQuality,
    printOrientation,
    printDuplexMode,
    printDpi,
    usePrinterDefaults,
    storagePath,
    autoDeleteDays,
    dimWhenIdle,
    idleTimeout,
    launchOnStartup,
    autoRestart,
    autoUpdateEnabled,
    countdown,
    retakeLimit,
    screenTimers,
    numberOfShots,
    flashEnabled,
    soundEnabled,
    language,
    price,
    appMode,
    timersEnabled,
    rental: {
      timerEnabled: rentalTimerEnabled,
      timerHours: rentalTimerHours,
      sessionLimitEnabled: rentalSessionLimitEnabled,
      sessionLimit: rentalSessionLimit,
      offlineModeEnabled,
      autoSaveTarget,
      endSessionSummaryEnabled,
    },
    business: {
      paymentEnabled,
      payment: { providers: { ...paymentProviders } },
      pricing: {
        model: pricingModel,
        pricePerSession,
        additionalPrintPrice,
        currency,
        taxEnabled,
        taxRate,
      },
    },
  });

  // Define trial eligibility:
  // Eligible only if not on paid plan and not redeemed/expired
  const hasPaidPlan = plan === "monthly" || plan === "yearly";
  const alreadyRedeemedOrExpired =
    Boolean(license?.trialRedeemed) || Boolean(license?.trialExpired);
  const trialEligible = !hasPaidPlan && !alreadyRedeemedOrExpired;

  // ===== Supabase-aware billing and license adapters =====

  async function fallbackCreateCheckoutSession(plan) {
    if (typeof licensingApi.createCheckoutSession === "function") {
      return licensingApi.createCheckoutSession(plan);
    }

    throw new Error("createCheckoutSession is not available.");
  }

  async function fallbackCustomerPortal() {
    if (typeof licensingApi.customerPortal === "function") {
      return licensingApi.customerPortal();
    }

    throw new Error("customerPortal is not available.");
  }

  async function fallbackRedeemTrial() {
    if (typeof licensingApi.redeemTrial === "function") return licensingApi.redeemTrial();
    throw new Error("redeemTrial is not available.");
  }

  async function fallbackLicenseStatus() {
    if (typeof licensingApi.licenseStatus === "function") return licensingApi.licenseStatus();
    throw new Error("licenseStatus is not available.");
  }

  // 1) Extract your existing initial fetch into a function
  const loadPersisted = React.useCallback(async (userId) => {
    if (!native || !userId) return;
    const ctx = { userId };

    // Init Supabase settings sync and pull cloud data into electron-store
    initSettingsSync(userId);
    try { await pullSettings(); } catch { /* non-fatal */ }

    try {
      const [
        persistedEvents, appearance, settings,
        persistedTemplates, persistedFrames, persistedTones, persistedPalettes,
        currentEventId, currentSubTab
      ] = await Promise.all([
        native.getEvents?.(ctx),
        native.getAppearance?.(ctx),
        native.getSettings?.(ctx),
        native.getTemplates?.(ctx),
        native.getFrames?.(ctx),
        native.getTones?.(ctx),
        native.getPalettes?.(ctx),
        native.getCurrentEventId?.(),
        native.getCurrentSubTab?.(),
      ]);

      // Events
      if (Array.isArray(persistedEvents)) setEvents(persistedEvents);

      // Appearance
      if (appearance) {
        setLogoPath(appearance.logoPath ? { url: appearance.logoPath, name: "logo", previewUrl: appearance.logoPath } : null);
        setBackgroundMediaPath(
          appearance.backgroundMediaPath
            ? {
              url: appearance.backgroundMediaPath,
              name: appearance.backgroundMediaName ?? "background",
              previewUrl: appearance.backgroundMediaPath,
              mime: appearance.backgroundMediaMime ?? "",
            }
            : null
        );
        setBoothName(appearance.boothName ?? "");
        setBoothSlogan(appearance.boothSlogan ?? "");
        setHeaderFont(appearance.headerFont ?? "Inter");
        setGeneralFont(appearance.generalFont ?? "Inter");
        setHeaderFontColor(appearance.headerFontColor ?? "#111827");
        setGeneralFontColor(appearance.generalFontColor ?? "#374151");
        setBgColor(appearance.bgColor ?? "#ffffff");
        setButtonBgColor(appearance.buttonBgColor ?? ACCENT_COLOR);
        setButtonHoverColor(appearance.buttonHoverColor ?? "#5348ff");
        setbuttonFont(appearance.buttonFont ?? "Inter");
        setButtonFontColor(appearance.buttonFontColor ?? "#ffffff");
        setStartButtonHidden(!!appearance.startButtonHidden);
        setStartButtonText(appearance.startButtonText ?? "Tap to Start");
        setSelectedBgColorId(appearance.selectedBgColorId ?? null);
      }

      // Settings
      if (settings) {
        // Camera
        setSelectedCameraId(settings.selectedCameraId ?? "");
        setMirrorCamera(settings.mirrorCamera ?? false);
        setCameraResolution(settings.cameraResolution ?? "1080p");
        setCameraWidth(settings.cameraWidth ?? 1920);
        setCameraHeight(settings.cameraHeight ?? 1080);
        setFacingMode(settings.facingMode ?? "user");

        // Capture
        setFlashEnabled(settings.flashEnabled ?? true);
        setSoundEnabled(settings.soundEnabled ?? true);

        // Printing
        setSelectedPrinter(settings.selectedPrinter ?? "");
        setPaperSize(settings.paperSize ?? "4x6");
        setPrintCopies(settings.printCopies ?? 1);
        setPrintColorMode(settings.printColorMode ?? "color");
        setPrintQuality(settings.printQuality ?? "high");
        setPrintOrientation(settings.printOrientation ?? "landscape");
        setPrintDuplexMode(settings.printDuplexMode ?? "simplex");
        setPrintDpi(settings.printDpi ?? 300);
        setUsePrinterDefaults(settings.usePrinterDefaults ?? false);

        // Storage
        setStoragePath(settings.storagePath ?? "");
        setAutoDeleteDays(settings.autoDeleteDays ?? 14);

        // General
        setDimWhenIdle(settings.dimWhenIdle ?? true);
        setIdleTimeout(settings.idleTimeout ?? 60);
        setLanguage(settings.language ?? "en");

        // Booth identity
        setBoothIdentityName(settings.boothIdentityName ?? "");
        setBoothLocation(settings.boothLocation ?? "");
        setOperatorName(settings.operatorName ?? "");

        // System
        setLaunchOnStartup(settings.launchOnStartup ?? true);
        setAutoRestart(settings.autoRestart ?? true);
        setAutoUpdateEnabled(settings.autoUpdateEnabled ?? true);

        // Flow
        setCountdown(settings.countdown ?? 5);
        setRetakeLimit(settings.retakeLimit ?? 0);
        setScreenTimers(settings.screenTimers ?? DEFAULT_SCREEN_TIMERS);
        setNumberOfShots(settings.numberOfShots ?? 3);
        setPrice(settings.price ?? 0);
        setAppMode(settings.appMode ?? DEFAULT_APP_MODE);
        setTimersEnabled(settings.timersEnabled ?? false);

        // Rental
        const rental = settings.rental ?? {};
        setRentalTimerEnabled(rental.timerEnabled ?? DEFAULT_RENTAL.timerEnabled);
        setRentalTimerHours(rental.timerHours ?? DEFAULT_RENTAL.timerHours);
        setRentalSessionLimitEnabled(rental.sessionLimitEnabled ?? DEFAULT_RENTAL.sessionLimitEnabled);
        setRentalSessionLimit(rental.sessionLimit ?? DEFAULT_RENTAL.sessionLimit);
        setOfflineModeEnabled(rental.offlineModeEnabled ?? DEFAULT_RENTAL.offlineModeEnabled);
        setAutoSaveTarget(rental.autoSaveTarget ?? DEFAULT_RENTAL.autoSaveTarget);
        setEndSessionSummaryEnabled(rental.endSessionSummaryEnabled ?? DEFAULT_RENTAL.endSessionSummaryEnabled);

        // Business
        const business = settings.business ?? {};
        setPaymentEnabled(business.paymentEnabled ?? DEFAULT_BUSINESS.paymentEnabled);
        const prov = business.payment?.providers ?? DEFAULT_BUSINESS.payment.providers;
        setPaymentProviders({
          gcash: !!prov.gcash,
          paypal: !!prov.paypal,
          stripe: !!prov.stripe,
          cash: prov.cash ?? true,
        });
        const pricing = business.pricing ?? DEFAULT_BUSINESS.pricing;
        setPricingModel(pricing.model ?? DEFAULT_BUSINESS.pricing.model);
        setPricePerSession(pricing.pricePerSession ?? DEFAULT_BUSINESS.pricing.pricePerSession);
        setAdditionalPrintPrice(pricing.additionalPrintPrice ?? DEFAULT_BUSINESS.pricing.additionalPrintPrice);
        setCurrency(pricing.currency ?? DEFAULT_BUSINESS.pricing.currency);
        setTaxEnabled(pricing.taxEnabled ?? DEFAULT_BUSINESS.pricing.taxEnabled);
        setTaxRate(pricing.taxRate ?? DEFAULT_BUSINESS.pricing.taxRate);
      }

      // Templates / Frames / Tones / Palettes
      if (Array.isArray(persistedTemplates)) setTemplates(persistedTemplates);
      if (Array.isArray(persistedFrames)) setFrames(persistedFrames);
      if (Array.isArray(persistedTones)) setTones(persistedTones);
      if (Array.isArray(persistedPalettes)) setPalettes(persistedPalettes);

      // Restore current event + sub-tab
      if (currentEventId != null && Array.isArray(persistedEvents)) {
        const found = persistedEvents.find((e) => e.id === currentEventId);
        if (found) {
          setCurrentEvent(JSON.parse(JSON.stringify(found)));
          setActiveMain("dashboard");
          setActiveSub(currentSubTab ?? "branding");
        }
      }

      setHydrated(true);
    } catch (err) {
      console.error('loadPersisted error', err);
    }
  }, [native]);


  /** Canvas refs (Templates editor) */
  const canvasRef = useRef(null);
  const pointerState = useRef({ mode: null, slotId: null, start: null, orig: null, handle: null });
  const rotatingRef = useRef(null);

  const asSelectValue = (v) => (typeof v === 'string' ? v : v ?? '');

  /** Card classes */
  // UPDATED: composed tokens to be consistent with screenshot style
  const cardClass = `${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} p-4 mt-4 ${SHADOW_SOFT}`;
  const smallCardClass = `${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-3 ${SHADOW_SOFT}`;

  /** Light helpers */
  const showToast = (message, ms = 1600) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), ms);
  };

  // This is the function the editor expects:

  // Save from TemplateEditor (persists multi-frame selection + optional apply)
  const handleSaveTemplatePayload = async (payload) => {
    const pm = payload?.previewMeta ?? {};
    const nextPreviewMeta = {
      ...pm,
      attachedFrameIds: Array.isArray(pm.attachedFrameIds) ? pm.attachedFrameIds : [],
      activeFrameId: pm.activeFrameId ?? null,
    };

    let nextTemplates = templates;
    let templateRef = null;

    if (editingTemplate) {
      templateRef = {
        id: editingTemplate.id,
        name: payload.name,
        previewMeta: nextPreviewMeta,
      };

      nextTemplates = templates.map((t) =>
        t.id === editingTemplate.id
          ? { ...t, name: payload.name, previewMeta: nextPreviewMeta }
          : t
      );
    } else {
      const newTemplate = {
        id: crypto.randomUUID(),
        name: payload.name,
        previewMeta: nextPreviewMeta,
      };

      templateRef = {
        id: newTemplate.id,
        name: newTemplate.name,
        previewMeta: nextPreviewMeta,
      };

      nextTemplates = [...templates, newTemplate];
    }

    let nextEvents = null;

    if (payload.applyToCurrentEvent && currentEvent && templateRef) {
      const ev = JSON.parse(JSON.stringify(currentEvent));
      ev.appliedTemplates = ev.appliedTemplates ?? [];

      if (!ev.appliedTemplates.find((x) => x.id === templateRef.id)) {
        ev.appliedTemplates.push(templateRef);
      }

      nextEvents = events.map((e) => (e.id === ev.id ? ev : e));
    }

    await persistAll({
      nextTemplates,
      nextEvents,
    });

    if (payload.applyToCurrentEvent && currentEvent) {
      showToast?.("Template applied to current event");
    }

    setIsTemplateModalOpen(false);
    setEditingTemplate(null);
  };

  // ⬇️ Replace handleCanvasBackgroundPointerDown with:
  const handleCanvasBackgroundPointerDown = React.useCallback(
    (ev) => {
      const target = ev.target;
      const isInsideSlot = !!(target && target.closest && target.closest('[data-is-slot="true"]'));
      if (!isInsideSlot) {
        setSelectionIds([]);
        // Clear any active pointer interaction
        pointerState.current = { mode: null, slotId: null, start: null, orig: null, handle: null };
        try {
          ev.target?.releasePointerCapture?.(ev.pointerId);
        } catch { }
      }
    },
    [setSelectionIds]
  );

  const updateAccountField = (key, value) => {
    setAccountForm((prev) => ({ ...prev, [key]: value }));
  };

  const updatePasswordField = (key, value) => {
    setPasswordForm((prev) => ({ ...prev, [key]: value }));
  };

  const updateAccountPreference = (key, value) => {
    setAccountPreferences((prev) => ({ ...prev, [key]: value }));
  };

  const chooseBadgePhoto = async () => {
    try {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";

      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;

        setProfileSaving(true);
        try {
          // Upload through the embedded server (service role) so storage policies
          // and profile update both use admin credentials — no RLS surprises.
          const result = await licensingApi.uploadAvatar(file);
          const publicUrl = result?.avatar_url;
          setAccountForm((prev) => ({ ...prev, badgePhoto: publicUrl }));
          showToast?.("Badge photo updated");
        } catch (err) {
          console.error(err);
          showToast?.(err?.message || "Failed to save badge photo");
        } finally {
          setProfileSaving(false);
        }
      };

      input.click();
    } catch (err) {
      console.error(err);
      showToast?.("Unable to open file picker");
    }
  };

  const saveAccountProfile = async () => {
    if (!user?.id) return;
    setProfileSaving(true);

    try {
      const patch = {
        full_name: accountForm.displayName?.trim() || "",
        email: accountForm.email?.trim() || "",
        phone: accountForm.phone?.trim() || "",
        company: accountForm.company?.trim() || "",
        avatar_url: accountForm.badgePhoto || "",
      };

      // Use the embedded API server (service role) — avoids anon-client RLS issues.
      const result = await licensingApi.updateUserProfile(patch);
      const data = result?.profile || null;

      setAccountForm((prev) => ({
        ...prev,
        displayName: data?.full_name || patch.full_name || prev.displayName,
        email: data?.email || patch.email || prev.email,
        phone: data?.phone || patch.phone || prev.phone,
        company: data?.company || patch.company || prev.company,
        badgePhoto: data?.avatar_url || patch.avatar_url || prev.badgePhoto,
      }));

      showToast?.("Profile saved");
    } catch (err) {
      console.error(err);
      showToast?.(err?.message || "Failed to save profile");
    } finally {
      setProfileSaving(false);
    }
  };

  const changePassword = async () => {
    if (!passwordForm.currentPassword) {
      showToast?.("Enter your current password");
      return;
    }
    if (!passwordForm.newPassword || !passwordForm.confirmPassword) {
      showToast?.("Complete the new password fields");
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      showToast?.("New password and confirm password do not match");
      return;
    }
    if (passwordForm.newPassword.length < 8) {
      showToast?.("New password must be at least 8 characters");
      return;
    }

    setPasswordSaving(true);
    try {
      // The embedded server verifies currentPassword via Supabase signInWithPassword
      // before calling the admin API to change it — current password is never skipped.
      await Promise.race([
        licensingApi.changePassword(passwordForm.currentPassword, passwordForm.newPassword),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Request timed out. Check your connection.")), 20000)
        ),
      ]);

      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      showToast?.("Password changed");
    } catch (e) {
      console.error(e);
      showToast?.(e?.message || "Failed to change password");
    } finally {
      setPasswordSaving(false);
    }
  };

  const loadBooths = useCallback(async () => {
    if (!user?.id) return;
    setBoothsLoading(true);
    try {
      const { data, error } = await supabase
        .from('booths')
        .select('*')
        .eq('user_id', user.id)
        .order('last_seen_at', { ascending: false });

      if (!error) setBooths(data || []);
    } catch (err) {
      console.error('loadBooths failed:', err);
    } finally {
      setBoothsLoading(false);
    }
  }, [user?.id]);

  // Subscribe to real-time booth status changes
  useEffect(() => {
    if (!user?.id) return;

    loadBooths();

    const channel = supabase
      .channel('booths-status')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'booths', filter: `user_id=eq.${user.id}` },
        () => loadBooths()  // reload whenever any booth row changes
      )
      .subscribe();

    return () => { channel.unsubscribe(); };
  }, [user?.id, loadBooths]);

  // Send a command to a specific booth
  const sendCommandToBooth = async (boothId, action, payload = {}) => {
    try {
      const { sendRemoteCommand } = await import('../services/remoteControl');
      const result = await sendRemoteCommand(boothId, action, payload);
      if (result?.ok) {
        showToast(`Command "${action}" sent to booth`);
      } else {
        showToast(result?.error || `Failed to send "${action}"`);
      }
    } catch (err) {
      console.error('sendCommandToBooth failed:', err);
      showToast(`Failed to send "${action}"`);
    }
  };

  const saveAccountPreferences = async () => {
    setPrefsSaving(true);
    try {
      const res = await window.electron?.saveAccountPreferences?.(accountPreferences);
      if (res?.ok) {
        showToast?.("Preferences saved");
      } else {
        showToast?.(res?.error || "Failed to save preferences");
      }
    } catch (err) {
      console.error(err);
      showToast?.("Failed to save preferences");
    } finally {
      setPrefsSaving(false);
    }
  };

  const profileImage =
    accountForm?.badgePhoto ||
    user?.user_metadata?.avatar_url ||
    user?.photoURL ||
    user?.avatar ||
    "";

  const sidebarDisplayName =
    accountForm?.displayName?.trim() ||
    profile?.full_name ||
    user?.user_metadata?.full_name ||
    user?.email ||
    identity?.username ||
    "User";

  const sidebarEmail =
    accountForm?.email?.trim() ||
    user?.email ||
    "Admin account";

  const sidebarInitial = sidebarDisplayName.charAt(0).toUpperCase();

  const renderAccountBilling = () => (
    <div className="space-y-6">
      {/* HERO — gradient header matching AuthGate */}
      <div className="relative overflow-hidden rounded-3xl border border-white/20 bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-700 px-6 py-7 text-white shadow-[0_24px_64px_rgba(79,70,229,0.25)]">
        <WavePattern />
        <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white">
              Account Center
            </div>
            <h2 className="mt-3 text-2xl font-bold tracking-tight" style={{ fontFamily: '"Fraunces", ui-serif, Georgia, serif' }}>
              {user?.user_metadata?.full_name || user?.email || "Your account"} 👋
            </h2>
            <p className="mt-1.5 text-sm text-white/80">
              Manage your profile, security, preferences, and subscription from one place.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${(license?.active || gating?.allow) ? "bg-emerald-100 text-emerald-700" : trialEligible ? "bg-amber-100 text-amber-700" : "bg-white/20 text-white"}`}>
              {(license?.active || gating?.allow) ? "Licensed" : trialEligible ? "Trial available" : "No active plan"}
            </span>
            {(license?.active || gating?.allow) && (
              <button
                onClick={() => {
                  fallbackCustomerPortal()
                    .then(({ url }) => {
                      if (url) {
                        window.system?.openExternal?.(url) ?? window.open(url, "_blank", "noopener,noreferrer");
                      } else {
                        showToast?.("Portal URL not returned");
                      }
                    })
                    .catch((e) => { showToast?.(`Open portal failed: ${e?.message ?? "unknown error"}`); });
                }}
                className="inline-flex items-center justify-center rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-indigo-700 shadow-md transition hover:-translate-y-0.5 hover:shadow-lg"
              >
                Manage billing
              </button>
            )}
            <button
              onClick={async () => {
                try { await refreshLicense(); showToast?.("License refreshed"); }
                catch (e) { showToast?.("Failed to refresh"); }
              }}
              className="inline-flex items-center justify-center rounded-full border border-white/25 bg-white/15 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/25"
            >
              Refresh status
            </button>
          </div>
        </div>

        {/* Plan stat tiles inside the gradient */}
        <div className="relative z-10 mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-2xl border border-white/15 bg-white/10 p-3 backdrop-blur-sm">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/70">Plan</div>
            <div className="mt-1 text-sm font-bold text-white">{licenseLoading && !plan ? "…" : plan ? String(plan).charAt(0).toUpperCase() + String(plan).slice(1) : "Free"}</div>
          </div>
          <div className="rounded-2xl border border-white/15 bg-white/10 p-3 backdrop-blur-sm">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/70">Best value</div>
            <div className="mt-1 text-sm font-bold text-white">{prices?.yearly?.display ?? "₱10,000 / yr"}</div>
          </div>
        </div>
      </div>

      {/* ACCOUNT NAV */}
      <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${TOOLBAR_RADIUS} ${SHADOW_SOFT} p-2 flex flex-wrap items-center gap-2`}>
        {[
          ["profile", "Profile"],
          ["security", "Security"],
          ["billing", "Billing"],
          ["preferences", "Preferences"],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setAccountTab(key)}
            className={`px-4 py-2 rounded-full text-sm font-semibold transition ${accountTab === key
              ? "bg-indigo-600 text-white shadow-md shadow-indigo-200"
              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* PROFILE */}
      {accountTab === "profile" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px,minmax(0,1fr)]">
          <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_CARD} p-5`}>
            <h4 className="text-sm font-semibold text-gray-900">Profile badge</h4>
            <p className="mt-1 text-xs text-gray-500">
              Update the badge photo and core account identity shown in the dashboard.
            </p>

            <div className="mt-5 flex flex-col items-center">
              <div className="h-28 w-28 overflow-hidden rounded-2xl border border-gray-200 bg-gray-100">
                {accountForm.badgePhoto ? (
                  <img
                    src={accountForm.badgePhoto}
                    alt="Badge"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-3xl text-gray-400">
                    👤
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={chooseBadgePhoto}
                className="mt-4 inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
              >
                Change badge photo
              </button>
            </div>
          </div>

          <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_CARD} p-5`}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="text-xs text-gray-700">
                Display name
                <input
                  type="text"
                  value={accountForm.displayName}
                  onChange={(e) => updateAccountField("displayName", e.target.value)}
                  className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} mt-1 w-full px-3 py-2 text-sm outline-none`}
                />
              </label>

              <label className="text-xs text-gray-700">
                Email
                <input
                  type="email"
                  value={accountForm.email}
                  onChange={(e) => updateAccountField("email", e.target.value)}
                  className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} mt-1 w-full px-3 py-2 text-sm outline-none`}
                />
              </label>

              <label className="text-xs text-gray-700">
                Phone
                <input
                  type="text"
                  value={accountForm.phone}
                  onChange={(e) => updateAccountField("phone", e.target.value)}
                  className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} mt-1 w-full px-3 py-2 text-sm outline-none`}
                />
              </label>

              <label className="text-xs text-gray-700">
                Role
                <input
                  type="text"
                  value={accountForm.role}
                  onChange={(e) => updateAccountField("role", e.target.value)}
                  className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} mt-1 w-full px-3 py-2 text-sm outline-none`}
                />
              </label>

              <label className="text-xs text-gray-700 md:col-span-2">
                Company / Team
                <input
                  type="text"
                  value={accountForm.company}
                  onChange={(e) => updateAccountField("company", e.target.value)}
                  className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} mt-1 w-full px-3 py-2 text-sm outline-none`}
                />
              </label>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={saveAccountProfile}
                disabled={profileSaving}
                className="inline-flex items-center justify-center rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-200 transition hover:-translate-y-0.5 hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {profileSaving ? "Saving..." : "Save profile"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SECURITY */}
      {accountTab === "security" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_CARD} p-5`}>
            <h4 className="text-sm font-semibold text-gray-900">Change password</h4>
            <p className="mt-1 text-xs text-gray-500">
              Update your login password and keep your account secure.
            </p>

            <div className="mt-4 space-y-4">
              <label className="block text-xs text-gray-700">
                Current password
                <input
                  type="password"
                  value={passwordForm.currentPassword}
                  onChange={(e) => updatePasswordField("currentPassword", e.target.value)}
                  className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} mt-1 w-full px-3 py-2 text-sm outline-none`}
                />
              </label>

              <label className="block text-xs text-gray-700">
                New password
                <input
                  type="password"
                  value={passwordForm.newPassword}
                  onChange={(e) => updatePasswordField("newPassword", e.target.value)}
                  className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} mt-1 w-full px-3 py-2 text-sm outline-none`}
                />
              </label>

              <label className="block text-xs text-gray-700">
                Confirm new password
                <input
                  type="password"
                  value={passwordForm.confirmPassword}
                  onChange={(e) => updatePasswordField("confirmPassword", e.target.value)}
                  className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} mt-1 w-full px-3 py-2 text-sm outline-none`}
                />
              </label>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={changePassword}
                disabled={passwordSaving}
                className="inline-flex items-center justify-center rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-200 transition hover:-translate-y-0.5 hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {passwordSaving ? "Updating..." : "Change password"}
              </button>
            </div>
          </div>

          <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_CARD} p-5`}>
            <h4 className="text-sm font-semibold text-gray-900">Security tips</h4>
            <div className="mt-4 space-y-3 text-xs leading-relaxed text-gray-600">
              <p>Use at least 8 characters and avoid reusing passwords from other services.</p>
              <p>Change credentials immediately when booth access is shared across operators.</p>
              <p>Later, this section can also support sign out of other sessions and 2-factor authentication.</p>
            </div>
          </div>
        </div>
      )}

      {/* BILLING */}
      {accountTab === "billing" && (
        <>
          {/* Backend / Stripe connectivity error banner */}
          {subscriptionError && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
              <svg className="h-4 w-4 flex-shrink-0 text-amber-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              <div>
                <div className="text-xs font-semibold text-amber-800">Billing server unreachable</div>
                <p className="mt-0.5 text-xs text-amber-700 leading-relaxed">
                  {subscriptionError}. This usually means your backend API server is not running, or your Stripe secret key / webhook is not configured in the server environment. Plan upgrades and billing management will be unavailable until the server is reachable.
                </p>
                <button
                  type="button"
                  onClick={() => refreshLicense()}
                  className="mt-2 text-xs font-medium text-amber-800 underline hover:no-underline"
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_CARD} p-5`}>
            <div className="mb-3">
              <h4 className="text-sm font-semibold text-gray-900">Current access</h4>
              <p className="mt-1 text-xs text-gray-500">
                Review the entitlement and subscription status currently applied to this account.
              </p>
            </div>

            <SubscriptionSummary
              license={license}
              gating={gating}
              prices={prices}
            />
          </div>

          <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_CARD} p-5`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold text-gray-900">Choose a plan</h4>
                <p className="mt-1 text-xs text-gray-500 max-w-md">
                  Upgrade anytime. Yearly plans offer better long-term value than monthly billing.
                </p>
              </div>

              <div className="rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-medium text-indigo-700">
                Recommended: Yearly
              </div>
            </div>

            <div className="mt-5">
              <PlanCards
                plan={subscription?.plan || license?.plan || gating?.plan || "free"}
                trialEligible={trialEligible}
                monthlyPriceText={prices?.monthly?.display ?? "₱1,400 / mo"}
                yearlyPriceText={prices?.yearly?.display ?? "₱10,000 / yr"}
                trialPriceText="₱0"
                monthlyPriceAmount={prices?.monthly?.amount ?? 1400}
                yearlyPriceAmount={prices?.yearly?.amount ?? 10000}
                onStartTrial={async () => {
                  try {
                    await licensingApi.redeemTrial();
                    await refreshLicense();
                    showToast?.("Trial started");
                  } catch (e) {
                    console.error("trial failed:", e);
                    showToast?.(`Trial failed: ${e?.message ?? "unknown error"}`);
                  }
                }}
                onUpgradeMonthly={async () => {
                  await openCheckout("monthly");
                }}
                onUpgradeYearly={async () => {
                  await openCheckout("yearly");
                }}
                onManageBilling={openCustomerPortal}
              />
            </div>
          </div>

          <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_CARD} p-5`}>
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h4 className="text-sm font-semibold text-gray-900">Gallery add-on</h4>
                <p className="mt-1 text-xs text-gray-500 max-w-xl">
                  Enables Supabase gallery upload, guest QR access, downloadable images, and hosted final-motion sharing.
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className={`rounded-full px-3 py-1 font-medium ${galleryAddonEnabled ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>
                    {galleryAddonEnabled ? "Gallery enabled" : "Gallery disabled"}
                  </span>
                  <span className="rounded-full bg-indigo-50 px-3 py-1 font-medium text-indigo-700">
                    {prices?.galleryAddon?.display ?? "PHP 499 / mo"}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={galleryAddonEnabled ? openCustomerPortal : openGalleryAddonCheckout}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
              >
                {galleryAddonEnabled ? "Manage add-on" : "Add gallery"}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div className="text-sm font-medium text-gray-900">Secure billing</div>
              <p className="mt-1 text-xs leading-relaxed text-gray-600">
                Payments are processed securely and plan updates are handled through your billing portal.
              </p>
            </div>

            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div className="text-sm font-medium text-gray-900">Flexible changes</div>
              <p className="mt-1 text-xs leading-relaxed text-gray-600">
                Upgrade, downgrade, or cancel based on booth usage and event demand.
              </p>
            </div>

            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div className="text-sm font-medium text-gray-900">Trial friendly</div>
              <p className="mt-1 text-xs leading-relaxed text-gray-600">
                Start with a trial when eligible, then switch to a paid plan when ready.
              </p>
            </div>
          </div>
        </>
      )}

      {/* PREFERENCES */}
      {accountTab === "preferences" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_CARD} p-5`}>
            <h4 className="text-sm font-semibold text-gray-900">Preferences</h4>
            <p className="mt-1 text-xs text-gray-500">
              Control how the dashboard behaves for this account.
            </p>

            <div className="mt-4 space-y-4">
              <label className="flex items-center justify-between gap-4 text-sm text-gray-700">
                <span>Email notifications</span>
                <input
                  type="checkbox"
                  checked={accountPreferences.emailNotifications}
                  onChange={(e) => updateAccountPreference("emailNotifications", e.target.checked)}
                />
              </label>

              <label className="flex items-center justify-between gap-4 text-sm text-gray-700">
                <span>Desktop notifications</span>
                <input
                  type="checkbox"
                  checked={accountPreferences.desktopNotifications}
                  onChange={(e) => updateAccountPreference("desktopNotifications", e.target.checked)}
                />
              </label>

              <label className="flex items-center justify-between gap-4 text-sm text-gray-700">
                <span>Enable sounds</span>
                <input
                  type="checkbox"
                  checked={accountPreferences.soundEnabled}
                  onChange={(e) => updateAccountPreference("soundEnabled", e.target.checked)}
                />
              </label>

              <label className="flex items-center justify-between gap-4 text-sm text-gray-700">
                <span>Launch app on startup</span>
                <input
                  type="checkbox"
                  checked={accountPreferences.autoLaunch}
                  onChange={(e) => updateAccountPreference("autoLaunch", e.target.checked)}
                />
              </label>

              <label className="block text-xs text-gray-700">
                Theme
                <select
                  value={accountPreferences.theme}
                  onChange={(e) => updateAccountPreference("theme", e.target.value)}
                  className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} mt-1 w-full px-3 py-2 text-sm outline-none`}
                >
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </label>

              <label className="block text-xs text-gray-700">
                Language
                <select
                  value={accountPreferences.language}
                  onChange={(e) => updateAccountPreference("language", e.target.value)}
                  className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} mt-1 w-full px-3 py-2 text-sm outline-none`}
                >
                  <option value="en">English</option>
                  <option value="fil">Filipino</option>
                </select>
              </label>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={saveAccountPreferences}
                disabled={prefsSaving}
                className="inline-flex items-center justify-center rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-200 transition hover:-translate-y-0.5 hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {prefsSaving ? "Saving..." : "Save preferences"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const openEventsLibrary = () => {
    setActiveMain("events");
  };

  const createNewEventFromHome = () => {
    setCurrentEvent(null);
    setActiveMain("events");

    requestAnimationFrame(() => {
      const input = document.getElementById("create-event-input");
      input?.focus?.();
      input?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    });
  };
  const openEventEditor = (eventToOpen) => {
    if (!eventToOpen) {
      showToast?.("No event selected");
      return;
    }

    setCurrentEvent(eventToOpen);
    setActiveSub("branding");
    setActiveMain("dashboard");
  };

  const openLatestEventFromHome = () => {
    if (!events.length) {
      showToast?.("No saved events yet");
      setActiveMain("events");
      return;
    }

    openEventEditor(events[0]);
  };

  const renderHomeDashboard = () => (
    <div className="space-y-5">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl border border-white/20 bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-700 px-6 py-6 text-white shadow-[0_24px_64px_rgba(79,70,229,0.25)]">
        <WavePattern />
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white">Dashboard</div>
            <h2 className="mt-3 text-2xl font-bold tracking-tight" style={{ fontFamily: '"Fraunces", ui-serif, Georgia, serif' }}>
              {boothIdentityName ? `Welcome back — ${boothIdentityName}` : "Studio Photuna"}
            </h2>
            <p className="mt-1.5 text-sm text-white/80">
              {boothLocation ? `${boothLocation} · ` : ""}{events.length} event{events.length !== 1 ? "s" : ""} · {templates.length} template{templates.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={createNewEventFromHome}
              className="inline-flex items-center justify-center rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-indigo-700 shadow-md transition hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.98]"
            >
              + New event
            </button>
            <button
              type="button"
              onClick={openLatestEventFromHome}
              className="inline-flex items-center justify-center rounded-full border border-white/25 bg-white/15 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/25 active:scale-[0.98]"
            >
              Resume latest
            </button>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {[
          {
            label: "Total Events", value: events.length, sub: "saved",
            icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />,
            color: "text-indigo-600", bg: "bg-indigo-50",
          },
          {
            label: "Templates", value: templates.length, sub: "available",
            icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />,
            color: "text-violet-600", bg: "bg-violet-50",
          },
          {
            label: "Sessions Today", value: sessionsToday, sub: "across all events",
            icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />,
            color: "text-emerald-600", bg: "bg-emerald-50",
          },
          {
            label: "Printer", value: printerOnline ? "Online" : "Offline", sub: printerStatusText || "status",
            icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />,
            color: printerOnline ? "text-emerald-600" : "text-amber-600", bg: printerOnline ? "bg-emerald-50" : "bg-amber-50",
          },
        ].map(({ label, value, sub, icon, color, bg }) => (
          <div key={label} className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-4`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">{label}</div>
                <div className={`mt-1.5 text-2xl font-bold ${color} tabular-nums`}>{value}</div>
                <div className="text-[11px] text-gray-400 mt-0.5 truncate">{sub}</div>
              </div>
              <div className={`${bg} rounded-full p-2.5 flex-shrink-0`}>
                <svg className={`w-4 h-4 ${color}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {icon}
                </svg>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 xl:grid-cols-[1.6fr,1fr] gap-5">

        {/* Left col */}
        <div className="space-y-5">

          {/* Quick actions */}
          <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-5`}>
            <div className={`${EYEBROW} mb-1`}>Quick actions</div>
            <p className="mt-0.5 text-xs text-slate-400 mb-4">Jump into the most common tasks.</p>
            <div className="grid grid-cols-2 gap-2.5">
              {[
                { label: "Manage events", sub: "Create, edit, or archive events", onClick: openEventsLibrary },
                { label: "Resume latest", sub: "Jump back into your last event", onClick: openLatestEventFromHome },
                { label: "Settings", sub: "Camera, printer, storage setup", onClick: () => setActiveMain("settings") },
                { label: "Account", sub: "Profile, security, and billing", onClick: () => setActiveMain("account") },
                { label: "Help center", sub: "Guides and troubleshooting", onClick: () => setActiveMain("helpcenter") },
              ].map(({ label, sub, onClick }) => (
                <button
                  key={label}
                  type="button"
                  onClick={onClick}
                  className="rounded-2xl border border-slate-200 bg-white p-4 text-left hover:border-indigo-200 hover:bg-indigo-50/40 transition-all group active:scale-[0.98]"
                >
                  <div className="text-sm font-semibold text-slate-800 group-hover:text-indigo-700 transition-colors">{label}</div>
                  <div className="mt-0.5 text-[11px] text-slate-400">{sub}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Recent events */}
          <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-5`}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className={EYEBROW}>Recent events</div>
                <p className="mt-0.5 text-xs text-slate-400">Jump back into an event editor.</p>
              </div>
              <button onClick={openEventsLibrary} className="text-xs text-indigo-600 hover:text-indigo-700 font-semibold transition-colors">
                View all →
              </button>
            </div>

            <div className="space-y-1.5">
              {events.slice(0, 5).map((ev) => (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => openEventEditor(ev)}
                  className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left hover:border-indigo-200 hover:bg-indigo-50/30 transition-all group active:scale-[0.98]"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-800 truncate group-hover:text-indigo-700 transition-colors">
                      {ev.name || "Untitled event"}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {ev.date || ev.created || "No date"} · {ev.sessions?.length ?? 0} sessions
                    </div>
                  </div>
                  <svg className="w-4 h-4 text-slate-300 group-hover:text-indigo-400 flex-shrink-0 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              ))}

              {events.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center">
                  <div className="text-sm text-slate-400">No events yet.</div>
                  <button
                    onClick={createNewEventFromHome}
                    className="mt-2 text-xs font-semibold text-indigo-600 hover:text-indigo-700 transition-colors"
                  >
                    Create your first event →
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right col */}
        <div className="space-y-5">

          {/* System health */}
          <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-5`}>
            <div className={`${EYEBROW} mb-4`}>System health</div>
            <div className="space-y-3">
              {[
                {
                  label: "Printer",
                  ok: printerOnline,
                  status: printerOnline ? "Online" : "Offline",
                },
                {
                  label: "Camera",
                  ok: cameraOnline,
                  status: cameraOnline ? "Ready" : "Not detected",
                },
                {
                  label: "Storage path",
                  ok: !!getEffectiveStoragePath(),
                  status: getEffectiveStoragePath() ? "Configured" : "Not set",
                },
                {
                  label: "Account",
                  ok: !!(license?.active || gating?.allow),
                  status: (license?.active || gating?.allow) ? "Active" : "Inactive",
                },
              ].map(({ label, ok, status }) => (
                <div key={label} className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">{label}</span>
                  <div className="flex items-center gap-1.5">
                    <div className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-emerald-400" : "bg-amber-400"}`} />
                    <span className={`text-xs font-medium ${ok ? "text-emerald-600" : "text-amber-600"}`}>
                      {status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Workspace */}
          <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-5`}>
            <div className={`${EYEBROW} mb-4`}>Workspace</div>
            <div className="space-y-2.5">
              {[
                { label: "User", value: user?.name || identity?.username || "Unknown" },
                { label: "Mode", value: appMode || "—" },
                { label: "Plan", value: licenseLoading && !plan ? "…" : plan ? String(plan).charAt(0).toUpperCase() + String(plan).slice(1) : "Free" },
                { label: "Printer", value: selectedPrinter || "None selected" },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-gray-400 flex-shrink-0">{label}</span>
                  <span className="text-gray-800 font-medium text-right truncate">{value}</span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );

  const getDashboardSectionMeta = () => {
    switch (activeSub) {
      case "branding":
        return {
          title: "Branding",
          description: "Update booth identity, logo, welcome presentation, fonts, and start button styling.",
        };
      case "templates":
        return {
          title: "Templates",
          description: "Create and manage print layouts, slot positioning, and template assignments.",
        };
      case "frames":
        return {
          title: "Frames",
          description: "Manage frame overlays, supported layouts, and frame assignments.",
        };
      case "tones":
        return {
          title: "Tones",
          description: "Control preset and custom tone treatments used during booth flow.",
        };
      case "background color":
        return {
          title: "Background Color",
          description: "Manage event background colors and visual palette options.",
        };
      case "controls":
        return {
          title: "Controls",
          description: "Configure countdown, number of shots, timers, retakes, and booth flow behavior.",
        };
      case "sharing":
        return {
          title: "Sharing",
          description: "Set sharing methods, delivery flow, and guest output behavior.",
        };
      case "analytics":
        return {
          title: "Analytics",
          description: "View and analyze booth performance, usage statistics, and user engagement.",
        };
      default:
        return {
          title: "Dashboard",
          description: "Manage the active event workspace.",
        };
    }
  };

  const Section = ({ title, children, defaultOpen = true }) => {
    const [open, setOpen] = React.useState(defaultOpen);

    return (
      <div className="mt-6">
        <button
          onClick={() => setOpen(!open)}
          className={`w-full flex items-center justify-between ${EYEBROW} mb-2`}
        >
          <span>{title}</span>
          <span className="text-slate-400 text-xs">{open ? "−" : "+"}</span>
        </button>

        {open && children}
      </div>
    );
  };

  // Camera useEffect

  useEffect(() => {
    const meta = getResolutionMeta(cameraResolution);
    setCameraWidth(meta.width);
    setCameraHeight(meta.height);
  }, [cameraResolution]);

  useEffect(() => {
    if (activeMain === "settings" && activeSettingsTab === "camera") {
      refreshCameras();
    }
  }, [activeMain, activeSettingsTab]);

  useEffect(() => {
    if (selectedCameraId) {
      loadCameraCapabilities(selectedCameraId);
    } else {
      setCameraCapabilities(null);
      setCameraOnline(false);
      setCameraStatusText("No camera selected");
    }
  }, [selectedCameraId]);

  // Storage useEffect

  useEffect(() => {
    if (storagePath) {
      loadStorageInfo(storagePath);
    } else {
      setStorageInfo(null);
      setStorageStatusText("No storage folder selected");
    }
  }, [storagePath]);

  // General useEffect

  useEffect(() => {
    if (!dimWhenIdle && idleTimeout !== 60) {
      // keep value, but no action needed; summary will explain that dimming is disabled
    }
  }, [dimWhenIdle, idleTimeout]);

  // 3) Subscribe to AuthGate’s broadcast
  useEffect(() => {
    if (authLoading) return;

    if (identity.userId) {
      setHydrated(false);
      loadPersisted(identity.userId);
      return;
    }

    setEvents([]);
    setCurrentEvent(null);
  }, [authLoading, identity.userId, loadPersisted]);

  function sanitizeSettings(input = {}) {
    const {
      countdown,
      retakeLimit,
      screenTimers,
      numberOfShots,
      flashEnabled,
      soundEnabled,
      language,
      price,
      appMode,
      timersEnabled,
      rental,
      business,
      selectedCameraId,
      mirrorCamera,
      cameraResolution,
      cameraWidth,
      cameraHeight,
      facingMode,
      selectedPrinter,
      paperSize,
      printCopies,
      printColorMode,
      printQuality,
      printOrientation,
      printDuplexMode,
      printDpi,
      storagePath,
      autoDeleteDays,
      dimWhenIdle,
      idleTimeout,
      launchOnStartup,
      autoRestart,
      boothIdentityName,
      boothLocation,
      operatorName,
      autoUpdateEnabled,
    } = input;

    const clampNum = (n, min, max, fallback = 0) => {
      const v = Number(n);
      if (!Number.isFinite(v)) return fallback;
      return Math.max(min, Math.min(max, v));
    };

    const safeBusinessProviders = {
      gcash: !!business?.payment?.providers?.gcash,
      paypal: !!business?.payment?.providers?.paypal,
      stripe: !!business?.payment?.providers?.stripe,
      cash: business?.payment?.providers?.cash ?? true,
    };

    const safeTimers =
      timersEnabled && screenTimers
        ? Object.fromEntries(
          Object.entries(screenTimers).map(([k, v]) => [
            k,
            clampNum(v, 0, 600, DEFAULT_SCREEN_TIMERS[k] ?? 0),
          ])
        )
        : DEFAULT_SCREEN_TIMERS;

    return {
      countdown: clampNum(countdown, 1, 30, 5),
      retakeLimit: clampNum(retakeLimit, 0, 20, 0),
      screenTimers: safeTimers,
      numberOfShots: clampNum(numberOfShots, 1, 10, 3),

      flashEnabled: flashEnabled ?? true,
      soundEnabled: soundEnabled ?? true,
      language: ["en", "fil"].includes(language) ? language : "en",
      price: clampNum(price, 0, 999999, 0),
      appMode: appMode ?? DEFAULT_APP_MODE,
      timersEnabled: timersEnabled ?? false,

      selectedCameraId: selectedCameraId ?? "",
      mirrorCamera: mirrorCamera ?? false,
      cameraResolution: ["720p", "1080p", "1440p", "4k"].includes(cameraResolution)
        ? cameraResolution
        : "1080p",
      cameraWidth: clampNum(cameraWidth, 320, 7680, 1920),
      cameraHeight: clampNum(cameraHeight, 240, 4320, 1080),
      facingMode: ["user", "environment", "left", "right"].includes(facingMode)
        ? facingMode
        : "user",

      selectedPrinter: selectedPrinter ?? "",
      paperSize:
        typeof paperSize === "string" && paperSize.trim()
          ? paperSize.trim()
          : "4x6",
      printCopies: clampNum(printCopies, 1, 20, 1),
      printColorMode: ["color", "grayscale"].includes(printColorMode)
        ? printColorMode
        : "color",
      printQuality: ["draft", "standard", "high"].includes(printQuality)
        ? printQuality
        : "high",
      printOrientation: ["auto", "portrait", "landscape"].includes(printOrientation)
        ? printOrientation
        : "landscape",
      printDuplexMode: ["simplex", "shortEdge", "longEdge"].includes(printDuplexMode)
        ? printDuplexMode
        : "simplex",
      printDpi: clampNum(printDpi, 72, 1200, 300),
      usePrinterDefaults: input.usePrinterDefaults ?? false,

      storagePath: storagePath ?? "",
      autoDeleteDays: clampNum(autoDeleteDays, 0, 3650, 14),

      dimWhenIdle: dimWhenIdle ?? true,
      idleTimeout: clampNum(idleTimeout, 5, 3600, 60),

      launchOnStartup: launchOnStartup ?? true,
      autoRestart: autoRestart ?? true,
      autoUpdateEnabled: autoUpdateEnabled ?? true,

      boothIdentityName: typeof boothIdentityName === 'string' ? boothIdentityName.trim().slice(0, 100) : '',
      boothLocation: typeof boothLocation === 'string' ? boothLocation.trim().slice(0, 200) : '',
      operatorName: typeof operatorName === 'string' ? operatorName.trim().slice(0, 100) : '',

      rental: {
        timerEnabled: !!rental?.timerEnabled,
        timerHours: clampNum(
          rental?.timerHours,
          0,
          24,
          DEFAULT_RENTAL.timerHours
        ),
        sessionLimitEnabled: !!rental?.sessionLimitEnabled,
        sessionLimit: clampNum(
          rental?.sessionLimit,
          0,
          10000,
          DEFAULT_RENTAL.sessionLimit
        ),
        offlineModeEnabled: !!rental?.offlineModeEnabled,
        autoSaveTarget: ["local", "usb", "cloud"].includes(rental?.autoSaveTarget)
          ? rental.autoSaveTarget
          : "local",
        endSessionSummaryEnabled: !!rental?.endSessionSummaryEnabled,
      },

      business: {
        paymentEnabled: business?.paymentEnabled ?? true,
        payment: {
          providers: safeBusinessProviders,
        },
        pricing: {
          model:
            business?.pricing?.model === "perPhoto" ? "perPhoto" : "perSession",
          pricePerSession: clampNum(
            business?.pricing?.pricePerSession,
            0,
            999999,
            0
          ),
          additionalPrintPrice: clampNum(
            business?.pricing?.additionalPrintPrice,
            0,
            999999,
            0
          ),
          currency: ["PHP", "USD", "EUR"].includes(business?.pricing?.currency)
            ? business.pricing.currency
            : "PHP",
          taxEnabled: !!business?.pricing?.taxEnabled,
          taxRate: clampNum(business?.pricing?.taxRate, 0, 100, 0),
        },
      },
    };
  }

  useEffect(() => {
    let mounted = true;

    (async () => {
      if (!selectedPrinter || !native?.invoke) return;

      try {
        const caps = await window.electron.invoke(
          "printer:get-capabilities",
          selectedPrinter
        );

        if (!mounted) return;

        setAvailablePrinterOptions(caps || null);

        const nextPaperOptions = extractPrinterPaperOptions(caps);
        setPaperSizeOptions(nextPaperOptions);

        const hasCurrentPaper = nextPaperOptions.some(
          (p) => normalizePaperName(p.value) === normalizePaperName(paperSize)
        );

        if (!hasCurrentPaper && nextPaperOptions.length) {
          setPaperSize(nextPaperOptions[0].value);
        }
      } catch (err) {
        console.warn("Failed to load printer capabilities", err);
        if (mounted) {
          setAvailablePrinterOptions(null);
          setPaperSizeOptions(CUSTOM_PAPER_SIZE_OPTIONS);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [selectedPrinter]);

  // ---------- Analytics helpers ----------

  const peso = (n = 0) =>
    `₱${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

  // Assumptions:
  // ev.sessions = [{ createdAt, photosCount }]
  // ev.settings.business.pricing.pricePerSession

  const allSessions = events.flatMap(ev => ev.sessions ?? []);

  const isToday = (d) => {
    const x = new Date(d);
    const t = new Date();
    return (
      x.getDate() === t.getDate() &&
      x.getMonth() === t.getMonth() &&
      x.getFullYear() === t.getFullYear()
    );
  };

  const sessionsToday = events.reduce((sum, ev) => {
    const price =
      ev.settings?.business?.pricing?.pricePerSession ??
      ev.settings?.price ??
      0;

    const todayCount =
      (ev.sessions ?? []).filter(s => isToday(s.createdAt)).length;

    return sum + todayCount;
  }, 0);

  const grossToday = events.reduce((sum, ev) => {
    const price =
      ev.settings?.business?.pricing?.pricePerSession ??
      ev.settings?.price ??
      0;

    const todayCount =
      (ev.sessions ?? []).filter(s => isToday(s.createdAt)).length;

    return sum + todayCount * price;
  }, 0);

  const totalGross = events.reduce((sum, ev) => {
    const price =
      ev.settings?.business?.pricing?.pricePerSession ??
      ev.settings?.price ??
      0;

    return sum + (ev.sessions?.length ?? 0) * price;
  }, 0);

  const totalPhotos = events.reduce(
    (sum, ev) =>
      sum +
      (ev.sessions ?? []).reduce(
        (s, sess) => s + (sess.photosCount ?? 0),
        0
      ),
    0
  );

  // ---- Mini chart: sessions per hour (today) ----
  const sessionsPerHour = Array.from({ length: 24 }, (_, h) => {
    return events.reduce((sum, ev) => {
      return (
        sum +
        (ev.sessions ?? []).filter((s) => {
          const d = new Date(s.createdAt);
          return isToday(d) && d.getHours() === h;
        }).length
      );
    }, 0);
  });

  const maxHourValue = Math.max(...sessionsPerHour, 1);

  const reportEvents =
    reportEventId === "all"
      ? events
      : events.filter(ev => ev.id === reportEventId);

  const reportSessions = reportEvents.flatMap(
    ev => ev.sessions ?? []
  );

  const reportGross = reportEvents.reduce((sum, ev) => {
    const price =
      ev.settings?.business?.pricing?.pricePerSession ??
      ev.settings?.price ??
      0;

    return sum + (ev.sessions?.length ?? 0) * price;
  }, 0);

  const reportPhotos = reportEvents.reduce(
    (sum, ev) =>
      sum +
      (ev.sessions ?? []).reduce(
        (s, sess) => s + (sess.photosCount ?? 0),
        0
      ),
    0
  );

  const reportConversionRate =
    reportSessions.length > 0
      ? Math.round(
        (reportSessions.filter(s => s.completed !== false).length /
          reportSessions.length) * 100
      )
      : 0;

  const reportSessionsPerHour = Array.from({ length: 24 }, (_, h) =>
    reportEvents.reduce((sum, ev) => {
      return (
        sum +
        (ev.sessions ?? []).filter(s => {
          const d = new Date(s.createdAt);
          return d.getHours() === h;
        }).length
      );
    }, 0)
  );

  const reportMaxHour = Math.max(...reportSessionsPerHour, 1);

  const peakHour =
    reportSessionsPerHour.indexOf(reportMaxHour);

  // ---- Extended analytics helpers (dashboard analytics tab) ----

  const isThisWeek = (ts) => {
    try {
      const d = new Date(ts);
      const now = new Date();
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
      startOfWeek.setHours(0, 0, 0, 0);
      return d >= startOfWeek && d <= now;
    } catch { return false; }
  };

  const isThisMonth = (ts) => {
    try {
      const d = new Date(ts);
      const now = new Date();
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    } catch { return false; }
  };

  const isThisYear = (ts) => {
    try {
      return new Date(ts).getFullYear() === new Date().getFullYear();
    } catch { return false; }
  };

  const getEvPrice = (ev) =>
    ev?.settings?.business?.pricing?.pricePerSession ?? ev?.settings?.price ?? 0;

  function isSameLocalDay(ts) {
    try {
      const d = new Date(ts);
      const now = new Date();
      return (
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate()
      );
    } catch { return false; }
  }

  // Per-event computed stats for the analytics tab
  const evSessions = currentEvent?.sessions ?? [];
  const evPrice = getEvPrice(currentEvent);
  const evLog = currentEvent?.analytics?.sessionLog ?? [];

  const evDayCount = evSessions.filter(s => isSameLocalDay(s.createdAt)).length;
  const evWeekCount = evSessions.filter(s => isThisWeek(s.createdAt)).length;
  const evMonthCount = evSessions.filter(s => isThisMonth(s.createdAt)).length;
  const evYtdCount = evSessions.filter(s => isThisYear(s.createdAt)).length;
  const evTotalCount = evSessions.length;

  const evDayRevenue = evDayCount * evPrice;
  const evWeekRevenue = evWeekCount * evPrice;
  const evMonthRevenue = evMonthCount * evPrice;
  const evYtdRevenue = evYtdCount * evPrice;
  const evTotalRevenue = evTotalCount * evPrice;

  const evTotalPhotos = evSessions.reduce((s, sess) => s + (sess.photosCount ?? 0), 0);
  const evAvgRevPerSession = evTotalCount > 0 ? evTotalRevenue / evTotalCount : 0;
  const evAvgPhotosPerSession = evTotalCount > 0 ? (evTotalPhotos / evTotalCount).toFixed(1) : "0.0";

  const evCompletedCount = evLog.length
    ? evLog.filter(s => s?.status === "completed").length
    : evTotalCount;
  const evTotalAttempted = evLog.length ? evLog.length : evTotalCount;
  const evCompletionRate = evTotalAttempted > 0
    ? Math.round((evCompletedCount / evTotalAttempted) * 100)
    : 100;

  // Sessions per hour today (scoped to currentEvent)
  const evHourlyData = Array.from({ length: 24 }, (_, h) =>
    evSessions.filter(s => {
      const d = new Date(s.createdAt);
      return isSameLocalDay(s.createdAt) && d.getHours() === h;
    }).length
  );
  const evMaxHourly = Math.max(...evHourlyData, 1);

  // Sessions per day this week (Sun–Sat)
  const _nowAn = new Date();
  const _startOfWeekAn = new Date(_nowAn);
  _startOfWeekAn.setDate(_nowAn.getDate() - _nowAn.getDay());
  _startOfWeekAn.setHours(0, 0, 0, 0);
  const EV_DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const evWeeklyData = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(_startOfWeekAn);
    day.setDate(_startOfWeekAn.getDate() + i);
    return evSessions.filter(s => {
      const sd = new Date(s.createdAt);
      return sd.getFullYear() === day.getFullYear() &&
        sd.getMonth() === day.getMonth() &&
        sd.getDate() === day.getDate();
    }).length;
  });
  const evMaxWeekly = Math.max(...evWeeklyData, 1);

  // Sessions per day — last 30 days
  const evLast30Data = Array.from({ length: 30 }, (_, i) => {
    const day = new Date();
    day.setDate(day.getDate() - (29 - i));
    day.setHours(0, 0, 0, 0);
    const next = new Date(day);
    next.setDate(next.getDate() + 1);
    return evSessions.filter(s => {
      const sd = new Date(s.createdAt);
      return sd >= day && sd < next;
    }).length;
  });
  const evMax30 = Math.max(...evLast30Data, 1);

  // Template usage
  const evTplUsage = currentEvent?.analytics?.templateUsage ?? {};
  const evTplEntries = Object.entries(evTplUsage).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const evMaxTpl = evTplEntries.length ? evTplEntries[0][1] : 1;

  // ---------------------------
  // Load persisted state (Electron)
  // ---------------------------

  useEffect(() => {
    (async () => {
      if (!native || !ready) return;
      try {
        const ctx = { userId: identity.userId };
        const [
          persistedEvents, appearance, settings, persistedTemplates, persistedFrames, persistedTones, persistedPalettes, currentEventId, currentSubTab,
        ] = await Promise.all([
          native?.getEvents?.(ctx),
          native?.getAppearance?.(ctx),
          native?.getSettings?.(ctx),
          native?.getTemplates?.(ctx),
          native?.getFrames?.(ctx),
          native?.getTones?.(ctx),
          native?.getPalettes?.(ctx),
          native?.getCurrentEventId?.(), // can remain global pin, or scope by user if desired
          native?.getCurrentSubTab?.(),
        ]);

        if (Array.isArray(persistedEvents)) setEvents(persistedEvents);

        // Appearance
        if (appearance) {
          setLogoPath(appearance.logoPath ? { url: appearance.logoPath, name: "logo", previewUrl: appearance.logoPath } : null);
          setBackgroundMediaPath(
            appearance.backgroundMediaPath
              ? {
                url: appearance.backgroundMediaPath,
                name: appearance.backgroundMediaName ?? "background",
                previewUrl: appearance.backgroundMediaPath,
                mime: appearance.backgroundMediaMime ?? "",
              }
              : null
          );
          setBoothName(appearance.boothName ?? "");
          setBoothSlogan(appearance.boothSlogan ?? "");
          setHeaderFont(appearance.headerFont ?? headerFont);
          setGeneralFont(appearance.generalFont ?? generalFont);
          setHeaderFontColor(appearance.headerFontColor ?? headerFontColor);
          setGeneralFontColor(appearance.generalFontColor ?? generalFontColor);
          setBgColor(appearance.bgColor ?? bgColor);
          setButtonBgColor(appearance.buttonBgColor ?? buttonBgColor);
          setButtonHoverColor(appearance.buttonHoverColor ?? buttonHoverColor);
          setbuttonFont(appearance.buttonFont ?? buttonFont);
          setButtonFontColor(appearance.buttonFontColor ?? buttonFontColor);
          setStartButtonHidden(!!appearance.startButtonHidden);
          setStartButtonText(appearance.startButtonText ?? "Tap to Start");
          setSelectedBgColorId(appearance.selectedBgColorId ?? null);
        }

        // Settings
        // Settings
        if (settings) {
          setCountdown(settings.countdown ?? countdown);
          setRetakeLimit(settings.retakeLimit ?? retakeLimit);
          setScreenTimers(settings.screenTimers ?? screenTimers);
          setNumberOfShots(settings.numberOfShots ?? numberOfShots);
          setFlashEnabled(settings.flashEnabled ?? flashEnabled);
          setSoundEnabled(settings.soundEnabled ?? soundEnabled);
          setLanguage(settings.language ?? language);
          setPrice(settings.price ?? price);
          setAppMode(settings.appMode ?? DEFAULT_APP_MODE);
          setTimersEnabled(settings.timersEnabled ?? !!settings.screenTimers);

          // Camera
          setSelectedCameraId(settings.selectedCameraId ?? "");
          setMirrorCamera(settings.mirrorCamera ?? false);
          setCameraResolution(settings.cameraResolution ?? "1080p");
          setCameraWidth(settings.cameraWidth ?? 1920);
          setCameraHeight(settings.cameraHeight ?? 1080);
          setFacingMode(settings.facingMode ?? "user");

          // Printing
          setSelectedPrinter(settings.selectedPrinter ?? "");
          setPaperSize(settings.paperSize ?? "4x6");
          setPrintCopies(settings.printCopies ?? 1);
          setPrintColorMode(settings.printColorMode ?? "color");
          setPrintQuality(settings.printQuality ?? "high");
          setPrintOrientation(settings.printOrientation ?? "landscape");
          setPrintDuplexMode(settings.printDuplexMode ?? "simplex");
          setPrintDpi(settings.printDpi ?? 300);
          setUsePrinterDefaults(settings.usePrinterDefaults ?? false);

          // Storage
          setStoragePath(settings.storagePath ?? "");
          setAutoDeleteDays(settings.autoDeleteDays ?? 14);

          // General
          setDimWhenIdle(settings.dimWhenIdle ?? true);
          setIdleTimeout(settings.idleTimeout ?? 60);

          // System
          setLaunchOnStartup(settings.launchOnStartup ?? true);
          setAutoRestart(settings.autoRestart ?? true);
          setAutoUpdateEnabled(settings.autoUpdateEnabled ?? true);

          // Rental
          const rental = settings.rental ?? {};
          setRentalTimerEnabled(rental.timerEnabled ?? DEFAULT_RENTAL.timerEnabled);
          setRentalTimerHours(rental.timerHours ?? DEFAULT_RENTAL.timerHours);
          setRentalSessionLimitEnabled(rental.sessionLimitEnabled ?? DEFAULT_RENTAL.sessionLimitEnabled);
          setRentalSessionLimit(rental.sessionLimit ?? DEFAULT_RENTAL.sessionLimit);
          setOfflineModeEnabled(rental.offlineModeEnabled ?? DEFAULT_RENTAL.offlineModeEnabled);
          setAutoSaveTarget(rental.autoSaveTarget ?? DEFAULT_RENTAL.autoSaveTarget);
          setEndSessionSummaryEnabled(rental.endSessionSummaryEnabled ?? DEFAULT_RENTAL.endSessionSummaryEnabled);

          // Business
          const business = settings.business ?? {};
          setPaymentEnabled(business.paymentEnabled ?? DEFAULT_BUSINESS.paymentEnabled);
          const prov = business.payment?.providers ?? DEFAULT_BUSINESS.payment.providers;
          setPaymentProviders({
            gcash: !!prov.gcash,
            paypal: !!prov.paypal,
            stripe: !!prov.stripe,
            cash: !!prov.cash,
          });

          const pricing = business.pricing ?? DEFAULT_BUSINESS.pricing;
          setPricingModel(pricing.model ?? DEFAULT_BUSINESS.pricing.model);
          setPricePerSession(pricing.pricePerSession ?? DEFAULT_BUSINESS.pricing.pricePerSession);
          setAdditionalPrintPrice(pricing.additionalPrintPrice ?? DEFAULT_BUSINESS.pricing.additionalPrintPrice);
          setCurrency(pricing.currency ?? DEFAULT_BUSINESS.pricing.currency);
          setTaxEnabled(pricing.taxEnabled ?? DEFAULT_BUSINESS.pricing.taxEnabled);
          setTaxRate(pricing.taxRate ?? DEFAULT_BUSINESS.pricing.taxRate);
        }

        // Templates / Frames / Tones / Palettes
        if (Array.isArray(persistedTemplates)) setTemplates(persistedTemplates);
        if (Array.isArray(persistedFrames)) setFrames(persistedFrames);
        if (Array.isArray(persistedTones)) setTones(persistedTones);
        if (Array.isArray(persistedPalettes)) setPalettes(persistedPalettes);

        // Restore current event + sub-tab
        if (currentEventId != null && Array.isArray(persistedEvents)) {
          const found = persistedEvents.find((e) => e.id === currentEventId);
          if (found) {
            setCurrentEvent(JSON.parse(JSON.stringify(found)));
            setActiveMain("dashboard");
            setActiveSub(currentSubTab ?? "branding");
          }
        }
        setHydrated(true); // <- mark hydration complete
      } catch (err) {
        console.error("load persisted state error", err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native, ready, identity.userId]);

  // --- Event save/create/delete ---
  const saveCurrentEvent = () => {
    if (!currentEvent) {
      showToast('No event loaded');
      return;
    }

    const settingsToSave = sanitizeSettings({
      selectedCameraId,
      mirrorCamera,
      cameraResolution,
      cameraWidth,
      cameraHeight,
      facingMode,
      countdown,
      retakeLimit,
      screenTimers,
      numberOfShots,
      flashEnabled,
      soundEnabled,
      language,
      price,
      appMode,
      timersEnabled,
      rental: {
        timerEnabled: rentalTimerEnabled,
        timerHours: rentalTimerHours,
        sessionLimitEnabled: rentalSessionLimitEnabled,
        sessionLimit: rentalSessionLimit,
        offlineModeEnabled,
        autoSaveTarget,
        endSessionSummaryEnabled,
      },
      business: {
        paymentEnabled,
        payment: { providers: { ...paymentProviders } },
        pricing: {
          model: pricingModel,
          pricePerSession,
          additionalPrintPrice,
          currency,
          taxEnabled,
          taxRate,
        },
      },
    });

    const updatedEvent = {
      ...currentEvent,
      appearance: {
        headerFont,
        generalFont,
        headerFontColor,
        generalFontColor,
        bgColor,
        logoPath: logoPath?.url ?? null,
        backgroundMediaPath: backgroundMediaPath?.url ?? null,
        backgroundMediaName: backgroundMediaPath?.name ?? null,
        backgroundMediaMime: backgroundMediaPath?.mime ?? null,
        boothName,
        boothSlogan,
        buttonBgColor,
        buttonHoverColor,
        buttonFont,
        buttonFontColor,
        startButtonHidden,
        startButtonText,
      },
      settings: settingsToSave,
      appliedTemplates: currentEvent.appliedTemplates ?? [],
      appliedFrames: currentEvent.appliedFrames ?? [],
      appliedTones: currentEvent.appliedTones ?? [],
      analytics: currentEvent.analytics ?? {},
      notes: currentEvent.notes ?? '',
    };

    const updated = events.map((e) => (e.id === currentEvent.id ? updatedEvent : e));
    setEvents(updated);
    setCurrentEvent(updatedEvent);
    native?.setEvents?.(updated, ctx).catch?.(() => { });
    showToast('Event saved');
  };

  // Persist state (electron-store + Supabase)
  useEffect(() => {
    if (!native?.setEvents || !ready || !hydrated) return;
    native.setEvents(events, ctx).catch?.(() => { });
    pushSettings({ events });
  }, [events, native, ready, ctx]);
  useEffect(() => {
    if (!native?.setTemplates || !ready || !hydrated) return;
    native?.setTemplates(templates, ctx).catch?.(() => { });
    pushSettings({ templates });
  }, [templates, native, ready, ctx]);
  useEffect(() => {
    if (!native?.setFrames || !ready || !hydrated) return;
    native?.setFrames(frames, ctx).catch?.(() => { });
    pushSettings({ frames });
  }, [frames, native, ready, ctx]);
  useEffect(() => {
    if (!native?.setTones || !ready || !hydrated) return;
    native?.setTones(tones, ctx).catch?.(() => { });
  }, [tones, native, ready, ctx]);
  useEffect(() => {
    if (!native?.setPalettes || !ready || !hydrated) return;
    native?.setPalettes(palettes, ctx).catch?.(() => { });
    pushSettings({ palettes });
  }, [palettes, native, ready, ctx]);
  useEffect(() => {
    if (!native?.setAppearance || !ready || !hydrated) return;
    const appearance = {
      headerFont,
      generalFont,
      headerFontColor,
      generalFontColor,
      bgColor,
      logoPath: logoPath?.url ?? null,
      backgroundMediaPath: backgroundMediaPath?.url ?? null,
      backgroundMediaName: backgroundMediaPath?.name ?? null,
      backgroundMediaMime: backgroundMediaPath?.mime ?? null,
      boothName,
      boothSlogan,
      buttonBgColor,
      buttonHoverColor,
      buttonFont,
      buttonFontColor,
      startButtonHidden,
      startButtonText,
      selectedBgColorId,
    };
    native.setAppearance(appearance, ctx).catch?.(() => { });
    // Sync to Supabase (debounced)
    pushSettings({ appearance });
  }, [
    headerFont,
    generalFont,
    headerFontColor,
    generalFontColor,
    bgColor,
    buttonBgColor,
    buttonHoverColor,
    buttonFont,
    buttonFontColor,
    startButtonHidden,
    startButtonText,
    logoPath,
    backgroundMediaPath,
    boothName,
    boothSlogan,
    native,
    ready,
    ctx,
  ]);

  useEffect(() => {
    if (!native?.setSettings || !ready) return;

    const settingsToSave = sanitizeSettings({
      selectedCameraId,
      mirrorCamera,
      cameraResolution,
      cameraWidth,
      cameraHeight,
      facingMode,
      countdown,
      retakeLimit,
      screenTimers,
      numberOfShots,
      flashEnabled,
      soundEnabled,
      language,
      price,
      appMode,
      timersEnabled,
      rental: {
        timerEnabled: rentalTimerEnabled,
        timerHours: rentalTimerHours,
        sessionLimitEnabled: rentalSessionLimitEnabled,
        sessionLimit: rentalSessionLimit,
        offlineModeEnabled,
        autoSaveTarget,
        endSessionSummaryEnabled,
      },
      business: {
        paymentEnabled,
        payment: { providers: { ...paymentProviders } },
        pricing: {
          model: pricingModel,
          pricePerSession,
          additionalPrintPrice,
          currency,
          taxEnabled,
          taxRate,
        },
      },
    });

    native
      .setSettings(settingsToSave, ctx)
      .catch?.(() => { });
  }, [
    countdown,
    retakeLimit,
    screenTimers,
    numberOfShots,
    flashEnabled,
    soundEnabled,
    language,
    price,
    mirrorCamera,
    appMode,
    timersEnabled,
    rentalTimerEnabled,
    rentalTimerHours,
    rentalSessionLimitEnabled,
    rentalSessionLimit,
    offlineModeEnabled,
    autoSaveTarget,
    endSessionSummaryEnabled,
    paymentEnabled,
    paymentProviders,
    pricingModel,
    pricePerSession,
    additionalPrintPrice,
    currency,
    taxEnabled,
    taxRate,
    native,
    ready,
    ctx,
  ]);

  useEffect(() => {
    if (!native?.setCurrentEventId || !hydrated) return;
    native.setCurrentEventId(currentEvent?.id ?? null).catch?.(() => { });
  }, [currentEvent, native]);
  useEffect(() => {
    if (!native?.setCurrentSubTab) return;
    native?.setCurrentSubTab(activeSub).catch?.(() => { });
  }, [activeSub, native]);

  useEffect(() => {
    if (!currentEvent) return;
    // Example only: adjust to your storage shape/keys
    const saved = currentEvent?.appearance ?? {};
    if (saved.HeaderFont) setHeaderFont(saved.HeaderFont);
    if (saved.GeneralFont) setGeneralFont(saved.GeneralFont);
  }, [currentEvent]);

  useEffect(() => {
    loadGoogleFont(headerFont);
    loadGoogleFont(generalFont);
    loadGoogleFont(buttonFont);
  }, [headerFont, generalFont, buttonFont]);


  // === CAMERA LOAD (ADD) ============================================
  // Try to fetch from Electron; if not available, provide a safe fallback.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const cams = (await native?.listCameras?.()) || [];
        if (mounted) {
          setCameraList(Array.isArray(cams) ? normalizeCameraList(cams) : []);
        }
      } catch (e) {
        console.warn("listCameras not available; using fallback");
        if (mounted) {
          setCameraList([{ id: "default", label: "Default camera", kind: "videoinput" }]);
        }
      }
    })();
    return () => { mounted = false; };
  }, [native]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const list = await native?.listPrinters?.();
        if (mounted && Array.isArray(list)) {
          setPrinters(normalizePrinterList(list));
        }
      } catch (err) {
        console.warn("listPrinters not available; using fallback");
        if (mounted) {
          setPrinters([{ name: "Virtual Printer", displayName: "Virtual Printer", isDefault: true, options: {} }]);
        }
      }
    })();
    return () => { mounted = false; };
  }, [native]);

  useEffect(() => {
    if (activeMain !== "account" || !identity?.userId) return;

    let cancelled = false;

    (async () => {
      try {
        const [meRes, prefRes] = await Promise.all([
          typeof licensingApi.me === "function" ? licensingApi.me().catch(() => null) : Promise.resolve(null),
          window.electron?.getAccountPreferences?.().catch(() => null),
        ]);

        if (!cancelled) {
          const resolvedProfile = meRes?.profile || profile || null;
          const resolvedUser = meRes?.user || user;

          setAccountForm((prev) => ({
            ...prev,
            displayName:
              resolvedProfile?.full_name ||
              resolvedUser?.user_metadata?.full_name ||
              resolvedUser?.email ||
              "",
            email: resolvedProfile?.email || resolvedUser?.email || "",
            phone: resolvedProfile?.phone || "",
            role: resolvedProfile?.role || "Administrator",
            company: resolvedProfile?.company || "",
            badgePhoto: resolvedProfile?.avatar_url || "",
          }));
        }

        if (!cancelled && prefRes?.ok && prefRes.preferences) {
          setAccountPreferences((prev) => ({ ...prev, ...prefRes.preferences }));
        }
      } catch (err) {
        console.error("Failed to load account center:", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeMain, identity?.userId, profile, user]);

  // Autosave
  useEffect(() => {
    if (!autosaveEnabled || !currentEvent) return;
    if (typeof document !== 'undefined' && document.hidden) return;

    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    // Use a slightly longer debounce
    autosaveTimer.current = setTimeout(() => {
      try {
        saveCurrentEvent();
        showToast('Autosaved');
      } catch (e) {
        console.error('Autosave failed', e);
        showToast('Autosave failed');
      }
    }, 1600);

    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    autosaveEnabled,
    currentEvent,
    headerFont,
    generalFont,
    headerFontColor,
    generalFontColor,
    bgColor,
    countdown,
    retakeLimit,
    screenTimers,
    numberOfShots,
    flashEnabled,
    soundEnabled,
    language,
    price,
    timersEnabled,
    logoPath,
    backgroundMediaPath,
    boothName,
    boothSlogan,
    buttonBgColor,
    buttonHoverColor,
    buttonFont,
    buttonFontColor,
    startButtonHidden,
    startButtonText,
    appMode,
    rentalTimerEnabled,
    rentalTimerHours,
    rentalSessionLimitEnabled,
    rentalSessionLimit,
    offlineModeEnabled,
    autoSaveTarget,
    endSessionSummaryEnabled,
    paymentEnabled,
    paymentProviders,
    pricingModel,
    pricePerSession,
    additionalPrintPrice,
    currency,
    taxEnabled,
    taxRate,
  ]);

  // -- Utilities for events --
  const completedSessionsToday = (ev) => {
    const log = ev?.analytics?.sessionLog ?? [];
    if (Array.isArray(log) && log.length) {
      return log.filter((s) => s?.status === "completed" && isSameLocalDay(s?.ts)).length;
    }
    return ev?.analytics?.sessionsToday ?? 0;
  };

  const createEvent = (e) => {
    e.preventDefault();
    if (!newEventName.trim()) {
      showToast("Please enter an event name");
      return;
    }
    if (Number.isFinite(eventLimit) && eventLimit > 0 && events.length >= eventLimit) {
      showToast(`Event limit reached for your current plan (${eventLimit}).`);
      return;
    }
    const nextId = makeId();

    const appearanceClone = JSON.parse(JSON.stringify(DEFAULT_APPEARANCE));  // fresh defaults
    const settingsClone = JSON.parse(JSON.stringify({
      countdown: 5,
      retakeLimit: 0,
      screenTimers: DEFAULT_SCREEN_TIMERS,
      numberOfShots: 3,
      flashEnabled: true,
      soundEnabled: true,
      language: "en",
      price: 0,
      appMode: DEFAULT_APP_MODE,
      timersEnabled: false,
      rental: { ...DEFAULT_RENTAL },
      business: { ...DEFAULT_BUSINESS },
    }));

    const newEv = {
      id: nextId,
      name: newEventName.trim(),
      created: new Date().toLocaleDateString(),
      appearance: appearanceClone,
      appliedTemplates: [],
      appliedFrames: [],
      appliedTones: [],
      settings: settingsClone,
      analytics: {
        sessionsToday: 0,
        sessionsWeekly: 0,
        sessionsMonthly: 0,
        revenueToday: 0,
        revenueWeekly: 0,
        revenueMonthly: 0,
        templateUsage: {},
      },
      notes: newEventNotes,
    };
    const updated = [newEv, ...events];
    setEvents(updated);
    native?.setEvents?.(updated, { userId: identity.userId }).catch?.(() => { });
    setNewEventName("");
    setNewEventNotes("");
    showToast("Event created");
  };

  async function handleLogoutClick() {
    try {
      if (native) {
        await native?.setEvents?.(events, ctx);
        await native?.setTemplates?.(templates, ctx);
        await native?.setFrames?.(frames, ctx);
        await native?.setTones?.(tones, ctx);
        await native?.setPalettes?.(palettes, ctx);
        await native?.setAppearance?.({
          logoPath: logoPath?.url ?? null,
          backgroundMediaPath: backgroundMediaPath?.url ?? null,
          backgroundMediaName: backgroundMediaPath?.name ?? null,
          backgroundMediaMime: backgroundMediaPath?.mime ?? null,
          boothName,
          boothSlogan,
          headerFont,
          generalFont,
          headerFontColor,
          generalFontColor,
          bgColor,
          buttonBgColor,
          buttonHoverColor,
          buttonFont,
          buttonFontColor,
          startButtonHidden,
          startButtonText,
        }, ctx);

        await native?.setSettings?.({
          countdown,
          retakeLimit,
          screenTimers,
          numberOfShots,
          flashEnabled,
          soundEnabled,
          language,
          price,
          appMode,
          rental: {
            timerEnabled: rentalTimerEnabled,
            timerHours: rentalTimerHours,
            sessionLimitEnabled: rentalSessionLimitEnabled,
            sessionLimit: rentalSessionLimit,
            offlineModeEnabled,
            autoSaveTarget,
            endSessionSummaryEnabled,
          },
          business: {
            paymentEnabled,
            payment: { providers: { ...paymentProviders } },
            pricing: {
              model: pricingModel,
              pricePerSession,
              additionalPrintPrice,
              currency,
              taxEnabled,
              taxRate,
            },
          },
        }, ctx);

        await native?.setCurrentEventId?.(currentEvent?.id ?? null);
        await native?.setCurrentSubTab?.(activeSub);
      }
    } catch (err) {
      console.error("persist before logout failed", err);
    } finally {
      // Sign out of Supabase — this sets user = null in AuthContext,
      // which causes App.js to re-render <AuthGate /> automatically.
      // Do NOT call navigate() here: the component will unmount as part
      // of the re-render, and navigating on an unmounting component throws.
      try {
        if (typeof logout === "function") {
          await logout();
        } else {
          await supabase.auth.signOut();
        }
      } catch (err) {
        console.error("logout() failed", err);
      }

      // Notify parent (App.js). The onLogout prop must NOT call logout()
      // again — logout() has already run above.
      onLogout?.();
    }
  }

  const [subscription, setSubscription] = useState(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(false);
  const [subscriptionError, setSubscriptionError] = useState(null);

  const refreshSubscription = useCallback(async () => {
    setSubscriptionLoading(true);
    setSubscriptionError(null);
    try {
      const data = await licensingApi.getSubscription();
      setSubscription(data || null);
    } catch (err) {
      console.error("Failed to load subscription", err);
      // Surface the error so the UI can show a meaningful message
      // instead of silently showing "No active plan".
      setSubscriptionError(err?.message || "Could not reach billing server");
      setSubscription(null);
    } finally {
      setSubscriptionLoading(false);
    }
  }, []);

  const refreshLicense = useCallback(async () => {
    await Promise.all([
      ctxRefreshLicense({ hard: true }).catch((err) =>
        console.error("ctxRefreshLicense failed", err)
      ),
      refreshSubscription().catch((err) =>
        console.error("refreshSubscription failed", err)
      ),
    ]);
  }, [ctxRefreshLicense, refreshSubscription]);

  const checkoutPendingRef = useRef(false);

  const openCheckout = async (plan) => {
    try {
      const res = await licensingApi.createCheckoutSession(plan);

      if (!res?.url) throw new Error("No checkout URL returned from backend");

      // Open Stripe checkout in the system browser (not inside Electron's window).
      window.system?.openExternal?.(res.url) ??
        window.open(res.url, "_blank", "noopener,noreferrer");

      // Mark a checkout as pending so that when the user switches back to this
      // window after completing payment, we automatically sync the license.
      checkoutPendingRef.current = true;
      showToast?.("Checkout opened in your browser. Return here after payment to apply your plan.");
      return { ok: true };
    } catch (err) {
      console.error("openCheckout failed:", err);
      showToast?.(`Checkout failed: ${err?.message || "Unknown error"}`);
      return { ok: false, error: err?.message || "Checkout failed" };
    }
  };

  const openGalleryAddonCheckout = async () => {
    try {
      const res = await licensingApi.createGalleryAddonCheckoutSession();
      if (!res?.url) throw new Error("No checkout URL returned from backend");

      window.system?.openExternal?.(res.url) ??
        window.open(res.url, "_blank", "noopener,noreferrer");

      checkoutPendingRef.current = true;
      showToast?.("Gallery add-on checkout opened. Return here after payment to apply access.");
      return { ok: true };
    } catch (err) {
      console.error("openGalleryAddonCheckout failed:", err);
      showToast?.(`Gallery add-on checkout failed: ${err?.message || "Unknown error"}`);
      return { ok: false, error: err?.message || "Gallery add-on checkout failed" };
    }
  };

  // Auto-refresh license when the user switches back to the app after Stripe checkout.
  useEffect(() => {
    const onFocus = async () => {
      if (!checkoutPendingRef.current) return;
      checkoutPendingRef.current = false;
      showToast?.("Verifying payment…");
      try {
        await refreshLicense();
        // refreshLicense calls ctxRefreshLicense({ hard: true }) which calls billingSync.
        // If the plan changed, gating.plan will reflect it after the state update.
        showToast?.("License status updated");
      } catch (err) {
        showToast?.("Could not verify payment — try clicking Refresh license");
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshLicense]);

  useEffect(() => {
    if (!user?.id) return;
    refreshLicense();
  }, [user?.id, refreshLicense]);

  const openCustomerPortal = useCallback(async () => {
    try {
      const res = await licensingApi.customerPortal();

      if (res?.url) {
        window.system?.openExternal?.(res.url) ??
          window.open(res.url, "_blank", "noopener,noreferrer");
      } else {
        showToast?.("Portal URL not returned");
      }
    } catch (err) {
      console.error("Open portal failed", err);
      showToast?.(err?.message || "Open portal failed");
    }
  }, []);

  const toNumber = (v, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };


  // ---------------------------
  // TEMPLATE EDITOR FUNCTIONS
  // ---------------------------
  function ensureSlotNumbers(slots) {
    // Return a NEW array and resequence slotNumber starting at 1
    return slots.map((s, i) => ({ ...s, slotNumber: i + 1 }));
  }
  const snapValue = (v) => {
    if (!snapEnabled) return v;
    const step = snapPercent / 100;
    return Math.round(v / step) * step;
  };

  // Grid rendering
  const renderGrid = (cols = 24, rows = 36) => {
    if (!showGrid) return null;
    const lines = [];
    for (let i = 1; i < cols; i++) {
      lines.push(
        <div
          key={`vc${i}`}
          style={{
            position: "absolute",
            left: `${(i / cols) * 100}%`,
            top: 0,
            bottom: 0,
            width: 1,
            background: "rgba(0,0,0,0.06)",
          }}
        />
      );
    }
    for (let j = 1; j < rows; j++) {
      lines.push(
        <div
          key={`hr${j}`}
          style={{
            position: "absolute",
            top: `${(j / rows) * 100}%`,
            left: 0,
            right: 0,
            height: 1,
            background: "rgba(0,0,0,0.06)",
          }}
        />
      );
    }
    return lines;
  };

  // Preset generator (fills area with slots on grid)
  const applyPreset = (cols, rows) => {
    const padding = 0.04;
    const gridW = 1 - padding * 2;
    const gridH = 1 - padding * 2;
    const cellW = gridW / cols;
    const cellH = gridH / rows;
    const slots = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const id = makeId();
        const w = Math.max(0.05, Math.min(1, cellW * 0.9));
        const h = Math.max(0.05, Math.min(1, cellH * 0.9));
        const x = padding + c * cellW + (cellW - w) / 2;
        const y = padding + r * cellH + (cellH - h) / 2;
        slots.push({
          id,
          x: snapValue(x),
          y: snapValue(y),
          w: snapValue(w),
          h: snapValue(h),
          rotation: 0,
        });
      }
    }
    setTemplateSlotsState(ensureSlotNumbers(slots));
    setSelectionIds(slots.map((s) => s.id));
    showToast(`Applied ${cols}×${rows} preset`);
  };

  // Align / distribute tools (operate on selection or all)
  const alignSlots = (action) => {
    const targetIds = selectionIds.length ? selectionIds : templateSlotsState.map((s) => s.id);
    if (!targetIds.length) return;
    const slotsMap = Object.fromEntries(templateSlotsState.map((s) => [s.id, s]));
    const targets = targetIds.map((id) => slotsMap[id]).filter(Boolean);
    if (!targets.length) return;
    const applyTo = (fn) => {
      setTemplateSlotsState((prev) => prev.map((s) => (targetIds.includes(s.id) ? fn(s) : s)));
    };
    if (["left", "centerX", "right"].includes(action)) {
      let refX = 0;
      if (action === "centerX") {
        const minX = Math.min(...targets.map((t) => t.x ?? 0));
        const maxX = Math.max(...targets.map((t) => (t.x ?? 0) + (t.w ?? 0)));
        refX = (minX + maxX) / 2;
      }
      if (action === "right") {
        const maxX = Math.max(...targets.map((t) => (t.x ?? 0) + (t.w ?? 0)));
        refX = maxX;
      }
      applyTo((s) => {
        const w = s.w ?? 0.25;
        let x;
        if (action === "left") x = 0;
        if (action === "centerX") x = Math.max(0, Math.min(1 - w, refX - w / 2));
        if (action === "right") x = Math.max(0, Math.min(1 - w, 1 - w));
        return { ...s, x: snapValue(x) };
      });
      return;
    }
    if (["top", "centerY", "bottom"].includes(action)) {
      let refY = 0;
      if (action === "centerY") {
        const minY = Math.min(...targets.map((t) => t.y ?? 0));
        const maxY = Math.max(...targets.map((t) => (t.y ?? 0) + (t.h ?? 0)));
        refY = (minY + maxY) / 2;
      }
      if (action === "bottom") {
        const maxY = Math.max(...targets.map((t) => (t.y ?? 0) + (t.h ?? 0)));
        refY = maxY;
      }
      applyTo((s) => {
        const h = s.h ?? 0.25;
        let y;
        if (action === "top") y = 0;
        if (action === "centerY") y = Math.max(0, Math.min(1 - h, refY - h / 2));
        if (action === "bottom") y = Math.max(0, Math.min(1 - h, 1 - h));
        return { ...s, y: snapValue(y) };
      });
      return;
    }
    if (action === "distributeX") {
      const sorted = targets.slice().sort((a, b) => (a.x ?? 0) - (b.x ?? 0));
      const n = sorted.length;
      const updatedPositions = {};
      sorted.forEach((s, i) => {
        const w = s.w ?? 0.25;
        const denom = Math.max(1, n - 1);
        const x = Math.max(0, Math.min(1 - w, (i / denom) * (1 - w)));
        updatedPositions[s.id] = snapValue(x);
      });
      setTemplateSlotsState((prev) =>
        prev.map((s) => (updatedPositions[s.id] !== undefined ? { ...s, x: updatedPositions[s.id] } : s))
      );
      return;
    }
    if (action === "distributeY") {
      const sorted = targets.slice().sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
      const n = sorted.length;
      const updatedPositions = {};
      sorted.forEach((s, i) => {
        const h = s.h ?? 0.25;
        const y = Math.max(0, Math.min(1 - h, (i / (n - 1 || 1)) * (1 - h)));
        updatedPositions[s.id] = snapValue(y);
      });
      setTemplateSlotsState((prev) =>
        prev.map((s) => (updatedPositions[s.id] !== undefined ? { ...s, y: updatedPositions[s.id] } : s))
      );
      return;
    }
  };

  // Pointer (drag/resize)
  const toPixels = (norm, size) => Math.round(norm * size);
  const toNorm = (px, size) => Math.max(0, Math.min(1, px / size));

  const onCanvasPointerDown = (ev, slotId, handle = null) => {
    ev.preventDefault();

    // Capture on the actual element that receives the event (the slot).
    const targetEl = ev.currentTarget; // the slot div
    if (targetEl?.setPointerCapture) {
      try { targetEl.setPointerCapture(ev.pointerId); } catch { }
    }

    // Get the rect from the canvas container (the div with ref={canvasRef})
    // Fall back to the target element's rect if, for some reason, the ref is not set.
    const container = canvasRef.current ?? targetEl;
    if (!container) return; // should not happen, but keeps us safe

    const rect = container.getBoundingClientRect();
    const startX = ev.clientX - rect.left;
    const startY = ev.clientY - rect.top;

    const slot = templateSlotsState.find((s) => s.id === slotId);
    if (!slot) return;

    pointerState.current = {
      mode: handle ? "resize" : "move",
      slotId,
      start: { x: startX, y: startY, rect },
      orig: { ...slot },
      handle,
    };
  };

  const onCanvasPointerMove = (ev) => {
    const state = pointerState.current;
    if (!state || !state.mode) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const curX = ev.clientX - rect.left;
    const curY = ev.clientY - rect.top;
    const dx = curX - state.start.x;
    const dy = curY - state.start.y;
    const canvasW = rect.width;
    const canvasH = rect.height;
    if (state.mode === "move") {
      const orig = state.orig;
      const newX = snapValue(toNorm(toPixels(orig.x, canvasW) + dx, canvasW));
      const newY = snapValue(toNorm(toPixels(orig.y, canvasH) + dy, canvasH));
      setTemplateSlotsState((s) =>
        s.map((slot) =>
          slot.id === state.slotId
            ? {
              ...slot,
              x: Math.max(0, Math.min(1 - (orig.w ?? 0.05), newX)),
              y: Math.max(0, Math.min(1 - (orig.h ?? 0.05), newY)),
            }
            : slot
        )
      );
    } else if (state.mode === "resize") {
      const orig = state.orig;
      const handle = state.handle;
      let newW = orig.w;
      let newH = orig.h;
      let newX = orig.x;
      let newY = orig.y;
      const deltaW = dx / canvasW;
      const deltaH = dy / canvasH;
      if (handle.includes("e")) {
        newW = Math.max(0.05, Math.min(1 - orig.x, (orig.w ?? 0.25) + deltaW));
      }
      if (handle.includes("w")) {
        const pxLeft = toPixels(orig.x, canvasW) + dx;
        const normLeft = toNorm(pxLeft, canvasW);
        const right = orig.x + orig.w;
        newX = Math.max(0, Math.min(right - 0.05, normLeft));
        newW = Math.max(0.05, Math.min(1 - newX, right - newX));
      }
      if (handle.includes("s")) {
        newH = Math.max(0.05, Math.min(1 - orig.y, (orig.h ?? 0.25) + deltaH));
      }
      if (handle.includes("n")) {
        const pxTop = toPixels(orig.y, canvasH) + dy;
        const normTop = toNorm(pxTop, canvasH);
        const bottom = orig.y + orig.h;
        newY = Math.max(0, Math.min(bottom - 0.05, normTop));
        newH = Math.max(0.05, Math.min(1 - newY, bottom - newY));
      }
      setTemplateSlotsState((s) =>
        s.map((slot) =>
          slot.id === state.slotId
            ? {
              ...slot,
              x: snapValue(newX),
              y: snapValue(newY),
              w: snapValue(newW),
              h: snapValue(newH),
            }
            : slot
        )
      );
    }
  };
  const onCanvasPointerUp = (ev) => {
    const canvas = canvasRef.current;
    if (canvas) {
      try {
        canvas.releasePointerCapture(ev.pointerId);
      } catch { }
    }
    pointerState.current = { mode: null, slotId: null, start: null, orig: null, handle: null };
  };

  // Delete slot
  const deleteSlot = (e, slotId) => {
    setTemplateSlotsState((prev) =>
      prev.filter((s) => s.id !== slotId)
    );
    setSelectionIds((prev) =>
      prev.filter((id) => id !== slotId)
    );
  };

  // Duplicate slot
  const duplicateSlot = (e, slotId) => {
    const slotToCopy = templateSlotsState.find((s) => s.id === slotId);
    if (!slotToCopy) return;
    const newId = makeId();
    const offset = 0.02; // offset to avoid exact overlap
    const newSlot = {
      ...slotToCopy,
      id: newId,
      x: Math.min(slotToCopy.x + offset, 0.85),
      y: Math.min(slotToCopy.y + offset, 0.85),
      slotNumber: templateSlotsState.length + 1,
    };
    setTemplateSlotsState((prev) => [...prev, newSlot]);
    setSelectionIds([newId]);
  };

  // Rotation
  const startRotate = (e, slotId) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const slot = templateSlotsState.find((s) => s.id === slotId);
    if (!slot) return;

    const centerX = rect.left + (slot.x + slot.w / 2) * rect.width;
    const centerY = rect.top + (slot.y + slot.h / 2) * rect.height;
    const startAngle = (Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180) / Math.PI;

    rotatingRef.current = { id: slotId, startAngle, startRotation: slot.rotation ?? 0, centerX, centerY };

    const onMove = (ev) => {
      const r = rotatingRef.current;
      if (!r) return;
      const angle = (Math.atan2(ev.clientY - r.centerY, ev.clientX - r.centerX) * 180) / Math.PI;
      const delta = angle - r.startAngle;
      const newRot = Math.round(((r.startRotation + delta) % 360 + 360) % 360);
      setTemplateSlotsState((s) => s.map((slot) => (slot.id === r.id ? { ...slot, rotation: newRot } : slot)));
    };

    const onUp = () => {
      rotatingRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove, { once: false });
    window.addEventListener('pointerup', onUp, { once: true });
  };

  const onRotateMove = (e) => {
    const r = rotatingRef.current;
    if (!r) return;
    const angle = (Math.atan2(e.clientY - r.centerY, e.clientX - r.centerX) * 180) / Math.PI;
    const delta = angle - r.startAngle;
    const newRot = Math.round(((r.startRotation + delta) % 360 + 360) % 360);
    setTemplateSlotsState((s) => s.map((slot) => (slot.id === r.id ? { ...slot, rotation: newRot } : slot)));
  };
  const endRotate = () => {
    rotatingRef.current = null;
    window.removeEventListener("pointermove", onRotateMove);
    window.removeEventListener("pointerup", endRotate);
  };

  // Copy slot helper
  function copySlotByIdWithId(slots, sourceId, newId) {
    const src = slots.find((s) => s.id === sourceId);
    if (!src) return slots.slice();
    // Slightly offset so the user can see the new copy
    const OFFSET = 0.02; // 2% of the canvas
    const newX = Math.min(src.x + OFFSET, Math.max(0, 1 - src.w));
    const newY = Math.min(src.y + OFFSET, Math.max(0, 1 - src.h));
    const copy = {
      ...src,
      id: newId,
      x: newX,
      y: newY,
      // Give it the next logical slotNumber at the end
      slotNumber: (slots.length || 0) + 1,
    };
    // Return a NEW array with the copy appended
    return [...slots, copy];
  }

  // REPLACE: generateTemplateThumbnail(slots, size=370)
  // WITH: layout-aware version
  const generateTemplateThumbnail = (slots, size = 370, layout = "4x6") => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");

      // bg
      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(0, 0, size, size);

      // aspect ratios per layout
      const LAYOUT_ASPECT = {
        "4x6": [2, 3], // portrait (4x6 printed portrait)
        "2x6": [1, 3], // portrait strip
        "6x4": [3, 2], // landscape postcard
        "6x2": [3, 1], // landscape strip
      };
      const [ratioW, ratioH] = LAYOUT_ASPECT[layout] ?? LAYOUT_ASPECT["4x6"];

      // fit inside square canvas with ~80% coverage
      const maxH = size * 0.80;
      const maxW = size * 0.80;
      let targetW = maxW;
      let targetH = (targetW * ratioH) / ratioW;

      if (targetH > maxH) {
        targetH = maxH;
        targetW = (targetH * ratioW) / ratioH;
      }

      const x0 = (size - targetW) / 2;
      const y0 = (size - targetH) / 2;

      // frame border
      ctx.strokeStyle = "#e5e7eb";
      ctx.lineWidth = 2;
      ctx.strokeRect(x0, y0, targetW, targetH);

      // draw slots
      slots.forEach((s) => {
        const x = x0 + (s.x ?? 0) * targetW;
        const y = y0 + (s.y ?? 0) * targetH;
        const w = (s.w ?? 0.2) * targetW;
        const h = (s.h ?? 0.2) * targetH;
        ctx.save();
        const cx = x + w / 2;
        const cy = y + h / 2;
        ctx.translate(cx, cy);
        ctx.rotate(((s.rotation ?? 0) * Math.PI) / 180);
        ctx.translate(-cx, -cy);
        ctx.fillStyle = "rgba(0,0,0,0.06)";
        ctx.strokeStyle = "#9ca3af";
        ctx.lineWidth = 1;
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
      });

      return canvas.toDataURL("image/jpeg", 0.85);
    } catch (err) {
      console.error("generateTemplateThumbnail error", err);
      return null;
    }
  };

  const handleThumbnailFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setThumbnailUploadPreview(ev.target.result);
    };
    reader.readAsDataURL(file);
  };

  // ⬇️ Replace your persistThumbnail with this
  const persistThumbnail = async (dataUrl, templateId) => {
    // If native API is not available, just return the data URL (in-memory).
    if (!native?.saveTemplateThumbnail) {
      return { savedPath: null, dataUrl, fileUrl: null };
    }
    try {
      const filename = `template-thumb-${templateId ?? Date.now()}.jpg`;
      const res = await native.saveTemplateThumbnail(dataUrl, filename, identity.userId);
      const savedPath = res?.savedPath ?? res?.filePath ?? null;
      const fileUrl = res?.fileUrl ?? null;
      return { savedPath, dataUrl, fileUrl };
    } catch (err) {
      console.error('saveTemplateThumbnail failed', err);
      return { savedPath: null, dataUrl, fileUrl: null };
    }
  };

  const saveTemplate = async () => {
    if (!templateName.trim()) {
      setTemplateError("Template name required");
      return;
    }
    if (!editingTemplate && Number.isFinite(templateLimit) && templateLimit > 0 && templates.length >= templateLimit) {
      setTemplateError(`Template limit reached for your current plan (${templateLimit}).`);
      return;
    }

    const slots = templateSlotsState.map((s) => ({
      id: s.id,
      slotNumber: s.slotNumber,
      x: Math.max(0, Math.min(1 - (s.w ?? 0.05), s.x ?? 0)),
      y: Math.max(0, Math.min(1 - (s.h ?? 0.05), s.y ?? 0)),
      w: Math.max(0.05, Math.min(1, s.w ?? 0.25)),
      h: Math.max(0.05, Math.min(1, s.h ?? 0.25)),
      rotation: s.rotation ?? 0,
    }));

    let localThumb = thumbnailUploadPreview;
    if (!localThumb) {
      localThumb = generateTemplateThumbnail(slots, 370, templateLayout);
      setThumbnailUploadPreview(localThumb);
    }

    let savedPath = null;
    if (localThumb) {
      const res = await persistThumbnail(localThumb, editingTemplate?.id ?? makeId());
      savedPath = res.savedPath ?? null;
    }

    const previewMeta = {
      layout: templateLayout,
      thumbnailPath: savedPath ?? null,
      thumbnailDataUrl: localThumb ?? null,
      slots: JSON.parse(JSON.stringify(slots)),
    };

    let nextTemplates = templates;
    let templateRef = null;

    if (editingTemplate) {
      templateRef = {
        id: editingTemplate.id,
        name: templateName.trim(),
        previewMeta,
      };

      nextTemplates = templates.map((t) =>
        t.id === editingTemplate.id
          ? { ...t, name: templateName.trim(), slots: slots.length, previewMeta }
          : t
      );

      showToast("Template updated");
    } else {
      const newTpl = {
        id: makeId(),
        name: templateName.trim(),
        slots: slots.length,
        previewMeta,
      };

      templateRef = {
        id: newTpl.id,
        name: newTpl.name,
        previewMeta: newTpl.previewMeta,
      };

      nextTemplates = [newTpl, ...templates];
      showToast("Template created");
    }

    let nextEvents = null;

    if (addTemplateToScreen && currentEvent && templateRef) {
      const ev = JSON.parse(JSON.stringify(currentEvent));
      ev.appliedTemplates = ev.appliedTemplates ?? [];

      if (!ev.appliedTemplates.find((x) => x.id === templateRef.id)) {
        ev.appliedTemplates.push(templateRef);
      }

      nextEvents = events.map((e) => (e.id === ev.id ? ev : e));
    }

    await persistAll({
      nextTemplates,
      nextEvents,
    });

    if (addTemplateToScreen && currentEvent) {
      showToast("Template applied to current event");
    }

    setIsTemplateModalOpen(false);
    setThumbnailUploadPreview(null);
    setSelectionIds([]);
    setAddTemplateToScreen(false);
  };

  // ---------------------------
  // Stripe-like layout & rendering
  // ---------------------------

  // UPDATED: Build a left sidebar + top bar shell to resemble the screenshot.
  // Live Preview & Template Editor blocks are untouched in behavior—only re-positioned.

  return (
    <div className={`${BODY_BG} ${BODY_TEXT} h-screen overflow-hidden antialiased`} style={{ fontFamily: '"Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif' }}>
      {/* Google Fonts */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" />
      {/* ===== Shell: Sidebar + Main ===== */}
      <div className="flex h-screen bg-[radial-gradient(circle_at_top,_rgba(79,70,229,0.06),_transparent_32%),linear-gradient(180deg,_#f8faff_0%,_#f1f5f9_100%)]">
        {/* --- Left Sidebar --- */}
        <aside className="h-screen w-[280px] flex-shrink-0 border-r border-slate-200/80 bg-slate-50/80 backdrop-blur-xl flex flex-col shadow-[10px_0_40px_rgba(15,23,42,0.06)]">
          {/* Account summary */}
          <div className="border-b border-slate-200/80 px-4 py-4">
            <button
              type="button"
              onClick={() => setActiveMain("account")}
              className="group w-full flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-slate-100/70 active:scale-[0.99]"
            >
              <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-xl bg-slate-200">
                {profileImage ? (
                  <img
                    src={profileImage}
                    alt="Profile"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div
                    className="flex h-full w-full items-center justify-center text-sm font-semibold text-white"
                    style={{
                      background: `linear-gradient(135deg, ${ACCENT_COLOR}, #7c3aed)`,
                    }}
                  >
                    {sidebarInitial}
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1 text-left">
                <div className="truncate text-sm font-medium text-slate-900 group-hover:text-indigo-600">
                  {sidebarDisplayName}
                </div>
                <div className="truncate text-xs text-slate-500">
                  {sidebarEmail}
                </div>
              </div>

              <svg
                className="h-4 w-4 flex-shrink-0 text-slate-300 transition group-hover:text-indigo-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.8}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>
          </div>

          {/* Main nav */}
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <div className="space-y-5">
              <div>
                <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Main
                </div>
                <div className="space-y-1">
                  {[
                    {
                      id: "home",
                      label: "Home",
                      icon: (
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.75}
                          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                        />
                      ),
                    },
                    {
                      id: "events",
                      label: "Events",
                      icon: (
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.75}
                          d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                        />
                      ),
                    },
                    {
                      id: "dashboard",
                      label: "Dashboard",
                      icon: (
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.75}
                          d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
                        />
                      ),
                    },
                  ].map(({ id, label, icon }) => {
                    const active = activeMain === id;
                    return (
                      <button
                        key={id}
                        onClick={() => setActiveMain(id)}
                        className={`w-full flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${active
                          ? "bg-indigo-50 text-indigo-700 shadow-[inset_0_0_0_1px_rgba(99,102,241,0.12)]"
                          : "text-slate-600 hover:bg-white hover:text-slate-900"
                          }`}
                      >
                        <svg
                          className={`h-4 w-4 flex-shrink-0 ${active ? "text-indigo-600" : "text-slate-400"
                            }`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          {icon}
                        </svg>
                        <span>{label}</span>

                        {id === "events" && events.length > 0 && (
                          <span className="ml-auto rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-500">
                            {events.length}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Configure
                </div>
                <button
                  onClick={() => setActiveMain("settings")}
                  className={`w-full flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${activeMain === "settings"
                    ? "bg-indigo-50 text-indigo-700 shadow-[inset_0_0_0_1px_rgba(99,102,241,0.12)]"
                    : "text-slate-600 hover:bg-white hover:text-slate-900"
                    }`}
                >
                  <svg
                    className={`h-4 w-4 flex-shrink-0 ${activeMain === "settings" ? "text-indigo-600" : "text-slate-400"
                      }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.75}
                      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                  <span>Settings</span>
                </button>

                <button
                  onClick={() => setActiveMain("booths")}
                  className={`w-full flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${activeMain === "booths"
                    ? "bg-indigo-50 text-indigo-700 shadow-[inset_0_0_0_1px_rgba(99,102,241,0.12)]"
                    : "text-slate-600 hover:bg-white hover:text-slate-900"
                    }`}
                >
                  <svg
                    className={`h-4 w-4 flex-shrink-0 ${activeMain === "booths" ? "text-indigo-600" : "text-slate-400"
                      }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.75}
                      d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.14 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0"
                    />
                  </svg>
                  <span>Remote Booth</span>
                </button>
              </div>

              <div>
                <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Insights
                </div>
                <button
                  onClick={() => setActiveMain("reports")}
                  className={`w-full flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${activeMain === "reports"
                    ? "bg-indigo-50 text-indigo-700 shadow-[inset_0_0_0_1px_rgba(99,102,241,0.12)]"
                    : "text-slate-600 hover:bg-white hover:text-slate-900"
                    }`}
                >
                  <svg
                    className={`h-4 w-4 flex-shrink-0 ${activeMain === "reports" ? "text-indigo-600" : "text-slate-400"
                      }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.75}
                      d="M11 3v18M4 14l7-7 9 9"
                    />
                  </svg>
                  <span>Reports</span>
                </button>
              </div>

              {currentEvent && (
                <div className="mx-1">
                  <div className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Active event
                  </div>
                  <button
                    onClick={() => setActiveMain("dashboard")}
                    className="w-full rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white px-3 py-3 text-left transition-all hover:border-indigo-200 hover:shadow-sm active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="truncate text-xs font-semibold text-indigo-900">
                        {currentEvent.name || "Untitled"}
                      </div>
                      <span className="h-2 w-2 flex-shrink-0 rounded-full bg-emerald-400" />
                    </div>
                    <div className="mt-1 text-[11px] text-indigo-500">
                      Open event workspace
                    </div>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Bottom nav */}
          <div className="space-y-4 border-t border-slate-200/80 bg-white/70 px-4 pb-5 pt-4">
            <div className="space-y-1">
              {[
                {
                  id: "helpcenter",
                  label: "Help Center",
                  icon: (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.75}
                      d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  ),
                },
              ].map(({ id, label, icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveMain(id)}
                  className={`w-full flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${activeMain === id
                    ? "bg-indigo-50 text-indigo-700 shadow-[inset_0_0_0_1px_rgba(99,102,241,0.12)]"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    }`}
                >
                  <svg
                    className={`h-4 w-4 flex-shrink-0 ${activeMain === id ? "text-indigo-600" : "text-slate-400"
                      }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    {icon}
                  </svg>
                  <span>{label}</span>
                </button>
              ))}
            </div>

            <div className="border-t border-slate-200/80 pt-4">
              <button
                onClick={handleLogoutClick}
                className="w-full flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium text-red-500 transition-all hover:bg-red-50 hover:text-red-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <svg
                  className="h-4 w-4 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.75}
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                  />
                </svg>
                <span>Sign out</span>
              </button>
            </div>
          </div>
        </aside>

        {/* --- Main Content --- */}
        <div className="min-h-0 min-w-0 flex-1 bg-transparent">
          <main className="h-full min-h-0 overflow-y-auto">
            <div className="mx-auto w-full max-w-[1600px] px-6 py-6 xl:px-8 2xl:px-10">

              {activeMain === "home" && renderHomeDashboard()}

              {activeMain === "dashboard" && !currentEvent && (
                <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} min-h-[360px] flex items-center justify-center p-10 text-center`}>
                  <div className="max-w-md">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 text-gray-400">
                      <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 21H5a2 2 0 01-2-2V7a2 2 0 012-2h4l2-2h8a2 2 0 012 2v14a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <h3 className="text-base font-semibold text-gray-900">No event selected</h3>
                    <p className="mt-2 text-sm text-gray-500">Go to Events to open or create one.</p>
                    <button
                      type="button"
                      onClick={() => setActiveMain("events")}
                      className="mt-4 inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 active:scale-[0.98]"
                    >
                      Go to Events
                    </button>
                  </div>
                </div>
              )}

              {activeMain === "dashboard" && currentEvent && (
                <div className="mb-6 space-y-4">
                  {/* Breadcrumb + event actions */}
                  <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} flex flex-col gap-4 px-5 py-5 lg:flex-row lg:items-start lg:justify-between`}>
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
                        <button
                          type="button"
                          onClick={() => { setCurrentEvent(null); setActiveMain("events"); }}
                          className="hover:text-gray-600 transition-colors active:scale-[0.98]"
                        >
                          Events
                        </button>
                        <span>{'>'}</span>
                        <button
                          type="button"
                          onClick={() => setActiveMain("dashboard")}
                          className="max-w-[220px] truncate font-medium text-gray-600 hover:text-gray-800 transition-colors active:scale-[0.98]"
                        >
                          {currentEvent?.name || "Untitled event"}
                        </button>
                        <span>{'>'}</span>
                        <button
                          type="button"
                          onClick={() => setActiveSub(activeSub)}
                          className="font-medium text-indigo-600 hover:text-indigo-700 transition-colors active:scale-[0.98]"
                        >
                          {activeSub === "background color"
                            ? "Background Color"
                            : activeSub === "controls"
                              ? "Session"
                              : activeSub === "analytics"
                                ? "Business"
                                : activeSub === "sharing"
                                  ? "Live Preview"
                                  : String(activeSub || "Branding").charAt(0).toUpperCase() + String(activeSub || "Branding").slice(1)}
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 min-w-0">
                        <h3 className="text-sm font-semibold text-gray-900 truncate">
                          {currentEvent?.name || "Untitled event"}
                        </h3>
                        <span className="flex-shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-600 border border-indigo-100">
                          {currentEvent?.settings?.appMode ?? appMode ?? DEFAULT_APP_MODE}
                        </span>
                        <div className="hidden md:flex items-center gap-3 text-[11px] text-gray-400">
                          <span>{Array.isArray(currentEvent?.appliedTemplates) ? currentEvent.appliedTemplates.length : 0} templates</span>
                          <span>·</span>
                          <span>{Array.isArray(currentEvent?.appliedFrames) ? currentEvent.appliedFrames.length : 0} frames</span>
                          <span>·</span>
                          <span>{currentEvent?.settings?.numberOfShots ?? numberOfShots ?? "—"} shots</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={autosaveEnabled}
                          onChange={(e) => setAutosaveEnabled(e.target.checked)}
                          className="w-3.5 h-3.5 rounded accent-indigo-600"
                        />
                        Autosave
                      </label>

                      <button
                        type="button"
                        onClick={saveCurrentEvent}
                        className={BTN_GHOST}
                      >
                        Save
                      </button>

                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const evCopy = JSON.parse(JSON.stringify(currentEvent));
                            const mergedEvent = {
                              ...evCopy,
                              settings: { ...(evCopy.settings || {}), ...settingsToSave },
                            };
                            const updatedEvents = events.map((item) =>
                              item.id === mergedEvent.id ? mergedEvent : item
                            );
                            setCurrentEvent(mergedEvent);
                            setEvents(updatedEvents);
                            await native?.setEvents?.(updatedEvents, ctx);
                            await native?.setCurrentEventId?.(mergedEvent.id);
                            if (typeof onStartPhotobooth === "function") {
                              onStartPhotobooth(mergedEvent);
                            }
                          } catch (e) {
                            console.error("Start Photo booth failed:", e);
                          }
                        }}
                        className={BTN_PRIMARY}
                      >
                        Start booth
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* DASHBOARD SUB-TABS */}
              {activeMain === "dashboard" && currentEvent && (
                <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} mb-6 p-4`}>
                  <div className="space-y-3">
                    <div>
                      <div className={`${EYEBROW} mb-2`}>Creative Setup</div>
                      <div className="flex flex-wrap gap-2">
                        {[
                          ["branding", "Branding"],
                          ["templates", "Templates"],
                          ["frames", "Frames"],
                          ["tones", "Tones"],
                          ["background color", "Background Color"],
                        ].map(([tab, label]) => (
                          <button
                            key={tab}
                            type="button"
                            onClick={() => setActiveSub(tab)}
                            className={`px-4 py-2 text-sm font-semibold rounded-full transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed ${activeSub === tab
                              ? "bg-indigo-600 text-white shadow-md shadow-indigo-200"
                              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                              }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <hr className="border-slate-100" />

                    <div>
                      <div className={`${EYEBROW} mb-2`}>Controls & Analytics</div>
                      <div className="flex flex-wrap gap-2">
                        {[
                          ["controls", "Controls"],
                          ["analytics", "Analytics"],
                          ["sharing", "Sharing"],
                        ].map(([tab, label]) => (
                          <button
                            key={tab}
                            type="button"
                            onClick={() => setActiveSub(tab)}
                            className={`px-4 py-2 text-sm font-semibold rounded-full transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed ${activeSub === tab
                              ? "bg-indigo-600 text-white shadow-md shadow-indigo-200"
                              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                              }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ===== CONTENT AREA ===== */}

              {/* Account & Billing */}
              {activeMain === "account" && renderAccountBilling()}

              {activeMain === "subscription" && renderAccountBilling()}

              {activeMain === "booths" && (
                <div className="space-y-4">
                  <div className="relative overflow-hidden rounded-3xl border border-white/20 bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-700 px-6 py-6 text-white shadow-[0_24px_64px_rgba(79,70,229,0.25)]">
                    <WavePattern />
                    <div className="relative z-10">
                      <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white">Remote</div>
                      <h2 className="mt-3 text-2xl font-bold tracking-tight" style={{ fontFamily: '"Fraunces", ui-serif, Georgia, serif' }}>Remote Booths</h2>
                      <p className="mt-1.5 text-sm text-white/80">Monitor and control connected booth devices.</p>
                    </div>
                  </div>

                  {boothsLoading ? (
                    <div className="text-sm text-slate-500 px-1">Loading booths...</div>
                  ) : booths.length === 0 ? (
                    <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-8 text-center`}>
                      <div className="text-sm text-slate-400">No booths registered yet.</div>
                      <div className="mt-1 text-xs text-slate-400">Start your booth app to register it automatically.</div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {booths.map(booth => (
                        <div key={booth.id} className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-5`}>
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="font-semibold text-slate-900">{booth.name}</div>
                              <div className="text-xs text-slate-500 mt-0.5">{booth.platform} · v{booth.app_version}</div>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <div className={`w-2 h-2 rounded-full ${booth.is_online ? 'bg-emerald-400' : 'bg-slate-300'}`} />
                              <span className={`text-xs font-medium ${booth.is_online ? 'text-emerald-600' : 'text-slate-400'}`}>
                                {booth.is_online ? 'Online' : 'Offline'}
                              </span>
                            </div>
                          </div>

                          <div className="text-xs text-slate-400 mt-2">
                            Last seen: {booth.last_seen_at
                              ? new Date(booth.last_seen_at).toLocaleString()
                              : 'Never'}
                          </div>

                          {booth.is_online && (
                            <div className="flex flex-wrap gap-2 mt-4">
                              <button
                                onClick={() => sendCommandToBooth(booth.id, 'ping')}
                                className={BTN_GHOST}
                              >
                                Ping
                              </button>
                              <button
                                onClick={() => sendCommandToBooth(booth.id, 'restart-booth')}
                                className={BTN_GHOST}
                              >
                                Restart
                              </button>
                              <button
                                onClick={() => sendCommandToBooth(booth.id, 'update-event', {
                                  event: currentEvent
                                })}
                                disabled={!currentEvent}
                                className={BTN_SECONDARY}
                              >
                                Push current event
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeMain === "reports" && (
                <div className="space-y-5">

                  {/* Header */}
                  <div className="relative overflow-hidden rounded-3xl border border-white/20 bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-700 px-6 py-6 text-white shadow-[0_24px_64px_rgba(79,70,229,0.25)]">
                    <WavePattern />
                    <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white">Analytics</div>
                        <h2 className="mt-3 text-2xl font-bold tracking-tight" style={{ fontFamily: '"Fraunces", ui-serif, Georgia, serif' }}>Reports</h2>
                        <p className="mt-1.5 text-sm text-white/80">Session activity, revenue, and performance metrics.</p>
                      </div>
                      <select
                        value={reportEventId}
                        onChange={(e) => setReportEventId(e.target.value)}
                        className="rounded-full border border-white/25 bg-white/15 px-4 py-2 text-sm text-white font-medium outline-none hover:bg-white/25 transition"
                      >
                        <option value="all" className="text-slate-900">All events</option>
                        {events.map(ev => (
                          <option key={ev.id} value={ev.id} className="text-slate-900">{ev.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Summary KPIs */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {[
                      { label: "Sessions", value: reportSessions.length, color: "text-gray-900" },
                      { label: "Photos", value: reportPhotos, color: "text-gray-900" },
                      { label: "Gross Revenue", value: peso(reportGross), color: "text-indigo-600" },
                      { label: "Conversion", value: `${reportConversionRate}%`, color: "text-emerald-600" },
                      { label: "Peak Hour", value: `${peakHour}:00`, color: "text-gray-900" },
                    ].map(({ label, value, color }) => (
                      <div key={label} className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-4`}>
                        <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">{label}</div>
                        <div className={`mt-1.5 text-xl font-bold tabular-nums ${color}`}>{value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Chart */}
                  <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-5`}>
                    <div className="flex items-center justify-between mb-4">
                      <div className="text-sm font-semibold text-gray-800">Sessions per hour</div>
                      <div className="text-xs text-gray-400">All-time across selected filter</div>
                    </div>
                    <div className="h-32 flex items-end gap-px">
                      {reportSessionsPerHour.map((v, i) => (
                        <div
                          key={i}
                          className="flex-1 rounded-sm bg-indigo-500/70 hover:bg-indigo-600 transition-colors"
                          style={{ height: `${(v / reportMaxHour) * 100}%`, minHeight: v > 0 ? 3 : 1 }}
                          title={`${v} sessions at ${i}:00`}
                        />
                      ))}
                    </div>
                    <div className="flex justify-between text-[10px] text-gray-400 mt-2">
                      <span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    <button className={BTN_GHOST}>
                      Export CSV
                    </button>
                    <button className={BTN_GHOST}>
                      Export PDF
                    </button>
                  </div>

                </div>
              )}

              {activeMain === "settings" && (
                <div className="space-y-6">
                  {/* ================= Header ================= */}
                  <div className="relative overflow-hidden rounded-3xl border border-white/20 bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-700 px-6 py-6 text-white shadow-[0_24px_64px_rgba(79,70,229,0.25)]">
                    <WavePattern />
                    <div className="relative z-10 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white">
                          Settings
                        </div>
                        <h2 className="mt-3 text-2xl font-bold tracking-tight" style={{ fontFamily: '"Fraunces", ui-serif, Georgia, serif' }}>
                          Booth Configuration
                        </h2>
                        <p className="mt-1.5 text-sm text-white/80">
                          Configure devices, storage, recovery, and booth behavior.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={saveSettings}
                          className="inline-flex items-center justify-center rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-indigo-700 shadow-md transition hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.98]"
                        >
                          Save settings
                        </button>
                        <button
                          type="button"
                          onClick={resetSettingsToDefault}
                          className="inline-flex items-center justify-center rounded-full border border-white/25 bg-white/15 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/25 active:scale-[0.98]"
                        >
                          Reset to defaults
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* ================= Quick status ================= */}
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-4`}>
                      <div className={EYEBROW}>
                        Camera
                      </div>
                      <div className={`mt-2 text-lg font-semibold ${cameraOnline ? "text-emerald-600" : "text-amber-600"}`}>
                        {cameraOnline ? "Ready" : "Needs attention"}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        {cameraStatusText || "Camera status unknown"}
                      </div>
                    </div>

                    <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-4`}>
                      <div className={EYEBROW}>
                        Printer
                      </div>
                      <div className={`mt-2 text-lg font-semibold ${printerOnline ? "text-emerald-600" : "text-amber-600"}`}>
                        {printerOnline ? "Ready" : "Needs attention"}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        {printerStatusText || "Printer status unknown"}
                      </div>
                    </div>

                    <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-4`}>
                      <div className={EYEBROW}>
                        Storage
                      </div>
                      <div className="mt-2 text-lg font-semibold text-gray-900">
                        {getEffectiveStoragePath() ? "Configured" : "Missing"}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        {storageStatusText || "No storage folder selected"}
                      </div>
                    </div>

                    <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-4`}>
                      <div className={EYEBROW}>
                        Updates
                      </div>
                      <div className="mt-2 text-lg font-semibold text-gray-900">
                        {updateState === "downloading"
                          ? `${updatePercent}%`
                          : updateState === "ready"
                            ? "Ready"
                            : updateState === "checking"
                              ? "Checking"
                              : "Idle"}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        {updateStatusText || "No update check yet"}
                      </div>
                    </div>
                  </div>

                  {/* ================= Settings Tabs ================= */}
                  <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${TOOLBAR_RADIUS} ${SHADOW_SOFT} p-2`}>
                    <div className="flex flex-wrap items-center gap-2">
                      {[
                        { id: "camera", label: "Camera" },
                        { id: "printing", label: "Printing" },
                        { id: "storage", label: "Storage" },
                        { id: "general", label: "General" },
                        { id: "logs", label: "Audit & Logs" },
                        { id: "system", label: "System" },
                      ].map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setActiveSettingsTab(tab.id)}
                          className={`px-4 py-2 text-sm font-semibold transition-all active:scale-[0.98] rounded-full ${activeSettingsTab === tab.id
                            ? "bg-indigo-600 text-white shadow-md shadow-indigo-200"
                            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                            }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ================= Active tab content ================= */}
                  <div className="space-y-6">
                    <div className="mb-6">
                      <h3 className="text-sm font-semibold text-gray-800">{getSettingsSectionMeta(activeSettingsTab).title}</h3>
                      <p className="text-xs text-gray-400 mt-0.5">{getSettingsSectionMeta(activeSettingsTab).description}</p>
                    </div>
                    {activeSettingsTab === "camera" && (
                      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                        <div className={`xl:col-span-2 ${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                                <span>Camera setup</span>
                                <span className={`inline-block h-2.5 w-2.5 rounded-full ${cameraOnline ? "bg-green-500" : "bg-red-500"}`} />
                              </div>
                              <div className="text-xs text-gray-500 mt-1">
                                Select the active camera and configure capture behavior.
                              </div>
                            </div>

                            <button
                              onClick={refreshCameras}
                              disabled={cameraLoading}
                              className={`${BTN_GHOST} text-sm px-4 py-2`}
                            >
                              {cameraLoading ? (<>
                                <svg className="mr-2 inline h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                                </svg>
                                Refreshing...
                              </>) : "Refresh cameras"}
                            </button>
                          </div>

                          {cameraError && (
                            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                              {cameraError}
                            </div>
                          )}

                          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                            <label className="block text-xs text-gray-700">
                              Camera device
                              <select
                                value={asSelectValue(selectedCameraId)}
                                onChange={(e) => setSelectedCameraId(e.target.value)}
                                className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-3 py-2 mt-1 w-full`}
                              >
                                {!cameraList.length && <option value="">No cameras found</option>}
                                {cameraList.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.label || c.id}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label className="block text-xs text-gray-700">
                              Resolution
                              <select
                                value={cameraResolution}
                                onChange={(e) => setCameraResolution(e.target.value)}
                                className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-3 py-2 mt-1 w-full`}
                              >
                                {CAMERA_RESOLUTION_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label className="block text-xs text-gray-700">
                              Facing mode
                              <select
                                value={facingMode}
                                onChange={(e) => setFacingMode(e.target.value)}
                                className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-3 py-2 mt-1 w-full`}
                              >
                                {CAMERA_FACING_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label className="block text-xs text-gray-700">
                              Output size
                              <input
                                type="text"
                                value={`${cameraWidth} × ${cameraHeight}`}
                                readOnly
                                className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-3 py-2 mt-1 w-full bg-gray-50`}
                              />
                            </label>

                            <label className="flex items-center gap-2 text-sm text-gray-700">
                              <input
                                type="checkbox"
                                checked={mirrorCamera}
                                onChange={(e) => setMirrorCamera(e.target.checked)}
                              />
                              Mirror camera preview
                            </label>

                            <label className="flex items-center gap-2 text-sm text-gray-700">
                              <input
                                type="checkbox"
                                checked={flashEnabled}
                                onChange={(e) => setFlashEnabled(e.target.checked)}
                              />
                              Enable flash
                            </label>

                            <label className="flex items-center gap-2 text-sm text-gray-700 md:col-span-2">
                              <input
                                type="checkbox"
                                checked={soundEnabled}
                                onChange={(e) => setSoundEnabled(e.target.checked)}
                              />
                              Play sound before capture
                            </label>
                          </div>
                        </div>

                        <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
                          <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                            <span>Camera status</span>
                            <span className={`inline-block h-2.5 w-2.5 rounded-full ${cameraOnline ? "bg-green-500" : "bg-red-500"}`} />
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            Current active device and capture preferences.
                          </div>

                          <div className="mt-4 space-y-3">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-gray-500">Connection</span>
                              <span className={cameraOnline ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                                {cameraOnline ? "Ready" : "Unavailable"}
                              </span>
                            </div>

                            <div className="text-xs text-gray-500">
                              {cameraStatusText}
                            </div>

                            <div className="pt-2 border-t border-gray-100 space-y-2 text-xs text-gray-600">
                              <div className="flex justify-between gap-3">
                                <span>Selected camera</span>
                                <span className="text-gray-900 text-right truncate">
                                  {cameraList.find((c) => c.id === selectedCameraId)?.label || selectedCameraId || "—"}
                                </span>
                              </div>

                              <div className="flex justify-between gap-3">
                                <span>Resolution preset</span>
                                <span className="text-gray-900 text-right">
                                  {cameraResolution || "—"}
                                </span>
                              </div>

                              <div className="flex justify-between gap-3">
                                <span>Facing mode</span>
                                <span className="text-gray-900 text-right capitalize">
                                  {facingMode || "—"}
                                </span>
                              </div>

                              <div className="flex justify-between gap-3">
                                <span>Output size</span>
                                <span className="text-gray-900 text-right">
                                  {cameraWidth} × {cameraHeight}
                                </span>
                              </div>

                              <div className="flex justify-between gap-3">
                                <span>Mirror</span>
                                <span className="text-gray-900 text-right">
                                  {mirrorCamera ? "Enabled" : "Disabled"}
                                </span>
                              </div>

                              <div className="flex justify-between gap-3">
                                <span>Detected cameras</span>
                                <span className="text-gray-900 text-right">
                                  {cameraList.length}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {activeSettingsTab === "printing" && (
                      <div className="mt-0 grid grid-cols-1 xl:grid-cols-3 gap-4">
                        <div className={`xl:col-span-2 ${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                                <span>Printer setup</span>
                                <span className={`inline-block h-2.5 w-2.5 rounded-full ${printerOnline ? "bg-green-500" : "bg-red-500"}`} />
                              </div>
                              <div className="text-xs text-gray-500 mt-1">
                                Configure the printer, paper size, output quality, and print behavior.
                              </div>
                            </div>

                            <button
                              onClick={refreshPrinters}
                              disabled={printerLoading}
                              className={`${BTN_GHOST} text-sm px-4 py-2`}
                            >
                              {printerLoading ? (<>
                                <svg className="mr-2 inline h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                                </svg>
                                Refreshing...
                              </>) : "Refresh printers"}
                            </button>
                          </div>

                          {printerError && (
                            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                              {printerError}
                            </div>
                          )}

                          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                            <label className="block text-xs text-gray-700">
                              Printer
                              <select
                                value={selectedPrinter}
                                onChange={(e) => setSelectedPrinter(e.target.value)}
                                className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-3 py-2 mt-1 w-full`}
                              >
                                {!printers.length && <option value="">No printers found</option>}
                                {printers.map((p) => (
                                  <option key={p.name} value={p.name}>
                                    {p.displayName || p.name}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label className="mt-6 inline-flex items-center gap-2 text-sm text-gray-700">
                              <input
                                type="checkbox"
                                checked={usePrinterDefaults}
                                onChange={(e) => setUsePrinterDefaults(e.target.checked)}
                              />
                              Use printer system defaults
                            </label>

                            <label className="block text-xs text-gray-700">
                              Paper size
                              <select
                                value={usePrinterDefaults ? "" : paperSize}
                                disabled={usePrinterDefaults}
                                onChange={(e) => setPaperSize(e.target.value)}
                                className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-3 py-2 mt-1 w-full ${usePrinterDefaults ? "opacity-40 pointer-events-none cursor-not-allowed bg-gray-50" : ""
                                  }`}
                              >
                                {usePrinterDefaults ? (
                                  <option value="">{printerSystemLayout || "System default"}</option>
                                ) : (
                                  paperSizeOptions.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                      {opt.label}{opt.source === "app" ? " (Custom)" : ""}
                                    </option>
                                  ))
                                )}
                              </select>
                            </label>

                            <label className="block text-xs text-gray-700">
                              Orientation
                              <select
                                value={printOrientation}
                                disabled={usePrinterDefaults}
                                onChange={(e) => setPrintOrientation(e.target.value)}
                                className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-3 py-2 mt-1 w-full ${usePrinterDefaults ? "opacity-40 pointer-events-none cursor-not-allowed bg-gray-50" : ""}`}
                              >
                                {PRINT_ORIENTATION_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label className="block text-xs text-gray-700">
                              Copies
                              <input
                                type="number"
                                min={1}
                                max={20}
                                value={printCopies}
                                disabled={usePrinterDefaults}
                                onChange={(e) => setPrintCopies(clamp(e.target.value, 1, 20, 1))}
                                className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-3 py-2 mt-1 w-full ${usePrinterDefaults ? "opacity-40 pointer-events-none cursor-not-allowed bg-gray-50" : ""}`}
                              />
                            </label>

                            <label className="block text-xs text-gray-700">
                              Color mode
                              <select
                                value={printColorMode}
                                disabled={usePrinterDefaults}
                                onChange={(e) => setPrintColorMode(e.target.value)}
                                className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-3 py-2 mt-1 w-full ${usePrinterDefaults ? "opacity-40 pointer-events-none cursor-not-allowed bg-gray-50" : ""}`}
                              >
                                {PRINT_COLOR_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label className="block text-xs text-gray-700">
                              Print quality
                              <select
                                value={printQuality}
                                disabled={usePrinterDefaults}
                                onChange={(e) => setPrintQuality(e.target.value)}
                                className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-3 py-2 mt-1 w-full ${usePrinterDefaults ? "opacity-40 pointer-events-none cursor-not-allowed bg-gray-50" : ""}`}
                              >
                                {PRINT_QUALITY_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label className="block text-xs text-gray-700">
                              Print DPI
                              <input
                                type="number"
                                min={72}
                                max={1200}
                                value={printDpi}
                                disabled={usePrinterDefaults}
                                onChange={(e) => setPrintDpi(clamp(e.target.value, 72, 1200, 300))}
                                className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-3 py-2 mt-1 w-full ${usePrinterDefaults ? "opacity-40 pointer-events-none cursor-not-allowed bg-gray-50" : ""}`}
                              />
                            </label>
                          </div>

                          <div className="mt-4 flex flex-wrap items-center gap-3">
                            <button
                              onClick={checkPrinterHealth}
                              disabled={!selectedPrinter || printerLoading}
                              className={`${BTN_GHOST} text-sm px-4 py-2`}
                            >
                              Check status
                            </button>
                            <button
                              onClick={testPrint}
                              disabled={!selectedPrinter}
                              className={`${BTN_PRIMARY} text-sm px-4 py-2`}
                            >
                              Test print
                            </button>
                          </div>
                        </div>

                        <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
                          <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                            <span>Printer status</span>
                            <span className={`inline-block h-2.5 w-2.5 rounded-full ${printerOnline ? "bg-green-500" : "bg-red-500"}`} />
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            Quick health summary for the selected printer.
                          </div>

                          <div className="mt-4 space-y-3">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-gray-500">Connection</span>
                              <span className={printerOnline ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                                {printerOnline ? "Online" : "Offline"}
                              </span>
                            </div>

                            <div className="text-xs text-gray-500">
                              {printerStatusText}
                            </div>

                            <div className="pt-2 border-t border-gray-100 space-y-2 text-xs text-gray-600">
                              <div className="flex justify-between gap-3">
                                <span>Selected printer</span>
                                <span className="text-gray-900 truncate text-right">
                                  {selectedPrinter || "—"}
                                </span>
                              </div>

                              <div className="flex justify-between gap-3">
                                <span>Driver orientation</span>
                                <span className="text-gray-900 text-right">
                                  {printerCapabilities?.orientation || "—"}
                                </span>
                              </div>

                              <div className="flex justify-between gap-3">
                                <span>Current layout</span>
                                <span className="text-gray-900 text-right">
                                  {paperSize || "—"}
                                </span>
                              </div>

                              <div className="flex justify-between gap-3">
                                <span>Color</span>
                                <span className="text-gray-900 text-right capitalize">
                                  {printColorMode}
                                </span>
                              </div>

                              <div className="flex justify-between gap-3">
                                <span>Quality</span>
                                <span className="text-gray-900 text-right capitalize">
                                  {printQuality}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {activeSettingsTab === "storage" && (
                      <div className="mt-0 grid grid-cols-1 xl:grid-cols-3 gap-4">
                        <div className={`xl:col-span-2 ${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-medium text-gray-900">Storage setup</div>
                              <div className="text-xs text-gray-500 mt-1">
                                Choose where photos are stored and manage automatic cleanup.
                              </div>
                            </div>

                            <button
                              onClick={selectStoragePath}
                              className={`${BTN_PRIMARY} text-sm px-4 py-2`}
                            >
                              Choose folder
                            </button>
                          </div>

                          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                            <label className="block text-xs text-gray-700 md:col-span-2">
                              Storage path
                              <input
                                type="text"
                                value={storagePath || ""}
                                readOnly
                                placeholder="No folder selected"
                                className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-3 py-2 mt-1 w-full bg-gray-50`}
                              />
                            </label>

                            <label className="block text-xs text-gray-700">
                              Auto cleanup
                              <select
                                value={autoDeleteDays}
                                onChange={(e) => setAutoDeleteDays(Number(e.target.value))}
                                className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-3 py-2 mt-1 w-full`}
                              >
                                <option value={0}>Never</option>
                                <option value={7}>7 days</option>
                                <option value={14}>14 days</option>
                                <option value={30}>30 days</option>
                                <option value={60}>60 days</option>
                              </select>
                            </label>

                            <div className="flex items-end">
                              <button
                                onClick={typeof runStorageCleanup === "function" ? runStorageCleanup : undefined}
                                disabled={typeof runStorageCleanup !== "function" || !storagePath}
                                className={`${BTN_GHOST} text-sm px-4 py-2 w-full`}
                              >
                                Run cleanup now
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
                          <div className="text-sm font-medium text-gray-900">Storage status</div>
                          <div className="text-xs text-gray-500 mt-1">
                            Summary of the current save location and cleanup behavior.
                          </div>

                          <div className="mt-4 space-y-3">
                            <div className="flex justify-between gap-3 text-sm">
                              <span className="text-gray-500">Save location</span>
                              <span className="text-gray-900 text-right truncate">
                                {storagePath || "Not configured"}
                              </span>
                            </div>

                            <div className="pt-2 border-t border-gray-100 space-y-2 text-xs text-gray-600">
                              <div className="flex justify-between gap-3">
                                <span>Auto cleanup</span>
                                <span className="text-gray-900">
                                  {Number(autoDeleteDays) === 0 ? "Disabled" : `${autoDeleteDays} days`}
                                </span>
                              </div>

                              <div className="flex justify-between gap-3">
                                <span>Folder selected</span>
                                <span className="text-gray-900">
                                  {storagePath ? "Yes" : "No"}
                                </span>
                              </div>

                              {typeof storageStatusText !== "undefined" && (
                                <div className="pt-2 border-t border-gray-100">
                                  <div className="text-xs text-gray-500">{storageStatusText}</div>
                                </div>
                              )}

                              {typeof storageInfo !== "undefined" && storageInfo && (
                                <div className="space-y-2 pt-2 border-t border-gray-100">
                                  {"writable" in storageInfo && (
                                    <div className="flex justify-between gap-3">
                                      <span>Writable</span>
                                      <span className="text-gray-900">
                                        {storageInfo.writable ? "Yes" : "No"}
                                      </span>
                                    </div>
                                  )}

                                  {"freeSpace" in storageInfo && (
                                    <div className="flex justify-between gap-3">
                                      <span>Free space</span>
                                      <span className="text-gray-900">{storageInfo.freeSpace}</span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {activeSettingsTab === "general" && (
                      <div className="mt-0 space-y-4">
                        {/* Booth Identity */}
                        <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
                          <div className="text-sm font-medium text-gray-900">Booth identity</div>
                          <div className="text-xs text-gray-500 mt-1">
                            Name and location information displayed on receipts and sessions.
                          </div>

                          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                            <label className="block text-xs text-gray-700">
                              Booth name
                              <input
                                type="text"
                                value={boothIdentityName}
                                onChange={(e) => setBoothIdentityName(e.target.value)}
                                placeholder="e.g. Wedding Photo Booth #1"
                                maxLength={100}
                                className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-3 py-2 mt-1 w-full`}
                              />
                            </label>

                            <label className="block text-xs text-gray-700">
                              Operator name
                              <input
                                type="text"
                                value={operatorName}
                                onChange={(e) => setOperatorName(e.target.value)}
                                placeholder="e.g. Santos Photography"
                                maxLength={100}
                                className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-3 py-2 mt-1 w-full`}
                              />
                            </label>

                            <label className="block text-xs text-gray-700 md:col-span-2">
                              Location / venue
                              <input
                                type="text"
                                value={boothLocation}
                                onChange={(e) => setBoothLocation(e.target.value)}
                                placeholder="e.g. Grand Ballroom, Hilton Manila"
                                maxLength={200}
                                className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-3 py-2 mt-1 w-full`}
                              />
                            </label>
                          </div>
                        </div>

                        {/* Session behavior */}
                        <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
                          <div className="text-sm font-medium text-gray-900">Session behavior</div>
                          <div className="text-xs text-gray-500 mt-1">
                            Control how each photo session runs.
                          </div>

                          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                            <label className="block text-xs text-gray-700">
                              Countdown (seconds)
                              <input
                                type="number"
                                min={1}
                                max={30}
                                value={countdown}
                                onChange={(e) => setCountdown(Number(e.target.value) || 5)}
                                className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-3 py-2 mt-1 w-full`}
                              />
                            </label>

                            <label className="block text-xs text-gray-700">
                              Number of shots
                              <input
                                type="number"
                                min={1}
                                max={10}
                                value={numberOfShots}
                                onChange={(e) => setNumberOfShots(Number(e.target.value) || 3)}
                                className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-3 py-2 mt-1 w-full`}
                              />
                            </label>

                            <label className="block text-xs text-gray-700">
                              Retake limit
                              <input
                                type="number"
                                min={0}
                                max={20}
                                value={retakeLimit}
                                onChange={(e) => setRetakeLimit(Number(e.target.value) || 0)}
                                className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-3 py-2 mt-1 w-full`}
                              />
                            </label>
                          </div>
                        </div>

                        {/* Idle & display */}
                        <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
                          <div className="text-sm font-medium text-gray-900">Idle & display</div>
                          <div className="text-xs text-gray-500 mt-1">
                            Configure screen dimming and kiosk display behavior.
                          </div>

                          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                            <label className="flex items-center gap-2 text-sm text-gray-700 md:col-span-2">
                              <input
                                type="checkbox"
                                checked={dimWhenIdle}
                                onChange={(e) => setDimWhenIdle(e.target.checked)}
                              />
                              Dim screen when idle
                            </label>

                            <label className="block text-xs text-gray-700">
                              Idle timeout (seconds)
                              <input
                                type="number"
                                min={5}
                                max={3600}
                                value={idleTimeout}
                                disabled={!dimWhenIdle}
                                onChange={(e) => setIdleTimeout(Number(e.target.value) || 60)}
                                className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-3 py-2 mt-1 w-full ${!dimWhenIdle ? "opacity-40 cursor-not-allowed bg-gray-50" : ""}`}
                              />
                            </label>

                            <label className="block text-xs text-gray-700">
                              Language
                              <select
                                value={language}
                                onChange={(e) => setLanguage(e.target.value)}
                                className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-3 py-2 mt-1 w-full`}
                              >
                                <option value="en">English</option>
                                <option value="fil">Filipino</option>
                              </select>
                            </label>
                          </div>
                        </div>

                        {/* Summary panel */}
                        <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
                          <div className="text-sm font-medium text-gray-900">Current configuration</div>
                          <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 text-xs text-gray-600">
                            <div className="flex justify-between gap-2 md:col-span-1">
                              <span className="text-gray-500">Booth name</span>
                              <span className="text-gray-900 truncate">{boothIdentityName || "—"}</span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-gray-500">Operator</span>
                              <span className="text-gray-900 truncate">{operatorName || "—"}</span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-gray-500">Location</span>
                              <span className="text-gray-900 truncate">{boothLocation || "—"}</span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-gray-500">Countdown</span>
                              <span className="text-gray-900">{countdown}s</span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-gray-500">Shots</span>
                              <span className="text-gray-900">{numberOfShots}</span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-gray-500">Retakes</span>
                              <span className="text-gray-900">{retakeLimit === 0 ? "Unlimited" : retakeLimit}</span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-gray-500">Idle dimming</span>
                              <span className="text-gray-900">{dimWhenIdle ? `${idleTimeout}s` : "Off"}</span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-gray-500">Language</span>
                              <span className="text-gray-900">{language === "fil" ? "Filipino" : "English"}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {activeSettingsTab === "logs" && (
                      <div className="mt-0 grid grid-cols-1 xl:grid-cols-3 gap-4">
                        <div className={`xl:col-span-2 ${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
                          <div>
                            <div className="text-sm font-medium text-gray-900">Audit & logs</div>
                            <div className="text-xs text-gray-500 mt-1">
                              Export diagnostic logs for troubleshooting and maintenance.
                            </div>
                          </div>

                          <div className="mt-4 flex flex-wrap items-center gap-3">
                            <button
                              onClick={exportLogs}
                              className={`${BTN_PRIMARY} text-sm px-4 py-2`}
                            >
                              Export audit logs
                            </button>
                            <button
                              onClick={typeof clearLogs === "function" ? clearLogs : undefined}
                              disabled={typeof clearLogs !== "function"}
                              className={`${BTN_GHOST} text-sm px-4 py-2`}
                            >
                              Clear logs
                            </button>
                          </div>
                        </div>

                        <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
                          <div className="text-sm font-medium text-gray-900">Log status</div>
                          <div className="text-xs text-gray-500 mt-1">
                            Recent export and maintenance activity.
                          </div>

                          <div className="mt-4 space-y-3">
                            {typeof logsStatusText !== "undefined" && (
                              <div className="text-xs text-gray-500">
                                {logsStatusText}
                              </div>
                            )}

                            <div className="pt-2 border-t border-gray-100 space-y-2 text-xs text-gray-600">
                              <div className="flex justify-between gap-3">
                                <span>Export available</span>
                                <span className="text-gray-900">Yes</span>
                              </div>

                              {typeof lastExportedLogPath !== "undefined" && (
                                <div className="flex justify-between gap-3">
                                  <span>Last exported file</span>
                                  <span className="text-gray-900 text-right truncate">
                                    {lastExportedLogPath || "None yet"}
                                  </span>
                                </div>
                              )}

                              {typeof logsLoading !== "undefined" && (
                                <div className="flex justify-between gap-3">
                                  <span>Status</span>
                                  <span className="text-gray-900">
                                    {logsLoading ? "Working..." : "Idle"}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {activeSettingsTab === "system" && (
                      <div className="mt-0 grid grid-cols-1 xl:grid-cols-3 gap-4">
                        <div className={`xl:col-span-2 ${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
                          <div>
                            <div className="text-sm font-medium text-gray-900">Startup & recovery</div>
                            <div className="text-xs text-gray-500 mt-1">
                              Control launch behavior, automatic recovery, and maintenance tools.
                            </div>
                          </div>

                          <div className="mt-4 grid grid-cols-1 gap-4">
                            <label className="flex items-center gap-2 text-sm text-gray-700">
                              <input
                                type="checkbox"
                                checked={launchOnStartup}
                                onChange={(e) => toggleLaunchOnStartup(e.target.checked)}
                              />
                              Launch on system startup
                            </label>

                            <label className="flex items-center gap-2 text-sm text-gray-700">
                              <input
                                type="checkbox"
                                checked={autoRestart}
                                onChange={(e) => setAutoRestart(e.target.checked)}
                              />
                              Auto-restart on crash
                            </label>

                            {typeof autoUpdateEnabled !== "undefined" && typeof setAutoUpdateEnabled === "function" && (
                              <label className="flex items-center gap-2 text-sm text-gray-700">
                                <input
                                  type="checkbox"
                                  checked={autoUpdateEnabled}
                                  onChange={(e) => setAutoUpdateEnabled(e.target.checked)}
                                />
                                Enable automatic updates
                              </label>
                            )}

                            <div className="flex flex-wrap items-center gap-3 pt-2">
                              <button
                                onClick={typeof checkForUpdates === "function" ? checkForUpdates : undefined}
                                disabled={typeof checkForUpdates !== "function"}
                                className={`${BTN_GHOST} text-sm px-4 py-2`}
                              >
                                Check for updates
                              </button>
                              <button
                                onClick={typeof clearCache === "function" ? clearCache : undefined}
                                disabled={typeof clearCache !== "function"}
                                className={`${BTN_GHOST} text-sm px-4 py-2`}
                              >
                                Clear cache
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
                          <div className="text-sm font-medium text-gray-900">System status</div>
                          <div className="text-xs text-gray-500 mt-1">
                            Current startup, recovery, and maintenance preferences.
                          </div>

                          <div className="mt-4 space-y-3">
                            <div className="flex justify-between gap-3 text-sm">
                              <span className="text-gray-500">Launch on startup</span>
                              <span className="text-gray-900">
                                {launchOnStartup ? "Enabled" : "Disabled"}
                              </span>
                            </div>

                            <div className="flex justify-between gap-3 text-sm">
                              <span className="text-gray-500">Auto-restart</span>
                              <span className="text-gray-900">
                                {autoRestart ? "Enabled" : "Disabled"}
                              </span>
                            </div>

                            <div className="pt-2 border-t border-gray-100 space-y-2 text-xs text-gray-600">
                              {typeof autoUpdateEnabled !== "undefined" && (
                                <div className="flex justify-between gap-3">
                                  <span>Auto update</span>
                                  <span className="text-gray-900">
                                    {autoUpdateEnabled ? "Enabled" : "Disabled"}
                                  </span>
                                </div>
                              )}

                              {typeof updateStatusText !== "undefined" && (
                                <div className="pt-2 border-t border-gray-100">
                                  <div className="text-xs text-gray-500">{updateStatusText}</div>
                                </div>
                              )}

                              {typeof cacheStatusText !== "undefined" && (
                                <div className="text-xs text-gray-500">{cacheStatusText}</div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeMain === "helpcenter" && (
                <div className={cardClass}>
                  {/* Header */}
                  <div className="flex items-start justify-between">
                    <div>

                    </div>

                    <button
                      className="text-xs text-gray-600 hover:text-gray-900 underline-offset-2 hover:underline"
                      onClick={openAllDocs}
                    >
                      View all docs
                    </button>
                  </div>

                  {/* Help Cards */}
                  <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Getting Started */}
                    <div className={`${smallCardClass} group`}>
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-md bg-gray-100 flex items-center justify-center text-xs font-semibold text-gray-700">
                          🚀
                        </div>
                        <span className="text-xs font-medium text-gray-700">
                          Getting Started
                        </span>
                      </div>

                      <p className="text-sm mt-2 text-gray-800 leading-relaxed">
                        Learn how to create events, upload logos, configure timers,
                        and run your first session.
                      </p>

                      <button
                        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700"
                        onClick={openGettingStartedGuide}
                      >
                        Read guide →
                      </button>
                    </div>

                    {/* Template Editor */}
                    <div className={`${smallCardClass} group`}>
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-md bg-gray-100 flex items-center justify-center text-xs font-semibold text-gray-700">
                          🧩
                        </div>
                        <span className="text-xs font-medium text-gray-700">
                          Template Editor
                        </span>
                      </div>

                      <p className="text-sm mt-2 text-gray-800 leading-relaxed">
                        Understand how to drag, resize, rotate, and align photo slots
                        on the 4×6 canvas.
                      </p>

                      <button
                        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700"
                        onClick={openTemplateEditorGuide}
                      >
                        Learn editor →
                      </button>
                    </div>

                    {/* Payments */}
                    <div className={`${smallCardClass} group`}>
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-md bg-gray-100 flex items-center justify-center text-xs font-semibold text-gray-700">
                          💳
                        </div>
                        <span className="text-xs font-medium text-gray-700">
                          Payments
                        </span>
                      </div>

                      <p className="text-sm mt-2 text-gray-800 leading-relaxed">
                        Set up and manage payment methods including GCash,
                        PayPal, Stripe, or Cash mode.
                      </p>

                      <button
                        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700"
                        onClick={openPaymentsGuide}
                      >
                        Configure payments →
                      </button>
                    </div>
                  </div>

                  {/* Footer Tip */}
                  <div className="mt-6 rounded-md border border-gray-200 bg-gray-50 p-3">
                    <p className="text-xs text-gray-600">
                      💡 Tip: You can access help anytime from the top-right menu while running a session.
                    </p>
                  </div>
                </div>
              )}

              {helpArticle && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
                  <div className={`w-full max-w-2xl ${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_CARD} p-5`}>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h4 className="text-base font-semibold text-gray-900">
                          {helpArticle.title}
                        </h4>
                        <p className="mt-1 text-xs text-gray-500">
                          In-app guide
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => setHelpArticle(null)}
                        className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                      >
                        Close
                      </button>
                    </div>

                    <div className="mt-4 space-y-3">
                      {(helpArticle.sections || []).map((section, index) => (
                        <p key={`${helpArticle.title}-${index}`} className="text-sm leading-relaxed text-gray-700">
                          {section}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* EVENTS */}
              {activeMain === "events" && (
                <div className="space-y-5">

                  {/* Create event — compact card */}
                  <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-5`}>
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div>
                        <h4 className="text-sm font-semibold text-gray-900">Create new event</h4>
                        <p className="text-xs text-gray-400 mt-0.5">Name your event, then configure it from the dashboard.</p>
                      </div>
                      <span className="flex-shrink-0 text-[11px] font-medium text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-full px-2.5 py-1">Quick setup</span>
                    </div>

                    <form onSubmit={createEvent} className="space-y-3">
                      <div className="flex gap-2">
                        <input
                          id="create-event-input"
                          value={newEventName}
                          onChange={(e) => setNewEventName(e.target.value)}
                          placeholder="e.g. Maria & John Wedding Booth"
                          className={`flex-1 ${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} ${FOCUS_RING_INDIGO} px-3 py-2.5 text-sm outline-none`}
                        />
                        <button
                          type="submit"
                          disabled={!ready || !newEventName.trim()}
                          className="flex-shrink-0 inline-flex items-center justify-center rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-200 transition hover:-translate-y-0.5 hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Create
                        </button>
                      </div>

                      {/* Quick name chips */}
                      <div className="flex flex-wrap gap-1.5">
                        <span className="text-[11px] text-gray-400 self-center mr-1">Quick fill:</span>
                        {["Birthday Booth", "Wedding Booth", "Corporate Booth", "Debut Booth", "School Event"].map((name) => (
                          <button
                            key={name}
                            type="button"
                            onClick={() => setNewEventName(name)}
                            className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-600 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 transition-all"
                          >
                            {name}
                          </button>
                        ))}
                      </div>

                      {/* Notes field */}
                      <div>
                        <input
                          value={newEventNotes}
                          onChange={(e) => setNewEventNotes(e.target.value)}
                          placeholder="Notes (optional)"
                          className={`w-full ${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-3 py-2 text-xs outline-none text-gray-600 placeholder-gray-400`}
                        />
                      </div>
                    </form>
                  </div>

                  {/* Event library */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-semibold text-gray-700">Event library</h4>
                      <span className="text-[11px] text-gray-400">{events.length} event{events.length !== 1 ? "s" : ""}</span>
                    </div>

                    {!hydrated ? (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {Array.from({ length: 6 }).map((_, index) => (
                          <div key={`event-skeleton-${index}`} className="animate-pulse bg-slate-100 rounded-2xl h-20 w-full" />
                        ))}
                      </div>
                    ) : events.length === 0 ? (
                      <div className="rounded-3xl border border-dashed border-slate-200 p-12 text-center">
                        <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center mx-auto mb-3">
                          <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </div>
                        <div className="text-sm font-medium text-gray-600">No events yet. Create your first event to get started.</div>
                        <p className="mt-1 text-xs text-gray-400">Use the create event form above to add your first event workspace.</p>
                        <button
                          type="button"
                          onClick={() => document.getElementById("create-event-input")?.focus()}
                          className="mt-4 inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 active:scale-[0.98]"
                        >
                          Create event
                        </button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {events.map((ev) => {
                          const sessionPrice = ev.settings?.business?.pricing?.pricePerSession ?? ev.settings?.price ?? 0;
                          const totalSessions = ev.sessions?.length ?? 0;
                          const todaySessions = completedSessionsToday(ev);
                          const isActive = currentEvent?.id === ev.id;

                          return (
                            <div
                              key={ev.id}
                              className={`flex flex-col rounded-3xl border bg-white p-4 shadow-sm transition-all ${isActive ? "border-indigo-300 ring-2 ring-indigo-100 shadow-[0_8px_30px_rgba(79,70,229,0.10)]" : "border-slate-200 hover:border-slate-300 hover:shadow-md"
                                }`}
                            >
                              {/* Card header */}
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    {isActive && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 flex-shrink-0" />}
                                    <div className="truncate text-sm font-semibold text-gray-900">
                                      {ev.name || "Untitled event"}
                                    </div>
                                  </div>
                                  <div className="mt-0.5 text-[11px] text-gray-400">
                                    {ev.created || "—"}
                                  </div>
                                </div>
                                <span className="flex-shrink-0 rounded-full bg-gray-50 border border-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                                  {ev.settings?.appMode ?? DEFAULT_APP_MODE}
                                </span>
                              </div>

                              {/* Stats strip */}
                              <div className="mt-3 grid grid-cols-4 gap-1.5">
                                {[
                                  { label: "Price", value: peso(sessionPrice) },
                                  { label: "Shots", value: ev.settings?.numberOfShots ?? "—" },
                                  { label: "Today", value: todaySessions },
                                  { label: "Total", value: totalSessions },
                                ].map(({ label, value }) => (
                                  <div key={label} className="rounded-lg bg-gray-50 px-2 py-2 text-center">
                                    <div className="text-[10px] text-gray-400">{label}</div>
                                    <div className="text-xs font-bold text-gray-800 mt-0.5 tabular-nums truncate">{value}</div>
                                  </div>
                                ))}
                              </div>

                              {/* Asset tags */}
                              <div className="mt-2.5 flex flex-wrap gap-1">
                                {[
                                  { count: ev.appliedTemplates?.length ?? 0, label: "template" },
                                  { count: ev.appliedFrames?.length ?? 0, label: "frame" },
                                  { count: ev.appliedTones?.length ?? 0, label: "tone" },
                                ].map(({ count, label }) =>
                                  count > 0 ? (
                                    <span key={label} className="rounded-full bg-indigo-50 border border-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-600">
                                      {count} {label}{count !== 1 ? "s" : ""}
                                    </span>
                                  ) : null
                                )}
                                {totalSessions > 0 && (
                                  <span className="rounded-full bg-emerald-50 border border-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
                                    {peso(totalSessions * sessionPrice)} gross
                                  </span>
                                )}
                              </div>

                              {/* Actions */}
                              <div className="mt-4 flex items-center gap-2">
                                <button
                                  onClick={() => {
                                    setCurrentEvent(JSON.parse(JSON.stringify(ev)));
                                    setActiveMain("dashboard");
                                    setActiveSub("branding");
                                  }}
                                  className="flex-1 inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 active:scale-[0.98]"
                                >
                                  Open editor
                                </button>

                                <button
                                  onClick={async () => {
                                    try {
                                      const evCopy = JSON.parse(JSON.stringify(ev));
                                      const mergedEvent = {
                                        ...evCopy,
                                        settings: { ...(evCopy.settings || {}), ...settingsToSave },
                                      };
                                      const updatedEvents = events.map((item) =>
                                        item.id === mergedEvent.id ? mergedEvent : item
                                      );
                                      setCurrentEvent(mergedEvent);
                                      setEvents(updatedEvents);
                                      await native?.setEvents?.(updatedEvents, ctx);
                                      await native?.setCurrentEventId?.(mergedEvent.id);
                                      if (typeof onStartPhotobooth === "function") {
                                        onStartPhotobooth(mergedEvent);
                                      } else {
                                        setActiveMain("dashboard");
                                      }
                                    } catch (e) {
                                      console.error("Start Photo booth failed:", e);
                                    }
                                  }}
                                  className="flex-1 inline-flex items-center justify-center rounded-full bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm shadow-indigo-200 transition hover:-translate-y-0.5 hover:bg-indigo-700 active:scale-[0.98]"
                                >
                                  Start booth
                                </button>

                                <button
                                  onClick={() => setDeleteTarget({ type: "event", id: ev.id, name: ev.name })}
                                  className="rounded-full border border-slate-200 p-2 text-slate-400 hover:text-red-500 hover:border-red-200 hover:bg-red-50 transition-all"
                                  title="Delete event"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ===== DASHBOARD CONTENT AREA ===== */}
              {activeMain === "dashboard" && currentEvent && (
                <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-5`}>
                  {/* Slim section title */}
                  <div className="flex items-center justify-between mb-5">
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900">{getDashboardSectionMeta().title}</h4>
                      <p className="text-xs text-gray-400 mt-0.5">{getDashboardSectionMeta().description}</p>
                    </div>
                  </div>
                  {/* ==== APPEARANCE (unchanged behavior, only visual polish) ==== */}
                  {activeMain === "dashboard" && currentEvent && activeSub === "branding" && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

                      {/* Logo */}
                      <div className={cardClass}>
                        <div className="text-sm font-semibold text-slate-800">Logo</div>

                        <div className="mt-3">
                          {logoPath ? (
                            <div className="flex items-center gap-4">
                              <img
                                src={logoPath.previewUrl ?? logoPath.url}
                                alt="Logo preview"
                                className="w-40 h-24 object-contain rounded-md border bg-white"
                              />

                              <button
                                onClick={() => {
                                  setLogoPath(null);
                                  showToast("Logo removed");
                                }}
                                className={BTN_GHOST}
                              >
                                Remove
                              </button>
                            </div>
                          ) : (
                            <input
                              type="file"
                              accept="image/*"
                              className="text-xs text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border file:border-gray-300 file:bg-white hover:file:bg-gray-50 cursor-pointer"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                if (!file.type.startsWith('image/')) {
                                  showToast('Please select an image file.');
                                  return;
                                }
                                if (file.size > 20 * 1024 * 1024) { // 20 MB
                                  showToast('Image exceeds 20MB. Please upload a smaller file.');
                                  return;
                                }

                                const tempUrl = URL.createObjectURL(file);
                                setLogoPath({ url: tempUrl, name: file.name, previewUrl: tempUrl });
                                try {
                                  const res = (await native?.saveAppearanceLogoFromFile?.(file, currentEvent.id, identity.userId)) ?? {};
                                  const finalUrl = res?.fileUrl ?? tempUrl;
                                  setLogoPath({ url: finalUrl, name: file.name, previewUrl: finalUrl });
                                  showToast('Logo saved');
                                } catch (err) {
                                  console.error(err);
                                  showToast('Failed to save logo');
                                } finally {
                                  URL.revokeObjectURL(tempUrl);
                                }
                              }}
                            />
                          )}
                        </div>
                      </div>

                      {/* Background */}
                      <div className={cardClass}>
                        <div className="text-sm font-semibold text-slate-800">Background Media</div>

                        <div className="mt-3">
                          {backgroundMediaPath ? (
                            <div className="flex items-center gap-4">
                              {/* Render images (jpg, png, webp, gif) as <img>, else <video> */}
                              {(() => {
                                const src = backgroundMediaPath.previewUrl ?? backgroundMediaPath.url;
                                const name = backgroundMediaPath.name?.toLowerCase() ?? '';
                                const isImageExt = /\.(gif|jpe?g|png|webp|bmp|tiff?)$/.test(name);
                                // Fallback to MIME when available
                                const isImageMime =
                                  backgroundMediaPath.mime?.startsWith('image/') ??
                                  name.endsWith('.gif'); // legacy fallback

                                const isImage = isImageExt || isImageMime;

                                return isImage ? (
                                  <img
                                    src={src}
                                    className="w-40 h-24 object-cover rounded-md border"
                                    alt="Background Image"
                                  />
                                ) : (
                                  <video
                                    src={src}
                                    className="w-40 h-24 object-cover rounded-md border"
                                    autoPlay
                                    muted
                                    loop
                                    playsInline
                                  />
                                );
                              })()}

                              <button
                                onClick={() => {
                                  setBackgroundMediaPath(null);
                                  showToast('Background removed');
                                }}
                                className={BTN_GHOST}
                              >
                                Remove
                              </button>
                            </div>
                          ) : (
                            <input
                              type="file"
                              // Allow videos AND images (jpg, png, webp, gif, etc.)
                              accept="video/*,image/*"
                              className="text-xs text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border file:border-gray-300 file:bg-white hover:file:bg-gray-50 cursor-pointer"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;

                                const type = file.type || '';
                                const isVideo = type.startsWith('video/');
                                const isImage = type.startsWith('image/'); // includes gif, jpg, png, webp, etc.

                                if (!isVideo && !isImage) {
                                  showToast('Please select a video or image file.');
                                  return;
                                }

                                // 100MB limit (you can split limits if you want stricter images, e.g., 25MB)
                                if (file.size > 100 * 1024 * 1024) {
                                  showToast('File exceeds 100MB. Please upload a smaller file.');
                                  return;
                                }

                                // Optional: reject SVGs if you don’t want vector uploads
                                if (type === 'image/svg+xml') {
                                  showToast('SVGs are not supported. Please upload a raster image like JPG/PNG/WEBP/GIF.');
                                  return;
                                }

                                const objectUrl = URL.createObjectURL(file);

                                // Optimistic preview
                                setBackgroundMediaPath({
                                  url: objectUrl,
                                  name: file.name,
                                  previewUrl: objectUrl,
                                  mime: file.type,
                                });

                                try {
                                  const res =
                                    (await native?.saveAppearanceBackgroundFromFile?.(
                                      file,
                                      currentEvent.id,
                                      identity.userId
                                    )) ?? {};

                                  if (!res?.fileUrl) {
                                    showToast('Failed to save background');
                                    return;
                                  }

                                  const finalUrl = res.appUrl ?? res.fileUrl;

                                  setBackgroundMediaPath({
                                    url: finalUrl,
                                    path: res.savedPath,
                                    name: file.name,
                                    previewUrl: finalUrl,
                                    mime: file.type,
                                  });

                                  showToast('Background saved');
                                } catch (err) {
                                  console.error(err);
                                  showToast('Failed to save background');
                                } finally {
                                  URL.revokeObjectURL(objectUrl);
                                }
                              }}
                            />
                          )}
                        </div>
                      </div>

                      {/* Colors */}
                      <div className={cardClass}>
                        <div className="text-sm font-semibold text-slate-800">Colors</div>

                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4">
                          {[
                            ["Header", headerFontColor, setHeaderFontColor],
                            ["General", generalFontColor, setGeneralFontColor],
                            ["Button Text", buttonFontColor, setButtonFontColor],
                            ["Background", bgColor, setBgColor],
                            ["Button BG", buttonBgColor, setButtonBgColor],
                            ["Button Hover", buttonHoverColor, setButtonHoverColor],
                          ].map(([label, value, setter]) => (
                            <label key={label} className="text-xs text-gray-700">
                              {label}
                              <input
                                type="color"
                                value={value}
                                onChange={(e) => setter(e.target.value)}
                                className="block mt-1 w-10 h-8 rounded"
                              />
                            </label>
                          ))}
                        </div>
                      </div>

                      {/* Booth Texts */}
                      <div className={cardClass}>
                        <div className="text-sm font-semibold text-slate-800">Booth Texts</div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
                          <input
                            value={boothName}
                            onChange={(e) => setBoothName(e.target.value)}
                            placeholder="Booth name"
                            className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-3 py-2 text-sm transition-all hover:bg-gray-50 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed`}
                          />

                          <input
                            value={boothSlogan}
                            onChange={(e) => setBoothSlogan(e.target.value)}
                            placeholder="Booth slogan"
                            className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-3 py-2 text-sm transition-all hover:bg-gray-50 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed`}
                          />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
                          {[
                            ["Header font", headerFont, setHeaderFont],
                            ["Body font", generalFont, setGeneralFont],
                            ["Button font", buttonFont, setbuttonFont],
                          ].map(([label, value, setter]) => (
                            <label key={label} className="text-xs font-medium text-slate-600">
                              {label}
                              <select
                                value={value}
                                onChange={(e) => setter(e.target.value)}
                                className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-3 py-2 mt-1 w-full text-sm transition-all hover:bg-gray-50 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed`}
                              >
                                {GOOGLE_FONTS.map((f) => (
                                  <option key={f} value={f}>
                                    {f}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ))}
                        </div>
                      </div>

                      {/* Booth Texts */}
                      <div className={cardClass}>
                        <div className="text-sm font-semibold text-slate-800">Start Button Menu</div>

                        {/* NEW: Start Button section */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
                          <label className="inline-flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={startButtonHidden}
                              onChange={(e) => setStartButtonHidden(e.target.checked)}
                            />
                            Hide “Start” button on Welcome Screen
                          </label>
                          <input
                            value={startButtonText}
                            onChange={(e) => setStartButtonText(e.target.value)}
                            placeholder="Start button text (e.g., Tap to Start)"
                            className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-3 py-2 text-sm transition-all hover:bg-gray-50 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed`}
                            disabled={startButtonHidden}
                          />
                        </div>
                      </div>

                      {/* Live Preview */}
                      <div className={cardClass}>
                        <div className="text-sm font-semibold text-slate-800">Live Preview</div>
                        <div
                          className="relative mt-3 h-[260px] rounded-md overflow-hidden border flex flex-col items-center justify-center text-center"
                          style={{
                            backgroundColor: bgColor,
                            '--btn-bg': buttonBgColor,
                            '--btn-hover': buttonHoverColor,
                            '--btn-font': `'${buttonFont}', ${FALLBACK_STACK}`,
                            '--btn-color': buttonFontColor,
                          }}
                        >
                          {backgroundMediaPath && (
                            <div className="absolute inset-0">
                              {(() => {
                                const src = backgroundMediaPath.previewUrl ?? backgroundMediaPath.url;
                                const name = backgroundMediaPath.name?.toLowerCase() ?? '';
                                const mime = backgroundMediaPath.mime ?? '';
                                // Prefer MIME when present (covers jpg/png/webp/gif/bmp/tiff/etc.)
                                const isImageMime = mime.startsWith('image/');
                                // Fallback to extension if MIME is missing
                                const isImageExt = /\.(gif|jpe?g|png|webp|bmp|tiff?)$/.test(name);
                                const isSvg = mime === 'image/svg+xml' || name.endsWith('.svg');
                                const isImage = (isImageMime || isImageExt) && !isSvg;

                                return isImage ? (
                                  <img
                                    src={src}
                                    className="w-full h-full object-cover"
                                    alt=""
                                    aria-hidden="true"
                                  />
                                ) : (
                                  <video
                                    src={src}
                                    className="w-full h-full object-cover"
                                    autoPlay
                                    muted
                                    loop
                                    playsInline
                                  />
                                );
                              })()}
                            </div>
                          )}

                          <div className="relative z-10 flex flex-col items-center gap-1">
                            {logoPath ? (
                              <img
                                src={logoPath.previewUrl ?? logoPath.url}
                                className="h-20 object-contain"
                                alt="Logo"
                              />
                            ) : (
                              <>
                                <div
                                  className="text-xl font-semibold"
                                  style={{
                                    color: headerFontColor,
                                    fontFamily: `'${headerFont}', ${FALLBACK_STACK}`,
                                  }}
                                >
                                  {boothName || 'Studio Photuna'}
                                </div>
                                <div
                                  className="text-sm"
                                  style={{
                                    color: generalFontColor,
                                    fontFamily: `'${generalFont}', ${FALLBACK_STACK}`,
                                  }}
                                >
                                  {boothSlogan || 'Ahead of the moment.'}
                                </div>
                              </>
                            )}
                            {!startButtonHidden && (
                              <button
                                className="mt-4 px-4 py-2 text-sm rounded-md transition-colors bg-[var(--btn-bg)] hover:bg-[var(--btn-hover)] text-[var(--btn-color)]"
                                style={{ fontFamily: 'var(--btn-font)' }}
                              >
                                {startButtonText || "Tap to Start"}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}


                  {/* ==== TEMPLATES — FULL EDITOR (unchanged behavior, reflowed into shell) ==== */}
                  {activeMain === "dashboard" && currentEvent && activeSub === "templates" && (
                    <div className={cardClass}>
                      {/* Header */}
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-semibold text-slate-800">Templates</div>

                        <button
                          onClick={() => {
                            setEditingTemplate(null);
                            setTemplateName("");
                            setTemplateSlotsState([]);
                            setThumbnailUploadPreview(null);
                            setTemplateError("");
                            setSelectionIds([]);
                            setTemplateLayout("4x6"); // default
                            setIsTemplateModalOpen(true);
                          }}
                          className={BTN_PRIMARY}
                        >
                          New Template
                        </button>
                      </div>

                      {/* Template List */}
                      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {!hydrated ? Array.from({ length: 6 }).map((_, index) => (
                          <div key={`template-skeleton-${index}`} className="animate-pulse bg-slate-100 rounded-2xl h-20 w-full" />
                        )) : templates.map((tpl) => {
                          const layout = tpl.previewMeta?.layout ?? "4x6";
                          const aspectMap = {
                            "4x6": "aspect-[4/6]",
                            "2x6": "aspect-[2/6]",
                            "6x4": "aspect-[6/4]",
                            "6x2": "aspect-[6/2]",
                          };
                          const aspectClass = aspectMap[layout] ?? aspectMap["4x6"];
                          const thumbSrc =
                            tpl.previewMeta?.thumbnailDataUrl ?? tpl.previewMeta?.thumbnailPath;
                          const isTall = layout === "4x6" || layout === "2x6";
                          const alreadyApplied =
                            currentEvent?.appliedTemplates?.some((t) => t.id === tpl.id) ?? false;

                          return (
                            <div
                              key={tpl.id}
                              className="p-4 rounded-2xl border border-slate-200 bg-white flex flex-col gap-3"
                            >
                              <div>
                                <div className="text-sm font-medium truncate">{tpl.name}</div>
                                <div className="text-xs text-gray-600">
                                  {getTemplateSlotCount(tpl)} slots
                                </div>
                              </div>

                              {thumbSrc ? (
                                <div className={`${isTall ? "" : "h-56"}`}>
                                  <div
                                    className={`flex justify-center ${aspectClass} ${isTall ? "h-56" : "w-56"
                                      } mx-auto border overflow-hidden`}
                                  >
                                    {/* Let the container control aspect; image fills without distortion */}
                                    <img
                                      src={thumbSrc}
                                      alt={`${tpl.name} thumbnail`}
                                      className="w-full h-full object-contain"
                                      loading="lazy"
                                    />
                                  </div>
                                </div>
                              ) : (
                                <div
                                  className={`${aspectClass} ${isTall ? "h-56" : "w-56"
                                    } mx-auto flex items-center justify-center text-xs text-gray-400 border rounded-md`}
                                >
                                  No preview
                                </div>
                              )}

                              <div className="flex flex-wrap items-center gap-2 pt-2">
                                <button
                                  onClick={() => {
                                    setEditingTemplate(tpl);
                                    setTemplateName(tpl.name);

                                    const slots = (tpl.previewMeta?.slots ?? []).map((s) => ({
                                      ...JSON.parse(JSON.stringify(s)),
                                      rotation: s.rotation ?? 0,
                                    }));
                                    setTemplateSlotsState(ensureSlotNumbers(slots));

                                    setThumbnailUploadPreview(
                                      tpl.previewMeta?.thumbnailDataUrl ??
                                      tpl.previewMeta?.thumbnailPath ??
                                      null
                                    );

                                    setTemplateError("");
                                    setSelectionIds([]);
                                    setIsTemplateModalOpen(true);
                                  }}
                                  className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  Edit
                                </button>

                                <button
                                  onClick={() =>
                                    setDeleteTarget({ type: "template", id: tpl.id, name: tpl.name })
                                  }
                                  className="inline-flex items-center justify-center rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-100 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  Delete
                                </button>

                                <label className="ml-auto text-xs inline-flex items-center gap-2 text-gray-700">
                                  <input
                                    type="checkbox"
                                    checked={alreadyApplied}
                                    onChange={(e) => {
                                      const evCopy = JSON.parse(JSON.stringify(currentEvent));
                                      evCopy.appliedTemplates = evCopy.appliedTemplates ?? [];

                                      if (alreadyApplied) {
                                        // Remove the template
                                        evCopy.appliedTemplates = evCopy.appliedTemplates.filter(
                                          (t) => t.id !== tpl.id
                                        );
                                        showToast(`Removed "${tpl.name}" from ${evCopy.name}`);
                                      } else {
                                        // Add the template
                                        evCopy.appliedTemplates.push({
                                          id: tpl.id,
                                          name: tpl.name,
                                          previewMeta: tpl.previewMeta ?? null,
                                        });
                                        showToast(`Applied "${tpl.name}" to ${evCopy.name}`);
                                      }

                                      const updatedEvents = events.map((e) =>
                                        e.id === evCopy.id ? evCopy : e
                                      );

                                      setEvents(updatedEvents);
                                      setCurrentEvent(evCopy);
                                      native?.setEvents?.(updatedEvents, ctx).catch(() => { });
                                    }}
                                  />
                                  {alreadyApplied ? "Applied" : "Apply to event"}
                                </label>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* ================= MODAL ================= */}
                      {(() => {
                        // Compute editing template props once for the modal (multi-frame)
                        const layout = editingTemplate?.previewMeta?.layout ?? templateLayout;
                        const initialAttachedFrameIds = Array.isArray(editingTemplate?.previewMeta?.attachedFrameIds)
                          ? editingTemplate.previewMeta.attachedFrameIds
                          : [];
                        const initialActiveFrameId = editingTemplate?.previewMeta?.activeFrameId ?? null;
                        const lookupOverlay = (id) =>
                          frames.find(f => f.id === id)?.previews?.[layout]?.originalDataUrl ?? null;
                        const backgroundFromAttached =
                          (initialActiveFrameId && lookupOverlay(initialActiveFrameId)) ||
                          (initialAttachedFrameIds.length && lookupOverlay(initialAttachedFrameIds[0])) ||
                          null;
                        return (
                          <div className="relative z-[60]">
                            <TemplateEditor
                              open={isTemplateModalOpen}
                              onClose={() => {
                                setIsTemplateModalOpen(false);
                                setEditingTemplate(null);
                              }}
                              accentColor={ACCENT_COLOR}
                              editing={!!editingTemplate}
                              initialName={editingTemplate?.name ?? ""}
                              initialSlots={editingTemplate?.previewMeta?.slots ?? []}
                              initialThumb={
                                editingTemplate?.previewMeta?.thumbnailDataUrl ??
                                editingTemplate?.previewMeta?.thumbnailPath ??
                                null
                              }
                              initialLayout={layout}
                              onLayoutChange={(next) => setTemplateLayout(next)}
                              frames={frames}
                              initialAttachedFrameIds={initialAttachedFrameIds}
                              initialActiveFrameId={initialActiveFrameId}
                              backgroundUrl={backgroundFromAttached}
                              onSave={handleSaveTemplatePayload}
                            />
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* Frames */}
                  {activeMain === "dashboard" && currentEvent && activeSub === "frames" && (
                    <div className={cardClass}>
                      {/* Header */}
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-semibold text-slate-800">Frames</div>
                        <button
                          onClick={() => {
                            setIsCreateFrameOpen(true);
                            setCreateFrameName("");
                            setCreateDraft({ file: null, dataUrl: null, w: 0, h: 0, layout: "4x6", error: "" });
                          }}
                          className={BTN_PRIMARY}
                        >
                          Upload Frame
                        </button>
                      </div>

                      <div className="mt-4 grid grid-cols-2 md:grid-cols-2 xl:grid-cols-4 gap-2">
                        {!hydrated ? Array.from({ length: 8 }).map((_, index) => (
                          <div key={`frame-skeleton-${index}`} className="animate-pulse bg-slate-100 rounded-2xl h-20 w-full" />
                        )) : frames.map((frame) => {
                          const applied = currentEvent.appliedFrames?.some((f) => f.id === frame.id);
                          const appliedEntry = (currentEvent.appliedFrames ?? []).find(f => f.id === frame.id);
                          const appliedBgColors = currentEvent.appliedBgColors ?? [];
                          const hasAnyEventBgColors = appliedBgColors.length > 0;
                          const appliedF2 = !!(appliedEntry?.useBgColor && (appliedEntry?.palette?.colors?.length ?? 0) > 0);

                          // Pick the first available layout for the thumbnail & aspect label
                          const order = ["4x6", "2x6", "6x4", "6x2"];
                          const firstKey = order.find(k => frame.previews?.[k]?.originalDataUrl) ?? null;
                          const aspectLabel = firstKey ?? "—";
                          const thumbSrc = firstKey ? frame.previews[firstKey].originalDataUrl : null;

                          return (
                            <div key={frame.id} className="p-4 rounded-2xl border border-slate-200 bg-white flex flex-col gap-3">
                              {/* Title: "<aspect> - <frame name>" */}
                              <div className="text-sm font-medium truncate">
                                {aspectLabel} - {frame.name}
                              </div>

                              {/* Single thumbnail */}
                              {thumbSrc ? (
                                <img
                                  src={thumbSrc}
                                  className="w-[260px] h-[200px] mx-auto rounded bg-white object-contain border"
                                  alt={`${aspectLabel} overlay`}
                                />
                              ) : (
                                <div className="w-[260px] h-[200px] mx-auto rounded border bg-gray-50 flex items-center justify-center text-xs text-gray-500">
                                  No image
                                </div>
                              )}

                              {/* Actions: Delete + Apply + Use event BG colors */}
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => setDeleteTarget({ type: "frame", id: frame.id, name: frame.name })}
                                  className="inline-flex items-center justify-center rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-100 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  Delete
                                </button>

                                <label className="text-xs inline-flex items-center gap-2 text-gray-700">
                                  <input
                                    type="checkbox"
                                    checked={appliedF2}
                                    onChange={() => {
                                      const evCopy = JSON.parse(JSON.stringify(currentEvent));
                                      evCopy.appliedFrames = Array.isArray(evCopy.appliedFrames) ? evCopy.appliedFrames : [];

                                      // gather all event BG hexes (may be empty)
                                      const allEventHexes = (currentEvent.appliedBgColors ?? [])
                                        .flatMap(c => c?.colors ?? [])
                                        .filter(Boolean);

                                      if (applied) {
                                        // Frame is already applied → just toggle useBgColor
                                        evCopy.appliedFrames = evCopy.appliedFrames.map(f => {
                                          if (f.id !== frame.id) return f;
                                          if (appliedF2) {
                                            // was ON → turn OFF
                                            return { ...f, useBgColor: false, palette: null, selectedColor: null };
                                          } else {
                                            // was OFF → turn ON (attach all event colors if any)
                                            return {
                                              ...f,
                                              useBgColor: true,
                                              palette: allEventHexes.length > 0
                                                ? { id: 'event-all-bg', name: 'Event BG Colors', colors: allEventHexes }
                                                : null,
                                              selectedColor: null,
                                            };
                                          }
                                        });

                                        const updatedEvents = events.map(e => (e.id === evCopy.id ? evCopy : e));
                                        setEvents(updatedEvents);
                                        setCurrentEvent(evCopy);
                                        native?.setEvents?.(updatedEvents, ctx).catch(() => { });
                                        showToast && showToast(appliedF2
                                          ? `Removed event BG colors from "${frame.name}"`
                                          : (allEventHexes.length
                                            ? `All event BG colors attached to "${frame.name}"`
                                            : `No BG colors are applied to the event yet.`)
                                        );
                                      } else {
                                        // Frame is NOT applied yet → apply it now and set useBgColor
                                        const newEntry = {
                                          id: frame.id,
                                          name: frame.name,
                                          useBgColor: true,
                                          palette: allEventHexes.length > 0
                                            ? { id: 'event-all-bg', name: 'Event BG Colors', colors: allEventHexes }
                                            : null,
                                          selectedColor: null,
                                        };
                                        evCopy.appliedFrames.push(newEntry);

                                        const updatedEvents = events.map(e => (e.id === evCopy.id ? evCopy : e));
                                        setEvents(updatedEvents);
                                        setCurrentEvent(evCopy);
                                        native?.setEvents?.(updatedEvents, ctx).catch(() => { });

                                        showToast && showToast(
                                          allEventHexes.length
                                            ? `Applied "${frame.name}" and attached all event BG colors`
                                            : `Applied "${frame.name}". (No event BG colors found to attach.)`
                                        );
                                      }
                                    }}
                                  />
                                  Use event BG colors
                                </label>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* New Frame Modal */}
                      {isCreateFrameOpen && (
                        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4">
                          <div className={`${cardClass} p-6 w-full max-w-md`}>
                            <div className="text-base font-semibold text-slate-800 mb-4">Upload Frame</div>

                            <label className="text-xs text-gray-700 block mb-2">
                              Frame name
                              <input
                                type="text"
                                value={createFrameName}
                                onChange={(e) => setCreateFrameName(e.target.value)}
                                className="mt-1 w-full border rounded px-3 py-2 text-sm"
                                placeholder="e.g., Gold Floral"
                              />
                            </label>

                            <label className="block text-xs text-gray-700">
                              Image file (PNG/JPG/WEBP)
                              <input
                                type="file"
                                accept="image/*"
                                className="mt-1 block w-full text-xs file:mr-3 file:py-1 file:px-2 file:rounded file:border file:bg-gray-100 file:text-gray-700"
                                onChange={async (e) => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;
                                  const err = validateImage(file);
                                  if (err) { setCreateDraft(d => ({ ...d, file: null, dataUrl: null, error: err })); return; }
                                  try {
                                    const { dataUrl, w, h } = await readImageWH(file);
                                    const suggested = suggestLayoutFromWH(w, h);
                                    setCreateDraft({ file, dataUrl, w, h, layout: suggested, error: "" });
                                  } catch {
                                    setCreateDraft(d => ({ ...d, file: null, dataUrl: null, error: "Failed to read image." }));
                                  }
                                }}
                              />
                            </label>

                            {createDraft.dataUrl && (
                              <div className="mt-3">
                                <div className="text-xs text-gray-600">Detected size: {createDraft.w}×{createDraft.h}</div>
                                <div className="mt-2">
                                  <img src={createDraft.dataUrl} alt="overlay preview" className="w-full max-h-56 object-contain border rounded" />
                                </div>

                                <label className="block mt-3 text-xs text-gray-700">
                                  Layout
                                  <select
                                    value={createDraft.layout}
                                    onChange={(e) => setCreateDraft(d => ({ ...d, layout: e.target.value }))}
                                    className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-3 py-2 mt-1 w-full`}
                                  >
                                    <option value="4x6">4×6 (portrait)</option>
                                    <option value="2x6">2×6 (portrait strip)</option>
                                    <option value="6x4">6×4 (landscape)</option>
                                    <option value="6x2">6×2 (landscape strip)</option>
                                  </select>
                                </label>
                              </div>
                            )}

                            {createDraft.error && (
                              <div className="mt-3 text-xs text-red-600">{createDraft.error}</div>
                            )}

                            <div className="flex justify-end gap-2 mt-4">
                              <button
                                onClick={() => {
                                  setIsCreateFrameOpen(false);
                                  setCreateFrameName("");
                                  setCreateDraft({ file: null, dataUrl: null, w: 0, h: 0, layout: "4x6", error: "" });
                                }}
                                className={BTN_GHOST}
                              >
                                Cancel
                              </button>
                              <button
                                disabled={!createFrameName.trim() || !createDraft.file}
                                onClick={async () => {
                                  await handleCreateFrameWithUpload({
                                    name: createFrameName,
                                    file: createDraft.file,
                                    layout: createDraft.layout,
                                  });
                                  setIsCreateFrameOpen(false);
                                  setCreateFrameName("");
                                  setCreateDraft({ file: null, dataUrl: null, w: 0, h: 0, layout: "4x6", error: "" });
                                }}
                                className={BTN_PRIMARY}
                              >
                                Create
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Tones */}
                  {activeMain === "dashboard" && currentEvent && activeSub === "tones" && (
                    <div className={cardClass}>
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-semibold text-slate-800">Tones</div>
                      </div>

                      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {allTones.map((tone) => {
                          const applied =
                            currentEvent.appliedTones?.some((t) => t.id === tone.id);

                          return (
                            <div key={tone.id} className="p-4 rounded-2xl border border-slate-200 bg-white">
                              <div className="text-sm font-medium">{tone.name}</div>

                              <div className="mt-2 text-xs text-gray-600">
                                Brightness: {tone.previewMeta.brightness}
                              </div>
                              <div className="mt-2 text-xs text-gray-600">
                                Contrast: {tone.previewMeta.contrast}
                              </div>
                              <div className="mt-2 text-xs text-gray-600">
                                Saturation: {tone.previewMeta.saturation}
                              </div>
                              <div className="mt-2 text-xs text-gray-600">
                                Hue: {tone.previewMeta.hue}
                              </div>

                              <div className="flex items-center gap-2 mt-3">

                                <label className="ml-auto text-xs inline-flex items-center gap-2 text-gray-700">
                                  <input
                                    type="checkbox"
                                    checked={applied}
                                    onChange={(e) => {
                                      const evCopy = JSON.parse(JSON.stringify(currentEvent));
                                      evCopy.appliedTones = evCopy.appliedTones ?? [];

                                      if (applied) {
                                        // Remove the template
                                        evCopy.appliedTones = evCopy.appliedTones.filter(
                                          (t) => t.id !== tone.id
                                        );
                                        showToast(`Removed "${tone.name}" from ${evCopy.name}`);
                                      } else {
                                        // existing snippet in AdminDashboard (tones tab)
                                        // Replace the push branch with this (add effectId)
                                        const effectId = mapToneToEffectId(tone);
                                        evCopy.appliedTones.push({
                                          id: tone.id,           // preset/custom tone id (keep)
                                          name: tone.name,
                                          effectId: mapToneToEffectId(tone),
                                        });
                                        showToast(`Applied "${tone.name}" to ${evCopy.name}`);
                                      }

                                      const updatedEvents = events.map((e) =>
                                        e.id === evCopy.id ? evCopy : e
                                      );

                                      setEvents(updatedEvents);
                                      setCurrentEvent(evCopy);
                                      native?.setEvents?.(updatedEvents, ctx).catch(() => { });
                                    }}
                                  />
                                  {applied ? "Applied" : "Apply to event"}
                                </label>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Background Color */}

                  {activeMain === "dashboard" && currentEvent && activeSub === "background color" && (
                    <div className={cardClass}>
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-semibold text-slate-800">Background Colors</div>
                        <button
                          onClick={() => setIsNewBgColorOpen(true)}
                          className={BTN_PRIMARY}
                        >
                          Add Color
                        </button>
                      </div>

                      <div className="mt-4 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4">
                        {(palettes ?? []).map((p) => {
                          const colors = extractHexes(p);
                          if (!colors.length) return null;
                          const primary = colors[0];
                          const applied =
                            currentEvent.appliedBgColors?.some((c) => c.id === p.id) ?? false;
                          const isActiveForFrames = selectedBgColorId === p.id;

                          return (
                            <div key={p.id} className="p-4 rounded-2xl border border-slate-200 bg-white flex flex-col gap-3">
                              <div>{paletteName(p)}</div>
                              {/* Swatch/Gradient */}
                              <div
                                className="w-full h-16 rounded border"
                                style={{
                                  background:
                                    colors.length > 1
                                      ? `linear-gradient(90deg, ${colors.join(", ")})`
                                      : primary,
                                }}
                                title={paletteName(p)}
                              />
                              <div className="text-xs text-gray-600 truncate">{colors.join(", ")}</div>

                              <div className="flex items-center gap-2 mt-2">
                                {/* Apply to event background */}
                                <label className="text-xs inline-flex items-center gap-2 text-gray-700">
                                  <input
                                    type="checkbox"
                                    checked={applied}
                                    onChange={() => {
                                      const evCopy = JSON.parse(JSON.stringify(currentEvent));
                                      evCopy.appliedBgColors = evCopy.appliedBgColors ?? [];

                                      if (applied) {
                                        evCopy.appliedBgColors = evCopy.appliedBgColors.filter(
                                          (c) => c.id !== p.id
                                        );
                                        showToast?.(`Removed background color from ${evCopy.name}`);
                                      } else {
                                        evCopy.appliedBgColors.push({
                                          id: p.id,
                                          name: paletteName(p),
                                          colors, // array
                                        });
                                        showToast?.(`Applied background color to ${evCopy.name}`);
                                      }

                                      const updatedEvents = events.map((e) =>
                                        e.id === evCopy.id ? evCopy : e
                                      );
                                      setEvents(updatedEvents);
                                      setCurrentEvent(evCopy);
                                      native?.setEvents?.(updatedEvents, ctx).catch(() => { });
                                    }}
                                  />
                                  {applied ? "Applied" : "Apply to event"}
                                </label>
                              </div>

                              {/* Delete color */}
                              <div className="flex items-center mt-2">
                                <button
                                  onClick={() =>
                                    setDeleteTarget({
                                      type: "bgColor",
                                      id: p.id,
                                      name: paletteName(p),
                                    })
                                  }
                                  className="inline-flex items-center justify-center rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-100 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Add Color Modal */}
                      {isNewBgColorOpen && (
                        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4">
                          <div className={`${cardClass} p-6 w-full max-w-md`}>
                            <div className="text-base font-semibold text-slate-800 mb-4">Add Background Color</div>

                            <label className="text-xs text-gray-700 block mb-2">
                              Name (optional)
                              <input
                                type="text"
                                value={newBgName}
                                onChange={(e) => setNewBgName(e.target.value)}
                                className="mt-1 w-full border rounded px-3 py-2 text-sm"
                                placeholder="e.g., Brand Blue"
                              />
                            </label>

                            <label className="text-xs text-gray-700 block">
                              Color
                              <div className="mt-2 flex items-center gap-3">
                                <input
                                  type="color"
                                  value={newBgHex}
                                  onChange={(e) => setNewBgHex(e.target.value)}
                                  className="w-14 h-10 rounded"
                                />
                                <input
                                  type="text"
                                  value={newBgHex}
                                  onChange={(e) => setNewBgHex(e.target.value)}
                                  className="border rounded px-2 py-1 text-sm w-28"
                                  placeholder="#000000"
                                />
                              </div>
                            </label>

                            <div className="flex justify-end gap-2 mt-4">
                              <button
                                onClick={() => {
                                  setIsNewBgColorOpen(false);
                                  setNewBgHex("#ffffff");
                                  setNewBgName("");
                                }}
                                className={BTN_GHOST}
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => {
                                  const entry = {
                                    id: makeId(),
                                    name: newBgName?.trim() || newBgHex.toUpperCase(),
                                    colors: [newBgHex], // single color palette
                                  };
                                  const next = [entry, ...(palettes ?? [])];
                                  setPalettes(next);
                                  native?.setPalettes?.(next, ctx).catch(() => { });
                                  setIsNewBgColorOpen(false);
                                  setNewBgHex("#ffffff");
                                  setNewBgName("");
                                  showToast?.("Background color added");
                                }}
                                className={BTN_PRIMARY}
                              >
                                Add
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* SETTINGS & ANALYTICS (unchanged behavior; minor visual polish) */}
                  {activeMain === "dashboard" && currentEvent && activeSub === "controls" && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Mode */}
                      <div className={cardClass}>
                        <div className="text-sm font-semibold text-slate-800">Mode</div>
                        <div className="mt-3 flex items-center gap-4">
                          <label className="inline-flex items-center gap-2 text-sm">
                            <input
                              type="radio"
                              name="rental"
                              checked={appMode === "rental"}
                              onChange={() => setAppMode("rental")}
                            />
                            Rental (skip payment)
                          </label>
                          <label className="inline-flex items-center gap-2 text-sm">
                            <input
                              type="radio"
                              name="business"
                              checked={appMode === "business"}
                              onChange={() => setAppMode("business")}
                            />
                            Business (payment available)
                          </label>
                        </div>

                        {/* Session settings */}
                        <div className="text-sm font-semibold text-slate-800 mt-4">Session Settings</div>
                        <div className="mt-3 grid grid-cols-2 gap-3">
                          <label className="text-xs text-gray-700">
                            Countdown (s)
                            <input
                              type="number"
                              value={countdown}
                              onChange={(e) => setCountdown(Number(e.target.value))}
                              className={`${SURFACE_BG} ${SURFACE_BORDER} w-full ${INPUT_RADIUS} px-2 py-2 text-sm outline-none mt-1`}
                            />
                          </label>
                          <label className="text-xs text-gray-700">
                            Shots per session
                            <input
                              type="number"
                              value={numberOfShots}
                              onChange={(e) => setNumberOfShots(Number(e.target.value))}
                              className={`${SURFACE_BG} ${SURFACE_BORDER} w-full ${INPUT_RADIUS} px-2 py-2 text-sm outline-none mt-1`}
                            />
                          </label>
                        </div>
                        <div className="mt-3">
                          <label className="inline-flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={timersEnabled}
                              onChange={(e) => setTimersEnabled(e.target.checked)}
                            />
                            Enable custom screen timers
                          </label>
                          <div className="mt-2 flex items-center gap-2">
                            <button
                              onClick={() => {
                                setScreenTimers({ ...screenTimers });
                                setTimersEnabled(true);
                                showToast("Using current timers for this event");
                              }}
                              className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 active:scale-[0.98]"
                            >
                              Use timers
                            </button>
                            <button
                              onClick={() => {
                                setScreenTimers({ ...DEFAULT_SCREEN_TIMERS });
                                setTimersEnabled(true);
                                showToast("Reset to default timers");
                              }}
                              className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 active:scale-[0.98]"
                            >
                              Reset
                            </button>
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                          {Object.keys(screenTimers).map((k) => (
                            <label key={k} className="text-xs text-gray-700">
                              {k}
                              <input
                                type="number"
                                value={screenTimers[k]}
                                disabled={!timersEnabled}
                                onChange={(e) =>
                                  setScreenTimers((prev) => ({ ...prev, [k]: Number(e.target.value) }))
                                }
                                className={`${SURFACE_BG} ${SURFACE_BORDER} w-full ${INPUT_RADIUS} px-2 py-2 text-sm outline-none mt-1`}
                              />
                            </label>
                          ))}
                        </div>
                        <p className="text-xs text-gray-600 mt-2">
                          When enabled, these timer values are saved into the current event; otherwise
                          global defaults apply.
                        </p>
                      </div>

                      {/* Rental options */}
                      {appMode === "rental" && (
                        <>
                          <div className={cardClass}>
                            <div className="text-sm font-semibold text-slate-800">Rental timer</div>
                            <div className="mt-2">
                              <label className="inline-flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={rentalTimerEnabled}
                                  onChange={(e) => setRentalTimerEnabled(e.target.checked)}
                                />
                                Enable auto-close timer
                              </label>
                              <div className="mt-2">
                                <input
                                  type="number"
                                  value={rentalTimerHours}
                                  onChange={(e) => setRentalTimerHours(Number(e.target.value))}
                                  className={`${SURFACE_BG} ${SURFACE_BORDER} w-24 ${INPUT_RADIUS} px-2 py-2 text-sm outline-none`}
                                  disabled={!rentalTimerEnabled}
                                />{" "}
                                hours
                              </div>
                              <p className="text-xs text-gray-600 mt-2">
                                App will auto-close after the specified hours from start.
                              </p>
                            </div>

                            <div className="text-sm font-semibold text-slate-800 mt-4">Session usage limit</div>
                            <div className="mt-2">
                              <label className="inline-flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={rentalSessionLimitEnabled}
                                  onChange={(e) => setRentalSessionLimitEnabled(e.target.checked)}
                                />
                                Limit total sessions
                              </label>
                              <div className="mt-2">
                                <input
                                  type="number"
                                  value={rentalSessionLimit}
                                  onChange={(e) => setRentalSessionLimit(Number(e.target.value))}
                                  className={`${SURFACE_BG} ${SURFACE_BORDER} w-24 ${INPUT_RADIUS} px-2 py-2 text-sm outline-none`}
                                  disabled={!rentalSessionLimitEnabled}
                                />{" "}
                                sessions
                              </div>
                              <p className="text-xs text-gray-600 mt-2">
                                Photobooth will stop accepting sessions after this count.
                              </p>
                            </div>
                          </div>

                          <div className={cardClass}>
                            <div className="text-sm font-semibold text-slate-800">Offline & saving</div>
                            <div className="mt-2 grid grid-cols-2 gap-2">
                              <label className="inline-flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={offlineModeEnabled}
                                  onChange={(e) => setOfflineModeEnabled(e.target.checked)}
                                />
                                Offline mode
                              </label>
                              <label className="text-xs text-gray-700">
                                Auto-save target
                                <select
                                  value={autoSaveTarget}
                                  onChange={(e) => setAutoSaveTarget(e.target.value)}
                                  className={`${SURFACE_BG} ${SURFACE_BORDER} w-full ${INPUT_RADIUS} px-3 py-2 text-sm outline-none mt-1`}
                                >
                                  <option value="local">Local storage</option>
                                  <option value="usb">USB drive</option>
                                  <option value="cloud">Cloud (when online)</option>
                                </select>
                              </label>
                              <label className="inline-flex items-center gap-2 text-sm col-span-2">
                                <input
                                  type="checkbox"
                                  checked={endSessionSummaryEnabled}
                                  onChange={(e) => setEndSessionSummaryEnabled(e.target.checked)}
                                />
                                Show end-of-session summary
                              </label>
                            </div>
                          </div>
                        </>
                      )}

                      {/* Business options */}
                      {activeMain === "dashboard" && currentEvent && appMode === "business" && (
                        <>
                          <div className={cardClass}>
                            <div className="text-sm font-semibold text-slate-800">Payment</div>
                            <div className="mt-2">
                              <label className="inline-flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={paymentEnabled}
                                  onChange={(e) => setPaymentEnabled(e.target.checked)}
                                />
                                Enable payment
                              </label>
                              <div className="mt-2 grid grid-cols-2 gap-2">
                                {[
                                  ["GCash", "gcash"],
                                  ["PayPal", "paypal"],
                                  ["Stripe (Card)", "stripe"],
                                  ["Cash", "cash"],
                                ].map(([label, key]) => (
                                  <label key={key} className="inline-flex items-center gap-2 text-sm">
                                    <input
                                      type="checkbox"
                                      checked={!!paymentProviders[key]}
                                      onChange={(e) =>
                                        setPaymentProviders((prev) => ({ ...prev, [key]: e.target.checked }))
                                      }
                                      disabled={!paymentEnabled}
                                    />
                                    {label}
                                  </label>
                                ))}
                              </div>
                              <p className="text-xs text-gray-600 mt-2">
                                Admin can enable/disable payment methods per event.
                              </p>
                            </div>


                            <div className="text-sm font-semibold text-slate-800 mt-4">Pricing</div>

                            {/* Pricing model fixed to per session; you can drop pricingModel altogether */}
                            <div className="mt-2 grid grid-cols-2 gap-3">
                              {/* Per session price */}
                              <label className="text-xs text-gray-700 col-span-2">
                                ₱ Per session
                                <input
                                  type="number"
                                  value={pricePerSession}
                                  onChange={(e) => setPricePerSession(Number(e.target.value))}
                                  className={`${SURFACE_BG} ${SURFACE_BORDER} w-full ${INPUT_RADIUS} px-2 py-2 text-sm outline-none mt-1`}
                                  min={0}
                                  step="0.01"
                                  inputMode="decimal"
                                />
                              </label>

                              {/* Additional print price (new input) */}
                              <label className="text-xs text-gray-700 col-span-2">
                                ₱ Additional print price
                                <input
                                  type="number"
                                  value={additionalPrintPrice}
                                  onChange={(e) => setAdditionalPrintPrice(Number(e.target.value))}
                                  className={`${SURFACE_BG} ${SURFACE_BORDER} w-full ${INPUT_RADIUS} px-2 py-2 text-sm outline-none mt-1`}
                                  min={0}
                                  step="0.01"
                                  inputMode="decimal"
                                />
                              </label>

                              {/* Currency */}
                              <label className="text-xs text-gray-700">
                                Currency
                                <select
                                  value={currency}
                                  onChange={(e) => setCurrency(e.target.value)}
                                  className={`${SURFACE_BG} ${SURFACE_BORDER} w-full ${INPUT_RADIUS} px-3 py-2 text-sm outline-none mt-1`}
                                >
                                  <option>PHP</option>
                                  <option>USD</option>
                                  <option>EUR</option>
                                </select>
                              </label>

                              {/* Apply tax */}
                              <label className="inline-flex items-center gap-2 text-sm col-span-1">
                                <input
                                  type="checkbox"
                                  checked={taxEnabled}
                                  onChange={(e) => setTaxEnabled(e.target.checked)}
                                />
                                Apply tax
                              </label>

                              {/* VAT/Tax */}
                              <label className="text-xs text-gray-700">
                                % VAT/Tax
                                <input
                                  type="number"
                                  value={taxRate}
                                  onChange={(e) => setTaxRate(Number(e.target.value))}
                                  className={`${SURFACE_BG} ${SURFACE_BORDER} w-full ${INPUT_RADIUS} px-2 py-2 text-sm outline-none mt-1`}
                                  disabled={!taxEnabled}
                                  min={0}
                                  step="0.01"
                                  inputMode="decimal"
                                />
                              </label>

                              {/* Retake limit */}
                              <label className="text-xs text-gray-700">
                                Retake limit
                                <input
                                  type="number"
                                  value={retakeLimit}
                                  onChange={(e) => setRetakeLimit(Number(e.target.value))}
                                  className={`${SURFACE_BG} ${SURFACE_BORDER} w-full ${INPUT_RADIUS} px-2 py-2 text-sm outline-none mt-1`}
                                  min={0}
                                  step="1"
                                  inputMode="numeric"
                                />
                              </label>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* Socials Sharing */}
                  {activeMain === "dashboard" && currentEvent && activeSub === "sharing" && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className={cardClass}>
                        <div className="text-sm font-semibold text-slate-800">Overview</div>
                        <div className="mt-3 grid grid-cols-2 gap-3">
                          <div className={smallCardClass}>
                            <div className="text-xs text-gray-600">Sessions Today</div>
                            <div className="text-xl font-semibold">
                              {completedSessionsToday(currentEvent)}
                            </div>
                            <div className="text-xs text-gray-600">Completed sessions</div>
                          </div>
                          <div className={smallCardClass}>
                            <div className="text-xs text-gray-600">Revenue Today</div>
                            <div className="text-xl font-semibold">
                              ₱{currentEvent?.analytics?.revenueToday ?? 0}
                            </div>
                            <div className="text-xs text-gray-600">Payments & add-ons</div>
                          </div>
                        </div>
                      </div>
                      <div className={cardClass}>
                        <div className="text-sm font-semibold text-slate-800">Weekly Sessions</div>
                        <div className="mt-3 text-2xl font-semibold">
                          {currentEvent?.analytics?.sessionsWeekly ?? 0}
                        </div>
                        <div className="text-xs text-gray-600">Chart</div>
                      </div>
                      <div className={cardClass}>
                        <div className="text-sm font-semibold text-slate-800">Monthly Revenue</div>
                        <div className="mt-3 text-2xl font-semibold">
                          ₱{currentEvent?.analytics?.revenueMonthly ?? 0}
                        </div>
                        <div className="text-xs text-gray-600">Chart</div>
                      </div>
                    </div>
                  )}

                  {/* Analytics */}
                  {activeMain === "dashboard" && currentEvent && activeSub === "analytics" && (
                    <div className="space-y-5">

                      {/* ── Row 1: Session KPIs ── */}
                      <div>
                        <div className={`${EYEBROW} mb-2`}>Sessions</div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          {[
                            { label: "Today", value: evDayCount, badge: "D" },
                            { label: "This Week", value: evWeekCount, badge: "W" },
                            { label: "This Month", value: evMonthCount, badge: "M" },
                            { label: "YTD", value: evYtdCount, badge: "Y" },
                          ].map(({ label, value, badge }) => (
                            <div key={label} className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-4`}>
                              <div className="flex items-center justify-between">
                                <div className="text-xs font-medium text-gray-500">{label}</div>
                                <span className="text-[10px] font-bold text-indigo-500 bg-indigo-50 rounded-full px-1.5 py-0.5">{badge}</span>
                              </div>
                              <div className="mt-2 text-3xl font-bold text-gray-900 tabular-nums">{value}</div>
                              <div className="text-[11px] text-gray-400 mt-0.5">sessions</div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* ── Row 2: Revenue KPIs ── */}
                      <div>
                        <div className={`${EYEBROW} mb-2`}>Revenue</div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          {[
                            { label: "Today", value: evDayRevenue },
                            { label: "This Week", value: evWeekRevenue },
                            { label: "This Month", value: evMonthRevenue },
                            { label: "YTD", value: evYtdRevenue },
                          ].map(({ label, value }) => (
                            <div key={label + "rev"} className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-4`}>
                              <div className="text-xs font-medium text-gray-500">{label}</div>
                              <div className="mt-2 text-2xl font-bold text-indigo-600 tabular-nums">{peso(value)}</div>
                              <div className="text-[11px] text-gray-400 mt-0.5">gross revenue</div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* ── Row 3: Charts ── */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                        {/* Hourly — today */}
                        <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-4`}>
                          <div className="text-sm font-semibold text-gray-800">Sessions / Hour</div>
                          <div className="text-xs text-gray-400 mb-3">Today</div>
                          <div className="h-24 flex items-end gap-px">
                            {evHourlyData.map((v, i) => (
                              <div
                                key={i}
                                className="flex-1 rounded-sm bg-indigo-500/70 hover:bg-indigo-600 transition-colors"
                                style={{ height: `${(v / evMaxHourly) * 100}%`, minHeight: v > 0 ? 3 : 1 }}
                                title={`${v} session${v !== 1 ? "s" : ""} at ${i}:00`}
                              />
                            ))}
                          </div>
                          <div className="flex justify-between text-[10px] text-gray-400 mt-1.5">
                            <span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span>
                          </div>
                        </div>

                        {/* Daily — this week */}
                        <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-4`}>
                          <div className="text-sm font-semibold text-gray-800">Sessions / Day</div>
                          <div className="text-xs text-gray-400 mb-3">This week</div>
                          <div className="h-24 flex items-end gap-1">
                            {evWeeklyData.map((v, i) => (
                              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                                <div className="w-full flex flex-col justify-end" style={{ height: 72 }}>
                                  <div
                                    className={`w-full rounded-sm transition-colors ${i === _nowAn.getDay() ? "bg-indigo-600" : "bg-indigo-300/70"}`}
                                    style={{ height: `${(v / evMaxWeekly) * 100}%`, minHeight: v > 0 ? 3 : 1 }}
                                    title={`${EV_DAY_LABELS[i]}: ${v} session${v !== 1 ? "s" : ""}`}
                                  />
                                </div>
                                <div className={`text-[10px] ${i === _nowAn.getDay() ? "text-indigo-600 font-semibold" : "text-gray-400"}`}>
                                  {EV_DAY_LABELS[i]}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Daily — last 30 days */}
                        <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-4`}>
                          <div className="text-sm font-semibold text-gray-800">Sessions / Day</div>
                          <div className="text-xs text-gray-400 mb-3">Last 30 days</div>
                          <div className="h-24 flex items-end gap-px">
                            {evLast30Data.map((v, i) => (
                              <div
                                key={i}
                                className="flex-1 rounded-sm bg-emerald-500/70 hover:bg-emerald-600 transition-colors"
                                style={{ height: `${(v / evMax30) * 100}%`, minHeight: v > 0 ? 3 : 1 }}
                                title={`${29 - i} day${29 - i !== 1 ? "s" : ""} ago: ${v} session${v !== 1 ? "s" : ""}`}
                              />
                            ))}
                          </div>
                          <div className="flex justify-between text-[10px] text-gray-400 mt-1.5">
                            <span>−30d</span><span>−15d</span><span>Today</span>
                          </div>
                        </div>
                      </div>

                      {/* ── Row 4: Performance + Template usage ── */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                        {/* All-time performance */}
                        <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-4`}>
                          <div className="text-sm font-semibold text-gray-800 mb-3">All-Time Performance</div>
                          <div className="grid grid-cols-2 gap-3">
                            {[
                              { label: "Total Sessions", value: evTotalCount },
                              { label: "Total Revenue", value: peso(evTotalRevenue) },
                              { label: "Total Photos Taken", value: evTotalPhotos },
                              { label: "Avg Rev / Session", value: peso(evAvgRevPerSession) },
                              { label: "Avg Photos / Session", value: evAvgPhotosPerSession },
                              { label: "Completion Rate", value: `${evCompletionRate}%` },
                            ].map(({ label, value }) => (
                              <div key={label} className={smallCardClass}>
                                <div className="text-[11px] text-gray-500 leading-tight">{label}</div>
                                <div className="mt-1 text-lg font-bold text-gray-900 tabular-nums">{value}</div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Template usage */}
                        <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-4`}>
                          <div className="text-sm font-semibold text-gray-800 mb-3">Top Templates Used</div>
                          {evTplEntries.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-32 text-gray-400 text-xs gap-2">
                              <svg className="w-8 h-8 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
                              </svg>
                              No template usage data yet
                            </div>
                          ) : (
                            <div className="space-y-2.5">
                              {evTplEntries.map(([name, count]) => (
                                <div key={name}>
                                  <div className="flex items-center justify-between text-xs mb-1">
                                    <span className="text-gray-700 font-medium truncate max-w-[75%]">{name}</span>
                                    <span className="text-gray-500 tabular-nums ml-2">{count}×</span>
                                  </div>
                                  <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-indigo-500 rounded-full transition-all"
                                      style={{ width: `${(count / evMaxTpl) * 100}%` }}
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Delete confirmation modal */}
            {deleteTarget && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
                <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} shadow-xl p-6 w-full max-w-sm`}>
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-9 h-9 rounded-full bg-red-50 flex items-center justify-center">
                      <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-900">Delete {deleteTarget.type}?</div>
                      <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                        <span className="font-medium text-gray-700">{deleteTarget.name}</span> will be permanently removed. This cannot be undone.
                      </p>
                    </div>
                  </div>
                  <div className="mt-5 flex items-center justify-end gap-3">
                    <button
                      onClick={() => setDeleteTarget(null)}
                      className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                    >
                      Cancel
                    </button>

                    <button
                      onClick={async () => {
                        if (!deleteTarget) return;

                        try {
                          if (deleteTarget.type === "event") {
                            const nextEvents = events.filter((e) => e.id !== deleteTarget.id);
                            await persistEvents(nextEvents);

                            if (currentEvent?.id === deleteTarget.id) {
                              setCurrentEvent(null);
                              setActiveMain("events");
                            }

                            showToast("Event deleted");
                          }

                          else if (deleteTarget.type === "template") {
                            const nextTemplates = templates.filter((t) => t.id !== deleteTarget.id);

                            const nextEvents = events.map((ev) => {
                              const copy = JSON.parse(JSON.stringify(ev));
                              copy.appliedTemplates = (copy.appliedTemplates ?? []).filter(
                                (at) => at.id !== deleteTarget.id
                              );
                              return copy;
                            });

                            await persistTemplates(nextTemplates);
                            await persistEvents(nextEvents);

                            showToast("Template deleted and removed from events");
                          }

                          else if (deleteTarget.type === "frame") {
                            const nextFrames = frames.filter((f) => f.id !== deleteTarget.id);

                            const nextEvents = events.map((ev) => {
                              const copy = JSON.parse(JSON.stringify(ev));
                              copy.appliedFrames = (copy.appliedFrames ?? []).filter(
                                (af) => af.id !== deleteTarget.id
                              );
                              return copy;
                            });

                            await persistFrames(nextFrames);
                            await persistEvents(nextEvents);

                            showToast("Frame deleted and removed from events");
                          }

                          else if (deleteTarget.type === "bgColor") {
                            const nextPalettes = (palettes ?? []).filter((p) => p.id !== deleteTarget.id);

                            const nextEvents = (events ?? []).map((ev) => {
                              const copy = JSON.parse(JSON.stringify(ev));
                              const before = copy.appliedBgColors ?? [];

                              copy.appliedBgColors = before.filter((c) => c.id !== deleteTarget.id);

                              if (before.length > 0 && copy.appliedBgColors.length === 0) {
                                copy.appliedFrames = (copy.appliedFrames ?? []).map((f) => {
                                  if (!f.useBgColor) return f;
                                  return {
                                    ...f,
                                    useBgColor: false,
                                    palette: null,
                                    selectedColor: null,
                                  };
                                });
                              }

                              return copy;
                            });

                            await persistPalettes(nextPalettes);
                            await persistEvents(nextEvents);

                            if (selectedBgColorId === deleteTarget.id) {
                              setSelectedBgColorId(null);
                              try {
                                await native?.setAppearance?.(
                                  {
                                    headerFont,
                                    generalFont,
                                    headerFontColor,
                                    generalFontColor,
                                    bgColor,
                                    logoPath: logoPath?.url ?? null,
                                    backgroundMediaPath: backgroundMediaPath?.url ?? null,
                                    backgroundMediaName: backgroundMediaPath?.name ?? null,
                                    backgroundMediaMime: backgroundMediaPath?.mime ?? null,
                                    boothName,
                                    boothSlogan,
                                    buttonBgColor,
                                    buttonHoverColor,
                                    buttonFont,
                                    buttonFontColor,
                                    startButtonHidden,
                                    startButtonText,
                                    selectedBgColorId: null,
                                  },
                                  ctx
                                );
                              } catch { }
                            }

                            showToast("Background color deleted");
                          }
                        } finally {
                          setDeleteTarget(null);
                        }
                      }}
                      className="inline-flex items-center justify-center rounded-full bg-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-red-200 transition hover:-translate-y-0.5 hover:bg-red-700"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Toast */}
            {toast && (
              <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-[0_8px_30px_rgba(15,23,42,0.25)]">
                <svg className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                {toast}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
