import { query, queryOne, withTransaction, isPgErrorCode, PG_ERROR_CODES } from "../client";
import { ConflictError } from "../../errors";
import type { AttributeGroup, AttributeOption } from "../types";

type GroupRow = {
  id: string;
  name: string;
  slug: string;
  selection_type: "multi_select" | "single_select";
  active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
};

type OptionRow = {
  id: string;
  attribute_group_id: string;
  name: string;
  slug: string;
  active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
};

const toGroup = (r: GroupRow): AttributeGroup => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  selectionType: r.selection_type,
  active: r.active,
  displayOrder: r.display_order,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toOption = (r: OptionRow): AttributeOption => ({
  id: r.id,
  attributeGroupId: r.attribute_group_id,
  name: r.name,
  slug: r.slug,
  active: r.active,
  displayOrder: r.display_order,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const GROUP_COLUMNS = "id, name, slug, selection_type, active, display_order, created_at, updated_at";
const OPTION_COLUMNS = "id, attribute_group_id, name, slug, active, display_order, created_at, updated_at";

// ---------------------------------------------------------------------------
// Attribute groups (admin management)
// ---------------------------------------------------------------------------

/** Admin view — every group regardless of active status. */
export async function listAllAttributeGroups(): Promise<AttributeGroup[]> {
  const rows = await query<GroupRow>(`SELECT ${GROUP_COLUMNS} FROM attribute_groups ORDER BY display_order, name`);
  return rows.map(toGroup);
}

export async function findAttributeGroupById(id: string): Promise<AttributeGroup | null> {
  const row = await queryOne<GroupRow>(`SELECT ${GROUP_COLUMNS} FROM attribute_groups WHERE id = $1`, [id]);
  return row ? toGroup(row) : null;
}

/** Category ids a group is currently assigned to. */
export async function getAttributeGroupCategoryIds(groupId: string): Promise<string[]> {
  const rows = await query<{ category_id: string }>(
    "SELECT category_id FROM attribute_group_categories WHERE attribute_group_id = $1",
    [groupId]
  );
  return rows.map((r) => r.category_id);
}

export type AttributeGroupInsert = {
  name: string;
  slug: string;
  selectionType: "multi_select" | "single_select";
  active: boolean;
  displayOrder: number;
};

export async function insertAttributeGroup(input: AttributeGroupInsert): Promise<AttributeGroup> {
  try {
    const row = await queryOne<GroupRow>(
      `INSERT INTO attribute_groups (name, slug, selection_type, active, display_order)
       VALUES ($1, $2, $3, $4, $5) RETURNING ${GROUP_COLUMNS}`,
      [input.name, input.slug, input.selectionType, input.active, input.displayOrder]
    );
    return toGroup(row!);
  } catch (err) {
    if (isPgErrorCode(err, PG_ERROR_CODES.UNIQUE_VIOLATION)) {
      throw new ConflictError("An attribute group with this slug already exists.");
    }
    throw err;
  }
}

export type AttributeGroupPatch = Partial<AttributeGroupInsert>;

export async function updateAttributeGroupFields(id: string, patch: AttributeGroupPatch): Promise<AttributeGroup | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (patch.name !== undefined) push("name", patch.name);
  if (patch.slug !== undefined) push("slug", patch.slug);
  if (patch.selectionType !== undefined) push("selection_type", patch.selectionType);
  if (patch.active !== undefined) push("active", patch.active);
  if (patch.displayOrder !== undefined) push("display_order", patch.displayOrder);
  if (sets.length === 0) return findAttributeGroupById(id);

  params.push(id);
  try {
    const row = await queryOne<GroupRow>(
      `UPDATE attribute_groups SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING ${GROUP_COLUMNS}`,
      params
    );
    return row ? toGroup(row) : null;
  } catch (err) {
    if (isPgErrorCode(err, PG_ERROR_CODES.UNIQUE_VIOLATION)) {
      throw new ConflictError("An attribute group with this slug already exists.");
    }
    throw err;
  }
}

/** Replaces the FULL set of category assignments for a group (delete then re-insert, in one transaction). */
export async function setAttributeGroupCategories(groupId: string, categoryIds: string[]): Promise<void> {
  await withTransaction(async (client) => {
    await client.query("DELETE FROM attribute_group_categories WHERE attribute_group_id = $1", [groupId]);
    for (const categoryId of categoryIds) {
      await client.query(
        "INSERT INTO attribute_group_categories (attribute_group_id, category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [groupId, categoryId]
      );
    }
  });
}

export async function deleteAttributeGroup(id: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>("DELETE FROM attribute_groups WHERE id = $1 RETURNING id", [id]);
  return !!row;
}

// ---------------------------------------------------------------------------
// Attribute options (admin management)
// ---------------------------------------------------------------------------

export async function listOptionsForGroup(groupId: string, opts: { activeOnly?: boolean } = {}): Promise<AttributeOption[]> {
  const where = opts.activeOnly ? "AND active = true" : "";
  const rows = await query<OptionRow>(
    `SELECT ${OPTION_COLUMNS} FROM attribute_options WHERE attribute_group_id = $1 ${where} ORDER BY display_order, name`,
    [groupId]
  );
  return rows.map(toOption);
}

export async function findAttributeOptionById(id: string): Promise<AttributeOption | null> {
  const row = await queryOne<OptionRow>(`SELECT ${OPTION_COLUMNS} FROM attribute_options WHERE id = $1`, [id]);
  return row ? toOption(row) : null;
}

export type AttributeOptionInsert = { attributeGroupId: string; name: string; slug: string; active: boolean; displayOrder: number };

export async function insertAttributeOption(input: AttributeOptionInsert): Promise<AttributeOption> {
  try {
    const row = await queryOne<OptionRow>(
      `INSERT INTO attribute_options (attribute_group_id, name, slug, active, display_order)
       VALUES ($1, $2, $3, $4, $5) RETURNING ${OPTION_COLUMNS}`,
      [input.attributeGroupId, input.name, input.slug, input.active, input.displayOrder]
    );
    return toOption(row!);
  } catch (err) {
    if (isPgErrorCode(err, PG_ERROR_CODES.UNIQUE_VIOLATION)) {
      throw new ConflictError("An option with this name/slug already exists in this group.");
    }
    throw err;
  }
}

export type AttributeOptionPatch = Partial<Omit<AttributeOptionInsert, "attributeGroupId">>;

export async function updateAttributeOptionFields(id: string, patch: AttributeOptionPatch): Promise<AttributeOption | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (patch.name !== undefined) push("name", patch.name);
  if (patch.slug !== undefined) push("slug", patch.slug);
  if (patch.active !== undefined) push("active", patch.active);
  if (patch.displayOrder !== undefined) push("display_order", patch.displayOrder);
  if (sets.length === 0) return findAttributeOptionById(id);

  params.push(id);
  try {
    const row = await queryOne<OptionRow>(
      `UPDATE attribute_options SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING ${OPTION_COLUMNS}`,
      params
    );
    return row ? toOption(row) : null;
  } catch (err) {
    if (isPgErrorCode(err, PG_ERROR_CODES.UNIQUE_VIOLATION)) {
      throw new ConflictError("An option with this name/slug already exists in this group.");
    }
    throw err;
  }
}

