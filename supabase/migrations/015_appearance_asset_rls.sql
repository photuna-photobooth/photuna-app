-- ============================================================
-- Photuna — Migration 015: Appearance Asset Storage RLS
--
-- Migration 013 made the studiophotuna bucket private, which
-- broke createSignedUrl() for appearance assets (logos and
-- backgrounds). The existing "Operators read own session files"
-- policy only matches gallery session paths, not appearance paths.
--
-- Appearance asset path pattern: {userId}/appearance/{slot}.{ext}
-- This migration adds a SELECT policy so authenticated operators
-- can call createSignedUrl() on their own appearance assets.
-- ============================================================

DROP POLICY IF EXISTS "Operators read own appearance assets" ON storage.objects;
CREATE POLICY "Operators read own appearance assets"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'studiophotuna'
    AND (string_to_array(name, '/'))[1] = auth.uid()::text
    AND (string_to_array(name, '/'))[2] = 'appearance'
  );
