import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import * as api from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import { usePlatformSettings } from '../lib/PlatformSettingsContext';
import { BrandLogo } from '../components/BrandLogo';

/**
 * Google/Apple sign-in: real, correctly-branded buttons, but honest about
 * a real limitation — actually authenticating with either provider
 * requires OAuth Client ID/Secret credentials registered with Google's
 * and Apple's own developer consoles, which this environment has no way
 * to generate. Rather than wire these to something that silently fails
 * or pretends to work, they show a clear, calm message explaining
 * exactly that. Once real credentials are configured server-side, this
 * handler is the one place to swap in the actual OAuth redirect.
 */
function useSocialLoginNotice() {
  const [notice, setNotice] = useState<string | null>(null);
  const trigger = (provider: string) => {
    setNotice(`${provider} sign-in isn't connected yet — the site owner needs to add ${provider} developer credentials first.`);
    setTimeout(() => setNotice(null), 5000);
  };
  return { notice, trigger };
}

function GoogleLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C34.5 5.1 29.6 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.2-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.5 18.9 13 24 13c3.1 0 5.8 1.1 8 3l6-6C34.5 5.1 29.6 3 24 3 16.3 3 9.6 7.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 45c5.5 0 10.4-1.9 14.2-5.1l-6.6-5.6c-2 1.5-4.6 2.5-7.6 2.5-5.3 0-9.7-3.4-11.3-8.1l-6.6 5.1C9.5 40.5 16.2 45 24 45z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.4l6.6 5.6C41.6 35.9 45 30.4 45 24c0-1.2-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function AppleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 384 512" aria-hidden="true" fill="currentColor">
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
    </svg>
  );
}

