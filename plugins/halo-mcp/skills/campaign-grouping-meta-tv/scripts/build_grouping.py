#!/usr/bin/env python3

"""campaign-grouping-meta-tv reference implementation.

Implements the algorithm described in the sibling SKILL.md: portfolio-scoped
campaign grouping over enriched Meta + TV CSV exports, with optional read/write
per-advertiser configs. Emits six artifacts to --out-dir — CSV by default, or
JSON / both via --output-format (JSON adds a nested groupings_nested.json):

  groupings.csv          - the canonical 3-level hierarchy
  pending_review.csv     - assignments awaiting user confirmation
  flags_unrecognized.csv - campaigns the pipeline could not bucket
  flags_anomalies.csv    - malformed/contradictory metadata
  flags_tv_lowconf.csv   - TV advertisers needing manual MC_ID confirmation
  flags_cluster_drift.csv - TF-IDF cosine outliers within their assigned group

See SKILL.md for the full algorithm. CLI flags mirror the spec.
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import math
import os
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime
from typing import Iterable

logger: logging.Logger = logging.getLogger(__name__)


# === Stopword + suffix tables ==============================================

_GENERIC_TOKENS: frozenset[str] = frozenset(
    """
ad ads adset adsets campaign campaigns reach reachfreq freq
awa awareness brand sales conv conversion conversions traffic engagement
mr fy fy24 fy25 fy26 fy27 q1 q2 q3 q4 yr cn ob re ff fs id obj
fb ig facebook instagram meta google video photo image carousel collection
all male female allgenders adults adult evergreen test prospecting retargeting rta
us usa na noram unitedstates uk eu en english spanish 18 24 25 34 35 44 45 54 55 65
mktg marketing corp media corporate primary general core main always lookalike
new mar apr may jun jul aug sep oct nov dec jan feb 2024 2025 2026 2027
tier tieral tierall doi
test launch ongoing always-on always_on
""".split()
)

# Common English stopwords that often appear repeated across creative copy.
_ENGLISH_STOPWORDS: frozenset[str] = frozenset(
    """
the and but are can will not has have had was were been being
this that these those there here where when what which who whom whose why how
you your yours our ours their theirs his her hers its
for from into onto with without about above below over under
some any all none every each many much more most less few
make made get got give gave take took come came see saw
just only also even still both either neither
because while though although since until before after during
will would could should might must shall may
say said tell told ask asked know knew think thought feel felt
want need use used try tried find found work worked
day days week weeks month months year years time times
new newer newest old older oldest big bigger biggest small smaller smallest
better best worse worst good great bad first last next previous
right wrong true false yes
people person things thing way ways place places
believe internet savings laundry lawn taxes hobbies water quality everything
nothing something anything important advice simpler easier wrong worth choose
choosing equal heard hear having advice fun jam created
""".split()
)

# Platform/retailer noise that appears in hashtags (#BrandPartner) and concat
# tokens (BRANDRETAILERSOCIAL). Filter AFTER concat-splitting so they don't
# define groups.
#
# The retailer tokens below are PLACEHOLDERS — replace/extend them with the
# major retailers, marketplaces, and media platforms in your market (these are
# tokens that appear at scale across creative copy/hashtags but never define a
# brand grouping).
_RETAILER_PLATFORM_STOPWORDS: frozenset[str] = frozenset(
    """
