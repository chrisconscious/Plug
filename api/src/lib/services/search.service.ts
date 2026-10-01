/**
 * Live product search for the storefront search panel (GET /api/v1/search).
 *
 * Built on the same matching as the /shop?q= listing (product-filter.repo's
 * buildProductWhere over the migration-0058 search document), so a product
 * suggested in the panel is always in "View all results" too. Everything
 * returned is real catalog data: live products only, public fields only.
 */
import * as catalogRepo from "../db/repos/catalog.repo";
import * as productFilterRepo from "../db/repos/product-filter.repo";
import type { FilterProductRow } from "../db/repos/product-filter.repo";
import { isSaleLive } from "./catalog.service";

export const DEFAULT_SUGGEST_LIMIT = 8;
export const MAX_SUGGEST_LIMIT = 12;
/** A product counts as "new" for this many days after it was first published. */
const NEW_FOR_DAYS = 14;

export type SearchProduct = {
  id: string;
  slug: string;
  name: string;
  url: string;
  brand: { name: string; slug: string } | null;
  category: { name: string; slug: string } | null;
  priceCents: number;
  compareAtPriceCents: number | null;
  onSale: boolean;
  discountPercent: number | null;
  image: { url: string; alt: string | null } | null;
  /** In-stock colours first, at most 4 (excludes the "Default" placeholder colour). */
  colors: string[];
  soldOut: boolean;
  isNew: boolean;
  badgeText: string | null;
};

export type SearchLink = { name: string; slug: string; count?: number; imageUrl?: string | null };

export type SearchResponse = {
  query: string;
  /** All words matched (true), or these are only "similar" any-word matches (false). */
  exact: boolean;
  /** Set when a typo was corrected ("snekers" -> "sneakers") and results come from the correction. */
  correctedQuery: string | null;
  /** Total products matching the (possibly corrected) query; 0 when only similar products are shown. */
  total: number;
  products: SearchProduct[];
  suggestions: string[];
  brands: SearchLink[];
  categories: SearchLink[];
};

export type SearchStartResponse = {
  popular: string[];
  brands: SearchLink[];
  categories: SearchLink[];
  newArrivals: SearchProduct[];
};

// ---- Vocabulary for typo correction (cached briefly; rebuilt on demand) ----
let vocabCache: { at: number; words: { word: string; ndoc: number }[] } | null = null;
const VOCAB_TTL_MS = 5 * 60_000;

async function vocabulary() {
  if (!vocabCache || Date.now() - vocabCache.at > VOCAB_TTL_MS) {
    vocabCache = { at: Date.now(), words: await productFilterRepo.searchVocabulary() };
  }
  return vocabCache.words;
}

/** Optimal-string-alignment distance (Levenshtein + adjacent swaps), capped for speed. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const at = (row: number[], j: number) => row[j] ?? 0;
  let prev2: number[] = [];
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(at(prev, j) + 1, at(cur, j - 1) + 1, at(prev, j - 1) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, at(prev2, j - 2) + 1);
      cur.push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return at(prev, b.length);
}

/**
 * Corrects words that match nothing in the catalog vocabulary to the closest
 * catalog word (1 edit for 4–5 letters, 2 for longer; short words are left
 * alone). Returns null when nothing needed or could be corrected.
 */
export function correctWords(words: string[], vocab: { word: string; ndoc: number }[]): string[] | null {
  let changed = false;
  const out = words.map((w) => {
    if (w.length < 4 || vocab.some((v) => v.word.startsWith(w))) return w;
    const max = w.length >= 6 ? 2 : 1;
    let best: { word: string; d: number; ndoc: number } | null = null;
    for (const v of vocab) {
      const d = editDistance(w, v.word, max);
      if (d <= max && (!best || d < best.d || (d === best.d && v.ndoc > best.ndoc))) best = { word: v.word, d, ndoc: v.ndoc };
    }
    if (!best) return w;
    changed = true;
    return best.word;
  });
  return changed ? out : null;
}

