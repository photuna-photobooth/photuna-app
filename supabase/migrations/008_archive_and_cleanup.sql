-- ============================================================
-- Photuna — Migration 008: Archive & Time-Bound Deletion
--
-- Covers:
--   1. gallery_retention_plans  — per-plan archive windows
--   2. galleries schema updates — owner_user_id, videos_purged_at, archived_at
--   3. licenses.gallery_tier    — new column (replaces legacy gallery_addon)
--   4. Storage-path helper
--   5. Plan-aware gallery_default_expires_at()
--   6. purge_expired_gallery_videos()    — Phase 1: delete video files
--   7. hard_delete_expired_galleries()  — Phase 2: delete photos + row
--   8. prune_stale_license_devices()    — stale device fingerprints > 90 days
--   9. archive_old_event_bookings()     — soft-archive 1 yr, hard-delete 2 yr
--  10. pg_cron schedules (runs nightly/weekly/monthly in UTC)
--
-- Requires: pg_cron enabled on the Supabase project (Pro plan+).
-- Run in: Supabase Dashboard → SQL Editor, or via Supabase CLI.
-- ============================================================


-- ============================================================
-- 1. GALLERY RETENTION PLANS
-- Two-phase deletion: videos are purged first (expensive storage),
-- then photos and the row are deleted after a longer window.
-- gallery_addon / gallery_tier="plus" users get extended retention.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.gallery_retention_plans (
  plan_key                text PRIMARY KEY,
  label                   text NOT NULL,
  -- How many days after creation until the gallery link expires
  gallery_expires_days    int  NOT NULL,
  -- Days after expires_at → delete video files (burst + final video)
  video_purge_after_days  int  NOT NULL,
  -- Days after expires_at → delete photo files + the gallery row
  hard_delete_after_days  int  NOT NULL
);

INSERT INTO public.gallery_retention_plans
  (plan_key, label, gallery_expires_days, video_purge_after_days, hard_delete_after_days)
VALUES
  -- plan_key must match licenses.plan values + gallery tier values
  ('free',     'Free',              7,    3,    14),
  ('trial',    'Trial',            14,    7,    30),
  ('monthly',  'Monthly',          30,   15,    60),
  ('yearly',   'Yearly',           90,   45,   180),
  ('plus',     'Gallery Add-on',  180,   90,   365),
  ('business', 'Business',        365,  180,   730)
ON CONFLICT (plan_key) DO NOTHING;

ALTER TABLE public.gallery_retention_plans ENABLE ROW LEVEL SECURITY;

-- Anyone can read the plan windows (used by the booth app to show expiry info)
DROP POLICY IF EXISTS "Public can read gallery retention plans" ON public.gallery_retention_plans;
CREATE POLICY "Public can read gallery retention plans"
  ON public.gallery_retention_plans FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Service role manages gallery retention plans" ON public.gallery_retention_plans;
CREATE POLICY "Service role manages gallery retention plans"
  ON public.gallery_retention_plans FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);


-- ============================================================
-- 2. GALLERIES — schema additions
-- owner_user_id: links to the booth operator so the cleanup
--   function can look up their plan tier.
-- videos_purged_at: Phase-1 sentinel (set once video files deleted).
-- archived_at: set when the gallery has fully expired and been processed.
-- ============================================================

ALTER TABLE public.galleries
  ADD COLUMN IF NOT EXISTS owner_user_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS videos_purged_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at      timestamptz;

-- Index makes the nightly cron fast (only scans expired, unprocessed rows)
CREATE INDEX IF NOT EXISTS galleries_cleanup_idx
  ON public.galleries (expires_at, videos_purged_at, archived_at)
  WHERE expires_at IS NOT NULL;


-- ============================================================
-- 3. LICENSES — gallery_tier column
-- Replaces the legacy gallery_addon boolean.
-- Values: 'free' | 'plus' | 'business'
-- Backfill from gallery_addon for existing rows.
-- ============================================================

