-- Per-item sync metadata for booth setups (see src/services/syncMerge.js).
--
-- Holds each event/template/frame/palette's content fingerprint and last-changed
-- time, plus deletion records, so devices can merge edits instead of the last
-- device to save overwriting everyone else.
--
-- Additive and nullable. App versions before this sync never send the column,
-- so their saves leave it untouched; the merge detects items they changed by
-- comparing each item's content with its recorded fingerprint.

alter table public.booth_settings
  add column if not exists sync_meta jsonb;

comment on column public.booth_settings.sync_meta is
  'Cross-device merge metadata: per-item fingerprint + updatedAt, and deletion tombstones.';
