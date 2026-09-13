// The motion-composite FFmpeg graph, shared by the booth and the render service.
//
// This used to live inside electron/main.js, which meant it could only ever run
// on a Windows desktop. Moving the encode to a server (so iPadOS and Android
// tablets can have motion clips at all, and so we stop distributing FFmpeg)
// needs the same graph in two places — and two copies of geometry this fiddly
// would drift, and the clips would quietly stop matching.
//
// So this module owns the graph and nothing else. It touches no filesystem and
// spawns no process: callers resolve the input files themselves (the booth from
// a local burst folder, the service from downloaded objects) and hand in paths.
// Given the same layout and the same inputs it must return the same plan, which
// is what makes the two produce the same video.
//
// CommonJS on purpose: it is required by Electron's main process and by a plain
// Node service, neither of which is bundled.

const FINAL_MOTION_DURATION_SECONDS = 5;

// Print sheet sizes in pixels. A strip layout is composed once and then
// duplicated side by side onto a full sheet, which is why renderArea and canvas
// differ for 2x6 and 6x2.
const SHEET_4x6 = { w: 1200, h: 1800 };
const SHEET_6x4 = { w: 1800, h: 1200 };
const STRIP_2x6 = { w: 600, h: 1800 };
const STRIP_6x2 = { w: 1800, h: 600 };

function clamp01(n, fallback = 0) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(1, v));
}

function toEven(n, min = 2) {
  const v = Math.max(min, Math.round(Number(n) || min));
  return v % 2 === 0 ? v : v + 1;
}

// Slot coordinates are stored as fractions of the render area, so they survive
// a change of sheet size. This turns them into pixels.
function toSlotPixels(slot, canvasW, canvasH, frame = null) {
  const pad = Number(frame?.padding || 0);

  const innerX = pad;
  const innerY = pad;
  const innerW = Math.max(2, canvasW - pad * 2);
  const innerH = Math.max(2, canvasH - pad * 2);

  return {
    x: Math.round(innerX + clamp01(slot?.x) * innerW),
    y: Math.round(innerY + clamp01(slot?.y) * innerH),
    w: toEven(clamp01(slot?.w, 0.1) * innerW),
    h: toEven(clamp01(slot?.h, 0.1) * innerH),
    rotation: Number(slot?.rotation || 0),

    scale: Math.max(1, Number(slot?.transform?.scale || 1)),
    offsetX: Math.round(Number(slot?.transform?.offsetX || 0)),
    offsetY: Math.round(Number(slot?.transform?.offsetY || 0)),
  };
}

/**
 * Work out which captured clip belongs in each final slot.
 *
 * Guests reorder poses after shooting, so final slot i is not necessarily
 * source clip i. Returned entries are source indices in final slot order; the
 * caller turns those into file paths however it gets its files.
 *
 * @param {object} layout
 * @param {number[]|null} slotVideoMap
 * @returns {number[]}
 */
function resolveSlotSourceIndices(layout, slotVideoMap) {
  const slots = Array.isArray(layout?.slots) ? layout.slots : [];
  const map = Array.isArray(slotVideoMap)
    ? slotVideoMap
    : Array.isArray(layout?.slotVideoMap)
      ? layout.slotVideoMap
      : [];

  return slots.map((_, i) => (Number.isInteger(map[i]) ? map[i] : i));
}

/**
 * Build the FFmpeg plan for a session's motion clip.
 *
 * @param {object}   layout           layoutKey/width/height/slots/frame
 * @param {(string|null)[]} slotFiles one entry per layout slot, aligned by
 *                                    index; null where no clip was captured
 * @param {string|null} overlayFile   the frame graphic, already on disk
 * @param {string}   backgroundColor
 * @param {boolean}  watermark
 * @returns {{inputs: object[], filters: string[], outputLabel: string,
 *            outputOptions: string[], durationSeconds: number,
 *            canvas: {w:number,h:number}}}
 */
