import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/repos/notifications.repo", () => ({
  createNotification: vi.fn(async () => undefined),
  hasRoleNotificationForEntity: vi.fn(async () => false),
}));
vi.mock("../audit", () => ({ recordAuditEvent: vi.fn() }));

import * as notificationsRepo from "../db/repos/notifications.repo";
import { notifyCustomersNewProduct, notifyWishlistersProductBackInStock } from "./notifications.service";

const created = vi.mocked(notificationsRepo.createNotification);

describe("product notification links", () => {
  beforeEach(() => created.mockClear());

  it("encode the slug, so the link always matches the /product/:id route", async () => {
    await notifyCustomersNewProduct({ id: "p1", name: "Classic Tshirt", slug: "/Classic Tshirt" });
    await notifyWishlistersProductBackInStock(["u1"], "p1", "Classic Tshirt", "/Classic Tshirt");
    const urls = created.mock.calls.map((c) => (c[0] as { actionUrl?: string }).actionUrl);
    expect(urls).toEqual(["/product/%2FClassic%20Tshirt", "/product/%2FClassic%20Tshirt"]);
  });

  it("leave normal slugs unchanged", async () => {
    await notifyCustomersNewProduct({ id: "p2", name: "Lema Watch", slug: "lema-watch" });
    expect((created.mock.calls[0]![0] as { actionUrl?: string }).actionUrl).toBe("/product/lema-watch");
  });
});
