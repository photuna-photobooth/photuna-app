-- The render service scales to zero, and a stopped machine runs no sweeper.
-- That quietly undid the point of having one: if the database webhook were ever
-- broken or misconfigured, nothing would wake the service and no clip would be
-- rendered -- the same silent failure that hid in both payment integrations.
--
-- This poke wakes it on a timer. The service sweeps the moment it starts, so
-- waking it is enough, and /health needs no credentials, so nothing sensitive
-- is stored in the job definition.
--
-- The timeout is generous because waking a stopped machine takes seconds: the
-- wake happens whether or not we wait for the reply, but a short timeout logs a
-- false failure on exactly the case this job exists for.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'photuna-poke-gallery-renderer') then
    perform cron.unschedule('photuna-poke-gallery-renderer');
  end if;
end $$;

select cron.schedule(
  'photuna-poke-gallery-renderer',
  '*/10 * * * *',
  $$select net.http_get(
      url := 'https://photuna-gallery-renderer.fly.dev/health',
      timeout_milliseconds := 30000
    )$$
);
