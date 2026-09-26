import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../lib/api";
import { StoreHeader } from "../components/shop/StoreHeader";
import { getLifestyleUrl } from "../lib/links";

/**
 * /lifestyles — "Shop by Lifestyle → EXPLORE ALL": every ACTIVE lifestyle
 * straight from the API (no hardcoded list — a lifestyle an admin creates or
 * activates appears on the next load; a deactivated one disappears). Each card
 * opens the shared product listing for that lifestyle (/lifestyle/:slug),
 * which is driven by the product↔lifestyle relationships in the database.
 */
export default function LifestylesPage() {
  const [items, setItems] = useState<api.Lifestyle[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    let on = true;
    setFailed(false);
    api
      .listLifestyles()
      .then((r) => on && setItems(r.items ?? []))
      .catch(() => {
        if (!on) return;
        setItems([]);
        setFailed(true);
      });
    return () => {
      on = false;
    };
  }, []);
  useEffect(load, [load]);

  useEffect(() => {
    const prev = document.title;
    document.title = "Shop by Lifestyle | PLUG";
    return () => {
      document.title = prev;
    };
  }, []);

  return (
    <div>
      <StoreHeader />
      <main className="lifestylesPage">
        <div className="breadcrumb">
          <Link to="/">HOME</Link> / LIFESTYLES
        </div>
        <p className="text-[10px] font-bold tracking-[.25em] text-black/45 mb-3">GET YOUR STYLE</p>
        <h1 className="text-3xl md:text-5xl font-black tracking-[-.05em] uppercase">Shop by lifestyle</h1>
        <p className="lifestylesIntro">Every edit we curate — pick a lifestyle to shop its pieces.</p>

        {items === null ? (
          <div className="lifestyleGrid" role="status" aria-label="Loading lifestyles">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="lifestyleGridCard lifestyleGridCard--skeleton" />
            ))}
          </div>
        ) : failed ? (
          <p className="brandsEmpty">
            Couldn't load lifestyles right now.{" "}
            <button type="button" className="linkButton" onClick={load}>
              Retry
            </button>
          </p>
        ) : items.length === 0 ? (
          <p className="brandsEmpty">No lifestyles yet — check back soon.</p>
        ) : (
          <div className="lifestyleGrid">
            {items.map((l) => (
              <LifestyleGridCard key={l.id} l={l} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function LifestyleGridCard({ l }: { l: api.Lifestyle }) {
  const img = api.assetUrl(l.heroImageUrl) || "";
  const [broken, setBroken] = useState(false);
  const count = l.productCount ?? 0;
  return (
    <Link to={getLifestyleUrl(l.slug)} className="lifestyleGridCard" aria-label={`Shop ${l.name}`} data-lifestyle-slug={l.slug}>
      {img && !broken ? (
        <img
          src={img}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => {
            console.warn(`Lifestyle image failed to load for "${l.name}": ${img}`);
            setBroken(true);
          }}
        />
      ) : null}
      <span className="lifestyleGridScrim" />
      <span className="lifestyleGridBody">
        <span className="lifestyleGridName">{l.name}</span>
        {l.shortDescription ? <span className="lifestyleGridDesc">{l.shortDescription}</span> : null}
        <span className="lifestyleGridCount">
          {count} product{count === 1 ? "" : "s"}
        </span>
      </span>
    </Link>
  );
}
