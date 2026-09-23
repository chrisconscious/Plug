/**
 * Single source of truth for every storefront navigation URL.
 *
 * No component should hand-build a URL string inline. Routing everything
 * through these helpers is what prevents "fixed in one place, still broken
 * in three others" — every nav item, product card, brand/category/collection
 * tile and advertisement CTA resolves a destination here.
 *
 * All destinations are real: the backend resolves gender / category / brand /
 * collection / sale / search and only ever returns products matching that
 * context (see product-filter.repo.ts). A URL produced here is never a dead
 * link or a param the backend silently ignores.
 */

/** Shop All — explicitly the empty filter context (nothing inherited). */
export function getShopAllUrl(): string {
  return "/shop";
}

export function getWomenUrl(): string {
  return "/shop?gender=women";
}

export function getMenUrl(): string {
  return "/shop?gender=men";
}

/** A category listing by its real database slug (e.g. "dresses"), not its label. */
export function getCategoryUrl(categorySlug: string): string {
  return `/shop?category=${encodeURIComponent(categorySlug)}`;
}

/** A category tile within a gender audience context (e.g. Men → Shoes → /shop?gender=men&category=shoes). */
export function getGenderCategoryUrl(gender: string, categorySlug: string): string {
  return `/shop?gender=${encodeURIComponent(gender)}&category=${encodeURIComponent(categorySlug)}`;
}

/** Brand context lives on its own route so the listing engine can render a brand hero. */
export function getBrandUrl(brandSlug: string): string {
  return `/brands/${encodeURIComponent(brandSlug)}`;
}

/** A category within a brand context — the brand's "Shop by Category" showcase links here. */
export function getBrandCategoryUrl(brandSlug: string, categorySlug: string): string {
  return `/brands/${encodeURIComponent(brandSlug)}?category=${encodeURIComponent(categorySlug)}`;
}

/** Collection context via the product tag (e.g. "new", "trending", "premium", "campus"). */
export function getCollectionUrl(collectionSlug: string): string {
  return `/shop?collection=${encodeURIComponent(collectionSlug)}`;
}

/** A lifestyle page by its real database slug (migration 0019), e.g. "campus-life". */
export function getLifestyleUrl(lifestyleSlug: string): string {
  return `/lifestyle/${encodeURIComponent(lifestyleSlug)}`;
}

/** A category within a lifestyle context — the "Shop by Category" showcase links here. */
export function getLifestyleCategoryUrl(lifestyleSlug: string, categorySlug: string): string {
  return `/lifestyle/${encodeURIComponent(lifestyleSlug)}?category=${encodeURIComponent(categorySlug)}`;
}

export function getSaleUrl(): string {
  return "/shop?sale=true";
}

export function getSearchUrl(query: string): string {
  const q = query.trim();
  return q ? `/shop?q=${encodeURIComponent(q)}` : getShopAllUrl();
}

export function getProductUrl(productSlug: string): string {
  return `/product/${encodeURIComponent(productSlug)}`;
}
