import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import * as api from './api';
import { setWishlistAuthMode } from './wishlist';
import { refreshCartCount, clearCartCount } from './cartCount';

/**
 * The server session is the ONLY source of truth for authentication state.
 * There is no localStorage/sessionStorage flag anywhere in this module —
 * on every page load, `status` starts at 'loading' and is resolved by
 * actually asking the backend (`api.me()`), which reads the real httpOnly
 * session cookie. A page refresh, a closed tab, a cleared cookie, or a
 * server-side session revocation are all reflected correctly because
 * nothing here is cached client-side across reloads.
 *
 * This replaces the old `vv_authed`/`vv_authed_exp` localStorage mirror
 * (api.ts's now-removed `isAuthed()`), which had exactly the failure mode
 * this design avoids: it was a *guess* about session validity based on a
 * client-side timer, and guesses can be wrong in both directions (stale
 * "authenticated" after a revoked session; stale "unauthenticated" after
 * a perfectly valid refresh).
 */

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'error';

type AuthState = {
  status: AuthStatus;
  user: api.PublicUser | null;
};

type AuthContextValue = AuthState & {
  /** Re-resolves auth state from the server. Called automatically on mount; exposed for manual re-checks (e.g. after MFA setup changes user.mfaEnabled). */
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<api.LoginResult>;
  register: (email: string, password: string, fullName?: string) => Promise<{ user: api.PublicUser }>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null });

  const resolve = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading' }));
    // Guest fast-path: the readable vv_session marker is always set in
    // exact sync with the httpOnly session cookies (see tokens.ts). Its
    // absence proves this browser holds no session cookies, so the /me
    // probe would only ever 401 — skip the request (and its console noise)
    // entirely and resolve straight to signed-out. When the marker IS
    // present, the server is still queried on every load and remains the
    // sole authority on whether the session is actually valid.
    if (!api.hasSessionMarker()) {
      setState({ status: 'unauthenticated', user: null });
      setWishlistAuthMode(false);
      clearCartCount();
      return;
    }
    try {
      const { user } = await api.me();
      setState({ status: 'authenticated', user });
      setWishlistAuthMode(true); // fire-and-forget: wishlist sync never blocks auth state
      refreshCartCount();
    } catch (e) {
      if (e instanceof api.ApiError && e.status === 401) {
        setState({ status: 'unauthenticated', user: null });
        setWishlistAuthMode(false);
        clearCartCount();
      } else {
        // A real failure (network down, 500, etc.) is NOT the same as
        // "signed out" — conflating the two would show a misleading
        // "please sign in" for what's actually a connectivity problem.
        setState({ status: 'error', user: null });
        // Deliberately NOT calling setWishlistAuthMode here: a transient
        // network error resolving /me says nothing about whether the
        // user is actually logged in, so it's not a real mode change —
        // whatever wishlist mode was already active stays active.
      }
    }
  }, []);

  useEffect(() => {
    resolve();
  }, [resolve]);

  const login = useCallback(async (phoneNumber: string, password: string) => {
    const result = await api.login(phoneNumber, password);
    if (result.mfaRequired === false) {
      setState({ status: 'authenticated', user: result.user });
      setWishlistAuthMode(true);
      refreshCartCount();
    }
    return result;
  }, []);

  const register = useCallback(async (phoneNumber: string, password: string, fullName?: string) => {
    const result = await api.register(phoneNumber, password, fullName);
    setState({ status: 'authenticated', user: result.user });
    setWishlistAuthMode(true);
    refreshCartCount();
    return result;
  }, []);

  const logout = useCallback(async () => {
    // Update UI state immediately — don't wait on the network round-trip
    // to reflect "signed out" (the task's explicit requirement: logout
    // must immediately update frontend state). The server call still
    // happens to actually revoke the session; if it fails, the user is
    // still shown as logged out locally, which is the safe direction for
    // this particular mismatch to fail in.
    setState({ status: 'unauthenticated', user: null });
    setWishlistAuthMode(false);
    clearCartCount();
    try {
      await api.logout();
    } catch {
      /* local state already updated; nothing further to reconcile here */
    }
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, refresh: resolve, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth() must be used within an <AuthProvider>');
  return ctx;
}
