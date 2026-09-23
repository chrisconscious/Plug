import { useState } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../lib/api';
import { BrandLogo } from '../components/BrandLogo';

function ForgotPassword() {
  const [email, setEmail] = useState(''); const [sent, setSent] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.includes('@')) return;
    setBusy(true); setError('');
    try {
      await api.requestPasswordReset(email);
      // Same UI outcome regardless of whether the email exists — the
      // backend deliberately never reveals that (see auth.service.ts).
      setSent(true);
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="authVisual" style={{ background: 'linear-gradient(155deg, #14161c 0%, #06070a 65%, #000 100%)' }}>
        <Link to="/" className="authLogo"><BrandLogo maxHeight={26} /></Link>
        <div><h1>FORGOT PASSWORD</h1><p>We'll help you get back in.</p></div>
      </div>
      <div className="authForm">
        <h1>RESET PASSWORD</h1>
        {sent ? (
          <>
            <p style={{ color: '#38805b' }}>If an account exists for that email, a reset link is on its way.</p>
            <p style={{ color: '#555', fontSize: 13 }}>The link expires in 1 hour and can only be used once. Check your inbox (and spam folder).</p>
            <Link to="/login" className="blackButton" style={{ width: '100%' }}>BACK TO SIGN IN</Link>
          </>
        ) : (
          <form className="formGrid" onSubmit={submit}>
            <input aria-label="Email address" placeholder="Email address" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            {error && <p style={{ color: '#c00', fontSize: 13, margin: 0 }}>{error}</p>}
            <button className="blackButton" disabled={!email.includes('@') || busy}>{busy ? 'SENDING…' : 'SEND RESET LINK'}</button>
            <p style={{ fontSize: 11.5, color: '#999', margin: '4px 0 0' }}>
              Registered with a mobile number instead of an email? Password reset by phone isn't available yet — please contact support to regain access.
            </p>
          </form>
        )}
        <p><Link to="/login" style={{ color: '#666' }}>Back to sign in</Link></p>
      </div>
    </div>
  );
}

export default ForgotPassword;
