#!/usr/bin/env python3
"""Create a cartoon-short project folder: the shared engine + the "O Lanche" example episode to adapt.

    python new_project.py <project_dir> [--force]

The project is self-contained: engine files (core/props/sets/rig/dog .js, audio .py, render.mjs) plus the
story files you edit (script.json, plan.py, film.js). Voice clips of the example are included so the
example builds offline; they are ignored automatically once the dialogue text changes.
"""
import argparse, os, shutil, sys

SKILL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('project')
    ap.add_argument('--force', action='store_true', help='overwrite engine files in an existing folder (keeps story files)')
    a = ap.parse_args()
    dst = os.path.abspath(a.project)
    if os.path.exists(dst) and os.listdir(dst) and not a.force:
        sys.exit(f'{dst} is not empty (use --force to refresh the engine files only)')
    os.makedirs(dst, exist_ok=True)
    shutil.copytree(os.path.join(SKILL, 'assets', 'engine'), dst, dirs_exist_ok=True)
    ex = os.path.join(SKILL, 'assets', 'example')
    for root, _, files in os.walk(ex):
        for f in files:
            src = os.path.join(root, f)
            out = os.path.join(dst, os.path.relpath(src, ex))
            if a.force and os.path.exists(out):
                continue                       # never clobber the user's story files
            os.makedirs(os.path.dirname(out), exist_ok=True)
            shutil.copy2(src, out)
    print(f'project ready: {dst}')
    print(f'next: python "{os.path.join(SKILL, "scripts", "check_env.py")}" "{dst}" --install')


if __name__ == '__main__':
    main()