function buildMotionCompositePlan({
  layout,
  slotFiles = [],
  overlayFile = null,
  backgroundColor = "#ffffff",
  watermark = false,
}) {
  const slots = Array.isArray(layout?.slots) ? layout.slots : [];
  if (!slots.length) {
    throw new Error("Missing layout slots for animated composite.");
  }

  const layoutKey = String(layout?.layoutKey || layout?.layout || "4x6").toLowerCase();

  const isTallStrip = layoutKey === "2x6";
  const isWideStrip = layoutKey === "6x2";
  const isStripLayout = isTallStrip || isWideStrip;

  // renderArea = the single strip area where slots are calculated
  const renderAreaW = isTallStrip
    ? STRIP_2x6.w
    : isWideStrip
      ? STRIP_6x2.w
      : toEven(Number(layout?.width) || 1200);

  const renderAreaH = isTallStrip
    ? STRIP_2x6.h
    : isWideStrip
      ? STRIP_6x2.h
      : toEven(Number(layout?.height) || 1800);

  // final output sheet
  const canvasW = isTallStrip ? SHEET_4x6.w : isWideStrip ? SHEET_6x4.w : renderAreaW;
  const canvasH = isTallStrip ? SHEET_4x6.h : isWideStrip ? SHEET_6x4.h : renderAreaH;

  const activeSlots = [];
  for (let i = 0; i < slots.length; i++) {
    const file = slotFiles[i];
    if (!file) continue;

    activeSlots.push({
      inputIndex: activeSlots.length + 1,
      file,
      slot: slots[i],
      px: toSlotPixels(slots[i], renderAreaW, renderAreaH, layout?.frame || null),
    });
  }

  if (!activeSlots.length) {
    throw new Error("No burst slot videos found to compose.");
  }

  const inputs = [
    {
      kind: "lavfi",
      spec: `color=c=${String(backgroundColor || "#ffffff")}@0:s=${renderAreaW}x${renderAreaH}:d=${FINAL_MOTION_DURATION_SECONDS}`,
    },
    ...activeSlots.map(({ file }) => ({ kind: "file", path: file })),
  ];
  if (overlayFile) inputs.push({ kind: "file", path: overlayFile });

  const filters = [];
  let last = "[0:v]";

  activeSlots.forEach((entry, i) => {
    const inLabel = `[${entry.inputIndex}:v]`;
    const zoomed = `[s${i}a]`;
    const placed = `[s${i}b]`;
    const slotted = `[s${i}c]`;
    const rotated = `[s${i}d]`;
    const overlaid = `[s${i}e]`;

    const { x, y, w, h, rotation, scale = 1, offsetX = 0, offsetY = 0 } = entry.px;

    const radians = ((rotation || 0) * Math.PI) / 180;
    const zoomH = toEven(h * scale);

    // 1) fit by height first, matching preview behavior better than "increase"
    filters.push(
      `${inLabel}setpts=N/(30*TB),fps=30,trim=duration=${FINAL_MOTION_DURATION_SECONDS},scale=-2:${zoomH}${zoomed}`
    );

    // 2) create a working frame that is never smaller than the zoomed input
    const padW = `max(iw\\,${w})`;
    const padH = `max(ih\\,${h})`;
    const padX = `max(0\\,(ow-iw)/2+${offsetX})`;
    const padY = `max(0\\,(oh-ih)/2+${offsetY})`;

    filters.push(`${zoomed}pad=${padW}:${padH}:${padX}:${padY}:color=white@0${placed}`);

    // 3) crop the final slot window from the centered working frame
    const cropX = `max(0\\,(iw-${w})/2)`;
    const cropY = `max(0\\,(ih-${h})/2)`;

    filters.push(`${placed}crop=${w}:${h}:${cropX}:${cropY}${slotted}`);

    // 4) rotate if needed
    if (rotation) {
      filters.push(`${slotted}rotate=${radians}:fillcolor=none:ow=${w}:oh=${h}${rotated}`);
    } else {
      filters.push(`${slotted}null${rotated}`);
    }

    // 5) overlay and keep last frame
    filters.push(`${last}${rotated}overlay=${x}:${y}:eof_action=repeat:repeatlast=1${overlaid}`);

    last = overlaid;
  });

  if (overlayFile) {
    const overlayInputIndex = activeSlots.length + 1;

    if (isStripLayout) {
      const stripFrameScaled = `[stripFrameScaled]`;
      const stripFramed = `[stripFramed]`;

      // Match final.png: overlay is drawn on the single strip first
      filters.push(
        `[${overlayInputIndex}:v]scale=${renderAreaW}:${renderAreaH}${stripFrameScaled}`,
        `${last}${stripFrameScaled}overlay=0:0${stripFramed}`
      );

      last = stripFramed;
    } else {
      const frameScaled = `[frameScaled]`;
      const finalOut = `[finalOut]`;

      filters.push(
        `[${overlayInputIndex}:v]scale=${canvasW}:${canvasH}${frameScaled}`,
        `${last}${frameScaled}overlay=0:0${finalOut}`
      );

      last = finalOut;
    }
  }

  if (isStripLayout) {
    const stripA = `[stripDupA]`;
    const stripB = `[stripDupB]`;
    const duplicated = `[duplicatedSheet]`;

    filters.push(`${last}split=2${stripA}${stripB}`);

    if (isTallStrip) {
      filters.push(
        `color=c=white:s=${canvasW}x${canvasH}:d=${FINAL_MOTION_DURATION_SECONDS}[stripSheetBase]`,
        `[stripSheetBase]${stripA}overlay=0:0[tmpStrip1]`,
        `[tmpStrip1]${stripB}overlay=${renderAreaW}:0${duplicated}`
      );
    } else if (isWideStrip) {
      filters.push(
        `color=c=white:s=${canvasW}x${canvasH}:d=${FINAL_MOTION_DURATION_SECONDS}[stripSheetBase]`,
        `[stripSheetBase]${stripA}overlay=0:0[tmpStrip1]`,
        `[tmpStrip1]${stripB}overlay=0:${renderAreaH}${duplicated}`
      );
    }

    // first move last to the duplicated sheet
    last = duplicated;

    // then add divider on the duplicated sheet
    const dividerOut = `[dividerOut]`;

    if (isTallStrip) {
      filters.push(
        `color=c=black@0.15:s=2x${canvasH}:d=${FINAL_MOTION_DURATION_SECONDS}[dividerLine]`,
        `${last}[dividerLine]overlay=${renderAreaW}:0${dividerOut}`
      );
    } else if (isWideStrip) {
      filters.push(
        `color=c=black@0.15:s=${canvasW}x2:d=${FINAL_MOTION_DURATION_SECONDS}[dividerLine]`,
        `${last}[dividerLine]overlay=0:${renderAreaH}${dividerOut}`
      );
    }

    last = dividerOut;
  }

  if (watermark) {
    const watermarkedOut = "[watermarkedOut]";
    const fontSize = Math.max(36, Math.round(Math.min(canvasW, canvasH) * 0.045));
    filters.push(
      `${last}drawtext=text='STUDIO PHOTUNA TRIAL':fontcolor=white@0.70:bordercolor=black@0.45:borderw=3:fontsize=${fontSize}:x=(w-text_w)/2:y=h-(text_h*2.2)${watermarkedOut}`
    );
    last = watermarkedOut;
  }

  return {
    inputs,
    filters,
    outputLabel: last.replace(/^\[|\]$/g, ""),
    outputOptions: [
      `-t ${FINAL_MOTION_DURATION_SECONDS}`,
      "-an",
      "-r 30",
      "-c:v libx264",
      "-pix_fmt yuv420p",
      "-preset veryfast",
      "-crf 23",
      "-movflags +faststart",
    ],
    durationSeconds: FINAL_MOTION_DURATION_SECONDS,
    canvas: { w: canvasW, h: canvasH },
  };
}

