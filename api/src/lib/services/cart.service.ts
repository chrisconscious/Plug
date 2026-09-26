import * as cartRepo from "../db/repos/cart.repo";
import * as catalogRepo from "../db/repos/catalog.repo";
import { getProductOrThrow, getVariantOrThrow } from "./catalog.service";
import { NotFoundError, ValidationError, ConflictError } from "../errors";
import { addCents, cents, multiplyCents, type Cents } from "../money";
import type { CartItem } from "../db/types";

type LineSource = { id: string; variantId: string; quantity: number };

/** Shared line serializer — used by the cart AND by "buy it now", so a
 *  single-item checkout shows exactly the same snapshot shape (image,
 *  price, line total, availability warning) as the cart would. */
async function serializeLines(lines: LineSource[]) {
  const variantIds = lines.map((l) => l.variantId);
  const variants = await Promise.all(variantIds.map((id) => catalogRepo.findVariantById(id)));
  const variantById = new Map(variants.filter(Boolean).map((v) => [v!.id, v!]));

  const productIds = [...new Set([...variantById.values()].map((v) => v.productId))];
  const products = await Promise.all(productIds.map((id) => catalogRepo.findProductById(id)));
  const productById = new Map(products.filter(Boolean).map((p) => [p!.id, p!]));
  const imagesByProduct = await catalogRepo.listImagesForProducts(productIds);

  const items = lines.map((item) => {
    const variant = variantById.get(item.variantId);
    const product = variant ? productById.get(variant.productId) : undefined;
    const unitPrice = product ? cents(product.priceCents) : cents(0);
    // A product can go inactive (or a variant's stock can drop to 0) any
    // time after it was put in front of the customer — createOrderTransactional
    // already re-validates this at the moment of order creation and will
    // reject it there regardless, but the customer deserves to know BEFORE
    // checkout rather than being surprised by a rejected order for an
    // item that was still shown as perfectly normal.
    const inStock = !!variant && variant.stockQty > 0;
    // More requested than exist (stock dropped after it was added) — the
    // order would be rejected, so it isn't purchasable as-is either.
    const insufficientStock = inStock && variant!.stockQty < item.quantity;
    const available = !!product && product.active && inStock && !insufficientStock;
    return {
      id: item.id,
      quantity: item.quantity,
      available,
      insufficientStock,
      variant: variant ? { id: variant.id, size: variant.size, color: variant.color, inStock: variant.stockQty > 0 } : null,
      product: product
        ? {
            id: product.id,
            slug: product.slug,
            name: product.name,
            priceCents: product.priceCents,
            image: imagesByProduct.get(product.id)?.[0]?.url ?? null,
          }
        : null,
      lineTotalCents: multiplyCents(unitPrice, item.quantity),
    };
  });
  // The subtotal only counts what could actually be ordered right now —
  // showing a total that includes an unavailable item's price would be
  // actively misleading, not just an omitted detail.
  const purchasableLines = items.filter((l) => l.available);
  const subtotalCents: Cents = purchasableLines.length ? addCents(...purchasableLines.map((l) => l.lineTotalCents)) : cents(0);
  return { items, subtotalCents };
}

async function serializeCart(userId: string) {
  const items = await cartRepo.listCartItems(userId);
  return serializeLines(items.map((i) => ({ id: i.id, variantId: i.variantId, quantity: i.quantity })));
}

/** Ownership check used by every cart mutation: a cart item must belong to the caller. */
async function assertOwnsCartItem(userId: string, cartItemId: string): Promise<CartItem> {
  const item = await cartRepo.findCartItemById(cartItemId);
  if (!item) throw new NotFoundError("Cart item not found.");
  if (item.userId !== userId) throw new NotFoundError("Cart item not found.");
  return item;
}

export async function getCart(userId: string) {
  return serializeCart(userId);
}

/** Snapshot for a "buy it now" checkout — a single product the customer
 *  clicked straight through to checkout. Never touches the cart. */
export async function getBuyNowItems(variantId: string, quantity: number) {
  return serializeLines([{ id: `direct-${variantId}`, variantId, quantity }]);
}

export async function addToCart(userId: string, variantId: string, quantity: number) {
  if (quantity < 1 || quantity > 20) {
    throw new ValidationError("Validation failed.", { quantity: "Quantity must be between 1 and 20." });
  }
  const variant = await getVariantOrThrow(variantId);
  await getProductOrThrow(variant.productId); // throws if product inactive/missing
  if (variant.stockQty <= 0) {
    throw new ConflictError("This size is currently out of stock.");
  }
  // The cart merges quantities for the same variant, so check the total the
  // customer would end up with, not just this request.
  const existing = (await cartRepo.listCartItems(userId)).find((i) => i.variantId === variantId);
  const wanted = (existing?.quantity ?? 0) + quantity;
  if (wanted > variant.stockQty) {
    throw new ConflictError(
      existing
        ? `Only ${variant.stockQty} available in this size — you already have ${existing.quantity} in your cart.`
        : `Only ${variant.stockQty} available in this size.`
    );
  }

  await cartRepo.upsertCartItem(userId, variantId, quantity);
  return serializeCart(userId);
}

export async function updateCartItemQuantity(userId: string, cartItemId: string, quantity: number) {
  const item = await assertOwnsCartItem(userId, cartItemId);
  if (quantity < 1 || quantity > 20) {
    throw new ValidationError("Validation failed.", { quantity: "Quantity must be between 1 and 20." });
  }
  const variant = await getVariantOrThrow(item.variantId);
  if (variant.stockQty <= 0) {
    throw new ConflictError("This size is currently out of stock.");
  }
  if (quantity > variant.stockQty) {
    throw new ConflictError(`Only ${variant.stockQty} available in this size.`);
  }
  await cartRepo.updateCartItemQuantity(item.id, quantity);
  return serializeCart(userId);
}

export async function removeCartItem(userId: string, cartItemId: string) {
  const item = await assertOwnsCartItem(userId, cartItemId);
  await cartRepo.deleteCartItem(item.id);
  return serializeCart(userId);
}
