import { query, queryOne, withTransaction, isPgErrorCode, PG_ERROR_CODES } from "../client";
import { ConflictError } from "../../errors";
import type { Brand, BrandCampaignImage, BrandLogo, Category, GenderAudience, Product, ProductImage, ProductVariant } from "../types";

type BrandRow = {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  display_order: number;
  logo_id: string | null;
  logo_storage_key: string | null;
  logo_url: string | null;
  logo_content_type: string | null;
  logo_size_bytes: number | null;
  logo_width: number | null;
  logo_height: number | null;
  logo_created_at: string | null;
  logo_updated_at: string | null;
  logo_tone: "light" | "dark" | null;
  campaign_image_id: string | null;
  campaign_image_storage_key: string | null;
  campaign_image_url: string | null;
  campaign_image_content_type: string | null;
  campaign_image_size_bytes: number | null;
  campaign_image_width: number | null;
  campaign_image_height: number | null;
  campaign_image_created_at: string | null;
  campaign_image_updated_at: string | null;
  product_count: string | null;
};
type CategoryRow = { id: string; slug: string; name: string; parent_id: string | null; image_url: string | null; image_storage_key: string | null; icon: string; active: boolean; display_order: number };
// Shared column list for the product table. Kept in one place so the listing,
// detail, admin and insert/update paths always agree on what a Product carries.
const PRODUCT_COLUMNS = `
  id, slug, name, brand_id, category_id, price_cents, active,
  compare_at_price_cents, gender, tags,
  sku, short_description, full_description, badge_text, offer_label,
  offer_start_date, offer_end_date,
  published_at, archived_at, created_at, updated_at`;

type ProductRow = {
  id: string;
  slug: string;
  name: string;
  brand_id: string;
  category_id: string;
  price_cents: number;
  active: boolean;
  compare_at_price_cents: number | null;
  gender: string | null;
  tags: string[] | null;
  sku: string | null;
  short_description: string | null;
  full_description: string | null;
  badge_text: string | null;
  offer_label: string | null;
  offer_start_date: string | null;
  offer_end_date: string | null;
  published_at: Date | null;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
};
type VariantRow = { id: string; product_id: string; size: string; color: string; stock_qty: number; sku: string | null };
type ProductImageRow = {
  id: string;
  product_id: string;
  url: string;
  position: number;
  alt_text: string | null;
  storage_key: string | null;
  content_type: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  created_at: string;
};
type LogoRow = {
  id: string;
  brand_id: string;
  storage_key: string;
  url: string;
  content_type: string;
  size_bytes: number;
  width: number;
  height: number;
  created_at: string;
  updated_at: string;
  /** brand_logos only (migration 0054); campaign-image rows reuse this type without it. */
  tone?: "light" | "dark" | null;
};

const toLogo = (r: LogoRow): BrandLogo => ({
  id: r.id,
  brandId: r.brand_id,
  storageKey: r.storage_key,
  url: r.url,
  contentType: r.content_type,
  sizeBytes: r.size_bytes,
  width: r.width,
  height: r.height,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  tone: r.tone ?? null,
});

const toBrand = (r: BrandRow): Brand => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  active: r.active,
  displayOrder: r.display_order,
  logo: r.logo_id
    ? {
        id: r.logo_id,
        brandId: r.id,
        storageKey: r.logo_storage_key!,
        url: r.logo_url!,
        contentType: r.logo_content_type!,
        sizeBytes: r.logo_size_bytes!,
        width: r.logo_width!,
        height: r.logo_height!,
        createdAt: r.logo_created_at!,
        updatedAt: r.logo_updated_at!,
        tone: r.logo_tone ?? null,
      }
    : null,
  campaignImage: r.campaign_image_id
    ? {
        id: r.campaign_image_id,
        brandId: r.id,
        storageKey: r.campaign_image_storage_key!,
        url: r.campaign_image_url!,
        contentType: r.campaign_image_content_type!,
        sizeBytes: r.campaign_image_size_bytes!,
        width: r.campaign_image_width!,
        height: r.campaign_image_height!,
        createdAt: r.campaign_image_created_at!,
        updatedAt: r.campaign_image_updated_at!,
      }
    : null,
  productCount: r.product_count !== null && r.product_count !== undefined ? Number(r.product_count) : undefined,
});

// Columns shared by the two brand-queries below (the LEFT JOINs carry the
// optional logo and campaign image; product_count is computed by a scalar
// subquery so the joins never fan out rows).
const BRAND_SELECT = `
  b.id, b.slug, b.name, b.active, b.display_order,
  l.id   AS logo_id,
  l.storage_key AS logo_storage_key,
  l.url  AS logo_url,
  l.content_type AS logo_content_type,
  l.size_bytes AS logo_size_bytes,
  l.width AS logo_width,
  l.height AS logo_height,
  l.created_at AS logo_created_at,
  l.updated_at AS logo_updated_at,
  l.tone AS logo_tone,
  ci.id   AS campaign_image_id,
  ci.storage_key AS campaign_image_storage_key,
  ci.url  AS campaign_image_url,
  ci.content_type AS campaign_image_content_type,
  ci.size_bytes AS campaign_image_size_bytes,
  ci.width AS campaign_image_width,
  ci.height AS campaign_image_height,
  ci.created_at AS campaign_image_created_at,
  ci.updated_at AS campaign_image_updated_at,
  (SELECT count(*)::text FROM products p WHERE p.brand_id = b.id AND p.active = true) AS product_count
FROM brands b
LEFT JOIN brand_logos l ON l.brand_id = b.id
LEFT JOIN brand_campaign_images ci ON ci.brand_id = b.id`;

const toCategory = (r: CategoryRow): Category => ({ id: r.id, slug: r.slug, name: r.name, parentId: r.parent_id, imageUrl: r.image_url, icon: r.icon, active: r.active, displayOrder: r.display_order });

