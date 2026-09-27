import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { Download, RefreshCw } from "lucide-react";
import * as api from "../../lib/api";
import { formatTZS } from "../../lib/currency";
import { userMessage } from "../../lib/errors";
import { ORDER_STATUS_LABEL } from "../../lib/orderStatus";

/** "2026-09-14" → "Sep 14" / "w/c Sep 14" / "Sep 2026", read as a calendar date (no timezone shift). */
export function bucketLabel(bucket: string, granularity: api.ReportGranularity): string {
  const [y, m, d] = bucket.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  if (granularity === "monthly") return date.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  const short = date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return granularity === "weekly" ? `w/c ${short}` : short;
}

const PERIOD_LABEL: Record<api.ReportGranularity, string> = { daily: "Last 14 days", weekly: "Last 8 weeks", monthly: "Last 12 months" };

export function SalesChart({ report }: { report: api.AdminReport }) {
  const data = report.series.map((p) => ({ label: bucketLabel(p.bucket, report.granularity), "Order value": p.orderValueTzs, "Paid revenue": p.paidRevenueTzs, orders: p.orders }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#888" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 10, fill: "#888" }} tickLine={false} axisLine={false} tickFormatter={(v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
        <Tooltip formatter={(v: number, n: string) => [formatTZS(v), n]} contentStyle={{ fontSize: 11 }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="Order value" fill="#c9a35a" radius={[3, 3, 0, 0]} />
        <Bar dataKey="Paid revenue" fill="#111" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function toCSV(rows: (string | number)[][]): string {
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
}

export function exportReportCsv(report: api.AdminReport) {
  const s = report.summary;
  const rows: (string | number)[][] = [
    ["PLUG sales report", PERIOD_LABEL[report.granularity], `from ${report.from ?? "-"}`, `timezone ${report.timezone}`],
    [],
    ["Orders (not cancelled)", s.orders],
    ["Cancelled orders", s.cancelledOrders],
    ["Order value (TZS)", s.orderValueTzs],
    ["Paid revenue (TZS)", s.paidRevenueTzs],
    ["Awaiting payment (TZS)", s.pendingValueTzs],
    ["Average order value (TZS)", s.averageOrderValueTzs],
    ["New customers", s.newCustomers],
    [],
    ["Period", "Orders", "Order value (TZS)", "Paid revenue (TZS)"],
    ...report.series.map((p) => [p.bucket, p.orders, p.orderValueTzs, p.paidRevenueTzs]),
    [],
    ["Top products", "Units", "Value (TZS)"],
    ...report.topProducts.map((p) => [p.name, p.units, p.valueTzs]),
    [],
    ["Payment method", "Orders", "Value (TZS)"],
    ...report.paymentMethods.map((m) => [m.name, m.orders, m.valueTzs]),
  ];
  const blob = new Blob([toCSV(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `plug-report-${report.granularity}-${report.from ?? "all"}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const cardGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 };
const th: React.CSSProperties = { textAlign: "left", fontSize: 10, color: "#777", fontWeight: 700, letterSpacing: ".08em", padding: "8px 10px", borderBottom: "1px solid #eee" };
const td: React.CSSProperties = { fontSize: 12, padding: "8px 10px", borderBottom: "1px solid #f3f3f3" };

/** Reports & analytics — real data from GET /api/v1/admin/reports. */
export function ReportsPage({ inventoryPath, productsPath }: { inventoryPath: string; productsPath: string }) {
  const [granularity, setGranularity] = useState<api.ReportGranularity>("daily");
  const [report, setReport] = useState<api.AdminReport | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  const load = (g = granularity) => {
    setStatus("loading");
    api.getAdminReport(g)
      .then((r) => { setReport(r); setStatus("ready"); })
      .catch((e) => { setError(userMessage(e, "Could not load the report.")); setStatus("error"); });
  };
  useEffect(() => { load(granularity); }, [granularity]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="dashboard" data-role="reports">
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
        <select aria-label="Report period" value={granularity} onChange={(e) => setGranularity(e.target.value as api.ReportGranularity)} style={{ border: "1px solid #ddd", background: "#fff", padding: "10px 13px", fontSize: 11, fontWeight: 600 }}>
          <option value="daily">Daily — last 14 days</option>
          <option value="weekly">Weekly — last 8 weeks</option>
          <option value="monthly">Monthly — last 12 months</option>
        </select>
        <button className="blackButton" disabled={!report} onClick={() => report && exportReportCsv(report)} style={{ display: "inline-flex", gap: 6 }}><Download size={14} /> Export CSV</button>
        <button onClick={() => load()} style={{ border: "1px solid #ddd", background: "#fff", padding: "10px 13px", fontSize: 11, display: "inline-flex", gap: 6, alignItems: "center" }}><RefreshCw size={13} /> Refresh</button>
        {report && <small style={{ color: "#888" }}>From {report.from} · times in {report.timezone}</small>}
      </div>

      {status === "error" && (
        <div role="alert" style={{ padding: 20, background: "#fef2f2", color: "#b91c1c", borderRadius: 8, fontSize: 13 }}>
          {error} <button onClick={() => load()} style={{ marginLeft: 8 }}>Try again</button>
        </div>
      )}
      {status === "loading" && !report && <p style={{ color: "#777", fontSize: 13 }}>Loading report…</p>}

      {report && (
        <div style={{ opacity: status === "loading" ? 0.6 : 1, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={cardGrid}>
            {[
              ["Paid revenue", formatTZS(report.summary.paidRevenueTzs), "Paid, shipped or delivered"],
              ["Order value", formatTZS(report.summary.orderValueTzs), `${report.summary.orders} orders (not cancelled)`],
              ["Awaiting payment", formatTZS(report.summary.pendingValueTzs), "Pending orders"],
              ["Average order", formatTZS(report.summary.averageOrderValueTzs), `${report.summary.cancelledOrders} cancelled`],
              ["New customers", String(report.summary.newCustomers), PERIOD_LABEL[report.granularity]],
            ].map(([label, value, hint]) => (
              <div className="statCard" key={label} data-role="report-card"><span>{label}</span><h2>{value}</h2><small style={{ color: "#777" }}>{hint}</small></div>
            ))}
          </div>

          <div className="panel">
            <div className="panelTitle">Sales — {PERIOD_LABEL[report.granularity]}</div>
            <div style={{ height: 260, marginTop: 8 }}><SalesChart report={report} /></div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
            <div className="panel">
              <div className="panelTitle">Top products (units sold)</div>
              {report.topProducts.length === 0 ? <p style={{ fontSize: 12, color: "#888" }}>No sales in this period.</p> : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr><th style={th}>PRODUCT</th><th style={th}>UNITS</th><th style={th}>VALUE</th></tr></thead>
                  <tbody>{report.topProducts.map((p) => <tr key={p.productId ?? p.name}><td style={td}>{p.name}</td><td style={td}>{p.units}</td><td style={td}>{formatTZS(p.valueTzs)}</td></tr>)}</tbody>
                </table>
              )}
            </div>
            <div className="panel">
              <div className="panelTitle">Orders by status</div>
              {Object.keys(report.statusCounts).length === 0 ? <p style={{ fontSize: 12, color: "#888" }}>No orders in this period.</p> : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <tbody>{(Object.entries(report.statusCounts) as [api.Order["status"], number][]).map(([s, n]) => <tr key={s}><td style={td}>{ORDER_STATUS_LABEL[s]}</td><td style={td}>{n}</td></tr>)}</tbody>
                </table>
              )}
              <div className="panelTitle" style={{ marginTop: 16 }}>Payment methods</div>
              {report.paymentMethods.length === 0 ? <p style={{ fontSize: 12, color: "#888" }}>No orders in this period.</p> : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <tbody>{report.paymentMethods.map((m) => <tr key={m.name}><td style={td}>{m.name}</td><td style={td}>{m.orders} orders</td><td style={td}>{formatTZS(m.valueTzs)}</td></tr>)}</tbody>
                </table>
              )}
            </div>
            <div className="panel">
              <div className="panelTitle">Low stock (live products) <Link to={inventoryPath} style={{ fontSize: 10 }}>OPEN INVENTORY</Link></div>
              {report.lowStock.length === 0 ? <p style={{ fontSize: 12, color: "#888" }}>Nothing is running low.</p> : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <tbody>{report.lowStock.map((v) => (
                    <tr key={v.variantId}>
                      <td style={td}><Link to={productsPath}>{v.productName}</Link><br /><small style={{ color: "#888" }}>{[v.color, v.size].filter(Boolean).join(" / ")}</small></td>
                      <td style={{ ...td, color: v.stockQty === 0 ? "#b91c1c" : "#a36d15", fontWeight: 700 }}>{v.stockQty === 0 ? "Sold out" : `${v.stockQty} left`}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
