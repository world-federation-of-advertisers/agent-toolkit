/**
 * Synthetic Halo BasicReport fixtures for demo / fake-mode.
 *
 * Three fictional brands, three distinct narratives:
 *   • veliro      — healthy launch (no pitfalls)
 *   • pellura    — one publisher (Vega) over-saturates: 60% of impressions,
 *                  9% of reach, 53× frequency
 *   • cobari      — two publishers heavily overlap (89% of one inside the other)
 *
 * Numbers are internally consistent (gross > net, stackedIncremental sums to
 * net reach, impressions = reach × freq, kPlusReach monotonically decreases).
 *
 * Publisher names are constellations (Orion, Vega, Lyra, Cygnus, Draco) so no
 * real platform is implicitly cast as a villain.
 */

import type { BasicReport } from "./halo-client.ts";

// Build a BasicMetricSet, computing implied fields where omitted.
function metrics(opts: {
  reach: number;
  impressions: number;
  freq?: number;
  populationSize: number;
  kPlusReach?: number[];
}): Record<string, unknown> {
  const freq = opts.freq ?? opts.impressions / Math.max(opts.reach, 1);
  const percentReach = opts.reach / opts.populationSize;
  const grps = percentReach * freq * 100;
  const kPlusReach = opts.kPlusReach ?? defaultKPlus(opts.reach, freq);
  const percentKPlusReach = kPlusReach.map((k) => k / opts.populationSize);
  return {
    reach: String(opts.reach),
    impressions: String(opts.impressions),
    averageFrequency: round2(freq),
    percentReach: round4(percentReach),
    grps: round2(grps),
    kPlusReach: kPlusReach.map(String),
    percentKPlusReach: percentKPlusReach.map(round4),
  };
}

