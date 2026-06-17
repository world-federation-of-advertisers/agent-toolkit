# Campaign Grouping (Meta + TV) — Algorithm

> All advertiser, brand, retailer, and campaign-code values in this document are **placeholders** (Acme Corporation / Widget Alpha / `BIGBOXMART` / synthetic codes). They illustrate the mechanics only — none are real.

## Inputs

### Required
1. **Enriched Meta CSV** (`--meta-csv`) with columns:
   `Advertiser Name, MCID, Ad Account ID, Ad Account Name, Campaign ID, Campaign Name, Creative ID, Creative Titles, Creative Bodies, Optimization Goal, Objective, Age Min, Age Max, Gender, Media Type, Start Date, End Date`
   - **Must already include the creative fields** (`Creative Titles`, `Creative Bodies`) and targeting. See the enrichment prerequisite in the [SKILL.md](../SKILL.md) / [README.md](../README.md).
2. **Deduplicated TV CSV** (`--tv-csv`) with columns:
   `Advert, Brand, Measured Entity, Media Type, Start Date, End Date`
   - `Brand` is hierarchical: `<Advertiser> - <Brand> - <Sub-product>` (e.g. `Acme Corporation - Widget Alpha - Widget Alpha Pro`).
   - `End Date = 31-12-9999` is the sentinel for **ongoing** campaigns.

### Optional
3. **Per-advertiser config directory** (`--config-dir`) — one file per MCID, read/write. See [halo-config-schema.md](./halo-config-schema.md).

### Output / filters
- `--out-dir <dir>` (required) — directory for the emitted artifacts (see below).
- `--output-format csv|json|both` (default `csv`).
- `--advertiser <name-or-mcid>` — restrict to one advertiser (default: all).
- `--no-config-write` — read config but skip writing back (config-side dry run).
- `--log-level DEBUG|INFO|WARNING|ERROR` (default `INFO`).

The reference `build_grouping.py` writes six artifacts to `--out-dir`:
`groupings`, `pending_review`, `flags_unrecognized`, `flags_anomalies`,
`flags_tv_lowconf`, `flags_cluster_drift`. With `--output-format csv` (default)
these are `.csv`; with `json` they are `.json` plus a nested
`groupings_nested.json` (advertiser → groups → campaigns); `both` emits all.

## Output: 3-level hierarchy

### CSV
Flat rows; L1+L2 fields repeat per row. Sorted by `advertiser_name`, then `group_name`, then `end_date` ascending.

| Column | Level | Source |
|---|---|---|
| `advertiser_name` | L1 | Meta `Advertiser Name`, or inferred from TV `Brand[0]` |
| `mc_id` | L1 | Meta `MCID`; empty for TV-only rows |
| `group_name` | L2 | Config `groups[].display_name` if matched, else AI-detected from text clustering |
| `measured_entity` | L3 | `Meta` for Meta rows; TV `Measured Entity` for TV rows |
| `campaign_id` | L3 | Meta `Campaign ID`; empty for TV |
| `campaign_name` | L3 | Meta `Campaign Name`; TV `Advert` |
| `optimization_goal` | L3 | Meta `Optimization Goal`; empty for TV |
| `objective` | L3 | Meta `Objective`; empty for TV |
| `age_min` / `age_max` / `gender` | L3 | Meta values, or `"all adults"` if empty/missing |
| `start_date` / `end_date` | L3 | ISO `YYYY-MM-DD`; `end_date` is `ongoing` for the `31-12-9999` sentinel |

L3 within each group is ordered by `end_date` ascending (`ongoing` last).

### JSON
The reference `build_grouping.py` emits the **CSV** form above; the nested shape
below documents the same hierarchy for consumers that prefer nested output.
Nested `advertiser → groups[] → campaigns[]`, all values illustrative placeholders:

