import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/repos/orders.repo", () => ({
  createOrderTransactional: vi.fn(),
  getOrderById: vi.fn(),
  listOrdersForUser: vi.fn(),
}));
vi.mock("../db/repos/users.repo", () => ({ findUserById: vi.fn() }));

import * as ordersRepo from "../db/repos/orders.repo";
import * as usersRepo from "../db/repos/users.repo";
import { createOrderFromCart } from "./order.service";
import type { Address } from "../db/types";

function fakeAddress(overrides: Partial<Omit<Address, "id" | "userId">> = {}): Omit<Address, "id" | "userId"> {
  return {
    label: "Home", line1: "123 Main St", city: "Dar es Salaam", region: "Dar es Salaam",
    postalCode: "00000", country: "TZ", phone: "+255700000000",
    ...overrides,
  };
}

function fakeUser(overrides: Partial<{ emailVerified: boolean }> = {}) {
  return {
    id: "user-1", email: "test@example.com", fullName: null, passwordHash: "hash", role: "CUSTOMER" as const,
    disabled: false, emailVerified: true, totpSecret: null, mfaEnabled: false, createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(ordersRepo.createOrderTransactional).mockReset();
  vi.mocked(usersRepo.findUserById).mockReset().mockResolvedValue(fakeUser());
});

describe("createOrderFromCart — idempotency fingerprint", () => {
  it("computes the SAME fingerprint for two calls with identical shipping address / payment method / transport number", async () => {
    vi.mocked(ordersRepo.createOrderTransactional).mockResolvedValue({ id: "order-1" } as any);

    await createOrderFromCart("user-1", fakeAddress(), "key-1", "pm-1", "0700000000", "dar_es_salaam");
    await createOrderFromCart("user-1", fakeAddress(), "key-2", "pm-1", "0700000000", "dar_es_salaam");

    const [firstCallArgs] = vi.mocked(ordersRepo.createOrderTransactional).mock.calls;
    const [secondCallArgs] = vi.mocked(ordersRepo.createOrderTransactional).mock.calls.slice(1);
    const firstFingerprint = firstCallArgs[5];
    const secondFingerprint = secondCallArgs[5];
    expect(firstFingerprint).toBe(secondFingerprint);
    expect(typeof firstFingerprint).toBe("string");
    expect((firstFingerprint as string).length).toBe(64); // sha256 hex
  });

  it("computes a DIFFERENT fingerprint when the shipping address differs", async () => {
    vi.mocked(ordersRepo.createOrderTransactional).mockResolvedValue({ id: "order-1" } as any);

    await createOrderFromCart("user-1", fakeAddress({ line1: "123 Main St" }), "key-1", "pm-1", null, "dar_es_salaam");
    await createOrderFromCart("user-1", fakeAddress({ line1: "456 Other St" }), "key-1", "pm-1", null, "dar_es_salaam");

    const calls = vi.mocked(ordersRepo.createOrderTransactional).mock.calls;
    expect(calls[0][5]).not.toBe(calls[1][5]);
  });

  it("computes a DIFFERENT fingerprint when only the payment method differs (same address)", async () => {
    vi.mocked(ordersRepo.createOrderTransactional).mockResolvedValue({ id: "order-1" } as any);

    await createOrderFromCart("user-1", fakeAddress(), "key-1", "pm-1", null, "dar_es_salaam");
    await createOrderFromCart("user-1", fakeAddress(), "key-1", "pm-2", null, "dar_es_salaam");

    const calls = vi.mocked(ordersRepo.createOrderTransactional).mock.calls;
    expect(calls[0][5]).not.toBe(calls[1][5]);
  });

  it("computes a DIFFERENT fingerprint when only the transport payment number differs", async () => {
    vi.mocked(ordersRepo.createOrderTransactional).mockResolvedValue({ id: "order-1" } as any);

    await createOrderFromCart("user-1", fakeAddress(), "key-1", "pm-1", "0700000000", "dar_es_salaam");
    await createOrderFromCart("user-1", fakeAddress(), "key-1", "pm-1", "0711111111", "dar_es_salaam");

    const calls = vi.mocked(ordersRepo.createOrderTransactional).mock.calls;
    expect(calls[0][5]).not.toBe(calls[1][5]);
  });

  it("does not confuse an address ending differently with a null vs empty transport number (no ambiguous concatenation)", async () => {
    vi.mocked(ordersRepo.createOrderTransactional).mockResolvedValue({ id: "order-1" } as any);

    // line2 empty + transport "x" should not hash the same as line2 "x" + transport empty
    await createOrderFromCart("user-1", fakeAddress({ line2: undefined }), "key-1", "pm-1", "x", "dar_es_salaam");
    await createOrderFromCart("user-1", fakeAddress({ line2: "x" }), "key-1", "pm-1", null, "dar_es_salaam");

    const calls = vi.mocked(ordersRepo.createOrderTransactional).mock.calls;
    expect(calls[0][5]).not.toBe(calls[1][5]);
  });
});

describe("createOrderFromCart — validation", () => {
  it("rejects when no idempotency key is provided", async () => {
    await expect(createOrderFromCart("user-1", fakeAddress(), null, "pm-1", null, "dar_es_salaam")).rejects.toThrow();
    expect(ordersRepo.createOrderTransactional).not.toHaveBeenCalled();
  });

  it("rejects when no payment method is provided", async () => {
    await expect(createOrderFromCart("user-1", fakeAddress(), "key-1", "", null, "dar_es_salaam")).rejects.toThrow();
    expect(ordersRepo.createOrderTransactional).not.toHaveBeenCalled();
  });

  it("rejects an unverified account before ever reaching the idempotency/order logic", async () => {
    vi.mocked(usersRepo.findUserById).mockResolvedValue(fakeUser({ emailVerified: false }));
    await expect(createOrderFromCart("user-1", fakeAddress(), "key-1", "pm-1", null, "dar_es_salaam")).rejects.toThrow(/verify/i);
    expect(ordersRepo.createOrderTransactional).not.toHaveBeenCalled();
  });
});
