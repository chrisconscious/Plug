import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import * as api from '../lib/api';
import { StoreHeader } from '../components/shop/StoreHeader';
import { BrandMark } from '../components/shop/BrandMark';
import { getBrandUrl } from '../lib/links';

function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0] ?? '').join('').toUpperCase().slice(0, 3) || '?';
}

function BrandCard({ b }: { b: api.Brand }) {
  const count = b.productCount ?? 0;
  return (
    <Link to={getBrandUrl(b.slug)} className="brandCard" aria-label={`Shop ${b.name}`} data-brand-slug={b.slug}>
      <div className="brandMark">
        {/* The name is printed below, so a missing logo falls back to initials. */}
        <BrandMark brand={b} className="brandLogoImg" alt="" fallback={initials(b.name)} />
      </div>
      <div className="brandName">{b.name}</div>
      <small>{count} Product{count === 1 ? '' : 's'}</small>
    </Link>
  );
}

/**
 * /brands — "Shop by Brand → EXPLORE ALL": every ACTIVE brand from the API
 * (nothing hardcoded; a brand a Super Admin adds appears on the next load).
 * Brands with live products are listed first; each card opens that brand's
 * product listing (/brands/:slug).
 */
function BrandsPage() {
  const [brands, setBrands] = useState<api.Brand[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [letter, setLetter] = useState('ALL');

  const load = useCallback(() => {
    let on = true;
    setFailed(false);
    api.listBrands()
      .then((r) => { if (on) setBrands(r.brands); })
      .catch(() => { if (on) { setBrands([]); setFailed(true); } });
    return () => { on = false; };
  }, []);
  useEffect(load, [load]);

  const list = useMemo(() => brands ?? [], [brands]);
  const letters = useMemo(() => Array.from(new Set(list.map((b) => (b.name[0] ?? '').toUpperCase()))).filter(Boolean).sort(), [list]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list.filter((b) => (!q || b.name.toLowerCase().includes(q)) && (letter === 'ALL' || (b.name[0] ?? '').toUpperCase() === letter));
  }, [list, query, letter]);
  const narrowed = letter !== 'ALL' || query.trim() !== '';
  const withProducts = filtered.filter((b) => (b.productCount ?? 0) > 0);
  const without = filtered.filter((b) => (b.productCount ?? 0) === 0);

  return (
    <div>
      <StoreHeader />
      <main className="brandsPage">
        <div className="breadcrumb"><Link to="/">HOME</Link> / BRANDS</div>
        <div className="pageTitle"><h1>ALL BRANDS</h1></div>
        <p className="brandsIntro">Discover your favorite brands and explore their latest collections.</p>
        <div className="searchBox brandSearch"><Search size={16} /><input aria-label="Search brands" placeholder="Search brands..." value={query} onChange={(e) => setQuery(e.target.value)} /></div>
        <div className="alphaNav">{['ALL', ...letters].map((l) => <button key={l} type="button" className={l === letter ? 'active' : ''} aria-pressed={l === letter} onClick={() => setLetter(l)}>{l}</button>)}</div>

        {brands === null ? (
          <p className="brandsEmpty">Loading brands…</p>
        ) : failed ? (
          <p className="brandsEmpty">Couldn't load brands right now. <button type="button" className="linkButton" onClick={load}>Retry</button></p>
        ) : filtered.length === 0 ? (
          <p className="brandsEmpty">{list.length === 0 ? 'No brands yet — check back soon.' : 'No brands found. Try a different search or letter.'}</p>
        ) : narrowed ? (
          // Searching / letter filter: ONE grid of exactly the matches (the old
          // page rendered brands without products twice here).
          <div className="brandGrid">{filtered.map((b) => <BrandCard key={b.id} b={b} />)}</div>
        ) : (
          <>
            {withProducts.length > 0 ? (
              <>
                {without.length > 0 ? <h3 className="brandsSectionTitle">FEATURED BRANDS</h3> : null}
                <div className="brandGrid">{withProducts.map((b) => <BrandCard key={b.id} b={b} />)}</div>
              </>
            ) : null}
            {without.length > 0 ? (
              <>
                {withProducts.length > 0 ? <h3 className="brandsSectionTitle">MORE BRANDS</h3> : null}
                <div className="brandGrid">{without.map((b) => <BrandCard key={b.id} b={b} />)}</div>
              </>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}

export default BrandsPage;
