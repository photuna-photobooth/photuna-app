-- ============================================================
-- Photuna — Migration 012: GDPR Compliance Fixes
--
-- Covers:
--   1. public_reviews — remove email from public-read RLS
--   2. event_bookings — add retention for approved/completed bookings
--   3. public_reviews — add retention (3 years)
--   4. booth_consent_logs — new table to record booth-user consent
-- ============================================================


-- ============================================================
-- 1. PUBLIC REVIEWS — remove email from public-facing reads
-- The "Public can read approved reviews" policy currently allows
-- anon and authenticated callers to read ALL columns including
-- email. Email is PII and must not be exposed to the public.
-- Fix: replace the policy with a column-level restriction via
-- a security-definer view, or drop and recreate the policy to
-- exclude email from the select list.
--
-- Supabase RLS policies cannot restrict which columns are
-- returned (column security is separate from row security).
-- The correct approach is a VIEW that excludes email, exposed
-- for public reads only.
-- ============================================================

-- Create a public-facing view that omits email
CREATE OR REPLACE VIEW public.public_reviews_public AS
  SELECT
    id,
    name,
    rating,
    review_text,
    event_type,
    source,
    is_featured,
    approved_at,
    created_at
  FROM public.public_reviews
  WHERE status = 'approved';

-- Grant anon + authenticated access to the view only
GRANT SELECT ON public.public_reviews_public TO anon, authenticated;

-- Revoke direct anon access to the underlying table (authenticated
-- users still need access for the "Users can read own reviews" policy)
REVOKE SELECT ON public.public_reviews FROM anon;

-- Tighten the public RLS policy to prevent anon reads on the base table.
-- (anon should use the view; authenticated users are covered by own-row policy)
DROP POLICY IF EXISTS "Public can read approved reviews" ON public.public_reviews;
CREATE POLICY "Public can read approved reviews"
  ON public.public_reviews FOR SELECT
  TO authenticated
  USING (status = 'approved');


-- ============================================================
-- 2. EVENT BOOKINGS — retention for approved/completed bookings
-- The archive_old_event_bookings() function (migration 008) only
-- handles declined/cancelled bookings. Approved and completed
-- bookings must also be deleted after a defined period.
--
-- Retention policy: pseudonymise PII after 2 years, hard-delete
-- after 5 years. Pseudonymisation (replacing name/phone/email
-- with hashed tokens) preserves business analytics while
-- removing the link to the individual.
-- ============================================================

CREATE OR REPLACE FUNCTION public.archive_old_event_bookings()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  soft_archived    int;
  hard_deleted     int;
  cal_pruned       int;
  pseudonymised    int;
  hard_deleted_old int;
BEGIN
  -- Phase 1: soft-archive (tag admin_notes, row remains) — declined/cancelled only
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

  -- Phase 2: hard-delete declined/cancelled bookings older than 2 years
  WITH removed AS (
    DELETE FROM public.event_bookings
    WHERE status IN ('declined', 'cancelled')
      AND created_at < now() - interval '2 years'
    RETURNING id
  )
  SELECT count(*) INTO hard_deleted FROM removed;

  -- Phase 3: pseudonymise PII from approved/completed bookings older than 2 years.
  -- Replaces name, phone, email, venue with anonymised tokens so the row remains
  -- for business reporting without retaining identifying information.
  WITH anon AS (
    UPDATE public.event_bookings
    SET
      full_name        = 'Anonymised Guest ' || left(md5(full_name || id::text), 8),
      contact_number   = 'REDACTED',
      email            = CASE WHEN email IS NOT NULL
                           THEN 'redacted-' || left(md5(email || id::text), 8) || '@removed.invalid'
                           ELSE NULL END,
      venue_location   = left(venue_location, 20) || '...',
      admin_notes      = coalesce(admin_notes || E'\n', '')
                         || '[pii-pseudonymised ' || now()::date || ']'
    WHERE status IN ('approved', 'completed', 'pending')
      AND created_at < now() - interval '2 years'
      AND admin_notes NOT LIKE '%[pii-pseudonymised%'
    RETURNING id
  )
  SELECT count(*) INTO pseudonymised FROM anon;

  -- Phase 4: hard-delete approved/completed bookings older than 5 years
  WITH removed_old AS (
    DELETE FROM public.event_bookings
    WHERE status IN ('approved', 'completed', 'pending')
      AND created_at < now() - interval '5 years'
    RETURNING id
  )
  SELECT count(*) INTO hard_deleted_old FROM removed_old;

  -- Prune past booking_calendar_days rows
  WITH pruned AS (
    DELETE FROM public.booking_calendar_days
    WHERE event_date < current_date - interval '1 day'
    RETURNING event_date
  )
  SELECT count(*) INTO cal_pruned FROM pruned;

  RETURN jsonb_build_object(
    'soft_archived',        soft_archived,
    'hard_deleted',         hard_deleted,
    'pseudonymised',        pseudonymised,
    'hard_deleted_old',     hard_deleted_old,
    'calendar_pruned',      cal_pruned
  );
