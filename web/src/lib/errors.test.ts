import { describe, it, expect } from "vitest";
import { ApiError } from "./api";
import { userMessage, fieldErrors } from "./errors";

describe("userMessage", () => {
  it("shows the real field reasons instead of the bare 'Validation failed.'", () => {
    const e = new ApiError(400, "Validation failed.", "VALIDATION_ERROR", "r1", { password: "Password needs an uppercase letter and a number." });
    expect(userMessage(e, "fallback")).toBe("Password needs an uppercase letter and a number.");
  });

  it("names the field for a bare 'required' message", () => {
    const e = new ApiError(400, "Validation failed.", "VALIDATION_ERROR", "r1", { postalCode: "This field is required." });
    expect(userMessage(e, "fallback", { postalCode: "Postal code" })).toBe("Postal code is required.");
    expect(fieldErrors(e, { postalCode: "Postal code" })).toEqual({ postalCode: "Postal code is required." });
  });

  it("never shows 'Validation failed.' on its own", () => {
    expect(userMessage(new ApiError(400, "Validation failed."), "Could not save.")).toBe("Could not save.");
  });

  it("keeps a specific server message and hides server internals behind a reference", () => {
    expect(userMessage(new ApiError(409, "Only 2 available in this size."), "x")).toBe("Only 2 available in this size.");
    const five = userMessage(new ApiError(500, "db exploded at line 3", "INTERNAL", "abcdef1234567"), "x");
    expect(five).not.toContain("db exploded");
    expect(five).toContain("abcdef12");
  });

  it("explains a network failure", () => {
    expect(userMessage(new TypeError("Failed to fetch"), "x")).toMatch(/couldn't reach/);
  });
});
