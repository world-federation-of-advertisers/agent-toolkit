// Export the Pellura fixture as a .pptx, then convert each slide to PNG using
// LibreOffice (soffice). Outputs to demo/remotion/public/slides/Slide{1..N}.png.
//
//   cd plugins/halo-mcp && npx tsx scripts/render-slides.tsx

import { writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { findFixtureReport } from "../lib/halo-fixtures.ts";
import { generatePptxBuffer } from "../lib/halo-export-pptx.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
// Writes under demo/, which is git-ignored — these are local build artifacts
// (the .pptx and rendered PNGs), not committed to the repo.
const SLIDES_DIR = join(HERE, "../../../demo/remotion/public/slides");
const PPTX_PATH = join(SLIDES_DIR, "pellura.pptx");

async function main() {
  const report = findFixtureReport("fixture_pellura_q1");
  if (!report) throw new Error("Pellura fixture not found");

  const buffer = await generatePptxBuffer(report);
  mkdirSync(SLIDES_DIR, { recursive: true });
  writeFileSync(PPTX_PATH, buffer);
  console.log(`Wrote ${PPTX_PATH} (${Math.round(buffer.length / 1024)} KB)`);

  const SOFFICE_PATHS = [
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    "soffice",
  ];

  for (const bin of SOFFICE_PATHS) {
    try {
      execFileSync(bin, [
        "--headless",
        "--convert-to", "png",
        "--outdir", SLIDES_DIR,
        PPTX_PATH,
      ], { stdio: "inherit", timeout: 30000 });
      console.log(`Converted via ${bin}`);
      return;
    } catch {
      // try next
    }
  }

  console.log(
    `\nCouldn't find LibreOffice. Manual step:\n` +
    `  Open ${PPTX_PATH}\n` +
    `  Export slides as PNG to ${SLIDES_DIR}/Slide{1..5}.png\n`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
