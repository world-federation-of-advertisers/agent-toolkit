/**
 * Halo BasicReport shape — narrow types for the bits the UI actually reads.
 * The Halo API returns numeric fields as JSON strings; parseMetrics() converts them.
 */

export interface RawMetricSet {
  reach?: string;
  impressions?: string;
  averageFrequency?: number;
  percentReach?: number;
  grps?: number;
  kPlusReach?: string[];
  percentKPlusReach?: number[];
}

export interface ReportingUnit {
  cumulative?: RawMetricSet | null;
  nonCumulative?: RawMetricSet | null;
  cumulativeUnique?: RawMetricSet | null;
  nonCumulativeUnique?: RawMetricSet | null;
  stackedIncrementalReach?: Array<{
    dataProvider?: string;
    reach?: string;
  }>;
}

export interface Component {
  key?: string;
  value?: ReportingUnit;
}

export interface MetricSet {
  populationSize?: string;
  reportingUnit?: ReportingUnit;
  components?: Component[];
  componentIntersections?: Array<{
    components?: string[];
    metricSet?: RawMetricSet;
  }>;
}

// Demographic data uses two conventions across Halo deployments:
//   A) older: dimensionSpecSummary.groupings[].value.enumValue carries the value
//   B) newer: dimensionSpecSummary.filters[].{key,value} carries the value
// `parseReport` accepts both shapes; downstream consumers see a normalized
// `Demographic` row.
export interface DimensionGrouping {
  path?: string;
  eventTemplateFields?: string[];
  value?: { enumValue?: string; stringValue?: string };
}

export interface DimensionFilter {
  key?: string;
  value?: string;
  terms?: unknown[];
}

export interface DimensionSpecSummary {
  groupings?: DimensionGrouping[];
  filters?: DimensionFilter[];
  dimensionCellLabel?: string;
}

export interface ResultGroupResult {
  metadata?: {
    reportingUnitSummary?: {
      reportingUnitComponentSummary?: Array<{
        dataProvider?: string;
        displayName?: string;
      }>;
    };
    nonCumulativeMetricStartTime?: HaloDate;
    cumulativeMetricStartTime?: HaloDate;
    metricEndTime?: HaloDate;
    metricFrequency?: { weekly?: unknown; total?: boolean };
    filter?: unknown;
    dimensionSpecSummary?: DimensionSpecSummary;
  };
  metricSet?: MetricSet;
}

export interface ResultGroup {
  title?: string;
  results?: ResultGroupResult[];
}

export interface BasicReport {
  name?: string;
  title?: string;
  state?: string;
  createTime?: string;
  campaignGroupDisplayName?: string;
  reportingInterval?: { reportStart?: string; reportEnd?: string };
  effectiveImpressionQualificationFilters?: unknown;
  effectiveModelLine?: string;
  resultGroups?: ResultGroup[];
}

// --- Normalised, UI-friendly shapes ---

export interface Metrics {
  reach: number;
  impressions: number;
  averageFrequency: number;
  percentReach: number;
  grps: number;
  kPlusReach: number[];
  percentKPlusReach: number[];
}

export interface PublisherMetrics {
  dataProvider: string;
  displayName: string;
  metrics: Metrics;
  uniqueReach?: number;
}

export interface Demographic {
  segmentLabel: string;
  rgTitle: string;
  populationSize: number;
  metrics: Metrics;
}

export interface ParsedReport {
  name: string;
  title: string;
  state: string;
  campaignGroup: string;
  periodStart: string;
  periodEnd: string;
  durationDays: number;
  modelLine: string;
  populationSize: number;
  total: Metrics;
  publishers: PublisherMetrics[];
  stackedIncremental: Array<{ dataProvider: string; reach: number }>;
  metricFrequency: "weekly" | "total" | "unknown";
  weekly?: Array<{
    weekLabel: string;
    cumulativeReach: number;
    nonCumulativeReach: number;
    impressions: number;
    averageFrequency: number;
    perPublisher: Array<{ dataProvider: string; impressions: number; reach: number; averageFrequency: number }>;
  }>;
  demographics: Demographic[];
}

const EMPTY_METRICS: Metrics = {
  reach: 0,
  impressions: 0,
  averageFrequency: 0,
  percentReach: 0,
  grps: 0,
  kPlusReach: [],
  percentKPlusReach: [],
};

