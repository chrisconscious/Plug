/**
 * Centralized, validated environment configuration.
 *
 * The app MUST fail fast (at import time) if required secrets are missing in
 * production, rather than silently running with insecure defaults. This is a
 * deliberate "fail safe if critical configuration is missing" control.
 */

function required(name: string, fallbackForDev?: string): string {
  const value = process.env[name] ?? fallbackForDev;
  if (!value || value.trim() === "") {
    if (process.env.NODE_ENV === "production") {
      // Never boot in production without real secrets.
      throw new Error(`Missing required environment variable: ${name}`);
    }
    // In dev only, generate an ephemeral value so `next dev` still runs,
    // but warn loudly so nobody mistakes this for a real deployment.
    // eslint-disable-next-line no-console
    console.warn(
      `[config] WARNING: ${name} is not set. Using an insecure ephemeral dev value. ` +
        `This is only acceptable outside production.`
    );
    return fallbackForDev ?? require("crypto").randomBytes(48).toString("hex");
  }
  return value;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return fallback;
  return parsed;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === "true" || raw === "1";
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProduction: process.env.NODE_ENV === "production",
  appUrl: process.env.APP_URL ?? "http://localhost:3001",
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? "http://localhost:5173",

  auth: {
    accessTokenSecret: required("ACCESS_TOKEN_SECRET"),
    refreshTokenSecret: required("REFRESH_TOKEN_SECRET"),
    accessTokenTtlSeconds: int("ACCESS_TOKEN_TTL_SECONDS", 900),
    refreshTokenTtlSeconds: int("REFRESH_TOKEN_TTL_SECONDS", 1209600),
  },

  cookies: {
    domain: process.env.COOKIE_DOMAIN ?? "localhost",
    // MUST be true in production. Enforced below.
    secure: bool("COOKIE_SECURE", false),
  },

  rateLimit: {
    redisUrl: process.env.RATE_LIMIT_REDIS_URL ?? null,
  },

  uploads: {
    // Absolute directory where logo files are written on the local disk.
    // Falls back to <backend>/public/uploads/brands so the Next dev server
    // serves them at /uploads/brands/... without extra wiring.
    //
    // Portability note: this is *local disk* storage. It works fine on any
    // host with a persistent filesystem — a VPS, a dedicated server, or a
    // Docker container with a mounted volume. It will NOT survive on hosts
    // with an ephemeral/read-only filesystem between requests or deploys
    // (serverless platforms in general). Not a concern for a normal server;
    // only relevant if you later move to a serverless host.
    dir: process.env.UPLOADS_DIR ?? "", // resolved lazily in the driver
    // 8 MB — a generous, host-agnostic default for product photos. No
    // platform-specific number baked in here; raise it in .env via
    // UPLOAD_MAX_BYTES if you need larger images.
    maxBytes: int("UPLOAD_MAX_BYTES", 8 * 1024 * 1024), // 8 MB
    allowedImageTypes: ["image/png", "image/jpeg", "image/webp"],
    // Public base path (not a filesystem path) that maps to `dir`.
    publicPath: "/uploads/brands",
  },

  /**
   * Which StorageProvider implementation actually backs uploads — see
   * lib/storage/provider.ts. "local" (default) is dev-only; "s3" is the
   * production-safe, multi-instance-safe option (works with AWS S3,
   * Cloudflare R2, MinIO, or any S3-compatible endpoint).
   */
  /**
   * How many reverse proxies/load balancers sit between the internet and
   * this app, and therefore how many hops of X-Forwarded-For are actually
   * trustworthy. Defaults to 0 (trust nothing) — the safe default, since
   * blindly trusting these headers when the app IS directly reachable
   * lets any caller set an arbitrary IP and bypass IP-based rate limiting
   * entirely (each spoofed value gets its own fresh bucket). See
   * lib/http.ts's clientIp() for how this is actually applied — it is
   * NOT as simple as "trust the header when this is > 0": the correct
   * client IP is the entry `trustProxyHops` positions from the END of the
   * X-Forwarded-For chain, not the first entry (the first entry is always
   * the original, client-supplied value, which remains spoofable even
   * behind a real proxy that only ever APPENDS to the header).
   */
  trustProxyHops: int("TRUST_PROXY_HOPS", 0),

  storage: {
    provider: (process.env.STORAGE_PROVIDER ?? "local") as "local" | "s3",
    s3: {
      bucket: process.env.S3_BUCKET ?? "",
      region: process.env.S3_REGION ?? "auto",
      // Leave unset for real AWS S3. Set for R2/MinIO/other S3-compatible
      // endpoints, e.g. https://<account>.r2.cloudflarestorage.com.
      endpoint: process.env.S3_ENDPOINT || undefined,
      // R2/MinIO typically need this; real AWS S3 does not.
      forcePathStyle: bool("S3_FORCE_PATH_STYLE", false),
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
      // The URL the frontend will actually load images from — your
      // bucket's public URL/custom domain, or a CDN in front of it.
      publicBaseUrl: process.env.S3_PUBLIC_BASE_URL ?? "",
      // Optional: namespace all of this app's objects under one prefix if
      // the bucket is shared with other applications.
      keyPrefix: process.env.S3_KEY_PREFIX || undefined,
    },
  },

  email: {
    // "stub" (default) logs every email to the server console instead of
    // sending it — safe for local dev, NOT safe left as-is in production
    // (see the fail-fast check below and lib/email.ts's own module
    // comment). "resend" sends real email via the Resend API
    // (https://resend.com) — a plain REST call, no SDK dependency added.
    provider: (process.env.EMAIL_PROVIDER ?? "stub") as "stub" | "resend",
    resend: {
      apiKey: process.env.RESEND_API_KEY ?? "",
      // Must be a domain/address verified in your Resend account, or
      // Resend will reject every send — see .env.example.
      fromAddress: process.env.EMAIL_FROM_ADDRESS ?? "",
    },
  },

  database: {
    connectionString: required("DATABASE_URL", "postgresql://localhost:5432/plug_dev"),
    // Pool sizing: conservative defaults suitable for a single small
    // instance. See docs/DATABASE.md "Connection management" for how this
    // must be reasoned about once multiple app instances share one
    // Postgres server: (instances x poolMax) must stay comfortably under
    // Postgres's own `max_connections`.
    poolMax: int("DB_POOL_MAX", 10),
    poolMin: int("DB_POOL_MIN", 0),
    idleTimeoutMillis: int("DB_POOL_IDLE_TIMEOUT_MS", 30_000),
    connectionTimeoutMillis: int("DB_POOL_CONN_TIMEOUT_MS", 5_000),
    // Server-side safety net: a query that runs longer than this is killed
    // rather than allowed to hold locks/connections indefinitely.
    statementTimeoutMillis: int("DB_STATEMENT_TIMEOUT_MS", 10_000),
    ssl: bool("DB_SSL", false),
  },
} as const;

