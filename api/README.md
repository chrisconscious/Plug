# PLUG Backend (application layer + PostgreSQL database)

A standalone Next.js (App Router) + TypeScript API backend for the
PLUG e-commerce platform, built to sit in front of the existing Vite
frontend over HTTP, backed by a PostgreSQL database. See
**`docs/ARCHITECTURE.md`** first — it explains why this is a separate
project and the application-layer design — then **`docs/DATABASE.md`** for
the full schema, concurrency/idempotency mechanisms, and access control
model, **`docs/SECURITY.md`** for the full security review, and
**`docs/api/CONTRACT.md`** for every endpoint's auth/permission/rate-limit
requirements (verified, not hand-written from memory).

## Quick start

```bash
cp .env.example .env
# generate secrets:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
# paste output into ACCESS_TOKEN_SECRET, run again for REFRESH_TOKEN_SECRET
# fill in DATABASE_URL — see docs/DATABASE.md §10 for the recommended
# least-privilege role setup before pointing this at anything shared

npm install
npm run typecheck
npm run db:migrate              # applies db/migrations/*.sql
npm run db:seed                 # optional: brands/categories/variants for local dev
npm run db:seed:catalog         # optional: a richer product/variant/image catalog
                                 # for exercising storefront filtering — can be run
                                 # in addition to db:seed; independent of it, both
                                 # are idempotent (ON CONFLICT DO NOTHING)
npm run db:create-super-admin   # interactive — creates your first login
npm run dev                     # http://localhost:3001
```

## API surface (v1)

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/v1/auth/register` | none | rate-limited |
| POST | `/api/v1/auth/login` | none | rate-limited, generic errors |
| POST | `/api/v1/auth/refresh` | refresh cookie | rotates the refresh token |
| POST | `/api/v1/auth/logout` | optional | revokes the refresh session |
| GET | `/api/v1/auth/me` | required | |
| GET | `/api/v1/products` | none | `?brand=&category=&q=&page=&pageSize=` |
| GET | `/api/v1/products/:slug` | none | |
| GET | `/api/v1/categories` \| `/brands` | none | |
| GET/POST | `/api/v1/cart` \| `/cart/items` | required | owner-only |
| PATCH/DELETE | `/api/v1/cart/items/:itemId` | required | owner-only |
| GET/POST | `/api/v1/wishlist` | required | owner-only |
| DELETE | `/api/v1/wishlist/:productId` | required | owner-only |
| GET/POST | `/api/v1/orders` | required | POST requires `Idempotency-Key` header |
| GET | `/api/v1/orders/:id` | required | owner-only |
| GET/POST | `/api/v1/admin/products` | `products.read`/`.create` | |
| PATCH/DELETE | `/api/v1/admin/products/:id` | `products.update`/`.delete` | |
| GET | `/api/v1/admin/orders` | `orders.read` | |
| PATCH | `/api/v1/admin/orders/:id` | `orders.update` | validated status transitions |
| GET | `/api/v1/admin/activity-logs` | `activity_logs.read` (Super Admin only) | |
| GET/POST | `/api/v1/super-admin/admins` | `admins.manage` | |
| PATCH | `/api/v1/super-admin/admins/:id` | `admins.manage` | disable/enable, change role |
| GET | `/api/v1/health` | none | liveness + database connectivity |

Roles: `CUSTOMER`, `ADMIN`, `SUPER_ADMIN` — full permission matrix in
`src/lib/rbac.ts`, mirrored in the database by `permissions`/
`role_permissions` (see `docs/DATABASE.md` §3).

## What's real vs. what's a documented placeholder

**Real, working logic:** password hashing, session tokens + rotation
(DB-persisted, revocable), RBAC, ownership checks, input validation,
server-computed money (independently re-verified by database CHECK
constraints), inventory concurrency protection (real PostgreSQL row locks),
idempotent order creation (database-enforced, multi-instance-safe), order
snapshots, audit logging (append-only, DB-enforced via revoked grants),
rate limiting, security headers, centralized error handling, least-
privilege database roles.

**Documented placeholder, by design, pending later phases:** rate limiting
is still in-memory/single-instance (needs Redis before horizontal
scaling — see `docs/ARCHITECTURE.md`); no payments, promotions, or
advertisements yet; no background job runner; no CI pipeline; no scheduled
cleanup for expired sessions/idempotency keys (the delete functions exist,
nothing calls them on a schedule yet). Every place this matters has a
comment explaining exactly what changes when that phase starts.

## Important: not yet run against a live database

This was built in a sandboxed environment with no network access and no
PostgreSQL server available. The schema and query layer were written
carefully and verified by static analysis (full strict TypeScript
type-checking against hand-built `pg` stubs, automated column-name
cross-checks against the migrations — see `docs/DATABASE.md` §18) — but
**none of the SQL has actually been executed.** Run `npm run db:migrate`
and the test plan in `docs/DATABASE.md` §16 against a real database before
trusting this anywhere beyond local experimentation.
