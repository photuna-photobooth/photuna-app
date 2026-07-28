-- 011_pg_cron_auto_expire.sql
--
-- Problem: the BEFORE trigger on licenses only fires when a row is written.
-- If nobody touches the row after current_period_end passes, the DB stays
-- stale (plan='monthly', state='active') indefinitely.
--
-- Fix: schedule a pg_cron job that runs every 30 minutes and does a no-op
-- UPDATE on any license whose current_period_end has lapsed. The no-op
-- triggers the existing BEFORE trigger (lock_expires_at_to_period_end) which
-- sets plan='free', state='expired', and all entitlement columns, then the
-- AFTER trigger (licenses_sync_profile_plan) syncs profiles.subscription_plan.
-- No application code or manual admin check is needed.

-- ── Enable pg_cron ──────────────────────────────────────────────────────────
-- pg_cron is available on all Supabase projects. Enabling it here is
-- idempotent — safe to run even if it was already enabled.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- Grant usage so the cron jobs can call functions in the public schema.
GRANT USAGE ON SCHEMA cron TO postgres;

-- ── Remove previous job if it was registered under the same name ────────────
SELECT cron.unschedule('photuna-expire-licenses')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'photuna-expire-licenses'
);

-- ── Schedule the expiry sweep ────────────────────────────────────────────────
-- Runs every 30 minutes. Adjust to '0 * * * *' (hourly) if you prefer.
-- The UPDATE is a no-op in terms of data — it sets current_period_end to its
-- own value — but it makes Postgres fire the ROW BEFORE UPDATE trigger, which
-- is where the real logic lives.
SELECT cron.schedule(
  'photuna-expire-licenses',
  '*/30 * * * *',
  $$
  UPDATE public.licenses
  SET    current_period_end = current_period_end
  WHERE  current_period_end IS NOT NULL
    AND  current_period_end < now()
    AND  plan != 'free'
    AND  state NOT IN ('expired', 'canceled');
  $$
);

-- ── (Optional) also sweep active pro_* plans that have wrong entitlements ───
-- This is a one-time repair for rows that were set to pro_yearly / pro_monthly
-- before migration 010's trigger handled those plan keys. Safe to run again —
-- it is a no-op for rows that already have correct entitlements because the
-- trigger only writes columns when the values differ from NEW.*.
SELECT cron.schedule(
  'photuna-repair-pro-entitlements',
  '0 3 * * *',   -- once a day at 03:00 UTC
  $$
  UPDATE public.licenses
  SET    current_period_end = current_period_end
  WHERE  plan IN ('pro_yearly', 'pro_monthly', 'pro')
    AND  state = 'active'
    AND  current_period_end IS NOT NULL
    AND  current_period_end >= now()
    AND  (max_events = 0 OR watermark = true);
  $$
);
