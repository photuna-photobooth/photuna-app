
import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import QRCode from "react-qr-code";
import { normalizeToFileUrl } from "../utils/mediaUrl";
import { loadGoogleFont } from "../utils/fontLoader";

/* ----------------------- Minimal i18n labels ----------------------- */
const LOCALES = {
  en: {
    printingTitle1: "We are now",
    printingTitle2: "Printing...",
    thanks: "Thank you for choosing ",
    thanksBold: "Studio Photuna",
    thanksTail:
      " to create this special memory. To download your photos and GIF samples, simply scan the QR code.",
    remainingSuffix: "secs",
    qrFallback: "QR",
    posterFallback: "Poster",
    localSaved: "Your photos are saved locally by the booth operator.",
  },
  tl: {
    printingTitle1: "Kasalukuyan kaming",
    printingTitle2: "Nagpi-print...",
    thanks: "Salamat sa pagpili sa ",
    thanksBold: "Studio Photuna",
    thanksTail:
      " para lumikha ng espesyal na alaala. Para i-download ang iyong mga larawan at GIF, i-scan lang ang QR code.",
    remainingSuffix: "seg",
    qrFallback: "QR",
    posterFallback: "Poster",
    localSaved: "Naka-save ang mga larawan sa lokal na storage ng booth operator.",
  },
};
function resolveLocale(code) {
  const key = String(code ?? "en").toLowerCase();
  return LOCALES[key] ?? LOCALES.en;
}

/* ---------------------------- Appearance defaults ---------------------------- */
const DEFAULT_APPEARANCE = {
  boothName: "Studio Photuna",
  boothSlogan: "Ahead of the moment.",
  headerFont: "Ramillas",
  generalFont: "Interphases",
  buttonFont: "Interphases",
  headerFontColor: "#111827",
  generalFontColor: "#374151",
  bgColor: "#ffffff",
  buttonBgColor: "#2563eb",
  buttonHoverColor: "#1e40af",
  buttonFontColor: "#ffffff",
  logoPath: null,
  backgroundMediaPath: null,
};

