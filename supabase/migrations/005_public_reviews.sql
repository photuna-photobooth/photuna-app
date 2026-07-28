-- ============================================================
-- Studio Photuna — Public reviews with admin moderation
-- Run this in: Supabase Dashboard -> SQL Editor
-- ============================================================

create table if not exists public.public_reviews (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete set null,
  name          text not null,
  email         text,
  rating        int not null,
  review_text   text not null,
  event_type    text,
  source        text not null default 'website',
  status        text not null default 'pending',
  is_featured   boolean not null default false,
  admin_notes   text,
  approved_at   timestamptz,
  approved_by   uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint public_reviews_rating_check check (rating between 1 and 5),
  constraint public_reviews_status_check check (status in ('pending', 'approved', 'hidden', 'rejected')),
  constraint public_reviews_source_check check (source in ('website', 'google_manual', 'admin'))
);

alter table public.public_reviews enable row level security;

create index if not exists public_reviews_status_featured_idx
  on public.public_reviews (status, is_featured, created_at desc);

alter table public.public_reviews add column if not exists user_id uuid references auth.users(id) on delete set null;

create unique index if not exists public_reviews_one_per_user_idx
  on public.public_reviews (user_id)
  where user_id is not null;

drop trigger if exists public_reviews_updated_at on public.public_reviews;
create trigger public_reviews_updated_at before update on public.public_reviews
  for each row execute procedure public.set_updated_at();

-- Signed-in users can submit one review. It is always pending by default.
drop policy if exists "Public can submit reviews" on public.public_reviews;
drop policy if exists "Authenticated users can submit one review" on public.public_reviews;
create policy "Authenticated users can submit one review"
  on public.public_reviews for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and
    status = 'pending'
    and is_featured = false
    and source = 'website'
  );

drop policy if exists "Users can read own reviews" on public.public_reviews;
create policy "Users can read own reviews"
  on public.public_reviews for select
  to authenticated
  using (auth.uid() = user_id);

-- Public website can only read approved reviews.
drop policy if exists "Public can read approved reviews" on public.public_reviews;
create policy "Public can read approved reviews"
  on public.public_reviews for select
  to anon, authenticated
  using (status = 'approved');

-- Admins can read and moderate all reviews.
drop policy if exists "Admins can manage reviews" on public.public_reviews;
create policy "Admins can manage reviews"
  on public.public_reviews for all
  to authenticated
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'superadmin')
    )
  )
  with check (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'superadmin')
    )
  );

drop policy if exists "Service role manages reviews" on public.public_reviews;
create policy "Service role manages reviews"
  on public.public_reviews for all
  to service_role
  using (true)
  with check (true);

-- Enable Realtime for live homepage refreshes when reviews are approved.
do $$
begin
  alter publication supabase_realtime add table public.public_reviews;
exception
  when duplicate_object then null;
end $$;
