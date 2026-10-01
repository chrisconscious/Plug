import { describe, it, expect } from "vitest";
import { correctWords, editDistance } from "./search.service";
import { normalizeKeywords } from "./catalog.service";
import { normalizeSearchPhrase, searchWords } from "../db/repos/product-filter.repo";
import { ValidationError } from "../errors";

describe("searchWords / normalizeSearchPhrase", () => {
  it("lowercases, collapses spaces and keeps only letters/digits (no tsquery operators get through)", () => {
    expect(normalizeSearchPhrase("  Black   NIKE  shoes ")).toBe("black nike shoes");
    expect(searchWords("black & nike | !shoes:*")).toEqual(["black", "nike", "shoes"]);
    expect(searchWords("T-Shirt")).toEqual(["t", "shirt"]);
  });

  it("drops filler words unless they are the whole query", () => {
    expect(searchWords("sneakers for men")).toEqual(["sneakers", "men"]);
    expect(searchWords("the")).toEqual(["the"]);
  });

  it("caps the input length and the number of words", () => {
    expect(normalizeSearchPhrase("x".repeat(500)).length).toBe(100);
    expect(searchWords("a1 b2 c3 d4 e5 f6 g7 h8 i9 j10")).toHaveLength(8);
    expect(searchWords("!!! ::")).toEqual([]);
  });
});

describe("typo correction", () => {
  const vocab = [
    { word: "sneakers", ndoc: 5 },
    { word: "aurum", ndoc: 1 },
    { word: "t-shirt", ndoc: 3 },
    { word: "shirts", ndoc: 2 },
    { word: "shorts", ndoc: 1 },
  ];

  it("measures edits including adjacent swaps", () => {
    expect(editDistance("snekaers", "sneakers")).toBe(1);
    expect(editDistance("aurrum", "aurum")).toBe(1);
    expect(editDistance("abc", "xyz", 2)).toBe(3);
  });

  it("corrects only words the catalog doesn't contain", () => {
    expect(correctWords(["snekers"], vocab)).toEqual(["sneakers"]);
    expect(correctWords(["tshirt"], vocab)).toEqual(["t-shirt"]);
    expect(correctWords(["aurrum", "sneakers"], vocab)).toEqual(["aurum", "sneakers"]);
    // already a (prefix of a) real word, or too short to guess at -> untouched
    expect(correctWords(["sneak"], vocab)).toBeNull();
    expect(correctWords(["xyz"], vocab)).toBeNull();
  });

  it("prefers the closest, then the most used word", () => {
    expect(correctWords(["shirtz"], vocab)).toEqual(["shirts"]);
  });
});

describe("normalizeKeywords (admin Keyword field)", () => {
  it("trims, lowercases, single-spaces, splits commas and de-duplicates", () => {
    expect(normalizeKeywords(["Black  Sneakers, running shoes", " black sneakers ", "", "Gym Shoes"])).toEqual([
      "black sneakers",
      "running shoes",
      "gym shoes",
    ]);
  });

  it("rejects over-long keywords and too many keywords instead of silently cutting them", () => {
    expect(() => normalizeKeywords(["x".repeat(61)])).toThrow(ValidationError);
    expect(() => normalizeKeywords(Array.from({ length: 31 }, (_, i) => `kw${i}`))).toThrow(ValidationError);
  });
});
