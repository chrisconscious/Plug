# Database Migrations

## Audit results (verified directly, not assumed)

- **27 migrations, `0001` through `0027`, sequentially numbered with no
  gaps.** Verified by listing the directory and checking the sequence
  directly, not assumed from file count.
- **Zero destructive operations anywhere.** Every migration was checked
  for `DROP TABLE`, `DROP COLUMN`, `DELETE FROM`, `TRUNCATE` — none exist
  in any of the 27 files. Every migration is additive (`CREATE TABLE`,
  `ALTER TABLE ... ADD COLUMN`, `CREATE INDEX`, `ALTER TABLE ... ADD
  CONSTRAINT`). This is a deliberate, verified property, not incidental —
  see "Rollback strategy" below for why it matters.
- **No manual/undocumented schema changes found.** Every table name
  referenced in real SQL across the entire repo layer (`src/lib/db/repos/`)
  was extracted and cross-checked against every `CREATE TABLE` across all
  27 migrations — all resolve to a real migration. There is no schema
  element in this application that isn't represented by a migration file.

## How migrations are applied

`db/scripts/migrate.ts` (see its own header comment for full detail):
sequential, filename-ordered, each in its own transaction, tracked in a
`schema_migrations` table, idempotent to re-run (already-applied files are
skipped), and stops immediately on the first failure rather than
attempting later files against a partially-applied schema.

```bash
cd api
DATABASE_URL=postgresql://... npm run db:migrate
```

Use `MIGRATOR_DATABASE_URL` instead of `DATABASE_URL` in production if the
migration role should have different (elevated) privileges than the
application's runtime role — see `docs/DATABASE.md`'s database-access
section for why the app's own runtime role should NOT be able to run DDL.

## Testing from an empty database

This is the actual, complete test the task asked for — do this before
trusting any change to `db/migrations/`:

```bash
# 1. A genuinely empty database (adjust for your Postgres setup):
createdb plug_migration_test
export DATABASE_URL=postgresql://localhost/plug_migration_test

# 2. Zero database -> all migrations:
cd api && npm run db:migrate
# Expect: every migration reports "OK", ending in
# "Applied 27 migration(s)." — not an error, not a partial count.

# 3. -> seed/test data:
npm run db:seed
# This is dev/test-only seed data (db/seed.sql). Never run it against a real
# production database — all real products are created from the admin panel.

# 4. -> application:
npm run dev
# Manually verify: the homepage loads (hero slides, categories, brands,
# lifestyles all render from the seeded data), an account can register,
# and an admin can log in (see db/scripts/create-super-admin.ts if no
# admin account was seeded).

# Cleanup:
dropdb plug_migration_test
```

**This procedure has not been executed in the environment that wrote this
document** — no live Postgres is available here (see
`docs/UPGRADE_PLAN.md`'s honesty note for the same underlying limitation).
Run it for real before trusting that 27 migrations genuinely apply
cleanly end to end; static review (the audit above) is not the same
guarantee as actually running them.

## Rollback strategy

**This project does not implement down-migrations (no rollback SQL per
migration), and that is a deliberate choice given the audit above, not an
oversight:**

- Every migration is additive. Old application code continues to run
  correctly against a newer schema (extra columns/tables it doesn't know
  about are inert to it) — which means **rolling back the application
  code does not require rolling back the schema**. This is the actual
  rollback strategy for the overwhelming majority of deployments: revert
  the app version, leave the schema as-is.
- For the rare migration that genuinely needs to be undone (e.g., a
  column was added with the wrong type), the correct fix is a **new
  forward migration** that corrects it (`0028_fix_whatever.sql`), not a
  down-migration that tries to reconstruct the pre-migration state — a
  reconstruction is exactly the kind of destructive operation this
  project's migrations have deliberately avoided throughout.
- **If data loss occurs** (a bad migration genuinely corrupts data, not
  just adds an unwanted column) — that is a restore-from-backup scenario,
  not a migration-rollback scenario. See the disaster-recovery plan
  (once written) for that procedure specifically.

If a future migration ever needs to be genuinely destructive (a real
`DROP COLUMN`, a data-lossy `ALTER`), it must: (1) be reviewed with extra
scrutiny given every prior migration in this project has avoided this,
(2) be preceded by a verified, tested backup, and (3) ideally ship as two
migrations — one that stops writing to the old column/table while still
keeping it, a deploy cycle, then one that actually removes it — so a
rollback of the *application* alone (without a schema rollback) still
works during the transition.

## CI validation

`npm run check:migrations` (see `scripts/check-migrations.mjs`) runs a
real, static check on every migration file: sequential numbering with no
gaps, valid `.sql` extension, and a paren/quote balance sanity check
(catches an unterminated string or unbalanced parenthesis before it ever
reaches a real database). This is NOT a substitute for actually running
migrations against a real Postgres instance in CI — see
`docs/CI_PIPELINE.md` for where that belongs in the full pipeline.
