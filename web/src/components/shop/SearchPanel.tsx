import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Clock, Loader2, Search, X } from "lucide-react";
import * as api from "../../lib/api";
import { formatTZS } from "../../lib/currency";
import { getBrandUrl, getCategoryUrl, getSearchUrl } from "../../lib/links";
import { PLACEHOLDER_IMG, resolveImage } from "../../lib/imagePlaceholder";

/** Wait this long after the last keystroke before asking the server. */
export const SEARCH_DEBOUNCE_MS = 220;
const RECENT_KEY = "plug.recentSearches";
const MAX_RECENT = 6;

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}
function rememberSearch(q: string) {
  const v = q.trim().toLowerCase();
  if (!v) return;
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([v, ...readRecent().filter((x) => x !== v)].slice(0, MAX_RECENT)));
  } catch {
    /* private mode / storage blocked — recent searches are only a convenience */
  }
}

// The starting state rarely changes within a visit; keep it for 5 minutes.
let startCache: { at: number; data: api.SearchStart } | null = null;

type Option =
  | { kind: "query"; label: string; recent?: boolean }
  | { kind: "category"; link: api.SearchLink }
  | { kind: "brand"; link: api.SearchLink }
  | { kind: "product"; product: api.SearchProduct }
  | { kind: "all"; label: string };

type Status = "idle" | "loading" | "ready" | "error";

/**
 * The header search panel. Rendered inside the sticky header and positioned at
 * `top: 100%`, so it always opens directly beneath the header — wherever the
 * page is scrolled — instead of floating in the middle of the screen.
 *
 * Live results come from GET /api/v1/search (real catalog data). Typing is
 * debounced, and every request carries an AbortController plus a sequence
 * number, so a slow older response can never overwrite newer results.
 */
