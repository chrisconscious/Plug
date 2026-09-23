# API Contract (v1)

**Source of truth**: every row below was extracted directly from the actual
`withRoute()` call in each route file (auth mode, RBAC permission, and rate
limit rule) — not hand-written from memory. Regenerate with the extraction
script noted at the bottom if routes change, rather than hand-editing this
table out of sync with the code.

Base URL: `VITE_API_BASE_URL` (frontend) / `http://localhost:3001` (dev).
All authenticated requests use httpOnly cookies (`credentials: 'include'`),
not a bearer token — see `docs/SECURITY.md` for the session model and
`../../src/lib/security/totp.ts` for the MFA second factor.

**Auth column key**:
- `none` — public, no session required.
- `optional` — works whether or not a session exists (e.g. logout).
- `required` — a valid session is mandatory; a request without one gets 401.
- `required (default)` — same as `required`, but the route relies on
  `withRoute`'s default (`options.auth ?? "required"`) rather than stating
  it explicitly. Functionally identical, flagged here only so it isn't
  mistaken for an oversight when reading the source.

**Permission column**: when set, the caller's role must have this RBAC
permission (see `src/lib/rbac.ts`) — this is in *addition* to being
authenticated, not instead of it.


### admin

| Method | Path | Auth | Permission | Rate limit |
|---|---|---|---|---|
| GET | `/api/v1/admin/activity-logs` | required | activity_logs.read | adminGeneral |
| POST | `/api/v1/admin/brands/[id]/logo` | required | brands.manage | adminGeneral |
| DELETE | `/api/v1/admin/brands/[id]/logo` | required | brands.manage | adminGeneral |
| PATCH | `/api/v1/admin/brands/[id]` | required | brands.manage | adminGeneral |
| GET | `/api/v1/admin/brands` | required | brands.manage | adminGeneral |
| POST | `/api/v1/admin/brands` | required | brands.manage | adminGeneral |
| GET | `/api/v1/admin/categories` | none | — | general |
| POST | `/api/v1/admin/categories` | required | products.create | adminGeneral |
| POST | `/api/v1/admin/hero-slides/[id]/image` | required | content.manage | adminGeneral |
| DELETE | `/api/v1/admin/hero-slides/[id]/image` | required | content.manage | adminGeneral |
| PATCH | `/api/v1/admin/hero-slides/[id]` | required | content.manage | adminGeneral |
| DELETE | `/api/v1/admin/hero-slides/[id]` | required | content.manage | adminGeneral |
| PUT | `/api/v1/admin/hero-slides/reorder` | required | content.manage | adminGeneral |
| GET | `/api/v1/admin/hero-slides` | required | content.manage | adminGeneral |
| POST | `/api/v1/admin/hero-slides` | required | content.manage | adminGeneral |
| POST | `/api/v1/admin/lifestyles/[id]/hero` | required | lifestyles.manage | adminGeneral |
| DELETE | `/api/v1/admin/lifestyles/[id]/hero` | required | lifestyles.manage | adminGeneral |
| PATCH | `/api/v1/admin/lifestyles/[id]` | required | lifestyles.manage | adminGeneral |
| DELETE | `/api/v1/admin/lifestyles/[id]` | required | lifestyles.manage | adminGeneral |
| GET | `/api/v1/admin/lifestyles` | required | lifestyles.manage | adminGeneral |
| POST | `/api/v1/admin/lifestyles` | required | lifestyles.manage | adminGeneral |
| POST | `/api/v1/admin/media/orphans/cleanup` | required | system.manage | adminGeneral |
| GET | `/api/v1/admin/media/orphans` | required | system.manage | adminGeneral |
| PATCH | `/api/v1/admin/orders/[id]` | required | orders.update | adminGeneral |
| GET | `/api/v1/admin/orders` | required | orders.read | adminGeneral |
| PATCH | `/api/v1/admin/payment-methods/[id]` | required | payment_methods.manage | adminGeneral |
| DELETE | `/api/v1/admin/payment-methods/[id]` | required | payment_methods.manage | adminGeneral |
| PUT | `/api/v1/admin/payment-methods/reorder` | required | payment_methods.manage | adminGeneral |
| GET | `/api/v1/admin/payment-methods` | required | payment_methods.manage | adminGeneral |
| POST | `/api/v1/admin/payment-methods` | required | payment_methods.manage | adminGeneral |
| POST | `/api/v1/admin/products/[id]/images` | required | products.update | adminGeneral |
| GET | `/api/v1/admin/products/[id]/images` | required | products.update | adminGeneral |
| PUT | `/api/v1/admin/products/[id]/images` | required | products.update | adminGeneral |
| PATCH | `/api/v1/admin/products/[id]` | required | products.update | adminGeneral |
| PUT | `/api/v1/admin/products/[id]` | required | products.update | adminGeneral |
| DELETE | `/api/v1/admin/products/[id]` | required | products.delete | adminGeneral |
| PATCH | `/api/v1/admin/products/images/[imageId]` | required | products.update | adminGeneral |
| DELETE | `/api/v1/admin/products/images/[imageId]` | required | products.update | adminGeneral |
| GET | `/api/v1/admin/products` | required | products.read | adminGeneral |
| POST | `/api/v1/admin/products` | required | products.create | adminGeneral |
| GET | `/api/v1/admin/settings/brand-section` | required | brands.manage | adminGeneral |
| PATCH | `/api/v1/admin/settings/brand-section` | required | brands.manage | adminGeneral |
| GET | `/api/v1/admin/stats` | required | orders.read | adminGeneral |
| GET | `/api/v1/admin/users` | required | users.read | adminGeneral |

