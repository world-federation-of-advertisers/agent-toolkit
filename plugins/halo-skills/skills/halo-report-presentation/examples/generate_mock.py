#!/usr/bin/env python3
"""Emit mock BasicReport JSON responses for rendering example reports.

The shape matches a real Halo BasicReport REST response observed at
GET /v2alpha/{mc}/basicReports/{id} (sampled across 4 production reports).
Notable real-API quirks reproduced here:

  - int64 fields (reach, impressions, populationSize, kPlusReach[],
    stackedIncrementalReach[]) are JSON strings, not numbers — protobuf's
    default int64 → JSON encoding to avoid JS Number precision loss.
  - metricFrequency.weekly is a string day-name ("THURSDAY" / "FRIDAY" /
    "SATURDAY" observed); metricFrequency.total is the literal `true`.
  - Per-result metric_start_time fields are ISO-8601 strings.
  - reportingInterval.reportStart is a full TimeOfDay-style timestamp;
    reportEnd is date-only.
  - For 'total' RGs the API populates `nonCumulative` and sets
    `cumulative: null`.  For 'weekly' RGs the inverse holds.  The mock
    populates BOTH so the existing renderer (which reads cumulative only)
    keeps working; real reports surface this asymmetry.
  - For single-publisher reports, `stackedIncrementalReach: []`,
    `componentIntersections: []`, and the lone component's
    `cumulativeUnique` / `nonCumulativeUnique` are `null` (no overlap
    to compute).
  - `effectiveImpressionQualificationFilters` is a list of FilterSpec
    objects (`[{custom: {filterSpec: [...]}}]`), NOT a list of
    `{impressionQualificationFilter: name}`. The parser's IQF extraction
    expects the latter and silently drops the former — known divergence,
    not fixed here.
Usage:
    python3 generate_mock.py [scenario_name|all]

Scenarios:
    1pub_tv         — single publisher (Linear TV), totals only — no
                      stacked-incremental, no intersections
    2pub_rich       — 2 publishers, weekly trend
    5pub_overflow   — 5 publishers, totals only
    failed          — single-slide FAILED-state report

Outputs land next to this script as <scenario>.json.
"""

import json
import os
import sys
from datetime import date, datetime, timezone

_HERE = os.path.dirname(os.path.abspath(__file__))

DP_PREFIX = "dataProviders"
MC = "measurementConsumers/example-mc"
WEEKLY_DAY = "THURSDAY"


def _full_date(d: date) -> dict:
    """Full TimeOfDay-style timestamp as emitted on reportingInterval.reportStart."""
    return {
        "year": d.year,
        "month": d.month,
        "day": d.day,
        "hours": 0,
        "minutes": 0,
        "seconds": 0,
        "nanos": 0,
        "utcOffset": "0s",
    }


def _short_date(d: date) -> dict:
    """Date-only object as emitted on reportingInterval.reportEnd."""
    return {"year": d.year, "month": d.month, "day": d.day}


def _iso(d: date) -> str:
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )


_EPOCH_ISO = "1970-01-01T00:00:00Z"


def _metric_set(ms: dict) -> dict:
    """Translate a snake_case scenario dict into the camelCase + string-int64
    shape the Halo API emits."""
    out: dict = {}
    int64_fields = {
        "reach": "reach",
        "impressions": "impressions",
    }
    for src, dst in int64_fields.items():
        if src in ms:
            out[dst] = str(int(ms[src]))

    if "percent_reach" in ms:
        out["percentReach"] = float(ms["percent_reach"])
    if "average_frequency" in ms:
        out["averageFrequency"] = float(ms["average_frequency"])
    if "grps" in ms:
        out["grps"] = float(ms["grps"])

    if "k_plus_reach" in ms:
        out["kPlusReach"] = [str(int(v)) for v in ms["k_plus_reach"]]
    else:
        out["kPlusReach"] = []

    if "percent_k_plus_reach" in ms:
        out["percentKPlusReach"] = [float(v) for v in ms["percent_k_plus_reach"]]
    else:
        out["percentKPlusReach"] = []

    return out


def _component_summary(pub: dict, mc: str) -> dict:
    """One reportingUnitComponentSummary entry with eventGroupSummaries."""
    eg_id = pub.get("event_group") or pub["key"].split("/")[-1]
    return {
        "component": pub["key"],
        "displayName": pub["name"],
        "eventGroupSummaries": [
            {"eventGroup": f"{mc}/eventGroups/{eg_id}"},
        ],
    }


