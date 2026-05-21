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

All skills live under `plugins/halo-skills/skills/<skill-name>/SKILL.md`. Each `SKILL.md` is a self-contained Markdown file with YAML frontmatter (`name`, `description`) followed by the skill body. How you wire that into your agent depends on the runtime.

### Claude Code (marketplace)

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

For agents without native skill discovery (Cursor, Continue, Aider, custom LangChain/LlamaIndex agents, raw API clients, etc.):

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
