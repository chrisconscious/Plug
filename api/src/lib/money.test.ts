import { describe, it, expect } from "vitest";
import { cents, addCents, multiplyCents, applyPercentDiscount, formatCents } from "./money";

describe("cents", () => {
  it("accepts integer values", () => {
    expect(cents(500)).toBe(500);
    expect(cents(0)).toBe(0);
    expect(cents(-100)).toBe(-100); // negative allowed (e.g. a refund/adjustment line)
  });

  it("rejects non-integer (floating point) values — this is the whole point of the module", () => {
    expect(() => cents(19.99)).toThrow("whole integers");
    expect(() => cents(0.1)).toThrow();
  });
});

describe("addCents", () => {
  it("sums multiple amounts", () => {
    expect(addCents(cents(100), cents(250), cents(50))).toBe(400);
  });

  it("returns 0 for no arguments", () => {
    expect(addCents()).toBe(0);
  });

  it("handles negative amounts (refunds/discounts as negative lines)", () => {
    expect(addCents(cents(1000), cents(-300))).toBe(700);
  });

  it("a product subtotal plus a transport fee produces the expected order total (the exact scenario docs/ARCHITECTURE.md's money-model note calls out)", () => {
    expect(addCents(cents(10000), cents(600))).toBe(10600);
  });
});

describe("multiplyCents", () => {
  it("multiplies a unit price by quantity", () => {
    expect(multiplyCents(cents(500), 3)).toBe(1500);
  });

  it("returns 0 for quantity 0", () => {
    expect(multiplyCents(cents(500), 0)).toBe(0);
  });

  it("rejects a negative quantity", () => {
    expect(() => multiplyCents(cents(500), -1)).toThrow("non-negative integer");
  });

  it("rejects a non-integer quantity", () => {
    expect(() => multiplyCents(cents(500), 1.5)).toThrow("non-negative integer");
  });
});

describe("applyPercentDiscount", () => {
  it("applies a clean percentage correctly", () => {
    expect(applyPercentDiscount(cents(1000), 25)).toBe(750);
  });

  it("rounds DOWN on a non-exact discount — never in the customer's favor by accident (per the function's own doc comment)", () => {
    // 999 * 0.67 = 669.33 -> floors to 669, not 670
    expect(applyPercentDiscount(cents(999), 33)).toBe(669);
  });

  it("0% off returns the original amount unchanged", () => {
    expect(applyPercentDiscount(cents(100), 0)).toBe(100);
  });

  it("100% off returns 0", () => {
    expect(applyPercentDiscount(cents(100), 100)).toBe(0);
  });

  it("rejects a percentage below 0", () => {
    expect(() => applyPercentDiscount(cents(100), -1)).toThrow("between 0 and 100");
  });

  it("rejects a percentage above 100", () => {
    expect(() => applyPercentDiscount(cents(100), 101)).toThrow("between 0 and 100");
  });
});

describe("formatCents", () => {
  const NBSP = "\u00A0";

  it("formats a whole TZS amount", () => {
    expect(formatCents(cents(150000))).toBe(`TZS${NBSP}150,000`);
  });

  it("formats zero", () => {
    expect(formatCents(cents(0))).toBe(`TZS${NBSP}0`);
  });

  it("formats a small amount", () => {
    expect(formatCents(cents(99))).toBe(`TZS${NBSP}99`);
  });

  it("formats a negative amount", () => {
    expect(formatCents(cents(-500))).toBe(`-TZS${NBSP}500`);
  });
});