/** pg returns DATE columns as JS Date objects; normalize to YYYY-MM-DD for string comparisons in isSaleLive. */
export const toDateOnly = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(v);
};

const toProduct = (r: ProductRow): Product => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  brandId: r.brand_id,
  categoryId: r.category_id,
  priceCents: r.price_cents,
  images: [], // populated separately by callers that need images; kept off the hot listing path
  active: r.active,
  compareAtPriceCents: r.compare_at_price_cents,
  gender: r.gender,
  tags: r.tags ?? [],
  sku: r.sku,
  shortDescription: r.short_description,
  fullDescription: r.full_description,
  badgeText: r.badge_text,
  offerLabel: r.offer_label,
  offerStartDate: toDateOnly(r.offer_start_date),
  offerEndDate: toDateOnly(r.offer_end_date),
  publishedAt: r.published_at ? new Date(r.published_at).toISOString() : null,
  archivedAt: r.archived_at ? new Date(r.archived_at).toISOString() : null,
  createdAt: new Date(r.created_at).toISOString(),
  updatedAt: new Date(r.updated_at).toISOString(),
});
const toVariant = (r: VariantRow): ProductVariant => ({
  id: r.id,
  productId: r.product_id,
  size: r.size,
  color: r.color,
  stockQty: r.stock_qty,
  sku: r.sku,
});
const toProductImage = (r: ProductImageRow): ProductImage => ({
  id: r.id,
  productId: r.product_id,
  url: r.url,
  position: r.position,
  altText: r.alt_text,
  storageKey: r.storage_key,
  contentType: r.content_type,
  sizeBytes: r.size_bytes,
  width: r.width,
  height: r.height,
  createdAt: r.created_at,
});

export async function listBrands(): Promise<Brand[]> {
  return (await query<BrandRow>(`SELECT ${BRAND_SELECT} ORDER BY b.name`)).map(toBrand);
}

export async function findBrandBySlug(slug: string): Promise<Brand | null> {
  const row = await queryOne<BrandRow>(`SELECT ${BRAND_SELECT} WHERE b.slug = $1`, [slug]);
  return row ? toBrand(row) : null;
}

export async function findBrandById(id: string): Promise<Brand | null> {
  const row = await queryOne<BrandRow>(`SELECT ${BRAND_SELECT} WHERE b.id = $1`, [id]);
  return row ? toBrand(row) : null;
}

export async function listCategories(opts: { activeOnly?: boolean } = {}): Promise<Category[]> {
  const where = opts.activeOnly ? "WHERE active = true" : "";
  return (await query<CategoryRow>(
    `SELECT id, slug, name, parent_id, image_url, image_storage_key, icon, active, display_order FROM categories ${where} ORDER BY display_order, name`
  )).map(toCategory);
}

export async function findCategoryBySlug(slug: string): Promise<Category | null> {
  const row = await queryOne<CategoryRow>("SELECT id, slug, name, parent_id, image_url, image_storage_key, icon, active, display_order FROM categories WHERE slug = $1", [slug]);
  return row ? toCategory(row) : null;
}

/** Repo-internal only — the storage key is never exposed via the shared Category type (nothing outside this file/its callers-that-need-deletion should see it, public API responses included). Used by updateCategoryImage/removeCategoryImage to know what to delete from the storage provider on replace/removal. */
export async function getCategoryImageStorageKey(id: string): Promise<string | null> {
  const row = await queryOne<{ image_storage_key: string | null }>("SELECT image_storage_key FROM categories WHERE id = $1", [id]);
  return row?.image_storage_key ?? null;
}

export type CategoryPatch = { name?: string; slug?: string; icon?: string; active?: boolean; displayOrder?: number };

export async function updateCategoryFields(id: string, patch: CategoryPatch): Promise<Category | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (col: string, val: unknown) => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };
  if (patch.name !== undefined) push("name", patch.name);
  if (patch.slug !== undefined) push("slug", patch.slug);
  if (patch.icon !== undefined) push("icon", patch.icon);
  if (patch.active !== undefined) push("active", patch.active);
  if (patch.displayOrder !== undefined) push("display_order", patch.displayOrder);
  if (sets.length === 0) {
    const row = await queryOne<CategoryRow>("SELECT id, slug, name, parent_id, image_url, image_storage_key, icon, active, display_order FROM categories WHERE id = $1", [id]);
    return row ? toCategory(row) : null;
  }

  params.push(id);
  try {
    const row = await queryOne<CategoryRow>(
      `UPDATE categories SET ${sets.join(", ")} WHERE id = $${params.length}
       RETURNING id, slug, name, parent_id, image_url, image_storage_key, icon, active, display_order`,
      params
    );
    return row ? toCategory(row) : null;
  } catch (err) {
    if (isPgErrorCode(err, PG_ERROR_CODES.UNIQUE_VIOLATION)) {
      throw new ConflictError("A category with this slug already exists.");
    }
    throw err;
  }
}

/** Sets (or clears, with url/storageKey both null) the category's storefront image. */
export async function setCategoryImage(id: string, url: string | null, storageKey: string | null): Promise<Category | null> {
  const row = await queryOne<CategoryRow>(
    `UPDATE categories SET image_url = $1, image_storage_key = $2 WHERE id = $3
     RETURNING id, slug, name, parent_id, image_url, image_storage_key, icon, active, display_order`,
    [url, storageKey, id]
  );
  return row ? toCategory(row) : null;
}

