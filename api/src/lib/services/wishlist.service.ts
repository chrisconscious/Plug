import * as wishlistRepo from "../db/repos/wishlist.repo";
import { getProductOrThrow, getPublicProductsByIds } from "./catalog.service";
import { NotFoundError, AuthorizationError } from "../errors";

async function serializeWishlist(userId: string) {
  const items = await wishlistRepo.listWishlistItems(userId);
  // Batched — a single round of queries for every item's product data,
  // not one round PER item (see catalog.service.ts's
  // getPublicProductsByIds doc comment for the N+1 this fixes).
  const productById = await getPublicProductsByIds(items.map((w) => w.productId));
  return items
    .map((w) => ({ id: w.id, product: productById.get(w.productId) ?? null }))
    // A wishlist item whose product was since deleted has nothing useful
    // to show — drop it rather than send the frontend a null it has to
    // guard against everywhere a Product is otherwise guaranteed present.
    .filter((entry): entry is { id: string; product: NonNullable<typeof entry.product> } => entry.product !== null);
}

export async function getWishlist(userId: string) {
  return serializeWishlist(userId);
}

export async function addToWishlist(userId: string, productId: string) {
  await getProductOrThrow(productId);
  await wishlistRepo.insertWishlistItem(userId, productId); // DB unique constraint -> ConflictError on duplicate
  return serializeWishlist(userId);
}

export async function removeFromWishlist(userId: string, productId: string) {
  const existing = await wishlistRepo.findWishlistItem(userId, productId);
  if (!existing) throw new NotFoundError("Wishlist item not found.");
  if (existing.userId !== userId) throw new AuthorizationError();
  await wishlistRepo.deleteWishlistItem(existing.id);
  return serializeWishlist(userId);
}
