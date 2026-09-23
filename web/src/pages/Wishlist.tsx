import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../lib/api';
import { StoreHeader } from '../components/shop/StoreHeader';
import { ProductCard } from '../components/shop/ProductCard';
import { getWishlist, onWishlistChange, getWishlistLoadError, retryWishlistLoad } from '../lib/wishlist';

function WishlistPage() {
  const [items, setItems] = useState<api.Product[]>(getWishlist);
  const [hasError, setHasError] = useState(getWishlistLoadError);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => onWishlistChange(() => { setItems(getWishlist()); setHasError(getWishlistLoadError()); }), []);
  const retry = async () => {
    setRetrying(true);
    try { await retryWishlistLoad(); } finally { setRetrying(false); }
  };
  return (
    <div>
      <StoreHeader />
      <main className="cartPage" style={{ gridTemplateColumns: '1fr' }}>
        <section>
          <div className="pageTitle"><h1>MY WISHLIST <small>({items.length} ITEM{items.length === 1 ? '' : 'S'})</small></h1></div>
          {hasError ? (
            <div style={{ padding: '20px 0' }}>
              <p style={{ color: '#c00', marginBottom: 12 }}>Couldn't load your wishlist right now.</p>
              <button type="button" className="blackButton" disabled={retrying} onClick={retry}>{retrying ? 'RETRYING…' : 'RETRY'}</button>
            </div>
          ) : items.length ? <div className="productGrid">{items.map((p) => <ProductCard key={p.slug} product={p} />)}</div> : <p style={{ padding: '20px 0' }}>Your wishlist is empty.</p>}
          <p style={{ padding: '10px 0' }}><Link to="/shop" className="blackButton">SHOP PRODUCTS</Link></p>
        </section>
      </main>
    </div>
  );
}


export default WishlistPage;