function toInt(s: string | undefined | null): number {
  if (s == null) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function parseMetrics(raw: RawMetricSet | undefined | null): Metrics {
  if (!raw) return { ...EMPTY_METRICS };
  return {
    reach: toInt(raw.reach),
    impressions: toInt(raw.impressions),
    averageFrequency: typeof raw.averageFrequency === "number" ? raw.averageFrequency : 0,
    percentReach: typeof raw.percentReach === "number" ? raw.percentReach : 0,
    grps: typeof raw.grps === "number" ? raw.grps : 0,
    kPlusReach: (raw.kPlusReach ?? []).map(toInt),
    percentKPlusReach: (raw.percentKPlusReach ?? []).slice(),
  };
}

function pickPopulated(unit: ReportingUnit | undefined): RawMetricSet | undefined {
  if (!unit) return undefined;
  return unit.cumulative ?? unit.nonCumulative ?? undefined;
}

function dataProviderDisplayMap(report: BasicReport): Map<string, string> {
  const map = new Map<string, string>();
  for (const rg of report.resultGroups ?? []) {
    for (const r of rg.results ?? []) {
      for (const c of r.metadata?.reportingUnitSummary?.reportingUnitComponentSummary ?? []) {
        if (c.dataProvider && c.displayName) {
          map.set(c.dataProvider, c.displayName);
        }
      }
    }
  }
  return map;
}

function diffDays(start: string | undefined, end: string | undefined): number {
  if (!start || !end) return 0;
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / (1000 * 60 * 60 * 24)));
}

// Halo dates arrive either as ISO strings (createTime) or as google.type.Date
// objects ({year, month, day, ...}). Normalize both to "YYYY-MM-DD".
export type HaloDate =
  | string
  | { year?: number; month?: number; day?: number }
  | null
  | undefined;

