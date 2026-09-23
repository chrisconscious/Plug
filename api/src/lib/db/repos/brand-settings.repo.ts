import { query, queryOne } from "../client";
import type { BrandSectionSpeed } from "../types";

/**
 * Brand logo section settings — a single-row config (id = 1) driving the
 * storefront "Shop by brands" marquee. See migration 0020.
 */

export type BrandSectionSettingsRow = {
  id: number;
  brand_logo_speed: BrandSectionSpeed;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

function toSettings(r: BrandSectionSettingsRow): { speed: BrandSectionSpeed } {
  return { speed: r.brand_logo_speed };
}

export async function getBrandSectionSettings(): Promise<{ speed: BrandSectionSpeed } | null> {
  const row = await queryOne<BrandSectionSettingsRow>(
    `SELECT id, brand_logo_speed, updated_by, created_at, updated_at
     FROM homepage_brand_settings WHERE id = 1`
  );
  return row ? toSettings(row) : null;
}

export async function updateBrandLogoSpeed(speed: BrandSectionSpeed, actorId: string): Promise<void> {
  await query(
    `INSERT INTO homepage_brand_settings (id, brand_logo_speed, updated_by)
     VALUES (1, $1, $2)
     ON CONFLICT (id) DO UPDATE
       SET brand_logo_speed = EXCLUDED.brand_logo_speed,
           updated_by = EXCLUDED.updated_by`,
    [speed, actorId]
  );
}