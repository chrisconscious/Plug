/**
 * Minimal, dependency-free (beyond `pg`) migration runner.
 *
 * Why not Prisma/node-pg-migrate/etc: this project was built in an
 * environment without npm registry access, so it deliberately uses only
 * `pg` (already a required runtime dependency for the app itself) rather
 * than adding a migration-framework dependency. If/when the team has
 * normal network access, swapping this for node-pg-migrate or Prisma
 * Migrate is a reasonable upgrade — the SQL files in db/migrations/ are
 * plain, framework-agnostic SQL and would carry over directly.
 *
 * Behavior:
 *  - Applies db/migrations/*.sql in filename order.
 *  - Tracks applied migrations in a `schema_migrations` table.
 *  - Each migration runs inside its own transaction; a failure rolls back
 *    that migration and STOPS (does not attempt later files) — a partially
 *    applied schema is treated as a stop-the-line event, not something to
 *    paper over by continuing.
 *  - Idempotent to re-run: already-applied migrations are skipped.
 *
 * Usage:  npm run db:migrate
 *
 * Connects using MIGRATOR_DATABASE_URL if set, else DATABASE_URL — see
 * docs/DATABASE.md "Database access control": migrations should run as a
 * privileged migrator role, not the low-privilege app runtime role, since
 * DDL (CREATE TABLE, GRANT, etc.) requires more than the app role has.
 */
import { readdirSync, readFileSync } from "fs";
import path from "path";
import { Client } from "pg";

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");

async function main() {
  const connectionString = process.env.MIGRATOR_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("Set MIGRATOR_DATABASE_URL or DATABASE_URL before running migrations.");
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  } catch (err) {
    console.error("Failed to create schema_migrations bootstrap table:", err);
    process.exit(1);
  }

  const { rows: appliedRows } = await client.query<{ filename: string }>(
    "SELECT filename FROM schema_migrations"
  );
  const applied = new Set(appliedRows.map((r) => r.filename));

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // filenames are zero-padded (0001_, 0002_, ...) so lexical sort == intended order

  let appliedCount = 0;
  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    console.log(`Applying ${file} ...`);
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
      appliedCount += 1;
      console.log(`  OK`);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`  FAILED — stopping. No later migrations were attempted.`);
      console.error(err);
      process.exit(1);
    }
  }

  console.log(
    appliedCount === 0
      ? "Database already up to date — no migrations applied."
      : `Applied ${appliedCount} migration(s).`
  );
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
