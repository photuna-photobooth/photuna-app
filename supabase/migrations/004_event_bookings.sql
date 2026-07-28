-- ============================================================
-- Studio Photuna — Event booking requests and public availability
-- Run this in: Supabase Dashboard -> SQL Editor
-- ============================================================

create table if not exists public.event_bookings (
  id                  uuid primary key default gen_random_uuid(),
  full_name           text not null,
  contact_number      text not null,
  email               text,
  package_name        text not null,
  event_date          date not null,
  start_time          time not null,
  event_type          text not null,
  estimated_guests    int,
  venue_location      text not null,
  notes               text,
  service_area        text not null default 'Metro Manila',
  status              text not null default 'pending',
  reservation_status  text not null default 'unpaid',
  reservation_paid_at timestamptz,
  approved_at         timestamptz,
  approved_by         uuid references auth.users(id) on delete set null,
  admin_notes         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint event_bookings_status_check
    check (status in ('pending', 'quoted', 'approved', 'declined', 'cancelled')),
  constraint event_bookings_reservation_status_check
    check (reservation_status in ('unpaid', 'partial_paid', 'paid', 'refunded')),
  constraint event_bookings_guests_check
    check (estimated_guests is null or estimated_guests > 0)
);

alter table public.event_bookings enable row level security;

create index if not exists event_bookings_event_date_idx
  on public.event_bookings (event_date);

create index if not exists event_bookings_status_idx
  on public.event_bookings (status, reservation_status);

drop trigger if exists event_bookings_updated_at on public.event_bookings;
create trigger event_bookings_updated_at before update on public.event_bookings
  for each row execute procedure public.set_updated_at();

-- Anyone can submit a booking request from the public website.
drop policy if exists "Public can submit event booking requests" on public.event_bookings;
create policy "Public can submit event booking requests"
  on public.event_bookings for insert
  to anon, authenticated
  with check (
    status = 'pending'
    and reservation_status = 'unpaid'
    and service_area = 'Metro Manila'
  );

-- Admins can read and manage booking requests.
drop policy if exists "Admins can read event bookings" on public.event_bookings;
create policy "Admins can read event bookings"
  on public.event_bookings for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'superadmin')
    )
  );

drop policy if exists "Admins can update event bookings" on public.event_bookings;
create policy "Admins can update event bookings"
  on public.event_bookings for update
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

drop policy if exists "Service role manages event bookings" on public.event_bookings;
create policy "Service role manages event bookings"
  on public.event_bookings for all
  to service_role
  using (true)
  with check (true);

-- Public calendar table intentionally stores only non-sensitive availability data.
create table if not exists public.booking_calendar_days (
  event_date    date primary key,
  status        text not null default 'unavailable',
  booking_id    uuid references public.event_bookings(id) on delete set null,
  package_name  text,
  updated_at    timestamptz not null default now(),
  constraint booking_calendar_days_status_check
    check (status in ('unavailable'))
);

alter table public.booking_calendar_days enable row level security;

drop policy if exists "Public can read booking availability" on public.booking_calendar_days;
create policy "Public can read booking availability"
  on public.booking_calendar_days for select
  to anon, authenticated
  using (true);

drop policy if exists "Service role manages booking availability" on public.booking_calendar_days;
create policy "Service role manages booking availability"
  on public.booking_calendar_days for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Admins can manage booking availability" on public.booking_calendar_days;
create policy "Admins can manage booking availability"
  on public.booking_calendar_days for all
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

create or replace function public.refresh_booking_calendar_day(target_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  confirmed_booking public.event_bookings%rowtype;
begin
  select *
  into confirmed_booking
  from public.event_bookings
  where event_date = target_date
    and status = 'approved'
    and reservation_status in ('partial_paid', 'paid')
  order by approved_at nulls last, created_at
  limit 1;

  if found then
    insert into public.booking_calendar_days (event_date, status, booking_id, package_name, updated_at)
    values (target_date, 'unavailable', confirmed_booking.id, confirmed_booking.package_name, now())
    on conflict (event_date) do update
      set booking_id = excluded.booking_id,
          package_name = excluded.package_name,
          updated_at = now();
  else
    delete from public.booking_calendar_days
    where event_date = target_date;
  end if;
end;
$$;

create or replace function public.sync_booking_calendar_day()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_booking_calendar_day(old.event_date);
    return old;
  end if;

  perform public.refresh_booking_calendar_day(new.event_date);

  if tg_op = 'UPDATE' and old.event_date <> new.event_date then
    perform public.refresh_booking_calendar_day(old.event_date);
  end if;

  return new;
end;
$$;

drop trigger if exists sync_booking_calendar_day on public.event_bookings;
create trigger sync_booking_calendar_day
  after insert or update or delete on public.event_bookings
  for each row execute procedure public.sync_booking_calendar_day();

-- Enable Supabase Realtime for the non-sensitive public availability table.
do $$
begin
  alter publication supabase_realtime add table public.booking_calendar_days;
exception
  when duplicate_object then null;
end $$;
