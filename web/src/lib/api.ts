/**
 * PLUG API client.
 *
 * Thin typed wrapper around the Next.js backend (../api).
 * The backend authenticates via httpOnly cookies (access + refresh tokens),
 * so every request is sent with `credentials: 'include'`. `baseUrl` comes
 * from VITE_API_BASE_URL (see .env).
 */

const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:3001";

/**
 * The backend returns asset URLs (e.g. brand logo `url`, product `images`)
 * as relative paths like `/uploads/brands/<uuid>`. Those files are served
 * from the API origin, not the frontend origin — so an `<img src>` using the
 * raw relative path would resolve against the frontend host and 404 (the logo
 * never appears). This helper makes such paths absolute against the API base.
 */
export function assetUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path; // already absolute
  // Data / blob URIs are self-contained — a relative prefix would turn the
  // placeholder into a broken URL like http://host/data:image/svg+xml;utf8,...
  if (/^[a-z][a-z\d+.-]*:/i.test(path)) return path;
  if (path.startsWith("/")) return `${baseUrl}${path}`;
  return `${baseUrl}/${path}`;
}

export class ApiError extends Error {
  status: number;
  category?: string;
  requestId?: string;
  /** Field-specific validation messages from the backend (e.g. { couponCode: "This coupon has expired." }) — was previously discarded entirely, leaving only the generic top-level message ("Validation failed.") for every field-validated error across the app. */
  fields?: Record<string, string>;
  constructor(status: number, message: string, category?: string, requestId?: string, fields?: Record<string, string>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.category = category;
    this.requestId = requestId;
    this.fields = fields;
  }
}

// Single-flight refresh so concurrent 401s (e.g. dashboard firing several
// requests at once) trigger only one rotation instead of a thundering herd.
let refreshPromise: Promise<boolean> | null = null;

/**
 * Reads the readable `vv_session` marker the backend sets alongside the
 * httpOnly auth cookies (see api/src/lib/security/tokens.ts). Its absence
 * proves this browser holds no session cookies at all, so session probes
 * (/auth/me on every page load) and refresh attempts are pointless — the
 * fast-path in AuthContext and the gate below skip them. Presence never
 * means "authenticated": when the marker is set, the server is still
 * consulted on every load (server remains the sole authority).
 */
export function hasSessionMarker(): boolean {
  return typeof document !== "undefined" && /(?:^|;\s*)vv_session=([^;]+)/.test(document.cookie);
}

// A failed refresh (401/403/network) means the refresh cookie is gone or
// no longer valid — re-posted retries can only fail again, so once that
// has happened once, skip further attempts for the rest of this page's
// life. Without this latch, every subsequent 401 (e.g. each /auth/me poll
// on every page load while signed out) re-hits /auth/refresh and spams the
// console with the same doomed error. Reset on login/register so a same-page
// re-auth after an earlier sign-out can still refresh.
let refreshPossible = hasSessionMarker();

function performRefresh(): Promise<boolean> {
  return fetch(`${baseUrl}/api/v1/auth/refresh`, { method: "POST", credentials: "include" })
    .then((r) => {
      if (!r.ok) refreshPossible = false;
      return r.ok;
    })
    .catch(() => {
      refreshPossible = false;
      return false;
    });
}

function refreshSession(): Promise<boolean> {
  if (!refreshPossible) return Promise.resolve(false);
  if (!refreshPromise) {
    refreshPromise = performRefresh().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

/**
 * Reads the CSRF token the backend sets as a readable (non-httpOnly) cookie
 * on every response (see api/src/middleware.ts) and echoes it back as a
 * header on mutating requests (see api/src/lib/security/csrf.ts for why:
 * double-submit CSRF protection — an attacker's cross-site page can trigger
 * a request that carries this app's cookies automatically, but it cannot
 * read the cookie's value to also put it in a header).
 */
function getCsrfCookie(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)vv_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", undefined]);

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method?.toUpperCase();
  const needsCsrf = !SAFE_METHODS.has(method);
  // Generated once per logical call (not per fetch attempt) so a transparent
  // refresh-and-retry (see below) still correlates as the same request in
  // both this browser's network tab and the backend's logs — two attempts
  // telling one coherent story, not two unrelated IDs.
  const requestId = crypto.randomUUID();
  const doFetch = () =>
    fetch(`${baseUrl}${path}`, {
      credentials: "include",
      // Only set the JSON content-type when there is a body — sending it on
      // bodyless requests (e.g. DELETE) can trip up strict servers.
      ...init,
      headers: {
        // Set the JSON content-type for JSON bodies only. FormData must keep
        // an unset Content-Type so the browser adds the multipart boundary —
        // forcing application/json here would corrupt the multipart stream
        // and the server couldn't read the uploaded file. Bodyless requests
        // (e.g. DELETE) send no content-type at all to avoid tripping strict
        // servers.
        ...(init?.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}),
        ...(needsCsrf && getCsrfCookie() ? { "X-CSRF-Token": getCsrfCookie()! } : {}),
        "X-Request-Id": requestId,
        ...(init?.headers ?? {}),
      },
    });

  let res = await doFetch();

  // The access token is short-lived (~15 min). If it has expired, rotate it via
  // the refresh token once, then transparently retry the original request so
  // the UI doesn't hard-fail on an otherwise-valid session.
  //
  // `/auth/login` and `/auth/refresh` are exempt: a 401 from login means BAD
  // CREDENTIALS (not expiry) — retrying it against the refresh cookie only
  // produces a second, misleading 401 console error and wastes a request.
  const isAuthEndpoint = path === "/api/v1/auth/login" || path === "/api/v1/auth/refresh";
  if (res.status === 401 && !isAuthEndpoint && refreshPossible) {
    const refreshed = await refreshSession();
    if (refreshed) res = await doFetch();
  }

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!res.ok) {
    const b = (body ?? {}) as { error?: string; message?: string; requestId?: string; fields?: Record<string, string> };
    throw new ApiError(res.status, b.message ?? `Request failed (${res.status})`, b.error, b.requestId, b.fields);
  }

  return body as T;
}

/**
 * Multipart upload helper for the admin image/logo/hero endpoints. Same
 * security posture as `request()` — HTTP-only cookies (`credentials:
 * "include"`), the double-submit CSRF token echoed back as a header, a
 * correlation id, and one transparent refresh-and-retry on 401 — but it must
 * NOT set a Content-Type header: the browser has to generate the multipart
 * boundary itself, which only happens when the header is left to fetch().
 * Sending `Content-Type: application/json` (as request() does when a body is
 * present) would corrupt the FormData and break parsing server-side.
 */
async function multipartRequest<T>(path: string, init: { method?: string; body: FormData; errorMessage?: string }): Promise<T> {
  const method = init.method?.toUpperCase();
  const requestId = crypto.randomUUID();
  const doFetch = () =>
    fetch(`${baseUrl}${path}`, {
      method,
      credentials: "include",
      body: init.body,
      headers: {
        ...(getCsrfCookie() ? { "X-CSRF-Token": getCsrfCookie()! } : {}),
        "X-Request-Id": requestId,
      },
    });

  let res = await doFetch();
  if (res.status === 401 && path !== "/api/v1/auth/login" && path !== "/api/v1/auth/refresh" && refreshPossible) {
    const refreshed = await refreshSession();
    if (refreshed) res = await doFetch();
  }

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!res.ok) {
    const b = (body ?? {}) as { error?: string; message?: string; requestId?: string; fields?: Record<string, string> };
    throw new ApiError(res.status, b.message ?? `${init.errorMessage ?? "Request failed"} (${res.status})`, b.error, b.requestId, b.fields);
  }

  return body as T;
}

// ---- Catalog ----

export interface BrandLogo {
  id: string;
  brandId: string;
  storageKey: string;
  url: string;
  contentType: string;
  sizeBytes: number;
  width: number;
  height: number;
  createdAt: string;
  updatedAt: string;
}

/** Same shape as BrandLogo (deliberately) — see the backend's migration 0045 for why this is a separate type: a large lifestyle photo, not the small logo mark. */
export interface BrandCampaignImage {
  id: string;
  brandId: string;
  storageKey: string;
  url: string;
  contentType: string;
  sizeBytes: number;
  width: number;
  height: number;
  createdAt: string;
  updatedAt: string;
}

/** A single product image. `position` orders the gallery (0 = primary). */
export interface ProductImage {
  id: string;
  productId: string;
  url: string;
  position: number;
  altText: string | null;
  storageKey: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  createdAt: string;
}

