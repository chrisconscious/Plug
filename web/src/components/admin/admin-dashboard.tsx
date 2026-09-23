"use client";

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from "recharts";
import { ChevronRight, Download, RefreshCw, Inbox, ShoppingBag, Users, Package } from "lucide-react";
import * as api from "../../lib/api";
import { buildSalesSeries, ordersByStatusData, type Granularity } from "../../lib/analytics";
import { formatTZS } from "../../lib/currency";

function StatCard({ label, value, delta, Icon }: { label: string; value: string; delta: string; Icon: any }) {
  return (
    <div className="statCard">
      <span>{label}</span>
      <h2>{value}</h2>
      <small><Icon size={12} /> {delta}</small>
    </div>
  );
}

function recentOrdersRows(orders: api.AdminOrder[]): string[] {
  if (!orders || orders.length === 0) return [];
  const rows: string[] = [];
  for (const o of orders.slice(0, 5)) {
    rows.push(`#${o.id.slice(0, 8).toUpperCase()} — ${o.items?.[0]?.nameSnapshot ?? 'Order'} — ${o.status}`);
    rows.push(`${formatTZS(o.totalTzs ?? o.totalCents ?? 0)} — ${new Date(o.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`);
  }
  return rows;
}

function toCSV(rows: (string | number)[][]): string {
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
}

