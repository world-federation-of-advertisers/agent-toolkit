#!/usr/bin/env python3
"""Build halo-skills.zip for GitHub Releases.

Produces a single zip containing the skills/ directory tree, ready for users
to download from the Releases page and unzip into their agent's skill directory.

Output: dist/halo-skills.zip
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


def should_include(path: Path) -> bool:
    parts = set(path.parts)
    if parts & EXCLUDE_NAMES:
        return False
    if path.suffix in EXCLUDE_SUFFIXES:
        return False
    return True


def main() -> int:
    if not SKILLS_DIR.is_dir():
        print(f"error: {SKILLS_DIR} does not exist", file=sys.stderr)
        return 1

    if DIST_DIR.exists():
        shutil.rmtree(DIST_DIR)
    DIST_DIR.mkdir(parents=True)

    out = DIST_DIR / "halo-skills.zip"
    file_count = 0
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(SKILLS_DIR.rglob("*")):
            if not path.is_file():
                continue
            rel = path.relative_to(SKILLS_DIR)
            if not should_include(rel):
                continue
            arcname = Path("skills") / rel
            zf.write(path, arcname.as_posix())
            file_count += 1

    if file_count == 0:
        print("error: no skill files found", file=sys.stderr)
        return 1

    size_kb = out.stat().st_size / 1024
    print(f"  {out.relative_to(REPO_ROOT)}  ({file_count} files, {size_kb:,.1f} KB)")
    print(f"\nUpload dist/halo-skills.zip to the GitHub Releases page.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
