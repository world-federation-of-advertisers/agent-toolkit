#!/usr/bin/env python3
"""Build one .zip per skill for GitHub Releases.

For each skill directory under plugins/halo-mcp/skills/, produce
dist/<skill-name>.zip in the Agent Skills layout:

    <skill-name>.zip
    └── <skill-name>/
        ├── SKILL.md              # required
        ├── scripts/              # optional
        ├── references/           # optional
        └── assets/               # optional

Every entry is rooted under <skill-name>/ so the archive unpacks to a single
self-contained directory the user can drop into their agent's skill directory.

Output: dist/<skill-name>.zip (one per skill)
Run:    python3 scripts/build-skill-zips.py
"""

from __future__ import annotations

import shutil
import sys
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = REPO_ROOT / "plugins" / "halo-mcp" / "skills"
DIST_DIR = REPO_ROOT / "dist"

EXCLUDE_NAMES = {".DS_Store", ".gitkeep", ".gitignore", "__pycache__"}
EXCLUDE_SUFFIXES = {".pyc"}


def should_include(rel: Path) -> bool:
    if set(rel.parts) & EXCLUDE_NAMES:
        return False
    if rel.suffix in EXCLUDE_SUFFIXES:
        return False
    return True


def skill_dirs() -> list[Path]:
    """Skill directories that contain a SKILL.md, sorted by name."""
    return sorted(
        d for d in SKILLS_DIR.iterdir() if d.is_dir() and (d / "SKILL.md").is_file()
    )


def build_zip(skill_dir: Path) -> tuple[Path, int]:
    name = skill_dir.name
    out = DIST_DIR / f"{name}.zip"
    file_count = 0
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(skill_dir.rglob("*")):
            if not path.is_file():
                continue
            rel = path.relative_to(skill_dir)
            if not should_include(rel):
                continue
            # Root each entry under <skill-name>/ so the zip has a single top dir.
            zf.write(path, (Path(name) / rel).as_posix())
            file_count += 1
    return out, file_count


def main() -> int:
    if not SKILLS_DIR.is_dir():
        print(f"error: {SKILLS_DIR} does not exist", file=sys.stderr)
        return 1

    skills = skill_dirs()
    if not skills:
        print(f"error: no skills with a SKILL.md found under {SKILLS_DIR}", file=sys.stderr)
        return 1

    if DIST_DIR.exists():
        shutil.rmtree(DIST_DIR)
    DIST_DIR.mkdir(parents=True)

    for skill_dir in skills:
        out, count = build_zip(skill_dir)
        if count == 0:
            print(f"error: {skill_dir.name} has no includable files", file=sys.stderr)
            return 1
        size_kb = out.stat().st_size / 1024
        print(f"  {out.relative_to(REPO_ROOT)}  ({count} files, {size_kb:,.1f} KB)")

    print(f"\nBuilt {len(skills)} skill zip(s) in dist/. Upload them to the GitHub Releases page.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
