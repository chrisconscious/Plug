import * as catalogRepo from "../db/repos/catalog.repo";
import * as lifestyleRepo from "../db/repos/lifestyles.repo";
import * as attributeRepo from "../db/repos/attribute.repo";
import * as wishlistRepo from "../db/repos/wishlist.repo";
import * as adminProductLimitsRepo from "../db/repos/admin-product-limits.repo";
import { toDateOnly } from "../db/repos/catalog.repo";
import * as productFilterRepo from "../db/repos/product-filter.repo";
import { NotFoundError, ValidationError } from "../errors";
import { recordAuditEvent } from "../audit";
import { notifyWishlistersProductBackInStock } from "./notifications.service";
import type { Brand, Product, ProductVariant, Category } from "../db/types";
import type { Role } from "../rbac";
import { brandLogoStorage, brandCampaignImageStorage, productImageStorage } from "../storage/storage";
import { randomUUID } from "crypto";
import * as mediaService from "./media.service";
import * as mediaRepo from "../db/repos/media.repo";
import { logger } from "../logger";

/**
 * "Live sale" test shared by the public serializers and the storefront sale
 * filter (product-filter.repo.ts applies the same window in SQL). A price is
 * only surfaced as a sale when it has a compare-at above its selling price AND
 * (when a window is set) the window covers the current date. NULL bounds mean
 * unbounded, mirroring the 0012/0013 hero date policy.
 */
export function isSaleLive(compareAt: number | null | undefined, price: number, start: string | null | undefined, end: string | null | undefined): boolean {
  if (compareAt == null || compareAt <= price) return false;
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (start && today < start) return false;
  if (end && today > end) return false;
  return true;
}

/** discount % of a live sale, floored to match the money module's rounding style. */
const discountPercentOf = (compareAt: number, price: number): number =>
  Math.floor((100 * (compareAt - price)) / compareAt);

function serializeProductWithVariants(
  product: Product,
  brand: { id: string; slug: string; name: string } | null,
  category: { id: string; slug: string; name: string; imageUrl?: string | null; parentId?: string | null } | null,
  variants: ProductVariant[],
  opts: { publicView?: boolean } = {}
) {
  const compareAt = product.compareAtPriceCents ?? null;
  const liveSale = isSaleLive(compareAt, product.priceCents, product.offerStartDate, product.offerEndDate);
  const rawSale = compareAt != null && compareAt > product.priceCents;
  const onSale = opts.publicView ? liveSale : rawSale;

  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    brand,
    category,
    priceCents: product.priceCents,
    compareAtPriceCents: opts.publicView ? (liveSale ? compareAt : null) : compareAt,
    onSale,
    // Savings % is derived server-side from compare-at vs price — never stored,
    // so the strikethrough and the "Save X%" can never contradict each other.
    discountPercent: onSale && compareAt != null ? discountPercentOf(compareAt, product.priceCents) : null,
    gender: product.gender ?? null,
    genderAudiences: product.genderAudiences ?? [],
    lifestyles: product.lifestyles ?? [],
    images: product.images,
    active: product.active,
    ...(opts.publicView
      ? {}
      : {
          // Fulfillment/scheduling details are admin-only (like variant stock
          // counts); the public storefront gets the presentation layer only.
          sku: product.sku ?? null,
          offerStartDate: product.offerStartDate ?? null,
          offerEndDate: product.offerEndDate ?? null,
          // Collection/campaign tags — admin needs to see/edit current
          // membership; the storefront only needs the FILTER capability
          // (already served by product-filter.repo.ts), not the raw list.
          tags: product.tags ?? [],
        }),
    shortDescription: product.shortDescription ?? null,
    fullDescription: product.fullDescription ?? null,
    badgeText: product.badgeText ?? null,
    offerLabel: product.offerLabel ?? null,
    variants: variants.map((v) => ({
      id: v.id,
      size: v.size,
      color: v.color,
      // Expose availability, not exact stock count, to reduce competitive
      // intel leakage while still letting the UI show "Low stock" states.
      inStock: v.stockQty > 0,
      lowStock: v.stockQty > 0 && v.stockQty <= 5,
      // Full inventory/fulfillment detail is admin-only, mirroring how sku
      // and offer dates above are withheld from the public storefront.
      ...(opts.publicView
        ? {}
        : {
            stockQty: v.stockQty,
            sku: v.sku ?? null,
          }),
    })),
  };
}

export type ProductFilters = {
  brandSlug?: string;
  categorySlug?: string;
  search?: string;
  page: number;
  pageSize: number;
  includeInactive?: boolean;
};

// Small in-process caches for brand/category lookups by slug — these are
// tiny, rarely-changing reference tables (a handful to a few hundred rows),
// so avoiding a query per filtered listing request is a safe, low-risk
// optimization. Real cross-instance caching (Redis) is a later-phase
// concern — see docs/DATABASE.md "Caching".
const brandCache = new Map<string, string | null>(); // slug -> id | null (not found)
const categoryCache = new Map<string, string | null>();

// Resolution result: matched=true when no filter or a real record resolves,
// matched=false when a requested slug matches nothing (-> empty result set).
async function resolveBrandId(
  slug: string | undefined
): Promise<{ matched: boolean; id?: string }> {
  if (!slug) return { matched: true };
  if (!brandCache.has(slug)) {
    const brand = await catalogRepo.findBrandBySlug(slug);
    brandCache.set(slug, brand?.id ?? null);
  }
  const id = brandCache.get(slug) ?? null;
  return id ? { matched: true, id } : { matched: false };
}

async function resolveCategoryId(
  slug: string | undefined
): Promise<{ matched: boolean; id?: string }> {
  if (!slug) return { matched: true };
  if (!categoryCache.has(slug)) {
    const category = await catalogRepo.findCategoryBySlug(slug);
    categoryCache.set(slug, category?.id ?? null);
  }
  const id = categoryCache.get(slug) ?? null;
  return id ? { matched: true, id } : { matched: false };
}

