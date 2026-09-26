/**
 * Tiny, dependency-free schema validator.
 *
 * Deliberately hand-rolled (no zod/yup) so this project has zero runtime
 * dependencies beyond Next/React while offline. If the team later adds
 * network access, swapping this for zod is a contained change — all
 * validation flows through `validateBody()` / field validators below.
 */
import { ValidationError } from "./errors";

export type FieldValidator<T> = (value: unknown, fieldName: string) => T;

export function required<T>(inner: FieldValidator<T>): FieldValidator<T> {
  return (value, fieldName) => {
    if (value === undefined || value === null || value === "") {
      throw new ValidationError("Validation failed.", { [fieldName]: "This field is required." });
    }
    return inner(value, fieldName);
  };
}

export function optional<T>(inner: FieldValidator<T>): FieldValidator<T | undefined> {
  return (value, fieldName) => {
    if (value === undefined || value === null || value === "") return undefined;
    return inner(value, fieldName);
  };
}

/**
 * Like `optional`, but preserves an explicit `null`/`""` as `null` so callers
 * can distinguish "field not provided" (undefined — leave unchanged) from
 * "explicitly clear this field" (null — write NULL). Used by PATCH-style
 * update bodies for nullable columns.
 */
export function nullable<T>(inner: FieldValidator<T>): FieldValidator<T | null | undefined> {
  return (value, fieldName) => {
    if (value === undefined) return undefined;
    if (value === null || value === "") return null;
    return inner(value, fieldName);
  };
}

export const isString: FieldValidator<string> = (value, fieldName) => {
  if (typeof value !== "string") {
    throw new ValidationError("Validation failed.", { [fieldName]: "Must be a string." });
  }
  return value;
};

export const isEmail: FieldValidator<string> = (value, fieldName) => {
  const str = isString(value, fieldName);
  // Intentionally simple/conservative — full RFC5322 validation isn't worth
  // the complexity, and this is backed by "does the verification email
  // arrive" as the real proof of a valid address.
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str) && str.length <= 254;
  if (!ok) throw new ValidationError("Validation failed.", { [fieldName]: "Enter a valid email address." });
  return str.toLowerCase().trim();
};

/**
 * Accepts a Tanzanian mobile number either in local format (0756825667 —
 * a leading 0 followed by 9 digits) or international format
 * (+255756825667 / 255756825667), and normalizes every accepted form to
 * the same local "0XXXXXXXXX" shape before storage/lookup — so the same
 * physical number always matches on login regardless of which format the
 * customer happened to type. Intentionally scoped to Tanzania's format
 * (this app's storefront targets Tanzania — see the checkout's TZS
 * pricing) rather than an international phone-number library.
 */
export const isPhoneNumber: FieldValidator<string> = (value, fieldName) => {
  const raw = isString(value, fieldName).replace(/[\s-]/g, "");
  let digits = raw;
  if (digits.startsWith("+255")) digits = "0" + digits.slice(4);
  else if (digits.startsWith("255")) digits = "0" + digits.slice(3);

  const ok = /^0[67]\d{8}$/.test(digits);
  if (!ok) {
    throw new ValidationError("Validation failed.", { [fieldName]: "Enter a valid mobile number, e.g. 0756825667." });
  }
  return digits;
};

export function minLength(min: number): (v: string, f: string) => string {
  return (value, fieldName) => {
    if (value.length < min) {
      throw new ValidationError("Validation failed.", {
        [fieldName]: `Must be at least ${min} characters.`,
      });
    }
    return value;
  };
}

export function maxLength(max: number): (v: string, f: string) => string {
  return (value, fieldName) => {
    if (value.length > max) {
      throw new ValidationError("Validation failed.", {
        [fieldName]: `Must be at most ${max} characters.`,
      });
    }
    return value;
  };
}

export const isStrongPassword: FieldValidator<string> = (value, fieldName) => {
  const str = isString(value, fieldName);
  const problems: string[] = [];
  if (str.length < 10) problems.push("at least 10 characters");
  if (!/[a-z]/.test(str)) problems.push("a lowercase letter");
  if (!/[A-Z]/.test(str)) problems.push("an uppercase letter");
  if (!/[0-9]/.test(str)) problems.push("a number");
  if (problems.length > 0) {
    throw new ValidationError("Validation failed.", {
      [fieldName]: `Password needs ${problems.length > 1 ? `${problems.slice(0, -1).join(", ")} and ${problems[problems.length - 1]}` : problems[0]}.`,
    });
  }
  return str;
};

export const isPositiveInt: FieldValidator<number> = (value, fieldName) => {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(num) || num <= 0) {
    throw new ValidationError("Validation failed.", { [fieldName]: "Must be a positive whole number." });
  }
  return num;
};

export const isNonNegativeInt: FieldValidator<number> = (value, fieldName) => {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(num) || num < 0) {
    throw new ValidationError("Validation failed.", { [fieldName]: "Must be zero or a positive whole number." });
  }
  return num;
};

export const isBoolean: FieldValidator<boolean> = (value, fieldName) => {
  if (typeof value !== "boolean") {
    throw new ValidationError("Validation failed.", { [fieldName]: "Must be a boolean." });
  }
  return value;
};

export const isArray: FieldValidator<unknown[]> = (value, fieldName) => {
  if (!Array.isArray(value)) {
    throw new ValidationError("Validation failed.", { [fieldName]: "Must be an array." });
  }
  return value;
};

export const isArrayOfStrings: FieldValidator<string[]> = (value, fieldName) => {
  if (!Array.isArray(value) || value.length === 0 || !value.every((v) => typeof v === "string" && v.length > 0)) {
    throw new ValidationError("Validation failed.", { [fieldName]: "Must be a non-empty array of strings." });
  }
  return value;
};

/**
 * Same as `isArrayOfStrings` but an empty array is allowed — for sets that an
 * admin may legitimately clear (e.g. a product's lifestyle membership).
 */
export const isStringArray: FieldValidator<string[]> = (value, fieldName) => {
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string" && v.length > 0)) {
    throw new ValidationError("Validation failed.", { [fieldName]: "Must be an array of strings." });
  }
  return value;
};

/**
 * Validates `body` (already-parsed JSON, `unknown`) against a shape of field
 * validators, rejects unknown top-level keys, and collects ALL field errors
 * before throwing (better UX than failing on the first bad field).
 */
export function validateBody<S extends Record<string, FieldValidator<any>>>(
  body: unknown,
  shape: S
): { [K in keyof S]: ReturnType<S[K]> } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ValidationError("Request body must be a JSON object.");
  }
  const input = body as Record<string, unknown>;
  const allowedKeys = new Set(Object.keys(shape));
  const unknownKeys = Object.keys(input).filter((k) => !allowedKeys.has(k));
  const fields: Record<string, string> = {};
  const out: Record<string, unknown> = {};

  for (const key of unknownKeys) fields[key] = "Unknown field.";

  for (const [key, validator] of Object.entries(shape)) {
    try {
      out[key] = validator(input[key], key);
    } catch (err) {
      if (err instanceof ValidationError && err.fields) {
        Object.assign(fields, err.fields);
      } else {
        fields[key] = "Invalid value.";
      }
    }
  }

  if (Object.keys(fields).length > 0) {
    throw new ValidationError("Validation failed.", fields);
  }
  return out as { [K in keyof S]: ReturnType<S[K]> };
}
