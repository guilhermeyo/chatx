#!/usr/bin/env python3
"""mix.py — final soundtrack for "O Lanche" v2: timeline.json -> mix.wav (48 kHz stereo 16-bit, exactly `dur` s).

Sources, each with an automatic fallback so the film always has sound:
  voices  assets/voice/<id>.mp3 (+ .json alignment; ElevenLabs or voices_free.py)  else  synth babble on lines[].ct
  sfx     assets/sfx/<cue id>.mp3 (ElevenLabs)                                    else  synth.render_cue(id)
  music   assets/music/score.mp3 (Eleven Music)                                   else  synth.music(sections)
ElevenLabs SFX are loudness-matched to the synth version of the same cue, so sound_design.json levels
hold for either source. Music is sidechain-ducked under dialogue. Master: HPF/LPF, soft clip, -1 dBFS peak.

Voice pitch ("cartoon kid" lift): each voice asset is pitched up by voices.<who>.pitch_factor
(~1.08-1.12) with ffmpeg `asetrate` (formants rise too -> younger, rounder, more "animated" timbre than a
formant-preserving shift) followed by `atempo` = 1/factor, so the DURATION IS PRESERVED. We keep duration
because lines[].ct / the lip-sync in film.js come from the alignment timestamps; a tape-speed shift would
drift the mouths by ~10 %.  Audio file t=0 is placed at line.start (+ optional line.audio_offset).

  python3 mix.py [--timeline timeline.json] [--out mix.wav] [--fallback] [--stems DIR] [--assets DIR]
"""
import argparse
import json
import os
import subprocess
import sys
import wave

import numpy as np
from scipy.signal import butter, sosfilt, sosfiltfilt

import synth
from synth import SR

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, 'assets')                                  # overridable with --assets


def log(*a):
    print('[mix]', *a, flush=True)


# ───────────────────────── audio utils ─────────────────────────
def ffmpeg_exe():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return 'ffmpeg'


def decode(path, channels=2, pitch=1.0):
    """Decode any audio file to float32 (n, channels) at 48 kHz via ffmpeg; optional duration-preserving pitch."""
    af = ['aresample=48000']
    if abs(pitch - 1.0) > 1e-3:
        af += [f'asetrate={int(round(48000 * pitch))}', 'aresample=48000', f'atempo={1.0 / pitch:.6f}']
    cmd = [ffmpeg_exe(), '-v', 'error', '-i', path, '-af', ','.join(af), '-ac', str(channels), '-ar', str(SR),
           '-f', 'f32le', '-']
    raw = subprocess.run(cmd, check=True, capture_output=True).stdout
    return np.nan_to_num(np.frombuffer(raw, dtype='<f4').astype(np.float64).reshape(-1, channels))


def db(x):
    return 10 ** (x / 20)


