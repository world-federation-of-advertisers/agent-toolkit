#!/usr/bin/env python3
"""Unit tests for build_grouping.py.

Standalone — uses only the stdlib `unittest`. Run with:

    cd plugins/halo-mcp/skills/campaign-grouping-meta-tv/scripts
    python3 -m unittest test_build_grouping -v

or simply `python3 test_build_grouping.py`.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import build_grouping as bg


class NormalizeTest(unittest.TestCase):
    def test_none_and_empty(self) -> None:
        self.assertEqual(bg.normalize(None), "")
        self.assertEqual(bg.normalize(""), "")

    def test_accent_and_case_fold(self) -> None:
        self.assertEqual(bg.normalize("Café"), "cafe")
        self.assertEqual(bg.normalize("Éxample's"), "example's")

    def test_apostrophe_variants_fold_together(self) -> None:
        # curly U+2019, backtick, acute all fold to straight apostrophe
        self.assertEqual(bg.normalize("Brand’s"), "brand's")
        self.assertEqual(bg.normalize("Brand´s"), "brand's")
        self.assertEqual(bg.normalize("Brand’s"), bg.normalize("Brand's"))


class NormalizeForMatchTest(unittest.TestCase):
    def test_drops_corp_suffix_and_punct(self) -> None:
        self.assertEqual(bg.normalize_for_match("Acme Inc"), "acme")
        self.assertEqual(bg.normalize_for_match("The Globex-Cola Company"), "globex cola")
        self.assertEqual(bg.normalize_for_match("Acme & Sons"), "acme sons")

    def test_drops_trailing_modifiers(self) -> None:
        self.assertEqual(bg.normalize_for_match("Globex Parent"), "globex")


class TokenizeTest(unittest.TestCase):
    def test_min_length_and_numeric_drop(self) -> None:
        # us (2 chars) and 2025 (numeric) dropped; underscores split
        self.assertEqual(bg.tokenize("Acme_US_Reach 2025"), ["acme", "reach"])

    def test_caps_tracking(self) -> None:
        toks, caps = bg.tokenize_with_caps("Acme Reach campaign")
        self.assertEqual(toks, ["acme", "reach", "campaign"])
        self.assertEqual(caps, {"acme", "reach"})


class StripCampaignCodesTest(unittest.TestCase):
    def test_drops_underscore_code_triplet(self) -> None:
        # 4-letter alpha + 2-letter alpha both look codey -> token dropped
        self.assertEqual(bg.strip_campaign_codes("Acme_US_Reach"), "")

    def test_brand_dict_exempts_short_brand(self) -> None:
        # The fix: a known brand token is never counted as a code, so the
        # whole token survives instead of being stripped.
        self.assertEqual(
            bg.strip_campaign_codes("Acme_US_Reach", {"acme"}), "Acme_US_Reach"
        )

    def test_strips_campaign_id_and_kv_pairs(self) -> None:
        self.assertEqual(bg.strip_campaign_codes("cp_100000000000001"), "")
        self.assertEqual(
            bg.strip_campaign_codes("objective~awareness Brand Push"),
            "Brand Push",
        )

    def test_leaves_plain_text(self) -> None:
        self.assertEqual(bg.strip_campaign_codes("Summer Sale"), "Summer Sale")


class ConcatSplitTest(unittest.TestCase):
    def test_greedy_split_on_brand(self) -> None:
        self.assertEqual(bg.concat_split("AcmePartner", ["acme"]), "Acme Partner")

    def test_no_brand_is_noop(self) -> None:
        self.assertEqual(bg.concat_split("Summer", ["acme"]), "Summer")
        self.assertEqual(bg.concat_split("anything", []), "anything")


class DateNormalizationTest(unittest.TestCase):
    def test_meta_variants(self) -> None:
        self.assertEqual(bg.normalize_date_meta("2026-06-09"), "2026-06-09")
        self.assertEqual(bg.normalize_date_meta("06/09/2026"), "2026-06-09")
        self.assertEqual(bg.normalize_date_meta("garbage"), "garbage")
        self.assertEqual(bg.normalize_date_meta(None), "")

    def test_tv_variants_and_sentinel(self) -> None:
        self.assertEqual(bg.normalize_date_tv("09 Jun 2026"), "2026-06-09")
        self.assertEqual(bg.normalize_date_tv("31-12-9999"), "ongoing")
        self.assertEqual(bg.normalize_date_tv(None), "")


class KeywordAndFieldTest(unittest.TestCase):
    def test_keyword_match(self) -> None:
        self.assertEqual(bg.keyword_match("Summer Acme Sale", ["acme"]), "acme")
        self.assertIsNone(bg.keyword_match("Summer Sale", ["acme"]))
        # accent-insensitive
        self.assertEqual(bg.keyword_match("cafe latte", ["café"]), "café")

    def test_field_for_match(self) -> None:
        row = {"Campaign Name": "X", "Creative Titles": "Y"}
        self.assertEqual(bg.field_for_match(row, "campaign_name"), "X")
        self.assertEqual(bg.field_for_match(row, "creative_titles"), "Y")
        self.assertEqual(bg.field_for_match(row, "unknown_field"), "")


class LookupMcidTest(unittest.TestCase):
    def test_exact(self) -> None:
        idx = {"globex": "MC1"}
        mc, conf, _ = bg.lookup_mcid_by_name("The Globex Company", idx)
        self.assertEqual(mc, "MC1")
        self.assertEqual(conf, 1.0)

    def test_high_overlap(self) -> None:
        idx = {"acme foods snacks": "MC2"}
        mc, conf, _ = bg.lookup_mcid_by_name("Acme Foods Snacks Drinks", idx)
        self.assertEqual(mc, "MC2")
        self.assertGreaterEqual(conf, 0.7)
        self.assertLess(conf, 1.0)

    def test_low_overlap(self) -> None:
        idx = {"acme foods": "MC3"}
        mc, conf, rationale = bg.lookup_mcid_by_name("Acme Foods Snacks", idx)
        self.assertEqual(mc, "MC3")
        self.assertGreaterEqual(conf, 0.4)
        self.assertLess(conf, 0.7)
        self.assertIn("LOW CONFIDENCE", rationale)

    def test_no_match(self) -> None:
        mc, conf, _ = bg.lookup_mcid_by_name("Zzz Unknown", {"acme foods": "MC4"})
        self.assertEqual(mc, "")
        self.assertEqual(conf, 0.0)


class ApplyConfigRulesTest(unittest.TestCase):
    def _cfg(self) -> dict[str, object]:
        return {
            "confirmed_campaigns": [{"campaign_id": "C1", "target_group": "g_special"}],
            "bucketing": {
                "rules": [
                    {
                        "match_field": "campaign_name",
                        "keywords": ["holiday"],
                        "target_group": "g_holiday",
                    }
                ],
                "catch_all": "g_other",
            },
        }

    def test_confirmed_rule_and_unmatched(self) -> None:
        rows = [
            {"Campaign ID": "C1", "Campaign Name": "whatever"},
            {"Campaign ID": "C2", "Campaign Name": "Holiday Blast"},
            {"Campaign ID": "C3", "Campaign Name": "Nothing special"},
        ]
        out, catch_all = bg.apply_config_rules(self._cfg(), rows)
        self.assertEqual(catch_all, "g_other")
        self.assertEqual(out[0][0], "g_special")
        self.assertEqual(out[1][0], "g_holiday")
        self.assertIsNone(out[2][0])

    def test_malformed_rule_is_skipped_not_raised(self) -> None:
        cfg: dict[str, object] = {
            "bucketing": {"rules": [{"keywords": ["x"]}], "catch_all": ""}
        }
        rows = [{"Campaign ID": "C1", "Campaign Name": "x marks it"}]
        # Missing match_field/target_group must NOT raise.
        out, _ = bg.apply_config_rules(cfg, rows)
        self.assertEqual(out, [(None, "")])


class BrandDictionaryTest(unittest.TestCase):
    def test_build_from_meta_and_tv(self) -> None:
        meta = [{"Ad Account Name": "Acme Pro Skincare"}]
        tv = [{"Brand": "ParentCo - Widget - Pods"}]
        bd = bg.build_brand_dictionary(meta, tv)
        self.assertTrue({"acme", "skincare", "widget", "pods"}.issubset(bd))
        # short tokens excluded (3-char "pro" is < 4 chars)
        self.assertNotIn("pro", bd)


class CosineTest(unittest.TestCase):
    def test_identical_and_orthogonal(self) -> None:
        self.assertAlmostEqual(bg.cosine({"a": 1.0}, {"a": 1.0}), 1.0)
        self.assertAlmostEqual(bg.cosine({"a": 1.0}, {"b": 1.0}), 0.0)


class RequireColumnsTest(unittest.TestCase):
    def test_ok(self) -> None:
        bg.require_columns(
            [{"MCID": "1", "Advertiser Name": "x"}],
            {"MCID", "Advertiser Name"},
            "Meta",
        )

    def test_missing_raises(self) -> None:
        with self.assertRaises(ValueError):
            bg.require_columns([{"Foo": "1"}], {"MCID"}, "Meta")

    def test_empty_rows_no_raise(self) -> None:
        bg.require_columns([], {"MCID"}, "Meta")


class MiscHelperTest(unittest.TestCase):
    def test_end_sort_key(self) -> None:
        self.assertEqual(bg.end_sort_key("ongoing"), (1, ""))
        self.assertEqual(bg.end_sort_key("2026-01-01"), (0, "2026-01-01"))
        # ongoing sorts after a dated end
        self.assertLess(bg.end_sort_key("2026-01-01"), bg.end_sort_key("ongoing"))

    def test_slug_to_display(self) -> None:
        cfg: dict[str, object] = {
            "advertiser": {"groups": [{"slug": "g1", "display_name": "Group One"}]}
        }
        self.assertEqual(bg.slug_to_display(cfg, "g1"), "Group One")
        self.assertEqual(bg.slug_to_display(cfg, "gX"), "gX")
        self.assertEqual(bg.slug_to_display(None, "g1"), "g1")


class DetectGroupsTextTest(unittest.TestCase):
    def _row(self, name: str) -> dict[str, str]:
        return {
            "Campaign Name": name,
            "Ad Account Name": "",
            "Creative Titles": "",
            "Creative Bodies": "",
        }

    def test_two_brand_split(self) -> None:
        rows = [
            self._row("Alpha One"),
            self._row("Alpha Two"),
            self._row("Alpha Three"),
            self._row("Beta One"),
            self._row("Beta Two"),
            self._row("Beta Three"),
        ]
        brand_dict = {"alpha", "beta"}
        out = bg.detect_groups_text("Acme Corp", rows, brand_dict)
        labels = [g for g, _ in out]
        # All Alpha rows share one (non-None) label; all Beta rows another;
        # the two brands land in different groups.
        self.assertTrue(all(label is not None for label in labels))
        self.assertEqual(labels[0], labels[1])
        self.assertEqual(labels[1], labels[2])
        self.assertEqual(labels[3], labels[4])
        self.assertEqual(labels[4], labels[5])
        self.assertNotEqual(labels[0], labels[3])


if __name__ == "__main__":
    unittest.main()