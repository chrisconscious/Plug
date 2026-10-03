import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Trash2, X } from "lucide-react";
import * as api from "../../lib/api";
import { formatTZS } from "../../lib/currency";
import { userMessage } from "../../lib/errors";
import { ORDER_STATUS_LABEL } from "../../lib/orderStatus";
import { confirmAndDeleteUser } from "./user-delete";

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

/** Account details for one customer: profile, order history and saved addresses. */
export function UserDetailsModal({ userId, canDelete, onClose, onDeleted }: {
  userId: string;
  canDelete: boolean;
  onClose: () => void;
  onDeleted: (message: string) => void;
}) {
  const [data, setData] = useState<api.AdminUserDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api.getAdminUserDetails(userId)
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setError(userMessage(e, "Could not load this account.")); });
    return () => { alive = false; };
  }, [userId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const u = data?.user;
  const name = u ? (u.fullName || u.email || u.phoneNumber || (u.deletedAt ? "Deleted account" : "Customer")) : "";

  const remove = async () => {
    if (!data || !u) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await confirmAndDeleteUser({ id: u.id, name, orderCount: data.orders.length });
      if (outcome) onDeleted(outcome === "deleted" ? `${name}'s account was deleted.` : `${name}'s account was deleted. Their orders were kept.`);
    } catch (e) {
      setError(userMessage(e, "Could not delete this account."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="userDetailOverlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="userDetailPanel" role="dialog" aria-modal="true" aria-label={name ? `Account details: ${name}` : "Account details"}>
        <div className="userDetailHead">
          <div style={{ minWidth: 0 }}>
            <div className="userDetailTitle">{name || "Account details"}</div>
            {u && <div className="userDetailSub">{u.role === "CUSTOMER" ? "Customer" : u.role === "SUPER_ADMIN" ? "Super Admin" : "Admin"} · joined {fmtDate(u.createdAt)}</div>}
          </div>
          <button type="button" className="userDetailClose" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="userDetailBody">
          {error && <div className="userDetailError">{error}</div>}
          {!data && !error && <p className="userDetailMuted">Loading…</p>}
          {data && u && (
            <>
              {u.deletedAt && <div className="userDetailNote">This account was deleted on {fmtDate(u.deletedAt)}. Its personal details were erased; its orders are kept.</div>}

              <dl className="userDetailGrid">
                <div><dt>Name</dt><dd>{u.fullName || "—"}</dd></div>
                <div><dt>Phone</dt><dd>{u.phoneNumber ? <a href={`tel:${u.phoneNumber}`}>{u.phoneNumber}</a> : "—"}</dd></div>
                <div><dt>Email</dt><dd>{u.email ? <><a href={`mailto:${u.email}`}>{u.email}</a>{u.emailVerified ? " · verified" : " · not verified"}</> : "—"}</dd></div>
                <div><dt>Status</dt><dd>{u.deletedAt ? "Deleted" : u.disabled ? "Disabled" : "Active"}</dd></div>
                <div><dt>Last sign-in</dt><dd>{fmtDate(u.lastLoginAt)}</dd></div>
                <div><dt>Orders · spent</dt><dd>{data.stats.orderCount} · {formatTZS(data.stats.totalSpentTzs)}</dd></div>
              </dl>

              <h4 className="userDetailSection">Orders</h4>
              {data.orders.length === 0 ? <p className="userDetailMuted">No orders yet.</p> : (
                <ul className="userDetailList">
                  {data.orders.map((o) => (
                    <li key={o.id}>
                      <Link to={`/admin/orders/${o.id}`}>#{o.id.slice(0, 8).toUpperCase()}</Link>
                      <span>{fmtDate(o.createdAt)} · {o.itemCount} item{o.itemCount === 1 ? "" : "s"}</span>
                      <span>{ORDER_STATUS_LABEL[o.status] ?? o.status}</span>
                      <b>{formatTZS(o.totalTzs)}</b>
                    </li>
                  ))}
                </ul>
              )}

              <h4 className="userDetailSection">Saved addresses</h4>
              {data.addresses.length === 0 ? <p className="userDetailMuted">No saved addresses.</p> : (
                <ul className="userDetailList">
                  {data.addresses.map((a) => (
                    <li key={a.id} style={{ display: "block" }}>
                      <b>{a.label}{a.isDefault ? " · default" : ""}</b>
                      <div className="userDetailMuted">{[a.line1, a.line2, a.city, a.region, a.country].filter(Boolean).join(", ")}{a.phone ? ` · ${a.phone}` : ""}</div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        {canDelete && u && u.role === "CUSTOMER" && !u.deletedAt && (
          <div className="userDetailFoot">
            <button type="button" className="userDetailDelete" disabled={busy} onClick={remove}>
              <Trash2 size={14} /> {busy ? "Deleting…" : "Delete account"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
