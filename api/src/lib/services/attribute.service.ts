import * as attributeRepo from "../db/repos/attribute.repo";
import * as catalogRepo from "../db/repos/catalog.repo";
import { NotFoundError, ValidationError, ConflictError } from "../errors";
import { recordAuditEvent } from "../audit";
import type { Role } from "../rbac";
import type { AttributeGroup, AttributeOption } from "../db/types";

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function assertNonBlank(value: unknown, field: string, label: string): string {
  const str = typeof value === "string" ? value.trim() : "";
  if (!str) throw new ValidationError("Validation failed.", { [field]: `${label} is required.` });
  return str;
}

// ---------------------------------------------------------------------------
// Attribute groups
// ---------------------------------------------------------------------------

export async function listAllAttributeGroups(): Promise<AttributeGroup[]> {
  const groups = await attributeRepo.listAllAttributeGroups();
  // Attach category assignments — the admin UI needs this to render
  // checkboxes correctly; the storefront-facing listAttributeGroupsForCategory
  // path never calls this function, so this extra round-trip per group only
  // happens on the admin management screen, not on every category page load.
  return Promise.all(
    groups.map(async (g) => ({ ...g, categoryIds: await attributeRepo.getAttributeGroupCategoryIds(g.id) }))
  );
}

export type CreateAttributeGroupInput = {
  name: unknown;
  slug?: unknown;
  selectionType?: unknown;
  active?: unknown;
  displayOrder?: unknown;
  categoryIds?: unknown;
};

export async function createAttributeGroup(actor: { id: string; role: Role }, input: CreateAttributeGroupInput) {
  const name = assertNonBlank(input.name, "name", "Name");
  const slug = typeof input.slug === "string" && input.slug.trim() ? slugify(input.slug) : slugify(name);
  if (!slug) throw new ValidationError("Validation failed.", { slug: "Could not derive a valid slug from the name." });

  const selectionType = input.selectionType === "single_select" ? "single_select" : "multi_select";
  const displayOrder = Number.isInteger(input.displayOrder) && (input.displayOrder as number) >= 0 ? (input.displayOrder as number) : 0;
  const active = input.active === undefined ? true : Boolean(input.active);
  const categoryIds = Array.isArray(input.categoryIds) ? input.categoryIds.filter((v): v is string => typeof v === "string") : [];

  const group = await attributeRepo.insertAttributeGroup({ name, slug, selectionType, active, displayOrder });
  if (categoryIds.length > 0) {
    await attributeRepo.setAttributeGroupCategories(group.id, categoryIds);
  }
  await recordAuditEvent({ actorId: actor.id, actorRole: actor.role, action: "attribute_group.created", targetType: "attribute_group", targetId: group.id, metadata: { name, categoryIds } });
  return { ...group, categoryIds };
}

export type UpdateAttributeGroupInput = Partial<CreateAttributeGroupInput>;

export async function updateAttributeGroup(actor: { id: string; role: Role }, id: string, input: UpdateAttributeGroupInput) {
  const existing = await attributeRepo.findAttributeGroupById(id);
  if (!existing) throw new NotFoundError("Attribute group not found.");

  const patch: attributeRepo.AttributeGroupPatch = {};
  if (input.name !== undefined) patch.name = assertNonBlank(input.name, "name", "Name");
  if (input.slug !== undefined) {
    const slug = slugify(String(input.slug));
    if (!slug) throw new ValidationError("Validation failed.", { slug: "Slug cannot be blank." });
    patch.slug = slug;
  }
  if (input.selectionType !== undefined) patch.selectionType = input.selectionType === "single_select" ? "single_select" : "multi_select";
  if (input.active !== undefined) patch.active = Boolean(input.active);
  if (input.displayOrder !== undefined) {
    const order = Number(input.displayOrder);
    if (!Number.isInteger(order) || order < 0) throw new ValidationError("Validation failed.", { displayOrder: "Display order must be a non-negative whole number." });
    patch.displayOrder = order;
  }

  const updated = await attributeRepo.updateAttributeGroupFields(id, patch);
  if (!updated) throw new NotFoundError("Attribute group not found.");

  if (input.categoryIds !== undefined) {
    const categoryIds = Array.isArray(input.categoryIds) ? input.categoryIds.filter((v): v is string => typeof v === "string") : [];
    await attributeRepo.setAttributeGroupCategories(id, categoryIds);
  }

  await recordAuditEvent({ actorId: actor.id, actorRole: actor.role, action: "attribute_group.updated", targetType: "attribute_group", targetId: id, metadata: patch as Record<string, unknown> });
  const categoryIds = await attributeRepo.getAttributeGroupCategoryIds(id);
  return { ...updated, categoryIds };
}

