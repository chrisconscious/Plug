import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Lock, Minus, Plus, X } from 'lucide-react';
import * as api from '../lib/api';
import { formatTZS } from '../lib/currency';
import { resolveImage } from '../lib/imagePlaceholder';
import { StoreHeader } from '../components/shop/StoreHeader';
import { ProductCard } from '../components/shop/ProductCard';
import { getProductUrl } from '../lib/links';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { setCartCountFromItems } from '../lib/cartCount';
import { loginUrl } from '../lib/returnTo';

/**
 * One cart row, with its OWN independent pending/error state via
 * useAsyncAction — updating item A's quantity must never show a pending
 * spinner or error message on item B's row. Extracted as its own
 * component specifically because a hook cannot be called conditionally
 * or inside a .map() callback; one row = one hook instance is the
 * correct way to give each row independent action state.
 */
function CartItemRow({ item, onUpdated }: { item: api.CartItem; onUpdated: (items: api.CartItem[]) => void }) {
  const decrease = useAsyncAction(async () => {
    const r = await api.updateCartItemQuantity(item.id, Math.max(1, (item.quantity ?? 1) - 1));
    onUpdated(r.cart.items ?? []);
  });
  const increase = useAsyncAction(async () => {
    const r = await api.updateCartItemQuantity(item.id, Math.min(20, (item.quantity ?? 1) + 1));
    onUpdated(r.cart.items ?? []);
  });
  const remove = useAsyncAction(async () => {
    const r = await api.removeCartItem(item.id);
    onUpdated(r.cart.items ?? []);
  });
  const rowError = decrease.error ?? increase.error ?? remove.error;
  const rowPending = decrease.pending || increase.pending || remove.pending;

  return (
    <div className="cartItem" style={item.available === false ? { opacity: 0.6 } : undefined}>
      <img src={resolveImage(item.product?.image ?? null)} alt="" />
      <div>
        <b>{item.product?.name ?? 'Item'}</b>
        <p>{item.variant?.color ?? ''} / {item.variant?.size ?? ''}</p>
        {item.available === false && (
          <p style={{ color: '#c00', fontSize: 11, fontWeight: 600, margin: '4px 0 0' }}>{item.insufficientStock ? 'Not enough stock for this quantity — please reduce it to check out' : 'No longer available — please remove it to check out'}</p>
        )}
        {rowError && <p role="alert" style={{ color: '#c00', fontSize: 11, margin: '4px 0 0' }}>{rowError}</p>}
        <Link to={getProductUrl(item.product?.slug ?? '')} style={{ fontSize: 10, textDecoration: 'underline' }}>View</Link>
      </div>
      <b>{formatTZS(item.lineTotalCents ?? 0)}</b>
      <div className="qty">
        <button onClick={() => decrease.run()} disabled={rowPending || (item.quantity ?? 1) <= 1}><Minus /></button>
        {item.quantity}
        <button onClick={() => increase.run()} disabled={rowPending || (item.quantity ?? 1) >= 20}><Plus /></button>
      </div>
      <button className="iconBtn" onClick={() => remove.run()} disabled={rowPending}><X /></button>
    </div>
  );
}

function Cart() {
  const [items, setItems] = useState<api.CartItem[] | null>(null);
  const [status, setStatus] = useState<'loading' | 'authenticated' | 'unauthenticated' | 'error'>('loading');
  const [recs, setRecs] = useState<api.Product[]>([]);
  useEffect(() => {
    let on = true;
    api.listProducts({ page: 1, pageSize: 3 }).then((r) => on && setRecs(r.items)).catch(() => on && setRecs([]));
    return () => { on = false; };
  }, []);
  const loadCart = () => {
    let on = true;
    setStatus('loading');
    (async () => {
      // getCart() is the real auth probe — api.ts already retries once via
      // a silent refresh on 401, so this only reports "logged out" when
      // the session is genuinely gone, not from any local timer/guess.
      try {
        const r = await api.getCart();
        if (on) { setItems(r.cart.items ?? []); setCartCountFromItems(r.cart.items ?? []); setStatus('authenticated'); }
      } catch (e) {
        if (!on) return;
        if (e instanceof api.ApiError && e.status === 401) {
          setStatus('unauthenticated');
          setItems([]);
        } else {
          // A real failure (network down, 500, etc.) is NOT the same as
          // an empty cart — showing "your cart is empty" here would be
          // actively misleading, the same failure mode AuthContext.tsx
          // was built to avoid for the overall session state.
          setStatus('error');
        }
      }
    })();
    return () => { on = false; };
  };
  useEffect(loadCart, []);
  const subtotal = (items ?? []).reduce((s, it) => s + (it.lineTotalCents ?? 0), 0);
  return (
    <div>
      <StoreHeader /><main className="cartPage"><section>
        <div className="pageTitle"><h1>YOUR CART <small>({((items ?? []).length)} ITEMS)</small></h1></div>
        {status === 'error' ? (
          <div style={{ padding: '30px 0', textAlign: 'center' }}>
            <p style={{ color: '#c00', marginBottom: 12 }}>Couldn't load your cart right now.</p>
            <button type="button" className="blackButton" onClick={loadCart}>RETRY</button>
          </div>
        ) : status === 'unauthenticated' ? (<p style={{ padding: '20px 0' }}>Please <Link to={loginUrl('/cart')}>sign in</Link> to view and manage your cart.</p>)
          : items && items.length > 0 ? (items.map((it, i) => (
              <CartItemRow key={it.id ?? i} item={it} onUpdated={(updated) => { setItems(updated); setCartCountFromItems(updated); }} />
            )))
          : (items ? <p style={{ padding: '20px 0' }}>Your cart is empty.</p> : <p style={{ padding: '20px 0' }}>Loading your cart...</p>)}
        <div className="cartRecs"><h3>YOU MAY ALSO LIKE</h3><div className="productGrid">{recs.map((px) => <ProductCard key={px.id} product={px} />)}</div></div>
      </section><OrderSummary subtotal={subtotal} /></main>
    </div>
  );
}

function OrderSummary({ subtotal = 0 }: { subtotal?: number }) {
  // The cart shows PRODUCTS ONLY — no transport/delivery fee here. The
  // transport fee is a checkout concern: it depends on the delivery
  // location the customer picks on the checkout payment page (see
  // Checkout.tsx), so it has no business being guessed on the cart. The
  // cart total therefore equals the subtotal, and checkout is the single
  // place the transport cost appears.
  const subtotalTzs = subtotal || 0;
  return (
    <aside className="summary">
      <h3>ORDER SUMMARY</h3>
      <p><span>Subtotal</span><b>{formatTZS(subtotalTzs)}</b></p>
      <hr /><p className="total"><span>Total</span><b>{formatTZS(subtotalTzs)}</b></p>
      <Link to="/checkout" className="blackButton">PROCEED TO CHECKOUT</Link>
      <div className="secure"><Lock /> Secure checkout<br /><small>Your information is protected</small></div>
    </aside>
  );
}


export default Cart;