export async function insertBrand(input: { slug: string; name: string }): Promise<Brand> {
  try {
    const row = await queryOne<BrandRow>(
      `INSERT INTO brands (slug, name)
       VALUES ($1, $2)
       RETURNING id, slug, name, active`,
      [input.slug, input.name]
    );
    return (await findBrandById(row!.id))!;
  } catch (err) {
    if (isPgErrorCode(err, PG_ERROR_CODES.UNIQUE_VIOLATION)) {
      throw new ConflictError("A brand with this slug already exists.");
    }
    throw err;
  }
}

export async function updateBrandFields(
  id: string,
  patch: Partial<{ name: string; slug: string; active: boolean; displayOrder: number }>
): Promise<Brand | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.name !== undefined) { params.push(patch.name); sets.push(`name = $${params.length}`); }
  if (patch.slug !== undefined) { params.push(patch.slug); sets.push(`slug = $${params.length}`); }
  if (patch.active !== undefined) { params.push(patch.active); sets.push(`active = $${params.length}`); }
  if (patch.displayOrder !== undefined) { params.push(patch.displayOrder); sets.push(`display_order = $${params.length}`); }

  if (sets.length > 0) {
    params.push(id);
    try {
      await query(`UPDATE brands SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
    } catch (err) {
      if (isPgErrorCode(err, PG_ERROR_CODES.UNIQUE_VIOLATION)) {
        throw new ConflictError("A brand with this slug already exists.");
      }
      throw err;
    }
  }
  return findBrandById(id);
}

export async function findLogoByBrandId(brandId: string): Promise<BrandLogo | null> {
  const row = await queryOne<LogoRow>(
    `SELECT id, brand_id, storage_key, url, content_type, size_bytes, width, height, created_at, updated_at, tone
     FROM brand_logos WHERE brand_id = $1`,
    [brandId]
  );
  return row ? toLogo(row) : null;
}

export async function upsertLogo(input: {
  brandId: string;
  storageKey: string;
  url: string;
  contentType: string;
  sizeBytes: number;
  width: number;
  height: number;
  /** Detected on upload (image-tone.ts); a new file always replaces the previous tone. */
  tone?: "light" | "dark" | null;
}): Promise<BrandLogo> {
  const row = await queryOne<LogoRow>(
    `INSERT INTO brand_logos (brand_id, storage_key, url, content_type, size_bytes, width, height, tone)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (brand_id) DO UPDATE SET
       storage_key = EXCLUDED.storage_key,
       url = EXCLUDED.url,
       content_type = EXCLUDED.content_type,
       size_bytes = EXCLUDED.size_bytes,
       width = EXCLUDED.width,
       height = EXCLUDED.height,
       tone = EXCLUDED.tone
     RETURNING id, brand_id, storage_key, url, content_type, size_bytes, width, height, created_at, updated_at, tone`,
    [
      input.brandId,
      input.storageKey,
      input.url,
      input.contentType,
      input.sizeBytes,
      input.width,
      input.height,
      input.tone ?? null,
    ]
  );
  return toLogo(row!);
}

export async function deleteLogoByBrandId(brandId: string): Promise<BrandLogo | null> {
  const row = await queryOne<LogoRow>(
    `DELETE FROM brand_logos WHERE brand_id = $1
     RETURNING id, brand_id, storage_key, url, content_type, size_bytes, width, height, created_at, updated_at, tone`,
    [brandId]
  );
  return row ? toLogo(row) : null;
}

// ---- Brand campaign images (large lifestyle photo — see migration 0045) ----

type CampaignImageRow = LogoRow; // identical shape, see migration 0045's header comment

const toCampaignImage = (r: CampaignImageRow): BrandCampaignImage => ({
  id: r.id,
  brandId: r.brand_id,
  storageKey: r.storage_key,
  url: r.url,
  contentType: r.content_type,
  sizeBytes: r.size_bytes,
  width: r.width,
  height: r.height,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function findCampaignImageByBrandId(brandId: string): Promise<BrandCampaignImage | null> {
  const row = await queryOne<CampaignImageRow>(
    `SELECT id, brand_id, storage_key, url, content_type, size_bytes, width, height, created_at, updated_at
     FROM brand_campaign_images WHERE brand_id = $1`,
    [brandId]
  );
  return row ? toCampaignImage(row) : null;
}

export async function upsertCampaignImage(input: {
  brandId: string;
  storageKey: string;
  url: string;
  contentType: string;
  sizeBytes: number;
  width: number;
  height: number;
}): Promise<BrandCampaignImage> {
  const row = await queryOne<CampaignImageRow>(
    `INSERT INTO brand_campaign_images (brand_id, storage_key, url, content_type, size_bytes, width, height)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (brand_id) DO UPDATE SET
       storage_key = EXCLUDED.storage_key,
       url = EXCLUDED.url,
       content_type = EXCLUDED.content_type,
       size_bytes = EXCLUDED.size_bytes,
       width = EXCLUDED.width,
       height = EXCLUDED.height
     RETURNING id, brand_id, storage_key, url, content_type, size_bytes, width, height, created_at, updated_at`,
    [
      input.brandId,
      input.storageKey,
      input.url,
      input.contentType,
      input.sizeBytes,
      input.width,
      input.height,
    ]
  );
  return toCampaignImage(row!);
}

export async function deleteCampaignImageByBrandId(brandId: string): Promise<BrandCampaignImage | null> {
  const row = await queryOne<CampaignImageRow>(
    `DELETE FROM brand_campaign_images WHERE brand_id = $1
     RETURNING id, brand_id, storage_key, url, content_type, size_bytes, width, height, created_at, updated_at`,
    [brandId]
  );
  return row ? toCampaignImage(row) : null;
}

/** Reassign contiguous display_order (0..n-1) for the given ordered brand id list — same transaction pattern already used for hero slides/announcements. */
export async function reorderBrands(orderedIds: string[]): Promise<number> {
  if (orderedIds.length === 0) return 0;
  await withTransaction(async (client) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await client.query("UPDATE brands SET display_order = $1 WHERE id = $2", [i, orderedIds[i]]);
    }
  });
  return orderedIds.length;
}

export async function insertCategory(input: { slug: string; name: string; icon?: string }): Promise<Category> {
  try {
    const row = await queryOne<CategoryRow>(
      "INSERT INTO categories (slug, name, icon) VALUES ($1, $2, $3) RETURNING id, slug, name, parent_id, image_url, image_storage_key, icon, active, display_order",
      [input.slug, input.name, input.icon ?? "box"]
    );
    return toCategory(row!);
  } catch (err) {
    if (isPgErrorCode(err, PG_ERROR_CODES.UNIQUE_VIOLATION)) {
      throw new ConflictError("A category with this slug already exists.");
    }
    throw err;
  }
}

export type AdminProductStatus = "active" | "draft" | "archived" | "sold_out" | "low_stock";
export type AdminProductSort = "newest" | "oldest" | "name" | "price_asc" | "price_desc" | "stock_asc" | "updated";

export type ProductListFilters = {
  brandId?: string;
  categoryId?: string;
  search?: string;
  page: number;
  pageSize: number;
  /** Admin listing only — include draft/archived products so they stay manageable. */
  includeInactive?: boolean;
  /** Admin listing only — substring match on name / slug / SKU / variant SKU (search above is the storefront full-text match). */
  adminSearch?: string;
  /** Admin listing only — lifecycle / inventory state. Omitted = everything except archived. */
  status?: AdminProductStatus | "all";
  sort?: AdminProductSort;
};

const ADMIN_SORT_SQL: Record<AdminProductSort, string> = {
  newest: "created_at DESC",
  oldest: "created_at ASC",
  name: "lower(name) ASC, created_at DESC",
  price_asc: "price_cents ASC, created_at DESC",
  price_desc: "price_cents DESC, created_at DESC",
  stock_asc: "(SELECT COALESCE(SUM(stock_qty), 0) FROM product_variants pv WHERE pv.product_id = products.id) ASC, created_at DESC",
  updated: "updated_at DESC",
};

const IN_STOCK_SQL = "EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = products.id AND pv.stock_qty > 0)";

/**
 * Returns one page of active products plus a total count for pagination.
 * Uses OFFSET pagination (page x pageSize) deliberately, not keyset —
 * see docs/DATABASE.md "Pagination strategy" for why that's an acceptable
 * tradeoff at the catalog sizes this is designed for today, and what
 * triggers switching to keyset pagination later.
 */
export async function listProducts(filters: ProductListFilters): Promise<{ items: Product[]; total: number }> {
  const conditions: string[] = filters.includeInactive ? [] : ["active = true"];
  const params: unknown[] = [];

  if (filters.brandId) {
    params.push(filters.brandId);
    conditions.push(`brand_id = $${params.length}`);
  }
  if (filters.categoryId) {
    params.push(filters.categoryId);
    conditions.push(`category_id = $${params.length}`);
  }
  if (filters.search) {
    params.push(filters.search);
    // plainto_tsquery + the generated search_vector column (see migration
    // 0003) — uses the GIN index rather than an ILIKE full scan.
    conditions.push(`search_vector @@ plainto_tsquery('english', $${params.length})`);
  }
  if (filters.adminSearch) {
    params.push(`%${filters.adminSearch.replace(/[\\%_]/g, (c) => "\\" + c)}%`);
    const i = params.length;
    conditions.push(
      `(name ILIKE $${i} OR slug ILIKE $${i} OR sku ILIKE $${i}
        OR EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = products.id AND pv.sku ILIKE $${i}))`
    );
  }
  switch (filters.status) {
    case "active": conditions.push("active = true"); break;
    case "draft": conditions.push("active = false AND archived_at IS NULL"); break;
    case "archived": conditions.push("archived_at IS NOT NULL"); break;
    case "sold_out": conditions.push(`archived_at IS NULL AND NOT ${IN_STOCK_SQL}`); break;
    case "low_stock":
      conditions.push(`archived_at IS NULL AND EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = products.id AND pv.stock_qty BETWEEN 1 AND 5)`);
      break;
    case "all": break;
    default:
      // Admin default view hides archived products (they have their own tab).
      if (filters.includeInactive) conditions.push("archived_at IS NULL");
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const countRow = await queryOne<{ count: string }>(
    `SELECT count(*)::text AS count FROM products ${whereClause}`,
    params
  );
  const total = Number(countRow?.count ?? "0");

  const limitParamIdx = params.length + 1;
  const offsetParamIdx = params.length + 2;
  const rows = await query<ProductRow>(
    `SELECT ${PRODUCT_COLUMNS}
     FROM products
     ${whereClause}
     ORDER BY ${ADMIN_SORT_SQL[filters.sort ?? "newest"]}
     LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}`,
    [...params, filters.pageSize, (filters.page - 1) * filters.pageSize]
  );

  return { items: rows.map(toProduct), total };
}

export async function findProductBySlug(slug: string): Promise<Product | null> {
  const row = await queryOne<ProductRow>(
    `SELECT ${PRODUCT_COLUMNS} FROM products WHERE LOWER(slug) = LOWER($1) AND active = true`,
    [slug]
  );
  return row ? toProduct(row) : null;
}

export async function findProductById(id: string): Promise<Product | null> {
  const row = await queryOne<ProductRow>(
    `SELECT ${PRODUCT_COLUMNS} FROM products WHERE id = $1`,
    [id]
  );
  return row ? toProduct(row) : null;
}

/** Batched equivalent of findProductById for a set of ids in one query — see catalog.service.ts's getPublicProductsByIds, which this was added specifically to fix an N+1 in (see wishlist.service.ts). */
export async function findProductsByIds(ids: string[]): Promise<Product[]> {
  if (ids.length === 0) return [];
  const rows = await query<ProductRow>(
    `SELECT ${PRODUCT_COLUMNS} FROM products WHERE id = ANY($1)`,
    [ids]
  );
  return rows.map(toProduct);
}

/** Fetches variants for MANY products in a single query — avoids N+1 when listing a page of products. */
export async function listVariantsForProducts(productIds: string[]): Promise<ProductVariant[]> {
  if (productIds.length === 0) return [];
  const rows = await query<VariantRow>(
    "SELECT id, product_id, size, color, stock_qty, sku FROM product_variants WHERE product_id = ANY($1) ORDER BY size",
    [productIds]
  );
  return rows.map(toVariant);
}

export async function findVariantById(id: string): Promise<ProductVariant | null> {
  const row = await queryOne<VariantRow>(
    "SELECT id, product_id, size, color, stock_qty, sku FROM product_variants WHERE id = $1",
    [id]
  );
  return row ? toVariant(row) : null;
}

/**
 * Batched equivalent of findVariantById — added to fix a genuine bug:
 * order.service.ts's low-stock notification check was calling this
 * function under the assumption it already existed, but it never did.
 * Since that call sits inside a try/catch explicitly designed to
 * swallow errors (a notification failure must never affect the order
 * response), this failed silently on every single order — the
 * low-stock admin notification feature has never actually fired. This
 * is the real fix, not a workaround: the batched function this call
 * site always should have had.
 */
export async function findVariantsByIds(ids: string[]): Promise<ProductVariant[]> {
  if (ids.length === 0) return [];
  const rows = await query<VariantRow>(
    "SELECT id, product_id, size, color, stock_qty, sku FROM product_variants WHERE id = ANY($1)",
    [ids]
  );
  return rows.map(toVariant);
}

export async function listImagesForProducts(productIds: string[]): Promise<Map<string, ProductImage[]>> {
  const map = new Map<string, ProductImage[]>();
  if (productIds.length === 0) return map;
  const rows = await query<ProductImageRow>(
    `SELECT id, product_id, url, position, alt_text, storage_key, content_type,
            size_bytes, width, height, created_at
     FROM product_images
     WHERE product_id = ANY($1)
     ORDER BY product_id, position ASC`,
    [productIds]
  );
  for (const r of rows) {
    const list = map.get(r.product_id) ?? [];
    list.push(toProductImage(r));
    map.set(r.product_id, list);
  }
  return map;
}

export async function listImagesForProduct(productId: string): Promise<ProductImage[]> {
  const rows = await query<ProductImageRow>(
    `SELECT id, product_id, url, position, alt_text, storage_key, content_type,
            size_bytes, width, height, created_at
     FROM product_images
     WHERE product_id = $1
     ORDER BY position ASC`,
    [productId]
  );
  return rows.map(toProductImage);
}

/** Sets a product's full image set atomically: deletes existing and inserts the given rows in order. */
export async function replaceProductImages(
  productId: string,
  images: { id: string; url: string; position: number; storageKey: string | null; contentType: string | null; sizeBytes: number | null; width: number | null; height: number | null; altText: string | null }[]
): Promise<ProductImage[]> {
  await withTransaction(async (client) => {
    await client.query("DELETE FROM product_images WHERE product_id = $1", [productId]);
    for (const img of images) {
      await client.query(
        `INSERT INTO product_images (id, product_id, url, position, alt_text, storage_key, content_type, size_bytes, width, height)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [img.id, productId, img.url, img.position, img.altText, img.storageKey, img.contentType, img.sizeBytes, img.width, img.height]
      );
    }
  });
  return listImagesForProduct(productId);
}

