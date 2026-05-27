---
name: halo-report-presentation
description: Use when generating a slide deck (.pptx), self-contained HTML report, or executive summary from a Halo `BasicReport` JSON response — i.e. when a user asks for a "presentation", "deck", "PowerPoint", "report dashboard", or "shareable summary" of a Halo cross-media measurement result, or wants to score the quality of an already-generated deck against the underlying API response.
---

# Halo Report Presentation

## Overview

Two generators + an auto-critic that turn a Halo [`BasicReport`](https://github.com/world-federation-of-advertisers/cross-media-measurement) JSON response (as returned by `GET /v2alpha/{mc}/basicReports/{id}`) into a polished output:

- `generate_presentation.py` → `.pptx` with **native PowerPoint charts** (no matplotlib). Editable, theme-aware, resolution-independent.
- `generate_html_report.py` → self-contained `.html` (one file) using ECharts + Tippy.js from CDN.
- `critic.py` → batch-scores generated `.pptx` files against the source JSON.

Use for ad-hoc decks, batch-generating presentations, or spot-checking that a deck surfaced what's in the source. Not for live API querying (use `halo-reporting-api`).

## Prerequisites

`python3 -m pip install python-pptx lxml` (HTML has no extra deps beyond stdlib).

## Usage

```bash
SKILL=plugins/halo-skills/skills/halo-report-presentation/scripts

# Fetch a report from the Halo API
curl -s "${BASE_URL}/v2alpha/${MC_ID}/basicReports/${REPORT_ID}" > report.json

# PowerPoint (.pptx)
python3 "$SKILL/generate_presentation.py" report.json [output.pptx]

# Self-contained HTML
python3 "$SKILL/generate_html_report.py"    report.json [output.html]

# Batch auto-critic — scores every .pptx in OUTPUT_DIR against the matching .json
python3 "$SKILL/critic.py" <json_dir> <output_dir>
```

If the output path is omitted, the file is written next to the JSON with a matching base name.

### Rebuild examples

The `examples/` folder ships JSON fixtures only (rendered `.pptx` / `.html` are gitignored). Two sets: `{1pub_tv,2pub_rich,5pub_overflow,failed}.json` from `generate_mock.py`, plus `01_*.json` … `24_*.json` — a goal/pitfall/state scenario suite converted from proto text-format via `textproto_to_json.py`.

```bash
EX=plugins/halo-skills/skills/halo-report-presentation/examples
python3 "$EX/generate_mock.py" all
for s in "$EX"/*.json; do
  python3 "$SKILL/generate_presentation.py" "$s"
  python3 "$SKILL/generate_html_report.py"  "$s"
done
```

## Output Shape

### PowerPoint — SUCCEEDED reports (3 to 8 slides; optional slides are skipped when their data is absent)

1. **Campaign Overview** — hero stat cards + per-publisher contribution cards + insights
2. **Cross-Media Reach** (≥2 publishers) — stacked incremental reach + Net / Incremental cards
3. **Reach vs. Unique Reach** (if unique-reach data) — grouped column chart
4. **Frequency Distribution** (if `kPlusReach`) — 1+, 2+, 3+, … thresholds + per-publisher sidebar
5. **Weekly Trends** (if weekly result groups) — cumulative + non-cumulative line chart
6. **Summary** — compact stat cards + publisher share table + takeaways

### PowerPoint — non-SUCCEEDED reports

Single status slide (red accent) explaining `RUNNING` / `FAILED` / `INVALID`.

### HTML report

Self-contained file with sidebar navigation (scroll-spy + IQ filter pills), executive summary card, 6 KPI cards, stacked incremental reach (ECharts), area-proportional Venn overlap, frequency distribution (1+…15+) with 3+ highlighted, weekly delivery section, publisher breakdown table, and custom ECharts graphs driven by an optional interpretation payload. Pitfall annotations render below the relevant chart based on each pitfall's `graph_annotations[].target_graph` field.

## Design

- **PPTX:** Calibri Light headings, Calibri body. Semantic colors: blue (#2C5CE1) reach, green (#0D8A5E) incremental, violet (#6D3BD1) frequency, slate (#475169) impressions. Per-publisher colors: blue, violet, teal, amber.
- **HTML:** Plus Jakarta Sans + IBM Plex Mono via Google Fonts. Navy sidebar with gradient background. Responsive (sidebar collapses on mobile).

## Data Safety

Generated outputs embed campaign names, brand names, and publisher names verbatim from the source JSON. **Don't share externally without confirming the source data is releasable.** Treat strings as untrusted input if they originated outside your organization (see `halo-reporting-api`).