export async function listProducts(filters: ProductFilters) {
  const [brand, category, brands, categories] = await Promise.all([
    resolveBrandId(filters.brandSlug),
    resolveCategoryId(filters.categorySlug),
    catalogRepo.listBrands(),
    catalogRepo.listCategories(),
  ]);

  if (!brand.matched || !category.matched) {
    return {
      items: [],
      pagination: { page: filters.page, pageSize: filters.pageSize, total: 0 },
    };
  }

  const { items, total } = await catalogRepo.listProducts({
    brandId: brand.id,
    categoryId: category.id,
    search: filters.search,
    page: filters.page,
    pageSize: filters.pageSize,
    includeInactive: filters.includeInactive,
  });

  const variants = await catalogRepo.listVariantsForProducts(items.map((p) => p.id));
  const variantsByProduct = new Map<string, ProductVariant[]>();
  for (const v of variants) {
    const list = variantsByProduct.get(v.productId) ?? [];
    list.push(v);
    variantsByProduct.set(v.productId, list);
  }
  const audiencesByProduct = await catalogRepo.listAudiencesForProducts(items.map((p) => p.id));
  const lifestylesByProduct = await lifestyleRepo.listLifestylesForProducts(items.map((p) => p.id));
  const brandById = new Map(brands.map((b) => [b.id, b]));
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  return {
    items: items.map((p) =>
      serializeProductWithVariants(
        {
          ...p,
          genderAudiences: audiencesByProduct.get(p.id) ?? [],
          lifestyles: lifestylesByProduct.get(p.id) ?? [],
        },
        brandById.get(p.brandId) ?? null,
        categoryById.get(p.categoryId) ?? null,
        variantsByProduct.get(p.id) ?? []
      )
    ),
    pagination: { page: filters.page, pageSize: filters.pageSize, total },
  };
}

/**
 * Public storefront listing — the reusable engine behind /shop and every
 * pre-filtered listing (brand, category, subcategory, search, sale, collection).
 * All filters are authoritative on the backend; slugs are resolved to ids and a
 * `category=` expands to the selected category plus all of its descendants.
 */
export type ProductListQuery = {
  brand?: string[]; // brand slugs (multi-select, comma-separated)
  category?: string; // category slug (parent — includes descendants)
  subcategory?: string; // exact subcategory slug
  size?: string[];
  color?: string[];
  minPrice?: number;
  maxPrice?: number;
  gender?: string;
  sale?: boolean;
  collection?: string;
  /** Lifestyle slug (migration 0019). Only ACTIVE lifestyles resolve (inactive → empty listing). */
  lifestyle?: string;
  /** Selected attribute option ids (migration 0033) — see ProductFilters' own field doc for the within-group-OR/across-group-AND semantics. Unlike brand/category/lifestyle, these are opaque ids, not slugs, since an option's meaning is only unambiguous alongside its group. */
  attributeOptionIds?: string[];
  availability?: "in_stock" | "out_of_stock";
  sort?: NonNullable<productFilterRepo.ProductFilters["sort"]>;
  search?: string;
  page: number;
  pageSize: number;
};

function resolveDescendantCategoryIds(categories: Category[], root: Category): string[] {
  const ids = new Set<string>([root.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of categories) {
      if (c.parentId && ids.has(c.parentId) && !ids.has(c.id)) {
        ids.add(c.id);
        changed = true;
      }
    }
  }
  return [...ids];
}

/**
 * Resolves multi brand slugs to ids. Returns null when ANY requested slug is
 * unknown (the whole listing should then be empty, not silently drop one).
 */
async function resolveBrandIds(slugs: string[] | undefined): Promise<string[] | null> {
  if (!slugs || slugs.length === 0) return [];
  const ids: string[] = [];
  for (const s of slugs) {
    const { matched, id } = await resolveBrandId(s);
    if (!matched) return null;
    ids.push(id!);
  }
  return ids;
}

export async function listProductsV2(filters: ProductListQuery) {
  const [brands, categories] = await Promise.all([catalogRepo.listBrands(), catalogRepo.listCategories()]);

  let noMatch = false;

  const brandIds = await resolveBrandIds(filters.brand);
  if (brandIds === null) noMatch = true;

  let categoryIds: string[] | undefined;
  if (filters.category && !noMatch) {
    const cat = await catalogRepo.findCategoryBySlug(filters.category);
    if (!cat) noMatch = true;
    else categoryIds = resolveDescendantCategoryIds(categories, cat);
  }

  let exactCategoryIds: string[] | undefined;
  if (filters.subcategory && !noMatch) {
    const sub = await catalogRepo.findCategoryBySlug(filters.subcategory);
    if (!sub) noMatch = true;
    else exactCategoryIds = [sub.id];
  }

  // Lifestyle is a storefront context, not a silent filter: an unknown OR
  // deactivated lifestyle yields an empty listing (the lifestyle detail route
  // 404s independently), so stale links never show orphaned products.
  let lifestyleIds: string[] | undefined;
  if (filters.lifestyle && !noMatch) {
    const lifestyle = await lifestyleRepo.findLifestyleBySlug(filters.lifestyle);
    if (!lifestyle || !lifestyle.active) noMatch = true;
    else lifestyleIds = [lifestyle.id];
  }

  if (noMatch) {
    return {
      items: [],
      pagination: { page: filters.page, pageSize: filters.pageSize, total: 0 },
      facets: await productFilterRepo.getProductFacets({
        brandIds: [],
        categoryIds: [],
        exactCategoryIds: [],
        lifestyleIds: [],
        page: filters.page,
        pageSize: filters.pageSize,
      }),
    };
  }

  const repoFilters: productFilterRepo.ProductFilters = {
    brandIds: brandIds ?? [],
    categoryIds,
    exactCategoryIds,
    sizes: filters.size,
    colors: filters.color,
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice,
    gender: filters.gender,
    sale: filters.sale,
    collection: filters.collection,
    lifestyleIds,
    attributeOptionIds: filters.attributeOptionIds,
    availability: filters.availability,
    search: filters.search,
    sort: filters.sort,
    page: filters.page,
    pageSize: filters.pageSize,
  };

  const [{ items, total }, facets] = await Promise.all([
    productFilterRepo.listFilteredProducts(repoFilters),
    productFilterRepo.getProductFacets(repoFilters),
  ]);

  const [variants, imagesByProduct, audiencesByProduct, lifestylesByProduct] = await Promise.all([
    catalogRepo.listVariantsForProducts(items.map((p) => p.id)),
    catalogRepo.listImagesForProducts(items.map((p) => p.id)),
    catalogRepo.listAudiencesForProducts(items.map((p) => p.id)),
    lifestyleRepo.listLifestylesForProducts(items.map((p) => p.id)),
  ]);
  const variantsByProduct = new Map<string, ProductVariant[]>();
  for (const v of variants) {
    const list = variantsByProduct.get(v.productId) ?? [];
    list.push(v);
    variantsByProduct.set(v.productId, list);
  }
  const brandById = new Map(brands.map((b) => [b.id, b]));
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  return {
    items: items.map((p) =>
      serializeProductWithVariants(
        {
          id: p.id,
          slug: p.slug,
          name: p.name,
          brandId: p.brand_id,
          categoryId: p.category_id,
          priceCents: p.price_cents,
          compareAtPriceCents: p.compare_at_price_cents,
          gender: p.gender,
          genderAudiences: audiencesByProduct.get(p.id) ?? [],
          lifestyles: lifestylesByProduct.get(p.id) ?? [],
          images: imagesByProduct.get(p.id) ?? [],
          active: p.active,
          sku: p.sku,
          shortDescription: p.short_description,
          fullDescription: p.full_description,
          badgeText: p.badge_text,
          offerLabel: p.offer_label,
          offerStartDate: toDateOnly(p.offer_start_date),
          offerEndDate: toDateOnly(p.offer_end_date),
        },
        brandById.get(p.brand_id) ?? null,
        categoryById.get(p.category_id) ?? null,
        variantsByProduct.get(p.id) ?? [],
        { publicView: true }
      )
    ),
    pagination: { page: filters.page, pageSize: filters.pageSize, total },
    facets,
  };
}