def _filter_block() -> dict:
    """Cross-publisher reports use the `custom` filter shape (a list per
    media type) rather than a single impressionQualificationFilter string."""
    return {
        "custom": {
            "filterSpec": [
                {"mediaType": "OTHER", "filters": []},
                {"mediaType": "VIDEO", "filters": []},
            ]
        }
    }


def _dimension_spec(groupings: list = None) -> dict:
    """Build a dimensionSpecSummary in the real API shape.

    `groupings` is a list of (path, enum_value) tuples, e.g.
        [("common.sex", "MALE"), ("common.age_group", "YEARS_55_PLUS")]
    These render as:
        {"path": "common.sex", "value": {"enumValue": "MALE"}}
    matching the real BasicReport response (verified against
    xmm-auto-nutfp1iz-meta)."""
    out_groupings = []
    for path, enum_val in groupings or []:
        out_groupings.append({"path": path, "value": {"enumValue": enum_val}})
    return {"groupings": out_groupings, "filters": [{"terms": []}]}


# Standard 6-cell demographic grid: 2 (sex) × 3 (age) using real enum values
# observed in production reports.
_STANDARD_DEMOS = [
    ("Female", "16-34", [("common.sex", "FEMALE"), ("common.age_group", "YEARS_16_TO_34")]),
    ("Female", "35-54", [("common.sex", "FEMALE"), ("common.age_group", "YEARS_35_TO_54")]),
    ("Female", "55+",   [("common.sex", "FEMALE"), ("common.age_group", "YEARS_55_PLUS")]),
    ("Male",   "16-34", [("common.sex", "MALE"),   ("common.age_group", "YEARS_16_TO_34")]),
    ("Male",   "35-54", [("common.sex", "MALE"),   ("common.age_group", "YEARS_35_TO_54")]),
    ("Male",   "55+",   [("common.sex", "MALE"),   ("common.age_group", "YEARS_55_PLUS")]),
]


def _metric_frequency(weekly: bool) -> dict:
    return {"weekly": WEEKLY_DAY} if weekly else {"total": True}


def _result_group(
    *,
    title: str,
    publishers: list,
    population: int,
    cumulative: dict,
    components: list,
    stacked_incremental: list = None,
    intersections: list = None,
    weekly: bool = False,
    metric_start: date = None,
    metric_end: date = None,
    groupings: list = None,
    mc: str = MC,
) -> dict:
    """Emit one resultGroups entry."""
    metadata: dict = {
        "reportingUnitSummary": {
            "reportingUnitComponentSummary": [
                _component_summary(p, mc) for p in publishers
            ]
        },
    }

    # The real API sets the *other* start-time to the Unix epoch when the
    # frequency-specific one is in use; reproduce that pattern.
    if weekly:
        metadata["nonCumulativeMetricStartTime"] = _EPOCH_ISO
        metadata["cumulativeMetricStartTime"] = (
            _iso(metric_start) if metric_start else _EPOCH_ISO
        )
    else:
        metadata["nonCumulativeMetricStartTime"] = (
            _iso(metric_start) if metric_start else _EPOCH_ISO
        )
        metadata["cumulativeMetricStartTime"] = _EPOCH_ISO

    metadata["metricEndTime"] = _iso(metric_end) if metric_end else _EPOCH_ISO
    metadata["metricFrequency"] = _metric_frequency(weekly)
    metadata["dimensionSpecSummary"] = _dimension_spec(groupings)
    metadata["filter"] = _filter_block()

    # reportingUnit: for weekly RGs the API populates `cumulative`, for total
    # RGs it populates `nonCumulative` (the inverse field is null in either
    # case). The mock populates BOTH so the existing renderer — which reads
    # only reporting_unit_cumulative — keeps working as a test fixture.
    metric_set_block = _metric_set(cumulative)
    reporting_unit = {
        "cumulative": metric_set_block,
        "nonCumulative": dict(metric_set_block),
        "stackedIncrementalReach": [str(int(v)) for v in (stacked_incremental or [])],
    }

    comp_entries = []
    for comp in components:
        comp_block = _metric_set(comp["cumulative"]) if "cumulative" in comp else None
        unique_reach = comp.get("cumulative_unique_reach")
        unique_block = {"reach": str(int(unique_reach))} if unique_reach else None
        value = {
            "cumulative": comp_block,
            "nonCumulative": dict(comp_block) if comp_block else None,
            "cumulativeUnique": unique_block,
            "nonCumulativeUnique": dict(unique_block) if unique_block else None,
        }
        comp_entries.append({"key": comp["key"], "value": value})

    metric_set = {
        "populationSize": str(int(population)),
        "reportingUnit": reporting_unit,
        "components": comp_entries,
    }

    if intersections:
        metric_set["componentIntersections"] = [
            {
                "components": list(ci["component_keys"]),
                "cumulative": {"reach": str(int(ci["cumulative_reach"]))},
                "nonCumulative": {"reach": str(int(ci["cumulative_reach"]))},
            }
            for ci in intersections
        ]
    else:
        metric_set["componentIntersections"] = []

    return {
        "title": title,
        "results": [{"metadata": metadata, "metricSet": metric_set}],
    }


