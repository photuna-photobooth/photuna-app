export const TRIAL_WATERMARK_TEXT = "STUDIO PHOTUNA TRIAL";

export function drawTrialWatermark(ctx, width, height, text = TRIAL_WATERMARK_TEXT) {
  if (!ctx || !width || !height) return;

  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.translate(width / 2, height / 2);
  ctx.rotate(-Math.PI / 5);

  const fontSize = Math.max(34, Math.round(Math.min(width, height) * 0.055));
  ctx.font = `800 ${fontSize}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = Math.max(3, Math.round(fontSize * 0.08));
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.fillStyle = "rgba(255,255,255,0.72)";

  const label = String(text || TRIAL_WATERMARK_TEXT).toUpperCase();
  const metrics = ctx.measureText(label);
  const stepX = Math.max(metrics.width + fontSize * 2.5, width * 0.58);
  const stepY = fontSize * 3.2;

  for (let y = -height; y <= height; y += stepY) {
    for (let x = -width; x <= width; x += stepX) {
      ctx.strokeText(label, x, y);
      ctx.fillText(label, x, y);
    }
  }

  ctx.restore();
}
