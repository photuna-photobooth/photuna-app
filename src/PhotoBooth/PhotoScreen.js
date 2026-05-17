
// src/PhotoBooth/PhotoScreen.jsx
import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { DEFAULT_APPEARANCE } from "../utils/appearance";


function normalizeTemplateGuide(templateSelection) {
  const slots =
    Array.isArray(templateSelection?.slots) && templateSelection.slots.length
      ? templateSelection.slots
      : Array.isArray(templateSelection?.previewMeta?.slots)
        ? templateSelection.previewMeta.slots
        : [];

  const layout =
    templateSelection?.previewMeta?.layout ??
    templateSelection?.layout ??
    "4x6";

  return { slots, layout };
}

function getLayoutAspectNumber(layout) {
  switch (String(layout || "").toLowerCase()) {
    case "6x4":
      return 6 / 4;
    case "2x6":
      return 2 / 6;
    case "6x2":
      return 6 / 2;
    case "4x6":
    default:
      return 4 / 6;
  }
}

function getSlotBounds(slots = []) {
  if (!Array.isArray(slots) || !slots.length) {
    return { minX: 0, minY: 0, maxX: 1, maxY: 1, width: 1, height: 1 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  slots.forEach((slot) => {
    const x = Number(slot?.x ?? 0);
    const y = Number(slot?.y ?? 0);
    const w = Number(slot?.w ?? 0.2);
    const h = Number(slot?.h ?? 0.2);

    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  });

  const width = Math.max(0.0001, maxX - minX);
  const height = Math.max(0.0001, maxY - minY);

  return { minX, minY, maxX, maxY, width, height };
}

function getGuideAspectFromSlotsOrLayout(guide, slotIndex = 0) {
  const slots = Array.isArray(guide?.slots) ? guide.slots : [];

  if (slots.length > 0) {
    const safeIndex = Math.max(0, Math.min(slotIndex, slots.length - 1));
    const slot = slots[safeIndex];

    let slotW = Number(slot?.w);
    let slotH = Number(slot?.h);
    const rotation = Math.abs(Number(slot?.rotation || 0)) % 180;

    if (rotation === 90) {
      [slotW, slotH] = [slotH, slotW];
    }

    if (Number.isFinite(slotW) && Number.isFinite(slotH) && slotW > 0 && slotH > 0) {
      return slotW / slotH;
    }
  }

  return getLayoutAspectNumber(guide?.layout);
}

export default function PhotoScreen({
  event = null,
  templateSelection = null,
  eventId = "default",
  countdownSeconds = 5,
  numberOfShots = 6,
  frame = null,
  retakeIndices = null,
  onCapture = () => { },
  onFinish = () => { },
  onCancel = () => { },
  mirrorCamera,
  session, // { sessionId, token, previewUrl }
  cameraStreamRef = null,
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const activeRecorderRef = useRef(null);
  const activeChunksRef = useRef([]);
  const activeSlotIndexRef = useRef(null);

  const previewWrapRef = useRef(null);
  const [previewRect, setPreviewRect] = useState({ width: 0, height: 0 });

  const [timer, setTimer] = useState(countdownSeconds);
  const [photosTaken, setPhotosTaken] = useState(0);
  const currentShotIndex = photosTaken;
  const [isFlashing, setIsFlashing] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState(null);

  const guide = normalizeTemplateGuide(templateSelection);

  const pendingClipPromisesRef = useRef([]);
  const currentClipPromiseRef = useRef(null);

  const activeGuideIndex = retakeIndices
    ? retakeIndices[photosTaken] ?? 0
    : photosTaken;

  const guideAspect = getGuideAspectFromSlotsOrLayout(guide, activeGuideIndex);

  const activeSlot =
    Array.isArray(guide.slots) && guide.slots.length
      ? guide.slots[Math.max(0, Math.min(activeGuideIndex, guide.slots.length - 1))]
      : null;

  const showSlotGuide = event?.settings?.showSlotGuide ?? true;
  const guideOpacity = event?.settings?.guideOpacity ?? 0.95;
  const guideColor = event?.settings?.guideColor ?? "#ffffff";
  const guideMaskOpacity = event?.settings?.guideMaskOpacity ?? 0.22;

  const capturesRef = useRef([]);

  const effectiveMirrorCamera =
    typeof mirrorCamera === "boolean"
      ? mirrorCamera
      : !!event?.settings?.mirrorCamera;

  const sessionIdRef = useRef(session?.sessionId || null);
  useEffect(() => { sessionIdRef.current = session?.sessionId || null; }, [session]);

  const initCamera = React.useCallback(async () => {
    try {
      const desiredWidth = event?.config?.cameraWidth ?? event?.settings?.cameraWidth ?? 1920;
      const desiredHeight = event?.config?.cameraHeight ?? event?.settings?.cameraHeight ?? 1080;
      const facingMode = event?.config?.facingMode ?? event?.settings?.facingMode ?? "user";
      const deviceId = event?.settings?.selectedCameraId;
      let stream = cameraStreamRef?.current ?? window.__cameraStream;

      // If a specific device is required, verify the preloaded stream is on that device
      if (stream && deviceId) {
        const activeDeviceId = stream.getVideoTracks()[0]?.getSettings?.()?.deviceId;
        if (activeDeviceId && activeDeviceId !== deviceId) {
          stream.getTracks().forEach((t) => t.stop());
          stream = null;
          if (cameraStreamRef) cameraStreamRef.current = null;
          window.__cameraStream = null;
        }
      }

      if (!stream) {
        const videoConstraints = deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: desiredWidth }, height: { ideal: desiredHeight } }
          : { width: { ideal: desiredWidth, max: desiredWidth }, height: { ideal: desiredHeight, max: desiredHeight }, facingMode };

        stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });

        if (cameraStreamRef) cameraStreamRef.current = stream;
        window.__cameraStream = stream;
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => { });
      }
      setCameraReady(true);
      setCameraError(null);
    } catch (err) {
      setCameraError(err?.message ?? "camera_unavailable");
      setCameraReady(false);
    }
  }, [event]);

  useEffect(() => {
    let mounted = true;

    const start = async () => {
      try {
        await initCamera();
      } catch (e) {
        console.error("initCamera failed:", e);
      }
    };

    start();

    return () => {
      mounted = false;
      try {
        streamRef.current?.getTracks?.().forEach((t) => t.stop());
        streamRef.current = null;
        if (cameraStreamRef) cameraStreamRef.current = null;
        window.__cameraStream = null;
      } catch { }
    };
  }, [initCamera, eventId]);

  /* ------------------------------------------------------------------ */
  /* Resolve appearance & settings                                      */
  /* ------------------------------------------------------------------ */
  const appearance = {
    ...DEFAULT_APPEARANCE,
    ...(event?.appearance || {}),
  };

  const {
    boothName,
    tagline,
    headerFont,
    generalFont,
    headerFontColor,
    generalFontColor,
    bgColor,
    logoPath,
    backgroundMediaPath,
    buttonBgColor,
    buttonHoverColor,
    buttonFont,
    buttonFontColor,
  } = appearance;

  // Settings (AdminDashboard)
  const flashEnabled = event?.settings?.flashEnabled ?? true;
  const soundEnabled = event?.settings?.soundEnabled ?? true;
  const language = event?.settings?.language ?? "en";

  function getFittedBox(containerW, containerH, targetAspect) {
    const containerAspect = containerW / containerH;

    if (containerAspect > targetAspect) {
      const height = containerH;
      const width = height * targetAspect;
      return {
        width,
        height,
        left: (containerW - width) / 2,
        top: 0,
      };
    }

    const width = containerW;
    const height = width / targetAspect;
    return {
      width,
      height,
      left: 0,
      top: (containerH - height) / 2,
    };
  }

  useEffect(() => {
    const updatePreviewRect = () => {
      const el = previewWrapRef.current;
      if (!el) return;
      setPreviewRect({
        width: el.clientWidth,
        height: el.clientHeight,
      });
    };

    updatePreviewRect();
    window.addEventListener("resize", updatePreviewRect);

    const ro = new ResizeObserver(updatePreviewRect);
    if (previewWrapRef.current) ro.observe(previewWrapRef.current);

    return () => {
      window.removeEventListener("resize", updatePreviewRect);
      ro.disconnect();
    };
  }, []);

  const isTagalog =
    String(language).toLowerCase() === "tagalog" ||
    String(language).toLowerCase() === "tl" ||
    String(language).toLowerCase() === "filipino";

  const t = {
    counter: isTagalog ? "Kunan" : "Shots",
    cameraError: isTagalog
      ? "Hindi ma-access ang camera. Pakisuri ang permiso at koneksyon."
      : "Unable to access camera. Please check permissions and connection.",
    retry: isTagalog ? "Subukan muli" : "Try Again",
    back: isTagalog ? "← Balik" : "← Back",
  };

  const FINAL_MOTION_CAPTURE_SECONDS = 5;

  // Prefer per-event countdown; for retake, keep retakeIndices.length
  const cfgCountdown = event?.settings?.countdown ?? countdownSeconds;

  // If retake, shots equal to retakeIndices length, otherwise normal
  const cfgShots = retakeIndices
    ? retakeIndices.length
    : event?.settings?.numberOfShots ?? numberOfShots;



  /* ------------------------------------------------------------------ */
  /* Countdown logic                                                    */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    if (!cameraReady || isCapturing || photosTaken >= cfgShots) return;

    if (timer <= 0) {
      capturePhoto();
      return;
    }

    const id = setInterval(() => {
      setTimer((t) => (t > 0 ? t - 1 : 0));
    }, 1000);

    return () => clearInterval(id);
  }, [timer, cameraReady, isCapturing, photosTaken, cfgShots]);

  useEffect(() => {
    if (!cameraReady || isCapturing) return;
    if (photosTaken >= cfgShots) return;
    if (timer > FINAL_MOTION_CAPTURE_SECONDS) return;

    // prevent duplicate recorder
    if (activeRecorderRef.current) return;

    const targetIndex = retakeIndices ? retakeIndices[photosTaken] : null;
    const slotIdx = targetIndex ?? photosTaken;

    startPreShotRecording(slotIdx, sessionIdRef.current);
  }, [timer, cameraReady, isCapturing, photosTaken, cfgShots, retakeIndices]);

  /* ------------------------------------------------------------------ */
  /* Capture helpers                                                    */
  /* ------------------------------------------------------------------ */
  const triggerFlash = () =>
    new Promise((res) => {
      if (!flashEnabled) return res(); // skip visual flash
      setIsFlashing(true);
      setTimeout(() => {
        setIsFlashing(false);
        res();
      }, 180);
    });

  const playShutter = () => {
    if (!soundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.13);
      osc.onended = () => ctx.close().catch(() => {});
    } catch { }
  };

  const captureFrame = async (targetIndex = null) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;

    const sourceW = video.videoWidth || 1920;
    const sourceH = video.videoHeight || 1080;

    // ✅ Capture the full camera frame only
    canvas.width = sourceW;
    canvas.height = sourceH;

    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (effectiveMirrorCamera) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }

    ctx.drawImage(video, 0, 0, sourceW, sourceH, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);

    return {
      dataUrl,
      index: targetIndex ?? photosTaken,
      width: sourceW,
      height: sourceH,
    };
  };

  const startPreShotRecording = (slotIndex, sessionId) => {
    try {
      const stream = streamRef.current;
      if (!stream || !sessionId) return;

      if (activeRecorderRef.current) return; // prevent duplicate

      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
          ? "video/webm;codecs=vp8"
          : "video/webm";

      activeChunksRef.current = [];
      activeSlotIndexRef.current = slotIndex;

      const rec = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 5_000_000,
      });

      rec.ondataavailable = (e) => {
        if (e.data?.size) activeChunksRef.current.push(e.data);
      };

      activeRecorderRef.current = { rec, sessionId, slotIndex };

      rec.start(250); // collect chunks every 250ms
    } catch (err) {
      console.error("[startPreShotRecording] failed:", err);
    }
  };

  const stopPreShotRecording = () => {
    const active = activeRecorderRef.current;
    if (!active) return Promise.resolve({ ok: false, reason: "no_active_recorder" });

    return new Promise((resolve) => {
      const { rec, sessionId, slotIndex } = active;

      rec.onstop = async () => {
        try {
          const mimeType =
            rec.mimeType ||
            (activeChunksRef.current?.[0]?.type || "video/webm");

          const blob = new Blob(activeChunksRef.current, { type: mimeType });

          if (!blob.size) {
            activeRecorderRef.current = null;
            activeChunksRef.current = [];
            return resolve({ ok: false, reason: "empty_blob" });
          }

          const ab = await blob.arrayBuffer();

          const res = await window.api.previewSaveSlotClip(
            sessionId,
            slotIndex,
            new Uint8Array(ab),
            { eventId }
          );

          activeRecorderRef.current = null;
          activeChunksRef.current = [];

          resolve(res?.ok ? { ok: true } : { ok: false, reason: res?.error || "save_failed" });
        } catch (err) {
          console.error("[stopPreShotRecording] failed:", err);
          activeRecorderRef.current = null;
          activeChunksRef.current = [];
          resolve({ ok: false, reason: err?.message || "stop_failed" });
        }
      };

      try {
        if (rec.state === "recording") {
          rec.requestData();
          setTimeout(() => {
            try {
              if (rec.state !== "inactive") rec.stop();
              else resolve({ ok: false, reason: "already_inactive" });
            } catch (err) {
              resolve({ ok: false, reason: err?.message || "stop_failed" });
            }
          }, 60);
        } else {
          activeRecorderRef.current = null;
          activeChunksRef.current = [];
          resolve({ ok: false, reason: "not_recording" });
        }
      } catch (err) {
        resolve({ ok: false, reason: err?.message || "requestdata_failed" });
      }
    });
  };

  const capturePhoto = async () => {
    if (isCapturing) return;
    setIsCapturing(true);

    try {
      await triggerFlash();
      playShutter();

      const targetIndex = retakeIndices ? retakeIndices[photosTaken] : null;
      const slotIdx = targetIndex ?? photosTaken;

      // Stop clip saving in the background — do NOT block still capture
      const clipPromise = stopPreShotRecording();
      pendingClipPromisesRef.current.push(clipPromise);

      const saved = await captureFrame(targetIndex);

      if (saved) {
        capturesRef.current.push(
          retakeIndices ? { index: targetIndex, saved } : saved
        );

        onCapture(saved);

        try {
          await window.api.previewSaveStill(session?.sessionId, slotIdx, saved.dataUrl, {
            eventId,
          });
        } catch { }
      }

      const nextShotIndex = photosTaken + 1;

      if (nextShotIndex < cfgShots) {
        const nextTargetIndex = retakeIndices
          ? retakeIndices[nextShotIndex] ?? nextShotIndex
          : nextShotIndex;

        setTimer(cfgCountdown);
      } else {
        setTimeout(async () => {
          try {
            await Promise.allSettled(pendingClipPromisesRef.current);
          } finally {
            pendingClipPromisesRef.current = [];
            onFinish(capturesRef.current);
            capturesRef.current = [];
          }
        }, 200);
      }

      setPhotosTaken(nextShotIndex);
    } catch (err) {
      console.error(err);
    } finally {
      setIsCapturing(false);
    }
  };

  /* ------------------------------------------------------------------ */
  /* Countdown ring                                                     */
  /* ------------------------------------------------------------------ */
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const progress = (timer / cfgCountdown) * circumference;

  const getGuideBoxByOrientation = (containerW, containerH, targetAspect) => {
    if (!containerW || !containerH || !targetAspect) {
      return { left: 0, top: 0, width: containerW || 0, height: containerH || 0 };
    }

    const isLandscapeGuide = targetAspect >= 1;
    const scale = 0.78; // within your requested 70–80%

    if (isLandscapeGuide) {
      // full width, reduced centered height
      const width = containerW;
      const height = Math.min(containerH * scale, width / targetAspect);
      return {
        width,
        height,
        left: 0,
        top: (containerH - height) / 2,
      };
    }

    // portrait guide: full height, reduced centered width
    const height = containerH;
    const width = Math.min(containerW * scale, height * targetAspect);
    return {
      width,
      height,
      left: (containerW - width) / 2,
      top: 0,
    };
  };

  const fittedGuideBox = getGuideBoxByOrientation(
    previewRect.width,
    previewRect.height,
    guideAspect
  );

  /* ------------------------------------------------------------------ */
  /* Render                                                             */
  /* ------------------------------------------------------------------ */
  return (
    <div
      className="relative w-full h-screen overflow-hidden"
      style={{
        backgroundColor: bgColor,
        fontFamily: generalFont,
        color: generalFontColor,
      }}
    >

      {/* Header */}
      <div className="absolute top-6 left-6 z-20">
        {logoPath ? (<img src={logoPath} alt="logo" className="max-w-[300px] sm:max-w-[300px] md:max-w-[400px]" />) : (<>
          <h1
            className="text-5xl font-bold"
            style={{ fontFamily: headerFont, color: headerFontColor }}
          >
            <span>{boothName}</span>
          </h1>
          {tagline && <p className="text-lg" style={{ color: generalFontColor }}>
            {tagline}
          </p>}</>)}
      </div>

      {/* Counter */}
      <div className="absolute top-6 right-6 z-20 px-6 py-3 rounded-full backdrop-blur text-2xl font-bold" style={{ fontFamily: generalFont, color: buttonFontColor, background: buttonBgColor }}>
        {photosTaken}/{cfgShots} {t.counter}
      </div>

      {/* Camera block */}
      <div className="absolute inset-0 z-0">
        <div
          ref={previewWrapRef}
          className="relative w-full h-full overflow-hidden bg-black"
        >
          <div className="relative w-full h-full overflow-hidden">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`absolute inset-0 w-full h-full object-cover ${effectiveMirrorCamera ? "scale-x-[-1]" : ""
                }`}
            />

            {showSlotGuide && previewRect.width > 0 && previewRect.height > 0 && activeSlot && (
              <div
                className="absolute pointer-events-none rounded-[20px]"
                style={{
                  left: fittedGuideBox.left,
                  top: fittedGuideBox.top,
                  width: fittedGuideBox.width,
                  height: fittedGuideBox.height,
                  border: "none",
                  boxShadow: "none",
                  background: "transparent",
                  transform: `rotate(${activeSlot.rotation || 0}deg)`,
                  transformOrigin: "center",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: 12,
                    left: 12,
                    minWidth: 34,
                    height: 34,
                    borderRadius: 999,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "0 12px",
                    fontSize: 16,
                    fontWeight: 700,
                    color: "#fff",
                    background: "rgba(0,0,0,0.35)",
                  }}
                >
                  {activeGuideIndex + 1}
                </div>
              </div>
            )}
          </div>

          {/* Countdown */}
          <div className="absolute inset-0 flex items-center justify-center">
            <svg className="w-48 h-48 -rotate-90">
              <circle
                cx="96"
                cy="96"
                r={radius}
                className="opacity-25"
                stroke={buttonFontColor}
                strokeWidth="8"
                fill="none"
              />
              <motion.circle
                cx="96"
                cy="96"
                r={radius}
                stroke={buttonBgColor}
                strokeWidth="8"
                fill="none"
                strokeDasharray={circumference}
                strokeDashoffset={circumference - progress}
              />
            </svg>

            <span
              className="absolute text-8xl font-bold"
              style={{ fontFamily: generalFont }}
            >
              {timer}
            </span>
          </div>


          {/* Flash overlay */}
          <div
            className={`absolute inset-0 bg-white transition-opacity ${isFlashing ? "opacity-90" : "opacity-0"
              }`}
          />
        </div>
      </div>

      {/* Camera error display + action row */}
      {cameraError && (
        <div className="absolute inset-x-0 top-28 z-40 flex flex-col items-center">
          <div className="px-4 py-2 rounded-full bg-red-600/80 text-white text-sm shadow">
            {t.cameraError}
          </div>
          <div className="mt-4 flex gap-8">
            <button
              onClick={() => {
                setCameraError(null);
                setCameraReady(false);
                initCamera();
              }}
              className="px-6 py-2 rounded-full bg-white text-black text-sm font-semibold hover:bg-gray-100"
            >
              {t.retry}
            </button>
            <button
              onClick={onCancel}
              className="px-6 py-2 rounded-full bg-white text-black text-sm font-semibold hover:bg-gray-100"
            >
              {t.back}
            </button>
          </div>
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />

    </div>
  );
}
