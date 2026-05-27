# halo_skills — Agent Guide

This repository packages AI agent skills for consumers of the [Halo cross-media measurement](https://github.com/world-federation-of-advertisers/cross-media-measurement) API.

## What's here

A single skill plugin, `halo-skills`, distributed two ways:

- as a **Claude Code marketplace** (via `.claude-plugin/marketplace.json` at the repo root), and
- as **plain `SKILL.md` files** under `plugins/halo-skills/skills/` that any agent (Codex, Claude Agent SDK, etc.) can load directly.

```
halo_skills/
├── .claude-plugin/marketplace.json
└── plugins/halo-skills/
    ├── .claude-plugin/plugin.json
    └── skills/<skill-name>/SKILL.md   ← agent-discoverable skills live here
```

## For agents working in this repo

When asked to author or modify a skill:

1. Skills live only under `plugins/halo-skills/skills/<skill-name>/SKILL.md`. Do not create `SKILL.md` files anywhere else — they will pollute users' agents at install time.
2. Start from [`plugins/halo-skills/SKILL_TEMPLATE.md`](./plugins/halo-skills/SKILL_TEMPLATE.md). The template lives outside `skills/` deliberately so it does not auto-load.
3. Follow the authoring rules in [`CONTRIBUTING.md`](./CONTRIBUTING.md):
   - `name` is lowercase letters, digits, hyphens only, and matches the directory.
   - `description` begins with "Use when…" and describes **triggering conditions only** — never a workflow summary. (A description that summarizes the workflow causes agents to skip the body.)
   - Aim for ≤ 500 words per skill.
4. Validate locally before committing:
   ```bash
   python3 scripts/lint-skills.py
   ```
5. Follow WFA contribution requirements (CLA, Conventional Commits, `Issue:` trailer) — see [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

Apache License 2.0. See [LICENSE](./LICENSE).
