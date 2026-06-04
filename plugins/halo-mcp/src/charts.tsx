import ReactECharts from "echarts-for-react";
import type { ParsedReport, PublisherMetrics } from "./halo-types.ts";
import { fmtInt } from "./halo-types.ts";

// Halo report palette.
const C = {
  blue: "#3B82F6",
  teal: "#14B8A6",
  green: "#10B981",
  amber: "#F59E0B",
  red: "#EF4444",
  purple: "#8B5CF6",
  slate400: "#94A3B8",
  slate500: "#64748B",
  slate200: "#E2E8F0",
  navy: "#1E293B",
} as const;

// Per-publisher color cycle. Mirrors PCOLS in the skill template so the
// stacked-incremental bars and the publisher-table dots stay in sync.
export const PUBLISHER_PALETTE = [C.blue, C.teal, C.purple, C.amber] as const;

const CHART_STYLE: React.CSSProperties = { height: 320, width: "100%" };

const BASE_OPTS = {
  grid: { left: 56, right: 24, top: 24, bottom: 48, containLabel: true },
  textStyle: { fontFamily: "var(--font-sans, ui-sans-serif, system-ui, sans-serif)" },
  animationDuration: 400,
};

const AXIS_LINE = { lineStyle: { color: C.slate200 } };
const AXIS_LABEL = { color: C.slate400, fontSize: 11 };
const SPLIT_LINE = { lineStyle: { color: "rgba(226,232,240,.5)" } };

export function StackedIncrementalChart({ report }: { report: ParsedReport }) {
  if (!report.stackedIncremental?.length) {
    return <p style={{ color: C.slate500, fontSize: 13 }}>No stacked incremental reach in this report.</p>;
  }
  const total = report.total.reach || report.stackedIncremental.reduce((s, v) => s + v.reach, 0) || 1;
  const cats = report.stackedIncremental.map((s) => {
    const pct = Math.round((s.reach / total) * 100);
    return `${s.dataProvider}\n(${pct}%)`;
  });
  const option = {
    ...BASE_OPTS,
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (p: Array<{ name: string; value: number }>) => `${p[0].name.split("\n")[0]}: ${fmtInt(p[0].value)}`,
    },
    xAxis: {
      type: "category",
      data: cats,
      axisLine: AXIS_LINE,
      axisTick: { show: false },
      axisLabel: { ...AXIS_LABEL, interval: 0 },
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: SPLIT_LINE,
      axisLabel: { ...AXIS_LABEL, formatter: (v: number) => fmtInt(v) },
    },
    series: [
      {
        type: "bar",
        data: report.stackedIncremental.map((s, i) => ({
          value: s.reach,
          itemStyle: {
            color: PUBLISHER_PALETTE[i % PUBLISHER_PALETTE.length],
            borderRadius: [6, 6, 0, 0],
          },
        })),
        barMaxWidth: 60,
        label: {
          show: true,
          position: "top",
          formatter: (p: { value: number }) => fmtInt(p.value),
          fontSize: 11,
          fontWeight: 700,
          color: "#334155",
          fontFamily: "var(--font-mono)",
        },
      },
    ],
  };
  return <ReactECharts option={option} style={CHART_STYLE} />;
}

