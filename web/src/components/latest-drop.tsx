import { useEffect, useRef, useState, useCallback } from "react";
import { useInView } from "framer-motion";
import * as api from "../lib/api";
import { getNewInUrl } from "../lib/links";
import { ProductCard } from "./shop/ProductCard";
import { ExploreAllLink, ExploreMoreRow } from "./explore-more";

type Status = "loading" | "success" | "empty" | "error";

/** How many of the newest products the homepage window shows. */
export const LATEST_DROP_SIZE = 8;

/**
 * Homepage "THE LATEST DROP" — a rolling window of the newest PUBLISHED
 * products, whatever their category, brand or type.
 *
 * Fully server-driven: `sort=newest` orders live products by their first
 * publish time (products.published_at, migration 0053), so publishing a new
 * product pushes it to the front and the oldest one in the window drops off.
 * No tag, category or hand-picked list decides membership, and nothing here
 * needs editing when products are added, changed, sold out or archived —
 * the list is fetched fresh (the API answers with Cache-Control: no-cache).
 */
export function LatestDrop() {
  const [products, setProducts] = useState<api.Product[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<Status>("loading");
  const ref = useRef<HTMLDivElement>(null);
  // Defer the below-the-fold fetch + image requests until the section is near
  // the viewport (prefetched ~800px early).
  const inView = useInView(ref, { once: true, margin: "800px 0px" });

  // "VIEW ALL" only when there really is more than the window shows.
  const showViewAll = status === "success" && total > LATEST_DROP_SIZE;

  const load = useCallback(() => {
    let on = true;
    setStatus("loading");
    api
      .listProducts({ sort: "newest", page: 1, pageSize: LATEST_DROP_SIZE })
      .then((r) => {
        if (!on) return;
        setProducts(r.items);
        setTotal(r.pagination.total);
        setStatus(r.items.length > 0 ? "success" : "empty");
      })
      .catch((e) => {
        if (!on) return;
        console.error("Failed to load the latest drop:", e);
        setStatus("error");
      });
    return () => {
      on = false;
    };
  }, []);

  useEffect(() => {
    if (!inView) return;
    return load();
  }, [inView, load]);

  return (
    <section ref={ref} className="py-20 md:py-28 bg-white">
      <div className="max-w-[1440px] mx-auto px-4 md:px-8">
        <div className="flex items-end justify-between mb-10">
          <div>
            <p className="text-[10px] font-bold tracking-[.25em] text-black/45 mb-3">DISCOVER NOW</p>
            <h2 className="text-4xl md:text-6xl font-black tracking-[-.06em] uppercase">The latest drop</h2>
          </div>
          {showViewAll ? (
            <ExploreAllLink to={getNewInUrl()} label="VIEW ALL" className="hidden sm:inline-flex" />
          ) : null}
        </div>
        {status === "error" ? (
          <div className="py-12 text-center">
            <p className="text-sm text-black/60 mb-4">Couldn't load the latest drop right now.</p>
            <button
              type="button"
              onClick={load}
              className="border border-black px-6 py-2 text-xs font-bold tracking-widest hover:bg-black hover:text-white transition-colors"
            >
              RETRY
            </button>
          </div>
        ) : status === "empty" ? (
          <p className="py-12 text-center text-sm text-black/50">New pieces are on their way — check back soon.</p>
        ) : (
          /* 2 columns on smartphones, 4 on large screens — never a sliding row. */
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6">
            {status === "loading" && products.length === 0
              ? Array.from({ length: LATEST_DROP_SIZE }).map((_, i) => (
                  <div key={i} className="aspect-[3/4] bg-black/5 animate-pulse" />
                ))
              : products.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        )}
        {showViewAll ? <ExploreMoreRow to={getNewInUrl()} label="VIEW ALL" className="sm:hidden" /> : null}
      </div>
    </section>
  );
}