def _iqf_filterspec(media_type: str, term_path: str = None, term_value: str = None) -> dict:
    """Build one effectiveImpressionQualificationFilters entry as observed in
    real reports: a FilterSpec object, NOT {impressionQualificationFilter: name}."""
    filters = []
    if term_path and term_value:
        filters.append(
            {"terms": [{"path": term_path, "value": {"stringValue": term_value}}]}
        )
    return {"custom": {"filterSpec": [{"mediaType": media_type, "filters": filters}]}}


def _report_envelope(
    *,
    name: str,
    title: str,
    campaign_group: str,
    campaign_group_display_name: str,
    state: str,
    start: date,
    end: date,
    create_time: str = None,
    iqfs: list = None,
    result_groups: list = None,
) -> dict:
    iqfs = iqfs or []
    return {
        "name": name,
        "title": title,
        "campaignGroup": campaign_group,
        "campaignGroupDisplayName": campaign_group_display_name,
        "createTime": create_time
        or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
        "modelLine": "",
        "effectiveModelLine": "",
        "state": state,
        "reportingInterval": {
            "reportStart": _full_date(start),
            "effectiveReportStart": _full_date(start),
            "reportEnd": _short_date(end),
        },
        "impressionQualificationFilters": list(iqfs),
        "effectiveImpressionQualificationFilters": list(iqfs),
        "resultGroupSpecs": [],
        "resultGroups": result_groups or [],
    }


# ── Scenarios ────────────────────────────────────────────────────────────────


def scenario_1pub_tv() -> dict:
    """Single-publisher (Linear TV) report — exercises the no-intersection,
    empty-stackedIncrementalReach shape that real one-publisher reports
    produce."""
    start = date(2026, 3, 1)
    end = date(2026, 3, 28)
    pub = {"key": f"{DP_PREFIX}/mediacorp-tv", "name": "MediaCorp TV"}
    pop = 55_942_000

    primary_cumulative = {
        "reach": 32_971_000,
        "percent_reach": 0.589,
        "k_plus_reach": [
            32_971_000, 24_515_000, 19_352_000, 16_068_000, 13_713_000,
            11_965_000, 10_019_000,  8_776_000,  7_856_000,  7_127_000,
             6_443_000,  5_684_000,  5_116_000,  4_385_000,  3_697_000,
        ],
        "percent_k_plus_reach": [
            58.9, 43.8, 34.6, 28.7, 24.5, 21.4, 17.9, 15.7, 14.0, 12.7,
            11.5, 10.2, 9.1, 7.8, 6.6,
        ],
        "average_frequency": 6.40,
        "impressions": 211_014_400,
        "grps": 377.1,
    }

    components = [
        {
            "key": pub["key"],
            "cumulative": primary_cumulative,
            # cumulative_unique_reach intentionally omitted — single-pub
            # reports leave cumulativeUnique/nonCumulativeUnique as null.
        }
    ]

    rg = _result_group(
        title="Total Reach",
        publishers=[pub],
        population=pop,
        cumulative=primary_cumulative,
        components=components,
        stacked_incremental=[],   # 1-pub → no stacking
        intersections=[],         # 1-pub → no intersections
        metric_start=start,
        metric_end=end,
    )

    iqf = _iqf_filterspec("VIDEO", "video", "viewable_100_percent")
    return _report_envelope(
        name=f"{MC}/basicReports/example-1pub-tv",
        title="MediaCorp Always-On Linear TV — Mar 2026",
        campaign_group=f"{MC}/reportingSets/mediacorp-mar",
        campaign_group_display_name="MediaCorp Always-On Mar 2026",
        state="SUCCEEDED",
        start=start,
        end=end,
        iqfs=[iqf],
        result_groups=[rg],
    )