export function FrequencyDistributionChart({ report }: { report: ParsedReport }) {
  const k = report.total.kPlusReach;
  if (!k?.length) {
    return <p style={{ color: C.slate500, fontSize: 13 }}>No k+ reach data in this report.</p>;
  }
  const option = {
    ...BASE_OPTS,
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      valueFormatter: (v: number) => fmtInt(v),
    },
    xAxis: {
      type: "category",
      data: k.map((_, i) => `${i + 1}+`),
      axisLine: AXIS_LINE,
      axisTick: { show: false },
      axisLabel: AXIS_LABEL,
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: SPLIT_LINE,
      axisLabel: { ...AXIS_LABEL, formatter: (v: number) => fmtInt(v) },
    },
    series: [
      {
        type: "bar",
        data: k.map((v, i) => ({
          value: v,
          // Highlight 3+ effective frequency in red per skill design.
          // 1+ and 2+ get the brand blue; 4+ onward fade to slate.
          itemStyle: {
            color: i < 2 ? C.blue : i === 2 ? C.red : C.slate400,
            borderRadius: [6, 6, 0, 0],
          },
        })),
        barMaxWidth: 50,
        label: {
          show: true,
          position: "top",
          formatter: (p: { value: number }) => fmtInt(p.value),
          fontSize: 10,
          fontWeight: 700,
          color: "#334155",
          fontFamily: "var(--font-mono)",
        },
      },
    ],
  };
  return <ReactECharts option={option} style={CHART_STYLE} />;
}

export function PublisherReachChart({ publishers }: { publishers: PublisherMetrics[] }) {
  if (!publishers?.length) return null;
  const option = {
    ...BASE_OPTS,
    tooltip: { trigger: "axis", valueFormatter: (v: number) => fmtInt(v) },
    legend: { data: ["Reach", "Unique Reach"], top: 0, right: 0, textStyle: { color: C.slate500, fontSize: 11 } },
    xAxis: {
      type: "category",
      data: publishers.map((p) => p.displayName),
      axisLine: AXIS_LINE,
      axisTick: { show: false },
      axisLabel: { ...AXIS_LABEL, interval: 0 },
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: SPLIT_LINE,
      axisLabel: { ...AXIS_LABEL, formatter: (v: number) => fmtInt(v) },
    },
    series: [
      {
        name: "Reach",
        type: "bar",
        data: publishers.map((p) => p.metrics.reach),
        itemStyle: { color: C.blue, borderRadius: [6, 6, 0, 0] },
        barMaxWidth: 48,
      },
      {
        name: "Unique Reach",
        type: "bar",
        data: publishers.map((p) => p.uniqueReach ?? 0),
        itemStyle: { color: C.teal, borderRadius: [6, 6, 0, 0] },
        barMaxWidth: 48,
      },
    ],
  };
  return <ReactECharts option={option} style={CHART_STYLE} />;
}

export function CrossCampaignFrequencyChart({ reports }: { reports: ParsedReport[] }) {
  const COLORS = [C.blue, C.amber, C.purple, C.teal, C.green];
  const maxLen = Math.max(...reports.map((r) => r.total.kPlusReach?.length ?? 0));
  if (maxLen === 0) return <p style={{ color: C.slate500, fontSize: 13 }}>No k+ reach data.</p>;
  const cats = Array.from({ length: maxLen }, (_, i) => `${i + 1}+`);
  const option = {
    ...BASE_OPTS,
    tooltip: { trigger: "axis", valueFormatter: (v: number) => fmtInt(v) },
    legend: {
      data: reports.map((r) => r.title.split("—")[0].trim()),
      top: 0,
      right: 0,
      textStyle: { color: C.slate500, fontSize: 11 },
    },
    xAxis: {
      type: "category",
      data: cats,
      name: "Frequency Threshold",
      nameLocation: "center",
      nameGap: 36,
      nameTextStyle: { color: C.slate500, fontSize: 11, fontWeight: 600 },
      axisLine: AXIS_LINE,
      axisTick: { show: false },
      axisLabel: AXIS_LABEL,
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: SPLIT_LINE,
      axisLabel: { ...AXIS_LABEL, formatter: (v: number) => fmtInt(v) },
    },
    series: reports.map((r, i) => ({
      name: r.title.split("—")[0].trim(),
      type: "line",
      smooth: true,
      data: r.total.kPlusReach ?? [],
      lineStyle: { color: COLORS[i % COLORS.length], width: 2.5 },
      itemStyle: { color: COLORS[i % COLORS.length] },
      symbol: "circle",
      symbolSize: 5,
    })),
  };
  return <ReactECharts option={option} style={CHART_STYLE} />;
}