function Auth({ register = false }: { register?: boolean }) {
  const nav = useNavigate();
  const { login, register: doRegister, refresh } = useAuth();
  const { platformName } = usePlatformSettings();
  const [sp] = useSearchParams();
  const sessionExpired = sp.get('reason') === 'expired';
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { notice: socialNotice, trigger: triggerSocial } = useSocialLoginNotice();
  const [authSettings, setAuthSettings] = useState<api.AuthPageSettings | null>(null);

  useEffect(() => {
    let on = true;
    api.getAuthPageSettings()
      .then((r) => on && setAuthSettings(r.settings))
      .catch(() => on && setAuthSettings(null));
    return () => { on = false; };
  }, []);
  // Set only when a login response comes back as an MFA challenge — the
  // form then switches to asking for a 6-digit (or recovery) code instead
  // of resubmitting phone/password.
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const goToRoleHome = (role: api.PublicUser['role']) => {
    if (role === 'SUPER_ADMIN') nav('/super-admin');
    else if (role === 'ADMIN') nav('/admin');
    else nav('/shop');
  };
  async function submit(ev: any) {
    ev.preventDefault(); setBusy(true); setError('');
    try {
      if (register) {
        const res = await doRegister(phone, password, name);
        goToRoleHome(res.user.role);
        return;
      }
      const res = await login(phone, password);
      if (res.mfaRequired === true) { setMfaToken(res.mfaToken); return; }
      goToRoleHome(res.user.role);
    } catch (e) { setError(e instanceof api.ApiError ? e.message : 'Something went wrong'); } finally { setBusy(false); }
  }
  async function submitMfa(ev: any) {
    ev.preventDefault(); setBusy(true); setError('');
    try {
      const res = await api.mfaVerifyLogin(mfaToken!, mfaCode);
      await refresh(); // re-resolve AuthContext state from the server now that the session exists
      goToRoleHome(res.user.role);
    } catch (e) { setError(e instanceof api.ApiError ? e.message : 'Something went wrong'); } finally { setBusy(false); }
  }
  return (
    <div className="auth">
      <div className="authVisual" style={authSettings?.backgroundImageUrl ? { backgroundImage: `url(${api.assetUrl(authSettings.backgroundImageUrl)})`, backgroundSize: 'cover', backgroundPosition: 'center' } : { background: register ? 'linear-gradient(155deg, #2b2118 0%, #0a0806 65%, #000 100%)' : 'linear-gradient(155deg, #14161c 0%, #06070a 65%, #000 100%)' }}>
        <Link to="/" className="authLogo"><BrandLogo maxHeight={26} /></Link>
        <div><h1>{register ? authSettings?.registerHeadline ?? 'BECOME A MEMBER' : authSettings?.loginHeadline ?? 'FASHION THAT DEFINES YOU'}</h1><p>{register ? authSettings?.registerSubtitle ?? 'Discover premium styles curated for you.' : authSettings?.loginSubtitle ?? 'Discover premium styles curated for you.'}</p></div>
      </div>
      <div className="authForm">
        {mfaToken ? (
          <>
            <h1>TWO-FACTOR CODE</h1>
            <p>Enter the 6-digit code from your authenticator app, or one of your recovery codes.</p>
            <form className="formGrid" onSubmit={submitMfa}>
              <input aria-label="6-digit code or recovery code" placeholder="6-digit code or recovery code" required value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} autoFocus />
              {error && <p style={{ color: '#c00', fontSize: 13, margin: 0 }}>{error}</p>}
              <button className="blackButton" disabled={busy}>{busy ? 'Verifying...' : 'VERIFY'}</button>
            </form>
            <p><button type="button" onClick={() => { setMfaToken(null); setMfaCode(''); setError(''); }} style={{ color: '#666', background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer', padding: 0 }}>Back to sign in</button></p>
          </>
        ) : (
          <>
            <h1>{register ? 'CREATE ACCOUNT' : 'WELCOME BACK'}</h1>
            <p>{register ? `Join ${platformName} today` : 'Sign in to your account'}</p>
            {!register && sessionExpired && <p style={{ color: '#b45309', fontSize: 13, margin: 0 }}>Your session expired. Please sign in again to continue.</p>}
            <form className="formGrid" onSubmit={submit}>
              {register && <input aria-label="Full name" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />}
              <div>
                <label htmlFor="auth-phone" style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 5 }}>
                  Mobile Number
                </label>
                <input
                  id="auth-phone"
                  aria-label="Mobile number"
                  placeholder="0756825667"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  style={{ fontSize: 16 }}
                />
                <span style={{ display: 'block', fontSize: 11, color: '#999', marginTop: 4 }}>e.g. 0756825667</span>
              </div>
              <div>
                <label htmlFor="auth-password" style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 5 }}>
                  Password
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    id="auth-password"
                    aria-label="Password"
                    placeholder="Password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={register ? 'new-password' : 'current-password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    style={{ width: '100%', paddingRight: 44, fontSize: 16 }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    title={showPassword ? 'Hide password' : 'Show password'}
                    style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#888', display: 'flex', padding: 6 }}
                  >
                    {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
                  </button>
                </div>
              </div>
              {error && <p style={{ color: '#c00', fontSize: 13, margin: 0 }}>{error}</p>}
              <button className="blackButton" disabled={busy} style={{ minHeight: 50, fontSize: 13 }}>{busy ? 'Please wait...' : (register ? 'CREATE ACCOUNT' : 'SIGN IN')}</button>
            </form>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '18px 0' }}>
              <span style={{ flex: 1, height: 1, background: '#e5e5e5' }} />
              <span style={{ fontSize: 11, color: '#999', textTransform: 'uppercase', letterSpacing: '.08em' }}>or</span>
              <span style={{ flex: 1, height: 1, background: '#e5e5e5' }} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                type="button"
                onClick={() => triggerSocial('Google')}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%', minHeight: 48, border: '1px solid #d8d5cd', background: '#fff', borderRadius: 2, fontSize: 13, fontWeight: 600, color: '#222', cursor: 'pointer' }}
              >
                <GoogleLogo /> Continue with Google
              </button>
              <button
                type="button"
                onClick={() => triggerSocial('Apple')}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%', minHeight: 48, border: '1px solid #111', background: '#111', borderRadius: 2, fontSize: 13, fontWeight: 600, color: '#fff', cursor: 'pointer' }}
              >
                <AppleLogo /> Continue with Apple
              </button>
              {socialNotice && (
                <p role="status" style={{ fontSize: 12, color: '#8a5a00', background: '#fff7e6', border: '1px solid #f5d99b', borderRadius: 6, padding: '8px 10px', margin: 0 }}>
                  {socialNotice}
                </p>
              )}
            </div>

            <p style={{ marginTop: 18 }}>{register ? 'Already have an account?' : 'New here?'} <Link to={register ? '/login' : '/register'}>{register ? 'Sign in' : 'Create an account'}</Link></p>
            <p><Link to="/forgot-password" style={{ color: '#666' }}>Forgot password?</Link></p>
          </>
        )}
      </div>
    </div>
  );
}


export default Auth;
