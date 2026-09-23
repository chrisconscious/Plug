-- ============================================================================
-- Migration 0012: Category icon (small icon-library key)
-- ============================================================================
-- Adds `categories.icon` — a tiny *identifier* that the storefront uses to
-- render a category with an inline vector icon from the already-installed
-- lucide-react set (e.g. "shoe", "shirt", "shopping-bag", "gem").
--
-- This is deliberately NOT a photo/image field: it stores only a short,
-- human-readable key string, never bytes and never a URL. The frontend keeps
-- the authoritative icon-key -> lucide-icon mapping; unknown keys fall back to
-- a default icon, so the DB stays permissive (no enum that would force a
-- migration every time an icon is added to the admin picker).
--
-- NOT NULL with a safe default so every category — legacy rows included —
-- renders something immediately. The not-blank CHECK mirrors the policy used
-- for every identifier column in this schema.
-- ============================================================================

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS icon TEXT NOT NULL DEFAULT 'box';

ALTER TABLE categories
  DROP CONSTRAINT IF EXISTS categories_icon_not_blank;
ALTER TABLE categories
  ADD CONSTRAINT categories_icon_not_blank
    CHECK (length(btrim(icon)) > 0);

COMMENT ON COLUMN categories.icon IS 'Short icon-library key (lucide icon set) used to render the category with an inline vector icon. An identifier string, NOT a photo and NOT a URL. Unknown keys fall back to a default icon client-side.';

-- Table-level grants from the 0007 baseline cover the new column, so no
-- per-column grant is needed.