ALTER TABLE public.licenses
  ADD COLUMN IF NOT EXISTS gallery_tier text NOT NULL DEFAULT 'free'
    CHECK (gallery_tier IN ('free', 'plus', 'business'));

-- Backfill: rows with gallery_addon=true → tier 'plus'
UPDATE public.licenses
SET gallery_tier = 'plus'
WHERE gallery_addon = true AND gallery_tier = 'free';


-- ============================================================
-- 4. HELPER: extract storage object path from a public URL
--
-- Input:  'https://xxx.supabase.co/storage/v1/object/public/studiophotuna/events/abc/...'
-- Output: 'events/abc/...'
--
-- Returns NULL for blank / non-storage URLs so DELETE WHERE name = NULL is a no-op.
-- ============================================================

CREATE OR REPLACE FUNCTION public.storage_path_from_url(url text, bucket text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN url IS NULL OR url = '' THEN NULL
    WHEN url LIKE '%/' || bucket || '/%'
      THEN split_part(url, '/' || bucket || '/', 2)
    ELSE NULL
  END;
$$;


-- ============================================================
-- 5. gallery_effective_plan_key(owner_user_id)
-- Returns the plan key to use for retention lookups.
-- Prioritises gallery_tier='plus'/'business' over the base plan.
-- ============================================================

CREATE OR REPLACE FUNCTION public.gallery_effective_plan_key(p_user_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN l.gallery_tier IN ('plus', 'business') THEN l.gallery_tier
    WHEN l.plan IS NOT NULL THEN l.plan
    ELSE 'free'
  END
  FROM public.licenses l
  WHERE l.user_id = p_user_id
  LIMIT 1;
$$;

-- ============================================================
-- 6. gallery_default_expires_at(owner_user_id)
-- Call this from the booth app (main.js gallery:create handler)
-- instead of hardcoding 7 days. Returns the correct expiry
-- timestamp based on the operator's current plan.
-- ============================================================

CREATE OR REPLACE FUNCTION public.gallery_default_expires_at(p_user_id uuid)
RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT now() + (rp.gallery_expires_days || ' days')::interval
  FROM public.gallery_retention_plans rp
  WHERE rp.plan_key = public.gallery_effective_plan_key(p_user_id)
  LIMIT 1;
$$;


-- ============================================================
-- 7. PHASE 1: purge_expired_gallery_videos()
-- Runs nightly. For every gallery whose expires_at has passed
-- and whose video files have not yet been deleted, this function:
--   a) Deletes all video storage objects (burst + final video)
--   b) Clears the URL columns
--   c) Stamps videos_purged_at
-- Videos are the largest files, so they are deleted first and
-- on a shorter window than photos.
-- ============================================================

CREATE OR REPLACE FUNCTION public.purge_expired_gallery_videos()
RETURNS int   -- returns count of galleries processed
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec         RECORD;
  vurl        text;
  bucket      CONSTANT text := 'studiophotuna';
  plan_key    text;
  purge_days  int;
  processed   int := 0;
BEGIN
  FOR rec IN
    SELECT g.id,
           g.burst_video_urls,
           g.final_video_url,
           g.expires_at,
           g.owner_user_id
    FROM public.galleries g
    WHERE g.expires_at IS NOT NULL
      AND g.videos_purged_at IS NULL
    ORDER BY g.expires_at
  LOOP
    -- Determine this gallery's plan-specific purge window
    plan_key   := COALESCE(public.gallery_effective_plan_key(rec.owner_user_id), 'free');
    purge_days := COALESCE(
      (SELECT video_purge_after_days FROM public.gallery_retention_plans WHERE plan_key = plan_key),
      3  -- fallback: 3 days (matches free plan)
    );

    -- Skip if not yet past the purge window
    CONTINUE WHEN rec.expires_at + (purge_days || ' days')::interval > now();

    -- Delete burst video objects from storage
    IF rec.burst_video_urls IS NOT NULL THEN
      FOREACH vurl IN ARRAY rec.burst_video_urls LOOP
        DELETE FROM storage.objects
        WHERE bucket_id = bucket
          AND name = public.storage_path_from_url(vurl, bucket)
          AND name IS NOT NULL AND name <> '';
      END LOOP;
    END IF;

    -- Delete final video object from storage
    IF rec.final_video_url IS NOT NULL AND rec.final_video_url <> '' THEN
      DELETE FROM storage.objects
      WHERE bucket_id = bucket
        AND name = public.storage_path_from_url(rec.final_video_url, bucket)
        AND name IS NOT NULL AND name <> '';
    END IF;

    -- Stamp and clear video URL columns
    UPDATE public.galleries
    SET videos_purged_at = now(),
        burst_video_urls = '{}',
        final_video_url  = NULL
    WHERE id = rec.id;

    processed := processed + 1;
  END LOOP;

  RETURN processed;
