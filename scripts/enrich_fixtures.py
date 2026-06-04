#!/usr/bin/env python3
"""Enrich JSON fixtures with missing structural data.

Reads each numbered JSON fixture, identifies missing fields (stackedIncrementalReach,
componentIntersections, kPlusReach, cumulativeUnique, components), and generates
plausible values that are internally consistent with existing data.

Uses the same plausibility rules as xmm-report-generator:
  - k_plus_reach[0] == reach
  - k_plus_reach monotonically non-increasing (geometric decay from avg_frequency)
  - sum(stacked_incremental_reach) == net reach
  - component_intersections: pairwise overlaps consistent with gross - net reach
  - cumulative_unique: unique reach per publisher <= component reach
  - impressions ~ reach * average_frequency (within 5%)

Output: overwrites fixtures in-place. Run git diff to review changes.
"""

import json
import math
import os
import sys

FIXTURES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..",
                            "plugins", "halo-mcp", "test", "fixtures")


def geometric_kplus(reach, avg_freq, n_buckets=7):
    """Generate a plausible k+ reach curve using geometric decay."""
    if reach <= 0 or avg_freq <= 0:
        return [str(reach)] * n_buckets

    decay = min(0.85, max(0.3, 1.0 / (avg_freq ** 0.55)))

    kplus = []
    v = float(reach)
    for i in range(n_buckets):
        kplus.append(str(int(round(v))))
        v *= decay
        if v < 1:
            v = 0

    return kplus


def generate_stacked_incremental(net_reach, components, publisher_keys):
    """Generate stacked incremental reach that sums to net_reach."""
    if not components or net_reach <= 0:
        return []

    reaches = []
    for key in publisher_keys:
        comp = next((c for c in components if c.get("key") == key), None)
        if comp:
            cum = comp.get("value", {}).get("cumulative", {})
            r = int(cum.get("reach", "0"))
            reaches.append(r)
        else:
            reaches.append(0)

    total_component_reach = sum(reaches) or 1

    incremental = []
    remaining = net_reach
    for i, r in enumerate(reaches):
        if i == 0:
            share = min(remaining, int(net_reach * r / total_component_reach * 1.2))
        elif i == len(reaches) - 1:
            share = remaining
        else:
            share = int(remaining * r / max(sum(reaches[i:]), 1))
        share = max(0, min(remaining, share))
        incremental.append(str(share))
        remaining -= share

    if remaining != 0:
        incremental[-1] = str(int(incremental[-1]) + remaining)

    return incremental


def generate_intersections(components, net_reach, publisher_keys):
    """Generate pairwise component intersections."""
    if len(components) < 2:
        return []

    reaches = {}
    for c in components:
        key = c.get("key", "")
        cum = c.get("value", {}).get("cumulative", {})
        reaches[key] = int(cum.get("reach", "0"))

    gross = sum(reaches.values())
    total_overlap = max(0, gross - net_reach)

    pairs = []
    total_weight = 0
    for i, k1 in enumerate(publisher_keys):
        for k2 in publisher_keys[i+1:]:
            if k1 in reaches and k2 in reaches:
                w = reaches[k1] * reaches[k2]
                pairs.append((k1, k2, w))
                total_weight += w

    intersections = []
    remaining = total_overlap
    for idx, (k1, k2, w) in enumerate(pairs):
        if idx == len(pairs) - 1:
            overlap = remaining
        else:
            overlap = int(total_overlap * w / max(total_weight, 1))
        max_overlap = min(reaches.get(k1, 0), reaches.get(k2, 0))
        overlap = min(overlap, max_overlap)
        overlap = max(0, min(remaining, overlap))
        intersections.append({
            "components": [k1, k2],
            "cumulative": {"reach": str(overlap)}
        })
        remaining -= overlap

    return intersections


def generate_unique_reach(components, net_reach, intersections):
    """Generate cumulativeUnique reach for each component."""
    if not components:
        return

    overlap_by_pub = {}
    for isect in intersections:
        overlap = int(isect.get("cumulative", {}).get("reach", "0"))
        for pub in isect.get("components", []):
            overlap_by_pub[pub] = overlap_by_pub.get(pub, 0) + overlap

    for comp in components:
        key = comp.get("key", "")
        cum = comp.get("value", {}).get("cumulative", {})
        reach = int(cum.get("reach", "0"))
        overlap = overlap_by_pub.get(key, 0)
        unique = max(0, reach - overlap)
        comp["value"]["cumulativeUnique"] = {"reach": str(unique)}