/** Facets for the current filter context — used to (re)render the sidebar without a full list fetch. */
export async function getFacets(filters: ProductListQuery) {
  const brandIds = (await resolveBrandIds(filters.brand)) ?? [];
  const categories = await catalogRepo.listCategories();
  let categoryIds: string[] | undefined;
  let exactCategoryIds: string[] | undefined;
  if (filters.category) {
    const cat = await catalogRepo.findCategoryBySlug(filters.category);
    if (cat) categoryIds = resolveDescendantCategoryIds(categories, cat);
  }
  if (filters.subcategory) {
    const sub = await catalogRepo.findCategoryBySlug(filters.subcategory);
    if (sub) exactCategoryIds = [sub.id];
  }
  let lifestyleIds: string[] | undefined;
  if (filters.lifestyle) {
    const lifestyle = await lifestyleRepo.findLifestyleBySlug(filters.lifestyle);
    if (lifestyle && lifestyle.active) lifestyleIds = [lifestyle.id];
  }
  return productFilterRepo.getProductFacets({
    brandIds,
    categoryIds,
    exactCategoryIds,
    sizes: filters.size,
    colors: filters.color,
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice,
    gender: filters.gender,
    sale: filters.sale,
    collection: filters.collection,
    lifestyleIds,
    availability: filters.availability,
    search: filters.search,
    sort: filters.sort,
    page: filters.page,
    pageSize: filters.pageSize,
  });
}

export async function getProductBySlug(slug: string) {
  const product = await catalogRepo.findProductBySlug(slug);
  if (!product) throw new NotFoundError("Product not found.");
  const [variants, brands, categories, imageMap, audienceList, lifestyleList] = await Promise.all([
    catalogRepo.listVariantsForProducts([product.id]),
    catalogRepo.listBrands(),
    catalogRepo.listCategories(),
    catalogRepo.listImagesForProducts([product.id]),
    catalogRepo.listAudiencesForProducts([product.id]),
    lifestyleRepo.listLifestylesForProducts([product.id]),
  ]);
  const brand = brands.find((b) => b.id === product.brandId) ?? null;
  const category = categories.find((c) => c.id === product.categoryId) ?? null;
  return serializeProductWithVariants(
    {
      ...product,
      images: imageMap.get(product.id) ?? [],
      genderAudiences: audienceList.get(product.id) ?? [],
      lifestyles: lifestyleList.get(product.id) ?? [],
    },
    brand,
    category,
    variants,
    { publicView: true }
  );
}

/** Same full public assembly as getProductBySlug(), starting from an id instead — used by wishlist.service.ts, which only has product ids to work with. Returns null (not a throw) for a missing/deleted product, since a wishlist item pointing at a since-deleted product is a normal, non-exceptional case the caller (serializeWishlist) needs to handle gracefully. */
/**
 * Batched — a single round of queries for a SET of product ids, not one
 * round per id. This used to have a per-item sibling
 * (getPublicProductByIdOrNull) that wishlist.service.ts called once per
 * wishlist item; that function alone did 6 queries internally (including
 * two full brand/category table scans), so a 20-item wishlist meant
 * ~120 queries for one page load — a real N+1 a performance audit found.
 * The per-item function was removed rather than kept alongside this one,
 * to avoid maintaining two parallel implementations of the same
 * assembly logic. Missing products are silently omitted from the
 * returned map — the caller decides what "missing" means for its own
 * use case (wishlist.service.ts drops the wishlist row too).
 */
export async function getPublicProductsByIds(productIds: string[]) {
  if (productIds.length === 0) return new Map<string, ReturnType<typeof serializeProductWithVariants>>();
  const uniqueIds = [...new Set(productIds)];
  const [products, variants, brands, categories, imageMap, audienceList, lifestyleList] = await Promise.all([
    catalogRepo.findProductsByIds(uniqueIds),
    catalogRepo.listVariantsForProducts(uniqueIds),
    catalogRepo.listBrands(),
    catalogRepo.listCategories(),
    catalogRepo.listImagesForProducts(uniqueIds),
    catalogRepo.listAudiencesForProducts(uniqueIds),
    lifestyleRepo.listLifestylesForProducts(uniqueIds),
  ]);
  const brandById = new Map(brands.map((b) => [b.id, b]));
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const variantsByProduct = new Map<string, typeof variants>();
  for (const v of variants) {
    const list = variantsByProduct.get(v.productId) ?? [];
    list.push(v);
    variantsByProduct.set(v.productId, list);
  }
  const result = new Map<string, ReturnType<typeof serializeProductWithVariants>>();
  for (const product of products) {
    result.set(
      product.id,
      serializeProductWithVariants(
        {
          ...product,
          images: imageMap.get(product.id) ?? [],
          genderAudiences: audienceList.get(product.id) ?? [],
          lifestyles: lifestyleList.get(product.id) ?? [],
        },
        brandById.get(product.brandId) ?? null,
        categoryById.get(product.categoryId) ?? null,
        variantsByProduct.get(product.id) ?? [],
        { publicView: true }
      )
    );
  }
  return result;
}

export async function getProductOrThrow(productId: string): Promise<Product> {
  const product = await catalogRepo.findProductById(productId);
  if (!product || !product.active) throw new NotFoundError("Product not found.");
  return product;
}

export async function getVariantOrThrow(variantId: string): Promise<ProductVariant> {
  const variant = await catalogRepo.findVariantById(variantId);
  if (!variant) throw new NotFoundError("Product variant not found.");
  return variant;
}

export async function listCategories() {
  return catalogRepo.listCategories({ activeOnly: true });
}

