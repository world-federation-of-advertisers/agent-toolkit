import type { App } from "@modelcontextprotocol/ext-apps";
import type { ParsedReport } from "./halo-types.ts";
import { fmtFreq, fmtInt, fmtPct } from "./halo-types.ts";
import {
  FrequencyDistributionChart,
  PUBLISHER_PALETTE,
  PublisherReachChart,
  StackedIncrementalChart,
  WeeklyTrendsChart,
} from "./charts.tsx";

// ============================================================================
// Halo report visual tokens.
// Kept local so the rest of the app keeps using the muted CSS variables.
// ============================================================================

const T = {
  navy: "#0F172A",
  navyAccent: "#1E3A5F",
  slate700: "#334155",
  slate600: "#475569",
  slate500: "#64748B",
  slate400: "#94A3B8",
  slate300: "#CBD5E1",
  slate200: "#E2E8F0",
  slate100: "#F1F5F9",
  slate50: "#F8FAFC",
  blue: "#3B82F6",
  teal: "#14B8A6",
  green: "#10B981",
  greenDark: "#065F46",
  greenBorder: "#A7F3D0",
  greenBg: "#ECFDF5",
  amber: "#F59E0B",
  amberDark: "#92400E",
  amberBorder: "#FDE68A",
  amberBg: "#FFFBEB",
  red: "#EF4444",
  purple: "#8B5CF6",
} as const;

const S = {
  card: {
    background: "#FFFFFF",
    border: `1px solid ${T.slate200}`,
    borderRadius: 16,
    padding: 28,
    marginBottom: 20,
    boxShadow: "0 1px 2px rgba(0,0,0,.04)",
  } as React.CSSProperties,
  cardTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: T.navy,
    marginBottom: 4,
    letterSpacing: "-0.01em",
  } as React.CSSProperties,
  cardSub: {
    fontSize: 11,
    color: T.slate400,
    marginBottom: 20,
    fontWeight: 500,
    lineHeight: 1.6,
  } as React.CSSProperties,
};

// ============================================================================
// ReportShell — outer container + Hero + Footer used by every viz tool.
// Each visualization renders its content in `children`.
// ============================================================================

function ReportShell({
  report,
  app,
  children,
}: {
  report: ParsedReport;
  app: App;
  children: React.ReactNode;
}) {
  const isSucceeded = report.state === "SUCCEEDED";
  return (
    <div
      style={{
        background: T.slate50,
        color: T.navy,
        minHeight: "100vh",
        padding: "32px 24px 80px",
      }}
    >
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <Hero report={report} />
        {isSucceeded ? children : <NonSucceededState report={report} />}
        <Footer report={report} app={app} />
      </div>
    </div>
  );
}

// ============================================================================
// Per-visualization views. Each is a thin wrapper over a single chart or card,
// rendered inside ReportShell so it gets the Hero/Footer for context.
// ============================================================================

export function SummaryView({ report, app }: { report: ParsedReport; app: App }) {
  return (
    <ReportShell report={report} app={app}>
      <NarrativeCard report={report} />
      <KpiGrid report={report} />
    </ReportShell>
  );
}

export function StackedIncrementalView({ report, app }: { report: ParsedReport; app: App }) {
  return (
    <ReportShell report={report} app={app}>
      <div style={S.card}>
        <div style={S.cardTitle}>Stacked Incremental Reach</div>
        <div style={S.cardSub}>
          Each publisher's contribution to total net reach, ordered by anchor.
        </div>
        <StackedIncrementalChart report={report} />
      </div>
    </ReportShell>
  );
}

export function VennOverlapView({ report, app }: { report: ParsedReport; app: App }) {
  return (
    <ReportShell report={report} app={app}>
      <div style={S.card}>
        <div style={S.cardTitle}>Cross-Publisher Overlap</div>
        <div style={S.cardSub}>Audience deduplication across the top two publishers.</div>
        <VennDiagram report={report} />
      </div>
    </ReportShell>
  );
}

