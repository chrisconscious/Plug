# Accessibility Audit

Code-level audit and fixes — no real screen reader or browser was
available in this environment to test actual announced behavior; every
fix below is grounded in what the JSX/ARIA actually says, verified by
reading it directly, not by running an automated checker (see "Not done"
below for what that would still need to confirm).

## Fixed

### Images with no accessible name (found via direct search, not assumed)

Checked every `<img>` in the frontend. All had *some* `alt` attribute
(good baseline), but 3 used `alt=""` on genuinely informative images —
where the image IS the content being managed, not decoration:

- `hero-content.tsx` (admin hero-slide thumbnails) — now uses the
  slide's headline/campaign label.
- `lifestyle-content.tsx` (admin lifestyle thumbnails) — now uses the
  lifestyle's name.
- `admin-pages.tsx` (product image editor thumbnails) — now uses
  position-aware text ("Product image 1 (primary)", "Product image 2").

`Cart.tsx`'s `alt=""` on the product thumbnail was checked and left
as-is — the adjacent `<b>{product name}</b>` already announces the
product name; adding "Photo of X" on the image next to visible text "X"
would be redundant, not more accessible.

### Form inputs with no real accessible name

Checked the highest-stakes flows first per the task's own list (login,
registration, checkout). Found every input across `Auth.tsx`,
`ForgotPassword.tsx`, `ResetPassword.tsx`, and `Checkout.tsx` (13 inputs
total) relied solely on `placeholder` text — not a reliable accessible
name (it disappears once typing starts, and isn't consistently
announced as a label by assistive tech). Added `aria-label` matching
each placeholder — a minimal fix with zero visual change, rather than
introducing visible `<label>` elements that would alter the existing
design.

### Modal dialog — no dialog semantics, no keyboard escape, unlabeled close button

The admin panel's `AddModal` (used for every "Add/Edit" flow — products,
brands, categories, admins) had:
- No `role="dialog"`/`aria-modal` — a screen reader had no way to know
  this was a dialog at all, or that page content behind it was now
  inert.
- No `aria-labelledby` connecting the dialog to its own title.
- No Escape-key handling — a keyboard-only or screen-reader user had no
  way to dismiss it except tabbing to and activating the close button.
- **The close button itself had no accessible name** — just an icon
  (`<X size={18} />`) with nothing else; a screen reader would announce
  it as bare "button," giving no indication of what it does.
- No focus movement into the dialog on open — focus stayed on whatever
  was behind it.

Fixed all five in one place (this one component backs every admin
add/edit modal, so the fix applies everywhere it's used): `role="dialog"`,
`aria-modal="true"`, `aria-labelledby` pointing to the title, `aria-label="Close dialog"`
on the close button, an Escape-key listener, and focus moved to the
dialog container on mount.

**Not done**: a full focus *trap* (keeping Tab cycling within the dialog
rather than escaping to the page behind it) — the fix above moves focus
in and handles Escape, but doesn't prevent Tab from eventually reaching
elements behind the overlay. A real trap needs tracking the dialog's
first/last focusable elements and intercepting Tab/Shift+Tab at the
boundary — a reasonable follow-up, not completed in this pass.

## Checked and found already correct

- Semantic landmark structure (`<header>`/`<main>`/`<nav>` via
  `StoreHeader`) — already present on every page checked.
- Buttons vs. links — spot-checked that navigation uses `<Link>`/`<a>`
  and actions use `<button>`, not the reverse (a common a11y bug: a
  `<div onClick>` styled as a button, invisible to keyboard nav
  entirely). No instances of that pattern found in the pages checked.

## Not done in this pass (stated plainly)

- **Automated accessibility checks** (axe-core or similar) — not wired
  into the test suite or CI. This is the single highest-value thing to
  add next: a real automated checker catches classes of issue (contrast
  ratios, ARIA misuse, missing landmark roles) that manual code reading
  will always miss some of.
- **Actual keyboard-only navigation testing** for the flows the task
  named (login, registration, product browsing, cart, checkout, admin,
  image upload) — no browser available here to tab through these for
  real. The fixes above address specific things a keyboard/screen-reader
  user would have hit, but "walked through it with a keyboard and
  confirmed" is a real, different, stronger standard than "read the JSX
  and fixed what's visibly wrong" — that walkthrough still needs to
  happen.
- **Color contrast** — not measured; would need either a running
  browser (devtools contrast checker) or the actual computed colors
  cross-referenced against WCAG ratios, neither done here.
- **Full modal focus trap** — see above.
- The admin panel's other, smaller interactive pieces (dropdowns, the
  drag-reorder controls on product images) were not individually
  audited — the modal and form-label fixes above were the highest-
  impact, most-broadly-applicable items found; a full pass over every
  remaining interactive element is a further follow-up.