// ---- Projection -----------------------------------------------------------

async function toSearchProducts(rows: FilterProductRow[]): Promise<SearchProduct[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [brands, categories, variants, images, published] = await Promise.all([
    catalogRepo.listBrands(),
    catalogRepo.listCategories(),
    catalogRepo.listVariantsForProducts(ids),
    catalogRepo.listImagesForProducts(ids),
    productFilterRepo.publishedAtFor(ids),
  ]);
  const brandById = new Map(brands.map((b) => [b.id, b]));
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const newSince = Date.now() - NEW_FOR_DAYS * 86_400_000;

  return rows.map((p) => {
    const vs = variants.filter((v) => v.productId === p.id);
    const sale = isSaleLive(p.compare_at_price_cents, p.price_cents, catalogRepo.toDateOnly(p.offer_start_date), catalogRepo.toDateOnly(p.offer_end_date));
    const colorsInStock = [...new Set(vs.filter((v) => v.stockQty > 0).map((v) => v.color))];
    const colorsAll = [...new Set(vs.map((v) => v.color))];
    const colors = [...colorsInStock, ...colorsAll.filter((c) => !colorsInStock.includes(c))]
      .filter((c) => c && c.toLowerCase() !== "default")
      .slice(0, 4);
    const img = (images.get(p.id) ?? [])[0];
    const brand = brandById.get(p.brand_id);
    const category = categoryById.get(p.category_id);
    const publishedAt = published.get(p.id);
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      url: `/product/${encodeURIComponent(p.slug)}`,
      brand: brand ? { name: brand.name, slug: brand.slug } : null,
      category: category ? { name: category.name, slug: category.slug } : null,
      priceCents: p.price_cents,
      compareAtPriceCents: sale ? p.compare_at_price_cents : null,
      onSale: sale,
      discountPercent: sale && p.compare_at_price_cents
        ? Math.floor((100 * (p.compare_at_price_cents - p.price_cents)) / p.compare_at_price_cents)
        : null,
      image: img ? { url: img.url, alt: img.altText ?? null } : null,
      colors,
      soldOut: !vs.some((v) => v.stockQty > 0),
      isNew: !!publishedAt && new Date(publishedAt).getTime() >= newSince,
      badgeText: p.badge_text ?? null,
    };
  });
}

// ---- Public API -----------------------------------------------------------

/** The empty-input state: popular searches (most-used admin keywords), top brands/categories, newest products. */
export async function searchStart(): Promise<SearchStartResponse> {
  const [counts, brands, categories, newest] = await Promise.all([
    productFilterRepo.searchContextCounts({}),
    catalogRepo.listBrands(),
    catalogRepo.listCategories({ activeOnly: true }),
    productFilterRepo.listFilteredProducts({ sort: "newest", page: 1, pageSize: 4 }),
  ]);
  const brandById = new Map(brands.filter((b) => b.active).map((b) => [b.id, b]));
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const topCategories = counts.categories.flatMap((c) => {
    const cat = categoryById.get(c.id);
    return cat ? [{ name: cat.name, slug: cat.slug, count: c.count, imageUrl: cat.imageUrl ?? null }] : [];
  });
  // Popular searches: the keywords admins attached to the most live products;
  // with no keywords yet, the busiest category names (still real, still useful).
  const popular = counts.keywords.slice(0, 6).map((k) => k.value);
  for (const c of topCategories) {
    if (popular.length >= 6) break;
    const n = c.name.toLowerCase();
    if (!popular.includes(n)) popular.push(n);
  }
  return {
    popular,
    brands: counts.brands.flatMap((b) => {
      const br = brandById.get(b.id);
      return br ? [{ name: br.name, slug: br.slug, count: b.count, imageUrl: br.logo?.url ?? null }] : [];
    }).slice(0, 5),
    categories: topCategories.slice(0, 5),
    newArrivals: await toSearchProducts(newest.items),
  };
}

