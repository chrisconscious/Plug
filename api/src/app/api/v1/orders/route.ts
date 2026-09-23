import { withRoute, json } from "@/lib/http";
import { validateBody, required, optional, isString, isArray, isPositiveInt } from "@/lib/validate";
import { ValidationError } from "@/lib/errors";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { createOrderFromCart, listOrdersForUser } from "@/lib/services/order.service";

export const GET = withRoute({ auth: "required", rateLimit: RateLimitRules.general }, async ({ user }) => {
  return json({ orders: await listOrdersForUser(user!.id) });
});

export const POST = withRoute({ auth: "required", rateLimit: RateLimitRules.orderCreate }, async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const shippingAddress = validateBody(body.shippingAddress ?? {}, {
    label: required(isString),
    line1: required(isString),
    line2: optional(isString),
    city: required(isString),
    region: required(isString),
    postalCode: required(isString),
    country: required(isString),
    phone: optional(isString),
  });

  // Idempotency-Key is a request HEADER (not body) — standard practice so
  // retried/duplicated HTTP requests (same header) are recognized even if
  // a client library re-serializes the body slightly differently.
  const idempotencyKey = req.headers.get("idempotency-key");

  // The chosen payment method id. The actual method/fee is resolved and
  // validated server-side in the order repo — never trusted from the client.
  const paymentMethodId =
    typeof body.paymentMethodId === "string" && body.paymentMethodId.trim() !== ""
      ? body.paymentMethodId.trim()
      : "";

  // For Cash on Delivery orders, the network the customer pays the transport
  // fee through (an active ONLINE method's payment number). Resolved + snapped
  // server-side in the order repo.
  const transportPaymentNumber =
    typeof body.transportPaymentNumber === "string" && body.transportPaymentNumber.trim() !== ""
      ? body.transportPaymentNumber.trim()
      : null;

  // Which delivery location the customer chose (migration 0047) — the
  // actual fee amount is resolved server-side from platform_settings,
  // never trusted from the client; this is only the location CHOICE.
  const deliveryLocation = typeof body.deliveryLocation === "string" ? body.deliveryLocation : "";

  // Optional coupon code — the actual discount is computed and validated
  // server-side (see coupons.repo.ts's applyCouponWithinTransaction);
  // this is only the CODE the customer typed, never a trusted amount.
  const couponCode = typeof body.couponCode === "string" && body.couponCode.trim() !== "" ? body.couponCode.trim() : null;

  // Optional "buy it now" line source. When present, the order is created
  // from EXACTLY these items instead of the customer's cart — the cart is
  // never touched. Shape: [{ variantId, quantity }], each quantity 1-20.
  // Validated loosely here (arrays of objects); the order repo re-validates
  // every line against live inventory/availability inside its transaction.
  let directItems: { variantId: string; quantity: number }[] | null = null;
  if (body.items !== undefined) {
    const rawItems = isArray(body.items, "items");
    if (rawItems.length === 0) {
      throw new ValidationError("Validation failed.", { items: "Must contain at least one item." });
    }
    directItems = rawItems.map((raw) => {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new ValidationError("Validation failed.", { items: "Each item must be an object." });
      }
      const o = raw as Record<string, unknown>;
      const variantId = isString(o.variantId, "items[].variantId");
      const quantity = isPositiveInt(o.quantity, "items[].quantity");
      if (quantity > 20) {
        throw new ValidationError("Validation failed.", { "items[].quantity": "Quantity must be at most 20." });
      }
      return { variantId, quantity };
    });
  }

  const order = await createOrderFromCart(user!.id, shippingAddress, idempotencyKey, paymentMethodId, transportPaymentNumber, deliveryLocation, directItems, couponCode);
  return json({ order }, { status: 201 });
});
