-- ============================================================
-- Studio Photuna - Admin RLS policy repair
-- Run this after any manual RLS script that made admin access stop working.
--
-- Why this exists:
-- Policies on public.profiles cannot safely check admin status by querying
-- public.profiles directly inside the policy. That can trigger recursive RLS
-- evaluation and prevent the browser from reading profiles.role.
-- ============================================================

create or replace function public.current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('admin', 'superadmin')
  );
$$;

grant execute on function public.current_user_is_admin() to authenticated;
grant execute on function public.current_user_is_admin() to service_role;

create or replace function public.protect_profile_system_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() = new.id and not public.current_user_is_admin() then
    if tg_op = 'INSERT' then
      new.role := 'user';
      new.subscription_plan := coalesce(new.subscription_plan, 'free');
    else
      new.role := old.role;
      new.subscription_plan := old.subscription_plan;
      new.stripe_customer_id := old.stripe_customer_id;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_self_role_change on public.profiles;
drop trigger if exists protect_profile_system_fields on public.profiles;
create trigger protect_profile_system_fields
  before insert or update on public.profiles
  for each row execute function public.protect_profile_system_fields();

-- ------------------------------------------------------------
-- Remove recursive / duplicate policies from manual RLS scripts.
-- ------------------------------------------------------------
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_select_admin" on public.profiles;
drop policy if exists "Users can read own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists "Users can insert own profile" on public.profiles;
drop policy if exists "Admins can read profiles" on public.profiles;
drop policy if exists "Admins can update profiles" on public.profiles;

drop policy if exists "licenses_select_own" on public.licenses;
drop policy if exists "licenses_select_admin" on public.licenses;
drop policy if exists "licenses_update_admin" on public.licenses;
drop policy if exists "Users can read own license" on public.licenses;
drop policy if exists "Admins can read licenses" on public.licenses;
drop policy if exists "Admins can update licenses" on public.licenses;

drop policy if exists "event_bookings_select_admin" on public.event_bookings;
drop policy if exists "event_bookings_update_admin" on public.event_bookings;
drop policy if exists "event_bookings_delete_admin" on public.event_bookings;
drop policy if exists "Admins can read event bookings" on public.event_bookings;
drop policy if exists "Admins can update event bookings" on public.event_bookings;
drop policy if exists "Admins can delete event bookings" on public.event_bookings;

drop policy if exists "public_reviews_select_admin" on public.public_reviews;
drop policy if exists "public_reviews_update_admin" on public.public_reviews;
drop policy if exists "Admins can manage reviews" on public.public_reviews;

drop policy if exists "booking_calendar_write_admin" on public.booking_calendar_days;
drop policy if exists "Admins can manage booking availability" on public.booking_calendar_days;

-- ------------------------------------------------------------
-- Profiles
-- ------------------------------------------------------------
alter table public.profiles enable row level security;

create policy "Users can read own profile"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id or public.current_user_is_admin());

create policy "Users can insert own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id or public.current_user_is_admin())
  with check (auth.uid() = id or public.current_user_is_admin());

-- ------------------------------------------------------------
-- Licenses
-- ------------------------------------------------------------
alter table public.licenses enable row level security;

create policy "Users can read own license"
  on public.licenses for select
  to authenticated
  using (auth.uid() = user_id or public.current_user_is_admin());

create policy "Admins can update licenses"
  on public.licenses for update
  to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- Keep existing service_role policy from 001_initial_schema.sql if present.

-- ------------------------------------------------------------
-- Event bookings
-- ------------------------------------------------------------
alter table public.event_bookings enable row level security;

create policy "Admins can read event bookings"
  on public.event_bookings for select
  to authenticated
  using (public.current_user_is_admin());

create policy "Admins can update event bookings"
  on public.event_bookings for update
  to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

create policy "Admins can delete event bookings"
  on public.event_bookings for delete
  to authenticated
  using (public.current_user_is_admin());

-- ------------------------------------------------------------
-- Public reviews
-- ------------------------------------------------------------
alter table public.public_reviews enable row level security;

create policy "Admins can manage reviews"
  on public.public_reviews for all
  to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- ------------------------------------------------------------
-- Booking calendar availability
-- ------------------------------------------------------------
alter table public.booking_calendar_days enable row level security;

create policy "Admins can manage booking availability"
  on public.booking_calendar_days for all
  to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());
