# Backup and Disaster Recovery

This is a design document, not a configured system — this environment has
no live production infrastructure (no cloud provider, no real Postgres
instance, no object storage account) to actually configure backups
against. What follows is concrete and actionable, not vague, but it has
not been executed; treat "define" and "document" as done, "configure" and
"test" as the next real steps for whoever operates the actual
infrastructure.

## Recovery objectives (defined, not left implicit)

| | Target | Why |
|---|---|---|
| **Recovery Point Objective (RPO)** | ≤ 5 minutes | Continuous WAL archiving (see below) makes near-zero data loss achievable at low cost — there's no good reason to accept more than a few minutes of loss for an e-commerce database where every lost minute is potentially lost orders. |
| **Recovery Time Objective (RTO)** | ≤ 1 hour for database; ≤ 4 hours for full application (including object storage/media) | A base backup restore + WAL replay for a database of this project's expected size (thousands, not billions, of rows) should complete well inside an hour; the wider 4-hour figure accounts for re-provisioning compute/networking/DNS if the disaster took out more than just the database. |

These are starting targets — the actual restore test below is what tells
you whether they're realistic for your specific infrastructure, not this
document.

## Backup strategy

- **Frequency**: continuous WAL (Write-Ahead Log) archiving + a full base
  backup daily. WAL archiving is what makes the 5-minute RPO possible —
  a daily-only full backup alone would mean up to 24 hours of potential
  loss, which is not acceptable for this application's data (orders,
  payments records, user accounts).
- **Retention**: 30 days of daily base backups + their WAL streams,
  7 years of monthly archives retained separately (a common baseline for
  financial/order records — check your actual jurisdiction's retention
  requirements before finalizing this number; this is not legal advice).
- **Encryption**: backups encrypted at rest (e.g., server-side encryption
  on whatever object storage holds them) AND in transit to that storage.
  The database itself should also use encryption at rest via the hosting
  provider's disk encryption — backups inherit no more security than the
  weakest link in this chain, so both ends need it, not just one.
- **Off-site storage**: backups must live in a different physical
  location/region than the primary database — a backup stored on the
  same host, or even the same region, does not protect against a
  region-level outage or account-level compromise. If using S3-compatible
  storage (this project already has that abstraction — see
  `docs/ARCHITECTURE.md`'s media section), enable cross-region
  replication on the backup bucket specifically, separate from the
  media/upload bucket.
- **Access control**: whoever/whatever can write backups should not
  automatically also be able to delete them (protects against a
  compromised application credential being used to destroy backups along
  with the data it's attacking) — use a separate, more restricted
  credential or bucket policy for backup deletion/lifecycle management
  than for the application's own database/storage credentials.

## Restoration procedure

**No credentials appear in this document** — every step below references
where to find a credential (a secrets manager, an environment variable
name), never the credential's actual value.

1. **Provision a new database instance** from the hosting provider (or a
   local Postgres for a restore drill) — do NOT restore onto the
   still-running production instance if the disaster is "production data
   is wrong/corrupted, not gone" — restore to a fresh instance first,
   verify it, then cut over.
2. **Restore the most recent base backup** onto that instance using your
   provider's restore tooling (e.g., `pg_basebackup`'s companion restore
   process, or your managed provider's "restore from snapshot" feature).
3. **Replay WAL segments** from the point of the base backup up to either
   the most recent available WAL, or a specific point in time if this is
   a "restore to just before the bad thing happened" scenario (point-in-
   time recovery) rather than "restore to as-current-as-possible."
4. **Run `npm run db:migrate`** against the restored instance (see
   `docs/MIGRATIONS.md`) — a backup taken before the most recent
   deployment will be missing any migrations applied since; the migration
   runner is idempotent and will apply only what's missing.
5. **Point the application at the restored instance** by updating
   `DATABASE_URL` (see `.env.example`) — in a real incident, this is a
   deployment-config change, not a code change.
6. **Verify** before declaring the incident resolved: run the health
   check endpoint, confirm recent orders are present (spot-check against
   whatever monitoring/logging captured order activity right before the
   incident — see the error-monitoring design once written), and confirm
   login/registration work end-to-end.

## Object storage (media) recoverability

Database backups alone are not enough — this application's uploaded
images live in object storage (S3-compatible; see
`docs/ARCHITECTURE.md`'s media section), not in Postgres. Recovering the
database without also recovering media would leave every product/hero/
lifestyle image broken.

- **Enable versioning** on the storage bucket — protects against an
  accidental overwrite or delete (including via this application's own
  `replaceMedia`/`removeMedia` logic, if a bug ever caused an unwanted
  delete) by keeping prior versions recoverable without needing a
  separate backup system at all.
- **Cross-region replication**, same reasoning as the database backups
  above — a single-region bucket doesn't survive a region-level outage.
- **The `media` table registry is itself a partial recovery aid**: since
  every real upload has a corresponding row (checksum, original
  filename, size), a restored database combined with a still-intact (or
  separately restored) storage bucket can be cross-checked using the
  existing orphan-detection system (`MediaService.findOrphans`, see
  `GET /api/v1/admin/media/orphans`) to identify any mismatch between
  what the database expects to exist and what's actually in storage
  after a partial recovery.

## Repeatable restore test — do this on a real schedule, not once

A backup that has never been restored is unverified, not a plan. This is
the actual test to run (quarterly, at minimum, and after any significant
schema change):

```bash
# 1. Provision a throwaway database instance (never the real production one).
# 2. Restore the most recent backup onto it (steps 1-3 above).
# 3. Run migrations:
cd api && DATABASE_URL=postgresql://<throwaway-instance> npm run db:migrate
# 4. Run the application's own health check against it:
curl http://<throwaway-instance-app-url>/api/v1/health
# 5. Spot-check real data survived: pick a handful of known order IDs /
#    user emails from before the backup was taken and confirm they're
#    present and correct in the restored instance.
# 6. Tear down the throwaway instance.
```

Record the actual wall-clock time this took, every time — that number,
not the RTO target above, is the honest current answer to "how long would
this really take," and it should trend toward the target over successive
drills, not be assumed to already meet it.

## What this document does NOT cover (stated, not hidden)

This is a design document. It has not been executed against real
infrastructure in this environment (none exists here to execute it
against). Specifically not done: no backup schedule is actually
configured anywhere, no restore has actually been performed, no actual
RTO/RPO has been measured — only targeted. Treat this as the plan to
execute, not a report of having already executed it.
