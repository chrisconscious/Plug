import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useEffect } from 'react';
import { reportClientError } from './lib/api';
import Index from './pages/Index';
import { MobileBottomNav } from './components/MobileBottomNav';
import { InstallPrompt } from './components/InstallPrompt';
import { NotificationToaster } from './components/NotificationToaster';
import { FloatingWhatsAppButton } from './components/FloatingWhatsAppButton';
import NotFound from './pages/NotFound';
import ProductDetail from './pages/ProductDetail';
import Cart from './pages/Cart';
import Checkout from './pages/Checkout';
import Confirmation from './pages/Confirmation';
import Auth from './pages/Auth';
import VerifyEmail from './pages/VerifyEmail';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Profile from './pages/Profile';
import Orders from './pages/Orders';
import OrderDetail from './pages/OrderDetail';
import AdminOrderDetail from './pages/AdminOrderDetail';
import Wishlist from './pages/Wishlist';
import Notifications from './pages/Notifications';
import Brands from './pages/Brands';
import Lifestyles from './pages/Lifestyles';
import Backoffice from './pages/Backoffice';
import { ProductListingPage } from './components/shop/ProductListingPage';
import { LifestylePage } from './components/lifestyle/LifestylePage';
import { superItems, adminItems } from './lib/adminNav';
import { AuthProvider } from './lib/AuthContext';
import { PlatformSettingsProvider } from './lib/PlatformSettingsContext';

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
        {superItems.map((x) => <Route key={x.path} path={x.path} element={<Backoffice />} />)}
        {adminItems.map((x) => <Route key={x.path} path={x.path} element={<Backoffice />} />)}
        <Route path="/admin/orders/:id" element={<AdminOrderDetail />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
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