export default function PrintPreviewScreen({
  seconds = 30,
  printingProgress,
  qrImage,
  qrUrl,
  composedImage,
  composedImagePath = null,
  composedImageUrl = null,
  sessionId = "default",
  eventId = "default",
  onPrintComplete,
  onNextPage,
  event = null,
  layout,
  layoutConfig = null,   // NEW
  photos = [],
  slotVideoMap = [],
  frameOverlayDataUrl = null,
  motionBackgroundColor = "#ffffff",
  watermark = false,
  galleryEnabled = false,
}) {
  // IMPORTANT: prefer window.api (preload exposes printPhoto here). Fall back to window.electron only if needed.
  const api =
    typeof window !== "undefined"
      ? window.api || window.electron || null
      : null;

  /* ---------------------------- Load AdminDashboard state ---------------------------- */
  const [currentEvent, setCurrentEvent] = useState(event ?? null);
  const [globalAppearance, setGlobalAppearance] = useState(null);
  const [globalSettings, setGlobalSettings] = useState(null);

  const [isPreparing, setIsPreparing] = useState(true);
  const [resolvedQrUrl, setResolvedQrUrl] = useState(qrUrl || null);
  const [galleryError, setGalleryError] = useState("");

  useEffect(() => {
    setResolvedQrUrl(qrUrl || null);
  }, [qrUrl]);

  // Prop-driven print progress (if provided)
  const [printProgress, setPrintProgress] = useState(0);
  useEffect(() => {
    if (typeof printingProgress === "number") {
      const p = Math.max(0, Math.min(1, printingProgress));
      setPrintProgress(p);
      if (p >= 1) onPrintComplete?.();
    }
  }, [printingProgress, onPrintComplete]);

  useEffect(() => {
    let mounted = true;

    async function prepareGallery() {
      if (!galleryEnabled) {
        setResolvedQrUrl(null);
        setGalleryError("");
        setIsPreparing(false);
        return;
      }

      try {
        setIsPreparing(true);
        setGalleryError("");

        const result = await api?.createOnlineGallery?.({
          composedImage,
          composedImagePath,
          composedImageUrl,
          photos,
          layout,              // normalizedLayout string
          layoutConfig,        // full resolved layout object with slots
          slotVideoMap,
          frameOverlayDataUrl,
          motionBackgroundColor,
          watermark,
          galleryEnabled,
          sessionId,
          eventId,
        });

        if (!mounted) return;

        if (!result?.ok) {
          throw new Error(result?.error || "Gallery creation failed");
        }

        if (result?.qrUrl) {
          setResolvedQrUrl(result.qrUrl);
        }

      } catch (err) {
        console.error("Gallery creation failed:", err);
        if (mounted) {
          setGalleryError(err?.message || "Gallery upload failed");
        }
      } finally {
        if (mounted) setIsPreparing(false);
      }
    }

    prepareGallery();

    return () => {
      mounted = false;
    };
  }, [
    api,
    composedImage,
    composedImagePath,
    composedImageUrl,
    photos,
    layout,
    layoutConfig,
    slotVideoMap,
    frameOverlayDataUrl,
    motionBackgroundColor,
    watermark,
    galleryEnabled,
    sessionId,
    eventId,
  ]);

  useEffect(() => {
    (async () => {
      if (!api) return;
      try {
        const [a, s] = await Promise.all([
          api.getAppearance?.(),
          api.getSettings?.(),
        ]);
        if (a) setGlobalAppearance(a);
        if (s) setGlobalSettings(s);
        if (event) {
          setCurrentEvent(event);
        } else {
          const evts = await api.getEvents?.();
          if (Array.isArray(evts)) {
            const curId = await api.getCurrentEventId?.();
            const found = evts.find((e) => e?.id === curId);
            if (found) setCurrentEvent(found);
          }
        }
      } catch (err) {
        console.warn("PrintPreviewScreen: failed to load appearance/settings/event:", err);
      }
    })();
  }, [api, event]);

  /* ---------------------------- Appearance resolution ---------------------------- */
  const appearance = useMemo(() => {
    const evApp = currentEvent?.appearance ?? {};
    const gApp = globalAppearance ?? {};
    const merged = { ...DEFAULT_APPEARANCE, ...gApp, ...evApp };
    return {
      ...merged,
      logoPath: merged.logoPath ? normalizeToFileUrl(merged.logoPath) : null,
      backgroundMediaPath: merged.backgroundMediaPath ? normalizeToFileUrl(merged.backgroundMediaPath) : null,
    };
  }, [currentEvent, globalAppearance]);

  const {
    boothName,
    boothSlogan,
    headerFont,
    generalFont,
    headerFontColor,
    generalFontColor,
    bgColor,
    buttonBgColor,
    buttonFont,
    buttonFontColor,
    buttonHoverColor,
  } = appearance;

  // Load fonts
  useEffect(() => {
    loadGoogleFont(headerFont);
    loadGoogleFont(generalFont);
  }, [headerFont, generalFont]);

  /* ---------------------------- Language ---------------------------- */
  const langCode = currentEvent?.settings?.language ?? globalSettings?.language ?? "en";
  const i18n = resolveLocale(langCode);

  // ---------------------------- Timer resolution ----------------------------
  const printingSeconds =
    currentEvent?.settings?.screenTimers?.printing ??
    globalSettings?.screenTimers?.printing ??
    seconds;

  // Page timer progress (for left countdown only)
  const [pageProgress, setPageProgress] = useState(0);

  // If your shell can push real-time progress, subscribe here.
  // We'll try window.api.onPrintProgress((0..1)) if available.
  useEffect(() => {
    if (!api?.onPrintProgress) return;
    const off = api.onPrintProgress((value) => {
      const p = Math.max(0, Math.min(1, Number(value) || 0));
      setPrintProgress(p);
      if (p >= 1) onPrintComplete?.();
    });
    return () => {
      try { off?.(); } catch { }
    };
  }, [api, onPrintComplete]);

  // Fallback page timer (only for the left side countdown). Does NOT drive the poster reveal anymore.
  useEffect(() => {
    if (isPreparing) {
      setPageProgress(0);
      return;
    }

    let current = 0;

    const interval = setInterval(() => {
      current += 1;
      const p = Math.min(1, current / printingSeconds);
      setPageProgress(p);
    }, 1000);

    return () => clearInterval(interval);
  }, [printingSeconds, isPreparing]);

  // Right-side reveal uses printer progress if available; if the host doesn't send it,
  // mirror the page timer so things still move.
  useEffect(() => {
    if (!api?.onPrintProgress) {
      setPrintProgress(pageProgress);
    }
  }, [api, pageProgress]);

  // For the clip-path animation on the right
  const posterBottomInset = Math.max(0, (1 - printProgress) * 100);

  /* ---------------------------- Normalized sources ---------------------------- */
  const qrSrc = useMemo(() => normalizeToFileUrl(qrImage), [qrImage]);
  const posterSrc = useMemo(() => normalizeToFileUrl(composedImage), [composedImage]);

  const [posterDims, setPosterDims] = useState({ w: 0, h: 0 });
  const posterRatio = useMemo(() => {
    const { w, h } = posterDims;
    return w > 0 && h > 0 ? w / h : null;
  }, [posterDims]);

  const resolvedLayout = layout || "4x6";

  const isStripTall = resolvedLayout === "2x6";
  const isStripWide = resolvedLayout === "6x2";
  const isSheetPortrait = resolvedLayout === "4x6";
  const isSheetLandscape = resolvedLayout === "6x4";

  const isStripLayout = isStripTall || isStripWide;

  // temporary: use posterSrc until you create a real single-strip asset
  const stripSrc = posterSrc;

  const activePreviewSrc = isStripLayout ? stripSrc : posterSrc;

  const previewBottomInset =
    typeof posterBottomInset !== "undefined"
      ? posterBottomInset
      : Math.max(0, 100 - printProgress * 100);

  /* ---------------------------- PRINT: single-shot, robust ---------------------------- */
  const printedRef = useRef(false);

  const sendPrintJob = useCallback(async () => {
    if (printedRef.current) return; // avoid duplicates
    if (!api) { console.warn("Print API not available"); return; }
    if (!composedImage || typeof composedImage !== "string" || !composedImage.startsWith("data:")) {
      console.warn("No valid composedImage data URL to print");
      return;
    }
    try {
      const settings = await api.getSettings?.();
      const list = await api.getPrinters?.() || [];
      const effectiveSettings = {
        ...(settings || {}),
        ...(currentEvent?.settings || {}),
      };
      const pickBy = (name) =>
        list.find(p => p?.name === name || p?.displayName === name);

      // Try the saved printer first
      let target = effectiveSettings?.selectedPrinter
        ? pickBy(effectiveSettings.selectedPrinter)
        : null;
      // Else default, else first available
      if (!target) target = list.find(p => p.isDefault) || list[0] || null;

      if (!target) {
        console.warn("No printers detected by Electron. Is the DNP driver installed?");
        return;
      }
      // Persist the resolved name if it changed (keeps Settings in sync)
      if (effectiveSettings?.selectedPrinter !== target.name) {
        await api.setSettings?.({ ...(settings || {}), selectedPrinter: target.name });
      }

      await api.savePrintCopy?.({
        imageData: posterSrc,
        eventId,
        sessionId: sessionId || "default",
        filename: `print_copy_${Date.now()}.png`,
      });

      const res = await api.printPhoto?.({
        printer: String(target.name),
        imageData: posterSrc,
        layout: resolvedLayout || "4x6",
        paperSize: effectiveSettings?.paperSize || resolvedLayout || "4x6",
        copies: effectiveSettings?.printCopies ?? 1,
        colorMode: effectiveSettings?.printColorMode ?? "color",
        quality: effectiveSettings?.printQuality ?? "standard",
        orientation: effectiveSettings?.printOrientation ?? "auto",
        duplexMode: effectiveSettings?.printDuplexMode ?? "simplex",
        dpi: effectiveSettings?.printDpi ?? 300,
        usePrinterDefaults: effectiveSettings?.usePrinterDefaults ?? false,
      });

      if (!res || res.ok === false) {
        console.error('printPhoto failed:', res?.error ?? 'unknown error');
        return;
      }

      printedRef.current = true;
    } catch (err) {
      console.error("Failed to send print job:", err);
    }
  }, [api, composedImage, currentEvent, resolvedLayout, posterSrc, eventId, sessionId]);

  // Send the job as soon as the composed image is present on the Print screen
  useEffect(() => {
    if (
      typeof composedImage === "string" &&
      composedImage.startsWith("data:image") &&
      composedImage.length > 20000
    ) {
      sendPrintJob();
    }
  }, [composedImage, sendPrintJob]);

  // Navigate to next page once the page timer hits zero (do NOT print again here)
  useEffect(() => {
    if (!isPreparing && pageProgress >= 1) {
      onNextPage?.();
    }
  }, [pageProgress, onNextPage, isPreparing]);

  /* ---------------------------- Preview aspect styles ---------------------------- */
  const ASPECT_STYLES = {
    "2x6": { aspectRatio: "2 / 6" },
    "4x6": { aspectRatio: "4 / 6" },
    "6x4": { aspectRatio: "6 / 4" },
    "6x2": { aspectRatio: "6 / 2" },
  };

  // Base container sizes (visual only, not print DPI):
  const SIZE_STYLES = {
    "2x6": { width: 240 }, // render two copies side-by-side
    "6x2": { width: 240 }, // render two copies stacked
    "4x6": { width: 820 }, // single portrait sheet
    "6x4": { width: 920 }, // single landscape sheet
  };

  const aspectStyle = ASPECT_STYLES[resolvedLayout] ?? ASPECT_STYLES["4x6"];
  const { width: baseW } = SIZE_STYLES[resolvedLayout] ?? SIZE_STYLES["4x6"];
  const scale = 1; // default preview scale (tune per layout if desired)

  // Use the actual image aspect once we know it; otherwise fall back to the layout hint
  const dynamicAspectStyle = useMemo(() => {
    const { w, h } = posterDims ?? {};
    if (w > 0 && h > 0) {
      return { aspectRatio: `${w} / ${h}` };
    }
    return aspectStyle; // fallback (2x6 / 4x6 / 6x4 / 6x2)
  }, [posterDims, aspectStyle]);

  // Left-side remaining time
  const remaining = Math.max(0, printingSeconds - Math.floor(pageProgress * printingSeconds));

  if (galleryEnabled && isPreparing) {
    return (
      <div
        className="w-full h-full flex items-center justify-center overflow-hidden px-10"
        style={{
          backgroundColor: bgColor,
          color: generalFontColor,
          fontFamily: generalFont,
        }}
      >
        <div className="flex flex-col items-center justify-center text-center">
          <p
            className="text-6xl md:text-7xl font-semibold leading-none"
            style={{
              color: headerFontColor,
              fontFamily: headerFont,
            }}
          >
            Preparing your gallery
          </p>

          <p className="mt-5 text-xl md:text-2xl leading-relaxed max-w-2xl">
            Generating your QR code and getting your photos ready.
          </p>

          <div className="mt-10 flex items-center gap-3">
            <span
              className="w-3 h-3 rounded-full animate-bounce"
              style={{ backgroundColor: headerFontColor, animationDelay: "0ms" }}
            />
            <span
              className="w-3 h-3 rounded-full animate-bounce"
              style={{ backgroundColor: headerFontColor, animationDelay: "150ms" }}
            />
            <span
              className="w-3 h-3 rounded-full animate-bounce"
              style={{ backgroundColor: headerFontColor, animationDelay: "300ms" }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-row overflow-hidden"
      style={{
        backgroundColor: bgColor,
        color: generalFontColor,
        fontFamily: generalFont,
      }}
    >

      {/* LEFT SIDE */}
      <div className="flex flex-col justify-center items-center w-1/2 px-16">
        <div
          className="px-8 py-3 rounded-full text-2xl font-bold shadow-sm mb-10"
          style={{
            fontFamily: generalFont,
            backgroundColor: buttonBgColor,
            color: buttonFontColor,
          }}
          aria-live="polite"
        >
          {Math.max(0, remaining)}s
        </div>

        <div className="text-center" style={{ fontFamily: headerFont }}>
          <p className="text-8xl" style={{ color: headerFontColor }}>
            {i18n.printingTitle1}
          </p>
          <p
            className="text-8xl italic font-semibold -mt-2"
            style={{ color: headerFontColor }}
          >
            {i18n.printingTitle2}
          </p>
        </div>


        {galleryEnabled ? (
          <div className="mt-12 border rounded-xl p-4 bg-white text-black border-black">
            {resolvedQrUrl ? (
              <div className="bg-white p-2 rounded-lg">
                <QRCode value={resolvedQrUrl} size={256} bgColor="#ffffff" fgColor="#000000" />
              </div>
            ) : qrSrc ? (
              <img
                src={qrSrc}
                alt="QR"
                className="w-64 h-64 object-contain bg-gray-100 rounded-lg"
              />
            ) : (
              <div className="w-64 h-64 flex items-center justify-center text-gray-400 bg-gray-100 rounded-lg">
                {isPreparing ? "Preparing" : i18n.qrFallback}
              </div>
            )}
            {galleryError ? (
              <div className="mt-2 max-w-64 text-center text-xs text-red-600">
                Gallery upload failed
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Thank you copy */}
        <p
          className="text-center text-lg mt-6 px-16 max-w-xl leading-relaxed"
          style={{ fontFamily: generalFont, color: generalFontColor }}
        >
          {i18n.thanks}
          <span className="font-semibold" style={{ color: headerFontColor }}>
            {boothName ?? i18n.thanksBold}
          </span>
          {galleryEnabled ? i18n.thanksTail : ` ${i18n.localSaved}`}
        </p>
      </div>

      {/* RIGHT SIDE - Poster Output */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-[100%] h-[100%] flex items-center justify-center">
          {isStripTall ? (
            /* 2×6: show single strip only */
            <div
              className="relative overflow-hidden"
              style={{
                ...dynamicAspectStyle,
                maxWidth: "100%",
                maxHeight: "100%",
                width: "clamp(360px, 90%, 100%)",
              }}
            >
              {posterSrc ? (
                <>
                  <motion.img
                    src={posterSrc}
                    alt="2x6 Strip"
                    className="absolute inset-0 w-full h-full object-contain"
                    initial={{ clipPath: "inset(0 0 100% 0)" }}
                    animate={{ clipPath: `inset(0 0 ${posterBottomInset}% 0)` }}
                    transition={{ duration: 0.85, ease: "easeOut" }}
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      setPosterDims({ w: img.naturalWidth, h: img.naturalHeight });
                    }}
                  />
                  {printProgress < 1 && (
                    <motion.div
                      className="absolute left-0 w-full h-8 pointer-events-none"
                      style={{
                        top: `${printProgress * 100}%`,
                        transform: "translateY(-50%)",
                        background:
                          "linear-gradient(to bottom, rgba(236,72,153,0), rgba(236,72,153,0.22), rgba(236,72,153,0))",
                      }}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.25 }}
                    />
                  )}
                  {printProgress >= 1 && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 0.6 }}
                      transition={{ duration: 0.4 }}
                      className="absolute inset-0 pointer-events-none"
                      style={{ boxShadow: "0 0 40px rgba(236,72,153,0.35)" }}
                    />
                  )}
                </>
              ) : (
                <div className="absolute inset-0 w-full h-full flex items-center justify-center text-gray-400 bg-gray-100">
                  {i18n.posterFallback}
                </div>
              )}
            </div>
          ) : isStripWide ? (
            /* 6×2: show single strip only */
            <div
              className="relative overflow-hidden"
              style={{
                ...dynamicAspectStyle,
                maxWidth: "100%",
                maxHeight: "100%",
                width: "clamp(480px, 95%, 100%)",
              }}
            >
              {posterSrc ? (
                <>
                  <motion.img
                    src={posterSrc}
                    alt="6x2 Strip"
                    className="absolute inset-0 w-full h-full object-contain"
                    initial={{ clipPath: "inset(0 0 100% 0)" }}
                    animate={{ clipPath: `inset(0 0 ${posterBottomInset}% 0)` }}
                    transition={{ duration: 0.85, ease: "easeOut" }}
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      setPosterDims({ w: img.naturalWidth, h: img.naturalHeight });
                    }}
                  />
                  {printProgress < 1 && (
                    <motion.div
                      className="absolute left-0 w-full h-8 pointer-events-none"
                      style={{
                        top: `${printProgress * 100}%`,
                        transform: "translateY(-50%)",
                        background:
                          "linear-gradient(to bottom, rgba(236,72,153,0), rgba(236,72,153,0.22), rgba(236,72,153,0))",
                      }}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.25 }}
                    />
                  )}
                  {printProgress >= 1 && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 0.6 }}
                      transition={{ duration: 0.4 }}
                      className="absolute inset-0 pointer-events-none"
                      style={{ boxShadow: "0 0 40px rgba(236,72,153,0.35)" }}
                    />
                  )}
                </>
              ) : (
                <div className="absolute inset-0 w-full h-full flex items-center justify-center text-gray-400 bg-gray-100">
                  {i18n.posterFallback}
                </div>
              )}
            </div>
          ) : (
            /* 4×6 or 6×4: single sheet */
            <div
              className="relative overflow-hidden"
              style={{
                ...dynamicAspectStyle,
                width: isSheetPortrait ? "clamp(360px, 90%, 100%)" : "clamp(480px, 95%, 100%)",
                maxWidth: "100%",
                maxHeight: "100%",
                height: "auto",
              }}
            >
              {posterSrc ? (
                <>
                  <motion.img
                    src={posterSrc}
                    alt="Poster"
                    className="absolute inset-0 w-full h-full object-contain"
                    initial={{ clipPath: "inset(0 0 100% 0)" }}
                    animate={{ clipPath: `inset(0 0 ${posterBottomInset}% 0)` }}
                    transition={{ duration: 0.85, ease: "easeOut" }}
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      setPosterDims({ w: img.naturalWidth, h: img.naturalHeight });
                    }}
                  />
                  {printProgress < 1 && (
                    <motion.div
                      className="absolute left-0 w-full h-10 pointer-events-none"
                      style={{
                        top: `${printProgress * 100}%`,
                        transform: "translateY(-50%)",
                        background:
                          "linear-gradient(to bottom, rgba(236,72,153,0), rgba(236,72,153,0.22), rgba(236,72,153,0))",
                      }}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.25 }}
                    />
                  )}
                  {printProgress >= 1 && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 0.6 }}
                      transition={{ duration: 0.4 }}
                      className="absolute inset-0 pointer-events-none"
                      style={{ boxShadow: "0 0 60px rgba(236,72,153,0.35)" }}
                    />
                  )}
                </>
              ) : (
                <div className="absolute inset-0 w-full h-full flex items-center justify-center text-gray-400 bg-gray-100">
                  {i18n.posterFallback}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div >
  );
}
