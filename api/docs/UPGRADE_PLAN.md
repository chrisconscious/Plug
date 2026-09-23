# Dependency Upgrade Plan

**This document is an audit and plan, not an executed upgrade.** This
environment has no network access — nothing here has been run against a
real npm registry, a real CVE database, or a real build. Every version
claim below is either (a) something in this repo's own `package.json`/
lockfile, which is directly verifiable, or (b) something from the author's
training data with a training cutoff of January 2026 — which can be, and
must be, wrong or stale by the time this is actually read. **Before acting
on this plan, re-verify every claim below against `npm audit`, the Next.js
security advisories (`https://github.com/vercel/next.js/security/advisories`),
and the GitHub Advisory Database — those are the actual source of truth,
not this document.**

## 1. Current versions (verified directly from this repo)

| Package | Current | Location |
|---|---|---|
| `next` | `^14.2.5` | `api/package.json` |
| `react` / `react-dom` | `^18.3.1` | both `api/` and `web/` |
| `typescript` | `^5.5.4` (api) / `^5.8.3` (web) | both |
| `pg` | `^8.12.0` | `api/package.json` |
| `vite` | `^5.4.19` | `web/package.json` |
| `react-router-dom` | `^6.30.1` | `web/package.json` |
| `ioredis` | `^5.4.1` | `api/package.json` (added this session) |
| `@aws-sdk/client-s3` | `^3.687.0` | `api/package.json` (added this session) |

The `^` ranges mean the *lockfile* — not this table — is the actual source
of truth for what's really installed. Check `api/package-lock.json` and
`web/package-lock.json` directly for exact resolved versions before
deciding anything is or isn't already patched.

## 2. The one specific, known, critical finding worth calling out by name

**Next.js middleware authorization-bypass advisory (disclosed March 2025,
commonly referenced as CVE-2025-29927), affecting Next.js versions before
14.2.25 and before 15.2.3.** The vulnerability allowed a crafted
`x-middleware-subrequest` header to cause Next.js to skip middleware
execution entirely.

**Why this specific app should check this first, not last:** this app's
`src/middleware.ts` is not decorative — it handles CORS preflight AND
ensures the CSRF cookie exists on every response (see `security/csrf.ts`).
A middleware-bypass vulnerability in a version predating the patch would
mean CSRF protection could be circumvented on **every state-changing
route**, not just some.

**Action, in order:**
1. Check the *actual resolved* Next.js version in `api/package-lock.json`
   (not just the `^14.2.5` range in `package.json`).
2. If it resolves to anything before `14.2.25`, this is a same-day,
   drop-everything patch — not part of a larger planned upgrade. Patch
   releases within the 14.2.x line are extremely low breaking-change risk.
3. Re-verify this specific advisory against the official Next.js security
   advisory page directly — do not trust this document's characterization
   of severity/version ranges as still accurate; advisories get amended.

## 3. Recommended upgrade path — patch first, defer the major version

**Phase 1 (low risk, do this regardless of anything else): patch within
Next.js 14.2.x** to the latest 14.2.x patch release. This closes any
disclosed CVEs in the 14.2 line without touching the App Router API
surface this codebase depends on (every route file uses the stable
`withRoute`/`NextRequest`/`NextResponse` pattern — none of that changes
within a patch release).

**Phase 2 (real work, do deliberately, not reflexively): Next.js 15.**
Do NOT bundle this with Phase 1. Next.js 15 made several previously
synchronous APIs asynchronous — most relevantly, dynamic route params and
`cookies()`/`headers()` became `Promise`-returning. This codebase's
`withRoute` wrapper (`src/lib/http.ts`) centralizes exactly the kind of
access that would need auditing: `routeArgs?.params`, and any direct
`cookies()`/`headers()` calls in `security/tokens.ts` and elsewhere.
**Every one of the ~74 route files in `docs/api/CONTRACT.md` needs to be
checked for this pattern, not just `http.ts` itself** — `withRoute` reads
`params` once centrally, but if any individual route handler destructures
or re-reads request data in a way that assumed synchronous access, it
needs the same fix. This is genuine, non-trivial audit work, not a
one-line version bump.

