import { describe, it, expect } from "vitest";
import { normaliseContactValue, contactHref } from "./contact-links";
import { ValidationError } from "./errors";

function fieldError(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof ValidationError) return (e as ValidationError & { fields?: Record<string, string> }).fields?.value;
    throw e;
  }
  return undefined;
}

describe("WhatsApp", () => {
  it.each([
    ["0756825667", "0756825667"],
    ["+255 756 825 667", "0756825667"],
    ["255756825667", "0756825667"],
    ["https://wa.me/255756825667", "0756825667"],
    ["wa.me/0756825667", "0756825667"], // the broken local-format link is repaired
    ["https://api.whatsapp.com/send?phone=255756825667", "0756825667"],
  ])("stores %j as the local number %j", (raw, stored) => {
    expect(normaliseContactValue("whatsapp", raw)).toBe(stored);
  });

  it("opens a valid international wa.me chat (never wa.me/0…)", () => {
    expect(contactHref("whatsapp", "0756825667")).toBe("https://wa.me/255756825667");
    // an old value stored before normalisation still produces the right link
    expect(contactHref("whatsapp", "https://wa.me/0756825667")).toBe("https://wa.me/255756825667");
  });

  it("keeps a real WhatsApp group/community invite link", () => {
    expect(contactHref("whatsapp", "https://chat.whatsapp.com/AbCdEf123")).toBe("https://chat.whatsapp.com/AbCdEf123");
  });

  it.each(["https://evil.example/wa", "javascript:alert(1)", "12345", "https://wa.me/12345"])("rejects %j", (raw) => {
    expect(fieldError(() => normaliseContactValue("whatsapp", raw))).toBeTruthy();
    expect(contactHref("whatsapp", raw)).toBeNull();
  });
});

describe("phone and email", () => {
  it("builds tel: with the international number and mailto:", () => {
    expect(contactHref("phone", "0756825667")).toBe("tel:+255756825667");
    expect(contactHref("phone", "+255 756 825 667")).toBe("tel:+255756825667");
    expect(contactHref("email", "Hello@Plug.co.tz")).toBe("mailto:hello@plug.co.tz");
  });

  it("drops unusable values instead of producing a broken link", () => {
    expect(contactHref("phone", "not a number")).toBeNull();
    expect(contactHref("email", "nope")).toBeNull();
    expect(contactHref("email", null)).toBeNull();
  });
});

describe("social links", () => {
  it.each([
    ["instagram", "https://instagram.com/plugstore", "https://instagram.com/plugstore"],
    ["instagram", "www.instagram.com/plugstore", "https://www.instagram.com/plugstore"],
    ["instagram", "instagram.com/plugstore/", "https://instagram.com/plugstore/"],
    ["instagram", "@plugstore", "https://www.instagram.com/plugstore/"],
    ["instagram", "plug.store_tz", "invalid"],
    ["tiktok", "@plugstore", "https://www.tiktok.com/@plugstore"],
    ["tiktok", "http://www.tiktok.com/@plugstore", "https://www.tiktok.com/@plugstore"],
    ["facebook", "https://m.facebook.com/plugstore", "https://m.facebook.com/plugstore"],
    ["facebook", "plugstore", "https://www.facebook.com/plugstore"],
  ] as const)("%s %j → %j", (platform, raw, expected) => {
    if (expected === "invalid") expect(fieldError(() => normaliseContactValue(platform, raw))).toBeTruthy();
    else expect(normaliseContactValue(platform, raw)).toBe(expected);
  });

  it("refuses a link to a different site than the platform", () => {
    expect(fieldError(() => normaliseContactValue("instagram", "https://facebook.com/plugstore"))).toMatch(/isn't on Instagram/);
    expect(fieldError(() => normaliseContactValue("facebook", "https://evilfacebook.com/x"))).toMatch(/isn't on Facebook/);
    expect(fieldError(() => normaliseContactValue("tiktok", "javascript:alert(1)"))).toBeTruthy();
  });

  it("refuses the bare platform home page (it wouldn't reach the store)", () => {
    expect(fieldError(() => normaliseContactValue("instagram", "https://instagram.com/"))).toMatch(/profile/);
  });
});