/** Admin-only — every category regardless of active status, so an admin can find and re-enable a hidden one. */
export async function listAdminCategories() {
  return catalogRepo.listCategories({ activeOnly: false });
}

export async function updateCategory(actor: { id: string; role: Role }, id: string, patch: catalogRepo.CategoryPatch) {
  if (patch.name !== undefined && !patch.name.trim()) {
    throw new ValidationError("Validation failed.", { name: "Category name cannot be blank." });
  }
  if (patch.displayOrder !== undefined && patch.displayOrder < 0) {
    throw new ValidationError("Validation failed.", { displayOrder: "Display order cannot be negative." });
  }
  const category = await catalogRepo.updateCategoryFields(id, patch);
  if (!category) throw new NotFoundError("Category not found.");
  await recordAuditEvent({ actorId: actor.id, actorRole: actor.role, action: "category.updated", targetType: "category", targetId: id, metadata: patch as Record<string, unknown> });
  return category;
}

/**
 * Upload/replace the category's storefront card image — routed entirely
 * through the same validated media pipeline (magic-byte content
 * inspection, dimension/size limits, EXIF stripping) every other image in
 * this app goes through; no second upload system was built for this.
 */
export async function uploadCategoryImage(actor: { id: string; role: Role }, categoryId: string, provider: import("../storage/provider").StorageProvider, data: Buffer, originalFilename: string | null) {
  const oldKey = await catalogRepo.getCategoryImageStorageKey(categoryId);
  const uploaded = await mediaService.uploadMedia({
    provider,
    data,
    originalFilename,
    altText: null,
    entityType: "category_image",
    entityId: categoryId,
  });
  const updated = await catalogRepo.setCategoryImage(categoryId, uploaded.media.url, uploaded.media.storageKey);
  if (!updated) throw new NotFoundError("Category not found.");
  if (oldKey) {
    await provider.delete(oldKey).catch(() => {
      // Best-effort — the new image is already live either way; a leftover
      // orphaned file is exactly what the media orphan-detection system
      // (GET /admin/media/orphans) exists to catch later.
    });
  }
  await recordAuditEvent({ actorId: actor.id, actorRole: actor.role, action: "category.image_uploaded", targetType: "category", targetId: categoryId });
  return updated;
}

export async function removeCategoryImage(actor: { id: string; role: Role }, categoryId: string, provider: import("../storage/provider").StorageProvider) {
  const oldKey = await catalogRepo.getCategoryImageStorageKey(categoryId);
  const updated = await catalogRepo.setCategoryImage(categoryId, null, null);
  if (!updated) throw new NotFoundError("Category not found.");
  if (oldKey) await provider.delete(oldKey).catch(() => {});
  await recordAuditEvent({ actorId: actor.id, actorRole: actor.role, action: "category.image_removed", targetType: "category", targetId: categoryId });
  return updated;
}

/**
 * "Shop by Category" for a specific audience. Returns the DISTINCT categories
 * that carry active products in that audience, each with a real product count
 * (top-level counts include descendants), filtered to non-zero so the
 * showcase never shows empty tiles. Backed by a real category↔gender query,
 * never a hardcoded list.
 */
export async function listGenderCategories(genderCode: string) {
  const rows = await catalogRepo.listCategoriesByGender(genderCode);
  return rows
    .filter((r) => Number(r.count) > 0)
    .map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      parentId: r.parent_id,
      imageUrl: r.image_url,
      icon: r.icon,
      count: Number(r.count),
    }));
}

/**
 * The header's "Shop by Category" mega-menu payload: the gender categories
 * (real DISTINCT category↔gender counts) each WITH the attribute groups that
 * apply to it, so a WOMEN dropdown can list Dresses/Jeans and show Fit/Rise
 * etc. for each — one request, never a fetch per category.
 */
export async function listGenderCategoriesWithAttributes(genderCode: string) {
  const categories = await listGenderCategories(genderCode);
  const groupsByCategory = await attributeRepo.listAttributeGroupsForCategories(categories.map((c) => c.id));
  return categories.map((c) => ({
    ...c,
    attributes: groupsByCategory.get(c.id) ?? [],
  }));
}

export async function listBrands() {
  return catalogRepo.listBrands();
}

/**
 * Public brand detail — resolves an active brand by slug and returns it
 * together with its active products (brand/logo + category + variants
 * enriched), for the customer-facing brand page.
 */
export async function getBrandBySlug(slug: string) {
  const brand = await catalogRepo.findBrandBySlug(slug);
  if (!brand || !brand.active) throw new NotFoundError("Brand not found.");
  if (brand.slug !== slug) throw new NotFoundError("Brand not found.");

  const { items, total } = await catalogRepo.listProducts({
    brandId: brand.id,
    categoryId: undefined,
    search: undefined,
    page: 1,
    pageSize: 50,
  });

  const [variants, imagesByProduct] = await Promise.all([
    catalogRepo.listVariantsForProducts(items.map((p) => p.id)),
    catalogRepo.listImagesForProducts(items.map((p) => p.id)),
  ]);
  const variantsByProduct = new Map<string, ProductVariant[]>();
  for (const v of variants) {
    const list = variantsByProduct.get(v.productId) ?? [];
    list.push(v);
    variantsByProduct.set(v.productId, list);
  }
  const categories = await catalogRepo.listCategories();
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  return {
    brand,
    products: items.map((p) =>
      serializeProductWithVariants(
        { ...p, images: imagesByProduct.get(p.id) ?? [] },
        brand,
        categoryById.get(p.categoryId) ?? null,
        variantsByProduct.get(p.id) ?? [],
        { publicView: true }
      )
    ),
    pagination: { page: 1, pageSize: 50, total },
  };
}

// ---- Admin mutations (called from admin/* routes, already RBAC-gated) ----

export type ProductOfferInput = {
  sku?: string | null;
  shortDescription?: string | null;
  fullDescription?: string | null;
  badgeText?: string | null;
  offerLabel?: string | null;
  compareAtPriceCents?: number | null;
  offerStartDate?: string | null;
  offerEndDate?: string | null;
};

