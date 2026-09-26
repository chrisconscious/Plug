/**
 * The password rules the API enforces (api/src/lib/validate.ts →
 * isStrongPassword), shown live while the customer types so they never
 * submit a password the server will refuse. The server stays the authority.
 */
export const PASSWORD_RULES: { id: string; label: string; test: (pw: string) => boolean }[] = [
  { id: "length", label: "At least 10 characters", test: (pw) => pw.length >= 10 },
  { id: "lower", label: "A lowercase letter", test: (pw) => /[a-z]/.test(pw) },
  { id: "upper", label: "An uppercase letter", test: (pw) => /[A-Z]/.test(pw) },
  { id: "number", label: "A number", test: (pw) => /[0-9]/.test(pw) },
];

export function isStrongPassword(pw: string): boolean {
  return PASSWORD_RULES.every((r) => r.test(pw));
}

/** Local check mirroring the API's Tanzanian mobile format (0XXXXXXXXX, +255… or 255…). */
export function isValidMobile(raw: string): boolean {
  let digits = raw.replace(/[\s-]/g, "");
  if (digits.startsWith("+255")) digits = "0" + digits.slice(4);
  else if (digits.startsWith("255")) digits = "0" + digits.slice(3);
  return /^0[67]\d{8}$/.test(digits);
}
