import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import * as api from '../lib/api';
import { StoreHeader } from '../components/shop/StoreHeader';
import { getBrandUrl } from '../lib/links';

function brandMark(b: { name: string; logo?: api.BrandLogo | null }): string {
  return (b.name || "?").split(/\s+/).map((w) => w[0] ?? "").join("").toUpperCase().slice(0, 3) || "BR";
}

function BrandCard({ b }: { b: api.Brand }) {
  return (
    <Link to={getBrandUrl(b.slug)} className="brandCard">
      <div className="brandMark">
        {b.logo?.url ? <img className="brandLogoImg" src={api.assetUrl(b.logo.url)} alt={`${b.name} logo`} loading="lazy" /> : brandMark(b)}
      </div>
      <div className="brandName">{b.name}</div>
      <small>{b.productCount ?? 0} Products</small>
    </Link>
  );
}

function BrandsPage() {
  const [brands, setBrands] = useState<api.Brand[] | null>(null);
  const [query, setQuery] = useState('');
  const [letter, setLetter] = useState('ALL');
  useEffect(() => {
    let on = true;
    api.listBrands().then((r) => { if (on) setBrands(r.brands); }).catch(() => { if (on) setBrands([]); });
    return () => { on = false; };
  }, []);
  const list = brands ?? [];
  const letters = useMemo(() => Array.from(new Set(list.map((b) => (b.name[0] ?? '').toUpperCase()))).sort(), [list]);
  const filtered = useMemo(() => list.filter((b) => b.name.toLowerCase().includes(query.toLowerCase()) && (letter === 'ALL' || (b.name[0] ?? '').toUpperCase() === letter)), [list, query, letter]);
  const featured = useMemo(() => filtered.filter((b) => b.productCount != null && b.productCount > 0), [filtered]);
  const others = useMemo(() => filtered.filter((b) => !(b.productCount != null && b.productCount > 0)), [filtered]);
  return (
    <div>
      <StoreHeader />
      <main className="brandsPage">
        <div className="breadcrumb">HOME / BRANDS</div>
        <div className="pageTitle"><h1>ALL BRANDS</h1></div>
        <p className="brandsIntro">Discover your favorite brands and explore their latest collections.</p>
        <div className="searchBox brandSearch"><Search size={16} /><input placeholder="Search brands..." value={query} onChange={(e) => setQuery(e.target.value)} /></div>
        <div className="alphaNav">{['ALL', ...letters].map((l) => <button key={l} className={l === letter ? 'active' : ''} onClick={() => setLetter(l)}>{l}</button>)}</div>
        {brands === null ? <p className="brandsEmpty">Loading brands…</p>
          : letter === 'ALL' && !query && featured.length > 0 ? <h3 className="brandsSectionTitle">FEATURED BRANDS</h3>
          : null}
        {brands !== null && (filtered.length ? <>
          {letter === 'ALL' && !query && featured.length > 0 ? <div className="brandGrid">{featured.map((b) => <BrandCard key={b.id} b={b} />)}</div> : null}
          {letter !== 'ALL' || query ? null : (others.length > 0 ? <h3 className="brandsSectionTitle">ALL BRANDS</h3> : null)}
          {(letter !== 'ALL' || query || others.length > 0) && (others.length > 0 ? <div className="brandGrid">{others.map((b) => <BrandCard key={b.id} b={b} />)}</div> : null)}
          {letter !== 'ALL' || query ? (filtered.length ? <div className="brandGrid">{filtered.map((b) => <BrandCard key={b.id} b={b} />)}</div> : null) : null}
        </> : <p className="brandsEmpty">No brands found. Try a different search or letter.</p>)}
      </main>
    </div>
  );
}


export default BrandsPage;