export interface Brand {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  displayOrder: number;
  logo?: BrandLogo | null;
  campaignImage?: BrandCampaignImage | null;
  productCount?: number;
}

export interface GenderAudience {
  code: string;
  name: string;
}

/** Light lifestyle projection attached to a serialized Product (its membership set). */
export interface ProductLifestyleRef {
  id: string;
  slug: string;
  name: string;
}

/**
 * A "Shop by Lifestyle" taxonomy entry. Public listings omit `active`/
 * `displayOrder`; the admin listing includes them.
 */
export interface Lifestyle {
  id: string;
  slug: string;
  name: string;
  shortDescription: string | null;
  heroImageUrl: string | null;
  /** Count of ACTIVE products assigned (storefront cards + admin listing). */
  productCount: number;
  /** Admin-only: whether the lifestyle is discoverable on the storefront. */
  active?: boolean;
  displayOrder?: number;
  /** Admin-only timestamps (used by the lifestyle management table). */
  createdAt?: string;
  updatedAt?: string;
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  parentId?: string | null;
  imageUrl?: string | null;
  /** Small icon-library key (lucide set) for rendering an inline vector icon — an identifier, NOT a photo. */
  icon?: string;
  active: boolean;
  displayOrder: number;
}

/** A category surfaced in the "Shop by Category" audience showcase. */
export interface GenderCategory extends Category {
  count: number;
}

/** Mega-menu category: a gender-scoped category with the attribute groups that apply to it. */
export interface GenderCategoryWithAttributes extends GenderCategory {
  attributes: AttributeGroup[];
}

export interface ProductVariant {
  id: string;
  size: string;
  color: string;
  inStock: boolean;
  lowStock: boolean;
  // Admin-only, omitted from the public storefront serialization
  stockQty?: number;
  sku?: string | null;
}

