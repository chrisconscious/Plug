import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { listActivePaymentMethods } from "@/lib/services/payment-methods.service";

const PAGE_CACHE = "public, max-age=60";

// Checkout fetches the currently live payment methods (online networks + the
// cash/transport fee). Only active rows are ever exposed to the storefront.
export const GET = withRoute({ auth: "none", rateLimit: RateLimitRules.general }, async () => {
  const methods = await listActivePaymentMethods();
  return json({ methods }, { cache: PAGE_CACHE });
});