def grms(x, gate_db=-45):
    """Gated RMS: RMS over 20 ms blocks louder than gate_db below the loudest block (ignores silence)."""
    m = x if x.ndim == 1 else x.mean(1)
    n = int(0.02 * SR)
    k = max(1, len(m) // n)
    blocks = np.sqrt(np.mean(m[: k * n].reshape(k, n) ** 2, 1) + 1e-20) if len(m) >= n else np.array([np.sqrt(np.mean(m ** 2) + 1e-20)])
    keep = blocks[blocks > blocks.max() * db(gate_db)]
    return float(np.sqrt(np.mean(keep ** 2))) if len(keep) else 1e-10


def trim_lead(x, thresh_db=-40):
    """Drop leading silence (ElevenLabs SFX often start with a few ms of air) so hits land on the cue."""
    m = np.abs(x if x.ndim == 1 else x.max(1))
    idx = np.nonzero(m > m.max() * db(thresh_db))[0]
    return x[max(0, idx[0] - int(0.003 * SR)):] if len(idx) else x


def loop_fill(x, n, xf=0.06):
    """Repeat x (n_samples, ch) to length n with equal-power crossfades of xf seconds (seamless loops)."""
    k = min(int(xf * SR), len(x) // 3)
    if len(x) >= n or k < 1:
        return x[:n]
    w = np.sin(0.5 * np.pi * np.arange(k) / k)[:, None]
    out = x.copy()
    while len(out) < n:
        head = out[:-k]
        seam = out[-k:] * w[::-1] + x[:k] * w
        out = np.concatenate([head, seam, x[k:]])
    return out[:n]


def fades(x, fin=0.003, fout=0.012):
    return synth.edge_fade(x, fin, fout)


def to_stereo(x, pan=0.0):
    """Mono -> constant-power panned stereo; stereo -> balance-panned."""
    a = (np.clip(pan, -1, 1) + 1) * np.pi / 4
    gl, gr = np.cos(a) * 1.414, np.sin(a) * 1.414
    if x.ndim == 1:
        return np.stack([x * gl, x * gr], 1)
    return np.stack([x[:, 0] * min(1, gl), x[:, 1] * min(1, gr)], 1)


class Bus:
    def __init__(self, n):
        self.x = np.zeros((n, 2))

    def add(self, sig, t):
        i = int(round(t * SR))
        if i < 0:
            sig, i = sig[-i:], 0
        j = min(len(self.x), i + len(sig))
        if j > i:
            self.x[i:j] += sig[: j - i]


def sos(kind, f, order=2):
    return butter(order, f, kind, fs=SR, output='sos')


# ───────────────────────── voices ─────────────────────────
def voice_asset(line):
    """Path of a usable voice file for this line, or None. Stale files (text changed) are rejected."""
    p = line.get('audio')
    if p:
        p = p if os.path.isabs(p) else os.path.join(HERE, p)
        return p if os.path.exists(p) else None
    mp3 = os.path.join(ASSETS, 'voice', f"{line['id']}.mp3")
    meta = mp3[:-4] + '.json'
    if not (os.path.exists(mp3) and os.path.exists(meta)):
        return None
    try:
        m = json.load(open(meta))
        said = m.get('text') or ''.join(m.get('characters', []))
    except ValueError:
        return None
    if ' '.join(said.split()) != ' '.join(line['text'].split()):
        log(f"{line['id']}: voice asset text {said!r} != line text — ignoring it")
        return None
    return mp3


def render_voices(tl, cfg, n, fallback):
    bus = Bus(n)
    target = db(cfg['mix']['voice_rms_dbfs'])
    use_audio = tl.get('voice', True) and not fallback
    report = []
    for line in tl.get('lines', []):
        who = line['who'].lower().replace('é', 'e')
        vc = cfg['voices'].get(who, {})
        pan, gain = vc.get('pan', 0.0), vc.get('gain', 1.0) * line.get('gain', 1.0)
        path = voice_asset(line) if use_audio else None
        if path:
            sig = decode(path, 1, vc.get('pitch_factor', 1.0))[:, 0]
            sig = sosfilt(sos('high', 90), sig)
            sig = sig + 0.12 * sosfilt(sos('high', 3000), sig)            # a little presence for clarity
            sig = fades(sig * target / grms(sig) * gain)
            t0 = line['start'] + line.get('audio_offset', 0.0)
            report.append(f"{line['id']} {who}: VOICE {os.path.relpath(path, HERE)} pitch x{vc.get('pitch_factor', 1.0)} ({len(sig) / SR:.2f}s @ {t0:.2f})")
        else:
            sig, t0 = synth.babble_line(line['text'], line.get('ct') or [line['start']], who, line.get('mood'),
                                        seed=sum(map(ord, line.get('id', 'x'))))
            sig = fades(sig * target / grms(sig) * cfg['mix'].get('babble_gain', 0.8) * gain)
            report.append(f"{line['id']} {who}: babble ({len(sig) / SR:.2f}s @ {t0:.2f})")
        bus.add(to_stereo(sig, pan), t0)
    return bus.x, report


# ───────────────────────── sfx ─────────────────────────
def sfx_asset(cid):
    man = os.path.join(ASSETS, 'sfx', 'manifest.json')
    p = os.path.join(ASSETS, 'sfx', f'{cid}.mp3')
    if not os.path.exists(p):
        return None
    try:
        return p if cid in json.load(open(man)) else None               # only files eleven.py produced
    except (OSError, ValueError):
        return None


def render_sfx(tl, cfg, n, fallback):
    bus = Bus(n)
    report = {}
    cache = {}
    for k, cue in enumerate(tl.get('cues', [])):
        cid = cue['id']
        spec = cfg['sfx'].get(cid, {})
        dur = cue.get('dur')
        seed = int(cue['t'] * 1000) + k
        ref = synth.render_cue(cid, dur, seed)                           # synth version = loudness reference
        path = None if fallback else sfx_asset(cid)
        if path:
            if path not in cache:
                cache[path] = trim_lead(decode(path, 2))
            sig = cache[path]
            if dur and (spec.get('loopable') or cid in synth.LOOPABLE):  # fill the requested span
                sig = loop_fill(sig, int(dur * SR))
            limit = int(((dur or spec.get('dur', 1.0)) + 0.6) * SR)       # keep tails from smearing the mix
            sig = fades(sig[:limit], 0.002, 0.08) * min(4.0, max(0.05, grms(ref) / grms(sig)))
            src = 'eleven'
        else:
            sig, src = ref, 'synth'
        g = spec.get('level', 0.3) * cue.get('gain', 1.0)
        bus.add(to_stereo(fades(sig, 0.001, 0.01) * g, cue.get('pan', 0.0)), cue['t'])
        report[cid] = src
    return bus.x, report


# ───────────────────────── music ─────────────────────────
def duck_gain(voice, cfg, n):
    """Sidechain: music gain curve from the dialogue envelope (attack/release smoothed, in 5 ms frames)."""
    d = cfg['music']['duck']
    hop = int(0.005 * SR)
    m = np.abs(voice).max(1)
    k = n // hop + 1
    frames = np.zeros(k)
    mm = np.pad(m, (0, k * hop - len(m)))[: k * hop].reshape(k, hop)
    frames[:] = np.sqrt(np.mean(mm ** 2, 1))
    thr = db(cfg['mix']['voice_rms_dbfs']) * 0.5
    target = np.clip(frames / thr, 0, 1)
    a_up = 1 - np.exp(-0.005 / d['attack_s'])
    a_dn = 1 - np.exp(-0.005 / d['release_s'])
    env, e = np.zeros(k), 0.0
    for i, v in enumerate(target):                                       # asymmetric one-pole follower
        e += (v - e) * (a_up if v > e else a_dn)
        env[i] = e
    # look-ahead of 40 ms so the dip starts just before the first syllable
    env = np.maximum(env, np.concatenate([env[8:], np.zeros(8)]))
    g = db(-d['depth_db'] * env)
    return np.interp(np.arange(n), np.arange(k) * hop, g)


def render_music(tl, cfg, n, fallback):
    m = tl.get('music') or {}
    dur = n / SR
    p = os.path.join(ASSETS, 'music', 'score.mp3')
    if not fallback and os.path.exists(p):
        x = decode(p, 2)[:n]
        x = np.pad(x, ((0, n - len(x)), (0, 0)))
        x = fades(x, 0.01, 0.05)                                         # master does the final fade
        src = 'eleven'
    else:
        x = synth.music(m.get('sections') or cfg['music']['default_sections'], dur,
                        m.get('stinger', cfg['music'].get('default_stinger')))
        src = 'synth'
    x = x * db(cfg['music']['level_rms_dbfs']) / grms(x)
    return x, src


# ───────────────────────── master ─────────────────────────
def room(x, send):
    """Tiny deterministic 'park air' early reflections (different L/R taps) for glue."""
    if send <= 0:
        return np.zeros_like(x)
    out = np.zeros_like(x)
    mono = sosfilt(sos('low', 5000), x.mean(1))
    for ch, taps in enumerate(([13, 29, 41, 61, 83], [17, 23, 47, 67, 89])):
        for j, ms in enumerate(taps):
            dly = int(ms * SR / 1000)
            out[dly:, ch] += mono[:-dly] * send * 0.7 ** j
    return out


def master(x, peak_dbfs):
    x = sosfiltfilt(sos('high', 30), x, axis=0)                          # DC + rumble
    x = sosfiltfilt(sos('low', 16000), x, axis=0)
    # soft clip: bring the 99.9th percentile to 0.8, tanh saturation only touches the rare transients
    ref = np.percentile(np.abs(x), 99.9) + 1e-9
    x = np.tanh(x * 0.8 / ref) / np.tanh(1.0)
    x *= db(peak_dbfs) / (np.abs(x).max() + 1e-9)
    n = len(x)
    f = np.ones(n)
    fi, fo = int(0.01 * SR), int(0.15 * SR)
    f[:fi] = np.linspace(0, 1, fi)
    f[-fo:] = np.linspace(1, 0, fo) ** 2
    return x * f[:, None]


def write_wav(path, x, seed=7):
    tpdf = np.random.default_rng(seed)                                   # deterministic dither
    d = (tpdf.random(x.shape) - tpdf.random(x.shape)) / 32767
    pcm = np.clip(np.round((x + d) * 32767), -32768, 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--timeline', default=os.path.join(HERE, 'timeline.json'))
    ap.add_argument('--out', default=os.path.join(HERE, 'mix.wav'))
    ap.add_argument('--design', default=os.path.join(HERE, 'sound_design.json'))
    ap.add_argument('--fallback', action='store_true', help='ignore all assets; procedural audio only')
    ap.add_argument('--stems', help='also write voice/sfx/music stems into this dir')
    ap.add_argument('--assets', default=ASSETS, help='asset root (voice/, sfx/, music/)')
    args = ap.parse_args()
    globals()['ASSETS'] = os.path.abspath(args.assets)
    if not os.path.exists(args.timeline):
        sys.exit(f'[mix] {args.timeline} not found (run plan.py first)')
    tl = json.load(open(args.timeline))
    cfg = json.load(open(args.design))
    dur = float(tl.get('dur', 15.0))
    n = int(round(dur * SR))

    voice, vrep = render_voices(tl, cfg, n, args.fallback)
    sfx, srep = render_sfx(tl, cfg, n, args.fallback)
    music, msrc = render_music(tl, cfg, n, args.fallback)
    sfx = sfx * db(cfg['mix'].get('sfx_bus_db', 0.0))
    music = music * duck_gain(voice, cfg, n)[:, None]
    dry = voice + sfx + music
    mix = master(dry + room(voice + sfx, cfg['mix'].get('room_send', 0.08)), cfg['mix']['peak_dbfs'])

    assert mix.shape == (n, 2) and np.isfinite(mix).all()
    write_wav(args.out, mix)
    if args.stems:
        os.makedirs(args.stems, exist_ok=True)
        k = 1.0 / max(1.0, max(np.abs(s).max() for s in (voice, sfx, music)) / db(-1))   # one common scale
        for name, s in (('voice', voice), ('sfx', sfx), ('music', music)):
            write_wav(os.path.join(args.stems, f'{name}.wav'), s * k)
    for r in vrep:
        log(r)
    by = {}
    for cid, src in srep.items():
        by.setdefault(src, []).append(cid)
    for src, ids in by.items():
        log(f'sfx {src}: {", ".join(ids)}')
    log(f'music: {msrc}')
    pk = 20 * np.log10(np.abs(mix).max())
    log(f'wrote {os.path.relpath(args.out, HERE) if args.out.startswith(HERE) else args.out}: {dur:.2f}s, '
        f'peak {pk:.2f} dBFS, rms {20 * np.log10(grms(mix)):.1f} dBFS')


if __name__ == '__main__':
    main()
