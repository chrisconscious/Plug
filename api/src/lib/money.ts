/**
 * Money is ALWAYS represented as whole integer amounts (TZS) once it leaves
 * this module. Never use floating-point arithmetic for prices/totals — see
 * docs/SECURITY.md and docs/ARCHITECTURE.md for why.
 *
 * All amounts the client sends (e.g. a "price" in a cart mutation) are
 * IGNORED for money calculations; the server always recomputes totals from
 * its own product/price data. See order.service.ts.
 */

export type Cents = number & { readonly __brand: "Cents" };

export function cents(value: number): Cents {
  if (!Number.isInteger(value)) {
    throw new Error("Money amounts must be whole integers, not floating point.");
  }
  return value as Cents;
}

export function addCents(...values: Cents[]): Cents {
  return cents(values.reduce((sum, v) => sum + v, 0));
}

export function multiplyCents(unitPrice: Cents, quantity: number): Cents {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new Error("Quantity must be a non-negative integer.");
  }
  return cents(unitPrice * quantity);
}

/** Applies a percentage discount (0-100), rounding down (never round in the customer's favor by accident, be consistent). */
export function applyPercentDiscount(amount: Cents, percentOff: number): Cents {
  if (percentOff < 0 || percentOff > 100) throw new Error("percentOff must be between 0 and 100.");
  return cents(Math.floor((amount * (100 - percentOff)) / 100));
}

export function formatCents(amount: Cents, currency = "TZS"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}
