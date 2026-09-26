import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, Save } from "lucide-react";
import * as api from "../../lib/api";
import { resolveImage } from "../../lib/imagePlaceholder";
import { sortSizeStrings } from "../../lib/shop";

const PAGE_SIZE = 12;

const FILTERS: { value: api.AdminProductFilter | ""; label: string }[] = [
  { value: "", label: "All products" },
  { value: "low_stock", label: "Low stock" },
  { value: "sold_out", label: "Sold out" },
  { value: "active", label: "Live" },
  { value: "draft", label: "Drafts" },
];

function describe(e: unknown, fallback: string): string {
  if (!(e instanceof api.ApiError)) return fallback;
  const details = Object.values(e.fields ?? {});
  return details.length ? `${e.message} ${details.join(" ")}` : e.message;
}

/**
 * One product's stock as a color × size grid. Each cell is one variant's
 * absolute stock; Save sends only the cells that changed, through the
 * dedicated stock endpoint (no need to resubmit the product). The storefront
 * derives availability / SOLD OUT from these numbers on its next read.
 */
function StockGrid({ product, onSaved, flash }: { product: api.Product; onSaved: () => void; flash: (m: string) => void }) {
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(product.variants.map((v) => [v.id, String(v.stockQty ?? 0)]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(Object.fromEntries(product.variants.map((v) => [v.id, String(v.stockQty ?? 0)])));
  }, [product]);

  const colors = useMemo(() => Array.from(new Map(product.variants.map((v) => [v.color.toLowerCase(), v.color])).values()), [product.variants]);
  const sizes = useMemo(() => sortSizeStrings(Array.from(new Map(product.variants.map((v) => [v.size.toLowerCase(), v.size])).values())), [product.variants]);
  const cellFor = (color: string, size: string) =>
    product.variants.find((v) => v.color.toLowerCase() === color.toLowerCase() && v.size.toLowerCase() === size.toLowerCase());

  const changes = product.variants
    .filter((v) => draft[v.id] !== undefined && draft[v.id] !== String(v.stockQty ?? 0))
    .map((v) => ({ variantId: v.id, raw: draft[v.id] }));
  const invalid = changes.some((c) => !/^\d+$/.test(c.raw.trim()) || Number(c.raw) > 100000);

  const save = async () => {
    if (changes.length === 0 || invalid) return;
    setSaving(true);
    setError(null);
    try {
      await api.setProductStock(product.id, changes.map((c) => ({ variantId: c.variantId, stockQty: Number(c.raw.trim()) })));
      flash(`Stock updated for "${product.name}".`);
      onSaved();
    } catch (e) {
      setError(describe(e, "Could not save stock"));
    } finally {
      setSaving(false);
    }
  };

  if (product.variants.length === 0) {
    return <p style={{ fontSize: 11, color: "#888", margin: "8px 0 0" }}>No color/size variants yet — add them in Products → Edit.</p>;
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "6px 10px 6px 0", fontSize: 10, color: "#888", fontWeight: 600 }}>Color / Size</th>
              {sizes.map((sz) => <th key={sz} style={{ padding: "6px 4px", fontSize: 11, minWidth: 64 }}>{sz}</th>)}
              <th style={{ padding: "6px 8px", fontSize: 10, color: "#888", fontWeight: 600 }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {colors.map((c) => {
              const rowTotal = sizes.reduce((sum, sz) => {
                const v = cellFor(c, sz);
                return sum + (v ? Number(draft[v.id]) || 0 : 0);
              }, 0);
              return (
                <tr key={c}>
                  <td style={{ padding: "4px 10px 4px 0", fontWeight: 600, whiteSpace: "nowrap" }}>{c}</td>
                  {sizes.map((sz) => {
                    const v = cellFor(c, sz);
                    if (!v) return <td key={sz} style={{ textAlign: "center", color: "#ccc" }}>—</td>;
                    const value = draft[v.id] ?? "";
                    const n = Number(value);
                    const changed = value !== String(v.stockQty ?? 0);
                    const bad = !/^\d+$/.test(value.trim());
                    return (
                      <td key={sz} style={{ padding: 3 }}>
                        <input
                          aria-label={`${c} ${sz} stock`}
                          data-role="stock-input"
                          data-variant={`${c}/${sz}`}
                          inputMode="numeric"
                          value={value}
                          onChange={(e) => setDraft((d) => ({ ...d, [v.id]: e.target.value }))}
                          style={{
                            width: 60,
                            padding: "7px 6px",
                            textAlign: "center",
                            fontSize: 12,
                            border: `1px solid ${bad ? "#c00" : changed ? "#111" : "#ddd"}`,
                            background: !bad && n === 0 ? "#f6f6f6" : !bad && n <= 5 ? "#fff8ec" : "#fff",
                            fontWeight: changed ? 700 : 400,
                          }}
                        />
                      </td>
                    );
                  })}
                  <td style={{ padding: "4px 8px", color: "#666", textAlign: "center" }}>{rowTotal}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          data-role="save-stock"
          className="blackButton"
          style={{ padding: "9px 14px" }}
          disabled={saving || changes.length === 0 || invalid}
          onClick={() => void save()}
        >
          <Save size={14} /> {saving ? "Saving…" : changes.length ? `Save ${changes.length} change${changes.length === 1 ? "" : "s"}` : "No changes"}
        </button>
        {invalid ? <span style={{ fontSize: 11, color: "#c00" }}>Stock must be a whole number from 0 to 100000.</span> : null}
        {error ? <span style={{ fontSize: 11, color: "#c00" }}>{error}</span> : null}
      </div>
    </div>
  );
}

/** Admin inventory: every product's variant stock, editable in place. */
export function InventoryManagement() {
  const [items, setItems] = useState<api.Product[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [filter, setFilter] = useState<api.AdminProductFilter | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState("");
  const reqSeq = useRef(0);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);
  useEffect(() => { setPage(1); }, [debouncedQ, filter]);

  const load = useCallback(async () => {
    const seq = ++reqSeq.current;
    setLoading(true);
    setError(null);
    try {
      const r = await api.listAdminProducts({ page, pageSize: PAGE_SIZE, q: debouncedQ || undefined, status: filter || undefined, sort: filter ? "stock_asc" : "newest" });
      if (seq !== reqSeq.current) return;
      setItems(r.items);
      setTotal(r.pagination.total);
    } catch (e) {
      if (seq !== reqSeq.current) return;
      setError(describe(e, "Could not load inventory"));
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, [page, debouncedQ, filter]);

  useEffect(() => { void load(); }, [load]);

  const flash = (m: string) => {
    setBanner(m);
    window.setTimeout(() => setBanner(""), 3500);
  };
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pill = (active: boolean) => ({ border: `1px solid ${active ? "#111" : "#ddd"}`, background: active ? "#111" : "#fff", color: active ? "#fff" : "#333", padding: "6px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer", borderRadius: 999 });

  return (
    <div className="management" data-role="inventory-management">
      {banner ? <div role="status" style={{ background: "#111", color: "#fff", padding: "10px 14px", fontSize: 12, marginBottom: 12 }}>{banner}</div> : null}
      <div className="managementToolbar" style={{ flexWrap: "wrap" }}>
        <div className="searchBox" style={{ minWidth: 220 }}>
          <Search size={16} />
          <input aria-label="Search inventory" placeholder="Search product name, slug or SKU…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {FILTERS.map((f) => (
          <button key={f.value || "all"} type="button" aria-pressed={filter === f.value} style={pill(filter === f.value)} onClick={() => setFilter(f.value)}>{f.label}</button>
        ))}
      </div>
      {error ? (
        <p style={{ color: "#c00", fontSize: 12 }}>{error} <button type="button" onClick={() => void load()}>Retry</button></p>
      ) : loading && items.length === 0 ? (
        <p style={{ color: "#888", fontSize: 12 }}>Loading inventory…</p>
      ) : items.length === 0 ? (
        <p style={{ color: "#888", fontSize: 12 }}>No products match.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {items.map((p) => (
            <div key={p.id} className="tableCard" style={{ padding: 14 }} data-role="inventory-product" data-slug={p.slug}>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <img src={resolveImage(p.images[0]?.url)} alt="" style={{ width: 38, height: 48, objectFit: "cover", background: "#eee" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{p.name}</div>
                  <div style={{ fontSize: 10, color: "#888" }}>
                    {p.status === "active" ? "Live" : "Draft"} · {p.totalStock ?? 0} units · {p.variants.length} variants
                    {api.isSoldOut(p) ? " · SOLD OUT" : ""}
                  </div>
                </div>
              </div>
              <StockGrid product={p} onSaved={() => void load()} flash={flash} />
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, fontSize: 11, color: "#666" }}>
        <span>{total} product{total === 1 ? "" : "s"}</span>
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((x) => Math.max(1, x - 1))} style={{ border: "1px solid #ddd", background: "#fff", padding: "6px 10px" }}>Previous</button>
          Page {page} of {pages}
          <button type="button" disabled={page >= pages || loading} onClick={() => setPage((x) => Math.min(pages, x + 1))} style={{ border: "1px solid #ddd", background: "#fff", padding: "6px 10px" }}>Next</button>
        </span>
      </div>
    </div>
  );
}
