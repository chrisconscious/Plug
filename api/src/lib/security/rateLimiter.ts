/**
 * Rate limiting — fixed-window counter.
 *
 * Two backends behind the same `checkRateLimit()` interface, chosen once
 * at startup by whether `RATE_LIMIT_REDIS_URL` is set (see config.ts):
 *
 *   - In-memory (default, `RedisRateLimitStore` not used): per-process
 *     state. Fine with exactly one running instance. The moment this app
 *     is horizontally scaled behind a load balancer WITHOUT switching to
 *     the Redis backend, each instance enforces its own separate limit —
 *     e.g. 3 instances behind a login limit of 8/min effectively allows
 *     24/min, silently reintroducing brute-force risk.
 *   - Redis-backed (`RATE_LIMIT_REDIS_URL` set): a shared counter across
 *     every instance, using atomic INCR + PEXPIRE so concurrent requests
 *     across processes can't race past the limit.
 *
 * ⚠️ VERIFICATION STATUS: the Redis backend was written against the
 * documented, stable `ioredis` API but this environment has no network
 * access to install the package or test against a real Redis instance —
 * it has NOT been executed. Same standard as `s3-provider.ts`: a
 * correct-by-review starting point, not a verified-working integration,
 * until it's actually run against a real (or local) Redis. See
 * docs/ARCHITECTURE.md "Rate limiting at scale".
 */

import { config } from "../config";

export type RateLimitRule = {
  /** Logical bucket name, e.g. "auth.login". Combined with the caller's IP by withRoute(). */
  key: string;
  windowMs: number;
  max: number;
};

export type RateLimitCheckResult = { allowed: boolean; retryAfterSeconds: number };

interface RateLimitStore {
  /** Returns whether the request is allowed (and increments the counter if so) plus how many seconds until the window resets — used for the `Retry-After` response header on a 429 (see http.ts's withRoute/errorToResponse). */
  check(compoundKey: string, rule: RateLimitRule): Promise<RateLimitCheckResult>;
  /** Test-only: clears all state so tests don't leak between cases. Never called from request paths. */
  reset(): void;
}

class InMemoryRateLimitStore implements RateLimitStore {
  private buckets = new Map<string, { count: number; resetAt: number }>();

  async check(compoundKey: string, rule: RateLimitRule): Promise<RateLimitCheckResult> {
    const now = Date.now();
    const bucket = this.buckets.get(compoundKey);

    if (!bucket || bucket.resetAt <= now) {
      const resetAt = now + rule.windowMs;
      this.buckets.set(compoundKey, { count: 1, resetAt });
      return { allowed: true, retryAfterSeconds: Math.ceil(rule.windowMs / 1000) };
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    if (bucket.count >= rule.max) return { allowed: false, retryAfterSeconds };

    bucket.count += 1;
    return { allowed: true, retryAfterSeconds };
  }

  reset(): void {
    this.buckets.clear();
  }
}

class RedisRateLimitStore implements RateLimitStore {
  // Lazily constructed so requiring `ioredis` only happens when this
  // backend is actually selected — a single-instance deployment
  // (RATE_LIMIT_REDIS_URL unset) never needs the package installed.
  private client: import("ioredis").Redis | null = null;

  private async getClient(): Promise<import("ioredis").Redis> {
    if (!this.client) {
      const { Redis } = await import("ioredis");
      if (!config.rateLimit.redisUrl) {
        throw new Error("RedisRateLimitStore constructed without RATE_LIMIT_REDIS_URL set.");
      }
      this.client = new Redis(config.rateLimit.redisUrl);
    }
    return this.client;
  }

  async check(compoundKey: string, rule: RateLimitRule): Promise<RateLimitCheckResult> {
    const client = await this.getClient();
    const key = `ratelimit:${compoundKey}`;
    // INCR is atomic across concurrent callers/instances — this is exactly
    // what makes this safe with multiple app instances, unlike the
    // in-memory Map above. PEXPIRE only applies on the FIRST increment in
    // a window (count === 1) so the window doesn't get pushed back by
    // every subsequent request within it (that would let a caller who
    // never stops requesting extend their own window indefinitely).
    const count = await client.incr(key);
    if (count === 1) {
      await client.pexpire(key, rule.windowMs);
    }
    const ttlMs = await client.pttl(key);
    const retryAfterSeconds = Math.max(1, Math.ceil((ttlMs > 0 ? ttlMs : rule.windowMs) / 1000));
    return { allowed: count <= rule.max, retryAfterSeconds };
  }

