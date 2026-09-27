import { lazy, Suspense, useEffect, useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { Menu, X, LogOut } from 'lucide-react';
import { superItems, adminItems, ADMIN_NAV_PERMISSION, type NavItem } from '../lib/adminNav';
import { BrandLogo } from '../components/BrandLogo';
import { NotificationBell } from '../components/NotificationBell';
import { useAuth } from '../lib/AuthContext';
import * as api from '../lib/api';

// Admin/backoffice screens are lazy-loaded so their (substantial) code stays in
// a separate chunk that only downloads when an admin route is actually visited —
// never shipped to storefront customers (reduces the customer bundle).
const DynamicDashboard = lazy(() =>
  import('../components/admin/admin-dashboard').then((m) => ({ default: m.DynamicDashboard }))
);
const FunctionalManagementPage = lazy(() =>
  import('../components/admin/admin-pages').then((m) => ({ default: m.FunctionalManagementPage }))
);
const PlatformBrandingSettings = lazy(() =>
  import('../components/admin/platform-branding').then((m) => ({ default: m.PlatformBrandingSettings }))
);
const AttributeManagement = lazy(() =>
  import('../components/admin/attribute-management').then((m) => ({ default: m.AttributeManagement }))
);
const AnnouncementManagement = lazy(() =>
  import('../components/admin/announcement-management').then((m) => ({ default: m.AnnouncementManagement }))
);
const FooterContactManagement = lazy(() =>
  import('../components/admin/footer-contact-management').then((m) => ({ default: m.FooterContactManagement }))
);
const NotificationBroadcastManagement = lazy(() =>
  import('../components/admin/notification-broadcast-management').then((m) => ({ default: m.NotificationBroadcastManagement }))
);
const CouponManagement = lazy(() =>
  import('../components/admin/coupon-management').then((m) => ({ default: m.CouponManagement }))
);
const PromoBannerManagement = lazy(() =>
  import('../components/admin/promo-banner-management').then((m) => ({ default: m.PromoBannerManagement }))
);
const InventoryManagement = lazy(() =>
  import('../components/admin/inventory-management').then((m) => ({ default: m.InventoryManagement }))
);
const ProductAccordionManagement = lazy(() =>
  import('../components/admin/product-accordion-management').then((m) => ({ default: m.ProductAccordionManagement }))
);
const AuthPageSettingsManagement = lazy(() =>
  import('../components/admin/auth-page-settings-management').then((m) => ({ default: m.AuthPageSettingsManagement }))
);
const RolesPermissions = lazy(() =>
  import('../components/admin/roles-permissions').then((m) => ({ default: m.RolesPermissionsPage }))
);
const ReportsPage = lazy(() =>
  import('../components/admin/reports').then((m) => ({ default: m.ReportsPage }))
);

const NAV_SHORT_LABELS: Record<string, string> = {
  'Admin Management': 'Admins',
  'User & Customer Management': 'Users & Customers',
  'Product Management': 'Products',
  'Categories & Brands Management': 'Categories & Brands',
  'Orders Management': 'Orders',
  'Content / Homepage Management': 'Content / Homepage',
  'Lifestyle Management': 'Lifestyles',
  'Footer Management': 'Footer',
};
/** Sidebar label: the page title, shortened where it carries "Management". */
function navLabel(label: string): string {
  return NAV_SHORT_LABELS[label] ?? label;
}

function Backoffice() {
  const loc = useLocation();
  const nav = useNavigate();
  const { user, logout } = useAuth();
  const superRole = loc.pathname.startsWith('/super-admin');
  const allItems = superRole ? superItems : adminItems;
  // An Admin's effective permissions (role + grants) decide which screens
  // they're shown; null while loading so the menu doesn't flicker.
  const [perms, setPerms] = useState<string[] | null>(superRole ? [] : null);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (superRole) return;
    let on = true;
    api.getMyPermissions().then((p) => on && setPerms(p)).catch(() => on && setPerms([]));
    return () => { on = false; };
  }, [superRole]);
  useEffect(() => { setMenuOpen(false); }, [loc.pathname]);

  const allowed = (it: NavItem) => superRole || !ADMIN_NAV_PERMISSION[it.path] || (perms ?? []).includes(ADMIN_NAV_PERMISSION[it.path]);
  const items = perms === null ? allItems.filter((it) => !ADMIN_NAV_PERMISSION[it.path]) : allItems.filter(allowed);
  const current = allItems.find((x) => x.path === loc.pathname) || allItems[0];
  const permitted = perms === null ? null : allowed(current);
  const who = user?.fullName || user?.email || user?.phoneNumber || (superRole ? 'Super Admin' : 'Admin');

  const signOut = async () => {
    try { await logout(); } finally { nav('/login', { replace: true }); }
  };

  return (
    <div className="backoffice">
      <aside className={`adminSidebar${menuOpen ? ' open' : ''}`}>
        <Link to="/" className="adminLogo"><BrandLogo maxHeight={18} /> <small>{superRole ? 'SUPER ADMIN' : 'ADMIN'}</small></Link>
        <nav className="navSection" aria-label="Admin sections">{items.map((it) => { const I = it.icon; return <Link className={it.path === current.path ? 'active' : ''} to={it.path} key={it.path} aria-current={it.path === current.path ? 'page' : undefined}><I size={17} /><span>{navLabel(it.label)}</span></Link>; })}</nav>
        <Link className="visitStore" to="/">↗ Visit Store</Link>
      </aside>
      <main className="adminMain">
        <header className="adminHeader">
          <button type="button" className="adminMenuBtn" aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>{menuOpen ? <X /> : <Menu />}</button>
          <div>
            <NotificationBell alwaysVisible />
            <div className="avatar" aria-hidden="true">{who.trim().charAt(0).toUpperCase()}</div>
            <span title={user?.email ?? undefined}>{who}<br /><small style={{ color: '#888' }}>{superRole ? 'Super Admin' : 'Admin'}</small></span>
            <button type="button" onClick={signOut} aria-label="Sign out" title="Sign out" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11 }}><LogOut size={15} /> Sign out</button>
          </div>
        </header>
        <Suspense
          fallback={
            <div style={{ padding: 40, color: '#71717a', fontFamily: 'ui-sans-serif, system-ui, sans-serif', fontSize: 13 }}>
              Loading {current.label}…
            </div>
          }
        >
          {permitted === false ? (
            <div style={{ padding: '48px 35px' }} data-role="no-permission">
              <h1 style={{ font: '800 20px Manrope', margin: '0 0 8px' }}>{current.label}</h1>
              <p style={{ fontSize: 13, color: '#666' }}>Your admin account doesn't have access to this section. A Super Admin can grant it in Admin Management.</p>
            </div>
          ) : permitted === null ? null : (
            <PageContent current={current} superRole={superRole} />
          )}
        </Suspense>
      </main>
    </div>
  );
}

