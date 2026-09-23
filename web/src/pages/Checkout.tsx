import { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Lock, Truck, Copy, Check, Loader2, Banknote, Smartphone } from 'lucide-react';
import * as api from '../lib/api';
import { clearCartCount } from '../lib/cartCount';
import { formatTZS } from '../lib/currency';
import { StoreHeader } from '../components/shop/StoreHeader';
import { usePlatformSettings } from '../lib/PlatformSettingsContext';

function Checkout() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const { darEsSalaamFeeTzs, outsideDarFeeTzs, codMessage } = usePlatformSettings();
  // "Buy it now": when the customer arrives at /checkout?buyNow=<variantId>&qty=<n>
  // they are checking out EXACTLY that one product — the order must contain only
  // it (never the rest of the cart) and the cart must be left untouched. The
  // query keeps it unambiguous per visit and survives refreshes without any
  // stale shared state; a plain /checkout visit is the normal full-cart flow.
  const buyNowVariant = searchParams.get('buyNow');
  const buyNowQtyRaw = Number(searchParams.get('qty') ?? '1');
  const buyNowQty = Number.isInteger(buyNowQtyRaw) && buyNowQtyRaw >= 1 && buyNowQtyRaw <= 20 ? buyNowQtyRaw : 1;
  const buyNow = buyNowVariant ? { variantId: buyNowVariant, quantity: buyNowQty } : null;
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [email, setEmail] = useState(''); const [full, setFull] = useState(''); const [addr, setAddr] = useState(''); const [city, setCity] = useState(''); const [region, setRegion] = useState(''); const [zip, setZip] = useState(''); const [phone, setPhone] = useState('');
  // Coupon: appliedCoupon is only ever set from a successful server
  // response (api.previewCoupon) — never derived from couponInput alone,
  // so the discount shown can't drift from what the server actually
  // validated. It's still only a PREVIEW: order creation re-validates
  // and re-computes this from scratch server-side (see order.service.ts),
  // so a coupon that becomes invalid between preview and submission
  // (expired, limit reached by someone else) is caught there too, not
  // just trusted here.
  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; discountCents: number } | null>(null);
  const [couponError, setCouponError] = useState('');
  const [couponChecking, setCouponChecking] = useState(false);

  const applyCoupon = async () => {
    if (!couponInput.trim()) return;
    setCouponChecking(true);
    setCouponError('');
    try {
      const result = await api.previewCoupon(couponInput.trim(), cartSubtotal);
      setAppliedCoupon({ code: couponInput.trim().toUpperCase(), discountCents: result.discountCents });
      setCouponError('');
    } catch (e) {
      setAppliedCoupon(null);
      setCouponError(e instanceof api.ApiError ? (e.fields?.couponCode ?? e.message) : 'Could not apply this coupon.');
    } finally {
      setCouponChecking(false);
    }
  };

  const removeCoupon = () => {
    setAppliedCoupon(null);
    setCouponInput('');
    setCouponError('');
  };
  const [step, setStep] = useState(1); const [paying, setPaying] = useState(false); const [err, setErr] = useState('');
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  // Generated ONCE per checkout attempt (component mount), not per submit
  // click — this is what makes the backend's idempotency protection
  // (see api/docs/DATABASE.md) actually work for a real retry: if the
  // first placeOrder() call succeeds server-side but the response is
  // lost (a network timeout) and the user clicks "Place Order" again,
  // the SAME key must be sent so the backend recognizes it as a retry
  // of the same attempt, not a new order. Regenerating a fresh key on
  // every submit (the previous behavior) defeated this entirely.
  const [idempotencyKey] = useState(() => (crypto.randomUUID ? crypto.randomUUID() : 'vv-' + Date.now() + '-' + Math.random()));

  const [methods, setMethods] = useState<api.PaymentMethod[] | null>(null);
  const [mode, setMode] = useState<'CASH' | 'ONLINE' | null>(null);
  const [location, setLocation] = useState<'dar_es_salaam' | 'outside_dar' | null>(null);
  const [networkId, setNetworkId] = useState<string>('');
  const [cartSubtotal, setCartSubtotal] = useState(0);
  const [cartItems, setCartItems] = useState<api.CartItem[]>([]);
  const [cartLoadError, setCartLoadError] = useState(false);
  const [cartLoaded, setCartLoaded] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const getCartSafe = async (): Promise<{ ok: true; cart: api.Cart } | { ok: false }> => {
    try {
      return { ok: true, cart: (await api.getCart()).cart };
    } catch (e) {
      return { ok: false };
    }
  };

  const loadCartAndMethods = async () => {
    try {
      const [m, c] = await Promise.all([
        api.listPaymentMethods(),
        buyNow
          ? api.getBuyNowItems(buyNow.variantId, buyNow.quantity).then((r) => ({ ok: true as const, cart: r.cart }))
          : getCartSafe(),
      ]);
      const active = m.methods ?? [];
      setMethods(active);
      const firstOnline = active.find((x) => x.kind === 'ONLINE');
      if (firstOnline) setNetworkId((cur) => cur || firstOnline.id);
      // Neither payment method is pre-selected — per the checkout redesign,
      // nothing about payment (network lists, COD instructions) should be
      // visible until the customer explicitly picks Online Pay or Cash on
      // Delivery. A prior version auto-selected one so the page had
      // "something" showing by default, which is exactly the clutter this
      // redesign removes.
      if (c && c.ok) {
        setCartLoadError(false);
        const cart = c.cart;
        setCartSubtotal(cart.subtotalCents ?? cart.items?.reduce((s, it) => s + (it.lineTotalCents ?? 0), 0) ?? 0);
        setCartItems(cart.items ?? []);
      } else {
        // The cart genuinely failed to load — showing a silent $0
        // subtotal here would be actively misleading on a checkout
        // page, not a harmless empty state. The order total itself is
        // always computed authoritatively server-side at placeOrder()
        // regardless of this display value, but the customer still
        // deserves to know the number on screen might be wrong, and a
        // real way to try again rather than being stuck.
        setCartLoadError(true);
      }
      setCartLoaded(true);
    } catch (e) {
      setMethods([]);
      setCartLoaded(true);
      setErr(e instanceof api.ApiError ? e.message : 'Could not load payment options');
    }
  };

  const retryCartLoad = async () => {
    setRetrying(true);
    try { await loadCartAndMethods(); } finally { setRetrying(false); }
  };

  // Session guard + load active payment methods (ONCE) + the real cart in parallel.
  useEffect(() => {
    let on = true;
    (async () => {
      // api.me() is the real auth probe — it requires a valid session and
      // (via request()'s built-in 401 handling) transparently refreshes an
      // expired access token first. Unlike the old local isAuthed() flag,
      // this can't wrongly report "logged out" just because 15 minutes
      // passed; /payment-methods below is a public endpoint, so it can't be
      // used as the auth signal on its own.
      let loggedOut = false;
      try {
        await api.me();
      } catch (e) {
        loggedOut = e instanceof api.ApiError && e.status === 401;
      }
      if (!on) return;
      setAuthed(!loggedOut);
      if (loggedOut) return;
      await loadCartAndMethods();
      // Pre-fill from the customer's saved address book (built for the
      // Account page) rather than always starting blank — this is what
      // makes checkout use the SAME address system as the account page
      // instead of a second, disconnected one. Only pre-fills fields
      // that are still empty, so it never overwrites anything the
      // customer may have already started typing while this loaded, and
      // never overrides an address they're deliberately editing.
      try {
        const { addresses } = await api.listAddresses();
        const preferred = addresses.find((a) => a.isDefault) ?? addresses[0];
        if (preferred && on) {
          setFull((cur) => cur || preferred.label);
          setAddr((cur) => cur || preferred.line1);
          setCity((cur) => cur || preferred.city);
          setRegion((cur) => cur || preferred.region);
          setZip((cur) => cur || preferred.postalCode);
          setPhone((cur) => cur || preferred.phone || '');
        }
      } catch {
        // Best-effort convenience — checkout works perfectly well with a
        // blank form if this fails for any reason (e.g. a guest browsing
        // without ever having saved an address).
      }
    })();
    return () => { on = false; };
  }, []);

  if (authed === false) {
    return (
      <div>
        <StoreHeader />
        <main className="checkout">
          <section className="checkoutEmpty">
            <h1>Checkout</h1>
            <p>Please <Link to="/login">sign in</Link> to place your order.</p>
          </section>
        </main>
      </div>
    );
  }

  const cash = methods?.find((m) => m.kind === 'CASH') ?? null;
  const online = methods?.filter((m) => m.kind === 'ONLINE') ?? [];
  const network = online.find((n) => n.id === networkId) ?? online[0] ?? null;

  const isCash = mode === 'CASH';
  const isOnline = mode === 'ONLINE';
  // Transport fee is keyed by the customer's chosen DELIVERY LOCATION, the
  // same amount regardless of payment method — a prior version tied this
  // to the Cash payment method specifically (Online Pay had zero delivery
  // charge). See the backend's migration 0047 for the full reasoning;
  // this mirrors it exactly so the number shown here always matches what
  // the backend actually charges.
  const transportFeeTzs = location === 'dar_es_salaam' ? darEsSalaamFeeTzs : location === 'outside_dar' ? outsideDarFeeTzs : 0;
  const shippingCents = transportFeeTzs;
  const discountCents = appliedCoupon?.discountCents ?? 0;
  const totalCents = cartSubtotal + shippingCents - discountCents;
  const subtotalTzs = cartSubtotal;
  const totalTzs = subtotalTzs + transportFeeTzs - discountCents;

  const cartIsEmpty = authed === true && cartLoaded && !cartLoadError && !buyNow && cartItems.length === 0;
  // A buy-now item that can no longer be purchased (sold out / deactivated
  // between the product page and checkout). Block checkout with an honest
  // message — unlike the cart, this item isn't "one of many that can be
  // excluded"; it IS the entire order, so it can't be filtered out silently.
  const buyNowNotAvailable = !!buyNow && cartLoaded && !cartLoadError && cartItems.length > 0 && cartItems[0]?.available === false;

  const placeOrder = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setErr('');
    if (step === 1) {
      if (email.trim() && !email.includes('@')) { setErr('Please enter a valid email, or leave it blank.'); return; }
      if (!full.trim()) { setErr('Please enter your full name.'); return; }
      if (!addr.trim()) { setErr('Please enter your delivery address.'); return; }
      if (!city.trim()) { setErr('Please enter your city.'); return; }
      if (!phone.trim()) { setErr('Please enter your phone number.'); return; }
      setStep(2); return;
    }
    if (!location) { setErr('Please choose your delivery location.'); return; }
    if (!mode) { setErr('Please choose how you would like to pay.'); return; }
    if (!phone.trim()) { setErr(isCash ? 'Please enter your phone number so we can reach you on delivery.' : 'Please enter the number that will send the payment.'); return; }
    let paymentMethodId = '';
    let transportPaymentNumber: string | null = null;
    if (isOnline) {
      if (!network) { setErr('No online payment network is available right now.'); return; }
      paymentMethodId = network.id;
    } else {
      if (!cash) { setErr('Cash on delivery is not available right now.'); return; }
      paymentMethodId = cash.id;
      if (transportFeeTzs > 0) {
        if (!network) { setErr('Please choose a network to pay the transport fee.'); return; }
        transportPaymentNumber = network.paymentNumber ?? network.id;
      }
    }
    setPaying(true);
    try {
      const order = await api.createOrder(
        { label: full || 'Home', line1: addr, city, region: region || 'Dar es Salaam', postalCode: zip.trim(), country: 'TZ', phone: phone || undefined },
        paymentMethodId,
        idempotencyKey,
        transportPaymentNumber,
        location,
        buyNow ? [{ variantId: buyNow.variantId, quantity: buyNow.quantity }] : undefined,
        appliedCoupon?.code ?? null
      );
      // A successful full-cart order empties the server-side cart — reflect
      // that immediately. A buy-now order NEVER touched the cart (by design),
      // so clearing the badge here would wrongly hide the customer's items.
      if (!buyNow) clearCartCount();
      const summary = {
        orderId: order.order.id,
        paymentMethodName: order.order.paymentMethodName ?? (isCash ? (cash?.name ?? '') : (network?.name ?? '')),
        kind: isCash ? 'CASH' : 'ONLINE',
        phone: phone.trim(),
        transportPaymentNumber: order.order.transportPaymentNumber ?? (isCash ? (network?.paymentNumber ?? null) : null),
        transportPaymentName: order.order.transportPaymentName ?? (isCash ? (network?.name ?? null) : null),
        transportFeeCents: order.order.transportFeeCents ?? shippingCents,
        deliveryLocation: order.order.deliveryLocation ?? location,
        totalTzs: order.order.totalTzs ?? totalTzs,
      };
      // Persist so a refresh on the confirmation screen shows the SAME real order
      // instead of fabricating a new fake order number.
      try { sessionStorage.setItem('vv_last_order', JSON.stringify(summary)); } catch { /* ignore */ }
      nav('/order-confirmation', { state: summary });
    } catch (e) {
      if (e instanceof api.ApiError && e.fields?.couponCode) {
        // The coupon passed preview but failed at actual order creation —
        // e.g. someone else claimed the last redemption in the meantime.
        // Surface it as a coupon problem specifically (and drop the
        // stale applied state) rather than a generic order failure, so
        // the customer understands exactly what to do next.
        setAppliedCoupon(null);
        setCouponError(e.fields.couponCode);
        setErr('Your coupon is no longer valid — please remove it or try a different code, then place your order again.');
      } else {
        setErr(e instanceof api.ApiError ? e.message : 'Could not place your order.');
      }
      setNeedsVerification(e instanceof api.ApiError && e.category === 'EMAIL_NOT_VERIFIED');
      setPaying(false);
    }
  };

  const ctaLabel = paying
    ? (<>Processing…</>)
    : (step === 1 ? 'Continue to Payment' : 'Place Order');

  return (
    <div>
      <StoreHeader />
      <main className="checkout">
        {cartIsEmpty || buyNowNotAvailable ? (
          <section className="checkoutEmpty">
            <h1>{buyNowNotAvailable ? 'This product is no longer available' : 'Your cart is empty'}</h1>
            <p>
              {buyNowNotAvailable
                ? 'It may have just sold out or been removed. Choose another size or product and continue.'
                : 'Add a few products before checking out.'}
            </p>
            <Link to="/shop" className="btnCheckout" style={{ margin: '0 auto' }}>Continue Shopping</Link>
          </section>
        ) : (
          <form className="checkoutForm" onSubmit={placeOrder} noValidate>
            <section className="checkoutSection">
              <div className="checkoutHead">
                <nav className="checkoutSteps" aria-label="Checkout progress">
                  <span className={step === 1 ? 'coStep active' : 'coStep done'}>
                    <span className="coStepNum">{step === 1 ? '1' : <Check size={12} />}</span>
                    Delivery details
                  </span>
                  <span className="coStepArrow">→</span>
                  <span className={step === 2 ? 'coStep active' : 'coStep'}>
                    <span className="coStepNum">2</span>
                    Payment
                  </span>
                </nav>
                <h1>Checkout</h1>
                <p className="checkoutSub">{step === 1 ? 'Where should we deliver your order?' : 'Confirm delivery and choose how you will pay.'}</p>
              </div>

              {err && (
                <div className="coError" role="alert">
                  <p>{err}</p>
                  {needsVerification && (
                    resendState === 'sent' ? (
                      <p className="coErrorOk">Verification email sent — check your inbox, then try again.</p>
                    ) : (
                      <button
                        type="button"
                        className="coErrorLink"
                        disabled={resendState === 'sending'}
                        onClick={async () => {
                          setResendState('sending');
                          try { await api.resendVerification(); setResendState('sent'); }
                          catch { setResendState('error'); }
                        }}
                      >
                        {resendState === 'sending' ? 'Sending…' : 'Resend verification email'}
                      </button>
                    )
                  )}
                  {resendState === 'error' && <p className="coErrorOk">Something went wrong sending the email. Please try again.</p>}
                </div>
              )}

              {step === 1 ? (
                <div className="fieldGrid">
                  <h2 className="coBlockTitle" id="contact-section">Contact information</h2>
                  <div className="coField full">
                    <label htmlFor="co-email">Email address</label>
                    <input id="co-email" placeholder="you@example.com (optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
                  </div>

                  <h2 className="coBlockTitle" id="address-section">Delivery address</h2>
                  <div className="coField full">
                    <label htmlFor="co-name">Full name <span aria-hidden="true">*</span></label>
                    <input id="co-name" placeholder="Full name" value={full} onChange={(e) => setFull(e.target.value)} required autoComplete="name" />
                  </div>
                  <div className="coField full">
                    <label htmlFor="co-address">Address <span aria-hidden="true">*</span></label>
                    <input id="co-address" placeholder="Street address" value={addr} onChange={(e) => setAddr(e.target.value)} required autoComplete="street-address" />
                  </div>
                  <div className="coField">
                    <label htmlFor="co-city">City <span aria-hidden="true">*</span></label>
                    <input id="co-city" placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} required autoComplete="address-level2" />
                  </div>
                  <div className="coField">
                    <label htmlFor="co-region">Region</label>
                    <input id="co-region" placeholder="Region" value={region} onChange={(e) => setRegion(e.target.value)} autoComplete="address-level1" />
                  </div>
                  <div className="coField">
                    <label htmlFor="co-zip">Postal code / Namba ya Nyumba</label>
                    <input id="co-zip" placeholder="Postal code / Namba ya Nyumba" value={zip} onChange={(e) => setZip(e.target.value)} autoComplete="postal-code" />
                  </div>
                  <div className="coField">
                    <label htmlFor="co-phone">Phone number <span aria-hidden="true">*</span></label>
                    <input id="co-phone" placeholder="+255 7XX XXX XXX" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required autoComplete="tel" />
                  </div>
                </div>
              ) : (
                <div className="checkoutStepBody">
                  <LocationStep
                    location={location}
                    setLocation={setLocation}
                    darFeeTzs={darEsSalaamFeeTzs}
                    outsideFeeTzs={outsideDarFeeTzs}
                  />
                  <PaymentStep
                    methods={methods}
                    cash={cash}
                    online={online}
                    mode={mode}
                    setMode={setMode}
                    network={network}
                    networkId={networkId}
                    setNetworkId={setNetworkId}
                    transportFeeTzs={transportFeeTzs}
                    totalTzs={totalTzs}
                    codMessage={codMessage}
                  />
                </div>
              )}
            </section>

            <aside className="checkoutAside" aria-label="Order summary">
              {cartLoadError ? (
                <div className="coCartError">
                  <p>Couldn't load your cart total. Please try again before continuing.</p>
                  <button type="button" className="btnCheckout" style={{ width: '100%', minWidth: 0 }} disabled={retrying} onClick={retryCartLoad}>
                    {retrying ? 'Retrying…' : 'Retry'}
                  </button>
                </div>
              ) : (
                <CheckoutSummary
                  items={cartItems}
                  subtotalCents={cartSubtotal}
                  transportFeeTzs={transportFeeTzs}
                  totalTzs={totalTzs}
                  locationChosen={!!location}
                  couponInput={couponInput}
                  setCouponInput={setCouponInput}
                  appliedCoupon={appliedCoupon}
                  couponError={couponError}
                  couponChecking={couponChecking}
                  onApplyCoupon={applyCoupon}
                  onRemoveCoupon={removeCoupon}
                />
              )}
            </aside>

            <div className="checkoutFooter">
              <span className="secureTag" aria-hidden="true"><Lock size={13} /> Secure checkout</span>
              <button type="submit" className="btnCheckout" disabled={paying}>
                {paying ? <><Loader2 size={15} className="spin" /> Processing…</> : ctaLabel}
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}

function CopyNumber({ number }: { number: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(number);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the number remains visibly selectable */
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? 'Copied' : 'Copy number'}
      aria-label="Copy payment number"
      className="copyBtn"
      data-role="copy-number"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}

function LocationStep({ location, setLocation, darFeeTzs, outsideFeeTzs }: {
  location: 'dar_es_salaam' | 'outside_dar' | null;
  setLocation: (l: 'dar_es_salaam' | 'outside_dar') => void;
  darFeeTzs: number;
  outsideFeeTzs: number;
}) {
  return (
    <div className="pmSection">
      <p className="pmSectionTitle">Delivery location</p>
      <p className="pmSectionDesc">Your transport fee depends on your delivery area.</p>
      <div className="pmCards">
        <button
          type="button"
          onClick={() => setLocation('dar_es_salaam')}
          aria-pressed={location === 'dar_es_salaam'}
          className={'pmCard' + (location === 'dar_es_salaam' ? ' active' : '')}
        >
          <span className="pmCardIcon"><Truck size={19} /></span>
          <span className="pmCardBody">
            <span className="pmCardName">Dar es Salaam</span>
            <span className="pmCardDesc">Delivery fee: {formatTZS(darFeeTzs)}</span>
          </span>
          <span className="pmCardIndicator"><Check size={13} className="pmCardCheck" /></span>
        </button>
        <button
          type="button"
          onClick={() => setLocation('outside_dar')}
          aria-pressed={location === 'outside_dar'}
          className={'pmCard' + (location === 'outside_dar' ? ' active' : '')}
        >
          <span className="pmCardIcon"><Truck size={19} /></span>
          <span className="pmCardBody">
            <span className="pmCardName">Outside Dar es Salaam</span>
            <span className="pmCardDesc">Delivery fee: {formatTZS(outsideFeeTzs)}</span>
          </span>
          <span className="pmCardIndicator"><Check size={13} className="pmCardCheck" /></span>
        </button>
      </div>
    </div>
  );
}

/** A proper radio control, not a clickable div — this is "choose one
 *  network from a group," which a radio input represents natively
 *  (keyboard operable, screen-reader announced, no manual role/tabIndex/
 *  onKeyDown needed). The copy button is a sibling <button> inside the
 *  <label>, never nested inside another button (invalid HTML) — clicking
 *  it works as a normal button and does NOT also toggle the radio,
 *  which is standard browser behavior for an interactive element nested
 *  in a label. */
function NetworkRow({ network, groupName, selected, onSelect }: { network: api.PaymentMethod; groupName: string; selected: boolean; onSelect: () => void }) {
  return (
    <label className={'networkRow' + (selected ? ' active' : '')}>
      <input
        type="radio"
        name={groupName}
        value={network.id}
        checked={selected}
        onChange={onSelect}
        className="networkRowRadio"
        aria-label={`Pay via ${network.name}${network.paymentNumber ? `, ${network.paymentNumber}` : ''}`}
      />
      {network.iconUrl ? (
        <img src={api.assetUrl(network.iconUrl)} alt="" className="networkRowLogo" />
      ) : (
        <span className="networkRowLogo networkRowLogoFallback">{network.name.charAt(0)}</span>
      )}
      <span className="networkRowBody">
        <span className="networkRowName">{network.name}</span>
        {network.paymentNumber && <span className="networkRowNumber">{network.paymentNumber}</span>}
      </span>
      {network.paymentNumber && <CopyNumber number={network.paymentNumber} />}
      <span className="networkRowCheck"><Check size={12} /></span>
    </label>
  );
}

function PaymentStep({ methods, cash, online, mode, setMode, network, networkId, setNetworkId, transportFeeTzs, totalTzs, codMessage }: {
  methods: api.PaymentMethod[] | null;
  cash: api.PaymentMethod | null;
  online: api.PaymentMethod[];
  mode: 'CASH' | 'ONLINE' | null;
  setMode: (m: 'CASH' | 'ONLINE') => void;
  network: api.PaymentMethod | null;
  networkId: string;
  setNetworkId: (id: string) => void;
  transportFeeTzs: number;
  totalTzs: number;
  codMessage: string | null;
}) {
  if (!methods) {
    return (
      <div className="pmSection">
        <p className="pmSectionTitle" style={{ marginTop: 0 }}>Payment method</p>
        <div className="payLoading">Loading payment options…</div>
      </div>
    );
  }
  if (methods.length === 0) {
    return (
      <div className="pmSection">
        <p className="pmSectionTitle" style={{ marginTop: 0 }}>Payment method</p>
        <div className="payEmpty">Online payment is currently unavailable. Please choose Cash on Delivery or try again later.</div>
      </div>
    );
  }

  const hasOnline = online.length > 0;
  const hasCash = !!cash;
  const effectiveCodMessage = codMessage?.trim() || 'Please pay the transport fee first using any of the payment numbers below. You will pay the remaining order amount after your parcel is delivered.';

  return (
    <>
      <div className="pmSection">
        <p className="pmSectionTitle">Payment method</p>
        <p className="pmSectionDesc">Select how you would like to complete your payment.</p>

        <div className="pmCards">
          {hasOnline && (
            <button
              type="button"
              data-role="pay-mode"
              data-mode="ONLINE"
              onClick={() => { setMode('ONLINE'); if (online.length > 0 && !networkId) setNetworkId(online[0].id); }}
              aria-pressed={mode === 'ONLINE'}
              className={'pmCard' + (mode === 'ONLINE' ? ' active' : '')}
            >
              <span className="pmCardIcon"><Smartphone size={19} /></span>
              <span className="pmCardBody">
                <span className="pmCardName">Online Pay</span>
                <span className="pmCardDesc">Pay the full total securely via mobile money</span>
              </span>
              <span className="pmCardIndicator"><Check size={13} className="pmCardCheck" /></span>
            </button>
          )}
          {hasCash && (
            <button
              type="button"
              data-role="pay-mode"
              data-mode="CASH"
              onClick={() => setMode('CASH')}
              aria-pressed={mode === 'CASH'}
              className={'pmCard' + (mode === 'CASH' ? ' active' : '')}
            >
              <span className="pmCardIcon"><Banknote size={19} /></span>
              <span className="pmCardBody">
                <span className="pmCardName">Cash on Delivery</span>
                <span className="pmCardDesc">Pay after your order is delivered</span>
              </span>
              <span className="pmCardIndicator"><Check size={13} className="pmCardCheck" /></span>
            </button>
          )}
        </div>
      </div>

      {mode === 'ONLINE' && hasOnline && (
        <div className="opSection" data-role="online-flow">
          <p className="opSectionLabel">Pay via mobile money</p>
          <div className="networkRows">
            {online.map((n) => (
              <NetworkRow key={n.id} network={n} groupName="online-network" selected={n.id === networkId} onSelect={() => setNetworkId(n.id)} />
            ))}
          </div>
          <p className="opPayNumHint">{network?.instructions || `Send ${formatTZS(totalTzs)} (your full order total) to your chosen number above.`}</p>
        </div>
      )}

      {mode === 'CASH' && hasCash && (
        <div className="codSection" data-role="cash-flow">
          <p className="codFeeNote">{effectiveCodMessage}</p>
          {transportFeeTzs > 0 && (
            <>
              <div className="codFeeBox">
                <span className="codFeeLabel">Transport fee (pay now)</span>
                <span className="codFeeAmount">{formatTZS(transportFeeTzs)}</span>
              </div>
              <p className="opSectionLabel">Pay transport fee via mobile money</p>
              <div className="networkRows">
                {online.map((n) => (
                  <NetworkRow key={n.id} network={n} groupName="cod-network" selected={n.id === networkId} onSelect={() => setNetworkId(n.id)} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

function CheckoutSummary({ items, subtotalCents, transportFeeTzs, totalTzs, locationChosen, couponInput, setCouponInput, appliedCoupon, couponError, couponChecking, onApplyCoupon, onRemoveCoupon }: {
  items: api.CartItem[];
  subtotalCents: number;
  transportFeeTzs: number;
  totalTzs: number;
  locationChosen: boolean;
  couponInput: string;
  setCouponInput: (v: string) => void;
  appliedCoupon: { code: string; discountCents: number } | null;
  couponError: string;
  couponChecking: boolean;
  onApplyCoupon: () => void;
  onRemoveCoupon: () => void;
}) {
  const [showItems, setShowItems] = useState(true);
  return (
    <div className="summary">
      <div className="summaryHead">
        <h3>Order summary</h3>
        {items.length > 0 && (
          <button
            type="button"
            className="summaryToggle"
            onClick={() => setShowItems((s) => !s)}
            aria-expanded={showItems}
            aria-controls="checkout-items"
          >
            {showItems ? 'Hide items' : `Show items (${items.length})`}
          </button>
        )}
      </div>
      {showItems && items.length > 0 && (
        <ul className="summaryItems" id="checkout-items">
          {items.map((item) => (
            <li key={item.id} className="summaryItem">
              <div className="summaryItemImg">
                {item.product?.image ? <img src={api.assetUrl(item.product.image)} alt="" /> : <div className="summaryItemImgFallback" />}
              </div>
              <div className="summaryItemInfo">
                <p className="summaryItemName">{item.product?.name ?? 'Product'}</p>
                <p className="summaryItemMeta">
                  {[item.variant?.size, item.variant?.color].filter(Boolean).join(' · ')}
                  {item.variant?.size || item.variant?.color ? ' · ' : ''}Qty {item.quantity}
                </p>
                {item.available === false && <p className="summaryItemWarn">No longer available — will be excluded from your order</p>}
              </div>
              <b className="summaryItemPrice">{formatTZS(item.lineTotalCents ?? 0)}</b>
            </li>
          ))}
        </ul>
      )}
      <div className="couponBox">
        {appliedCoupon ? (
          <div className="couponApplied">
            <span>
              <b>{appliedCoupon.code}</b> applied
            </span>
            <button type="button" onClick={onRemoveCoupon} className="couponRemoveBtn">Remove</button>
          </div>
        ) : (
          <div className="couponInputRow">
            <input
              type="text"
              value={couponInput}
              onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
              placeholder="Coupon code"
              aria-label="Coupon code"
              disabled={couponChecking}
            />
            <button type="button" onClick={onApplyCoupon} disabled={couponChecking || !couponInput.trim()} className="couponApplyBtn">
              {couponChecking ? 'Checking…' : 'Apply'}
            </button>
          </div>
        )}
        {couponError && <p className="couponError">{couponError}</p>}
      </div>
      <dl className="summaryTotals">
        <div><dt>Product subtotal</dt><dd>{formatTZS(subtotalCents)}</dd></div>
        {appliedCoupon && appliedCoupon.discountCents > 0 && (
          <div className="summaryDiscount"><dt>Discount ({appliedCoupon.code})</dt><dd>-{formatTZS(appliedCoupon.discountCents)}</dd></div>
        )}
        {locationChosen ? (
          <>
            <div><dt>Delivery fee</dt><dd>{formatTZS(transportFeeTzs)}</dd></div>
            <div className="summaryTotal"><dt>Total payable</dt><dd>{formatTZS(totalTzs)}</dd></div>
          </>
        ) : (
          <div className="summaryNote">
            Delivery fee is added once you choose a delivery location in the payment step.
          </div>
        )}
      </dl>
      <div className="secure"><Lock size={12} /> Secure checkout — SSL encrypted</div>
    </div>
  );
}

export default Checkout;