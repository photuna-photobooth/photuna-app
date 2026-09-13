// Private bucket — create a long-lived signed URL (365 days) instead of a public URL
const SIGNED_URL_EXPIRY_SECONDS = 365 * 24 * 60 * 60;

// Uploads run a few at a time. They used to run strictly one after another, and
// a session is ~14 files each needing an upload and then a signing request. The
// files are tens of kilobytes, so almost all of the ~8 s that took was waiting
// on round trips, not bandwidth. Six at once is enough to collapse that without
// swamping a weak venue connection.
const UPLOAD_CONCURRENCY = 6;

async function getSafeUrl(supabase, bucket, path) {
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, SIGNED_URL_EXPIRY_SECONDS);
    if (!error && data?.signedUrl) return data.signedUrl;
  } catch (_) {}
  // Fall back to public URL (works if bucket is made public later)
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data?.publicUrl || null;
}

function normalizeImageContentType(blob, fallback = "image/png") {
  const type = String(blob?.type || "").toLowerCase();
  if (type.startsWith("image/")) return type;
  return fallback;
}

function detectVideoMeta(blob, index = 0, prefix = "slot") {
  const type = String(blob?.type || "").toLowerCase();

  if (type.includes("mp4")) {
    return {
      ext: "mp4",
      contentType: "video/mp4",
      fileName: `${prefix}-${index + 1}.mp4`,
    };
  }

  if (type.includes("ogg") || type.includes("ogv")) {
    return {
      ext: "ogg",
      contentType: "video/ogg",
      fileName: `${prefix}-${index + 1}.ogg`,
    };
  }

  return {
    ext: "webm",
    contentType: "video/webm",
    fileName: `${prefix}-${index + 1}.webm`,
  };
}

// Runs tasks with at most `limit` in flight and returns their results in task
// order, whatever order they finish in. The first task to throw stops any that
// have not started yet and becomes the rejection.
async function runLimited(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  let failed = false;
  let failure;

  async function worker() {
    while (!failed && next < tasks.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await tasks[index]();
      } catch (err) {
        if (!failed) {
          failed = true;
          failure = err;
        }
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker);
  await Promise.all(workers);
  if (failed) throw failure;
  return results;
}

async function uploadSessionImages({
  supabase,
  eventId,
  sessionId,
  finalBlob,
  finalVideoBlob = null,
  photoBlobs = [],
  burstVideoBlobs = [],
}) {
  const bucket = "studiophotuna";

  if (!supabase) throw new Error("Missing Supabase client");
  if (!eventId) throw new Error("Missing eventId");
  if (!sessionId) throw new Error("Missing sessionId");
  if (!finalBlob) throw new Error("Missing finalBlob");

  const finalPath = `${eventId}/${sessionId}/final.png`;

  // Diagnostic: log the supabase project URL so we can confirm the right client is used
  const supabaseUrl = supabase?.supabaseUrl || String(supabase?.storageUrl?.href || "") || "(unknown)";
  console.log("[uploadSessionImages] start", {
    eventId,
    sessionId,
    photoCount: photoBlobs.length,
    burstCount: burstVideoBlobs.length,
    finalType: finalBlob?.type,
    finalSize: finalBlob?.size,
    finalVideoType: finalVideoBlob?.type,
    finalVideoSize: finalVideoBlob?.size,
    supabaseUrl,
    bucket,
    finalPath,
  });

  // The strip, its motion clip and the photos are required: any failure fails
  // the gallery, as it always has.
  async function uploadRequired(path, blob, contentType, label) {
    const res = await supabase.storage
      .from(bucket)
      .upload(path, blob, { contentType, upsert: true });

    if (res.error) {
      console.error(`[uploadSessionImages] ${label} upload failed`, {
        error: res.error,
        status: res.error?.status,
        statusCode: res.error?.statusCode,
        message: res.error?.message,
        supabaseUrl,
        bucket,
        path,
      });
      throw res.error;
    }

    return getSafeUrl(supabase, bucket, path);
  }

  const tasks = [];

  const finalTask = tasks.push(() =>
    uploadRequired(finalPath, finalBlob, normalizeImageContentType(finalBlob, "image/png"), "final")
  ) - 1;

  let motionTask = -1;
  if (finalVideoBlob && finalVideoBlob.size) {
    const motionMeta = detectVideoMeta(finalVideoBlob, 0, "final-motion");
    const finalVideoPath = `${eventId}/${sessionId}/${motionMeta.fileName}`;
    motionTask = tasks.push(() =>
      uploadRequired(finalVideoPath, finalVideoBlob, motionMeta.contentType, "final video")
    ) - 1;
  }

  const photoTasks = [];
  photoBlobs.forEach((photoBlob, i) => {
    if (!photoBlob || !photoBlob.size) {
      console.warn(`[uploadSessionImages] skipping empty photo blob at index ${i}`);
      return;
    }
    const photoPath = `${eventId}/${sessionId}/photos/photo-${i + 1}.png`;
    photoTasks.push(tasks.push(() =>
      uploadRequired(photoPath, photoBlob, normalizeImageContentType(photoBlob, "image/png"), `photo ${i}`)
    ) - 1);
  });

  // Burst clips are best-effort: a failure is recorded, never thrown.
  const burstTasks = [];
  burstVideoBlobs.forEach((videoBlob, i) => {
    if (!videoBlob || !videoBlob.size) {
      console.warn(`[uploadSessionImages] skipping empty burst blob at index ${i}`);
      return;
    }
    const meta = detectVideoMeta(videoBlob, i);
    const videoPath = `${eventId}/${sessionId}/burst-video/${meta.fileName}`;

    burstTasks.push(tasks.push(async () => {
      try {
        const videoRes = await supabase.storage
          .from(bucket)
          .upload(videoPath, videoBlob, { contentType: meta.contentType, upsert: true });
        if (videoRes.error) throw videoRes.error;

        const url = await getSafeUrl(supabase, bucket, videoPath);
        return url ? { url } : { error: `No signed URL returned for burst index ${i}` };
      } catch (err) {
        console.error(`[uploadSessionImages] burst upload failed at index ${i}`, err);
        return { error: err?.message || `Burst upload failed at index ${i}` };
      }
    }) - 1);
  });

  const results = await runLimited(tasks, UPLOAD_CONCURRENCY);

  const finalUrl = results[finalTask];
  const finalVideoUrl = motionTask >= 0 ? results[motionTask] : null;
  const photoUrls = photoTasks.map((t) => results[t]).filter(Boolean);

  const burstVideoUrls = [];
  const burstUploadErrors = [];
  for (const t of burstTasks) {
    if (results[t].url) burstVideoUrls.push(results[t].url);
    else burstUploadErrors.push(results[t].error);
  }

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
  };
}

module.exports = { uploadSessionImages };
