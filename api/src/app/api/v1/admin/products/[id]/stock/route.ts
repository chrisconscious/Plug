import { withRoute, json } from "@/lib/http";
import { validateBody, required, isArray } from "@/lib/validate";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { setProductStock } from "@/lib/services/catalog.service";

/**
 * Dedicated inventory endpoint: sets absolute stock for some of a product's
 * variants — { stock: [{ variantId, stockQty }] } — without resubmitting the
 * product or its whole variant matrix.
 */
export const PATCH = withRoute({ permission: "products.update", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user, params }) => {
  const body = await req.json().catch(() => ({}));
  const { stock } = validateBody(body, { stock: required(isArray) });
  const variants = await setProductStock(
    user!,
    params.id!,
    (stock as unknown[]).map((raw) => {
      const r = (raw ?? {}) as Record<string, unknown>;
      return {
        variantId: typeof r.variantId === "string" ? r.variantId : "",
        stockQty: typeof r.stockQty === "number" ? r.stockQty : Number.NaN,
      };
    })
  );
  return json({ variants });
});
