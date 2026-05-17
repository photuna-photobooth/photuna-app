// src/utils.js

/** -----------------------------
 * Canvas & Template Helpers
 * ----------------------------- */

// Converts percentage or pixel values to actual pixel count
export function toPx(value, total) {
  if (typeof value === "string" && value.includes("%")) {
    return (parseFloat(value) / 100) * total;
  }
  return Number(value) || 0;
}

// Gets canvas width/height and column count for a given template
export function getCanvasDims(template) {
  if (!template) return { cw: 0, ch: 0, cols: 1 };
  const cw = template.width || 1080;
  const ch = template.height || 1920;
  const cols = template.cols || 1;
  return { cw, ch, cols };
}

/** -----------------------------
 * Filters for Preview
 * ----------------------------- */

export const FILTERS = [
  { name: "None", css: "" },
  { name: "Warm", css: "sepia(0.3) saturate(1.2) contrast(1.1)" },
  { name: "Cool", css: "contrast(1.1) saturate(0.8) hue-rotate(180deg)" },
  { name: "Vintage", css: "sepia(0.4) contrast(1.2) brightness(0.9)" },
  { name: "Grayscale", css: "grayscale(1)" },
  { name: "Bright", css: "brightness(1.3) contrast(1.1)" },
  { name: "Muted", css: "saturate(0.6) brightness(0.9)" },
];

/** -----------------------------
 * Sample Photos for Placeholders
 * ----------------------------- */
export const SAMPLE_PHOTOS = [
  "https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=400&q=80",
  "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&q=80",
  "https://images.unsplash.com/photo-1502685104226-ee32379fefbe?w=400&q=80",
  "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400&q=80",
];

