/**
 * Store contact channels (Footer Management → Instagram / TikTok / Facebook /
 * Phone / WhatsApp / Email): one place that both NORMALISES what an admin
 * types and BUILDS the link a customer's tap actually opens.
 *
 * Why server-side: the storefront used to build links itself, and a WhatsApp
 * number stored in local form (0756825667) became `https://wa.me/0756825667`
 * — an invalid chat link, since wa.me needs the full international number
 * with no leading zero. Every consumer (footer, floating chat button, account
 * help card) now uses the `href` computed here, so they can't drift apart.
 *
 * Nothing here holds a real number/handle — the values come only from the
 * admin's configuration. The one constant is the dialling code for the local
 * mobile format `isPhoneNumber` accepts (Tanzania, 255).
 */
import { ValidationError } from "./errors";
import { isEmail, isPhoneNumber } from "./validate";

export type ContactPlatform = "instagram" | "tiktok" | "facebook" | "phone" | "whatsapp" | "email";
type SocialPlatform = "instagram" | "tiktok" | "facebook";

/** Country dialling code for the local `0XXXXXXXXX` numbers `isPhoneNumber` stores. */
export const PHONE_COUNTRY_CODE = "255";

const SOCIAL: Record<SocialPlatform, { label: string; hosts: string[]; profile: (handle: string) => string; example: string }> = {
  instagram: {
    label: "Instagram",
    hosts: ["instagram.com", "instagr.am"],
    profile: (h) => `https://www.instagram.com/${h}/`,
    example: "https://instagram.com/yourbrand or @yourbrand",
  },
  tiktok: {
    label: "TikTok",
    hosts: ["tiktok.com"],
    profile: (h) => `https://www.tiktok.com/@${h}`,
    example: "https://tiktok.com/@yourbrand or @yourbrand",
  },
  facebook: {
    label: "Facebook",
    hosts: ["facebook.com", "fb.com", "fb.me"],
    profile: (h) => `https://www.facebook.com/${h}`,
    example: "https://facebook.com/yourbrand or @yourbrand",
  },
};

const WHATSAPP_HOSTS = ["wa.me", "whatsapp.com"];

function hostMatches(host: string, allowed: string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return allowed.some((a) => h === a || h.endsWith(`.${a}`));
}

function fail(message: string): never {
  throw new ValidationError("Validation failed.", { value: message });
}

/** Parses `https://x`, `http://x`, `www.x/...` or `x.com/...` into an https URL, or null. */
function parseLooseUrl(raw: string): URL | null {
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : /^[\w-]+(\.[\w-]+)+(\/|$|\?)/.test(raw) ? `https://${raw}` : null;
  if (!withScheme) return null;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  url.protocol = "https:";
  return url;
}

function normaliseSocial(platform: SocialPlatform, raw: string): string {
  const spec = SOCIAL[platform];
  // "@plugstore", or a bare word with no dot ("plugstore"), is a handle.
  const handle = raw.match(/^@?([A-Za-z0-9._-]{1,60})$/);
  const handleName = handle?.[1];
  if (handleName && (raw.startsWith("@") || !raw.includes(".")) && !/^\.+$/.test(handleName)) {
    return spec.profile(handleName);
  }
  const url = parseLooseUrl(raw);
  if (!url) fail(`Enter a ${spec.label} link, e.g. ${spec.example}.`);
  if (!hostMatches(url.hostname, spec.hosts)) {
    fail(`That link isn't on ${spec.label} — it must point to ${spec.hosts[0]}.`);
  }
  if (url.pathname === "/" || url.pathname === "") {
    fail(`Link to your ${spec.label} profile, not just the ${spec.label} home page.`);
  }
  return url.toString();
}

/** Local `0XXXXXXXXX` → international digits `255XXXXXXXXX` (what wa.me and tel: need). */
export function internationalDigits(localNumber: string): string {
  return PHONE_COUNTRY_CODE + localNumber.replace(/^0/, "");
}

function normaliseWhatsapp(raw: string): string {
  const url = /^(https?:\/\/|www\.|wa\.me|api\.whatsapp|chat\.whatsapp|whatsapp\.com)/i.test(raw) ? parseLooseUrl(raw) : null;
  if (!url) {
    // A plain number in any accepted form → stored as the local number.
    return isPhoneNumber(raw, "value");
  }
  if (!hostMatches(url.hostname, WHATSAPP_HOSTS)) {
    fail("That isn't a WhatsApp link — enter the WhatsApp number (e.g. 0756825667) or a wa.me link.");
  }
  // A chat link that carries a number (wa.me/<n>, api.whatsapp.com/send?phone=<n>)
  // is stored as that number, so a wrong leading 0 in the link gets fixed too.
  const fromPath = url.hostname.toLowerCase().endsWith("wa.me") ? url.pathname.replace(/^\/+|\/+$/g, "") : "";
  const candidate = /^\+?\d[\d\s-]*$/.test(decodeURIComponent(fromPath)) ? decodeURIComponent(fromPath) : url.searchParams.get("phone") ?? "";
  if (candidate) {
    try {
      return isPhoneNumber(candidate.replace(/[^\d]/g, ""), "value");
    } catch {
      fail("The number in that WhatsApp link isn't a valid mobile number — enter it as 0756825667.");
    }
  }
  // Other WhatsApp links (e.g. a chat.whatsapp.com community/group invite).
  if (url.pathname === "/" && !url.search) fail("Enter the WhatsApp number (e.g. 0756825667) or a full wa.me link.");
  return url.toString();
}

/** Validates + normalises an admin-entered value for a platform; throws a field-level ValidationError. */
export function normaliseContactValue(platform: ContactPlatform, raw: string): string {
  const value = raw.trim();
  if (value.length > 500) fail("That value is too long.");
  if (platform === "instagram" || platform === "tiktok" || platform === "facebook") return normaliseSocial(platform, value);
  if (platform === "phone") return isPhoneNumber(value, "value");
  if (platform === "whatsapp") return normaliseWhatsapp(value);
  return isEmail(value, "value");
}

/**
 * The link a customer opens for a stored value, or null when the value is not
 * usable (e.g. an old entry saved before this validation existed) — such a
 * channel is then left out of the storefront instead of sending people to a
 * broken or wrong destination.
 */
export function contactHref(platform: ContactPlatform, value: string | null): string | null {
  if (!value) return null;
  let normalised: string;
  try {
    normalised = normaliseContactValue(platform, value);
  } catch {
    return null;
  }
  if (platform === "phone") return `tel:+${internationalDigits(normalised)}`;
  if (platform === "email") return `mailto:${normalised}`;
  if (platform === "whatsapp") {
    return /^\d+$/.test(normalised) ? `https://wa.me/${internationalDigits(normalised)}` : normalised;
  }
  return normalised;
}
