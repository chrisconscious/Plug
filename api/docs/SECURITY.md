# PLUG Backend — Security Review

**Status:** Database Phase (application-layer security from Phase 1, now
backed by a real PostgreSQL schema — see `docs/DATABASE.md`). Several
controls below moved from "implemented at the application layer only" to
"implemented at both the application layer AND enforced independently by
database constraints/grants" — each entry says which applies.

This document does not claim the platform is "100% secure." Security is a
continuous process — see "Security testing recommendations" for what should
run on every change going forward.

## 1. Threat model — what was considered

| Threat | Considered? | Where addressed |
|---|---|---|
| SQL injection | Yes | Every query in `db/repos/*.ts` uses parameterized queries (`$1, $2, ...` via `pg`) — no string-concatenated SQL anywhere in the codebase. Verified by manual review of every repo file (see `docs/DATABASE.md` §18). |
| Broken authentication | Yes | `lib/security/password.ts`, `lib/security/tokens.ts` (now DB-backed sessions, see `docs/DATABASE.md`) |
| Broken authorization / IDOR / BOLA | Yes | `lib/rbac.ts`, ownership checks in every service (e.g. `order.service.ts#getOrderForUser`, `cart.service.ts#assertOwnsCartItem`) |
| Privilege escalation | Yes | Explicit per-role permission allow-list (`rbac.ts`, mirrored in DB by `role_permissions` — see `docs/DATABASE.md` §3); admins cannot change their own role or disable themselves (`admin.service.ts`) |
| Session hijacking / fixation | Yes | HttpOnly+SameSite cookies, refresh token rotation, sessions persisted server-side so they're revocable, TOTP MFA for Admin/Super Admin |
| Credential stuffing / brute force | Yes | Per-IP rate limiting on `/auth/login`, `/auth/register`, `/auth/refresh` |
| Account enumeration | Yes | Generic error messages on login/register (DB unique-violation is caught and translated to the same generic message — see `users.repo.ts#insertUser`); constant-effort dummy hash comparison for unknown emails on login |
| Malicious file uploads | Yes | Real upload endpoints exist (brand logos, product images, hero slides, lifestyle heroes) — magic-byte image validation (`security/image.ts`, never trusts client-supplied content-type), size limits, checksums, and object-storage abstraction (`lib/storage/`, `lib/services/media.service.ts`) with orphan cleanup — see `docs/ARCHITECTURE.md`'s media section |
| API abuse | Yes | Rate limiting per route category (dedicated limits for login/registration/password-reset/refresh/uploads/search/admin — see rateLimiter.ts), backed by Redis when `RATE_LIMIT_REDIS_URL` is set (required for correctness once more than one instance runs); client IP is only ever taken from proxy headers when `TRUST_PROXY_HOPS` is explicitly configured for the real deployment topology — see below |
| Sensitive data exposure | Yes | Centralized error handler never returns stack traces/internals; passwords/tokens are redacted from all logs (`lib/logger.ts`); database grants additionally prevent the app role from ever needing broader access than each table requires (`docs/DATABASE.md` §10) |
| Security misconfiguration | Yes | App refuses to boot in production without real secrets (`lib/config.ts`); `COOKIE_SECURE` enforced in production; database credentials are a required env var with no insecure default (`config.ts#database`) |
| Dependency vulnerabilities | Deferred | This phase intentionally has a minimal dependency set specifically to minimize supply-chain surface while offline; run `npm audit` / Dependabot once the project has network access |
| Open redirects | N/A this phase | No redirect-taking endpoints exist |
| Clickjacking | Yes | `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'` |
| CSRF | Yes | Double-submit cookie + Origin validation on every state-changing request — see below |
| Replay attacks (order/payment) | Yes | `Idempotency-Key` handling for order creation, now enforced by a database UNIQUE constraint + transaction rather than an in-memory Map — see `docs/DATABASE.md` §6 |
| Data corruption / invalid states | Yes | Database CHECK constraints make several classes of bad data physically impossible to write (negative prices/stock, order totals that don't match their own line items) — see `docs/DATABASE.md` §4 |
| Excessive database privileges | Yes | Least-privilege DB roles with table-by-table, operation-by-operation grants (migration 0007) — e.g. the app role cannot UPDATE or DELETE `order_items` or `activity_logs` even if application code had a bug that tried to |

### CSRF

Two independent checks apply to every state-changing (non-GET/HEAD/OPTIONS)
request, layered on top of (not instead of) `SameSite=Lax` cookies — see
`lib/security/csrf.ts`:

1. **Origin validation**: the request's `Origin` header must match the
   configured `FRONTEND_ORIGIN` exactly. A missing or mismatched Origin is
   rejected — there is no fallback to `Referer` or an "assume same-origin"
   exception, since a client that omits Origin is indistinguishable from a
   forged one without it.
2. **Double-submit CSRF token**: a random token is set as a readable
   (non-httpOnly) cookie on every response (`middleware.ts`). The frontend
   reads it and echoes it back as `X-CSRF-Token` (`web/src/lib/api.ts`'s
   `request()`, applied automatically — no per-call-site code needed). An
   attacker's cross-site page can trigger a request that carries this
   app's cookies, but cannot read the cookie's value to also put it in a
   header.

`auth: "none"` routes (login, register, refresh — no session cookie exists
yet to protect) get Origin validation only, not the token check; every
authenticated route gets both. Safe methods are never checked, so normal
browsing/reads are unaffected.

### Rate limiting and client IP trust

Every 429 response includes a `Retry-After` header (seconds until that
caller's window resets) — well-behaved clients can back off exactly that
long instead of guessing or polling.

Client IP (used to key every rate limit) is **never** taken from
`X-Forwarded-For`/`X-Real-IP`/`CF-Connecting-IP` unless `TRUST_PROXY_HOPS`
is explicitly set for the real deployment topology (see `.env.example`
and `lib/http.ts`'s `clientIp()`). This matters because these headers are
just as attacker-controlled as any other request header when nothing
trusted sits in front of the app — blindly reading the first entry (a
mistake this codebase made until it was caught and fixed) means an
attacker can set a fresh fake IP on every request and get a fresh
rate-limit bucket every time, completely bypassing login/registration
brute-force protection.

The fix has two parts, both necessary:
1. **Don't trust the header at all with `TRUST_PROXY_HOPS=0`** (the
   default). Rate limiting still applies — just bucketed together rather
   than per-IP — which is strictly safer than trusting a spoofable value.
2. **When a real proxy IS configured** (`TRUST_PROXY_HOPS` set to the
   actual hop count), take the entry that many positions from the *end*
   of the `X-Forwarded-For` chain, never the first entry — the first
   entry is always the original client-supplied value and remains
   spoofable no matter how many genuine proxies sit in front of it.

## 2. Security controls implemented

- **Password storage:** `scrypt` (memory-hard KDF), unique random salt per
  password, parameters embedded in the stored hash so they can be upgraded
  later without invalidating existing hashes. Constant-time comparison
  (`timingSafeEqual`) — never a plain `===` on secret material.
- **Email-verification and password-reset tokens (migration 0028):** a
  real 32-byte random secret is generated per token, sent in the email
  link, and never persisted anywhere — only its SHA-256 hash is stored.
  A database read alone (a leaked backup, a SQLi read) yields only
  hashes, not usable tokens. This is a real fix, not a from-the-start
  design: an earlier version of both tables used the row's own id (an
  unguessable UUID) as the bearer secret itself — functionally
  equivalent to plaintext storage, since reading the row directly handed
  out a working token. See `security/tokenHash.ts` and migration 0028's
  header comment for the full reasoning.
- **Session tokens:** short-lived (15 min) HMAC-signed access tokens,
  long-lived (14 day) refresh tokens that are individually revocable
  (server-side session record) and **rotated on every use** (old refresh
  session revoked, new one issued) — limits the value of a stolen refresh
  token to a single use before rotation invalidates it.
- **Cookies:** `HttpOnly`, `SameSite=Lax`, `Secure` (enforced true in
  production), refresh cookie scoped to `/api/v1/auth` only (not sent on
  every request).
- **Rate limiting:** per-IP, per-route-category (login, register, refresh,
  order creation, general, admin) — see `lib/security/rateLimiter.ts`.
- **Generic authentication errors:** "Invalid email or password" regardless
  of which part was wrong or whether the account exists; registration
  returns a generic conflict message rather than confirming an email is
  taken.
- **Authorization:** every protected route declares its required
  `permission` in the route definition itself (`withRoute({ permission:
  ... })`), checked server-side on every request — never inferred from the
  frontend. Role → permission mapping is an explicit allow-list, not
  "SUPER_ADMIN can do everything" implicitly.
- **Resource ownership:** customers can only read/mutate their own cart,
  wishlist, and orders — enforced in the service layer, not just the route
  layer, so it can't be bypassed by a future route that forgets to check.
- **Input validation:** every request body is validated against an explicit
  field shape (`lib/validate.ts`); unknown fields are rejected rather than
  silently ignored.
- **Money handling:** all amounts are integer cents; the server always
  recomputes order totals from its own product price data — a client can
  send any `priceCents` it wants in a request and it will simply be
  ignored (see `order.service.ts`).
- **Inventory concurrency:** stock check-and-decrement for each product
  variant is protected by real PostgreSQL row locks (`SELECT ... FOR
  UPDATE`) inside a database transaction, with a two-pass
  validate-then-mutate order creation flow so a failed stock check never
  partially decrements other lines, plus a `stock_qty >= 0` CHECK
  constraint as a last-resort backstop. This now holds correctly across
  multiple horizontally-scaled instances — see `docs/DATABASE.md` §5 for
  the full mechanism (this superseded the Phase 1 in-memory mutex).
- **Idempotent order creation:** an `Idempotency-Key` header is required on
  order creation; a database UNIQUE constraint (not an in-memory Map)
  enforces that replays of the same key return the original order rather
  than creating a duplicate — see `docs/DATABASE.md` §6.
- **Audit logging:** admin-affecting actions (product changes, order status
  changes, admin creation/role changes/disabling) are recorded with actor,
  action, target, and timestamp in an append-only `activity_logs` table.
  UPDATE and DELETE on this table are revoked from the application's
  database role entirely (migration 0007) — enforced by the database, not
  just by which functions `lib/audit.ts` happens to export.
- **Database-level data integrity:** CHECK constraints make several classes
  of corruption impossible to write regardless of application logic — an
  order's `total_cents` must equal `subtotal - discount + shipping`, stock
  can never go negative, discounts can never exceed the subtotal they
  apply to. See `docs/DATABASE.md` §4–5.
- **Least-privilege database access:** the application connects as a role
  with only the specific grants each table needs (e.g. INSERT but not
  UPDATE/DELETE on `order_items`), not blanket table ownership — see
  `docs/DATABASE.md` §10.
- **Error handling:** centralized `withRoute()` wrapper ensures every route
  goes through the same error translation — unexpected errors are logged
  with full detail server-side and returned to the client as a generic
  500 with a request ID for correlation, never a stack trace or internal
  detail.
- **Secure headers:** `X-Content-Type-Options: nosniff`, `X-Frame-Options:
  DENY`, `Referrer-Policy`, restrictive `Content-Security-Policy`,
  `Strict-Transport-Security` in production, locked-down CORS.
- **Secrets:** never hardcoded; `lib/config.ts` reads from environment
  variables only and refuses to boot in production if required secrets are
  missing. `.env.example` documents required variables without real values.
- **Secure account provisioning:** the first Super Admin account is created
  via an interactive script (`db/scripts/create-super-admin.ts`) that
  prompts for credentials rather than generating or hardcoding one —
  replaces the Phase 1 bootstrap mechanism (random password printed to the
  console on every boot), which was explicitly documented there as
  unsuitable for anything beyond local development.
- **Logging:** structured JSON logs with request IDs; a `redact()` helper
  strips passwords/tokens/secrets from anything logged, applied
  automatically to all log metadata.

## 3. Remaining risks (not yet fully closed)

These are real gaps, stated plainly rather than glossed over:

1. **None of this has run against a real database yet.** Every SQL
   migration, query, and the concurrency/idempotency logic were written
   carefully and cross-checked by static analysis (see `docs/DATABASE.md`
   §18), but this sandbox has no PostgreSQL available and no network
   access to install one. Run the full test plan in `docs/DATABASE.md` §16
   — especially the concurrency test — against a real database before
   trusting any of this in a shared environment.
2. **Single-instance rate limiting.** Still in-memory (`lib/security/
   rateLimiter.ts`) and therefore only correct with exactly one running
   instance — unlike inventory locking and idempotency, which are now
   database-backed and multi-instance-safe (see `docs/DATABASE.md` §5–6).
   Horizontally scaling this app *before* moving rate limiting to Redis
   would silently reintroduce brute-force risk. Documented at the top of
   `lib/security/rateLimiter.ts`.
3. **Access tokens can't be revoked early.** A stolen access token remains
   valid for up to 15 minutes even after logout/disable, because it's
   stateless by design (checked against no server-side store, for
   performance) — though the underlying user row IS re-checked on every
   request (`tokens.ts#getSessionFromRequest`), so a *disabled* user's
   access token stops working immediately; only a *stolen-but-not-yet-
   detected* token has this window. A Redis-backed token-denylist would
   close that remaining gap if the risk tolerance requires it.
5. **No email verification flow yet.** Registration creates a usable
   account immediately.
6. **No file upload endpoints yet**, so upload-specific controls (MIME/
   signature validation, size limits, malware scanning architecture) are
   not implemented — they must be added *before* any upload endpoint
   (e.g. product image management) ships, not after.
7. **No MFA** for privileged (Admin/Super Admin) accounts yet.
8. **Dependency scanning is not automated** (no CI configured in this
   phase — see `docs/ARCHITECTURE.md`).
9. **Account deletion/anonymization workflow is not built.** The schema
   deliberately prevents hard-deleting a user with order history
   (`orders.user_id` is `ON DELETE RESTRICT` — see `docs/DATABASE.md` §9),
   but the anonymization workflow that should back a real "delete my
   account" request (scrub PII, keep the row for referential integrity)
   doesn't exist yet — a named, scoped follow-up, not silently missing.
10. **Scheduled cleanup jobs are not running.** Expired sessions and old
    idempotency keys accumulate — the query functions to delete them exist
    (`sessions.repo.ts#deleteExpiredSessions`), but no scheduler invokes
    them yet, since no background job runner exists in this phase.

## 4. Required infrastructure controls (outside this codebase)

The application cannot enforce these itself — they're deployment/infra
responsibilities:

- TLS termination / HTTPS-only at the load balancer or edge (the app trusts
  `COOKIE_SECURE=true` and HSTS headers, but does not terminate TLS itself).
- A WAF or equivalent for DDoS / abusive traffic patterns beyond
  application-level rate limiting.
- Database network isolation (private subnet, no public ingress) — see
  `docs/DATABASE.md` §10 for the access control model this assumes.
- Secrets management (e.g. a vault/secrets manager) rather than plain
  environment variables in production — this now includes the database
  connection string (`DATABASE_URL`), not just the auth token secrets.
- Automated, encrypted, tested database backups and point-in-time recovery
  — see `docs/DATABASE.md` §14, which documents the requirement and
  targets (RPO/RTO) but cannot implement or test this from application code.

## 5. Security testing recommendations

Before and after every meaningful change:

- **Authorization boundary tests:** attempt cross-account access (customer
  A reading customer B's order/cart/wishlist by ID), attempt admin routes
  as a customer, attempt super-admin routes as an admin. All must fail with
  403/401, never 500 or silent success.
- **Concurrency tests:** fire many simultaneous `POST /orders` for the same
  low-stock variant and confirm stock never goes negative and no duplicate
  orders are created for a repeated `Idempotency-Key`. See
  `docs/DATABASE.md` §16 for the specific scripted scenario and pass
  conditions — none of this has been run yet (no live database available
  in this build environment).
- **Database constraint tests:** deliberately attempt to insert/update data
  that should be impossible (negative price, mismatched order total,
  duplicate SKU-equivalent, deleting a brand with active products) and
  confirm the database rejects every one — see `docs/DATABASE.md` §16 for
  the exact statements.
- **Rate limit tests:** confirm `/auth/login` locks out after the
  configured threshold and recovers after the window.
- **Input fuzzing:** malformed JSON, oversized payloads, unexpected field
  types, extra/unknown fields on every POST/PATCH body.
- **Dependency audit:** `npm audit` (and ideally Dependabot/Snyk) once
  network access allows installing the real dependency set.
- **Session tests:** confirm a disabled admin's existing session stops
  working immediately (not just on next login), and that refresh token
  rotation invalidates the previous refresh token.

This review should be repeated, not just referenced, every time a new
sensitive endpoint (payments, file uploads, admin action) is added.