/**
 * Reduce a layout to exactly the fields buildMotionCompositePlan reads, for
 * sending to the render service.
 *
 * A template's slots carry a great deal the video never uses: the first recipe
 * sent whole was 349 kB, larger than the photo strip. Keep this beside the plan
 * builder — if the builder starts reading another field it must be added here,
 * or the server will quietly render a different clip from the booth.
 */
function toRenderLayout(layout) {
  if (!layout || typeof layout !== "object") return null;
  const slots = Array.isArray(layout.slots) ? layout.slots : [];

  return {
    layoutKey: layout.layoutKey,
    layout: typeof layout.layout === "string" ? layout.layout : undefined,
    width: layout.width,
    height: layout.height,
    frame: layout.frame ? { padding: layout.frame.padding } : undefined,
    slotVideoMap: Array.isArray(layout.slotVideoMap) ? layout.slotVideoMap : undefined,
    slots: slots.map((slot) => ({
      x: slot?.x,
      y: slot?.y,
      w: slot?.w,
      h: slot?.h,
      rotation: slot?.rotation,
      transform: slot?.transform
        ? {
            scale: slot.transform.scale,
            offsetX: slot.transform.offsetX,
            offsetY: slot.transform.offsetY,
          }
        : undefined,
    })),
  };
}

module.exports = {
  FINAL_MOTION_DURATION_SECONDS,
  buildMotionCompositePlan,
  resolveSlotSourceIndices,
  toRenderLayout,
  toSlotPixels,
  toEven,
  clamp01,
};