export async function deleteAttributeGroup(actor: { id: string; role: Role }, id: string) {
  const existing = await attributeRepo.findAttributeGroupById(id);
  if (!existing) throw new NotFoundError("Attribute group not found.");
  // Deleting a group CASCADEs to its options (migration 0033), which would
  // in turn hit the options' own RESTRICT against product_attribute_values
  // — but that RESTRICT fires mid-cascade with a much less helpful error.
  // Check up front so an admin gets one clear message instead of a raw
  // constraint violation.
  const options = await attributeRepo.listOptionsForGroup(id);
  for (const option of options) {
    const count = await attributeRepo.countProductsWithOption(option.id);
    if (count > 0) {
      throw new ConflictError(`Cannot delete "${existing.name}" — its option "${option.name}" is still assigned to ${count} product(s). Unassign it from those products first.`);
    }
  }
  await attributeRepo.deleteAttributeGroup(id);
  await recordAuditEvent({ actorId: actor.id, actorRole: actor.role, action: "attribute_group.deleted", targetType: "attribute_group", targetId: id, metadata: { name: existing.name } });
}

// ---------------------------------------------------------------------------
// Attribute options
// ---------------------------------------------------------------------------

export async function listOptionsForGroup(groupId: string): Promise<AttributeOption[]> {
  const group = await attributeRepo.findAttributeGroupById(groupId);
  if (!group) throw new NotFoundError("Attribute group not found.");
  return attributeRepo.listOptionsForGroup(groupId);
}

export type CreateAttributeOptionInput = { name: unknown; slug?: unknown; active?: unknown; displayOrder?: unknown };

export async function createAttributeOption(actor: { id: string; role: Role }, groupId: string, input: CreateAttributeOptionInput) {
  const group = await attributeRepo.findAttributeGroupById(groupId);
  if (!group) throw new NotFoundError("Attribute group not found.");

  const name = assertNonBlank(input.name, "name", "Name");
  const slug = typeof input.slug === "string" && input.slug.trim() ? slugify(input.slug) : slugify(name);
  if (!slug) throw new ValidationError("Validation failed.", { slug: "Could not derive a valid slug from the name." });
  const active = input.active === undefined ? true : Boolean(input.active);
  const displayOrder = Number.isInteger(input.displayOrder) && (input.displayOrder as number) >= 0 ? (input.displayOrder as number) : 0;

  const option = await attributeRepo.insertAttributeOption({ attributeGroupId: groupId, name, slug, active, displayOrder });
  await recordAuditEvent({ actorId: actor.id, actorRole: actor.role, action: "attribute_option.created", targetType: "attribute_option", targetId: option.id, metadata: { groupId, name } });
  return option;
}

export type UpdateAttributeOptionInput = Partial<CreateAttributeOptionInput>;

export async function updateAttributeOption(actor: { id: string; role: Role }, id: string, input: UpdateAttributeOptionInput) {
  const existing = await attributeRepo.findAttributeOptionById(id);
  if (!existing) throw new NotFoundError("Attribute option not found.");

  const patch: attributeRepo.AttributeOptionPatch = {};
  if (input.name !== undefined) patch.name = assertNonBlank(input.name, "name", "Name");
  if (input.slug !== undefined) {
    const slug = slugify(String(input.slug));
    if (!slug) throw new ValidationError("Validation failed.", { slug: "Slug cannot be blank." });
    patch.slug = slug;
  }
  if (input.active !== undefined) patch.active = Boolean(input.active);
  if (input.displayOrder !== undefined) {
    const order = Number(input.displayOrder);
    if (!Number.isInteger(order) || order < 0) throw new ValidationError("Validation failed.", { displayOrder: "Display order must be a non-negative whole number." });
    patch.displayOrder = order;
  }

  const updated = await attributeRepo.updateAttributeOptionFields(id, patch);
  if (!updated) throw new NotFoundError("Attribute option not found.");
  await recordAuditEvent({ actorId: actor.id, actorRole: actor.role, action: "attribute_option.updated", targetType: "attribute_option", targetId: id, metadata: patch as Record<string, unknown> });
  return updated;
}

