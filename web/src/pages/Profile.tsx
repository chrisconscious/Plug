import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Package, Heart, User as UserIcon, MapPin, ShieldCheck, MessageCircle, Phone, LogOut, Plus, X, Check } from 'lucide-react';
import * as api from '../lib/api';
import { StoreHeader } from '../components/shop/StoreHeader';
import { useAuth } from '../lib/AuthContext';
import { formatTZS } from '../lib/currency';
import { PLACEHOLDER_IMG, resolveImage } from '../lib/imagePlaceholder';
import { getProductUrl } from '../lib/links';
import { findContact, useContactLinks } from '../lib/contactLinks';
import { loginUrl, currentLocation } from '../lib/returnTo';
import { orderRef, orderStatusLabel } from '../lib/orderStatus';
import { userMessage } from '../lib/errors';
import { isStrongPassword } from '../lib/password';
import { PasswordChecklist } from '../components/PasswordChecklist';

/** A section's data: still loading (null), loaded, or failed — a failure is never shown as "empty". */
type Loaded<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error' };

function SectionError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div className="accEmpty" role="alert">
      <p>We couldn't load your {what} right now.</p>
      <button type="button" className="outlineButton" onClick={onRetry}>TRY AGAIN</button>
    </div>
  );
}

const COUNTRY_NAMES: Record<string, string> = { TZ: 'Tanzania' };

function initials(name: string | null, phone: string | null): string {
  if (name?.trim()) {
    const parts = name.trim().split(/\s+/);
    return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || name[0].toUpperCase();
  }
  if (phone) return phone.replace(/\D/g, '').slice(-2);
  return '?';
}

