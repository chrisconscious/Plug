/**
 * Thin re-export so route/service call sites (`@/lib/audit`) don't need to
 * know whether the audit trail is backed by the database or (in earlier
 * phases) an in-memory array. The real implementation now lives in
 * db/repos/audit.repo.ts, backed by the append-only `activity_logs` table
 * (migration 0006) with UPDATE/DELETE revoked for the app role at the
 * database level (migration 0007) — see docs/SECURITY.md.
 */
export { recordAuditEvent, listAuditEvents } from "./db/repos/audit.repo";