```json
[
  {
    "advertiser_name": "Acme Corporation",
    "mc_id": "mc_acme_001",
    "groups": [
      {
        "group_name": "Widget Alpha",
        "campaigns": [
          {
            "measured_entity": "Meta",
            "campaign_id": "100000000000001",
            "campaign_name": "Widget Alpha - Reach - 25-54 - All",
            "optimization_goal": "REACH",
            "objective": "OUTCOME_AWARENESS",
            "age_min": 25, "age_max": 54, "gender": "All",
            "start_date": "2026-01-15", "end_date": "2026-02-28"
          },
          { "measured_entity": "ExamplePanel", "campaign_id": "", "campaign_name": "WIDGET ALPHA TV SPOT", "...": "..." }
        ]
      },
      { "group_name": "Widget Beta", "campaigns": [] }
    ]
  }
]
```

## Algorithm

1. **Load Meta CSV** → group rows by `(MCID, Advertiser Name)`. One MCID can map to multiple advertiser names (sub-brands of a parent), so do not assume 1:1.
2. **Load TV CSV** → for each row, split the `Brand` field on ` - `:
   - `parts[0]` → parent advertiser name
   - `parts[1]` → brand (usually the L2 group candidate)
   - `parts[2]` (if present) → sub-product
3. **Build an advertiser registry keyed by MC_ID.** For each MC_ID, register the **full set** of Meta `Advertiser Name` values associated with it (one MC_ID can carry several advertiser names — e.g. a parent company "Globex Corporation" whose Meta data spans "Globex Beverages", "Summit Selects", and "Hopworks" all under one MC_ID). Also index TV `parts[0]` values. Use accent-insensitive matching (NFKD normalize) to merge minor spelling/diacritic variants. During TV reconciliation (step 5), a TV parent name is compared against **every** registered Meta advertiser name for an MC_ID — a match against any name merges the TV row under that MC_ID.
4. **For each advertiser (Meta side):**
   a. **Confirmed-campaigns lookup** (if config provided): if `campaign_id` ∈ `confirmed_campaigns[]`, assign its `target_group` directly. Skip text grouping.
   b. **Bucketing rules** (if config provided): apply `bucketing.rules[]` in order. Each rule has `target_group` + `keywords` + `match_field` (`campaign_name` | `ad_account_name` | `creative_titles` | `creative_bodies`). First match wins.
   c. **Catch-all**: if config provides `bucketing.catch_all`, assign unmatched campaigns there.
   d. **AI text grouping** (no config or unmatched): two-tier token clustering over `Campaign Name + Ad Account Name + Creative Titles + Creative Bodies` (creative fields weighted 2× over names, since campaign names are often cryptic codes). All comparison is case- and accent-insensitive. Pipeline order:

      **i. Brand dictionary build** — construct a per-advertiser brand-name dictionary from two free signals: (a) TV `Brand` field `parts[1]`/`parts[2]` segments (already proper-cased brand/sub-product names like `Widget Alpha`, `Widget Beta`); (b) Meta `Ad Account Name` distinct tokens longer than 3 chars. This dictionary is the source of truth for known brands.

      **ii. Campaign code stripping (REQUIRED before concat-splitting)** — campaign names routinely embed structured management codes that survive tokenization and dominate TF-IDF scoring if not stripped. Synthetic examples of the shapes seen in real data:
        - Key-value delimited: `SOC~O-A1B2C3_CP00XYZ_MB~MLT_FS~N_MK~N_SCT~ALL`, `ID~B0000X00_YR~26_FS~CORPMEDIA_CN~AAAA_OB~AWA_RE~TIERALL`
        - Underscore-segmented: `soc_26_q1_brandcode_core_reg1_cc_lto_nat_di_xx`, `2_aut_00000_26_mq_xxx_soc_aucconv_brandauto_auto`
        - Alphanumeric IDs: `A1B2C3`, `CP00XYZ`, `cp_100000000000001`

        Strip before any other text processing:
        1. Remove key-value segments matching `<KEY>~<VALUE>` (tilde-delimited pairs).
        2. Remove underscore-segmented codes with 3+ segments where ≥ 2 segments are alphanumeric codes or numbers. Preserve underscore-separated natural language.
        3. Remove tokens matching campaign-ID patterns: `cp_\d+`, `D\d[A-Z0-9]+` (hex-style IDs ≥ 5 chars).
        4. Remove date-formatted segments embedded in campaign names (e.g. `3/2/26 - 10/11/26`).

        Without this step, structured codes produce unique-ish tokens with df ≥ 2 that pass the Tier-1 filter and become group labels. Empirical impact: a 2-campaign advertiser can explode to 80+ spurious groups; a large multi-brand advertiser can produce 100–150 noisy groups instead of the ~30 real product lines.

      **iii. Concatenated-term splitting (REQUIRED before tokenizing)** — campaign names and creative text routinely contain glued-together terms: `WIDGETALPHABIGBOXMARTSOCIAL`, `#WidgetAlphaPartner`, `WIDGETBETAPARTNER`, `ECOMMERCESOCIAL`. Run **greedy longest-match** against the brand dictionary on every input string before splitting on non-word delimiters. Without this step a single large multi-brand advertiser can produce 150+ noisy AI groups instead of ~30 real product lines.

      **iv. Stopword filter** — drop:
        - **Ad-tech jargon**: `reach`, `fb`, `ig`, `q1`, `awa`, `cpm`, `cpc`, …
        - **Common English copy**: `the`, `and`, `believe`, `internet`, …
        - **Platform/retailer noise** (post-splitting): generic platform and major-retailer tokens — e.g. placeholder forms like `partner`, `bigboxmart`, `megamart`, `grocerco`, `ecommerceco`, `valuestore`, `meta`, `instagram`, `facebook`, plus the actual retailer/platform names in your market. Add new ones as you encounter them — these appear at scale across creative copy/hashtags but never define a brand grouping.

      **v. Two-tier clustering**, picking one group per campaign:
        - **Tier 1 — Discriminative (preferred)**: tokens appearing in ≥ 2 campaigns and < 70% of the advertiser's portfolio. Score by `weight × len(token) × log(N/df) × brand_boost` (TF-IDF flavor with a **3× multiplier** for tokens in the brand dictionary from step i). The brand boost ensures a real brand token (e.g. `widgetalpha`) beats a random high-IDF creative word. Handles multi-brand advertisers — picks `Widget Alpha` / `Widget Beta` / `Widget Gamma` as distinct labels.
        - **Tier 2 — Brand-defining (fallback)**: triggered only when Tier 1 produces ≤ 2 distinct labels across the advertiser's whole portfolio (i.e. effectively single-brand-line). Promotes tokens with ≥ 80% coverage instead. Among those, the scorer **prefers proper-noun-shaped tokens** (capitalized in any source field) over generic English copy. Catches single-brand-line advertisers that TF-IDF would otherwise ignore (their brand token has IDF ≈ 0) — e.g. a parent "ParentCo Holdings" whose only brand is `BrandName`.

      **vi. Display normalization** — AI-derived labels are emitted with first-letter capitalization (`widgetalpha` → `Widget Alpha`) so they merge cleanly with TV-side labels (already proper-cased from `parts[1]`).

      Every Tier-1/Tier-2 assignment goes into `pending_review[]` for the user to stamp (subject to lifecycle phase — see the schema doc).
