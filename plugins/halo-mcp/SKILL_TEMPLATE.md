# Skill Template

Copy this file to `skills/<skill-name>/SKILL.md` when authoring a new skill. Replace placeholders and delete the instructional comments.

The template is intentionally **outside** `skills/` so it does not auto-load into agents. Do not create files named `SKILL.md` anywhere except inside a `skills/<skill-name>/` directory.

---

```markdown
---
name: skill-name-with-hyphens
description: Use when [specific triggering conditions and symptoms — NOT a summary of what the skill does]
---

# Skill Name

## Overview
One or two sentences. What is this and what is the core principle?

## When to Use
- Symptom or situation 1
- Symptom or situation 2

When NOT to use: [edge cases that look similar but aren't a fit]

## Quick Reference
Table or short bullet list a reader can scan in 10 seconds.

## Implementation
Concrete steps, commands, or a short worked example.

## Common Mistakes
- Mistake 1 — what goes wrong, how to fix
- Mistake 2 — what goes wrong, how to fix
```

## Rules

1. **`name`** uses only lowercase letters, digits, and hyphens. It must match the directory name.
2. **`description`** starts with "Use when..." and describes *triggering conditions only*. Never summarize the workflow — agents will follow the description and skip the body.
3. **One `SKILL.md` per directory.** No extra `SKILL.md` files at other depths.
4. **Target under 500 words.** Skills that load frequently should be even tighter (under 200 words).
5. **No narrative storytelling** (no "in session X we found..."). Skills are reusable references, not changelogs.
