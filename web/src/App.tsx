import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { reportClientError } from './lib/api';
import Index from './pages/Index';
import { MobileBottomNav } from './components/MobileBottomNav';
import { InstallPrompt } from './components/InstallPrompt';
import { NotificationToaster } from './components/NotificationToaster';
import { FloatingWhatsAppButton } from './components/FloatingWhatsAppButton';
import { superItems, adminItems } from './lib/adminNav';
import { RequireRole } from './components/RequireRole';
import { AuthProvider } from './lib/AuthContext';
import { PlatformSettingsProvider } from './lib/PlatformSettingsContext';
import { ScrollManager } from './components/ScrollManager';

// Every page except the homepage is loaded on demand, so a first visit only
// downloads the homepage (checkout, account and admin code come later).
const NotFound = lazy(() => import('./pages/NotFound'));
const ProductDetail = lazy(() => import('./pages/ProductDetail'));
const Cart = lazy(() => import('./pages/Cart'));
const Checkout = lazy(() => import('./pages/Checkout'));
const Confirmation = lazy(() => import('./pages/Confirmation'));
const Auth = lazy(() => import('./pages/Auth'));
const VerifyEmail = lazy(() => import('./pages/VerifyEmail'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const Profile = lazy(() => import('./pages/Profile'));
const Orders = lazy(() => import('./pages/Orders'));
const OrderDetail = lazy(() => import('./pages/OrderDetail'));
const AdminOrderDetail = lazy(() => import('./pages/AdminOrderDetail'));
const Wishlist = lazy(() => import('./pages/Wishlist'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Brands = lazy(() => import('./pages/Brands'));
const Lifestyles = lazy(() => import('./pages/Lifestyles'));
const Backoffice = lazy(() => import('./pages/Backoffice'));
const ProductListingPage = lazy(() => import('./components/shop/ProductListingPage').then((m) => ({ default: m.ProductListingPage })));
const LifestylePage = lazy(() => import('./components/lifestyle/LifestylePage').then((m) => ({ default: m.LifestylePage })));

function App() {
  useEffect(() => {
    // Service worker: static-asset caching only (see public/service-worker.js's
    // own header comment for what it deliberately never touches — /api/,
    // checkout, cart, account, admin). Registered here rather than in
    // main.tsx (marked scaffold-owned). Skipped in development: Vite serves
    // the app as live source modules (including /src/index.css, which changes
    // on every edit), and a static cache-first worker has no business caching
    // those — doing so served permanently-stale styles (the old broken
    // WOMEN/MEN dropdown). Production builds contain stable hashed assets, so
    // the cache is only ever activated there. Also skipped outside a secure
    // context (service workers require HTTPS or localhost) and wrapped so a
    // registration failure never breaks the rest of the app.
    const isProd = import.meta.env.PROD;
    if (
      isProd &&
      "serviceWorker" in navigator &&
      (window.isSecureContext || location.hostname === "localhost")
    ) {
      navigator.serviceWorker.register("/service-worker.js").catch(() => {
        // Non-fatal — the site works identically without it, just without
        // the static-asset caching / installability benefit.
      });
    } else if (import.meta.env.DEV && "serviceWorker" in navigator) {
      // Clear any worker registered by an older session/post-upgrade build —
      // the dev server is live source and must never be served from a stale
      // static cache (that's what left the old header dropdown unstyled).
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((r) => r.unregister());
      }).catch(() => {});
      // Also drop every cache the old worker might still hold (e.g. a cached
      // /src/index.css from plug-static-v1) so the next fetch is guaranteed
      // fresh — no hard-refresh required.
      if ("caches" in window) {
        caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).catch(() => {});
      }
    }
  }, []);

  useEffect(() => {
    // Global error monitoring — deliberately separate from main.tsx's
    // render-error boundary (which only catches errors during React's
    // render phase). These two handlers catch what a render-error
    // boundary structurally cannot: an error thrown inside an event
    // handler/timer/async callback, and an unhandled promise rejection
    // (e.g. a fire-and-forget API call whose .catch was missed). Both
    // are common real causes of "the button did nothing" bug reports
    // that a render-only boundary would never see.
    const onError = (event: ErrorEvent) => {
      reportClientError({ message: event.message, stack: event.error?.stack, url: window.location.href });
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      reportClientError({
        message: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
        url: window.location.href,
      });
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, []);

  return (
    <PlatformSettingsProvider>
    <AuthProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ScrollManager />
      <Suspense fallback={<div aria-busy="true" style={{ minHeight: '60vh' }} />}>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/shop" element={<ProductListingPage />} />
        <Route path="/brands" element={<Brands />} />
        <Route path="/brands/:slug" element={<ProductListingPage />} />
        <Route path="/lifestyles" element={<Lifestyles />} />
        <Route path="/lifestyle/:lifestyleSlug" element={<LifestylePage />} />
        <Route path="/product/:id" element={<ProductDetail />} />
        <Route path="/cart" element={<Cart />} />
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/order-confirmation" element={<Confirmation />} />
        <Route path="/login" element={<Auth />} />
        <Route path="/register" element={<Auth register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/orders/:id" element={<OrderDetail />} />
        <Route path="/wishlist" element={<Wishlist />} />
        <Route path="/notifications" element={<Notifications />} />
        {superItems.map((x) => <Route key={x.path} path={x.path} element={<RequireRole roles={['SUPER_ADMIN']}><Backoffice /></RequireRole>} />)}
        {adminItems.map((x) => <Route key={x.path} path={x.path} element={<RequireRole roles={['ADMIN', 'SUPER_ADMIN']}><Backoffice /></RequireRole>} />)}
        <Route path="/admin/orders/:id" element={<RequireRole roles={['ADMIN', 'SUPER_ADMIN']}><AdminOrderDetail /></RequireRole>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      </Suspense>
      <MobileBottomNav />
      <InstallPrompt />
      <NotificationToaster />
      <FloatingWhatsAppButton />
      </BrowserRouter>
    </AuthProvider>
    </PlatformSettingsProvider>
  );
}

export default App;
