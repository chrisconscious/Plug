/**
 * Catalog search & filtering — the authoritative backend implementation for the
 * storefront product listing engine.
 *
 * All filtering happens in parameterized SQL here (never client-side). One
 * shared WHERE-builder (`buildProductWhere`) is reused by:
 *   - the paged product listing (`listFilteredProducts`)
 *   - the total-count query
 *   - the grouped "facets" queries (brand / category / size / color / gender /
 *     collection counts plus the price distribution used for quick ranges)
 * so that facet counts always reflect the *current* filter context with the
 * facet's own dimension removed ("if I also picked this") — and so filter
 * combinations never fan out the result rows (variant filters use `EXISTS`
 * subqueries, keeping LIMIT/OFFSET correct).
 */
import { query, queryOne } from "../client";

export type FilterProductRow = {
  id: string;
  slug: string;
  name: string;
  brand_id: string;
  category_id: string;
  price_cents: number;
  active: boolean;
  gender: string | null;
  compare_at_price_cents: number | null;
  tags: string[];
  sku: string | null;
  short_description: string | null;
  full_description: string | null;
  badge_text: string | null;
  offer_label: string | null;
  offer_start_date: string | null;
  offer_end_date: string | null;
};

export type ProductFilters = {
  brandIds?: string[];
  /** Resolved category ids for a `category=` filter (parent + all descendants). */
  categoryIds?: string[];
  /** Resolved ids for an exact `subcategory=` filter. */
  exactCategoryIds?: string[];
  sizes?: string[];
  colors?: string[];
  minPrice?: number; // minor units (cents)
  maxPrice?: number; // minor units (cents)
  gender?: string;
  sale?: boolean;
  /** A single collection tag, e.g. "new" | "trending" | "campus". */
  collection?: string;
  /** Resolved lifestyle ids (any-match) — migration 0019 join filter. */
  lifestyleIds?: string[];
  /**
   * Selected attribute option ids (migration 0033), FLAT and possibly
   * spanning multiple attribute groups (e.g. Fit=Baggy AND Rise=HighRise).
   * Semantics, per the attribute engine's own spec: options WITHIN the
   * same group are OR'd (Fit=Baggy OR Fit=Slim matches either), but
   * DIFFERENT groups are AND'd (Fit=Baggy AND Rise=HighRise requires
   * both). See buildProductWhere's handling below for how a single SQL
   * fragment expresses both at once.
   */
  attributeOptionIds?: string[];
  search?: string;
  availability?: "in_stock" | "out_of_stock";
  sort?: "recommended" | "newest" | "price_asc" | "price_desc";
  page?: number;
  pageSize?: number;
};

type Where = { clause: string; params: unknown[] };

/**
 * Builds `WHERE active = true` (+ any active filters, minus those named in
 * `exclude`) referencing the products alias `p` (and `pv` inside EXISTS
 * subqueries). The same builder powers listings, counts, and every facet so
 * counts are always consistent with the listing.
 */