export function DynamicDashboard({ superRole }: { superRole: boolean }) {
  const [stats, setStats] = useState<api.AdminStats | null>(null);
  const [orders, setOrders] = useState<api.AdminOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gran, setGran] = useState<Granularity>("daily");
  const [exportMsg, setExportMsg] = useState("");

  const load = async () => {
    setLoading(true); setError(null); setExportMsg("");
    try {
      const [s, o] = await Promise.all([api.getAdminStats(), api.listAdminOrders()]);
      setStats(s); setOrders(o.orders ?? []);
    } catch (e) {
      setError(e instanceof api.ApiError ? e.message : "Could not load dashboard data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const salesSeries = useMemo(
    () => buildSalesSeries(orders, gran),
    [orders, gran]
  );

  const statusData = useMemo(
    () => ordersByStatusData(stats?.orderStatusCounts ?? {}),
    [stats?.orderStatusCounts]
  );

  const handleExport = () => {
    const rows: (string | number)[][] = [
      ["Metric", "Value"],
      ["Orders", stats?.totals?.orders ?? 0],
      ["Revenue (TZS)", stats?.totals?.revenueTzs ?? stats?.totals?.revenueCents ?? 0],
      ["Products", stats?.totals?.products ?? 0],
      ["Customers", stats?.totals?.customers ?? 0],
      ["Admins", stats?.totals?.admins ?? 0],
      [],
      ["Period", gran.toUpperCase()],
      ...salesSeries.map((s) => [s.label, `Revenue ${s.revenue}`, `Orders ${s.orders}`]),
    ];
    const blob = new Blob([toCSV(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "plug-super-admin-report.csv"; a.click();
    URL.revokeObjectURL(url);
    setExportMsg("Report exported ✓");
    setTimeout(() => setExportMsg(""), 2500);
  };

  if (loading && !stats) {
    return <div className="dashboard"><p style={{ padding: '40px 0', color: '#777' }}>Loading dashboard data…</p></div>;
  }

  if (error && !stats) {
    return (
      <div className="dashboard">
        <p style={{ padding: '20px 0', color: '#c00' }}>Could not load dashboard data. Please ensure the backend is running and you are signed in as a Super Admin.</p>
        <button className="blackButton" onClick={load}><RefreshCw size={15} /> Retry</button>
        <div className="adminIntro" style={{ marginTop: 24 }}>
          <p style={{ color: '#666', maxWidth: 520 }}>Preview mode showing a representative snapshot while data loads.</p>
        </div>
        <PlaceholderStats superRole={superRole} />
      </div>
    );
  }

  const t = stats?.totals;

  return (
    <div className="dashboard">
      <div className="adminToolRow" style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 18, flexWrap: 'wrap' }}>
        <select
          value={gran}
          onChange={(e) => setGran(e.target.value as Granularity)}
          style={{ border: '1px solid #ddd', background: '#fff', padding: '10px 13px', fontSize: 11, fontWeight: 600 }}
        >
          <option value="daily">Sales — Daily</option>
          <option value="weekly">Sales — Weekly</option>
          <option value="monthly">Sales — Monthly</option>
        </select>
        <button className="blackButton" onClick={handleExport} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Download size={14} /> Export Report
        </button>
        <button onClick={load} style={{ border: '1px solid #ddd', background: '#fff', padding: '10px 13px', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <RefreshCw size={13} /> Refresh
        </button>
        {exportMsg && <span style={{ fontSize: 11, color: '#018849', fontWeight: 600 }}>{exportMsg}</span>}
        {!superRole && <span style={{ fontSize: 10, color: '#888' }}>You have read access. Some actions are Super Admin only.</span>}
      </div>

      <div className="statGrid">
        <StatCard label="Total Sales" value={formatTZS((t?.revenueTzs ?? 0) > 0 ? (t?.revenueTzs ?? 0) : (t?.revenueCents ?? 0))} delta="Revenue" Icon={Package} />
        <StatCard label="Total Orders" value={String(t?.orders ?? 0)} delta={t?.orders ? 'orders' : 'No orders yet'} Icon={Inbox} />
        <StatCard label="Total Products" value={String(t?.products ?? 0)} delta={`${t?.brands ?? 0} brands / ${t?.categories ?? 0} categories`} Icon={ShoppingBag} />
        <StatCard label="Customers" value={String(t?.customers ?? 0)} delta={`${t?.users ?? 0} total users`} Icon={Users} />
        <StatCard label="Admins" value={String(t?.admins ?? 0)} delta={`${(stats?.topCustomers?.length ?? 0)} active accounts`} Icon={Users} />
      </div>

      <div className="chartGrid">
        <div className="panel chart">
          <div className="panelTitle">Sales Overview <span style={{ fontSize: 10, color: '#999' }}>{gran === 'daily' ? 'Last 14 days' : gran === 'weekly' ? 'Last 8 weeks' : 'Last 12 months'}</span></div>
          <div style={{ height: 240, marginTop: 8 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={salesSeries} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#111" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#111" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#999' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#999' }} tickLine={false} axisLine={false} tickFormatter={(v: number) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)} />
                <Tooltip formatter={(v: number) => [formatTZS(v), 'Revenue']} labelStyle={{ fontSize: 11 }} contentStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="revenue" stroke="#111" strokeWidth={2} fill="url(#revGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel">
          <div className="panelTitle">Orders by Status</div>
          {statusData.length > 0 ? (
            <>
              <div className="donut" style={{ height: 150 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={2}>
                      {statusData.map((s) => <Cell key={s.name} fill={s.color} />)}
                    </Pie>
                    <Tooltip formatter={(v: number, n: string) => [v, n]} contentStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="legend">
                {statusData.map((s) => <li key={s.name}>{s.name} {s.value}</li>)}
              </ul>
            </>
          ) : (
            <div style={{ padding: '20px 0', color: '#888', fontSize: 12 }}>No orders yet — status distribution will appear here once orders are placed.</div>
          )}
        </div>

        <div className="panel">
          <div className="panelTitle">{superRole ? 'Recent Orders' : 'Orders Activity'}</div>
          {orders.length > 0 ? (
            recentOrdersRows(orders).map((r, i) => <div className="dataRow" key={i}><span>{r}</span><b>{i % 2 === 0 ? 'View' : '·'}</b></div>)
          ) : (
            <div className="dataRow"><span>No orders placed yet</span><b>·</b></div>
          )}
        </div>
      </div>

      <div className="lowerGrid">
        <div className="panel dataPanel">
          <div className="panelTitle">{superRole ? 'System Overview' : 'Top Selling Products'}</div>
          {superRole ? (
            <>
              <div className="dataRow"><span>Server status</span><b className="status">Operational</b></div>
              <div className="dataRow"><span>Database</span><b className="status">Operational</b></div>
              <div className="dataRow"><span>Products</span><b>{t?.products ?? 0}</b></div>
              <div className="dataRow"><span>Order queue</span><b>{t?.orders ?? 0}</b></div>
            </>
          ) : (
            <ProductsMini orders={orders} />
          )}
        </div>

        <div className="panel dataPanel">
          <div className="panelTitle">{superRole ? 'Total Orders by Status' : 'Recent Customers'}</div>
          <div style={{ height: 150 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={statusData.length ? statusData : [{ name: 'No orders', value: 0 }]}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#999' }} tickLine={false} axisLine={false} />
                <YAxis hide />
                <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                  {statusData.map((s) => <Cell key={s.name} fill={s.color} />)}
                </Bar>
                <Tooltip contentStyle={{ fontSize: 11 }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <QuickActions superRole={superRole} />
      </div>
    </div>
  );
}

function ProductsMini({ orders }: { orders: api.AdminOrder[] }) {
  return (
    <>
      {(orders.length ? orders.slice(0, 4) : []).map((o, i) => (
        <div className="dataRow" key={i}><span>{o.items?.[0]?.nameSnapshot ?? `Order #${o.id.slice(0, 8)}`}</span><b>{formatTZS(o.totalTzs ?? o.totalCents ?? 0)}</b></div>
      ))}
      {orders.length === 0 && <div className="dataRow"><span>No sell-through data yet</span><b>·</b></div>}
    </>
  );
}

function PlaceholderStats({ superRole }: { superRole: boolean }) {
  const items = superRole
    ? [['Total Sales', '—'], ['Total Orders', '—'], ['Total Products', '—'], ['Customers', '—'], ['Admins', '—']]
    : [['Total Sales', '—'], ['Total Orders', '—'], ['Total Products', '—'], ['Stock', '—']];
  return (
    <div className="statGrid">
      {items.map(([l, v]) => <div className="statCard" key={l}><span>{l}</span><h2>{v}</h2><small>Awaiting connection</small></div>)}
    </div>
  );
}

function QuickActions({ superRole }: { superRole: boolean }) {
  const actions = superRole
    ? [["Add New Admin", "/super-admin/admins"], ["Add New Product", "/super-admin/products"], ["Orders", "/super-admin/orders"], ["Activity Logs", "/super-admin/activity"]]
    : [["Add New Product", "/admin/products"], ["Orders", "/admin/orders"], ["Manage Catalog", "/admin/catalog"], ["View Reports", "/admin/reports"]];
  return (
    <div className="panel dataPanel">
      <div className="panelTitle">Quick Actions</div>
      {actions.map(([label, to]) => (
        <Link key={label} to={to} className="quick" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          {label} <ChevronRight size={15} />
        </Link>
      ))}
    </div>
  );
}
