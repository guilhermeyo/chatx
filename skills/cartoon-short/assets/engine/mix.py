#!/usr/bin/env python3
"""mix.py — final soundtrack for "O Lanche" v2: timeline.json -> mix.wav (48 kHz stereo 16-bit, exactly `dur` s).

Sources, each with an automatic fallback so the film ALWAYS gets a soundtrack (any undecodable, empty,
stale or inconsistent asset is logged and replaced by the procedural version; mix.py never dies on an asset):
  voices  assets/voice/<id>.mp3 (+ .json alignment; ElevenLabs or voices_free.py)  else  synth babble on lines[].ct
          A character's lines are a unit: if one of them has no usable take from the same engine+voice as the
          others, ALL of that character's lines babble (mix.voice_unit 'character'; 'all' = whole cast).
  sfx     assets/sfx/<cue id>.mp3 (ElevenLabs, manifest hash == current prompt)   else  synth.render_cue(id)
  music   assets/music/score.mp3 (Eleven Music, manifest hash == current plan)     else  synth.music(sections)
ElevenLabs SFX are loudness-matched to the synth version of the same cue, so sound_design.json levels
hold for either source. Music is sidechain-ducked under dialogue; an ElevenLabs score is faded out just
before the stinger so the fim_chord cue is the film's only "ta-da".
Master: HPF/LPF -> capped tanh glue -> integrated loudness to mix.loudness_lufs (ITU-R BS.1770-4) ->
look-ahead true-peak limiter at mix.true_peak_dbtp (4x oversampled) -> fades. Same loudness for every source.

Voice pitch ("cartoon kid" lift): each voice asset is pitched by voices.<who>.pitch_factor with ffmpeg
`rubberband` (formant 'shifted' or 'preserved', duration kept within ~2 ms), falling back to
asetrate+atempo when rubberband is unavailable. Duration is kept because lines[].ct / the lip-sync in
film.js come from the alignment timestamps.
TIMING CONTRACT: audio file t=0 is placed at line.start + line.audio_offset (default 0), so plan.py must
write ct[k] = line.start + audio_offset + alignment.start[k]. mix.py measures where speech really falls
(-40 dB of each take's peak) and WARNS on overlapping lines, speech past line.end + 0.3 s, or a first
syllable more than 0.12 s off its ct; `--report file.json` exports the measured spans for plan.py/film.

  python3 mix.py [--timeline timeline.json] [--out mix.wav] [--fallback] [--stems DIR] [--assets DIR]
                 [--report report.json]
"""
import argparse
import json
import os
import subprocess
import sys
import wave

import numpy as np
from scipy.ndimage import minimum_filter1d, uniform_filter1d
from scipy.signal import butter, lfilter, resample_poly, sosfilt, sosfiltfilt

import synth
from synth import SR

try:                                   # request hashes / manifest checks shared with the generator
    import eleven
except Exception:                      # pragma: no cover — mix must work even if eleven.py is broken
    eleven = None

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, 'assets')                                  # overridable with --assets
MIN_S = 0.05                                                            # shorter decodes count as missing
WARN = []                                                               # collected warnings (also in --report)


def log(*a):
    print('[mix]', *a, flush=True)


def warn(msg):
    WARN.append(msg)
    log('WARNING ' + msg)


# ───────────────────────── audio utils ─────────────────────────
def ffmpeg_exe():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return 'ffmpeg'


def _ff(path, af, channels):
    cmd = [ffmpeg_exe(), '-v', 'error', '-i', path, '-af', ','.join(af), '-ac', str(channels), '-ar', str(SR),
           '-f', 'f32le', '-']
    raw = subprocess.run(cmd, check=True, capture_output=True, timeout=120).stdout
    return np.nan_to_num(np.frombuffer(raw, dtype='<f4').astype(np.float64).reshape(-1, channels))


def decode(path, channels=2, pitch=1.0, formant='shifted', engine='rubberband'):
    """Decode any audio file to float64 (n, channels) at 48 kHz via ffmpeg, with an optional
    duration-preserving pitch shift. Raises on failure (see load_audio for the safe wrapper)."""
    if abs(pitch - 1.0) <= 1e-3:
        return _ff(path, ['aresample=48000'], channels)
    if engine == 'rubberband':
        try:
            return _ff(path, ['aresample=48000', f'rubberband=pitch={pitch:.6f}:formant={formant}:pitchq=quality'],
                       channels)
        except subprocess.CalledProcessError as e:
            if b'rubberband' not in e.stderr.lower() and b'filter' not in e.stderr.lower():
                raise                                                   # the file itself is bad
            log('rubberband unavailable — pitch via asetrate+atempo')
    return _ff(path, ['aresample=48000', f'asetrate={int(round(48000 * pitch))}', 'aresample=48000',
                      f'atempo={1.0 / pitch:.6f}'], channels)


