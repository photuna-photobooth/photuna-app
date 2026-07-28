-- 009_current_period_end_lock.sql
--
-- Adds current_period_end to public.licenses (the admin-set, authoritative
-- expiry date based on actual payment), and a BEFORE trigger that keeps
-- expires_at in sync with it automatically.
--
-- Why: the application code re-computes expires_at as now()+30d every time
-- it writes the license row (e.g. on plan activation). If an admin has already
-- set the real expiry in current_period_end, that date must win regardless of
-- whatever the app calculates.
--
-- Result: writing current_period_end = '2026-07-06' will always force
-- expires_at to that same value, even if the upsert passes a different
-- expires_at.  If current_period_end is NULL the trigger is a no-op and the
-- app's computed value is used as normal.

ALTER TABLE public.licenses
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz;

-- Copy any existing expires_at value as the initial current_period_end so
-- rows already in the DB are consistent on migration.
UPDATE public.licenses
SET current_period_end = expires_at
WHERE current_period_end IS NULL AND expires_at IS NOT NULL;

-- ── Trigger function ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lock_expires_at_to_period_end()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- If the admin has set a current_period_end, it is the authoritative expiry.
  -- Override whatever expires_at the application just wrote.
  IF NEW.current_period_end IS NOT NULL THEN
    NEW.expires_at := NEW.current_period_end;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS licenses_lock_expires_at ON public.licenses;
CREATE TRIGGER licenses_lock_expires_at
  BEFORE INSERT OR UPDATE ON public.licenses
  FOR EACH ROW
  EXECUTE FUNCTION public.lock_expires_at_to_period_end();
