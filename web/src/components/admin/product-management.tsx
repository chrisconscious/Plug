import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Search, Pencil, Archive, RotateCcw, Eye, EyeOff } from "lucide-react";
import * as api from "../../lib/api";
import { formatTZS } from "../../lib/currency";
import { resolveImage } from "../../lib/imagePlaceholder";

const PAGE_SIZE = 24;

const FILTERS: { value: api.AdminProductFilter | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "active", label: "Live" },
  { value: "draft", label: "Drafts" },
  { value: "sold_out", label: "Sold out" },
  { value: "low_stock", label: "Low stock" },
  { value: "archived", label: "Archived" },
];

const SORTS: { value: api.AdminProductSort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "updated", label: "Recently updated" },
  { value: "oldest", label: "Oldest" },
  { value: "name", label: "Name A–Z" },
  { value: "price_asc", label: "Price: low → high" },
  { value: "price_desc", label: "Price: high → low" },
  { value: "stock_asc", label: "Stock: low → high" },
];

function describe(e: unknown, fallback: string): string {
  if (!(e instanceof api.ApiError)) return fallback;
  const details = Object.values(e.fields ?? {});
  return details.length ? `${e.message} ${details.join(" ")}` : e.message;
}

function StatusPill({ p }: { p: api.Product }) {
  const soldOut = api.isSoldOut(p);
  const low = !soldOut && p.variants.some((v) => v.lowStock);
  const base = { fontSize: 9, fontWeight: 700, letterSpacing: ".08em", padding: "3px 7px", borderRadius: 3, whiteSpace: "nowrap" as const };
  const status = p.status ?? (p.active ? "active" : "draft");
  return (
    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
      {status === "archived" ? (
        <span style={{ ...base, background: "#eee", color: "#666" }}>ARCHIVED</span>
      ) : status === "active" ? (
        <span style={{ ...base, background: "#e8f3ec", color: "#2f7a4a" }}>LIVE</span>
      ) : (
        <span style={{ ...base, background: "#fbf1de", color: "#9a6512" }}>DRAFT</span>
      )}
      {status !== "archived" && soldOut ? <span style={{ ...base, background: "#404040", color: "#fff" }}>SOLD OUT</span> : null}
      {status !== "archived" && low ? <span style={{ ...base, background: "#fff4e5", color: "#b45309" }}>LOW STOCK</span> : null}
    </span>
  );
}

/**
 * Admin product list — every query (search, status, sort, paging) runs on the
 * server, so it works the same for 10 products or millions. The list is the
 * database's current state; nothing is cached client-side beyond this page.
 */
