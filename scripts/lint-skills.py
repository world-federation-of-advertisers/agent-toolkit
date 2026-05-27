#!/usr/bin/env python3
"""Validate every SKILL.md in the repo.

Checks:
  1. File lives at plugins/<plugin>/skills/<skill-name>/SKILL.md
  2. Frontmatter parses and has `name` and `description`
  3. `name` matches ^[a-z0-9-]+$
  4. `name` equals the parent directory name
  5. `description` starts with "Use when" (case-insensitive)
  6. Word count <= 500 (warning only)

Exit code 0 on success, 1 on any error.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS_GLOB = "plugins/*/skills/*/SKILL.md"

NAME_RE = re.compile(r"^[a-z0-9-]+$")
FRONTMATTER_RE = re.compile(r"\A---\r?\n(.*?)\r?\n---(?:\r?\n|\Z)", re.DOTALL)
KEY_RE = re.compile(r"^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$")
WORD_LIMIT = 500


def parse_frontmatter(text: str) -> dict[str, str] | None:
    match = FRONTMATTER_RE.match(text)
    if not match:
        return None
    fields: dict[str, str] = {}
    for line in match.group(1).splitlines():
        line = line.rstrip()
        if not line or line.startswith("#"):
            continue
        m = KEY_RE.match(line)
        if not m:
            continue
        key, value = m.group(1), m.group(2).strip()
        if (value.startswith('"') and value.endswith('"')) or (
            value.startswith("'") and value.endswith("'")
        ):
            value = value[1:-1]
        fields[key] = value
    return fields


def lint_skill(path: Path) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    rel = path.relative_to(REPO_ROOT)

    text = path.read_text(encoding="utf-8")
    fields = parse_frontmatter(text)
    if fields is None:
        errors.append(f"{rel}: missing or malformed YAML frontmatter")
        return errors, warnings

    name = fields.get("name")
    description = fields.get("description")

    if not name:
        errors.append(f"{rel}: frontmatter missing `name`")
    elif not NAME_RE.match(name):
        errors.append(
            f"{rel}: `name` '{name}' must match ^[a-z0-9-]+$ (lowercase, digits, hyphens)"
        )

    parent_dir = path.parent.name
    if name and name != parent_dir:
        errors.append(
            f"{rel}: `name` '{name}' does not match parent directory '{parent_dir}'"
        )

    if not description:
        errors.append(f"{rel}: frontmatter missing `description`")
    elif not description.lower().startswith("use when"):
        errors.append(
            f"{rel}: `description` must start with 'Use when' (got: {description[:60]!r})"
        )

    body = FRONTMATTER_RE.sub("", text, count=1)
    word_count = len(body.split())
    if word_count > WORD_LIMIT:
        warnings.append(
            f"{rel}: body is {word_count} words (target <= {WORD_LIMIT})"
        )

    return errors, warnings


def main() -> int:
    skill_files = sorted(REPO_ROOT.glob(SKILLS_GLOB))
    if not skill_files:
        print("No SKILL.md files found yet. Skipping lint.")
        return 0

    all_errors: list[str] = []
    all_warnings: list[str] = []
    for path in skill_files:
        errs, warns = lint_skill(path)
        all_errors.extend(errs)
        all_warnings.extend(warns)

    for w in all_warnings:
        print(f"warning: {w}")
    for e in all_errors:
        print(f"error:   {e}", file=sys.stderr)

    print(
        f"\nLinted {len(skill_files)} skill(s): "
        f"{len(all_errors)} error(s), {len(all_warnings)} warning(s)"
    )
    return 1 if all_errors else 0


if __name__ == "__main__":
    sys.exit(main())
