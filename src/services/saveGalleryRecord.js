import { supabase } from './supabase.js';

export async function saveGalleryRecord({
  slug,
  eventId,
  sessionId,
  finalUrl,
  finalVideoUrl = null,
  photoUrls = [],
}) {
  const payload = {
    slug,
    event_id: eventId,
    session_id: sessionId,
    final_url: finalUrl,
    final_video_url: finalVideoUrl,
    photo_urls: Array.isArray(photoUrls) ? photoUrls : [],
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };

  console.log("[saveGalleryRecord] payload:", payload);

  const { data, error } = await supabase
    .from("galleries")
    .upsert(payload, {
      onConflict: "slug",
    })
    .select()
    .single();

  if (error) {
    console.error("[saveGalleryRecord] failed:", error);
    throw error;
  }

  console.log("[saveGalleryRecord] saved row:", data);
  return data;
}
