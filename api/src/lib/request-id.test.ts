import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { logger, requestContext } from "./logger";
import { withRoute, json } from "./http";

const API_BASE = "http://localhost:3001";
const FRONTEND_ORIGIN = "http://localhost:5173";

function parseLoggedJson(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown>[] {
  return spy.mock.calls.map((call) => JSON.parse(call[0] as string));
}

describe("logger — automatic requestId propagation via AsyncLocalStorage", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("includes the requestId in a log call made directly inside requestContext.run(...)", () => {
    requestContext.run({ requestId: "test-id-direct" }, () => {
      logger.info("direct log");
    });
    const [entry] = parseLoggedJson(consoleSpy);
    expect(entry.requestId).toBe("test-id-direct");
  });

  it("includes the requestId in a log call several levels of nested (async) function calls deep — proving this isn't just a same-frame coincidence", async () => {
    async function repoLayer() {
      logger.info("simulated repo-layer log");
    }
    async function serviceLayer() {
      await new Promise((r) => setTimeout(r, 0)); // force a real async hop
      await repoLayer();
    }
    await requestContext.run({ requestId: "test-id-nested" }, async () => {
      await serviceLayer();
    });
    const [entry] = parseLoggedJson(consoleSpy);
    expect(entry.requestId).toBe("test-id-nested");
  });

  it("does NOT include a requestId when logging outside any request context", () => {
    logger.info("no context log");
    const [entry] = parseLoggedJson(consoleSpy);
    expect(entry.requestId).toBeUndefined();
  });

  it("keeps two concurrent request contexts correctly isolated from each other", async () => {
    await Promise.all([
      requestContext.run({ requestId: "request-A" }, async () => {
        await new Promise((r) => setTimeout(r, 5));
        logger.info("from A");
      }),
      requestContext.run({ requestId: "request-B" }, async () => {
        logger.info("from B");
      }),
    ]);
    const entries = parseLoggedJson(consoleSpy);
    const fromA = entries.find((e) => e.message === "from A");
    const fromB = entries.find((e) => e.message === "from B");
    expect(fromA?.requestId).toBe("request-A");
    expect(fromB?.requestId).toBe("request-B");
  });
});

describe("withRoute — request-id end-to-end (client-supplied id -> response -> nested service log)", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("echoes back a client-supplied X-Request-Id on the response header", async () => {
    const route = withRoute({ auth: "none" }, async () => json({ ok: true }));
    const req = new NextRequest(`${API_BASE}/api/v1/test`, {
      method: "GET",
      headers: { origin: FRONTEND_ORIGIN, "x-request-id": "client-supplied-id" },
    });
    const res = await route(req, undefined);
    expect(res.headers.get("X-Request-Id")).toBe("client-supplied-id");
  });

  it("generates a fresh id when the client doesn't supply one", async () => {
    const route = withRoute({ auth: "none" }, async () => json({ ok: true }));
    const req = new NextRequest(`${API_BASE}/api/v1/test`, { method: "GET", headers: { origin: FRONTEND_ORIGIN } });
    const res = await route(req, undefined);
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
  });

  it("a log call made from INSIDE the route handler (simulating a service/repo call) automatically carries the same request id as the response header", async () => {
    const route = withRoute({ auth: "none" }, async () => {
      logger.info("simulated deep service-layer log during request handling");
      return json({ ok: true });
    });
    const req = new NextRequest(`${API_BASE}/api/v1/test`, {
      method: "GET",
      headers: { origin: FRONTEND_ORIGIN, "x-request-id": "trace-me-through" },
    });
    const res = await route(req, undefined);
    expect(res.headers.get("X-Request-Id")).toBe("trace-me-through");

    const entries = parseLoggedJson(consoleSpy);
    const serviceLog = entries.find((e) => e.message === "simulated deep service-layer log during request handling");
    expect(serviceLog?.requestId).toBe("trace-me-through");
  });

  it("includes the request id in the error response body when a handler throws (user-facing correlation reference)", async () => {
    const route = withRoute({ auth: "none" }, async () => {
      throw new Error("simulated internal failure");
    });
    const req = new NextRequest(`${API_BASE}/api/v1/test`, {
      method: "GET",
      headers: { origin: FRONTEND_ORIGIN, "x-request-id": "error-trace-id" },
    });
    const res = await route(req, undefined);
    const body = await res.json();
    expect(body.requestId).toBe("error-trace-id");
  });
});
