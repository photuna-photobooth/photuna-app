
// src/screens/PhotoBooth/PhotoBooth.js
import React, { useState, useEffect, useRef } from "react";
import { AnimatePresence } from "framer-motion";

// Screens
import WelcomeScreen from "../PhotoBooth/WelcomeScreen";
import TemplateScreen from "../PhotoBooth/TemplateScreen";
import PaymentScreen from "../PhotoBooth/PaymentScreen";
import PhotoScreen from "../PhotoBooth/PhotoScreen";
import TemplateSelectionScreen from "../PhotoBooth/TemplateSelectionScreen";
import SelectRetakeScreen from "../PhotoBooth/SelectRetakeScreen";
import FrameFilterScreen from "../PhotoBooth/FrameFilterScreen";
import PrintPreviewScreen from "../PhotoBooth/PrintPreviewScreen";
import ThankYouScreen from "../PhotoBooth/ThankYouScreen";

/** Local defaults matching AdminDashboard */
const DEFAULT_SCREEN_TIMERS = {
  template: 10,
  payment: 20,
  retake: 8,
  photoselect: 15,
  framefilter: 12,
  printing: 30,
  thankyou: 6,
};

export default function PhotoBooth({ frames = [], onShortcut, initialEvent = null }) {
  const [screen, setScreen] = useState("WELCOME");
  const [session, setSession] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [selectedFrame, setSelectedFrame] = useState(frames[0] ?? null);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [events, setEvents] = useState([]);
  const [activeEventId, setActiveEventId] = useState(initialEvent?.id ?? "default");
  const [eventConfig, setEventConfig] = useState(initialEvent?.config ?? {}); // kept for backward compat wherever you still consume it
  const [retakeIndex, setRetakeIndex] = useState(null);
  const [retakeLimit, setRetakeLimit] = useState(2);
  const [retakenIndices, setRetakenIndices] = useState([]);
  const [templateSelection, setTemplateSelection] = useState(null);
  const selectedEvent =
    initialEvent ?? (events.find((e) => e.id === activeEventId) ?? null);

  const [composedImage, setComposedImage] = useState(null);
  const [composedImagePath, setComposedImagePath] = useState(null);
  const [composedImageUrl, setComposedImageUrl] = useState(null);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [qrImage, setQrImage] = useState(null);
  const [galleryQrUrl, setGalleryQrUrl] = useState(null);
  const [slotVideoMap, setSlotVideoMap] = useState([]);
  const cameraStreamRef = useRef(null);
  const [composedLayout, setComposedLayout] = useState(null);       // keep normalizedLayout/string if you want
  const [composedLayoutConfig, setComposedLayoutConfig] = useState(null);
  const [motionBackgroundColor, setMotionBackgroundColor] = useState("#ffffff");
  const [frameOverlayDataUrl, setFrameOverlayDataUrl] = useState(null);
  const sessionRecordedRef = useRef(false);

  async function dataUrlToBlob(dataUrl) {
    const response = await fetch(dataUrl);
    return await response.blob();
  }

  async function imagePathToBlob(imagePath) {
    const response = await fetch(imagePath);
    return await response.blob();
  }

  async function sourceToBlob(src) {
    const response = await fetch(src);
    return await response.blob();
  }

  /** NEW: global appearance for PaymentScreen theming */
  const [appearance, setAppearance] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        if (window.api?.getAppearance) {
          const a = await window.api.getAppearance();
          setAppearance(a || null);
        }
      } catch (e) {
        console.warn('[PhotoBooth] failed to load appearance:', e?.message);
      }
    })();
  }, []);

  /** Helper: derive effective settings and timers from current event */
  const deriveSettings = (ev) => {
    const s = ev?.settings ?? {};
    const timers = s.screenTimers ?? DEFAULT_SCREEN_TIMERS;
    return {
      appMode: s.appMode ?? "business",
      business: s.business ?? {},
      countdown: s.countdown ?? 3,
      numberOfShots: s.numberOfShots ?? 6,
      timers: {
        template: timers.template ?? DEFAULT_SCREEN_TIMERS.template,
        payment: timers.payment ?? DEFAULT_SCREEN_TIMERS.payment,
        retake: timers.retake ?? DEFAULT_SCREEN_TIMERS.retake,
        photoselect: timers.photoselect ?? DEFAULT_SCREEN_TIMERS.photoselect,
        framefilter: timers.framefilter ?? DEFAULT_SCREEN_TIMERS.framefilter,
        printing: timers.printing ?? DEFAULT_SCREEN_TIMERS.printing,
        thankyou: timers.thankyou ?? DEFAULT_SCREEN_TIMERS.thankyou,
      },
    };
  };

  /** Helper: should we do a Payment step? */
  const wantsPayment = (ev) => {
    const cfg = deriveSettings(ev);
    const appMode = cfg.appMode;
    const business = cfg.business || {};
    const enabled = !!business.paymentEnabled;
    const providers = business.payment?.providers || {};
    const anyProvider =
      !!providers.cash || !!providers.gcash || !!providers.paypal || !!providers.stripe;

    // Only do payment in Business mode, with payment enabled AND at least one provider toggled on
    return appMode === "business" && enabled && anyProvider;
  };

  // ---- Preview session bootstrap (server + session) ----
  async function ensurePreviewSession(templateForLayout = null) {
    if (session?.sessionId) return session;
    try {
      // Start the tiny Express preview server in main (no-op if already running)
      await window.api.previewStartServer?.();
      // Prepare a layout object from the selected template if you have one
      const layout = templateForLayout?.previewMeta?.layout
        || { width: 1200, height: 800, slots: [] };
      // Create a unique session folder + token + preview URL
      const sess = await window.api.previewCreateSession?.({ layout });
      if (sess && sess.sessionId) setSession(sess);
      return sess;
    } catch (e) {
      console.error('ensurePreviewSession failed', e);
      setSession(null);
      return null;
    }
  }

  // Unified Template Loader
  const loadFullTemplate = async (tplOrId) => {
    try {
      const id = typeof tplOrId === "string" ? tplOrId : tplOrId?.id;
      if (!id) return null;

      const all = await window.api.getTemplates();
      const found = all.find((t) => String(t.id) === String(id));
      if (!found) return null;

      return {
        ...found,
        previewMeta: {
          ...found.previewMeta,
          slots: Array.isArray(found.previewMeta?.slots)
            ? found.previewMeta.slots
            : [],
        },
      };
    } catch (err) {
      console.error("loadFullTemplate failed", err);
      return null;
    }
  };

  // Load events on mount
  useEffect(() => {
    let mounted = true;
    const loadEvents = async () => {
      try {
        if (initialEvent) {
          setEvents((prev) => {
            const found = prev.find((e) => e.id === initialEvent.id);
            if (found) return prev;
            return [initialEvent, ...prev];
          });
          setActiveEventId(initialEvent.id);
          setEventConfig(initialEvent.config ?? {});
          return;
        }
        if (window.api?.getEvents) {
          const allEvents = await window.api.getEvents();
          if (!mounted) return;
          setEvents(allEvents || []);
          if (Array.isArray(allEvents) && allEvents.length > 0) {
            const firstEvent = allEvents[0];
            setActiveEventId(firstEvent.id);
            const config = await (window.api.getEventData ? window.api.getEventData(firstEvent.id) : null);
            setEventConfig(config || {});
          }
        }
      } catch (err) {
        console.error("Failed to load events:", err);
      }
    };
    loadEvents();
    return () => { mounted = false; };
  }, [initialEvent]);

  // Sync retakeLimit from the current event settings
  useEffect(() => {
    // Prefer event's configured limit; default to 0 if missing
    const configured = Number(selectedEvent?.settings?.retakeLimit);
    setRetakeLimit(Number.isFinite(configured) ? configured : 0);
  }, [selectedEvent]);

  // Append a session record to event.sessions[] so dashboard reports are accurate.
  // completed=true when the full flow finishes; false when abandoned mid-flow.
  const recordSession = async (completed = true) => {
    if (sessionRecordedRef.current) return;
    sessionRecordedRef.current = true;
    try {
      const evId = selectedEvent?.id ?? activeEventId;
      if (!evId || !window.api?.getEvents || !window.api?.setEvents) return;

      const sessionRecord = {
        id: String(Date.now()),
        createdAt: new Date().toISOString(),
        photosCount: photos.length,
        completed,
        template: selectedTemplate?.name ?? selectedTemplate?.id ?? null,
        retakes: retakenIndices.length,
      };

      const all = await window.api.getEvents();
      if (!Array.isArray(all)) return;
      const updated = all.map((e) =>
        String(e.id) === String(evId)
          ? { ...e, sessions: [...(e.sessions ?? []), sessionRecord] }
          : e
      );
      await window.api.setEvents(updated);
    } catch (err) {
      console.warn('[PhotoBooth] recordSession failed:', err?.message);
    }
  };

  // Restart session and clear persisted retakenIndices for active event
  const restartSession = async () => {
    // If photos were taken but the session was never recorded (user abandoned), record it now
    if (!sessionRecordedRef.current && photos.length > 0) {
      await recordSession(false);
    }
    sessionRecordedRef.current = false;
    setPhotos([]);
    setSession(null);
    {
      const configured = Number(selectedEvent?.settings?.retakeLimit);
      setRetakeLimit(Number.isFinite(configured) ? configured : 0);
    }
    setRetakenIndices([]);
    setRetakeIndex(null);
    setSelectedFrame(frames[0] || null);
    setSelectedTemplate(null);
    setTemplateSelection(null);
    setComposedImage(null);
    setQrImage(null);
    setGalleryQrUrl(null);
    setScreen("WELCOME");

    try {
      const evId = selectedEvent?.id ?? activeEventId;
      if (!evId) return;
      if (window.api?.getEvents && window.api?.setEvents) {
        const all = await window.api.getEvents();
        if (!Array.isArray(all)) return;
        const updated = (all || []).map((e) => {
          if (String(e.id) === String(evId)) {
            e.retakenIndices = [];
          }
          return e;
        });
        await window.api.setEvents(updated);
        return;
      }
      if (window.electron?.getEvents && window.electron?.setEvents) {
        const all = await window.electron.getEvents();
        if (!Array.isArray(all)) return;
        const updated = (all || []).map((e) => {
          if (String(e.id) === String(evId)) {
            e.retakenIndices = [];
          }
          return e;
        });
        await window.electron.setEvents(updated);
      }
    } catch (err) {
      console.warn("Failed to clear persisted retakenIndices on restart:", err);
    }
  };

  // Keyboard shortcut
  useEffect(() => {
    const listener = (e) => {
      if (e.ctrlKey && e.key === "a") {
        onShortcut?.();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [onShortcut]);

  // Helper to normalize saved photo objects to src strings
  const normalizeSavedToSrc = (saved) => {
    if (!saved) return null;
    if (typeof saved === "string") return saved;
    if (typeof saved === "object") {
      if (saved.appUrl) return saved.appUrl;
      if (saved.fileUrl) return saved.fileUrl;
      if (saved.filePath) return `file://${saved.filePath}`;
      if (saved.dataUrl) return saved.dataUrl;
    }
    return null;
  };

  // ===== Derived, per-event, per-screen values =====
  const effective = deriveSettings(selectedEvent);
  const paymentTimer = effective.timers.payment;
  const photoCountdown = effective.countdown;         // replaces hard-coded 3
  const photoShots = effective.numberOfShots;         // replaces hard-coded 6
  const selectTimer = effective.timers.photoselect;   // replaces 40
  const filterTimer = effective.timers.framefilter;   // replaces 45
  const printingTimer = effective.timers.printing;    // replaces 30
  const thankyouTimer = effective.timers.thankyou;    // replaces 10

  return (
    <div className="w-full h-screen bg-black text-white overflow-hidden">
      <AnimatePresence mode="wait">
        {screen === "WELCOME" && (
          <WelcomeScreen
            key="welcome"
            event={selectedEvent}
            eventConfig={eventConfig}
            onNext={() => setScreen("TEMPLATE")}
          />
        )}

        {screen === "TEMPLATE" && (
          <TemplateScreen
            key="template"
            event={selectedEvent}
            eventConfig={eventConfig}
            frames={frames}
            selectedFrame={selectedFrame}
            cameraStreamRef={cameraStreamRef}
            onSelectFrame={setSelectedFrame}
            onCancel={() => setScreen("WELCOME")}
            onNext={async () => {
              // Create preview session before entering PHOTO
              await ensurePreviewSession(selectedTemplate);
              wantsPayment(selectedEvent) ? setScreen("PAYMENT") : setScreen("PHOTO");
            }}
            onSelect={async (tpl) => {
              const fullTpl = await loadFullTemplate(tpl);
              setSelectedTemplate(fullTpl);

              // Create preview session (with template layout) before PHOTO
              await ensurePreviewSession(fullTpl);
              wantsPayment(selectedEvent) ? setScreen("PAYMENT") : setScreen("PHOTO");

            }}
            onApplyTemplate={(tpl) => {
              try {
                const evId = activeEventId;
                if (evId && window.api?.getEvents) {
                  window.api
                    .getEvents()
                    .then((all) => {
                      const updated = (all || []).map((e) => {
                        if (e.id === evId) {
                          e.appliedTemplates = e.appliedTemplates || [];
                          if (!e.appliedTemplates.find((at) => at.id === tpl.id))
                            e.appliedTemplates.push(tpl);
                        }
                        return e;
                      });
                      window.api.setEvents?.(updated);
                    })
                    .catch((e) => console.warn('[PhotoBooth] setEvents failed:', e?.message));
                }
              } catch (err) {
                console.warn(err);
              }
            }}
          />
        )}

        {screen === "PAYMENT" && (
          <PaymentScreen
            key="payment"
            event={selectedEvent}
            appearance={appearance}

            onNext={async () => {
              await ensurePreviewSession(selectedTemplate);
              setScreen("PHOTO");
            }}

            onCancel={() => setScreen("WELCOME")}
            onBack={() => setScreen("TEMPLATE")}
            // amountDue is only a fallback; PaymentScreen computes total from event.settings.business
            amountDue={selectedEvent?.settings?.price ?? 150}
          />
        )}

        {screen === "PHOTO" && (
          <PhotoScreen
            key="photo"
            session={session}
            frame={selectedFrame}
            event={selectedEvent}
            eventConfig={eventConfig}
            eventId={selectedEvent?.id ?? activeEventId}
            mirrorCamera={selectedEvent?.settings?.mirrorCamera}
            cameraStreamRef={cameraStreamRef}
            templateSelection={selectedTemplate}
            onCapture={(saved) => {
              const src = normalizeSavedToSrc(saved);
              setPhotos((prev) => [...prev, src ?? saved]);
            }}
            onFinish={(allPhotos) => {
              const normalized = (allPhotos || []).map((p) => normalizeSavedToSrc(p) ?? p);
              setPhotos(normalized);
              if ((retakeLimit ?? 0) <= 0) {
                setScreen("TEMPLATE_SELECT");
              } else {
                setScreen("RETAKE");
              }
            }}
            countdownSeconds={photoCountdown}
            numberOfShots={photoShots}
            onCancel={restartSession}
          />
        )}

        {screen === "RETAKE" && (retakeLimit ?? 0) > 0 && (
          <SelectRetakeScreen
            photos={photos}
            frame={selectedFrame}
            event={selectedEvent}
            eventId={selectedEvent?.id ?? activeEventId}
            retakeLimit={retakeLimit}
            retakenIndices={retakenIndices}
            onRetake={(indices) => {
              if (!Array.isArray(indices) || indices.length === 0) return;
              if (retakeLimit >= indices.length) {
                setRetakeIndex(indices);
                setScreen("PHOTO_RETAKE");
              }
            }}
            onConfirm={(updatedPhotos) => {
              if (Array.isArray(updatedPhotos) && updatedPhotos.length > 0) {
                setPhotos(updatedPhotos.map((p) => normalizeSavedToSrc(p) ?? p));
              }
              setScreen("TEMPLATE_SELECT");
            }}
            onBack={() => setScreen("TEMPLATE_SELECT")}
          />
        )}

        {screen === "PHOTO_RETAKE" && Array.isArray(retakeIndex) && retakeIndex.length > 0 && (
          <PhotoScreen
            key="photo_retake"
            session={session}
            event={selectedEvent}
            frame={selectedFrame}
            eventId={selectedEvent?.id ?? activeEventId}
            mirrorCamera={selectedEvent?.settings?.mirrorCamera}
            cameraStreamRef={cameraStreamRef}
            templateSelection={selectedTemplate}
            retakeIndices={retakeIndex}
            countdownSeconds={photoCountdown}
            onFinish={(results) => {
              // results expected: [{ index, saved }, ...]
              setPhotos((prev) => {
                const updated = [...prev];
                (results || []).forEach((r) => {
                  const src = normalizeSavedToSrc(r?.saved) ?? r?.saved?.dataUrl ?? null;
                  if (typeof r.index === "number") updated[r.index] = src ?? updated[r.index];
                });
                return updated;
              });
              setRetakenIndices((prev) => Array.from(new Set([...(prev || []), ...retakeIndex])));

              setRetakeLimit((prev) => {
                const next = prev - retakeIndex.length;
                // After consuming remaining retakes, decide where to go
                if (next <= 0) {
                  setRetakeIndex(null);
                  setScreen("TEMPLATE_SELECT");
                } else {
                  setRetakeIndex(null);
                  setScreen("RETAKE");
                }
                return next;
              });

            }}
          />
        )}

        {screen === "TEMPLATE_SELECT" && (
          <TemplateSelectionScreen
            eventId={activeEventId}
            event={selectedEvent}
            photos={photos.map((p) => {
              if (!p) return null;
              if (typeof p === "string") return p;
              if (typeof p === "object")
                return p.fileUrl ?? (p.filePath ? `file://${p.filePath}` : p.dataUrl) ?? null;
              return null;
            })}
            numberOfShots={photoShots}
            countdownStart={selectTimer}
            frame={selectedEvent?.appliedFrame ?? selectedEvent?.frame ?? selectedFrame}
            template={selectedTemplate ?? null}
            onBack={() => setScreen("FRAME_FILTER")}
            onNext={async (payload) => {
              const fullTpl = await loadFullTemplate(payload.templateId);

              // Normalize template slot definition
              const templateSlots = Array.isArray(fullTpl?.slots)
                ? fullTpl.slots
                : Array.isArray(fullTpl?.previewMeta?.slots)
                  ? fullTpl.previewMeta.slots
                  : typeof fullTpl?.slots === "object"
                    ? Object.values(fullTpl.slots)
                    : [];

              if (!templateSlots.length) {
                console.error("NO SLOT DEFINITIONS FOUND IN TEMPLATE:", fullTpl);
                alert("This template does not contain slot definitions.");
                return;
              }

              // Build a lookup by slotId from payload
              const userById = new Map((payload.slots || []).map((s) => [String(s.slotId), s]));

              const mergedSlots = templateSlots.map((slotDef, i) => {
                const defId = String(slotDef.slotId || slotDef.id || i);
                const user = userById.get(defId) || payload.slots?.[i] || {};

                return {
                  // Keep BOTH id and slotId for compatibility with different screens
                  id: slotDef.id ?? defId,
                  slotId: defId,

                  // Layout fields (MUST include rotation)
                  x: slotDef.x ?? 0,
                  y: slotDef.y ?? 0,
                  w: slotDef.w ?? 0.25,
                  h: slotDef.h ?? 0.25,
                  rotation: slotDef.rotation ?? 0,
                  slotNumber: slotDef.slotNumber ?? i + 1,

                  // Selection fields
                  photoIndex: user.photoIndex ?? null,
                  photoUrl: user.photoUrl ?? null,   // ✅ carry the absolute URL forward
                  transform: user.transform ?? { scale: 1, offsetX: 0, offsetY: 0 },
                };
              });

              setTemplateSelection({
                templateId: payload.templateId,
                layout: payload.layout,                // keep for compatibility
                slots: mergedSlots,
                // ✅ include what Frame Filter needs
                previewMeta: {
                  ...(fullTpl?.previewMeta ?? {}),
                },
              });

              setScreen("FRAME_FILTER");
            }}
          />
        )}

        {screen === "FRAME_FILTER" && (
          <FrameFilterScreen
            key="framefilter"
            eventId={activeEventId}
            event={selectedEvent}
            sessionId={session?.sessionId || activeSessionId || "default"}
            countdownStart={filterTimer}
            templateSelection={templateSelection}
            photos={photos.map((p) => {
              if (!p) return null;
              if (typeof p === "string") return p;
              if (typeof p === "object") {
                return p.fileUrl ?? (p.filePath ? `file://${p.filePath}` : p.dataUrl) ?? null;
              }
              return null;
            })}
            onNext={async (payload) => {
              if (payload?.composedImage) setComposedImage(payload.composedImage);
              if (payload?.composedImagePath) setComposedImagePath(payload.composedImagePath);
              if (payload?.composedImageUrl) setComposedImageUrl(payload.composedImageUrl);
              if (payload?.sessionId) setActiveSessionId(payload.sessionId);
              if (payload?.qrImage) setQrImage(payload.qrImage);

              if (payload?.layout) setComposedLayout(payload.layout);
              if (payload?.layoutConfig) setComposedLayoutConfig(payload.layoutConfig);
              if (Array.isArray(payload?.slotVideoMap)) setSlotVideoMap(payload.slotVideoMap);

              if (payload?.motionBackgroundColor) {
                setMotionBackgroundColor(payload.motionBackgroundColor);
              }
              setFrameOverlayDataUrl(payload?.frameOverlayDataUrl || null);

              setGalleryQrUrl(null);
              setScreen("PRINT");
            }}
            onCancel={() => setScreen("TEMPLATE_SELECT")}
          />
        )}

        {screen === "PRINT" && (
          <PrintPreviewScreen
            seconds={deriveSettings(selectedEvent).timers.printing}
            qrImage={qrImage}
            qrUrl={galleryQrUrl}
            composedImage={composedImage}
            composedImagePath={composedImagePath}
            composedImageUrl={composedImageUrl}
            sessionId={activeSessionId || session?.sessionId || "default"}
            eventId={activeEventId || "default"}
            event={selectedEvent}
            layout={composedLayout}                // normalizedLayout string
            layoutConfig={composedLayoutConfig}    // NEW full object with slots
            photos={photos
              .map((p) => {
                if (!p) return null;
                if (typeof p === "string") return p;
                if (typeof p === "object") {
                  return p.fileUrl ?? (p.filePath ? `file://${p.filePath}` : p.dataUrl) ?? null;
                }
                return null;
              })
              .filter(Boolean)}
            slotVideoMap={slotVideoMap}
            frameOverlayDataUrl={frameOverlayDataUrl}
            motionBackgroundColor={motionBackgroundColor}
            onPrintComplete={() => { }}
            onNextPage={() => { recordSession(true); setScreen("THANK_YOU"); }}
          />
        )}

        {screen === "THANK_YOU" && (
          <ThankYouScreen
            eventId={activeEventId}
            event={selectedEvent}
            countdownStart={thankyouTimer}
            onRestart={restartSession}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
