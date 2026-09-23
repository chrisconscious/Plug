import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { setMyDefaultAddress } from "@/lib/services/addresses.service";

export const PUT = withRoute({ auth: "required", rateLimit: RateLimitRules.general }, async ({ user, params }) => {
  const address = await setMyDefaultAddress(user!.id, params.id!);
  return json({ address });
});
