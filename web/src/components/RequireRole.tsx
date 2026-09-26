import type { ReactNode } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import type { PublicUser } from '../lib/api';
import { loginUrl, currentLocation } from '../lib/returnTo';

/**
 * Back-office screens only for the roles allowed to use them. The API already
 * refuses every admin call from anyone else (RBAC in api/src/lib/rbac.ts);
 * this keeps the admin interface itself — and its code chunks — from loading
 * for a customer, and sends an Admin who opens a Super Admin URL to their own
 * dashboard instead of a screen whose every request would fail.
 */
export function RequireRole({ roles, children }: { roles: PublicUser['role'][]; children: ReactNode }) {
  const { status, user, refresh } = useAuth();
  if (status === 'loading') {
    return <div style={{ padding: 48, textAlign: 'center', color: '#71717a', fontSize: 13 }}>Checking access…</div>;
  }
  if (status === 'error') {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <p style={{ color: '#c00', marginBottom: 12 }}>Couldn't check your session right now.</p>
        <button type="button" className="blackButton" onClick={() => refresh()}>RETRY</button>
      </div>
    );
  }
  if (!user) return <Navigate to={loginUrl(currentLocation())} replace />;
  if (roles.includes(user.role)) return <>{children}</>;
  if (user.role === 'ADMIN') return <Navigate to="/admin" replace />;
  return (
    <main style={{ padding: '80px 20px', textAlign: 'center' }} data-role="no-access">
      <h1 style={{ fontSize: 22, marginBottom: 10 }}>This page isn't available</h1>
      <p style={{ color: '#666', marginBottom: 20 }}>It's only for store staff.</p>
      <Link to="/" className="blackButton">BACK TO THE STORE</Link>
    </main>
  );
}
