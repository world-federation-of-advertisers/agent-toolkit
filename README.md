# halo_skills

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
| `export_basic_report` | Export report as PowerPoint (.pptx) via in-app download |

### `report-interpretation` — Agent skill

A standalone `SKILL.md` that teaches any LLM agent how to interpret Halo cross-media measurement reports: what the metrics mean, how to read cross-publisher reach, what constitutes a good frequency distribution, and how to narrate findings for a media planner audience.

Download the latest `halo-skills.zip` from the [Releases](https://github.com/world-federation-of-advertisers/halo_skills/releases) page.

## Installation

### Claude Desktop

1. Download `halo-mcp.mcpb` from the [Releases](https://github.com/world-federation-of-advertisers/halo_skills/releases) page.
2. Open Claude Desktop and go to **Settings → Extensions**.
3. Click **Advanced settings**.
4. Click **Install Extension** and select the downloaded `.mcpb` file.
5. Review the extension details and click **Install**.
6. You'll be prompted to configure the following values (get these from your Halo Kingdom operator):

   | Field | Description | Example |
   |-------|-------------|---------|
   | **Halo API Base URL** | Public base URL of your Kingdom's reporting API | `https://api.example-halo.org` |
   | **Measurement Consumer Resource Name** | Your MC resource name | `measurementConsumers/abc123` |
   | **Auth0 Tenant URL** | Your Auth0 tenant base URL | `https://example.auth0.com` |
   | **Auth0 API Audience** | Auth0 audience identifier for the Halo API | `https://your-api-identifier` |
   | **Auth0 Client ID** | Machine-to-machine application client ID | *(from Auth0)* |
   | **Auth0 Client Secret** | Machine-to-machine application client secret | *(from Auth0)* |

7. Click **Save**. The Halo tools are now available in your conversations.

### Coding agents (Claude Code, Cursor, Windsurf, etc.)

Any coding agent that speaks MCP can run `halo-mcp` via `npx` — no clone, build, or manual download. `npx` fetches the package tarball straight from the GitHub release URL and runs it. Replace `<version>` with the [latest release](https://github.com/world-federation-of-advertisers/halo_skills/releases) tag (e.g. `0.1.0`).

**Claude Code** — one command:

```bash
claude mcp add halo -- npx -y https://github.com/world-federation-of-advertisers/halo_skills/releases/download/v<version>/halo-mcp-<version>.tgz --stdio
```

Then set the six `HALO_*` variables (below) in the server's `env`, or export them in your shell before launching Claude Code.

**Cursor, Windsurf, or any agent that reads an `mcp.json`** — add this block:

```json
{
  "mcpServers": {
    "halo": {
      "command": "npx",
      "args": ["-y", "https://github.com/world-federation-of-advertisers/halo_skills/releases/download/v<version>/halo-mcp-<version>.tgz", "--stdio"],
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

All six `HALO_*` environment variables are required. Get them from your Halo Kingdom operator. See [`plugins/halo-mcp/.env.example`](./plugins/halo-mcp/.env.example) for descriptions and optional settings.

> Working offline or behind a proxy? Download the `.tgz` from the [Releases](https://github.com/world-federation-of-advertisers/halo_skills/releases) page and swap the URL for a local path: `npx -y /path/to/halo-mcp-<version>.tgz --stdio`.

### Installing the skill (any agent)

Download `halo-skills.zip` from the [Releases](https://github.com/world-federation-of-advertisers/halo_skills/releases) page and unzip it. Each skill is a self-contained `SKILL.md` file you can drop into your agent's skill/rules directory.

| Agent | Destination |
|-------|-------------|
| Claude Code | `.claude/skills/` in your project |
| Codex | `~/.codex/skills/` |
| Cursor | `.cursor/rules/` |
| Continue | `.continue/rules/` |

The skills are agent-agnostic Markdown — no Claude-specific syntax. Any LLM that can follow Markdown instructions can use them.

## Repository layout

```
halo_skills/
├── .claude-plugin/marketplace.json
└── plugins/
    ├── halo-skills/
    │   ├── .claude-plugin/plugin.json
    │   └── skills/report-interpretation/SKILL.md
    └── halo-mcp/
        ├── .claude-plugin/plugin.json     ← Claude Code plugin manifest
        ├── manifest.json                  ← MCPB manifest for Claude Desktop
        ├── main.ts · server.ts · lib/ · src/
        └── scripts/build-mcpb.sh
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). New skills start by copying [`plugins/halo-skills/SKILL_TEMPLATE.md`](./plugins/halo-skills/SKILL_TEMPLATE.md).

Every PR runs [`scripts/lint-skills.py`](./scripts/lint-skills.py) in CI. Run it locally before pushing:

```bash
python3 scripts/lint-skills.py
```

## License

[Apache License 2.0](./LICENSE).
