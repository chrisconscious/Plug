/**
 * Repository for the Shop by Lifestyle taxonomy (migration 0019).
 *
 * Follows the gender_audiences (0011) join pattern: `lifestyles` is the
 * reference/taxonomy table and `product_lifestyles` the join. Products own
 * their memberships (CASCADE); lifestyles can only be deleted while nothing
 * references them (RESTRICT — the DB is the delete backstop; the service
 * turns that into a friendly message via a pre-check).
 */
import { query, queryOne, withTransaction, isPgErrorCode, PG_ERROR_CODES } from "../client";
import { ConflictError } from "../../errors";
import type { Lifestyle, LifestyleRow, ProductLifestyleRef } from "../types";

type LifestyleDetailRow = LifestyleRow & { product_count: string | null };

function toLifestyle(r: LifestyleDetailRow): Lifestyle {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    shortDescription: r.short_description,
    heroImageUrl: r.hero_image_url,
    storageKey: r.storage_key,
    contentType: r.content_type,
    sizeBytes: r.size_bytes,
    width: r.width,
    height: r.height,
    active: r.active,
    displayOrder: r.display_order,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    productCount: r.product_count != null ? Number(r.product_count) : undefined,
  };
}

const LIFESTYLE_COLUMNS = `
  id, slug, name, short_description, hero_image_url, storage_key,
  content_type, size_bytes, width, height, active, display_order,
  created_at, updated_at`;

const PRODUCT_COUNT_SUBQUERY = `(
  SELECT count(*)::text
  FROM product_lifestyles pl
  JOIN products p ON p.id = pl.product_id
  WHERE pl.lifestyle_id = l.id AND p.active = true
) AS product_count`;

/** All lifestyles ordered for presentation (admin listing — includes drafts). */
export async function listLifestyles(): Promise<Lifestyle[]> {
  const rows = await query<LifestyleDetailRow>(
    `SELECT ${LIFESTYLE_COLUMNS}, ${PRODUCT_COUNT_SUBQUERY}
     FROM lifestyles l
     ORDER BY l.display_order ASC, l.created_at ASC`,
    []
  );
  return rows.map(toLifestyle);
}

/** Only the active lifestyles — the storefront surface (homepage + detail pages). */
export async function listActiveLifestyles(): Promise<Lifestyle[]> {
  const rows = await query<LifestyleDetailRow>(
    `SELECT ${LIFESTYLE_COLUMNS}, ${PRODUCT_COUNT_SUBQUERY}
     FROM lifestyles l
     WHERE l.active = true
     ORDER BY l.display_order ASC, l.created_at ASC`,
    []
  );
  return rows.map(toLifestyle);
}

export async function findLifestyleById(id: string): Promise<Lifestyle | null> {
  const row = await queryOne<LifestyleDetailRow>(
    `SELECT ${LIFESTYLE_COLUMNS}, ${PRODUCT_COUNT_SUBQUERY}
     FROM lifestyles l
     WHERE l.id = $1`,
    [id]
  );
  return row ? toLifestyle(row) : null;
}

/** Slug lookup used by the public detail route (activeness is a service concern). */
export async function findLifestyleBySlug(slug: string): Promise<Lifestyle | null> {
  const row = await queryOne<LifestyleDetailRow>(
    `SELECT ${LIFESTYLE_COLUMNS}, ${PRODUCT_COUNT_SUBQUERY}
     FROM lifestyles l
     WHERE l.slug = $1`,
    [slug]
  );
  return row ? toLifestyle(row) : null;
}

export type LifestyleInsert = {
  slug: string;
  name: string;
  shortDescription: string | null;
  active: boolean;
  displayOrder: number;
};

export async function insertLifestyle(input: LifestyleInsert): Promise<Lifestyle> {
  const row = await queryOne<LifestyleRow>(
    `INSERT INTO lifestyles (slug, name, short_description, active, display_order)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${LIFESTYLE_COLUMNS}`,
    [input.slug, input.name, input.shortDescription, input.active, input.displayOrder]
  ).catch((err) => {
    if (isPgErrorCode(err, PG_ERROR_CODES.UNIQUE_VIOLATION)) {
      throw new ConflictError("A lifestyle with this slug already exists.");
    }
    throw err;
  });
  return toLifestyle({ ...row!, product_count: "0" });
}