export function ProductManagementTable({
  reloadKey,
  canAdd,
  onAdd,
  onEdit,
  setBanner,
}: {
  reloadKey: number;
  canAdd: boolean;
  onAdd: () => void;
  onEdit: (p: api.Product) => void;
  setBanner: (msg: string) => void;
}) {
  const [items, setItems] = useState<api.Product[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [filter, setFilter] = useState<api.AdminProductFilter | "">("");
  const [sort, setSort] = useState<api.AdminProductSort>("newest");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Archive/restore need products.delete (Super Admin, or an admin granted
  // it). Hidden otherwise — the server enforces it either way.
  const [canArchive, setCanArchive] = useState(false);
  const reqSeq = useRef(0);

  useEffect(() => {
    let alive = true;
    api.getMyPermissions().then((perms) => { if (alive) setCanArchive(perms.includes("products.delete")); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);
  useEffect(() => { setPage(1); }, [debouncedQ, filter, sort]);

  const load = useCallback(async () => {
    const seq = ++reqSeq.current;
    setLoading(true);
    setError(null);
    try {
      const r = await api.listAdminProducts({ page, pageSize: PAGE_SIZE, q: debouncedQ || undefined, status: filter || undefined, sort });
      if (seq !== reqSeq.current) return; // a newer request superseded this one
      setItems(r.items);
      setTotal(r.pagination.total);
    } catch (e) {
      if (seq !== reqSeq.current) return;
      setError(describe(e, "Could not load products"));
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, [page, debouncedQ, filter, sort]);

  useEffect(() => { void load(); }, [load, reloadKey]);

  const flash = (msg: string) => {
    setBanner(msg);
    window.setTimeout(() => setBanner(""), 4500);
  };

  const run = async (p: api.Product, action: () => Promise<unknown>, ok: string) => {
    setBusyId(p.id);
    try {
      await action();
      flash(ok);
      await load();
    } catch (e) {
      flash(describe(e, "That didn't work — please try again."));
    } finally {
      setBusyId(null);
    }
  };

  const archive = (p: api.Product) => {
    const confirmed = window.confirm(
      `Archive "${p.name}"?\n\nIt will disappear from the storefront, Latest Drop, search and all listings, and can no longer be bought. Past orders keep their details. You can restore it later from the Archived tab.`
    );
    if (!confirmed) return;
    void run(p, () => api.deleteAdminProduct(p.id), `"${p.name}" archived.`);
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const cell = { padding: "10px 12px", fontSize: 12, borderTop: "1px solid #eee", verticalAlign: "middle" as const };
  const iconBtn = { border: "1px solid #ddd", background: "#fff", padding: "6px 8px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11 } as const;

  return (
    <div data-role="product-management">
      <div className="managementToolbar" style={{ flexWrap: "wrap" }}>
        <div className="searchBox" style={{ minWidth: 220 }}>
          <Search size={16} />
          <input aria-label="Search products" placeholder="Search name, slug or SKU…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select aria-label="Sort products" value={sort} onChange={(e) => setSort(e.target.value as api.AdminProductSort)} style={{ border: "1px solid #ddd", background: "#fff", padding: "10px 12px", fontSize: 11 }}>
          {SORTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {canAdd ? (
          // The page header already has "Add New" on desktop; it is hidden
          // below 900px, so this toolbar button covers phones/tablets.
          <button type="button" className="blackButton pmAddMobile" onClick={onAdd}><Plus size={15} /> Add product</button>
        ) : null}
      </div>
      <div role="tablist" aria-label="Filter by status" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {FILTERS.map((f) => (
          <button
            key={f.value || "all"}
            role="tab"
            aria-selected={filter === f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            style={{ border: `1px solid ${filter === f.value ? "#111" : "#ddd"}`, background: filter === f.value ? "#111" : "#fff", color: filter === f.value ? "#fff" : "#333", padding: "6px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer", borderRadius: 999 }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="tableCard" style={{ padding: 20 }}>
          <p style={{ color: "#c00", fontSize: 12, margin: "0 0 10px" }}>{error}</p>
          <button type="button" style={iconBtn} onClick={() => void load()}>Retry</button>
        </div>
      ) : (
        <div className="tableCard" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead>
              <tr style={{ background: "#f5f5f4", fontSize: 10, color: "#777", textAlign: "left" }}>
                <th style={{ padding: "10px 12px" }}>Product</th>
                <th style={{ padding: "10px 12px" }}>Status</th>
                <th style={{ padding: "10px 12px" }}>Price</th>
                <th style={{ padding: "10px 12px" }}>Stock</th>
                <th style={{ padding: "10px 12px" }}>Updated</th>
                <th style={{ padding: "10px 12px", textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 ? (
                <tr><td colSpan={6} style={{ ...cell, color: "#888" }}>Loading products…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={6} style={{ ...cell, color: "#888" }}>{debouncedQ || filter ? "No products match." : "No products yet — add your first one."}</td></tr>
              ) : (
                items.map((p) => {
                  const archived = p.status === "archived" || !!p.archivedAt;
                  const colors = new Set(p.variants.map((v) => v.color.toLowerCase())).size;
                  return (
                    <tr key={p.id} data-role="product-row" data-slug={p.slug} style={{ opacity: busyId === p.id ? 0.5 : 1 }}>
                      <td style={cell}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <img src={resolveImage(p.images[0]?.url)} alt="" style={{ width: 40, height: 50, objectFit: "cover", background: "#eee", flexShrink: 0 }} />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 700 }}>{p.name}</div>
                            <div style={{ fontSize: 10, color: "#888" }}>
                              {[p.brand?.name, p.category?.name].filter(Boolean).join(" · ")}
                              {p.sku ? ` · SKU ${p.sku}` : ""}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td style={cell}><StatusPill p={p} /></td>
                      <td style={cell}>
                        {formatTZS(p.priceCents)}
                        {p.compareAtPriceCents != null && p.compareAtPriceCents > p.priceCents ? (
                          <div style={{ fontSize: 10, color: "#999", textDecoration: "line-through" }}>{formatTZS(p.compareAtPriceCents)}</div>
                        ) : null}
                      </td>
                      <td style={cell}>
                        <b>{p.totalStock ?? 0}</b> units
                        <div style={{ fontSize: 10, color: "#888" }}>{p.variants.length} variant{p.variants.length === 1 ? "" : "s"} · {colors} color{colors === 1 ? "" : "s"}</div>
                      </td>
                      <td style={{ ...cell, fontSize: 11, color: "#666" }}>{p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : "—"}</td>
                      <td style={{ ...cell, textAlign: "right", whiteSpace: "nowrap" }}>
                        <span style={{ display: "inline-flex", gap: 6 }}>
                          <button type="button" style={iconBtn} title="Edit" aria-label={`Edit ${p.name}`} disabled={busyId === p.id} onClick={() => onEdit(p)}><Pencil size={13} /> Edit</button>
                          {archived ? (
                            canArchive ? <button type="button" style={iconBtn} title="Restore as draft" aria-label={`Restore ${p.name}`} disabled={busyId === p.id} onClick={() => void run(p, () => api.restoreAdminProduct(p.id), `"${p.name}" restored as a draft.`)}><RotateCcw size={13} /> Restore</button> : null
                          ) : (
                            <>
                              {p.active ? (
                                <button type="button" style={iconBtn} title="Unpublish" aria-label={`Unpublish ${p.name}`} disabled={busyId === p.id} onClick={() => void run(p, () => api.updateAdminProduct(p.id, { active: false }), `"${p.name}" unpublished — now a draft.`)}><EyeOff size={13} /></button>
                              ) : (
                                <button type="button" style={iconBtn} title="Publish" aria-label={`Publish ${p.name}`} disabled={busyId === p.id} onClick={() => void run(p, () => api.updateAdminProduct(p.id, { active: true }), `"${p.name}" is live.`)}><Eye size={13} /></button>
                              )}
                              {canArchive ? <button type="button" style={{ ...iconBtn, color: "#b00" }} title="Archive (delete)" aria-label={`Archive ${p.name}`} disabled={busyId === p.id} onClick={() => archive(p)}><Archive size={13} /></button> : null}
                            </>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, fontSize: 11, color: "#666" }}>
        <span>{total} product{total === 1 ? "" : "s"}</span>
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <button type="button" style={iconBtn} disabled={page <= 1 || loading} onClick={() => setPage((x) => Math.max(1, x - 1))}>Previous</button>
          Page {page} of {pages}
          <button type="button" style={iconBtn} disabled={page >= pages || loading} onClick={() => setPage((x) => Math.min(pages, x + 1))}>Next</button>
        </span>
      </div>
    </div>
  );
}
