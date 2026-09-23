import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../lib/api';
import { formatTZS } from '../lib/currency';
import { StoreHeader } from '../components/shop/StoreHeader';

function OrdersPage() {
  const [orders, setOrders] = useState<api.Order[] | null>(null);
  const [status, setStatus] = useState<'loading' | 'authenticated' | 'unauthenticated' | 'error'>('loading');
  const loadOrders = () => {
    let on = true;
    setStatus('loading');
    // No isAuthed() pre-check: listOrders() itself gets a silent refresh
    // retry on 401 (see request() in lib/api.ts), and the .catch below
    // already handles a *genuine* 401 correctly — the pre-check only added
    // a false "logged out" state once the local access-token-TTL timer
    // expired, even with a perfectly valid session underneath.
    api.listOrders()
      .then((r) => { if (on) { setOrders(r.orders ?? []); setStatus('authenticated'); } })
      .catch((e) => {
        if (!on) return;
        if (e instanceof api.ApiError && e.status === 401) {
          api.logout().catch(() => {});
          setStatus('unauthenticated');
          setOrders([]);
        } else {
          // A real failure (network down, 500, etc.) is NOT the same as
          // "you have zero orders" — showing the empty-state copy here
          // would misrepresent a system failure as a fact about the
          // customer's order history.
          setStatus('error');
        }
      });
    return () => { on = false; };
  };
  useEffect(loadOrders, []);
  return (
    <div>
      <StoreHeader />
      <main className="cartPage" style={{ gridTemplateColumns: '1fr' }}>
        <section>
          <div className="pageTitle"><h1>MY ORDERS</h1></div>
          {status === 'error' ? (
            <div style={{ padding: '20px 0' }}>
              <p style={{ color: '#c00', marginBottom: 12 }}>Couldn't load your orders right now.</p>
              <button type="button" className="blackButton" onClick={loadOrders}>RETRY</button>
            </div>
          ) : status === 'unauthenticated' ? (
            <p style={{ padding: '20px 0' }}>Please <Link to="/login">sign in</Link> to view your orders.</p>
          ) : orders === null ? (
            <p style={{ padding: '20px 0' }}>Loading your orders...</p>
          ) : orders.length === 0 ? (
            <div className="orderBox"><h3>ORDER HISTORY</h3><div><span>When you place an order, it will appear here.</span><b>0 orders</b></div></div>
          ) : (
            <div className="orderBox">
              <h3>ORDER HISTORY</h3>
              {orders.map((o) => (
                <div key={o.id} style={{ borderTop: '1px solid #ececec', padding: '14px 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <b>#{o.id.slice(0, 8).toUpperCase()}</b>
                    <span style={{ fontSize: 12 }}>{new Date(o.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                  </div>
                  <p style={{ fontSize: 13, color: '#555', margin: '4px 0 6px' }}>
                    {(o.items ?? []).map((it) => `${it.nameSnapshot} (${it.color ?? ''} ${it.size ?? ''})`.trim()).join(', ') || 'Order'}
                  </p>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className={`status ${o.status === 'CANCELLED' ? 'danger' : o.status === 'DELIVERED' ? '' : 'warning'}`}>{o.status}</span>
                    <b>{formatTZS(o.totalTzs ?? o.totalCents ?? 0)}</b>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p style={{ padding: '10px 0' }}><Link to="/shop" className="blackButton">CONTINUE SHOPPING</Link></p>
        </section>
      </main>
    </div>
  );
}


export default OrdersPage;
