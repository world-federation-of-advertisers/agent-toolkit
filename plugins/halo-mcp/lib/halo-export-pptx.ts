/**
 * Deterministic PPTX generator for Halo Basic Reports.
 *
 * Pure TypeScript — no Python, no subprocess. Takes the raw BasicReport JSON
 * the Halo REST API returns, parses it with `parseReport()` (the same
 * normaliser the in-app dashboard uses), and emits a native .pptx via
 * pptxgenjs. Charts are native PowerPoint chart objects, so they remain
 * editable and theme-aware in the deck.
 *
 * Slide deck (skipped if data is missing):
 *   1. Campaign Overview    — hero KPI cards + publisher chips
 *   2. Cross-Media Reach    — stacked incremental column chart
 *   3. Reach vs Unique      — grouped column chart (conditional)
 *   4. Frequency Distribution — k+ column chart (conditional)
 *   5. Weekly Trends        — cumulative + non-cumulative line chart (conditional)
 *   6. Demographics         — per-segment reach/freq table (conditional)
 *   7. Summary              — stat cards + publisher table
 *
 * Non-SUCCEEDED reports get a single status slide.
 */
import PptxGenJSImport from "pptxgenjs";
// pptxgenjs ships dual ESM/CJS; under tsx the default export is the namespace,
// not the constructor. Pull the constructor out either way.
const PptxGenJS = ((PptxGenJSImport as unknown as { default?: typeof PptxGenJSImport }).default
  ?? PptxGenJSImport) as typeof PptxGenJSImport;
// The class shares its name with a types namespace, so refer to instances
// via the constructor type to avoid TS2709.
type Pres = InstanceType<typeof PptxGenJS>;
import type { BasicReport } from "../src/halo-types.ts";
import {
  fmtFreq,
  fmtInt,
  fmtPct,
  parseReport,
  type ParsedReport,
  type PublisherMetrics,
} from "../src/halo-types.ts";

// ---- Design tokens (hex without #, matching pptxgenjs convention) ----------

const C = {
  navy: "0F172A",
  slate700: "334155",
  slate600: "475569",
  slate500: "64748B",
  slate400: "94A3B8",
  slate300: "CBD5E1",
  slate200: "E2E8F0",
  slate100: "F1F5F9",
  slate50: "F8FAFC",
  blue: "3B82F6",
  teal: "14B8A6",
  green: "10B981",
  amber: "F59E0B",
  red: "EF4444",
  purple: "8B5CF6",
  white: "FFFFFF",
} as const;

const PUB_PALETTE = [C.blue, C.teal, C.purple, C.amber];

const FONT_HEAD = "Calibri Light";
const FONT_BODY = "Calibri";

// Slide is 10 x 5.625 in (LAYOUT_16x9 default). Everything in inches.
const SLIDE_W = 10;
const SLIDE_H = 5.625;
const M = 0.4; // left/right margin

// ---- Small helpers ---------------------------------------------------------

type Slide = ReturnType<Pres["addSlide"]>;

function pubColor(i: number): string {
  return PUB_PALETTE[i % PUB_PALETTE.length];
}

function header(slide: Slide, title: string, subtitle?: string): void {
  slide.background = { color: C.slate50 };
  // Top accent bar.
  slide.addShape("rect", { x: 0, y: 0, w: SLIDE_W, h: 0.06, fill: { color: C.blue }, line: { type: "none" } });
  slide.addText(title, {
    x: M, y: 0.22, w: SLIDE_W - 2 * M, h: 0.5,
    fontFace: FONT_HEAD, fontSize: 24, bold: true, color: C.navy,
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: M, y: 0.7, w: SLIDE_W - 2 * M, h: 0.3,
      fontFace: FONT_BODY, fontSize: 11, color: C.slate500,
    });
  }
}

function footer(slide: Slide, text: string): void {
  slide.addText(text, {
    x: M, y: SLIDE_H - 0.3, w: SLIDE_W - 2 * M, h: 0.25,
    fontFace: FONT_BODY, fontSize: 9, color: C.slate400, align: "left",
  });
}

