# PLUG — Database Architecture (PostgreSQL)

This is the Database Phase deliverable, building on `docs/ARCHITECTURE.md`
(application layer) and `docs/SECURITY.md` (Phase 1 security review). Read
those first if you haven't — this document assumes that context.

**Cannot-verify-here disclaimer, stated plainly:** this sandbox has no
network access and no PostgreSQL binary available (confirmed — `apt-get
install postgresql` was attempted and blocked). Every SQL file here was
written carefully, cross-checked (see "Verification performed" at the
bottom) against the TypeScript that calls it, and manually proofread for
syntax — but **none of it has been executed against a real Postgres
server.** Run `npm run db:migrate` against a real database and the test
plan in this document before trusting this in any shared environment.

## 1. Entity relationship overview

```
users ──┬── addresses (CASCADE)
        ├── sessions (CASCADE)
        ├── cart_items (CASCADE) ──── product_variants (CASCADE)
        ├── wishlist_items (CASCADE) ─ products (CASCADE)
        ├── orders (RESTRICT) ──┬── order_items (CASCADE)
        │                       │      ├── products (SET NULL, snapshot-backed)
        │                       │      └── product_variants (SET NULL, snapshot-backed)
        ├── idempotency_keys (CASCADE)
        └── activity_logs (RESTRICT, actor_id)

brands ──RESTRICT── products ──CASCADE── product_variants
categories (self-referential, SET NULL) ──RESTRICT── products
products ──CASCADE── product_images

permissions ──RESTRICT── role_permissions   (reference/documentation tables — see §3)
                     └── admin_permissions  (per-admin grant overlay — see §3)
```

Full column-level detail lives in the migration files themselves
(`db/migrations/0001`–`0007`) — every table, column, constraint, and index
has an inline comment explaining *why*, not just *what*. This document is
the map; the migrations are the territory.

## 2. ID strategy

**UUID v4 (`gen_random_uuid()`, via the `pgcrypto` extension) for every
primary key.** Considered and rejected:

- **Auto-increment integers:** predictable, sequential — trivially
  enumerable (`/api/v1/orders/1043` implies `1042` exists) even though
  authorization would still block cross-account access. UUIDs remove that
  information-disclosure surface for free.
- **UUIDv7 (time-ordered UUIDs):** genuinely better for index locality on
  very large, high-insert-rate tables (avoids the random-insert B-tree
  fragmentation that UUIDv4 causes) — but requires either PostgreSQL 18+
  (native `uuidv7()`) or a third-party extension, and this project was
  built without the ability to confirm what PostgreSQL version or
  extensions are available in the actual target environment. **This is a
  concrete, named upgrade path**: once the target Postgres version is
  confirmed ≥18, switching the `DEFAULT` on high-insert tables
  (`order_items`, `activity_logs` are the ones that will accumulate fastest)
  from `gen_random_uuid()` to `uuidv7()` is a low-risk, backward-compatible
  change (existing v4 rows are unaffected; only new inserts change).
- **ULID:** similar time-ordering benefit to UUIDv7 without needing native
  DB support (can be generated app-side), but adds an external dependency
  this offline build couldn't install. Worth reconsidering once network
  access allows evaluating `ulid` npm packages properly.

