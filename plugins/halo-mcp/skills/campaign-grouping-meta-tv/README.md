# Campaign Grouping (Meta + TV) — portfolio-level campaign bucketing

A skill that takes cross-media campaign exports (a Meta-side enriched CSV and a TV-side deduplicated CSV) and emits an **Advertiser → Product Group → Campaign** hierarchy as CSV and/or JSON. It is portfolio-scoped by default (all advertisers in the export; optional `--advertiser` filter) and reads an optional per-advertiser config to make grouping deterministic. (The full read/write config that *evolves* across runs is part of the design — the bundled reference script reads configs but does not yet write them back; see [Reference-implementation scope](#reference-implementation-scope).)

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
   - **Flags** — `cluster_drift`, `tv_reconciliation_low_confidence`, `unrecognized`, `metadata_anomalies`, `stale_activity`. *(The reference script emits the first four; `stale_activity` is design-only — see [Reference-implementation scope](#reference-implementation-scope).)*
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

## Reference-implementation scope

`scripts/build_grouping.py` is a **deterministic, stdlib-only reference implementation**. It intentionally implements a subset of the full design above — enough to produce the groupings + review/flag artifacts with zero dependencies. The UI/integrator builds the write-back loop (turning user actions into config edits) around it.

| Capability | Reference script | Full design (spec) |
|---|---|---|
| Read per-advertiser config (rules / confirmed / catch_all / aliases / `lifecycle.phase`) | ✅ **JSON only** | YAML or JSON |
| Grouping: confirmed → rules → TF-IDF clustering | ✅ | ✅ |
| TV → MC_ID reconciliation (tiers 1–4) | ✅ | ✅ |
| Cluster-drift detection | ✅ **TF-IDF cosine** (stand-in) | neural embeddings |
| Emit groupings + `pending_review` + `flags_{unrecognized,anomalies,tv_lowconf,cluster_drift}` | ✅ (CSV and/or JSON) | ✅ |
| **Config write-back** (persist `pending_review` / `flags` / `lifecycle` into the config) | ❌ not implemented | ✅ |
| `flags_stale_activity` | ❌ not emitted | ✅ |
| Similar-campaign (embedding KNN) suggestions | ❌ not implemented | ✅ |

The ❌ rows are documented in the references as the **intended design**, not current script behavior. So the script *reads* configs and *writes output artifacts* only — it does not mutate the config files.

## Prerequisite — inputs must already carry creative metadata (important)

The skill's grouping quality depends on each campaign already having **creative titles, creative bodies, optimization goal, objective, and demographics** — not just a campaign name. Campaign names are frequently opaque management codes, so the creative fields are what make brand/product clustering work. **This skill makes no API calls; it assumes the inputs are already enriched.**

> **TODO / integration requirement.** The Halo `list_event_groups` tool (see the [repo README](../../../../README.md), "halo-mcp" section) returns, by default, only:
> campaign name, MC ID, campaign ID (in the form of the **event-group reference id**), display name, brand/advertiser name, and start/end dates.
>
> It does **not** return creative bodies/titles, optimization goal, objective, or targeting/demographics. So an **additional enrichment step is required after calling `list_event_groups`** to pull that extra campaign metadata before this skill can group meaningfully. That enrichment is expected to come from the advertising platform's **insights/marketing API endpoint calls** (e.g. Meta's Insights and Marketing API). Wiring up that enrichment step is the responsibility of the calling workflow/UI and is intentionally **out of scope** for this skill — it is left here as a note/TODO for integrators.

## Files

- [`SKILL.md`](./SKILL.md) — the agent-facing skill: when to use, the enrichment prerequisite, the per-campaign match order, conventions, and common mistakes.
- [`references/algorithm.md`](./references/algorithm.md) — the full algorithm (load → group → reconcile TV → merge → sort), the AI text-grouping pipeline, the validation/similar-campaign passes, and the design tradeoffs (including why TF-IDF and explicitly **not** embeddings for initial grouping). Marks which steps are spec vs. in the reference script.
- [`references/halo-config-schema.md`](./references/halo-config-schema.md) — the full per-advertiser config schema (the design's read/write contract), lifecycle phases, TV-reconciliation tiers, and field reference.
- [`scripts/build_grouping.py`](./scripts/build_grouping.py) — the deterministic reference implementation (the engine the UI workflow invokes): stdlib-only, argparse CLI, emitting six artifacts as CSV and/or JSON (groupings + pending_review + four flag files). See [references/algorithm.md](./references/algorithm.md) for the CLI examples and [Reference-implementation scope](#reference-implementation-scope) for what it does vs. the design.
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
| Output | Multi-tab spreadsheet | CSV and/or JSON artifacts |
| Pre-filter | Reach-aligned only | Includes all campaigns; reach filtering is downstream |
| Config | None | Optional per-advertiser config (reference reads it; read/write evolution is design) |
| Demo defaults | Per-tab handling | `"all adults"` literal for empty Age/Gender |
| TV ongoing dates | Blank | `"ongoing"` sentinel |