export async function appendProductImage(input: {
  id: string;
  productId: string;
  url: string;
  storageKey: string;
  contentType: string;
  sizeBytes: number;
  width: number;
  height: number;
}): Promise<ProductImage> {
  const posRow = await queryOne<{ position: number }>(
    `SELECT COALESCE(MAX(position), -1) + 1 AS position FROM product_images WHERE product_id = $1`,
    [input.productId]
  );
  const row = await queryOne<ProductImageRow>(
    `INSERT INTO product_images (id, product_id, url, position, storage_key, content_type, size_bytes, width, height)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, product_id, url, position, alt_text, storage_key, content_type, size_bytes, width, height, created_at`,
    [input.id, input.productId, input.url, posRow!.position, input.storageKey, input.contentType, input.sizeBytes, input.width, input.height]
  );
  return toProductImage(row!);
}

/** Removes a single image row. Returns true if a row was actually deleted (so the caller can clean up the file). */
export async function deleteProductImageRow(imageId: string): Promise<{ deleted: boolean; storageKey: string | null; productId: string | null; position: number | null }> {
  const row = await queryOne<{ storage_key: string | null; product_id: string | null; position: number | null }>(
    `DELETE FROM product_images WHERE id = $1 RETURNING storage_key, product_id, position`,
    [imageId]
  );
  return row
    ? { deleted: true, storageKey: row.storage_key, productId: row.product_id, position: row.position }
    : { deleted: false, storageKey: null, productId: null, position: null };
}