export function SearchPanel({ onClose, closing }: { onClose: (opts?: { restoreFocus?: boolean }) => void; closing: boolean }) {
  const nav = useNavigate();
  const ids = useId();
  const listId = `${ids}-list`;
  const inputRef = useRef<HTMLInputElement>(null);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [results, setResults] = useState<api.SearchResults | null>(null);
  const [start, setStart] = useState<api.SearchStart | null>(startCache?.data ?? null);
  const [startFailed, setStartFailed] = useState(false);
  const [recent, setRecent] = useState<string[]>(() => readRecent());
  const [active, setActive] = useState(-1);
  const [retryKey, setRetryKey] = useState(0);
  const seq = useRef(0);

  const trimmed = q.replace(/\s+/g, " ").trim();

  // Focus the input once the panel is on screen (not before — focusing during
  // the opening frame makes mobile browsers jump the page).
  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 30);
    return () => window.clearTimeout(t);
  }, []);

  // Starting state (empty input).
  useEffect(() => {
    if (startCache && Date.now() - startCache.at < 5 * 60_000) return;
    const ctrl = new AbortController();
    api.searchStart({ signal: ctrl.signal })
      .then((d) => { startCache = { at: Date.now(), data: d }; setStart(d); setStartFailed(false); })
      .catch(() => { if (!ctrl.signal.aborted) setStartFailed(true); });
    return () => ctrl.abort();
  }, [retryKey]);

  // Live results, debounced; stale responses are dropped.
  useEffect(() => {
    setActive(-1);
    if (!trimmed) {
      seq.current++;
      setStatus("idle");
      setResults(null);
      return;
    }
    const mySeq = ++seq.current;
    const ctrl = new AbortController();
    setStatus("loading");
    const timer = window.setTimeout(() => {
      api.liveSearch(trimmed, { limit: 8, signal: ctrl.signal })
        .then((r) => {
          if (mySeq !== seq.current) return;
          setResults(r);
          setStatus("ready");
        })
        .catch(() => {
          if (mySeq !== seq.current || ctrl.signal.aborted) return;
          setStatus("error");
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [trimmed, retryKey]);

  const go = useCallback(
    (to: string, remember?: string) => {
      if (remember) rememberSearch(remember);
      onClose({ restoreFocus: false });
      nav(to);
    },
    [nav, onClose]
  );

  const viewAll = useCallback(() => {
    if (!trimmed) return;
    go(getSearchUrl(results?.correctedQuery ?? trimmed), trimmed);
  }, [go, results, trimmed]);

  // Everything the arrow keys can move through, in on-screen order.
  const showResults = !!trimmed && status !== "idle";
  const options: Option[] = useMemo(() => {
    if (!showResults) {
      const out: Option[] = [];
      recent.forEach((r) => out.push({ kind: "query", label: r, recent: true }));
      (start?.popular ?? []).filter((p) => !recent.includes(p)).forEach((p) => out.push({ kind: "query", label: p }));
      (start?.categories ?? []).forEach((c) => out.push({ kind: "category", link: c }));
      (start?.brands ?? []).forEach((b) => out.push({ kind: "brand", link: b }));
      (start?.newArrivals ?? []).forEach((p) => out.push({ kind: "product", product: p }));
      return out;
    }
    if (!results) return [];
    const out: Option[] = [];
    results.suggestions.forEach((s) => out.push({ kind: "query", label: s }));
    results.categories.forEach((c) => out.push({ kind: "category", link: c }));
    results.brands.forEach((b) => out.push({ kind: "brand", link: b }));
    results.products.forEach((p) => out.push({ kind: "product", product: p }));
    if (results.exact && results.total > 0) out.push({ kind: "all", label: results.correctedQuery ?? trimmed });
    return out;
  }, [showResults, recent, start, results, trimmed]);

  const optionId = (i: number) => `${ids}-opt-${i}`;
  const indexOf = (match: (o: Option) => boolean) => options.findIndex(match);

  const activate = (o: Option) => {
    switch (o.kind) {
      case "query":
        setQ(o.label);
        inputRef.current?.focus();
        break;
      case "category":
        go(getCategoryUrl(o.link.slug), trimmed);
        break;
      case "brand":
        go(getBrandUrl(o.link.slug), trimmed);
        break;
      case "product":
        go(o.product.url, trimmed);
        break;
      case "all":
        viewAll();
        break;
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (options.length) setActive((i) => (i + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (options.length) setActive((i) => (i <= 0 ? options.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = options[active];
      if (active >= 0 && o) activate(o);
      else viewAll();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (q) setQ("");
      else onClose({ restoreFocus: true });
    }
  };

  // Keep the highlighted option scrolled into view.
  useEffect(() => {
    if (active < 0) return;
    document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const announce =
    !trimmed ? "" :
    status === "loading" ? "Searching…" :
    status === "error" ? "Search failed." :
    results && results.total > 0 ? `${results.total} product${results.total === 1 ? "" : "s"} found${results.correctedQuery ? ` for ${results.correctedQuery}` : ""}.` :
    results ? "No exact matches found." : "";

  const optProps = (i: number) => ({
    id: optionId(i),
    role: "option" as const,
    "aria-selected": active === i,
    className: active === i ? "is-active" : undefined,
    onMouseEnter: () => setActive(i),
  });

  // ---- Render helpers ----
  const queryRow = (label: string, recentRow?: boolean) => {
    const i = indexOf((o) => o.kind === "query" && o.label === label);
    return (
      <li key={`q-${label}`} {...optProps(i)}>
        <button type="button" tabIndex={-1} className="spQuery" onClick={() => activate({ kind: "query", label })}>
          {recentRow ? <Clock size={14} aria-hidden="true" /> : <Search size={14} aria-hidden="true" />}
          <span>{label}</span>
        </button>
      </li>
    );
  };
  const linkRow = (kind: "category" | "brand", link: api.SearchLink) => {
    const i = indexOf((o) => o.kind === kind && o.link.slug === link.slug);
    return (
      <li key={`${kind}-${link.slug}`} {...optProps(i)}>
        <button type="button" tabIndex={-1} className="spLink" onClick={() => activate({ kind, link } as Option)}>
          <span>{link.name}</span>
          {typeof link.count === "number" && <small>{link.count}</small>}
        </button>
      </li>
    );
  };
  const productCard = (p: api.SearchProduct) => {
    const i = indexOf((o) => o.kind === "product" && o.product.id === p.id);
    return (
      <li key={p.id} {...optProps(i)}>
        <a
          href={p.url}
          tabIndex={-1}
          className="spProduct"
          onClick={(e) => { e.preventDefault(); activate({ kind: "product", product: p }); }}
        >
          <span className="spProductImg">
            <img
              src={resolveImage(p.image?.url)}
              alt={p.image?.alt || p.name}
              loading="lazy"
              decoding="async"
              onError={(e) => { (e.currentTarget as HTMLImageElement).src = PLACEHOLDER_IMG; }}
            />
            {p.onSale && p.discountPercent ? <span className="spBadge spBadge--sale">-{p.discountPercent}%</span> : p.isNew ? <span className="spBadge">New</span> : null}
          </span>
          <span className="spProductInfo">
            {p.brand && <span className="spBrand">{p.brand.name}</span>}
            <span className="spName">{p.name}</span>
            <span className="spPrice">
              <b className={p.onSale ? "is-sale" : undefined}>{formatTZS(p.priceCents)}</b>
              {p.onSale && p.compareAtPriceCents ? <s>{formatTZS(p.compareAtPriceCents)}</s> : null}
            </span>
            {(p.colors.length > 0 || p.soldOut) && (
              <span className="spMeta">
                {p.soldOut ? "Sold out" : p.colors.length > 1 ? `${p.colors.length} colours` : p.colors[0]}
              </span>
            )}
          </span>
        </a>
      </li>
    );
  };

  const skeleton = (
    <ul className="spProducts" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <li key={i}><span className="spProduct spSkel"><span className="spProductImg" /><span className="spProductInfo"><i /><i /><i /></span></span></li>
      ))}
    </ul>
  );

  // ---- Body ----
  let aside: React.ReactNode = null;
  let main: React.ReactNode = null;

  if (!showResults) {
    const popular = (start?.popular ?? []).filter((p) => !recent.includes(p));
    aside = (
      <>
        {recent.length > 0 && (
          <section role="group" aria-label="Recent searches" className="spGroup">
            <div className="spGroupHead">
              <h3>Recent searches</h3>
              <button type="button" className="spTextBtn" onClick={() => { try { localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ } setRecent([]); }}>Clear</button>
            </div>
            <ul role="presentation">{recent.map((r) => queryRow(r, true))}</ul>
          </section>
        )}
        {popular.length > 0 && (
          <section role="group" aria-label="Popular searches" className="spGroup">
            <h3>Popular searches</h3>
            <ul role="presentation">{popular.map((p) => queryRow(p))}</ul>
          </section>
        )}
        {(start?.categories.length ?? 0) > 0 && (
          <section role="group" aria-label="Categories" className="spGroup">
            <h3>Categories</h3>
            <ul role="presentation">{start!.categories.map((c) => linkRow("category", c))}</ul>
          </section>
        )}
        {(start?.brands.length ?? 0) > 0 && (
          <section role="group" aria-label="Brands" className="spGroup spGroup--brands">
            <h3>Brands</h3>
            <ul role="presentation">{start!.brands.map((b) => linkRow("brand", b))}</ul>
          </section>
        )}
      </>
    );
    main = start?.newArrivals.length ? (
      <section role="group" aria-label="New arrivals" className="spGroup">
        <h3>New arrivals</h3>
        <ul className="spProducts" role="presentation">{start.newArrivals.map(productCard)}</ul>
      </section>
    ) : startFailed ? (
      <p className="spNote">Suggestions couldn't load — you can still type to search.</p>
    ) : !start ? skeleton : null;
  } else if (status === "error") {
    main = (
      <div className="spEmpty" role="alert">
        <b>Search isn't responding right now.</b>
        <span>Check your connection and try again — your search is kept.</span>
        <button type="button" className="spRetry" onClick={() => setRetryKey((k) => k + 1)}>Try again</button>
      </div>
    );
  } else if (status === "loading" && !results) {
    main = skeleton;
  } else if (results) {
    const none = !results.exact || results.total === 0;
    aside = (
      <>
        {results.suggestions.length > 0 && (
          <section role="group" aria-label="Suggested searches" className="spGroup">
            <h3>Suggestions</h3>
            <ul role="presentation">{results.suggestions.map((s) => queryRow(s))}</ul>
          </section>
        )}
        {results.categories.length > 0 && (
          <section role="group" aria-label="Categories" className="spGroup">
            <h3>Categories</h3>
            <ul role="presentation">{results.categories.map((c) => linkRow("category", c))}</ul>
          </section>
        )}
        {results.brands.length > 0 && (
          <section role="group" aria-label="Brands" className="spGroup spGroup--brands">
            <h3>Brands</h3>
            <ul role="presentation">{results.brands.map((b) => linkRow("brand", b))}</ul>
          </section>
        )}
      </>
    );
    main = (
      <section role="group" aria-label="Products" className={`spGroup${status === "loading" ? " is-refreshing" : ""}`}>
        {none ? (
          <div className="spEmpty">
            <b>No exact matches found for “{trimmed}”.</b>
            <span>{results.products.length ? "You might like these similar products:" : "Try a shorter search, a brand or a category — or check the spelling."}</span>
          </div>
        ) : (
          <div className="spResultsHead">
            <h3>
              {results.correctedQuery ? <>Showing results for <em>“{results.correctedQuery}”</em></> : "Products"}
            </h3>
            <span>{results.total} result{results.total === 1 ? "" : "s"}</span>
          </div>
        )}
        {results.products.length > 0 && <ul className="spProducts" role="presentation">{results.products.map(productCard)}</ul>}
        {!none && (() => {
          const i = indexOf((o) => o.kind === "all");
          return (
            <div className="spAllWrap" role="presentation">
              <button type="button" tabIndex={-1} id={optionId(i)} role="option" aria-selected={active === i} className={`spAll${active === i ? " is-active" : ""}`} onClick={viewAll} onMouseEnter={() => setActive(i)}>
                View all results for “{results.correctedQuery ?? trimmed}” <ArrowRight size={15} aria-hidden="true" />
              </button>
            </div>
          );
        })()}
      </section>
    );
  }

  return (
    <div className={`spPanel${closing ? " is-closing" : ""}`} role="dialog" aria-modal="false" aria-label="Search products">
      <div className="spInner">
        <form
          className="spBar"
          role="search"
          onSubmit={(e) => { e.preventDefault(); viewAll(); }}
        >
          <Search size={18} className="spBarIcon" aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            value={q}
            maxLength={100}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search products, brands, categories..."
            aria-label="Search products, brands and categories"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={options.length > 0}
            aria-controls={listId}
            aria-activedescendant={active >= 0 ? optionId(active) : undefined}
          />
          {status === "loading" && <Loader2 size={16} className="spSpin" aria-hidden="true" />}
          {q && (
            <button type="button" className="spIconBtn" aria-label="Clear search" onClick={() => { setQ(""); inputRef.current?.focus(); }}>
              <X size={16} />
            </button>
          )}
          <button type="button" className="spClose" aria-label="Close search" onClick={() => onClose({ restoreFocus: true })}>
            <X size={20} className="spCloseIcon" aria-hidden="true" />
            <span>Close</span>
          </button>
        </form>
        <div className="spBody" id={listId} role="listbox" aria-label="Search suggestions and results">
          {aside && <div className="spAside">{aside}</div>}
          <div className="spMain">{main}</div>
        </div>
        <p className="srOnly" aria-live="polite">{announce}</p>
      </div>
    </div>
  );
}