function statCard(
  slide: Slide,
  x: number, y: number, w: number, h: number,
  value: string, label: string, accent: string,
): void {
  slide.addShape("roundRect", {
    x, y, w, h, rectRadius: 0.08,
    fill: { color: C.white }, line: { color: C.slate200, width: 0.5 },
  });
  // Left accent stripe.
  slide.addShape("rect", {
    x, y: y + 0.1, w: 0.08, h: h - 0.2,
    fill: { color: accent }, line: { type: "none" },
  });
  slide.addText(value, {
    x: x + 0.2, y: y + 0.15, w: w - 0.3, h: h * 0.55,
    fontFace: FONT_HEAD, fontSize: 22, bold: true, color: C.navy, valign: "middle",
  });
  slide.addText(label.toUpperCase(), {
    x: x + 0.2, y: y + h * 0.62, w: w - 0.3, h: h * 0.3,
    fontFace: FONT_BODY, fontSize: 9, bold: true, color: C.slate500, charSpacing: 1,
  });
}

// ---- Per-slide builders ----------------------------------------------------

function slideOverview(pres: Pres, r: ParsedReport): void {
  const s = pres.addSlide();
  const period = r.periodStart && r.periodEnd ? `${r.periodStart} → ${r.periodEnd}` : "";
  header(s, r.title || "Untitled Report", [r.campaignGroup, period].filter(Boolean).join(" · "));

  const kpis: Array<{ value: string; label: string; color: string }> = [
    { value: fmtInt(r.total.reach), label: "Net reach", color: C.blue },
    { value: fmtPct(r.total.percentReach), label: "% of population", color: C.teal },
    { value: fmtFreq(r.total.averageFrequency), label: "Avg frequency", color: C.purple },
    { value: fmtInt(r.total.impressions), label: "Impressions", color: C.slate600 },
  ];
  const cardW = (SLIDE_W - 2 * M - 0.3 * 3) / 4;
  kpis.forEach((k, i) => {
    statCard(s, M + i * (cardW + 0.3), 1.25, cardW, 1.0, k.value, k.label, k.color);
  });

  // Publisher chips row.
  if (r.publishers.length) {
    s.addText("Publisher contribution", {
      x: M, y: 2.55, w: SLIDE_W - 2 * M, h: 0.3,
      fontFace: FONT_BODY, fontSize: 11, bold: true, color: C.slate700,
    });
    const cw = (SLIDE_W - 2 * M - 0.2 * (r.publishers.length - 1)) / Math.max(r.publishers.length, 1);
    r.publishers.forEach((p, i) => {
      const x = M + i * (cw + 0.2);
      s.addShape("roundRect", {
        x, y: 2.9, w: cw, h: 1.1, rectRadius: 0.06,
        fill: { color: C.white }, line: { color: C.slate200, width: 0.5 },
      });
      s.addShape("ellipse", {
        x: x + 0.18, y: 3.05, w: 0.18, h: 0.18,
        fill: { color: pubColor(i) }, line: { type: "none" },
      });
      s.addText(p.displayName, {
        x: x + 0.45, y: 3.0, w: cw - 0.55, h: 0.3,
        fontFace: FONT_BODY, fontSize: 10, bold: true, color: C.navy,
      });
      s.addText(`${fmtInt(p.metrics.reach)} reach`, {
        x: x + 0.18, y: 3.35, w: cw - 0.3, h: 0.3,
        fontFace: FONT_HEAD, fontSize: 14, bold: true, color: C.navy,
      });
      s.addText(`${fmtInt(p.metrics.impressions)} imp · ${fmtFreq(p.metrics.averageFrequency)}× freq`, {
        x: x + 0.18, y: 3.68, w: cw - 0.3, h: 0.3,
        fontFace: FONT_BODY, fontSize: 9, color: C.slate500,
      });
    });
  }

  // Insight strip.
  const insight = composeInsight(r);
  if (insight) {
    s.addShape("roundRect", {
      x: M, y: 4.4, w: SLIDE_W - 2 * M, h: 0.7, rectRadius: 0.06,
      fill: { color: C.slate100 }, line: { color: C.slate200, width: 0.5 },
    });
    s.addText([
      { text: "Key insight  ", options: { bold: true, color: C.slate600, fontSize: 9 } },
      { text: insight, options: { color: C.slate700, fontSize: 10 } },
    ], { x: M + 0.2, y: 4.45, w: SLIDE_W - 2 * M - 0.4, h: 0.6, fontFace: FONT_BODY, valign: "middle" });
  }

  footer(s, footerText(r));
}