def generate_components_from_total(total_reach, total_impressions, avg_freq,
                                   population_size, n_pubs, pub_defs):
    """Generate publisher components when none exist."""
    if n_pubs <= 0 or total_reach <= 0:
        return []

    if n_pubs == 1:
        weights = [1.0]
    elif n_pubs == 2:
        weights = [0.6, 0.4]
    else:
        weights = [0.45, 0.30, 0.25]

    components = []
    for i in range(min(n_pubs, len(pub_defs))):
        key, display_name = pub_defs[i]
        w = weights[i] if i < len(weights) else weights[-1]

        gross_multiplier = 1.3
        pub_reach = int(total_reach * gross_multiplier * w)
        pub_reach = min(pub_reach, population_size)

        freq_mult = [1.0, 1.3, 0.8] if n_pubs >= 3 else [1.0, 1.2]
        pub_freq = avg_freq * (freq_mult[i] if i < len(freq_mult) else 1.0)
        pub_impressions = int(pub_reach * pub_freq)

        pub_percent_reach = pub_reach / population_size if population_size > 0 else 0

        components.append({
            "key": key,
            "value": {
                "cumulative": {
                    "reach": str(pub_reach),
                    "percentReach": round(pub_percent_reach, 6),
                    "averageFrequency": round(pub_freq, 2),
                    "impressions": str(pub_impressions)
                }
            }
        })

    return components


def is_demographic_result(res):
    """Check if a result is a demographic cell."""
    dim = res.get("metadata", {}).get("dimensionSpecSummary", {})
    has_grouping = any(
        g.get("value", {}).get("enumValue") or g.get("value", {}).get("stringValue")
        for g in (dim.get("groupings") or [])
    )
    has_filter = any(fl.get("value") for fl in (dim.get("filters") or []))
    return has_grouping or has_filter


def find_total_result(report):
    """Find the total-level result in a report (non-weekly, non-demographic).

    If the total result has no reach data but demographic cells do, synthesize
    a total from the demographics.
    """
    total_res = None
    for rg in report.get("resultGroups", []):
        for res in rg.get("results", []):
            meta = res.get("metadata", {})
            mf = meta.get("metricFrequency", {})
            is_weekly = mf.get("weekly") is not None
            is_demo = is_demographic_result(res)
            if not is_weekly and not is_demo:
                ms = res.get("metricSet", {})
                comps = ms.get("components", [])
                if not total_res or len(comps) > len(total_res.get("metricSet", {}).get("components", [])):
                    total_res = res

    # If the total result has no reach, compute from demographics
    if total_res:
        ms = total_res.get("metricSet", {})
        ru = ms.get("reportingUnit", {})
        cum = ru.get("cumulative") or ru.get("nonCumulative") or {}
        net_reach = int(cum.get("reach", "0"))

        if net_reach == 0:
            # Sum demographic cell reaches to estimate total
            demo_reach_sum = 0
            demo_imp_sum = 0
            demo_pop = 0
            for rg in report.get("resultGroups", []):
                for res in rg.get("results", []):
                    if is_demographic_result(res):
                        dms = res.get("metricSet", {})
                        dru = dms.get("reportingUnit", {})
                        dcum = dru.get("cumulative") or dru.get("nonCumulative") or {}
                        demo_reach_sum += int(dcum.get("reach", "0"))
                        demo_imp_sum += int(dcum.get("impressions", "0"))
                        demo_pop += int(dms.get("populationSize", "0"))

            if demo_reach_sum > 0:
                avg_freq = demo_imp_sum / demo_reach_sum if demo_reach_sum > 0 else 0
                pop = demo_pop if demo_pop > 0 else int(ms.get("populationSize", "0"))
                pct = demo_reach_sum / pop if pop > 0 else 0

                # Ensure reportingUnit and cumulative exist on the actual metricSet
                if "reportingUnit" not in ms:
                    ms["reportingUnit"] = {}
                if "cumulative" not in ms["reportingUnit"]:
                    ms["reportingUnit"]["cumulative"] = {}

                target = ms["reportingUnit"]["cumulative"]
                target["reach"] = str(demo_reach_sum)
                target["impressions"] = str(demo_imp_sum)
                target["averageFrequency"] = round(avg_freq, 2)
                target["percentReach"] = round(pct, 6)
                if pop > 0:
                    ms["populationSize"] = str(pop)

    return total_res


def get_publisher_keys(report, total_res):
    """Extract publisher keys from metadata or resultGroupSpecs."""
    pub_summary = total_res.get("metadata", {}).get("reportingUnitSummary", {})
    pub_components = pub_summary.get("reportingUnitComponentSummary", [])
    keys = []
    for pc in pub_components:
        dp = pc.get("dataProvider") or pc.get("component", "")
        if dp:
            keys.append(dp)

    if not keys:
        comps = total_res.get("metricSet", {}).get("components", [])
        keys = [c.get("key", "") for c in comps if c.get("key")]

    if not keys:
        for rgs_spec in report.get("resultGroupSpecs", []):
            ru_spec = rgs_spec.get("reportingUnit", {})
            spec_comps = ru_spec.get("components", [])
            if spec_comps and len(spec_comps) > len(keys):
                keys = list(spec_comps)

    return keys


