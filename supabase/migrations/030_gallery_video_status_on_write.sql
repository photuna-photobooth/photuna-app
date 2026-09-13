-- Settle a gallery's video_status from what the row actually carries.
--
-- Migration 026 gave video_status a default of 'pending', which is right for a
-- session that still needs its motion clip rendered. But a Windows booth makes
-- its own clip, so its rows arrived with final_video_url already set and were
-- still marked 'pending' -- forever, since the render service's claim (correctly)
-- skips any row that has a clip. Harmless to rendering, but every booth session
-- would have claimed to be outstanding work, misleading anyone reading the
-- column and growing the index that exists only for real outstanding work.
--
-- Done in the database rather than the app so it holds for every client: old
-- installed versions, the desktop app and future tablets alike.
--
-- A row still at the default is settled on write:
--   has a clip                        -> ready
--   inserted with no burst clips      -> skipped (nothing could ever be rendered)
--   otherwise                         -> stays pending, for the render service
-- Any status a caller sets explicitly is left alone, and the service's own
-- claim / mark_ready / mark_failed functions are unaffected.
--
-- Dry-run verified against the real table before applying: booth session ->
-- ready and not claimable; tablet session -> pending and claimable; no-motion
-- session -> skipped; the booth's upsert retry leaves status intact; a finished
-- render still lands on ready.

create or replace function public.galleries_video_status_on_write()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if new.video_status = 'pending' then
    if new.final_video_url is not null then
      new.video_status := 'ready';
    elsif tg_op = 'INSERT' and coalesce(array_length(new.burst_video_urls, 1), 0) = 0 then
      new.video_status := 'skipped';
    end if;
  end if;
  return new;
end
$fn$;

drop trigger if exists galleries_video_status_on_write on public.galleries;
create trigger galleries_video_status_on_write
  before insert or update of final_video_url on public.galleries
  for each row execute function public.galleries_video_status_on_write();

-- Booth sessions written between migration 026 and this one.
update public.galleries
   set video_status = 'ready'
 where video_status = 'pending' and final_video_url is not null;
