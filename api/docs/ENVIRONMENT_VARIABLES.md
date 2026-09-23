# Environment Variables

Every variable actually read anywhere in this codebase (verified by
grepping `process.env.` across the backend and `import.meta.env.` across
the frontend — not assumed from `.env.example` alone, since a stale
example file could describe variables the code no longer reads, or omit
ones it does).

**Startup validation**: `api/src/lib/config.ts` validates required
production configuration at import time and refuses to boot if it's
missing or left at a localhost/dev default — see "Fails fast in
production" column below. This is enforced code, not just documentation;
see `config.ts` directly for the exact checks.

**Secrets are never logged.** Verified: no code anywhere logs
`process.env`, the `config` object, or an individual secret value.
`lib/logger.ts`'s `redact()` additionally strips known-sensitive key
names from any structured log metadata as a second layer, independent of
this.

## Backend (`api/`)

| Variable | Required in production? | Secret? | Dev default | Fails fast in production if missing/wrong? |
|---|---|---|---|---|
| `NODE_ENV` | Yes (must be `production`) | No | `development` | Everything below is gated on this being set correctly — an unset `NODE_ENV` means every production check below silently doesn't run. |
| `PORT` | No | No | `3001` | No — has a safe default either way. |
| `APP_URL` | **Yes** | No | `http://localhost:3001` | **Yes** — refuses to start if left at a `localhost`/`127.0.0.1` value in production. |
| `FRONTEND_ORIGIN` | **Yes** | No | `http://localhost:5173` | **Yes** — same check; this is what CORS/CSRF Origin validation checks every request against (see `security/csrf.ts`) — wrong or missing means every real request gets rejected, not a security hole. |
| `ACCESS_TOKEN_SECRET` | **Yes** | **Yes** | ephemeral random (dev only, logged as a loud warning) | **Yes** — throws if missing in production. |
| `REFRESH_TOKEN_SECRET` | **Yes** | **Yes** | ephemeral random (dev only) | **Yes** — same. |
| `ACCESS_TOKEN_TTL_SECONDS` | No | No | `900` (15 min) | No — has a safe default. |
| `REFRESH_TOKEN_TTL_SECONDS` | No | No | `1209600` (14 days) | No — has a safe default. |
| `COOKIE_DOMAIN` | **Yes** | No | `localhost` | **Yes** — refuses to start if left at `localhost` in production. |
| `COOKIE_SECURE` | **Yes** (must be `true`) | No | `false` | **Yes** — throws if not `true` in production (cookies must be HTTPS-only). |
| `TRUST_PROXY_HOPS` | No (defaults to the safe value) | No | `0` | No — `0` (trust nothing) is itself the safe default; see `security/csrf.ts`'s module comment and `.env.example` for why raising this incorrectly is a real vulnerability, not just a config nicety. |
| `STORAGE_PROVIDER` | No (`local` is valid for single-instance deployments) | No | `local` | Conditional — see the S3 block below; also warns (not throws) if still `local` in production. |
| `UPLOADS_DIR` | Only if `STORAGE_PROVIDER=local` | No | resolved to `<backend>/public/uploads` | No |
| `UPLOAD_MAX_BYTES` | No | No | `8388608` (8 MB) | No |
| `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` / `S3_PUBLIC_BASE_URL` | **Yes, if `STORAGE_PROVIDER=s3`** | `S3_SECRET_ACCESS_KEY` is a secret; the others are not | none | **Yes** — throws immediately (dev included, deliberately not softened for local testing) if `STORAGE_PROVIDER=s3` without all four. |
| `S3_REGION` | No | No | `auto` | No |
| `S3_ENDPOINT` | No (unset = real AWS S3) | No | unset | No |
| `S3_FORCE_PATH_STYLE` | No | No | `false` | No |
| `S3_KEY_PREFIX` | No | No | unset | No |
| `RATE_LIMIT_REDIS_URL` | No, but **required for correctness once more than one instance runs** | Arguably (contains no credential itself, but the reachable Redis instance is a real dependency) | unset (in-memory store) | No hard failure — see `docs/SECURITY.md`'s rate-limiting section for why an unset value silently means each instance enforces its own separate limit. |
| `DATABASE_URL` | **Yes** | **Yes** (contains the DB password) | `postgresql://localhost:5432/plug_dev` | **Yes** — throws if missing in production. |
| `MIGRATOR_DATABASE_URL` | No (falls back to `DATABASE_URL`) | **Yes** | unset | No — optional privilege-separation, not a hard requirement. |
| `DB_POOL_MAX` / `DB_POOL_MIN` / `DB_POOL_IDLE_TIMEOUT_MS` / `DB_POOL_CONN_TIMEOUT_MS` / `DB_STATEMENT_TIMEOUT_MS` | No | No | tuned defaults | No |
| `DB_SSL` | No (should be `true` for most managed Postgres providers) | No | `false` | No — not enforced, since some legitimate local/VPS setups genuinely don't need TLS to their own same-host database; document this in your own deployment runbook if your provider requires it. |

## Frontend (`web/`)

| Variable | Required in production? | Secret? | Notes |
|---|---|---|---|
| `VITE_API_BASE_URL` | **Yes** | No — this is a public value the browser itself sends requests to; it is not a credential | Must point at the real production API origin. Vite bakes `VITE_`-prefixed variables into the client bundle at build time — never put a real secret behind this prefix, since it would ship to every visitor's browser. |

## E2E (`e2e/`)

| Variable | Required for | Secret? |
|---|---|---|
| `E2E_FRONTEND_URL` | All tests | No — defaults to `http://localhost:5173` |
| `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` | Admin-gated tests only | **Yes** — a real admin account's credentials. Tests requiring these are skipped, not faked, when unset — see `e2e/README.md`. Never point these at a real production account. |

## Public vs. secret — the actual line drawn

**Secret** (never committed with a real value, never logged, never sent
to the frontend): `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`,
`DATABASE_URL`, `MIGRATOR_DATABASE_URL`, `S3_SECRET_ACCESS_KEY`,
`E2E_ADMIN_PASSWORD`.

**Public** (safe to expose, several are sent to the browser as-is):
`VITE_API_BASE_URL` (sent to every browser by design — it's baked into
the client bundle), `FRONTEND_ORIGIN`, `APP_URL`, `S3_PUBLIC_BASE_URL`
(this is, by definition, a public CDN/bucket URL, not a credential).

Every variable in `.env.example` is present with either an empty value, a
safe non-production placeholder (`localhost` URLs), or a clearly-labeled
non-secret default — never a real secret. This is a manually-maintained
invariant (there is no automated check enforcing it) — if you add a new
variable, keep it true by construction: never paste a real value into
`.env.example` in the first place, rather than adding one and remembering
to redact it later.
