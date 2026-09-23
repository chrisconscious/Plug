// Tanzanian Shillings (TZS) currency formatting for the storefront.
// All monetary values in the system are stored and displayed as whole TZS.

/** Format a whole-TZS amount with thousands separators, e.g. 348300 -> "TZS 348,300". */
export function formatTZS(amount: number): string {
  if (!Number.isFinite(amount)) amount = 0;
  return "TZS " + Math.round(amount).toLocaleString("en-US");
}