def load_audio(path, what, **kw):
    """decode() that never raises: undecodable / empty / silent files -> None (logged)."""
    try:
        x = decode(path, **kw)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, ValueError, OSError) as e:
        err = getattr(e, 'stderr', b'') or b''
        warn(f'{what}: cannot decode {os.path.relpath(path, HERE)} '
             f'({err.decode("utf-8", "replace").strip().splitlines()[-1:] or type(e).__name__}) — fallback')
        return None
    if len(x) < MIN_S * SR or np.abs(x).max() < 1e-4:
        warn(f'{what}: {os.path.relpath(path, HERE)} is empty/silent ({len(x) / SR:.3f}s) — fallback')
        return None
    return x


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


def active_span(sig, thresh_db=-40, hop=0.01):
    """(start, end) seconds of the part of sig within thresh_db of its loudest 10 ms frame."""
    m = np.abs(sig if sig.ndim == 1 else sig.max(1))
    h = int(hop * SR)
    k = max(1, len(m) // h)
    e = np.sqrt(np.mean(np.pad(m, (0, max(0, k * h - len(m))))[: k * h].reshape(k, h) ** 2, 1))
    idx = np.nonzero(e > e.max() * db(thresh_db))[0]
    return (idx[0] * hop, (idx[-1] + 1) * hop) if len(idx) else (0.0, 0.0)


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


def manifest(kind):
    return eleven.Manifest(kind, ASSETS) if eleven else None


# ───────────────────────── voices ─────────────────────────
def _meta(mp3):
    try:
        m = json.load(open(mp3[:-4] + '.json', encoding='utf-8'))
        return m if isinstance(m, dict) else None
    except (OSError, ValueError):
        return None


def engine_of(meta):
    """Which engine + voice produced a take: ('elevenlabs', voice_id) / ('edge-tts', voice) / ('unknown', ..)."""
    if not meta:
        return ('unknown', '')
    src = meta.get('source') or ('edge-tts' if 'voice' in meta else 'unknown')
    who = meta.get('voice_id') or json.dumps(meta.get('voice'), sort_keys=True)
    return (src, who or '')


def voice_take(line, vman):
    """(path, engine) of the take for this line, or (None, reason). Takes whose text differs from the line,
    or ElevenLabs takes whose bytes no longer match eleven.py's manifest (overwritten by another tool), are rejected."""
    cands = []
    own = os.path.join(ASSETS, 'voice', f"{line['id']}.mp3")
    if line.get('audio'):
        p = line['audio'] if os.path.isabs(line['audio']) else os.path.join(HERE, line['audio'])
        cands = [own, p] if ASSETS != os.path.join(HERE, 'assets') else [p, own]
    else:
        cands = [own]
    reason = 'no voice file'
    for p in dict.fromkeys(cands):
        if not os.path.exists(p):
            continue
        m = _meta(p)
        if m is None and not line.get('audio'):
            reason = f'{os.path.relpath(p, HERE)} has no alignment json'
            continue
        said = (m.get('text') or ''.join(m.get('characters', []))) if m else line['text']
        if ' '.join(said.split()) != ' '.join(line['text'].split()):
            reason = f'{os.path.relpath(p, HERE)} says {said!r}, line is {line["text"]!r}'
            continue
        eng = engine_of(m)
        if eng[0] == 'elevenlabs' and vman is not None and os.path.dirname(p) == vman.dir \
                and vman.valid(line['id']) is None:
            reason = f'{os.path.relpath(p, HERE)} claims ElevenLabs but its bytes do not match the manifest'
            continue
        return p, eng
    return None, reason


def render_voices(tl, cfg, n, fallback):
    """Returns (voice bus, text report, spans). spans: per line {id, who, src, t0, span:[a,b]} (absolute s)."""
    bus = Bus(n)
    target = db(cfg['mix']['voice_rms_dbfs'])
    use_audio = tl.get('voice', True) and not fallback
    lines = tl.get('lines', [])
    unit = cfg['mix'].get('voice_unit', 'character')
    vman = manifest('voice')
    inc = os.path.join(ASSETS, 'voice', 'INCOMPLETE.json')
    if use_audio and os.path.exists(inc):
        try:
            log('eleven.py marked the voice set incomplete: ' + ', '.join(sorted(json.load(open(inc, encoding='utf-8')).get('failed', {}))))
        except (OSError, ValueError, AttributeError):
            pass

    # 1) pick + decode every take
    takes = {}                                                           # id -> (sig, path, engine) | None
    for line in lines:
        who = line['who'].lower().replace('é', 'e')
        vc = cfg['voices'].get(who, {})
        if not use_audio:
            takes[line['id']] = None
            continue
        path, eng = voice_take(line, vman)
        if path is None:
            log(f"{line['id']}: {eng}")
            takes[line['id']] = None
            continue
        x = load_audio(path, f"voice {line['id']}", channels=1, pitch=vc.get('pitch_factor', 1.0),
                       formant=vc.get('formant', 'shifted'), engine=cfg['mix'].get('pitch_engine', 'rubberband'))
        takes[line['id']] = None if x is None else (x[:, 0], path, eng)

    # 2) a character's voice is a unit: all lines real from one engine+voice, else all babble
    if use_audio:
        by_who = {}
        for line in lines:
            by_who.setdefault(line['who'].lower().replace('é', 'e'), []).append(line['id'])
        broken = {}
        for who, ids in by_who.items():
            missing = [i for i in ids if takes[i] is None]
            engines = {takes[i][2] for i in ids if takes[i] is not None}
            if missing and len(missing) < len(ids):
                broken[who] = f'no usable take for {", ".join(missing)}'
            elif len(engines) > 1:
                broken[who] = 'takes come from different engines/voices: ' + '; '.join(f'{a} {b[:24]}' for a, b in sorted(engines))
        if broken and unit == 'all':
            broken = {w: broken.get(w, 'another character is incomplete (voice_unit=all)') for w in by_who}
        for who, why in broken.items():
            warn(f'{who}: {why} — babbling ALL of {who}\'s lines so the character keeps one voice')
            for i in by_who[who]:
                takes[i] = None

    # 3) place
    report, spans = [], []
    for line in lines:
        who = line['who'].lower().replace('é', 'e')
        vc = cfg['voices'].get(who, {})
        pan, gain = vc.get('pan', 0.0), vc.get('gain', 1.0) * line.get('gain', 1.0)
        take = takes.get(line['id'])
        if take:
            sig, path, eng = take
            sig = sosfilt(sos('high', 90), sig)
            sig = sig + 0.12 * sosfilt(sos('high', 3000), sig)            # a little presence for clarity
            sig = fades(sig * target / grms(sig) * gain)
            t0 = line['start'] + line.get('audio_offset', 0.0)
            src = f'VOICE {eng[0]}'
            report.append(f"{line['id']} {who}: VOICE {os.path.relpath(path, HERE)} [{eng[0]}] "
                          f"pitch x{vc.get('pitch_factor', 1.0)} ({len(sig) / SR:.2f}s @ {t0:.2f})")
        else:
            sig, t0 = synth.babble_line(line['text'], line.get('ct') or [line['start']], who, line.get('mood'),
                                        seed=sum(map(ord, line.get('id', 'x'))))
            sig = fades(sig * target / grms(sig) * cfg['mix'].get('babble_gain', 0.8) * gain)
            src = 'babble'
            report.append(f"{line['id']} {who}: babble ({len(sig) / SR:.2f}s @ {t0:.2f})")
        a, b = active_span(sig)
        spans.append(dict(id=line['id'], who=who, src=src, t0=round(t0, 4), span=[round(t0 + a, 3), round(t0 + b, 3)],
                          start=line.get('start'), end=line.get('end')))
        bus.add(to_stereo(sig, pan), t0)
    check_spans(lines, spans)
    return bus.x, report, spans


def check_spans(lines, spans):
    """Warn about talking over each other, speech running past line.end, or a lip-sync offset."""
    by_id = {l['id']: l for l in lines}
    order = sorted(spans, key=lambda s: s['span'][0])
    for s, nxt in zip(order, order[1:]):
        if s['span'][1] > nxt['span'][0] - 0.05:
            warn(f"{s['id']} speech ends {s['span'][1]:.2f}s but {nxt['id']} starts {nxt['span'][0]:.2f}s "
                 f"(overlap {s['span'][1] - nxt['span'][0]:+.2f}s)")
    for s in spans:
        line = by_id[s['id']]
        if line.get('end') is not None and s['span'][1] > line['end'] + 0.3:
            warn(f"{s['id']} speech runs to {s['span'][1]:.2f}s, past line.end {line['end']:.2f}s + 0.3")
        ct = line.get('ct') or []
        k = next((i for i, ch in enumerate(line['text']) if ch.isalpha()), None)
        if s['src'] != 'babble' and k is not None and k < len(ct) and abs(s['span'][0] - ct[k]) > 0.12:
            warn(f"{s['id']} first syllable at {s['span'][0]:.2f}s but ct says {ct[k]:.2f}s (lip-sync drift)")


# ───────────────────────── sfx ─────────────────────────
def sfx_asset(cid, cfg, man):
    """Path of a fresh ElevenLabs SFX for this cue, else None. 'Fresh' = manifest hash equals the request the
    CURRENT prompt would make and the file bytes are the ones eleven.py wrote."""
    p = os.path.join(ASSETS, 'sfx', f'{cid}.mp3')
    if not os.path.exists(p) or man is None or cid not in man.d:
        return None
    if cid not in cfg['sfx']:
        return None
    if man.valid(cid, eleven.sfx_request(cfg, cid)[3]) is None:
        warn(f'sfx {cid}: stale asset (prompt changed or file modified) — using synth')
        return None
    return p


def render_sfx(tl, cfg, n, fallback):
    bus = Bus(n)
    report = {}
    cache = {}
    man = None if fallback else manifest('sfx')
    for k, cue in enumerate(tl.get('cues', [])):
        cid = cue['id']
        spec = cfg['sfx'].get(cid, {})
        dur = cue.get('dur')
        seed = int(cue['t'] * 1000) + k
        ref = synth.render_cue(cid, dur, seed)                           # synth version = loudness reference
        path = None if fallback else sfx_asset(cid, cfg, man)
        if path and path not in cache:
            x = load_audio(path, f'sfx {cid}', channels=2)
            cache[path] = None if x is None else trim_lead(x)
        sig = cache.get(path) if path else None
        if sig is not None:
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


def score_asset(tl, cfg):
    """Fresh ElevenLabs score path, else None (missing, stale plan, or bytes not from eleven.py)."""
    p = os.path.join(ASSETS, 'music', 'score.mp3')
    if not os.path.exists(p):
        return None
    man = manifest('music')
    if man is None or man.valid('score', eleven.music_request(cfg, tl)[4]) is None:
        warn('music: stale score.mp3 (timeline sections/stinger or prompt changed) — using synth')
        return None
    return p


def render_music(tl, cfg, n, fallback):
    m = tl.get('music') or {}
    dur = n / SR
    stinger = m.get('stinger', cfg['music'].get('default_stinger'))
    p = None if fallback else score_asset(tl, cfg)
    x = load_audio(p, 'music', channels=2) if p else None
    if x is not None:
        x = x[:n]
        x = np.pad(x, ((0, n - len(x)), (0, 0)))
        x = fades(x, 0.01, 0.05)
        if stinger:                                                      # fim_chord is the only button:
            a, fo = int((stinger - 0.05) * SR), int(0.3 * SR)            # score gone by stinger + 0.25 s
            if 0 < a < n:
                w = np.zeros(n - a)
                k = min(fo, n - a)
                w[:k] = 0.5 + 0.5 * np.cos(np.pi * np.arange(k) / fo)
                x[a:] *= w[:, None]
        src = 'eleven'
    else:
        x = synth.music(m.get('sections') or cfg['music']['default_sections'], dur, stinger)
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


def lufs(x):
    """Integrated loudness, ITU-R BS.1770-4 (48 kHz K-weighting, 400 ms blocks / 75 % overlap, -70 LUFS
    absolute and -10 LU relative gates). x: (n, 2)."""
    b1, a1 = [1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585]
    b2, a2 = [1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621]
    k = lfilter(b2, a2, lfilter(b1, a1, x, axis=0), axis=0)
    blk, hop = int(0.4 * SR), int(0.1 * SR)
    if len(k) < blk:
        return -70.0
    c = np.concatenate([np.zeros((1, k.shape[1])), np.cumsum(k ** 2, 0)])
    starts = np.arange(0, len(k) - blk + 1, hop)
    z = ((c[starts + blk] - c[starts]) / blk).sum(1)                    # sum of channel mean squares
    lk = -0.691 + 10 * np.log10(z + 1e-20)
    z = z[lk > -70]
    if not len(z):
        return -70.0
    rel = -0.691 + 10 * np.log10(z.mean()) - 10
    z = z[-0.691 + 10 * np.log10(z) > rel]
    return float(-0.691 + 10 * np.log10(z.mean()))


def true_peak_env(x, os_=4):
    """Per-sample true peak (max |x| over the 4x-oversampled points belonging to each sample, all channels)."""
    y = resample_poly(x, os_, 1, axis=0)
    return np.abs(y[: len(x) * os_]).reshape(len(x), os_, -1).max(axis=(1, 2))


def limiter(x, ceil_dbtp, look=0.005, release=0.05):
    """Look-ahead true-peak limiter (offline): the gain at n never exceeds the gain every true peak within
    +-look needs; release is a one-pole recovery, then a boxcar of the same width smooths the attack."""
    thr = db(ceil_dbtp)
    req = np.minimum(1.0, thr / (true_peak_env(x) + 1e-12))
    if req.min() >= 1.0:
        return x, 0.0
    L = int(look * SR)
    h = minimum_filter1d(req, 2 * L + 1, mode='nearest')
    a = 1 - np.exp(-1.0 / (release * SR))
    g = np.empty_like(h)
    e = 1.0
    hl = h.tolist()
    for i, v in enumerate(hl):                                          # instant attack (look-ahead), slow release
        e = v if v < e else e + (1 - e) * a
        if e > v:
            e = v
        g[i] = e
    g = uniform_filter1d(g, 2 * L + 1, mode='nearest')
    return x * g[:, None], float(-20 * np.log10(g.min()))


def master(x, cfg):
    mx = cfg['mix']
    x = sosfiltfilt(sos('high', 30), x, axis=0)                          # DC + rumble
    x = sosfiltfilt(sos('low', 16000), x, axis=0)
    # glue: tanh with the 99.9th percentile at 0.8 — drive capped so the loudest peak sees at most 1.28
    pk = np.abs(x).max() + 1e-9
    ref = max(np.percentile(np.abs(x), 99.9), pk / 1.6) + 1e-9
    x = np.tanh(x * 0.8 / ref)
    # fades before measuring: the film's last 0.35 s rings out
    n = len(x)
    f = np.ones(n)
    fi, fo = int(0.01 * SR), int(mx.get('fade_out_s', 0.35) * SR)
    f[:fi] = 0.5 - 0.5 * np.cos(np.pi * np.arange(fi) / fi)
    f[-fo:] = 0.5 + 0.5 * np.cos(np.pi * np.arange(fo) / fo)
    x = x * f[:, None]
    target, ceil = mx.get('loudness_lufs', -14.0), mx.get('true_peak_dbtp', -1.5) - 0.1   # 0.1 dB dither margin
    y, gr = x, 0.0
    for _ in range(3):                             # limiting lowers the loudness a little: re-aim, re-limit
        err = target - lufs(y)
        if abs(err) < 0.05:
            break
        x = x * db(err)
        y, gr = limiter(x, ceil)
    return y, gr


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
    ap.add_argument('--report', help='write measured voice spans, sources, loudness and warnings as JSON')
    args = ap.parse_args()
    globals()['ASSETS'] = os.path.abspath(args.assets)
    if not os.path.exists(args.timeline):
        sys.exit(f'[mix] {args.timeline} not found (run plan.py first)')
    tl = json.load(open(args.timeline, encoding='utf-8'))
    cfg = json.load(open(args.design, encoding='utf-8'))
    dur = float(tl.get('dur', 15.0))
    n = int(round(dur * SR))

    voice, vrep, spans = render_voices(tl, cfg, n, args.fallback)
    sfx, srep = render_sfx(tl, cfg, n, args.fallback)
    music, msrc = render_music(tl, cfg, n, args.fallback)
    sfx = sfx * db(cfg['mix'].get('sfx_bus_db', 0.0))
    music = music * duck_gain(voice, cfg, n)[:, None]
    dry = voice + sfx + music
    mix, gr = master(dry + room(voice + sfx, cfg['mix'].get('room_send', 0.08)), cfg)

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
    loud, tp = lufs(mix), 20 * np.log10(true_peak_env(mix).max() + 1e-12)
    log(f'wrote {os.path.relpath(args.out, HERE) if args.out.startswith(HERE) else args.out}: {dur:.2f}s, '
        f'{loud:.1f} LUFS, true peak {tp:.2f} dBTP, limiter {gr:.1f} dB, {len(WARN)} warning(s)')
    if args.report:
        json.dump(dict(voice=spans, sfx=srep, music=msrc, lufs=round(loud, 2), true_peak_dbtp=round(tp, 2),
                       limiter_db=round(gr, 2), warnings=WARN), open(args.report, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