def scenario_2pub_rich() -> dict:
    start = date(2026, 1, 1)
    end = date(2026, 1, 28)
    pubs = [
        {"key": f"{DP_PREFIX}/mediacorp-tv", "name": "MediaCorp TV"},
        {"key": f"{DP_PREFIX}/videostream", "name": "VideoStream Platform"},
    ]
    pop = 55_942_000

    primary_cumulative = {
        "reach": 12_300_000,
        "percent_reach": 0.220,
        "k_plus_reach": [12_300_000, 8_000_000, 5_000_000, 3_000_000, 1_800_000, 1_000_000],
        "percent_k_plus_reach": [0.220, 0.143, 0.089, 0.054, 0.032, 0.018],
        "average_frequency": 2.11,
        "impressions": 25_990_000,
        "grps": 46.5,
    }

    components = [
        {
            "key": pubs[0]["key"],
            "cumulative": {
                "reach": 8_500_000,
                "percent_reach": 0.152,
                "average_frequency": 2.30,
                "impressions": 19_550_000,
                "grps": 35.0,
            },
            "cumulative_unique_reach": 5_200_000,
        },
        {
            "key": pubs[1]["key"],
            "cumulative": {
                "reach": 6_300_000,
                "percent_reach": 0.113,
                "average_frequency": 1.92,
                "impressions": 12_096_000,
                "grps": 21.6,
            },
            "cumulative_unique_reach": 3_800_000,
        },
    ]

    intersections = [
        {
            "component_keys": [pubs[0]["key"], pubs[1]["key"]],
            "cumulative_reach": 2_500_000,
        }
    ]

    rgs = []

    # Primary total result group (drives Campaign Overview, Cross-Media,
    # Reach vs Unique, Frequency, Summary)
    rgs.append(_result_group(
        title="Total Reach",
        publishers=pubs,
        population=pop,
        cumulative=primary_cumulative,
        components=components,
        stacked_incremental=[8_500_000, 3_800_000],  # sums to 12.3M net
        intersections=intersections,
        metric_start=start,
        metric_end=end,
    ))

    # Weekly result groups — 4 weeks cumulative
    weeks = [
        ("Week 1", 4_200_000, 4_200_000, 8_900_000),
        ("Week 2", 7_800_000, 4_100_000, 16_200_000),
        ("Week 3", 10_500_000, 3_300_000, 22_100_000),
        ("Week 4", 12_300_000, 2_400_000, 25_990_000),
    ]
    for i, (label, cum_reach, _wk_reach, cum_imp) in enumerate(weeks):
        wk_end = date(2026, 1, 7 * (i + 1))
        rgs.append(_result_group(
            title=f"Weekly ({label})",
            publishers=pubs,
            population=pop,
            cumulative={
                "reach": cum_reach,
                "percent_reach": round(cum_reach / pop, 4),
                "average_frequency": round(cum_imp / cum_reach, 2),
                "impressions": cum_imp,
            },
            components=[
                {"key": pubs[0]["key"],
                 "cumulative": {"reach": int(cum_reach * 0.69),
                                "impressions": int(cum_imp * 0.75)}},
                {"key": pubs[1]["key"],
                 "cumulative": {"reach": int(cum_reach * 0.51),
                                "impressions": int(cum_imp * 0.46)}},
            ],
            weekly=True,
            metric_start=start,
            metric_end=wk_end,
        ))

    # Demographic breakdown — 6 cells (sex × age). Real reports emit one
    # result group per cell with `dimensionSpecSummary.groupings` populated.
    # Population/reach shares are illustrative — chosen to sum near total.
    demo_share = [
        # (sex, age, pop_share, reach_share, freq)
        ("Female", "16-34", 0.18, 0.21, 1.95),
        ("Female", "35-54", 0.17, 0.20, 2.05),
        ("Female", "55+",   0.15, 0.14, 2.20),
        ("Male",   "16-34", 0.18, 0.19, 1.92),
        ("Male",   "35-54", 0.17, 0.16, 2.18),
        ("Male",   "55+",   0.15, 0.10, 2.35),
    ]
    for (sex_label, age_label, pop_share, reach_share, freq), (_, _, groupings) in zip(
        demo_share, _STANDARD_DEMOS
    ):
        cell_pop = int(pop * pop_share)
        cell_reach = int(primary_cumulative["reach"] * reach_share)
        cell_imp = int(cell_reach * freq)
        rgs.append(_result_group(
            title="Total Reach",
            publishers=pubs,
            population=cell_pop,
            cumulative={
                "reach": cell_reach,
                "percent_reach": round(cell_reach / cell_pop, 4) if cell_pop else 0,
                "average_frequency": freq,
                "impressions": cell_imp,
            },
            components=[
                {"key": pubs[0]["key"],
                 "cumulative": {"reach": int(cell_reach * 0.69),
                                "impressions": int(cell_imp * 0.75)}},
                {"key": pubs[1]["key"],
                 "cumulative": {"reach": int(cell_reach * 0.51),
                                "impressions": int(cell_imp * 0.46)}},
            ],
            groupings=groupings,
            metric_start=start,
            metric_end=end,
        ))

    return _report_envelope(
        name=f"{MC}/basicReports/example-rich",
        title="FreshBrew Coffee Q1 Launch",
        campaign_group=f"{MC}/reportingSets/freshbrew-q1",
        campaign_group_display_name="FreshBrew Coffee Q1 2026",
        state="SUCCEEDED",
        start=start,
        end=end,
        result_groups=rgs,
    )


