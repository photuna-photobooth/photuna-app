-- ============================================================
-- Photuna App — Fix licenses table constraints & missing columns
-- Run this in: Supabase Dashboard → SQL Editor
-- Safe to run on any existing database (all statements are idempotent).
-- ============================================================

-- Ensure user_id has the UNIQUE constraint required for upsert with onConflict.
-- This is a no-op if the constraint already exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.licenses'::regclass
      AND contype = 'u'
      AND conname = 'licenses_user_id_key'
  ) THEN
    ALTER TABLE public.licenses ADD CONSTRAINT licenses_user_id_key UNIQUE (user_id);
  END IF;
END $$;

-- Add any columns that may be missing from older manual installs
ALTER TABLE public.licenses ADD COLUMN IF NOT EXISTS watermark          boolean not null default true;
ALTER TABLE public.licenses ADD COLUMN IF NOT EXISTS max_events         int     not null default 1;
ALTER TABLE public.licenses ADD COLUMN IF NOT EXISTS templates          int     not null default 1;
ALTER TABLE public.licenses ADD COLUMN IF NOT EXISTS priority_support   boolean not null default false;
ALTER TABLE public.licenses ADD COLUMN IF NOT EXISTS gallery_addon      boolean not null default false;
ALTER TABLE public.licenses ADD COLUMN IF NOT EXISTS trial_redeemed     boolean not null default false;
ALTER TABLE public.licenses ADD COLUMN IF NOT EXISTS stripe_subscription_id text;
ALTER TABLE public.licenses ADD COLUMN IF NOT EXISTS stripe_gallery_subscription_id text;
ALTER TABLE public.licenses ADD COLUMN IF NOT EXISTS stripe_customer_id   text;
ALTER TABLE public.licenses ADD COLUMN IF NOT EXISTS expires_at         timestamptz;

-- Normalize legacy entitlement values from earlier development builds.
UPDATE public.licenses
SET max_events = 100,
    templates = 25,
    watermark = false,
    priority_support = false
WHERE plan = 'monthly'
  AND (max_events > 100 OR templates > 25);

UPDATE public.licenses
SET max_events = 1200,
    templates = 100,
    watermark = false,
    priority_support = true
WHERE plan = 'yearly'
  AND (max_events > 1200 OR templates > 100);

UPDATE public.licenses
SET max_events = 3,
    templates = 5,
    watermark = true,
    priority_support = false
WHERE plan = 'trial';

-- Ensure profiles has subscription_plan column
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS subscription_plan text not null default 'free';

-- Add INSERT policy on profiles so authenticated users can upsert their own row.
-- (The auto-created trigger handles signup, but a belt-and-suspenders INSERT policy
--  prevents RLS from blocking upsert calls made from the client.)
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Drop and recreate the service-role write policy to ensure it covers INSERT/UPDATE
DROP POLICY IF EXISTS "Service role manages licenses" ON public.licenses;
CREATE POLICY "Service role manages licenses"
  ON public.licenses FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- Storage: avatars bucket
-- The bucket is created via Supabase Dashboard or CLI.
-- These policies allow the service role (used by the embedded
-- API server) to upload/overwrite any avatar, and allow anyone
-- to read public avatar URLs.
-- ============================================================

-- Allow service_role to upload/update any avatar (the embedded server does this).
DROP POLICY IF EXISTS "Service role manages avatars" ON storage.objects;
CREATE POLICY "Service role manages avatars"
  ON storage.objects FOR ALL
  TO service_role
  USING (bucket_id = 'avatars')
  WITH CHECK (bucket_id = 'avatars');

-- Allow authenticated users to read their own avatar.
DROP POLICY IF EXISTS "Authenticated users can read avatars" ON storage.objects;
CREATE POLICY "Authenticated users can read avatars"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'avatars');

-- Allow public (anon) read so avatar_url works in <img> tags without auth headers.
DROP POLICY IF EXISTS "Public can read avatars" ON storage.objects;
CREATE POLICY "Public can read avatars"
  ON storage.objects FOR SELECT
  TO anon
  USING (bucket_id = 'avatars');
