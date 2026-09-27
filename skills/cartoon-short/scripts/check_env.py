#!/usr/bin/env python3
"""Check (and with --install, install) everything a cartoon-short project needs.

    python check_env.py <project_dir> [--install]

Needs: Python 3.9+ with numpy, scipy, edge-tts, certifi, imageio-ffmpeg (ffmpeg binary comes from
imageio-ffmpeg, no system ffmpeg needed); Node.js 18+ with the `playwright` package in the project and
its Chromium browser. Works on Windows, macOS and Linux.
"""
import argparse, importlib.util, os, shutil, subprocess, sys

PY = {'numpy': 'numpy', 'scipy': 'scipy', 'edge_tts': 'edge-tts', 'certifi': 'certifi', 'imageio_ffmpeg': 'imageio-ffmpeg'}


def run(cmd, cwd=None):
    print('  $', ' '.join(cmd))
    return subprocess.run(cmd, cwd=cwd, shell=(os.name == 'nt')).returncode == 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('project')
    ap.add_argument('--install', action='store_true')
    a = ap.parse_args()
    proj, ok = os.path.abspath(a.project), True

    missing = [pip for mod, pip in PY.items() if importlib.util.find_spec(mod) is None]
    if missing:
        print('python packages missing:', ', '.join(missing))
        if a.install and run([sys.executable, '-m', 'pip', 'install', *missing]):
            missing = []
        ok &= not missing
    else:
        print('python packages: ok')

    node = shutil.which('node')
    if not node:
        print('Node.js not found: install Node 18+ from https://nodejs.org and re-run'); return 1
    ver = subprocess.run([node, '--version'], capture_output=True, text=True).stdout.strip()
    print('node', ver)
    if int(ver.lstrip('v').split('.')[0]) < 18:
        print('Node 18+ required'); ok = False

    npm, npx = shutil.which('npm'), shutil.which('npx')
    if not os.path.isdir(os.path.join(proj, 'node_modules', 'playwright')):
        print('playwright not installed in the project')
        if a.install and npm and run([npm, 'install'], cwd=proj):
            pass
        else:
            ok = False
    else:
        print('playwright: ok')
    if a.install and npx:
        run([npx, 'playwright', 'install', 'chromium'], cwd=proj)   # no-op when already installed

    try:
        import imageio_ffmpeg
        print('ffmpeg:', imageio_ffmpeg.get_ffmpeg_exe())
    except Exception as e:
        print('ffmpeg unavailable:', e); ok = False
    print('ELEVENLABS_API_KEY:', 'set (ElevenLabs voices/SFX/music)' if os.environ.get('ELEVENLABS_API_KEY') else 'not set (free pt-BR voices + procedural audio)')
    print('READY' if ok else 'NOT READY — run again with --install')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
