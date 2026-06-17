---
name: campaign-grouping-meta-tv
description: Use when grouping a portfolio of cross-media (Meta + TV) campaigns into an Advertiser → Product Group → Campaign hierarchy from already-enriched campaign exports, typically as the engine behind a human-in-the-loop grouping UI.
---

# Campaign Grouping (Meta + TV)

## Overview
Groups cross-media campaigns into a 3-level hierarchy — **Advertiser (L1) → Product Group (L2) → Campaign rows (L3)** — from two CSV inputs: an enriched Meta-side export and a deduplicated TV-side export. Emits a single CSV or JSON artifact. An optional per-advertiser config (read/write) makes grouping deterministic and lets it improve with use.

This skill is the **engine for a UI-driven, human-in-the-loop workflow**, not a one-shot command. See [README.md](./README.md) for the full intent and [references/algorithm.md](./references/algorithm.md) for the algorithm.

## Prerequisite — inputs must already carry creative metadata
Grouping quality depends on per-campaign **creative titles, creative bodies, optimization goal, objective, and demographics**, not just campaign names (which are often cryptic codes). This skill assumes the inputs already contain that metadata and makes **no API calls itself**.

> **TODO / integration note.** The Halo `list_event_groups` tool (see the halo-mcp README) returns only campaign name, MC ID, campaign ID (as the event-group reference id), display name, brand/advertiser name, and start/end dates. It does **not** return creative bodies/titles, optimization goal, objective, or targeting. A separate **enrichment step is required after `list_event_groups`** to fetch that metadata — e.g. via the platform's insights/marketing API endpoints — before grouping. Wiring it up is the calling workflow's job, not this skill's.

## When to use
- You have a whole **portfolio** of advertisers to bucket at once (or one, via `--advertiser`).
- The inputs are already enriched with creative metadata (see prerequisite).
- You want a single CSV/JSON artifact plus a reviewable list of uncertain assignments.

When NOT to use:
- Inputs only have campaign names / IDs — run the enrichment step first.
- You need a multi-tab spreadsheet for a single advertiser — use the older per-advertiser grouping workflow instead.

## Quick reference

**Inputs:** `--meta-csv`, `--tv-csv`, `--out-dir` (required); optional `--config-dir`, `--advertiser`, `--no-config-write`.

**Output:** six CSVs to `--out-dir` — `groupings.csv` (the 3-level hierarchy: L1 advertiser keyed on MC ID, L2 product group, L3 campaign rows sorted by `end_date`, `ongoing` last) plus `pending_review.csv` and four `flags_*.csv`.

**Per-campaign match order (first match wins):**
1. `confirmed_campaigns[]` → use its `target_group`.
2. `bucketing.rules[]` keyword match on the configured field.
3. AI text clustering (TF-IDF, **not** embeddings) → write suggestion to `pending_review[]`.
4. `bucketing.catch_all`, else `flags.unrecognized[]`.

**Conventions:** empty Age/Gender → `"all adults"`; TV `31-12-9999` → `"ongoing"`; accent/apostrophe-insensitive matching; never fabricate data.

## Implementation
Run `scripts/build_grouping.py` — the deterministic reference implementation (stdlib-only; CLI in [references/algorithm.md](./references/algorithm.md)) — or follow the algorithm there directly. Config contract: [references/halo-config-schema.md](./references/halo-config-schema.md).

## Common mistakes
- **Skipping enrichment** — grouping on campaign names alone collapses to noise; confirm creative metadata is present first.
- **Using embeddings for initial grouping** — they cluster by product *category*, not brand, and cross-merge different brands. Use TF-IDF; embeddings are only for the validation/similarity passes.
- **Hiding `lifecycle.phase`** — first-run review is the whole portfolio; steady-state is a few rows. Surface the phase or the UI feels broken on day one.
