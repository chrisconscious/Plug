import { describe, it, expect, beforeEach, vi } from "vitest";
import { checkRateLimit, __resetRateLimitStoreForTests, type RateLimitRule } from "./rateLimiter";

beforeEach(() => {
  __resetRateLimitStoreForTests();
  vi.useRealTimers();
});

describe("checkRateLimit — repeated requests", () => {
  it("allows requests up to the limit, then rejects", async () => {
    const rule: RateLimitRule = { key: "test.repeated", windowMs: 60_000, max: 3 };
    const key = "test.repeated:1.2.3.4";
    expect((await checkRateLimit(key, rule)).allowed).toBe(true);
    expect((await checkRateLimit(key, rule)).allowed).toBe(true);
    expect((await checkRateLimit(key, rule)).allowed).toBe(true);
    expect((await checkRateLimit(key, rule)).allowed).toBe(false); // 4th request in the window
    expect((await checkRateLimit(key, rule)).allowed).toBe(false); // still rejected
  });

  it("tracks each distinct key independently — one caller's limit does not affect another's", async () => {
    const rule: RateLimitRule = { key: "test.isolation", windowMs: 60_000, max: 1 };
    expect((await checkRateLimit("test.isolation:caller-a", rule)).allowed).toBe(true);
    expect((await checkRateLimit("test.isolation:caller-a", rule)).allowed).toBe(false); // caller A exhausted
    expect((await checkRateLimit("test.isolation:caller-b", rule)).allowed).toBe(true); // caller B unaffected
  });

  it("resets after the window elapses", async () => {
    vi.useFakeTimers();
    const rule: RateLimitRule = { key: "test.reset", windowMs: 1000, max: 1 };
    const key = "test.reset:1.2.3.4";
    expect((await checkRateLimit(key, rule)).allowed).toBe(true);
    expect((await checkRateLimit(key, rule)).allowed).toBe(false);

    vi.advanceTimersByTime(1001); // past the window

    expect((await checkRateLimit(key, rule)).allowed).toBe(true); // fresh window, allowed again
    vi.useRealTimers();
  });

  it("different rules (different max) are respected independently even under the same key prefix", async () => {
    const looseRule: RateLimitRule = { key: "test.loose", windowMs: 60_000, max: 100 };
    const strictRule: RateLimitRule = { key: "test.strict", windowMs: 60_000, max: 1 };
    expect((await checkRateLimit("test.loose:ip", looseRule)).allowed).toBe(true);
    expect((await checkRateLimit("test.strict:ip", strictRule)).allowed).toBe(true);
    expect((await checkRateLimit("test.strict:ip", strictRule)).allowed).toBe(false);
    expect((await checkRateLimit("test.loose:ip", looseRule)).allowed).toBe(true); // unaffected by the strict key's rejection
  });
});

describe("checkRateLimit — retryAfterSeconds (used for the Retry-After response header)", () => {
  it("reports approximately the full window when the limit is first hit", async () => {
    vi.useFakeTimers();
    const rule: RateLimitRule = { key: "test.retryafter", windowMs: 60_000, max: 1 };
    const key = "test.retryafter:1.2.3.4";
    await checkRateLimit(key, rule); // consumes the one allowed request
    const result = await checkRateLimit(key, rule); // this one is rejected
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBe(60); // the full window — no time has passed yet
    vi.useRealTimers();
  });

  it("counts down as time passes within the window", async () => {
    vi.useFakeTimers();
    const rule: RateLimitRule = { key: "test.retryafter2", windowMs: 60_000, max: 1 };
    const key = "test.retryafter2:1.2.3.4";
    await checkRateLimit(key, rule);
    vi.advanceTimersByTime(25_000); // 25s into the 60s window
    const result = await checkRateLimit(key, rule);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBe(35); // ~35s remaining
    vi.useRealTimers();
  });

  it("is always at least 1 (never 0 or negative) so a client is never told to retry immediately/in the past", async () => {
    vi.useFakeTimers();
    const rule: RateLimitRule = { key: "test.retryafter3", windowMs: 1000, max: 1 };
    const key = "test.retryafter3:1.2.3.4";
    await checkRateLimit(key, rule);
    vi.advanceTimersByTime(999); // 1ms before the window would naturally reset
    const result = await checkRateLimit(key, rule);
    expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    vi.useRealTimers();
  });
});