export function FrequencyDistributionView({ report, app }: { report: ParsedReport; app: App }) {
  const k = report.total.kPlusReach;
  const reach1p = k[0] || 0;
  const reach3p = k.length >= 3 ? k[2] : 0;
  const pct3p = reach1p > 0 ? Math.round((reach3p / reach1p) * 100) : 0;
  const sub = k.length
    ? `Average frequency ${report.total.averageFrequency.toFixed(1)}×. ${pct3p}% of 1+ audience reached 3+ effective frequency.`
    : "No frequency distribution data in this report.";
  return (
    <ReportShell report={report} app={app}>
      <div style={S.card}>
        <div style={S.cardTitle}>Reach by Frequency Threshold</div>
        <div style={S.cardSub}>{sub}</div>
        <FrequencyDistributionChart report={report} />
      </div>
    </ReportShell>
  );
}

export function PublisherReachChartView({ report, app }: { report: ParsedReport; app: App }) {
  return (
    <ReportShell report={report} app={app}>
      <div style={S.card}>
        <div style={S.cardTitle}>Reach by Publisher</div>
        <div style={S.cardSub}>
          Total deduplicated reach vs. unique reach contribution per publisher.
        </div>
        {report.publishers.length ? (
          <PublisherReachChart publishers={report.publishers} />
        ) : (
          <p style={{ color: T.slate500, fontSize: 13 }}>No per-publisher data in this report.</p>
        )}
      </div>
    </ReportShell>
  );
}

export function PublisherTableView({ report, app }: { report: ParsedReport; app: App }) {
  return (
    <ReportShell report={report} app={app}>
      <div style={S.card}>
        <div style={S.cardTitle}>Publisher Breakdown</div>
        <div style={S.cardSub}>
          Per-publisher reach, frequency, impressions, and unique contribution.
        </div>
        {report.publishers.length ? (
          <PublisherTable report={report} />
        ) : (
          <p style={{ color: T.slate500, fontSize: 13 }}>No per-publisher data in this report.</p>
        )}
      </div>
    </ReportShell>
  );
}

export function WeeklyTrendsView({ report, app }: { report: ParsedReport; app: App }) {
  return (
    <ReportShell report={report} app={app}>
      <div style={S.card}>
        <div style={S.cardTitle}>Reach & Impressions by Week</div>
        <div style={S.cardSub}>
          Cumulative net reach grows over time; weekly impressions show pacing.
        </div>
        {report.weekly?.length ? (
          <WeeklyTrendsChart report={report} />
        ) : (
          <p style={{ color: T.slate500, fontSize: 13 }}>No weekly data in this report.</p>
        )}
      </div>
    </ReportShell>
  );
}

// ---- Hero ----

function Hero({ report }: { report: ParsedReport }) {
  const id = report.name.split("/").pop() ?? report.name;
  return (
    <header style={{ marginBottom: 32, paddingBottom: 24, borderBottom: `1px solid ${T.slate200}` }}>
      <div
        style={{
          fontSize: 10,
          letterSpacing: "2.5px",
          textTransform: "uppercase",
          color: T.blue,
          fontWeight: 600,
          marginBottom: 10,
        }}
      >
        Cross-Media Measurement
      </div>
      <h1
        style={{
          fontSize: 30,
          fontWeight: 800,
          color: T.navy,
          lineHeight: 1.15,
          letterSpacing: "-0.025em",
          margin: 0,
        }}
      >
        Campaign Report
        <br />
        <span style={{ color: T.blue }}>{report.title}</span>
      </h1>
      <MetaRow report={report} />
      <div
        style={{
          marginTop: 8,
          fontSize: 10,
          color: T.slate400,
          fontWeight: 500,
        }}
      >
        <code>{id}</code>
        {report.modelLine ? (
          <span>
            {" · "}model=<code>{report.modelLine.split("/").pop()}</code>
          </span>
        ) : null}
      </div>
    </header>
  );
}