END;
$$;


-- ============================================================
-- 8. PHASE 2: hard_delete_expired_galleries()
-- Runs nightly AFTER the video purge job.
-- For every gallery that has already had its videos purged and
-- is past the hard_delete window, this function:
--   a) Deletes all photo storage objects
--   b) Deletes the final image storage object
--   c) Hard-deletes the gallery row (cascades to nothing)
-- ============================================================

CREATE OR REPLACE FUNCTION public.hard_delete_expired_galleries()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec          RECORD;
  purl         text;
  bucket       CONSTANT text := 'studiophotuna';
  plan_key     text;
  delete_days  int;
  processed    int := 0;
BEGIN
  FOR rec IN
    SELECT g.id,
           g.photo_urls,
           g.final_url,
           g.expires_at,
           g.owner_user_id
    FROM public.galleries g
    WHERE g.expires_at IS NOT NULL
      AND g.videos_purged_at IS NOT NULL  -- Phase 1 must complete first
      AND g.archived_at IS NULL           -- not yet fully processed
    ORDER BY g.expires_at
  LOOP
    plan_key    := COALESCE(public.gallery_effective_plan_key(rec.owner_user_id), 'free');
    delete_days := COALESCE(
      (SELECT hard_delete_after_days FROM public.gallery_retention_plans WHERE plan_key = plan_key),
      14  -- fallback: 14 days (matches free plan)
    );

    CONTINUE WHEN rec.expires_at + (delete_days || ' days')::interval > now();

    -- Delete individual photo objects
    IF rec.photo_urls IS NOT NULL THEN
      FOREACH purl IN ARRAY rec.photo_urls LOOP
        DELETE FROM storage.objects
        WHERE bucket_id = bucket
          AND name = public.storage_path_from_url(purl, bucket)
          AND name IS NOT NULL AND name <> '';
      END LOOP;
    END IF;

    -- Delete final composite image
    IF rec.final_url IS NOT NULL AND rec.final_url <> '' THEN
      DELETE FROM storage.objects
      WHERE bucket_id = bucket
        AND name = public.storage_path_from_url(rec.final_url, bucket)
        AND name IS NOT NULL AND name <> '';
    END IF;

    -- Hard-delete the gallery row
    DELETE FROM public.galleries WHERE id = rec.id;

    processed := processed + 1;
  END LOOP;

  RETURN processed;
END;
$$;


-- ============================================================
-- 9. prune_stale_license_devices()
-- Runs weekly. Removes device fingerprints not seen in 90 days.
-- Prevents the license_devices table growing unboundedly for
-- operators who replace machines without deregistering.
-- ============================================================

CREATE OR REPLACE FUNCTION public.prune_stale_license_devices()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted int;
BEGIN
  WITH removed AS (
    DELETE FROM public.license_devices
    WHERE last_seen_at < now() - interval '90 days'
    RETURNING id
  )
  SELECT count(*) INTO deleted FROM removed;

  RETURN deleted;
END;
$$;


-- ============================================================
-- 10. archive_old_event_bookings()
-- Runs monthly. Two-phase for declined/cancelled bookings:
--   Phase 1 (1 year old): soft-archive — tag admin_notes.
--   Phase 2 (2 years old): hard-delete the row.
-- Also prunes booking_calendar_days rows for past dates (>1 day
-- old), since the trigger only fires on booking changes.
-- Approved/completed bookings are NEVER deleted — they are
-- business records and must be kept.
-- ============================================================

