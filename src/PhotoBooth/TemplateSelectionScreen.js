
// src/components/TemplateSelectionScreen.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { normalizeToFileUrl } from "../utils/mediaUrl";
import { loadGoogleFont } from "../utils/fontLoader";

/* ---------------------------- Helpers ---------------------------- */
/** Parse capture filename meta: capture_<index>-of-<total>_<timestamp>.jpg */
function parseCaptureMeta(url) {
  const m = String(url).match(/capture_(\d+)-of-(\d+)_([0-9]+)\.(jpg|jpeg|png|webp)$/i);
  return m ? { url, index: +m[1], total: +m[2], timestamp: +m[3] } : null;
}

/* Simple i18n for this screen */
const STRINGS = {
  en: {
    by: "by",
    brandDefaultName: "Studio Photuna",
    brandDefaultSlogan: "Ahead of the moment.",
    instructions1:
      "Select photos on the left. The first selection fills the first slot, and so on.",
    instructions2:
      "When the countdown reaches zero, any unfilled slots will be automatically assigned random photos from your selections.",
    photosCount: "Photos",
    back: "Back",
    next: "Next →",
    slotLabel: (n) => `Slot ${n}`,
    slotBadge: (n) => `#${n}`,
    secondsSuffix: "s",
  },
  Tagalog: {
    by: "gawa ng",
    brandDefaultName: "Studio Photuna",
    brandDefaultSlogan: "Mas nauna sa sandali.",
    instructions1:
      "Pumili ng mga larawan sa kaliwa. Ang unang pili ay mapupunta sa unang puwesto, at iba pa.",
    instructions2:
      "Kapag umabot sa zero ang countdown, ang mga bakanteng puwesto ay awtomatikong mapupunan ng mga larawang napili.",
    photosCount: "Mga Larawan",
    back: "Bumalik",
    next: "Susunod →",
    slotLabel: (n) => `Puwesto ${n}`,
    slotBadge: (n) => `#${n}`,
    secondsSuffix: "seg",
  },
};

const resolveStrings = (code) => {
  const k = String(code ?? 'en').toLowerCase();
  return (k === "tl" || k === "tagalog" || k === "fil" || k === "filipino")
    ? STRINGS.tl
    : STRINGS.en;
};

