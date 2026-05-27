#!/usr/bin/env python3
"""Generate an HTML report from a Halo API JSON BasicReport using the report template.

Usage:
    python3 generate_html_report.py <json_path> [output.html]
"""

import json
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
from generate_presentation import parse_report

TEMPLATE = os.path.join(_HERE, "report_template.html")
PUB_COLORS = ["#3B82F6", "#14B8A6", "#8B5CF6", "#F59E0B"]


def build_data_contract(proto_path):
    r = parse_report(proto_path)

    primary = None
    # Prefer a total-frequency result group with components
    for rg in r.result_groups:
        if (
            not rg.dimension_groupings
            and rg.metric_frequency == "total"
            and rg.components
        ):
            if rg.reporting_unit_cumulative and rg.reporting_unit_cumulative.reach > 0:
                primary = rg
                break
    # Fallback: pick the weekly group with the highest cumulative reach
    if not primary:
        best_reach = 0
        for rg in r.result_groups:
            if not rg.dimension_groupings and rg.components:
                cum = rg.reporting_unit_cumulative
                if cum and cum.reach > best_reach:
                    best_reach = cum.reach
                    primary = rg
    if not primary and r.result_groups:
        primary = r.result_groups[0]
    if not primary:
        return {}

    cum = primary.reporting_unit_cumulative
    pop = primary.population_size
    comps = primary.components

    # Publisher reach data — generalized for N publishers
    pub_reach = {}
    if len(comps) >= 2:
        c0, c1 = comps[0], comps[1]
        r0 = c0.cumulative.reach if c0.cumulative else 0
        r1 = c1.cumulative.reach if c1.cumulative else 0
        u0 = c0.cumulative_unique_reach
        u1 = c1.cumulative_unique_reach

        # For 3+ publishers, combine publishers 1..N into "other" for Venn
        if len(comps) > 2:
            combined_reach = cum.reach - u0 if cum else r1
            combined_unique = cum.reach - r0 if cum else u1
            for c in comps[2:]:
                pass  # already accounted in net reach
            r1 = combined_reach
            u1 = combined_unique

        pub_reach = {
            "meta_total_reach": r0,
            "tv_total_reach": r1,
            "meta_unique_reach": u0,
            "tv_unique_reach": u1,
            "meta_unique_reach_pct": round(u0 / r0 * 100, 1) if r0 else 0,
            "tv_unique_reach_pct": round(u1 / r1 * 100, 1) if r1 else 0,
            "pub1_name": c0.display_name,
            "pub2_name": (
                "Others (" + str(len(comps) - 1) + ")"
                if len(comps) > 2
                else c1.display_name
            ),
        }

    # Frequency curve
    freq_curve = []
    if cum and cum.k_plus_reach:
        for i, kr in enumerate(cum.k_plus_reach):
            if kr == 0 and i > 0:
                continue
            freq_curve.append(
                {
                    "freq": f"{i + 1}+",
                    "reach": kr,
                    "reach_pct": round(kr / pop * 100, 2) if pop else 0,
                }
            )

    # Publisher details for table
    pub_details = []
    for i, c in enumerate(comps):
        cr = c.cumulative.reach if c.cumulative else 0
        pub_details.append(
            {
                "name": c.display_name,
                "color": PUB_COLORS[i % len(PUB_COLORS)],
                "reach": cr,
                "percent_reach": round(cr / pop * 100, 1) if pop else 0,
                "impressions": c.cumulative.impressions if c.cumulative else 0,
                "avg_frequency": (
                    round(c.cumulative.average_frequency, 2) if c.cumulative else 0
                ),
                "unique_reach": c.cumulative_unique_reach,
            }
        )

    # Stacked incremental — compute from components if not provided
    stacked = primary.stacked_incremental_reach or []
    if not stacked and comps and cum and cum.reach > 0:
        sorted_comps = sorted(
            comps, key=lambda c: c.cumulative.reach if c.cumulative else 0, reverse=True
        )
        remaining = cum.reach
        for c in sorted_comps:
            cr = c.cumulative.reach if c.cumulative else 0
            incr = min(cr, remaining)
            stacked.append(incr)
            remaining -= incr
            if remaining <= 0:
                remaining = 0

    # Intersections
    intersections = []
    for ci in primary.component_intersections:
        names = [r.publisher_names.get(k, k.split("/")[-1]) for k in ci.component_keys]
        intersections.append({"publishers": names, "reach": ci.cumulative_reach})

    iq_labels = []
    for f in r.iq_filters:
        if "mrc" in f.lower():
            iq_labels.append("MRC")
        elif "ami" in f.lower():
            iq_labels.append("AMI")

    data = {
        "meta": {
            "entity": r.campaign_group_display_name or r.title,
            "brand": r.campaign_group_display_name,
            "date_range": f"{r.start_date} to {r.end_date}" if r.start_date else "",
            "duration": f"{r.duration_days} days",
            "universe": pop,
            "report_name": r.title,
            "iq_filters": iq_labels,
            "publishers": [c.display_name for c in comps],
        },
        "kpis": {
            "total_impressions": cum.impressions if cum else 0,
            "net_reach": cum.reach if cum else 0,
            "avg_frequency": cum.average_frequency if cum else 0,
            "total_spend": None,
            "cpm": None,
            "cost_per_1k_reach": None,
            "gross_reach": sum(c.cumulative.reach for c in comps if c.cumulative),
            "grps": cum.grps if cum else 0,
            "percent_reach": round(cum.reach / pop * 100, 1) if cum and pop else 0,
        },
        "publisher_reach": pub_reach,
        "freq_curve": freq_curve,
        "daily": [],
        "campaign_metadata": [],
        "publisher_details": pub_details,
        "stacked_incremental": stacked,
        "intersections": intersections,
        "weekly": _extract_weekly(r, pop),
        "pitfalls": [],
    }
    return data


