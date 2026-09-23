#!/usr/bin/env node
/**
 * Static migration validation — runs without a database connection, so it
 * can run on every PR regardless of whether a Postgres instance is
 * available in that CI job. Checks:
 *   1. Every migration file is sequentially numbered with no gaps.
 *   2. No migration number is duplicated.
 *   3. Every file has balanced parentheses and quotes (catches an
 *      unterminated string or unbalanced paren before it ever reaches a
 *      real database, where the failure mode would be a cryptic syntax
 *      error instead of a clear message pointing at the exact file).
 *   4. No destructive keywords (DROP TABLE/COLUMN, TRUNCATE, DELETE FROM
 *      with no WHERE clause) appear without an explicit acknowledgement
 *      comment — see the ALLOW_DESTRUCTIVE marker below. This project's
 *      migrations have been additive-only throughout (see
 *      docs/MIGRATIONS.md); this check makes that a verified property
 *      going forward, not just a historical fact.
 *
 * This does NOT replace actually running migrations against a real
 * database (see docs/MIGRATIONS.md's "Testing from an empty database" —
 * that step needs a real Postgres and is not run here).
 *
 * Usage: node scripts/check-migrations.mjs
 * Exit code 0 = clean. Exit code 1 = problems found (see stdout).
 */
import { readdirSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "db", "migrations");
const ALLOW_DESTRUCTIVE_MARKER = "-- ALLOW_DESTRUCTIVE:";

/**
 * Strips SQL line comments (`-- ...` to end of line) while correctly
 * tracking single-quoted string state — a `--` that appears INSIDE a
 * string literal (e.g. a COMMENT ON COLUMN whose text itself contains a
 * double-dash) is not a comment and must not be treated as one. A naive
 * "truncate at the first --" approach gets this wrong and was caught
 * doing so on this project's own migration 0019, which has exactly this
 * case in a real COMMENT ON COLUMN string.
 */
function stripSqlComments(content) {
  let out = "";
  let inString = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];
    if (ch === "'") {
      // A doubled '' inside a string is an escaped literal quote, not the
      // string's end — consume both characters as one unit so the
      // "inString" toggle isn't flipped twice in a row.
      if (inString && next === "'") {
        out += "''";
        i++;
        continue;
      }
      inString = !inString;
      out += ch;
      continue;
    }
    if (!inString && ch === "-" && next === "-") {
      // Real comment start — skip to end of line.
      const eol = content.indexOf("\n", i);
      i = eol === -1 ? content.length : eol - 1;
      continue;
    }
    out += ch;
  }
  return out;
}

function main() {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const problems = [];

  // ---- 1 & 2: sequential numbering, no gaps, no duplicates ----
  const numbers = files.map((f) => {
    const m = f.match(/^(\d+)_/);
    return m ? parseInt(m[1], 10) : null;
  });
  const seen = new Set();
  for (let i = 0; i < files.length; i++) {
    const n = numbers[i];
    if (n === null) {
      problems.push(`${files[i]}: does not start with a numeric prefix (expected NNNN_description.sql)`);
      continue;
    }
    if (seen.has(n)) problems.push(`Duplicate migration number ${n} (${files[i]})`);
    seen.add(n);
  }
  const sortedNumbers = [...seen].sort((a, b) => a - b);
  for (let i = 1; i < sortedNumbers.length; i++) {
    if (sortedNumbers[i] !== sortedNumbers[i - 1] + 1) {
      problems.push(`Gap in migration numbering: ${sortedNumbers[i - 1]} is followed by ${sortedNumbers[i]}, not ${sortedNumbers[i - 1] + 1}`);
    }
  }
  if (sortedNumbers.length > 0 && sortedNumbers[0] !== 1) {
    problems.push(`Migrations should start at 0001, but the first one found is ${sortedNumbers[0]}`);
  }

  // ---- 3 & 4: per-file structural + destructive-operation checks ----
  for (const file of files) {
    const content = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const withoutComments = stripSqlComments(content);

    let parens = 0;
    for (const ch of withoutComments) {
      if (ch === "(") parens++;
      if (ch === ")") parens--;
    }
    if (parens !== 0) problems.push(`${file}: unbalanced parentheses (delta ${parens})`);

    const singleQuotes = (withoutComments.match(/'/g) ?? []).length;
    if (singleQuotes % 2 !== 0) problems.push(`${file}: odd number of single-quote characters outside comments (possible unterminated string)`);

    const destructivePatterns = [
      { re: /\bDROP\s+TABLE\b/i, label: "DROP TABLE" },
      { re: /\bDROP\s+COLUMN\b/i, label: "DROP COLUMN" },
      { re: /\bTRUNCATE\b/i, label: "TRUNCATE" },
      { re: /\bDELETE\s+FROM\s+\w+\s*;/i, label: "DELETE FROM with no WHERE clause" },
    ];
    for (const { re, label } of destructivePatterns) {
      if (re.test(withoutComments) && !content.includes(ALLOW_DESTRUCTIVE_MARKER)) {
        problems.push(`${file}: contains ${label} with no "${ALLOW_DESTRUCTIVE_MARKER}" acknowledgement comment — see docs/MIGRATIONS.md's rollback-strategy section on why this project's migrations have been additive-only`);
      }
    }
  }

  if (problems.length > 0) {
    console.error(`Migration validation FAILED (${problems.length} issue(s)):\n`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  console.log(`OK — ${files.length} migrations (0001-${String(sortedNumbers[sortedNumbers.length - 1]).padStart(4, "0")}), sequential, no gaps, structurally sound.`);
  process.exit(0);
}

main();