export function buildProductWhere(filters: ProductFilters, exclude: (keyof ProductFilters)[] = []): Where {
  const X = (k: keyof ProductFilters) => !exclude.includes(k);
  const params: unknown[] = [];
  const conds: string[] = ["p.active = true"];

  const push = (sql: string, ...vals: unknown[]) => {
    params.push(...vals);
    conds.push(sql);
  };

  const anyOf = (col: string, values: string[] | undefined) => {
    if (!values || values.length === 0) return;
    const arr = `$${params.length + 1}`;
    push(`${col} = ANY(${arr})`, values);
  };

  if (X("brandIds")) anyOf("p.brand_id", filters.brandIds);

  // Parent `category=` expands to descendants; an exact `subcategory=` (if
  // both present) further narrows via AND. Only one applies in any real flow,
  // but honoring both keeps the semantics consistent and predictable.
  if (X("categoryIds") && filters.categoryIds?.length) {
    anyOf("p.category_id", filters.categoryIds);
  }
  if (X("exactCategoryIds") && filters.exactCategoryIds?.length) {
    anyOf("p.category_id", filters.exactCategoryIds);
  }

  if (X("sizes") && filters.sizes?.length) {
    const arr = `$${params.length + 1}`;
    // Only sizes that can actually be bought: a customer filtering by "M"
    // must not be shown products whose M is sold out.
    push(`EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id AND pv.size = ANY(${arr}) AND pv.stock_qty > 0)`, filters.sizes);
  }

  if (X("colors") && filters.colors?.length) {
    const arr = `$${params.length + 1}`;
    push(`EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id AND pv.color = ANY(${arr}) AND pv.stock_qty > 0)`, filters.colors);
  }

  if (X("availability")) {
    if (filters.availability === "in_stock") {
      push(`EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id AND pv.stock_qty > 0)`);
    } else if (filters.availability === "out_of_stock") {
      push(`NOT EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id AND pv.stock_qty > 0)`);
    }
  }

  if (X("minPrice") && filters.minPrice != null) push(`p.price_cents >= $${params.length + 1}`, filters.minPrice);
  if (X("maxPrice") && filters.maxPrice != null) push(`p.price_cents <= $${params.length + 1}`, filters.maxPrice);

  if (X("gender") && filters.gender) {
    // Authoritative gender model is the many-to-many join (0011). ANY-match:
    // a product matches `gender=men` if its audience set contains "men",
    // whether or not it is also unisex. EXISTS keeps the join from fanning
    // out result rows, so LIMIT/OFFSET stay correct.
    push(
      `EXISTS (SELECT 1 FROM product_gender_audiences pga
               WHERE pga.product_id = p.id AND pga.gender_audience_id = $${params.length + 1})`,
      filters.gender
    );
  }

  if (X("sale") && filters.sale) {
    // A product is "on sale" when it has a compare-at price above its selling
    // price AND (if a window is set) the window covers today. Date arithmetic
    // uses CURRENT_DATE (IMMUTABLE-safe here because it lives in a query, not
    // a CHECK constraint); a NULL bound means "no lower/upper limit".
    push(
      `p.compare_at_price_cents IS NOT NULL
       AND p.compare_at_price_cents > p.price_cents
       AND (p.offer_start_date IS NULL OR p.offer_start_date <= CURRENT_DATE)
       AND (p.offer_end_date IS NULL OR p.offer_end_date >= CURRENT_DATE)`
    );
  }

  if (X("collection") && filters.collection) push(`p.tags @> ARRAY[$${params.length + 1}]::text[]`, filters.collection);

  if (X("lifestyleIds") && filters.lifestyleIds?.length) {
    // Lifestyle membership is a pure join (migration 0019); ANY-match keeps a
    // multi-lifestyle product in every lifestyle it belongs to, and EXISTS
    // prevents the join from fanning out LIMIT/OFFSET rows.
    const arr = `$${params.length + 1}`;
    push(
      `EXISTS (SELECT 1 FROM product_lifestyles pl
               WHERE pl.product_id = p.id AND pl.lifestyle_id = ANY(${arr}))`,
      filters.lifestyleIds
    );
  }

  if (X("attributeOptionIds") && filters.attributeOptionIds?.length) {
    // Within-group OR, across-group AND (see the ProductFilters field's own
    // doc comment). Expressed as: join the product's attribute values to
    // the SELECTED option ids only, then require the number of DISTINCT
    // GROUPS matched to equal the number of distinct groups actually
    // represented among the selected ids — if the customer picked options
    // from 2 different groups, the product must match at least one
    // selected option from EACH of those 2 groups, but any one option
    // within a group is enough to satisfy that group.
    const arr = `$${params.length + 1}`;
    push(
      `(SELECT COUNT(DISTINCT ao.attribute_group_id)
        FROM product_attribute_values pav
        JOIN attribute_options ao ON ao.id = pav.attribute_option_id
        WHERE pav.product_id = p.id AND pav.attribute_option_id = ANY(${arr}))
       = (SELECT COUNT(DISTINCT ao2.attribute_group_id) FROM attribute_options ao2 WHERE ao2.id = ANY(${arr}))`,
      filters.attributeOptionIds
    );
  }

  if (X("search") && filters.search) {
    const prefixQuery = toPrefixTsQuery(filters.search);
    if (prefixQuery) {
      // Prefix match on the product name ("shir" finds "shirt") via the GIN
      // index, plus brand / category name matches (both tiny tables).
      const tq = `$${params.length + 1}`;
      const like = `$${params.length + 2}`;
      push(
        `(p.search_vector @@ to_tsquery('english', ${tq})
          OR p.brand_id IN (SELECT b.id FROM brands b WHERE b.name ILIKE ${like})
          OR p.category_id IN (SELECT c.id FROM categories c WHERE c.name ILIKE ${like}))`,
        prefixQuery,
        `%${filters.search.trim().replace(/[\\%_]/g, (c) => "\\" + c)}%`
      );
    }
  }

  return { clause: conds.join(" AND "), params };
}