// Geometric decay seeded by avg frequency; produces a plausible k+ tail.
function defaultKPlus(reach: number, freq: number): number[] {
  // decay ratio: higher freq → flatter tail; lower freq → steeper.
  const r = Math.min(0.78, 0.32 + freq * 0.04);
  const out: number[] = [];
  let v = reach;
  for (let i = 0; i < 15; i++) {
    out.push(Math.round(v));
    v *= r;
    if (v < 1) break;
  }
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

// ─────────────────────────────────────────────────────────────────────
// Fixture 1 — Veliro Athletic, healthy launch
// ─────────────────────────────────────────────────────────────────────

const VELIRO_POP = 50_000_000;
const VELIRO_TOTAL_REACH = 18_000_000;
const VELIRO_TOTAL_IMP = 69_000_000;

const VELIRO: BasicReport = {
  name: "measurementConsumers/demo/basicReports/fixture_veliro_q1",
  title: "Veliro Athletic — Run 1 Launch",
  state: "SUCCEEDED",
  createTime: "2026-03-15T10:00:00Z",
  campaignGroupDisplayName: "Veliro Athletic Run 1",
  campaignGroup: "measurementConsumers/demo/reportingSets/veliro_run1",
  reportingInterval: { reportStart: "2026-01-13", reportEnd: "2026-03-09" },
  effectiveImpressionQualificationFilters: [
    { impressionQualificationFilter: "impressionQualificationFilters/mrc_video_standard" },
  ],
  effectiveModelLine: "modelProviders/wfa/modelLines/v2026",
  resultGroups: [
    {
      title: "Total",
      results: [
        {
          metadata: {
            reportingUnitSummary: {
              reportingUnitComponentSummary: [
                { dataProvider: "dataProviders/orion", displayName: "Orion" },
                { dataProvider: "dataProviders/cygnus", displayName: "Cygnus" },
                { dataProvider: "dataProviders/lyra", displayName: "Lyra" },
              ],
            },
            metricFrequency: { total: true },
          },
          metricSet: {
            populationSize: String(VELIRO_POP),
            reportingUnit: {
              cumulative: metrics({
                reach: VELIRO_TOTAL_REACH,
                impressions: VELIRO_TOTAL_IMP,
                populationSize: VELIRO_POP,
              }),
              stackedIncrementalReach: [
                { dataProvider: "dataProviders/orion", reach: "12000000" },
                { dataProvider: "dataProviders/cygnus", reach: "4000000" },
                { dataProvider: "dataProviders/lyra", reach: "2000000" },
              ],
            },
            components: [
              {
                key: "dataProviders/orion",
                value: {
                  cumulative: metrics({
                    reach: 12_000_000,
                    impressions: 30_000_000,
                    populationSize: VELIRO_POP,
                  }),
                  cumulativeUnique: { reach: "10500000" },
                },
              },
              {
                key: "dataProviders/cygnus",
                value: {
                  cumulative: metrics({
                    reach: 8_000_000,
                    impressions: 24_000_000,
                    populationSize: VELIRO_POP,
                  }),
                  cumulativeUnique: { reach: "5500000" },
                },
              },
              {
                key: "dataProviders/lyra",
                value: {
                  cumulative: metrics({
                    reach: 6_000_000,
                    impressions: 15_000_000,
                    populationSize: VELIRO_POP,
                  }),
                  cumulativeUnique: { reach: "4000000" },
                },
              },
            ],
            componentIntersections: [
              {
                components: ["dataProviders/orion", "dataProviders/cygnus"],
                metricSet: { reach: "2500000" },
              },
              {
                components: ["dataProviders/orion", "dataProviders/lyra"],
                metricSet: { reach: "1500000" },
              },
              {
                components: ["dataProviders/cygnus", "dataProviders/lyra"],
                metricSet: { reach: "1200000" },
              },
            ],
          },
        },
      ],
    },
  ],
} as BasicReport;

// ─────────────────────────────────────────────────────────────────────
// Fixture 2 — Pellura Vitamin-C Serum, saturation reveal
// ─────────────────────────────────────────────────────────────────────

const PEL_POP = 50_000_000;
const PEL_NET_REACH = 11_000_000;
const PEL_TOTAL_IMP = 88_000_000;

const PELLURA: BasicReport = {
  name: "measurementConsumers/demo/basicReports/fixture_pellura_q1",
  title: "Pellura Vitamin-C Serum — Q1 Launch",
  state: "SUCCEEDED",
  createTime: "2026-03-18T10:00:00Z",
  campaignGroupDisplayName: "Pellura V-C Serum Launch",
  campaignGroup: "measurementConsumers/demo/reportingSets/pellura_vc_q1",
  reportingInterval: { reportStart: "2026-02-01", reportEnd: "2026-03-14" },
  effectiveImpressionQualificationFilters: [
    { impressionQualificationFilter: "impressionQualificationFilters/mrc_video_standard" },
  ],
  effectiveModelLine: "modelProviders/wfa/modelLines/v2026",
  resultGroups: [
    {
      title: "Total",
      results: [
        {
          metadata: {
            reportingUnitSummary: {
              reportingUnitComponentSummary: [
                { dataProvider: "dataProviders/orion", displayName: "Orion" },
                { dataProvider: "dataProviders/vega", displayName: "Vega" },
                { dataProvider: "dataProviders/lyra", displayName: "Lyra" },
                { dataProvider: "dataProviders/cygnus", displayName: "Cygnus" },
                { dataProvider: "dataProviders/draco", displayName: "Draco" },
              ],
            },
            metricFrequency: { total: true },
          },
          metricSet: {
            populationSize: String(PEL_POP),
            reportingUnit: {
              cumulative: metrics({
                reach: PEL_NET_REACH,
                impressions: PEL_TOTAL_IMP,
                populationSize: PEL_POP,
              }),
              // Anchor order: Orion → Cygnus → Lyra → Vega → Draco.
              // Vega's stub (100K) is the visual punchline.
              stackedIncrementalReach: [
                { dataProvider: "dataProviders/orion", reach: "7500000" },
                { dataProvider: "dataProviders/cygnus", reach: "1700000" },
                { dataProvider: "dataProviders/lyra", reach: "1500000" },
                { dataProvider: "dataProviders/vega", reach: "100000" },
                { dataProvider: "dataProviders/draco", reach: "200000" },
              ],
            },
            components: [
              {
                key: "dataProviders/orion",
                value: {
                  cumulative: metrics({
                    reach: 7_500_000,
                    impressions: 18_000_000,
                    populationSize: PEL_POP,
                  }),
                  cumulativeUnique: { reach: "6500000" },
                },
              },
              {
                key: "dataProviders/vega",
                value: {
                  cumulative: metrics({
                    reach: 1_000_000,
                    impressions: 53_000_000,
                    populationSize: PEL_POP,
                  }),
                  cumulativeUnique: { reach: "100000" },
                },
              },
              {
                key: "dataProviders/lyra",
                value: {
                  cumulative: metrics({
                    reach: 3_200_000,
                    impressions: 8_000_000,
                    populationSize: PEL_POP,
                  }),
                  cumulativeUnique: { reach: "1500000" },
                },
              },
              {
                key: "dataProviders/cygnus",
                value: {
                  cumulative: metrics({
                    reach: 4_500_000,
                    impressions: 6_000_000,
                    populationSize: PEL_POP,
                  }),
                  cumulativeUnique: { reach: "1700000" },
                },
              },
              {
                key: "dataProviders/draco",
                value: {
                  cumulative: metrics({
                    reach: 1_500_000,
                    impressions: 3_000_000,
                    populationSize: PEL_POP,
                  }),
                  cumulativeUnique: { reach: "200000" },
                },
              },
            ],
            componentIntersections: [
              {
                components: ["dataProviders/orion", "dataProviders/vega"],
                metricSet: { reach: "900000" },
              },
              {
                components: ["dataProviders/orion", "dataProviders/cygnus"],
                metricSet: { reach: "2800000" },
              },
              {
                components: ["dataProviders/orion", "dataProviders/lyra"],
                metricSet: { reach: "1700000" },
              },
            ],
          },
        },
      ],
    },
  ],
} as BasicReport;

// ─────────────────────────────────────────────────────────────────────
// Fixture 3 — Cobari Coffee, heavy overlap (XMM-only insight)
// ─────────────────────────────────────────────────────────────────────

const COBARI_POP = 60_000_000;
const COBARI_NET_REACH = 22_000_000;
const COBARI_TOTAL_IMP = 138_000_000;

const COBARI: BasicReport = {
  name: "measurementConsumers/demo/basicReports/fixture_cobari_q1",
  title: "Cobari Coffee — Brand Awareness Q1",
  state: "SUCCEEDED",
  createTime: "2026-03-20T10:00:00Z",
  campaignGroupDisplayName: "Cobari Coffee Brand Awareness",
  campaignGroup: "measurementConsumers/demo/reportingSets/cobari_aware_q1",
  reportingInterval: { reportStart: "2026-01-06", reportEnd: "2026-03-09" },
  effectiveImpressionQualificationFilters: [
    { impressionQualificationFilter: "impressionQualificationFilters/mrc_video_standard" },
  ],
  effectiveModelLine: "modelProviders/wfa/modelLines/v2026",
  resultGroups: [
    {
      title: "Total",
      results: [
        {
          metadata: {
            reportingUnitSummary: {
              reportingUnitComponentSummary: [
                { dataProvider: "dataProviders/orion", displayName: "Orion" },
                { dataProvider: "dataProviders/cygnus", displayName: "Cygnus" },
              ],
            },
            metricFrequency: { total: true },
          },
          metricSet: {
            populationSize: String(COBARI_POP),
            reportingUnit: {
              cumulative: metrics({
                reach: COBARI_NET_REACH,
                impressions: COBARI_TOTAL_IMP,
                populationSize: COBARI_POP,
              }),
              // Anchor Orion. Cygnus is mostly inside Orion → tiny incremental.
              stackedIncrementalReach: [
                { dataProvider: "dataProviders/orion", reach: "20000000" },
                { dataProvider: "dataProviders/cygnus", reach: "2000000" },
              ],
            },
            components: [
              {
                key: "dataProviders/orion",
                value: {
                  cumulative: metrics({
                    reach: 20_000_000,
                    impressions: 48_000_000,
                    populationSize: COBARI_POP,
                  }),
                  cumulativeUnique: { reach: "4000000" },
                },
              },
              {
                key: "dataProviders/cygnus",
                value: {
                  cumulative: metrics({
                    reach: 18_000_000,
                    impressions: 90_000_000,
                    populationSize: COBARI_POP,
                  }),
                  cumulativeUnique: { reach: "2000000" },
                },
              },
            ],
            componentIntersections: [
              {
                components: ["dataProviders/orion", "dataProviders/cygnus"],
                metricSet: { reach: "16000000" },
              },
            ],
          },
        },
      ],
    },
  ],
} as BasicReport;

// ─────────────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────────────

export const FIXTURE_REPORTS: BasicReport[] = [VELIRO, PELLURA, COBARI];

const FIXTURE_INDEX = new Map<string, BasicReport>();
for (const r of FIXTURE_REPORTS) {
  const id = (r.name as string).split("/").pop() ?? "";
  FIXTURE_INDEX.set(id, r);
  FIXTURE_INDEX.set(r.name as string, r);
}

export function findFixtureReport(idOrName: string): BasicReport | undefined {
  return (
    FIXTURE_INDEX.get(idOrName) ??
    FIXTURE_INDEX.get(idOrName.replace(/^basicReports\//, ""))
  );
}

// Synthetic event groups + reporting sets — minimal so list_event_groups and
// list_reporting_sets return something coherent in fake mode.
export const FIXTURE_EVENT_GROUPS = [
  {
    name: "measurementConsumers/demo/eventGroups/eg_orion_veliro",
    cmmsDataProvider: "dataProviders/orion",
    mediaTypes: ["VIDEO"],
    dataAvailabilityInterval: {
      startTime: "2026-01-13T00:00:00Z",
      endTime: "2026-03-09T23:59:59Z",
    },
  },
  {
    name: "measurementConsumers/demo/eventGroups/eg_cygnus_veliro",
    cmmsDataProvider: "dataProviders/cygnus",
    mediaTypes: ["DISPLAY", "VIDEO"],
    dataAvailabilityInterval: {
      startTime: "2026-01-13T00:00:00Z",
      endTime: "2026-03-09T23:59:59Z",
    },
  },
  {
    name: "measurementConsumers/demo/eventGroups/eg_vega_pellura",
    cmmsDataProvider: "dataProviders/vega",
    mediaTypes: ["VIDEO"],
    dataAvailabilityInterval: {
      startTime: "2026-02-01T00:00:00Z",
      endTime: "2026-03-14T23:59:59Z",
    },
  },
];

export const FIXTURE_REPORTING_SETS = [
  {
    name: "measurementConsumers/demo/reportingSets/veliro_run1",
    displayName: "Veliro Athletic Run 1",
    campaignGroup: { /* truthy, marks this as usable as a campaign group */ },
  },
  {
    name: "measurementConsumers/demo/reportingSets/pellura_vc_q1",
    displayName: "Pellura V-C Serum Launch",
    campaignGroup: {},
  },
  {
    name: "measurementConsumers/demo/reportingSets/cobari_aware_q1",
    displayName: "Cobari Coffee Brand Awareness",
    campaignGroup: {},
  },
];
