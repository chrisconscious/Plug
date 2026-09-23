/**
 * Storefront listing helpers. Pure, dependency-free utilities used by the
 * product listing page (and its filter sidebar / mobile sheet) to keep the
 * presentation layer small and readable.
 */
import type { CategoryFacet, FacetValue } from "./api";

/**
 * The full set of storefront filters, decoupled from the URL so the listing
 * page can treat the URL as its single source of truth and map one-to-one to
 * a composable, serializable object.
 */
export interface ShopFilters {
  brand: string[];
  category: string | null;
  subcategory: string | null;
  size: string[];
  color: string[];
  minPrice: number | null;
  maxPrice: number | null;
  gender: string | null;
  sale: boolean;
  collection: string | null;
  availability: string | null;
  /** Selected attribute option ids (e.g. Fit=Baggy) — see api.ts's AttributeGroup/AttributeOption and product-filter.repo.ts's within-group-OR/across-group-AND semantics. */
  attr: string[];
}

export const EMPTY_FILTERS: ShopFilters = {
  brand: [],
  category: null,
  subcategory: null,
  size: [],
  color: [],
  minPrice: null,
  maxPrice: null,
  gender: null,
  sale: false,
  collection: null,
  availability: null,
  attr: [],
};

export function filtersToParams(f: ShopFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.brand.length) p.set("brand", f.brand.join(","));
  if (f.category) p.set("category", f.category);
  if (f.subcategory) p.set("subcategory", f.subcategory);
  if (f.size.length) p.set("size", f.size.join(","));
  if (f.color.length) p.set("color", f.color.join(","));
  if (f.minPrice != null) p.set("minPrice", String(f.minPrice));
  if (f.maxPrice != null) p.set("maxPrice", String(f.maxPrice));
  if (f.gender) p.set("gender", f.gender);
  if (f.sale) p.set("sale", "true");
  if (f.collection) p.set("collection", f.collection);
  if (f.availability) p.set("availability", f.availability);
  if (f.attr.length) p.set("attr", f.attr.join(","));
  return p;
}

export function paramsToFilters(sp: URLSearchParams): ShopFilters {
  const split = (v: string | null) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);
  const num = (v: string | null) => (v && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null);
  return {
    brand: split(sp.get("brand")),
    category: sp.get("category"),
    subcategory: sp.get("subcategory") === "" ? null : sp.get("subcategory"),
    size: split(sp.get("size")),
    color: split(sp.get("color")),
    minPrice: num(sp.get("minPrice")),
    maxPrice: num(sp.get("maxPrice")),
    gender: sp.get("gender"),
    sale: sp.get("sale") === "true",
    collection: sp.get("collection"),
    availability: sp.get("availability") === "in_stock" || sp.get("availability") === "out_of_stock" ? sp.get("availability") : null,
    attr: split(sp.get("attr")),
  };
}

/** True when no filter is active (except sort/paging). */
export function isFiltering(f: ShopFilters): boolean {
  return (
    f.brand.length > 0 ||
    !!f.category ||
    !!f.subcategory ||
    f.size.length > 0 ||
    f.color.length > 0 ||
    f.minPrice != null ||
    f.maxPrice != null ||
    !!f.gender ||
    f.sale ||
    !!f.collection ||
    !!f.availability ||
    f.attr.length > 0
  );
}

export const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "recommended", label: "Recommended" },
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Price: Low to High" },
  { value: "price_desc", label: "Price: High to Low" },
];

const COLOR_HEX: Record<string, string> = {
  black: "#151515",
  white: "#f5f5f5",
  navy: "#1f2a44",
  grey: "#9a9a9a",
  gray: "#9a9a9a",
  blue: "#2f4f8f",
  cream: "#f3e9d2",
  beige: "#dcc9a3",
  red: "#a62828",
  charcoal: "#3a3a3a",
  silver: "#c0c0c0",
  tan: "#c8a97a",
  olive: "#6b6e45",
  brown: "#6b4a2f",
  nude: "#e0b9a0",
  rose: "#d8a0a0",
  burgundy: "#6e1f2f",
  khaki: "#9c8a5a",
  green: "#4f6e41",
  pink: "#e5a8b8",
  gold: "#c9a53c",
  cognac: "#9a3b1b",
  yellow: "#e3c84b",
  orange: "#d96a2f",
  purple: "#6a3a6a",
  camel: "#b98a5a",
  ivory: "#f6f2e8",
};

/**
 * Resolves a color name to a swatch hex. Unknown names get a neutral swatch
 * (the letter rendered) so the facet is never empty.
 */
export function colorHex(name: string): string {
  return COLOR_HEX[name.toLowerCase()] ?? "transparent";
}

export function isKnownColor(name: string): boolean {
  return name.toLowerCase() in COLOR_HEX;
}

/**
 * Detects whether a size facet holds numeric (shoe) sizes vs letter (apparel)
 * sizes by inspecting the actual distinct values — never a hardcoded map.
 */
export function isNumericSizeSet(sizes: string[]): boolean {
  if (sizes.length === 0) return false;
  const count = sizes.filter((s) => /^\d+(\.\d+)?$/.test(s.trim())).length;
  return count / sizes.length > 0.5;
}

export interface CategoryGroup {
  parent: CategoryFacet;
  children: { name: string; slug: string; count: number; active: boolean }[];
}

/**
 * Groups flat category facets into a parent -> children tree using parentId, and
 * computes a synthesized parent count (parent + its descendants) for the sidebar.
 */
export function groupCategories(facets: CategoryFacet[]): CategoryGroup[] {
  const bySlug = new Map(facets.map((c) => [c.slug, c]));
  const children = new Map<string, CategoryFacet[]>();
  const parents: CategoryFacet[] = [];
  for (const c of facets) {
    if (c.parentId) {
      const list = children.get(c.parentId) ?? [];
      list.push(c);
      children.set(c.parentId, list);
    } else {
      parents.push(c);
    }
  }
  return parents.map((parent) => {
    const kids = children.get(parent.slug) ?? [];
    const childTotal = kids.reduce((s, k) => s + k.count, 0);
    return {
      parent: { ...parent, count: parent.count + childTotal },
      children: kids.map((k) => ({ name: k.name, slug: k.slug, count: k.count, active: false })),
    };
  });
}

/** Orders a size facet naturally: numeric ascending, then letters, "One Size" last. */
export function sortSizeValues(tags: FacetValue[]): string[] {
  const numeric: string[] = [];
  const alpha: string[] = [];
  const other: string[] = [];
  for (const t of tags) {
    if (/^\d+(\.\d+)?$/.test(t.value.trim())) numeric.push(t.value);
    else if (/^\d+$/.test(t.value.trim())) numeric.push(t.value);
    else if (/^[A-Za-z]+$/.test(t.value)) alpha.push(t.value);
    else other.push(t.value);
  }
  numeric.sort((a, b) => parseFloat(a) - parseFloat(b));
  alpha.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const precedence = ["XS", "S", "M", "L", "XL", "XXL"];
  alpha.sort((a, b) => {
    const ia = precedence.indexOf(a.toUpperCase());
    const ib = precedence.indexOf(b.toUpperCase());
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return [...numeric, ...alpha, ...other.filter((x) => x.toLowerCase() !== "one size"), ...other.filter((x) => x.toLowerCase() === "one size")];
}

/** Sorts plain size labels (e.g. variant sizes) using the same natural order as the shop filters. */
export function sortSizeStrings(sizes: string[]): string[] {
  return sortSizeValues(sizes.map((s) => ({ value: s, count: 0 })));
}
