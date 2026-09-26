import { Search, Users, Heart, ShoppingBag, X, Menu, LogOut, ChevronDown } from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import { usePlatformSettings } from "../../lib/PlatformSettingsContext";
import { BrandLogo } from "../BrandLogo";
import { NotificationBell } from "../NotificationBell";
import * as api from "../../lib/api";
import { loginUrl } from "../../lib/returnTo";
import {
  getCategoryUrl,
  getNewInUrl,
  getGenderCategoryUrl,
  getMenUrl,
  getSaleUrl,
  getSearchUrl,
  getShopAllUrl,
  getWomenUrl,
} from "../../lib/links";

/** Gender audiences that open a dropdown in the header nav. */
type MenuKind = "women" | "men";

const MENU_LABEL: Record<MenuKind, string> = { women: "WOMEN", men: "MEN" };

/**
 * Canonical storefront header used on every customer-facing page
 * (home, shop, product, cart, brands, etc.).
 *
 * WOMEN / MEN open a dynamic category mega-menu (desktop) / accordion
 * (mobile). Both render ONLY real taxonomy from the category API — never a
 * hardcoded list — grouped by parent category so it stays readable as the
 * Superadmin adds or removes categories. No product/attribute filter UI
 * content lives in the header; that belongs on the shop listing page.
 */
