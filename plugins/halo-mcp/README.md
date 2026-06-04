# Halo MCP

A read-only MCP server that exposes the [Halo Cross-Media Measurement REST API](https://github.com/world-federation-of-advertisers/cross-media-measurement) as MCP tools. When the LLM calls a tool, the host renders a React-based dashboard inline in the chat — KPI cards, ECharts visualizations, publisher breakdowns, and weekly trends. It can also export any report as a native PowerPoint deck.

This package can be consumed three ways:
- as a **Claude Code plugin** (registered via the parent `halo_skills` marketplace),
- as a **Claude Desktop Extension** (`.mcpb`), or
- as a **standalone MCP server** over HTTP or stdio for any MCP-compatible host.

## Tools

| Tool | Description |
|---|---|
| `list_basic_reports` | Browse recent Basic Reports — state, period, campaign group. Each row has an "Open" button that calls `get_basic_report`. |
| `get_basic_report` | Render a full report dashboard: KPIs, stacked incremental reach, k+ frequency distribution, per-publisher reach chart + table, weekly trends. |
| `list_event_groups` | Browse event groups (campaigns) with optional metadata search. |
| `list_reporting_sets` | Browse reporting sets; flags which are usable as campaign groups. |
| `export_basic_report` | Export a report as a native PowerPoint deck (`.pptx`). Generated deterministically in-process via `pptxgenjs` — no Python, no external skill. Returned as an embedded binary resource the host offers for download. |

This server is **read-only**. It does not create reports, event groups, or reporting sets — use your Halo deployment's authoring tools for writes.

## Configuration

The server reads six required environment variables, plus a few optional ones:

| Var | Example | Purpose |
|---|---|---|
| `HALO_BASE_URL` | `https://api.example-halo.org` | Base URL of your CMMS Operator's public API |
| `HALO_MC_ID` | `measurementConsumers/abc123` | Your Measurement Consumer resource name |
| `HALO_AUTH0_URL` | `https://example.auth0.com` | Your Auth0 tenant URL |
| `HALO_AUTH0_AUDIENCE` | `https://api.example-halo.org` | Auth0 API audience |
| `HALO_CLIENT_ID` | _(secret)_ | Auth0 machine-to-machine client id |
| `HALO_CLIENT_SECRET` | _(secret)_ | Auth0 machine-to-machine client secret |
| `HALO_TOKEN_FILE` | `~/.halo_token` | (optional) Auth0 token cache path (mode `600`) |
| `HTTPS_PROXY` | `http://proxy:8080` | (optional) Outbound proxy, if your network requires one |
| `PORT` | `3001` | (optional) HTTP transport port; ignored under `--stdio` |

For demos and offline work, set `HALO_FAKE_DATA=1` instead — none of the above are required (see [Fake-data mode](#fake-data-mode)).

## Run standalone

```bash
npm install
npm run build                         # bundles UI into dist/mcp-app.html
export HALO_BASE_URL=… HALO_MC_ID=… HALO_AUTH0_URL=… HALO_AUTH0_AUDIENCE=… HALO_CLIENT_ID=… HALO_CLIENT_SECRET=…
npm run serve                         # HTTP transport on http://localhost:3001/mcp
# or:
npm run serve:stdio                   # stdio transport
# or, with no credentials, against built-in fixtures:
HALO_FAKE_DATA=1 npm run serve:stdio
```

## Fake-data mode

For demos and offline development, set `HALO_FAKE_DATA=1`. The client
bypasses Auth0 and the Halo API entirely and returns fixtures defined in
[`lib/halo-fixtures.ts`](lib/halo-fixtures.ts). No other env vars are
required.

```bash
HALO_FAKE_DATA=1 npm run serve
```

Three fictional reports ship with the fixture set:

| ID | Title | Story |
|---|---|---|
| `fixture_veliro_q1` | Veliro Athletic — Run 1 Launch | Healthy 3-publisher launch — no pitfalls |
| `fixture_pellura_q1` | Pellura Vitamin-C Serum — Q1 Launch | One publisher (Vega) over-saturates: 60% of impressions, 9% of reach, 53× frequency |
| `fixture_cobari_q1` | Cobari Coffee — Brand Awareness Q1 | Two publishers heavily overlap — 89% of Cygnus's reach also in Orion |

Publisher names are constellations (Orion, Vega, Lyra, Cygnus, Draco) so no
real platform is implicitly characterized. Add or edit fixtures by
modifying `lib/halo-fixtures.ts`.

## Build as Claude Desktop Extension

```bash
npm run build:mcpb  # produces halo-mcp.mcpb — drag into Claude Desktop's Settings → Extensions
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

If any are missing, the server fails fast with a `Missing required env var …` error. Use the `.mcpb` build above if you want secrets stored in the OS keychain instead.

## Develop

```bash
npm install
npm run dev   # rebuild UI on change + restart server on .ts change
```

### Run from source in Claude Desktop

To exercise your local working copy inside Claude Desktop (no build, no `.mcpb`), point the server at `main.ts` through the repo's `tsx`. Add this to your `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`), using **absolute paths** to your checkout, then restart Claude Desktop:

```json
{
  "mcpServers": {
    "xmm-halo": {
      "command": "/absolute/path/to/agent-toolkit/plugins/halo-mcp/node_modules/.bin/tsx",
      "args": [
        "/absolute/path/to/agent-toolkit/plugins/halo-mcp/main.ts",
        "--stdio"
      ],
      "env": {
        "HALO_BASE_URL": "https://api.example-halo.org",
        "HALO_MC_ID": "measurementConsumers/abc123",
        "HALO_AUTH0_URL": "https://example.auth0.com",
        "HALO_AUTH0_AUDIENCE": "https://your-api-identifier",
        "HALO_CLIENT_ID": "your-client-id",
        "HALO_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

Run `npm install` first so `node_modules/.bin/tsx` exists. `tsx` runs the TypeScript directly, so edits to `main.ts`, `server.ts`, or `lib/` take effect on the next Claude Desktop restart — no build step. To work offline against the bundled fixtures, drop the six `HALO_*` entries and use `"env": { "HALO_FAKE_DATA": "1" }` instead.

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

- Secrets are never logged or echoed.
- Two different things are stored in two different places: the **config secrets** (`HALO_CLIENT_ID`/`HALO_CLIENT_SECRET`) come from the host — the OS keychain when installed as a `.mcpb`, or your shell env / `mcp.json` otherwise; this server never persists them. Separately, the short-lived **Auth0 access token** it fetches is cached on disk at `HALO_TOKEN_FILE` (default `~/.halo_token`, `chmod 600`) to avoid re-authenticating on every call.
- Halo response fields (titles, brand/campaign metadata) are treated as untrusted consortium-supplied strings. React's default JSX-escaping is the only output path — no raw HTML injection.

## License

Apache License 2.0.
