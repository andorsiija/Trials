-- saved_artworks table for user artwork collections
-- IMPORTANT: columns are quoted to preserve camelCase (userId, artworkId, savedAt)
-- to match the rest of the schema (artistId, createdAt) and the app's queries.
-- Run this in your Supabase SQL Editor. It drops the previous (mis-cased) table.

DROP TABLE IF EXISTS saved_artworks;

CREATE TABLE saved_artworks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  "userId" UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "artworkId" TEXT NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  "savedAt" TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE("userId", "artworkId")
);

CREATE INDEX IF NOT EXISTS idx_saved_artworks_userId ON saved_artworks("userId");
CREATE INDEX IF NOT EXISTS idx_saved_artworks_artworkId ON saved_artworks("artworkId");

ALTER TABLE saved_artworks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own saved artworks"
  ON saved_artworks FOR SELECT
  USING (auth.uid() = "userId");

CREATE POLICY "Users can save artworks"
  ON saved_artworks FOR INSERT
  WITH CHECK (auth.uid() = "userId");

CREATE POLICY "Users can unsave artworks"
  ON saved_artworks FOR DELETE
  USING (auth.uid() = "userId");
