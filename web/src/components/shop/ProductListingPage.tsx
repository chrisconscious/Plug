import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { X, ChevronDown, ChevronLeft, ChevronRight, SlidersHorizontal, Frown } from "lucide-react";
import * as api from "../../lib/api";
import { useAutoScrollCarousel } from "../../hooks/useAutoScrollCarousel";
import { formatTZS } from "../../lib/currency";
import {
  EMPTY_FILTERS,
  filtersToParams,
  paramsToFilters,
  SORT_OPTIONS,
  type ShopFilters,
} from "../../lib/shop";
import { getBrandCategoryUrl, getBrandUrl, getCategoryUrl, getGenderCategoryUrl, getLifestyleCategoryUrl, getLifestyleUrl, getShopAllUrl } from "../../lib/links";
import { StoreHeader } from "./StoreHeader";
import { ProductCard } from "./ProductCard";
import { CategoryCard } from "./CategoryCard";
import { FilterSidebar, type HideableSection } from "./FilterSidebar";

const fmt = (c: number) => formatTZS(c);
const PAGE_SIZE = 24;

// slug -> icon-key map for the storefront category tiles. Built once per app
// session (lifestyle facet categories don't ship the icon field) and shared by
// every lifestyle page visit.
let categoryIconCache: Record<string, string> | null = null;

/** One consistent "Shop by Category" showcase rail (shared CategoryCard in a
 *  `.catRow` scroller — the same design system as the homepage). Rendered by
 *  the Women/Men, brand and lifestyle listing contexts; each builds its cards
 *  from real facet/audience data and links back INTO its own context. The rail
 *  runs the exact same premium autoplay + drag-to-scroll engine as the
 *  homepage (see useAutoScrollCarousel): it glides slowly only when the row
 *  overflows, pauses on any manual scroll/drag and resumes after an idle
 *  delay, and keeps the arrow buttons as a desktop nudge — never fights the
 *  user, never duplicates a card. */
interface ShowcaseCard {
  slug: string;
  to: string;
  imageUrl?: string | null;
  iconKey?: string | null;
  name: string;
  count?: number;
}

function CategoryShowcase({ subtitle, meta, cards }: { subtitle: string; meta?: string; cards: ShowcaseCard[] }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const carousel = useAutoScrollCarousel({ ref: rowRef, active: cards.length > 0 });

  // Arrow buttons behave exactly like the homepage rail: pause the autoplay,
  // nudge by two cards (smooth), then let it resume after the idle delay.
  const scrollByCards = (dir: 1 | -1) => {
    const el = rowRef.current;
    if (!el) return;
    carousel.resumeSoon();
    const cardWidth = el.querySelector<HTMLElement>("[data-card]")?.offsetWidth ?? 200;
    el.scrollBy({ left: dir * (cardWidth + 16) * 2, behavior: "smooth" });
  };

  return (
    <section className="mt-6">
      <div className="flex items-end justify-between gap-3 mb-4">
        <div>
          <h2 className="font-black text-sm tracking-widest">SHOP BY CATEGORY</h2>
          <p className="mt-0.5 text-[11px] text-neutral-500">{subtitle}</p>
        </div>
        {meta ? <span className="text-[11px] text-neutral-400">{meta}</span> : null}
      </div>
      <div className="categoryCarouselWrap">
        <button
          type="button"
          className="categoryNavBtn"
          aria-label="Previous categories"
          onClick={() => scrollByCards(-1)}
        >
          <ChevronLeft size={18} />
        </button>
        <div ref={rowRef} className="catRow" role="list">
          {cards.map((c) => (
            <CategoryCard
              key={c.slug}
              to={c.to}
              imageUrl={c.imageUrl}
              iconKey={c.iconKey}
              name={c.name}
              count={c.count}
              listItem
            />
          ))}
        </div>
        <button
          type="button"
          className="categoryNavBtn"
          aria-label="Next categories"
          onClick={() => scrollByCards(1)}
        >
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="mt-6 border-t border-neutral-200" />
    </section>
  );
}

type Sheet = "none" | "filter" | "sort";

/** Display names for the product tag (collection) values that drive collection pages. */
const COLLECTION_NAMES: Record<string, string> = {
  new: "New In",
  trending: "Trending",
  premium: "Premium Collection",
  campus: "Campus Fashion",
};

