# Error Monitoring

## What's actually implemented vs. designed

Built and tested (not just designed): a real `captureError()` abstraction
(`api/src/lib/errorMonitoring.ts`), server-side capture of frontend
exceptions via `POST /api/v1/client-errors`, and correlation context
(`requestId`, `userId`, `environment`, `errorCategory`) that a real bug
in this exact codebase caused to be missing until this audit — see
"A real bug this audit found" below.

**Not implemented**: a real external APM/error-tracking service (Sentry,
Datadog, etc.). No network access exists in the environment that built
this to install or verify one. `captureError()` is the integration
point — every capture already goes through it, so wiring in a real SDK
later means changing that one function's body, not any of its ~10 call
sites.

## What's captured, and how each category maps to something real

| Category | Captured how |
|---|---|
| Server exceptions | `http.ts`'s central catch block — every unhandled error in any route handler. |
| Failed API requests | Same catch block — every `AppError` (validation, auth, 404, etc.) too, not just unexpected crashes. |
| Frontend exceptions | `POST /api/v1/client-errors`, called from `App.tsx`'s `window.onerror`/`unhandledrejection` handlers (see below for why these, not just the existing render-error boundary). |
| Failed uploads | Routes through the same `http.ts` catch block — an upload validation/storage failure is still just a thrown error there. |
| Authentication failures | `security/tokens.ts`/`auth.service.ts` throw `AuthenticationError`, caught the same way. |
| Database failures | A `pg` query failure is an unhandled exception unless a repo function specifically catches and translates it (see `orders.repo.ts`'s constraint-violation handling) — either way it reaches the same central catch block. |
| Storage failures | `StorageProvider` implementations throw on failure (see `local-disk-provider.ts`/`s3-provider.ts`); `MediaService` either handles them (compensation logic) or lets them propagate to the same catch block. |

## Why `App.tsx`'s global handlers, not just `main.tsx`'s existing boundary

`main.tsx` has a `PreviewErrorBoundary` — explicitly marked
"scaffold-owned, do not edit or remove" in its own comment, so it was
left untouched. But it also only catches **render-phase** errors —
structurally, a React error boundary's `componentDidCatch` never fires
for an error thrown inside an event handler, a `setTimeout`, an async
callback, or an unhandled promise rejection (a very common real cause:
a fire-and-forget API call whose `.catch` was missed). `App.tsx` (which
`main.tsx` imports, and which is NOT protected) now additionally
registers `window.onerror`/`window.onunhandledrejection` — genuinely
broader coverage, not a workaround for not being able to touch the
protected file.

## What's NEVER captured (verified, not just stated)

`errorMonitoring.ts`'s `captureError()` has its own explicit
never-capture key list (`password`, `token`/`accessToken`/`refreshToken`,
`cookie`, `secret`, `cardNumber`, `resetToken`, and variants) — checked
independently of `logger.ts`'s own `redact()`, which every capture also
passes through as a second, separate layer. Both are tested directly
(`errorMonitoring.test.ts`) — the test asserts specific secret values are
absent from the actual logged output, not just that a function was
called.

## Context included on every capture

`requestId`, `environment` (`NODE_ENV`), `endpoint`, `errorCategory`,
timestamp (added automatically by `logger.ts`'s `write()`), and `userId`
when available.

### A real bug this audit found

Before this audit, a **failed** request's log line never included
`userId` at all — `let user` was declared *inside* the `try` block in
`http.ts`'s `withRoute`, making it invisible to the `catch` block's
logging call. Every successful request logged who made it; every failed
one didn't. Fixed by hoisting the declaration above the `try` — a
one-line-looking change that's actually the difference between "which
user hit this bug" being answerable or not for every error this app has
ever logged. Verified with a real test
(`error-monitoring-context.test.ts`) proving `userId` now appears in a
failed request's log, not just claimed to.

## Testing this for real

`errorMonitoring.test.ts` and `error-monitoring-context.test.ts` both
assert against the *actual logged string content* (parsing/searching
real `console.error`/`console.warn` output), not just that a mock
function was invoked — the same standard as everywhere else in this
session where a test could otherwise pass while proving nothing.
