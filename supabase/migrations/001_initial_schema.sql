-- ============================================================
-- Photuna App — Initial Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor
-- ============================================================

-- ------------------------------------------------------------
-- PROFILES
-- One row per auth.users entry. Auto-created by trigger below.
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  full_name          text,
  email              text,
  phone              text,
  company            text,
  avatar_url         text,
  role               text not null default 'user',          -- 'user' | 'admin' | 'superadmin'
  subscription_plan  text not null default 'free',
  stripe_customer_id text unique,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can read own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- updated_at auto-stamp
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles
  for each row execute procedure public.set_updated_at();

-- ------------------------------------------------------------
-- LICENSES
-- One row per user. Managed by the licensing API.
-- ------------------------------------------------------------
create table if not exists public.licenses (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null unique references auth.users(id) on delete cascade,
  plan                  text not null default 'free',   -- free | trial | monthly | yearly
  state                 text not null default 'active', -- active | trialing | past_due | cancelled | expired | cancelling
  expires_at            timestamptz,
  watermark             boolean not null default true,
  max_events            int not null default 1,
  templates             int not null default 1,
  priority_support      boolean not null default false,
  gallery_addon         boolean not null default false,
  trial_redeemed        boolean not null default false,
  stripe_subscription_id text unique,
  stripe_gallery_subscription_id text unique,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table public.licenses enable row level security;

create policy "Users can read own license"
  on public.licenses for select
  using (auth.uid() = user_id);

-- Only the service role (backend) can write licenses
create policy "Service role manages licenses"
  on public.licenses for all
  using (auth.role() = 'service_role');

create trigger licenses_updated_at before update on public.licenses
  for each row execute procedure public.set_updated_at();

-- ------------------------------------------------------------
-- LICENSE DEVICES
-- Tracks which devices a user has attached their license to.
-- ------------------------------------------------------------
create table if not exists public.license_devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  fingerprint  text not null,
  platform     text not null default 'unknown',
  last_seen_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (user_id, fingerprint)
);

alter table public.license_devices enable row level security;

create policy "Users can read own devices"
  on public.license_devices for select
  using (auth.uid() = user_id);

create policy "Service role manages devices"
  on public.license_devices for all
  using (auth.role() = 'service_role');

-- ------------------------------------------------------------
-- BOOTHS
-- Physical booth registrations with heartbeat tracking.
-- ------------------------------------------------------------
create table if not exists public.booths (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null default 'My Booth',
  fingerprint  text unique,
  platform     text,
  app_version  text,
  is_online    boolean not null default false,
  last_seen_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.booths enable row level security;

create policy "Users can manage own booths"
  on public.booths for all
  using (auth.uid() = user_id);

create trigger booths_updated_at before update on public.booths
  for each row execute procedure public.set_updated_at();

-- ------------------------------------------------------------
-- GALLERIES
-- Session photo/video records with time-limited public access.
-- ------------------------------------------------------------
create table if not exists public.galleries (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique,
  event_id         text,
  session_id       text,
  final_url        text,
  final_video_url  text,
  photo_urls       text[] not null default '{}',
  burst_video_urls text[] not null default '{}',
  expires_at       timestamptz,
  created_at       timestamptz not null default now()
);

alter table public.galleries enable row level security;

-- Public read for gallery sharing links (no auth required)
create policy "Public can read non-expired galleries"
  on public.galleries for select
  using (expires_at is null or expires_at > now());

-- Service role / authenticated users can insert/update
create policy "Authenticated can upsert galleries"
  on public.galleries for insert
  with check (auth.role() in ('authenticated', 'service_role'));

create policy "Authenticated can update galleries"
  on public.galleries for update
  using (auth.role() in ('authenticated', 'service_role'));

-- ------------------------------------------------------------
-- BOOTH SETTINGS
-- Synced copy of electron-store data (events, templates, etc.)
-- ------------------------------------------------------------
create table if not exists public.booth_settings (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references auth.users(id) on delete cascade,
  settings    jsonb not null default '{}',
  appearance  jsonb not null default '{}',
  events      jsonb not null default '[]',
  templates   jsonb not null default '[]',
  frames      jsonb not null default '[]',
  palettes    jsonb not null default '[]',
  synced_at   timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.booth_settings enable row level security;

create policy "Users can manage own booth settings"
  on public.booth_settings for all
  using (auth.uid() = user_id);

create trigger booth_settings_updated_at before update on public.booth_settings
  for each row execute procedure public.set_updated_at();

-- ------------------------------------------------------------
-- SAFE ALTER for existing databases (idempotent — run on upgrade)
-- ------------------------------------------------------------
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists company text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.licenses add column if not exists stripe_subscription_id text unique;
alter table public.booth_settings add column if not exists frames jsonb not null default '[]';

-- ------------------------------------------------------------
-- STORAGE BUCKET: studiophotuna
-- Create via dashboard or uncomment if using Supabase CLI:
-- ------------------------------------------------------------
-- insert into storage.buckets (id, name, public)
-- values ('studiophotuna', 'studiophotuna', true)
-- on conflict (id) do nothing;

-- Storage policy: only authenticated users can upload
-- create policy "Authenticated upload"
--   on storage.objects for insert
--   with check (bucket_id = 'studiophotuna' and auth.role() = 'authenticated');

-- Storage policy: public read for gallery images
-- create policy "Public read gallery images"
--   on storage.objects for select
--   using (bucket_id = 'studiophotuna');