No public/internal ID split was introduced (e.g. a separate short public
order number) — not because it lacks value (a customer-facing "Order
#VV12345" is nicer UX than a UUID), but because it's a presentation-layer
concern, not a security or integrity one: the UUID `orders.id` is never
guessable, and ownership is checked on every access (`order.service.ts`)
regardless of ID shape. **A human-readable order number is a reasonable
addition, deferred as a small, isolated feature** (a `display_number`
column, a sequence, done whenever it's prioritized) rather than baked into
this pass as if it were integrity-critical.

## 3. Roles and permissions: two tables, one enforcement path

Migration 0002 creates `permissions` and `role_permissions` tables that
mirror `src/lib/rbac.ts`'s `PERMISSIONS` and `ROLE_PERMISSIONS` exactly.
**These tables are not the enforcement mechanism.** `src/lib/http.ts`'s
`withRoute({ permission: ... })` calls `hasPermissionForUser()` from
`rbac.ts` — first a zero-latency in-memory check of the hard-coded role
matrix, then (if the role check fails) a per-admin grant lookup via
`admin_permissions`. The DB reference tables exist so that:

1. The permission matrix is queryable/auditable independent of reading
   TypeScript source (the Roles & Permissions admin screen queries
   `admin_permissions` + `permissionsForRole()` via the `/admin/rbac`
   endpoint).
2. A CI check can assert the two never drift: **recommended addition**
   (not yet built — no CI exists in this phase, see
   `docs/ARCHITECTURE.md`) — a script that connects to a test database,
   reads `role_permissions`, and diffs it against `permissionsForRole()`
   from `rbac.ts` for all three roles, failing the build on any mismatch.

### Per-admin permission grants (migration 0044)

`admin_permissions` stores *extra* permissions granted to an individual
Admin account by a Super Admin, overlaying the hard-coded role matrix.
These are never needed by a SUPER_ADMIN role (which already holds
everything), and NON_GRANTABLE_PERMISSIONS (`admins.manage`,
`system.manage`) can never be granted to anyone — the write path
validates this and the read path in `hasPermissionForUser` rejects them
even if a bad row somehow reached the table (defense in depth).

### Evaluation order (`hasPermissionForUser`)

1. SUPER_ADMIN → always true (no DB query).
2. Role-based check (`hasPermission`) → zero-latency, in-memory.
3. NON_GRANTABLE filter → fail-closed before the DB is touched.
4. `admin_permissions` lookup (60-second TTL per-user cache).

This is a deliberate two-copies-with-a-sync-check design, not an oversight
— the alternative (making every authorization check a DB query) would add
a network round trip to every single protected request for no correctness
benefit, since the permission set changes only when a developer ships code.

## 4. Money strategy

Every money column is `INTEGER` storing **minor currency units (cents)** —
`price_cents`, `subtotal_cents`, `unit_price_cents_snapshot`, etc. Never
`NUMERIC`, never `FLOAT`/`DOUBLE PRECISION`. This matches
`src/lib/money.ts`'s `Cents` branded type on the application side — the
database and the application agree on representation, so no conversion
layer exists to have a bug in.

**Two CHECK constraints make bad arithmetic physically impossible to
store**, independent of whether the application code that computed the
values was correct:

```sql
-- orders (migration 0005)
CONSTRAINT orders_discount_not_exceeding_subtotal CHECK (discount_cents <= subtotal_cents),
CONSTRAINT orders_total_matches_arithmetic
  CHECK (total_cents = subtotal_cents - discount_cents + shipping_cents)

-- order_items (migration 0005)
CONSTRAINT order_items_line_total_matches_arithmetic
  CHECK (line_total_cents = unit_price_cents_snapshot * quantity)
```

If a future bug in `orders.repo.ts` ever computed a wrong total, the
`INSERT`/`UPDATE` would fail outright rather than silently persisting an
incorrect financial record. This is the single highest-value integrity
control in the whole schema.

## 5. Concurrency strategy — how overselling is actually prevented

This is worth spelling out in full because it's the platform's most
safety-critical piece of logic (`src/lib/db/repos/orders.repo.ts`,
`createOrderTransactional`):

1. **One database transaction** wraps the entire order-creation flow —
   `BEGIN` ... `COMMIT`/`ROLLBACK` via `withTransaction()`
   (`src/lib/db/client.ts`).
2. The transaction's first act is claiming the idempotency key (§6) —
   cheapest-possible rejection of a duplicate/replayed request before any
   real work happens.
3. All distinct `product_variants` rows touched by the cart are locked with
   `SELECT ... FOR UPDATE OF pv`, **sorted by `pv.id`**. The sort matters:
   if Order A needs variants [X, Y] and Order B (running concurrently)
   needs variants [Y, X], without a stable lock-acquisition order they
   could deadlock (A holds X, waits for Y; B holds Y, waits for X). Sorting
   both by `id` means both transactions always request locks in the same
   order, so one simply waits for the other — no deadlock possible.
4. **Validate every line's stock BEFORE mutating anything** (two-pass: read
   all locked rows and check `stock_qty >= quantity` for every cart line
   first; only after every line passes does step 5 run). If any line fails,
   the whole transaction throws and rolls back — no partial decrement ever
   happens.
5. Stock is decremented with `UPDATE product_variants SET stock_qty =
   stock_qty - $qty WHERE id = $id AND stock_qty >= $qty`. The `AND
   stock_qty >= $qty` guard is redundant given the lock + prior validation
   (this row cannot have changed between the lock and this UPDATE, since we
   hold the lock) — it's there as a second, independent check: if it ever
   returns 0 rows affected (meaning the guard *did* catch something), the
   code treats that as a hard error and rolls back, rather than assuming
   the impossible can't happen.
6. The `product_variants.stock_qty >= 0` `CHECK` constraint (migration
   0003) is the third and final layer — even a bug that somehow bypassed
   both of the above could not write a negative stock value.

**What this replaces:** Phase 1 (see `docs/ARCHITECTURE.md`) used an
in-process async mutex as a documented, single-instance-only placeholder
for exactly this logic. That file has since been removed (it was unused
by any code path) — real row locks provide the same serialization
guarantee **correctly across multiple horizontally-scaled backend
instances**, which the in-memory mutex structurally could not.

## 6. Idempotency — database-enforced, not in-memory

`idempotency_keys` (migration 0005) has a composite `PRIMARY KEY (scope,
user_id, idempotency_key)`. The claiming `INSERT` happens *inside* the same
transaction as order creation:

- **Two concurrent requests, same key:** the loser's `INSERT` hits SQLSTATE
  `23505` (unique violation) immediately — Postgres itself is the race
  detector, not application logic. The loser's transaction aborts before
  touching any inventory. The outer function then looks up the winner's row
  (fresh query, since the loser's transaction is gone) and either returns
  the winner's stored `response_body` (if `COMPLETED`) or a 409 telling the
  client "still in progress, retry shortly" (if the winner hasn't finished
  yet).
- **A failed attempt (e.g. out of stock):** the whole transaction —
  including the idempotency claim — rolls back. A legitimate retry with the
  same key is free to try again; a failed attempt never permanently
  "burns" a key.
- **This works correctly with N backend instances behind a load balancer.**
  Phase 1's in-memory `Map`-based idempotency could not make that claim —
  a retry routed to a different instance would have seen no record of
  the first attempt. That file has since been removed (it was unused by
  any code path).
- **Same key, genuinely different request (migration 0027):** the key
  alone was never enough — a client reusing the same `Idempotency-Key`
  with a different shipping address or payment method would otherwise
  silently get back the ORIGINAL request's order. `request_fingerprint`
  (a SHA-256 of the request's meaningful fields, computed in
  `order.service.ts`) is stored alongside the key and compared on every
  collision: a match is a genuine replay (return the cached result); a
  mismatch is rejected with a distinct error rather than substituting a
  different request's result for what was actually asked.

## 7. Deletion behavior — a table-by-table decision, not a default

Every foreign key's `ON DELETE` behavior was chosen deliberately (see
inline `COMMENT`s in the migrations for each one's specific reasoning):

| Relationship | Behavior | Why |
|---|---|---|
| `addresses.user_id` → `users` | CASCADE | An address has no meaning independent of its owner; orders keep their own snapshot, unaffected. |
| `sessions.user_id` → `users` | CASCADE | Same reasoning. |
| `cart_items.*` → `users`, `product_variants` | CASCADE | Cart is not a historical record. |
| `wishlist_items.*` → `users`, `products` | CASCADE | Same. |
| `orders.user_id` → `users` | **RESTRICT** | Financial/historical records must never silently disappear via a user deletion. See §9 for the required anonymization workflow instead. |
| `order_items.order_id` → `orders` | CASCADE | An order's line items have no independent existence — but see below, orders are never actually deleted in practice. |
| `order_items.product_id` / `variant_id` → `products` / `product_variants` | SET NULL | The line item survives catalog changes; every display-relevant field is already snapshotted. |
| `products.brand_id` / `category_id` → `brands` / `categories` | **RESTRICT** | Prevents accidentally orphaning an entire brand's/category's active products by deleting the parent; forces an explicit reassignment/deactivation first. |
| `categories.parent_id` → `categories` (self) | SET NULL | Deleting a parent category promotes children to top-level rather than destroying the subtree. |
| `activity_logs.actor_id` → `users` | **RESTRICT** | An audit trail must remain attributable; matches how the app actually offboards admins (disable, never delete — `admin.service.ts`). |
| `idempotency_keys.user_id` → `users` | CASCADE | Purely operational/transient data, not a historical record. |

## 8. Indexing strategy

Every index has an inline comment naming the specific query pattern it
serves — summarized here:

- `users_email_unique_idx` — login/registration lookup + uniqueness (CITEXT
  handles case-insensitivity).
- `users_role_disabled_idx` — Super Admin "list active Admins" view.
- `sessions_active_idx` (**partial**, `WHERE revoked = false`) — every
  refresh/logout/disable operation only cares about non-revoked sessions;
  a partial index keeps this small forever even as millions of historical
  (revoked/expired) sessions accumulate.
- `products_active_brand_category_idx` (**partial + composite**, `WHERE
  active = true`) — the #1 query in the whole app (product listing/filter).
- `products_search_vector_gin_idx` — full-text product name search via
  `plainto_tsquery`, avoiding an `ILIKE '%...%'` full scan.
- `product_variants_low_stock_idx` (**partial**, `WHERE stock_qty <= 5`) —
  a future "low stock" admin dashboard query, cheap because the index only
  contains the small subset of rows that qualify.
- `orders_user_id_created_at_idx` (**composite**, `created_at DESC`) —
  "my orders, newest first," the #1 customer-facing order query, served
  directly without a sort step.
- `orders_status_idx` — admin fulfillment-queue-style queries.
- `activity_logs_target_idx` (**composite**, `target_type, target_id`) —
  "audit history of this specific order/product/user."

**What was deliberately NOT indexed:** every foreign key column gets an
index only where a real query pattern needs it (documented above) — not
mechanically on every FK. `product_images.product_id` is covered by the
composite `(product_id, position)` index rather than a redundant separate
one. Write-heavy, rarely-filtered columns (e.g. `created_at` on
high-volume tables without a specific query need) are left unindexed
unless a documented access pattern justifies the write-amplification cost.

## 9. Data lifecycle and retention

| Data | Policy |
|---|---|
| Orders, order items | **Retained indefinitely**, never hard-deleted. `orders.user_id` is `RESTRICT`, enforcing this at the schema level. |
| Users with order history | Cannot be hard-deleted (blocked by the RESTRICT above). A GDPR-style "delete my account" request must be implemented as an **anonymization workflow**: scrub `email`/PII-bearing columns on the `users` row (replace with a placeholder, e.g. `deleted-user-<uuid>@plug.invalid`), set `disabled = true`, revoke all sessions — while the row (and therefore the order history's referential integrity) remains. **This workflow is not yet built** — it's a named, scoped follow-up, not silently missing. |
| Sessions | Revoked immediately on logout/disable/role-change; **not auto-deleted**. A scheduled job should run `sessions.repo.ts#deleteExpiredSessions` periodically (e.g. daily, deleting sessions expired >30 days) to keep the table from growing unbounded. **Not yet scheduled** — no background job runner exists in this phase (see `docs/ARCHITECTURE.md` deferred items). |
| Idempotency keys | Same — `deleteExpiredSessions`-style cleanup needed via `idempotency_keys_created_at_idx`, deleting rows older than the 24h replay window. Not yet scheduled, same reason. |
| Activity logs | Retained indefinitely by default; no automatic deletion. If retention limits are ever required (storage cost, not correctness), archive-and-delete older rows to cold storage rather than deleting outright — audit history has ongoing compliance/dispute value. |
| Products, brands, categories | Soft-deleted only (`active = false`), never hard-deleted, specifically because `order_items` may reference them historically. |
| Cart items, wishlist items | Ephemeral by nature; no retention policy needed beyond normal CASCADE-on-account-deletion. |

## 10. Database access control (least privilege)

Migration 0007 creates two **group** roles (`NOLOGIN` — nobody connects as
them directly), renamed from their original `voguevibe_*` names to the
current `plug_*` names in migration 0030 (a safe rename — PostgreSQL
tracks roles by OID, so every grant from 0007 onward continues to apply
automatically under the new name; nothing needed to be re-granted):

- **`plug_app_role`** — the application's runtime privileges, granted
  table-by-table, operation-by-operation (see the migration file's inline
  comments for the reasoning on every single grant — e.g. why `order_items`
  gets `SELECT, INSERT` but explicitly *not* `UPDATE`/`DELETE`, why
  `activity_logs` gets `SELECT, INSERT` only).
- **`plug_readonly_role`** — `SELECT` on every table, for
  analytics/BI/reporting tool access. No write path exists for this role
  at all.

**Provisioning actual login credentials is an operational runbook, not a
migration file** (a migration is version-controlled and reviewed by
anyone with repo access — a password never belongs there). The runbook:

1. A database administrator creates a `LOGIN` role with a strong, randomly
   generated password, using your secrets manager to generate and store it
   — never typed into a terminal history or committed anywhere:
   ```sql
   CREATE ROLE plug_app_user WITH LOGIN PASSWORD '<from secrets manager>';
   GRANT plug_app_role TO plug_app_user;
   ```
   If your deployment already has an older `voguevibe_app_user` LOGIN role
   from before the 0030 rename, renaming it to match
   (`ALTER ROLE voguevibe_app_user RENAME TO plug_app_user;`) is a separate,
   deliberate operational step — migration 0030 does not do this for you
   (see that migration's own comment for why: it can't safely guess your
   actual LOGIN role's name or verify renaming it won't break an
   already-configured `DATABASE_URL`).
2. That connection string becomes `DATABASE_URL` in the deployment
   environment's secret store (never in `.env` files committed to git —
   `.env` is gitignored in this project specifically for this reason).
3. **Migrations run as a separate, more-privileged role** (schema owner —
   needs `CREATE TABLE`, `GRANT`, etc., which the low-privilege app role
   deliberately does not have). Set `MIGRATOR_DATABASE_URL` to that role's
   connection string when running `npm run db:migrate`; it should not be
   the same credential the running application uses.
4. **Credential rotation:** because privileges live on the `NOLOGIN` group
   role, rotating `plug_app_user`'s password (or replacing it with a
   new login role entirely) requires no re-running of `GRANT` statements —
   just update `DATABASE_URL` and restart the app. Grant the new login role
   membership in `plug_app_role`, cut over, then drop the old login
   role.
5. **Never expose the database to the public internet.** It should sit in
   a private subnet/VPC reachable only from the application's own network,
   with `DB_SSL=true` enforced for any connection that isn't purely local.

## 11. Connection management

`src/lib/db/pool.ts` — one `pg.Pool` per process, sized via `DB_POOL_MAX`
(default 10). **The critical constraint to reason about when scaling
horizontally:** `(number of running app instances) × DB_POOL_MAX` must
stay comfortably under Postgres's own `max_connections` (default 100 on a
stock install), leaving headroom for the migrator role, a readonly/BI
connection, and manual admin access. Concretely: 5 app instances × pool
max 10 = 50 connections — fine against a default 100-connection Postgres,
but this arithmetic must be re-checked any time instance count or pool
size changes. If instance count needs to grow beyond what this arithmetic
supports, introduce **PgBouncer** (connection pooling at the infrastructure
layer, transaction-pooling mode) between the app and Postgres rather than
raising `max_connections` indefinitely — a scaling trigger worth writing
down now: *if total desired app-side connections would exceed ~70% of
Postgres's configured `max_connections`, introduce PgBouncer next.*

