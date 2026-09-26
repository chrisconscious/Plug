import { lazy, Suspense } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { Menu, Search, Bell } from 'lucide-react';
import { superItems, adminItems } from '../lib/adminNav';
import { BrandLogo } from '../components/BrandLogo';

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

function Backoffice() {
  const loc = useLocation(); const superRole = loc.pathname.startsWith('/super-admin'); const items = superRole ? superItems : adminItems; const current = items.find((x) => x.path === loc.pathname) || items[0];
  return (
    <div className="backoffice">
      <aside className="adminSidebar">
        <Link to="/" className="adminLogo"><BrandLogo maxHeight={18} /> <small>{superRole ? 'SUPER ADMIN' : 'ADMIN'}</small></Link>
        <div className="navSection">{items.map((it) => { const I = it.icon; return <Link className={it.path === current.path ? 'active' : ''} to={it.path} key={it.path}><I size={17} /><span>{it.label.replace(' Management', '').replace(' & Customer', '')}</span></Link>; })}</div>
        <Link className="visitStore" to="/">↗ Visit Store</Link>
      </aside>
      <main className="adminMain">
        <header className="adminHeader"><button><Menu /></button><div><Search /><Bell /><div className="avatar">A</div><span>{superRole ? 'Super Admin' : 'Admin'}</span></div></header>
        <Suspense
          fallback={
            <div style={{ padding: 40, color: '#71717a', fontFamily: 'ui-sans-serif, system-ui, sans-serif', fontSize: 13 }}>
              Loading {current.label}…
            </div>
          }
        >
          <PageContent current={current} superRole={superRole} />
        </Suspense>
      </main>
    </div>
  );
}

function PageContent({ current, superRole }: { current: any; superRole: boolean }) {
  const isDash = current.label.includes('Dashboard'); const title = current.label;
  return (
    <>
      <div className="adminIntro">
        <div><div className="eyebrow">{superRole ? 'PLATFORM CONTROL' : 'STORE OPERATIONS'}</div><h1>{title}</h1><p>{current.desc}</p></div>
        {isDash && (
          <div className="adminActions">
            <Link to={superRole ? '/super-admin/reports' : '/admin/reports'} className="blackButton">View Analytics</Link>
          </div>
        )}
      </div>
      {isDash ? <DynamicDashboard superRole={superRole} /> : title.includes('Branding') ? <PlatformBrandingSettings /> : title.includes('Attributes') ? <AttributeManagement /> : title.includes('Announcements') ? <AnnouncementManagement /> : title.includes('Footer') ? <FooterContactManagement /> : title.includes('Notifications') ? <NotificationBroadcastManagement /> : title.includes('Coupon') ? <CouponManagement /> : title.includes('Promo') ? <PromoBannerManagement /> : title.includes('Accordion') ? <ProductAccordionManagement /> : title.includes('Auth Page') ? <AuthPageSettingsManagement /> : title.includes('Roles') ? <RolesPermissions /> : title.includes('Inventory') ? <InventoryManagement /> : <FunctionalManagementPage key={current.path} title={title} desc={current.desc} withHeroOverride={title.includes('Content')} withPaymentsOverride={title.includes('Payment')} withLifestylesOverride={title.includes('Lifestyle')} withMfaOverride={title.includes('Account Settings') || title.includes('Account & Security')} superRole={superRole} />}
    </>
  );
}

export default Backoffice;