function collectionTitle(slug: string): string {
  return COLLECTION_NAMES[slug] ?? slug.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Resolved listing context. Every visible destination (Women / Men / SALE /
 * a collection / a category / a brand / search / shop all) drives the page
 * title, breadcrumb, API query, filter relevance and rendered products from
 * this ONE object — they can never disagree because they all read it.
 */
interface ListingContext {
  /** Primary page title, e.g. WOMEN, DRESSES, NIKE, SALE, PREMIUM COLLECTION. */
  title: string;
  /** Short optional page description shown under the title. */
  description?: string;
  /** Breadcrumb segments (after HOME), each { label, to }. */
  crumb: { label: string; to: string }[];
  /** Sections of the filter sidebar that are locked by this context and hidden. */
  hidden: HideableSection[];
  /** Accent class for the title (keeps the platform's tone, allows subtle context color). */
  accent?: "sale";
  /** True when a context is active (not plain Shop All). */
  contextual: boolean;
}

export function ProductListingPage({ lifestyle: lifestyleSlug }: { lifestyle?: string } = {}) {
  const { slug: brandRoute } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => paramsToFilters(searchParams), [searchParams]);
  const sort = searchParams.get("sort") ?? "recommended";
  const q = searchParams.get("q") || "";
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);

  // Category-specific attribute groups (e.g. Fit/Rise for Jeans), lifted up
  // here (rather than fetched independently inside FilterSidebar) so both
  // the sidebar's checkboxes AND the active-filter chips below can resolve
  // an attribute option id to its readable name/group without a second,
  // duplicate fetch of the same data.
  const effectiveAttributeCategorySlug = filters.subcategory ?? filters.category;
  const [attributeGroups, setAttributeGroups] = useState<api.AttributeGroup[]>([]);

  // The brand slug lives on the route (/brands/:slug), the same brand listing
  // engine as every other context. On those pages the brand is locked (shown as
  // a removable chip, not a re-selectable side-bar option).
  const lockedBrand = lifestyleSlug ? null : brandRoute?.toLowerCase() || null;
  const [brandInfo, setBrandInfo] = useState<api.Brand | null>(null);
  const [brandLoaded, setBrandLoaded] = useState(lockedBrand ? false : true);

  useEffect(() => {
    if (!lockedBrand) {
      setBrandInfo(null);
      setBrandLoaded(true);
      return;
    }
    let on = true;
    setBrandInfo(null);
    setBrandLoaded(false);
    api
      .listBrands()
      .then((r) => {
        if (!on) return;
        const b = r.brands.find((x) => x.slug === lockedBrand);
        setBrandInfo(b ?? null);
        setBrandLoaded(true);
      })
      .catch(() => {
        if (on) {
          setBrandInfo(null);
          setBrandLoaded(true);
        }
      });
    return () => {
      on = false;
    };
  }, [lockedBrand]);

  const values: ShopFilters = lockedBrand ? { ...filters, brand: [lockedBrand] } : filters;

  // The lifestyle context lives on the route (/lifestyle/:lifestyleSlug) and is a
  // first-class locked listing context like brand — its meta drives the hero + title.
  const [lifestyleInfo, setLifestyleInfo] = useState<api.Lifestyle | null>(null);
  const [lifestyleLoaded, setLifestyleLoaded] = useState(lifestyleSlug ? false : true);

  useEffect(() => {
    if (!lifestyleSlug) {
      setLifestyleInfo(null);
      setLifestyleLoaded(true);
      return;
    }
    let on = true;
    setLifestyleInfo(null);
    setLifestyleLoaded(false);
    api
      .getLifestyleBySlug(lifestyleSlug)
      .then((r) => {
        if (on) {
          setLifestyleInfo(r.lifestyle);
          setLifestyleLoaded(true);
        }
      })
      .catch(() => {
        if (on) {
          setLifestyleInfo(null);
          setLifestyleLoaded(true);
        }
      });
    return () => {
      on = false;
    };
  }, [lifestyleSlug]);

  const [data, setData] = useState<api.ProductPage | null>(null);
  // The categories present in the CURRENT listing. On a brand page these are
  // brand-scoped (facets are computed under the locked brand), so they drive
  // both the brand's "Shop by Category" showcase AND the union of attribute
  // groups shown before a specific category is picked.
  const listingCategorySlugs = useMemo(
    () => [...new Set((data?.facets.categories ?? []).map((c) => c.slug))],
    [data]
  );
  useEffect(() => {
    let alive = true;
    if (effectiveAttributeCategorySlug) {
      api.listCategoryAttributes(effectiveAttributeCategorySlug)
        .then((r) => { if (alive) setAttributeGroups(r.groups); })
        .catch(() => { if (alive) setAttributeGroups([]); });
    } else if (lockedBrand && listingCategorySlugs.length > 0) {
      // Brand context with no category picked: surface the de-duplicated
      // attribute groups of every category that brand carries, so customers
      // can filter the brand by Fit/Rise/etc. before drilling into a category.
      api.listCategoriesBySlugAttributes(listingCategorySlugs)
        .then((r) => { if (alive) setAttributeGroups(r.groups); })
        .catch(() => { if (alive) setAttributeGroups([]); });
    } else {
      setAttributeGroups([]);
    }
    return () => { alive = false; };
  }, [effectiveAttributeCategorySlug, lockedBrand, listingCategorySlugs]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>("none");
  const [draft, setDraft] = useState<ShopFilters>(values);
  const [sortDraft, setSortDraft] = useState<string>(sort);
  // "Shop by Category" within the active gender audience (real DISTINCT query).
  const [genderCats, setGenderCats] = useState<api.GenderCategory[] | null>(null);
  // Every category on the plain Shop All page (same real list as the homepage —
  // rendered as a self-driving showcase rail like the contextual ones).
  const [allCats, setAllCats] = useState<api.Category[] | null>(null);
  // Lifestyle category tiles reuse the same icon set — facet categories don't
  // carry `icon`, so build a slug->icon map once per app session (cached below).
  const [catIconBySlug, setCatIconBySlug] = useState<Record<string, string>>({});

  const paramsKey = searchParams.toString() + (lockedBrand ? `|brand:${lockedBrand}` : "") + (lifestyleSlug ? `|lifestyle:${lifestyleSlug}` : "");

  useEffect(() => {
    let on = true;
    setLoading(true);
    setError(null);
    api
      .listProducts({
        brand: values.brand,
        category: filters.category ?? undefined,
        subcategory: filters.subcategory ?? undefined,
        size: filters.size,
        color: filters.color,
        minPrice: filters.minPrice ?? undefined,
        maxPrice: filters.maxPrice ?? undefined,
        gender: filters.gender ?? undefined,
        sale: filters.sale || undefined,
        collection: filters.collection ?? undefined,
        availability: (filters.availability as "in_stock" | "out_of_stock" | undefined) ?? undefined,
        attributeOptionIds: filters.attr.length ? filters.attr : undefined,
        q: q || undefined,
        lifestyle: lifestyleSlug ?? undefined,
        sort: (sort as api.ProductListParams["sort"]) ?? undefined,
        page,
        pageSize: PAGE_SIZE,
      })
      .then((r) => on && setData(r))
      .catch(() => on && setError("Could not load products. Please try again."))
      .finally(() => on && setLoading(false));
    return () => {
      on = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey]);

  // "Shop by Category" showcase for the active gender audience. Only when a
  // gender context is live with no specific category/subcategory/search, so it
  // never competes with an already-narrowed category listing.
  const showGenderShowcase = !!filters.gender && !filters.category && !filters.subcategory && !q;

  // Plain Shop All (no context): give the page the same Shop-by-Category rail
  // as every contextual listing, driven by the real active category list.
  const showShopAllShowcase =
    !lockedBrand && !lifestyleSlug && !q && !filters.sale && !filters.collection && !filters.gender &&
    !filters.category && !filters.subcategory;

  useEffect(() => {
    let on = true;
    if (!showShopAllShowcase) {
      setAllCats(null);
      return;
    }
    api
      .listCategories()
      .then((r) => on && setAllCats(r.categories.length ? r.categories : null))
      .catch(() => on && setAllCats(null));
    return () => {
      on = false;
    };
  }, [showShopAllShowcase]);

  useEffect(() => {
    let on = true;
    setGenderCats(null);
    if (!showGenderShowcase) return;
    api
      .listCategoriesByGender(filters.gender as string)
      .then((r) => on && setGenderCats(r.categories.length ? r.categories : null))
      .catch(() => on && setGenderCats(null));
    return () => {
      on = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showGenderShowcase, filters.gender]);

  useEffect(() => {
    if (!lifestyleSlug && !lockedBrand) return;
    let on = true;
    if (categoryIconCache) {
      setCatIconBySlug(categoryIconCache);
      return;
    }
    api
      .listCategories()
      .then(({ categories }) => {
        if (!on) return;
        const map: Record<string, string> = {};
        for (const c of categories) map[c.slug] = c.icon ?? "box";
        categoryIconCache = map;
        setCatIconBySlug(map);
      })
      .catch(() => on && setCatIconBySlug({}));
    return () => {
      on = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lifestyleSlug, lockedBrand]);

  const total = data?.pagination.total ?? 0;

  const commitParams = (next: ShopFilters, keepPage = false) => {
    const p = filtersToParams(next);
    // In a locked brand context the brand lives on the route — never duplicate
    // it into the query string (keeps URLs clean and shareable).
    if (lockedBrand) p.delete("brand");
    if (q) p.set("q", q);
    if (sort && sort !== "recommended") p.set("sort", sort);
    if (!keepPage && page !== 1) p.set("page", "1");
    else if (page !== 1) p.set("page", String(page));
    setSearchParams(p, { replace: false });
    setSheet("none");
  };

  const applySort = (s: string) => {
    const p = new URLSearchParams(searchParams);
    if (lockedBrand) p.delete("brand");
    if (s && s !== "recommended") p.set("sort", s);
    else p.delete("sort");
    p.delete("page");
    setSearchParams(p);
    setSheet("none");
  };

  const removeChip = (type: string, value?: string) => {
    const next = { ...values };
    if (type === "brand") {
      // Removing the locked brand context returns to Shop All (the brand lives
      // on the route, so we navigate away from it — never a dead end).
      if (lockedBrand) {
        navigate(getShopAllUrl());
        setSheet("none");
        return;
      }
      next.brand = next.brand.filter((x) => x !== value);
    } else if (type === "size") next.size = next.size.filter((x) => x !== value);
    else if (type === "color") next.color = next.color.filter((x) => x !== value);
    else if (type === "category") { next.category = null; next.subcategory = null; }
    else if (type === "subcategory") { next.subcategory = null; }
    else if (type === "gender") next.gender = null;
    else if (type === "collection") next.collection = null;
    else if (type === "sale") next.sale = false;
    else if (type === "availability") next.availability = null;
    else if (type === "price") { next.minPrice = null; next.maxPrice = null; }
    else if (type === "attr" && value) next.attr = next.attr.filter((x) => x !== value);
    commitParams(next);
  };

  const brandName = (slug: string) => data?.facets.brands.find((b) => b.value === slug)?.name ?? slug;
  const categoryName = (slug: string) => data?.facets.categories.find((c) => c.slug === slug)?.name ?? slug;

  const activeChips: { key: string; label: string; type: string; value?: string }[] = [];
  values.brand.forEach((b) => activeChips.push({ key: `b${b}`, label: brandName(b), type: "brand", value: b }));
  if (filters.category)
    activeChips.push({ key: `c${filters.category}`, label: categoryName(filters.category), type: "category" });
  if (filters.subcategory)
    activeChips.push({ key: `s${filters.subcategory}`, label: categoryName(filters.subcategory), type: "subcategory" });
  filters.size.forEach((v) => activeChips.push({ key: `z${v}`, label: `Size ${v}`, type: "size", value: v }));
  filters.color.forEach((v) => activeChips.push({ key: `o${v}`, label: v, type: "color", value: v }));
  if (filters.gender) activeChips.push({ key: `g${filters.gender}`, label: filters.gender, type: "gender" });
  if (filters.collection) activeChips.push({ key: `l${filters.collection}`, label: collectionTitle(filters.collection), type: "collection" });
  if (filters.sale) activeChips.push({ key: "sale", label: "On Sale", type: "sale" });
  if (filters.availability) activeChips.push({ key: "avail", label: filters.availability === "in_stock" ? "In Stock" : "Out of Stock", type: "availability" });
  if (filters.minPrice != null || filters.maxPrice != null) {
    const lo = filters.minPrice ?? 0;
    const hi = filters.maxPrice;
    activeChips.push({ key: "price", label: hi != null ? `${fmt(lo)} – ${fmt(hi)}` : `${fmt(lo)}+`, type: "price" });
  }
  if (q) activeChips.push({ key: "q", label: `"${q}"`, type: "q" });
  // Attribute chips resolve id -> readable "Group: Option" label from the
  // same attributeGroups data the sidebar renders from — never a second
  // fetch, and never just the raw id shown to the customer.
  filters.attr.forEach((optionId) => {
    for (const group of attributeGroups) {
      const opt = (group.options ?? []).find((o) => o.id === optionId);
      if (opt) {
        activeChips.push({ key: `a${optionId}`, label: `${group.name}: ${opt.name}`, type: "attr", value: optionId });
        break;
      }
    }
  });

  const clearAll = () => {
    const next = JSON.parse(JSON.stringify(EMPTY_FILTERS)) as ShopFilters;
    if (lockedBrand) next.brand = [lockedBrand];
    commitParams(next);
  };

  const clearQ = () => {
    const p = new URLSearchParams(searchParams);
    if (lockedBrand) p.delete("brand");
    p.delete("q");
    p.delete("page");
    setSearchParams(p);
  };

  const totalLabel = total === 1 ? "1 Product" : `${total} Products`;

  const handleSortDraft = (s: string) => setSortDraft(s);

  const openFilterSheet = () => {
    setDraft(values);
    setSheet("filter");
  };
  const openSortSheet = () => {
    setSortDraft(sort);
    setSheet("sort");
  };

  // ---- Context resolution (single object drives title + crumb + filters) ----
  const ctx: ListingContext = useMemo(() => {
    const HOME = { label: "HOME", to: "/" };
    if (lifestyleSlug && lifestyleInfo) {
      return {
        title: lifestyleInfo.name.toUpperCase(),
        description: `${total} product${total === 1 ? "" : "s"}`,
        crumb: [HOME, { label: "LIFESTYLES", to: "/" }, { label: lifestyleInfo.name.toUpperCase(), to: getLifestyleUrl(lifestyleInfo.slug) }],
        hidden: [],
        contextual: true,
      };
    }
    if (lockedBrand && brandInfo) {
      return {
        title: brandInfo.name.toUpperCase(),
        description: `${total} product${total === 1 ? "" : "s"} from ${brandInfo.name}`,
        crumb: [HOME, { label: "BRANDS", to: "/brands" }, { label: brandInfo.name.toUpperCase(), to: getBrandUrl(brandInfo.slug) }],
        hidden: ["brand"],
        contextual: true,
      };
    }
    if (lockedBrand) {
      return {
        title: (brandRoute ?? "").toUpperCase(),
        crumb: [HOME, { label: "BRANDS", to: "/brands" }, { label: (brandRoute ?? "").toUpperCase(), to: getBrandUrl(brandRoute as string) }],
        hidden: ["brand"],
        contextual: true,
      };
    }
    if (q) {
      return {
        title: `SEARCH RESULTS FOR “${q.toUpperCase()}”`,
        crumb: [HOME, { label: "SEARCH", to: getShopAllUrl() }],
        hidden: [],
        contextual: true,
      };
    }
    if (filters.sale) {
      return {
        title: "SALE",
        description: `${total} discounted product${total === 1 ? "" : "s"}`,
        crumb: [HOME, { label: "SALE", to: "/shop?sale=true" }],
        hidden: [],
        accent: "sale",
        contextual: true,
      };
    }
    if (filters.collection) {
      return {
        title: collectionTitle(filters.collection).toUpperCase(),
        crumb: [HOME, { label: "COLLECTIONS", to: getShopAllUrl() }, { label: collectionTitle(filters.collection).toUpperCase(), to: `/shop?collection=${filters.collection}` }],
        hidden: ["collection"],
        contextual: true,
      };
    }
    if (filters.gender && !filters.category && !filters.subcategory) {
      return {
        title: filters.gender.toUpperCase(),
        crumb: [HOME, { label: filters.gender.toUpperCase(), to: `/shop?gender=${filters.gender}` }],
        hidden: ["gender"],
        contextual: true,
      };
    }
    if (filters.category || filters.subcategory) {
      const cat = (filters.subcategory ?? filters.category)!;
      return {
        title: categoryName(cat).toUpperCase(),
        crumb: [HOME, { label: categoryName(cat).toUpperCase(), to: getCategoryUrl(cat) }],
        hidden: ["category"],
        contextual: true,
      };
    }
    return {
      title: "SHOP ALL",
      crumb: [HOME, { label: "SHOP ALL", to: getShopAllUrl() }],
      hidden: [],
      contextual: false,
    };
  }, [lockedBrand, brandRoute, brandInfo, lifestyleSlug, lifestyleInfo, total, q, filters, categoryName]);

  const brandMissing = lockedBrand && brandLoaded && !brandInfo;
  const lifestyleMissing = !!lifestyleSlug && lifestyleLoaded && !lifestyleInfo;

  return (
    <div>
      <StoreHeader />
      <main className="mx-auto max-w-[1500px] px-4 md:px-8 py-6 md:py-8">
        {/* Header row — breadcrumb + identity driven by ctx */}
        <div className="border-b border-neutral-200 pb-4">
          <p className="text-[10px] tracking-widest text-neutral-400 mb-2">
            {ctx.crumb.map((c, i) => (
              <span key={c.label}>
                {i > 0 && <span className="mx-1.5 text-neutral-300">/</span>}
                {i < ctx.crumb.length - 1 ? <Link to={c.to} className="hover:text-neutral-700">{c.label}</Link> : <span className="text-neutral-600">{c.label}</span>}
              </span>
            ))}
          </p>
          {ctx.contextual && !q && (
            <p className="text-xs text-neutral-500 mb-1">
              <Link to={getShopAllUrl()} className="underline">back to all</Link>
            </p>
          )}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h1 className={`font-black text-2xl md:text-3xl tracking-tight break-words ${ctx.accent === "sale" ? "text-red-600" : ""}`}>{ctx.title}</h1>
              {ctx.description && <p className="mt-1 text-xs text-neutral-500">{ctx.description}</p>}
            </div>
            <div className="hidden md:flex items-center gap-4">
              <span className="text-xs text-neutral-500">{loading ? "Loading…" : totalLabel}</span>
              <select
                value={sort}
                onChange={(e) => applySort(e.target.value)}
                className="border border-neutral-300 px-3 py-2 text-xs font-semibold focus:outline-none focus:border-neutral-900"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>Sort: {o.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Active filter chips */}
        {activeChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 py-3">
            {activeChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={() => (chip.type === "q" ? clearQ() : removeChip(chip.type, chip.value))}
                className="flex items-center gap-1.5 border border-neutral-300 px-2.5 py-1 text-[11px] font-medium hover:border-neutral-900"
              >
                {chip.label}
                <X size={12} />
              </button>
            ))}
            {!lockedBrand && (
              <button
                type="button"
                onClick={clearAll}
                className="text-[11px] font-semibold underline underline-offset-2 hover:text-neutral-700"
              >
                Clear All
              </button>
            )}
          </div>
        )}

        {/* Shop by Category — plain Shop All rail (the real active category
            list, linking into each category's listing) */}
        {showShopAllShowcase && allCats && allCats.length > 0 && (
          <CategoryShowcase
            subtitle="Explore every category across the shop"
            meta={`${allCats.length} categories`}
            cards={allCats.map((c) => ({
              slug: c.slug,
              to: getCategoryUrl(c.slug),
              imageUrl: c.imageUrl,
              iconKey: c.icon,
              name: c.name,
            }))}
          />
        )}

        {/* Shop by Category — audience showcase (real DISTINCT category↔gender) */}
        {showGenderShowcase && genderCats && genderCats.length > 0 && (
          <CategoryShowcase
            subtitle={`Explore ${filters.gender} pieces across categories`}
            meta={`${genderCats.length} categories`}
            cards={genderCats.map((c) => ({
              slug: c.slug,
              to: getGenderCategoryUrl(filters.gender as string, c.slug),
              imageUrl: c.imageUrl,
              iconKey: c.icon,
              name: c.name,
              count: c.count,
            }))}
          />
        )}

        {/* Shop by Category — brand showcase (real brand-scoped facet query).
            Every category here belongs to this brand's catalog and links back
            INTO the brand context, so picking one keeps the brand locked and
            only shows that brand's products within the category. */}
        {lockedBrand && brandInfo && !filters.category && !filters.subcategory && !q && data && data.facets.categories.length > 0 && (
          <CategoryShowcase
            subtitle={`Explore ${brandInfo.name} across categories`}
            meta={`${data.facets.categories.length} categories`}
            cards={data.facets.categories.map((c) => ({
              slug: c.slug,
              to: getBrandCategoryUrl(brandInfo.slug, c.slug),
              iconKey: catIconBySlug[c.slug],
              name: c.name,
              count: c.count,
            }))}
          />
        )}

        {/* Shop by Category — lifestyle showcase (real facet query inside this
            lifestyle). Same compact tiles as Women/Men/SALE (the shared card
            system, one horizontal row that scrolls natively) — the categories
            are always the ones actually present in the selected lifestyle. */}
        {!!lifestyleSlug && lifestyleInfo && !filters.category && !filters.subcategory && !q && data && data.facets.categories.length > 0 && (
          <CategoryShowcase
            subtitle={`Explore the ${lifestyleInfo.name} edit across categories`}
            cards={data.facets.categories.map((c) => ({
              slug: c.slug,
              to: getLifestyleCategoryUrl(lifestyleSlug, c.slug),
              iconKey: catIconBySlug[c.slug],
              name: c.name,
            }))}
          />
        )}

        {/* Body */}
        <div className="mt-4 grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-8">
          {/* Desktop sidebar */}
          <aside className="hidden lg:block">
            {data ? (
              <FilterSidebar
                facets={data.facets}
                categories={data.facets.categories.map((c) => ({ id: c.parentId ?? c.slug, slug: c.slug, name: c.name, parentId: c.parentId, active: true, displayOrder: 0 }))}
                values={values}
                onChange={(next) => commitParams(next)}
                attributeGroups={attributeGroups}
                sort={sort}
                onSort={applySort}
                hiddenSections={ctx.hidden}
              />
            ) : (
              <div className="text-sm text-neutral-400 py-8">Loading filters…</div>
            )}
          </aside>

          {/* Product grid */}
          <section>
            {/* Mobile toolbar */}
            <div className="lg:hidden flex items-center justify-between gap-3 border border-neutral-200 px-3 py-2.5 mb-4 text-xs font-bold tracking-widest">
              <button type="button" onClick={openFilterSheet} className="flex items-center gap-2">
                <SlidersHorizontal size={14} /> FILTER {(activeChips.length > 0) && <span className="text-neutral-400">({activeChips.length})</span>}
              </button>
              <span className="text-neutral-500 font-normal">{loading ? "…" : totalLabel}</span>
              <button type="button" onClick={openSortSheet} className="flex items-center gap-1">
                SORT <ChevronDown size={13} />
              </button>
            </div>

            {lifestyleMissing ? (
              <div className="py-20 text-center">
                <Frown className="mx-auto mb-4 text-neutral-300" size={40} />
                <h2 className="text-lg font-bold">Lifestyle not found</h2>
                <p className="mt-1 text-sm text-neutral-500">This edit isn't available right now. Take me back to the shop.</p>
                <Link to={getShopAllUrl()} className="mt-6 inline-block border border-neutral-900 px-6 py-3 text-xs font-bold tracking-widest hover:bg-neutral-900 hover:text-white transition-colors">
                  SHOP ALL
                </Link>
              </div>
            ) : brandMissing ? (
              <div className="py-20 text-center">
                <Frown className="mx-auto mb-4 text-neutral-300" size={40} />
                <h2 className="text-lg font-bold">Brand not found</h2>
                <p className="mt-1 text-sm text-neutral-500">We couldn't find that brand.</p>
                <Link to="/brands" className="mt-6 inline-block border border-neutral-900 px-6 py-3 text-xs font-bold tracking-widest hover:bg-neutral-900 hover:text-white transition-colors">
                  VIEW ALL BRANDS
                </Link>
              </div>
            ) : error ? (
              <div className="py-20 text-center text-sm text-neutral-600">
                <p className="mb-3">{error}</p>
                <Link to={getShopAllUrl()} className="underline underline-offset-2">Go back to all products</Link>
              </div>
            ) : loading && !data ? (
              <div className="py-20 text-center text-sm text-neutral-400">Loading products…</div>
            ) : data && data.items.length === 0 ? (
              <div className="py-20 text-center">
                <Frown className="mx-auto mb-4 text-neutral-300" size={40} />
                <h2 className="text-lg font-bold">No products found</h2>
                <p className="mt-1 text-sm text-neutral-500">Try adjusting or clearing your filters.</p>
                <button
                  type="button"
                  onClick={clearAll}
                  className="mt-6 border border-neutral-900 px-6 py-3 text-xs font-bold tracking-widest hover:bg-neutral-900 hover:text-white transition-colors"
                >
                  CLEAR ALL FILTERS
                </button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-8">
                  {(data?.items ?? []).map((p) => (
                    <ProductCard key={p.id} product={p} />
                  ))}
                </div>

                {/* Pagination */}
                {(data?.pagination.total ?? 0) > PAGE_SIZE && (
                  <div className="mt-10 flex items-center justify-center gap-2">
                    {Array.from({ length: Math.ceil((data?.pagination.total ?? 0) / PAGE_SIZE) }, (_, i) => i + 1).map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => {
                          const p = new URLSearchParams(searchParams);
                          if (lockedBrand) p.delete("brand");
                          if (n === 1) p.delete("page");
                          else p.set("page", String(n));
                          setSearchParams(p);
                        }}
                        className={`h-9 w-9 border text-sm font-semibold ${n === page ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 hover:border-neutral-900"}`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </main>

      {/* Mobile filter sheet */}
      {sheet === "filter" && (
        <div className="fixed inset-0 z-[80] bg-black/50 lg:hidden" onClick={() => setSheet("none")}>
          <div
            className="absolute inset-y-0 right-0 w-full max-w-sm bg-white p-5 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-black tracking-widest text-sm">FILTER BY</h2>
              <button type="button" onClick={() => setSheet("none")}><X size={18} /></button>
            </div>
            {data && (
              <FilterSidebar
                facets={data.facets}
                categories={data.facets.categories.map((c) => ({ id: c.parentId ?? c.slug, slug: c.slug, name: c.name, parentId: c.parentId, active: true, displayOrder: 0 }))}
                values={draft}
                onChange={(next) => setDraft(next)}
                attributeGroups={attributeGroups}
                sort={sortDraft}
                onSort={handleSortDraft}
                hiddenSections={ctx.hidden}
              />
            )}
            <div className="sticky bottom-0 mt-5 bg-white pt-3 border-t border-neutral-200 space-y-2">
              <button
                type="button"
                onClick={() => commitParams(draft)}
                className="w-full bg-neutral-900 text-white py-3 text-xs font-bold tracking-widest"
              >
                SHOW {data ? data.pagination.total : 0} PRODUCTS
              </button>
              <button
                type="button"
                onClick={() => setDraft(JSON.parse(JSON.stringify(EMPTY_FILTERS)) as ShopFilters)}
                className="w-full border border-neutral-300 py-3 text-xs font-bold tracking-widest"
              >
                CLEAR ALL
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile sort sheet */}
      {sheet === "sort" && (
        <div className="fixed inset-0 z-[80] bg-black/50 lg:hidden" onClick={() => setSheet("none")}>
          <div className="absolute bottom-0 inset-x-0 bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-black tracking-widest text-sm">SORT BY</h2>
              <button type="button" onClick={() => setSheet("none")}><X size={18} /></button>
            </div>
            <ul>
              {SORT_OPTIONS.map((o) => (
                <li key={o.value}>
                  <button
                    type="button"
                    onClick={() => applySort(o.value)}
                    className={`w-full py-3 text-left text-sm font-medium border-b border-neutral-100 ${sort === o.value ? "text-neutral-900 font-bold" : "text-neutral-600"}`}
                  >
                    {o.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}