Every pooled connection also gets a server-side `statement_timeout`
(`DB_STATEMENT_TIMEOUT_MS`, default 10s) — a runaway or accidentally
unindexed query is killed rather than holding a connection (and any locks)
indefinitely.

## 12. Pagination strategy

`catalog.repo.ts#listProducts` uses `LIMIT`/`OFFSET` pagination. This is a
deliberate, named tradeoff: `OFFSET` pagination degrades on very large
offsets (Postgres still has to scan and discard the first N rows), but at
realistic catalog sizes (thousands to low tens of thousands of products)
this is not yet a measurable problem, and `OFFSET` pagination is simpler to
reason about (jump to page 7 directly) than keyset/cursor pagination.
**Scaling trigger, written down now rather than guessed at later:** if
`EXPLAIN ANALYZE` on a deep-page product listing query (e.g. page 200 of
results) shows materially worse latency than page 1, switch that endpoint
to keyset pagination (`WHERE created_at < :last_seen ORDER BY created_at
DESC LIMIT :n`) — the schema already supports this without a migration,
since `orders_user_id_created_at_idx` and equivalent indexes already sort
by the columns keyset pagination would need.

## 13. Caching

**No caching layer (Redis) is introduced in this phase.** Two small
in-process caches exist in `catalog.service.ts` (`brandCache`/
`categoryCache` — slug-to-ID lookups for tiny, rarely-changing reference
tables) as a low-risk, measured optimization, not a general caching
strategy. Real caching (product listings, homepage content) is deferred
until there's a measured reason for it — see `docs/ARCHITECTURE.md`'s
stance on this generally. When it is introduced: product/category/brand
data are safe to cache with a short TTL or explicit invalidation on
admin writes; **inventory (`stock_qty`) must never be served from a cache
during checkout** — the concurrency strategy in §5 depends on reading live,
locked rows.