5. **TV → MC_ID reconciliation** (Meta is grouped first; TV joins to it). For each TV row, take `parts[0]` and tier-match it against **all advertiser names registered under each MC_ID**. Normalization includes NFKD accent folding, corp-suffix stripping (`Inc`/`SA`/`Corp`/`Intl`/etc.), and **apostrophe folding** — curly right `’` (U+2019), curly left `‘` (U+2018), backtick `` ` `` (U+0060), and acute `´` (U+00B4) all collapse to straight `'` (U+0027). (Required because TV often emits curly apostrophes while Meta uses straight — e.g. `ExampleCo’s` vs `ExampleCo's Corp` — and without folding they tokenize to different sets and never match.)
   - **Tier 1 — exact normalized match.** Confidence 1.0. Auto-merge into the matching MC_ID.
   - **Tier 2 — high token overlap** (Jaccard ≥ 0.7). Confidence ∈ [0.7, 1.0). Auto-merge, log to `pending_review[]` for audit.
   - **Tier 3 — partial overlap** (Jaccard ∈ [0.4, 0.7)). Too low to auto-merge. Write to `flags.tv_reconciliation_low_confidence[]` for human review (e.g. `ParentCo Canada` → proposed `ParentCo Inc` at conf 0.5 — likely a geographic split). Keep the TV row as a separate L1 entry until confirmed.
   - **Tier 4 — no overlap.** Keep as a separate TV-only L1 entry. TV-side advertisers are deduped by normalized name first (so `ExampleCo` / `ExampleCo Intl` / `ExampleCo International` consolidate).

   Group (L2) for TV rows comes from `parts[1]`. If empty/generic, fall back to text-clustering the `Advert` field. TV anomalies (empty `Brand`, no ` - ` split) go to `flags.metadata_anomalies[]`.
6. **Merge** Meta + TV under the same `(mc_id_or_canonical_name, group_name)` keys.
7. **Sort & emit:** L1 alphabetical by `advertiser_name`; L2 alphabetical by `group_name`; L3 by `end_date` ascending (`ongoing` last).
8. **Cluster validation** (optional — see below): for each L2 group with ≥ 3 campaigns, flag embedding outliers to `flags.cluster_drift[]`.
9. **Similar-campaign suggestions** (optional — see below): for net-new campaigns, suggest a group via KNN to `confirmed_campaigns[]`.
10. **Write-back** (unless `--no-config-write`): persist AI suggestions to `pending_review[]`, anomalies/drift/low-conf TV merges to `flags.*`, and update `lifecycle.last_run_at`.

## Demographic defaults
If `Age Min`, `Age Max`, or `Gender` is empty/missing in the Meta CSV, write the literal `"all adults"`. Do not invent numeric defaults. TV rows always emit `"all adults"` (TV CSV carries no demo).

## Date handling
- Meta CSV uses ISO (`YYYY-MM-DD`); TV CSV uses `DD MMM YYYY` (e.g. `30 Jun 2025`). Normalize both to ISO on output.
- `31-12-9999` → emit literal `ongoing` and sort to the bottom of L3.

## Data integrity
**Never fabricate data.** Empty fields stay empty (except the documented `"all adults"` and `"ongoing"` sentinels). No invented campaign IDs, brand names, or demographics.

Accent-insensitive normalization:
```python
import unicodedata
def normalize(s):
    nfkd = unicodedata.normalize('NFKD', s or '')
    return ''.join(c for c in nfkd if not unicodedata.combining(c)).lower().strip()
