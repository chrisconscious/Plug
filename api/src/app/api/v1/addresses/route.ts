import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { listMyAddresses, createMyAddress } from "@/lib/services/addresses.service";

export const GET = withRoute({ auth: "required", rateLimit: RateLimitRules.general }, async ({ user }) => {
  const addresses = await listMyAddresses(user!.id);
  return json({ addresses });
});

export const POST = withRoute({ auth: "required", rateLimit: RateLimitRules.general }, async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const makeDefault = Boolean(body?.isDefault);
  const address = await createMyAddress(user!.id, body, makeDefault);
  return json({ address }, { status: 201 });
});
