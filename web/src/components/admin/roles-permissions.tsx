"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, RefreshCw, Check, Minus, ArrowUp, ArrowDown, X } from "lucide-react";
import * as api from "../../lib/api";

function handleAuthError(e: unknown, setError: (m: string) => void): boolean {
  if (e instanceof api.ApiError && e.status === 401) {
    api.logout().catch(() => {});
    window.location.assign("/login?reason=expired");
    return true;
  }
  return false;
}

export function RolesPermissionsPage() {
  const [permissions, setPermissions] = useState<api.RbacPermissionInfo[]>([]);
  const [roles, setRoles] = useState<api.RbacRoleInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await api.getRbac();
      setPermissions(r.permissions);
      setRoles(r.roles);
    } catch (e) {
      if (!handleAuthError(e, setError)) setError(e instanceof api.ApiError ? e.message : "Could not load the access-control matrix.");
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const toggleRole = async (member: api.RbacRoleMember, role: "ADMIN" | "SUPER_ADMIN") => {
    const next = role === "SUPER_ADMIN" ? "ADMIN" : "SUPER_ADMIN";
    const actorPassword = window.prompt(`Enter your current password to confirm: change ${member.email ?? "this admin"} → ${next}`);
    if (!actorPassword) return; // cancelled
    setBusyId(member.id);
    try {
      await api.changeAdminRole(member.id, next, actorPassword);
      setBanner(`${member.email} role → ${next}`);
      setTimeout(() => setBanner(""), 3000);
      await load();
    } catch (e) {
      if (!handleAuthError(e, setError)) setError(e instanceof api.ApiError ? e.message : "Could not change role");
    } finally { setBusyId(null); }
  };

  if (loading) return <p style={{ padding: 24 }}>Loading…</p>;
  if (error && permissions.length === 0) return <p style={{ padding: 24, color: "#c00" }}>{error}</p>;

  const adminRoles: (api.RbacRoleInfo & { role: "ADMIN" | "SUPER_ADMIN" })[] = roles.filter(
    (r): r is api.RbacRoleInfo & { role: "ADMIN" | "SUPER_ADMIN" } => r.admin
  );

  return (
    <div style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#666' }}>
          <ShieldCheck size={18} />
          <span>Permission catalog plus which admin accounts hold each role. Permission — role assignments are enforced server-side on every request.</span>
        </div>
        <button className="blackButton" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={load}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {banner && <div style={{ background: '#e9f7ef', border: '1px solid #bfe3cd', color: '#0b6b3a', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16 }}>{banner}</div>}
      {error && <div style={{ background: '#fdecea', border: '1px solid #f3c4c0', color: '#a11', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16 }}>{error}</div>}

      {/* Role cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14, marginBottom: 22 }}>
        {roles.map((r) => (
          <div key={r.role} style={{ border: '1px solid #ececec', borderRadius: 10, padding: 16, background: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{r.label}</div>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: r.role === "SUPER_ADMIN" ? '#111' : r.role === "ADMIN" ? '#1f6feb' : '#9ca3af', flexShrink: 0 }} />
            </div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 10, minHeight: 42 }}>{r.description}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11, color: '#555' }}>
              <span style={{ border: '1px solid #e3e3e3', borderRadius: 999, padding: '3px 9px', background: '#fafafa' }}>{r.permissions.length} permission{r.permissions.length === 1 ? "" : "s"}</span>
              {r.admin && <span style={{ border: '1px solid #e3e3e3', borderRadius: 999, padding: '3px 9px', background: '#fafafa' }}>{r.members.length} admin{r.members.length === 1 ? "" : "s"}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Permission matrix */}
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>Permission matrix</div>
      <div style={{ overflowX: 'auto', border: '1px solid #e5e5e5', borderRadius: 10, background: '#fff', marginBottom: 26 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 640 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '10px 14px', borderBottom: '1px solid #ececec', color: '#555', fontWeight: 700 }}>Permission</th>
              {roles.map((r) => <th key={r.role} style={{ textAlign: 'center', padding: '10px 12px', borderBottom: '1px solid #ececec', color: '#555', fontWeight: 700 }}>{r.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {permissions.map((p) => (
              <tr key={p.code} style={{ borderBottom: '1px solid #f2f2f2' }}>
                <td style={{ padding: '9px 14px' }}>
                  <div style={{ fontWeight: 600, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{p.code}</div>
                  <div style={{ color: '#888', fontSize: 12, marginTop: 1 }}>{p.description}</div>
                </td>
                {roles.map((r) => {
                  const has = r.permissions.includes(p.code);
                  return (
                    <td key={r.role} style={{ textAlign: 'center', padding: '9px 12px' }}>
                      {has
                        ? <Check size={16} style={{ color: '#0b6b3a', display: 'inline' }} />
                        : <Minus size={16} style={{ color: '#d6d6d6', display: 'inline' }} />}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Role membership */}
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>Admins by role</div>
      {adminRoles.map((r) => (
        <div key={r.role} style={{ border: '1px solid #ececec', borderRadius: 10, background: '#fff', marginBottom: 14, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>{r.label}</span>
            <span style={{ fontSize: 12, fontWeight: 500, color: '#888' }}>{r.members.length} account{r.members.length === 1 ? "" : "s"}</span>
          </div>
          {r.members.length === 0 ? (
            <div style={{ padding: '14px 16px', fontSize: 13, color: '#999' }}>No admins hold this role yet.</div>
          ) : (
            r.members.map((m) => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid #f5f5f5' }}>
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: r.role === "SUPER_ADMIN" ? '#111' : '#1f6feb', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                  {(m.email ?? "A")[0].toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.email ?? "(no email)"}</div>
                  <div style={{ fontSize: 11, color: m.disabled ? '#b45309' : '#0b6b3a' }}>{m.disabled ? "Suspended" : "Active"}</div>
                </div>
                {m.disabled ? (
                  <span style={{ fontSize: 12, color: '#aaa' }} title="Re-activate this admin in Admin Management before changing their role">No role change</span>
                ) : (
                  <button
                    className="blackButton"
                    disabled={busyId === m.id}
                    onClick={() => toggleRole(m, r.role)}
                    title={`Change ${m.email} to ${r.role === "SUPER_ADMIN" ? "ADMIN" : "SUPER_ADMIN"}`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, padding: '7px 12px' }}
                  >
                    {busyId === m.id ? <X size={13} /> : r.role === "SUPER_ADMIN" ? <ArrowDown size={13} /> : <ArrowUp size={13} />}
                    {r.role === "SUPER_ADMIN" ? "Demote" : "Promote"}
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      ))}
    </div>
  );
}