```

## Embedding-based cluster validation
Once L2 groups are assigned (rules + AI clustering), optionally verify intra-cluster cohesion using campaign-level text embeddings.

**Why:** TF-IDF token clustering is fast and yields human-readable labels but can't catch *semantic* drift — e.g. a campaign bucketed into "Brand A" because its name contains that literal token, even though the creative content is actually about "Brand B".

**How:**
1. For each L2 group with ≥ 3 campaigns, embed each campaign over `Campaign Name + Ad Account Name + Creative Titles + Creative Bodies`.
2. Compute the group centroid (mean embedding).
3. Measure each campaign's cosine distance to the centroid.
4. Flag campaigns > 2σ above the group's mean distance to `flags.cluster_drift[]` with the next-closest group as a suggestion.

**Cost:** ~10ms/campaign on CPU with a small sentence model; negligible under ~50K campaigns. Skips automatically when no embedding model is available.

**Not done here:** drifted campaigns are not auto-re-bucketed — drift goes to `flags.cluster_drift[]` for the user to triage (accept the suggestion, or stamp the original assignment into `confirmed_campaigns[]` to suppress future flags).

## Similar-campaign suggestions for net-new campaigns
When a net-new campaign appears (its `campaign_id` wasn't in the previous run's input), check whether it looks like an existing confirmed campaign.

**How:**
1. Identify net-new campaigns via the `lifecycle.last_run_at` watermark (all campaigns on first run).
2. For each, embed it and find top-K nearest neighbors among the advertiser's `confirmed_campaigns[]`.
3. If ≥ 2 of the top-3 neighbors share a `target_group` at cosine ≥ 0.8, write to `pending_review.similar_to_existing[]` with that group as a high-confidence suggestion.
4. The UI ranks these above regular text-cluster suggestions for low-friction bulk stamping.

**At scale:** use ANN libraries (FAISS, hnswlib) for sublinear lookup; pre-compute and persist embeddings, recompute only for net-new campaigns.

## Design tradeoffs (read before modifying)

### Why TF-IDF — and explicitly NOT embeddings — for initial grouping
It's tempting to "upgrade" the AI text grouping (step 4d) from TF-IDF to a neural sentence-embedding model. **Don't.** Empirically, embeddings cluster by product **category**, not **brand identity**. Concrete failure shapes:
- Two different brands' **body wash** both cluster as "moisturizing body wash" → merged despite being different advertisers' brands.
- Two different brands' **deodorant** both cluster as "odor protection" → wrong-brand merges.
- Two different brands' **toilet paper** both cluster as "soft toilet paper" → cross-advertiser leakage.

For initial grouping we want *brand identity* (which IS the L2 group), not category. TF-IDF on the raw token vocabulary preserves brand tokens as discriminators; embeddings dilute them. Embeddings are used **only** for the validation pass (`flags.cluster_drift`) and net-new similarity suggestions (`pending_review.similar_to_existing`), where category-level similarity is the *right* signal.

### Sub-brand fragmentation is expected
TF-IDF naturally splits `Widget Alpha` vs `Widget Alpha Pro` vs `Widget Alpha Max` into separate groups because the more-specific tokens have higher IDF than the parent. This is arguably correct — they're distinct product lines for reporting.

If a user wants coarser grouping (everything under one `Widget Alpha` umbrella), resolve via config:
- Add `Widget Alpha` as a `groups[].display_name`, and
- Add a `bucketing.rules[]` entry: `{"target_group": "widget_alpha", "match_field": "campaign_name", "keywords": ["widget alpha"]}`

The rule catches all three sub-brands and collapses them. Fragmentation is the default because it's recoverable, not because it's the right answer for every advertiser.

## CLI usage

```bash
# All advertisers (no config — pure AI grouping)
python3 scripts/build_grouping.py \
  --meta-csv /path/to/meta_campaigns_enriched.csv \
  --tv-csv /path/to/tv_campaigns_deduplicated.csv \
  --out-dir /tmp/grouping_out

# All advertisers, with read/write config dir
python3 scripts/build_grouping.py \
  --meta-csv meta.csv --tv-csv tv.csv \
  --config-dir /path/to/configs \
  --out-dir /tmp/grouping_out

# One advertiser by MCID, with config (config gets read AND updated)
python3 scripts/build_grouping.py \
  --meta-csv meta.csv --tv-csv tv.csv \
  --advertiser mc_acme_001 \
  --config-dir /path/to/configs \
  --out-dir /tmp/grouping_out

# One advertiser by name (accent-insensitive), dry-run config side
python3 scripts/build_grouping.py \
  --meta-csv meta.csv --tv-csv tv.csv \
  --advertiser "Acme Corp" \
  --config-dir /path/to/configs \
  --no-config-write \
  --out-dir /tmp/grouping_out
```

> The reference implementation `scripts/build_grouping.py` (stdlib-only — no external dependencies) implements these algorithm steps. Unit tests: `python3 scripts/test_build_grouping.py`. An agent may also execute the steps directly from this spec when the script isn't wired up.
