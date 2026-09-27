#!/usr/bin/env python3
"""Build a cartoon-short project.

    python build.py <project_dir>                     full build → <project_dir>/<name>.mp4
    python build.py <project_dir> --stills 1.2,4,7.5  render just those moments → contact.jpg (fast review)
    python build.py <project_dir> --audio             voices + timeline + mix.wav only
Options: --workers N (parallel Chromium renderers, default = CPUs up to 6), --no-voice (skip TTS; babble),
         --out FILE.

Pipeline: voices (ElevenLabs if ELEVENLABS_API_KEY is set, else free pt-BR edge-tts) → plan.py
(timeline.json/.js from script.json + real voice timings) → ElevenLabs SFX/music (if key) → frames
(render.mjs, parallel) → mix.py (mix.wav) → ffmpeg (grain + vignette, H.264 + AAC).
"""
import argparse, json, os, shutil, subprocess, sys, glob


def sh(cmd, cwd, check=True):
    r = subprocess.run(cmd, cwd=cwd)
    if check and r.returncode:
        sys.exit(f'failed ({r.returncode}): {" ".join(map(str, cmd))}')
    return r.returncode


def ffmpeg():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('project')
    ap.add_argument('--stills')
    ap.add_argument('--audio', action='store_true')
    ap.add_argument('--no-voice', action='store_true')
    ap.add_argument('--workers', type=int, default=min(6, os.cpu_count() or 4))
    ap.add_argument('--out')
    a = ap.parse_args()
    P, py, node = os.path.abspath(a.project), sys.executable, shutil.which('node') or 'node'
    key = os.environ.get('ELEVENLABS_API_KEY')

    if not a.stills and not a.no_voice:
        print('== voices')
        if key:
            sh([py, 'eleven.py', '--only', 'voice'], P, check=False)
        else:
            sh([py, 'voices_free.py', 'script.json'], P, check=False)
    print('== timeline')
    sh([py, 'plan.py'], P)
    tl = json.load(open(os.path.join(P, 'timeline.json'), encoding='utf-8'))
    n = round(tl['dur'] * tl['fps'])

    if a.stills:
        st = os.path.join(P, 'stills')
        shutil.rmtree(st, ignore_errors=True)
        sh([node, 'render.mjs', 'stills', a.stills, 'stills'], P)
        shots = sorted(glob.glob(os.path.join(st, 'f*.jpg')))
        for i, f in enumerate(shots):                     # sequential names → portable ffmpeg pattern
            os.replace(f, os.path.join(st, f's{i:03d}.jpg'))
        k = len(shots); cols = min(4, k)
        sh([ffmpeg(), '-loglevel', 'error', '-y', '-i', os.path.join(st, 's%03d.jpg'),
            '-vf', f'scale=640:-1,tile={cols}x{(k + cols - 1) // cols}', '-frames:v', '1', os.path.join(P, 'contact.jpg')], P, check=False)
        print('stills in', st, '| contact sheet:', os.path.join(P, 'contact.jpg'))
        return

    if key and not a.audio:
        print('== ElevenLabs sfx/music')
        sh([py, 'eleven.py', '--only', 'sfx,music'], P, check=False)
    if not a.audio:
        print(f'== frames ({n}, {a.workers} workers)')
        fr = os.path.join(P, 'frames'); shutil.rmtree(fr, ignore_errors=True)
        step = (n + a.workers - 1) // a.workers
        procs = [subprocess.Popen([node, 'render.mjs', 'frames', str(s), str(min(n, s + step)), 'frames'], cwd=P) for s in range(0, n, step)]
        if any(p.wait() for p in procs):
            sys.exit('frame rendering failed (see PAGE ERROR above)')
    print('== mix')
    sh([py, 'mix.py'], P)
    if a.audio:
        return
    out = a.out or os.path.join(P, os.path.basename(P.rstrip('/\\')) + '.mp4')
    print('== encode')
    sh([ffmpeg(), '-loglevel', 'error', '-y', '-framerate', str(tl['fps']), '-i', os.path.join('frames', 'f%04d.jpg'), '-i', 'mix.wav',
        '-vf', 'noise=alls=4:allf=t,vignette=PI/6,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18',
        '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', out], P)
    print('done:', out)


if __name__ == '__main__':
    main()
