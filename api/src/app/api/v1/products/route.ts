import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { listProductsV2 } from "@/lib/services/catalog.service";

// Always revalidate: admin edits (price, stock, publish/archive) must show
// up on the very next storefront load, never from a stale browser/CDN copy.
const PAGE_CACHE = "no-cache";

const splitMulti = (v: string | null): string[] | undefined => {
  if (!v) return undefined;
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
};

export const GET = withRoute({ auth: "none", rateLimit: RateLimitRules.search }, async ({ req }) => {
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("pageSize") ?? "24") || 24));
  const sp = url.searchParams;

  const minPriceRaw = sp.get("minPrice");
  const maxPriceRaw = sp.get("maxPrice");
  const sortRaw = sp.get("sort");
  const saleRaw = sp.get("sale");

  const sortAllowed = ["recommended", "newest", "price_asc", "price_desc"];
  const availabilityRaw = sp.get("availability");
  const availability: "in_stock" | "out_of_stock" | undefined =
    availabilityRaw === "in_stock" || availabilityRaw === "out_of_stock" ? availabilityRaw : undefined;

  return json(
    await listProductsV2({
      brand: splitMulti(sp.get("brand")),
      category: sp.get("category") ?? undefined,
      subcategory: sp.get("subcategory") ?? undefined,
      size: splitMulti(sp.get("size")),
      color: splitMulti(sp.get("color")),
      minPrice: minPriceRaw && Number.isFinite(Number(minPriceRaw)) && Number(minPriceRaw) >= 0 ? Number(minPriceRaw) : undefined,
      maxPrice: maxPriceRaw && Number.isFinite(Number(maxPriceRaw)) && Number(maxPriceRaw) >= 0 ? Number(maxPriceRaw) : undefined,
      gender: sp.get("gender") ?? undefined,
      sale: saleRaw === "true" ? true : undefined,
      collection: sp.get("collection") ?? undefined,
      lifestyle: sp.get("lifestyle") ?? undefined,
      attributeOptionIds: splitMulti(sp.get("attr")),
      availability,
      sort: sortRaw && sortAllowed.includes(sortRaw) ? (sortRaw as NonNullable<Parameters<typeof listProductsV2>[0]["sort"]>) : undefined,
      search: sp.get("q") ?? undefined,
      page,
      pageSize,
    }),
    { cache: PAGE_CACHE }
  );
});
