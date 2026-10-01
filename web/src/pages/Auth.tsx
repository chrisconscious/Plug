import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link, Navigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Eye, EyeOff } from 'lucide-react';
import * as api from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import { usePlatformSettings } from '../lib/PlatformSettingsContext';
import { BrandLogo } from '../components/BrandLogo';
import { safeReturnTo, loginUrl } from '../lib/returnTo';
import { fieldErrors, userMessage } from '../lib/errors';
import { isStrongPassword, isValidMobile } from '../lib/password';
import { PasswordChecklist } from '../components/PasswordChecklist';

const FIELD_LABELS = { fullName: 'Full name', phoneNumber: 'Mobile number', password: 'Password' };
type FieldKey = 'fullName' | 'phoneNumber' | 'password';

function Auth({ register = false }: { register?: boolean }) {
  const nav = useNavigate();
  const { login, register: doRegister, refresh, status, user } = useAuth();
  const { platformName } = usePlatformSettings();
  const [sp] = useSearchParams();
  const sessionExpired = sp.get('reason') === 'expired';
  // Where the customer was going (e.g. /checkout?buyNow=…). Validated to an
  // internal path only — see lib/returnTo.ts (open-redirect protection).
  const returnTo = safeReturnTo(sp.get('returnTo'));
  const toCheckout = !!returnTo && returnTo.startsWith('/checkout');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState<Partial<Record<FieldKey, string>>>({});
  // Registration refused because the number is taken (the API answers 409
  // without saying so outright — no account enumeration); offer the two
  // useful next steps instead of a dead end.
  const [registerConflict, setRegisterConflict] = useState(false);
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
  // After sign-in: back to exactly where the customer was going (replace, so
  // Back doesn't return to the sign-in form); otherwise the role's home.
  const goToRoleHome = (role: api.PublicUser['role']) => {
    if (returnTo) nav(returnTo, { replace: true });
    else if (role === 'SUPER_ADMIN') nav('/super-admin', { replace: true });
    else if (role === 'ADMIN') nav('/admin', { replace: true });
    else nav('/shop', { replace: true });
  };
  // Same rules the API enforces, checked first so the customer gets an
  // immediate, specific message; the API remains the authority.
  function validateLocally(): Partial<Record<FieldKey, string>> {
    const errs: Partial<Record<FieldKey, string>> = {};
    if (register && !name.trim()) errs.fullName = 'Enter your full name.';
    if (!phone.trim()) errs.phoneNumber = 'Enter your mobile number.';
    else if (!isValidMobile(phone)) errs.phoneNumber = 'Enter a valid mobile number, e.g. 0655000000.';
    if (!password) errs.password = 'Enter your password.';
    else if (register && !isStrongPassword(password)) errs.password = 'Your password doesn\'t meet all the requirements below yet.';
    return errs;
  }
  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setError(''); setRegisterConflict(false);
    const local = validateLocally();
    setFieldErr(local);
    if (Object.keys(local).length > 0) return;
    setBusy(true);
    try {
      if (register) {
        const res = await doRegister(phone.trim(), password, name.trim());
        if ('user' in res) goToRoleHome(res.user.role);
        return;
      }
      const res = await login(phone.trim(), password);
      if (res.mfaRequired) { setMfaToken(res.mfaToken); return; }
      if ('user' in res) goToRoleHome(res.user.role);
    } catch (e) {
      if (register && e instanceof api.ApiError && e.status === 409) {
        setRegisterConflict(true);
        return;
      }
      const fields = fieldErrors(e, FIELD_LABELS) as Partial<Record<FieldKey, string>>;
      const shown = (Object.keys(FIELD_LABELS) as FieldKey[]).filter((k) => fields[k]);
      setFieldErr(fields);
      // Anything not attached to a visible field is still said, never dropped.
      if (shown.length === 0) setError(userMessage(e, register ? 'We couldn\'t create your account. Please try again.' : 'We couldn\'t sign you in. Please try again.', FIELD_LABELS));
    } finally { setBusy(false); }
  }
  async function submitMfa(ev: React.FormEvent) {
    ev.preventDefault(); setBusy(true); setError('');
    try {
      const res = await api.mfaVerifyLogin(mfaToken!, mfaCode);
      await refresh(); // re-resolve AuthContext state from the server now that the session exists
      if ('user' in res) goToRoleHome(res.user.role);
    } catch (e) { setError(userMessage(e, 'That code didn\'t work. Please try again.')); } finally { setBusy(false); }
  }
  const errId = (k: FieldKey) => (fieldErr[k] ? `auth-${k}-error` : undefined);
  // Already signed in (e.g. a stale /login?returnTo=… tab, or Back from the
  // destination): don't show the form again — continue to the destination.
  if (status === 'authenticated' && user && !mfaToken) {
    return <Navigate to={returnTo ?? (user.role === 'SUPER_ADMIN' ? '/super-admin' : user.role === 'ADMIN' ? '/admin' : '/shop')} replace />;
  }
  return (
    <div className={register ? 'auth authPage authPage--register' : 'auth authPage'}>
      <div className="authVisual" style={authSettings?.backgroundImageUrl ? { backgroundImage: `url(${api.assetUrl(authSettings.backgroundImageUrl)})`, backgroundSize: 'cover', backgroundPosition: 'center' } : { background: register ? 'linear-gradient(155deg, #2b2118 0%, #0a0806 65%, #000 100%)' : 'linear-gradient(155deg, #14161c 0%, #06070a 65%, #000 100%)' }}>
        <Link to="/" className="authLogo"><BrandLogo maxHeight={26} /></Link>
        <div className="authVisualText"><h1>{register ? authSettings?.registerHeadline ?? 'BECOME A MEMBER' : authSettings?.loginHeadline ?? 'FASHION THAT DEFINES YOU'}</h1><p>{register ? authSettings?.registerSubtitle ?? 'Discover premium styles curated for you.' : authSettings?.loginSubtitle ?? 'Discover premium styles curated for you.'}</p></div>
      </div>
      <div className="authForm">
        <div className="authPanel">
        {mfaToken ? (
          <>
            <header className="authHead">
              <h1>TWO-FACTOR CODE</h1>
              <p className="authLead">Enter the 6-digit code from your authenticator app, or one of your recovery codes.</p>
            </header>
            <form className="authFields" onSubmit={submitMfa}>
              <div className="authField">
                <label htmlFor="auth-mfa" className="authLabel">Verification code</label>
                <input id="auth-mfa" className="authInput" aria-label="6-digit code or recovery code" placeholder="6-digit code or recovery code" autoComplete="one-time-code" required value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} autoFocus />
              </div>
              {error && <p role="alert" className="authNotice authNotice--error">{error}</p>}
              <button type="submit" className="blackButton authSubmit" disabled={busy}>{busy ? 'Verifying...' : 'VERIFY'}</button>
            </form>
            <div className="authSwitch">
              <button type="button" className="authAltButton" onClick={() => { setMfaToken(null); setMfaCode(''); setError(''); }}>
                <ArrowLeft size={16} aria-hidden="true" /> Back to sign in
              </button>
            </div>
          </>
        ) : (
          <>
            <header className="authHead">
              <h1>{register ? 'CREATE ACCOUNT' : 'WELCOME BACK'}</h1>
              <p className="authLead">{register ? `Join ${platformName} today` : 'Sign in to your account'}</p>
            </header>
            {!register && sessionExpired && <p className="authNotice authNotice--warn">Your session expired. Please sign in again to continue.</p>}
            {toCheckout && <p role="status" data-role="checkout-return-note" className="authNotice">{register ? 'Create an account' : 'Sign in'} to continue to checkout — you'll go straight back to your order.</p>}
            <form className="authFields" onSubmit={submit} noValidate>
              {register && (
                <div className="authField">
                  <label htmlFor="auth-name" className="authLabel">Full name</label>
                  <input
                    id="auth-name"
                    className="authInput"
                    placeholder="Your full name"
                    autoComplete="name"
                    maxLength={120}
                    value={name}
                    aria-invalid={!!fieldErr.fullName}
                    aria-describedby={errId('fullName')}
                    onChange={(e) => { setName(e.target.value); setFieldErr((f) => ({ ...f, fullName: undefined })); }}
                  />
                  {fieldErr.fullName && <p id="auth-fullName-error" className="authFieldError">{fieldErr.fullName}</p>}
                </div>
              )}
              <div className="authField">
                <label htmlFor="auth-phone" className="authLabel">Mobile number</label>
                <input
                  id="auth-phone"
                  className="authInput"
                  aria-label="Mobile number"
                  placeholder="0655000000"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  required
                  value={phone}
                  aria-invalid={!!fieldErr.phoneNumber}
                  aria-describedby={errId('phoneNumber')}
                  onChange={(e) => { setPhone(e.target.value); setFieldErr((f) => ({ ...f, phoneNumber: undefined })); }}
                />
                {fieldErr.phoneNumber && <p id="auth-phoneNumber-error" className="authFieldError">{fieldErr.phoneNumber}</p>}
              </div>
              <div className="authField">
                <div className="authLabelRow">
                  <label htmlFor="auth-password" className="authLabel">Password</label>
                  {!register && <Link to="/forgot-password" className="authTextLink">Forgot password?</Link>}
                </div>
                <div className="authInputWrap">
                  <input
                    id="auth-password"
                    className="authInput authInput--withIcon"
                    aria-label="Password"
                    placeholder={register ? 'Create a password' : 'Enter your password'}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={register ? 'new-password' : 'current-password'}
                    required
                    value={password}
                    aria-invalid={!!fieldErr.password}
                    aria-describedby={[errId('password'), register ? 'auth-password-rules' : undefined].filter(Boolean).join(' ') || undefined}
                    onChange={(e) => { setPassword(e.target.value); setFieldErr((f) => ({ ...f, password: undefined })); }}
                  />
                  <button
                    type="button"
                    className="authEye"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
                  </button>
                </div>
                {fieldErr.password && <p id="auth-password-error" className="authFieldError">{fieldErr.password}</p>}
                {register && <PasswordChecklist id="auth-password-rules" password={password} />}
              </div>
              {registerConflict && (
                <div role="alert" data-role="register-conflict" className="authNotice authNotice--warn">
                  We couldn't create an account with this mobile number. If you already have an account,{' '}
                  <Link to={loginUrl(returnTo)} className="authTextLink">sign in</Link> or <Link to="/forgot-password" className="authTextLink">reset your password</Link>.
                </div>
              )}
              {error && <p role="alert" className="authNotice authNotice--error">{error}</p>}
              <button type="submit" className="blackButton authSubmit" disabled={busy}>
                {busy ? 'Please wait...' : (register ? 'CREATE ACCOUNT' : 'SIGN IN')}
                {!busy && <ArrowRight size={17} aria-hidden="true" />}
              </button>
            </form>

            <div className="authSwitch">
              <p className="authDivider"><span>{register ? 'Already have an account?' : `New to ${platformName}?`}</span></p>
              <Link to={loginUrl(returnTo, { page: register ? 'login' : 'register' })} className="authAltButton">
                {register ? 'Sign in' : 'Create an account'} <ArrowRight size={16} aria-hidden="true" />
              </Link>
              {register && <Link to="/forgot-password" className="authTextLink authForgot">Forgot password?</Link>}
            </div>
          </>
        )}
        </div>
      </div>
    </div>
  );
}


export default Auth;