/** Reorders a product's images by setting each image's position to its index in `orderedImageIds`. */
export async function reorderProductImages(productId: string, orderedImageIds: string[]): Promise<ProductImage[]> {
  await withTransaction(async (client) => {
    for (let i = 0; i < orderedImageIds.length; i++) {
      await client.query(
        `UPDATE product_images SET position = $1 WHERE id = $2 AND product_id = $3`,
        [i, orderedImageIds[i], productId]
      );
    }
  });
  return listImagesForProduct(productId);
}

export async function findProductImageById(imageId: string): Promise<ProductImage | null> {
  const row = await queryOne<ProductImageRow>(
    `SELECT id, product_id, url, position, alt_text, storage_key, content_type,
            size_bytes, width, height, created_at
     FROM product_images WHERE id = $1`,
    [imageId]
  );
  return row ? toProductImage(row) : null;
}

/** Replaces the stored-file metadata of an existing image row (same position kept). */
export async function updateProductImageFile(
  imageId: string,
  file: { storageKey: string; url: string; contentType: string; sizeBytes: number; width: number; height: number }
): Promise<ProductImage | null> {
  const row = await queryOne<ProductImageRow>(
    `UPDATE product_images
     SET storage_key = $2, url = $3, content_type = $4, size_bytes = $5, width = $6, height = $7
     WHERE id = $1
     RETURNING id, product_id, url, position, alt_text, storage_key, content_type, size_bytes, width, height, created_at`,
    [imageId, file.storageKey, file.url, file.contentType, file.sizeBytes, file.width, file.height]
  );
  return row ? toProductImage(row) : null;
}

