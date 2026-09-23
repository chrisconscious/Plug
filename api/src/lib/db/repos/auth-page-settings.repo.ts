import { query, queryOne } from "../client";

const SINGLETON_ID = "00000000-0000-0000-0000-000000000001";

export type AuthPageSettingsRow = {
  background_image_url: string | null;
  login_headline: string;
  login_subtitle: string;
  register_headline: string;
  register_subtitle: string;
  updated_at: string;
};

export type AuthPageSettings = {
  backgroundImageUrl: string | null;
  loginHeadline: string;
  loginSubtitle: string;
  registerHeadline: string;
  registerSubtitle: string;
  updatedAt: string;
};

function toSettings(r: AuthPageSettingsRow): AuthPageSettings {
  return {
    backgroundImageUrl: r.background_image_url,
    loginHeadline: r.login_headline,
    loginSubtitle: r.login_subtitle,
    registerHeadline: r.register_headline,
    registerSubtitle: r.register_subtitle,
    updatedAt: r.updated_at,
  };
}

const COLUMNS = "background_image_url, login_headline, login_subtitle, register_headline, register_subtitle, updated_at";

export async function getAuthPageSettings(): Promise<AuthPageSettings | null> {
  const row = await queryOne<AuthPageSettingsRow>(`SELECT ${COLUMNS} FROM auth_page_settings WHERE id = $1`, [SINGLETON_ID]);
  return row ? toSettings(row) : null;
}

export async function updateAuthPageField(field: string, value: string | null, actorId: string): Promise<AuthPageSettings> {
  const allowed = ["background_image_url", "login_headline", "login_subtitle", "register_headline", "register_subtitle"];
  if (!allowed.includes(field)) throw new Error(`Invalid field: ${field}`);
  await query(
    `INSERT INTO auth_page_settings (id, ${field}, updated_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET ${field} = EXCLUDED.${field}, updated_by = EXCLUDED.updated_by`,
    [SINGLETON_ID, value, actorId]
  );
  return (await getAuthPageSettings())!;
}

export async function updateAuthPageFields(fields: Record<string, string | null>, actorId: string): Promise<AuthPageSettings> {
  const allowed = ["background_image_url", "login_headline", "login_subtitle", "register_headline", "register_subtitle"];
  const entries = Object.entries(fields).filter(([k]) => allowed.includes(k));
  if (entries.length === 0) return (await getAuthPageSettings())!;
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of entries) {
    params.push(v);
    sets.push(`${k} = $${params.length}`);
  }
  params.push(actorId);
  sets.push(`updated_by = $${params.length}`);
  const whereParam = params.length + 1;
  await query(
    `INSERT INTO auth_page_settings (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
    [SINGLETON_ID]
  );
  await query(`UPDATE auth_page_settings SET ${sets.join(", ")} WHERE id = $${whereParam}`, [...params, SINGLETON_ID]);
  return (await getAuthPageSettings())!;
}