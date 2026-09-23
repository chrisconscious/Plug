#!/usr/bin/env node
/**
 * Contract drift check: compares every path declared in
 * docs/openapi/openapi.yaml against the actual route.ts files present
 * under src/app/api/v1. Exits non-zero (CI-failing) if:
 *   - a path in the OpenAPI doc has no corresponding route.ts file, or
 *   - a path/method combination declared in the doc has no matching
 *     exported HTTP method in that route file.
 *
 * This does NOT check that every route.ts is documented in the OpenAPI
 * doc — see docs/openapi/README.md's "Known limitations" for why full
 * bidirectional coverage isn't enforced yet (the doc intentionally covers
 * a subset of the ~74 endpoints; docs/api/CONTRACT.md is the complete
 * endpoint inventory). This script only prevents the OpenAPI doc from
 * silently drifting to describe endpoints that no longer exist, or
 * methods a route no longer actually exports.
 *
 * Usage: node scripts/check-openapi-drift.mjs
 * Exit code 0 = no drift found. Exit code 1 = drift found (see stdout).
 */
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import yaml from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OPENAPI_PATH = join(REPO_ROOT, "docs/openapi/openapi.yaml");
const ROUTES_ROOT = join(REPO_ROOT, "src/app/api/v1");

function openApiPathToFsPath(openApiPath) {
  // "/products/{slug}" -> "products/[slug]" (Next.js App Router convention)
  const segments = openApiPath
    .replace(/^\//, "")
    .split("/")
    .map((seg) => (seg.startsWith("{") && seg.endsWith("}") ? `[${seg.slice(1, -1)}]` : seg));
  return join(ROUTES_ROOT, ...segments, "route.ts");
}

function main() {
  const doc = yaml.load(readFileSync(OPENAPI_PATH, "utf8"));
  const problems = [];

  for (const [openApiPath, methods] of Object.entries(doc.paths ?? {})) {
    const routeFile = openApiPathToFsPath(openApiPath);
    if (!existsSync(routeFile)) {
      problems.push(`MISSING FILE: ${openApiPath} -> expected ${routeFile.replace(REPO_ROOT + "/", "")}`);
      continue;
    }
    const source = readFileSync(routeFile, "utf8");
    for (const method of Object.keys(methods)) {
      const httpMethod = method.toUpperCase();
      const exportPattern = new RegExp(`export const ${httpMethod}\\s*=`);
      if (!exportPattern.test(source)) {
        problems.push(`MISSING METHOD: ${httpMethod} ${openApiPath} — route.ts has no "export const ${httpMethod}"`);
      }
    }
  }

  if (problems.length > 0) {
    console.error(`Contract drift detected (${problems.length} issue(s)):\n`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error(`\nEither the OpenAPI doc describes an endpoint that no longer exists, or a route`);
    console.error(`file was changed without updating docs/openapi/openapi.yaml to match.`);
    process.exit(1);
  }

  console.log(`OK — all ${Object.keys(doc.paths ?? {}).length} documented paths resolve to a real route file with a matching exported method.`);
  process.exit(0);
}

main();