function slideCrossMediaReach(pres: Pres, r: ParsedReport): void {
  if (!r.stackedIncremental.length) return;
  const s = pres.addSlide();
  header(s, "Cross-Media Reach", "Incremental reach contributed by each publisher");

  const data = [{
    name: "Incremental reach",
    labels: r.stackedIncremental.map((x) => x.dataProvider),
    values: r.stackedIncremental.map((x) => x.reach),
  }];

  s.addChart(pres.ChartType.bar, data, {
    x: M, y: 1.1, w: SLIDE_W - 2 * M, h: 3.7,
    barDir: "col",
    chartColors: r.stackedIncremental.map((_, i) => pubColor(i)),
    chartColorsOpacity: 100,
    catAxisLabelFontFace: FONT_BODY,
    catAxisLabelFontSize: 10,
    catAxisLabelColor: C.slate500,
    valAxisLabelFontFace: FONT_BODY,
    valAxisLabelFontSize: 9,
    valAxisLabelColor: C.slate500,
    valAxisLabelFormatCode: "#,##0",
    showLegend: false,
    showValue: true,
    dataLabelFontFace: FONT_HEAD,
    dataLabelFontSize: 10,
    dataLabelColor: C.slate700,
    dataLabelFormatCode: "#,##0",
    dataLabelPosition: "outEnd",
    showTitle: false,
    plotArea: { fill: { color: C.white } },
  });

  // Net reach footnote.
  s.addText(
    `Net reach: ${fmtInt(r.total.reach)}  ·  Gross reach: ${fmtInt(
      r.publishers.reduce((acc, p) => acc + p.metrics.reach, 0),
    )}`,
    { x: M, y: 4.85, w: SLIDE_W - 2 * M, h: 0.3, fontFace: FONT_BODY, fontSize: 10, color: C.slate600 },
  );

  footer(s, footerText(r));
}

function slideReachVsUnique(pres: Pres, r: ParsedReport): void {
  const withUnique = r.publishers.filter((p) => typeof p.uniqueReach === "number" && p.uniqueReach > 0);
  if (withUnique.length < 2) return;
  const s = pres.addSlide();
  header(s, "Reach vs. Unique Reach", "Total reach vs the portion only reached by this publisher");

  const labels = r.publishers.map((p) => p.displayName);
  const data = [
    { name: "Total reach", labels, values: r.publishers.map((p) => p.metrics.reach) },
    { name: "Unique reach", labels, values: r.publishers.map((p) => p.uniqueReach ?? 0) },
  ];

  s.addChart(pres.ChartType.bar, data, {
    x: M, y: 1.1, w: SLIDE_W - 2 * M, h: 3.9,
    barDir: "col",
    barGrouping: "clustered",
    chartColors: [C.blue, C.teal],
    catAxisLabelFontFace: FONT_BODY,
    catAxisLabelFontSize: 10,
    catAxisLabelColor: C.slate500,
    valAxisLabelFontFace: FONT_BODY,
    valAxisLabelFontSize: 9,
    valAxisLabelColor: C.slate500,
    valAxisLabelFormatCode: "#,##0",
    showLegend: true,
    legendPos: "t",
    legendFontFace: FONT_BODY,
    legendFontSize: 10,
    legendColor: C.slate600,
    showValue: false,
    showTitle: false,
    plotArea: { fill: { color: C.white } },
  });

  footer(s, footerText(r));
}

function slideFrequency(pres: Pres, r: ParsedReport): void {
  const k = r.total.kPlusReach;
  if (!k.length) return;
  const s = pres.addSlide();
  header(s, "Frequency Distribution", "How many people saw the campaign at least N times");

  const labels = k.map((_, i) => `${i + 1}+`);
  const data = [{ name: "Reach", labels, values: k }];

  // Highlight 3+ effective frequency by varying colors per bar.
  const barColors = k.map((_, i) => (i < 2 ? C.blue : i === 2 ? C.red : C.slate400));

  s.addChart(pres.ChartType.bar, data, {
    x: M, y: 1.1, w: SLIDE_W - 2 * M, h: 3.6,
    barDir: "col",
    chartColors: barColors,
    catAxisLabelFontFace: FONT_BODY,
    catAxisLabelFontSize: 10,
    catAxisLabelColor: C.slate500,
    valAxisLabelFontFace: FONT_BODY,
    valAxisLabelFontSize: 9,
    valAxisLabelColor: C.slate500,
    valAxisLabelFormatCode: "#,##0",
    showLegend: false,
    showValue: true,
    dataLabelFontFace: FONT_HEAD,
    dataLabelFontSize: 9,
    dataLabelColor: C.slate700,
    dataLabelFormatCode: "#,##0",
    dataLabelPosition: "outEnd",
    showTitle: false,
    plotArea: { fill: { color: C.white } },
  });

  const eff = k[2];
  if (eff) {
    const share = r.total.reach > 0 ? eff / r.total.reach : 0;
    s.addText(
      `Effective frequency (3+):  ${fmtInt(eff)} people  ·  ${fmtPct(share)} of net reach`,
      { x: M, y: 4.8, w: SLIDE_W - 2 * M, h: 0.3, fontFace: FONT_BODY, fontSize: 10, color: C.slate600 },
    );
  }

  footer(s, footerText(r));
}