export const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Price + offer invariants shared by create and update (the DB re-checks via 0009 + 0018 constraints). */
export function validateOfferInput(input: ProductOfferInput, priceCents: number): void {
  if (input.compareAtPriceCents != null && input.compareAtPriceCents < priceCents) {
    throw new ValidationError("Compare-at price must be greater than the selling price.", { compareAtPriceCents: "Must be greater than the selling price." });
  }
  for (const key of ["offerStartDate", "offerEndDate"] as const) {
    const v = input[key];
    if (v != null && !DATE_ONLY_RE.test(v)) {
      throw new ValidationError("Offer dates must be in YYYY-MM-DD format.", { [key]: "Use YYYY-MM-DD." });
    }
  }
  if (input.offerStartDate && input.offerEndDate && input.offerStartDate > input.offerEndDate) {
    throw new ValidationError("Offer start date cannot be after the end date.", { offerStartDate: "Must be on or before the end date." });
  }
  if (input.sku != null && input.sku.trim() === "") {
    throw new ValidationError("SKU cannot be blank.", { sku: "Enter an SKU or leave it empty." });
  }
}

/**
 * Product-posting limit enforcement — the actual check, called from
 * createProduct before anything is inserted. Never trusts the frontend:
 * a direct API call is rejected here exactly the same way the UI would
 * have prevented it, since this runs server-side regardless of how the
 * request arrived. Usage is always counted live (see
 * admin-product-limits.repo.ts's own comment for why), never a stored
 * counter that could drift from reality.
 */
async function assertUnderProductLimit(adminUserId: string): Promise<void> {
  const limit = await adminProductLimitsRepo.getLimit(adminUserId);
  // No row, or an explicit NONE row, both mean "no limit" — nothing to check.
  if (!limit || limit.limitType === "NONE") return;

  const now = new Date();
  let current: number;
  switch (limit.limitType) {
    case "FIXED_TOTAL":
      current = await adminProductLimitsRepo.countProductsForAdmin(adminUserId, {});
      break;
    case "FIXED_ACTIVE":
      current = await adminProductLimitsRepo.countProductsForAdmin(adminUserId, { activeOnly: true });
      break;
    case "PER_DAY": {
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      current = await adminProductLimitsRepo.countProductsForAdmin(adminUserId, { since: startOfDay });
      break;
    }
    case "PER_MONTH": {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      current = await adminProductLimitsRepo.countProductsForAdmin(adminUserId, { since: startOfMonth });
      break;
    }
  }
  if (current >= (limit.maxValue ?? 0)) {
    throw new ValidationError(
      "You have reached your product posting limit. Please contact the Super Admin.",
      { productLimit: "Limit reached." }
    );
  }
}

export async function createProduct(
  actor: { id: string; role: Role },
  input: { slug: string; name: string; brandId: string; categoryId: string; priceCents: number; genderAudiences?: string[]; lifestyleIds?: string[]; tags?: string[] } & ProductOfferInput
) {
  // Product-posting limits — enforced here, server-side, never just a
  // disabled button on the frontend (a direct API call must be rejected
  // the same way). Super Admin is deliberately exempt: per this
  // feature's own explicit requirement, Super Admin should not be
  // unnecessarily restricted by limits meant to bound individual admins.
  if (actor.role !== "SUPER_ADMIN") {
    await assertUnderProductLimit(actor.id);
  }

  const audiences = input.genderAudiences ?? [];
  // A product must belong to at least one audience (women / men / unisex).
  if (audiences.length === 0) {
    throw new ValidationError("At least one gender/audience is required.", { genderAudiences: "Select at least one audience." });
  }
  validateOfferInput(input, input.priceCents);
  // insertProduct now persists the full offer/description set and assigns
  // audiences atomically (rollback on any failure — no orphaned rows).
  const product = await catalogRepo.insertProduct(input, audiences, actor.id);

  // Lifestyle membership is optional (a product may belong to none), but when
  // submitted the set is persisted atomically afterwards — same shape as
  // updateProduct, so create/edit behave identically.
  if (input.lifestyleIds !== undefined) {
    await lifestyleRepo.replaceProductLifestyles(product.id, input.lifestyleIds);
  }

  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "product.created",
    targetType: "product",
    targetId: product.id,
    metadata: {
      slug: product.slug,
      priceCents: product.priceCents,
      genderAudiences: audiences,
      lifestyleIds: input.lifestyleIds ?? [],
      sku: product.sku ?? null,
      compareAtPriceCents: product.compareAtPriceCents ?? null,
      offerStartDate: product.offerStartDate ?? null,
      offerEndDate: product.offerEndDate ?? null,
    },
  });
  return product;
}

export async function updateProduct(
  actor: { id: string; role: Role },
  productId: string,
  patch: Partial<{ name: string; priceCents: number; active: boolean; genderAudiences?: string[]; lifestyleIds?: string[]; tags?: string[] } & ProductOfferInput>
) {
  const before = await catalogRepo.findProductById(productId);
  if (!before) throw new NotFoundError("Product not found.");

  // A product must keep at least one audience — rejecting an explicit empty
  // list prevents an admin from stripping every audience off an existing item.
  if (patch.genderAudiences !== undefined && patch.genderAudiences.length === 0) {
    throw new ValidationError("At least one gender/audience is required.", { genderAudiences: "Select at least one audience." });
  }

  // Price/offer invariants must hold against the effective price of the row.
  const effectivePrice = patch.priceCents ?? before.priceCents;
  validateOfferInput(patch, effectivePrice);

  // The DB CHECK `products_offer_date_range_valid` must also hold against the
  // *merged* row: if only one bound is patched, the other (existing) bound
  // decides the window. Validate the effective window here so a bad merge is
  // a friendly 400 instead of an unexpected CHECK violation (500).
  const effectiveOfferStart = patch.offerStartDate !== undefined ? patch.offerStartDate : before.offerStartDate;
  const effectiveOfferEnd = patch.offerEndDate !== undefined ? patch.offerEndDate : before.offerEndDate;
  if (effectiveOfferStart && effectiveOfferEnd && effectiveOfferStart > effectiveOfferEnd) {
    throw new ValidationError("Offer start date cannot be after the end date.", { offerStartDate: "Must be on or before the end date." });
  }

  const updated = await catalogRepo.updateProductFields(productId, patch);
  if (!updated) throw new NotFoundError("Product not found.");

  if (patch.genderAudiences !== undefined) {
    await catalogRepo.replaceProductAudiences(productId, patch.genderAudiences);
  }

  // Lifestyle membership is optional; an explicit list replaces the whole set
  // ([] clears it). An omitted field leaves assignments untouched.
  if (patch.lifestyleIds !== undefined) {
    await lifestyleRepo.replaceProductLifestyles(productId, patch.lifestyleIds);
  }

  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "product.updated",
    targetType: "product",
    targetId: productId,
    metadata: {
      before: {
        name: before.name,
        priceCents: before.priceCents,
        active: before.active,
        compareAtPriceCents: before.compareAtPriceCents ?? null,
        sku: before.sku ?? null,
        badgeText: before.badgeText ?? null,
        offerLabel: before.offerLabel ?? null,
        offerStartDate: before.offerStartDate ?? null,
        offerEndDate: before.offerEndDate ?? null,
      },
      after: {
        ...patch,
        genderAudiences: patch.genderAudiences ?? undefined,
        lifestyleIds: patch.lifestyleIds ?? undefined,
      },
    },
  });
  return updated;
}