/** Thrown by insertProduct when the slug (not the SKU) is already taken, so createProduct can retry with a suffixed slug. */
export class ProductSlugConflictError extends ConflictError {
  constructor() {
    super("A product with this slug already exists.");
  }
}

export async function insertProduct(
  input: {
    slug: string;
    name: string;
    brandId: string;
    categoryId: string;
    priceCents: number;
    sku?: string | null;
    compareAtPriceCents?: number | null;
    badgeText?: string | null;
    offerLabel?: string | null;
    offerStartDate?: string | null;
    offerEndDate?: string | null;
    shortDescription?: string | null;
    fullDescription?: string | null;
    /** Collection/campaign tags — drives homepage "featured products" sections and collection pages (see product-filter.repo.ts's `collection` filter, which matches via `tags @> ARRAY[value]`). */
    tags?: string[] | null;
  },
  genderAudienceCodes: string[] = [],
  createdBy?: string | null
): Promise<Product> {
  // Product insert + audience assignment must succeed or fail together: a
  // failure part-way would otherwise orphan a product row with no audience.
  return withTransaction(async (client) => {
    let row: ProductRow;
    try {
      // New products are created INACTIVE (draft) regardless of the
      // active column's own table-level DEFAULT true — a brand-new
      // product has zero variants at this point (variants are added in
      // a separate step, via replaceProductVariants, after creation),
      // so publishing it immediately would put a genuinely unpurchasable
      // product live on the storefront. The admin explicitly activates
      // it afterward via the same "active" toggle updateProduct already
      // exposes — this doesn't strand anything, it just requires the
      // deliberate step of actually finishing the product first.
      const result = await client.query<ProductRow>(
        `INSERT INTO products (slug, name, brand_id, category_id, price_cents, sku, compare_at_price_cents, badge_text, offer_label, offer_start_date, offer_end_date, short_description, full_description, tags, active, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, false, $15, $15)
         RETURNING ${PRODUCT_COLUMNS}`,
        [
          input.slug,
          input.name,
          input.brandId,
          input.categoryId,
          input.priceCents,
          input.sku ?? null,
          input.compareAtPriceCents ?? null,
          input.badgeText ?? null,
          input.offerLabel ?? null,
          input.offerStartDate ?? null,
          input.offerEndDate ?? null,
          input.shortDescription ?? null,
          input.fullDescription ?? null,
          input.tags ?? [],
          createdBy ?? null,
        ]
      );
      const first = result.rows[0];
      if (!first) throw new Error("INSERT ... RETURNING returned no row.");
      row = first;
    } catch (err) {
      if (isPgErrorCode(err, PG_ERROR_CODES.UNIQUE_VIOLATION)) {
        if (err.constraint === "products_sku_unique_idx") {
          throw new ConflictError("A product with this SKU already exists.");
        }
        throw new ProductSlugConflictError();
      }
      if (isPgErrorCode(err, PG_ERROR_CODES.FOREIGN_KEY_VIOLATION)) {
        throw new ConflictError("The specified brand or category does not exist.");
      }
      throw err;
    }
    try {
      for (const code of [...new Set(genderAudienceCodes)]) {
        await client.query(
          "INSERT INTO product_gender_audiences (product_id, gender_audience_id) VALUES ($1, $2)",
          [row.id, code]
        );
      }
    } catch (err) {
      if (isPgErrorCode(err, PG_ERROR_CODES.FOREIGN_KEY_VIOLATION)) {
        throw new ConflictError("One or more gender/audience codes do not exist.");
      }
      throw err;
    }
    return toProduct(row);
  });
}