function MetaRow({ report }: { report: ParsedReport }) {
  const parts: Array<{ label?: string; value: string } | "sep"> = [];
  if (report.campaignGroup) parts.push({ value: report.campaignGroup });
  if (report.periodStart && report.periodEnd) {
    if (parts.length) parts.push("sep");
    parts.push({ value: `${report.periodStart} → ${report.periodEnd}` });
  }
  if (report.populationSize > 0) {
    if (parts.length) parts.push("sep");
    parts.push({ label: "Universe", value: fmtInt(report.populationSize) });
  }
  if (parts.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        marginTop: 14,
        fontSize: 12,
        color: T.slate500,
        alignItems: "center",
      }}
    >
      {parts.map((p, i) =>
        p === "sep" ? (
          <span key={i} style={{ color: T.slate300 }}>
            /
          </span>
        ) : (
          <span key={i}>
            {p.label ? `${p.label}: ` : null}
            <strong style={{ color: T.slate700, fontWeight: 600 }}>{p.value}</strong>
          </span>
        ),
      )}
    </div>
  );
}

// ---- Narrative card ----

function NarrativeCard({ report }: { report: ParsedReport }) {
  const text = composeNarrative(report);
  return (
    <div
      style={{
        background: `linear-gradient(135deg, ${T.navy}, ${T.navyAccent})`,
        borderRadius: 16,
        padding: "28px 32px",
        marginBottom: 32,
        color: "#FFFFFF",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: "2px",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.4)",
          marginBottom: 12,
          fontWeight: 600,
        }}
      >
        Executive Summary
      </div>
      <p
        style={{
          fontSize: 14,
          lineHeight: 1.7,
          color: "rgba(255,255,255,0.85)",
          maxWidth: 680,
          margin: 0,
        }}
      >
        {text}
      </p>
    </div>
  );
}

function composeNarrative(report: ParsedReport): string {
  const pubCount = report.publishers.length;
  const parts: string[] = [];
  parts.push(
    `This campaign delivered ${fmtInt(report.total.impressions)} impressions across ${pubCount} publisher${pubCount === 1 ? "" : "s"}, reaching a deduplicated audience of ${fmtInt(report.total.reach)} people` +
      (report.populationSize > 0
        ? ` — ${(report.total.percentReach * 100).toFixed(1)}% of the ${fmtInt(report.populationSize)} universe.`
        : "."),
  );
  if (report.total.averageFrequency > 0) {
    parts.push(`Average frequency: ${report.total.averageFrequency.toFixed(1)}×.`);
  }
  if (report.total.grps > 0) {
    parts.push(`GRPs: ${report.total.grps.toFixed(1)}.`);
  }
  return parts.join(" ");
}

// ---- KPI grid ----

function KpiGrid({ report }: { report: ParsedReport }) {
  const kpis: Array<{ label: string; value: string; sub: string; accent: string }> = [
    {
      label: "Net Reach",
      value: fmtInt(report.total.reach),
      sub: report.populationSize > 0 ? `${(report.total.percentReach * 100).toFixed(1)}% of universe` : "deduplicated",
      accent: T.blue,
    },
    {
      label: "Impressions",
      value: fmtInt(report.total.impressions),
      sub: "across all publishers",
      accent: T.teal,
    },
    {
      label: "Avg Frequency",
      value: report.total.averageFrequency > 0 ? `${report.total.averageFrequency.toFixed(2)}×` : "—",
      sub: "impressions per person",
      accent: T.green,
    },
    {
      label: "GRPs",
      value: report.total.grps > 0 ? report.total.grps.toFixed(1) : "—",
      sub: "gross rating points",
      accent: T.purple,
    },
    {
      label: "Publishers",
      value: String(report.publishers.length),
      sub: report.publishers.map((p) => p.displayName).join(", ") || "—",
      accent: T.amber,
    },
    {
      label: "Duration",
      value: report.durationDays > 0 ? `${report.durationDays}d` : "—",
      sub: report.periodStart && report.periodEnd ? `${report.periodStart} → ${report.periodEnd}` : "—",
      accent: T.slate500,
    },
  ];
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 16,
        marginBottom: 48,
      }}
    >
      {kpis.map((k) => (
        <KpiCard key={k.label} {...k} />
      ))}
    </div>
  );
}

function KpiCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div
      style={{
        background: "#FFFFFF",
        border: `1px solid ${T.slate200}`,
        borderRadius: 12,
        padding: "22px 24px",
        position: "relative",
        overflow: "hidden",
        boxShadow: "0 1px 2px rgba(0,0,0,.04)",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: accent,
          borderRadius: "12px 12px 0 0",
        }}
      />
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "1.2px",
          color: T.slate400,
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 26,
          fontWeight: 800,
          color: T.navy,
          fontFamily: "var(--font-mono)",
          lineHeight: 1,
          letterSpacing: "-0.02em",
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 11,
          color: T.slate500,
          marginTop: 6,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={sub}
      >
        {sub}
      </div>
    </div>
  );
}

// ---- PublisherTable (used by PublisherTableView) ----

function PublisherTable({ report }: { report: ParsedReport }) {
  const th: React.CSSProperties = {
    padding: "12px 16px",
    textAlign: "left",
    fontSize: 10,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "1px",
    color: T.slate400,
    borderBottom: `2px solid ${T.slate200}`,
    fontFamily: "var(--font-mono)",
  };
  const thRight: React.CSSProperties = { ...th, textAlign: "right" };
  const td: React.CSSProperties = {
    padding: "14px 16px",
    borderBottom: `1px solid ${T.slate100}`,
    fontFamily: "var(--font-mono)",
    fontWeight: 500,
    fontSize: 13,
  };
  const tdRight: React.CSSProperties = { ...td, textAlign: "right" };
  const tdRightBold: React.CSSProperties = { ...tdRight, fontWeight: 700 };
  const tfootTd: React.CSSProperties = {
    padding: "14px 16px",
    fontWeight: 700,
    borderTop: `2px solid ${T.slate200}`,
    fontFamily: "var(--font-mono)",
    fontSize: 13,
  };
  const tfootRight: React.CSSProperties = { ...tfootTd, textAlign: "right" };

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr>
          <th style={th}>Publisher</th>
          <th style={thRight}>Reach</th>
          <th style={thRight}>% Universe</th>
          <th style={thRight}>Impressions</th>
          <th style={thRight}>Avg Freq</th>
          <th style={thRight}>Unique Reach</th>
        </tr>
      </thead>
      <tbody>
        {report.publishers.map((p, i) => {
          const pct = report.populationSize > 0 ? (p.metrics.reach / report.populationSize) * 100 : 0;
          return (
            <tr key={p.dataProvider}>
              <td style={td}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    display: "inline-block",
                    marginRight: 8,
                    verticalAlign: "middle",
                    background: PUBLISHER_PALETTE[i % PUBLISHER_PALETTE.length],
                  }}
                />
                {p.displayName}
              </td>
              <td style={tdRight}>{fmtInt(p.metrics.reach)}</td>
              <td style={tdRight}>{report.populationSize > 0 ? `${pct.toFixed(1)}%` : "—"}</td>
              <td style={tdRight}>{fmtInt(p.metrics.impressions)}</td>
              <td style={tdRight}>{fmtFreq(p.metrics.averageFrequency)}×</td>
              <td style={tdRightBold}>{p.uniqueReach != null ? fmtInt(p.uniqueReach) : "—"}</td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <td style={tfootTd}>Net Campaign Reach</td>
          <td style={tfootRight}>{fmtInt(report.total.reach)}</td>
          <td style={tfootRight}>{fmtPct(report.total.percentReach)}</td>
          <td style={tfootRight}>{fmtInt(report.total.impressions)}</td>
          <td style={tfootRight}>{fmtFreq(report.total.averageFrequency)}×</td>
          <td style={tfootRight}>—</td>
        </tr>
      </tfoot>
    </table>
  );
}

// ---- Non-SUCCEEDED state ----

function NonSucceededState({ report }: { report: ParsedReport }) {
  return (
    <div
      style={{
        padding: 24,
        borderRadius: 12,
        background: "#FFFFFF",
        border: `1px solid ${T.slate200}`,
        borderLeft: `4px solid ${T.red}`,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 700, color: T.navy, marginBottom: 8 }}>
        Report state: <code>{report.state || "?"}</code>
      </div>
      <div style={{ fontSize: 13, color: T.slate600, lineHeight: 1.6 }}>
        Metrics are not available yet. Reports in <code>RUNNING</code> state are still being computed; reports in{" "}
        <code>FAILED</code> or <code>INVALID</code> state cannot be rendered.
      </div>
    </div>
  );
}

// ---- Footer ----

function Footer({ report, app }: { report: ParsedReport; app: App }) {
  return (
    <footer
      style={{
        marginTop: 24,
        paddingTop: 16,
        borderTop: `1px solid ${T.slate200}`,
        fontSize: 11,
        color: T.slate400,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <span>Halo · Cross-Media Measurement</span>
      <button
        type="button"
        onClick={() => {
          void app.sendLog({ level: "info", data: { reportName: report.name } });
        }}
        style={{ fontSize: 11 }}
      >
        Log report ID to host
      </button>
    </footer>
  );
}

// ============================================================================
// VennDiagram — proportional-area two-publisher overlap visualization.
// ============================================================================

function VennDiagram({ report }: { report: ParsedReport }) {
  const [a, b] = pickVennPair(report);
  if (!a || !b) {
    return (
      <div style={{ color: T.slate500, fontSize: 13, padding: 16, textAlign: "center" }}>
        Overlap requires two publishers with reach data.
      </div>
    );
  }
  const pop = report.populationSize;
  const netReach = report.total.reach;
  const grossR = a.reach + b.reach;
  const overlapR = Math.max(0, grossR - netReach);

  // Proportional circle radii (area ~ reach)
  const maxR = 145;
  const maxReachVal = Math.max(a.reach, b.reach) || 1;
  const r1 = maxR * Math.sqrt(a.reach / maxReachVal);
  const r2 = maxR * Math.sqrt(b.reach / maxReachVal);

  // Binary search for circle distance matching overlap area.
  const targetArea = (Math.PI * r1 * r1 * overlapR) / (a.reach || 1);
  let dLo = Math.abs(r1 - r2);
  let dHi = r1 + r2;
  let dist = (dLo + dHi) / 2;
  for (let iter = 0; iter < 80; iter++) {
    dist = (dLo + dHi) / 2;
    if (circleIntersectionArea(r1, r2, dist) > targetArea) dLo = dist;
    else dHi = dist;
  }

  const W = 700;
  const H = 440;
  const cy = 195;
  const totalSpan = dist + r1 + r2;
  const startX = (W - totalSpan) / 2 + r1;
  const cx1 = startX;
  const cx2 = startX + dist;
  const intX = (r1 * r1 - r2 * r2 + dist * dist) / (2 * dist);
  const pub1LabelX = cx1 - (r1 - intX) / 2;
  const pub2LabelX = cx2 + (r2 - (dist - intX)) / 2;
  const overlapCx = (cx1 + cx2) / 2;
  const netBoxY = cy + Math.max(r1, r2) + 42;
  const FONT_M = "var(--font-mono)";

  const overlapPct = pop > 0 ? ((overlapR / pop) * 100).toFixed(1) : "—";
  const netPct = pop > 0 ? ((netReach / pop) * 100).toFixed(1) : "—";
  const a1Unique = a.uniqueReach ?? Math.max(0, a.reach - overlapR);
  const a2Unique = b.uniqueReach ?? Math.max(0, b.reach - overlapR);
  const a1OnlyPct = pop > 0 ? ((a1Unique / pop) * 100).toFixed(1) : "—";
  const a2OnlyPct = pop > 0 ? ((a2Unique / pop) * 100).toFixed(1) : "—";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "16px 0 8px" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: "100%", height: "auto" }} role="img" aria-label="Two-publisher reach overlap Venn diagram">
        <defs>
          <clipPath id="venn-clip-overlap">
            <circle cx={cx2} cy={cy} r={r2} />
          </clipPath>
        </defs>
        {/* Universe background */}
        <rect
          x={30}
          y={16}
          width={W - 60}
          height={cy + Math.max(r1, r2) + 20 - 16}
          rx={16}
          fill={T.slate50}
          stroke={T.slate200}
          strokeWidth={1}
        />
        <text x={50} y={40} fontSize={10} fontWeight={600} fill={T.slate400} fontFamily={FONT_M} textAnchor="start">
          UNIVERSE: {pop > 0 ? fmtInt(pop) : "—"}
        </text>

        {/* Circles */}
        <circle cx={cx1} cy={cy} r={r1} fill={T.blue} fillOpacity={0.18} stroke={T.blue} strokeWidth={2.5} />
        <circle cx={cx2} cy={cy} r={r2} fill={T.teal} fillOpacity={0.18} stroke={T.teal} strokeWidth={2.5} />
        <circle cx={cx1} cy={cy} r={r1} fill={T.purple} fillOpacity={0.22} clipPath="url(#venn-clip-overlap)" />

        {/* Publisher labels above circles */}
        <text x={cx1} y={cy - r1 - 18} fontSize={13} fontWeight={700} fill={T.blue} textAnchor="middle">
          {a.displayName}
        </text>
        <text x={cx1} y={cy - r1 - 4} fontSize={10} fontWeight={500} fill={T.slate500} fontFamily={FONT_M} textAnchor="middle">
          {fmtInt(a.reach)} total
        </text>
        <text x={cx2} y={cy - r2 - 18} fontSize={13} fontWeight={700} fill={T.teal} textAnchor="middle">
          {b.displayName}
        </text>
        <text x={cx2} y={cy - r2 - 4} fontSize={10} fontWeight={500} fill={T.slate500} fontFamily={FONT_M} textAnchor="middle">
          {fmtInt(b.reach)} total
        </text>

        {/* Numbers inside circles */}
        <text x={pub1LabelX} y={cy + 4} fontSize={17} fontWeight={800} fill="#1E3A5F" fontFamily={FONT_M} textAnchor="middle">
          {fmtInt(a1Unique)}
        </text>
        <text x={pub1LabelX} y={cy + 22} fontSize={11} fontWeight={600} fill={T.blue} fontFamily={FONT_M} textAnchor="middle">
          {a1OnlyPct}%
        </text>
        <text x={pub2LabelX} y={cy + 4} fontSize={17} fontWeight={800} fill="#134E4A" fontFamily={FONT_M} textAnchor="middle">
          {fmtInt(a2Unique)}
        </text>
        <text x={pub2LabelX} y={cy + 22} fontSize={11} fontWeight={600} fill={T.teal} fontFamily={FONT_M} textAnchor="middle">
          {a2OnlyPct}%
        </text>
        <text x={overlapCx} y={cy + 2} fontSize={15} fontWeight={800} fill="#5B21B6" fontFamily={FONT_M} textAnchor="middle">
          {fmtInt(overlapR)}
        </text>
        <text x={overlapCx} y={cy + 20} fontSize={11} fontWeight={600} fill="#7C3AED" fontFamily={FONT_M} textAnchor="middle">
          {overlapPct}%
        </text>

        {/* Net Reach box */}
        <rect x={W / 2 - 145} y={netBoxY - 18} width={290} height={36} rx={8} fill={T.greenBg} stroke={T.greenBorder} strokeWidth={1.5} />
        <text x={W / 2 - 76} y={netBoxY + 5} fontSize={11} fontWeight={600} fill={T.greenDark} textAnchor="middle">
          Net Campaign Reach:
        </text>
        <text x={W / 2 + 48} y={netBoxY + 5} fontSize={14} fontWeight={800} fill={T.greenDark} fontFamily={FONT_M} textAnchor="middle">
          {fmtInt(netReach)}
        </text>
        <text x={W / 2 + 106} y={netBoxY + 5} fontSize={11} fontWeight={600} fill={T.green} fontFamily={FONT_M} textAnchor="middle">
          ({netPct}%)
        </text>
      </svg>
      <VennEquation pub1Label={a.displayName} pub2Label={b.displayName} pub1Reach={a.reach} pub2Reach={b.reach} overlap={overlapR} net={netReach} />
    </div>
  );
}