## 14. Backup and disaster recovery — what this codebase cannot do for you

This is infrastructure, not application code, and cannot be implemented or
tested from within this repository. What's documented here is the
requirement, not a working implementation:

- **RPO (Recovery Point Objective) target: ≤5 minutes** for order/payment
  data — achievable via continuous WAL archiving / point-in-time recovery
  (PITR), which most managed Postgres providers (RDS, Cloud SQL, Supabase,
  etc.) support natively; confirm and enable it explicitly, don't assume a
  default.
- **RTO (Recovery Time Objective) target: ≤1 hour** for a full database
  restore — this number is a starting assumption, not a measured result;
  it must be validated by actually performing a restore drill (see below).
- Automated daily full backups + continuous WAL archiving, retained ≥30
  days, encrypted at rest, stored in a separate failure domain (a different
  region/availability zone from the primary database).
- **Uploaded media (product images, campaign images) are NOT in Postgres**
  and are NOT covered by database backups — they need their own backup
  strategy once object storage (S3-compatible, per `docs/ARCHITECTURE.md`)
  is wired up.
- **"Backup jobs complete" is not the same as "backup is reliable."**
  Schedule a recurring (e.g. quarterly) restore drill: restore the most
  recent backup to a scratch environment, run the application's smoke
  tests against it, and time the whole process against the RTO target.
  This has not been done — there is no database to restore yet.

