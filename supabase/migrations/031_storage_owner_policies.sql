-- Close the studiophotuna storage bucket to everyone but each file's owner.
--
-- Before this migration the bucket was marked private, but its policies said
-- otherwise:
--   * "Public can read studiophotuna files" let anyone holding the public key —
--     which ships inside the web app — list every folder and download every
--     guest's photos and videos.
--   * "Operators upload/update own session files" checked only the bucket, so any
--     signed-in operator could overwrite or add files in another operator's
--     sessions, including the recipe the render service trusts.
--
-- After it:
--   * Operators read, sign and overwrite only files they uploaded (owner_id, which
--     the Storage service sets from the uploader's token — no path changes, so
--     booths already installed keep working).
--   * Uploads are allowed into the operator's own user folder, or into an event
--     folder no other operator has claimed (by a gallery row or an existing file).
--   * Nobody who is not signed in can list or read anything. Guest galleries are
--     unaffected: they use signed URLs, which Storage validates by token, not RLS.
--   * The service role (render service, retention jobs) is unaffected.
--
-- Dry-run verified against production data before applying: every normal booth
-- operation allowed (first upload to a new event, more files in a session, own
-- overwrite/upsert, signing own files, own logo replacement, tablet template
-- upload); every attack refused (reading, signing, overwriting or planting files
-- in another operator's session or folder, spoofing the owner, anonymous listing).

create index if not exists galleries_event_id_idx on public.galleries (event_id);

-- True when the top-level folder belongs to someone other than the caller: it is
-- another user's id, an event with another owner's gallery, or already holds
-- another owner's files. SECURITY DEFINER because the policy on storage.objects
-- would otherwise hide exactly the rows this has to see.
create or replace function public.storage_folder_claimed_by_other(p_folder text)
returns boolean
language sql
stable
security definer
set search_path = public, storage
as $fn$
  select
    exists (select 1 from auth.users u where u.id::text = p_folder and u.id <> auth.uid())
    or exists (select 1 from public.galleries g
                where g.event_id = p_folder and g.owner_user_id is not null and g.owner_user_id <> auth.uid())
    or exists (select 1 from storage.objects so
                where so.bucket_id = 'studiophotuna'
                  and so.name like replace(replace(replace(p_folder, '\', '\\'), '%', '\%'), '_', '\_') || '/%'
                  and so.owner_id is not null
                  and so.owner_id <> auth.uid()::text)
$fn$;

revoke all on function public.storage_folder_claimed_by_other(text) from public, anon;
grant execute on function public.storage_folder_claimed_by_other(text) to authenticated;

drop policy if exists "Public can read studiophotuna files" on storage.objects;
drop policy if exists "Operators read own session files" on storage.objects;
drop policy if exists "Operators read own appearance assets" on storage.objects;
drop policy if exists "Operators upload own session files" on storage.objects;
drop policy if exists "Authenticated users can upload to studiophotuna" on storage.objects;
drop policy if exists "Operators update own session files" on storage.objects;
drop policy if exists "Authenticated users can update own files in studiophotuna" on storage.objects;

create policy "studiophotuna: owners read their own files" on storage.objects
  for select to authenticated
  using (bucket_id = 'studiophotuna' and owner_id = (select auth.uid()::text));

create policy "studiophotuna: operators upload into folders they own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'studiophotuna'
    and owner_id = (select auth.uid()::text)
    and coalesce(array_length(storage.foldername(name), 1), 0) >= 1
    and not public.storage_folder_claimed_by_other((storage.foldername(name))[1])
  );

create policy "studiophotuna: owners overwrite their own files" on storage.objects
  for update to authenticated
  using (bucket_id = 'studiophotuna' and owner_id = (select auth.uid()::text))
  with check (bucket_id = 'studiophotuna' and owner_id = (select auth.uid()::text));

-- Files uploaded through the service key before booths used operator tokens have
-- no owner, so under the new policies their operator could no longer sign or
-- replace them. Assign each to its event's gallery owner. Every such event has a
-- single owner; the few test files with no gallery stay ownerless.
update storage.objects so
   set owner_id = g.owner_user_id::text
  from (select distinct on (event_id) event_id, owner_user_id
          from public.galleries
         where owner_user_id is not null
         order by event_id, created_at) g
 where so.bucket_id = 'studiophotuna'
   and so.owner_id is null
   and split_part(so.name, '/', 1) = g.event_id;
