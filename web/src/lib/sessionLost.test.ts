// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;

/** Fresh copy of the API client per test: its refresh latch is module state, read from the session marker at import. */
async function loadApi() {
  vi.resetModules();
  return import("./api");
}

beforeEach(() => {
  document.cookie = "vv_session=1; path=/";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = "vv_session=; max-age=0; path=/";
});

const urls = () => fetchMock.mock.calls.map((c) => String(c[0]).replace(/^https?:\/\/[^/]+/, ""));

describe("API client — session ended by the server", () => {
  it("reports the lost session once and stops retrying the refresh", async () => {
    const api = await loadApi();
    const lost = vi.fn();
    api.onSessionLost(lost);
    fetchMock
      .mockResolvedValueOnce(json(401, { error: "UNAUTHENTICATED" })) // unread-count
      .mockResolvedValueOnce(json(401, { error: "UNAUTHENTICATED" })) // refresh rejected
      .mockResolvedValueOnce(json(401, { error: "UNAUTHENTICATED" })); // next poll

    await expect(api.getUnreadNotificationCount()).rejects.toMatchObject({ status: 401 });
    expect(lost).toHaveBeenCalledTimes(1);

    await expect(api.getUnreadNotificationCount()).rejects.toMatchObject({ status: 401 });
    expect(urls()).toEqual(["/api/v1/notifications/unread-count", "/api/v1/auth/refresh", "/api/v1/notifications/unread-count"]);
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it("does not treat a dropped connection during refresh as signed out — the next 401 refreshes again", async () => {
    const api = await loadApi();
    const lost = vi.fn();
    api.onSessionLost(lost);
    fetchMock
      .mockResolvedValueOnce(json(401)) // unread-count
      .mockRejectedValueOnce(new TypeError("Failed to fetch")) // refresh: server restarting
      .mockResolvedValueOnce(json(401)) // unread-count again
      .mockResolvedValueOnce(json(200, { user: {} })) // refresh works now
      .mockResolvedValueOnce(json(200, { count: 3 })); // retried unread-count

    await expect(api.getUnreadNotificationCount()).rejects.toMatchObject({ status: 401 });
    await expect(api.getUnreadNotificationCount()).resolves.toEqual({ count: 3 });
    expect(lost).not.toHaveBeenCalled();
    expect(urls().filter((u) => u === "/api/v1/auth/refresh")).toHaveLength(2);
  });
});