### auth

| Method | Path | Auth | Permission | Rate limit |
|---|---|---|---|---|
| POST | `/api/v1/auth/forgot-password` | none | — | passwordReset |
| POST | `/api/v1/auth/login` | none | — | login |
| POST | `/api/v1/auth/logout` | optional | — | (none) |
| GET | `/api/v1/auth/me` | required | — | (none) |
| POST | `/api/v1/auth/mfa/disable` | required | — | (none) |
| POST | `/api/v1/auth/mfa/enable` | required | — | (none) |
| POST | `/api/v1/auth/mfa/setup` | required | — | (none) |
| POST | `/api/v1/auth/mfa/verify-login` | none | — | login |
| POST | `/api/v1/auth/refresh` | none | — | refresh |
| POST | `/api/v1/auth/register` | none | — | register |
| POST | `/api/v1/auth/resend-verification` | required | — | resendVerification |
| POST | `/api/v1/auth/reset-password` | none | — | passwordReset |
| POST | `/api/v1/auth/verify-email` | none | — | (none) |

### brands

| Method | Path | Auth | Permission | Rate limit |
|---|---|---|---|---|
| GET | `/api/v1/brands/[slug]` | none | — | general |
| GET | `/api/v1/brands` | none | — | general |

### cart

| Method | Path | Auth | Permission | Rate limit |
|---|---|---|---|---|
| PATCH | `/api/v1/cart/items/[itemId]` | required | — | general |
| DELETE | `/api/v1/cart/items/[itemId]` | required | — | general |
| POST | `/api/v1/cart/items` | required | — | general |
| GET | `/api/v1/cart` | required | — | general |

### categories

| Method | Path | Auth | Permission | Rate limit |
|---|---|---|---|---|
| GET | `/api/v1/categories` | none | — | general |

### health

| Method | Path | Auth | Permission | Rate limit |
|---|---|---|---|---|
| GET | `/api/v1/health` | none | — | (none) |

### hero-slides

| Method | Path | Auth | Permission | Rate limit |
|---|---|---|---|---|
| GET | `/api/v1/hero-slides` | none | — | general |

### lifestyles

| Method | Path | Auth | Permission | Rate limit |
|---|---|---|---|---|
| GET | `/api/v1/lifestyles/[slug]` | none | — | general |
| GET | `/api/v1/lifestyles` | none | — | general |

### orders

| Method | Path | Auth | Permission | Rate limit |
|---|---|---|---|---|
| GET | `/api/v1/orders/[id]` | required | — | general |
| GET | `/api/v1/orders` | required | — | general |
| POST | `/api/v1/orders` | required | — | orderCreate |

### payment-methods

| Method | Path | Auth | Permission | Rate limit |
|---|---|---|---|---|
| GET | `/api/v1/payment-methods` | none | — | general |

### products

| Method | Path | Auth | Permission | Rate limit |
|---|---|---|---|---|
| GET | `/api/v1/products/[id]` | none | — | general |
| GET | `/api/v1/products` | none | — | general |

### settings

| Method | Path | Auth | Permission | Rate limit |
|---|---|---|---|---|
| GET | `/api/v1/settings/brand-section` | none | — | general |

### super-admin

| Method | Path | Auth | Permission | Rate limit |
|---|---|---|---|---|
| PATCH | `/api/v1/super-admin/admins/[id]` | required | admins.manage | adminGeneral |
| GET | `/api/v1/super-admin/admins` | required | admins.manage | adminGeneral |
| POST | `/api/v1/super-admin/admins` | required | admins.manage | adminGeneral |

### wishlist

| Method | Path | Auth | Permission | Rate limit |
|---|---|---|---|---|
| DELETE | `/api/v1/wishlist/[productId]` | required | — | general |
| GET | `/api/v1/wishlist` | required | — | general |
| POST | `/api/v1/wishlist` | required | — | general |

## One flagged inconsistency (not a security issue, worth a decision)

`GET /api/v1/admin/categories` is public (`auth: none`) despite living
under the `/admin` path — every sibling admin route requires auth. It
returns the same non-sensitive data as the already-public
`GET /api/v1/categories`, so this is not a vulnerability, but the
duplication/inconsistency is worth a decision: either remove the admin
copy and have the admin UI call the public one, or make it consistent
with its sibling routes for its own sake.

## Request/response body shapes

This document currently covers **auth/permission/rate-limit only** —
verified as accurate. Full request/response body schemas for all 74
endpoints were not written into this pass (74 endpoints × request +
response shapes is a large, error-prone task to do by hand in one sitting;
doing it carelessly would produce a *wrong* contract, which is worse than
no contract). Until that's done, the authoritative body shapes are:
- **Request validation**: the `validateBody(...)` call in each route file.
- **Response shape the frontend expects**: the corresponding function in
  `web/src/lib/api.ts`.
A follow-up task should either extract both mechanically (similar to how
this table was built) into this document, or introduce a schema library
(zod is the natural fit — the project already hand-rolls comparable
validation in `lib/validate.ts`) that both generates this documentation
and enforces the shapes at runtime, closing the drift risk for good
instead of documenting it once and letting it go stale again.

## Regenerating this table

The extraction script used to build the tables above reads every
`export const METHOD = withRoute({...}, ...)` call under
`src/app/api/v1/**/route.ts` and parses its options object — ask for it
directly if this file needs refreshing after route changes.