function PageContent({ current, superRole }: { current: NavItem; superRole: boolean }) {
  const isDash = current.label.includes('Dashboard'); const title = current.label;
  return (
    <>
      <div className="adminIntro">
        <div><div className="eyebrow">{superRole ? 'PLATFORM CONTROL' : 'STORE OPERATIONS'}</div><h1>{title}</h1><p>{current.desc}</p></div>
        {isDash && (
          <div className="adminActions">
            <Link to={superRole ? '/super-admin/reports' : '/admin/reports'} className="blackButton">View Reports</Link>
          </div>
        )}
      </div>
      {isDash ? <DynamicDashboard superRole={superRole} /> : title.includes('Branding') ? <PlatformBrandingSettings /> : title.includes('Attributes') ? <AttributeManagement /> : title.includes('Announcements') ? <AnnouncementManagement /> : title.includes('Footer') ? <FooterContactManagement /> : title.includes('Notifications') ? <NotificationBroadcastManagement /> : title.includes('Coupon') ? <CouponManagement /> : title.includes('Promo') ? <PromoBannerManagement /> : title.includes('Accordion') ? <ProductAccordionManagement /> : title.includes('Auth Page') ? <AuthPageSettingsManagement /> : title.includes('Roles') ? <RolesPermissions /> : title.includes('Inventory') ? <InventoryManagement /> : title.includes('Reports') ? <ReportsPage inventoryPath={superRole ? '/super-admin/inventory' : '/admin/inventory'} productsPath={superRole ? '/super-admin/products' : '/admin/products'} /> : <FunctionalManagementPage key={current.path} title={title} desc={current.desc} withHeroOverride={title.includes('Content')} withPaymentsOverride={title.includes('Payment')} withLifestylesOverride={title.includes('Lifestyle')} withMfaOverride={title.includes('Account Settings') || title.includes('Account & Security')} superRole={superRole} />}
    </>
  );
}

export default Backoffice;
