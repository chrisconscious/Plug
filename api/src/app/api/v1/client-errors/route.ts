import { withRoute, json } from "@/lib/http";
import { validateBody, required, optional, isString } from "@/lib/validate";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { captureError } from "@/lib/errorMonitoring";

// auth: "optional" — a frontend crash can happen whether or not the user
// is logged in (e.g. a rendering bug on the public storefront), and this
// must not itself require a valid session to report.
export const POST = withRoute({ auth: "optional", rateLimit: RateLimitRules.clientErrorReport }, async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const { message, stack, componentStack, url } = validateBody(body, {
    message: required(isString),
    stack: optional(isString),
    componentStack: optional(isString),
    url: optional(isString),
  });

  captureError({
    category: "frontend_exception",
    message,
    stack,
    userId: user?.id,
    endpoint: url,
    context: componentStack ? { componentStack } : undefined,
  });

  return json({ success: true });
});
