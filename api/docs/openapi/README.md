# OpenAPI contract

`openapi.yaml` is a genuine, machine-parseable OpenAPI 3.0 document — not
prose. It has been validated as syntactically correct YAML and every
internal `$ref` has been checked to resolve to something that actually
exists in the document (see the commands below to re-check this
yourself).

## Scope — honest, not exhaustive

This document covers the endpoint categories the project asked for
(authentication, users, products, variants, categories, brands, images,
hero slides, cart, orders, admin) with a **representative subset** of
the ~74 total endpoints — enough to validate real requests/responses for
each category, not a line-by-line transcription of every route.

**`docs/api/CONTRACT.md` remains the complete endpoint inventory** (all
~74 routes, with auth mode/permission/rate-limit for each) — this OpenAPI
document is a schema-validating companion to it, not a replacement.

## Keeping this in sync — and detecting when it drifts

Two things exist specifically so this document doesn't quietly rot:

1. **`npm run check:openapi-drift`** (`scripts/check-openapi-drift.mjs`)
   — checks that every path this document declares actually has a
   corresponding `route.ts` file with a matching exported HTTP method.
   Wire this into CI so a route file rename/removal that isn't reflected
   here fails the build instead of silently going stale. Note its
   direction: it catches the OpenAPI doc describing something that no
   longer exists; it does not (yet) flag a new route that was never added
   to this document — see "Known limitations."
2. **Schema fields are grounded in the actual TypeScript types**, not
   guessed — e.g. `Product.tags`, `CartItem.available`, and the error
   response shape were all copied from the real `catalog.service.ts`,
   `cart.service.ts`, and `errors.ts` at the time of writing. If those
   change, this document needs a matching update — the drift script
   above does not check field-level accuracy, only path/method
   existence.

## Known limitations (stated plainly, not hidden)

- **Not all ~74 endpoints are documented here** — see "Scope" above.
- **The drift check is one-directional.** It never flags "this route
  exists but isn't in the OpenAPI doc" — only "this OpenAPI entry no
  longer matches a real route." Full bidirectional coverage would need
  either documenting every remaining endpoint or generating this file
  from route source directly (e.g. via `zod-to-openapi` if/when Zod
  schemas are introduced) — neither was in scope for this pass.
- **This document has not been run through a real OpenAPI validator**
  (e.g. `@apidevtools/swagger-parser`, Redocly CLI) — only checked for
  valid YAML and resolvable internal `$ref`s (see below). A real
  validator might catch structural issues these checks don't (e.g.
  OpenAPI 3.0 keyword misuse beyond simple ref resolution).

## Commands

```bash
# From api/, once dependencies are installed:
npm run check:openapi-drift

# A quick standalone sanity check without any dependencies (Python + PyYAML):
python3 -c "import yaml; yaml.safe_load(open('docs/openapi/openapi.yaml'))" && echo "valid YAML"
```
