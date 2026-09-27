import { describe, it, expect, vi, beforeEach } from "vitest";
import { ValidationError } from "../errors";

const createCouponRow = vi.hoisted(() => vi.fn());
vi.mock("../db/repos/coupons.repo", () => ({ createCoupon: createCouponRow }));
vi.mock("../audit", () => ({ recordAuditEvent: vi.fn() }));

import { createCoupon } from "./coupons.service";

const actor = { id: "admin-1", role: "SUPER_ADMIN" as const };
const base = { code: "SAVE10", discountType: "PERCENTAGE", discountValue: 10 };

describe("createCoupon — date fields", () => {
  beforeEach(() => {
    createCouponRow.mockReset();
    createCouponRow.mockImplementation(async (row: Record<string, unknown>) => ({ id: "c1", ...row }));
  });

  it("rejects a malformed start date with a field error instead of throwing a RangeError (500)", async () => {
    await expect(createCoupon(actor, { ...base, startsAt: "not-a-date" })).rejects.toBeInstanceOf(ValidationError);
    await expect(createCoupon(actor, { ...base, startsAt: "not-a-date" })).rejects.toMatchObject({ fields: { startsAt: "Enter a valid date." } });
    expect(createCouponRow).not.toHaveBeenCalled();
  });

  it("rejects a malformed end date the same way", async () => {
    await expect(createCoupon(actor, { ...base, endsAt: "2026-13-45" })).rejects.toMatchObject({ fields: { endsAt: "Enter a valid date." } });
  });

  it("accepts a one-day window (start of day to end of the same day)", async () => {
    const c = await createCoupon(actor, { ...base, startsAt: "2026-10-01T00:00:00.000+03:00", endsAt: "2026-10-01T23:59:59.999+03:00" });
    expect(c.startsAt).toBe("2026-09-30T21:00:00.000Z");
    expect(c.endsAt).toBe("2026-10-01T20:59:59.999Z");
  });

  it("still refuses an end before the start", async () => {
    await expect(createCoupon(actor, { ...base, startsAt: "2026-10-02", endsAt: "2026-10-01" })).rejects.toMatchObject({ fields: { endsAt: expect.stringMatching(/after the start/) } });
  });
});