def enrich_fixture(filepath):
    """Enrich a single fixture with missing data. Returns True if modified."""
    with open(filepath) as f:
        report = json.load(f)

    if report.get("state") != "SUCCEEDED":
        return False

    total_res = find_total_result(report)
    if not total_res:
        return False

    modified = False
    ms = total_res["metricSet"]
    ru = ms.get("reportingUnit", {})
    cum = ru.get("cumulative") or ru.get("nonCumulative") or {}

    net_reach = int(cum.get("reach", "0"))
    avg_freq = float(cum.get("averageFrequency", 0))
    impressions = int(cum.get("impressions", "0"))
    population_size = int(ms.get("populationSize", "0"))

    comps = ms.get("components", [])
    publisher_keys = get_publisher_keys(report, total_res)
    n_pubs = len(publisher_keys)

    # Single publisher path
    if n_pubs < 2 and len(comps) < 2:
        if not cum.get("kPlusReach") and net_reach > 0 and avg_freq > 0:
            cum["kPlusReach"] = geometric_kplus(net_reach, avg_freq)
            if "cumulative" in ru:
                ru["cumulative"] = cum
            elif "nonCumulative" in ru:
                ru["nonCumulative"] = cum
            modified = True

        if comps and not comps[0].get("value", {}).get("cumulativeUnique"):
            comp_reach = int(comps[0].get("value", {}).get("cumulative", {}).get("reach", "0"))
            comps[0]["value"]["cumulativeUnique"] = {"reach": str(comp_reach)}
            modified = True

        if modified:
            with open(filepath, "w") as f:
                json.dump(report, f, indent=2, ensure_ascii=False)
                f.write("\n")

        return modified

    # Multi-publisher: generate components if missing
    if not comps and n_pubs >= 2:
        pub_defs = []
        for key in publisher_keys:
            name = key.replace("dataProviders/", "").replace("_", " ").title()
            pub_defs.append((key, name))

        comps = generate_components_from_total(
            net_reach, impressions, avg_freq, population_size, n_pubs, pub_defs
        )
        ms["components"] = comps

        pub_summary = total_res.get("metadata", {}).get("reportingUnitSummary", {})
        if not pub_summary.get("reportingUnitComponentSummary"):
            total_res.setdefault("metadata", {}).setdefault(
                "reportingUnitSummary", {}
            )["reportingUnitComponentSummary"] = [
                {"dataProvider": key, "displayName": name}
                for key, name in pub_defs
            ]

        modified = True

    # Add kPlusReach if missing
    if not cum.get("kPlusReach") and net_reach > 0 and avg_freq > 0:
        cum["kPlusReach"] = geometric_kplus(net_reach, avg_freq)
        if "cumulative" in ru:
            ru["cumulative"] = cum
        elif "nonCumulative" in ru:
            ru["nonCumulative"] = cum
        modified = True

    # Add stackedIncrementalReach if missing
    if not ru.get("stackedIncrementalReach") and len(comps) >= 2:
        comp_keys = [c.get("key", "") for c in comps]
        stacked = generate_stacked_incremental(net_reach, comps, comp_keys)
        ru["stackedIncrementalReach"] = stacked
        modified = True

    # Add componentIntersections if missing
    if not ms.get("componentIntersections") and len(comps) >= 2:
        comp_keys = [c.get("key", "") for c in comps]
        intersections = generate_intersections(comps, net_reach, comp_keys)
        ms["componentIntersections"] = intersections
        modified = True

    # Add cumulativeUnique if missing
    has_unique = all(c.get("value", {}).get("cumulativeUnique") for c in comps)
    if not has_unique and comps:
        intersections = ms.get("componentIntersections", [])
        generate_unique_reach(comps, net_reach, intersections)
        modified = True

    if modified:
        with open(filepath, "w") as f:
            json.dump(report, f, indent=2, ensure_ascii=False)
            f.write("\n")

    return modified


def main():
    fixtures_dir = FIXTURES_DIR
    if not os.path.isdir(fixtures_dir):
        print(f"error: {fixtures_dir} does not exist", file=sys.stderr)
        return 1

    enriched = []
    for fname in sorted(os.listdir(fixtures_dir)):
        if not fname.endswith(".json"):
            continue
        filepath = os.path.join(fixtures_dir, fname)
        if enrich_fixture(filepath):
            enriched.append(fname)
            print(f"  enriched: {fname}")
        else:
            print(f"  ok:       {fname}")

    print(f"\n{len(enriched)} fixture(s) enriched.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
