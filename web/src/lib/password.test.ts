import { describe, it, expect } from "vitest";
import { isStrongPassword, isValidMobile, PASSWORD_RULES } from "./password";

describe("password rules mirror the API", () => {
  it.each([
    ["GoodPass123", true],
    ["password1", false], // 9 chars, no uppercase
    ["mypassword123", false], // no uppercase
    ["MYPASSWORD123", false], // no lowercase
    ["NoDigitsHere", false],
    ["          ", false],
  ])("%j → %s", (pw, ok) => {
    expect(isStrongPassword(pw)).toBe(ok);
  });

  it("reports each unmet rule separately", () => {
    expect(PASSWORD_RULES.filter((r) => !r.test("abc")).map((r) => r.id)).toEqual(["length", "upper", "number"]);
  });
});

describe("isValidMobile", () => {
  it.each(["0756825667", "+255 756 825 667", "255756825667", "0656-825-667"])("accepts %j", (v) => expect(isValidMobile(v)).toBe(true));
  it.each(["12345", "0556825667", "", "07568256670"])("rejects %j", (v) => expect(isValidMobile(v)).toBe(false));
});
