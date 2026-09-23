-- ============================================================================
-- Migration 0050: Hero advertisement video support
-- ============================================================================
-- Extends the existing hero_advertisements table (migration 0013) rather
-- than a new one — this is the same "hero slide," just optionally backed
-- by a video instead of only a static image. image_url stays NOT NULL
-- (unchanged) and continues to serve as the poster frame / fallback shown
-- before the video loads and on any browser/network path where video
-- playback isn't available — a slide is never video-only with nothing to
-- show if video fails.

ALTER TABLE hero_advertisements
  ADD COLUMN IF NOT EXISTS video_url          TEXT,
  ADD COLUMN IF NOT EXISTS video_storage_key  TEXT,
  ADD COLUMN IF NOT EXISTS video_content_type TEXT
                           CHECK (video_content_type IS NULL OR video_content_type IN ('video/mp4', 'video/webm')),
  ADD COLUMN IF NOT EXISTS video_size_bytes   INTEGER CHECK (video_size_bytes IS NULL OR video_size_bytes >= 0);

COMMENT ON COLUMN hero_advertisements.video_url IS 'Optional background video for this slide — image_url remains required as the poster frame/fallback. NULL means this slide is image-only (the existing, unchanged behavior).';