function slideWeekly(pres: Pres, r: ParsedReport): void {
  const w = r.weekly;
  if (!w?.length) return;
  const s = pres.addSlide();
  header(s, "Weekly Trends", "Cumulative reach build over campaign duration");

  const labels = w.map((x) => x.weekLabel);
  const data = [
    { name: "Cumulative reach", labels, values: w.map((x) => x.cumulativeReach) },
    { name: "Weekly reach", labels, values: w.map((x) => x.nonCumulativeReach) },
  ];

  s.addChart(pres.ChartType.line, data, {
    x: M, y: 1.1, w: SLIDE_W - 2 * M, h: 3.7,
    chartColors: [C.blue, C.purple],
    lineSize: 2,
    lineDataSymbol: "circle",
    lineDataSymbolSize: 7,
    catAxisLabelFontFace: FONT_BODY,
    catAxisLabelFontSize: 8,
    catAxisLabelColor: C.slate500,
    catAxisLabelRotate: -30,
    valAxisLabelFontFace: FONT_BODY,
    valAxisLabelFontSize: 9,
    valAxisLabelColor: C.slate500,
    valAxisLabelFormatCode: "#,##0",
    showLegend: true,
    legendPos: "t",
    legendFontFace: FONT_BODY,
    legendFontSize: 10,
    legendColor: C.slate600,
    showTitle: false,
    plotArea: { fill: { color: C.white } },
  });

  const last = w[w.length - 1];
  const first = w[0];
  const w1Share = last.cumulativeReach > 0 ? first.cumulativeReach / last.cumulativeReach : 0;
  s.addText(
    `Week 1 delivered ${fmtPct(w1Share)} of final cumulative reach across ${w.length} week(s).`,
    { x: M, y: 4.85, w: SLIDE_W - 2 * M, h: 0.3, fontFace: FONT_BODY, fontSize: 10, color: C.slate600 },
  );

  footer(s, footerText(r));
}

function slideDemographics(pres: Pres, r: ParsedReport): void {
  if (!r.demographics.length) return;
  const s = pres.addSlide();
  const rgTitle = r.demographics[0]?.rgTitle;
  header(s, "Demographics", rgTitle || "Per-segment reach and frequency");

  const cols = ["Segment", "Population", "Reach", "% Reach", "Avg Freq.", "Impressions"];
  const widths = [2.8, 1.5, 1.5, 1.2, 1.2, 1.6];
  const totalW = widths.reduce((a, b) => a + b, 0);
  const scale = (SLIDE_W - 2 * M) / totalW;
  const colW = widths.map((w) => w * scale);

  const top = 1.15;
  const availableH = SLIDE_H - top - 0.6;
  const rowH = Math.min(0.36, availableH / (r.demographics.length + 1));

  // Header.
  let x = M;
  cols.forEach((c, i) => {
    s.addShape("rect", {
      x, y: top, w: colW[i], h: rowH,
      fill: { color: C.slate100 }, line: { color: C.slate200, width: 0.5 },
    });
    s.addText(c.toUpperCase(), {
      x: x + 0.1, y: top, w: colW[i] - 0.2, h: rowH,
      fontFace: FONT_BODY, fontSize: 9, bold: true, color: C.slate600, charSpacing: 1,
      valign: "middle", align: i === 0 ? "left" : "right",
    });
    x += colW[i];
  });

  // Body rows.
  r.demographics.forEach((d, ri) => {
    const y = top + rowH + ri * rowH;
    let cx = M;
    const cells: Array<{ text: string; align: "left" | "right" }> = [
      { text: d.segmentLabel || "—", align: "left" },
      { text: fmtInt(d.populationSize), align: "right" },
      { text: fmtInt(d.metrics.reach), align: "right" },
      { text: fmtPct(d.metrics.percentReach), align: "right" },
      { text: fmtFreq(d.metrics.averageFrequency), align: "right" },
      { text: fmtInt(d.metrics.impressions), align: "right" },
    ];
    cells.forEach((c, i) => {
      s.addShape("rect", {
        x: cx, y, w: colW[i], h: rowH,
        fill: { color: ri % 2 === 0 ? C.white : C.slate50 },
        line: { color: C.slate200, width: 0.5 },
      });
      s.addText(c.text, {
        x: cx + 0.1, y, w: colW[i] - 0.2, h: rowH,
        fontFace: i === 0 ? FONT_BODY : FONT_HEAD, fontSize: 10,
        color: i === 0 ? C.navy : C.slate700,
        bold: i === 0,
        valign: "middle", align: c.align,
      });
      cx += colW[i];
    });
  });

  footer(s, footerText(r));
}