/** Deletion is RESTRICTed by the FK if any real product still has this option assigned — see migration 0033's comment. Callers should check countProductsWithOption first to give a clear error rather than surface a raw constraint violation. */
export async function deleteAttributeOption(id: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>("DELETE FROM attribute_options WHERE id = $1 RETURNING id", [id]);
  return !!row;
}

export async function countProductsWithOption(optionId: string): Promise<number> {
  const row = await queryOne<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM product_attribute_values WHERE attribute_option_id = $1",
    [optionId]
  );
  return Number(row?.count ?? 0);
}

// ---------------------------------------------------------------------------
// Storefront: attribute groups (with their options) for a given category
// ---------------------------------------------------------------------------

/**
 * The real storefront query: active groups assigned to this category, each
 * with its active options, in display order. This is what makes a category
 * page show ONLY the attributes relevant to it — driven entirely by the
 * attribute_group_categories assignment, never a hardcoded category check.
 */
export async function listAttributeGroupsForCategory(categoryId: string): Promise<AttributeGroup[]> {
  const groups = await listAttributeGroupsForCategories([categoryId]);
  return groups.get(categoryId) ?? [];
}

/**
 * Batched storefront read: active groups assigned to ANY of the given
 * categories, each with its active options, in display order — two queries
 * total regardless of how many categories are passed (no N+1). This powers
 * contexts that span multiple categories at once (a Brand page's attribute
 * shelf, the header's category mega-menu) without a request per category.
 * Returns a category-id -> groups map, so callers can answer "what applies
 * here" without re-joining the assignment table.
 */
