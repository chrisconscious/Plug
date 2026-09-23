import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { updateMyAddress, deleteMyAddress } from "@/lib/services/addresses.service";

/** Ownership is enforced entirely inside the service/repo layer (every query is scoped by the authenticated user's own id) — params.id alone can never reach another customer's address. */
export const PATCH = withRoute({ auth: "required", rateLimit: RateLimitRules.general }, async ({ req, user, params }) => {
  const body = await req.json().catch(() => ({}));
  const address = await updateMyAddress(user!.id, params.id!, body);
  return json({ address });
});

export const DELETE = withRoute({ auth: "required", rateLimit: RateLimitRules.general }, async ({ user, params }) => {
  await deleteMyAddress(user!.id, params.id!);
  return json({ success: true });
});