function slideSummary(pres: Pres, r: ParsedReport): void {
  const s = pres.addSlide();
  header(s, "Summary", r.campaignGroup || r.title);

  // Top stat row.
  const stats: Array<{ value: string; label: string; color: string }> = [
    { value: fmtInt(r.total.reach), label: "Net reach", color: C.blue },
    { value: fmtInt(r.total.impressions), label: "Impressions", color: C.slate600 },
    { value: fmtFreq(r.total.averageFrequency), label: "Avg frequency", color: C.purple },
    { value: `${r.durationDays}d`, label: "Duration", color: C.green },
  ];
  const cardW = (SLIDE_W - 2 * M - 0.3 * 3) / 4;
  stats.forEach((k, i) => {
    statCard(s, M + i * (cardW + 0.3), 1.15, cardW, 0.85, k.value, k.label, k.color);
  });

  // Publisher table.
  publisherTable(s, r, 2.25, 2.7);
  footer(s, footerText(r));
}

function publisherTable(s: Slide, r: ParsedReport, top: number, height: number): void {
  if (!r.publishers.length) return;
  const cols = ["Publisher", "Reach", "% Reach", "Avg Freq.", "Impressions"];
  const widths = [3.2, 1.6, 1.4, 1.4, 1.6]; // sums to ~9.2 in
  const totalW = widths.reduce((a, b) => a + b, 0);
  const scale = (SLIDE_W - 2 * M) / totalW;
  const colW = widths.map((w) => w * scale);

  // Header row.
  const rowH = Math.min(0.4, height / (r.publishers.length + 1));
  let x = M;
  cols.forEach((c, i) => {
    s.addShape("rect", {
      x, y: top, w: colW[i], h: rowH,
      fill: { color: C.slate100 }, line: { color: C.slate200, width: 0.5 },
    });
    s.addText(c.toUpperCase(), {
      x: x + 0.1, y: top, w: colW[i] - 0.2, h: rowH,
      fontFace: FONT_BODY, fontSize: 9, bold: true, color: C.slate600, charSpacing: 1,
      valign: "middle", align: i === 0 ? "left" : "right",
    });
    x += colW[i];
  });

  // Body rows.
  r.publishers.forEach((p, ri) => {
    const y = top + rowH + ri * rowH;
    let cx = M;
    const cells: Array<{ text: string; align: "left" | "right" }> = [
      { text: p.displayName, align: "left" },
      { text: fmtInt(p.metrics.reach), align: "right" },
      { text: fmtPct(p.metrics.percentReach), align: "right" },
      { text: fmtFreq(p.metrics.averageFrequency), align: "right" },
      { text: fmtInt(p.metrics.impressions), align: "right" },
    ];
    cells.forEach((c, i) => {
      s.addShape("rect", {
        x: cx, y, w: colW[i], h: rowH,
        fill: { color: ri % 2 === 0 ? C.white : C.slate50 },
        line: { color: C.slate200, width: 0.5 },
      });
      if (i === 0) {
        // Publisher color dot.
        s.addShape("ellipse", {
          x: cx + 0.1, y: y + rowH / 2 - 0.075, w: 0.15, h: 0.15,
          fill: { color: pubColor(ri) }, line: { type: "none" },
        });
        s.addText(c.text, {
          x: cx + 0.32, y, w: colW[i] - 0.4, h: rowH,
          fontFace: FONT_BODY, fontSize: 10, color: C.navy, bold: true, valign: "middle",
        });
      } else {
        s.addText(c.text, {
          x: cx + 0.1, y, w: colW[i] - 0.2, h: rowH,
          fontFace: FONT_HEAD, fontSize: 10, color: C.slate700, valign: "middle", align: c.align,
        });
      }
      cx += colW[i];
    });
  });
}

