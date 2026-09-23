# PLUG Backend — Architecture

## Why this exists as a separate project

The pre-existing frontend repository is a
**Vite + React Router single-page app** with zero backend — every "product,"
"order," and dashboard number in it is a hardcoded array in the frontend
bundle. The brief for this phase asked for a Next.js + TypeScript backend.
Those two facts don't reconcile into "add an API folder to the existing
app" — Vite and Next.js are different frameworks with different serving
models. Rather than silently picking one and hoping it's what was meant,
this is called out explicitly:

**This backend is a standalone Next.js (App Router) project — `plug-
backend/` — that the existing Vite frontend calls over HTTP (CORS is
locked to the frontend's origin; see `lib/config.ts`).** If the intent was
instead "migrate the whole frontend to Next.js too," that's a materially
different, larger project — say the word and it can be scoped separately.

## Current phase scope (explicit)

**This document (`docs/ARCHITECTURE.md`) describes the Phase 1 application
architecture, which is still accurate for everything except the data
layer.** The data layer described in "Known limitation" and "Database
phase" below has now been implemented — see **`docs/DATABASE.md`** for the
current, authoritative description of the PostgreSQL schema, the
concurrency/idempotency mechanisms that replaced the in-memory
placeholders, and what's still unverified (no live Postgres was available
to actually run any of it against — see `docs/DATABASE.md`'s disclaimer).

Built now: **Authentication, RBAC/authorization, product/category/brand
catalog (read) + admin catalog mutation, cart, wishlist, orders with
integrity guarantees (now backed by real PostgreSQL transactions and row
locks, not in-memory placeholders), admin & super-admin management, audit
logging (append-only, DB-enforced), security middleware (rate limiting,
headers, validation, error handling), structured logging, and a complete
PostgreSQL schema with least-privilege access control.**

Deliberately deferred to a later phase (per the brief's own phasing —
"we will continue to Database later if I tell you," now done — and to
avoid shipping half-built, unverifiable stubs for things that need real
infrastructure): **payments/webhooks, promotions/coupons, advertisements
CRUD, background job queue, Redis caching, distributed tracing, load
testing, CI pipeline.** Each of these has a clear seam to attach to (see
"Extension points" below) so adding them doesn't require restructuring
what exists.

## Request flow

```
Client (Vite frontend)
   │  fetch(..., { credentials: "include" })
   ▼
Next.js Route Handler  (src/app/api/v1/**/route.ts)
   │  wrapped in withRoute({ auth, permission, rateLimit })
   ▼
withRoute()  (src/lib/http.ts)
   │  1. assign request ID
   │  2. rate limit check
   │  3. extract + verify session (access token cookie)
   │  4. permission check (RBAC)
   │  5. call the handler
   │  6. catch + translate errors centrally
   │  7. attach security headers, log outcome
   ▼
Service layer  (src/lib/services/*.service.ts)
   │  business logic, ownership checks, money math, audit events
   ▼
Data layer  (src/lib/db/repos/*.ts)
   │  PostgreSQL via `pg`, parameterized queries — see docs/DATABASE.md
```

Every route handler is a thin wrapper: parse/validate input, call one
service function, return its result as JSON. Business logic lives in
`lib/services/`, never in route files — this is what keeps authorization
and validation from being duplicated (or forgotten) route-by-route.

## Module layout

```
src/
  app/api/v1/            route handlers only (thin — see above)
    auth/                register, login, logout, refresh, me
    products/ categories/ brands/     public catalog reads
    cart/ wishlist/       customer-owned resources
    orders/               create (idempotent) + list/get (own)
    admin/                products CRUD, orders read/update, activity-logs
    super-admin/          admin account management
  lib/
    config.ts             validated env config, fails fast if misconfigured
    logger.ts              structured logging + redaction
    errors.ts               typed error taxonomy -> HTTP status mapping
    http.ts                  withRoute() composition wrapper (see above)
    rbac.ts                   roles + explicit permission allow-lists
    validate.ts              dependency-free schema validation
    money.ts                 integer-cents money helpers
    audit.ts                   re-exports db/repos/audit.repo.ts
    security/
      password.ts             scrypt hashing
      tokens.ts                 HMAC session tokens, DB-backed sessions
      rateLimiter.ts            in-memory rate limiting (still current — see docs/DATABASE.md's scaling notes)
    db/
      types.ts                  entity interfaces (now the TS side of the SQL schema)
      pool.ts                    pg.Pool singleton, statement_timeout, graceful shutdown
      client.ts                  query()/withTransaction() helpers
      repos/
        users.repo.ts, sessions.repo.ts, catalog.repo.ts, cart.repo.ts,
        wishlist.repo.ts, orders.repo.ts, audit.repo.ts
    services/
      auth.service.ts, catalog.service.ts, cart.service.ts,
      wishlist.service.ts, order.service.ts, admin.service.ts
```

See `docs/DATABASE.md` for the full schema (`db/migrations/*.sql`), the
concurrency/idempotency mechanisms in `orders.repo.ts`, and the
access-control model.

## Media / file storage architecture

```
domain service (catalog/hero/lifestyles.service.ts)
  -> MediaService (lib/services/media.service.ts)
       -> StorageProvider interface (lib/storage/provider.ts)
            -> LocalDiskStorageProvider (dev only) | S3StorageProvider
       -> media.repo.ts -> `media` table (metadata only — file bytes never
          touch Postgres)
```

- **`StorageProvider`** is the one interface all file storage goes
  through — `put`/`delete`/`exists`/`list`. Business logic never imports
  `fs` or an S3 SDK directly. Selected by `STORAGE_PROVIDER` (`local` or
  `s3` — see `.env.example`); swapping providers is a config change, not
  a code change.
- **`MediaService`** owns validation (magic-byte sniffing via
  `security/image.ts`, never trusting client-supplied content-type),
  checksum computation (SHA-256), and — the part that used to be
  duplicated and inconsistent across the domain services — the
  failure-compensation logic: if the DB write fails after a successful
  upload, the just-uploaded object is deleted rather than left orphaned;
  if a best-effort cleanup delete fails, it's logged (not thrown, not
  silently swallowed) and left for orphan cleanup to reconcile.
