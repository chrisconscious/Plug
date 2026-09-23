import { withRoute, json } from "@/lib/http";
import { validateBody, required, isString } from "@/lib/validate";
import { ValidationError } from "@/lib/errors";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { updateOrderStatus, getOrderForAdmin } from "@/lib/services/order.service";
import type { Order } from "@/lib/db/types";

const VALID_STATUSES: Order["status"][] = ["PENDING", "PAID", "SHIPPED", "DELIVERED", "CANCELLED"];

export const GET = withRoute({ permission: "orders.read", rateLimit: RateLimitRules.adminGeneral }, async ({ params }) => {
  const order = await getOrderForAdmin(params.id!);
  return json({ order });
});

export const PATCH = withRoute({ permission: "orders.update", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user, params }) => {
  const body = await req.json().catch(() => ({}));
  const { status } = validateBody(body, { status: required(isString) });
  if (!VALID_STATUSES.includes(status as Order["status"])) {
    throw new ValidationError("Validation failed.", { status: `Must be one of: ${VALID_STATUSES.join(", ")}` });
  }
  const order = await updateOrderStatus(user!, params.id!, status as Order["status"]);
  return json({ order });
});