export function StoreHeader() {
  const nav = useNavigate();
  const location = useLocation();
  const { status, logout } = useAuth();
  const { platformName } = usePlatformSettings();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [announcements, setAnnouncements] = useState<api.Announcement[]>([]);

  useEffect(() => {
    let alive = true;
    // Re-fetch whenever the tab regains focus too — an admin may have edited
    // the announcements (Super Admin → Header Announcements) in another tab,
    // and the announcement bar should reflect that without a manual reload.
    const load = () => {
      api.listAnnouncements()
        .then((r) => { if (alive) setAnnouncements(r.announcements); })
        .catch(() => { /* the announcement bar is decorative — never blocks the rest of the header */ });
    };
    load();
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { alive = false; document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  const closeAll = () => {
    setMenuOpen(false);
    setSearchOpen(false);
  };

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    setSearchOpen(false);
    nav(getSearchUrl(q));
  };

  // ---- Gender dropdowns (desktop mega-menu + mobile accordion) ----
  // Categories are fetched once per gender and cached for the session, so
  // hovering WOMEN→MEN→WOMEN never re-requests the same payload.
  const [megaKind, setMegaKind] = useState<MenuKind | null>(null);
  const [megaData, setMegaData] = useState<Partial<Record<MenuKind, api.GenderCategory[]>>>({});
  const [megaOpen, setMegaOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mobileKind, setMobileKind] = useState<MenuKind | null>(null);

  const closeMega = () => {
    setMegaOpen(false);
    setMegaKind(null);
  };

  const openMega = (kind: MenuKind) => {
    setMegaKind(kind);
    setMegaOpen(true);
    setLoadError(null);
    if (!megaData[kind]) {
      api
        .listCategoriesByGender(kind)
        .then((r) => setMegaData((prev) => ({ ...prev, [kind]: r.categories })))
        .catch(() => setLoadError("Could not load categories right now."));
    }
  };

  // Close on Escape or any click outside the header (the desktop dropdown
  // and the handlers on the header itself manage hover-based close).
  useEffect(() => {
    if (!megaOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMega();
    };
    const onPointer = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && !t.closest(".storeHeader")) closeMega();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [megaOpen]);

  const toggleMobileGender = (kind: MenuKind) => {
    if (mobileKind === kind) {
      setMobileKind(null);
    } else {
      setMobileKind(kind);
      if (!megaData[kind]) {
        setLoadError(null);
        api
          .listCategoriesByGender(kind)
          .then((r) => setMegaData((prev) => ({ ...prev, [kind]: r.categories })))
          .catch(() => setLoadError("Could not load categories right now."));
      }
    }
  };

  /**
   * Group the real category rows into root parents + their children so the
   * dropdown stays navigable no matter what the Superadmin does with the
   * taxonomy. A category whose parent is missing from the gender-scoped
   * list is promoted to its own group rather than silently dropped.
   */
  const groupsFor = (kind: MenuKind) => {
    const cats = megaData[kind] ?? [];
    const ids = new Set(cats.map((c) => c.id));
    const byId = new Map(cats.map((c) => [c.id, c]));
    const childrenOf = new Map<string, api.GenderCategory[]>();
    const roots: api.GenderCategory[] = [];
    for (const c of cats) {
      if (c.parentId && byId.has(c.parentId)) {
        const list = childrenOf.get(c.parentId) ?? [];
        list.push(c);
        childrenOf.set(c.parentId, list);
      } else {
        roots.push(c);
      }
    }
    const sortCats = (a: api.GenderCategory, b: api.GenderCategory) =>
      (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.name.localeCompare(b.name);
    roots.sort(sortCats);
    for (const [pid, list] of childrenOf) childrenOf.set(pid, [...list].sort(sortCats));
    return { roots, childrenOf, ids };
  };

  const mega = useMemo(() => (megaKind ? groupsFor(megaKind) : null), [megaKind, megaData]);

  const genderUrl = (kind: MenuKind) => (kind === "women" ? getWomenUrl() : getMenUrl());
  const genderApiUrl = (kind: MenuKind, slug: string) => getGenderCategoryUrl(kind, slug);

  const quickNav: [string, string][] = [
    ["NEW IN", getNewInUrl()],
    ["COLLECTIONS", getShopAllUrl()],
    ["SALE", getSaleUrl()],
    ["BRANDS", "/brands"],
    ["CLOTHING", getCategoryUrl("clothing")],
    ["SHOES", getCategoryUrl("shoes")],
    ["ACCESSORIES", getCategoryUrl("accessories")],
  ];

  return (
    <>
      {announcements.length > 0 && (
        <div className="announcement">
          {announcements.map((a, i) => (
            <span key={a.id}>
              {i > 0 && <span aria-hidden="true"> • </span>}
              {a.message}
            </span>
          ))}
        </div>
      )}
      <header
        className="storeHeader"
        onMouseLeave={(e) => {
          // Stay open while moving between the nav item and the panel
          // (both live inside the header); only close on a true exit.
          if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
          closeMega();
        }}
      >
        <button type="button" className="menuToggle" aria-label="Open menu" onClick={() => setMenuOpen(true)}>
          <Menu size={20} />
        </button>
        <Link to="/" className="logo" aria-label={`${platformName} home`}><BrandLogo variant="header" /></Link>
        <nav>
          {(["women", "men"] as MenuKind[]).map((kind) => (
            <div key={kind} className="navItem" onMouseEnter={() => openMega(kind)}>
              <Link to={genderUrl(kind)}>{MENU_LABEL[kind]} <ChevronDown size={10} /></Link>
            </div>
          ))}
          <Link to={getNewInUrl()}>NEW IN</Link>
          <Link to={getShopAllUrl()}>COLLECTIONS</Link>
          <Link to={getSaleUrl()}>SALE</Link>
          <Link to="/brands">BRANDS</Link>
        </nav>
        <div className="headerIcons">
          <button type="button" className="iconBtn" aria-label="Search" onClick={() => setSearchOpen(true)}>
            <Search size={19} />
          </button>
          <Link to={status === 'authenticated' ? '/profile' : loginUrl(location.pathname + location.search)} aria-label={status === 'authenticated' ? 'Account' : 'Sign in'} className="desktopOnlyIcon"><Users size={19} /></Link>
          {status === 'authenticated' && (
            <button type="button" className="iconBtn desktopOnlyIcon" aria-label="Sign out" onClick={() => { logout(); nav('/'); }}>
              <LogOut size={19} />
            </button>
          )}
          {status === 'authenticated' && <NotificationBell />}
          <Link to="/wishlist" aria-label="Wishlist" className="desktopOnlyIcon"><Heart size={19} /></Link>
          <Link to="/cart" aria-label="Cart" className="desktopOnlyIcon"><ShoppingBag size={19} /></Link>
        </div>

        {/* Desktop category mega-menu (hover on WOMEN / MEN) */}
        {megaOpen && megaKind && mega && (
          <div className="megaBackdrop">
            <div className="megaPanel">
              <div className="megaPanelHead">
                <span className="megaKicker">{MENU_LABEL[megaKind]}</span>
                <Link to={genderUrl(megaKind)} className="megaShopAll">
                  Shop all {MENU_LABEL[megaKind].toLowerCase()} →
                </Link>
              </div>
              {loadError ? (
                <p className="megaEmpty">{loadError}</p>
              ) : mega.roots.length === 0 ? (
                <p className="megaEmpty">Loading categories…</p>
              ) : (
                <div className="megaCols">
                  {mega.roots.map((root) => (
                    <div className="megaCol" key={root.id}>
                      <Link to={genderApiUrl(megaKind, root.slug)} className="megaColTitle">
                        {root.name}
                        <span className="megaColCount">{root.count}</span>
                      </Link>
                      {(mega.childrenOf.get(root.id) ?? []).length > 0 && (
                        <div className="megaColLinks">
                          {(mega.childrenOf.get(root.id) ?? []).map((child) => (
                            <Link key={child.id} to={genderApiUrl(megaKind, child.slug)} className="megaColLink">
                              <span>{child.name}</span>
                              <span className="megaColNb">{child.count}</span>
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Mobile navigation */}
      {menuOpen && (
        <div className="navOverlay" onClick={() => setMenuOpen(false)}>
          <aside className="navDrawer" onClick={(e) => e.stopPropagation()}>
            <div className="navOverlayHead">
              <b><BrandLogo maxHeight={20} /></b>
              <button type="button" className="iconBtn" aria-label="Close menu" onClick={() => setMenuOpen(false)}>
                <X size={20} />
              </button>
            </div>

            {/* WOMEN / MEN expandable category accordions */}
            {(["women", "men"] as MenuKind[]).map((kind) => (
              <div key={kind} className="mobGroup">
                <button
                  type="button"
                  className={`mobGroupHead ${mobileKind === kind ? "open" : ""}`}
                  onClick={() => toggleMobileGender(kind)}
                >
                  <span>{MENU_LABEL[kind]}</span>
                  <ChevronDown size={14} />
                </button>
                {mobileKind === kind && (
                  <div className="mobGroupBody">
                    {loadError ? (
                      <p className="megaEmpty">{loadError}</p>
                    ) : megaData[kind] && groupsFor(kind).roots.length === 0 ? (
                      <p className="megaEmpty">Loading categories…</p>
                    ) : groupsFor(kind).roots.map((root) => (
                      <div key={root.id} className="mobCol">
                        <Link
                          to={genderApiUrl(kind, root.slug)}
                          className="mobColTitle"
                          onClick={() => setMenuOpen(false)}
                        >
                          {root.name} <span>{root.count}</span>
                        </Link>
                        {(groupsFor(kind).childrenOf.get(root.id) ?? []).map((child) => (
                          <Link
                            key={child.id}
                            to={genderApiUrl(kind, child.slug)}
                            className="mobColLink"
                            onClick={() => setMenuOpen(false)}
                          >
                            {child.name} <span>{child.count}</span>
                          </Link>
                        ))}
                      </div>
                    ))}
                    <Link to={genderUrl(kind)} className="mobShopAll" onClick={() => setMenuOpen(false)}>
                      Shop all {MENU_LABEL[kind].toLowerCase()} →
                    </Link>
                  </div>
                )}
              </div>
            ))}

            {quickNav.map(([x, to]) => (
              <Link key={x} to={to} className="navOverlayLink" onClick={() => setMenuOpen(false)}>
                {x}
              </Link>
            ))}
          </aside>
        </div>
      )}

      {/* Search overlay */}
      {searchOpen && (
        <div className="navOverlay" onClick={() => setSearchOpen(false)}>
          <div className="searchModal" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={submitSearch}>
              <Search size={18} />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search products, brands and styles"
                aria-label="Search products"
              />
              <button type="submit" className="searchGo">SEARCH</button>
              <button type="button" className="iconBtn" aria-label="Close search" onClick={() => setSearchOpen(false)}>
                <X size={18} />
              </button>
            </form>
            {!query && (
              <div className="searchHints">
                <span>Popular</span>
                {[["New In", getNewInUrl()], ["Sale", getSaleUrl()], ["Women", getWomenUrl()], ["Men", getMenUrl()]].map(([x, to]) => (
                  <button key={x} type="button" onClick={() => { nav(to); closeAll(); }}>{x}</button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}