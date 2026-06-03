# halo_skills — Agent Guide

This repository packages AI agent skills for consumers of the [Halo cross-media measurement](https://github.com/world-federation-of-advertisers/cross-media-measurement) API.

## What's here

A Claude Code marketplace (via `.claude-plugin/marketplace.json`) shipping a single plugin, **`halo`** (source: `plugins/halo-mcp/`), that bundles both:

- **An MCP server** that exposes the Halo Reporting API as tools, renders interactive React dashboards inline in chat, and exports reports as PowerPoint (.pptx) via in-app download. Also distributable as a Claude Desktop `.mcpb` extension (see `plugins/halo-mcp/manifest.json`).
- **Skills** — `SKILL.md` files under `plugins/halo-mcp/skills/` that any agent (Claude Code, Codex, Claude Agent SDK, etc.) can load. Currently ships one skill: `halo-workflow` (how to drive the MCP tools). Also published as a standalone `halo-skills.zip` for non-Claude agents.

```
halo_skills/
├── .claude-plugin/marketplace.json        ← declares the single `halo` plugin
└── plugins/
    └── halo-mcp/                           ← the `halo` plugin
        ├── .claude-plugin/plugin.json      ← registers MCP server + auto-loads skills/
        ├── manifest.json                   ← MCPB manifest for Claude Desktop
        ├── main.ts · server.ts · lib/ · src/
        ├── scripts/build-mcpb.sh
        ├── SKILL_TEMPLATE.md               ← outside skills/ so it does not auto-load
        └── skills/halo-workflow/SKILL.md
```

## For agents working in this repo

When asked to author or modify a skill:

1. Skills live only under `plugins/halo-mcp/skills/<skill-name>/SKILL.md`. Do not create `SKILL.md` files anywhere else — they will pollute users' agents at install time.
2. Start from [`plugins/halo-mcp/SKILL_TEMPLATE.md`](./plugins/halo-mcp/SKILL_TEMPLATE.md). The template lives outside `skills/` deliberately so it does not auto-load.
3. Follow the authoring rules in [`CONTRIBUTING.md`](./CONTRIBUTING.md):
   - `name` is lowercase letters, digits, hyphens only, and matches the directory.
   - `description` begins with "Use when…" and describes **triggering conditions only** — never a workflow summary. (A description that summarizes the workflow causes agents to skip the body.)
   - Aim for ≤ 500 words per skill.
4. Validate locally before committing:
   ```bash
   python3 scripts/lint-skills.py
   ```
5. Follow WFA contribution requirements (CLA, Conventional Commits, `Issue:` trailer) — see [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## Releases

The `halo-skills.zip` artifact on the [Releases](https://github.com/world-federation-of-advertisers/halo_skills/releases) page contains the `skills/` directory tree. Users download and unzip it into their agent's skill directory.

## License

Apache License 2.0. See [LICENSE](./LICENSE).
