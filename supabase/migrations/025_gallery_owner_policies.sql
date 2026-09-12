-- Galleries have been written with owner_user_id since migration 008, but the
-- row-level policies were left checking the older user_id column. That column
-- is NULL on every row, so once the app stopped using the service-role key
-- (commit e4eafd3, 28 Aug 2026) every operator's gallery upload was refused:
--   new row violates row-level security policy for table "galleries"
-- Only admins were unaffected, because "Admins can manage all galleries"
-- matched first — which is why this was invisible from the studio account.
--
-- Point ownership at the column the app actually writes.

drop policy if exists "Users can insert own galleries" on public.galleries;
create policy "Users can insert own galleries" on public.galleries
  for insert to authenticated
  with check (auth.uid() = owner_user_id);

-- The app upserts on slug, so a retried upload takes the UPDATE path and needs
-- this policy to match as well.
drop policy if exists "Users can update own galleries" on public.galleries;
create policy "Users can update own galleries" on public.galleries
  for update to authenticated
  using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);

-- "Public can read non-expired galleries" serves the QR links and stays as it
-- is; this lets an operator still see their own gallery once it has expired.
drop policy if exists "Users can read own galleries" on public.galleries;
create policy "Users can read own galleries" on public.galleries
  for select to authenticated
  using (auth.uid() = owner_user_id);

comment on column public.galleries.user_id is
  'Legacy. Unused and NULL on every row; ownership is owner_user_id.';
