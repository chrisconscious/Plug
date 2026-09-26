import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import * as api from '../lib/api';
import { ORDER_STATUS_LABEL as STATUS_LABEL } from '../lib/orderStatus';
import { formatTZS } from '../lib/currency';
import { StoreHeader } from '../components/shop/StoreHeader';
import { loginUrl, currentLocation } from '../lib/returnTo';


function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<api.Order | null>(null);
  const [status, setStatus] = useState<'loading' | 'success' | 'not_found' | 'unauthenticated' | 'error'>('loading');

  useEffect(() => {
    if (!id) return;
    let on = true;
    setStatus('loading');
    api.getOrder(id)
      .then((r) => { if (on) { setOrder(r.order); setStatus('success'); } })
      .catch((e) => {
        if (!on) return;
        if (e instanceof api.ApiError && e.status === 401) {
          api.logout().catch(() => {});
          setStatus('unauthenticated');
        } else if (e instanceof api.ApiError && (e.status === 404 || e.status === 403)) {
          // 403 (someone else's order) and 404 (doesn't exist) both read as
          // "not found" to this customer — never confirm or deny that an
          // order ID belonging to another customer actually exists.
          setStatus('not_found');
        } else {
          setStatus('error');
        }
      });
    return () => { on = false; };
  }, [id]);

  const orderNumber = id ? id.slice(0, 8).toUpperCase() : '';

  return (
    <div>
      <StoreHeader />
      <main className="notifPage" style={{ maxWidth: 640 }}>
        <div style={{ marginBottom: 20 }}>
          <Link to="/orders" style={{ fontSize: 12, fontWeight: 700, color: '#666' }}>&larr; ALL ORDERS</Link>
        </div>

        {status === 'loading' && <div className="accSkelBlock" style={{ height: 300 }} />}

        {status === 'unauthenticated' && (
          <p>Please <Link to={loginUrl(currentLocation())}>sign in</Link> to view this order.</p>
        )}

        {status === 'not_found' && (
          <div className="accEmpty">
            <p>We couldn't find that order.</p>
            <Link to="/orders" className="blackButton" style={{ display: 'inline-block', marginTop: 12 }}>VIEW ALL ORDERS</Link>
          </div>
        )}

        {status === 'error' && (
          <div className="accEmpty">
            <p>Something went wrong loading this order.</p>
            <button type="button" className="blackButton" onClick={() => window.location.reload()}>RETRY</button>
          </div>
        )}

        {status === 'success' && order && (
          <>
            <div className="notifPageHead">
              <h1>Order #{orderNumber}</h1>
              <span className={'status'} style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20, background: '#f0efe9' }}>
                {STATUS_LABEL[order.status] ?? order.status}
              </span>
            </div>
            <p style={{ fontSize: 12.5, color: '#888', marginTop: -8, marginBottom: 20 }}>
              Placed {new Date(order.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>

            <div className="notifPageList" style={{ marginBottom: 20 }}>
              {order.items.map((item, i) => (
                <div key={i} className="notifPageItem" style={{ cursor: 'default' }}>
                  <span className="notifItemBody">
                    <span className="notifItemTitle">{item.nameSnapshot}</span>
                    <span className="notifItemMsg">{[item.brandSnapshot, [item.size, item.color].filter(Boolean).join(' / ')].filter(Boolean).join(' · ')} · Qty {item.quantity}</span>
                  </span>
                  <b style={{ fontSize: 13 }}>{formatTZS(item.lineTotalCents)}</b>
                </div>
              ))}
            </div>

            <dl className="summaryTotals">
              <div><dt>Subtotal</dt><dd>{formatTZS(order.subtotalCents)}</dd></div>
              {order.discountCents > 0 && <div className="summaryDiscount"><dt>Discount</dt><dd>-{formatTZS(order.discountCents)}</dd></div>}
              <div><dt>Delivery fee</dt><dd>{formatTZS(order.shippingCents)}</dd></div>
              <div className="summaryTotal"><dt>Total</dt><dd>{formatTZS(order.totalCents)}</dd></div>
            </dl>

            {order.paymentMethodName && (
              <p style={{ fontSize: 12.5, color: '#666', marginTop: 16 }}>
                Payment method: {order.paymentMethodName}
                {order.deliveryLocation && ` · Delivery to ${order.deliveryLocation === 'dar_es_salaam' ? 'Dar es Salaam' : 'outside Dar es Salaam'}`}
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default OrderDetailPage;
