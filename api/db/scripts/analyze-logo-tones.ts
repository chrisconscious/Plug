/**
 * One-off backfill for migration 0054: detects the presentation tone of brand
 * logos uploaded BEFORE tone detection existed (new uploads are analyzed
 * automatically). Only reads the stored files — never modifies them.
 *
 * Usage:
 *   npm run media:analyze-logo-tones            # only logos with no tone yet
 *   npm run media:analyze-logo-tones -- --all   # re-analyze every logo
 */
import { query } from "../../src/lib/db/client";
import { brandLogoStorage } from "../../src/lib/storage/storage";
import { analyzeLogoTone } from "../../src/lib/security/image-tone";

const ALL = process.argv.includes("--all");

async function main() {
  if (!brandLogoStorage.get) {
    console.error(`Storage provider "${brandLogoStorage.name}" cannot read files back.`);
    process.exit(1);
  }
  const rows = await query<{ brand_id: string; name: string; storage_key: string; content_type: string }>(
    `SELECT l.brand_id, b.name, l.storage_key, l.content_type
     FROM brand_logos l JOIN brands b ON b.id = l.brand_id
     ${ALL ? "" : "WHERE l.tone IS NULL"}`
  );
  let updated = 0;
  for (const r of rows) {
    const data = await brandLogoStorage.get(r.storage_key);
    if (!data) {
      console.warn(`  ${r.name}: file missing in storage (${r.storage_key}) — skipped`);
      continue;
    }
    const tone = analyzeLogoTone(data, r.content_type);
    await query("UPDATE brand_logos SET tone = $2 WHERE brand_id = $1", [r.brand_id, tone]);
    console.log(`  ${r.name}: ${tone ?? "unknown (set it in the admin if needed)"}`);
    if (tone) updated++;
  }
  console.log(`Analyzed ${rows.length} logo(s); ${updated} classified.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
