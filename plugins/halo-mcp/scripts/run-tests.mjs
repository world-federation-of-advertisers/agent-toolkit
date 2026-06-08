// Run every *.test.ts under a directory with node's test runner + the tsx
// loader. Exits 0 when the directory has no tests, so `npm test` passes on
// branches/PRs that don't ship tests yet (e.g. the core-plugin PR) instead of
// erroring on a no-match glob (behavior differs across tsx/OS versions).
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: run-tests.mjs <dir>");
  process.exit(2);
}

let files = [];
try {
  files = readdirSync(dir, { recursive: true })
    .filter((f) => typeof f === "string" && f.endsWith(".test.ts"))
    .map((f) => `${dir}/${f}`);
} catch {
  // directory doesn't exist → treat as no tests
}

if (files.length === 0) {
  console.log(`no tests found in ${dir}/ — skipping`);
  process.exit(0);
}

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", ...files],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
