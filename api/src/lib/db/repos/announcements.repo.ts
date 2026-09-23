import { query, queryOne, withTransaction } from "../client";
import type { Announcement } from "../types";

type AnnouncementRow = {
  id: string;
  message: string;
  active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
};

const toAnnouncement = (r: AnnouncementRow): Announcement => ({
  id: r.id,
  message: r.message,
  active: r.active,
  displayOrder: r.display_order,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const COLUMNS = "id, message, active, display_order, created_at, updated_at";

/** Public storefront query — only what the header announcement bar should show. */
export async function listActiveAnnouncements(): Promise<Announcement[]> {
  const rows = await query<AnnouncementRow>(
    `SELECT ${COLUMNS} FROM announcements WHERE active = true ORDER BY display_order, created_at`
  );
  return rows.map(toAnnouncement);
}

/** Admin view — every announcement, active and inactive. */
export async function listAllAnnouncements(): Promise<Announcement[]> {
  const rows = await query<AnnouncementRow>(`SELECT ${COLUMNS} FROM announcements ORDER BY display_order, created_at`);
  return rows.map(toAnnouncement);
}

export async function findAnnouncementById(id: string): Promise<Announcement | null> {
  const row = await queryOne<AnnouncementRow>(`SELECT ${COLUMNS} FROM announcements WHERE id = $1`, [id]);
  return row ? toAnnouncement(row) : null;
}

export type AnnouncementInsert = { message: string; active: boolean; displayOrder: number };

export async function insertAnnouncement(input: AnnouncementInsert): Promise<Announcement> {
  const row = await queryOne<AnnouncementRow>(
    `INSERT INTO announcements (message, active, display_order) VALUES ($1, $2, $3) RETURNING ${COLUMNS}`,
    [input.message, input.active, input.displayOrder]
  );
  return toAnnouncement(row!);
}

export type AnnouncementPatch = Partial<AnnouncementInsert>;

export async function updateAnnouncementFields(id: string, patch: AnnouncementPatch): Promise<Announcement | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (patch.message !== undefined) push("message", patch.message);
  if (patch.active !== undefined) push("active", patch.active);
  if (patch.displayOrder !== undefined) push("display_order", patch.displayOrder);
  if (sets.length === 0) return findAnnouncementById(id);

  params.push(id);
  const row = await queryOne<AnnouncementRow>(
    `UPDATE announcements SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING ${COLUMNS}`,
    params
  );
  return row ? toAnnouncement(row) : null;
}

export async function deleteAnnouncement(id: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>("DELETE FROM announcements WHERE id = $1 RETURNING id", [id]);
  return !!row;
}

/** Reassign contiguous display_order (0..n-1) for the given ordered id list — mirrors reorderHeroSlides's transaction pattern. */
export async function reorderAnnouncements(orderedIds: string[]): Promise<number> {
  if (orderedIds.length === 0) return 0;
  await withTransaction(async (client) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await client.query("UPDATE announcements SET display_order = $1 WHERE id = $2", [i, orderedIds[i]]);
    }
  });
  return orderedIds.length;
}
