# Report Interpretation Runbook

Operational reference for the [`report-interpretation`](../SKILL.md) skill. All field names are JSON (camelCase, as returned by `GET /v2alpha/{mc}/basicReports/{id}`).

## Contents

- [BasicReport JSON shape](#basicreport-json-shape) — the fields used by interpretation
- [Missing-Data Flags](#missing-data-flags) — expected-but-absent data per goal
- [Goals](#goals) — the 13-option menu + goal-to-metric mapping
- [Pitfalls](#pitfalls) — the 18 detection rules with severity thresholds
- [Output](#output) — JSON schema, annotation quality

---

## BasicReport JSON shape

Top-level fields:

| Field | Type | Notes |
|---|---|---|
| `name` | string | `measurementConsumers/{mc}/basicReports/{id}` |
| `title` | string | Human-readable title |
| `campaignGroup` / `campaignGroupDisplayName` | string | ReportingSet of EventGroups under measurement |
| `reportingInterval` | object | `{ reportStart, reportEnd }` — ISO date strings (e.g. `"2026-01-13"`) |
| `impressionQualificationFilters` | array | IQ filters — each is either `{ filter: "amiMrc" }` etc. (named) or `{ customFilters: [{ mediaType, filters }] }` |
| `effectiveImpressionQualificationFilters` | array | System-augmented IQ filters actually applied |
| `resultGroupSpecs` | array | What was requested |
| `resultGroups` | array | The actual results — see below |
| `state` | enum | `STATE_UNSPECIFIED \| RUNNING \| SUCCEEDED \| FAILED \| INVALID` |
| `modelLine` / `effectiveModelLine` | string | VID model used |
| `createTime` | RFC 3339 timestamp | Report creation time |

### `resultGroups[].results[]`

Each `Result` has `metadata` (`MetricMetadata`) and `metricSet` (`MetricSet`).

`metadata`:
- `reportingUnitSummary.reportingUnitComponentSummary[]` — one per component, each with `displayName`, `dataProvider`, `eventGroupSummaries[]`
- `nonCumulativeMetricStartTime`, `cumulativeMetricStartTime`, `metricEndTime`
- `metricFrequency` — `{ weekly: <DayOfWeek> }` OR `{ total: true }`
- `dimensionSpecSummary` — `{ groupings: [{ eventTemplateField }], filters: [...] }`
- `filter` — the IQ filter applied to this Result

`metricSet`:
- `populationSize` — int64 string, total population for this grouping/filter
- `reportingUnit` — union metrics: `nonCumulative` and `cumulative` (each a `BasicMetricSet`), plus `stackedIncrementalReach[]`
- `components[]` — per-DataProvider metrics: `nonCumulative`, `cumulative`, `nonCumulativeUnique`, `cumulativeUnique` (each a `BasicMetricSet`)
- `componentIntersections[]` — N-way overlap reach

### `BasicMetricSet`

| Field | Type | Meaning |
|---|---|---|
| `reach` | int64 string | Deduplicated unique individuals reached |
| `percentReach` | float | `reach / populationSize` |
| `kPlusReach[]` | array<int64 string> | Reach at 1+, 2+, 3+, … (index = frequency − 1) |
| `percentKPlusReach[]` | array<float> | `kPlusReach / populationSize` |
| `averageFrequency` | float | Mean exposures per reached person |
| `impressions` | int64 string | Total impression count |
| `grps` | float | Gross rating points |

> int64 fields are JSON strings — always coerce to number before arithmetic.

### MediaType values

`VIDEO` · `DISPLAY` · `OTHER` (often includes social formats).

---

## Missing-Data Flags

After parsing, flag data that is **expected for the selected goal but absent**. Not pitfalls (bad data) — flags for limits on the analysis. Surface under a **Missing Data** section between Pitfalls and Recommendations.

| Missing | Flag When | Recommendation |
|---|---|---|
| No demographic groupings | Goal = 3 (Targeted Reach) and no `dimensionSpecSummary.groupings` contain `common.sex` / `common.age_group` | "Request demographic breakdowns to evaluate targeting effectiveness" |
| No `stackedIncrementalReach` | Goal = 2 (Incremental Reach) and `reportingUnit.stackedIncrementalReach` missing or empty | "Request stacked incremental reach to measure each publisher's unique contribution" |
| No `componentIntersections` | Multi-publisher and no `componentIntersections[]` | "Request pairwise intersection data for Venn / overlap analysis" |
| No `kPlusReach` | Goal ∈ {5 Effective Frequency, 8 Frequency Caps} and `reportingUnit.*.kPlusReach` absent | "Request frequency distribution (k+ reach) to evaluate effective-frequency delivery" |
| No weekly data | Goal ∈ {12 Launch, 13 Sustaining} and `metricFrequency.total` is true | "Request weekly breakdowns to assess pacing and temporal trends" |
| No weekly `kPlusReach` | Goal = 13 (Sustaining Frequency) and weekly data exists but lacks `kPlusReach` | "Request weekly frequency distribution to evaluate frequency consistency over time" |
| No `cumulativeUnique` reach | Multi-publisher and no `components[].cumulativeUnique.reach` | "Request unique reach per publisher for reach-vs-unique comparison" |
| Single IQ filter | Report has only AMI or only MRC, not both | "Request both AMI and MRC for viewability comparison across publishers" |

---

## Goals

### Menu — present to the user verbatim

```
What is the primary analysis goal for this report? Select a number:

REACH FOCUSED
  1. Maximum reach — Maximize unique people exposed
  2. Incremental reach — Find new audiences beyond core/anchor platforms
  3. Targeted reach — Reach specific demographic segments effectively
  4. Geographic reach — Cover specific markets or regions
     [NOTE: not currently measurable in Halo BasicReport]

FREQUENCY FOCUSED
  5. Effective frequency — Achieve optimal exposure count (typically 3–7x)
  6. Brand recall / awareness frequency — Enough repetition for recall
     [NOTE: frequency available, recall itself needs a brand-lift study]
  7. Persuasion frequency — Move audiences through consideration to purchase
     [NOTE: frequency available, persuasion needs a brand-lift study]
  8. Frequency caps — Evaluate whether caps are limiting fatigue effectively
     [NOTE: cap settings not in report — distribution indicates effectiveness]

BALANCED
  9. Optimal reach/frequency balance — Right trade-off given budget
 10. Cost-efficient reach — Maximize reach per dollar spent
     [NOTE: no cost data in report — client must overlay spend]
 11. Recency — Maintain consistent recent exposure, avoid clustering
     [NOTE: partially measurable via weekly breakdowns]

CAMPAIGN SPECIFIC
 12. Launch reach — Build awareness quickly for new products
 13. Sustaining frequency — Maintain ongoing presence for established brands
```

After selection:
1. Acknowledge it and surface any measurability caveat.
2. If goal 4 → explain it's not currently measurable, suggest the user request it from the Halo / consortium team, and offer to switch goals.
3. If goal 6, 7, or 10 → note the limitation and proceed with available data.
4. Store the goal number for Step 3.

### Goal → metric mapping

| Goal | Primary Metrics | Secondary Metrics | What "Good" Looks Like |
|---|---|---|---|
| 1. Maximum reach | `reach`, `percentReach` | `impressions`, `grps`, component reach | High total reach (>50% of universe); reach growing across weeks if weekly |
| 2. Incremental reach | `stackedIncrementalReach`, component `cumulativeUnique.reach` | `componentIntersections`, component `reach` | Each publisher contributes meaningful incremental (>5% of total); low pairwise overlap |
| 3. Targeted reach | Per-group `reach`/`percentReach` from `dimensionSpecSummary.groupings` | Component reach per demographic | Target demo over-indexes vs. overall; high in-target reach % |
| 5. Effective frequency | `kPlusReach[2]` (3+ reach), `averageFrequency` | Full `kPlusReach` distribution, per-component frequency | 3+ reach ≥50% of 1+ reach; avg frequency 3–7; no heavy tail |
| 6. Brand recall freq | `averageFrequency`, `kPlusReach` | Weekly frequency consistency | Avg ≥3; consistent week-over-week |
| 7. Persuasion freq | `averageFrequency`, `kPlusReach[2..5]` | Weekly frequency trends | Higher frequency (5–7+); sustained |
| 8. Frequency caps | `kPlusReach` distribution, per-component `averageFrequency` | Highest-frequency bucket with significant reach | No heavy tail (10+ minimal); even distribution |
| 9. R&F balance | `reach` + `averageFrequency` together | `kPlusReach`, per-component balance | Moderate reach (>40%) at moderate frequency (3–5); balanced publishers |
| 10. Cost-efficient reach | `reach`, `percentReach`, `impressions` | Per-component reach contribution | High reach relative to impressions. Flag: no cost data — must overlay |
| 11. Recency | Weekly non-cumulative `reach` and `averageFrequency` | Cumulative reach slope | Consistent weekly delivery; no large gaps/clustering |
| 12. Launch reach | Cumulative weekly `reach` curve | Week-1 non-cumulative reach, early component contribution | Steep build: ≥50% of total reach in first 25% of campaign |
| 13. Sustaining freq | Weekly non-cumulative `averageFrequency` | Weekly `impressions`, cumulative frequency trend | Consistent frequency (±20% WoW); no decay |

### Analysis structure (Step 3 of the workflow)

Produce for the selected goal:

1. **Metric extraction** — table of primary + secondary metrics actually present.
2. **Assessment** — 2–3 paragraphs vs. "What Good Looks Like": how does the report perform? which publishers contribute most/least? any concerning patterns?
3. **Per-publisher breakdown** (multi-publisher reports) — share of total reach, frequency relative to others, unique-reach contribution if available.
4. **Temporal analysis** (only if `metricFrequency.weekly`) — week-over-week evolution; alignment with goal; per-week anomalies.
5. **Cross-IQ-filter comparison** (multiple IQ filters) — AMI vs. MRC vs. custom. AMI is always ≥ MRC; flag if the gap is unusually large.

---

## Pitfalls

Run **every** rule below. For each, record `severity ∈ {HIGH, MEDIUM, LOW, INFO}` and a `finding` that names the publisher / metric / threshold breached. Always attach a `graph_annotations` entry for HIGH and MEDIUM pitfalls (the renderer turns these into callouts below the relevant chart).

> Cross-cutting note: int64 fields (`reach`, `kPlusReach[]`, `impressions`, `populationSize`) are JSON strings — cast to number first.

### 1. Too-High Frequency on a Platform

**Detect** — per-component `averageFrequency` (`metricSet.components[].cumulative.averageFrequency`):
- `HIGH` if any > 10
- `MEDIUM` if any > 8
- `MEDIUM` if one component's frequency > 2× another's
- Also: if `kPlusReach` exists, flag if `kPlusReach[4]` (5+) > 20% of `kPlusReach[0]` (1+)

**Setup guidance** — ask for weekly frequency histograms to see distribution over time.

**Objective guidance** — frequency cap may be too high, or audience targeting too narrow for the budget (saturation).

**Platform guidance** — lower-CPM platforms accumulate frequency faster at the same spend. Short-form formats need higher frequency than long-form for equivalent attention.

### 2. Too-Low Incremental Reach

**Detect** — `reportingUnit.stackedIncrementalReach[]` (skip if absent):
- `HIGH` if any entry except the first (anchor) is < 2% of the anchor's reach
- `MEDIUM` if < 5% of the anchor
- The order in `components[]` determines the stack — the anchor (index 0) gets the most credit by construction.

**Setup guidance** — try a report with a different anchor. Check if all flights started together; earlier-starting campaigns earn more incremental.

**Objective guidance** — focus on frequency or narrow targeting suppresses incremental. Check buying constraints.

**Platform guidance** — anchor doesn't have to be TV; digital can anchor with the right tactics and creative.

### 3. Impression Counts Differ from External Systems

**Detect** — cannot detect from the report alone.

- `INFO` — always flag as a check item.

**Guidance** — counts should match externals nearly exactly. Mismatch suggests the advertiser is measuring additional campaigns or impressions outside the report's scope.

### 4. Reach Differs from External Systems

**Detect** — cannot detect from the report alone.

- `INFO` — always flag as a check item.

**Guidance** — first verify impressions match (Pitfall 3). If they do, reach gap is because Halo models people-level reach via a VID model, while ad platforms measure account- or device-level reach.

### 5. Demographic Reach Doesn't Match Target

**Detect** — `dimensionSpecSummary.groupings` containing `common.sex` / `common.age_group` (or equivalent demo fields):
- If groupings exist: compare per-group `reach` / `percentReach`
- `HIGH` if the target demo's reach share is <50% of a uniform-distribution baseline
- `MEDIUM` if the target demo is not the highest-reach group
- If no demographic groupings: `INFO` — request demographic breakdowns

**Setup guidance** — compare reached audience composition vs. plan; highlight skew.

**Objective guidance** — broad targeting expects some skew. Validate against the targeting setup.

**Platform guidance** — digital targeting tends to show tighter in-target reach % than broad traditional buys.

### 6. Comparing Different Measurement Windows

**Detect** — across each `metadata`: `nonCumulativeMetricStartTime`, `metricEndTime`, and across components within the same result:
- `HIGH` if start/end differ by >7 days
- `MEDIUM` if 1–7 days

**Setup guidance** — align reporting periods across vendors before comparing.

**Objective guidance** — staggered flight starts skew comparative reach.

**Platform guidance** — traditional measurement often uses rolling averages — ensure cadence matches.

### 7. No Cost Data for Efficiency Analysis

**Detect** — `BasicReport` never carries cost data.

- `MEDIUM` — always flag.

**Setup guidance** — request spend by channel from client/agency; compute CPM, cost per reach point, incremental cost per reach.

**Objective guidance** — align on raw reach vs. cost-efficient reach before presenting.

**Platform guidance** — contextualize cost-efficiency with platform CPM differences.

### 8. Misinterpreting Frequency Distribution

**Detect** — `kPlusReach[]` if present:
- `MEDIUM` if `kPlusReach[4]` (5+) > 15% of `kPlusReach[0]` (1+)
- `MEDIUM` if `kPlusReach[9]` (10+) > 5% of `kPlusReach[0]`
- Also flag if only `averageFrequency` is reported without `kPlusReach` — a high average can hide a wide distribution.

**Setup guidance** — present 1+/2+/3+ thresholds, not just `averageFrequency`.

**Objective guidance** — clarify the effective threshold (e.g., 3+ for awareness) and report reach at that level.

**Platform guidance** — traditional builds frequency slowly; digital can hit effective frequency faster, but cap settings must be tuned.

### 9. Budget Pacing Misalignment

**Detect** — only if `metricFrequency.weekly`. Use per-week non-cumulative `impressions` / `reach`:
- `MEDIUM` if `max(weekly impressions) > 3 × min(weekly impressions)`, excluding partial first/last weeks
- `MEDIUM` if per-component weekly impressions show opposite trends (one front-loaded, another back-loaded)

**Setup guidance** — weekly breakdowns reveal front-loading / back-loading.

**Objective guidance** — front-load for launch reach; even pace for sustaining frequency.

**Platform guidance** — flighting is common in traditional; digital usually pulses continuously.

### 10. Not Considering Ad Format / Placement Differences

**Detect** — `impressionQualificationFilters` and `effectiveImpressionQualificationFilters`:
- `LOW` if only AMI is used with no MRC — viewability differences are hidden
- `INFO` if MediaType is only `OTHER` — may exclude video-specific metrics
- `INFO` if multiple MediaTypes are present — note format differences affect frequency requirements

**Setup guidance** — request placement-level data if available.

**Objective guidance** — match format strategy to objective (high-impact for awareness, mixed for reach).

**Platform guidance** — 30s linear ≠ 6s short-form; contextualize frequency by attention.

### 11. Publisher Reach-to-Impression Inefficiency

**Detect** — per component, share of total impressions vs. share of total reach:
- `HIGH` if any component has >40% of total impressions but <10% of total reach
- `MEDIUM` if >30% of impressions but <15% of reach

**Setup guidance** — compute impressions-per-unique-person. >50 on any publisher = severe saturation.

**Objective guidance** — investigate too-narrow targeting; consider broadening audience or reducing spend.

**Platform guidance** — unlimited-inventory digital can shovel impressions into small audiences. A 10× impressions-to-reach ratio gap suggests a fundamentally different delivery model (retargeting vs. prospecting).

### 12. Excessive Audience Overlap

**Detect** — `componentIntersections[]` if present:
- `HIGH` if any pairwise intersection reach > 70% of the smaller publisher's reach
- `MEDIUM` if > 50%
- Also: if total net reach < 60% of gross reach (sum of publisher reaches) — high overall duplication

**Setup guidance** — heavy overlap means low incremental from the overlapping publisher; consider reallocating budget.

**Objective guidance** — some overlap reinforces frequency; flag when it suggests publishers serve the same audience with no incremental value.

**Platform guidance** — TV/digital often overlap in some demos. Use intersection data to argue for differentiation strategies.

### 13. Cumulative Reach Plateau (Diminishing Returns)

**Detect** — only if `metricFrequency.weekly` with cumulative reach:
- `MEDIUM` if week-over-week cumulative reach gain < 2% of total reach for 2+ consecutive weeks
- `INFO` if final-week gain < 5% of total reach (expected, but worth noting)

**Setup guidance** — a plateau means the addressable audience is exhausted; additional spend buys frequency, not new reach.

**Objective guidance** — for launch reach, a plateau = stop or diversify. For sustaining frequency, expected.

**Platform guidance** — different publishers plateau at different points; early plateau may signal narrower targeting.

### 14. Publisher Delivery Dropout

**Detect** — only if `metricFrequency.weekly`. Per-component weekly impressions:
- `HIGH` if any component's weekly impressions drop >90% week-over-week (effectively stopped delivering)
- `MEDIUM` if drop >70%
- Exclude partial first/last weeks.

**Setup guidance** — dropout may be pause, budget exhaustion, creative-approval issue, or technical problem. Investigate with publisher.

**Objective guidance** — if the dropout publisher was a major reach contributor, the campaign's overall reach may be compromised.

**Platform guidance** — TV may flight intentionally; a digital dropout is usually an anomaly.

### 15. Very Low Overall Reach

**Detect** — total `percentReach`:
- `MEDIUM` if `percentReach < 15%` AND total `impressions > 100M`
- `INFO` if `percentReach < 15%` regardless of impressions

**Setup guidance** — low reach + high impressions = narrow audience. Check if targeting is too restrictive for spend level.

**Objective guidance** — retargeting / niche campaigns may intentionally have low reach. Broad awareness needs broader targeting.

**Platform guidance** — find the publisher driving the narrow reach; one publisher's targeting may need adjustment while others are fine.

### 16. Cross-IQ-Filter Divergence

**Detect** — results under both AMI and MRC for the same publisher:
- `MEDIUM` if AMI reach > 2× MRC reach (significant viewability gap)
- `INFO` if AMI/MRC ratio > 1.5×

**Setup guidance** — large gap = many impressions don't meet MRC viewability. Identify the offending publishers.

**Objective guidance** — for awareness, viewability matters. Consider requiring MRC-qualified for future campaigns.

**Platform guidance** — in-stream video typically has higher viewability than outstream or display.

### 17. Frequency-Reach Tradeoff Alert

**Detect** — total `averageFrequency` against total `percentReach`:
- `INFO` if `averageFrequency > 7` AND `percentReach < 25%` — campaign is hitting a small audience 7+ times while >75% of the universe is untouched

**Setup guidance** — not necessarily wrong (retargeting concentrates frequency intentionally), but flag the tradeoff explicitly.

**Objective guidance** — for awareness/reach, redistribute. For conversion/consideration, may be intentional.

**Platform guidance** — check whether one publisher is driving the narrow reach; another publisher could extend it.

### 18. Publisher Contribution Negligibility

**Detect** — per component, share of total campaign reach:
- `MEDIUM` if any publisher's `reach` < 1% of total campaign `reach`

(Distinct from Pitfall 2: this checks **absolute** contribution; Pitfall 2 checks **incremental** contribution vs. anchor.)

**Setup guidance** — <1% contribution = functionally absent. Investigate whether the campaign was properly configured on that platform.

**Objective guidance** — consider reallocating that publisher's budget to publishers that are delivering reach.

**Platform guidance** — small publishers may have been included for testing. If contribution is negligible, the test has answered.

---

## Output

The interpretation emits a single JSON object — the single source of truth for executive-summary text, downstream rendering (HTML/PPTX), and any audit pipeline.

### Schema

```jsonc
{
  "executive_summary": "...",   // 2-3 sentences, ANALYTICAL — campaign overview with specific numbers, goal-alignment verdict, most critical issue (if any). Not a template.
  "goal_category": "Maximum Reach",
  "goal_number": 1,
  "scenario": "strong|adequate|concerning|poor",   // overall quality verdict; per-issue detail lives in pitfalls[]
  "key_metrics_summary": "Reach: 33.7M (61.3%) | Freq: 4.27 | GRPs: 261.74",

  "pitfalls": [
    {
      "number": 1,
      "name": "Too-High Frequency",
      "severity": "HIGH",
      "finding": "Digital Platform Beta avg frequency 18.3x — 4.4x TV Alpha's 4.2x. Well above 10x HIGH threshold.",
      "graph_annotations": [
        {
          "target_graph": "frequency_distribution",
          "annotation": "Beta drives 70% of impressions to a narrow audience at 18.3x frequency — bars beyond 10+ show the waste zone."
        }
      ]
    }
  ],

  "graph_annotations": {
    "stacked_incremental_reach": "Each publisher's incremental contribution ...",
    "frequency_distribution": null,
    "weekly_impressions": "Delivery collapsed after Week 2 ...",
    "weekly_reach": null,
    "weekly_frequency": "Beta's frequency spiked to 12.3x in Week 2 ...",
    "venn_overlap": null,
    "publisher_table": null,
    "demographics": null,
    "kpi_reach": null
  },

  "recommendations": [
    "Cap Beta frequency at 5-7 per user to prevent audience saturation.",
    "Redistribute pacing for even weekly delivery — current 9:1 ratio wastes early budget.",
    "Request weekly frequency histograms by publisher for ongoing monitoring."
  ]
}
```

### `graph_annotations` quality rules

**Every standard graph section MUST get an entry** when the interpretation has something analytical to say about that chart. "If a stakeholder is looking at this chart, what should they notice?"

For **healthy** metrics, confirm the positive signal:
- "Healthy frequency distribution: 60% of 1+ audience reaches 3+, with minimal tail beyond 10+. Textbook frequency management."
- "All three publishers contribute meaningful incremental reach (36%, 22% of anchor), confirming effective cross-media extension."

For **problem** metrics, name what's wrong and why it matters:
- "CRITICAL: Clear inflection at Week 3. Impressions 52M → 50M → 31M → 30.5M. Beta ceased delivery."
- "Beta drives 70% of impressions to a narrow audience at 18.3x — bars beyond 10+ show the waste zone."

Bad annotations:
- "The chart shows frequency distribution." (describes WHAT, not WHAT TO NOTICE)
- "See above for details." (no content)
- `null` when there IS something analytical to say.

**`null` is only acceptable** for chart sections that don't exist in the report (e.g., `weekly_impressions: null` for a total-only report).

**Every HIGH / MEDIUM pitfall MUST also carry at least one `graph_annotations` entry on the pitfall itself**, pointing to the chart where the problem is most visible. This drives the warning callout below that chart.

The interpretation **annotates only** — it does not create new charts. The Halo MCP server renders the full standard chart set (stacked incremental, frequency distribution, weekly delivery, Venn overlap, publisher table, demographics) via its `show_*` tools and `export_basic_report`.

### Per-goal supplementary guidance

- **Goal 4 (Geographic)** — not supported. Suggest the user surface the gap to the Halo / consortium team. Offer to switch goals.
- **Goal 6 (Brand recall)** — frequency data only. Use it to assess whether exposure was sufficient (typically 3+); actual recall requires a brand-lift study.
- **Goal 7 (Persuasion)** — frequency only. Higher thresholds apply (5–7+). Persuasion itself requires separate measurement.
- **Goal 10 (Cost-efficient)** — no cost data in the report. Once spend is overlaid: `CPM = (spend / impressions) × 1000`, `cost per reach point = spend / (reach / universe × 100)`, `incremental cost per reach = spend on channel / incremental reach from channel`.

### Weekly vs. total reports

- **`metricFrequency.weekly`** — produce week-by-week tables, cumulative build curves, pacing consistency. Note partial weeks at start/end.
- **`metricFrequency.total`** — focus on aggregates. Cannot assess pacing or temporal trends. `nonCumulative` and `cumulative` are identical when frequency is `total` — presenting both is redundant. `kPlusReach` and `averageFrequency` are not supported for cumulative weekly; they're available only for total or non-cumulative weekly.

### Multiple `resultGroups`

- Analyze each separately, then synthesize.
- Note how groups differ (different `dimensionSpecSummary.groupings`, different filters, different metrics).
- Cross-reference findings across groups.
- If groups represent demographic slices, synthesize the demographic analysis across all slices.

### Multiple IQ filters

- Present AMI vs. MRC side-by-side.
- AMI reach is always ≥ MRC reach.
- The gap indicates viewability performance. AMI > 2× MRC for any publisher = significant viewability issue.

Downstream rendering (HTML dashboards, PowerPoint export) is handled by the `halo-mcp` server, not by this skill.