export async function replaceProductVariants(
  actor: { id: string; role: Role },
  productId: string,
  input: Array<{ id?: string | null; size: string; color: string; stockQty: number; sku?: string | null }>
) {
  const product = await catalogRepo.findProductById(productId);
  if (!product) throw new NotFoundError("Product not found.");

  // Captured BEFORE the replace so we can tell whether this update is
  // genuinely a "the whole product was sold out, now it isn't" event —
  // see notifyWishlistersProductBackInStock's own comment for why that's
  // the right trigger, not "any single variant changed."
  const previousVariants = await catalogRepo.listVariantsForProducts([productId]);
  const wasFullyOutOfStock = previousVariants.length > 0 && previousVariants.every((v) => v.stockQty === 0);

  if (!Array.isArray(input) || input.length > 100) {
    throw new ValidationError("Too many variants.", { variants: "A product can have at most 100 variants." });
  }

  const combos = new Set<string>();
  const seenIds = new Set<string>();
  const seenSkus = new Set<string>();
  for (const v of input) {
    const size = typeof v.size === "string" ? v.size.trim() : "";
    const color = typeof v.color === "string" ? v.color.trim() : "";
    if (!size || !color) {
      throw new ValidationError("Invalid variant.", { variants: "Size and color are required for every variant." });
    }
    if (!Number.isInteger(v.stockQty) || v.stockQty < 0 || v.stockQty > 100000) {
      throw new ValidationError("Invalid stock quantity.", { variants: "Stock must be a non-negative whole number (0–100000)." });
    }
    if (v.sku != null && typeof v.sku === "string" && v.sku.trim() === "") {
      throw new ValidationError("Blank variant SKU.", { variants: "Variant SKUs cannot be blank." });
    }
    if (v.sku && typeof v.sku === "string") {
      const skuKey = v.sku.trim().toLowerCase();
      if (seenSkus.has(skuKey)) {
        throw new ValidationError("Duplicate variant SKU.", { variants: `Variant SKU "${v.sku.trim()}" appears more than once.` });
      }
      seenSkus.add(skuKey);
    }
    const key = `${color.toLowerCase()}\u0000${size.toLowerCase()}`;
    if (combos.has(key)) {
      throw new ValidationError("Duplicate variant.", { variants: `Color "${color}" / size "${size}" appears more than once.` });
    }
    combos.add(key);
    if (v.id) {
      if (seenIds.has(v.id)) throw new ValidationError("Duplicate variant.", { variants: "A variant id can only appear once." });
      seenIds.add(v.id);
    }
  }

  // An insert must never collide with the (immutable) combo of a kept row —
  // reject as a duplicate rather than leaking a raw UNIQUE violation.
  const existing = await catalogRepo.listVariantsForProducts([productId]);
  const keptIds = new Set(input.filter((v) => v.id).map((v) => v.id as string));
  const keptCombos = new Set(
    existing.filter((v) => keptIds.has(v.id)).map((v) => `${v.color.toLowerCase()}\u0000${v.size.toLowerCase()}`)
  );
  for (const v of input) {
    if (!v.id) {
      const key = `${v.color.trim().toLowerCase()}\u0000${v.size.trim().toLowerCase()}`;
      if (keptCombos.has(key)) {
        throw new ValidationError("Duplicate variant.", { variants: `Color "${v.color}" / size "${v.size}" already exists.` });
      }
    }
  }

  const variants = await catalogRepo.replaceProductVariants(
    productId,
    input.map((v) => ({ id: v.id ?? null, size: v.size.trim(), color: v.color.trim(), stockQty: v.stockQty, sku: v.sku ?? null }))
  );

  // Fired AFTER the write commits, best-effort — a notification hiccup
  // must never affect the actual variant update this admin action is for.
  if (wasFullyOutOfStock && variants.some((v) => v.stockQty > 0)) {
    (async () => {
      try {
        const userIds = await wishlistRepo.listUserIdsWithProductWishlisted(productId);
        if (userIds.length > 0) {
          await notifyWishlistersProductBackInStock(userIds, productId, product.name, product.slug);
        }
      } catch {
        /* best-effort */
      }
    })();
  }

  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "product.variants.updated",
    targetType: "product",
    targetId: productId,
    metadata: {
      variantCount: input.length,
      variants: input.map((v) => ({ id: v.id ?? null, size: v.size.trim(), color: v.color.trim(), stockQty: v.stockQty, sku: v.sku ?? null })),
    },
  });

  return variants;
}

export async function deleteProduct(actor: { id: string; role: Role }, productId: string) {
  const product = await catalogRepo.findProductById(productId);
  if (!product) throw new NotFoundError("Product not found.");

  await catalogRepo.softDeleteProduct(productId);

  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "product.deleted",
    targetType: "product",
    targetId: productId,
  });
}

const slugify = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export async function createBrand(
  actor: { id: string; role: Role },
  input: { name: string; slug?: string }
) {
  const slug = (input.slug && input.slug.trim() ? slugify(input.slug) : slugify(input.name)) || "brand";
  const brand = await catalogRepo.insertBrand({ slug, name: input.name.trim() });

  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "brand.created",
    targetType: "brand",
    targetId: brand.id,
    metadata: { slug: brand.slug, name: brand.name },
  });
  return brand;
}

export async function createCategory(
  actor: { id: string; role: Role },
  input: { name: string; slug?: string; icon?: string }
) {
  const slug = (input.slug && input.slug.trim() ? slugify(input.slug) : slugify(input.name)) || "category";
  const const_icon = input.icon && input.icon.trim() ? input.icon.trim() : "box";
  const category = await catalogRepo.insertCategory({ slug, name: input.name.trim(), icon: const_icon });
  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "category.created",
    targetType: "category",
    targetId: category.id,
    metadata: { slug: category.slug, name: category.name, icon: const_icon },
  });
  return category;
}

// ---- Brand management (edit + logo upload/replace/remove) ----

