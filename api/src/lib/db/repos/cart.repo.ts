import { query, queryOne } from "../client";
import type { CartItem } from "../types";

type CartItemRow = { id: string; user_id: string; variant_id: string; quantity: number };
const toCartItem = (r: CartItemRow): CartItem => ({ id: r.id, userId: r.user_id, variantId: r.variant_id, quantity: r.quantity });

export async function listCartItems(userId: string): Promise<CartItem[]> {
  return (await query<CartItemRow>("SELECT * FROM cart_items WHERE user_id = $1", [userId])).map(toCartItem);
}

export async function findCartItemById(id: string): Promise<CartItem | null> {
  const row = await queryOne<CartItemRow>("SELECT * FROM cart_items WHERE id = $1", [id]);
  return row ? toCartItem(row) : null;
}

/**
 * Atomic upsert: "add to cart" for a variant already in the cart increments
 * quantity (capped at 20) in a single statement — no separate
 * SELECT-then-decide-INSERT-or-UPDATE round trip, and therefore no race
 * between two concurrent "add to cart" clicks for the same variant. This
 * relies on the `cart_items_unique_user_variant` UNIQUE constraint from
 * migration 0004.
 */
export async function upsertCartItem(userId: string, variantId: string, quantity: number): Promise<CartItem> {
  const row = await queryOne<CartItemRow>(
    `INSERT INTO cart_items (user_id, variant_id, quantity)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, variant_id)
     DO UPDATE SET quantity = LEAST(cart_items.quantity + EXCLUDED.quantity, 20)
     RETURNING *`,
    [userId, variantId, quantity]
  );
  return toCartItem(row!);
}

export async function updateCartItemQuantity(id: string, quantity: number): Promise<CartItem | null> {
  const row = await queryOne<CartItemRow>(
    "UPDATE cart_items SET quantity = $2 WHERE id = $1 RETURNING *",
    [id, quantity]
  );
  return row ? toCartItem(row) : null;
}

export async function deleteCartItem(id: string): Promise<void> {
  await query("DELETE FROM cart_items WHERE id = $1", [id]);
}
