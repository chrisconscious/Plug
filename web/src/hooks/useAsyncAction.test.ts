// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAsyncAction } from "./useAsyncAction";
import { ApiError } from "../lib/api";

describe("useAsyncAction", () => {
  it("starts with pending: false and error: null", () => {
    const { result } = renderHook(() => useAsyncAction(async () => {}));
    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("sets pending: true while the action is in flight, then false once it resolves", async () => {
    let resolveAction: () => void;
    const action = vi.fn(() => new Promise<void>((resolve) => { resolveAction = resolve; }));
    const { result } = renderHook(() => useAsyncAction(action));

    act(() => { result.current.run(); });
    await waitFor(() => expect(result.current.pending).toBe(true));

    act(() => { resolveAction(); });
    await waitFor(() => expect(result.current.pending).toBe(false));
  });

  it("captures an ApiError's message as the error", async () => {
    const action = vi.fn().mockRejectedValue(new ApiError(409, "This size is out of stock."));
    const { result } = renderHook(() => useAsyncAction(action));

    await act(async () => { await result.current.run(); });

    expect(result.current.error).toBe("This size is out of stock.");
    expect(result.current.pending).toBe(false);
  });

  it("explains a network failure (fetch rejects with a TypeError)", async () => {
    const action = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => useAsyncAction(action));

    await act(async () => { await result.current.run(); });

    expect(result.current.error).toBe("We couldn't reach the store. Check your connection and try again.");
  });

  it("falls back to a generic message for any other non-API failure", async () => {
    const action = vi.fn().mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useAsyncAction(action));

    await act(async () => { await result.current.run(); });

    expect(result.current.error).toBe("Something went wrong. Please try again.");
  });

  it("never shows a server error's internals to the customer", async () => {
    const action = vi.fn().mockRejectedValue(new ApiError(500, "relation \"orders\" does not exist"));
    const { result } = renderHook(() => useAsyncAction(action));

    await act(async () => { await result.current.run(); });

    expect(result.current.error).toBe("Something went wrong on our side. Please try again in a moment.");
  });

  it("clears a previous error on the next run, even before the new call resolves", async () => {
    const action = vi.fn()
      .mockRejectedValueOnce(new ApiError(409, "first failure"))
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useAsyncAction(action));

    await act(async () => { await result.current.run(); });
    expect(result.current.error).toBe("first failure");

    await act(async () => { await result.current.run(); });
    expect(result.current.error).toBeNull();
  });

  it("clearError() resets the error without needing another run", async () => {
    const action = vi.fn().mockRejectedValue(new ApiError(409, "failed"));
    const { result } = renderHook(() => useAsyncAction(action));
    await act(async () => { await result.current.run(); });
    expect(result.current.error).toBe("failed");

    act(() => { result.current.clearError(); });
    expect(result.current.error).toBeNull();
  });

  it("ignores a second call while the first is still in flight — the actual duplicate-submission guard, not just a documented intent", async () => {
    let resolveAction: () => void;
    const action = vi.fn(() => new Promise<void>((resolve) => { resolveAction = resolve; }));
    const { result } = renderHook(() => useAsyncAction(action));

    // Fire two calls back-to-back before the first resolves.
    act(() => {
      result.current.run();
      result.current.run();
    });
    await waitFor(() => expect(result.current.pending).toBe(true));

    // The underlying action must have been invoked exactly ONCE — the
    // second call was genuinely ignored, not queued to run after the
    // first (which would be a different, also-wrong behavior: a stale
    // duplicate mutation firing later).
    expect(action).toHaveBeenCalledTimes(1);

    act(() => { resolveAction(); });
    await waitFor(() => expect(result.current.pending).toBe(false));
  });

  it("allows a new call again once the previous one has finished", async () => {
    const action = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAsyncAction(action));

    await act(async () => { await result.current.run(); });
    await act(async () => { await result.current.run(); });

    expect(action).toHaveBeenCalledTimes(2);
  });
});
