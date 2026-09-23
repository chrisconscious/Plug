import { query, queryOne } from "../client";

/**
 * Homepage promo banner settings — a single-row config (id = 1) driving
 * the storefront's top messaging strip. See migration 0026.
 */

export type PromoBannerSettingsRow = {
  id: number;
  messages: string[];
  is_active: boolean;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PromoBannerSettings = { messages: string[]; isActive: boolean };

function toSettings(r: PromoBannerSettingsRow): PromoBannerSettings {
  return { messages: r.messages, isActive: r.is_active };
}

export async function getPromoBannerSettings(): Promise<PromoBannerSettings | null> {
  const row = await queryOne<PromoBannerSettingsRow>(
    `SELECT id, messages, is_active, updated_by, created_at, updated_at
     FROM homepage_promo_banner WHERE id = 1`
  );
  return row ? toSettings(row) : null;
}

export async function updatePromoBannerSettings(
  input: { messages: string[]; isActive: boolean },
  actorId: string
): Promise<PromoBannerSettings> {
  const row = await queryOne<PromoBannerSettingsRow>(
    `INSERT INTO homepage_promo_banner (id, messages, is_active, updated_by)
     VALUES (1, $1, $2, $3)
     ON CONFLICT (id) DO UPDATE
       SET messages = EXCLUDED.messages,
           is_active = EXCLUDED.is_active,
           updated_by = EXCLUDED.updated_by
     RETURNING *`,
    [input.messages, input.isActive, actorId]
  );
  return toSettings(row!);
}