export async function updateBrand(
  actor: { id: string; role: Role },
  brandId: string,
  patch: Partial<{ name: string; slug: string; active: boolean }>
): Promise<Brand> {
  const before = await catalogRepo.findBrandById(brandId);
  if (!before) throw new NotFoundError("Brand not found.");

  const normalized: typeof patch = { ...patch };
  if (normalized.name !== undefined) normalized.name = normalized.name.trim() || before.name;
  if (normalized.slug !== undefined) {
    normalized.slug = slugify(normalized.slug) || before.slug;
  }

  const updated = await catalogRepo.updateBrandFields(brandId, normalized);
  if (!updated) throw new NotFoundError("Brand not found.");

  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "brand.updated",
    targetType: "brand",
    targetId: brandId,
    metadata: {
      before: { name: before.name, slug: before.slug, active: before.active },
      after: { name: updated.name, slug: updated.slug, active: updated.active },
    },
  });
  return updated;
}

export type UploadedImageInput = { data: Buffer; contentType: string; filename?: string | null };

/**
 * Validates and stores a brand-logo image. Shared by the create and replace
 * paths — the storage clobbers any existing object/row for the brand
 * (upsert semantics), so callers don't need a separate "create vs update".
 *
 * Routes through MediaService for the actual validate/store/checksum work
 * — see media.service.ts for the compensation logic if the DB write below
 * fails after the file is already uploaded.
 */
async function storeLogo(actor: { id: string; role: Role }, brandId: string, file: UploadedImageInput) {
  const brand = await catalogRepo.findBrandById(brandId);
  if (!brand) throw new NotFoundError("Brand not found.");

  const { media } = await mediaService.uploadMedia({
    provider: brandLogoStorage,
    data: file.data,
    originalFilename: file.filename ?? null,
    entityType: "brand_logo",
    entityId: brandId,
  });

  try {
    await catalogRepo.upsertLogo({
      brandId,
      storageKey: media.storageKey,
      url: media.url,
      contentType: media.contentType,
      sizeBytes: media.sizeBytes,
      width: media.width!,
      height: media.height!,
    });
  } catch (err) {
    // The media registry row (and its storage object) are now unreferenced
    // by the domain table — clean them up rather than leave an orphan for
    // every brand_logos write failure.
    await mediaService.removeMedia(brandLogoStorage, media.id).catch(() => undefined);
    throw err;
  }

  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "brand.logo.uploaded",
    targetType: "brand",
    targetId: brandId,
    metadata: { url: media.url, width: media.width, height: media.height, sizeBytes: media.sizeBytes },
  });

  return catalogRepo.findLogoByBrandId(brandId);
}

export async function uploadBrandLogo(
  actor: { id: string; role: Role },
  brandId: string,
  file: UploadedImageInput
) {
  // storeLogo() itself checks the brand exists and throws NotFoundError —
  // no separate check needed here.
  return storeLogo(actor, brandId, file);
}

export async function replaceBrandLogo(
  actor: { id: string; role: Role },
  brandId: string,
  file: UploadedImageInput
) {
  const existing = await catalogRepo.findLogoByBrandId(brandId);
  if (!existing) throw new NotFoundError("Brand does not have a logo yet.");

  const logo = await storeLogo(actor, brandId, file);

  // Old object superseded by the new one — clean up its storage object AND
  // its media registry row (otherwise the old row lingers forever: it
  // still points at a valid brand, so orphan-by-missing-entity scanning
  // would never flag it even though it's no longer this brand's logo).
  if (existing.storageKey) {
    await brandLogoStorage.delete(existing.storageKey).catch((err) => {
      logger.error("brand.logo.old_object_delete_failed", {
        brandId,
        storageKey: existing.storageKey,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    const oldMedia = await mediaRepo.findMediaByStorageKey(brandLogoStorage.name, existing.storageKey).catch(() => null);
    if (oldMedia) {
      await mediaRepo.deleteMedia(oldMedia.id).catch(() => undefined);
    }
  }

  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "brand.logo.replaced",
    targetType: "brand",
    targetId: brandId,
    metadata: { oldKey: existing.storageKey, newKey: logo?.storageKey },
  });
  return logo;
}

export async function removeBrandLogo(actor: { id: string; role: Role }, brandId: string) {
  const existing = await catalogRepo.findLogoByBrandId(brandId);
  if (!existing) throw new NotFoundError("Brand does not have a logo.");

  await catalogRepo.deleteLogoByBrandId(brandId);
  await brandLogoStorage.delete(existing.storageKey).catch((err) => {
    logger.error("brand.logo.delete_failed", {
      brandId,
      storageKey: existing.storageKey,
      error: err instanceof Error ? err.message : String(err),
    });
  });
  const oldMedia = await mediaRepo.findMediaByStorageKey(brandLogoStorage.name, existing.storageKey).catch(() => null);
  if (oldMedia) {
    await mediaRepo.deleteMedia(oldMedia.id).catch(() => undefined);
  }

  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "brand.logo.removed",
    targetType: "brand",
    targetId: brandId,
    metadata: { key: existing.storageKey },
  });
}

// ---- Brand campaign images (large lifestyle photo — see migration 0045) ----

async function storeCampaignImage(actor: { id: string; role: Role }, brandId: string, file: UploadedImageInput) {
  const brand = await catalogRepo.findBrandById(brandId);
  if (!brand) throw new NotFoundError("Brand not found.");

  const { media } = await mediaService.uploadMedia({
    provider: brandCampaignImageStorage,
    data: file.data,
    originalFilename: file.filename ?? null,
    entityType: "brand_campaign_image",
    entityId: brandId,
  });

  try {
    await catalogRepo.upsertCampaignImage({
      brandId,
      storageKey: media.storageKey,
      url: media.url,
      contentType: media.contentType,
      sizeBytes: media.sizeBytes,
      width: media.width!,
      height: media.height!,
    });
  } catch (err) {
    await mediaService.removeMedia(brandCampaignImageStorage, media.id).catch(() => undefined);
    throw err;
  }

  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "brand.campaign_image.uploaded",
    targetType: "brand",
    targetId: brandId,
    metadata: { url: media.url, width: media.width, height: media.height, sizeBytes: media.sizeBytes },
  });

  return catalogRepo.findCampaignImageByBrandId(brandId);
}

export async function uploadBrandCampaignImage(
  actor: { id: string; role: Role },
  brandId: string,
  file: UploadedImageInput
) {
  return storeCampaignImage(actor, brandId, file);
}

