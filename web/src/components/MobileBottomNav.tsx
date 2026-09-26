import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, Heart, ShoppingBag, User } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { getWishlist, onWishlistChange } from '../lib/wishlist';
import { getCartCount, onCartCountChange, refreshCartCount } from '../lib/cartCount';
import { loginUrl } from '../lib/returnTo';

/**
 * Fixed bottom navigation for smartphones — Home / Wishlist / Cart /
 * Account, per the mobile-nav redesign brief. Desktop/tablet continue
 * using the existing top header/StoreHeader nav unchanged; this bar is
 * hidden above the mobile breakpoint via CSS (.mobileBottomNav's media
 * query in index.css), not by conditionally rendering in JS, so there's
 * no layout flash while JS hydrates.
 *
 * Badge counts come from the SAME reactive modules the rest of the app
 * already uses (wishlist.ts, cartCount.ts) — this bar does not run its
 * own independent fetch of either, per the third-party/API audit's own
 * emphasis on not duplicating requests for data another part of the app
 * already tracks.
 */
export function MobileBottomNav() {
  const location = useLocation();
  const { status } = useAuth();
  const [wishlistCount, setWishlistCount] = useState(() => getWishlist().length);
  const [cartCount, setCartCount] = useState(() => getCartCount());

  useEffect(() => onWishlistChange(() => setWishlistCount(getWishlist().length)), []);
  useEffect(() => onCartCountChange(() => setCartCount(getCartCount())), []);

  useEffect(() => {
    if (status === 'authenticated') refreshCartCount();
  }, [status]);

  // Storefront-only pattern — the admin/Super Admin dashboard has its own
  // dedicated layout and should not show a customer shopping nav.
  if (location.pathname.startsWith('/admin') || location.pathname.startsWith('/super-admin')) {
    return null;
  }

  const isActive = (path: string) => (path === '/' ? location.pathname === '/' : location.pathname.startsWith(path));

  const items: { path: string; label: string; icon: typeof Home; badge?: number }[] = [
    { path: '/', label: 'Home', icon: Home },
    { path: '/wishlist', label: 'Wishlist', icon: Heart, badge: wishlistCount },
    { path: '/cart', label: 'Cart', icon: ShoppingBag, badge: cartCount },
    { path: status === 'authenticated' ? '/profile' : '/login', label: 'Account', icon: User },
  ];

  return (
    <nav className="mobileBottomNav" aria-label="Primary">
      {items.map((item) => {
        const active = isActive(item.path === '/login' ? '/login' : item.path);
        const Icon = item.icon;
        return (
          <Link
            key={item.label}
            // Signing in from any page returns the customer to that page.
            to={item.path === '/login' ? loginUrl(location.pathname + location.search) : item.path}
            className={`mobileBottomNavItem${active ? ' active' : ''}`}
            aria-label={item.label}
            aria-current={active ? 'page' : undefined}
          >
            <span className="mobileBottomNavIcon">
              <Icon size={22} strokeWidth={active ? 2.25 : 1.75} />
              {item.badge != null && item.badge > 0 && (
                <span className="mobileBottomNavBadge" aria-hidden="true">
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
            </span>
            <span className="mobileBottomNavLabel">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
