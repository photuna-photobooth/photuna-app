-- ============================================================
-- Studio Photuna - Booking quote fields
-- Run this after 004_event_bookings.sql
-- ============================================================

alter table public.event_bookings
  add column if not exists package_price int,
  add column if not exists extra_hours int not null default 0,
  add column if not exists extra_hour_rate int,
  add column if not exists extra_hours_total int not null default 0,
  add column if not exists estimated_total int;

alter table public.event_bookings
  drop constraint if exists event_bookings_extra_hours_check,
  add constraint event_bookings_extra_hours_check
    check (extra_hours between 0 and 3);

alter table public.event_bookings
  drop constraint if exists event_bookings_quote_amounts_check,
  add constraint event_bookings_quote_amounts_check
    check (
      (package_price is null or package_price >= 0)
      and (extra_hour_rate is null or extra_hour_rate >= 0)
      and extra_hours_total >= 0
      and (estimated_total is null or estimated_total >= 0)
    );