- **The `media` table** is a cross-cutting metadata/audit registry
  (checksum, original filename, alt text, which entity it belongs to) —
  deliberately *parallel to*, not a replacement for, each domain table's
  own `storage_key` column (`brand_logos`, `product_images`,
  `hero_advertisements`, `lifestyles`). See migration `0023`'s header
  comment for why a full rewrite of all four domains onto a foreign-key
  join wasn't done.
- **Orphan cleanup** (`MediaService.findOrphans`/`cleanupOrphans`)
  reconciles storage against the database in both directions: a storage
  object with no `media` row (upload succeeded, something didn't clean up
  right), and a `media` row whose owning entity was deleted through a
  path that didn't also clean up its media record. Runs dry-run by
  default — nothing is destructively deleted without an explicit opt-in.
  Reachable two ways: `GET /api/v1/admin/media/orphans` (scan) /
  `POST /api/v1/admin/media/orphans/cleanup` (act — `system.manage`,
  Super Admin only, dry-run unless the body says `{"dryRun": false}`) for
  ad-hoc/admin-UI use, or `npm run media:cleanup-orphans [-- --apply]` for
  a cron job — same underlying logic either way.
- **Migration status**: all four upload domains — brand logos, product
  images, hero slides, and lifestyle heroes — route through `MediaService`
  for validation, storage, checksum computation, and compensating cleanup
  on failure. Each domain's own table (`brand_logos`, `product_images`,
  `hero_advertisements`, `lifestyles`) remains its own source of truth for
  "what image does this X currently have"; `media` is the parallel
  registry all four now populate consistently.

## Data integrity design (why it's structured this way)

