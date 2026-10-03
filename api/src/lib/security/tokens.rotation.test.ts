import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../config", () => ({
  config: {
    cookies: { domain: "localhost", secure: false },
    auth: { accessTokenTtlSeconds: 900, refreshTokenTtlSeconds: 5184000, accessTokenSecret: "a".repeat(64), refreshTokenSecret: "b".repeat(64) },
  },
}));
const sessions = new Map<string, { id: string; userId: string; revoked: boolean; rotatedAt: string | null; createdAt: string; expiresAt: string }>();
vi.mock("../db/repos/sessions.repo", () => ({
  insertSession: vi.fn(async (s: { id: string; userId: string; expiresAt: Date }) => {
    const row = { id: s.id, userId: s.userId, revoked: false, rotatedAt: null, createdAt: new Date().toISOString(), expiresAt: s.expiresAt.toISOString() };
    sessions.set(s.id, row);
    return row;
  }),
  findSessionById: vi.fn(async (id: string) => sessions.get(id) ?? null),
}));
vi.mock("../db/repos/users.repo", () => ({}));

import { createRefreshToken, verifyRefreshToken, REFRESH_ROTATION_GRACE_SECONDS } from "./tokens";

const user = { id: "u1", email: "a@b.tz", role: "CUSTOMER" as const };
beforeEach(() => sessions.clear());

describe("refresh token rotation grace", () => {
  it("accepts a token renewed moments ago (a second tab, or a lost renewal response)", async () => {
    const { token, sessionId } = await createRefreshToken(user);
    sessions.get(sessionId)!.rotatedAt = new Date(Date.now() - 5_000).toISOString();
    expect(await verifyRefreshToken(token)).toMatchObject({ sub: "u1", jti: sessionId });
  });

  it("refuses a token renewed longer ago than the grace window", async () => {
    const { token, sessionId } = await createRefreshToken(user);
    sessions.get(sessionId)!.rotatedAt = new Date(Date.now() - (REFRESH_ROTATION_GRACE_SECONDS + 1) * 1000).toISOString();
    expect(await verifyRefreshToken(token)).toBeNull();
  });

  it("refuses a signed-out (revoked) token immediately", async () => {
    const { token, sessionId } = await createRefreshToken(user);
    sessions.get(sessionId)!.revoked = true;
    expect(await verifyRefreshToken(token)).toBeNull();
  });

});
