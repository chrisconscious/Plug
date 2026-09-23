import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import * as api from '../lib/api';
import { BrandLogo } from '../components/BrandLogo';

function VerifyEmail() {
  const [sp] = useSearchParams();
  const token = sp.get('token') ?? '';
  const [status, setStatus] = useState<'checking' | 'ok' | 'error'>('checking');
  useEffect(() => {
    if (!token) { setStatus('error'); return; }
    api.verifyEmail(token).then(() => setStatus('ok')).catch(() => setStatus('error'));
  }, [token]);
  return (
    <div className="auth">
      <div className="authVisual" style={{ background: 'linear-gradient(155deg, #14161c 0%, #06070a 65%, #000 100%)' }}>
        <Link to="/" className="authLogo"><BrandLogo maxHeight={26} /></Link>
        <div><h1>VERIFY YOUR EMAIL</h1><p>One quick step to unlock checkout.</p></div>
      </div>
      <div className="authForm">
        <h1>EMAIL VERIFICATION</h1>
        {status === 'checking' && <p style={{ color: '#555' }}>Verifying your link…</p>}
        {status === 'ok' && (
          <>
            <p style={{ color: '#38805b' }}>Your email is verified ✓</p>
            <Link to="/shop" className="blackButton" style={{ width: '100%' }}>CONTINUE SHOPPING</Link>
          </>
        )}
        {status === 'error' && (
          <>
            <p style={{ color: '#c00' }}>This link is invalid or has expired.</p>
            <p style={{ color: '#555', fontSize: 13 }}>Sign in and use "Resend verification email" from your profile to get a fresh link.</p>
            <Link to="/login" className="blackButton" style={{ width: '100%' }}>SIGN IN</Link>
          </>
        )}
      </div>
    </div>
  );
}


export default VerifyEmail;
