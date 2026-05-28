#!/usr/bin/env python3
"""Build one .zip per skill for upload to Claude Desktop's Skills feature.

Each zip contains a single top-level folder named after the skill, with
SKILL.md at its root and any scripts/, references/, examples/ subfolders
preserved. Junk files (.DS_Store, __pycache__, *.pyc, .gitkeep) are excluded.

Output: dist/<skill-name>.zip
Run:    python3 scripts/build-skill-zips.py
"""

from __future__ import annotations

import shutil
import sys
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = REPO_ROOT / "plugins" / "halo-skills" / "skills"
DIST_DIR = REPO_ROOT / "dist"

EXCLUDE_NAMES = {".DS_Store", ".gitkeep", ".gitignore", "__pycache__"}
EXCLUDE_SUFFIXES = {".pyc"}


def should_include(path: Path) -> bool:
    parts = set(path.parts)
    if parts & EXCLUDE_NAMES:
        return False
    if path.suffix in EXCLUDE_SUFFIXES:
        return False
    return True


def build_zip(skill_dir: Path, out_path: Path) -> int:
    skill_name = skill_dir.name
    file_count = 0
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(skill_dir.rglob("*")):
            if not path.is_file():
                continue
            rel = path.relative_to(skill_dir)
            if not should_include(rel):
                continue
            arcname = Path(skill_name) / rel
            zf.write(path, arcname.as_posix())
            file_count += 1
    return file_count


def main() -> int:
    if not SKILLS_DIR.is_dir():
        print(f"error: {SKILLS_DIR} does not exist", file=sys.stderr)
        return 1

    if DIST_DIR.exists():
        shutil.rmtree(DIST_DIR)
    DIST_DIR.mkdir(parents=True)

    skill_dirs = sorted(p for p in SKILLS_DIR.iterdir() if p.is_dir())
    if not skill_dirs:
        print("error: no skills found", file=sys.stderr)
        return 1

    for skill_dir in skill_dirs:
        out = DIST_DIR / f"{skill_dir.name}.zip"
        n = build_zip(skill_dir, out)
        size_kb = out.stat().st_size / 1024
        print(f"  {out.relative_to(REPO_ROOT)}  ({n} files, {size_kb:,.1f} KB)")

    print(f"\nBuilt {len(skill_dirs)} skill zip(s) in {DIST_DIR.relative_to(REPO_ROOT)}/")
    print("Upload each .zip to Claude Desktop via Settings -> Capabilities -> Skills.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
