#!/usr/bin/env python3

"""End-to-end grouping eval for build_grouping.py.

Runs the reference implementation over a small synthetic fixture (placeholder
advertisers/brands only — no real data) and asserts metric-level properties that
each exercise a distinct algorithm path:

  * multi-brand advertiser   → discriminative TF-IDF yields one group per brand
  * single-brand-line adv.   → brand-defining fallback collapses to one group
  * pure-code campaign name   → routed to flags_unrecognized (no catch_all)
  * per-advertiser catch_all  → absorbs the otherwise-unrecognized campaign
  * TV partial name overlap   → flags_tv_lowconf (not auto-merged)
  * TV no overlap             → kept as a TV-only L1 row
  * contradictory targeting   → flags_anomalies

Asserts metric properties (group counts, flag counts, membership), NOT exact
labels, so harmless scoring tweaks don't trip it while real regressions do.

Exit code 0 if all checks pass, 1 otherwise. Stdlib only.
"""

from __future__ import annotations

import csv
import os
import subprocess
import sys
import tempfile
from collections import defaultdict

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(SCRIPT_DIR, "build_grouping.py")
FIXTURES = os.path.join(SCRIPT_DIR, "eval_fixtures")
META = os.path.join(FIXTURES, "meta.csv")
TV = os.path.join(FIXTURES, "tv.csv")
CONFIGS = os.path.join(FIXTURES, "configs")


def run(out_dir: str, config: bool) -> None:
    cmd = [
        sys.executable,
        BUILD,
        "--meta-csv",
        META,
        "--tv-csv",
        TV,
        "--out-dir",
        out_dir,
        "--log-level",
        "ERROR",
    ]
    if config:
        cmd += ["--config-dir", CONFIGS]
    subprocess.run(cmd, check=True)


def load_groups(out_dir: str) -> dict[str, set[str]]:
    g: dict[str, set[str]] = defaultdict(set)
    with open(os.path.join(out_dir, "groupings.csv"), newline="") as f:
        for r in csv.DictReader(f):
            g[r["advertiser_name"]].add(r["group_name"])
    return g


def tv_only_advertisers(out_dir: str) -> set[str]:
    out: set[str] = set()
    with open(os.path.join(out_dir, "groupings.csv"), newline="") as f:
        for r in csv.DictReader(f):
            if not r["mc_id"] and r["measured_entity"] != "Meta":
                out.add(r["advertiser_name"])
    return out


def count(out_dir: str, name: str) -> int:
    with open(os.path.join(out_dir, name), newline="") as f:
        return sum(1 for _ in csv.DictReader(f))


def col_values(out_dir: str, name: str, col: str) -> set[str]:
    with open(os.path.join(out_dir, name), newline="") as f:
        return {r[col] for r in csv.DictReader(f)}


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        nocfg = os.path.join(tmp, "nocfg")
        cfg = os.path.join(tmp, "cfg")
        os.makedirs(nocfg)
        os.makedirs(cfg)
        run(nocfg, config=False)
        run(cfg, config=True)

        g = load_groups(nocfg)
        gc = load_groups(cfg)
        tv_only = tv_only_advertisers(nocfg)

        # canonical-label merge: the Meta-side AI label adopts the multi-word TV
        # brand (`Widget Alpha`) so Meta + TV land in ONE group (regression for the
        # single-token-label fragmentation, issue #16). Acme's TV row uses
        # `Brand parts[1] = "Widget Alpha"`; Meta's discriminative token is `alpha`.
        acme_groups: dict[str, set[str]] = defaultdict(set)
        with open(os.path.join(nocfg, "groupings.csv"), newline="") as f:
            for r in csv.DictReader(f):
                if r["advertiser_name"] == "Acme Corporation":
                    acme_groups[r["group_name"]].add(r["measured_entity"])
        merged_ok = {"Meta", "ExamplePanel"} <= acme_groups.get("Widget Alpha", set())

        checks: list[tuple[str, bool]] = [
            # multi-brand: one group per brand (discriminative TF-IDF)
            ("Acme (multi-brand) → exactly 3 groups", len(g.get("Acme Corporation", set())) == 3),
            # canonical-label merge (issue #16): Meta label adopts the multi-word
            # TV brand, so "Widget Alpha" holds both Meta and TV rows
            ("Meta AI label merges with multi-word TV brand (Widget Alpha = Meta+TV)", merged_ok),
            # single-brand-line: brand-defining fallback collapses to one group
            ("Globex Holdings (single-brand) → exactly 1 group", len(g.get("Globex Holdings", set())) == 1),
            # pure-code campaign → unrecognized (no catch_all)
            ("no-config → exactly 1 unrecognized", count(nocfg, "flags_unrecognized.csv") == 1),
            ("Initech has an (unrecognized) bucket", "(unrecognized)" in g.get("Initech Inc", set())),
            # per-advertiser catch_all absorbs it
            ("with catch_all config → 0 unrecognized", count(cfg, "flags_unrecognized.csv") == 0),
            ("with config → Initech keeps a real group, no (unrecognized)", "Initech" in gc and bool(gc["Initech"]) and "(unrecognized)" not in gc["Initech"]),
            # TV reconciliation tiers
            ("TV partial overlap → exactly 1 tv_lowconf", count(nocfg, "flags_tv_lowconf.csv") == 1),
            ("tv_lowconf names the partial-overlap advertiser",
             "Globex International Foods" in col_values(nocfg, "flags_tv_lowconf.csv", "tv_advertiser_name")),
            ("TV no-overlap advertiser kept as TV-only L1", "Umbrella Beverages" in tv_only),
            # anomalies
            ("contradictory age → exactly 1 anomaly", count(nocfg, "flags_anomalies.csv") == 1),
            # overall shape
            ("5 distinct L1 advertisers", len(g) == 5),
        ]

        width = max(len(d) for d, _ in checks)
        passed = 0
        print("\n=== campaign-grouping eval ===")
        for desc, ok in checks:
            print(f"  [{'PASS' if ok else 'FAIL'}] {desc.ljust(width)}")
            passed += ok
        total = len(checks)
        print(f"\n{passed}/{total} checks passed")
        return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
