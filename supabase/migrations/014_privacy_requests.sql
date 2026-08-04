-- ============================================================
-- Photuna — Migration 014: Data Subject Rights Request Table
--
-- Creates the privacy_requests table that stores GDPR / RA 10173
-- data subject rights requests submitted by booth guests or
-- operators via the /privacy-request page.
--
-- GDPR Art. 12(2) requires the controller to facilitate
-- exercise of data subject rights. This table provides the
-- backend for the self-service request form.
--
-- Response deadline: 30 calendar days (Art. 12(3) GDPR).
-- ============================================================


-- ============================================================
-- 1. privacy_requests table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.privacy_requests (
  id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at         timestamptz  NOT NULL DEFAULT now(),

  -- Request details
  request_type       text         NOT NULL
                       CHECK (request_type IN (
                         'access',       -- Art. 15 — right of access
                         'erasure',      -- Art. 17 — right to erasure
                         'correction',   -- Art. 16 — right to rectification
                         'portability',  -- Art. 20 — right to data portability
                         'objection'     -- Art. 21 — right to object
                       )),
  requester_name     text         NOT NULL,
  requester_email    text         NOT NULL,

  -- Location info to find the session
  event_date         date,
  event_venue        text,
  session_description text,

  -- Processing state
  status             text         NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'in_progress', 'completed', 'rejected')),
  identity_verified  boolean      NOT NULL DEFAULT false,
  responded_at       timestamptz,
  resolved_at        timestamptz,
  notes              text,        -- internal DPO notes only

  -- Deadline tracking (GDPR Art. 12(3): respond within 30 days)
  -- Computed as created_at + 30 days; stored explicitly on insert via trigger.
  deadline_at        timestamptz  NOT NULL DEFAULT (now() + interval '30 days')
);

CREATE INDEX IF NOT EXISTS privacy_requests_status_idx
  ON public.privacy_requests (status)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS privacy_requests_created_idx
  ON public.privacy_requests (created_at DESC);


-- ============================================================
-- 2. Row Level Security
-- Anyone can submit; only service_role can read/update.
-- ============================================================

ALTER TABLE public.privacy_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can submit a privacy request"
  ON public.privacy_requests FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Service role full access to privacy_requests"
  ON public.privacy_requests FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Prevent anonymous reads — requester cannot poll their own
-- request status (contact by email is the stated channel).
REVOKE SELECT ON public.privacy_requests FROM anon, authenticated;


-- ============================================================
-- 3. alert_overdue_privacy_requests()
-- Monthly cron that flags requests past the 30-day deadline
-- so the DPO can take action.
-- ============================================================

CREATE OR REPLACE FUNCTION public.alert_overdue_privacy_requests()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  overdue_count int;
BEGIN
  SELECT count(*) INTO overdue_count
  FROM public.privacy_requests
  WHERE status IN ('pending', 'in_progress')
    AND deadline_at < now();

  -- If pg_net or notify is wired up in the future, send an alert here.
  -- For now this count is returned and visible in cron logs.
  RETURN overdue_count;
END;
$$;

SELECT cron.schedule(
  'photuna-alert-overdue-privacy-requests',
  '0 9 * * 1',   -- every Monday at 09:00 UTC
  $$SELECT public.alert_overdue_privacy_requests()$$
);
