---
name: halo-workflow
description: Use when the user wants to explore Halo cross-media measurement reports using the MCP tools.
---

# Halo Cross-Media Analysis Workflow

The MCP tool descriptions already say what each tool does and when to call it.
This skill covers the fetching mechanics and presentation conventions they
can't.

## Tools

- **Discovery:** `list_basic_reports`, `list_event_groups`, `list_reporting_sets`
- **Single report:** `show_report_summary`, `show_publisher_reach_chart`,
  `show_stacked_incremental_reach`, `show_venn_overlap`,
  `show_frequency_distribution`, `show_weekly_trends`, `show_publisher_table`
- **Cross-campaign:** `show_cross_campaign_frequency`, `show_cross_campaign_reach`
- **Export:** `export_basic_report`

## Mechanics

- **List first, then drill.** Always call `list_basic_reports` before any
  visualization. Only `SUCCEEDED` reports have analyzable data — never open a
  viz tool on a report in another state.
- **Viz tools share a ~60s report cache** (keyed per report). Calling several on
  the same report in one turn is cheap — fetch once, no need to batch.
- **Cross-campaign tools fan out** over the most recent `SUCCEEDED` reports and
  fetch each individually. If the result note says more campaigns exist, tell
  the user the chart shows only the recent ones.
- **Report IDs:** pass either a bare id (`abc123`) or the full
  `basicReports/abc123` form — both work.

## Presentation

- **Frame every number against universe size.** Say "22% of the 50M target
  population", not just "11M reach" — a reach figure is meaningless without the
  population it is drawn from.
- **Reach ≠ impressions.** impressions ÷ reach = frequency; high impressions with
  low reach means repetition, not scale.
- Lead with the summary, then follow the user's questions into specific charts —
  let them steer which dimension (overlap, frequency, trend) to open.

For what the metrics *mean* and how to interpret them, defer to the
`report-interpretation` skill.
