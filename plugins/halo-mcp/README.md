# Halo MCP

A read-only MCP server that exposes the [Halo Cross-Media Measurement REST API](https://github.com/world-federation-of-advertisers/cross-media-measurement) as MCP tools. When the LLM calls a tool, the host renders a React-based dashboard inline in the chat — KPI cards, ECharts visualizations, publisher breakdowns, and weekly trends. It can also export any report as a native PowerPoint deck.

This package can be consumed three ways:
- as a **Claude Code plugin** (registered via the parent `halo_skills` marketplace),
- as a **Claude Desktop Extension** (`.dxt`), or
- as a **standalone MCP server** over HTTP or stdio for any MCP-compatible host.

## Tools

| Tool | Description |
|---|---|
| `list_basic_reports` | Browse recent Basic Reports — state, period, campaign group. Each row has an "Open" button that calls `get_basic_report`. |
| `get_basic_report` | Render a full report dashboard: KPIs, stacked incremental reach, k+ frequency distribution, per-publisher reach chart + table, weekly trends. |
| `list_event_groups` | Browse event groups (campaigns) with optional metadata search. |
| `list_reporting_sets` | Browse reporting sets; flags which are usable as campaign groups. |
| `export_basic_report` | Export a report as a native PowerPoint deck (`.pptx`). Generated deterministically in-process via `pptxgenjs` — no Python, no external skill. Saves to `HALO_EXPORT_DIR` (default `~/Downloads`). |

This server is **read-only**. It does not create reports, event groups, or reporting sets — use your Halo deployment's authoring tools for writes.

## Configuration

The server reads four environment variables, all required:

| Var | Example | Purpose |
|---|---|---|
| `HALO_BASE_URL` | `https://api.example-halo.org` | Base URL of your Halo Kingdom's public API |
| `HALO_MC_ID` | `measurementConsumers/abc123` | Your Measurement Consumer resource name |
| `HALO_AUTH0_URL` | `https://example.auth0.com` | Your Auth0 tenant URL |
| `HALO_AUTH0_AUDIENCE` | `https://api.example-halo.org` | Auth0 API audience |
| `HALO_CLIENT_ID` | _(secret)_ | Auth0 machine-to-machine client id |
| `HALO_CLIENT_SECRET` | _(secret)_ | Auth0 machine-to-machine client secret |
| `HALO_EXPORT_DIR` | `~/Downloads` | (optional) Output directory for `.pptx` exports |

See [`.env.example`](./.env.example) for a complete template.

## Run standalone

```bash
npm install
cp .env.example .env  # then fill in HALO_CLIENT_ID / HALO_CLIENT_SECRET and the four HALO_* vars
npm run build         # bundles UI into dist/mcp-app.html
npm run serve         # HTTP transport on http://localhost:3001/mcp
# or:
npm run serve:stdio   # stdio transport
```

## Build as Claude Desktop Extension

```bash
npm run build:dxt   # produces halo-mcp.dxt — drag into Claude Desktop's Settings → Extensions
```

The user is prompted for `HALO_CLIENT_ID`, `HALO_CLIENT_SECRET`, and the four `HALO_*` URLs at install time. Secrets are stored by the host (Keychain on macOS, Credential Manager on Windows, libsecret on Linux); the user never has to edit a dotfile.

## Install as Claude Code plugin

The Claude Code plugin manifest (`.claude-plugin/plugin.json`) reads `HALO_*` from your shell environment — there is no install-time prompt. Export them before launching Claude Code:

```bash
export HALO_BASE_URL=https://api.example-halo.org
export HALO_MC_ID=measurementConsumers/abc123
export HALO_AUTH0_URL=https://example.auth0.com
export HALO_AUTH0_AUDIENCE=https://api.example-halo.org
export HALO_CLIENT_ID=…
export HALO_CLIENT_SECRET=…
```

If any are missing, the server fails fast with a `Missing required env var …` error. Use the `.dxt` build above if you want secrets stored in the OS keychain instead.

## Develop

```bash
npm run dev   # rebuild UI on change + restart server on .ts change
```

## Test with basic-host

```bash
git clone --branch "v$(npm view @modelcontextprotocol/ext-apps version)" --depth 1 \
  https://github.com/modelcontextprotocol/ext-apps.git /tmp/mcp-ext-apps
cd /tmp/mcp-ext-apps/examples/basic-host && npm install
SERVERS='["http://localhost:3001/mcp"]' npm run start
# open http://localhost:8080
```

## Architecture

```
main.ts                  ─ HTTP + stdio transport boot
server.ts                ─ registerAppTool ×4 (UI-bound) + registerTool ×1 (export, text-only) + registerAppResource ×1
lib/halo-client.ts       ─ Auth0 token caching, GET + pagination
lib/halo-export-pptx.ts  ─ Deterministic PPTX generator (pptxgenjs); native charts, slide layout
src/mcp-app.tsx          ─ useApp hook, dispatches on payload.kind
src/views.tsx            ─ List views + report dashboard, KPI cards, publisher table
src/charts.tsx           ─ ECharts wrappers: stacked incremental, freq distribution, publisher reach, weekly trends
src/halo-types.ts        ─ Narrow types + parseReport() (string-encoded ints, cumulative ?? nonCumulative)
```

## Security notes

- Secrets are never logged or echoed. Token cache (`~/.halo_token`) is `chmod 600`.
- Halo response fields (titles, brand/campaign metadata) are treated as untrusted consortium-supplied strings. React's default JSX-escaping is the only output path — no raw HTML injection.

## License

Apache License 2.0.
