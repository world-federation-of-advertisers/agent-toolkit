#!/usr/bin/env bash
# Build a Claude Desktop Extension (.mcpb) bundle for halo-mcp.
#
# Output: ./halo-mcp.mcpb (a zip the user can drag into Claude Desktop).
#
# Bundles: manifest.json + pre-compiled server (dist/server/main.mjs) + built UI
# (dist/mcp-app.html) + production node_modules. No TypeScript source or tsx
# runtime is shipped — main.ts/server.ts/lib are bundled by esbuild.
#
# Uses `mcpb pack` (from @anthropic-ai/mcpb), which validates the manifest
# against the current schema before zipping.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT="$ROOT/halo-mcp.mcpb"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

echo "Staging MCPB contents in $STAGE"

if [ ! -f "$ROOT/dist/server/main.mjs" ] || [ ! -f "$ROOT/dist/mcp-app.html" ]; then
  echo "ERROR: dist/ incomplete — run 'npm run build' first" >&2
  exit 1
fi

# Copy manifest + pre-built artifacts + package manifests for npm install.
cp manifest.json "$STAGE/"
cp package.json "$STAGE/"
cp package-lock.json "$STAGE/" 2>/dev/null || true
cp -R dist "$STAGE/"

# Install only production deps. The compiled server bundles all *.ts source but
# leaves npm packages external (--packages=external), so node_modules is needed
# at runtime for express, undici, pptxgenjs, the MCP SDK, etc.
echo "Installing production deps into stage"
( cd "$STAGE" && npm install --omit=dev --silent --no-audit --no-fund )

# Pack the staged dir into the .mcpb. `mcpb pack` validates manifest.json
# against the current schema and produces a zip with the .mcpb extension.
rm -f "$OUT"
npx -y @anthropic-ai/mcpb pack "$STAGE" "$OUT"

SIZE=$(du -h "$OUT" | awk '{print $1}')
echo "Built $OUT ($SIZE)"
