import { withRoute, json } from "@/lib/http";
import { validateBody, required, isString } from "@/lib/validate";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { getUserDetails, deleteCustomerAccount } from "@/lib/services/customers.service";

/** One account's profile, addresses and order history. */
export const GET = withRoute({ permission: "users.read", rateLimit: RateLimitRules.adminGeneral }, async ({ params }) => {
  return json(await getUserDetails(params.id!));
});

/** Deletes a customer account (order history is kept — see customers.service.ts). */
export const DELETE = withRoute({ permission: "users.manage", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user, params }) => {
  const body = await req.json().catch(() => ({}));
  const { actorPassword } = validateBody(body, { actorPassword: required(isString) });
  const result = await deleteCustomerAccount(user!, params.id!, actorPassword);
  return json({ success: true, ...result });
});