export async function updateProductFields(
  id: string,
  patch: Partial<{
    name: string;
    slug: string;
    brandId: string;
    categoryId: string;
    priceCents: number;
    active: boolean;
    sku: string | null;
    shortDescription: string | null;
    fullDescription: string | null;
    badgeText: string | null;
    offerLabel: string | null;
    compareAtPriceCents: number | null;
    offerStartDate: string | null;
    offerEndDate: string | null;
    tags: string[] | null;
  }>
): Promise<Product | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.name !== undefined) { params.push(patch.name); sets.push(`name = $${params.length}`); }
  if (patch.priceCents !== undefined) { params.push(patch.priceCents); sets.push(`price_cents = $${params.length}`); }
  if (patch.slug !== undefined) { params.push(patch.slug); sets.push(`slug = $${params.length}`); }
  if (patch.brandId !== undefined) { params.push(patch.brandId); sets.push(`brand_id = $${params.length}`); }
  if (patch.categoryId !== undefined) { params.push(patch.categoryId); sets.push(`category_id = $${params.length}`); }
  if (patch.active !== undefined) {
    params.push(patch.active);
    sets.push(`active = $${params.length}`);
    // Publishing stamps published_at the FIRST time only (Latest Drop order
    // must not jump on unpublish/republish) and always un-archives.
    if (patch.active) sets.push("published_at = COALESCE(published_at, now())", "archived_at = NULL");
  }
  if (patch.sku !== undefined) { params.push(patch.sku ?? null); sets.push(`sku = $${params.length}`); }
  if (patch.shortDescription !== undefined) { params.push(patch.shortDescription ?? null); sets.push(`short_description = $${params.length}`); }
  if (patch.fullDescription !== undefined) { params.push(patch.fullDescription ?? null); sets.push(`full_description = $${params.length}`); }
  if (patch.badgeText !== undefined) { params.push(patch.badgeText ?? null); sets.push(`badge_text = $${params.length}`); }
  if (patch.offerLabel !== undefined) { params.push(patch.offerLabel ?? null); sets.push(`offer_label = $${params.length}`); }
  if (patch.compareAtPriceCents !== undefined) { params.push(patch.compareAtPriceCents ?? null); sets.push(`compare_at_price_cents = $${params.length}`); }
  if (patch.offerStartDate !== undefined) { params.push(patch.offerStartDate ?? null); sets.push(`offer_start_date = $${params.length}`); }
  if (patch.offerEndDate !== undefined) { params.push(patch.offerEndDate ?? null); sets.push(`offer_end_date = $${params.length}`); }
  if (patch.tags !== undefined) { params.push(patch.tags ?? []); sets.push(`tags = $${params.length}`); }
  if (sets.length === 0) {
    const existing = await findProductById(id);
    return existing;
  }
  params.push(id);
  try {
    const row = await queryOne<ProductRow>(
      `UPDATE products SET ${sets.join(", ")} WHERE id = $${params.length}
       RETURNING ${PRODUCT_COLUMNS}`,
      params
    );
    return row ? toProduct(row) : null;
  } catch (err) {
    if (isPgErrorCode(err, PG_ERROR_CODES.UNIQUE_VIOLATION)) {
      if (err.constraint === "products_sku_unique_idx") throw new ConflictError("A product with this SKU already exists.");
      throw new ConflictError("A product with this slug already exists.");
    }
    if (isPgErrorCode(err, PG_ERROR_CODES.FOREIGN_KEY_VIOLATION)) {
      throw new ConflictError("The specified brand or category does not exist.");
    }
    throw err;
  }
}

/**
 * Archive ("delete") — never a hard DELETE: the row stays so order history,
 * wishlists and audit events keep resolving (see migrations 0003 / 0053).
 * An archived product is unlisted and unpurchasable everywhere.
 */
export async function archiveProduct(id: string): Promise<Product | null> {
  const row = await queryOne<ProductRow>(
    `UPDATE products SET active = false, archived_at = COALESCE(archived_at, now()) WHERE id = $1 RETURNING ${PRODUCT_COLUMNS}`,
    [id]
  );
  return row ? toProduct(row) : null;
}

/** Restores an archived product as a DRAFT — the admin re-publishes it deliberately. */
export async function restoreProduct(id: string): Promise<Product | null> {
  const row = await queryOne<ProductRow>(
    `UPDATE products SET archived_at = NULL WHERE id = $1 RETURNING ${PRODUCT_COLUMNS}`,
    [id]
  );
  return row ? toProduct(row) : null;
}

/**
 * Sets absolute stock for a batch of one product's variants in a single
 * transaction — the dedicated inventory path (no need to resubmit the whole
 * product). Each row is locked like checkout locks it, so a concurrent order
 * either commits first (and this overwrites with the admin's counted value)
 * or waits for this to finish.
 */
export async function setVariantStock(productId: string, updates: { variantId: string; stockQty: number }[]): Promise<ProductVariant[]> {
  await withTransaction(async (client) => {
    const ids = [...new Set(updates.map((u) => u.variantId))].sort();
    const locked = await client.query<{ id: string }>(
      "SELECT id FROM product_variants WHERE product_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE",
      [productId, ids]
    );
    if (locked.rows.length !== ids.length) {
      throw new ConflictError("One or more variants do not belong to this product.");
    }
    for (const u of updates) {
      await client.query("UPDATE product_variants SET stock_qty = $2, version = version + 1 WHERE id = $1", [u.variantId, u.stockQty]);
    }
  });
  return listVariantsForProducts([productId]);
}

export type VariantInput = {
  /** Present for existing rows → update stock/sku in place (size/color are the immutable combo keys). Absent → insert a new row. */
  id?: string | null;
  size: string;
  color: string;
  stockQty: number;
  sku?: string | null;
};

/**
 * Reconciles a product's variant set to the admin's submitted matrix in ONE
 * transaction: existing rows' stock/sku are updated, new rows inserted, and
 * rows absent from the payload deleted (carts CASCADE — documented safe in
 * 0004; order_items SET NULL with snapshots — see 0003/0005). A failure
 * anywhere rolls the whole diff back, so repeated edits never leave orphaned
 * or duplicate rows.
 */
