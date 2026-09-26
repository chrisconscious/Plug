import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import * as api from '../lib/api';
import { ORDER_STATUS_LABEL as STATUS_LABEL } from '../lib/orderStatus';
import { formatTZS } from '../lib/currency';

const STATUSES: api.Order['status'][] = ['PENDING', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED'];

/**
 * Standalone route, not one of the Backoffice-dispatched nav-item pages —
 * those only match an exact path from adminNav.ts (e.g. /admin/orders),
 * so an order-specific URL like /admin/orders/abc123 needs its own
 * explicit route (added in App.tsx) rather than relying on that
 * nav-driven dispatch, which has no notion of a dynamic :id segment.
 */
function AdminOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<api.Order | null>(null);
  const [status, setStatus] = useState<'loading' | 'success' | 'not_found' | 'forbidden' | 'error'>('loading');
  const [updating, setUpdating] = useState(false);
  const [banner, setBanner] = useState('');

  const load = () => {
    if (!id) return;
    setStatus('loading');
    api.getAdminOrder(id)
      .then((r) => { setOrder(r.order); setStatus('success'); })
      .catch((e) => {
        if (e instanceof api.ApiError && e.status === 404) setStatus('not_found');
        else if (e instanceof api.ApiError && e.status === 403) setStatus('forbidden');
        else setStatus('error');
      });
  };
  useEffect(load, [id]);

  const changeStatus = async (next: api.Order['status']) => {
    if (!id || !order) return;
    setUpdating(true);
    try {
      const r = await api.updateOrderStatus(id, next);
      setOrder((cur) => (cur ? { ...cur, status: r.order.status } : cur));
      setBanner('Status updated.');
    } catch (e) {
      setBanner(e instanceof api.ApiError ? e.message : 'Could not update status.');
    } finally {
      setUpdating(false);
      setTimeout(() => setBanner(''), 3000);
    }
  };

  const orderNumber = id ? id.slice(0, 8).toUpperCase() : '';

  if (status === 'loading') return <div style={{ padding: 40, fontSize: 13, color: '#71717a' }}>Loading…</div>;
  if (status === 'not_found') return <div style={{ padding: 40, fontSize: 13 }}>Order not found. <Link to="/admin/orders">Back to Orders</Link></div>;
  if (status === 'forbidden') return <div style={{ padding: 40, fontSize: 13 }}>You don't have permission to view this order.</div>;
  if (status === 'error' || !order) return <div style={{ padding: 40, fontSize: 13, color: '#c00' }}>Couldn't load this order. <button onClick={load} style={{ marginLeft: 8 }}>RETRY</button></div>;

  return (
    <div style={{ maxWidth: 720, padding: 24 }}>
      <Link to="/admin/orders" style={{ fontSize: 12, fontWeight: 700, color: '#666' }}>&larr; ALL ORDERS</Link>

      {banner && <div style={{ margin: '12px 0', padding: '8px 12px', borderRadius: 6, fontSize: 12.5, background: '#f0fdf4', color: '#166534' }}>{banner}</div>}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '16px 0' }}>
        <h1 style={{ font: '800 20px Manrope', margin: 0 }}>Order #{orderNumber}</h1>
        <select value={order.status} disabled={updating} onChange={(e) => changeStatus(e.target.value as api.Order['status'])} style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid #d4d4d4', fontSize: 12.5 }}>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </div>
      <p style={{ fontSize: 12.5, color: '#888', marginTop: -8 }}>
        Placed {new Date(order.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '16px 0' }}>
        {order.items.map((item, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', border: '1px solid #ece9e2', borderRadius: 8, padding: '10px 14px' }}>
            <div>
              <b style={{ fontSize: 13 }}>{item.nameSnapshot}</b>
              <p style={{ fontSize: 11.5, color: '#888', margin: '2px 0 0' }}>{item.brandSnapshot} · {item.size} / {item.color} · Qty {item.quantity}</p>
            </div>
            <b style={{ fontSize: 13 }}>{formatTZS(item.lineTotalCents)}</b>
          </div>
        ))}
      </div>

      <div style={{ borderTop: '1px solid #ece9e2', paddingTop: 12, fontSize: 13 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Subtotal</span><span>{formatTZS(order.subtotalCents)}</span></div>
        {order.discountCents > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', color: '#166534' }}><span>Discount</span><span>-{formatTZS(order.discountCents)}</span></div>}
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Delivery fee</span><span>{formatTZS(order.shippingCents)}</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, marginTop: 6 }}><span>Total</span><span>{formatTZS(order.totalCents)}</span></div>
      </div>

      {order.paymentMethodName && (
        <p style={{ fontSize: 12.5, color: '#666', marginTop: 16 }}>
          Paid via {order.paymentMethodName}
          {order.deliveryLocation && ` · Delivery to ${order.deliveryLocation === 'dar_es_salaam' ? 'Dar es Salaam' : 'outside Dar es Salaam'}`}
        </p>
      )}
    </div>
  );
}

export default AdminOrderDetailPage;
