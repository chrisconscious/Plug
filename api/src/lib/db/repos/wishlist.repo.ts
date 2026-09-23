import { query, queryOne, isPgErrorCode, PG_ERROR_CODES } from "../client";
import { ConflictError } from "../../errors";
import type { WishlistItem } from "../types";

type WishlistRow = { id: string; user_id: string; product_id: string };
const toWishlistItem = (r: WishlistRow): WishlistItem => ({ id: r.id, userId: r.user_id, productId: r.product_id });

export async function listWishlistItems(userId: string): Promise<WishlistItem[]> {
  return (await query<WishlistRow>("SELECT * FROM wishlist_items WHERE user_id = $1", [userId])).map(toWishlistItem);
}

/** The reverse lookup — who has this product saved. Used for "back in stock" notifications; a small, bounded set for any single product, not a table scan. */
export async function listUserIdsWithProductWishlisted(productId: string): Promise<string[]> {
  const rows = await query<{ user_id: string }>("SELECT user_id FROM wishlist_items WHERE product_id = $1", [productId]);
  return rows.map((r) => r.user_id);
}

export async function insertWishlistItem(userId: string, productId: string): Promise<WishlistItem> {
  try {
    const row = await queryOne<WishlistRow>(
      "INSERT INTO wishlist_items (user_id, product_id) VALUES ($1, $2) RETURNING *",
      [userId, productId]
    );
    return toWishlistItem(row!);
  } catch (err) {
    if (isPgErrorCode(err, PG_ERROR_CODES.UNIQUE_VIOLATION)) {
      throw new ConflictError("This product is already in your wishlist.");
    }
    throw err;
  }
}

export async function findWishlistItem(userId: string, productId: string): Promise<WishlistItem | null> {
  const row = await queryOne<WishlistRow>(
    "SELECT * FROM wishlist_items WHERE user_id = $1 AND product_id = $2",
    [userId, productId]
  );
  return row ? toWishlistItem(row) : null;
}

export async function deleteWishlistItem(id: string): Promise<void> {
  await query("DELETE FROM wishlist_items WHERE id = $1", [id]);
}
