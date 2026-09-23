# PLUG — storefront & admin frontend

React + Vite single-page app. Talks to the API (`../api`) over HTTP only —
see `.env` / `.env.example` for `VITE_API_BASE_URL`.

## Structure

```
src/
  App.tsx              Router only — route path -> page mapping. No business
                        logic lives here; see pages/ for that.
  pages/                One file per route (extracted from what used to be
                        a single ~1200-line App.tsx):
    ProductDetail.tsx     /product/:id
    Cart.tsx               /cart
    Checkout.tsx            /checkout (+ its PaymentStep/CheckoutSummary/
                             CopyNumber sub-components — Checkout-specific,
                             kept in the same file rather than fragmented)
    Confirmation.tsx        /order-confirmation
    Auth.tsx                 /login, /register
    VerifyEmail.tsx          /verify-email
    ForgotPassword.tsx       /forgot-password
    Profile.tsx              /profile
    Orders.tsx               /orders
    Wishlist.tsx             /wishlist
    Brands.tsx               /brands (+ BrandCard, brandMark helper)
    Backoffice.tsx           every /admin/* and /super-admin/* route (shared
                             sidebar shell; the actual screen per section is
                             lazy-loaded from components/admin/*)
    Index.tsx, NotFound.tsx  home page, 404
  components/
    shop/                 Storefront UI shared across pages (StoreHeader,
                          ProductCard, ProductListingPage, FilterSidebar)
    admin/                 Admin/backoffice screens, lazy-loaded so their
                          code never ships in the customer bundle
    lifestyle/             "Shop by Lifestyle" feature UI
    ui/                     Generic shadcn/ui primitives (buttons, dialogs,
                          etc.) — not business logic, safe to treat as a
                          vendored library
  lib/
    api.ts                 The one HTTP client to the backend — every
                          backend call in the app goes through this file
    adminNav.ts             Admin/Super-Admin sidebar nav data (shared
                          between App.tsx's router and Backoffice.tsx)
    currency.ts, links.ts, shop.ts, wishlist.ts, imagePlaceholder.ts,
    category-icons.ts, analytics.ts, utils.ts
  hooks/                   Small reusable React hooks
```

## Status

This is a working frontend already connected to a real backend (`../api`) —
real authentication (cookie-based sessions + TOTP MFA for Admin/Super
Admin), a real PostgreSQL-backed catalog/cart/order flow, and real file
uploads. It is not a disconnected prototype. See the top-level `README.md`
for how to run both apps together, and `../api/docs/` for backend details.
