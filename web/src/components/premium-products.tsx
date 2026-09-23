import { useEffect, useRef, useState, useCallback } from "react";
import { useInView } from "framer-motion";
import * as api from "../lib/api";
import { getCollectionUrl } from "../lib/links";
import { ProductCard } from "./shop/ProductCard";
import { ExploreAllLink, ExploreMoreRow } from "./explore-more";

type Status = "loading" | "success" | "empty" | "error";

export function PremiumProducts() {
  const [products, setProducts] = useState<api.Product[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<Status>("loading");
  const ref = useRef<HTMLDivElement>(null);
  // Defer the below-the-fold fetch + image requests until the section is near
  // the viewport (prefetched ~800px early), so initial page load doesn't issue
  // this request before the user ever approaches it.
  const inView = useInView(ref, { once: true, margin: "800px 0px" });

  // "VIEW ALL" only when this shelf is really the "latest 6 of many" —
  // otherwise the grid already IS the whole drop and the link would just
  // show an empty page.
  const showViewAll = status === "success" && total > 6;

  const load = useCallback(() => {
    let on = true;
    setStatus("loading");
    api
      .listProducts({ collection: "premium", page: 1, pageSize: 6 })
      .then((r) => {
        if (!on) return;
        setProducts(r.items);
        setTotal(r.pagination.total);
        setStatus(r.items.length > 0 ? "success" : "empty");
      })
      .catch((e) => {
        if (!on) return;
        console.error("Failed to load featured products:", e);
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
            <ExploreAllLink to={getCollectionUrl("premium")} label="VIEW ALL" className="hidden sm:inline-flex" />
          ) : null}
        </div>
        {status === "error" ? (
          <div className="py-12 text-center">
            <p className="text-sm text-black/60 mb-4">Couldn't load featured products right now.</p>
            <button
              type="button"
              onClick={load}
              className="border border-black px-6 py-2 text-xs font-bold tracking-widest hover:bg-black hover:text-white transition-colors"
            >
              RETRY
            </button>
          </div>
        ) : status === "empty" ? (
          <p className="py-12 text-center text-sm text-black/50">No featured products right now — check back soon.</p>
        ) : (
          /* One plain editorial grid on every screen — never a sliding row:
             smartphones see 2 columns (3 rows of the latest drop), larger
             screens see the 2/4-column grid. */
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6">
            {status === "loading" && products.length === 0
              ? Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="aspect-[3/4] bg-black/5 animate-pulse" />
                ))
              : products.map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
          </div>
        )}
        {showViewAll ? <ExploreMoreRow to={getCollectionUrl("premium")} label="VIEW ALL" className="sm:hidden" /> : null}
      </div>
    </section>
  );
}