- **Money:** `lib/money.ts`'s `Cents` type is a branded `number` — the type
  system won't let you accidentally add a raw `number` (e.g. something
  parsed from client JSON without going through validation) into a money
  calculation without an explicit `cents(...)` call. **Despite the
  name, every `Cents`/`*_cents` field and column holds a whole TZS
  amount, not real cents** — this app originally used USD cents, and
  migration 0042 changed the actual unit to TZS without renaming every
  existing field to match (a live rename across the schema and every
  call site is riskier than documenting the discrepancy clearly). See
  `db/types.ts`'s own header comment on the `Order` type for the full
  explanation, including why some fields exist under both a `*Cents`
  and a `*Tzs` name (the same value, two labels — not two competing
  totals). Combined with the rule
  "server always recomputes totals from `product.priceCents`, never from
  client input" (see `order.service.ts`), this closes the "client-side
  price manipulation" class of bug at the type level — and, as of the
  database phase, the database's own CHECK constraints independently
  verify the same arithmetic (see `docs/DATABASE.md` §4). Two layers, not
  one.
- **Order snapshots:** `OrderItem` copies `nameSnapshot`, `brandSnapshot`,
  and `unitPriceCentsSnapshot` at creation time. A later product rename or
  price change can never retroactively alter what a past order shows the
  customer or an auditor.
- **Inventory concurrency and idempotency:** now implemented with real
  PostgreSQL row locks and a database-enforced idempotency key — see
  `docs/DATABASE.md` §5–6 for the full mechanism. This section previously
  described the Phase 1 in-memory placeholders for both; that description
  has moved there since it's no longer how the system actually works.

## Extension points for deferred features

- **Payments:** a `payments.service.ts` would sit alongside
  `order.service.ts`, called after order creation with the order's
  server-computed `totalCents` (never a client-sent amount), and would use
  the same database-idempotency pattern as order creation for webhook
  processing — see `docs/DATABASE.md` §6.
- **Promotions/coupons:** `order.service.ts`'s `discountCents` is already a
  named field, currently hardcoded to 0 — a coupon-application step would
  populate it before the total is computed, server-side.
- **Advertisements:** would follow the exact same admin-route +
  RBAC-permission + audit-log pattern as `admin/products`.
- **Background jobs:** none of the current logic requires async processing
  (no emails/images yet), so no queue exists yet; when one is needed, it
  attaches at the service layer (a service function enqueues a job instead
  of doing work inline) without touching route handlers.

## Running this project

```
cp .env.example .env      # fill in ACCESS_TOKEN_SECRET / REFRESH_TOKEN_SECRET / DATABASE_URL
                            # (generate secrets: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
npm install
npm run db:migrate         # applies db/migrations/*.sql — see docs/DATABASE.md
npm run db:seed            # optional: sample brands/categories/products for local dev
npm run db:create-super-admin   # interactive — creates your first Super Admin login
npm run dev                # http://localhost:3001
```

See `docs/DATABASE.md` §10 for the recommended database role setup
(separate low-privilege app role vs. migrator role) before running this
against anything beyond a local scratch database.

**Note on this sandbox:** this code was written and type-checked (see
below) without network access and without a PostgreSQL server available,
so `npm install`, `npm run db:migrate`, `npm run build`, and `npm run dev`
have not been executed end-to-end here. Run them in a normal environment
before deploying — see `docs/DATABASE.md` §18 for exactly what was and
wasn't verified in this environment.

## Verification performed in this environment

- Full TypeScript type-check of every file in `src/` (now including the
  entire PostgreSQL data layer) against the real compiler (`tsc --strict
  --noUncheckedIndexedAccess`), using hand-written minimal type stubs for
  `next/server` and `pg` (since neither package could be installed
  offline) — this caught and fixed several real bugs before delivery,
  across both the Phase 1 pass and the database-phase rewrite (see
  `docs/DATABASE.md` §18 for the database-phase-specific findings).
- Manual review of every route for: RBAC declaration present, ownership
  check where the resource is user-owned, validation on every body field,
  rate limit rule assigned.
- Every SQL migration file was checked for balanced parentheses and
  correctly-escaped string literals by script, and every column name used
  in the TypeScript query layer was cross-checked against the actual
  migration schema — see `docs/DATABASE.md` §18 for what this caught.
- **Not performed** (needs a real environment): `npm install`, `npm run
  build`, running migrations against a live PostgreSQL server, integration
  tests against a running server, the concurrency/idempotency test
  scenarios, or load testing. See `docs/DATABASE.md` §16 for the full test
  plan to run once a real database is available, and `docs/SECURITY.md` §5
  for the security-specific test plan.
