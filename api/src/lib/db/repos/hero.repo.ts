import { query, queryOne, withTransaction } from "../client";
import type { HeroSlide } from "../types";

export type HeroSlideRow = {
  id: string;
  campaign_label: string;
  headline: string;
  description: string;
  cta_text: string;
  cta_url: string;
  cta2_text: string | null;
  cta2_url: string | null;
  badge_text: string | null;
  editorial_text: string | null;
  hero_type: HeroSlide["heroType"];
  image_url: string;
  storage_key: string | null;
  content_type: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  video_url: string | null;
  video_storage_key: string | null;
  video_content_type: string | null;
  video_size_bytes: number | null;
  display_order: number;
  is_active: boolean;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
};

function toHeroSlide(r: HeroSlideRow): HeroSlide {
  return {
    id: r.id,
    campaignLabel: r.campaign_label,
    headline: r.headline,
    description: r.description,
    ctaText: r.cta_text,
    ctaUrl: r.cta_url,
    cta2Text: r.cta2_text,
    cta2Url: r.cta2_url,
    badgeText: r.badge_text,
    editorialText: r.editorial_text,
    heroType: r.hero_type,
    imageUrl: r.image_url,
    storageKey: r.storage_key,
    contentType: r.content_type,
    sizeBytes: r.size_bytes,
    width: r.width,
    height: r.height,
    videoUrl: r.video_url,
    videoStorageKey: r.video_storage_key,
    videoContentType: r.video_content_type,
    videoSizeBytes: r.video_size_bytes,
    displayOrder: r.display_order,
    isActive: r.is_active,
    startDate: r.start_date,
    endDate: r.end_date,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const HERO_COLUMNS = `
  id, campaign_label, headline, description, cta_text, cta_url,
  cta2_text, cta2_url,
  badge_text, editorial_text, hero_type, image_url, storage_key,
  content_type, size_bytes, width, height,
  video_url, video_storage_key, video_content_type, video_size_bytes,
  display_order, is_active,
  start_date, end_date, created_at, updated_at
`;

/**
 * The exact query the storefront homepage runs: active slides that are inside
 * their scheduling window (when set), in display order. The leading partial
 * index (hero_advertisements_active_order_idx) supports it.
 */
export async function listActiveHeroSlides(): Promise<HeroSlide[]> {
  const rows = await query<HeroSlideRow>(
    `SELECT ${HERO_COLUMNS} FROM hero_advertisements
     WHERE is_active = true
       AND (start_date IS NULL OR start_date <= now())
       AND (end_date IS NULL OR end_date >= now())
     ORDER BY display_order ASC, created_at ASC`
  );
  return rows.map(toHeroSlide);
}

/** Admin view — every slide, including inactive / scheduled / expired. */
export async function listAllHeroSlides(): Promise<HeroSlide[]> {
  const rows = await query<HeroSlideRow>(
    `SELECT ${HERO_COLUMNS} FROM hero_advertisements
     ORDER BY display_order ASC, created_at ASC`
  );
  return rows.map(toHeroSlide);
}

export async function findHeroSlideById(id: string): Promise<HeroSlide | null> {
  const row = await queryOne<HeroSlideRow>(
    `SELECT ${HERO_COLUMNS} FROM hero_advertisements WHERE id = $1`,
    [id]
  );
  return row ? toHeroSlide(row) : null;
}

export type HeroInsertInput = {
  campaignLabel: string;
  headline: string;
  description: string;
  ctaText: string;
  ctaUrl: string;
  cta2Text: string | null;
  cta2Url: string | null;
  badgeText: string | null;
  editorialText: string | null;
  heroType: HeroSlide["heroType"];
  imageUrl: string;
  storageKey: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  displayOrder: number;
  isActive: boolean;
  startDate: string | null;
  endDate: string | null;
  /** Optional — a new slide is always created image-only; video is added afterward via the same upload-after-create pattern images already use. Only meaningful through updateHeroSlide's patch. */
  videoUrl?: string | null;
  videoStorageKey?: string | null;
  videoContentType?: string | null;
  videoSizeBytes?: number | null;
};

export async function insertHeroSlide(input: HeroInsertInput): Promise<HeroSlide> {
  const row = await queryOne<HeroSlideRow>(
    `INSERT INTO hero_advertisements (
       campaign_label, headline, description, cta_text, cta_url,
       cta2_text, cta2_url,
       badge_text, editorial_text, hero_type, image_url, storage_key,
       content_type, size_bytes, width, height, display_order, is_active,
       start_date, end_date
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     RETURNING ${HERO_COLUMNS}`,
    [
      input.campaignLabel, input.headline, input.description, input.ctaText, input.ctaUrl,
      input.cta2Text, input.cta2Url,
      input.badgeText, input.editorialText, input.heroType, input.imageUrl, input.storageKey,
      input.contentType, input.sizeBytes, input.width, input.height, input.displayOrder, input.isActive,
      input.startDate, input.endDate,
    ]
  );
  return toHeroSlide(row!);
}

export type HeroPatchInput = Partial<HeroInsertInput>;

export async function updateHeroSlide(id: string, patch: HeroPatchInput): Promise<HeroSlide | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const colMap: Record<string, string> = {
    campaignLabel: "campaign_label",
    headline: "headline",
    description: "description",
    ctaText: "cta_text",
    ctaUrl: "cta_url",
    cta2Text: "cta2_text",
    cta2Url: "cta2_url",
    badgeText: "badge_text",
    editorialText: "editorial_text",
    heroType: "hero_type",
    imageUrl: "image_url",
    storageKey: "storage_key",
    contentType: "content_type",
    sizeBytes: "size_bytes",
    width: "width",
    height: "height",
    displayOrder: "display_order",
    isActive: "is_active",
    startDate: "start_date",
    endDate: "end_date",
    videoUrl: "video_url",
    videoStorageKey: "video_storage_key",
    videoContentType: "video_content_type",
    videoSizeBytes: "video_size_bytes",
  };
  for (const key of Object.keys(patch) as (keyof HeroPatchInput)[]) {
    const col = colMap[key];
    if (!col || patch[key] === undefined) continue;
    values.push(patch[key]);
    sets.push(`${col} = $${values.length}`);
  }
  if (sets.length === 0) return findHeroSlideById(id);
  values.push(id);
  const row = await queryOne<HeroSlideRow>(
    `UPDATE hero_advertisements SET ${sets.join(", ")} WHERE id = $${values.length}
     RETURNING ${HERO_COLUMNS}`,
    values
  );
  return row ? toHeroSlide(row) : null;
}

export async function deleteHeroSlide(id: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>("DELETE FROM hero_advertisements WHERE id = $1 RETURNING id", [id]);
  return !!row;
}

/**
 * Reassign contiguous display_order (0..n-1) for the given ordered id list.
 * Runs in a transaction so a partial failure can't strand a descending order.
 */
export async function reorderHeroSlides(orderedIds: string[]): Promise<number> {
  if (orderedIds.length === 0) return 0;
  await withTransaction(async (client) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await client.query("UPDATE hero_advertisements SET display_order = $1 WHERE id = $2", [i, orderedIds[i]]);
    }
  });
  return orderedIds.length;
}
