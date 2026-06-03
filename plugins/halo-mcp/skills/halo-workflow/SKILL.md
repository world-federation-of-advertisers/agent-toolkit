---
name: halo-workflow
description: Use when the user wants to analyze cross-media measurement campaigns using the Halo MCP tools — listing reports, viewing summaries, comparing publishers, checking frequency, examining overlap, viewing trends, or exporting a deck.
---

# Halo Cross-Media Analysis Workflow

## Overview

Walk users through cross-media campaign analysis using the Halo MCP tools. Each tool renders an interactive visualization inline. Start broad (list → summary), go deep (publisher reach → incremental → overlap → frequency → trends), then export.

## Quick Reference

| Tool | When to call | What it shows |
|---|---|---|
| `list_basic_reports` | "What reports are available?" | Table of campaigns with dates, state |
| `show_report_summary` | "Open this report" / "How did it do?" | KPI cards, publisher list, narrative |
| `show_publisher_reach_chart` | "Which publishers drove reach?" | Total vs. unique reach per publisher |
| `show_stacked_incremental_reach` | "How much new audience did each add?" | Incremental contribution bar chart |
| `show_venn_overlap` | "How much overlap between X and Y?" | Proportional Venn diagram for top 2 |
| `show_frequency_distribution` | "What's the frequency distribution?" | k+ reach histogram (1+, 2+, 3+…) |
| `show_weekly_trends` | "How did reach build over time?" | Cumulative reach line + weekly impression bars |
| `show_publisher_table` | "Give me exact numbers" | Full per-publisher metrics table |
| `export_basic_report` | "Export this as a deck" | PowerPoint download with native charts |
| `list_event_groups` | "What campaigns/event groups exist?" | Table of campaigns by publisher |
| `list_reporting_sets` | "What reporting sets are available?" | Table of reporting sets |

## Recommended Flow

### 1. Orient — what's available

Call `list_basic_reports`. Present the table. Only `SUCCEEDED` reports have analyzable data. Help the user pick one.

### 2. Open — campaign overview

Call `show_report_summary` with the chosen report ID. Read the KPIs aloud: net reach, impressions, average frequency, publisher count. Frame the numbers against the universe size (e.g. "22% of the 50M target population").

### 3. Drill down — publisher analysis

Follow the user's questions. Typical progression:

- **"Which publishers drove reach?"** → `show_publisher_reach_chart` — total vs. unique reach. Flag publishers where unique ≪ total (heavy overlap).
- **"How much did each add?"** → `show_stacked_incremental_reach` — incremental contribution only. Highlight near-zero incrementals.
- **"How much overlap?"** → `show_venn_overlap` — proportional Venn for top 2 publishers.

### 4. Frequency + trends

- `show_frequency_distribution` — compare 1+ reach vs. 3+/4+ (effective frequency gap). Flag publishers with 10×+ higher frequency than peers.
- `show_weekly_trends` — cumulative reach + weekly impressions. Look for reach plateaus and front/back loading.

### 5. Export

`export_basic_report` generates a native PowerPoint deck with all key charts. Downloadable from the inline widget.

## Common Mistakes

- Calling visualization tools on a report that isn't `SUCCEEDED` — always check state first.
- Comparing publishers without accounting for universe size — a publisher reaching 1M in a 10M universe is proportionally larger than 5M in a 100M universe.
- Interpreting high impressions as high reach — impressions ÷ reach = frequency. High impressions with low reach means repetition, not scale.