export type LifestylePatch = Partial<{
  slug: string;
  name: string;
  shortDescription: string | null;
  active: boolean;
  displayOrder: number;
  heroImageUrl: string | null;
  storageKey: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
}>;

export async function updateLifestyleFields(id: string, patch: LifestylePatch): Promise<Lifestyle | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (col: string, val: unknown) => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };
  if (patch.slug !== undefined) push("slug", patch.slug);
  if (patch.name !== undefined) push("name", patch.name);
  if (patch.shortDescription !== undefined) push("short_description", patch.shortDescription);
  if (patch.active !== undefined) push("active", patch.active);
  if (patch.displayOrder !== undefined) push("display_order", patch.displayOrder);
  if (patch.heroImageUrl !== undefined) push("hero_image_url", patch.heroImageUrl);
  if (patch.storageKey !== undefined) push("storage_key", patch.storageKey);
  if (patch.contentType !== undefined) push("content_type", patch.contentType);
  if (patch.sizeBytes !== undefined) push("size_bytes", patch.sizeBytes);
  if (patch.width !== undefined) push("width", patch.width);
  if (patch.height !== undefined) push("height", patch.height);
  if (sets.length === 0) return findLifestyleById(id);

  params.push(id);
  try {
    const row = await queryOne<LifestyleDetailRow>(
      `UPDATE lifestyles AS l SET ${sets.join(", ")} WHERE l.id = $${params.length}
       RETURNING ${LIFESTYLE_COLUMNS}, ${PRODUCT_COUNT_SUBQUERY}`,
      params
    );
    return row ? toLifestyle(row) : null;
  } catch (err) {
    if (isPgErrorCode(err, PG_ERROR_CODES.UNIQUE_VIOLATION)) {
      throw new ConflictError("A lifestyle with this slug already exists.");
    }
    throw err;
  }
}

/** Number of products (any status) assigned to a lifestyle — the delete-guard count. */
export async function countAssignedProducts(lifestyleId: string): Promise<number> {
  const row = await queryOne<{ count: string }>(
    `SELECT count(*)::text AS count FROM product_lifestyles WHERE lifestyle_id = $1`,
    [lifestyleId]
  );
  return Number(row?.count ?? "0");
}

export async function deleteLifestyleRow(id: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>("DELETE FROM lifestyles WHERE id = $1 RETURNING id", [id]);
  return !!row;
}

// ---- Product membership (the join) ----

type ProductLifestyleRow = { product_id: string; lifestyle_id: string; slug: string; name: string };

/**
 * Fetches the lifestyle set for MANY products in one query — avoids N+1 when
 * serializing a listing page. Products with no lifestyles are omitted.
 */
export async function listLifestylesForProducts(productIds: string[]): Promise<Map<string, ProductLifestyleRef[]>> {
  const map = new Map<string, ProductLifestyleRef[]>();
  if (productIds.length === 0) return map;
  const rows = await query<ProductLifestyleRow>(
    `SELECT pl.product_id, l.id AS lifestyle_id, l.slug, l.name
     FROM product_lifestyles pl
     JOIN lifestyles l ON l.id = pl.lifestyle_id
     WHERE pl.product_id = ANY($1)
     ORDER BY l.display_order ASC, l.name ASC`,
    [productIds]
  );
  for (const r of rows) {
    const list = map.get(r.product_id) ?? [];
    list.push({ id: r.lifestyle_id, slug: r.slug, name: r.name });
    map.set(r.product_id, list);
  }
  return map;
}

/**
 * Atomically replaces a product's lifestyle set (delete-then-insert in one
 * transaction — no orphaned joins). Every id is validated against the FK; an
 * unknown id surfaces as a friendly conflict. Passing an empty array clears
 * the product out of every lifestyle.
 */
export async function replaceProductLifestyles(productId: string, lifestyleIds: string[]): Promise<void> {
  const unique = [...new Set(lifestyleIds)];
  await withTransaction(async (client) => {
    await client.query("DELETE FROM product_lifestyles WHERE product_id = $1", [productId]);
    for (const lifestyleId of unique) {
      try {
        await client.query(
          "INSERT INTO product_lifestyles (product_id, lifestyle_id) VALUES ($1, $2)",
          [productId, lifestyleId]
        );
      } catch (err) {
        if (isPgErrorCode(err, PG_ERROR_CODES.FOREIGN_KEY_VIOLATION)) {
          throw new ConflictError("One or more lifestyles do not exist.");
        }
        throw err;
      }
    }
  });
}