## 15. Scaling roadmap

| Trigger | Action |
|---|---|
| Read query latency degrades under production read load | Introduce a read replica; route `plug_readonly_role` traffic (and eventually read-only app queries like product listing) to it. |
| Total desired app-side connections approach ~70% of Postgres `max_connections` | Introduce PgBouncer (transaction pooling mode) between app instances and Postgres — see §11. |
| `activity_logs` or `order_items` grow large enough that sequential scans/vacuum start showing up in slow-query logs | Evaluate time-based partitioning (e.g. monthly partitions on `created_at`) — do NOT partition preemptively; these tables are indexed for their actual query patterns already and partitioning adds real operational complexity. |
| Product catalog search needs go beyond `plainto_tsquery` on name (fuzzy matching, faceted search, relevance tuning) | Introduce a dedicated search system (e.g. Postgres `pg_trgm` first as a low-effort step; Elasticsearch/Typesense/Meilisearch if requirements grow further) rather than stretching `tsvector` indefinitely. |
| Reporting/analytics queries start measurably impacting transactional (checkout-path) query latency | Separate the analytical workload — either the read replica from the first row, or a dedicated data warehouse fed by CDC/ETL, depending on how sophisticated the reporting needs become. |
| A single Postgres instance's write throughput becomes the bottleneck despite the above | This is the point to seriously evaluate sharding/multi-region — **not before**, and not speculatively designed for in this phase, per the brief's own instruction not to over-engineer for hypothetical scale. |