def scenario_5pub_overflow() -> dict:
    start = date(2026, 2, 1)
    end = date(2026, 2, 28)
    pubs = [
        {"key": f"{DP_PREFIX}/mediacorp-tv",   "name": "MediaCorp TV"},
        {"key": f"{DP_PREFIX}/videostream",    "name": "VideoStream Platform"},
        {"key": f"{DP_PREFIX}/socialbuzz",     "name": "SocialBuzz Network"},
        {"key": f"{DP_PREFIX}/streammax",      "name": "StreamMax Audio"},
        {"key": f"{DP_PREFIX}/audiocast",      "name": "AudioCast Radio"},
    ]
    pop = 62_400_000

    primary_cumulative = {
        "reach": 18_900_000,
        "percent_reach": 0.303,
        "k_plus_reach": [18_900_000, 12_400_000, 8_100_000, 5_200_000, 3_300_000],
        "percent_k_plus_reach": [0.303, 0.199, 0.130, 0.083, 0.053],
        "average_frequency": 2.45,
        "impressions": 46_305_000,
        "grps": 74.2,
    }

    pub_data = [
        (8_500_000, 19_550_000, 4_100_000),
        (6_300_000, 12_096_000, 3_200_000),
        (4_800_000,  9_120_000, 2_700_000),
        (3_100_000,  3_565_000, 1_800_000),
        (2_400_000,  1_974_000, 1_500_000),
    ]
    components = []
    for i, p in enumerate(pubs):
        reach, impressions, unique = pub_data[i]
        components.append({
            "key": p["key"],
            "cumulative": {
                "reach": reach,
                "percent_reach": round(reach / pop, 4),
                "average_frequency": round(impressions / reach, 2),
                "impressions": impressions,
            },
            "cumulative_unique_reach": unique,
        })

    intersections = [
        {"component_keys": [pubs[0]["key"], pubs[1]["key"]], "cumulative_reach": 2_500_000},
        {"component_keys": [pubs[0]["key"], pubs[2]["key"]], "cumulative_reach": 1_900_000},
        {"component_keys": [pubs[1]["key"], pubs[2]["key"]], "cumulative_reach": 1_500_000},
    ]

    rg = _result_group(
        title="Total Reach",
        publishers=pubs,
        population=pop,
        cumulative=primary_cumulative,
        components=components,
        stacked_incremental=[8_500_000, 4_300_000, 3_100_000, 1_800_000, 1_200_000],
        intersections=intersections,
        metric_start=start,
        metric_end=end,
    )

    return _report_envelope(
        name=f"{MC}/basicReports/example-overflow",
        title="OmniReach Multi-Platform Campaign",
        campaign_group=f"{MC}/reportingSets/omnireach-feb",
        campaign_group_display_name="OmniReach February 2026",
        state="SUCCEEDED",
        start=start,
        end=end,
        result_groups=[rg],
    )


def scenario_failed() -> dict:
    start = date(2026, 4, 1)
    end = date(2026, 4, 30)
    return _report_envelope(
        name=f"{MC}/basicReports/example-failed",
        title="Q2 Brand Awareness — Diagnostic",
        campaign_group=f"{MC}/reportingSets/q2-brand",
        campaign_group_display_name="Q2 Brand Awareness 2026",
        state="FAILED",
        start=start,
        end=end,
    )


SCENARIOS = {
    "1pub_tv":       scenario_1pub_tv,
    "2pub_rich":     scenario_2pub_rich,
    "5pub_overflow": scenario_5pub_overflow,
    "failed":        scenario_failed,
}


def build(name: str) -> str:
    out_path = os.path.join(_HERE, f"{name}.json")
    body = SCENARIOS[name]()
    with open(out_path, "w") as f:
        json.dump(body, f, indent=2)
        f.write("\n")
    return out_path


def main():
    targets = sys.argv[1:] or ["all"]
    if targets == ["all"]:
        targets = list(SCENARIOS)
    for name in targets:
        if name not in SCENARIOS:
            print(f"Unknown scenario: {name}", file=sys.stderr)
            sys.exit(1)
        path = build(name)
        print(f"Wrote {path}")


if __name__ == "__main__":
    main()