export async function replaceProductVariants(productId: string, input: VariantInput[]): Promise<ProductVariant[]> {
  await withTransaction(async (client) => {
    const existing = await client.query<VariantRow>(
      "SELECT id, product_id, size, color, stock_qty, sku FROM product_variants WHERE product_id = $1 FOR UPDATE",
      [productId]
    );
    const existingById = new Map(existing.rows.map((r) => [r.id, r]));
    const keptIds = new Set<string>();

    for (const v of input) {
      if (v.id && existingById.has(v.id)) {
        keptIds.add(v.id);
        try {
          await client.query("UPDATE product_variants SET stock_qty = $2, sku = $3 WHERE id = $1", [
            v.id,
            v.stockQty,
            v.sku ?? null,
          ]);
        } catch (err) {
          if (isPgErrorCode(err, PG_ERROR_CODES.UNIQUE_VIOLATION)) {
            if (err.constraint === "product_variants_sku_unique_idx") {
              throw new ConflictError("A variant with this SKU already exists.");
            }
            throw new ConflictError("A variant with this color/size already exists.");
          }
          throw err;
        }
      } else if (v.id && !existingById.has(v.id)) {
        throw new ConflictError("One or more variants do not belong to this product.");
      } else {
        try {
          await client.query(
            "INSERT INTO product_variants (product_id, size, color, stock_qty, sku) VALUES ($1, $2, $3, $4, $5)",
            [productId, v.size, v.color, v.stockQty, v.sku ?? null]
          );
        } catch (err) {
          if (isPgErrorCode(err, PG_ERROR_CODES.UNIQUE_VIOLATION)) {
            if (err.constraint === "product_variants_sku_unique_idx") {
              throw new ConflictError("A variant with this SKU already exists.");
            }
            throw new ConflictError("A variant with this color/size already exists.");
          }
          throw err;
        }
      }
    }

    for (const r of existing.rows) {
      if (!keptIds.has(r.id)) {
        await client.query("DELETE FROM product_variants WHERE id = $1", [r.id]);
      }
    }
  });

  return listVariantsForProducts([productId]);
}

// ---- Gender / audience (many-to-many, authoritative — see 0011) ----

type AudienceRow = { product_id: string; code: string; name: string };

/**
 * Fetches the audience set for MANY products in a single query — avoids N+1
 * when serializing a listing page. Products with no audiences are omitted.
 */
export async function listAudiencesForProducts(productIds: string[]): Promise<Map<string, GenderAudience[]>> {
  const map = new Map<string, GenderAudience[]>();
  if (productIds.length === 0) return map;
  const rows = await query<AudienceRow>(
    `SELECT pga.product_id, ga.code, ga.name
     FROM product_gender_audiences pga
     JOIN gender_audiences ga ON ga.code = pga.gender_audience_id
     WHERE pga.product_id = ANY($1)
     ORDER BY ga.code`,
    [productIds]
  );
  for (const r of rows) {
    const list = map.get(r.product_id) ?? [];
    list.push({ code: r.code, name: r.name });
    map.set(r.product_id, list);
  }
  return map;
}

/**
 * Atomically replaces a product's audience set (delete-then-insert in one
 * transaction). Passing an empty array removes all audiences (product then
 * becomes unassigned). Enforces that every code is a real audience via the FK.
 */
export async function replaceProductAudiences(productId: string, codes: string[]): Promise<void> {
  const unique = [...new Set(codes)];
  await withTransaction(async (client) => {
    await client.query("DELETE FROM product_gender_audiences WHERE product_id = $1", [productId]);
    for (const code of unique) {
      await client.query(
        "INSERT INTO product_gender_audiences (product_id, gender_audience_id) VALUES ($1, $2)",
        [productId, code]
      );
    }
  });
}

export type CategoryAudienceRow = { id: string; slug: string; name: string; parent_id: string | null; image_url: string | null; icon: string; count: string };

/**
 * "Shop by Category" for a given audience: the DISTINCT categories that carry
 * active products assigned to that audience, each with a real product count.
 * Top-level categories are included via a subquery that sums their own +
 * descendant products, so "Men → Shoes" surfaces both Shoes and its children
 * (sneakers, boots, ...) without double counting. Aggregated in SQL (no N+1).
 */
export async function listCategoriesByGender(genderCode: string): Promise<CategoryAudienceRow[]> {
  return query<CategoryAudienceRow>(
    `SELECT c.id, c.slug, c.name, c.parent_id, c.image_url, c.icon,
            (
              SELECT count(*)::text
              FROM products p
              WHERE p.active = true
                AND p.category_id IN (
                  SELECT d.id FROM categories d WHERE d.id = c.id OR d.parent_id = c.id
                )
                AND EXISTS (
                  SELECT 1 FROM product_gender_audiences pga
                  WHERE pga.product_id = p.id AND pga.gender_audience_id = $1
                )
            ) AS count
     FROM categories c
     WHERE $1::text <> ''
       -- A category only belongs in this gender's nav dropdown if it (or
       -- one of its child categories) actually has at least one active
       -- product for that gender — this is the REAL filter. The previous
       -- WHERE clause here was effectively a no-op (true for any
       -- non-empty gender code), which meant every category in the
       -- entire store appeared identically in BOTH the Women's and Men's
       -- dropdowns regardless of relevance — the count subquery above
       -- was already scoping PRODUCT COUNTS correctly, but nothing was
       -- using that same logic to decide which categories to include at
       -- all. Reuses the identical EXISTS/IN pattern the count subquery
       -- already uses, so a category and its badge count are always
       -- consistent with each other.
       AND EXISTS (
         SELECT 1
         FROM products p
         WHERE p.active = true
           AND p.category_id IN (
             SELECT d.id FROM categories d WHERE d.id = c.id OR d.parent_id = c.id
           )
           AND EXISTS (
             SELECT 1 FROM product_gender_audiences pga
             WHERE pga.product_id = p.id AND pga.gender_audience_id = $1
           )
       )
     ORDER BY c.name`,
    [genderCode]
  );
}

/** Admin override of a logo's presentation tone (NULL = back to "unknown / render as uploaded"). */
export async function setLogoTone(brandId: string, tone: "light" | "dark" | null): Promise<BrandLogo | null> {
  const row = await queryOne<LogoRow>(
    `UPDATE brand_logos SET tone = $2 WHERE brand_id = $1
     RETURNING id, brand_id, storage_key, url, content_type, size_bytes, width, height, created_at, updated_at, tone`,
    [brandId, tone]
  );
  return row ? toLogo(row) : null;
}