END;
$$;


-- ============================================================
-- 3. PUBLIC REVIEWS — add retention (3 years)
-- No retention policy existed for approved reviews.
-- Reviews older than 3 years are deleted.
-- ============================================================

CREATE OR REPLACE FUNCTION public.prune_old_public_reviews()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted int;
BEGIN
  WITH removed AS (
    DELETE FROM public.public_reviews
    WHERE created_at < now() - interval '3 years'
    RETURNING id
  )
  SELECT count(*) INTO deleted FROM removed;
  RETURN deleted;
END;
$$;

-- Schedule: run on the 1st of each month at 04:30 UTC
SELECT cron.schedule(
  'photuna-prune-old-reviews',
  '30 4 1 * *',
  $$SELECT public.prune_old_public_reviews()$$
);


-- ============================================================
-- 4. BOOTH CONSENT LOGS — record booth-user consent
-- Every time a booth user accepts the privacy notice, a row
-- is inserted here. Retained until gallery hard-delete fires
-- (matched on session_id). Required under GDPR Art. 7(1) —
-- the controller must be able to demonstrate that consent
-- was given.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.booth_consent_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      text NOT NULL,
  event_id        text NOT NULL,
  booth_id        text,
  consent_version text NOT NULL DEFAULT '1.0',
  ip_hash         text,
  consented_at    timestamptz NOT NULL DEFAULT now(),
  withdrawn_at    timestamptz,
  CONSTRAINT booth_consent_logs_session_unique UNIQUE (session_id)
);

ALTER TABLE public.booth_consent_logs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS booth_consent_logs_event_idx
  ON public.booth_consent_logs (event_id, consented_at DESC);

CREATE INDEX IF NOT EXISTS booth_consent_logs_session_idx
  ON public.booth_consent_logs (session_id);

-- Only the service role (booth backend) writes consent logs.
-- Operators can read consent logs for their own events via the admin client.
DROP POLICY IF EXISTS "Service role manages consent logs" ON public.booth_consent_logs;
CREATE POLICY "Service role manages consent logs"
  ON public.booth_consent_logs FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- pg_cron: delete consent logs for sessions whose gallery has been hard-deleted.
-- Consent logs are retained as long as the gallery exists, then cleaned up.
CREATE OR REPLACE FUNCTION public.prune_orphaned_consent_logs()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted int;
BEGIN
  WITH removed AS (
    DELETE FROM public.booth_consent_logs bcl
    WHERE NOT EXISTS (
      SELECT 1 FROM public.galleries g WHERE g.session_id = bcl.session_id
    )
    AND consented_at < now() - interval '30 days'
    RETURNING bcl.id
  )
  SELECT count(*) INTO deleted FROM removed;
  RETURN deleted;
END;
$$;

SELECT cron.schedule(
  'photuna-prune-consent-logs',
  '45 3 * * *',
  $$SELECT public.prune_orphaned_consent_logs()$$
);
-- Add terms_accepted_at to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz;
