# Campaign Grouping (Meta + TV) — portfolio-level campaign bucketing

A skill that takes cross-media campaign exports (a Meta-side enriched CSV and a TV-side deduplicated CSV) and emits a single **Advertiser → Product Group → Campaign** hierarchy as CSV or JSON. It is portfolio-scoped by default (all advertisers in the export; optional `--advertiser` filter) and can read/write an optional per-advertiser config that makes grouping deterministic and improves over use.

## Summary

This skill groups Meta and TV campaigns into a 3-level hierarchy. It takes campaign-export CSVs directly and emits a single CSV/JSON artifact instead of a multi-tab spreadsheet workflow. It is portfolio-scoped (all advertisers by default, optional single-advertiser filter), takes an enriched Meta CSV plus a deduplicated TV CSV, and produces one 3-level hierarchy.

**3-level output hierarchy:**
- **L1: Advertiser** — the MC ID (Measurement Consumer id) is the source of truth; multiple advertiser names under one MC ID collapse to a single canonical row.
- **L2: Product Group** — sourced from the optional per-advertiser config (`groups[].display_name`) when available, else AI-clustered (TF-IDF over `Campaign Name + Ad Account Name + Creative Titles + Creative Bodies`, with creative fields weighted 2× over names).
- **L3: Campaign rows** (sorted by `end_date` ascending; `ongoing` last) — Measured Entity, Campaign ID, Campaign Name, Optimization Goal, Objective, Age Min, Age Max, Gender, Start Date, End Date.

## Intended use — engine for a UI-driven workflow

This skill is the **engine** for a human-in-the-loop campaign-grouping UI, not a one-shot CLI. A typical integration:

1. **The UI fetches inputs** — Meta campaign data and TV campaign data — and passes them as `--meta-csv` / `--tv-csv`.
2. **The UI invokes the skill** with `--config-dir` pointing at a per-advertiser config store (local directory or shared mount).
3. **The UI surfaces the output for review:**
   - **Groupings** — the canonical 3-level hierarchy (the answer artifact).
   - **Pending Review** — assignments awaiting user confirmation. During `initial_setup` this is *every* non-confirmed assignment; in `steady_state` it shrinks to AI-suggested rows, lower-confidence TV merges, and net-new similarity suggestions.
   - **Flags** — `cluster_drift`, `tv_reconciliation_low_confidence`, `unrecognized`, `metadata_anomalies`, `stale_activity`.
4. **The UI captures user actions** and translates them into config writes the skill respects on the next run:

   | User action in UI | Skill writes to config |
   |---|---|
   | Confirm a Pending Review suggestion | append to `confirmed_campaigns[]` |
   | Rename a group | update `advertiser.groups[].display_name` |
   | Add a keyword rule | append a `bucketing.rules[]` entry |
   | Confirm a low-confidence TV merge | append to `advertiser.aliases[]` |
   | Move a campaign between groups | update `target_group` in `confirmed_campaigns[]` |

5. **Subsequent runs** apply confirmed + rules + aliases deterministically; Pending Review collapses to *new* uncertainty. `lifecycle.phase` auto-advances `initial_setup → steady_state → adaptive_learning`.

**UI design tip:** expose `lifecycle.phase` to the user — review burden differs by orders of magnitude across phases (hundreds–thousands of rows on first run vs. tens per run in steady state).

Input fetching is **not** this skill's job (it expects already-enriched, correctly-shaped CSVs). Config storage is **not** prescribed (`--config-dir` works against a local directory or a shared mount).

## Prerequisite — inputs must already carry creative metadata (important)

The skill's grouping quality depends on each campaign already having **creative titles, creative bodies, optimization goal, objective, and demographics** — not just a campaign name. Campaign names are frequently opaque management codes, so the creative fields are what make brand/product clustering work. **This skill makes no API calls; it assumes the inputs are already enriched.**

> **TODO / integration requirement.** The Halo `list_event_groups` tool (see the [repo README](../../../../README.md), "halo-mcp" section) returns, by default, only:
> campaign name, MC ID, campaign ID (in the form of the **event-group reference id**), display name, brand/advertiser name, and start/end dates.
>
> It does **not** return creative bodies/titles, optimization goal, objective, or targeting/demographics. So an **additional enrichment step is required after calling `list_event_groups`** to pull that extra campaign metadata before this skill can group meaningfully. That enrichment is expected to come from the advertising platform's **insights/marketing API endpoint calls** (e.g. Meta's Insights and Marketing API). Wiring up that enrichment step is the responsibility of the calling workflow/UI and is intentionally **out of scope** for this skill — it is left here as a note/TODO for integrators.

## Files

- [`SKILL.md`](./SKILL.md) — the agent-facing skill: when to use, the enrichment prerequisite, the per-campaign match order, conventions, and common mistakes.
- [`references/algorithm.md`](./references/algorithm.md) — the full algorithm (load → group → reconcile TV → merge → sort → write-back), the AI text-grouping pipeline, embedding-based validation, similar-campaign suggestions, and the design tradeoffs (including why TF-IDF and explicitly **not** embeddings for initial grouping).
- [`references/halo-config-schema.md`](./references/halo-config-schema.md) — the full read/write per-advertiser config schema, lifecycle phases, TV-reconciliation tiers, and field reference.
- [`scripts/build_grouping.py`](./scripts/build_grouping.py) — the deterministic reference implementation (the engine the UI workflow invokes): stdlib-only, argparse CLI, emitting six CSVs (groupings + pending_review + four flag files). See [references/algorithm.md](./references/algorithm.md) for the CLI examples.
- [`scripts/test_build_grouping.py`](./scripts/test_build_grouping.py) — stdlib `unittest` coverage for the implementation. Run `python3 scripts/test_build_grouping.py`.

## Conventions

- **Demographic defaults:** empty `Age Min` / `Age Max` / `Gender` emit the literal string `"all adults"`. No invented numerics.
- **Date sentinel:** the TV `31-12-9999` end date emits as `"ongoing"` and sorts last in L3.
- **Name matching:** accent- and apostrophe-insensitive (NFKD normalize; curly/backtick/acute apostrophes fold to a straight quote) for advertiser/brand reconciliation.
- **Never fabricate data:** empty fields stay empty (except the documented `"all adults"` and `"ongoing"` sentinels). No invented campaign IDs, brand names, or demographics.

## Comparison vs. a single-advertiser multi-tab workflow

| Aspect | Single-advertiser sheet workflow | This skill |
|---|---|---|
| Scope | One advertiser at a time | Multi-advertiser by default; `--advertiser` to filter |
| Input | Multi-tab fetch output + TV sheet | Enriched Meta CSV + deduplicated TV CSV |
| Output | Multi-tab spreadsheet | Single CSV or JSON |
| Pre-filter | Reach-aligned only | Includes all campaigns; reach filtering is downstream |
| Config | None | Optional per-advertiser config (read/write, evolves with use) |
| Demo defaults | Per-tab handling | `"all adults"` literal for empty Age/Gender |
| TV ongoing dates | Blank | `"ongoing"` sentinel |
