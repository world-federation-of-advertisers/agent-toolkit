# agent-toolkit

AI agent skills for consumers of the [Halo cross-media measurement](https://github.com/world-federation-of-advertisers/cross-media-measurement) API.

## What's in here

### `halo-mcp` — MCP server for the Halo Reporting API

An MCP server that exposes the Halo Reporting API as tools, renders interactive React dashboards inline in chat, and exports reports as PowerPoint. Distributable as a Claude Desktop Extension (`.mcpb`) or configured manually for any MCP-compatible coding agent.

**Tools provided:**

| Tool | Description |
|------|-------------|
| `list_basic_reports` | List reports with status, campaign group, and date range |
| `list_event_groups` | List event groups (publishers and media types) |
| `list_reporting_sets` | List reporting sets (campaign groups) |
| `show_report_summary` | Render headline KPIs, publisher list, and narrative |
| `show_stacked_incremental_reach` | Stacked incremental reach chart |
| `show_venn_overlap` | Cross-publisher audience overlap (Venn) |
| `show_frequency_distribution` | Frequency distribution chart |
| `show_publisher_reach_chart` | Per-publisher reach chart |
| `show_publisher_table` | Publisher comparison table |
| `show_weekly_trends` | Weekly reach trends over time |
| `show_cross_campaign_reach` | Compare per-publisher reach across all campaigns (grouped bars) |
| `show_cross_campaign_frequency` | Overlay k+ frequency distributions across all campaigns |
| `export_basic_report` | Export report as PowerPoint (.pptx) via in-app download |

### `halo-workflow` — Agent skill

A standalone `SKILL.md` that teaches any LLM agent how to drive the Halo MCP tools: which tool to call for a given question, the discovery sequence (list → summary → drill down → export), and common interpretation pitfalls.

Download the per-skill `.zip` bundles from the [Releases](https://github.com/world-federation-of-advertisers/agent-toolkit/releases) page.

## Installation

### Claude Code

Install the whole `halo` plugin — MCP server **and** the bundled skills — directly from this marketplace. No clone or build step.

1. **Add the marketplace** (one time):

   ```
   /plugin marketplace add world-federation-of-advertisers/agent-toolkit
   ```

2. **Install the plugin:**

   ```
   /plugin install halo@agent-toolkit
   ```

3. **Provide credentials.** The MCP server needs six `HALO_*` values (get them from your CMMS Operator). Set them as environment variables before launching Claude Code — export them in your shell, or add an `env` block to the `halo` server in your `.claude/settings.json`. See [Configuration](#configuration) for the full list.

4. **Restart Claude Code** so the server starts. On first launch the server is fetched via `npx` from the release tarball and cached, so that run needs network access.

Use `/plugin` at any time to enable, disable, or uninstall it. To pick up a new release later, run `/plugin marketplace update agent-toolkit`, then reinstall.

> **Just want to try it?** Skip the credentials and set `"HALO_FAKE_DATA": "1"` in the server's `env` instead. The server then serves three built-in demo reports (no Halo account or Auth0 needed) so you can explore the tools and dashboards offline.

### Claude Desktop

1. Download `halo-mcp.mcpb` from the [Releases](https://github.com/world-federation-of-advertisers/agent-toolkit/releases) page.
2. Open Claude Desktop and go to **Settings → Extensions**.
3. Click **Advanced settings**.
4. Click **Install Extension** and select the downloaded `.mcpb` file.
5. Review the extension details and click **Install**.
6. You'll be prompted to configure the following values (get these from your CMMS Operator):

   | Field | Description | Example |
   |-------|-------------|---------|
   | **Halo API Base URL** | Public base URL of your CMMS Operator's reporting API | `https://api.example-halo.org` |
   | **Measurement Consumer Resource Name** | Your MC resource name | `measurementConsumers/abc123` |
   | **Auth0 Tenant URL** | Your Auth0 tenant base URL | `https://example.auth0.com` |
   | **Auth0 API Audience** | Auth0 audience identifier for the Halo API | `https://your-api-identifier` |
   | **Auth0 Client ID** | Machine-to-machine application client ID | *(from Auth0)* |
   | **Auth0 Client Secret** | Machine-to-machine application client secret | *(from Auth0)* |

7. Click **Save**. The Halo tools are now available in your conversations.

### Other coding agents (Cursor, Windsurf, etc.)

Any other coding agent that speaks MCP can run `halo-mcp` via `npx` — no clone, build, or manual download. `npx` fetches the package tarball straight from the GitHub release URL and runs it. Replace `<version>` with the [latest release](https://github.com/world-federation-of-advertisers/agent-toolkit/releases) tag (e.g. `0.1.0`).

In **Cursor**, **Windsurf**, or any agent that reads an `mcp.json`, add this block:

```json
{
  "mcpServers": {
    "halo": {
      "command": "npx",
      "args": ["-y", "https://github.com/world-federation-of-advertisers/agent-toolkit/releases/download/v<version>/halo-mcp-<version>.tgz", "--stdio"],
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

All six `HALO_*` environment variables are required — see [Configuration](#configuration) below for the full list.

> Working offline or behind a proxy? Download the `.tgz` from the [Releases](https://github.com/world-federation-of-advertisers/agent-toolkit/releases) page and swap the URL for a local path: `npx -y /path/to/halo-mcp-<version>.tgz --stdio`.

### Installing the skill (any agent)

Download the skill bundle(s) — one `<skill-name>.zip` per skill — from the [Releases](https://github.com/world-federation-of-advertisers/agent-toolkit/releases) page and unzip. Each unzips to a self-contained `<skill-name>/` directory you can drop into your agent's skill/rules directory.

| Agent | Destination |
|-------|-------------|
| Claude Code | `.claude/skills/` in your project |
| Codex | `~/.codex/skills/` |
| Cursor | `.cursor/rules/` |
| Continue | `.continue/rules/` |

The skills are agent-agnostic Markdown — no Claude-specific syntax. Any LLM that can follow Markdown instructions can use them.

## Configuration

The MCP server reads these environment variables:

| Variable | Required | Example | Purpose |
|---|---|---|---|
| `HALO_BASE_URL` | Yes | `https://api.example-halo.org` | Base URL of your CMMS Operator's public API |
| `HALO_MC_ID` | Yes | `measurementConsumers/abc123` | Your Measurement Consumer resource name |
| `HALO_AUTH0_URL` | Yes | `https://example.auth0.com` | Your Auth0 tenant URL |
| `HALO_AUTH0_AUDIENCE` | Yes | `https://api.example-halo.org` | Auth0 API audience identifier |
| `HALO_CLIENT_ID` | Yes | *(from Auth0)* | Machine-to-machine application client ID |
| `HALO_CLIENT_SECRET` | Yes | *(from Auth0)* | Machine-to-machine application client secret |
| `HALO_TOKEN_FILE` | No | `~/.halo_token` | Auth0 token cache path (mode `0600`) |
| `HTTPS_PROXY` | No | `http://proxy:8080` | Outbound proxy, if your network requires one |
| `HALO_FAKE_DATA` | No | `1` | Serve built-in demo fixtures (no credentials needed) |

### Fake-data mode

Set `HALO_FAKE_DATA=1` to bypass Auth0 and the Halo API entirely. The server returns three built-in fixture reports — no other env vars are required. Useful for demos, offline development, and evaluating the tools before connecting to a live Halo deployment.

## Development

```bash
cd plugins/halo-mcp
npm install
npm run dev          # rebuild UI on change + restart server on .ts change
npm run build        # production build (dist/mcp-app.html + dist/server/main.mjs)
npm run build:mcpb   # package as Claude Desktop Extension (.mcpb)
```

### Run from source in Claude Desktop

Add this to your `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`), using absolute paths to your checkout:

```json
{
  "mcpServers": {
    "xmm-halo": {
      "command": "/path/to/agent-toolkit/plugins/halo-mcp/node_modules/.bin/tsx",
      "args": ["/path/to/agent-toolkit/plugins/halo-mcp/main.ts", "--stdio"],
      "env": { "HALO_FAKE_DATA": "1" }
    }
  }
}
```

`tsx` runs TypeScript directly — edits take effect on restart, no build step needed.

### Security notes

- Secrets are never logged or echoed.
- Config secrets (`HALO_CLIENT_ID`/`HALO_CLIENT_SECRET`) come from the host (OS keychain for `.mcpb`, shell env otherwise) — the server never persists them. The short-lived Auth0 access token is cached at `HALO_TOKEN_FILE` (default `~/.halo_token`, `chmod 600`).
- Halo response fields (titles, brand/campaign metadata) are treated as untrusted consortium-supplied strings. React's default JSX-escaping handles output — no raw HTML injection.

## Repository layout

```
agent-toolkit/
├── .claude-plugin/marketplace.json        ← declares the single `halo` plugin
└── plugins/
    └── halo-mcp/                           ← the `halo` plugin (MCP server + skills)
        ├── .claude-plugin/plugin.json     ← registers MCP server + auto-loads skills/
        ├── manifest.json                  ← MCPB manifest for Claude Desktop
        ├── main.ts · server.ts · lib/ · src/
        ├── scripts/build-mcpb.sh
        ├── SKILL_TEMPLATE.md
        └── skills/halo-workflow/SKILL.md
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). New skills start by copying [`plugins/halo-mcp/SKILL_TEMPLATE.md`](./plugins/halo-mcp/SKILL_TEMPLATE.md).

Every PR runs [`scripts/lint-skills.py`](./scripts/lint-skills.py) in CI. Run it locally before pushing:

```bash
python3 scripts/lint-skills.py
```

## License

[Apache License 2.0](./LICENSE).
