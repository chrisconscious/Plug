import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import { ChevronRight, RefreshCw, Inbox, ShoppingBag, Users, Package, AlertTriangle } from "lucide-react";
import * as api from "../../lib/api";
import { formatTZS } from "../../lib/currency";
import { userMessage } from "../../lib/errors";
import { ORDER_STATUS_LABEL, orderRef } from "../../lib/orderStatus";
import { SalesChart } from "./reports";

const STATUS_COLORS: Record<api.Order["status"], string> = {
  PENDING: "#d97706",
  PAID: "#018849",
  SHIPPED: "#b09a5a",
  DELIVERED: "#111111",
  CANCELLED: "#9aa0a8",
};

function StatCard({ label, value, hint, Icon, to }: { label: string; value: string; hint: string; Icon: typeof Package; to?: string }) {
  const body = (
    <>
      <span>{label}</span>
      <h2>{value}</h2>
      <small style={{ color: "#666" }}><Icon size={12} /> {hint}</small>
    </>
  );
  return to ? <Link to={to} className="statCard" style={{ color: "inherit", textDecoration: "none" }}>{body}</Link> : <div className="statCard">{body}</div>;
}

/**
 * Admin / Super Admin dashboard. Every figure comes from the API
 * (GET /admin/stats — all-time SQL aggregates, and GET /admin/reports for
 * the sales chart); nothing here is invented, sampled or hard-coded.
 */
