import { query, queryOne, withTransaction } from "../client";
import type { ProductAccordionSection } from "../types";

type AccordionRow = {
  id: string;
  title: string;
  body: string;
  active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
};

const toAccordion = (r: AccordionRow): ProductAccordionSection => ({
  id: r.id,
  title: r.title,
  body: r.body,
  active: r.active,
  displayOrder: r.display_order,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const COLUMNS = "id, title, body, active, display_order, created_at, updated_at";

/** Public storefront query — only what the product detail page should show. */
export async function listActiveAccordionSections(): Promise<ProductAccordionSection[]> {
  const rows = await query<AccordionRow>(
    `SELECT ${COLUMNS} FROM product_accordion_sections WHERE active = true ORDER BY display_order, created_at`
  );
  return rows.map(toAccordion);
}

/** Admin view — every section, active and inactive. */
export async function listAllAccordionSections(): Promise<ProductAccordionSection[]> {
  const rows = await query<AccordionRow>(
    `SELECT ${COLUMNS} FROM product_accordion_sections ORDER BY display_order, created_at`
  );
  return rows.map(toAccordion);
}

export async function findAccordionSectionById(id: string): Promise<ProductAccordionSection | null> {
  const row = await queryOne<AccordionRow>(`SELECT ${COLUMNS} FROM product_accordion_sections WHERE id = $1`, [id]);
  return row ? toAccordion(row) : null;
}

export type AccordionInsert = { title: string; body: string; active: boolean; displayOrder: number };

export async function insertAccordionSection(input: AccordionInsert): Promise<ProductAccordionSection> {
  const row = await queryOne<AccordionRow>(
    `INSERT INTO product_accordion_sections (title, body, active, display_order) VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
    [input.title, input.body, input.active, input.displayOrder]
  );
  return toAccordion(row!);
}

export type AccordionPatch = Partial<AccordionInsert>;

export async function updateAccordionSectionFields(id: string, patch: AccordionPatch): Promise<ProductAccordionSection | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (patch.title !== undefined) push("title", patch.title);
  if (patch.body !== undefined) push("body", patch.body);
  if (patch.active !== undefined) push("active", patch.active);
  if (patch.displayOrder !== undefined) push("display_order", patch.displayOrder);
  if (sets.length === 0) return findAccordionSectionById(id);

  params.push(id);
  const row = await queryOne<AccordionRow>(
    `UPDATE product_accordion_sections SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING ${COLUMNS}`,
    params
  );
  return row ? toAccordion(row) : null;
}

export async function deleteAccordionSection(id: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>("DELETE FROM product_accordion_sections WHERE id = $1 RETURNING id", [id]);
  return !!row;
}

/** Reassign contiguous display_order (0..n-1) for the given ordered id list — mirrors reorderAnnouncements's transaction pattern. */
export async function reorderAccordionSections(orderedIds: string[]): Promise<number> {
  if (orderedIds.length === 0) return 0;
  await withTransaction(async (client) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await client.query("UPDATE product_accordion_sections SET display_order = $1 WHERE id = $2", [i, orderedIds[i]]);
    }
  });
  return orderedIds.length;
}