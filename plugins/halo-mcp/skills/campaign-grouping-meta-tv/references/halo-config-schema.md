# Advertiser Config Schema (Read/Write)

> **All values in this document are placeholder examples** (Acme Corporation / Widget Alpha / etc.). Do not treat them as real data — when seeding a new config, replace all values with the actual advertiser's identifiers, group names, and rules.

This describes the **full read/write schema** of the *design*: configs are read to drive grouping, and AI suggestions / anomaly flags / lifecycle state are written back at the end of each run.

> **Reference-implementation note.** `scripts/build_grouping.py` implements the **read** half only — it loads configs to drive grouping and emits suggestions/flags as **separate output artifacts** (`pending_review`, `flags_*`). It does **not** write back into the config files. The "Writes (config evolution)" section below is the intended design; a UI/integrator performs those writes. See [README — Reference-implementation scope](../README.md#reference-implementation-scope).

## File layout
One file per advertiser, named by MCID or internal slug (e.g. `mc_acme_001.json`). The reference script loads **`*.json` only** (stdlib, no YAML parser); the design also allows YAML.

## Lifecycle phases
The config evolves through three phases; the skill auto-advances `lifecycle.phase` based on activity:

| Phase | Trigger | Behavior |
|---|---|---|
| `initial_setup` | New config or first run | Skill prompts the user to seed `groups[]`, `bucketing.rules[]`, optional `confirmed_campaigns[]`. Pure-AI grouping if the user skips. **`pending_review[]` contains EVERY assignment not yet confirmed** — including rule-matched and Tier 1 TV merges. Forces a one-time validation pass. |
| `steady_state` | ≥ N confirmed campaigns AND ≥ M runs (defaults N=10, M=3) | Applies confirmed + rules + AI suggestions; **`pending_review[]` shrinks to AI-suggested rows + Tier 2 TV merges + net-new similarity suggestions**. Rule-matched and Tier 1 TV merges are trusted. |
| `adaptive_learning` | ≥ X stamps over a rolling window (default 5 stamps in last 10 runs) | Auto-promotes high-confidence suggestions and proactively flags drift in previously confirmed assignments. |

## Full example (placeholder values)

```yaml
advertiser:
  mc_id: "mc_acme_001"
  display_name: "Acme Corporation"
  internal_name: "acme"
  aliases:                     # additional TV/external names that should resolve to this MC_ID
    - "Acme Co"
    - "Acme Worldwide"
  groups:
    - display_name: "Widget Alpha"
      slug: "widget_alpha"
    - display_name: "Widget Beta"
      slug: "widget_beta"
    - display_name: "Widget Gamma"
      slug: "widget_gamma"

bucketing:
  rules:
    - target_group: "widget_alpha"
      keywords: ["widget alpha", "alpha pro", "alpha edition"]
      match_field: "campaign_name"   # or ad_account_name | creative_titles | creative_bodies
    - target_group: "widget_beta"
      keywords: ["widget beta", "beta plus"]
      match_field: "campaign_name"
    - target_group: "widget_gamma"
      keywords: ["gamma", "gamma max", "gamma ultra"]
      match_field: "creative_titles"
  catch_all: "acme_general"

confirmed_campaigns:
  - campaign_id: "100000000000001"
    target_group: "widget_alpha"
    confirmed_by: "example_user"
    confirmed_at: "2026-04-15T10:00:00Z"
  - campaign_id: "100000000000002"
    target_group: "widget_beta"
    confirmed_by: "example_user"
    confirmed_at: "2026-04-15T10:01:00Z"

pending_review:
  - campaign_id: "100000000000010"
    suggested_group: "widget_gamma"
    confidence: 0.82
    suggested_by: "ai_text_clustering"
    suggested_at: "2026-04-26T08:30:00Z"
    rationale: "Campaign Name contains 'gamma ultra'; matches widget_gamma rule keyword."
  - campaign_id: "100000000000011"
    suggested_group: "widget_alpha"
    confidence: 0.64
    suggested_by: "ai_text_clustering"
    suggested_at: "2026-04-26T08:30:00Z"
    rationale: "Creative Titles mention 'alpha edition' but Campaign Name is generic."

flags:
  unrecognized:
    - campaign_id: "100000000000020"
      reason: "No keyword match in any rule; AI clustering produced no high-confidence group."
      flagged_at: "2026-04-26T08:30:00Z"
  metadata_anomalies:
    - campaign_id: "100000000000021"
      reason: "Empty Campaign Name; cannot text-cluster."
      flagged_at: "2026-04-26T08:30:00Z"
    - campaign_id: "100000000000022"
      reason: "Age Min (45) > Age Max (35); contradictory targeting."
      flagged_at: "2026-04-26T08:30:00Z"
  stale_activity:
    - campaign_id: "100000000000030"
      reason: "End Date 2024-01-15 — older than 12 months."
      flagged_at: "2026-04-26T08:30:00Z"
  cluster_drift:
    - campaign_id: "100000000000040"
      assigned_group: "widget_alpha"
      suggested_group: "widget_beta"
      cosine_distance: 0.42
      group_mean_distance: 0.18
      flagged_at: "2026-04-26T08:30:00Z"
      reason: "Cosine distance to widget_alpha centroid (0.42) exceeds 2σ above group mean (0.18); creative content is closer to widget_beta."
  tv_reconciliation_low_confidence:
    - tv_advertiser_name: "ExampleCo Canada"
      tv_brand_full: "ExampleCo Canada - Snack Brand A - Sub Product X"
      proposed_mc_id: "mc_acme_007"
      proposed_meta_advertiser: "ExampleCo Inc"
      confidence: 0.50
      tv_row_count: 12
      reason: "Partial token overlap (Jaccard 0.50). Likely geographic split — needs human confirmation before merging."
      flagged_at: "2026-04-26T08:30:00Z"

pending_review_similar_to_existing:
  - campaign_id: "100000000000050"
    suggested_group: "widget_alpha"
    confidence: 0.91
    matched_campaigns: ["100000000000001", "100000000000003", "100000000000005"]
    suggested_by: "embedding_knn"
    suggested_at: "2026-04-26T08:30:00Z"
    rationale: "Net-new campaign; cosine similarity 0.91 to 3 confirmed widget_alpha campaigns."

lifecycle:
  phase: "steady_state"
  last_run_at: "2026-04-26T08:30:00Z"
  run_count: 7
  confirmed_count: 12
  recent_stamps: 3
```

## Field reference

### Reads (drive grouping)

| Path | Used for |
|---|---|
| `advertiser.mc_id` | L1 join key |
| `advertiser.display_name` | L1 label (overrides raw CSV `Advertiser Name`) |
| `advertiser.internal_name` | Slug for filename / cross-reference |
| `advertiser.aliases[]` | Additional TV/external names that resolve to this MC_ID. Upgrades Tier 3 TV reconciliations to Tier 1 after human confirmation. |
| `advertiser.groups[].display_name` | L2 labels (canonical group names) |
| `advertiser.groups[].slug` | Internal join key for `bucketing.rules[].target_group` |
| `bucketing.rules[].target_group` | L2 group slug |
| `bucketing.rules[].keywords` | Substring tokens (case + accent insensitive) |
| `bucketing.rules[].match_field` | Which Meta CSV column to test |
| `bucketing.catch_all` | L2 group slug for unmatched campaigns |
| `confirmed_campaigns[].campaign_id` | Override key |
| `confirmed_campaigns[].target_group` | Forced L2 group |

### Writes (config evolution)

| Path | Written when |
|---|---|
| `pending_review[]` (`campaign_id` + `suggested_group` + `confidence` + `rationale`) | Every run; contents depend on `lifecycle.phase`. `initial_setup` writes EVERY non-confirmed assignment (rule-matched + Tier 1 TV merges included). `steady_state`/`adaptive_learning` writes only AI-suggested rows + Tier 2 TV merges + net-new similarity suggestions. |
| `pending_review_similar_to_existing[]` | For net-new campaigns (added since `lifecycle.last_run_at`), when embedding KNN finds ≥ 2 matching confirmed campaigns at cosine ≥ 0.8. |
| `flags.unrecognized[]` | Campaigns the pipeline couldn't bucket via rules, with no high-confidence AI cluster. |
| `flags.metadata_anomalies[]` | Campaigns with malformed/missing/contradictory metadata. |
| `flags.stale_activity[]` | Campaigns whose `End Date` is far in the past or that haven't appeared in recent exports. |
| `flags.cluster_drift[]` | Campaigns whose distance from their group centroid exceeds 2σ above the group mean (reference uses **TF-IDF cosine**; design uses embeddings). Includes the suggested next-closest group. |
| `flags.tv_reconciliation_low_confidence[]` | TV advertiser names partially matching an MC_ID (Jaccard ∈ [0.4, 0.7)) but not strongly enough to auto-merge. |
| `lifecycle.phase` | Auto-advances `initial_setup → steady_state → adaptive_learning`. |
| `lifecycle.last_run_at` | ISO timestamp every run. |
| `lifecycle.run_count` | Incremented every run. |
| `lifecycle.confirmed_count` | Length of `confirmed_campaigns[]` after the run. |
| `lifecycle.recent_stamps` | Count of `pending_review` → `confirmed_campaigns` promotions in the last K runs. |

### User-managed (skill never auto-writes; user stamps these between runs)

| Path | How it changes |
|---|---|
| `confirmed_campaigns[]` | User reviews `pending_review[]`, stamps acceptable suggestions, and moves them here (manually or via UI). The skill respects the move on next run. |
| `bucketing.rules[]` | User edits to add/remove/refine keyword rules as patterns emerge. |
| `advertiser.groups[]` | User edits to add new product lines or rename existing ones. |

## Match order (per Meta campaign)
First match wins:
1. `campaign_id` ∈ `confirmed_campaigns[]` → use its `target_group`. Stop.
2. Else iterate `bucketing.rules[]` in order; first rule whose any keyword (case + accent insensitive substring) matches the configured `match_field` value wins. Stop.
3. Else AI text clustering on Campaign Name + Ad Account Name + Creative Titles + Creative Bodies. High-confidence cluster → record under `pending_review[]` with the suggested group (the run's output uses the suggestion so the user sees the proposed assignment).
4. Else `bucketing.catch_all` if set, otherwise `flags.unrecognized[]`.

For TV rows: rules are not applied (TV CSV lacks the matched fields). TV is grouped on its own using the hierarchical `Brand` column (see [algorithm.md](./algorithm.md) step 5). TV anomalies (empty `Brand`, no ` - ` split) go to `flags.metadata_anomalies[]`.

## TV → MC_ID reconciliation tiers
TV rows have no MC_ID. Each TV row's `parts[0]` (parent advertiser) is reconciled to the MC_ID registry in tiers (see [algorithm.md](./algorithm.md) step 5 for full detail):

| Tier | Match quality | Confidence | Action |
|---|---|---|---|
| 1 | Exact normalized match (corp suffixes stripped) | 1.0 | Auto-merge silently |
| 2 | High token overlap (Jaccard ≥ 0.7) | 0.7–0.99 | Auto-merge, log to `pending_review[]` for audit |
| 3 | Partial token overlap (Jaccard ∈ [0.4, 0.7)) | 0.4–0.69 | Do NOT merge; write to `flags.tv_reconciliation_low_confidence[]` for human review |
| 4 | No overlap | 0.0 | Keep as a separate TV-only L1 row |

To resolve a Tier 3 case in favor of merging, add the TV-side name under `advertiser.aliases[]`. On the next run it hits Tier 1.

## First-run seeding
When `--config-dir` is provided but no file exists for an advertiser:
1. Skill prompts: "No config found for `<advertiser>`. Seed one before grouping?"
2. If yes, it walks the user through (each step optional): display name + slug; initial `groups[]`; initial `bucketing.rules[]`; optional `bucketing.catch_all`; optional `confirmed_campaigns[]`.
3. Skill writes the seeded config with `lifecycle.phase: initial_setup`, then runs grouping.
4. After grouping, `pending_review[]` and `flags.*` are populated from this run so the user has something concrete to review next time.

If the user declines seeding, the skill runs pure-AI grouping for that advertiser and writes nothing back (treated as `--no-config-write` for that one advertiser).
