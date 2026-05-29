# halo_skills

AI agent skills for consumers of the [Halo cross-media measurement](https://github.com/world-federation-of-advertisers/cross-media-measurement) API.

## What's in here

A Claude Code marketplace bundling **two plugins**:

- **`halo-skills`** — agent-agnostic `SKILL.md` files (e.g. `report-interpretation`) that any LLM runtime can load.
- **`halo-mcp`** — an MCP server that exposes the Halo Reporting API as tools, renders interactive React dashboards inline in chat, and exports reports as PowerPoint. Distributable as a Claude Code plugin or a Claude Desktop Extension (`.mcpb`).

```
halo_skills/
├── .claude-plugin/marketplace.json
└── plugins/
    ├── halo-skills/
    │   ├── .claude-plugin/plugin.json
    │   └── skills/<skill-name>/SKILL.md   ← agent-discoverable skills
    └── halo-mcp/
        ├── .claude-plugin/plugin.json     ← Claude Code plugin manifest
        ├── manifest.json                  ← MCPB manifest for Claude Desktop
        ├── main.ts · server.ts · lib/ · src/
        └── scripts/build-mcpb.sh
```

## Installation

All skills live under `plugins/halo-skills/skills/<skill-name>/SKILL.md`. Each `SKILL.md` is a self-contained Markdown file with YAML frontmatter (`name`, `description`) followed by the skill body. How you wire that into your agent depends on the runtime.

### Claude Code (marketplace)

```
/plugin marketplace add https://github.com/world-federation-of-advertisers/halo_skills
/plugin install halo-skills@halo_skills
/plugin install halo-mcp@halo_skills      # optional: adds interactive dashboards + PPTX export
```

Skills auto-activate based on their `description` field — no per-skill configuration needed. The `halo-mcp` plugin reads six `HALO_*` environment variables for credentials and endpoint URLs (see [`plugins/halo-mcp/.env.example`](./plugins/halo-mcp/.env.example)). After installing the plugin, run `npm install` inside `plugins/halo-mcp/` once to fetch its Node dependencies.

### Claude Desktop (Extension)

Build a `.mcpb` you can drag into Claude Desktop's Settings → Extensions:

```bash
cd plugins/halo-mcp
npm install
npm run build:mcpb   # produces halo-mcp.mcpb
```

The user is prompted for the six `HALO_*` config values at install time. Sensitive ones (`HALO_CLIENT_ID`, `HALO_CLIENT_SECRET`) are stored in the OS keychain.

### Any agent via `npx skills`

The [`skills` CLI](https://github.com/vercel-labs/skills) installs `SKILL.md` files into the right directory for 50+ agents (Claude Code, Codex, Cursor, OpenCode, Continue, and more). It reads this repo's `.claude-plugin/marketplace.json` automatically — no extra config needed.

```bash
# Install into the current project
npx skills add world-federation-of-advertisers/halo_skills

# Install globally for the current user
npx skills add world-federation-of-advertisers/halo_skills -g

# Target a specific agent
npx skills add world-federation-of-advertisers/halo_skills -a codex

# Pick individual skills
npx skills add world-federation-of-advertisers/halo_skills --list
npx skills add world-federation-of-advertisers/halo_skills --skill <skill-name>
```

### Codex (manual)

If you'd rather not use `npx skills`:

```bash
git clone https://github.com/world-federation-of-advertisers/halo_skills
cp -r halo_skills/plugins/halo-skills/skills/* ~/.codex/skills/
```

### Claude Agent SDK

Clone the repo and point the SDK's skill loader at the skills directory:

```python
from claude_agent_sdk import ClaudeAgentOptions

options = ClaudeAgentOptions(
    setting_sources=["project"],
    # ...
)
# Place the cloned skills under .claude/skills/ in your project,
# or symlink: ln -s /path/to/halo_skills/plugins/halo-skills/skills .claude/skills
```

### Any other agent (generic)

For most agents, `npx skills` (above) is the easiest path. For custom setups — raw API clients, in-house LangChain/LlamaIndex agents, or anything else without a `skills`-CLI integration:

1. **Clone the repo:**
   ```bash
   git clone https://github.com/world-federation-of-advertisers/halo_skills
   ```
2. **Choose a loading strategy:**
   - **Symlink or copy** `plugins/halo-skills/skills/` into whatever path your agent already scans for instructions (e.g. `.cursor/rules/`, `.continue/rules/`, `CONVENTIONS.md` includes).
   - **Inject into the system prompt** — for lightweight setups, concatenate the `SKILL.md` files (or just their frontmatter) into your agent's system prompt so it knows what's available and can request the body on demand.
   - **Build a tiny loader** — read each `SKILL.md`, parse the frontmatter, expose `name` + `description` to the model upfront, and load the body only when the model asks for it. This mirrors how Claude Code does progressive disclosure.

The skills themselves are agent-agnostic Markdown — no Claude-specific syntax in the bodies. Any LLM that can follow Markdown instructions can use them.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). New skills start by copying [`plugins/halo-skills/SKILL_TEMPLATE.md`](./plugins/halo-skills/SKILL_TEMPLATE.md).

Every PR runs [`scripts/lint-skills.py`](./scripts/lint-skills.py) in CI. Run it locally before pushing:

```bash
python3 scripts/lint-skills.py
```

## License

[Apache License 2.0](./LICENSE).