function Profile() {
  const { status, user, refresh, logout } = useAuth();
  const nav = useNavigate();

  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const resend = async () => {
    setResendState('sending');
    try { await api.resendVerification(); setResendState('sent'); }
    catch { setResendState('error'); }
  };

  const [orders, setOrders] = useState<Loaded<api.Order[]>>({ status: 'loading' });
  const [wishlist, setWishlist] = useState<Loaded<api.WishlistEntry[]>>({ status: 'loading' });
  const [signingOut, setSigningOut] = useState(false);
  const { links: contactLinks } = useContactLinks();
  const userId = user?.id;

  const loadOrders = () => {
    setOrders({ status: 'loading' });
    api.listOrders().then((r) => setOrders({ status: 'ready', data: r.orders })).catch(() => setOrders({ status: 'error' }));
  };
  const loadWishlist = () => {
    setWishlist({ status: 'loading' });
    api.listWishlist().then((r) => setWishlist({ status: 'ready', data: r.wishlist })).catch(() => setWishlist({ status: 'error' }));
  };
  useEffect(() => {
    if (!userId) return;
    loadOrders();
    loadWishlist();
  }, [userId]);

  const whatsappHref = findContact(contactLinks, 'whatsapp')?.href ?? null;
  const phoneHref = findContact(contactLinks, 'phone')?.href ?? null;
  const signOut = async () => {
    setSigningOut(true);
    try { await logout(); } finally { nav('/', { replace: true }); }
  };

  if (status === 'loading') {
    return (
      <div>
        <StoreHeader />
        <main className="accountPage">
          <div className="accountSkeleton" aria-hidden="true">
            <div className="accSkelBlock" style={{ width: 220, height: 30 }} />
            <div className="accSkelBlock" style={{ width: 320, height: 16, marginTop: 10 }} />
            <div className="accQuickGrid" style={{ marginTop: 28 }}>
              {[0, 1, 2, 3].map((i) => <div key={i} className="accSkelBlock" style={{ height: 88 }} />)}
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div>
        <StoreHeader />
        <main className="accountPage">
          <p style={{ color: '#c00', marginBottom: 12 }}>Couldn't check your session right now.</p>
          <button type="button" className="blackButton" onClick={() => refresh()}>RETRY</button>
        </main>
      </div>
    );
  }

  if (!user) {
    return (
      <div>
        <StoreHeader />
        <main className="accountPage">
          <p>Please <Link to={loginUrl(currentLocation())}>sign in</Link> to view your account.</p>
        </main>
      </div>
    );
  }

  return (
    <div>
      <StoreHeader />
      <main className="accountPage">
        <div className="accHeader">
          <div className="accAvatar">{initials(user.fullName, user.phoneNumber)}</div>
          <div>
            <p className="accEyebrow">ACCOUNT</p>
            <h1>Welcome back{user.fullName ? `, ${user.fullName.split(' ')[0]}` : ''}</h1>
            <p className="accSub">Manage your orders, profile and preferences.</p>
          </div>
        </div>

        {user.email && !user.emailVerified && (
          <div className="accNotice">
            <p>Your email isn't verified yet. Verify it to be able to place orders.</p>
            {resendState === 'sent' ? (
              <p className="accNoticeOk">Verification email sent — check your inbox.</p>
            ) : (
              <button type="button" className="blackButton" disabled={resendState === 'sending'} onClick={resend}>
                {resendState === 'sending' ? 'Sending…' : 'Resend verification email'}
              </button>
            )}
            {resendState === 'error' && <p className="accNoticeErr">Couldn't send it — please try again shortly.</p>}
          </div>
        )}

        <nav className="accQuickGrid" aria-label="Account sections">
          <a href="#acc-orders" className="accQuickCard"><Package size={18} /><span>My Orders</span><small>Track purchases and view history</small></a>
          <a href="#acc-wishlist" className="accQuickCard"><Heart size={18} /><span>Wishlist</span><small>Products saved for later</small></a>
          <a href="#acc-info" className="accQuickCard"><UserIcon size={18} /><span>Personal Information</span><small>Name, email and phone</small></a>
          <a href="#acc-addresses" className="accQuickCard"><MapPin size={18} /><span>Addresses</span><small>Manage delivery addresses</small></a>
        </nav>

        <OrdersSection orders={orders} onRetry={loadOrders} />
        <WishlistSection wishlist={wishlist} onRetry={loadWishlist} />
        <PersonalInfoSection user={user} onSaved={refresh} />
        <AddressesSection />

        <section id="acc-security" className="accSection">
          <h2><ShieldCheck size={16} /> Account Security</h2>
          <SecurityForm />
        </section>

        {(whatsappHref || phoneHref) && (
          <section className="accSection accHelp">
            <h2>Need Help?</h2>
            <p className="accHelpSub">We're here to help.</p>
            <div className="accHelpActions">
              {whatsappHref && (
                <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className="outlineButton accHelpBtn">
                  <MessageCircle size={16} /> WhatsApp
                </a>
              )}
              {phoneHref && (
                <a href={phoneHref} className="outlineButton accHelpBtn">
                  <Phone size={16} /> Call Us
                </a>
              )}
            </div>
          </section>
        )}

        <button type="button" className="accLogout" disabled={signingOut} onClick={signOut}>
          <LogOut size={15} /> {signingOut ? 'Signing out…' : 'Sign Out'}
        </button>
      </main>
    </div>
  );
}

function OrdersSection({ orders: state, onRetry }: { orders: Loaded<api.Order[]>; onRetry: () => void }) {
  const orders = state.status === 'ready' ? state.data : null;
  return (
    <section id="acc-orders" className="accSection">
      <div className="accSectionHead">
        <h2><Package size={16} /> My Orders</h2>
        {orders && orders.length > 0 && <Link to="/orders" className="accViewAll">VIEW ALL ORDERS</Link>}
      </div>
      {state.status === 'error' ? (
        <SectionError what="orders" onRetry={onRetry} />
      ) : orders === null ? (
        <div className="accSkelBlock" style={{ height: 70 }} />
      ) : orders.length === 0 ? (
        <div className="accEmpty">
          <p>You haven't placed an order yet.</p>
          <Link to="/shop" className="blackButton">START SHOPPING</Link>
        </div>
      ) : (
        <div className="accOrderList">
          {orders.slice(0, 3).map((o) => (
            <Link key={o.id} to={`/orders/${o.id}`} className="accOrderRow">
              <div className="accOrderThumb" aria-hidden="true" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8a8a8a' }}>
                <Package size={22} />
              </div>
              <div className="accOrderInfo">
                <b>Order {orderRef(o.id)}</b>
                <span>{new Date(o.createdAt).toLocaleDateString()} · {o.items.length} item{o.items.length === 1 ? '' : 's'}</span>
              </div>
              <span className={`accOrderStatus accOrderStatus--${o.status.toLowerCase()}`}>{orderStatusLabel(o.status)}</span>
              <b className="accOrderTotal">{formatTZS(o.totalTzs ?? o.totalCents)}</b>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function WishlistSection({ wishlist: state, onRetry }: { wishlist: Loaded<api.WishlistEntry[]>; onRetry: () => void }) {
  const wishlist = state.status === 'ready' ? state.data : null;
  return (
    <section id="acc-wishlist" className="accSection">
      <div className="accSectionHead">
        <h2><Heart size={16} /> Wishlist</h2>
        {wishlist && wishlist.length > 0 && <Link to="/wishlist" className="accViewAll">VIEW ALL</Link>}
      </div>
      {state.status === 'error' ? (
        <SectionError what="wishlist" onRetry={onRetry} />
      ) : wishlist === null ? (
        <div className="accSkelBlock" style={{ height: 70 }} />
      ) : wishlist.length === 0 ? (
        <div className="accEmpty">
          <p>Your wishlist is waiting for something special.</p>
          <Link to="/shop" className="blackButton">EXPLORE PRODUCTS</Link>
        </div>
      ) : (
        <div className="accWishGrid">
          {wishlist.slice(0, 4).map((w) => (
            <Link key={w.id} to={getProductUrl(w.product.slug)} className="accWishCard">
              <div className="accWishImg">
                <img src={w.product.images[0]?.url ? resolveImage(w.product.images[0].url) : PLACEHOLDER_IMG} alt={w.product.name} />
              </div>
              <p className="accWishName">{w.product.name}</p>
              {w.product.brand?.name && <p className="accWishBrand">{w.product.brand.name}</p>}
              <b className="accWishPrice">{formatTZS(w.product.priceCents)}</b>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function PersonalInfoSection({ user, onSaved }: { user: api.PublicUser; onSaved: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(user.fullName ?? '');
  const [phoneNumber, setPhoneNumber] = useState(user.phoneNumber ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const startEdit = () => {
    setFullName(user.fullName ?? '');
    setPhoneNumber(user.phoneNumber ?? '');
    setError('');
    setSaved(false);
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const patch: { fullName?: string; phoneNumber?: string } = {};
      if (fullName.trim() !== (user.fullName ?? '')) patch.fullName = fullName.trim();
      if (phoneNumber.trim() !== (user.phoneNumber ?? '')) patch.phoneNumber = phoneNumber.trim();
      if (Object.keys(patch).length > 0) await api.updateMyProfile(patch);
      await onSaved();
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(userMessage(e, 'Could not save your changes.', { fullName: 'Name', phoneNumber: 'Phone number' }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section id="acc-info" className="accSection">
      <div className="accSectionHead">
        <h2><UserIcon size={16} /> Personal Information</h2>
        {!editing && <button type="button" className="accLinkBtn" onClick={startEdit}>EDIT</button>}
      </div>
      {saved && <p className="accNoticeOk" style={{ marginBottom: 10 }}>Your information was updated.</p>}
      {editing ? (
        <div className="accForm">
          <label>Full name<input value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={120} /></label>
          <label>Phone number<input value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="0756825667" /></label>
          {user.email && <label>Email<input value={user.email} disabled title="Email can't be changed here yet" /></label>}
          {error && <p className="accNoticeErr">{error}</p>}
          <div className="accFormActions">
            <button type="button" className="blackButton" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'SAVE'}</button>
            <button type="button" className="accLinkBtn" disabled={saving} onClick={() => setEditing(false)}>CANCEL</button>
          </div>
        </div>
      ) : (
        <div className="accInfoRows">
          {user.fullName && <div><span>Name</span><b>{user.fullName}</b></div>}
          {user.phoneNumber && <div><span>Phone Number</span><b>{user.phoneNumber}</b></div>}
          {user.email && <div><span>Email</span><b>{user.email}</b></div>}
          <div><span>Member since</span><b>{new Date(user.createdAt).toLocaleDateString()}</b></div>
        </div>
      )}
    </section>
  );
}

function AddressesSection() {
  const [addresses, setAddresses] = useState<api.Address[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = () => {
    setLoadFailed(false);
    api.listAddresses().then((r) => setAddresses(r.addresses)).catch(() => setLoadFailed(true));
  };
  useEffect(load, []);

  const remove = async (id: string) => {
    if (!window.confirm('Remove this address?')) return;
    setError('');
    try { await api.deleteAddress(id); load(); } catch (e) { setError(userMessage(e, 'Could not remove this address.')); }
  };
  const makeDefault = async (id: string) => {
    setError('');
    try { await api.setDefaultAddress(id); load(); } catch (e) { setError(userMessage(e, 'Could not set this as default.')); }
  };

  return (
    <section id="acc-addresses" className="accSection">
      <div className="accSectionHead">
        <h2><MapPin size={16} /> Delivery Addresses</h2>
        {!adding && <button type="button" className="accLinkBtn" onClick={() => setAdding(true)}><Plus size={13} /> ADD ADDRESS</button>}
      </div>
      {error && <p className="accNoticeErr">{error}</p>}
      {loadFailed && addresses === null ? (
        <SectionError what="addresses" onRetry={load} />
      ) : addresses === null ? (
        <div className="accSkelBlock" style={{ height: 70 }} />
      ) : addresses.length === 0 && !adding ? (
        <div className="accEmpty">
          <p>Add an address to make checkout faster.</p>
          <button type="button" className="blackButton" onClick={() => setAdding(true)}>ADD ADDRESS</button>
        </div>
      ) : (
        <div className="accAddressList">
          {addresses.map((a) => (
            editingId === a.id ? (
              <AddressForm key={a.id} initial={a} onDone={() => { setEditingId(null); load(); }} onCancel={() => setEditingId(null)} />
            ) : (
              <div key={a.id} className="accAddressCard">
                <div className="accAddressCardHead">
                  <b>{a.label.toUpperCase()}</b>
                  {a.isDefault && <span className="accDefaultBadge">DEFAULT</span>}
                </div>
                <p>{a.line1}{a.line2 ? `, ${a.line2}` : ''}</p>
                <p>{a.city}, {a.region}{a.postalCode ? ` ${a.postalCode}` : ''}</p>
                <p>{COUNTRY_NAMES[a.country] ?? a.country}</p>
                {a.phone && <p>{a.phone}</p>}
                <div className="accAddressActions">
                  <button type="button" className="accLinkBtn" onClick={() => setEditingId(a.id)}>EDIT</button>
                  {!a.isDefault && <button type="button" className="accLinkBtn" onClick={() => makeDefault(a.id)}>SET DEFAULT</button>}
                  <button type="button" className="accLinkBtn accLinkBtnDanger" onClick={() => remove(a.id)}>REMOVE</button>
                </div>
              </div>
            )
          ))}
        </div>
      )}
      {adding && <AddressForm onDone={() => { setAdding(false); load(); }} onCancel={() => setAdding(false)} />}
    </section>
  );
}

function AddressForm({ initial, onDone, onCancel }: { initial?: api.Address; onDone: () => void; onCancel: () => void }) {
  const [label, setLabel] = useState(initial?.label ?? 'Home');
  const [line1, setLine1] = useState(initial?.line1 ?? '');
  const [city, setCity] = useState(initial?.city ?? '');
  const [region, setRegion] = useState(initial?.region ?? '');
  const [postalCode, setPostalCode] = useState(initial?.postalCode ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  // Deliveries are within Tanzania — the same country code checkout saves.
  const country = initial?.country && initial.country !== 'Tanzania' ? initial.country : 'TZ';
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    const missing = [!label.trim() && 'label', !line1.trim() && 'address', !city.trim() && 'city', !region.trim() && 'region', !postalCode.trim() && 'postal code / house number'].filter(Boolean);
    if (missing.length) { setError(`Please fill in the ${missing.join(', ')}.`); return; }
    setSaving(true);
    setError('');
    try {
      const body = { label: label.trim(), line1: line1.trim(), city: city.trim(), region: region.trim(), postalCode: postalCode.trim(), country, phone: phone.trim() || undefined };
      if (initial) await api.updateAddress(initial.id, body);
      else await api.createAddress(body);
      onDone();
    } catch (e) {
      setError(userMessage(e, 'Could not save this address.', { label: 'Label', line1: 'Address', city: 'City', region: 'Region', postalCode: 'Postal code', phone: 'Phone' }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="accAddressCard accAddressForm">
      <div className="accForm">
        <label>Label<input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Home, Office…" /></label>
        <label>Address<input value={line1} onChange={(e) => setLine1(e.target.value)} placeholder="Street, house number" /></label>
        <label>City<input value={city} onChange={(e) => setCity(e.target.value)} /></label>
        <label>Region<input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="e.g. Dar es Salaam" autoComplete="address-level1" /></label>
        <label>Postal code / House number<input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} autoComplete="postal-code" /></label>
        <label>Phone<input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0756825667" /></label>
        {error && <p className="accNoticeErr">{error}</p>}
        <div className="accFormActions">
          <button type="button" className="blackButton" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'SAVE'}</button>
          <button type="button" className="accLinkBtn" disabled={saving} onClick={onCancel}>CANCEL</button>
        </div>
      </div>
    </div>
  );
}

function SecurityForm() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setError('');
    setSuccess(false);
    if (!currentPassword || !newPassword) { setError('Enter your current and new password.'); return; }
    if (!isStrongPassword(newPassword)) { setError("Your new password doesn't meet all the requirements yet."); return; }
    if (newPassword !== confirmPassword) { setError("The new passwords don't match."); return; }
    if (newPassword === currentPassword) { setError('Choose a new password that is different from your current one.'); return; }
    setSaving(true);
    try {
      await api.changeMyPassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSuccess(true);
      setTimeout(() => setSuccess(false), 6000);
    } catch (e) {
      setError(userMessage(e, 'Could not change your password.', { currentPassword: 'Current password', newPassword: 'New password' }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="accForm" onSubmit={save}>
      <label>Current password<input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" /></label>
      <label>New password<input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" aria-describedby="acc-password-rules" /></label>
      <PasswordChecklist id="acc-password-rules" password={newPassword} />
      <label>Confirm new password<input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" /></label>
      {success && <p className="accNoticeOk" role="status"><Check size={13} /> Password changed. Any other devices signed in to your account have been signed out.</p>}
      {error && <p className="accNoticeErr" role="alert"><X size={13} /> {error}</p>}
      <div className="accFormActions">
        <button type="submit" className="blackButton" disabled={saving}>{saving ? 'Saving…' : 'CHANGE PASSWORD'}</button>
      </div>
    </form>
  );
}

export default Profile;
