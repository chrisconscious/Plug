import { describe, it, expect } from "vitest";
import { sortSizeStrings, isNumericSizeSet, colorHex, isKnownColor, isFiltering, EMPTY_FILTERS, filtersToParams, paramsToFilters } from "./shop";

describe("sortSizeStrings", () => {
  it("orders letter sizes by garment-size precedence, not alphabetically", () => {
    // Alphabetical would give L, M, S, XL, XS — precedence order is different:
    expect(sortSizeStrings(["M", "XS", "L", "S", "XL"])).toEqual(["XS", "S", "M", "L", "XL"]);
  });

  it("orders numeric (shoe) sizes ascending numerically, not as strings", () => {
    // String sort would give "10","7","8.5","9" — numeric sort must not do that:
    expect(sortSizeStrings(["10", "8.5", "9", "7"])).toEqual(["7", "8.5", "9", "10"]);
  });

  it("puts numeric sizes first, then letter sizes, then 'One Size' last", () => {
    expect(sortSizeStrings(["M", "6", "XL", "One Size", "S"])).toEqual(["6", "S", "M", "XL", "One Size"]);
  });

  it("handles a size not in the known precedence list by placing it after known sizes, ordered alphabetically among unknowns", () => {
    expect(sortSizeStrings(["Petite", "M", "Tall"])).toEqual(["M", "Petite", "Tall"]);
  });

  it("handles XXL correctly (end of the precedence list)", () => {
    expect(sortSizeStrings(["XXL", "XS"])).toEqual(["XS", "XXL"]);
  });

  it("returns an empty array for empty input", () => {
    expect(sortSizeStrings([])).toEqual([]);
  });
});

describe("isNumericSizeSet", () => {
  it("returns true when sizes are numeric", () => {
    expect(isNumericSizeSet(["6", "7", "8"])).toBe(true);
  });

  it("returns false when sizes are letters", () => {
    expect(isNumericSizeSet(["S", "M", "L"])).toBe(false);
  });

  it("returns false for an empty list rather than dividing by zero", () => {
    expect(isNumericSizeSet([])).toBe(false);
  });

  it("returns false at exactly 50/50 (threshold is a strict majority, not a tie)", () => {
    expect(isNumericSizeSet(["6", "M"])).toBe(false);
  });
});

describe("colorHex / isKnownColor", () => {
  it("resolves a known color case-insensitively", () => {
    expect(colorHex("Black")).toBe("#151515");
    expect(colorHex("BLACK")).toBe("#151515");
    expect(colorHex("black")).toBe("#151515");
  });

  it("returns transparent for an unknown color", () => {
    expect(colorHex("mauve-taupe-thing")).toBe("transparent");
  });

  it("isKnownColor matches colorHex's own notion of known", () => {
    expect(isKnownColor("navy")).toBe(true);
    expect(isKnownColor("mauve-taupe-thing")).toBe(false);
  });
});

describe("isFiltering", () => {
  it("returns false for the empty filter set", () => {
    expect(isFiltering(EMPTY_FILTERS)).toBe(false);
  });

  it("returns true when any single filter is set", () => {
    expect(isFiltering({ ...EMPTY_FILTERS, brand: ["nike"] })).toBe(true);
    expect(isFiltering({ ...EMPTY_FILTERS, sale: true })).toBe(true);
    expect(isFiltering({ ...EMPTY_FILTERS, minPrice: 0 })).toBe(true); // 0 is a real filter value, not "unset"
  });
});

describe("filtersToParams / paramsToFilters round-trip", () => {
  it("round-trips a fully-populated filter set through URLSearchParams", () => {
    const original = {
      ...EMPTY_FILTERS,
      brand: ["nike", "adidas"],
      category: "shoes",
      size: ["8", "9"],
      color: ["black"],
      minPrice: 1000,
      maxPrice: 5000,
      gender: "women",
      sale: true,
      collection: "new",
      availability: "in_stock",
    };
    const params = filtersToParams(original);
    const roundTripped = paramsToFilters(params);
    expect(roundTripped).toEqual(original);
  });

  it("round-trips the empty filter set back to itself", () => {
    const params = filtersToParams(EMPTY_FILTERS);
    expect(paramsToFilters(params)).toEqual(EMPTY_FILTERS);
  });

  it("ignores a negative minPrice from a tampered URL rather than accepting it", () => {
    const sp = new URLSearchParams("minPrice=-50");
    expect(paramsToFilters(sp).minPrice).toBeNull();
  });

  it("ignores an invalid availability value from a tampered URL", () => {
    const sp = new URLSearchParams("availability=delete-everything");
    expect(paramsToFilters(sp).availability).toBeNull();
  });
});
