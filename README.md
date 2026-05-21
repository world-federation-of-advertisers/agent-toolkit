# halo_skills

AI agent skills for users of the [Halo cross-media measurement](https://github.com/world-federation-of-advertisers/cross-media-measurement) system — advertisers, Measurement Coordinators (MCs), and agencies.

## What's in here

A single skill plugin — `halo-skills` — packaged as a Claude Code marketplace **and** usable directly by any agent that loads `SKILL.md` files.

```
halo_skills/
├── .claude-plugin/marketplace.json
└── plugins/halo-skills/
    ├── .claude-plugin/plugin.json
    └── skills/
        └── <skill-name>/SKILL.md   ← the actual skills
```

## Installation

### Claude Code

```
/plugin marketplace add https://github.com/world-federation-of-advertisers/halo_skills
/plugin install halo-skills@halo_skills
```

Skills auto-activate based on their `description` field — no per-skill configuration needed.

### Codex

```bash
git clone https://github.com/world-federation-of-advertisers/halo_skills
cp -r halo_skills/plugins/halo-skills/skills/* ~/.codex/skills/
```

### Claude Agent SDK / other agents

Clone the repo and point your skill loader at:

```
halo_skills/plugins/halo-skills/skills/
```

Each subdirectory is a self-contained skill with a `SKILL.md` at its root.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). New skills start by copying [`plugins/halo-skills/SKILL_TEMPLATE.md`](./plugins/halo-skills/SKILL_TEMPLATE.md).

Every PR runs [`scripts/lint-skills.py`](./scripts/lint-skills.py) in CI. Run it locally before pushing:

```bash
python3 scripts/lint-skills.py
```

## License

[Apache License 2.0](./LICENSE).