/** Live results for a typed query. */
export async function searchProducts(rawQuery: string, limit = DEFAULT_SUGGEST_LIMIT): Promise<SearchResponse> {
  const queryText = productFilterRepo.normalizeSearchPhrase(rawQuery);
  const size = Math.min(MAX_SUGGEST_LIMIT, Math.max(1, Math.floor(limit) || DEFAULT_SUGGEST_LIMIT));
  const empty: SearchResponse = { query: queryText, exact: true, correctedQuery: null, total: 0, products: [], suggestions: [], brands: [], categories: [] };
  let words = productFilterRepo.searchWords(queryText);
  if (words.length === 0) return empty;

  let effective = queryText;
  let correctedQuery: string | null = null;
  let page = await productFilterRepo.listFilteredProducts({ search: effective, sort: "relevance", page: 1, pageSize: size });

  if (page.total === 0) {
    const fixed = correctWords(words, await vocabulary());
    if (fixed) {
      const retry = fixed.join(" ");
      const second = await productFilterRepo.listFilteredProducts({ search: retry, sort: "relevance", page: 1, pageSize: size });
      if (second.total > 0) {
        page = second;
        effective = retry;
        correctedQuery = retry;
        words = productFilterRepo.searchWords(retry);
      }
    }
  }

  const [brands, categories] = await Promise.all([catalogRepo.listBrands(), catalogRepo.listCategories({ activeOnly: true })]);
  const brandById = new Map(brands.filter((b) => b.active).map((b) => [b.id, b]));
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  if (page.total === 0) {
    // Nothing matches every word: for a multi-word query offer products that
    // match some of the words, clearly flagged as "similar" (exact: false).
    const similar = words.length > 1 ? await productFilterRepo.listAnyWordProducts(words, size) : [];
    return { ...empty, exact: false, products: await toSearchProducts(similar) };
  }

  const counts = await productFilterRepo.searchContextCounts({ search: effective });
  const productsOut = await toSearchProducts(page.items);

  // Suggested searches — each one is a query that really returns products:
  // admin keywords containing every typed word, then "<colour> <query>" and
  // "<query> for men/women" from what the matching products actually have.
  const suggestions: string[] = [];
  const add = (s: string) => {
    const v = s.replace(/\s+/g, " ").trim().toLowerCase();
    if (v && v !== effective && !suggestions.includes(v) && suggestions.length < 6) suggestions.push(v);
  };
  const tokenStarts = (text: string, w: string) => text.split(/[^\p{L}\p{N}]+/u).some((t) => t.startsWith(w));
  for (const k of counts.keywords) if (words.every((w) => tokenStarts(k.value, w))) add(k.value);
  // Refinements only when they actually narrow the results (a colour every
  // match already has is not a useful suggestion).
  if (words.length <= 3 && page.total >= 2) {
    for (const c of counts.colors.slice(0, 3)) {
      if (!words.includes(c.value) && c.count > 0 && c.count < page.total) add(`${c.value} ${effective}`);
    }
    for (const a of counts.audiences) {
      if ((a.code === "men" || a.code === "women") && !words.includes(a.code) && a.count < page.total) add(`${effective} for ${a.code}`);
    }
  }

  return {
    query: queryText,
    exact: true,
    correctedQuery,
    total: page.total,
    products: productsOut,
    suggestions,
    brands: counts.brands.flatMap((b) => {
      const br = brandById.get(b.id);
      return br ? [{ name: br.name, slug: br.slug, count: b.count, imageUrl: br.logo?.url ?? null }] : [];
    }).slice(0, 4),
    categories: counts.categories.flatMap((c) => {
      const cat = categoryById.get(c.id);
      return cat ? [{ name: cat.name, slug: cat.slug, count: c.count, imageUrl: cat.imageUrl ?? null }] : [];
    }).slice(0, 4),
  };
}
