import { useState, type ReactNode } from "react";
import type { Category, ProductFacets, AttributeGroup } from "../../lib/api";
import { formatTZS } from "../../lib/currency";
import { colorHex, isNumericSizeSet, sortSizeValues, SORT_OPTIONS } from "../../lib/shop";
import type { ShopFilters } from "../../lib/shop";
import { SlidersHorizontal } from "lucide-react";

const fmt = (c: number) => formatTZS(c);

function Section({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-neutral-200 py-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-[11px] font-extrabold tracking-[.14em] text-neutral-900"
      >
        <span>{title}</span>
        <span className="text-neutral-400">{open ? "−" : "+"}</span>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

export type HideableSection = "brand" | "gender" | "collection" | "category";

interface FilterSidebarProps {
  facets: ProductFacets;
  categories: Category[];
  values: ShopFilters;
  onChange: (next: ShopFilters) => void;
  /** Category-specific attribute groups (e.g. Fit/Rise for Jeans) — fetched once by the parent page and passed down, so the sidebar and the active-filter chips both resolve option ids to names from the same data instead of each fetching it independently. */
  attributeGroups: AttributeGroup[];
  /** Mobile sheet shows a sort select too (sort is top-level on desktop). */
  showSort?: boolean;
  sort: string;
  onSort: (s: string) => void;
  /**
   * Sections to hide because the current listing context already locks them
   * (e.g. a Brand page hides the brand selector, a Women page hides gender).
   * These are shown as a removable active chip / breadcrumb instead of being
   * re-selectable — keeping the panel's options relevant to the context.
   */
  hiddenSections?: HideableSection[];
}

export function FilterSidebar({ facets, categories, values, onChange, attributeGroups, showSort, sort, onSort, hiddenSections = [] }: FilterSidebarProps) {
  const hide = (s: HideableSection) => hiddenSections.includes(s);

  const toggleAttributeOption = (group: AttributeGroup, optionId: string) => {
    const current = values.attr;
    const groupOptionIds = (group.options ?? []).map((o) => o.id);
    if (group.selectionType === "single_select") {
      const isSelected = current.includes(optionId);
      onChange({ ...values, attr: isSelected ? current.filter((id) => !groupOptionIds.includes(id)) : [...current.filter((id) => !groupOptionIds.includes(id)), optionId] });
    } else {
      onChange({ ...values, attr: current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId] });
    }
  };

  // Merge facet counts (which, for categories, are per-subcategory) with the
  // full category tree so the sidebar can render parent groups.
  const categoryFacets = facets.categories;
  const parentCount = (slug: string) => {
    const f = categoryFacets.find((c) => c.slug === slug);
    return f?.count ?? 0;
  };

  const childrenOf = (parentSlug: string | null | undefined) =>
    categoryFacets.filter((c) => (parentSlug ? c.parentId === (categories.find((x) => x.slug === parentSlug)?.id ?? null) : c.parentId == null));

  const topLevel = childrenOf(null);
  const numericSizes = isNumericSizeSet(facets.sizes.map((s) => s.value));
  const orderedSizes = sortSizeValues(facets.sizes);
  const price = facets.price;

  const set = (patch: Partial<ShopFilters>) => onChange({ ...values, ...patch });

  const toggleArr = (key: "brand" | "size" | "color", value: string) => {
    const arr = values[key];
    set({ [key]: arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value] } as Partial<ShopFilters>);
  };

  return (
    <div>
      {showSort && (
        <div className="mb-4">
          <label className="text-[11px] font-extrabold tracking-[.14em] text-neutral-900">SORT BY</label>
          <select
            value={sort}
            onChange={(e) => onSort(e.target.value)}
            className="mt-2 w-full border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:border-neutral-900"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* Category */}
      {!hide("category") && (
        <Section title="CATEGORY">
        <ul className="space-y-2 text-[13px]">
          <li>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="cat" checked={values.category == null && values.subcategory == null} onChange={() => set({ category: null, subcategory: null })} />
              <span>All</span>
            </label>
          </li>
          {topLevel.map((p) => {
            const kids = childrenOf(p.slug);
            const activeParent = values.category === p.slug;
            const activeSub = kids.some((k) => values.subcategory === k.slug);
            return (
              <li key={p.slug} className="space-y-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="cat"
                    checked={activeParent}
                    onChange={() => set({ category: p.slug, subcategory: null })}
                  />
                  <span className="flex-1">{p.name}</span>
                  <span className="text-[11px] text-neutral-400">{parentCount(p.slug)}</span>
                </label>
                {kids.length > 0 && (
                  <ul className="ml-5 space-y-1">
                    {kids.map((k) => (
                      <li key={k.slug}>
                        <label className="flex items-center gap-2 cursor-pointer text-[12px] text-neutral-600">
                          <input
                            type="radio"
                            name="cat"
                            checked={values.subcategory === k.slug}
                            onChange={() => set({ category: p.slug, subcategory: k.slug })}
                          />
                          <span className="flex-1">{k.name}</span>
                          <span className="text-[10px] text-neutral-400">{k.count}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </Section>
      )}

      {/* Brand */}
      {!hide("brand") && (
      <Section title="BRAND">
        <ul className="space-y-2 text-[13px]">
          {facets.brands.map((b) => (
            <li key={b.value}>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={values.brand.includes(b.value)} onChange={() => toggleArr("brand", b.value)} />
                <span className="flex-1">{b.name}</span>
                <span className="text-[11px] text-neutral-400">{b.count}</span>
              </label>
            </li>
          ))}
        </ul>
      </Section>
      )}

      {/* Gender */}
      {facets.genders.length > 0 && !hide("gender") && (
        <Section title="GENDER">
          <ul className="space-y-2 text-[13px]">
            {facets.genders.map((g) => (
              <li key={g.value}>
                <label className="flex items-center gap-2 cursor-pointer capitalize">
                  <input type="radio" name="gender" checked={values.gender === g.value} onChange={() => set({ gender: values.gender === g.value ? null : g.value })} />
                  <span className="flex-1">{g.value}</span>
                  <span className="text-[11px] text-neutral-400">{g.count}</span>
                </label>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Collection */}
      {facets.collections.length > 0 && !hide("collection") && (
        <Section title="COLLECTION">
          <ul className="space-y-2 text-[13px]">
            {facets.collections.map((c) => (
              <li key={c.value}>
                <label className="flex items-center gap-2 cursor-pointer capitalize">
                  <input type="radio" name="collection" checked={values.collection === c.value} onChange={() => set({ collection: values.collection === c.value ? null : c.value })} />
                  <span className="flex-1">{c.value}</span>
                  <span className="text-[11px] text-neutral-400">{c.count}</span>
                </label>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Price */}
      <Section title="PRICE">
        <label className="flex items-center gap-2 text-[13px] cursor-pointer">
          <input type="checkbox" checked={values.sale} onChange={() => set({ sale: !values.sale })} />
          <span className="flex-1">On Sale</span>
        </label>
        <div className="mt-3 space-y-2">
          {[
            { label: `Under ${fmt(price.p25)}`, min: null as number | null, max: price.p25 },
            { label: `${fmt(price.p25)} – ${fmt(price.p75)}`, min: price.p25, max: price.p75 },
            { label: `Over ${fmt(price.p75)}`, min: price.p75, max: null as number | null },
            { label: "Any price", min: null as number | null, max: null as number | null },
          ].map((preset) => {
            const active =
              (values.minPrice === preset.min && values.maxPrice === preset.max) ||
              // A range equal to the current catalog boundaries reads as "Any price"
              // even though the URL may carry explicit min/max from a prior context.
              (preset.min === null && preset.max === null && values.minPrice == null && values.maxPrice == null);
            return (
              <label key={preset.label} className="flex items-center gap-2 text-[13px] cursor-pointer">
                <input type="radio" name="price" checked={active} onChange={() => set({ minPrice: preset.min, maxPrice: preset.max })} />
                <span className="flex-1">{preset.label}</span>
              </label>
            );
          })}
          {values.minPrice != null && values.maxPrice != null && (
            <p className="pt-1 text-[11px] text-neutral-500">Custom range: {fmt(values.minPrice)} – {fmt(values.maxPrice)}</p>
          )}
        </div>
      </Section>

      {/* Size */}
      <Section title="SIZE">
        <div className="flex flex-wrap gap-2">
          {orderedSizes.map((s) => {
            const f = facets.sizes.find((x) => x.value === s);
            const selected = values.size.includes(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleArr("size", s)}
                className={`border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                  selected ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 hover:border-neutral-900"
                }`}
              >
                {s}
              </button>
            );
          })}
        </div>
        {numericSizes && (
          <p className="mt-2 text-[10px] text-neutral-400">Shoe sizes are numeric (e.g. 7–11)</p>
        )}
      </Section>

      {/* Color */}
      <Section title="COLOR">
        <div className="mt-1 grid grid-cols-3 gap-3">
          {facets.colors.map((c) => {
            const selected = values.color.includes(c.value);
            const hex = colorHex(c.value);
            return (
              <button
                key={c.value}
                type="button"
                onClick={() => toggleArr("color", c.value)}
                className="flex flex-col items-center gap-1.5"
              >
                <span
                  className={`h-7 w-7 rounded-full border ${selected ? "border-neutral-900 ring-1 ring-neutral-900 ring-offset-1" : "border-neutral-300"}`}
                  style={{ background: hex === "transparent" ? "#e5e5e5" : hex }}
                />
                <span className="text-[10px] leading-none text-neutral-600">{c.value}</span>
              </button>
            );
          })}
        </div>
      </Section>

      {/* Category-specific attributes (e.g. Fit, Rise, Neckline) — one Section per group, entirely data-driven */}
      {attributeGroups.map((group) => (
        <Section key={group.id} title={group.name.toUpperCase()}>
          <ul className="space-y-2 text-[13px]">
            {(group.options ?? []).map((opt) => {
              const checked = values.attr.includes(opt.id);
              return (
                <li key={opt.id}>
                  <label className="flex cursor-pointer items-center gap-2.5">
                    <input
                      type={group.selectionType === "single_select" ? "radio" : "checkbox"}
                      name={group.selectionType === "single_select" ? `attr-${group.id}` : undefined}
                      checked={checked}
                      onChange={() => toggleAttributeOption(group, opt.id)}
                      className="h-4 w-4 accent-neutral-900"
                    />
                    <span className="text-neutral-700">{opt.name}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </Section>
      ))}

      {/* Availability */}
      <Section title="AVAILABILITY">
        <ul className="space-y-2 text-[13px]">
          <li>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="avail" checked={values.availability === "in_stock"} onChange={() => set({ availability: "in_stock" })} />
              <span className="flex-1">In Stock</span>
              <span className="text-[11px] text-neutral-400">{facets.availability.inStock}</span>
            </label>
          </li>
          <li>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="avail" checked={values.availability === "out_of_stock"} onChange={() => set({ availability: "out_of_stock" })} />
              <span className="flex-1">Out of Stock</span>
              <span className="text-[11px] text-neutral-400">{facets.availability.outOfStock}</span>
            </label>
          </li>
        </ul>
      </Section>

      <div className="mt-4 flex items-center gap-2 text-[11px] text-neutral-500">
        <SlidersHorizontal size={13} /> Counts reflect your current filters
      </div>
    </div>
  );
}