if (config.isProduction && !config.cookies.secure) {
  throw new Error(
    "Refusing to start: COOKIE_SECURE must be true in production (cookies must be HTTPS-only)."
  );
}

if (config.storage.provider === "s3") {
  const s3 = config.storage.s3;
  const missing = (["bucket", "accessKeyId", "secretAccessKey", "publicBaseUrl"] as const).filter((k) => !s3[k]);
  if (missing.length > 0) {
    // Always fail fast here, dev included: choosing STORAGE_PROVIDER=s3
    // without the credentials to back it isn't a safe default to fall
    // back from (unlike the dev-ephemeral-secret pattern used for auth
    // tokens above) — silently falling back to local disk would mean
    // uploads "work" locally and then behave completely differently
    // (or fail) the moment this runs on a second instance.
    throw new Error(
      `Refusing to start: STORAGE_PROVIDER=s3 requires ${missing.map((k) => `S3_${k.replace(/[A-Z]/g, (c) => "_" + c).toUpperCase()}`).join(", ")} to be set. See .env.example.`
    );
  }
} else if (config.isProduction) {
  // Not a hard failure — a single-instance VPS/dedicated-server deployment
  // with a persistent disk is a legitimate choice (see docs/deployment.md)
  // — but the operator should be making that choice deliberately, not by
  // omission.
  // eslint-disable-next-line no-console
  console.warn(
    "[config] WARNING: running in production with STORAGE_PROVIDER=local. " +
    "This only works correctly with a single instance and a persistent disk. " +
    "If this deployment scales to multiple instances or uses ephemeral storage, uploads WILL behave inconsistently. See docs/deployment.md."
  );
}

if (config.email.provider === "resend") {
  const missing = (["apiKey", "fromAddress"] as const).filter((k) => !config.email.resend[k]);
  if (missing.length > 0) {
    throw new Error(
      `Refusing to start: EMAIL_PROVIDER=resend requires ${missing.map((k) => (k === "apiKey" ? "RESEND_API_KEY" : "EMAIL_FROM_ADDRESS")).join(", ")} to be set. See .env.example.`
    );
  }
} else if (config.isProduction) {
  // Unlike storage, there's no legitimate production reason to still be
  // on the stub — real customers need real verification/password-reset
  // emails to actually arrive. This is a warning, not a hard failure
  // (a soft launch or admin-only pilot with no real customer email flow
  // yet is a real, if narrow, case), but it must never be silent —
  // lib/email.ts's own sendEmail() also logs this same warning on every
  // call for exactly this reason: someone watching logs should notice
  // immediately, not discover it when a customer says a verification
  // email never arrived.
  // eslint-disable-next-line no-console
  console.warn(
    "[config] WARNING: running in production with EMAIL_PROVIDER=stub. " +
    "Verification and password-reset emails are being logged to the server console, NOT delivered. " +
    "Set EMAIL_PROVIDER=resend (with RESEND_API_KEY and EMAIL_FROM_ADDRESS) before relying on real customer email flows."
  );
}

if (config.isProduction) {
  // Unlike storage-provider choice above (which has a legitimate
  // single-instance use case), there is no legitimate reason for a real
  // production deployment to still be pointed at localhost for these —
  // silently accepting the dev default here would mean CORS/CSRF reject
  // every real request from the actual production frontend (since
  // Origin validation checks against exactly this value — see
  // security/csrf.ts), producing a confusing, hard-to-diagnose full
  // outage instead of a clear, immediate startup error.
  const localhostDefaults: Array<[string, string]> = [
    ["APP_URL", config.appUrl],
    ["FRONTEND_ORIGIN", config.frontendOrigin],
  ];
  for (const [name, value] of localhostDefaults) {
    if (value.includes("localhost") || value.includes("127.0.0.1")) {
      throw new Error(
        `Refusing to start: ${name} is set to "${value}" in production. Set it to the real production URL — see .env.example.`
      );
    }
  }
  if (config.cookies.domain === "localhost") {
    throw new Error(
      "Refusing to start: COOKIE_DOMAIN is unset (defaulting to \"localhost\") in production. Set it to the real production domain — see .env.example."
    );
  }
}
