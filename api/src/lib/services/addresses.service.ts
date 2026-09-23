import * as addressesRepo from "../db/repos/addresses.repo";
import type { Address } from "../db/types";
import { NotFoundError, ValidationError } from "../errors";
import { required, optional, isString, maxLength, validateBody } from "../validate";

const addressFields = {
  label: required(isString),
  line1: required(isString),
  line2: optional(isString),
  city: required(isString),
  region: required(isString),
  postalCode: required(isString),
  country: required((v: unknown, f: string) => maxLength(60)(isString(v, f), f)),
  phone: optional(isString),
};

export async function listMyAddresses(userId: string): Promise<Address[]> {
  return addressesRepo.listAddressesForUser(userId);
}

export async function createMyAddress(userId: string, body: unknown, makeDefault: boolean): Promise<Address> {
  const input = validateBody(body as Record<string, unknown>, addressFields);
  return addressesRepo.createAddressForUser(userId, input, makeDefault);
}

export async function updateMyAddress(userId: string, addressId: string, body: Record<string, unknown>): Promise<Address> {
  // Every field is optional here (unlike create's addressFields) since
  // this is a PATCH — only the fields the customer actually changed are
  // sent, and an omitted field is simply skipped rather than rejected as
  // "required".
  const patch = validateBody(body, {
    label: optional(isString),
    line1: optional(isString),
    line2: optional(isString),
    city: optional(isString),
    region: optional(isString),
    postalCode: optional(isString),
    country: optional((v: unknown, f: string) => maxLength(60)(isString(v, f), f)),
    phone: optional(isString),
  });
  if (Object.keys(patch).length === 0) {
    throw new ValidationError("Validation failed.", { body: "Provide at least one field to update." });
  }
  const updated = await addressesRepo.updateAddressForUser(userId, addressId, patch);
  if (!updated) throw new NotFoundError("Address not found.");
  return updated;
}

export async function deleteMyAddress(userId: string, addressId: string): Promise<void> {
  const deleted = await addressesRepo.deleteAddressForUser(userId, addressId);
  if (!deleted) throw new NotFoundError("Address not found.");
}

export async function setMyDefaultAddress(userId: string, addressId: string): Promise<Address> {
  const updated = await addressesRepo.setDefaultAddressForUser(userId, addressId);
  if (!updated) throw new NotFoundError("Address not found.");
  return updated;
}