export async function listAttributeGroupsForCategories(categoryIds: string[]): Promise<Map<string, AttributeGroup[]>> {
  const byCategory = new Map<string, AttributeGroup[]>();
  if (categoryIds.length === 0) return byCategory;

  const groupRows = await query<GroupRow & { category_id: string }>(
    `SELECT ${GROUP_COLUMNS.split(", ").map((c) => `g.${c}`).join(", ")}, agc.category_id
     FROM attribute_groups g
     JOIN attribute_group_categories agc ON agc.attribute_group_id = g.id
     WHERE agc.category_id = ANY($1) AND g.active = true
     ORDER BY g.display_order, g.name`,
    [categoryIds]
  );
  if (groupRows.length === 0) return byCategory;

  const groupById = new Map<string, AttributeGroup>();
  for (const row of groupRows) groupById.set(row.id, toGroup(row));

  const optionRows = await query<OptionRow>(
    `SELECT ${OPTION_COLUMNS} FROM attribute_options
     WHERE attribute_group_id = ANY($1) AND active = true
     ORDER BY display_order, name`,
    [[...groupById.keys()]]
  );
  const optionsByGroup = new Map<string, AttributeOption[]>();
  for (const row of optionRows) {
    const opt = toOption(row);
    const list = optionsByGroup.get(opt.attributeGroupId) ?? [];
    list.push(opt);
    optionsByGroup.set(opt.attributeGroupId, list);
  }

  for (const row of groupRows) {
    const group = { ...groupById.get(row.id)!, options: optionsByGroup.get(row.id) ?? [] };
    const list = byCategory.get(row.category_id) ?? [];
    list.push(group);
    byCategory.set(row.category_id, list);
  }
  return byCategory;
}

// ---------------------------------------------------------------------------
// Product <-> attribute option assignment
// ---------------------------------------------------------------------------

export async function getProductAttributeOptionIds(productId: string): Promise<string[]> {
  const rows = await query<{ attribute_option_id: string }>(
    "SELECT attribute_option_id FROM product_attribute_values WHERE product_id = $1",
    [productId]
  );
  return rows.map((r) => r.attribute_option_id);
}

/** Replaces the FULL set of attribute values for a product — same delete-then-insert-in-one-transaction pattern as setAttributeGroupCategories. */
export async function setProductAttributeValues(productId: string, optionIds: string[]): Promise<void> {
  await withTransaction(async (client) => {
    await client.query("DELETE FROM product_attribute_values WHERE product_id = $1", [productId]);
    for (const optionId of optionIds) {
      await client.query(
        "INSERT INTO product_attribute_values (product_id, attribute_option_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [productId, optionId]
      );
    }
  });
}

/** Product ids that have ALL of the given option ids. */
export async function listProductIdsWithAllOptions(optionIds: string[]): Promise<string[]> {
  if (optionIds.length === 0) return [];
  const rows = await query<{ product_id: string }>(
    `SELECT product_id FROM product_attribute_values
     WHERE attribute_option_id = ANY($1)
     GROUP BY product_id
     HAVING COUNT(DISTINCT attribute_option_id) = $2`,
    [optionIds, optionIds.length]
  );
  return rows.map((r) => r.product_id);
}

/** Product ids that have ANY of the given option ids — used within a single attribute group, where multiple selected options are OR'd (e.g. Fit = Baggy OR Slim). */
export async function listProductIdsWithAnyOption(optionIds: string[]): Promise<string[]> {
  if (optionIds.length === 0) return [];
  const rows = await query<{ product_id: string }>(
    "SELECT DISTINCT product_id FROM product_attribute_values WHERE attribute_option_id = ANY($1)",
    [optionIds]
  );
  return rows.map((r) => r.product_id);
}