export async function replaceBrandCampaignImage(
  actor: { id: string; role: Role },
  brandId: string,
  file: UploadedImageInput
) {
  const existing = await catalogRepo.findCampaignImageByBrandId(brandId);
  if (!existing) throw new NotFoundError("Brand does not have a campaign image yet.");

  const image = await storeCampaignImage(actor, brandId, file);

  if (existing.storageKey) {
    await brandCampaignImageStorage.delete(existing.storageKey).catch((err) => {
      logger.error("brand.campaign_image.old_object_delete_failed", {
        brandId,
        storageKey: existing.storageKey,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    const oldMedia = await mediaRepo.findMediaByStorageKey(brandCampaignImageStorage.name, existing.storageKey).catch(() => null);
    if (oldMedia) {
      await mediaRepo.deleteMedia(oldMedia.id).catch(() => undefined);
    }
  }

  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "brand.campaign_image.replaced",
    targetType: "brand",
    targetId: brandId,
    metadata: { oldKey: existing.storageKey, newKey: image?.storageKey },
  });
  return image;
}

export async function removeBrandCampaignImage(actor: { id: string; role: Role }, brandId: string) {
  const existing = await catalogRepo.findCampaignImageByBrandId(brandId);
  if (!existing) throw new NotFoundError("Brand does not have a campaign image.");

  await catalogRepo.deleteCampaignImageByBrandId(brandId);
  await brandCampaignImageStorage.delete(existing.storageKey).catch((err) => {
    logger.error("brand.campaign_image.delete_failed", {
      brandId,
      storageKey: existing.storageKey,
      error: err instanceof Error ? err.message : String(err),
    });
  });
  const oldMedia = await mediaRepo.findMediaByStorageKey(brandCampaignImageStorage.name, existing.storageKey).catch(() => null);
  if (oldMedia) {
    await mediaRepo.deleteMedia(oldMedia.id).catch(() => undefined);
  }

  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "brand.campaign_image.removed",
    targetType: "brand",
    targetId: brandId,
    metadata: { key: existing.storageKey },
  });
}

export async function reorderBrands(actor: { id: string; role: Role }, orderedIds: unknown) {
  const ids = Array.isArray(orderedIds) ? orderedIds.filter((v): v is string => typeof v === "string") : [];
  if (ids.length === 0) throw new ValidationError("Validation failed.", { orderedIds: "Provide the full list of brand ids in the desired order." });
  await catalogRepo.reorderBrands(ids);
  await recordAuditEvent({ actorId: actor.id, actorRole: actor.role, action: "brand.reordered", targetType: "brand", targetId: ids[0]!, metadata: { orderedIds: ids } });
}

// ---- Product images (admin upload / replace / reorder / delete) ----

export async function uploadProductImage(
  actor: { id: string; role: Role },
  productId: string,
  file: { data: Buffer; contentType: string; filename?: string | null }
) {
  const product = await catalogRepo.findProductById(productId);
  if (!product) throw new NotFoundError("Product not found.");

  const { media } = await mediaService.uploadMedia({
    provider: productImageStorage,
    data: file.data,
    originalFilename: file.filename ?? null,
    entityType: "product_image",
    entityId: productId,
  });

  let image;
  try {
    image = await catalogRepo.appendProductImage({
      id: randomUUID(),
      productId,
      url: media.url,
      storageKey: media.storageKey,
      contentType: media.contentType,
      sizeBytes: media.sizeBytes,
      width: media.width!,
      height: media.height!,
    });
  } catch (err) {
    await mediaService.removeMedia(productImageStorage, media.id).catch(() => undefined);
    throw err;
  }

  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "product.image.uploaded",
    targetType: "product",
    targetId: productId,
    metadata: { imageId: image.id, url: media.url, width: media.width, height: media.height, sizeBytes: media.sizeBytes },
  });
  return image;
}

export async function replaceProductImage(
  actor: { id: string; role: Role },
  imageId: string,
  file: { data: Buffer; contentType: string; filename?: string | null }
) {
  const existing = await catalogRepo.findProductImageById(imageId);
  if (!existing) throw new NotFoundError("Product image not found.");

  const { media } = await mediaService.uploadMedia({
    provider: productImageStorage,
    data: file.data,
    originalFilename: file.filename ?? null,
    entityType: "product_image",
    entityId: existing.productId,
  });

  let updated;
  try {
    updated = await catalogRepo.updateProductImageFile(imageId, {
      storageKey: media.storageKey,
      url: media.url,
      contentType: media.contentType,
      sizeBytes: media.sizeBytes,
      width: media.width!,
      height: media.height!,
    });
    if (!updated) throw new NotFoundError("Product image not found.");
  } catch (err) {
    await mediaService.removeMedia(productImageStorage, media.id).catch(() => undefined);
    throw err;
  }

  // Old object superseded by the new one — clean up its storage object AND
  // its media registry row (see the identical reasoning in replaceBrandLogo).
  if (existing.storageKey && existing.storageKey !== media.storageKey) {
    await productImageStorage.delete(existing.storageKey).catch((err) => {
      logger.error("product.image.old_object_delete_failed", {
        imageId,
        storageKey: existing.storageKey,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    const oldMedia = await mediaRepo.findMediaByStorageKey(productImageStorage.name, existing.storageKey).catch(() => null);
    if (oldMedia) {
      await mediaRepo.deleteMedia(oldMedia.id).catch(() => undefined);
    }
  }

  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "product.image.replaced",
    targetType: "product",
    targetId: existing.productId,
    metadata: { imageId, oldKey: existing.storageKey, newKey: media.storageKey },
  });
  return updated;
}

export async function deleteProductImage(actor: { id: string; role: Role }, imageId: string) {
  const existing = await catalogRepo.findProductImageById(imageId);
  if (!existing) throw new NotFoundError("Product image not found.");

  const { deleted } = await catalogRepo.deleteProductImageRow(imageId);
  if (!deleted) throw new NotFoundError("Product image not found.");

  if (existing.storageKey) {
    await productImageStorage.delete(existing.storageKey).catch((err) => {
      logger.error("product.image.delete_failed", {
        imageId,
        storageKey: existing.storageKey,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    const oldMedia = await mediaRepo.findMediaByStorageKey(productImageStorage.name, existing.storageKey).catch(() => null);
    if (oldMedia) {
      await mediaRepo.deleteMedia(oldMedia.id).catch(() => undefined);
    }
  }

  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "product.image.deleted",
    targetType: "product",
    targetId: existing.productId,
    metadata: { imageId, key: existing.storageKey },
  });
}

export async function reorderProductImages(
  actor: { id: string; role: Role },
  productId: string,
  orderedImageIds: string[]
) {
  const product = await catalogRepo.findProductById(productId);
  if (!product) throw new NotFoundError("Product not found.");
  const images = await catalogRepo.reorderProductImages(productId, orderedImageIds);

  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "product.images.reordered",
    targetType: "product",
    targetId: productId,
    metadata: { orderedImageIds },
  });
  return images;
}