export interface VariantInput {
  id?: string | null;
  size: string;
  color: string;
  stockQty: number;
  sku?: string | null;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  brand: Brand | null;
  category: Category | null;
  priceCents: number;
  compareAtPriceCents?: number | null;
  onSale: boolean;
  discountPercent: number | null;
  gender?: string | null;
  genderAudiences?: GenderAudience[];
  lifestyles?: ProductLifestyleRef[];
  images: ProductImage[];
  active: boolean;
  /** Server-derived: true when no variant has stock (or there are no variants). Never stored. */
  soldOut?: boolean;
  variants: ProductVariant[];
  shortDescription?: string | null;
  fullDescription?: string | null;
  badgeText?: string | null;
  offerLabel?: string | null;
  // Admin-only (omitted in public storefront serialization)
  sku?: string | null;
  offerStartDate?: string | null;
  offerEndDate?: string | null;
  tags?: string[];
  status?: AdminProductStatus;
  totalStock?: number;
  publishedAt?: string | null;
  archivedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export type AdminProductStatus = "active" | "draft" | "archived";
export type AdminProductFilter = "all" | "active" | "draft" | "archived" | "sold_out" | "low_stock";
export type AdminProductSort = "newest" | "oldest" | "name" | "price_asc" | "price_desc" | "stock_asc" | "updated";

/** Same rule the server uses (see catalog.service.ts serializeProductWithVariants) — for payloads that predate the soldOut field. */
export function isSoldOut(p: Pick<Product, "soldOut" | "variants">): boolean {
  return p.soldOut ?? !p.variants.some((v) => v.inStock);
}

export interface FacetValue {
  value: string;
  count: number;
}

export interface CategoryFacet extends FacetValue {
  slug: string;
  name: string;
  parentId: string | null;
}

export interface BrandFacet extends FacetValue {
  name: string;
}

export interface ProductFacets {
  brands: BrandFacet[];
  categories: CategoryFacet[];
  sizes: FacetValue[];
  colors: FacetValue[];
  genders: FacetValue[];
  collections: FacetValue[];
  availability: { inStock: number; outOfStock: number };
  price: { min: number; max: number; p25: number; p50: number; p75: number };
}

export interface ProductPage {
  items: Product[];
  pagination: { page: number; pageSize: number; total: number };
  facets: ProductFacets;
}

export interface ProductListParams {
  brand?: string[];
  category?: string;
  subcategory?: string;
  size?: string[];
  color?: string[];
  minPrice?: number;
  maxPrice?: number;
  gender?: string;
  sale?: boolean;
  collection?: string;
  /** Lifestyle slug context (migration 0019) — narrows the listing + facets to that lifestyle. */
  lifestyle?: string;
  /** Selected attribute option ids (e.g. Fit=Baggy) — see shop.ts's ShopFilters.attr and the backend's within-group-OR/across-group-AND semantics. */
  attributeOptionIds?: string[];
  availability?: "in_stock" | "out_of_stock";
  q?: string;
  sort?: "recommended" | "newest" | "price_asc" | "price_desc";
  page?: number;
  pageSize?: number;
}

export function listProducts(params?: ProductListParams): Promise<ProductPage> {
  const q = new URLSearchParams();
  if (params?.brand?.length) q.set("brand", params.brand.join(","));
  if (params?.category) q.set("category", params.category);
  if (params?.subcategory) q.set("subcategory", params.subcategory);
  if (params?.size?.length) q.set("size", params.size.join(","));
  if (params?.color?.length) q.set("color", params.color.join(","));
  if (params?.minPrice != null) q.set("minPrice", String(params.minPrice));
  if (params?.maxPrice != null) q.set("maxPrice", String(params.maxPrice));
  if (params?.gender) q.set("gender", params.gender);
  if (params?.sale) q.set("sale", "true");
  if (params?.collection) q.set("collection", params.collection);
  if (params?.lifestyle) q.set("lifestyle", params.lifestyle);
  if (params?.attributeOptionIds?.length) q.set("attr", params.attributeOptionIds.join(","));
  if (params?.availability) q.set("availability", params.availability);
  if (params?.q) q.set("q", params.q);
  if (params?.sort) q.set("sort", params.sort);
  if (params?.page) q.set("page", String(params.page));
  if (params?.pageSize) q.set("pageSize", String(params.pageSize));
  const qs = q.toString();
  return request<ProductPage>(`/api/v1/products${qs ? `?${qs}` : ""}`);
}

export function getProductBySlug(slug: string): Promise<{ product: Product }> {
  return request<{ product: Product }>(`/api/v1/products/${encodeURIComponent(slug)}`);
}

export function listBrands(): Promise<{ brands: Brand[] }> {
  return request<{ brands: Brand[] }>("/api/v1/brands");
}

export type BrandSectionSpeed = "slow" | "medium" | "fast";

/** Public storefront setting — the "Shop by brands" marquee autoplay speed. */
export function getBrandSectionSettings(): Promise<{ speed: BrandSectionSpeed }> {
  return request<{ speed: BrandSectionSpeed }>("/api/v1/settings/brand-section");
}

export interface BrandPageData {
  brand: Brand;
  products: Product[];
  pagination: { page: number; pageSize: number; total: number };
}

/** Public brand detail — brand (with logo) plus its active products. */
export function getBrandBySlug(slug: string): Promise<BrandPageData> {
  return request<BrandPageData>(`/api/v1/brands/${encodeURIComponent(slug)}`);
}

/** Admin catalog view — returns ALL brands including inactive ones. */
export function listAdminBrands(): Promise<{ brands: Brand[] }> {
  return request<{ brands: Brand[] }>("/api/v1/admin/brands");
}

/** Persist the brand-section marquee autoplay speed (brands.manage). */
export function updateBrandSectionSettings(speed: BrandSectionSpeed): Promise<{ speed: BrandSectionSpeed }> {
  return request<{ speed: BrandSectionSpeed }>("/api/v1/admin/settings/brand-section", {
    method: "PATCH",
    body: JSON.stringify({ speed }),
  });
}

export function listCategories(): Promise<{ categories: Category[] }> {
  return request<{ categories: Category[] }>("/api/v1/categories");
}

/** "Shop by Category" within an audience — real DISTINCT category↔gender counts. */
export function listCategoriesByGender(gender: string): Promise<{ categories: GenderCategory[] }> {
  return request<{ categories: GenderCategory[] }>(`/api/v1/categories?gender=${encodeURIComponent(gender)}`);
}

/** Header mega-menu payload — gender categories each with their attribute groups in one request. */
export function listGenderCategoriesWithAttributes(gender: string): Promise<{ categories: GenderCategoryWithAttributes[] }> {
  return request<{ categories: GenderCategoryWithAttributes[] }>(
    `/api/v1/categories?gender=${encodeURIComponent(gender)}&withAttributes=1`
  );
}

/**
 * Batched storefront read — the distinct active attribute groups (with
 * options) that apply to ANY of the given category slugs, de-duplicated by
 * group id. Used by multi-category contexts (a Brand page's attribute shelf,
 * the header mega-menu) where fetching per-category would be N requests.
 */
export function listCategoriesBySlugAttributes(slugs: string[]): Promise<{ groups: AttributeGroup[] }> {
  const clean = [...new Set((slugs ?? []).map((s) => s.trim()).filter(Boolean))];
  if (clean.length === 0) return Promise.resolve({ groups: [] });
  return request<{ groups: AttributeGroup[] }>("/api/v1/categories/attributes?for=" + encodeURIComponent(clean.join(",")));
}

// ---- Admin / Business (RBAC-gated) ----

export interface AdminOrder {
  id: string;
  userId: string;
  status: "PENDING" | "PAID" | "SHIPPED" | "DELIVERED" | "CANCELLED";
  items: { nameSnapshot: string; brandSnapshot: string; quantity: number; lineTotalCents: number }[];
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  totalCents: number;
  totalTzs?: number | null;
  shippingAddressSnapshot?: { city: string; region: string; country: string } | null;
  createdAt: string;
}

// Admin listing reuses the rich storefront Product serialization (name, brand,
// variants incl. stock/sku, price etc.) but returns { items, pagination } —
// there are NO facets on this endpoint (search is client-side here).
export function listAdminProducts(params?: { page?: number; pageSize?: number; q?: string; status?: AdminProductFilter; sort?: AdminProductSort }): Promise<{ items: Product[]; pagination: { page: number; pageSize: number; total: number } }> {
  const q = new URLSearchParams();
  if (params?.page) q.set("page", String(params.page));
  if (params?.pageSize) q.set("pageSize", String(params.pageSize));
  if (params?.q) q.set("q", params.q);
  if (params?.status) q.set("status", params.status);
  if (params?.sort) q.set("sort", params.sort);
  const qs = q.toString();
  return request<{ items: Product[]; pagination: { page: number; pageSize: number; total: number } }>(`/api/v1/admin/products${qs ? `?${qs}` : ""}`);
}

/** Advances an order's lifecycle (PENDING→PAID→SHIPPED→DELIVERED / CANCELLED). */
export function updateOrderStatus(
  id: string,
  status: AdminOrder["status"]
): Promise<{ order: AdminOrder }> {
  return request<{ order: AdminOrder }>(`/api/v1/admin/orders/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export function createAdminProduct(input: {
  /** Omit to let the server derive a unique slug from the name. */
  slug?: string;
  name: string;
  brandId: string;
  categoryId: string;
  priceCents: number;
  genderAudiences?: string[];
  lifestyleIds?: string[];
  tags?: string[];
  sku?: string | null;
  shortDescription?: string | null;
  fullDescription?: string | null;
  badgeText?: string | null;
  offerLabel?: string | null;
  compareAtPriceCents?: number | null;
  offerStartDate?: string | null;
  offerEndDate?: string | null;
}): Promise<{ product: Product }> {
  return request<{ product: Product }>("/api/v1/admin/products", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateAdminProduct(
  id: string,
  patch: Partial<{
    name: string;
    slug: string;
    brandId: string;
    categoryId: string;
    priceCents: number;
    active: boolean;
    genderAudiences?: string[];
    lifestyleIds?: string[];
    tags?: string[];
    sku: string | null;
    shortDescription: string | null;
    fullDescription: string | null;
    badgeText: string | null;
    offerLabel: string | null;
    compareAtPriceCents: number | null;
    offerStartDate: string | null;
    offerEndDate: string | null;
  }>
): Promise<{ product: Product }> {
  return request<{ product: Product }>(`/api/v1/admin/products/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/** Replaces the full color×size×stock variant matrix for a product (atomic on the server). */
export function updateProductVariants(
  id: string,
  variants: VariantInput[]
): Promise<{ variants: ProductVariant[] }> {
  return request<{ variants: ProductVariant[] }>(`/api/v1/admin/products/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ variants }),
  });
}

/** The signed-in user's effective permissions (role + per-admin grants) — for hiding actions the server would refuse. */
export function getMyPermissions(): Promise<string[]> {
  return request<{ permissions?: string[] }>("/api/v1/auth/me").then((r) => r.permissions ?? []);
}

/** Admin product detail (any status) — stock, SKUs, dates, images. */
export function getAdminProduct(id: string): Promise<{ product: Product }> {
  return request<{ product: Product }>(`/api/v1/admin/products/${encodeURIComponent(id)}`);
}

/** Un-archives a deleted product back to draft. */
export function restoreAdminProduct(id: string): Promise<{ product: Product }> {
  return request<{ product: Product }>(`/api/v1/admin/products/${encodeURIComponent(id)}/restore`, { method: "POST" });
}

/** Sets absolute stock for some of a product's variants (dedicated inventory path). */
export function setProductStock(id: string, stock: { variantId: string; stockQty: number }[]): Promise<{ variants: ProductVariant[] }> {
  return request<{ variants: ProductVariant[] }>(`/api/v1/admin/products/${encodeURIComponent(id)}/stock`, {
    method: "PATCH",
    body: JSON.stringify({ stock }),
  });
}

/** Archives ("deletes") a product: hidden from the storefront and unpurchasable; order history is kept. Restorable. */
export function deleteAdminProduct(id: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/api/v1/admin/products/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function createAdminBrand(input: { name: string; slug?: string }): Promise<{ brand: Brand }> {
  return request<{ brand: Brand }>("/api/v1/admin/brands", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateAdminBrand(
  id: string,
  patch: Partial<{ name: string; slug: string; active: boolean }>
): Promise<{ brand: Brand }> {
  return request<{ brand: Brand }>(`/api/v1/admin/brands/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/** Uploads (or replaces) a brand logo via multipart/form-data. */
export function uploadBrandLogo(brandId: string, file: File): Promise<{ logo: BrandLogo }> {
  const form = new FormData();
  form.append("file", file);
  return multipartRequest<{ logo: BrandLogo }>(
    `/api/v1/admin/brands/${encodeURIComponent(brandId)}/logo`,
    { method: "POST", body: form, errorMessage: "Upload failed" }
  );
}

export function removeBrandLogo(brandId: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/api/v1/admin/brands/${encodeURIComponent(brandId)}/logo`, {
    method: "DELETE",
  });
}

export function uploadBrandCampaignImage(brandId: string, file: File): Promise<{ campaignImage: BrandCampaignImage }> {
  const form = new FormData();
  form.append("file", file);
  return multipartRequest<{ campaignImage: BrandCampaignImage }>(
    `/api/v1/admin/brands/${encodeURIComponent(brandId)}/campaign-image`,
    { method: "POST", body: form, errorMessage: "Upload failed" }
  );
}

export function removeBrandCampaignImage(brandId: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/api/v1/admin/brands/${encodeURIComponent(brandId)}/campaign-image`, {
    method: "DELETE",
  });
}

export function reorderBrands(orderedIds: string[]): Promise<{ brands: Brand[] }> {
  return request<{ brands: Brand[] }>("/api/v1/admin/brands/reorder", {
    method: "PUT",
    body: JSON.stringify({ orderedIds }),
  });
}

export type FooterPlatform = "instagram" | "tiktok" | "facebook" | "phone" | "whatsapp" | "email";

export type NotificationCategory =
  | "ORDER" | "PAYMENT" | "PRODUCT" | "PROMOTION" | "WISHLIST"
  | "INVENTORY" | "CUSTOMER" | "SYSTEM" | "ADMIN" | "SECURITY";

export interface AppNotification {
  id: string;
  category: NotificationCategory;
  title: string;
  message: string;
  imageUrl: string | null;
  entityType: string | null;
  entityId: string | null;
  actionUrl: string | null;
  isRead: boolean;
  createdAt: string;
}

export function listNotifications(page = 1, pageSize = 20): Promise<{ notifications: AppNotification[]; total: number; page: number; pageSize: number }> {
  return request(`/api/v1/notifications?page=${page}&pageSize=${pageSize}`);
}

/** Deliberately its own tiny call — what the header bell polls. */
export function getUnreadNotificationCount(): Promise<{ count: number }> {
  return request("/api/v1/notifications/unread-count");
}

export function markNotificationRead(id: string): Promise<{ success: boolean }> {
  return request(`/api/v1/notifications/${encodeURIComponent(id)}/read`, { method: "PUT" });
}

export function markAllNotificationsRead(): Promise<{ success: boolean }> {
  return request("/api/v1/notifications/mark-all-read", { method: "PUT" });
}

export interface FooterContactLink {
  id: string;
  platform: FooterPlatform;
  value: string | null;
  active: boolean;
  displayOrder: number;
}

/** Public — only channels that are active AND configured, in display order. */
export function listFooterContactLinks(): Promise<{ links: FooterContactLink[] }> {
  return request<{ links: FooterContactLink[] }>("/api/v1/footer-contact-links");
}

export function listAdminFooterContactLinks(): Promise<{ links: FooterContactLink[] }> {
  return request<{ links: FooterContactLink[] }>("/api/v1/admin/footer-contact-links");
}

export interface AdminBroadcastNotification extends AppNotification {
  roleScope: "CUSTOMER" | "ADMIN" | "SUPER_ADMIN";
  active: boolean;
}

export type CouponDiscountType = "FIXED" | "PERCENTAGE";

export interface Coupon {
  id: string;
  code: string;
  discountType: CouponDiscountType;
  discountValue: number;
  minOrderCents: number;
  maxRedemptions: number | null;
  maxRedemptionsPerCustomer: number | null;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CouponDraft = {
  code: string;
  discountType: CouponDiscountType;
  discountValue: number;
  minOrderCents?: number;
  maxRedemptions?: number | null;
  maxRedemptionsPerCustomer?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
};

export type AdminProductLimitType = "NONE" | "FIXED_TOTAL" | "FIXED_ACTIVE" | "PER_DAY" | "PER_MONTH";

export interface AdminProductLimitStatus {
  limitType: AdminProductLimitType;
  maxValue: number | null;
  used: number;
  remaining: number | null;
}

export function getAdminProductLimit(adminUserId: string): Promise<AdminProductLimitStatus> {
  return request<AdminProductLimitStatus>(`/api/v1/super-admin/admins/${encodeURIComponent(adminUserId)}/product-limit`);
}

export function setAdminProductLimit(adminUserId: string, limitType: AdminProductLimitType, maxValue: number | null): Promise<{ limit: unknown }> {
  return request<{ limit: unknown }>(`/api/v1/super-admin/admins/${encodeURIComponent(adminUserId)}/product-limit`, {
    method: "PUT",
    body: JSON.stringify({ limitType, maxValue }),
  });
}

export function listAdminCoupons(): Promise<{ coupons: Coupon[] }> {
  return request<{ coupons: Coupon[] }>("/api/v1/admin/coupons");
}

export function createCoupon(draft: CouponDraft): Promise<{ coupon: Coupon }> {
  return request<{ coupon: Coupon }>("/api/v1/admin/coupons", {
    method: "POST",
    body: JSON.stringify(draft),
  });
}

export function updateCoupon(id: string, patch: Partial<CouponDraft> & { active?: boolean }): Promise<{ coupon: Coupon }> {
  return request<{ coupon: Coupon }>(`/api/v1/admin/coupons/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/** Read-only preview only — the discount shown here is never what actually gets charged; order creation re-validates and re-computes it server-side from scratch. */
export function previewCoupon(couponCode: string, subtotalCents: number): Promise<{ valid: boolean; discountCents: number; discountType: CouponDiscountType; discountValue: number }> {
  return request("/api/v1/coupons/preview", {
    method: "POST",
    body: JSON.stringify({ couponCode, subtotalCents }),
  });
}

export function listAdminBroadcasts(): Promise<{ notifications: AdminBroadcastNotification[] }> {
  return request<{ notifications: AdminBroadcastNotification[] }>("/api/v1/admin/notifications");
}

export function createBroadcastNotification(input: {
  roleScope: "CUSTOMER" | "ADMIN" | "SUPER_ADMIN";
  title: string;
  message: string;
  actionUrl?: string;
  imageUrl?: string;
}): Promise<{ id: string }> {
  return request<{ id: string }>("/api/v1/admin/notifications", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function setBroadcastNotificationActive(id: string, active: boolean): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/api/v1/admin/notifications/${encodeURIComponent(id)}/active`, {
    method: "PUT",
    body: JSON.stringify({ active }),
  });
}

export function updateFooterContactLink(
  platform: FooterPlatform,
  patch: Partial<{ value: string | null; active: boolean; displayOrder: number }>
): Promise<{ link: FooterContactLink }> {
  return request<{ link: FooterContactLink }>(`/api/v1/admin/footer-contact-links/${encodeURIComponent(platform)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

// ---- Admin product images (multipart upload / replace / reorder / delete) ----

/** Uploads a single product image (appends to the product's gallery). */
export function uploadProductImage(productId: string, file: File): Promise<{ image: ProductImage }> {
  const form = new FormData();
  form.append("file", file);
  return multipartRequest<{ image: ProductImage }>(
    `/api/v1/admin/products/${encodeURIComponent(productId)}/images`,
    { method: "POST", body: form, errorMessage: "Upload failed" }
  );
}

/** Replaces one product image's bytes (keeps its position in the gallery). */
export function replaceProductImage(imageId: string, file: File): Promise<{ image: ProductImage }> {
  const form = new FormData();
  form.append("file", file);
  return multipartRequest<{ image: ProductImage }>(
    `/api/v1/admin/products/images/${encodeURIComponent(imageId)}`,
    { method: "PATCH", body: form, errorMessage: "Replace failed" }
  );
}

export function deleteProductImage(imageId: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/api/v1/admin/products/images/${encodeURIComponent(imageId)}`, {
    method: "DELETE",
  });
}

/** Sets image order for a product (first id = primary). */
export function reorderProductImages(productId: string, orderedImageIds: string[]): Promise<{ images: ProductImage[] }> {
  return request<{ images: ProductImage[] }>(`/api/v1/admin/products/${encodeURIComponent(productId)}/images`, {
    method: "PUT",
    body: JSON.stringify({ orderedImageIds }),
  });
}

export function listProductImages(productId: string): Promise<{ images: ProductImage[] }> {
  return request<{ images: ProductImage[] }>(`/api/v1/admin/products/${encodeURIComponent(productId)}/images`);
}

// ---- Homepage hero advertisements ----

export type HeroType = "promotional" | "lifestyle" | "editorial";

/** Lean shape returned by the storefront endpoint (public /api/v1/hero-slides). */
export interface PublicHeroSlide {
  id: string;
  campaignLabel: string;
  headline: string;
  description: string;
  ctaText: string;
  ctaUrl: string;
  cta2Text: string | null;
  cta2Url: string | null;
  badgeText: string | null;
  editorialText: string | null;
  heroType: HeroType;
  imageUrl: string;
  videoUrl: string | null;
}

/** Full shape used by the Super Admin management UI. */
export interface HeroSlide extends PublicHeroSlide {
  storageKey: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  videoStorageKey: string | null;
  videoContentType: string | null;
  videoSizeBytes: number | null;
  displayOrder: number;
  isActive: boolean;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export type HeroSlideDraft = {
  campaignLabel: string;
  headline: string;
  description: string;
  ctaText: string;
  ctaUrl: string;
  cta2Text?: string | null;
  cta2Url?: string | null;
  badgeText?: string;
  editorialText?: string;
  heroType: HeroType;
  displayOrder?: number;
  isActive?: boolean;
  startDate?: string | null;
  endDate?: string | null;
  imageUrl?: string;
};

export function listHeroSlides(): Promise<{ slides: PublicHeroSlide[] }> {
  return request<{ slides: PublicHeroSlide[] }>("/api/v1/hero-slides");
}

export interface PlatformSettings {
  platformName: string;
  tagline: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  pwaIconUrl: string | null;
  pwaInstallPromptEnabled: boolean;
  darEsSalaamFeeTzs: number;
  outsideDarFeeTzs: number;
  codMessage: string | null;
  updatedAt: string;
}

/** Public — used by the header, footer, title metadata, and every page needing the current brand identity. */
export function getPlatformSettings(): Promise<{ settings: PlatformSettings }> {
  return request<{ settings: PlatformSettings }>("/api/v1/platform-settings");
}

export function updatePlatformSettings(input: { platformName?: string; tagline?: string | null; pwaInstallPromptEnabled?: boolean; darEsSalaamFeeTzs?: number; outsideDarFeeTzs?: number; codMessage?: string | null }): Promise<{ settings: PlatformSettings }> {
  return request<{ settings: PlatformSettings }>("/api/v1/admin/platform-settings", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function uploadPlatformLogo(file: File): Promise<{ settings: PlatformSettings }> {
  const formData = new FormData();
  formData.append("file", file);
  return request<{ settings: PlatformSettings }>("/api/v1/admin/platform-settings/logo", { method: "POST", body: formData });
}

export function removePlatformLogo(): Promise<{ settings: PlatformSettings }> {
  return request<{ settings: PlatformSettings }>("/api/v1/admin/platform-settings/logo", { method: "DELETE" });
}

export function uploadPlatformFavicon(file: File): Promise<{ settings: PlatformSettings }> {
  const formData = new FormData();
  formData.append("file", file);
  return request<{ settings: PlatformSettings }>("/api/v1/admin/platform-settings/favicon", { method: "POST", body: formData });
}

export function removePlatformFavicon(): Promise<{ settings: PlatformSettings }> {
  return request<{ settings: PlatformSettings }>("/api/v1/admin/platform-settings/favicon", { method: "DELETE" });
}

export function uploadPlatformPwaIcon(file: File): Promise<{ settings: PlatformSettings }> {
  const formData = new FormData();
  formData.append("file", file);
  return request<{ settings: PlatformSettings }>("/api/v1/admin/platform-settings/pwa-icon", { method: "POST", body: formData });
}

export function removePlatformPwaIcon(): Promise<{ settings: PlatformSettings }> {
  return request<{ settings: PlatformSettings }>("/api/v1/admin/platform-settings/pwa-icon", { method: "DELETE" });
}

export interface AuthPageSettings {
  backgroundImageUrl: string | null;
  loginHeadline: string;
  loginSubtitle: string;
  registerHeadline: string;
  registerSubtitle: string;
}

/** Public — auth page background image and editable headlines, in display order. */
export function getAuthPageSettings(): Promise<{ settings: AuthPageSettings }> {
  return request<{ settings: AuthPageSettings }>("/api/v1/auth-page-settings", { cache: "no-store" });
}

export function getAdminAuthPageSettings(): Promise<{ settings: AuthPageSettings }> {
  return request<{ settings: AuthPageSettings }>("/api/v1/admin/auth-page-settings");
}

export function updateAuthPageSettings(input: Partial<{ loginHeadline: string; loginSubtitle: string; registerHeadline: string; registerSubtitle: string }>): Promise<{ settings: AuthPageSettings }> {
  return request<{ settings: AuthPageSettings }>("/api/v1/admin/auth-page-settings", { method: "PATCH", body: JSON.stringify(input) });
}

export function uploadAuthPageBackground(file: File): Promise<{ settings: AuthPageSettings }> {
  const formData = new FormData();
  formData.append("file", file);
  return request<{ settings: AuthPageSettings }>("/api/v1/admin/auth-page-settings/background-image", { method: "POST", body: formData });
}

export function removeAuthPageBackground(): Promise<{ settings: AuthPageSettings }> {
  return request<{ settings: AuthPageSettings }>("/api/v1/admin/auth-page-settings/background-image", { method: "DELETE" });
}

export function getPromoBanner(): Promise<{ messages: string[] }> {
  return request<{ messages: string[] }>("/api/v1/promo-banner", { cache: "no-store" });
}

export function getAdminPromoBanner(): Promise<{ messages: string[] }> {
  return request<{ messages: string[] }>("/api/v1/admin/promo-banner");
}

export function updateAdminPromoBanner(messages: string[]): Promise<{ messages: string[] }> {
  return request<{ messages: string[] }>("/api/v1/admin/promo-banner", { method: "PATCH", body: JSON.stringify({ messages }) });
}

/**
 * Reports a caught frontend exception to the backend for real server-side
 * visibility (see api/src/lib/errorMonitoring.ts) — best-effort, and MUST
 * NEVER throw itself: a broken error-reporting call must never become a
 * second crash on top of the first one it was trying to report.
 */
export function reportClientError(input: { message: string; stack?: string; componentStack?: string; url?: string }): void {
  request("/api/v1/client-errors", {
    method: "POST",
    body: JSON.stringify(input),
  }).catch(() => { /* deliberately swallowed — see doc comment above */ });
}

export function listAdminHeroSlides(): Promise<{ slides: HeroSlide[] }> {
  return request<{ slides: HeroSlide[] }>("/api/v1/admin/hero-slides");
}

export function createAdminHeroSlide(input: HeroSlideDraft): Promise<{ slide: HeroSlide }> {
  return request<{ slide: HeroSlide }>("/api/v1/admin/hero-slides", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateAdminHeroSlide(id: string, patch: Partial<HeroSlideDraft>): Promise<{ slide: HeroSlide }> {
  return request<{ slide: HeroSlide }>(`/api/v1/admin/hero-slides/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteAdminHeroSlide(id: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/api/v1/admin/hero-slides/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function reorderAdminHeroSlides(orderedIds: string[]): Promise<{ slides: HeroSlide[] }> {
  return request<{ slides: HeroSlide[] }>("/api/v1/admin/hero-slides/reorder", {
    method: "PUT",
    body: JSON.stringify({ orderedIds }),
  });
}

/** Uploads (or replaces) a hero slide image via multipart/form-data. */
export function uploadHeroImage(slideId: string, file: File): Promise<{ slide: HeroSlide }> {
  const form = new FormData();
  form.append("file", file);
  return multipartRequest<{ slide: HeroSlide }>(
    `/api/v1/admin/hero-slides/${encodeURIComponent(slideId)}/image`,
    { method: "POST", body: form, errorMessage: "Upload failed" }
  );
}

export function uploadHeroVideo(slideId: string, file: File): Promise<{ slide: HeroSlide }> {
  const form = new FormData();
  form.append("file", file);
  return multipartRequest<{ slide: HeroSlide }>(
    `/api/v1/admin/hero-slides/${encodeURIComponent(slideId)}/video`,
    { method: "POST", body: form, errorMessage: "Video upload failed" }
  );
}

export function removeHeroVideo(slideId: string): Promise<{ slide: HeroSlide }> {
  return request<{ slide: HeroSlide }>(`/api/v1/admin/hero-slides/${encodeURIComponent(slideId)}/video`, {
    method: "DELETE",
  });
}

export function removeHeroImage(slideId: string): Promise<{ slide: HeroSlide }> {
  return request<{ slide: HeroSlide }>(`/api/v1/admin/hero-slides/${encodeURIComponent(slideId)}/image`, {
    method: "DELETE",
  });
}

// ---- Shop by Lifestyle (migration 0019) ----

/** Active lifestyles for the homepage "Shop by Lifestyle" section, ordered. */
export function listLifestyles(): Promise<{ items: Lifestyle[] }> {
  return request<{ items: Lifestyle[] }>("/api/v1/lifestyles");
}

/** An active lifestyle by slug (404 when missing/inactive — deactivated lifestyles vanish from links). */
export function getLifestyleBySlug(slug: string): Promise<{ lifestyle: Lifestyle }> {
  return request<{ lifestyle: Lifestyle }>(`/api/v1/lifestyles/${encodeURIComponent(slug)}`);
}

/** Every lifestyle incl. drafts — Super Admin lifestyle management only. */
export function listAdminLifestyles(): Promise<{ items: Lifestyle[] }> {
  return request<{ items: Lifestyle[] }>("/api/v1/admin/lifestyles");
}

export function createAdminLifestyle(input: {
  name: string;
  slug?: string;
  shortDescription?: string | null;
  active?: boolean;
  displayOrder?: number;
}): Promise<{ lifestyle: Lifestyle }> {
  return request<{ lifestyle: Lifestyle }>("/api/v1/admin/lifestyles", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateAdminLifestyle(
  id: string,
  patch: Partial<{
    name: string;
    slug: string;
    shortDescription: string | null;
    active: boolean;
    displayOrder: number;
  }>
): Promise<{ lifestyle: Lifestyle }> {
  return request<{ lifestyle: Lifestyle }>(`/api/v1/admin/lifestyles/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/** Delete is blocked server-side while products are still assigned. */
export function deleteAdminLifestyle(id: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/api/v1/admin/lifestyles/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

/** Uploads (or replaces) a lifestyle's real hero image via multipart/form-data. */
export function uploadLifestyleHero(id: string, file: File): Promise<{ lifestyle: Lifestyle }> {
  const form = new FormData();
  form.append("file", file);
  return multipartRequest<{ lifestyle: Lifestyle }>(
    `/api/v1/admin/lifestyles/${encodeURIComponent(id)}/hero`,
    { method: "POST", body: form, errorMessage: "Upload failed" }
  );
}

/** Removes the hero image (only allowed while the lifestyle is inactive). */
export function removeLifestyleHero(id: string): Promise<{ lifestyle: Lifestyle }> {
  return request<{ lifestyle: Lifestyle }>(`/api/v1/admin/lifestyles/${encodeURIComponent(id)}/hero`, {
    method: "DELETE",
  });
}

export function createAdminCategory(input: { name: string; slug?: string; icon?: string }): Promise<{ category: Category }> {
  return request<{ category: Category }>("/api/v1/admin/categories", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Admin-only — every category, active and inactive, so a hidden one can be found and re-enabled. */
export function listAdminCategories(): Promise<{ categories: Category[] }> {
  return request<{ categories: Category[] }>("/api/v1/admin/categories");
}

export function updateAdminCategory(id: string, patch: { name?: string; slug?: string; icon?: string; active?: boolean; displayOrder?: number }): Promise<{ category: Category }> {
  return request<{ category: Category }>(`/api/v1/admin/categories/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function uploadAdminCategoryImage(id: string, file: File): Promise<{ category: Category }> {
  const formData = new FormData();
  formData.append("file", file);
  return request<{ category: Category }>(`/api/v1/admin/categories/${encodeURIComponent(id)}/image`, { method: "POST", body: formData });
}

export function removeAdminCategoryImage(id: string): Promise<{ category: Category }> {
  return request<{ category: Category }>(`/api/v1/admin/categories/${encodeURIComponent(id)}/image`, { method: "DELETE" });
}

export interface AttributeOption {
  id: string;
  attributeGroupId: string;
  name: string;
  slug: string;
  active: boolean;
  displayOrder: number;
}

export interface AttributeGroup {
  id: string;
  name: string;
  slug: string;
  selectionType: "multi_select" | "single_select";
  active: boolean;
  displayOrder: number;
  categoryIds?: string[];
  options?: AttributeOption[];
}

export function listAdminAttributeGroups(): Promise<{ groups: AttributeGroup[] }> {
  return request<{ groups: AttributeGroup[] }>("/api/v1/admin/attribute-groups");
}

export function createAttributeGroup(input: { name: string; slug?: string; selectionType?: "multi_select" | "single_select"; active?: boolean; displayOrder?: number; categoryIds?: string[] }): Promise<{ group: AttributeGroup }> {
  return request<{ group: AttributeGroup }>("/api/v1/admin/attribute-groups", { method: "POST", body: JSON.stringify(input) });
}

export function updateAttributeGroup(id: string, patch: Partial<{ name: string; slug: string; selectionType: "multi_select" | "single_select"; active: boolean; displayOrder: number; categoryIds: string[] }>): Promise<{ group: AttributeGroup }> {
  return request<{ group: AttributeGroup }>(`/api/v1/admin/attribute-groups/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteAttributeGroup(id: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/api/v1/admin/attribute-groups/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function listAttributeOptions(groupId: string): Promise<{ options: AttributeOption[] }> {
  return request<{ options: AttributeOption[] }>(`/api/v1/admin/attribute-groups/${encodeURIComponent(groupId)}/options`);
}

export function createAttributeOption(groupId: string, input: { name: string; slug?: string; active?: boolean; displayOrder?: number }): Promise<{ option: AttributeOption }> {
  return request<{ option: AttributeOption }>(`/api/v1/admin/attribute-groups/${encodeURIComponent(groupId)}/options`, { method: "POST", body: JSON.stringify(input) });
}

export function updateAttributeOption(id: string, patch: Partial<{ name: string; slug: string; active: boolean; displayOrder: number }>): Promise<{ option: AttributeOption }> {
  return request<{ option: AttributeOption }>(`/api/v1/admin/attribute-options/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteAttributeOption(id: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/api/v1/admin/attribute-options/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** Public — which attribute groups (with their active options) apply to a category, by SLUG (matching every other slug-addressed public route in this app), for the storefront filter UI. */
export function listCategoryAttributes(categorySlug: string): Promise<{ groups: AttributeGroup[] }> {
  return request<{ groups: AttributeGroup[] }>(`/api/v1/categories/${encodeURIComponent(categorySlug)}/attributes`);
}

export function getProductAttributeOptionIds(productId: string): Promise<{ optionIds: string[] }> {
  return request<{ optionIds: string[] }>(`/api/v1/admin/products/${encodeURIComponent(productId)}/attributes`);
}

export function setProductAttributeValues(productId: string, optionIds: string[]): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/api/v1/admin/products/${encodeURIComponent(productId)}/attributes`, { method: "PATCH", body: JSON.stringify({ optionIds }) });
}

export interface Announcement {
  id: string;
  message: string;
  active: boolean;
  displayOrder: number;
}

/** Public — active header announcements, in display order. No-store: admin edits (Super Admin → Header Announcements) must show up on an already-open storefront tab immediately, not after the previous HTTP-cached copy expires. */
export function listAnnouncements(): Promise<{ announcements: Announcement[] }> {
  return request<{ announcements: Announcement[] }>("/api/v1/announcements", { cache: "no-store" });
}

export function listAdminAnnouncements(): Promise<{ announcements: Announcement[] }> {
  return request<{ announcements: Announcement[] }>("/api/v1/admin/announcements");
}

export function createAnnouncement(input: { message: string; active?: boolean; displayOrder?: number }): Promise<{ announcement: Announcement }> {
  return request<{ announcement: Announcement }>("/api/v1/admin/announcements", { method: "POST", body: JSON.stringify(input) });
}

export function updateAnnouncement(id: string, patch: Partial<{ message: string; active: boolean; displayOrder: number }>): Promise<{ announcement: Announcement }> {
  return request<{ announcement: Announcement }>(`/api/v1/admin/announcements/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteAnnouncement(id: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/api/v1/admin/announcements/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function reorderAnnouncements(orderedIds: string[]): Promise<{ success: boolean }> {
  return request<{ success: boolean }>("/api/v1/admin/announcements/reorder", { method: "POST", body: JSON.stringify({ orderedIds }) });
}

export interface AccordionSection {
  id: string;
  title: string;
  body: string;
  active: boolean;
  displayOrder: number;
}

/** Public — active product-page accordion sections, in display order. No-store: admin edits (Super Admin → Product Accordion) must show up on an already-open product tab immediately. */
export function listAccordionSections(): Promise<{ sections: AccordionSection[] }> {
  return request<{ sections: AccordionSection[] }>("/api/v1/accordion-sections", { cache: "no-store" });
}

export function listAdminAccordionSections(): Promise<{ sections: AccordionSection[] }> {
  return request<{ sections: AccordionSection[] }>("/api/v1/admin/accordion-sections");
}

export function createAccordionSection(input: { title: string; body: string; active?: boolean; displayOrder?: number }): Promise<{ section: AccordionSection }> {
  return request<{ section: AccordionSection }>("/api/v1/admin/accordion-sections", { method: "POST", body: JSON.stringify(input) });
}

export function updateAccordionSection(id: string, patch: Partial<{ title: string; body: string; active: boolean; displayOrder: number }>): Promise<{ section: AccordionSection }> {
  return request<{ section: AccordionSection }>(`/api/v1/admin/accordion-sections/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteAccordionSection(id: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/api/v1/admin/accordion-sections/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function reorderAccordionSections(orderedIds: string[]): Promise<{ success: boolean }> {
  return request<{ success: boolean }>("/api/v1/admin/accordion-sections/reorder", { method: "POST", body: JSON.stringify({ orderedIds }) });
}

export function listAdminOrders(): Promise<{ orders: AdminOrder[] }> {
  return request<{ orders: AdminOrder[] }>("/api/v1/admin/orders");
}

export function listAdmins(): Promise<{ admins: AdminUser[] }> {
  return request<{ admins: AdminUser[] }>("/api/v1/super-admin/admins");
}

export function createAdmin(input: { email: string; password: string; role: "ADMIN" | "SUPER_ADMIN"; actorPassword: string }): Promise<{ admin: AdminUser }> {
  return request<{ admin: AdminUser }>("/api/v1/super-admin/admins", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Suspends (disabled=true) or re-enables (disabled=false) an admin account. Requires the acting Super Admin's own current password to confirm — see admin.service.ts's reauthenticate(). */
export function setAdminDisabled(id: string, disabled: boolean, actorPassword: string): Promise<{ admin: AdminUser }> {
  return request<{ admin: AdminUser }>(`/api/v1/super-admin/admins/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ disabled, actorPassword }),
  });
}

/** Promotes or demotes an admin between ADMIN and SUPER_ADMIN. Requires the acting Super Admin's own current password to confirm. */
export function changeAdminRole(id: string, role: "ADMIN" | "SUPER_ADMIN", actorPassword: string): Promise<{ admin: AdminUser }> {
  return request<{ admin: AdminUser }>(`/api/v1/super-admin/admins/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ role, actorPassword }),
  });
}

export interface AdminGrant {
  permissionCode: string;
  grantedAt: string;
  grantedBy: string | null;
}

export interface AdminPermissions {
  admin: { id: string; email: string | null; role: string; disabled: boolean; createdAt: string };
  grants: AdminGrant[];
}

/** Super Admin-only. Returns an admin's per-admin permission grants (overlay on top of the role matrix from rbac.ts). */
export function getAdminPermissions(id: string): Promise<AdminPermissions> {
  return request<AdminPermissions>(`/api/v1/super-admin/admins/${encodeURIComponent(id)}/permissions`);
}

/** Super Admin-only. Replaces an Admin's whole per-admin grant set. Requires the acting Super Admin's own current password to confirm. */
export function setAdminPermissions(id: string, permissions: string[], actorPassword: string): Promise<{ admin: AdminUser }> {
  return request<{ admin: AdminUser }>(`/api/v1/super-admin/admins/${encodeURIComponent(id)}/permissions`, {
    method: "PUT",
    body: JSON.stringify({ permissions, actorPassword }),
  });
}

export interface ActivityLog {
  id: string;
  actorId: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export function listActivityLogs(limit = 100): Promise<{ events: ActivityLog[] }> {
  return request<{ events: ActivityLog[] }>(`/api/v1/admin/activity-logs?limit=${limit}`);
}

export interface RbacPermissionInfo {
  code: string;
  description: string;
}

export interface RbacRoleMember {
  id: string;
  email: string | null;
  disabled: boolean;
}

export interface RbacRoleInfo {
  role: "CUSTOMER" | "ADMIN" | "SUPER_ADMIN";
  label: string;
  description: string;
  admin: boolean;
  permissions: string[];
  members: RbacRoleMember[];
}

/** Super Admin-only. Serves the enforced RBAC matrix (permissions + role membership) for the Roles & Permissions screen. */
export function getRbac(): Promise<{ permissions: RbacPermissionInfo[]; roles: RbacRoleInfo[] }> {
  return request<{ permissions: RbacPermissionInfo[]; roles: RbacRoleInfo[] }>("/api/v1/admin/rbac");
}

export interface AdminUser {
  id: string;
  email: string | null;
  phoneNumber: string | null;
  role: "CUSTOMER" | "ADMIN" | "SUPER_ADMIN";
  disabled: boolean;
  createdAt: string;
  orderCount?: number;
  totalSpentCents?: number;
}

export function listAdminUsers(): Promise<{ users: AdminUser[]; total: number; page: number; pageSize: number }> {
  // pageSize=100 (the server's max) as a stopgap so existing behavior is
  // unchanged for any realistic current customer count — see
  // api/docs/PERFORMANCE.md for why this endpoint was paginated at all,
  // and that real pagination UI (page controls in the admin table) is a
  // follow-up not built here; this only prevents an unbounded payload for
  // a customer base that grows past 100.
  return request<{ users: AdminUser[]; total: number; page: number; pageSize: number }>("/api/v1/admin/users?pageSize=100");
}

export interface AdminStats {
  totals: {
    users: number;
    admins: number;
    customers: number;
    products: number;
    categories: number;
    brands: number;
    orders: number;
    revenueCents: number;
    revenueTzs: number;
    customerSpendCents: number;
    variants: number;
  };
  orderStatusCounts: Record<string, number>;
  recentOrders: AdminOrder[];
  recentEvents: ActivityLog[];
  topCustomers: { id: string; email: string; role: string; orderCount: number; totalSpentCents: number }[];
}

export function getAdminStats(): Promise<AdminStats> {
  return request<AdminStats>("/api/v1/admin/stats");
}

// ---- Auth ----

export interface PublicUser {
  id: string;
  email: string | null;
  phoneNumber: string | null;
  fullName: string | null;
  role: "CUSTOMER" | "ADMIN" | "SUPER_ADMIN";
  emailVerified: boolean;
  mfaEnabled: boolean;
  createdAt: string;
}

// login() can return one of two shapes: either a completed session (same
// as before), or a { mfaRequired: true, mfaToken } challenge that the
// caller must resolve via mfaVerifyLogin() before any session exists.
export type LoginResult =
  | { mfaRequired: false; user: PublicUser }
  | { mfaRequired: true; mfaToken: string };

export function login(phoneNumber: string, password: string): Promise<LoginResult> {
  return request<{ mfaRequired: boolean; user?: PublicUser; mfaToken?: string; accessTokenTtlSeconds?: number }>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ phoneNumber, password }),
  }).then((r) => {
    if (r.mfaRequired) return { mfaRequired: true as const, mfaToken: r.mfaToken! };
    refreshPossible = true;
    return { mfaRequired: false as const, user: r.user! };
  });
}

export function mfaVerifyLogin(mfaToken: string, code: string): Promise<{ user: PublicUser }> {
  return request<{ user: PublicUser; accessTokenTtlSeconds?: number }>("/api/v1/auth/mfa/verify-login", {
    method: "POST",
    body: JSON.stringify({ mfaToken, code }),
  });
}

export function mfaSetup(): Promise<{ secret: string; otpauthUri: string }> {
  return request<{ secret: string; otpauthUri: string }>("/api/v1/auth/mfa/setup", { method: "POST" });
}

export function mfaEnable(code: string): Promise<{ recoveryCodes: string[] }> {
  return request<{ recoveryCodes: string[] }>("/api/v1/auth/mfa/enable", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export function mfaDisable(password: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>("/api/v1/auth/mfa/disable", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export function requestPasswordReset(email: string): Promise<{ success: boolean; message: string }> {
  return request<{ success: boolean; message: string }>("/api/v1/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function resetPassword(token: string, password: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>("/api/v1/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, password }),
  });
}

// ---- Wishlist (server-backed, authenticated users only — see lib/wishlist.ts for the guest/localStorage + merge-on-login layer built on top of these) ----

export interface WishlistEntry {
  id: string;
  product: Product;
}

export function listWishlist(): Promise<{ wishlist: WishlistEntry[] }> {
  return request<{ wishlist: WishlistEntry[] }>("/api/v1/wishlist");
}

export function addToWishlistServer(productId: string): Promise<{ wishlist: WishlistEntry[] }> {
  return request<{ wishlist: WishlistEntry[] }>("/api/v1/wishlist", {
    method: "POST",
    body: JSON.stringify({ productId }),
  });
}

export function removeFromWishlistServer(productId: string): Promise<{ wishlist: WishlistEntry[] }> {
  return request<{ wishlist: WishlistEntry[] }>(`/api/v1/wishlist/${productId}`, { method: "DELETE" });
}

export function register(phoneNumber: string, password: string, fullName?: string | null): Promise<{ user: PublicUser }> {
  return request<{ user: PublicUser; accessTokenTtlSeconds?: number }>("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({ phoneNumber, password, fullName: fullName?.trim() || undefined }),
  }).then((r) => {
    refreshPossible = true;
    return r;
  });
}

export function logout(): Promise<{ success: boolean }> {
  return request<{ success: boolean }>("/api/v1/auth/logout", { method: "POST" });
}

export function me(): Promise<{ user: PublicUser }> {
  return request<{ user: PublicUser; accessTokenTtlSeconds?: number }>("/api/v1/auth/me");
}

export function verifyEmail(token: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>("/api/v1/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export function resendVerification(): Promise<{ success: boolean }> {
  return request<{ success: boolean }>("/api/v1/auth/resend-verification", { method: "POST" });
}

// ---- Cart ----

export interface CartItem {
  id: string;
  quantity: number;
  // populated by the backend serializer
  product?: { name: string; slug: string; priceCents: number; image?: string | null } | null;
  variant?: { id: string; size: string; color: string; inStock?: boolean } | null;
  lineTotalCents?: number;
  /** False if the product has gone inactive or the variant is out of stock since this was added to cart — the backend's authoritative check at order creation will reject it regardless; this lets the UI warn before checkout instead of after. */
  available?: boolean;
  /** True when the variant still has stock but less than this line's quantity. */
  insufficientStock?: boolean;
}

export interface Cart {
  items: CartItem[];
  subtotalCents?: number;
  itemCount?: number;
}

export function getCart(): Promise<{ cart: Cart }> {
  return request<{ cart: Cart }>("/api/v1/cart");
}

export function addToCart(variantId: string, quantity: number): Promise<{ cart: Cart }> {
  return request<{ cart: Cart }>("/api/v1/cart/items", {
    method: "POST",
    body: JSON.stringify({ variantId, quantity }),
  });
}

/** "Buy it now" item snapshot — the exact item a customer clicked straight
 *  through to checkout with. Mirrors the cart serializer's shape so the
 *  checkout summary renders it identically. Never mutates the cart. */
export function getBuyNowItems(variantId: string, quantity: number): Promise<{ cart: Cart }> {
  return request<{ cart: Cart }>("/api/v1/checkout/direct", {
    method: "POST",
    body: JSON.stringify({ variantId, quantity }),
  });
}

export function updateCartItemQuantity(itemId: string, quantity: number): Promise<{ cart: Cart }> {
  return request<{ cart: Cart }>(`/api/v1/cart/items/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    body: JSON.stringify({ quantity }),
  });
}

export function removeCartItem(itemId: string): Promise<{ cart: Cart }> {
  return request<{ cart: Cart }>(`/api/v1/cart/items/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
  });
}

// ---- Orders / Checkout ----

export interface ShippingAddressInput {
  label?: string;
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode?: string;
  country: string;
  phone?: string;
}

export interface OrderItem {
  productId: string;
  variantId: string;
  nameSnapshot: string;
  brandSnapshot: string;
  size: string;
  color: string;
  unitPriceCentsSnapshot: number;
  quantity: number;
  lineTotalCents: number;
}

export interface Order {
  id: string;
  status: "PENDING" | "PAID" | "SHIPPED" | "DELIVERED" | "CANCELLED";
  items: OrderItem[];
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  totalCents: number;
  paymentMethodKind?: "CASH" | "ONLINE" | null;
  paymentMethodName?: string | null;
  paymentNumber?: string | null;
  transportFeeCents?: number | null;
  transportFeeTzs?: number | null;
  totalTzs?: number | null;
  transportPaymentNumber?: string | null;
  transportPaymentName?: string | null;
  deliveryLocation?: "dar_es_salaam" | "outside_dar" | null;
  createdAt: string;
}

/** Creates an order — either from the caller's cart (default), or, when
 *  `items` is passed, from EXACTLY those items (the "buy it now" flow) —
 *  in which case the customer's cart is left untouched. Requires an
 *  idempotency key. For Cash on Delivery, `transportPaymentNumber`
 *  identifies the active online network the customer pays the transport
 *  fee through. */
export function createOrder(
  shippingAddress: ShippingAddressInput,
  paymentMethodId: string,
  idempotencyKey: string,
  transportPaymentNumber: string | null | undefined,
  deliveryLocation: "dar_es_salaam" | "outside_dar",
  items?: { variantId: string; quantity: number }[],
  couponCode?: string | null
): Promise<{ order: Order }> {
  const body: Record<string, unknown> = { shippingAddress, paymentMethodId, transportPaymentNumber, deliveryLocation };
  if (items && items.length > 0) body.items = items;
  if (couponCode) body.couponCode = couponCode;
  return request<{ order: Order }>("/api/v1/orders", {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey },
    body: JSON.stringify(body),
  });
}

/** The signed-in customer's own order history (newest first). */
export function listOrders(): Promise<{ orders: Order[] }> {
  return request<{ orders: Order[] }>("/api/v1/orders");
}

export function getOrder(id: string): Promise<{ order: Order }> {
  return request<{ order: Order }>(`/api/v1/orders/${encodeURIComponent(id)}`);
}

export function getAdminOrder(id: string): Promise<{ order: Order }> {
  return request<{ order: Order }>(`/api/v1/admin/orders/${encodeURIComponent(id)}`);
}

export interface Address {
  id: string;
  label: string;
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  phone?: string;
  isDefault: boolean;
}

export function listAddresses(): Promise<{ addresses: Address[] }> {
  return request<{ addresses: Address[] }>("/api/v1/addresses");
}

export function createAddress(input: Omit<Address, "id" | "isDefault"> & { isDefault?: boolean }): Promise<{ address: Address }> {
  return request<{ address: Address }>("/api/v1/addresses", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateAddress(id: string, patch: Partial<Omit<Address, "id" | "isDefault">>): Promise<{ address: Address }> {
  return request<{ address: Address }>(`/api/v1/addresses/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteAddress(id: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/api/v1/addresses/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function setDefaultAddress(id: string): Promise<{ address: Address }> {
  return request<{ address: Address }>(`/api/v1/addresses/${encodeURIComponent(id)}/default`, { method: "PUT" });
}

export function updateMyProfile(patch: { fullName?: string; phoneNumber?: string }): Promise<{ user: PublicUser }> {
  return request<{ user: PublicUser }>("/api/v1/me", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function changeMyPassword(currentPassword: string, newPassword: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>("/api/v1/me/password", {
    method: "PATCH",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

// ---- Payment methods (storefront + Super Admin) ----

export type PaymentMethodKind = "CASH" | "ONLINE";

/** Shape returned by the public storefront endpoint (active methods only).
 *  `feeTzs` is the exact Cash transport fee in TZS; `feeCents` holds the
 *  same TZS value (kept in sync for backward compatibility with order
 *  arithmetic CHECKs). */
export interface PaymentMethod {
  id: string;
  kind: PaymentMethodKind;
  name: string;
  paymentNumber: string | null;
  feeCents: number;
  feeTzs: number;
  isActive: boolean;
  displayOrder: number;
  iconUrl: string | null;
  instructions: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Active payment methods offered at checkout (public). */
export function listPaymentMethods(): Promise<{ methods: PaymentMethod[] }> {
  return request<{ methods: PaymentMethod[] }>("/api/v1/payment-methods");
}

export function listAdminPaymentMethods(): Promise<{ methods: PaymentMethod[] }> {
  return request<{ methods: PaymentMethod[] }>("/api/v1/admin/payment-methods");
}

export function createAdminPaymentMethod(input: {
  kind: PaymentMethodKind;
  name: string;
  paymentNumber?: string | null;
  feeCents?: number;
  feeTzs?: number;
  isActive?: boolean;
  displayOrder?: number;
  instructions?: string | null;
}): Promise<{ method: PaymentMethod }> {
  return request<{ method: PaymentMethod }>("/api/v1/admin/payment-methods", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateAdminPaymentMethod(
  id: string,
  patch: Partial<{ name: string; paymentNumber: string | null; feeCents: number; feeTzs: number; isActive: boolean; instructions: string | null }>
): Promise<{ method: PaymentMethod }> {
  return request<{ method: PaymentMethod }>(`/api/v1/admin/payment-methods/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteAdminPaymentMethod(id: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/api/v1/admin/payment-methods/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function uploadPaymentMethodIcon(id: string, file: File): Promise<{ method: PaymentMethod }> {
  const formData = new FormData();
  formData.append("file", file);
  return request<{ method: PaymentMethod }>(`/api/v1/admin/payment-methods/${encodeURIComponent(id)}/icon`, { method: "POST", body: formData });
}

export function removePaymentMethodIcon(id: string): Promise<{ method: PaymentMethod }> {
  return request<{ method: PaymentMethod }>(`/api/v1/admin/payment-methods/${encodeURIComponent(id)}/icon`, { method: "DELETE" });
}

export function reorderAdminPaymentMethods(orderedIds: string[]): Promise<{ methods: PaymentMethod[] }> {
  return request<{ methods: PaymentMethod[] }>("/api/v1/admin/payment-methods/reorder", {
    method: "PUT",
    body: JSON.stringify({ orderedIds }),
  });
}
