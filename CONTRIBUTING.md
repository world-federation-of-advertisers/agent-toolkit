# Contributing to halo_skills

This repo packages agent skills for the Halo cross-media measurement ecosystem. Skills are auto-discovered by agents (Claude Code, Codex, Agent SDK) — small structural mistakes cause silent load failures, so please follow the conventions.

## Contributor License Agreement

Contributions to this project must be accompanied by a Contributor License Agreement, in line with all repositories in the [World Federation of Advertisers](https://github.com/world-federation-of-advertisers) organization. You (or your employer) retain the copyright to your contribution; the CLA simply grants WFA permission to use and redistribute it as part of the project.

You generally only need to submit a CLA once across WFA projects.

## Code Review

All submissions, including those from project members, require review via GitHub pull requests.

## Commit messages

Follow **[Conventional Commits](https://www.conventionalcommits.org/)**, consistent with other WFA repositories. Every significant PR must include an `Issue` trailer referencing the tracking issue:

```
feat(skills): add report-spec-intake skill

Issue: #42
```

Common types for this repo: `feat`, `fix`, `docs`, `chore`, `refactor`.

## Repository layout

```
halo_skills/
├── AGENTS.md                                # Agent-facing guide (CLAUDE.md is a pointer to this)
├── CLAUDE.md                                # @AGENTS.md
├── .claude-plugin/marketplace.json          # Claude Code marketplace catalog
├── plugins/
│   ├── halo-skills/
│   │   ├── .claude-plugin/plugin.json       # Plugin manifest
│   │   ├── SKILL_TEMPLATE.md                # Copy this when adding a skill
│   │   └── skills/
│   │       └── <skill-name>/
│   │           └── SKILL.md                 # Auto-discovered
│   └── halo-mcp/
│       ├── .claude-plugin/plugin.json       # Claude Code plugin manifest
│       ├── manifest.json                    # MCPB manifest for Claude Desktop
│       ├── main.ts · server.ts · lib/ · src/
│       └── scripts/build-mcpb.sh
├── scripts/lint-skills.py                   # Validates every SKILL.md
└── .github/workflows/lint-skills.yml        # Runs the linter in CI
```

## Adding a skill

1. Copy [`plugins/halo-skills/SKILL_TEMPLATE.md`](./plugins/halo-skills/SKILL_TEMPLATE.md) to `plugins/halo-skills/skills/<skill-name>/SKILL.md`.
2. Fill in `name` (must match the directory), `description` (start with "Use when…"), and the body.
3. Run the linter locally:
   ```bash
   python3 scripts/lint-skills.py
   ```
4. Commit with a Conventional Commits message and an `Issue:` trailer.
5. Open a PR. CI runs the same linter on every push.

## Skill authoring rules

- **`name`** — lowercase letters, digits, hyphens only. Must match the containing directory name.
- **`description`** — describes *when* to use the skill, not *what* it does. Agents use this to decide whether to load the skill; a workflow summary in the description causes agents to skip the body.
- **One `SKILL.md` per skill directory.** Supporting files (scripts, references) are fine; just don't name them `SKILL.md`.
- **Keep it tight.** Under 500 words is the target. Skills that load into every conversation should be under 200.
- **No narratives.** Skills are reusable references, not session logs.

## Installing your local copy for testing

**Claude Code:**

```
/plugin marketplace add /absolute/path/to/halo_skills
/plugin install halo-skills@halo_skills
```

**Cross-agent:** point your loader at `plugins/halo-skills/skills/`.

## License

Apache License 2.0. See [LICENSE](./LICENSE). By contributing, you agree your contributions will be licensed under it.
