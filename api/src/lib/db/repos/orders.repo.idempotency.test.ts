import { describe, it, expect, vi } from "vitest";

/**
 * SCOPE OF THESE TESTS — read before extending them.
 *
 * The actual concurrency GUARANTEE for duplicate order submissions is a
 * database-level one: idempotency_keys' composite PRIMARY KEY
 * (scope, user_id, idempotency_key) means Postgres itself allows only
 * ONE of two simultaneous INSERTs to succeed. That guarantee — and the
 * equivalent one for stock (SELECT ... FOR UPDATE OF pv serializing
 * concurrent access to the same variant row) — cannot be meaningfully
 * exercised by a mocked unit test: mocking the DB client would mock
 * away exactly the row-locking behavior under test. Proving those
 * requires a genuine integration test against a real Postgres instance
 * running two real concurrent transactions, which this environment does
 * not have (no DATABASE_URL, no reachable server) — see this session's
 * audit notes for that explicit limitation; it is not being silently
 * skipped or claimed as passing.
 *
 * What IS meaningfully testable without a database is the APPLICATION
 * logic that runs after Postgres reports the conflict: does the losing
 * request correctly look up the winner's outcome and either (a) return
 * the same order the winner already created (the desired idempotent
 * result for a genuine double-click/retry), or (b) reject cleanly if
 * the reused key actually belongs to a different request (the
 * fingerprint mismatch case), or (c) report "already being processed"
 * if the winner hasn't finished yet. That branching is pure JS logic
 * over whatever the DB layer returns, so it mocks cleanly — these tests
 * cover exactly that branching, not the row lock itself.
 */

vi.mock("../client", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  withTransaction: vi.fn(),
  isPgErrorCode: (err: unknown, code: string) =>
    typeof err === "object" && err !== null && (err as { code?: string }).code === code,
  PG_ERROR_CODES: { UNIQUE_VIOLATION: "23505" },
}));
vi.mock("./audit.repo", () => ({ recordAuditEventOnClient: vi.fn() }));
vi.mock("./coupons.repo", () => ({}));

import { queryOne, withTransaction } from "../client";
import { createOrderTransactional } from "./orders.repo";

const baseArgs = [
  "user-1",
  "idem-key-1",
  { label: "Home", line1: "1 Main St", city: "Dar es Salaam", region: "Dar es Salaam", postalCode: "00000", country: "TZ", phone: "0756000000" },
  "pm-1",
  null,
  "fingerprint-abc",
  "dar_es_salaam" as const,
] as const;

describe("createOrderTransactional — idempotency conflict resolution", () => {
  it("returns the winning transaction's own order when the same request is retried after it already completed", async () => {
    // Simulates: this request lost the race for the idempotency key
    // (Postgres reported a unique-violation), and by the time we look,
    // the WINNING request already committed a real order.
    (withTransaction as any).mockImplementation(async (fn: any) => {
      const fakeClient = {
        query: vi.fn().mockImplementation(() => {
          const err = new Error("duplicate key value") as Error & { code: string };
          err.code = "23505";
          throw err;
        }),
      };
      // The real function's own inner try/catch converts this into its
      // IdempotencyKeyClaimConflict, which propagates out of the
      // transaction callback exactly as a real ROLLBACK would.
      return fn(fakeClient);
    });

    const winningOrder = { id: "order-winner", status: "PENDING", totalCents: 15000 };
    (queryOne as any).mockResolvedValue({
      status: "COMPLETED",
      response_body: winningOrder,
      request_fingerprint: "fingerprint-abc", // matches — same request, not a key reused for something else
    });

    const result = await createOrderTransactional(...baseArgs);
    expect(result).toEqual(winningOrder);
  });

  it("rejects with a clear error when the same idempotency key was already used for a genuinely different request", async () => {
    (withTransaction as any).mockImplementation(async (fn: any) => {
      const fakeClient = {
        query: vi.fn().mockImplementation(() => {
          const err = new Error("duplicate key value") as Error & { code: string };
          err.code = "23505";
          throw err;
        }),
      };
      return fn(fakeClient);
    });

    (queryOne as any).mockResolvedValue({
      status: "COMPLETED",
      response_body: { id: "order-other", status: "PENDING", totalCents: 99999 },
      request_fingerprint: "a-totally-different-fingerprint",
    });

    await expect(createOrderTransactional(...baseArgs)).rejects.toThrow(
      /already used for a different request/i
    );
  });

  it("reports a conflict (not a silent success or a raw 500) when the winning request is still in flight", async () => {
    (withTransaction as any).mockImplementation(async (fn: any) => {
      const fakeClient = {
        query: vi.fn().mockImplementation(() => {
          const err = new Error("duplicate key value") as Error & { code: string };
          err.code = "23505";
          throw err;
        }),
      };
      return fn(fakeClient);
    });

    (queryOne as any).mockResolvedValue({
      status: "IN_PROGRESS",
      response_body: null,
      request_fingerprint: "fingerprint-abc",
    });

    await expect(createOrderTransactional(...baseArgs)).rejects.toThrow(
      /already being processed/i
    );
  });
});