export function DynamicDashboard({ superRole }: { superRole: boolean }) {
  const base = superRole ? "/super-admin" : "/admin";
  const [stats, setStats] = useState<api.AdminStats | null>(null);
  const [report, setReport] = useState<api.AdminReport | null>(null);
  const [gran, setGran] = useState<api.ReportGranularity>("daily");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  const load = async (g = gran) => {
    setStatus("loading");
    try {
      const [s, r] = await Promise.all([api.getAdminStats(), api.getAdminReport(g)]);
      setStats(s); setReport(r); setStatus("ready");
    } catch (e) {
      setError(userMessage(e, "Could not load dashboard data."));
      setStatus("error");
    }
  };
  useEffect(() => { load(gran); }, [gran]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!stats && status === "loading") return <div className="dashboard"><p style={{ padding: "40px 0", color: "#777" }}>Loading dashboard…</p></div>;
  if (!stats) {
    return (
      <div className="dashboard" role="alert">
        <p style={{ padding: "20px 0", color: "#c00" }}>{error}</p>
        <button className="blackButton" onClick={() => load()}><RefreshCw size={15} /> Try again</button>
      </div>
    );
  }

  const t = stats.totals;
  const statusData = (Object.entries(stats.orderStatusCounts) as [api.Order["status"], number][])
    .filter(([, n]) => n > 0)
    .map(([s, n]) => ({ name: ORDER_STATUS_LABEL[s], value: n, color: STATUS_COLORS[s] }));

  return (
    <div className="dashboard" data-role="dashboard">
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 18, flexWrap: "wrap" }}>
        <select aria-label="Sales chart period" value={gran} onChange={(e) => setGran(e.target.value as api.ReportGranularity)} style={{ border: "1px solid #ddd", background: "#fff", padding: "10px 13px", fontSize: 11, fontWeight: 600 }}>
          <option value="daily">Sales — Daily</option>
          <option value="weekly">Sales — Weekly</option>
          <option value="monthly">Sales — Monthly</option>
        </select>
        <button onClick={() => load()} style={{ border: "1px solid #ddd", background: "#fff", padding: "10px 13px", fontSize: 11, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <RefreshCw size={13} /> Refresh
        </button>
        <Link to={`${base}/reports`} style={{ fontSize: 11, fontWeight: 700 }}>FULL REPORTS →</Link>
        {status === "error" && <span role="alert" style={{ fontSize: 11, color: "#c00" }}>{error}</span>}
      </div>

      <div className="statGrid">
        <StatCard label="Paid revenue" value={formatTZS(t.paidRevenueTzs)} hint={`${formatTZS(t.orderValueTzs)} ordered (not cancelled)`} Icon={Package} to={`${base}/reports`} />
        <StatCard label="Orders" value={String(t.orders)} hint={t.pendingOrders ? `${t.pendingOrders} awaiting payment` : "None awaiting payment"} Icon={Inbox} to={`${base}/orders`} />
        <StatCard label="Products" value={String(t.liveProducts)} hint={`live of ${t.products} · ${t.brands} brands · ${t.categories} categories`} Icon={ShoppingBag} to={`${base}/products`} />
        <StatCard label="Customers" value={String(t.customers)} hint={superRole ? `${t.admins} staff accounts` : "registered accounts"} Icon={Users} to={superRole ? `${base}/users` : `${base}/customers`} />
        <StatCard label="Stock alerts" value={String(t.lowStockVariants + t.outOfStockVariants)} hint={`${t.outOfStockVariants} sold out · ${t.lowStockVariants} low`} Icon={AlertTriangle} to={`${base}/inventory`} />
      </div>

      <div className="chartGrid">
        <div className="panel chart">
          <div className="panelTitle">Sales overview</div>
          <div style={{ height: 240, marginTop: 8 }}>{report ? <SalesChart report={report} /> : null}</div>
        </div>

        <div className="panel">
          <div className="panelTitle">Orders by status</div>
          {statusData.length > 0 ? (
            <>
              <div style={{ height: 150 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={2}>
                      {statusData.map((s) => <Cell key={s.name} fill={s.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="legend">{statusData.map((s) => <li key={s.name}><span style={{ color: s.color }}>●</span> {s.name} {s.value}</li>)}</ul>
            </>
          ) : (
            <p style={{ padding: "20px 0", color: "#888", fontSize: 12 }}>No orders yet.</p>
          )}
        </div>

        <div className="panel">
          <div className="panelTitle">Recent orders <Link to={`${base}/orders`} style={{ fontSize: 10 }}>ALL</Link></div>
          {stats.recentOrders.length === 0 ? (
            <p style={{ color: "#888", fontSize: 12 }}>No orders placed yet.</p>
          ) : stats.recentOrders.map((o) => (
            <Link key={o.id} to={`/admin/orders/${o.id}`} className="dataRow" style={{ color: "inherit", textDecoration: "none" }}>
              <span>{orderRef(o.id)} · {o.customer ?? "Customer"}<br /><small style={{ color: "#888" }}>{o.firstItem ?? ""}{o.items > 1 ? ` +${o.items - 1}` : ""}</small></span>
              <b style={{ color: STATUS_COLORS[o.status] }}>{formatTZS(o.totalTzs)}<br /><small>{ORDER_STATUS_LABEL[o.status]}</small></b>
            </Link>
          ))}
        </div>
      </div>

      <div className="lowerGrid">
        <div className="panel dataPanel">
          <div className="panelTitle">Low stock <Link to={`${base}/inventory`} style={{ fontSize: 10 }}>INVENTORY</Link></div>
          {stats.lowStock.length === 0 ? <p style={{ color: "#888", fontSize: 12 }}>Nothing is running low.</p> : stats.lowStock.map((v) => (
            <div className="dataRow" key={v.variantId}>
              <span>{v.productName} <small style={{ color: "#888" }}>{[v.color, v.size].filter(Boolean).join(" / ")}</small></span>
              <b style={{ color: v.stockQty === 0 ? "#b91c1c" : "#a36d15" }}>{v.stockQty === 0 ? "Sold out" : `${v.stockQty} left`}</b>
            </div>
          ))}
        </div>

        <div className="panel dataPanel">
          <div className="panelTitle">{superRole ? "Top customers" : "Newest customers"}</div>
          {superRole ? (
            stats.topCustomers.length === 0 ? <p style={{ color: "#888", fontSize: 12 }}>No purchases yet.</p> : stats.topCustomers.map((c) => (
              <div className="dataRow" key={c.id}><span>{c.name ?? "Customer"} <small style={{ color: "#888" }}>{c.orders} orders</small></span><b>{formatTZS(c.spentTzs)}</b></div>
            ))
          ) : (
            stats.recentCustomers.length === 0 ? <p style={{ color: "#888", fontSize: 12 }}>No customers yet.</p> : stats.recentCustomers.map((c) => (
              <div className="dataRow" key={c.id}><span>{c.name ?? "Customer"}</span><b>{new Date(c.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</b></div>
            ))
          )}
        </div>

        <QuickActions superRole={superRole} />
      </div>
    </div>
  );
}

function QuickActions({ superRole }: { superRole: boolean }) {
  const actions = superRole
    ? [["Add New Admin", "/super-admin/admins"], ["Add New Product", "/super-admin/products"], ["Orders", "/super-admin/orders"], ["Activity Logs", "/super-admin/activity"]]
    : [["Add New Product", "/admin/products"], ["Orders", "/admin/orders"], ["Manage Catalog", "/admin/catalog"], ["Reports", "/admin/reports"]];
  return (
    <div className="panel dataPanel">
      <div className="panelTitle">Quick actions</div>
      {actions.map(([label, to]) => (
        <Link key={label} to={to} className="quick" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
          {label} <ChevronRight size={15} />
        </Link>
      ))}
    </div>
  );
}