partner partners cobranded cobrand promo promotion deals deal save savings
bigboxmart megamart warehouseclub grocerco ecommerceco valuestore pharmacychain
clubstore marketplace superstore
socialplatform videoplatform searchengine streamingco
""".split()
)

GENERIC_TOKENS: frozenset[str] = (
    _GENERIC_TOKENS | _ENGLISH_STOPWORDS | _RETAILER_PLATFORM_STOPWORDS
)

_CORP_SUFFIXES: tuple[str, ...] = (
    "inc",
    "corp",
    "corporation",
    "co",
    "company",
    "ltd",
    "limited",
    "llc",
    "plc",
    "sa",
    "s.a",
    "group",
    "gmbh",
    "ag",
    "nv",
    "bv",
    "holdings",
    "international",
    "intl",
    "global",
    "worldwide",
    "technologies",
    "tech",
    "brewing",
)

# U+2019 right curly, U+2018 left curly, U+0060 backtick, U+00B4 acute.
# All fold to U+0027 straight apostrophe so curly/straight name variants tokenize the same.
_APOSTROPHE_VARIANTS: str = "’‘`´"


# === Normalization + tokenization helpers =================================


def normalize(s: str | None) -> str:
    """Lowercase, accent-fold (NFKD), apostrophe-fold."""
    if not s:
        return ""
    folded = s
    for v in _APOSTROPHE_VARIANTS:
        folded = folded.replace(v, "'")
    nfkd = unicodedata.normalize("NFKD", folded)
    return "".join(c for c in nfkd if not unicodedata.combining(c)).lower().strip()


def normalize_for_match(s: str | None) -> str:
    """Aggressive normalization for advertiser-name fuzzy matching.

    Drops corp suffixes, punctuation, and common geographic modifiers.
    Used as the lookup key in the TV → MC_ID reconciliation registry.
    """
    if not s:
        return ""
    out = normalize(s)
    out = re.sub(r"[^\w\s]", " ", out)
    out = re.sub(r"\s+", " ", out).strip()
    parts = [
        p for p in out.split(" ") if p not in _CORP_SUFFIXES and p not in {"the", "and"}
    ]
    out = " ".join(parts).strip()
    for tail in (
        " ultimate parent",
        " parent",
        " beverage company",
        " beverage",
        " incorporated",
    ):
        if out.endswith(tail):
            out = out[: -len(tail)].strip()
    return out


def tokenize(*sources: str | None) -> list[str]:
    """Return lowercased tokens (≥ 3 chars, non-numeric) split on every
    non-alphanumeric character (including underscores)."""
    out: list[str] = []
    for s in sources:
        if not s:
            continue
        for tok in re.split(r"[^a-zA-Z0-9]+", s.lower()):
            tok = tok.strip()
            if tok and len(tok) >= 3 and not tok.isdigit():
                out.append(tok)
    return out


def tokenize_with_caps(*sources: str | None) -> tuple[list[str], set[str]]:
    """Like tokenize, but also returns the set of tokens that appeared
    capitalized (proper-noun-shaped) in any source. Used by the brand-defining
    fallback to prefer real brand names over common copy that happens to repeat."""
    lower_tokens: list[str] = []
    capitalized: set[str] = set()
    for s in sources:
        if not s:
            continue
        for raw in re.split(r"[^a-zA-Z0-9]+", s):
            tok = raw.strip()
            if not tok or len(tok) < 3 or tok.isdigit():
                continue
            lower_tokens.append(tok.lower())
            if tok[0].isupper() and not tok.isupper():
                capitalized.add(tok.lower())
    return lower_tokens, capitalized


# === Brand dictionary + concat splitter ===================================


def build_brand_dictionary(
    meta_rows: list[dict[str, str]],
    tv_rows_all: list[dict[str, str]],
) -> set[str]:
    """Per-advertiser brand-name dictionary from two free signals: TV Brand
    parts[1] and parts[2] (proper-cased brand/sub-product names) and Meta
    Ad Account Name distinct tokens. Returned set is lowercase tokens (≥4
    chars, not in stopwords), suitable for greedy longest-match concat
    splitting AND for boosting in TF-IDF scoring."""
    bd: set[str] = set()
    for r in meta_rows:
        for t in tokenize(r.get("Ad Account Name", "")):
            if len(t) >= 4 and t not in GENERIC_TOKENS:
                bd.add(t)
    for r in tv_rows_all:
        brand = r.get("Brand", "").strip()
        parts = [p.strip() for p in brand.split(" - ")]
        for part in parts[1:]:
            for t in tokenize(part):
                if len(t) >= 4 and t not in GENERIC_TOKENS:
                    bd.add(t)
    return bd


# Pre-tokenization regexes for structured campaign-code stripping (Algorithm 4d-ii)
_RE_KV_PAIR: re.Pattern[str] = re.compile(r"\b\w+~[^\s_]+", re.UNICODE)
_RE_CAMPAIGN_ID: re.Pattern[str] = re.compile(r"\bcp_\d+\b|\b[Dd]\d[A-Za-z0-9]{4,}\b")
_RE_DATE: re.Pattern[str] = re.compile(
    r"\b\d{1,2}[\-/]\d{1,2}[\-/]\d{2,4}(?:\s*-\s*\d{1,2}[\-/]\d{1,2}[\-/]\d{2,4})?\b"
)


def _looks_like_alphanumeric_code(seg: str) -> bool:
    """A segment counts as a code if it's pure digits, or mixes letters and digits
    in a non-natural way (e.g., 'q1', '70080', 'abcd', 'cp_100000000000001')."""
    if not seg:
        return False
    if seg.isdigit():
        return True
    if any(ch.isdigit() for ch in seg):
        return True
    # Short cryptic abbreviations (≤ 4 chars, all consonants or alpha-only) often
    # show up as code segments — `abcd`, `xyz`, `q1`, `cn`, `ob`. We can't tell
    # for sure, but combined with the multi-segment heuristic in strip_campaign_codes
    # the false-positive rate stays low.
    if len(seg) <= 4 and seg.isalpha():
        return True
    return False


def strip_campaign_codes(s: str, brand_dict: set[str] | None = None) -> str:
    """Pre-tokenization scrub for structured campaign-management codes that
    survive normal tokenization and dominate TF-IDF scoring (SKILL.md 4d-ii).
    Strips KEY~VALUE pairs, underscore-segmented codes (≥3 segments with ≥2
    alphanumeric/numeric), `cp_\\d+` / hex-style IDs, and embedded date ranges.

    `brand_dict` (lowercase brand tokens) is exempted from the code heuristic so
    short (e.g. 4-letter) brand names glued into an underscore triplet like
    `Brand_US_Reach` are NOT misclassified as codes and dropped along with the
    rest of the token."""
    if not s:
        return s
    bd = brand_dict or set()
    out = _RE_KV_PAIR.sub(" ", s)
    out = _RE_CAMPAIGN_ID.sub(" ", out)
    out = _RE_DATE.sub(" ", out)
    # Normalize pipe / slash / backslash to whitespace BEFORE the underscore-segment
    # heuristic so we don't conflate distinct code blocks ('a|b_c|d') as one token.
    out = re.sub(r"[|/\\]+", " ", out)

    # Underscore-segmented codes: split on whitespace, then for each whitespace
    # token examine its underscore segments. If 3+ segments and ≥2 look codey,
    # drop the whole token. Known brand tokens never count as codey.
    cleaned: list[str] = []
    for ws_tok in out.split():
        segs = ws_tok.split("_")
        if len(segs) >= 3:
            code_count = sum(
                1
                for seg in segs
                if seg.lower() not in bd and _looks_like_alphanumeric_code(seg)
            )
            if code_count >= 2:
                continue
        cleaned.append(ws_tok)
    return " ".join(cleaned)


def concat_split(s: str, sorted_brand: list[str]) -> str:
    """Greedy longest-match split of `s` against `sorted_brand` (brand tokens
    pre-sorted longest-first by the caller so we don't re-sort per call). Inserts
    a space before and after each matched dictionary token. Catches concat
    strings like `BrandPartner` → `Brand Partner` so subsequent tokenization
    recovers brand tokens that would otherwise be glued to retailer/platform
    noise."""
    if not s or not sorted_brand:
        return s
    lower = s.lower()
    out: list[str] = []
    i = 0
    L = len(lower)
    while i < L:
        matched: str | None = None
        for entry in sorted_brand:
            n = len(entry)
            if i + n <= L and lower[i : i + n] == entry:
                matched = entry
                break
        if matched:
            if out and out[-1] not in " \t\n":
                out.append(" ")
            out.append(s[i : i + len(matched)])
            i += len(matched)
            if i < L and lower[i] not in " \t\n":
                out.append(" ")
        else:
            out.append(s[i])
            i += 1
    return "".join(out)


# === Date normalization ==================================================


def normalize_date_meta(s: str | None) -> str:
    """Meta CSV is mostly ISO-ish; tolerate the common variants."""
    if not s:
        return ""
    out = s.strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(out, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return out


def normalize_date_tv(s: str | None) -> str:
    """TV CSV uses `DD MMM YYYY`; `31-12-9999` is the ongoing sentinel."""
    if not s:
        return ""
    out = s.strip()
    if "9999" in out:
        return "ongoing"
    for fmt in ("%d %b %Y", "%d-%m-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(out, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return out


# === Halo config rule application ========================================

_FIELD_MAP: dict[str, str] = {
    "campaign_name": "Campaign Name",
    "ad_account_name": "Ad Account Name",
    "creative_titles": "Creative Titles",
    "creative_bodies": "Creative Bodies",
}


def field_for_match(r: dict[str, str], match_field: str) -> str:
    return r.get(_FIELD_MAP.get(match_field, ""), "")


def keyword_match(value: str, keywords: list[str]) -> str | None:
    """Case + accent insensitive substring match. Returns the matched keyword."""
    if not value:
        return None
    nv = normalize(value)
    for kw in keywords:
        nk = normalize(kw)
        if nk and nk in nv:
            return kw
    return None


def apply_config_rules(
    cfg: dict[str, object],
    rows: list[dict[str, str]],
) -> tuple[list[tuple[str | None, str]], str]:
    """Return per-row (group_slug, rationale) pairs and the catch_all slug."""
    bucketing = cfg.get("bucketing") or {}
    rules = bucketing.get("rules", []) if isinstance(bucketing, dict) else []
    catch_all = bucketing.get("catch_all", "") if isinstance(bucketing, dict) else ""
    confirmed_list = cfg.get("confirmed_campaigns") or []
    confirmed: dict[str, str] = {
        c["campaign_id"]: c["target_group"]
        for c in confirmed_list
        if isinstance(c, dict) and "campaign_id" in c and "target_group" in c
    }

    out: list[tuple[str | None, str]] = []
    for r in rows:
        cid = r.get("Campaign ID", "").strip()
        if cid in confirmed:
            out.append(
                (confirmed[cid], f"confirmed_campaigns override → {confirmed[cid]}")
            )
            continue
        matched: tuple[str, str] | None = None
        for rule in rules:
            if not isinstance(rule, dict):
                continue
            match_field = rule.get("match_field")
            target_group = rule.get("target_group")
            if not match_field or not target_group:
                logger.warning(
                    "skipping malformed bucketing rule (missing match_field/"
                    "target_group): %s",
                    rule,
                )
                continue
            kw = keyword_match(
                field_for_match(r, match_field),
                rule.get("keywords", []),
            )
            if kw:
                matched = (
                    target_group,
                    f'rule keyword "{kw}" matched in {match_field}',
                )
                break
        out.append(matched if matched else (None, ""))
    return out, catch_all if isinstance(catch_all, str) else ""


# === AI text grouping (TF-IDF + brand-defining fallback) ==================

_BRAND_BOOST: float = 3.0
_FIELD_WEIGHTS: dict[str, float] = {
    "campaign_name": 1.0,
    "ad_account_name": 1.0,
    "creative_titles": 2.0,
    "creative_bodies": 2.0,
}


def detect_groups_text(
    advertiser_name: str,
    rows: list[dict[str, str]],
    brand_dict: set[str],
) -> list[tuple[str | None, str]]:
    """Two-tier text clustering. Returns per-row (group_label, rationale)."""
    adv_tokens = set(tokenize(advertiser_name))
    stop = GENERIC_TOKENS | adv_tokens
    sorted_brand = sorted(brand_dict, key=len, reverse=True)

    per_camp_token_weight: list[dict[str, float]] = []
    proper_noun_tokens: set[str] = set()
    for r in rows:
        token_w: dict[str, float] = defaultdict(float)
        for field, w in _FIELD_WEIGHTS.items():
            split = concat_split(
                strip_campaign_codes(field_for_match(r, field), brand_dict),
                sorted_brand,
            )
            toks, caps = tokenize_with_caps(split)
            for t in toks:
                if t in stop:
                    continue
                token_w[t] += w
            proper_noun_tokens |= caps - stop
        per_camp_token_weight.append(token_w)

    doc_freq: Counter[str] = Counter()
    for tw in per_camp_token_weight:
        for t in tw:
            doc_freq[t] += 1

    n = len(rows)
    discriminative: set[str] = {
        t for t, c in doc_freq.items() if c >= 2 and c < max(2, int(n * 0.7))
    }
    brand_defining: set[str] = {
        t for t, c in doc_freq.items() if c >= max(2, int(n * 0.8))
    }

    def discriminative_top(tw: dict[str, float]) -> str | None:
        cands = {t: w for t, w in tw.items() if t in discriminative}
        if not cands:
            return None

        def score(t: str) -> float:
            boost = _BRAND_BOOST if t in brand_dict else 1.0
            return cands[t] * len(t) * math.log(max(2, n / doc_freq[t])) * boost

        return max(cands, key=score)

    discriminative_assignments = [
        discriminative_top(tw) for tw in per_camp_token_weight
    ]
    distinct_disc_groups = {g for g in discriminative_assignments if g is not None}
    use_brand_defining = bool(brand_defining) and len(distinct_disc_groups) <= 2

    def pick_brand_defining(tw: dict[str, float]) -> str | None:
        bd = {t: w for t, w in tw.items() if t in brand_defining}
        if not bd:
            return None
        return max(
            bd,
            key=lambda t: (
                t in proper_noun_tokens,
                doc_freq[t],
                len(t),
                bd[t],
            ),
        )

    assignments: list[tuple[str | None, str]] = []
    for tw, disc_top in zip(per_camp_token_weight, discriminative_assignments):
        if use_brand_defining:
            top = pick_brand_defining(tw)
            if top:
                assignments.append(
                    (
                        top.capitalize(),
                        f'Token "{top}" (in {doc_freq[top]}/{n} campaigns ≥80% — single-brand-line)',
                    )
                )
                continue
        if disc_top is not None:
            assignments.append(
                (
                    disc_top.capitalize(),
                    f'Token "{disc_top}" (in {doc_freq[disc_top]}/{n} campaigns)',
                )
            )
            continue
        top = pick_brand_defining(tw)
        if top:
            assignments.append(
                (
                    top.capitalize(),
                    f'Token "{top}" (in {doc_freq[top]}/{n} campaigns ≥80% — fallback)',
                )
            )
            continue
        assignments.append((None, ""))
    return assignments


# === TV → MC_ID reconciliation ==========================================


def lookup_mcid_by_name(
    name: str,
    name_to_mcid: dict[str, str],
) -> tuple[str, float, str]:
    """Tiered TV → MC_ID match. Returns (mcid, confidence, rationale)."""
    if not name:
        return ("", 0.0, "")
    n = normalize_for_match(name)
    if not n:
        return ("", 0.0, "")
    if n in name_to_mcid:
        return (name_to_mcid[n], 1.0, f'exact normalized match → "{n}"')

    n_tokens = set(n.split())
    if not n_tokens:
        return ("", 0.0, "")

    best_mc: str = ""
    best_score: float = 0.0
    best_match: str = ""
    for indexed_name, mc in name_to_mcid.items():
        if not indexed_name:
            continue
        i_tokens = set(indexed_name.split())
        if not i_tokens:
            continue
        overlap = n_tokens & i_tokens
        if not overlap:
            continue
        jaccard = len(overlap) / len(n_tokens | i_tokens)
        if jaccard > best_score:
            best_score = jaccard
            best_mc = mc
            best_match = indexed_name

    if best_score >= 0.7:
        return (
            best_mc,
            best_score,
            f'high token overlap (Jaccard {best_score:.2f}) → "{best_match}"',
        )
    if best_score >= 0.4:
        return (
            best_mc,
            best_score,
            f'partial token overlap (Jaccard {best_score:.2f}) → "{best_match}" (LOW CONFIDENCE)',
        )
    return ("", 0.0, "")


# === TF-IDF vectors + cluster drift detection ============================


def build_tfidf_vectors(
    rows: list[dict[str, str]],
    advertiser_name: str,
    brand_dict: set[str],
) -> list[dict[str, float]]:
    """Per-row L2-normalized TF-IDF vectors for cluster-drift detection."""
    adv_tokens = set(tokenize(advertiser_name))
    stop = GENERIC_TOKENS | adv_tokens
    sorted_brand = sorted(brand_dict, key=len, reverse=True)

    raw: list[dict[str, float]] = []
    for r in rows:
        tw: dict[str, float] = defaultdict(float)
        for field, w in _FIELD_WEIGHTS.items():
            split = concat_split(
                strip_campaign_codes(field_for_match(r, field), brand_dict),
                sorted_brand,
            )
            for t in tokenize(split):
                if t in stop:
                    continue
                tw[t] += w
        raw.append(tw)

    n = len(rows)
    df: Counter[str] = Counter()
    for tw in raw:
        for t in tw:
            df[t] += 1

    vecs: list[dict[str, float]] = []
    for tw in raw:
        v: dict[str, float] = {}
        for t, w in tw.items():
            idf = math.log(max(2, (n + 1) / (df[t] + 1)))
            v[t] = w * idf
        norm = math.sqrt(sum(x * x for x in v.values())) or 1.0
        vecs.append({t: x / norm for t, x in v.items()})
    return vecs


def cosine(a: dict[str, float], b: dict[str, float]) -> float:
    """Cosine of two L2-normalized sparse dict vectors (= dot product)."""
    if len(a) > len(b):
        a, b = b, a
    return sum(b.get(t, 0.0) * w for t, w in a.items())


# === Loaders =============================================================


def load_csv(path: str) -> list[dict[str, str]]:
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def require_columns(rows: list[dict[str, str]], required: set[str], label: str) -> None:
    """Fail fast with an actionable message if the CSV is missing columns the
    pipeline indexes directly (otherwise the failure is an opaque KeyError deep
    in the run)."""
    if not rows:
        return
    present = set(rows[0].keys())
    missing = required - present
    if missing:
        raise ValueError(
            f"{label} CSV is missing required column(s): "
            f"{', '.join(sorted(missing))}. Found: {', '.join(sorted(present))}"
        )


def load_configs(config_dir: str | None) -> dict[str, dict[str, object]]:
    """Load all *.json configs in `config_dir` keyed by mc_id.

    Only `.json` is supported; other files (e.g. `.yaml`) are skipped with a
    warning so a mis-named config isn't silently ignored."""
    out: dict[str, dict[str, object]] = {}
    if not config_dir or not os.path.isdir(config_dir):
        return out
    for fn in os.listdir(config_dir):
        if not fn.endswith(".json"):
            if not fn.startswith("."):
                logger.warning(
                    "skipping non-.json config %s (only .json is supported)", fn
                )
            continue
        path = os.path.join(config_dir, fn)
        try:
            with open(path, encoding="utf-8") as f:
                cfg = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            logger.warning("failed to load config %s: %s", path, e)
            continue
        adv = cfg.get("advertiser") or {}
        mc = adv.get("mc_id", "") if isinstance(adv, dict) else ""
        if mc:
            out[mc] = cfg
    return out


def write_csv(path: str, rows: Iterable[dict[str, object]], cols: list[str]) -> None:
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for r in rows:
            w.writerow({c: r.get(c, "") for c in cols})


def write_json(path: str, data: object) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


_CAMPAIGN_COLS: list[str] = [
    "measured_entity",
    "campaign_id",
    "campaign_name",
    "optimization_goal",
    "objective",
    "age_min",
    "age_max",
    "gender",
    "start_date",
    "end_date",
]


def build_nested(results: list[dict[str, object]]) -> list[dict[str, object]]:
    """Nested advertiser → groups[] → campaigns[] view of the flat grouping rows
    (the JSON hierarchy documented in references/algorithm.md). Preserves the
    sorted order of `results`."""
    by_adv: dict[tuple[str, str], dict[str, object]] = {}
    order: list[tuple[str, str]] = []
    for r in results:
        akey = (str(r.get("advertiser_name", "")), str(r.get("mc_id", "")))
        if akey not in by_adv:
            by_adv[akey] = {"advertiser_name": akey[0], "mc_id": akey[1], "_groups": {}}
            order.append(akey)
        groups = by_adv[akey]["_groups"]
        gname = str(r.get("group_name", ""))
        groups.setdefault(gname, []).append({c: r.get(c, "") for c in _CAMPAIGN_COLS})
    out: list[dict[str, object]] = []
    for akey in order:
        adv = by_adv[akey]
        out.append(
            {
                "advertiser_name": adv["advertiser_name"],
                "mc_id": adv["mc_id"],
                "groups": [
                    {"group_name": g, "campaigns": c}
                    for g, c in adv["_groups"].items()
                ],
            }
        )
    return out


# === Main pipeline =======================================================


def slug_to_display(cfg: dict[str, object] | None, slug: str) -> str:
    if not cfg:
        return slug
    adv = cfg.get("advertiser") or {}
    if not isinstance(adv, dict):
        return slug
    for g in adv.get("groups", []):
        if isinstance(g, dict) and g.get("slug") == slug:
            return g.get("display_name", slug)
    return slug


def end_sort_key(end: str) -> tuple[int, str]:
    if end == "ongoing":
        return (1, "")
    return (0, end)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--meta-csv", required=True, help="Enriched Meta CSV path"
    )
    parser.add_argument(
        "--tv-csv", required=True, help="Deduplicated TV CSV path"
    )
    parser.add_argument(
        "--config-dir",
        default=None,
        help="Per-advertiser config directory (read/write). If omitted, "
        "pure-AI grouping with no config writes.",
    )
    parser.add_argument(
        "--out-dir", required=True, help="Output directory for the CSV/JSON artifacts"
    )
    parser.add_argument(
        "--output-format",
        choices=("csv", "json", "both"),
        default="csv",
        help="Emit CSVs (default), JSON, or both. JSON adds a nested "
        "groupings_nested.json (advertiser → groups → campaigns) alongside the "
        "flat per-artifact JSON files.",
    )
    parser.add_argument(
        "--advertiser", default=None, help="Filter to one advertiser by name or MC_ID"
    )
    parser.add_argument(
        "--no-config-write",
        action="store_true",
        help="Read existing config but skip writing back",
    )
    parser.add_argument(
        "--log-level", default="INFO", choices=("DEBUG", "INFO", "WARNING", "ERROR")
    )
    args = parser.parse_args()

    logging.basicConfig(level=args.log_level, format="%(levelname)s %(message)s")
    os.makedirs(args.out_dir, exist_ok=True)

    configs_by_mcid = load_configs(args.config_dir)
    logger.info("loaded %d Halo config(s)", len(configs_by_mcid))

    meta_rows = load_csv(args.meta_csv)
    tv_rows = load_csv(args.tv_csv)
    logger.info("Meta rows: %d, TV rows: %d", len(meta_rows), len(tv_rows))
    require_columns(meta_rows, {"MCID", "Advertiser Name"}, "Meta")
    require_columns(tv_rows, {"Brand"}, "TV")

    # --- Build canonical advertiser registry (MC_ID is source of truth) ---
    mcid_to_meta_names: dict[str, set[str]] = defaultdict(set)
    for r in meta_rows:
        mc = (r.get("MCID") or "").strip()
        nm = (r.get("Advertiser Name") or "").strip()
        if mc and nm:
            mcid_to_meta_names[mc].add(nm)

    mcid_to_canonical: dict[str, str] = {}
    for mc, names in mcid_to_meta_names.items():
        cfg = configs_by_mcid.get(mc)
        adv = (cfg.get("advertiser") if cfg else None) or {}
        cfg_name = adv.get("display_name", "") if isinstance(adv, dict) else ""
        if cfg_name:
            mcid_to_canonical[mc] = cfg_name
        else:
            candidates = [n for n in names if n.upper() != "UNKNOWN"]
            mcid_to_canonical[mc] = max(candidates or list(names), key=len)

    # name_to_mcid lookup (includes aliases from configs)
    name_to_mcid: dict[str, str] = {}
    for mc, names in mcid_to_meta_names.items():
        for nm in names:
            name_to_mcid[normalize_for_match(nm)] = mc
        name_to_mcid[normalize_for_match(mcid_to_canonical[mc])] = mc
        cfg = configs_by_mcid.get(mc)
        adv = (cfg.get("advertiser") if cfg else None) or {}
        if isinstance(adv, dict):
            for alias in adv.get("aliases", []):
                if isinstance(alias, str):
                    name_to_mcid[normalize_for_match(alias)] = mc

    # Optional advertiser filter
    target_filter: str | None = None
    if args.advertiser:
        target_filter = args.advertiser.strip()

    # --- Process Meta rows, grouped by MC_ID ---
    mcid_to_rows: dict[str, list[dict[str, str]]] = defaultdict(list)
    for r in meta_rows:
        mcid_to_rows[(r.get("MCID") or "").strip()].append(r)

    results: list[dict[str, object]] = []
    pending_review: list[dict[str, object]] = []
    flags_unrecognized: list[dict[str, object]] = []
    flags_anomalies: list[dict[str, object]] = []
    flags_tv_lowconf: list[dict[str, object]] = []
    flags_cluster_drift: list[dict[str, object]] = []
    campaign_vectors: list[dict[str, object]] = []

    # Pre-index TV rows by resolved MC_ID so per-advertiser brand dictionaries
    # don't get polluted by unrelated advertisers' TV brands.
    tv_rows_by_mcid: dict[str, list[dict[str, str]]] = defaultdict(list)
    for tr in tv_rows:
        brand = (tr.get("Brand") or "").strip()
        parts = [p.strip() for p in brand.split(" - ")] if brand else []
        if parts and parts[0]:
            mc_match, conf, _ = lookup_mcid_by_name(parts[0], name_to_mcid)
            if mc_match and conf >= 0.7:
                tv_rows_by_mcid[mc_match].append(tr)

    for mc, rows in mcid_to_rows.items():
        canonical = mcid_to_canonical.get(mc, rows[0].get("Advertiser Name", ""))
        if target_filter and target_filter != mc:
            tf_norm = normalize_for_match(target_filter)
            names = mcid_to_meta_names.get(mc, set())
            if tf_norm not in {normalize_for_match(n) for n in (names | {canonical})}:
                continue
        cfg = configs_by_mcid.get(mc)
        lifecycle = (cfg.get("lifecycle") if cfg else None) or {}
        phase = (
            lifecycle.get("phase", "initial_setup")
            if isinstance(lifecycle, dict)
            else "initial_setup"
        )
        is_initial = phase == "initial_setup"
        confirmed_list = (cfg.get("confirmed_campaigns") if cfg else None) or []
        confirmed_ids: set[str] = {
            c["campaign_id"]
            for c in confirmed_list
            if isinstance(c, dict) and "campaign_id" in c
        }

        tv_rows_for_mc = tv_rows_by_mcid.get(mc, [])
        brand_dict = build_brand_dictionary(rows, tv_rows_for_mc)
        tfidf_vecs = build_tfidf_vectors(rows, canonical, brand_dict)

        if cfg:
            cfg_assignments, catch_all = apply_config_rules(cfg, rows)
        else:
            cfg_assignments = [(None, "")] * len(rows)
            catch_all = ""

        final = list(cfg_assignments)
        if not (cfg and catch_all):
            fallback_idx = [i for i, (g, _) in enumerate(cfg_assignments) if g is None]
            fallback_rows = [rows[i] for i in fallback_idx]
            if fallback_rows:
                fallback = detect_groups_text(canonical, fallback_rows, brand_dict)
                for i, fa in zip(fallback_idx, fallback):
                    final[i] = fa

        for r, (group, rationale), vec in zip(rows, final, tfidf_vecs):
            cid = r.get("Campaign ID", "").strip()
            cn = r.get("Campaign Name", "").strip()
            amin = r.get("Age Min", "").strip()
            amax = r.get("Age Max", "").strip()

            if not cn:
                flags_anomalies.append(
                    {
                        "advertiser_name": canonical,
                        "mc_id": mc,
                        "campaign_id": cid,
                        "campaign_name": "",
                        "reason": "Empty Campaign Name",
                    }
                )
            try:
                if amin and amax and float(amin) > float(amax):
                    flags_anomalies.append(
                        {
                            "advertiser_name": canonical,
                            "mc_id": mc,
                            "campaign_id": cid,
                            "campaign_name": cn,
                            "reason": f"Age Min ({amin}) > Age Max ({amax})",
                        }
                    )
            except ValueError:
                pass

            if group is None:
                if catch_all:
                    group_label = slug_to_display(cfg, catch_all)
                    pending_review.append(
                        {
                            "advertiser_name": canonical,
                            "mc_id": mc,
                            "campaign_id": cid,
                            "campaign_name": cn,
                            "suggested_group": group_label,
                            "rationale": f'No rule matched; assigned to catch_all "{catch_all}"',
                        }
                    )
                else:
                    flags_unrecognized.append(
                        {
                            "advertiser_name": canonical,
                            "mc_id": mc,
                            "campaign_id": cid,
                            "campaign_name": cn,
                            "reason": "No rule matched and no catch_all configured",
                        }
                    )
                    group_label = "(unrecognized)"
            else:
                group_label = slug_to_display(cfg, group) if cfg else group
                is_confirmed = cid in confirmed_ids
                is_rule = (
                    "rule keyword" in rationale or "confirmed_campaigns" in rationale
                )
                if not is_confirmed and (is_initial or not is_rule):
                    pending_review.append(
                        {
                            "advertiser_name": canonical,
                            "mc_id": mc,
                            "campaign_id": cid,
                            "campaign_name": cn,
                            "suggested_group": group_label,
                            "rationale": rationale,
                        }
                    )

            results.append(
                {
                    "advertiser_name": canonical,
                    "mc_id": mc,
                    "group_name": group_label,
                    "measured_entity": "Meta",
                    "campaign_id": cid,
                    "campaign_name": cn,
                    "optimization_goal": r.get("Optimization Goal", ""),
                    "objective": r.get("Objective", ""),
                    "age_min": amin or "all adults",
                    "age_max": amax or "all adults",
                    "gender": r.get("Gender", "").strip() or "all adults",
                    "start_date": normalize_date_meta(r.get("Start Date", "")),
                    "end_date": normalize_date_meta(r.get("End Date", "")),
                }
            )
            if vec:
                campaign_vectors.append(
                    {
                        "mc_id": mc,
                        "advertiser_name": canonical,
                        "group_label": group_label,
                        "campaign_id": cid,
                        "campaign_name": cn,
                        "vec": vec,
                    }
                )

    # --- TV processing ---
    tv_advs_no_mcid: dict[str, list[str]] = defaultdict(list)
    for r in tv_rows:
        brand = r.get("Brand", "").strip()
        parts = [p.strip() for p in brand.split(" - ")] if brand else []
        if parts and parts[0]:
            mc, _, _ = lookup_mcid_by_name(parts[0], name_to_mcid)
            if not mc:
                tv_advs_no_mcid[normalize_for_match(parts[0])].append(parts[0])
    tv_canonical_no_mcid: dict[str, str] = {}
    for variants in tv_advs_no_mcid.values():
        canonical = max(set(variants), key=lambda v: (len(v), v))
        for v in set(variants):
            tv_canonical_no_mcid[v] = canonical

    for r in tv_rows:
        brand = r.get("Brand", "").strip()
        parts = [p.strip() for p in brand.split(" - ")] if brand else []
        if not parts or not parts[0]:
            flags_anomalies.append(
                {
                    "advertiser_name": "",
                    "mc_id": "",
                    "campaign_id": "",
                    "campaign_name": r.get("Advert", ""),
                    "reason": f'TV row with empty/malformed Brand: "{brand}"',
                }
            )
            continue
        raw_adv = parts[0]
        group = parts[1] if len(parts) > 1 and parts[1] else "(unrecognized)"
        mc, confidence, rationale = lookup_mcid_by_name(raw_adv, name_to_mcid)

        if mc and confidence >= 0.7:
            tv_canonical = mcid_to_canonical.get(mc, raw_adv)
            if confidence < 1.0:
                pending_review.append(
                    {
                        "advertiser_name": tv_canonical,
                        "mc_id": mc,
                        "campaign_id": "",
                        "campaign_name": r.get("Advert", ""),
                        "suggested_group": f"(TV reconciliation) → MCID {mc}",
                        "rationale": f'TV advertiser "{raw_adv}" {rationale}',
                    }
                )
            cfg_tv = configs_by_mcid.get(mc)
            lifecycle_tv = (cfg_tv.get("lifecycle") if cfg_tv else None) or {}
            phase_tv = (
                lifecycle_tv.get("phase", "initial_setup")
                if isinstance(lifecycle_tv, dict)
                else "initial_setup"
            )
            if phase_tv == "initial_setup":
                pending_review.append(
                    {
                        "advertiser_name": tv_canonical,
                        "mc_id": mc,
                        "campaign_id": "",
                        "campaign_name": r.get("Advert", ""),
                        "suggested_group": group,
                        "rationale": f'TV row, group from Brand parts[1]="{group}"',
                    }
                )
        elif mc and confidence >= 0.4:
            tv_canonical = tv_canonical_no_mcid.get(raw_adv, raw_adv)
            flags_tv_lowconf.append(
                {
                    "tv_advertiser_name": raw_adv,
                    "tv_brand_full": brand,
                    "proposed_mc_id": mc,
                    "proposed_meta_advertiser": mcid_to_canonical.get(mc, ""),
                    "confidence": f"{confidence:.2f}",
                    "reason": rationale,
                }
            )
            mc = ""
        else:
            tv_canonical = tv_canonical_no_mcid.get(raw_adv, raw_adv)
            mc = ""
            pending_review.append(
                {
                    "advertiser_name": tv_canonical,
                    "mc_id": "",
                    "campaign_id": "",
                    "campaign_name": r.get("Advert", ""),
                    "suggested_group": group,
                    "rationale": f'TV-only L1 (no MC_ID match), group from Brand parts[1]="{group}"',
                }
            )

        if target_filter and target_filter not in (mc, tv_canonical):
            continue
        results.append(
            {
                "advertiser_name": tv_canonical,
                "mc_id": mc,
                "group_name": group,
                "measured_entity": r.get("Measured Entity", ""),
                "campaign_id": "",
                "campaign_name": r.get("Advert", ""),
                "optimization_goal": "",
                "objective": "",
                "age_min": "all adults",
                "age_max": "all adults",
                "gender": "all adults",
                "start_date": normalize_date_tv(r.get("Start Date", "")),
                "end_date": normalize_date_tv(r.get("End Date", "")),
            }
        )

    # --- Cluster drift pass ---
    clusters: dict[tuple[str, str], list[dict[str, object]]] = defaultdict(list)
    for cv in campaign_vectors:
        clusters[(cv["mc_id"], cv["group_label"])].append(cv)

    adv_centroids: dict[str, dict[str, dict[str, float]]] = defaultdict(dict)

    def mean_vector(vecs: list[dict[str, float]]) -> dict[str, float]:
        centroid: dict[str, float] = defaultdict(float)
        for v in vecs:
            for t, w in v.items():
                centroid[t] += w
        n = len(vecs)
        centroid = {t: w / n for t, w in centroid.items()}
        norm = math.sqrt(sum(x * x for x in centroid.values())) or 1.0
        return {t: x / norm for t, x in centroid.items()}

    for (mc, gl), cvs in clusters.items():
        if len(cvs) >= 2:
            adv_centroids[mc][gl] = mean_vector([cv["vec"] for cv in cvs])

    for (mc, gl), cvs in clusters.items():
        if len(cvs) < 3:
            continue
        centroid = adv_centroids[mc][gl]
        distances = [1.0 - cosine(cv["vec"], centroid) for cv in cvs]
        mean_d = sum(distances) / len(distances)
        var = sum((d - mean_d) ** 2 for d in distances) / len(distances)
        std_d = math.sqrt(var)
        threshold = mean_d + 2 * std_d
        other_groups = {g: c for g, c in adv_centroids[mc].items() if g != gl}
        for cv, d in zip(cvs, distances):
            if d <= threshold or std_d < 0.01:
                continue
            next_group = ""
            next_dist = 1.0
            for og, oc in other_groups.items():
                od = 1.0 - cosine(cv["vec"], oc)
                if od < next_dist:
                    next_group, next_dist = og, od
            flags_cluster_drift.append(
                {
                    "advertiser_name": cv["advertiser_name"],
                    "mc_id": cv["mc_id"],
                    "campaign_id": cv["campaign_id"],
                    "campaign_name": cv["campaign_name"],
                    "assigned_group": cv["group_label"],
                    "cosine_distance": f"{d:.3f}",
                    "group_mean_distance": f"{mean_d:.3f}",
                    "group_stddev": f"{std_d:.3f}",
                    "suggested_next_group": next_group,
                    "next_distance": f"{next_dist:.3f}" if next_group else "",
                    "reason": (
                        f"d={d:.3f} > mean+2σ ({threshold:.3f}); "
                        + (
                            f'closer to "{next_group}" (d={next_dist:.3f})'
                            if next_group and next_dist < d
                            else "no closer group within advertiser"
                        )
                    ),
                }
            )

    # --- Sort + emit ---
    results.sort(
        key=lambda x: (
            str(x["advertiser_name"]).lower(),
            str(x["group_name"]).lower(),
            end_sort_key(str(x["end_date"])),
        )
    )

    # Dedupe TV low-conf by (tv_adv, proposed_mc_id) for the human-review surface.
    seen: dict[tuple[str, str], dict[str, object]] = {}
    for r in flags_tv_lowconf:
        k = (str(r["tv_advertiser_name"]), str(r["proposed_mc_id"]))
        if k not in seen:
            seen[k] = {**r, "tv_row_count": 1}
        else:
            seen[k]["tv_row_count"] = int(seen[k]["tv_row_count"]) + 1

    artifacts: list[tuple[str, list[dict[str, object]], list[str]]] = [
        (
            "groupings",
            results,
            [
                "advertiser_name",
                "mc_id",
                "group_name",
                "measured_entity",
                "campaign_id",
                "campaign_name",
                "optimization_goal",
                "objective",
                "age_min",
                "age_max",
                "gender",
                "start_date",
                "end_date",
            ],
        ),
        (
            "pending_review",
            pending_review,
            [
                "advertiser_name",
                "mc_id",
                "campaign_id",
                "campaign_name",
                "suggested_group",
                "rationale",
            ],
        ),
        (
            "flags_unrecognized",
            flags_unrecognized,
            ["advertiser_name", "mc_id", "campaign_id", "campaign_name", "reason"],
        ),
        (
            "flags_anomalies",
            flags_anomalies,
            ["advertiser_name", "mc_id", "campaign_id", "campaign_name", "reason"],
        ),
        (
            "flags_tv_lowconf",
            list(seen.values()),
            [
                "tv_advertiser_name",
                "proposed_meta_advertiser",
                "proposed_mc_id",
                "confidence",
                "tv_row_count",
                "reason",
            ],
        ),
        (
            "flags_cluster_drift",
            flags_cluster_drift,
            [
                "advertiser_name",
                "mc_id",
                "campaign_id",
                "campaign_name",
                "assigned_group",
                "suggested_next_group",
                "cosine_distance",
                "group_mean_distance",
                "group_stddev",
                "next_distance",
                "reason",
            ],
        ),
    ]

    fmt = args.output_format
    for name, rows, cols in artifacts:
        if fmt in ("csv", "both"):
            write_csv(os.path.join(args.out_dir, name + ".csv"), rows, cols)
        if fmt in ("json", "both"):
            write_json(
                os.path.join(args.out_dir, name + ".json"),
                [{c: r.get(c, "") for c in cols} for r in rows],
            )
    if fmt in ("json", "both"):
        write_json(
            os.path.join(args.out_dir, "groupings_nested.json"),
            build_nested(results),
        )

    logger.info(
        "Wrote %d grouping rows, %d pending review, %d unrecognized, "
        "%d anomalies, %d TV low-conf, %d cluster drift (format=%s)",
        len(results),
        len(pending_review),
        len(flags_unrecognized),
        len(flags_anomalies),
        len(seen),
        len(flags_cluster_drift),
        fmt,
    )


if __name__ == "__main__":
    main()