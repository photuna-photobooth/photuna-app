-- 010_expiry_state_entitlement_sync.sql
--
-- Problem: when current_period_end is set to a past date the trigger in 009
-- correctly updates expires_at, but licenses.state and the entitlement columns
-- (max_events, watermark, templates, priority_support) remain stale, and
-- profiles.subscription_plan is never touched.
--
-- Fix:
--   1. Expand the lock_expires_at_to_period_end() trigger so it also sets
--      state='expired' and free-plan entitlement values when
--      current_period_end < now(), and restores plan entitlements + state
--      when current_period_end is set to a future date (re-activation).
--   2. Add a second trigger on licenses that keeps profiles.subscription_plan
--      in sync whenever state or plan changes.
--   3. Back-fill any rows that are already expired so the dashboard is
--      consistent right after the migration runs.

-- ── 1. Expand the expiry trigger ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lock_expires_at_to_period_end()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Nothing to do when current_period_end is not set.
  IF NEW.current_period_end IS NULL THEN
    RETURN NEW;
  END IF;

  -- Always keep expires_at in sync with current_period_end.
  NEW.expires_at := NEW.current_period_end;

  IF NEW.current_period_end < now() THEN
    -- ── Expired ──────────────────────────────────────────────────
    -- plan is set to 'free' so every column reflects the effective
    -- (post-expiry) subscription, including profiles.subscription_plan
    -- which is synced by the licenses_sync_profile_plan trigger below.
    NEW.plan             := 'free';
    NEW.state            := 'expired';
    NEW.watermark        := true;
    NEW.max_events       := 0;
    NEW.templates        := 0;
    NEW.priority_support := false;
  ELSE
    -- ── Active / re-activated ─────────────────────────────────────
    -- Only reset state if it was previously expired or canceled.
    IF NEW.state IN ('expired', 'canceled') THEN
      NEW.state := 'active';
    END IF;

    -- Restore entitlement columns to match the stored plan.
    -- NEW.plan is whatever the caller passed in the upsert (e.g. 'monthly').
    -- pro_yearly / pro_monthly are aliases for yearly / monthly respectively.
    CASE
      WHEN NEW.plan IN ('yearly', 'pro_yearly') THEN
        NEW.watermark        := false;
        NEW.max_events       := 50;
        NEW.templates        := 100;
        NEW.priority_support := true;
      WHEN NEW.plan IN ('monthly', 'pro_monthly', 'pro') THEN
        NEW.watermark        := false;
        NEW.max_events       := 20;
        NEW.templates        := 30;
        NEW.priority_support := false;
      WHEN NEW.plan = 'trial' THEN
        NEW.watermark        := true;
        NEW.max_events       := 3;
        NEW.templates        := 5;
        NEW.priority_support := false;
      ELSE
        -- free or unknown
        NEW.watermark        := true;
        NEW.max_events       := 0;
        NEW.templates        := 0;
        NEW.priority_support := false;
    END CASE;
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger already exists from 009; DROP + recreate to pick up the new function body.
DROP TRIGGER IF EXISTS licenses_lock_expires_at ON public.licenses;
CREATE TRIGGER licenses_lock_expires_at
  BEFORE INSERT OR UPDATE ON public.licenses
  FOR EACH ROW
  EXECUTE FUNCTION public.lock_expires_at_to_period_end();


-- ── 2. Trigger: keep profiles.subscription_plan in sync ────────────────────
CREATE OR REPLACE FUNCTION public.sync_profile_subscription_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET subscription_plan = CASE
    WHEN NEW.state IN ('expired', 'canceled') THEN 'free'
    ELSE COALESCE(NEW.plan, 'free')
  END
  WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS licenses_sync_profile_plan ON public.licenses;
CREATE TRIGGER licenses_sync_profile_plan
  AFTER INSERT OR UPDATE OF state, plan ON public.licenses
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_subscription_plan();


-- ── 3. Back-fill existing expired rows ─────────────────────────────────────
-- Update licenses where expires_at is already in the past.
UPDATE public.licenses
SET
  plan             = 'free',
  state            = 'expired',
  watermark        = true,
  max_events       = 0,
  templates        = 0,
  priority_support = false
WHERE
  expires_at IS NOT NULL
  AND expires_at < now()
  AND plan != 'free'
  AND state NOT IN ('expired', 'canceled');

-- Sync profiles for every license we just marked expired
-- (the AFTER trigger above fires only on future UPDATEs, not this batch).
UPDATE public.profiles p
SET subscription_plan = 'free'
FROM public.licenses l
WHERE l.user_id = p.id
  AND l.state = 'expired'
  AND p.subscription_plan != 'free';
