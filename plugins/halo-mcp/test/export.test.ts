/**
 * End-to-end tests for the PPTX exporter against every fixture in test/fixtures/.
 *
 * Two layers of assertions:
 *
 *   A) Plumbing — for every fixture:
 *      1. parseReport() doesn't throw.
 *      2. buildPresentation() → generatePptxBuffer() produces a non-trivial buffer.
 *      3. Buffer is a valid ZIP (PPTX is a ZIP container, starts with PK).
 *      4. Slide count matches expectedSlideCount() derived from parsed data.
 *
 *   B) Semantic — protect against silent data corruption:
 *      5. parsed.total.reach must match the reach reported by SOME total-level
 *         result in the source (rules out picking the wrong RG).
 *      6. parsed.demographics.length must match the count of dimensional cells
 *         in the source (rules out dropping segments).
 *      7. parsed.weekly?.length must match the count of weekly results in the
 *         source (rules out missing or double-counting weeks).
 *
 * Run with: npm test
 */
import { strict as assert } from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { generatePptxBuffer } from "../lib/halo-export-pptx.ts";
import type { BasicReport, ResultGroupResult } from "../src/halo-types.ts";
import { parseReport } from "../src/halo-types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, "fixtures");

function expectedSlideCount(report: BasicReport): number {
  const parsed = parseReport(report);
  if (parsed.state && parsed.state !== "SUCCEEDED") return 1;
  let n = 1; // overview always rendered for SUCCEEDED
  if (parsed.stackedIncremental.length) n++;
  if (
    parsed.publishers.some((p) => (p.uniqueReach ?? 0) > 0)
    && parsed.publishers.filter((p) => (p.uniqueReach ?? 0) > 0).length >= 2
  ) n++;
  if (parsed.total.kPlusReach.length) n++;
  if (parsed.weekly?.length) n++;
  if (parsed.demographics.length) n++;
  n++; // summary always rendered for SUCCEEDED
  return n;
}

// --- Semantic helpers --------------------------------------------------------
// These walk the raw BasicReport (not parseReport) so we have an independent
// source of truth to compare against.

function isDemographicCellRaw(r: ResultGroupResult): boolean {
  const dim = r.metadata?.dimensionSpecSummary;
  if (!dim) return false;
  const hasGroupingValue = (dim.groupings ?? []).some(
    (g) => g.value?.enumValue || g.value?.stringValue,
  );
  const hasFilterValue = (dim.filters ?? []).some(
    (f) => f.key != null && f.value != null,
  );
  return hasGroupingValue || hasFilterValue;
}

function isWeeklyResultRaw(r: ResultGroupResult): boolean {
  return r.metadata?.metricFrequency?.weekly != null && !isDemographicCellRaw(r);
}

function isTotalResultRaw(r: ResultGroupResult): boolean {
  return !isDemographicCellRaw(r) && !isWeeklyResultRaw(r);
}

function reachOf(r: ResultGroupResult): number {
  const unit = r.metricSet?.reportingUnit;
  const raw = unit?.cumulative ?? unit?.nonCumulative;
  const s = raw?.reach;
  if (s == null) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function countResults(report: BasicReport, pred: (r: ResultGroupResult) => boolean): number {
  let n = 0;
  for (const rg of report.resultGroups ?? []) {
    for (const r of rg.results ?? []) if (pred(r)) n++;
  }
  return n;
}

async function loadFixtures(): Promise<Array<{ name: string; report: BasicReport }>> {
  const files = (await fs.readdir(FIXTURE_DIR)).filter((f) => f.endsWith(".json")).sort();
  return Promise.all(
    files.map(async (f) => ({
      name: f,
      report: JSON.parse(await fs.readFile(path.join(FIXTURE_DIR, f), "utf8")) as BasicReport,
    })),
  );
}

const fixtures = await loadFixtures();
assert.ok(fixtures.length > 0, "no fixtures found in test/fixtures/");

for (const { name, report } of fixtures) {
  test(`export: ${name}`, async () => {
    // --- A) Plumbing -----------------------------------------------------
    const parsed = parseReport(report);
    assert.ok(parsed, `parseReport returned falsy for ${name}`);

    const buf = await generatePptxBuffer(report);
    assert.ok(buf.length > 1000, `pptx buffer too small (${buf.length} bytes) for ${name}`);
    assert.equal(buf[0], 0x50, `not a zip (first byte != 'P') for ${name}`);
    assert.equal(buf[1], 0x4b, `not a zip (second byte != 'K') for ${name}`);

    const text = buf.toString("binary");
    const slideMatches = text.match(/ppt\/slides\/slide\d+\.xml/g) ?? [];
    const uniqueSlides = new Set(slideMatches);
    const expected = expectedSlideCount(report);
    assert.equal(
      uniqueSlides.size,
      expected,
      `${name}: expected ${expected} slides, found ${uniqueSlides.size}`,
    );

    // --- B) Semantic -----------------------------------------------------
    // Skip semantic checks for non-SUCCEEDED reports (single status slide).
    if (parsed.state && parsed.state !== "SUCCEEDED") return;

    // 5) The headline reach must match SOME total-level result in the source.
    //    (pickHeadline prefers components-bearing totals; any of the raw totals
    //    is a valid match.)
    const totalReaches = new Set<number>();
    for (const rg of report.resultGroups ?? []) {
      for (const r of rg.results ?? []) {
        if (isTotalResultRaw(r)) totalReaches.add(reachOf(r));
      }
    }
    if (totalReaches.size > 0) {
      assert.ok(
        totalReaches.has(parsed.total.reach),
        `${name}: parsed.total.reach=${parsed.total.reach} not among total-level reaches ${[...totalReaches].join(",")}`,
      );
    }

    // 6) Demographic cell count must match raw count.
    const rawDemoCount = countResults(report, isDemographicCellRaw);
    assert.equal(
      parsed.demographics.length,
      rawDemoCount,
      `${name}: parsed ${parsed.demographics.length} demographics, source has ${rawDemoCount}`,
    );

    // 7) Weekly count must match raw count.
    const rawWeeklyCount = countResults(report, isWeeklyResultRaw);
    const parsedWeeklyCount = parsed.weekly?.length ?? 0;
    assert.equal(
      parsedWeeklyCount,
      rawWeeklyCount,
      `${name}: parsed ${parsedWeeklyCount} weekly slices, source has ${rawWeeklyCount}`,
    );
  });
}
