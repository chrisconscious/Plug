import { useState, useEffect } from 'react';
import * as api from '../../lib/api';

export function CouponManagement() {
  const [items, setItems] = useState<api.Coupon[] | null>(null);
  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'forbidden'>('loading');
  const [banner, setBanner] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);

  const [code, setCode] = useState('');
  const [discountType, setDiscountType] = useState<api.CouponDiscountType>('PERCENTAGE');
  const [discountValue, setDiscountValue] = useState('');
  const [minOrder, setMinOrder] = useState('');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [maxPerCustomer, setMaxPerCustomer] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => {
    setStatus('loading');
    api.listAdminCoupons()
      .then((r) => { setItems(r.coupons); setStatus('success'); })
      .catch((e) => setStatus(e instanceof api.ApiError && e.status === 403 ? 'forbidden' : 'error'));
  };
  useEffect(load, []);

  const showBanner = (text: string, tone: 'ok' | 'error') => {
    setBanner({ text, tone });
    setTimeout(() => setBanner(null), 4000);
  };

  const resetForm = () => {
    setCode(''); setDiscountValue(''); setMinOrder(''); setMaxRedemptions(''); setMaxPerCustomer(''); setStartsAt(''); setEndsAt('');
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!code.trim() || !discountValue.trim()) {
      showBanner('Enter a code and a discount value.', 'error');
      return;
    }
    setSaving(true);
    try {
      await api.createCoupon({
        code: code.trim(),
        discountType,
        discountValue: Number(discountValue),
        minOrderCents: minOrder.trim() ? Number(minOrder) : 0,
        maxRedemptions: maxRedemptions.trim() ? Number(maxRedemptions) : null,
        maxRedemptionsPerCustomer: maxPerCustomer.trim() ? Number(maxPerCustomer) : null,
        startsAt: startsAt || null,
        endsAt: endsAt || null,
      });
      resetForm();
      showBanner('Coupon created.', 'ok');
      load();
    } catch (e) {
      showBanner(e instanceof api.ApiError ? e.message : 'Could not create this coupon.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (c: api.Coupon) => {
    try {
      await api.updateCoupon(c.id, { active: !c.active });
      load();
    } catch (e) {
      showBanner(e instanceof api.ApiError ? e.message : 'Could not update this coupon.', 'error');
    }
  };

  const fieldStyle: React.CSSProperties = { padding: '9px 11px', border: '1px solid #d4d4d4', borderRadius: 6, fontSize: 13 };
  const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4, color: '#555' };

  const formatDiscount = (c: api.Coupon) => c.discountType === 'PERCENTAGE' ? `${c.discountValue}% off` : `TZS ${c.discountValue.toLocaleString('en-US')} off`;
  const formatLimit = (c: api.Coupon) => {
    const parts: string[] = [];
    if (c.minOrderCents > 0) parts.push(`min. order TZS ${c.minOrderCents.toLocaleString('en-US')}`);
    if (c.maxRedemptions !== null) parts.push(`max ${c.maxRedemptions} total uses`);
    if (c.maxRedemptionsPerCustomer !== null) parts.push(`max ${c.maxRedemptionsPerCustomer} per customer`);
    if (c.startsAt) parts.push(`from ${new Date(c.startsAt).toLocaleDateString()}`);
    if (c.endsAt) parts.push(`until ${new Date(c.endsAt).toLocaleDateString()}`);
    return parts.length ? parts.join(' · ') : 'No restrictions';
  };

  if (status === 'forbidden') {
    return (
      <div style={{ padding: 48, textAlign: 'center', border: '1px dashed #d1d5db', borderRadius: 12, color: '#71717a', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
        <p style={{ fontWeight: 700, color: '#374151', marginBottom: 6 }}>Requires Super Admin access</p>
        <p style={{ fontSize: 13 }}>Managing coupons is restricted to Super Admins, unless you've been individually granted this permission.</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 780, display: 'flex', flexDirection: 'column', gap: 24 }}>
      {banner && (
        <div style={{ padding: '10px 14px', borderRadius: 8, fontSize: 13, background: banner.tone === 'ok' ? '#f0fdf4' : '#fef2f2', color: banner.tone === 'ok' ? '#166534' : '#b91c1c', border: `1px solid ${banner.tone === 'ok' ? '#bbf7d0' : '#fecaca'}` }}>
          {banner.text}
        </div>
      )}

      <section style={{ border: '1px solid #e5e5e5', borderRadius: 10, padding: 20 }}>
        <h3 style={{ font: '800 15px Manrope', margin: '0 0 4px' }}>Create a Coupon</h3>
        <p style={{ fontSize: 12.5, color: '#71717a', margin: '0 0 16px' }}>
          Discounts are calculated and validated server-side at checkout — never trusted from the customer's browser.
        </p>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Code</label>
              <input value={code} onChange={(e) => setCode(e.target.value)} maxLength={32} placeholder="NEWSEASON20" style={{ ...fieldStyle, width: '100%', textTransform: 'uppercase' }} />
            </div>
            <div>
              <label style={labelStyle}>Discount type</label>
              <select value={discountType} onChange={(e) => setDiscountType(e.target.value as api.CouponDiscountType)} style={{ ...fieldStyle, width: '100%' }}>
                <option value="PERCENTAGE">Percentage (%)</option>
                <option value="FIXED">Fixed amount (TZS)</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>{discountType === 'PERCENTAGE' ? 'Percentage off' : 'Amount off (TZS)'}</label>
              <input type="number" min={1} max={discountType === 'PERCENTAGE' ? 100 : undefined} value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} placeholder={discountType === 'PERCENTAGE' ? '20' : '5000'} style={{ ...fieldStyle, width: '100%' }} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Minimum order (TZS) <small style={{ fontWeight: 400, color: '#999' }}>optional</small></label>
              <input type="number" min={0} value={minOrder} onChange={(e) => setMinOrder(e.target.value)} placeholder="0" style={{ ...fieldStyle, width: '100%' }} />
            </div>
            <div>
              <label style={labelStyle}>Total use limit <small style={{ fontWeight: 400, color: '#999' }}>optional</small></label>
              <input type="number" min={1} value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)} placeholder="Unlimited" style={{ ...fieldStyle, width: '100%' }} />
            </div>
            <div>
              <label style={labelStyle}>Uses per customer <small style={{ fontWeight: 400, color: '#999' }}>optional</small></label>
              <input type="number" min={1} value={maxPerCustomer} onChange={(e) => setMaxPerCustomer(e.target.value)} placeholder="Unlimited" style={{ ...fieldStyle, width: '100%' }} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Starts <small style={{ fontWeight: 400, color: '#999' }}>optional</small></label>
              <input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} style={{ ...fieldStyle, width: '100%' }} />
            </div>
            <div>
              <label style={labelStyle}>Ends <small style={{ fontWeight: 400, color: '#999' }}>optional</small></label>
              <input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} style={{ ...fieldStyle, width: '100%' }} />
            </div>
          </div>
          <button type="submit" className="blackButton" disabled={saving} style={{ alignSelf: 'flex-start' }}>
            {saving ? 'Creating…' : 'CREATE COUPON'}
          </button>
        </form>
      </section>

      <section style={{ border: '1px solid #e5e5e5', borderRadius: 10, padding: 20 }}>
        <h3 style={{ font: '800 15px Manrope', margin: '0 0 14px' }}>All Coupons</h3>
        {status === 'loading' ? (
          <div style={{ color: '#71717a', fontSize: 13 }}>Loading…</div>
        ) : status === 'error' ? (
          <div>
            <p style={{ color: '#c00', marginBottom: 10, fontSize: 13 }}>Couldn't load coupons.</p>
            <button type="button" className="blackButton" onClick={load}>RETRY</button>
          </div>
        ) : !items || items.length === 0 ? (
          <p style={{ fontSize: 13, color: '#888' }}>No coupons created yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((c) => (
              <div key={c.id} style={{ border: '1px solid #ece9e2', borderRadius: 8, padding: '12px 14px', opacity: c.active ? 1 : 0.55 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <b style={{ fontSize: 13, fontFamily: 'monospace', letterSpacing: '.03em' }}>{c.code}</b>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#166534' }}>{formatDiscount(c)}</span>
                </div>
                <p style={{ fontSize: 11.5, color: '#888', margin: '0 0 8px' }}>{formatLimit(c)}</p>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, color: '#999' }}>Created {new Date(c.createdAt).toLocaleDateString()}</span>
                  <button type="button" onClick={() => toggleActive(c)} style={{ fontSize: 11, fontWeight: 700, background: 'none', border: 'none', color: c.active ? '#b91c1c' : '#166534', cursor: 'pointer' }}>
                    {c.active ? 'DEACTIVATE' : 'ACTIVATE'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