export function shortDate(d: HaloDate): string {
  if (d == null) return "";
  if (typeof d === "string") {
    const parsed = new Date(d);
    if (Number.isNaN(parsed.getTime())) return d;
    return parsed.toISOString().slice(0, 10);
  }
  if (typeof d === "object" && typeof d.year === "number") {
    const y = String(d.year).padStart(4, "0");
    const m = String(d.month ?? 1).padStart(2, "0");
    const day = String(d.day ?? 1).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  return "";
}

// --- Result classification helpers ------------------------------------------
//
// A Halo report mixes three kinds of results in its resultGroups:
//   - totals       : single top-level result (no dim filters/groupings, freq.total)
//   - weekly slices: one per week (freq.weekly)
//   - demographic cells: per-segment results (carries dimensionSpecSummary)
// They can appear in any order across resultGroups, so classify by metadata,
// never by index.

function isDemographicCell(r: ResultGroupResult): boolean {
  const dim = r.metadata?.dimensionSpecSummary;
  if (!dim) return false;
  const hasGroupingValue = (dim.groupings ?? []).some(
    (g) => g.value?.enumValue || g.value?.stringValue,
  );
  const hasFilterValue = (dim.filters ?? []).some(
    (f) => f.key != null && f.value != null,
  );
  return hasGroupingValue || hasFilterValue;
}

function isWeeklyResult(r: ResultGroupResult): boolean {
  return r.metadata?.metricFrequency?.weekly != null && !isDemographicCell(r);
}

function isTotalCandidate(r: ResultGroupResult): boolean {
  return !isDemographicCell(r) && !isWeeklyResult(r);
}

// Prefer the total-level result that carries per-publisher components — some
// reports include both a thin total (reportingUnit only) and a richer total
// (with components); we want the latter.
function pickHeadline(report: BasicReport): ResultGroupResult | undefined {
  let best: ResultGroupResult | undefined;
  for (const rg of report.resultGroups ?? []) {
    for (const r of rg.results ?? []) {
      if (!isTotalCandidate(r)) continue;
      if (!best) { best = r; continue; }
      const bestComp = best.metricSet?.components?.length ?? 0;
      const rComp = r.metricSet?.components?.length ?? 0;
      if (rComp > bestComp) best = r;
    }
  }
  return best;
}

// FEMALE → Female, YEARS_18_TO_34 → 18-34, YEARS_55_PLUS → 55+
function formatSegmentValue(s: string): string {
  const range = s.match(/^YEARS_(\d+)_TO_(\d+)$/i);
  if (range) return `${range[1]}-${range[2]}`;
  const plus = s.match(/^YEARS_(\d+)_PLUS$/i);
  if (plus) return `${plus[1]}+`;
  if (s.length > 0 && s === s.toUpperCase()) {
    return s[0] + s.slice(1).toLowerCase();
  }
  return s;
}

function buildSegmentLabel(r: ResultGroupResult): string {
  const dim = r.metadata?.dimensionSpecSummary;
  if (!dim) return "";
  if (dim.dimensionCellLabel) return dim.dimensionCellLabel;
  const parts: string[] = [];
  for (const g of dim.groupings ?? []) {
    const v = g.value?.enumValue ?? g.value?.stringValue;
    if (v) parts.push(formatSegmentValue(v));
  }
  for (const f of dim.filters ?? []) {
    if (f.value) parts.push(formatSegmentValue(String(f.value)));
  }
  return parts.join(" · ");
}

function epochOf(d: HaloDate): number {
  if (d == null) return 0;
  if (typeof d === "string") {
    const t = Date.parse(d);
    return Number.isFinite(t) ? t : 0;
  }
  if (typeof d === "object" && typeof d.year === "number") {
    return Date.UTC(d.year, (d.month ?? 1) - 1, d.day ?? 1);
  }
  return 0;
}

export function parseReport(report: BasicReport): ParsedReport {
  const publisherNames = dataProviderDisplayMap(report);
  const resultGroups = report.resultGroups ?? [];

  // Scan all RGs for the best headline (total-level, components preferred).
  // Fall back to results[0][0] only if no candidate matches (degenerate report).
  const headline = pickHeadline(report) ?? resultGroups[0]?.results?.[0];
  const headlineMetricSet = headline?.metricSet;
  const totalMetrics = parseMetrics(pickPopulated(headlineMetricSet?.reportingUnit));
  const populationSize = toInt(headlineMetricSet?.populationSize);

  const publishers: PublisherMetrics[] = (headlineMetricSet?.components ?? []).map((c) => {
    const key = c.key ?? "";
    const dataProvider = key.replace(/^dataProviders\//, "");
    const displayName = publisherNames.get(key) ?? publisherNames.get(dataProvider) ?? dataProvider;
    const metrics = parseMetrics(pickPopulated(c.value));
    const uniqueRaw = c.value?.cumulativeUnique ?? c.value?.nonCumulativeUnique;
    return {
      dataProvider,
      displayName,
      metrics,
      uniqueReach: uniqueRaw ? toInt(uniqueRaw.reach) : undefined,
    };
  });

  const stackedIncremental = (headlineMetricSet?.reportingUnit?.stackedIncrementalReach ?? []).map((s) => {
    const dp = s.dataProvider?.replace(/^dataProviders\//, "") ?? "";
    return {
      dataProvider: publisherNames.get(s.dataProvider ?? "") ?? dp,
      reach: toInt(s.reach),
    };
  });

  // Weekly: collect every freq.weekly result across all RGs, sort chronologically
  // by metricEndTime (RG order is not guaranteed).
  const weeklyResults: ResultGroupResult[] = [];
  for (const rg of resultGroups) {
    for (const r of rg.results ?? []) {
      if (isWeeklyResult(r)) weeklyResults.push(r);
    }
  }
  weeklyResults.sort((a, b) =>
    epochOf(a.metadata?.metricEndTime) - epochOf(b.metadata?.metricEndTime),
  );

  let weekly: ParsedReport["weekly"];
  if (weeklyResults.length) {
    weekly = weeklyResults.map((r, idx) => {
      const ms = r.metricSet;
      const unit = pickPopulated(ms?.reportingUnit);
      const cumRaw = ms?.reportingUnit?.cumulative;
      const start = r.metadata?.nonCumulativeMetricStartTime ?? r.metadata?.cumulativeMetricStartTime;
      const end = r.metadata?.metricEndTime;
      const label = start && end ? `${shortDate(start)} → ${shortDate(end)}` : `Week ${idx + 1}`;
      return {
        weekLabel: label,
        cumulativeReach: toInt(cumRaw?.reach),
        nonCumulativeReach: toInt(unit?.reach),
        impressions: toInt(unit?.impressions),
        averageFrequency: typeof unit?.averageFrequency === "number" ? unit.averageFrequency : 0,
        perPublisher: (ms?.components ?? []).map((c) => {
          const dp = c.key?.replace(/^dataProviders\//, "") ?? "";
          const compUnit = pickPopulated(c.value);
          return {
            dataProvider: publisherNames.get(c.key ?? "") ?? dp,
            impressions: toInt(compUnit?.impressions),
            reach: toInt(compUnit?.reach),
            averageFrequency: typeof compUnit?.averageFrequency === "number" ? compUnit.averageFrequency : 0,
          };
        }),
      };
    });
  }

  const metricFrequency: ParsedReport["metricFrequency"] = weeklyResults.length
    ? "weekly"
    : headline?.metadata?.metricFrequency?.total
      ? "total"
      : "unknown";

  // Demographics: any result with a dimensionSpecSummary that has a non-empty
  // grouping value or filter value. Two conventions are supported (see types).
  const demographics: Demographic[] = [];
  for (const rg of resultGroups) {
    for (const r of rg.results ?? []) {
      if (!isDemographicCell(r)) continue;
      demographics.push({
        segmentLabel: buildSegmentLabel(r),
        rgTitle: rg.title ?? "",
        populationSize: toInt(r.metricSet?.populationSize),
        metrics: parseMetrics(pickPopulated(r.metricSet?.reportingUnit)),
      });
    }
  }

  return {
    name: report.name ?? "",
    title: report.title ?? report.name ?? "Untitled report",
    state: report.state ?? "",
    campaignGroup: report.campaignGroupDisplayName ?? "",
    periodStart: shortDate(report.reportingInterval?.reportStart),
    periodEnd: shortDate(report.reportingInterval?.reportEnd),
    durationDays: diffDays(report.reportingInterval?.reportStart, report.reportingInterval?.reportEnd),
    modelLine: report.effectiveModelLine ?? "",
    populationSize,
    total: totalMetrics,
    publishers,
    stackedIncremental,
    metricFrequency,
    weekly,
    demographics,
  };
}

// --- Number formatting helpers ---

export function fmtInt(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return Math.round(n).toLocaleString();
}

export function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

export function fmtFreq(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  return n.toFixed(2);
}
