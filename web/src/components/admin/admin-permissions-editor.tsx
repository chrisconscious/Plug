"use client";

import { useEffect, useState } from "react";
import { X, Lock, Key, Save, ShieldCheck } from "lucide-react";
import * as api from "../../lib/api";
import { redirectToLoginExpired } from "../../lib/returnTo";

/** Permissions that a Super Admin may NEVER grant to an Admin — see rbac.ts NON_GRANTABLE_PERMISSIONS. */
const NON_GRANTABLE = ["admins.manage", "system.manage"];

function handleAuthError(e: unknown, setError: (m: string) => void): boolean {
  if (e instanceof api.ApiError && e.status === 401) {
    api.logout().catch(() => {});
    redirectToLoginExpired();
    return true;
  }
  return false;
}

/**
 * Full-screen overlay that lets a Super Admin choose exactly which extra
 * permissions an Admin account may hold beyond the hard-coded role matrix.
 *
 * Props:
 *   admin  – the AdminRow currently being edited (from FunctionalManagementPage)
 *   onClose – dismiss the overlay
 *   onSaved – callback after a successful save (parent refreshes the list)
 */
export function AdminPermissionsEditor({ admin, onClose, onSaved }: { admin: { id: string; email: string | null; role: string; disabled: boolean }; onClose: () => void; onSaved: () => Promise<void> }) {
  const [permissions, setPermissions] = useState<api.RbacPermissionInfo[]>([]);
  const [rolePermissions, setRolePermissions] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [rbac, admPerms] = await Promise.all([api.getRbac(), api.getAdminPermissions(admin.id)]);
        if (!alive) return;
        // Find the admin's role in the RBAC matrix to get role-based permissions
        const roleEntry = rbac.roles.find((r) => r.role === admin.role);
        const roleCodes = roleEntry?.permissions ?? [];
        setPermissions(rbac.permissions);
        setRolePermissions(roleCodes);
        // Grants are the "extra" permissions beyond the role
        const grantCodes = new Set(admPerms.grants.map((g) => g.permissionCode));
        setSelected(grantCodes);
      } catch (e) {
        if (!handleAuthError(e, setError)) setError(e instanceof api.ApiError ? e.message : "Could not load permissions.");
      } finally { setLoading(false); }
    })();
    return () => { alive = false; };
  }, [admin.id, admin.role]);

  const toggle = (code: string) => setSelected((prev) => { const next = new Set(prev); if (next.has(code)) { next.delete(code); } else { next.add(code); } return next; });

  const handleSave = async () => {
    const actorPassword = window.prompt(`Enter your current password to confirm: update permissions for ${admin.email}`);
    if (!actorPassword) return;
    setSaving(true); setError(null);
    try {
      await api.setAdminPermissions(admin.id, [...selected], actorPassword);
      setBanner("Permissions saved ✓");
      setTimeout(() => { setBanner(""); onSaved(); }, 1500);
    } catch (e) {
      if (!handleAuthError(e, setError)) setError(e instanceof api.ApiError ? e.message : "Could not save permissions");
    } finally { setSaving(false); }
  };

  if (loading) return (
    <div style={overlayStyle}>
      <div style={panelStyle}><p style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading…</p></div>
    </div>
  );

  return (
    <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={panelStyle}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #e8e8e8', padding: '16px 20px' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Key size={18} />
              Permissions — {admin.email}
            </div>
            <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
              {admin.role} account · checkboxes add <em>extra</em> permissions beyond the role · toggles take effect immediately
            </div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 6 }}><X size={18} /></button>
        </div>

        {banner && <div style={{ margin: '12px 20px', padding: '10px 14px', background: '#eef8f1', color: '#018849', fontSize: 13, borderRadius: 6, border: '1px solid #d5efe0' }}>{banner}</div>}
        {error && <div style={{ margin: '12px 20px', padding: '10px 14px', background: '#fdecea', color: '#a11', fontSize: 13, borderRadius: 6, border: '1px solid #f3c4c0' }}>{error}</div>}

        {/* Body: permission list */}
        <div style={{ padding: '16px 20px', overflowY: 'auto', maxHeight: 'calc(100vh - 180px)' }}>
          {permissions.map((p) => {
            const inherited = rolePermissions.includes(p.code);
            const nonGrantable = NON_GRANTABLE.includes(p.code);
            const checked = selected.has(p.code);
            const disabled = inherited || nonGrantable;

            return (
              <label
                key={p.code}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '12px 14px',
                  border: `1px solid ${checked && !disabled ? '#111' : '#ececec'}`,
                  borderRadius: 8,
                  marginBottom: 8,
                  background: disabled ? '#f9f9f9' : checked ? '#111' : '#fff',
                  color: disabled ? '#999' : checked ? '#fff' : '#333',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => toggle(p.code)}
                  style={{ marginTop: 2, flexShrink: 0 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, fontWeight: 700, letterSpacing: -0.3 }}>{p.code}</code>
                    {inherited && (
                      <span style={{ fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 3, opacity: 0.7, border: `1px solid ${checked ? 'rgba(255,255,255,0.25)' : '#ddd'}`, borderRadius: 999, padding: '2px 8px' }}>
                        <Lock size={10} /> inherited from {admin.role}
                      </span>
                    )}
                    {nonGrantable && !inherited && (
                      <span style={{ fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 3, opacity: 0.7, border: `1px solid ${checked ? 'rgba(255,255,255,0.25)' : '#ddd'}`, borderRadius: 999, padding: '2px 8px' }}>
                        <ShieldCheck size={10} /> SUPER_ADMIN only
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, marginTop: 3, opacity: 0.75, lineHeight: 1.4 }}>{p.description}</div>
                </div>
              </label>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ borderTop: '1px solid #e8e8e8', padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#888' }}>
            {selected.size} extra permission{selected.size === 1 ? '' : 's'} granted · {rolePermissions.length} inherited from role
          </span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="blackButton" onClick={onClose}>Close</button>
            <button className="blackButton" disabled={saving} onClick={handleSave} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Save size={14} /> {saving ? 'Saving…' : 'Save permissions'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999, fontFamily: 'ui-sans-serif, system-ui, sans-serif' };
const panelStyle: React.CSSProperties = { background: '#fff', borderRadius: 14, width: '95vw', maxWidth: 720, maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 60px rgba(0,0,0,0.25)' };