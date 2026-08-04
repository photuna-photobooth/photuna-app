import { supabase } from './supabase.js';

const BUCKET = "studiophotuna";
// Signed URLs valid for 365 days — outlasts all gallery retention periods.
// Files are deleted by the nightly cron before URLs become stale in practice.
const SIGNED_URL_EXPIRY_SECONDS = 365 * 24 * 60 * 60;

async function createSignedUrl(path) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_EXPIRY_SECONDS);
  if (error || !data?.signedUrl) {
    console.error("[uploadSessionImages] signed URL creation failed", path, error);
    return null;
  }
  return data.signedUrl;
}

function normalizeImageContentType(blob, fallback = "image/png") {
  const type = String(blob?.type || "").toLowerCase();
  if (type.startsWith("image/")) return type;
  return fallback;
}

function detectVideoMeta(blob, index = 0, prefix = "slot") {
  const type = String(blob?.type || "").toLowerCase();

  if (type.includes("mp4")) {
    return { ext: "mp4", contentType: "video/mp4", fileName: `${prefix}-${index + 1}.mp4` };
  }
  if (type.includes("ogg") || type.includes("ogv")) {
    return { ext: "ogg", contentType: "video/ogg", fileName: `${prefix}-${index + 1}.ogg` };
  }
  return { ext: "webm", contentType: "video/webm", fileName: `${prefix}-${index + 1}.webm` };
}

async function uploadAndSign(path, blob, contentType) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType, upsert: true });
  if (error) throw error;
  return createSignedUrl(path);
}

export async function uploadSessionImages({
  eventId,
  sessionId,
  finalBlob,
  finalVideoBlob = null,
  photoBlobs = [],
  burstVideoBlobs = [],
}) {
  if (!eventId) throw new Error("Missing eventId");
  if (!sessionId) throw new Error("Missing sessionId");
  if (!finalBlob) throw new Error("Missing finalBlob");

  console.log("[uploadSessionImages] start", {
    eventId,
    sessionId,
    photoCount: photoBlobs.length,
    burstCount: burstVideoBlobs.length,
    finalType: finalBlob?.type,
    finalSize: finalBlob?.size,
    finalVideoType: finalVideoBlob?.type,
    finalVideoSize: finalVideoBlob?.size,
  });

  const finalPath = `${eventId}/${sessionId}/final.png`;
  const finalUrl = await uploadAndSign(
    finalPath,
    finalBlob,
    normalizeImageContentType(finalBlob, "image/png")
  );

  let finalVideoUrl = null;
  let finalVideoPath = null;
  if (finalVideoBlob && finalVideoBlob.size) {
    const motionMeta = detectVideoMeta(finalVideoBlob, 0, "final-motion");
    finalVideoPath = `${eventId}/${sessionId}/${motionMeta.fileName}`;
    finalVideoUrl = await uploadAndSign(finalVideoPath, finalVideoBlob, motionMeta.contentType);
  }

  const photoUrls = [];
  const photoPaths = [];
  for (let i = 0; i < photoBlobs.length; i++) {
    const photoBlob = photoBlobs[i];
    if (!photoBlob || !photoBlob.size) {
      console.warn(`[uploadSessionImages] skipping empty photo blob at index ${i}`);
      continue;
    }
    const photoPath = `${eventId}/${sessionId}/photos/photo-${i + 1}.png`;
    const url = await uploadAndSign(
      photoPath,
      photoBlob,
      normalizeImageContentType(photoBlob, "image/png")
    );
    if (url) { photoUrls.push(url); photoPaths.push(photoPath); }
  }

  const burstVideoUrls = [];
  const burstUploadErrors = [];

  for (let i = 0; i < burstVideoBlobs.length; i++) {
    const videoBlob = burstVideoBlobs[i];
    if (!videoBlob || !videoBlob.size) {
      console.warn(`[uploadSessionImages] skipping empty burst blob at index ${i}`);
      continue;
    }
    const meta = detectVideoMeta(videoBlob, i);
    const videoPath = `${eventId}/${sessionId}/burst-video/${meta.fileName}`;
    try {
      const url = await uploadAndSign(videoPath, videoBlob, meta.contentType);
      if (url) {
        burstVideoUrls.push(url);
      } else {
        burstUploadErrors.push(`No signed URL returned for burst index ${i}`);
      }
    } catch (err) {
      console.error(`[uploadSessionImages] burst upload failed at index ${i}`, err);
      burstUploadErrors.push(err?.message || `Burst upload failed at index ${i}`);
    }
  }

  const urlsExpireAt = new Date(Date.now() + SIGNED_URL_EXPIRY_SECONDS * 1000).toISOString();

  console.log("[uploadSessionImages] done", {
    finalUrl,
    finalVideoUrl,
    photoUrls,
    burstVideoUrls,
    burstUploadErrors,
  });

  return {
    finalUrl,
    finalVideoUrl,
    photoUrls,
    burstVideoUrls,
    burstUploadErrors,
    // Storage paths — used to refresh signed URLs when they expire
    finalPath,
    finalVideoPath,
    photoPaths,
    urlsExpireAt,
  };
}