export async function deleteAttributeOption(actor: { id: string; role: Role }, id: string) {
  const existing = await attributeRepo.findAttributeOptionById(id);
  if (!existing) throw new NotFoundError("Attribute option not found.");
  const count = await attributeRepo.countProductsWithOption(id);
  if (count > 0) {
    throw new ConflictError(`Cannot delete "${existing.name}" — it is still assigned to ${count} product(s). Unassign it from those products first.`);
  }
  await attributeRepo.deleteAttributeOption(id);
  await recordAuditEvent({ actorId: actor.id, actorRole: actor.role, action: "attribute_option.deleted", targetType: "attribute_option", targetId: id, metadata: { name: existing.name } });
}

// ---------------------------------------------------------------------------
// Storefront
// ---------------------------------------------------------------------------

export async function listAttributeGroupsForCategory(categoryId: string): Promise<AttributeGroup[]> {
  return attributeRepo.listAttributeGroupsForCategory(categoryId);
}

/**
 * Slug-addressed variant — every OTHER public storefront route in this app
 * is slug-addressed (/products/{slug}, /lifestyle/{slug}), and the
 * frontend only has the category slug readily available (from the URL),
 * not its raw id. Resolves the slug first, then delegates to the
 * id-based lookup above. An unknown slug returns an empty list rather
 * than throwing — same "stale link, not a broken page" reasoning already
 * used for lifestyle slugs in catalog.service.ts.
 */
export async function listAttributeGroupsForCategorySlug(slug: string): Promise<AttributeGroup[]> {
  const category = await catalogRepo.findCategoryBySlug(slug);
  if (!category) return [];
  return attributeRepo.listAttributeGroupsForCategory(category.id);
}

/**
 * Batched variant for multi-category contexts (a Brand page's attribute shelf,
 * the header mega-menu): resolves a set of category slugs and returns the
 * DISTINCT active groups (with options) that apply to any of them. Groups are
 * de-duplicated by id so a shared group (e.g. "Fit" on Jeans AND Trousers)
 * appears once. An empty result for unknown slugs — never a throw — mirrors
 * the single-slug variant above.
 */
export async function listAttributeGroupsForCategorySlugs(slugs: string[]): Promise<AttributeGroup[]> {
  const clean = [...new Set((slugs ?? []).map((s) => s.trim()).filter(Boolean))];
  if (clean.length === 0) return [];
  const categories = await catalogRepo.listCategories();
  const bySlug = new Map(categories.map((c) => [c.slug, c.id]));
  const ids = clean.map((s) => bySlug.get(s)).filter((id): id is string => !!id);
  const map = await attributeRepo.listAttributeGroupsForCategories(ids);
  const groups = new Map<string, AttributeGroup>();
  for (const list of map.values()) {
    for (const g of list) {
      if (!groups.has(g.id)) groups.set(g.id, g);
    }
  }
  return [...groups.values()];
}

// ---------------------------------------------------------------------------
// Product assignment
// ---------------------------------------------------------------------------

export async function getProductAttributeOptionIds(productId: string): Promise<string[]> {
  return attributeRepo.getProductAttributeOptionIds(productId);
}

export async function setProductAttributeValues(actor: { id: string; role: Role }, productId: string, optionIds: unknown) {
  const ids = Array.isArray(optionIds) ? optionIds.filter((v): v is string => typeof v === "string") : [];
  await attributeRepo.setProductAttributeValues(productId, ids);
  await recordAuditEvent({ actorId: actor.id, actorRole: actor.role, action: "product.attributes_updated", targetType: "product", targetId: productId, metadata: { optionIds: ids } });
}
