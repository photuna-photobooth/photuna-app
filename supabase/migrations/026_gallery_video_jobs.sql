-- Groundwork for rendering the gallery motion clip off the booth.
--
-- The booth currently encodes the clip itself with a bundled FFmpeg. That
-- cannot work on iPadOS or Android, where an app may not execute a bundled
-- binary, and it is also what obliges us to distribute GPL software. Moving
-- the encode to a service means the booth only uploads the raw burst clips it
-- already uploads today.
--
-- This migration adds only the job state. Nothing reads it yet, so it changes
-- no behaviour on its own, and the booth keeps making the clip exactly as
-- before until the renderer is proven.
--
-- Safety: every row that exists today is marked finished — 'ready' if it has
-- its video, 'skipped' if it never will. Nothing pre-existing becomes work.
-- And a row written by today's booth arrives with final_video_url already set,
-- which the claim excludes, so the renderer can run safely before the booth
-- changes.

alter table public.galleries
  add column if not exists video_status     text        not null default 'pending',
  add column if not exists video_attempts   int         not null default 0,
  add column if not exists video_claimed_at timestamptz,
  add column if not exists video_error      text;

update public.galleries
   set video_status = case when final_video_url is not null then 'ready' else 'skipped' end
 where video_status = 'pending';

alter table public.galleries drop constraint if exists galleries_video_status_check;
alter table public.galleries add constraint galleries_video_status_check
  check (video_status in ('pending','processing','ready','failed','skipped'));

-- The sweeper only ever looks for outstanding work, so the index covers only that.
create index if not exists galleries_video_outstanding_idx
  on public.galleries (created_at)
  where video_status in ('pending','processing');

comment on column public.galleries.video_status is
  'Motion-clip render state: pending | processing | ready | failed | skipped.';

-- ── Claiming ────────────────────────────────────────────────────────────────
-- One conditional UPDATE is the whole concurrency control. Two workers racing
-- the same row serialise on the row lock, and the loser re-evaluates its WHERE
-- against the committed row and matches nothing — so a duplicate webhook
-- delivery cannot start a second encode. A worker that dies mid-render leaves
-- the row 'processing'; the lease below lets the sweeper reclaim it.
--
-- The claim also refuses any row that already has a video or has no clips to
-- work from, which is what makes this safe to run while the booth still encodes.

create or replace function public.claim_gallery_video_job(p_slug text)
returns table (
  slug             text,
  event_id         text,
  session_id       text,
  owner_user_id    uuid,
  burst_video_urls text[]
)
language sql
security definer
set search_path = public
as $$
  update public.galleries g
     set video_status     = 'processing',
         video_claimed_at = now(),
         video_attempts   = g.video_attempts + 1
   where g.slug = p_slug
     and g.final_video_url is null
     and coalesce(array_length(g.burst_video_urls, 1), 0) > 0
     and (g.video_status = 'pending'
          or (g.video_status = 'processing'
              and g.video_claimed_at < now() - interval '10 minutes'))
  returning g.slug, g.event_id, g.session_id, g.owner_user_id, g.burst_video_urls;
$$;

-- The sweeper. A webhook can be missed, misconfigured, or silently rejected —
-- both payment integrations taught us that the hard way — so nothing depends on
-- a single delivery. This runs on a timer and picks up whatever is outstanding.
create or replace function public.claim_next_gallery_video_jobs(p_limit int default 5)
returns table (
  slug             text,
  event_id         text,
  session_id       text,
  owner_user_id    uuid,
  burst_video_urls text[]
)
language sql
security definer
set search_path = public
as $$
  with candidate as (
    select g.slug
      from public.galleries g
     where g.final_video_url is null
       and coalesce(array_length(g.burst_video_urls, 1), 0) > 0
       and (g.video_status = 'pending'
            or (g.video_status = 'processing'
                and g.video_claimed_at < now() - interval '10 minutes'))
     order by g.created_at
     limit greatest(p_limit, 1)
     for update skip locked
  )
  update public.galleries g
     set video_status     = 'processing',
         video_claimed_at = now(),
         video_attempts   = g.video_attempts + 1
    from candidate c
   where g.slug = c.slug
  returning g.slug, g.event_id, g.session_id, g.owner_user_id, g.burst_video_urls;
$$;

-- ── Completing ──────────────────────────────────────────────────────────────
-- Keeping the state machine in functions means the renderer never writes the
-- status column directly, so there is one place to reason about.

create or replace function public.mark_gallery_video_ready(
  p_slug text, p_url text, p_path text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.galleries
     set final_video_url  = p_url,
         final_video_path = coalesce(p_path, final_video_path),
         video_status     = 'ready',
         video_error      = null,
         video_claimed_at = null
   where slug = p_slug;
$$;

-- Five attempts is enough to ride out a transient failure; past that the job is
-- parked as 'failed' rather than retried forever, and the gallery simply shows
-- photos without a clip — which is already how it behaves when an encode fails.
create or replace function public.mark_gallery_video_failed(p_slug text, p_error text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.galleries
     set video_status     = case when video_attempts >= 5 then 'failed' else 'pending' end,
         video_error      = left(coalesce(p_error, 'unknown'), 500),
         video_claimed_at = null
   where slug = p_slug;
$$;

-- These bypass RLS by design, so only the renderer may call them.
revoke all on function public.claim_gallery_video_job(text)            from public, anon, authenticated;
revoke all on function public.claim_next_gallery_video_jobs(int)       from public, anon, authenticated;
revoke all on function public.mark_gallery_video_ready(text,text,text) from public, anon, authenticated;
revoke all on function public.mark_gallery_video_failed(text,text)     from public, anon, authenticated;

grant execute on function public.claim_gallery_video_job(text)            to service_role;
grant execute on function public.claim_next_gallery_video_jobs(int)       to service_role;
grant execute on function public.mark_gallery_video_ready(text,text,text) to service_role;
grant execute on function public.mark_gallery_video_failed(text,text)     to service_role;