export function CrossCampaignReachChart({ reports }: { reports: ParsedReport[] }) {
  const pubMap = new Map<string, number[]>();
  for (const r of reports) {
    for (const p of r.publishers) {
      const arr = pubMap.get(p.displayName) ?? [];
      arr.push(p.metrics.reach);
      pubMap.set(p.displayName, arr);
    }
  }
  if (pubMap.size === 0) return <p style={{ color: C.slate500, fontSize: 13 }}>No publisher data.</p>;
  const pubs = [...pubMap.entries()].sort((a, b) => {
    const avgA = a[1].reduce((s, v) => s + v, 0) / a[1].length;
    const avgB = b[1].reduce((s, v) => s + v, 0) / b[1].length;
    return avgB - avgA;
  });
  const cats = pubs.map(([name]) => name);
  const COLORS = [C.blue, C.teal, C.purple, C.amber, C.green];
  const option = {
    ...BASE_OPTS,
    tooltip: { trigger: "axis", valueFormatter: (v: number) => fmtInt(v) },
    legend: {
      data: reports.map((r) => r.title.split("—")[0].trim()),
      top: 0,
      right: 0,
      textStyle: { color: C.slate500, fontSize: 11 },
    },
    xAxis: {
      type: "category",
      data: cats,
      axisLine: AXIS_LINE,
      axisTick: { show: false },
      axisLabel: { ...AXIS_LABEL, interval: 0 },
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: SPLIT_LINE,
      axisLabel: { ...AXIS_LABEL, formatter: (v: number) => fmtInt(v) },
    },
    series: reports.map((r, ri) => ({
      name: r.title.split("—")[0].trim(),
      type: "bar",
      data: cats.map((name) => {
        const pub = r.publishers.find((p) => p.displayName === name);
        return pub?.metrics.reach ?? 0;
      }),
      itemStyle: { color: COLORS[ri % COLORS.length], borderRadius: [4, 4, 0, 0] },
      barMaxWidth: 32,
    })),
  };
  return <ReactECharts option={option} style={CHART_STYLE} />;
}

export function WeeklyTrendsChart({ report }: { report: ParsedReport }) {
  const weekly = report.weekly;
  if (!weekly?.length) return null;
  const option = {
    ...BASE_OPTS,
    tooltip: { trigger: "axis", valueFormatter: (v: number) => fmtInt(v) },
    legend: {
      data: ["Cumulative Reach", "Weekly Impressions"],
      top: 0,
      right: 0,
      textStyle: { color: C.slate500, fontSize: 11 },
    },
    xAxis: {
      type: "category",
      data: weekly.map((w) => w.weekLabel),
      axisLine: AXIS_LINE,
      axisTick: { show: false },
      axisLabel: { ...AXIS_LABEL, rotate: 30 },
    },
    yAxis: [
      {
        type: "value",
        name: "Reach",
        nameTextStyle: AXIS_LABEL,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: SPLIT_LINE,
        axisLabel: { ...AXIS_LABEL, formatter: (v: number) => fmtInt(v) },
      },
      {
        type: "value",
        name: "Impressions",
        nameTextStyle: AXIS_LABEL,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { ...AXIS_LABEL, formatter: (v: number) => fmtInt(v) },
      },
    ],
    series: [
      {
        name: "Cumulative Reach",
        type: "line",
        smooth: true,
        data: weekly.map((w) => w.cumulativeReach),
        lineStyle: { color: C.blue, width: 3 },
        itemStyle: { color: C.blue },
        symbol: "circle",
        symbolSize: 6,
      },
      {
        name: "Weekly Impressions",
        type: "bar",
        yAxisIndex: 1,
        data: weekly.map((w) => w.impressions),
        itemStyle: { color: C.teal, borderRadius: [6, 6, 0, 0] },
        barMaxWidth: 36,
      },
    ],
  };
  return <ReactECharts option={option} style={CHART_STYLE} />;
}