def _extract_weekly(r, pop):
    weekly_rgs = [
        rg
        for rg in r.result_groups
        if rg.metric_frequency == "weekly" and not rg.dimension_groupings
    ]
    if weekly_rgs:
        max_pop = max(rg.population_size for rg in weekly_rgs)
        weekly_rgs = [rg for rg in weekly_rgs if rg.population_size == max_pop]
        weekly_rgs.sort(key=lambda rg: rg.metric_end_time)
    weeks = []
    prev_reach = 0
    prev_imps = 0
    prev_pub_reach = {}
    prev_pub_imps = {}
    week_num = 0
    for rg in weekly_rgs:
        week_num += 1
        nc = rg.reporting_unit_non_cumulative
        cum = rg.reporting_unit_cumulative
        reach_cum = cum.reach if cum else 0
        imps_cum = cum.impressions if cum else 0

        if nc:
            reach_nc = nc.reach
            imps_nc = nc.impressions
            freq_nc = nc.average_frequency
        else:
            reach_nc = max(0, reach_cum - prev_reach)
            imps_nc = max(0, imps_cum - prev_imps)
            freq_nc = cum.average_frequency if cum else 0

        pub_data = []
        for c in rg.components:
            cn = c.non_cumulative
            cc = c.cumulative
            if cn:
                pub_data.append(
                    {
                        "name": c.display_name,
                        "reach": cn.reach,
                        "impressions": cn.impressions,
                        "frequency": cn.average_frequency,
                    }
                )
            elif cc:
                pr = max(0, cc.reach - prev_pub_reach.get(c.key, 0))
                pi = max(0, cc.impressions - prev_pub_imps.get(c.key, 0))
                pub_data.append(
                    {
                        "name": c.display_name,
                        "reach": pr,
                        "impressions": pi,
                        "frequency": cc.average_frequency,
                    }
                )
            else:
                pub_data.append(
                    {
                        "name": c.display_name,
                        "reach": 0,
                        "impressions": 0,
                        "frequency": 0,
                    }
                )

        weeks.append(
            {
                "week": week_num,
                "title": rg.title,
                "reach": reach_nc,
                "impressions": imps_nc,
                "frequency": freq_nc,
                "cumulative_reach": reach_cum,
                "cumulative_impressions": imps_cum,
                "publishers": pub_data,
            }
        )

        prev_reach = reach_cum
        prev_imps = imps_cum
        for c in rg.components:
            cc = c.cumulative
            if cc:
                prev_pub_reach[c.key] = cc.reach
                prev_pub_imps[c.key] = cc.impressions
    return weeks


def generate_html(proto_path, output_path=None, pitfalls=None):
    if output_path is None:
        base = os.path.splitext(os.path.basename(proto_path))[0]
        output_path = os.path.join(os.path.dirname(proto_path), f"{base}.html")

    with open(TEMPLATE) as f:
        html = f.read()

    data = build_data_contract(proto_path)
    if not data or "meta" not in data:
        print(f"Skipped (no result data): {proto_path}")
        return None
    if pitfalls:
        if isinstance(pitfalls, dict):
            data["pitfalls"] = pitfalls.get("pitfalls", [])
            data["graph_annotations"] = pitfalls.get("graph_annotations", {})
            data["custom_graphs"] = pitfalls.get("custom_graphs", [])
        elif isinstance(pitfalls, list):
            data["pitfalls"] = pitfalls
    data_json = json.dumps(data)

    html = html.replace("{{DATA_CONTRACT}}", data_json)
    html = html.replace("{{ENTITY}}", data["meta"]["entity"])
    html = html.replace("{{BRAND}}", data["meta"]["brand"])

    with open(output_path, "w") as f:
        f.write(html)

    print(f"Generated: {output_path}")
    print(f"  Report: {data['meta']['report_name']}")
    print(f"  Publishers: {', '.join(data['meta']['publishers'])}")
    return output_path


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <json_path> [output.html]")
        sys.exit(1)
    proto = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else None
    generate_html(proto, out)