  reset(): void {
    // Deliberately not implemented for the Redis backend: tests exercise
    // the in-memory store directly (see rateLimiter.test.ts) rather than
    // needing a real Redis connection to reset.
    throw new Error("RedisRateLimitStore.reset() is not implemented — tests should exercise the in-memory store directly.");
  }
}

let store: RateLimitStore | null = null;

function getStore(): RateLimitStore {
  if (!store) {
    store = config.rateLimit.redisUrl ? new RedisRateLimitStore() : new InMemoryRateLimitStore();
  }
  return store;
}

export async function checkRateLimit(compoundKey: string, rule: RateLimitRule): Promise<RateLimitCheckResult> {
  return getStore().check(compoundKey, rule);
}

/** Test-only — clears the in-memory store's state between test cases. Throws if the Redis backend is active (tests should mock at a higher level in that case). */
export function __resetRateLimitStoreForTests(): void {
  getStore().reset();
}


// Shared rule presets for sensitive endpoints (per docs/SECURITY.md).
export const RateLimitRules = {
  login: { key: "auth.login", windowMs: 60_000, max: 8 } satisfies RateLimitRule,
  register: { key: "auth.register", windowMs: 60_000, max: 5 } satisfies RateLimitRule,
  passwordReset: { key: "auth.password_reset", windowMs: 60_000, max: 5 } satisfies RateLimitRule,
  refresh: { key: "auth.refresh", windowMs: 60_000, max: 20 } satisfies RateLimitRule,
  // Deliberately tight: resending is the one auth action a signed-in user
  // could otherwise spam indefinitely to flood their own inbox (or, if the
  // stub in email.ts is ever swapped for a real provider, run up its bill).
  resendVerification: { key: "auth.resend_verification", windowMs: 300_000, max: 3 } satisfies RateLimitRule,
  // MFA setup/enable/disable are security-sensitive account actions —
  // disableMfa() in particular re-checks the password, and this limit is
  // what stops a stolen/hijacked session from brute-forcing that check
  // (or from spamming setup/enable attempts) once rate limiting is the
  // only thing standing between "wrong password" and "try again
  // immediately, as many times as you like."
  mfaManagement: { key: "auth.mfa_management", windowMs: 60_000, max: 5 } satisfies RateLimitRule,
  orderCreate: { key: "orders.create", windowMs: 60_000, max: 10 } satisfies RateLimitRule,
  general: { key: "general", windowMs: 60_000, max: 120 } satisfies RateLimitRule,
  // Deliberately tight — a frontend crash loop reporting the same error
  // repeatedly should not be able to flood the backend/log volume. A
  // legitimate session hitting real, distinct errors is well within this;
  // a broken retry loop is exactly what this bounds.
  clientErrorReport: { key: "client_errors.report", windowMs: 60_000, max: 20 } satisfies RateLimitRule,
  // Product listing/filtering runs the most DB-intensive query path a
  // public, unauthenticated caller can trigger (multi-column WHERE,
  // joins, sorting) — tighter than plain `general` browsing so it can't
  // be used to load the database disproportionately to how "just reading
  // a page" should cost.
  search: { key: "catalog.search", windowMs: 60_000, max: 60 } satisfies RateLimitRule,
  // Uploads cost real disk/bandwidth/object-storage — much tighter than
  // adminGeneral's 240/min, which was never actually upload-specific
  // (every admin write shared one limit). 20/min comfortably covers
  // normal catalog management (uploading several images in a row) while
  // still bounding worst-case storage/bandwidth cost from one session.
  uploads: { key: "media.uploads", windowMs: 60_000, max: 20 } satisfies RateLimitRule,
  adminGeneral: { key: "admin.general", windowMs: 60_000, max: 240 } satisfies RateLimitRule,
};
