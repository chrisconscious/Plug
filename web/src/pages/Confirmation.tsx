import { useLocation, Link } from 'react-router-dom';
import { Truck, CheckCircle2, Check, ChevronRight } from 'lucide-react';
import { formatTZS } from '../lib/currency';
import { StoreHeader } from '../components/shop/StoreHeader';

function Confirmation() {
  const loc = useLocation();
  let persisted: Partial<{
    orderId?: string;
    paymentMethodName?: string;
    kind?: string;
    phone?: string;
    transportPaymentNumber?: string | null;
    transportPaymentName?: string | null;
    transportFeeCents?: number | null;
    totalTzs?: number | null;
    deliveryLocation?: string | null;
  }> = {};
  try { persisted = JSON.parse(sessionStorage.getItem('vv_last_order') ?? '{}'); } catch { /* ignore */ }
  const state: Record<string, unknown> = { ...persisted, ...((loc.state ?? {}) as Record<string, unknown>) };
  const orderId = typeof state.orderId === 'string' && state.orderId ? state.orderId : null;
  const isCash = state.kind === 'CASH';
  const isOnline = state.kind === 'ONLINE';
  // No real order was placed (deep-linked/refreshed with nothing saved) — show
  // an honest state rather than inventing a random order number.
  if (!orderId) {
    return (
      <div>
        <StoreHeader />
        <main className="confirmation">
          <h1>NO ORDER TO SHOW</h1>
          <p>We could not find a recent order on this device. Your placed orders are always listed under "My Orders".</p>
          <Link to="/orders" className="blackButton">VIEW MY ORDERS</Link>
          <Link to="/shop" className="outlineButton">CONTINUE SHOPPING</Link>
        </main>
      </div>
    );
  }
  return (
    <div>
      <StoreHeader />
      <main className="confirmation">
        <div className="successIcon"><CheckCircle2 /></div>
        <h1>THANK YOU!</h1><h2>YOUR ORDER HAS BEEN PLACED.</h2>
        <p>Order <b>#{orderId.slice(0, 8).toUpperCase()}</b></p>
        {isCash ? (
          <p>Our delivery team will contact you on <b>{typeof state.phone === 'string' ? state.phone : 'your number'}</b> to confirm your delivery. You will pay the balance in cash.</p>
        ) : isOnline ? (
          <p>A payment of the order total is expected via mobile money. Follow the details below to complete your payment.</p>
        ) : (
          <p>Our team will contact you shortly to confirm your delivery.</p>
        )}
        <div className="orderBox">
          <h3>ORDER DETAILS</h3>
          <div><span>Order number</span><b>#{orderId.slice(0, 8).toUpperCase()}</b></div>
          {(state.deliveryLocation === 'dar_es_salaam' || state.deliveryLocation === 'outside_dar') && (
            <div><span>Delivery location</span><b>{state.deliveryLocation === 'dar_es_salaam' ? 'Dar es Salaam' : 'Outside Dar es Salaam'}</b></div>
          )}
          {typeof state.paymentMethodName === 'string' && <div><span>Payment method</span><b>{state.paymentMethodName}</b></div>}
          <div><span>Order total</span><b>{formatTZS(typeof state.totalTzs === 'number' ? state.totalTzs : 0)}</b></div>
          {state.transportPaymentNumber && state.transportPaymentName ? (
            <>
              <div><span>Pay transport fee via</span><b>{String(state.transportPaymentName)}</b></div>
              <div><span>Transport fee number</span><b>{String(state.transportPaymentNumber)}</b></div>
            </>
          ) : null}
          {/* The order starts as PENDING; payment is confirmed by the store, never assumed here. */}
          <div><span>Order status</span><b>Pending</b></div>
          <div><span>Payment</span><b>{isOnline ? 'Awaiting your mobile-money payment' : isCash ? 'Pay on delivery' : 'To be confirmed'}</b></div>
        </div>
        <div className="nextSteps"><span><Check size={13} /> Order placed</span><ChevronRight /><span><Truck size={13} /> Order shipped</span><ChevronRight /><span>Delivered</span></div>
        <Link to={`/orders/${orderId}`} className="outlineButton">VIEW ORDER DETAILS</Link>
        <Link to="/shop" className="blackButton">CONTINUE SHOPPING</Link>
      </main>
    </div>
  );
}


export default Confirmation;
