import { useEffect, useState, type CSSProperties } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight, ChevronDown, Heart, Search, ShoppingBag, UserRound } from "lucide-react";
import * as api from "../../lib/api";
import { useAuth } from "../../lib/AuthContext";
import { BrandLogo } from "../BrandLogo";
import { loginUrl } from "../../lib/returnTo";
import { getGenderCategoryUrl, getMenUrl, getNewInUrl, getSaleUrl, getShopAllUrl, getWomenUrl } from "../../lib/links";

type Gender = "women" | "men";
const GENDERS: { kind: Gender; label: string; url: () => string }[] = [
  { kind: "women", label: "Women", url: getWomenUrl },
  { kind: "men", label: "Men", url: getMenUrl },
];
const LINKS: { label: string; url: () => string }[] = [
  { label: "New in", url: getNewInUrl },
  { label: "Collections", url: getShopAllUrl },
  { label: "Sale", url: getSaleUrl },
  { label: "Brands", url: () => "/brands" },
];

/** How long the closing animation runs before the menu unmounts. */
const CLOSE_MS = 260;

/** Gender category lists, fetched once per visit and shared across openings. */
const genderCache: Partial<Record<Gender, api.GenderCategory[]>> = {};

function useGenderCategories(kind: Gender | null) {
  const [data, setData] = useState<api.GenderCategory[] | undefined>(kind ? genderCache[kind] : undefined);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!kind) return;
    if (genderCache[kind]) {
      setData(genderCache[kind]);
      return;
    }
    let alive = true;
    setData(undefined);
    setError(false);
    api.listCategoriesByGender(kind)
      .then((r) => {
        genderCache[kind] = r.categories;
        if (alive) setData(r.categories);
      })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [kind]);
  return { data, error };
}

/** Root categories (sorted) with their children, so the list stays readable as the admin's taxonomy grows. */
function group(cats: api.GenderCategory[]) {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const children = new Map<string, api.GenderCategory[]>();
  const roots: api.GenderCategory[] = [];
  for (const c of cats) {
    if (c.parentId && byId.has(c.parentId)) children.set(c.parentId, [...(children.get(c.parentId) ?? []), c]);
    else roots.push(c);
  }
  const order = (a: api.GenderCategory, b: api.GenderCategory) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.name.localeCompare(b.name);
  roots.sort(order);
  for (const [k, v] of children) children.set(k, [...v].sort(order));
  return { roots, children };
}

/**
 * The phone menu (header hamburger; the desktop bar replaces it from 901px).
 * A side panel, never full screen. Everything in it is live: Women / Men open
 * to the admin's categories; there are no hard-coded category links.
 *
 * Links inside REPLACE the history entry the menu opened (see StoreHeader),
 * so the phone's Back button goes to the page the customer was on before,
 * and Back while the menu is open simply closes it.
 */
export function MobileMenu({ open, onClose, onSearch }: { open: boolean; onClose: () => void; onSearch: () => void }) {
  const location = useLocation();
  const { status, user } = useAuth();
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const [expanded, setExpanded] = useState<Gender | null>(null);
  const { data, error } = useGenderCategories(expanded);

  // Keep the panel mounted while it animates out.
  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    const t = window.setTimeout(() => { setMounted(false); setClosing(false); setExpanded(null); }, CLOSE_MS);
    return () => window.clearTimeout(t);
  }, [open, mounted]);

  // While open: no page scrolling behind the panel; Escape closes it.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { root.style.overflow = prev; document.removeEventListener("keydown", onKey); };
  }, [open, onClose]);

  if (!mounted) return null;

  const here = (url: string) => {
    const u = new URL(url, window.location.origin);
    return u.pathname === location.pathname && (u.search === "" || u.search === location.search);
  };
  const firstName = user?.fullName?.trim().split(/\s+/)[0];
  const step = (i: number) => ({ "--i": i }) as CSSProperties;
  const grouped = data ? group(data) : null;

  return (
    <div className={`mm${closing ? " is-closing" : ""}`} role="presentation" onClick={onClose}>
      <aside className="mmPanel" role="dialog" aria-modal="true" aria-label="Menu" onClick={(e) => e.stopPropagation()}>
        <div className="mmTop">
          <Link to="/" replace className="mmLogo" aria-label="Home"><BrandLogo maxHeight={20} /></Link>
          <button type="button" className="mmClose" aria-label="Close menu" onClick={onClose}>
            <span /><span />
          </button>
        </div>

        <button type="button" className="mmSearch" style={step(0)} onClick={onSearch}>
          <Search size={16} aria-hidden="true" />
          <span>Search products, brands…</span>
        </button>

        <nav className="mmNav" aria-label="Shop">
          {GENDERS.map((g, i) => {
            const isOpen = expanded === g.kind;
            return (
              <div key={g.kind} className={`mmItem mmGroup${isOpen ? " is-open" : ""}`} style={step(i + 1)}>
                <button type="button" className="mmRow" aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : g.kind)}>
                  <span className={`mmLabel${here(g.url()) ? " is-here" : ""}`}>{g.label}</span>
                  <ChevronDown size={18} className="mmChevron" aria-hidden="true" />
                </button>
                <div className="mmSub" aria-hidden={!isOpen}>
                  <div className="mmSubInner">
                    {error ? (
                      <p className="mmNote">Couldn't load categories. Try again in a moment.</p>
                    ) : !grouped ? (
                      <p className="mmNote">Loading…</p>
                    ) : grouped.roots.length === 0 ? (
                      <p className="mmNote">New pieces are on the way.</p>
                    ) : (
                      grouped.roots.map((root) => (
                        <div key={root.id} className="mmCat">
                          <Link to={getGenderCategoryUrl(g.kind, root.slug)} replace tabIndex={isOpen ? 0 : -1} className="mmCatLink">
                            <span>{root.name}</span><small>{root.count}</small>
                          </Link>
                          {(grouped.children.get(root.id) ?? []).map((child) => (
                            <Link key={child.id} to={getGenderCategoryUrl(g.kind, child.slug)} replace tabIndex={isOpen ? 0 : -1} className="mmCatLink mmCatChild">
                              <span>{child.name}</span><small>{child.count}</small>
                            </Link>
                          ))}
                        </div>
                      ))
                    )}
                    <Link to={g.url()} replace tabIndex={isOpen ? 0 : -1} className="mmShopAll">
                      Shop all {g.label.toLowerCase()} <ArrowRight size={14} aria-hidden="true" />
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
          {LINKS.map((l, i) => (
            <Link key={l.label} to={l.url()} replace className="mmItem mmRow" style={step(i + 3)}>
              <span className={`mmLabel${here(l.url()) ? " is-here" : ""}`}>{l.label}</span>
              <ArrowRight size={18} className="mmArrow" aria-hidden="true" />
            </Link>
          ))}
        </nav>

        <div className="mmFoot" style={step(LINKS.length + 3)}>
          {status === "authenticated" ? (
            <Link to="/profile" replace className="mmAccount">
              <span className="mmAvatar" aria-hidden="true"><UserRound size={18} /></span>
              <span><b>{firstName ? `Hi, ${firstName}` : "My account"}</b><small>Orders, addresses &amp; settings</small></span>
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          ) : (
            <Link to={loginUrl(location.pathname + location.search)} replace className="mmSignIn">
              Sign in or create an account
            </Link>
          )}
          <div className="mmQuick">
            <Link to="/wishlist" replace><Heart size={18} aria-hidden="true" /> Wishlist</Link>
            <Link to="/cart" replace><ShoppingBag size={18} aria-hidden="true" /> Bag</Link>
          </div>
        </div>
      </aside>
    </div>
  );
}