**Do not upgrade React to 19 as part of this.** React 18.3.1 has no
known critical CVEs in this author's training data, and pairing it with
a Next.js major upgrade at the same time makes it much harder to isolate
which change caused a given regression if something breaks. Upgrade
React separately, later, once Next.js 15 is stable in this app — Next.js
15 doesn't strictly require React 19 in the App Router the way some
announcements implied, but verify current compatibility requirements
against Next.js's own documentation before upgrading either alone.

**Vite** (`web/`): patch within the 5.x line for the same reason as
Next.js above — Vite's dev-server-specific CVEs (historically, path
traversal / `server.fs` bypass issues in various 4.x/5.x releases) are
lower real-world severity for this app specifically, since they affect
`vite dev`, not the production build this app actually ships — but the
patch cost is low, so there's no reason to defer it.

## 4. What this plan deliberately does NOT include

- **No blind `npm update` / `npm upgrade --latest` across the board.** The
  task was explicit about this, and it's the right call regardless: a
  sweeping update makes it impossible to attribute a regression to a
  specific change, and several dependencies here (`react-router-dom` v6 vs
  the v7/"Router 7" rename, for instance) have their own independent
  breaking-change timelines unrelated to Next.js at all.
- **No automatic resolution of peer-dependency conflicts.** If `npm
  install` reports conflicts during Phase 2, resolve them by reading what
  the conflict actually is, not by adding `--legacy-peer-deps` or
  `--force` as a default reflex — either can silently mask a real
  incompatibility.

## 5. After any upgrade — exact commands, run in this order

```bash
# From a clean checkout (never against a partially-modified working tree):
rm -rf node_modules
npm ci                          # from the lockfile — see docs/DEVELOPMENT.md if this fails; see §6 below
npm run typecheck                # must be zero errors — see §6 for how to triage any that appear
npm run lint
npm run build
npm test                         # or `npm run test:ci` if a CI-specific script exists
npm audit                        # review, don't blindly `npm audit fix --force`
```

Then, specifically because of what changed:
- **Inspect `src/middleware.ts` and every place `withRoute` is used** —
  confirm CORS headers, the CSRF cookie-ensure logic, and rate limiting
  all still fire correctly (a middleware-bypass-class regression would be
  silent otherwise — nothing throws, requests just skip protection).
- **Inspect `security/csrf.ts` and `security/tokens.ts`** — re-run
  `src/lib/security/csrf.test.ts`, `http-csrf.test.ts`, and
  `auth-routes.test.ts` specifically; these are the tests most likely to
  catch a subtle behavior change from an App Router API surface shift.
- **Inspect every upload route** (`admin/products/[id]/images`,
  `admin/brands/[id]/logo`, `admin/hero-slides/[id]/image`,
  `admin/lifestyles/[id]/hero`) — `FormData`/`Blob` handling has had
  subtle behavior differences across Next.js versions in the past; re-run
  `image.test.ts` and the domain-specific upload integration tests.
- **Inspect response headers/CSP** — re-run whatever confirms
  `X-Frame-Options`/CSP/`Access-Control-Allow-*` headers are still set
  exactly as before (see `applySecurityHeaders` in `http.ts`).

## 6. If `npm ci` or `npm run typecheck` fails after an upgrade

Diagnose before reaching for a suppression. In order of likelihood:

1. **Lockfile out of sync with package.json** — `npm ci` will say so
   explicitly ("`npm ci` can only install packages when your
   package.json and package-lock.json are in sync"). Fix: resolve the
   actual version you want, update package.json, run `npm install`
   (not `ci`) once to regenerate the lockfile consistently, commit both
   files together.
2. **A genuine breaking API change** (e.g. a newly-async API used
   synchronously) — the type error will point at the exact call site;
   fix the call site to match the new API, don't suppress the error.
3. **A stale import path** (a package restructured its exports) — the
   error will be "module not found" or "no exported member," not a type
   mismatch; check that package's own changelog for the new import path.
4. **A genuine version conflict between two dependencies' peer
   requirements** — `npm ls <package>` shows the conflicting resolved
   versions; resolve by aligning both to a mutually-compatible version,
   not by forcing installation past the conflict.

**Never** resolve any of these by adding `@ts-ignore`, disabling a lint
rule, loosening `tsconfig.json` strictness, or deleting the failing
functionality. If a fix genuinely isn't possible without a real upgrade
cycle, that itself is the finding to report — not something to paper over.