function slideNotSucceeded(pres: Pres, r: ParsedReport): void {
  const s = pres.addSlide();
  s.background = { color: C.slate50 };
  s.addShape("rect", { x: 0, y: 0, w: SLIDE_W, h: 0.06, fill: { color: C.red }, line: { type: "none" } });
  s.addText(r.title || "Untitled Report", {
    x: M, y: 1.8, w: SLIDE_W - 2 * M, h: 0.6,
    fontFace: FONT_HEAD, fontSize: 22, bold: true, color: C.navy, align: "center",
  });
  s.addText(`Status: ${r.state || "UNKNOWN"}`, {
    x: M, y: 2.5, w: SLIDE_W - 2 * M, h: 0.4,
    fontFace: FONT_BODY, fontSize: 16, bold: true, color: C.red, align: "center",
  });
  const messages: Record<string, string> = {
    RUNNING: "This report is still computing. Results are not yet available.",
    FAILED: "This report failed to compute. Check the configuration and try again.",
    INVALID: "This report has been invalidated. A new report may be needed.",
  };
  s.addText(messages[r.state] ?? `Report state: ${r.state}`, {
    x: M, y: 3.1, w: SLIDE_W - 2 * M, h: 0.4,
    fontFace: FONT_BODY, fontSize: 11, color: C.slate600, align: "center",
  });
  footer(s, footerText(r));
}

// ---- Narrative + footer helpers --------------------------------------------

function composeInsight(r: ParsedReport): string {
  const parts: string[] = [];
  if (r.total.reach > 0 && r.total.percentReach > 0) {
    parts.push(
      `Reached ${fmtInt(r.total.reach)} people (${fmtPct(r.total.percentReach)} of the ${fmtInt(r.populationSize)} target population)`,
    );
  }
  if (r.total.averageFrequency > 0) {
    parts.push(`at an average frequency of ${fmtFreq(r.total.averageFrequency)} exposures`);
  }
  const top = topPublisher(r.publishers);
  if (top && r.total.reach > 0) {
    const share = top.metrics.reach / r.total.reach;
    parts.push(`${top.displayName} delivered ${fmtPct(share)} of total reach`);
  }
  return parts.join(". ") + (parts.length ? "." : "");
}

function topPublisher(pubs: PublisherMetrics[]): PublisherMetrics | undefined {
  if (!pubs.length) return undefined;
  return pubs.reduce((a, b) => (b.metrics.reach > a.metrics.reach ? b : a), pubs[0]);
}

function footerText(r: ParsedReport): string {
  const bits = [r.campaignGroup, r.modelLine, r.state].filter(Boolean);
  return bits.join("  ·  ");
}

// ---- Public entry points ---------------------------------------------------

export function buildPresentation(reportJson: BasicReport): Pres {
  const parsed = parseReport(reportJson);
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_16x9";
  pres.title = parsed.title || "Halo Report";
  pres.company = "Halo Cross-Media Measurement";

  if (parsed.state && parsed.state !== "SUCCEEDED") {
    slideNotSucceeded(pres, parsed);
    return pres;
  }

  slideOverview(pres, parsed);
  if (parsed.stackedIncremental.length) slideCrossMediaReach(pres, parsed);
  if (parsed.publishers.some((p) => (p.uniqueReach ?? 0) > 0)) slideReachVsUnique(pres, parsed);
  if (parsed.total.kPlusReach.length) slideFrequency(pres, parsed);
  if (parsed.weekly?.length) slideWeekly(pres, parsed);
  if (parsed.demographics.length) slideDemographics(pres, parsed);
  slideSummary(pres, parsed);

  return pres;
}

export async function generatePptxBuffer(reportJson: BasicReport): Promise<Buffer> {
  const pres = buildPresentation(reportJson);
  const out = await pres.stream({ compression: true });
  if (out instanceof Uint8Array) return Buffer.from(out);
  if (typeof out === "string") return Buffer.from(out, "binary");
  if (out instanceof ArrayBuffer) return Buffer.from(out);
  // Blob fallback (browser path — not expected on Node, but harmless).
  return Buffer.from(await (out as Blob).arrayBuffer());
}

export async function writePptx(reportJson: BasicReport, outPath: string): Promise<string> {
  const pres = buildPresentation(reportJson);
  return pres.writeFile({ fileName: outPath, compression: true });
}
