import { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import * as api from '../lib/api';
import { BrandLogo } from '../components/BrandLogo';
import { userMessage } from '../lib/errors';
import { isStrongPassword } from '../lib/password';
import { PasswordChecklist } from '../components/PasswordChecklist';

function ResetPassword() {
  const [sp] = useSearchParams();
  const token = sp.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!token) { setError('This reset link is missing its token.'); return; }
    if (!isStrongPassword(password)) { setError("Your new password doesn't meet all the requirements yet."); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    setBusy(true);
    try {
      await api.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(userMessage(err, 'We couldn\'t reset your password. Please try again.', { password: 'New password' }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="authVisual" style={{ background: 'linear-gradient(155deg, #14161c 0%, #06070a 65%, #000 100%)' }}>
        <Link to="/" className="authLogo"><BrandLogo maxHeight={26} /></Link>
        <div><h1>SET A NEW PASSWORD</h1><p>Almost there.</p></div>
      </div>
      <div className="authForm">
        <h1>RESET PASSWORD</h1>
        {!token ? (
          <>
            <p style={{ color: '#c00' }}>This reset link is invalid — it's missing its token.</p>
            <Link to="/forgot-password" className="blackButton" style={{ width: '100%' }}>REQUEST A NEW LINK</Link>
          </>
        ) : done ? (
          <>
            <p style={{ color: '#38805b' }}>Your password has been reset. You've been signed out everywhere else for safety.</p>
            <Link to="/login" className="blackButton" style={{ width: '100%' }}>SIGN IN</Link>
          </>
        ) : (
          <form className="formGrid" onSubmit={submit}>
            <div>
              <input aria-label="New password" placeholder="New password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby="reset-password-rules" style={{ width: '100%' }} />
              <PasswordChecklist id="reset-password-rules" password={password} />
            </div>
            <input aria-label="Confirm new password" placeholder="Confirm new password" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            {error && <p role="alert" style={{ color: '#c00', fontSize: 13, margin: 0 }}>{error}</p>}
            <button type="submit" className="blackButton" disabled={busy || !password || !confirm}>{busy ? 'SAVING…' : 'SET NEW PASSWORD'}</button>
          </form>
        )}
        <p><Link to="/login" style={{ color: '#666' }}>Back to sign in</Link></p>
      </div>
    </div>
  );
}

export default ResetPassword;
