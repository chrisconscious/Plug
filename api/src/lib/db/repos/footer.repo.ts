import { query, queryOne } from "../client";

export type FooterPlatform = "instagram" | "tiktok" | "facebook" | "phone" | "whatsapp" | "email";

export type FooterContactLink = {
  id: string;
  platform: FooterPlatform;
  value: string | null;
  active: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
};

type FooterContactLinkRow = {
  id: string;
  platform: FooterPlatform;
  value: string | null;
  active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
};

const toLink = (r: FooterContactLinkRow): FooterContactLink => ({
  id: r.id,
  platform: r.platform,
  value: r.value,
  active: r.active,
  displayOrder: r.display_order,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const COLUMNS = "id, platform, value, active, display_order, created_at, updated_at";

/** Public storefront query — only channels that are both active AND have a real configured value (belt-and-suspenders alongside the DB's own active-requires-value constraint). */
export async function listActiveFooterContactLinks(): Promise<FooterContactLink[]> {
  const rows = await query<FooterContactLinkRow>(
    `SELECT ${COLUMNS} FROM footer_contact_links WHERE active = true AND value IS NOT NULL ORDER BY display_order`
  );
  return rows.map(toLink);
}

/** Admin view — all six fixed platform rows, active or not, configured or not. */
export async function listAllFooterContactLinks(): Promise<FooterContactLink[]> {
  const rows = await query<FooterContactLinkRow>(`SELECT ${COLUMNS} FROM footer_contact_links ORDER BY display_order`);
  return rows.map(toLink);
}

export async function findFooterContactLinkByPlatform(platform: FooterPlatform): Promise<FooterContactLink | null> {
  const row = await queryOne<FooterContactLinkRow>(`SELECT ${COLUMNS} FROM footer_contact_links WHERE platform = $1`, [platform]);
  return row ? toLink(row) : null;
}

export type FooterContactLinkPatch = { value?: string | null; active?: boolean; displayOrder?: number };

/** UPDATE only — never INSERT/DELETE, matching the table's own fixed six-row design (see migration 0046). */
export async function updateFooterContactLink(platform: FooterPlatform, patch: FooterContactLinkPatch): Promise<FooterContactLink | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (patch.value !== undefined) push("value", patch.value);
  if (patch.active !== undefined) push("active", patch.active);
  if (patch.displayOrder !== undefined) push("display_order", patch.displayOrder);
  if (sets.length === 0) return findFooterContactLinkByPlatform(platform);

  params.push(platform);
  const row = await queryOne<FooterContactLinkRow>(
    `UPDATE footer_contact_links SET ${sets.join(", ")} WHERE platform = $${params.length} RETURNING ${COLUMNS}`,
    params
  );
  return row ? toLink(row) : null;
}