CREATE OR REPLACE FUNCTION public.archive_old_event_bookings()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  soft_archived int;
  hard_deleted  int;
  cal_pruned    int;
BEGIN
  -- Phase 1: soft-archive (tag admin_notes, row remains)
  WITH tagged AS (
    UPDATE public.event_bookings
    SET admin_notes = coalesce(admin_notes || E'\n', '')
                      || '[auto-archived ' || now()::date || ']'
    WHERE status IN ('declined', 'cancelled')
      AND created_at < now() - interval '1 year'
      AND (admin_notes IS NULL OR admin_notes NOT LIKE '%[auto-archived%')
    RETURNING id
  )
  SELECT count(*) INTO soft_archived FROM tagged;

  -- Phase 2: hard-delete (2 years old, already soft-archived)
  WITH removed AS (
    DELETE FROM public.event_bookings
    WHERE status IN ('declined', 'cancelled')
      AND created_at < now() - interval '2 years'
    RETURNING id
  )
  SELECT count(*) INTO hard_deleted FROM removed;

  -- Prune past booking_calendar_days (trigger handles future changes,
  -- but past-date rows for events > 1 day ago linger forever otherwise)
  WITH pruned AS (
    DELETE FROM public.booking_calendar_days
    WHERE event_date < current_date - interval '1 day'
    RETURNING event_date
  )
  SELECT count(*) INTO cal_pruned FROM pruned;

  RETURN jsonb_build_object(
    'soft_archived', soft_archived,
    'hard_deleted',  hard_deleted,
    'calendar_pruned', cal_pruned
  );
END;
$$;


-- ============================================================
-- 11. pg_cron SCHEDULES
-- All times are UTC. Stagger the jobs to avoid concurrent load.
--
--   02:00 UTC daily  → purge gallery videos   (Phase 1)
--   03:00 UTC daily  → hard-delete galleries  (Phase 2)
--   04:00 UTC Sunday → prune stale devices
--   04:00 UTC 1st    → archive old bookings
-- ============================================================

-- Safely remove existing schedules before re-creating (idempotent)
DO $$
BEGIN
  PERFORM cron.unschedule('photuna-purge-gallery-videos');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('photuna-hard-delete-galleries');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('photuna-prune-license-devices');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('photuna-archive-bookings');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'photuna-purge-gallery-videos',
  '0 2 * * *',
  $$SELECT public.purge_expired_gallery_videos();$$
);

SELECT cron.schedule(
  'photuna-hard-delete-galleries',
  '0 3 * * *',
  $$SELECT public.hard_delete_expired_galleries();$$
);

SELECT cron.schedule(
  'photuna-prune-license-devices',
  '0 4 * * 0',
  $$SELECT public.prune_stale_license_devices();$$
);

SELECT cron.schedule(
  'photuna-archive-bookings',
  '0 4 1 * *',
  $$SELECT public.archive_old_event_bookings();$$
);


-- ============================================================
-- 12. delete_event_storage(p_event_id)
-- Called by the booth app (main.js event:cleanupStorage handler)
-- whenever an operator manually deletes an event.
-- Deletes all storage objects whose path starts with {eventId}/
-- and hard-deletes all gallery rows for that event.
-- Returns the number of storage objects removed.
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_event_storage(p_event_id text, p_bucket text DEFAULT 'studiophotuna')
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted int;
BEGIN
  -- Remove all storage objects under this event prefix
  WITH removed AS (
    DELETE FROM storage.objects
    WHERE bucket_id = p_bucket
      AND name LIKE p_event_id || '/%'
    RETURNING id
  )
  SELECT count(*) INTO deleted FROM removed;

  -- Hard-delete gallery rows for this event (video/photo files already gone)
  DELETE FROM public.galleries WHERE event_id = p_event_id;

  RETURN deleted;
END;
$$;