None of these triggers have been hit — there is no production traffic yet.
This table exists so the team knows what signal to watch for and what the
next concrete action is, not to imply any of this is imminent.

## 16. Testing strategy (what should run, once a real database exists)

None of the following has been executed in this sandbox (no Postgres
available — see the disclaimer at the top). All of it is meant to be run
as part of standing up the first real database:

**Constraint / corruption-attempt tests** (each should FAIL to insert/update — that's the pass condition):
```sql
-- Negative price
INSERT INTO products (slug, name, brand_id, category_id, price_cents)
VALUES ('test', 'Test', (SELECT id FROM brands LIMIT 1), (SELECT id FROM categories LIMIT 1), -100);
-- expect: CHECK constraint violation

-- Order total that doesn't match its own arithmetic
INSERT INTO orders (user_id, subtotal_cents, discount_cents, shipping_cents, total_cents, shipping_address_snapshot)
VALUES ((SELECT id FROM users LIMIT 1), 1000, 0, 500, 9999, '{}'::jsonb);
-- expect: orders_total_matches_arithmetic violation

-- Negative stock
UPDATE product_variants SET stock_qty = -1 WHERE id = (SELECT id FROM product_variants LIMIT 1);
-- expect: CHECK constraint violation

-- Duplicate SKU-equivalent (same product/size/color twice)
-- expect: product_variants_unique_combo violation on the second INSERT

-- Delete a brand that still has active products
DELETE FROM brands WHERE id = (SELECT brand_id FROM products WHERE active LIMIT 1);
-- expect: foreign key RESTRICT violation

-- Delete a user who has placed an order
DELETE FROM users WHERE id = (SELECT user_id FROM orders LIMIT 1);
-- expect: foreign key RESTRICT violation
```

**Concurrency test** (the "1,000 users, 1 item left" scenario, run with a
real client against a seeded low-stock variant — `seed.sql` deliberately
seeds one variant with `stock_qty = 3`):
- Fire N concurrent `POST /api/v1/orders` requests (each with a unique
  `Idempotency-Key`) for carts that each want that variant.
- Expected: at most 3 succeed; the rest receive a 409 with the "Only N
  left" message; `SELECT stock_qty FROM product_variants WHERE id = ...`
  afterward is exactly 0, never negative; `SELECT count(*) FROM orders
  WHERE ...` matches the number of successful requests exactly (no
  duplicates, no missing orders).

**Idempotency replay test:**
- Send the same `POST /api/v1/orders` request (same `Idempotency-Key`)
  twice, sequentially. Expected: identical `order.id` in both responses,
  and exactly one row in `orders`.
- Send it twice **concurrently** (simultaneously). Expected: one succeeds
  immediately, the other receives 409 ("already being processed") if it
  arrives before the first commits, or the same `order.id` if it arrives
  after.

**Migration tests:**
- Fresh database: `npm run db:migrate` from empty should apply all 7
  migrations cleanly and be re-runnable (idempotent — running it twice in a
  row should apply zero new migrations the second time).
- Re-run after a deliberately-interrupted migration (kill the process
  mid-migration) to confirm the failed migration's changes were rolled back
  and `schema_migrations` doesn't show it as applied.

**Cascade/restrict behavior tests:**
- Delete a category with children → children's `parent_id` becomes NULL,
  children rows still exist.
- Delete a product with variants → variants are gone (CASCADE), but any
  `order_items` referencing those variants still exist with `variant_id`
  now NULL and every snapshot field intact.

## 17. What changed from Phase 1 — summary for reviewers

| Phase 1 (in-memory) | Phase 2 (this document) |
|---|---|
| `src/lib/db/store.ts` (in-memory Maps, seeded on boot) | **Deleted.** Replaced by `db/migrations/*.sql` (schema) + `src/lib/db/repos/*.ts` (query layer). |
| `src/lib/mutex.ts` for inventory concurrency | **Deleted** (was unused by any code path, kept only as a reference pattern for a time). Real `SELECT ... FOR UPDATE` row locks in `orders.repo.ts`. |
| `src/lib/idempotency.ts` (in-memory Map) | **Deleted** (was unused by any code path, kept only as a reference pattern for a time). `idempotency_keys` table + transactional INSERT. |
| Sessions stored in an in-memory `Map` | `sessions` table (migration 0002); `tokens.ts` rewritten to be async and DB-backed. |
| Bootstrap Super Admin: random password printed to console on every boot | `db/scripts/create-super-admin.ts` — interactive, one-time, real credential provisioning. |
| No RBAC persistence | `permissions` / `role_permissions` reference tables (migration 0002), documented as reference-only (§3). |
| No per-admin grant override | `admin_permissions` table (migration 0044) + `hasPermissionForUser()` in http.ts. Per-admin grants overlay the role matrix; `admins.manage` / `system.manage` are non-grantable. |
| Every service function was synchronous or trivially async over an in-memory Map | Every service function now genuinely awaits a database round trip — this is a real behavioral change or a caller that forgot to `await` would be a real bug, not a type error (TypeScript catches most of these — see "Verification performed" — but this is exactly the kind of change worth flagging explicitly for review). |

## 18. Verification performed in this environment

- Every migration file's parentheses were counted and balanced
  automatically; every `COMMENT ON ... IS '...'` string literal was
  regex-verified for correctly-doubled internal apostrophes (`''`) — one
  real cross-reference bug (migration 0006 referred to "migration 0008,"
  which doesn't exist — should have said 0007) was found and fixed this
  way.
- Every snake_case column name referenced anywhere in
  `src/lib/db/repos/*.ts` was cross-checked programmatically against the
  columns actually defined in the migration files — zero mismatches found
  (they were written together, but this confirms no drift was introduced
  during editing).
- The **entire** rewired `src/` tree (all services, all routes, the new
  `db/pool.ts`/`db/client.ts`/`db/repos/*`) was type-checked with the real
  TypeScript compiler in strict mode (`--strict
  --noUncheckedIndexedAccess`), using hand-written minimal type stubs for
  `pg` and `next/server` (since neither package could be installed
  offline). This is the same technique used in Phase 1 and it again caught
  real issues before delivery (a missing re-export, a stub gap) — see the
  session log for specifics.
- `db/scripts/migrate.ts` and `db/scripts/create-super-admin.ts` were
  type-checked separately (they live outside `src/` and aren't part of the
  Next.js build).
- **Not performed, and cannot be performed here:** actually running
  `npm run db:migrate` against a live PostgreSQL server, `EXPLAIN ANALYZE`
  on any query, the concurrency/idempotency test scenarios in §16, a
  restore drill, or load testing. All of these require a real Postgres
  instance and, in most cases, network access this sandbox does not have.
  Treat every performance claim in this document ("this index serves that
  query") as a design intent verified by manual query-plan reasoning, not
  as a measured result — measure it for real before relying on it.
