"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, ShieldAlert, Copy, Check } from "lucide-react";
import * as api from "../../lib/api";
import { redirectToLoginExpired } from "../../lib/returnTo";

function handleAuthError(e: unknown): boolean {
  if (e instanceof api.ApiError && e.status === 401) {
    api.logout().catch(() => {});
    redirectToLoginExpired();
    return true;
  }
  return false;
}

export function MfaSettingsPage() {
  const [user, setUser] = useState<api.PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Setup-in-progress state (step 1: secret shown, step 2: code confirmed).
  const [setupSecret, setSetupSecret] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [confirmCode, setConfirmCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  // Disable flow.
  const [disabling, setDisabling] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");

  const load = async () => {
    setLoading(true); setError(null);
    try { const r = await api.me(); setUser(r.user); }
    catch (e) { if (!handleAuthError(e)) setError("Could not load your account."); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const startSetup = async () => {
    setError(null); setBusy(true);
    try { setSetupSecret(await api.mfaSetup()); }
    catch (e) { if (!handleAuthError(e)) setError(e instanceof api.ApiError ? e.message : "Could not start setup"); }
    finally { setBusy(false); }
  };

  const confirmSetup = async (ev: React.FormEvent) => {
    ev.preventDefault(); setError(null); setBusy(true);
    try {
      const r = await api.mfaEnable(confirmCode);
      setRecoveryCodes(r.recoveryCodes);
      setSetupSecret(null);
      setConfirmCode("");
      await load();
    } catch (e) { if (!handleAuthError(e)) setError(e instanceof api.ApiError ? e.message : "That code didn't work"); }
    finally { setBusy(false); }
  };

  const confirmDisable = async (ev: React.FormEvent) => {
    ev.preventDefault(); setError(null); setBusy(true);
    try {
      await api.mfaDisable(disablePassword);
      setDisabling(false); setDisablePassword("");
      await load();
    } catch (e) { if (!handleAuthError(e)) setError(e instanceof api.ApiError ? e.message : "Could not disable MFA"); }
    finally { setBusy(false); }
  };

  const copySecret = () => {
    if (!setupSecret) return;
    navigator.clipboard?.writeText(setupSecret.secret).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  if (loading) return <p style={{ padding: 24 }}>Loading…</p>;
  if (error && !user) return <p style={{ padding: 24, color: "#c00" }}>{error}</p>;
  if (!user) return null;

  return (
    <div style={{ maxWidth: 560 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        {user.mfaEnabled ? <ShieldCheck size={22} color="#038849" /> : <ShieldAlert size={22} color="#b45309" />}
        <div>
          <h3 style={{ margin: 0 }}>Two-factor authentication</h3>
          <p style={{ margin: "2px 0 0", fontSize: 13, color: "#666" }}>
            {user.mfaEnabled ? "Enabled — a code from your authenticator app is required at every sign-in." : "Not enabled. Turning this on protects your account even if your password leaks."}
          </p>
        </div>
      </div>

      {error && <p style={{ color: "#c00", fontSize: 13, marginBottom: 12 }}>{error}</p>}

      {/* Recovery codes are shown exactly once, right after enabling. */}
      {recoveryCodes && (
        <div style={{ border: "1px solid #f5d99b", background: "#fff7e6", borderRadius: 8, padding: 16, marginBottom: 20 }}>
          <p style={{ margin: "0 0 8px", fontWeight: 700, color: "#8a5a00" }}>Save these recovery codes now</p>
          <p style={{ margin: "0 0 10px", fontSize: 13, color: "#8a5a00" }}>
            Each works once, if you lose access to your authenticator app. They will not be shown again.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontFamily: "monospace", fontSize: 13, background: "#fff", padding: 10, borderRadius: 6 }}>
            {recoveryCodes.map((c) => <span key={c}>{c}</span>)}
          </div>
          <button className="blackButton" style={{ marginTop: 12 }} onClick={() => setRecoveryCodes(null)}>I've saved these codes</button>
        </div>
      )}

      {!user.mfaEnabled && !setupSecret && !recoveryCodes && (
        <button className="blackButton" disabled={busy} onClick={startSetup}>
          {busy ? "Starting…" : "Set up two-factor authentication"}
        </button>
      )}

      {setupSecret && (
        <form onSubmit={confirmSetup} style={{ border: "1px solid #ececec", borderRadius: 8, padding: 16 }}>
          <p style={{ marginTop: 0, fontSize: 13 }}>
            1. Add this key to an authenticator app (Google Authenticator, Authy, 1Password, etc.) — either paste the key manually, or paste the full setup link if your app accepts one.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#f7f7f5", padding: "8px 10px", borderRadius: 6, fontFamily: "monospace", fontSize: 13, marginBottom: 6, wordBreak: "break-all" }}>
            {setupSecret.secret}
            <button type="button" onClick={copySecret} style={{ background: "none", border: "none", cursor: "pointer", flexShrink: 0 }} title="Copy">
              {copied ? <Check size={16} color="#038849" /> : <Copy size={16} />}
            </button>
          </div>
          <p style={{ fontSize: 12, color: "#888", marginBottom: 16, wordBreak: "break-all" }}>{setupSecret.otpauthUri}</p>
          <p style={{ fontSize: 13, marginBottom: 8 }}>2. Enter the 6-digit code your app is now showing:</p>
          <input
            placeholder="123456"
            value={confirmCode}
            onChange={(e) => setConfirmCode(e.target.value)}
            style={{ width: "100%", padding: "10px 12px", border: "1px solid #ddd", borderRadius: 6, marginBottom: 12, fontSize: 16, letterSpacing: 2 }}
            autoFocus
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="blackButton" disabled={busy || confirmCode.trim().length === 0}>{busy ? "Verifying…" : "Confirm & enable"}</button>
            <button type="button" onClick={() => { setSetupSecret(null); setConfirmCode(""); setError(null); }} style={{ background: "none", border: "none", textDecoration: "underline", cursor: "pointer", fontSize: 13, color: "#666" }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {user.mfaEnabled && !disabling && (
        <button
          onClick={() => setDisabling(true)}
          style={{ background: "none", border: "1px solid #ddd", borderRadius: 6, padding: "8px 14px", cursor: "pointer", fontSize: 13, color: "#c00" }}
        >
          Turn off two-factor authentication
        </button>
      )}

      {disabling && (
        <form onSubmit={confirmDisable} style={{ border: "1px solid #f3c9c9", background: "#fff5f5", borderRadius: 8, padding: 16 }}>
          <p style={{ marginTop: 0, fontSize: 13, color: "#900" }}>Confirm your password to turn off two-factor authentication.</p>
          <input
            type="password"
            placeholder="Current password"
            value={disablePassword}
            onChange={(e) => setDisablePassword(e.target.value)}
            style={{ width: "100%", padding: "10px 12px", border: "1px solid #ddd", borderRadius: 6, marginBottom: 12 }}
            autoFocus
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="blackButton" disabled={busy || !disablePassword}>{busy ? "Turning off…" : "Confirm, turn off"}</button>
            <button type="button" onClick={() => { setDisabling(false); setDisablePassword(""); setError(null); }} style={{ background: "none", border: "none", textDecoration: "underline", cursor: "pointer", fontSize: 13, color: "#666" }}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