/* ---------------------- Main selection screen --------------------- */
export default function TemplateSelectionScreen({
  eventId = "default",
  countdownStart = 40, // fallback if no event timer
  numberOfShots = 1,   // fallback if no event setting
  photos: photosProp,  // optional: pass session photos
  template: templateProp, // IMPORTANT: pass selectedTemplate with saved slots
  onNext,
  onCancel,
}) {
  // Appearance + Settings from AdminDashboard
  const [appearance, setAppearance] = useState({
    boothName: "",
    boothSlogan: "",
    logoPath: null,
    headerFont: "Inter",
    generalFont: "Inter",
    buttonFont: "Interphases",
    headerFontColor: "#111827",
    generalFontColor: "#374151",
    bgColor: "#ffffff",
    buttonBgColor: "#2563eb",
    buttonHoverColor: "#1e40af",
    buttonFontColor: "#ffffff",
  });
  const [settings, setSettings] = useState(null);

  // Effective screen strings based on language
  const T = resolveStrings(settings?.language ?? "en");

  // Effective timers & shots

  const effectiveCountdownStart =
    settings?.screenTimers?.photoselect ??
    settings?.screenTimers?.templateselection ?? // legacy/old builds
    countdownStart;

  const effectiveNumberOfShots = settings?.numberOfShots ?? numberOfShots;

  const [timeLeft, setTimeLeft] = useState(effectiveCountdownStart);
  const [photos, setPhotos] = useState([]);
  const [selectedIndices, setSelectedIndices] = useState([]);
  const hasAutoAdvancedRef = useRef(false);

  // Normalize slots from previewMeta if slots is missing or is just a count
  const normalizedSlots = useMemo(() => {
    if (Array.isArray(templateProp?.slots) && templateProp.slots.length > 0) {
      // Already an array of slot objects
      return templateProp.slots;
    }
    // AdminDashboard saved slots live under previewMeta.slots
    return Array.isArray(templateProp?.previewMeta?.slots)
      ? templateProp.previewMeta.slots
      : [];
  }, [templateProp]);

  // NEW: read layout ("4x6","2x6","6x4","6x2") from previewMeta or fall back to 4x6
  const normalizedLayout = useMemo(() => {
    const raw = templateProp?.previewMeta?.layout ?? templateProp?.layout ?? "4x6";
    const key = String(raw).toLowerCase();
    return ["4x6", "2x6", "6x4", "6x2"].includes(key) ? key : "4x6";
  }, [templateProp]);

  const [template, setTemplate] = useState(() => ({
    id: templateProp?.id ?? "",
    name: templateProp?.name ?? "",
    slots: normalizedSlots,
    layout: normalizedLayout, // ✅ ADD THIS
  }));

  const totalSlots = Array.isArray(template.slots) ? template.slots.length : 0;

  /* ---------------- Load template ---------------- */
  useEffect(() => {
    if (templateProp) {
      setTemplate({
        id: templateProp.id ?? "",
        name: templateProp.name ?? "",
        slots: normalizedSlots,
        layout: normalizedLayout, // ✅ ADD THIS
      });
      return;
    }

    (async () => {
      try {
        const t = await window.electron.getActiveTemplate(eventId);
        const slotsFromPreview = Array.isArray(t?.previewMeta?.slots)
          ? t.previewMeta.slots
          : [];
        setTemplate({
          id: t?.id ?? "",
          name: t?.name ?? "",
          slots: slotsFromPreview,
        });
      } catch (err) {
        console.error("Failed to load template:", err);
        setTemplate({ id: "", name: "", slots: [], layout: "4x6" });
      }
    })();
  }, [eventId, templateProp, normalizedSlots, normalizedLayout]);

  /* ---------------- Load appearance + settings from AdminDashboard ---------------- */
  useEffect(() => {
    (async () => {
      try {
        // Prefer event-scoped values; fall back to global if eventId not supported
        const [app, sett] = await Promise.all([
          window.electron?.getAppearance?.(eventId) ??
          window.electron?.getAppearance?.(),
          window.electron?.getSettings?.(eventId) ??
          window.electron?.getSettings?.(),
        ]);

        if (app) {
          const nextApp = {
            boothName: app.boothName ?? appearance.boothName,
            boothSlogan: app.boothSlogan ?? appearance.boothSlogan,
            logoPath: app.logoPath ?? null,
            headerFont: app.headerFont ?? appearance.headerFont,
            generalFont: app.generalFont ?? appearance.generalFont,
            buttonFont: app.buttonFont ?? appearance.buttonFont,
            headerFontColor: app.headerFontColor ?? appearance.headerFontColor,
            generalFontColor: app.generalFontColor ?? appearance.generalFontColor,
            bgColor: app.bgColor ?? appearance.bgColor,
            buttonBgColor: app.buttonBgColor ?? appearance.buttonBgColor,
            buttonHoverColor: app.buttonHoverColor ?? appearance.buttonHoverColor,
            buttonFontColor: app.buttonFontColor ?? appearance.buttonFontColor,
          };
          setAppearance(nextApp);
          // Load fonts the same way AdminDashboard does
          loadGoogleFont(nextApp.headerFont);
          loadGoogleFont(nextApp.generalFont);
          loadGoogleFont(nextApp.buttonFont);
        }

        if (sett) {
          setSettings(sett);
          // Reset countdown to effective source
          const nextCountdown =
            sett?.screenTimers?.templateselection ?? countdownStart;
          setTimeLeft(nextCountdown);
        }
      } catch (err) {
        console.warn("Failed to load appearance/settings:", err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  /* ---------------- Load photos: prop first, else latest session ---------------- */
  useEffect(() => {
    (async () => {
      try {
        const shots = effectiveNumberOfShots;
        if (Array.isArray(photosProp) && photosProp.length > 0) {
          setPhotos(photosProp.map(normalizeToFileUrl).slice(0, shots));
          return;
        }
        const imgs = await window.electron.getCapturedPhotos(eventId);
        const normalized = (imgs || []).map(normalizeToFileUrl);

        const parsed = normalized.map(parseCaptureMeta).filter(Boolean);

        if (parsed.length > 0) {
          parsed.sort((a, b) => b.timestamp - a.timestamp);
          const latestBatch = parsed.slice(0, shots).map((p) => p.url);
          setPhotos(latestBatch);
        } else {
          // fallback if filenames do not match expected pattern
          setPhotos(normalized.slice(-shots));
        }
      } catch (err) {
        console.error("Failed to load photos:", err);
        setPhotos([]);
      }
    })();
  }, [eventId, effectiveNumberOfShots, photosProp]);

  /* ---------------- Countdown ---------------- */
  useEffect(() => {
    if (timeLeft <= 0) return;
    const id = setInterval(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearInterval(id);
  }, [timeLeft]);

  /* ---------------- Selection logic ---------------- */
  const toggleSelection = (index) => {
    setSelectedIndices((prev) => {
      if (prev.includes(index)) return prev.filter((i) => i !== index);
      if (prev.length >= totalSlots) return prev;
      return [...prev, index];
    });
  };

  const slotAssignments = useMemo(() => {
    const map = {};
    (template.slots || []).forEach((slot, i) => {
      map[slot.id] = selectedIndices[i] ?? null;
    });
    return map;
  }, [template.slots, selectedIndices]);

  /* ---------------- Save selection ---------------- */
  const onSave = async () => {
    if (hasAutoAdvancedRef.current) return;
    hasAutoAdvancedRef.current = true;

    const payload = {
      eventId,
      templateId: template.id,
      layout: template.layout,
      slots: (template.slots || []).map((slot) => {
        const idx = slotAssignments[slot.id];
        const url = Number.isFinite(idx) ? photos[idx] ?? null : null;
        return {
          slotId: slot.id,
          slotNumber: slot.slotNumber,
          photoIndex: idx,       // keep for backward compatibility
          photoUrl: url,         // NEW: absolute identity of the selected image
        };
      }),

      // Optional: include language/mode for downstream screens if needed
      language: settings?.language ?? "en",
      appMode: settings?.appMode ?? "rental",
    };
    try {
      await window.electron.saveTemplateSelection(payload);
    } catch (err) {
      console.error("Failed to save template selection:", err);
    }
    onNext?.(payload);
  };

  /* ---------------- Auto-fill + auto-advance ---------------- */
  useEffect(() => {
    if (timeLeft !== 0) return;
    if (selectedIndices.length >= totalSlots) return;

    const remaining = Math.max(0, totalSlots - selectedIndices.length);
    const available = photos.map((_, i) => i).filter((i) => !selectedIndices.includes(i));
    const shuffled = [...available].sort(() => Math.random() - 0.5);
    const autoFill = shuffled.slice(0, remaining);

    setSelectedIndices((prev) => [...prev, ...autoFill]);
  }, [timeLeft, totalSlots, photos, selectedIndices]);

  // Reset selections when a new session starts
  useEffect(() => {
    setSelectedIndices([]);
    hasAutoAdvancedRef.current = false;
    // Reset countdown from settings when props change
    setTimeLeft(effectiveCountdownStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, photosProp, templateProp, effectiveCountdownStart]);

  useEffect(() => {
    if (timeLeft !== 0) return;
    if (hasAutoAdvancedRef.current) return;
    if (selectedIndices.length >= totalSlots && totalSlots > 0) {
      onSave();
    }
  }, [timeLeft, selectedIndices, totalSlots]);

  /* ---------------- Circular countdown ring ---------------- */
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const progress = (timeLeft / effectiveCountdownStart) * circumference;

  /* ---------------- Derived styles ---------------- */
  const brandName = appearance.boothName || T.brandDefaultName;
  const brandSlogan = appearance.boothSlogan || T.brandDefaultSlogan;
  const brandColor = appearance.headerFontColor || "#111827";
  const bodyColor = appearance.generalFontColor || "#374151";
  const primaryColor = appearance.buttonBgColor || "#ec4899"; // pink fallback
  const uiFont = appearance.generalFont || "Inter";
  const headerFont = appearance.headerFont || "Inter";
  const buttonFont = appearance.buttonFont || "Interphases";
  const logoPath = appearance.logoPath || null;
  const buttonFontColor = appearance.buttonFontColor || "#000000";
  const buttonHoverColor = appearance.buttonHoverColor || "gray";


  /* ---------------- Render ---------------- */
  return (
    <div
      className="w-full h-screen text-black overflow-hidden grid grid-cols-[.8fr_.8fr] py-[50px]"
      style={{ backgroundColor: appearance.bgColor || "#ffffff", color: bodyColor, fontFamily: uiFont }}
    >

      {/* Header */}
      <div className="absolute top-6 left-6 z-20">
        {logoPath ? (
          <img src={logoPath} alt="logo" className="max-w-[300px] sm:max-w-[300px] md:max-w-[400px]" />
        ) : (
          <>
            <h1 className="text-5xl font-bold" style={{ fontFamily: headerFont, color: brandColor }}>
              {brandName}
            </h1>
            {brandSlogan && (
              <p className="text-lg" style={{ color: bodyColor }}>
                {brandSlogan}
              </p>
            )}
          </>
        )}
      </div>

      <div className="absolute top-6 left-1/2 transform -translate-x-1/2 z-30">
        <div
          className="px-8 py-3 rounded-full text-2xl font-bold shadow-sm"
          style={{
            fontFamily: uiFont,
            backgroundColor: primaryColor,
            color: buttonFontColor,
          }}
          aria-live="polite"
        >
          {Math.max(0, timeLeft)}s
        </div>
      </div>

      {/* LEFT: photos */}
      <div className="col-span-1 overflow-y-auto pt-32 px-20 light-scroll">
        <div className="grid grid-cols-2 gap-4">
      
          {photos.map((src, i) => {
            const selected = selectedIndices.includes(i);
            const order = selected ? selectedIndices.indexOf(i) + 1 : null;
            return (
              <button
                key={i}
                onClick={() => toggleSelection(i)}
                className={`relative overflow-hidden rounded-xl shadow-md border-2 transition-transform active:scale-95 ${selected ? "border-black" : "border-gray-200"
                  }`}
                style={{ fontFamily: uiFont }}
              >
                <img src={src} alt={`Photo ${i + 1}`} className="w-full h-auto object-cover" />
                {selected && (
                  <div className="absolute top-2 left-2">
                    <span
                      className="text-white text-xs font-bold px-2 py-1 rounded-md"
                      style={{ backgroundColor: primaryColor, fontFamily: buttonFont }}
                    >
                      {order}
                    </span>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between mt-6">
          <span
            className="flex items-center gap-2 px-10 py-4 rounded-full text-2xl font-bold shadow-lg"
            style={{ backgroundColor: primaryColor, color: "#fff", fontFamily: buttonFont }}
          >
            {T.photosCount} {selectedIndices.length}/{totalSlots}
          </span>
          <div className="flex items-center gap-3">
            {onCancel && (
              <button
                onClick={onCancel}
                className="px-5 py-2 rounded-full text-lg font-semibold bg-gray-200 hover:bg-gray-300 transition"
                style={{ fontFamily: uiFont }}
              >
                {T.back}
              </button>
            )}
            <button
              onClick={onSave}
              disabled={selectedIndices.length < totalSlots || selectedIndices.length === 0}
              className={`flex items-center gap-2 px-10 py-4 rounded-full text-2xl font-bold shadow-lg transition
    ${selectedIndices.length >= totalSlots && totalSlots > 0
                  ? "cursor-pointer"
                  : "bg-gray-300 text-gray-500 cursor-not-allowed"
                }
  `}
              style={{
                fontFamily: buttonFont,
                backgroundColor:
                  selectedIndices.length >= totalSlots && totalSlots > 0
                    ? primaryColor
                    : undefined,
                color:
                  selectedIndices.length >= totalSlots && totalSlots > 0
                    ? buttonFontColor
                    : undefined,
              }}
              onMouseEnter={(e) => {
                if (selectedIndices.length >= totalSlots && totalSlots > 0) {
                  e.currentTarget.style.backgroundColor = buttonHoverColor;
                  e.currentTarget.style.color = buttonFontColor;
                }
              }}
              onMouseLeave={(e) => {
                if (selectedIndices.length >= totalSlots && totalSlots > 0) {
                  e.currentTarget.style.backgroundColor = primaryColor;
                  e.currentTarget.style.color = buttonFontColor;
                }
              }}
            >
              {T.next}
            </button>

          </div>
        </div>
      </div>

      {/* RIGHT: template preview (absolute layout from AdminDashboard slots) */}
      <div className="col-span-1 h-full pt-32 p-20">

        {(() => {
          const layoutKey = normalizedLayout; // "4x6" | "2x6" | "6x4" | "6x2"

          // Aspect ratio classes per layout
          const aspectMap = {
            "4x6": "aspect-[4/6]",
            "2x6": "aspect-[2/6]",
            "6x4": "aspect-[6/4]",
            "6x2": "aspect-[6/2]",
          };
          const aspectClass = aspectMap[layoutKey] ?? aspectMap["4x6"];

          // Strip types duplicate: 2x6 (side-by-side) and 6x2 (stacked one above the other)
          const isStrip = layoutKey === "2x6" || layoutKey === "6x2";
          const isTall = layoutKey === "4x6" || layoutKey === "2x6";

          // Width constraints per layout to keep a sensible preview size
          const boxClass = (() => {
            switch (layoutKey) {
              case "2x6": // tall strip
                return "w-full max-w-[230px]";
              case "6x2": // wide strip
                return "w-full max-w-[720px]";
              case "6x4": // landscape postcard
                return "w-full max-w-[720px]";
              default: // 4x6 portrait postcard
                return "w-full max-w-[460px]";
            }
          })();

          // One function that renders the WYSIWYG canvas using normalized slots
          const Canvas = (
            <div className="relative w-full h-full">
              {template.slots.map((slot) => {
                const photoIndex = slotAssignments[slot.id];
                const src = Number.isFinite(photoIndex) ? photos[photoIndex] : null;
                return (
                  <div
                    key={slot.id}
                    className="absolute border border-white/30 overflow-hidden"
                    style={{
                      left: `${slot.x * 100}%`,
                      top: `${slot.y * 100}%`,
                      width: `${slot.w * 100}%`,
                      height: `${slot.h * 100}%`,
                      transform: `rotate(${slot.rotation || 0}deg)`,
                      transformOrigin: "center",
                    }}
                  >
                    {src ? (
                      <img src={src} className="w-full h-full object-cover" alt="" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs text-gray-300">
                        {T.slotLabel(slot.slotNumber)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );

          // Non-strip layouts: single preview box (4x6, 6x4)
          if (!isStrip) {
            return (
              <div className="flex items-center justify-center gap-6">
                <div className={`bg-black shadow-sm ${aspectClass} ${boxClass} relative`}>
                  {Canvas}
                </div>
              </div>
            );
          }

          // Strip layouts duplicate:
          // - 2x6 (tall): side-by-side
          // - 6x2 (wide): stacked vertically
          if (layoutKey === "2x6") {
            return (
              <div className="flex items-start justify-center gap-6">
                <div className={`bg-black shadow-sm ${aspectClass} ${boxClass} relative`}>{Canvas}</div>
                <div className={`bg-black shadow-sm ${aspectClass} ${boxClass} relative`}>{Canvas}</div>
              </div>
            );
          }

          // 6x2: stack one above the other for a natural landscape two-up
          return (
            <div className="flex flex-col items-center justify-start gap-6">
              <div className={`bg-black shadow-sm ${aspectClass} ${boxClass} relative`}>{Canvas}</div>
              <div className={`bg-black shadow-sm ${aspectClass} ${boxClass} relative`}>{Canvas}</div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}