/**
 * Builds a safe prefix tsquery ("black tee" -> "black:* & tee:*") from free
 * text: only letters/digits survive, so user input can never inject tsquery
 * operators. Returns null when nothing searchable remains.
 */
export function toPrefixTsQuery(input: string): string | null {
  const words = input
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 8);
  return words.length ? words.map((w) => `${w}:*`).join(" & ") : null;
}

const SORT_SQL: Record<NonNullable<ProductFilters["sort"]>, string> = {
  price_asc: "p.price_cents ASC, p.created_at DESC",
  price_desc: "p.price_cents DESC, p.created_at DESC",
  // "Newest" = most recently PUBLISHED (migration 0053) — this is the
  // Latest Drop ordering. id breaks ties so paging is deterministic.
  newest: "p.published_at DESC NULLS LAST, p.created_at DESC, p.id DESC",
  recommended: "p.published_at DESC NULLS LAST, p.created_at DESC, p.id DESC",
};

export const DEFAULT_SORT: NonNullable<ProductFilters["sort"]> = "recommended";

/** One page of active products matching the filters. */
export async function listFilteredProducts(
  filters: ProductFilters
): Promise<{ items: FilterProductRow[]; total: number }> {
  const where = buildProductWhere(filters);
  const orderBy = SORT_SQL[filters.sort ?? DEFAULT_SORT];

  const countRow = await queryOne<{ count: string }>(
    `SELECT count(*)::text AS count FROM products p WHERE ${where.clause}`,
    where.params
  );
  const total = Number(countRow?.count ?? "0");

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, filters.pageSize ?? 24));
  const limitIdx = where.params.length + 1;
  const offsetIdx = where.params.length + 2;

  const rows = await query<FilterProductRow>(
    `SELECT p.id, p.slug, p.name, p.brand_id, p.category_id, p.price_cents, p.active,
            p.gender, p.compare_at_price_cents, p.tags,
            p.sku, p.short_description, p.full_description, p.badge_text,
            p.offer_label, p.offer_start_date, p.offer_end_date
     FROM products p
     WHERE ${where.clause}
     ORDER BY ${orderBy}
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    [...where.params, pageSize, (page - 1) * pageSize]
  );

  return { items: rows, total };
}

export type FacetValue = { value: string; count: number };

export type ProductFacets = {
  brands: (FacetValue & { name: string })[]; // brand slug -> count (context minus brand)
  categories: (FacetValue & { name: string; slug: string; parentId: string | null })[];
  sizes: FacetValue[];
  colors: FacetValue[];
  genders: FacetValue[];
  collections: FacetValue[];
  availability: { inStock: number; outOfStock: number };
  price: { min: number; max: number; p25: number; p50: number; p75: number };
};

/**
 * Computes, for the current filter context, the available options + counts for
 * every facet. Each facet's own dimension is excluded from its WHERE so the
 * count reads "if I also picked this option". Implemented as a small number of
 * grouped aggregate queries (no per-option count queries, no N+1).
 */
export async function getProductFacets(filters: ProductFilters): Promise<ProductFacets> {
  const brandWhere = buildProductWhere(filters, ["brandIds"]);
  const brandRows = await query<{ slug: string; name: string; count: string }>(
    `SELECT b.slug AS slug, min(b.name) AS name, count(*)::text AS count
     FROM products p
     JOIN brands b ON b.id = p.brand_id
     WHERE ${brandWhere.clause}
     GROUP BY b.slug
     ORDER BY count(*) DESC`,
    brandWhere.params
  );

  const catWhere = buildProductWhere(filters, ["categoryIds", "exactCategoryIds"]);
  const catRows = await query<{ slug: string; name: string; parent_id: string | null; count: string }>(
    `SELECT c.slug AS slug, min(c.name) AS name, min(c.parent_id::text) AS parent_id, count(*)::text AS count
     FROM products p
     JOIN categories c ON c.id = p.category_id
     WHERE ${catWhere.clause}
     GROUP BY c.slug
     ORDER BY count(*) DESC`,
    catWhere.params
  );

  const sizeWhere = buildProductWhere(filters, ["sizes"]);
  const sizeRows = await query<{ value: string; count: string }>(
    `SELECT pv.size AS value, count(DISTINCT p.id)::text AS count
     FROM products p
     JOIN product_variants pv ON pv.product_id = p.id AND pv.stock_qty > 0
     WHERE ${sizeWhere.clause}
     GROUP BY pv.size
     ORDER BY pv.size`,
    sizeWhere.params
  );

  const colorWhere = buildProductWhere(filters, ["colors"]);
  const colorRows = await query<{ value: string; count: string }>(
    `SELECT pv.color AS value, count(DISTINCT p.id)::text AS count
     FROM products p
     JOIN product_variants pv ON pv.product_id = p.id AND pv.stock_qty > 0
     WHERE ${colorWhere.clause}
     GROUP BY pv.color
     ORDER BY count(DISTINCT p.id) DESC`,
    colorWhere.params
  );

  const genderWhere = buildProductWhere(filters, ["gender"]);
  const genderRows = await query<{ value: string; count: string }>(
    `SELECT ga.code AS value, count(*)::text AS count
     FROM products p
     JOIN product_gender_audiences pga ON pga.product_id = p.id
     JOIN gender_audiences ga ON ga.code = pga.gender_audience_id
     WHERE ${genderWhere.clause}
     GROUP BY ga.code
     ORDER BY count(*) DESC`,
    genderWhere.params
  );

  const collWhere = buildProductWhere(filters, ["collection"]);
  const collRows = await query<{ value: string; count: string }>(
    `SELECT tag AS value, count(*)::text AS count
     FROM products p, unnest(p.tags) AS tag
     WHERE ${collWhere.clause}
     GROUP BY tag
     ORDER BY count(*) DESC`,
    collWhere.params
  );

  const availWhere = buildProductWhere(filters, ["availability"]);
  const availRows = await queryOne<{ in_stock: string; out_of_stock: string }>(
    `SELECT
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id AND pv.stock_qty > 0))::text AS in_stock,
       count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id AND pv.stock_qty > 0))::text AS out_of_stock
     FROM products p
     WHERE ${availWhere.clause}`,
    availWhere.params
  );

  const priceWhere = buildProductWhere(filters, ["minPrice", "maxPrice"]);
  const priceRows = await queryOne<{ min: string; max: string; p25: string; p50: string; p75: string }>(
    `SELECT
       min(p.price_cents)::text AS min,
       max(p.price_cents)::text AS max,
       percentile_disc(0.25) WITHIN GROUP (ORDER BY p.price_cents)::text AS p25,
       percentile_disc(0.50) WITHIN GROUP (ORDER BY p.price_cents)::text AS p50,
       percentile_disc(0.75) WITHIN GROUP (ORDER BY p.price_cents)::text AS p75
     FROM products p
     WHERE ${priceWhere.clause}`,
    priceWhere.params
  );

  return {
    brands: brandRows.map((r) => ({ value: r.slug, name: r.name, count: Number(r.count) })),
    categories: catRows.map((r) => ({
      value: r.slug,
      name: r.name,
      slug: r.slug,
      parentId: r.parent_id,
      count: Number(r.count),
    })),
    sizes: sizeRows.map((r) => ({ value: r.value, count: Number(r.count) })),
    colors: colorRows.map((r) => ({ value: r.value, count: Number(r.count) })),
    genders: genderRows.map((r) => ({ value: r.value!, count: Number(r.count) })),
    collections: collRows.map((r) => ({ value: r.value, count: Number(r.count) })),
    availability: {
      inStock: Number(availRows?.in_stock ?? "0"),
      outOfStock: Number(availRows?.out_of_stock ?? "0"),
    },
    price: {
      min: Number(priceRows?.min ?? "0"),
      max: Number(priceRows?.max ?? "0"),
      p25: Number(priceRows?.p25 ?? "0"),
      p50: Number(priceRows?.p50 ?? "0"),
      p75: Number(priceRows?.p75 ?? "0"),
    },
  };
}