function VennEquation({
  pub1Label,
  pub2Label,
  pub1Reach,
  pub2Reach,
  overlap,
  net,
}: {
  pub1Label: string;
  pub2Label: string;
  pub1Reach: number;
  pub2Reach: number;
  overlap: number;
  net: number;
}) {
  const items: Array<{ op: string } | { val: string; label: string; result?: boolean }> = [
    { val: fmtInt(pub1Reach), label: pub1Label },
    { op: "+" },
    { val: fmtInt(pub2Reach), label: pub2Label },
    { op: "−" },
    { val: fmtInt(overlap), label: "Overlap" },
    { op: "=" },
    { val: fmtInt(net), label: "Net Reach", result: true },
  ];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: "16px 0 4px",
        flexWrap: "wrap",
      }}
    >
      {items.map((item, i) => {
        if ("op" in item) {
          return (
            <span key={i} style={{ fontSize: 20, fontWeight: 700, color: T.slate400, fontFamily: "var(--font-mono)" }}>
              {item.op}
            </span>
          );
        }
        const bg = item.result ? T.greenBg : T.slate50;
        const border = item.result ? T.greenBorder : T.slate200;
        const valColor = item.result ? T.greenDark : T.navy;
        const labelColor = item.result ? T.green : T.slate400;
        return (
          <div
            key={i}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
              padding: "10px 18px",
              borderRadius: 10,
              background: bg,
              border: `1px solid ${border}`,
              minWidth: 100,
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "var(--font-mono)", color: valColor, letterSpacing: "-0.02em" }}>
              {item.val}
            </div>
            <div style={{ fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", color: labelColor }}>
              {item.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Flat shape for VennDiagram (publisher.metrics.reach hoisted to .reach).
interface VennPub {
  reach: number;
  displayName: string;
  uniqueReach?: number;
}

// Pick the top-2 publishers by reach for the Venn pair.
function pickVennPair(report: ParsedReport): [VennPub | undefined, VennPub | undefined] {
  const sorted = [...report.publishers]
    .filter((p) => p.metrics.reach > 0)
    .sort((a, b) => b.metrics.reach - a.metrics.reach)
    .map<VennPub>((p) => ({
      reach: p.metrics.reach,
      displayName: p.displayName,
      uniqueReach: p.uniqueReach,
    }));
  return [sorted[0], sorted[1]];
}

function circleIntersectionArea(ra: number, rb: number, d: number): number {
  if (d >= ra + rb) return 0;
  if (d <= Math.abs(ra - rb)) return Math.PI * Math.min(ra, rb) * Math.min(ra, rb);
  const a = (ra * ra - rb * rb + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, ra * ra - a * a));
  return ra * ra * Math.acos(a / ra) + rb * rb * Math.acos((d - a) / rb) - d * h;
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div style={{ padding: 32, textAlign: "center", color: "var(--color-text-muted)" }}>{message}</div>
  );
}

export function ErrorView({ error }: { error: string }) {
  return (
    <div style={{ padding: 16, maxWidth: 800, margin: "0 auto" }}>
      <div
        style={{
          padding: 16,
          borderRadius: 10,
          background: "var(--color-background-secondary)",
          borderLeft: "4px solid var(--color-danger)",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          whiteSpace: "pre-wrap",
        }}
      >
        {error}
      </div>
    </div>
  );
}

