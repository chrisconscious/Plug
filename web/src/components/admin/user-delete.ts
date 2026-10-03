import * as api from "../../lib/api";

/**
 * Asks to confirm, then for the acting admin's password, and deletes the
 * customer account. Resolves with the outcome, or null if cancelled.
 */
export async function confirmAndDeleteUser(u: { id: string; name: string; orderCount: number }): Promise<"deleted" | "anonymized" | null> {
  const history = u.orderCount > 0
    ? `\n\nThey have ${u.orderCount} order${u.orderCount === 1 ? "" : "s"}. Those orders are kept for your sales records; the account itself is closed and its name, email, phone, addresses, cart and wishlist are erased.`
    : "\n\nTheir account, addresses, cart and wishlist are removed.";
  if (!window.confirm(`Delete ${u.name}'s account?${history}\n\nThis can't be undone.`)) return null;
  const password = window.prompt("Enter your password to confirm deleting this account:");
  if (!password) return null;
  const r = await api.deleteAdminUser(u.id, password);
  return r.outcome;
}
