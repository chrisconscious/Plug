# Performance Audit

Static analysis and code-level fixes — no live server/browser/database was
available in the environment that did this audit to measure real
wall-clock latency or bundle size. Every finding below is either a
structural fact (a query pattern, a missing/present index) verified by
reading the actual code and schema, or a fix verified by tracing the
before/after query count by hand. "Measure before and after" per the
task's own instruction means: once this runs for real, confirm these
fixes actually reduced query counts/payload size in practice — that
step has not been done here.

## Fixed — real, found issues

### N+1: wishlist product loading (fixed)

`wishlist.service.ts`'s `serializeWishlist` called a per-item product-
assembly function once per wishlist item. That function did **6 queries
internally**, including two full, unfiltered `brands`/`categories` table
scans — repeated per item. A 20-item wishlist meant roughly **120
queries** for one page load.

Fixed with a genuinely batched `getPublicProductsByIds` (one query per
data type, covering the whole set of ids, not one round per id) —
verified with tests asserting `listBrands`/`listCategories` are each
called exactly once regardless of item count, and that each product's
own brand/variants/images are correctly attributed (no data mixing
between products, which a naive batching attempt could get wrong).

The now-redundant per-item function was removed rather than kept
alongside the batched one, to avoid two parallel implementations of the
same assembly logic drifting apart over time.

### Missing pagination: admin users list (fixed)

`listAllUsersWithStats` fetched every user in the database
unconditionally, on every admin panel load, regardless of how many
customers exist. Added real `LIMIT`/`OFFSET` pagination, with
`COUNT(*) OVER()` for the total row count in the same query (avoiding a
second round-trip just to know how many pages exist). Capped at 100
rows/page even without an explicit `pageSize`.

**Honest limitation**: no pagination *UI* (page number controls) was
built in the admin table — the frontend currently just requests
`pageSize=100` as a stopgap so nothing regresses for a small-to-medium
customer base, while still bounding the worst case. Real pagination
controls in the admin customers table are a follow-up, not done here.

## Checked and confirmed NOT an issue (a real audit outcome, not a gap)

### Database indexes on foreign keys

Every foreign-key column across all 28 migrations was extracted and
cross-checked against every `CREATE INDEX` statement. The static check
surfaced 7 "unindexed FK" candidates; each was individually verified
against real query patterns before concluding anything:

- `brand_logos.brand_id` — false positive: it has a `UNIQUE` constraint,
  which Postgres backs with its own index automatically.
- `homepage_brand_settings.updated_by` / `homepage_promo_banner.updated_by`
  — false positive: both are singleton tables (exactly one row, ever,
  by design). An index on a one-row table has no possible benefit.
- `cart_items.variant_id`, `wishlist_items.product_id`,
  `order_items.variant_id`, `idempotency_keys.user_id` (alone, not as
  part of the composite key it's actually part of) — genuinely
  unindexed, but **also genuinely unused by any current query path** in
  this codebase. Adding an index for a query that doesn't exist yet
  would be exactly the premature optimization the task explicitly said
  not to do (every index has a real write/storage/vacuum cost). If a
  future feature needs "how many carts contain variant X" or similar,
  add the index alongside that feature, not speculatively now.

**The columns that ARE hit by real, frequent queries are not just
indexed but well-indexed**: `orders (user_id, created_at DESC)` is a
composite index matching the *exact* shape of the real "list my orders,
most recent first" query — not just "an index exists somewhere on this
table." `sessions.user_id`, `cart_items.user_id`, `wishlist_items.user_id`
are all properly indexed too.

### Duplicate frontend requests

Checked whether more than one component on the same page independently
fetches the same data (e.g., both the header and a page-specific
component separately calling `listCategories()`). Found none — each of
`listCategories()`/`listBrands()`'s three call sites
(`category-circles.tsx`, `ProductListingPage.tsx`, `admin-pages.tsx`) is
on a different page, not duplicated within one page load.

## Not done in this pass (stated, not hidden)

- **Frontend bundle size** — no build was run in this environment to
  measure it (see `docs/UPGRADE_PLAN.md`'s standing note on why: no
  `node_modules` here, no network to install one). Run `npm run build`
  and inspect the output size/warnings for real numbers.
- **API/database latency** — no live server or database to measure
  actual response times against.
- **Rendering performance** (React re-render frequency, memoization
  opportunities) — not profiled; would need a real browser + React
  DevTools Profiler.
- **Responsive images / image format optimization** — uploaded images
  are stored and served as-uploaded (see `security/image.ts`); no
  resizing/format-conversion (e.g., WebP transcoding, multiple
  resolutions for `srcset`) happens anywhere in the upload pipeline.
  This is a real, known gap, not silently ignored — it just wasn't
  fixed in this pass given the scope already covered. Fixing it
  properly would need a real image-processing library (e.g. `sharp`),
  which — same limitation as EXIF stripping earlier this session — this
  environment has no network access to install.
- **API response minimization** — not systematically reviewed for
  over-fetching (returning fields a given caller never uses) beyond the
  admin-only/public-view field splitting already documented in
  `docs/SECURITY.md` and `ARCHITECTURE.md`.
