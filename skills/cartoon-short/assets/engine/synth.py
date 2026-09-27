# synth.py — procedural fallback audio for "O Lanche" v2 (no network, fully deterministic).
# Ported from v1_audio.py: Karplus-Strong ukulele, glockenspiel, babble voices and every cartoon SFX,
# now as pure functions keyed by the same cue ids used in sound_design.json / timeline.json.
#   render_cue(id, dur=None, seed=0)          -> mono float array (SR)
#   babble_line(text, ct, who, mood, seed)    -> mono float array starting at ct[0]
#   music(sections, dur, stinger, seed)       -> (N, 2) stereo float array
# Randomness only ever comes from np.random.default_rng(<fixed seed>), so output is bit-identical per run.
import zlib
import numpy as np
from scipy.signal import butter, sosfilt, lfilter

SR = 48000


# ─────────────────────────── helpers ───────────────────────────
def _rng(*key):
    """Deterministic RNG from any key (string/ints) — independent of call order."""
    return np.random.default_rng(zlib.crc32(repr(key).encode()))


def tt(d):
    return np.arange(max(1, int(d * SR))) / SR


def bp(x, lo, hi, o=2):
    hi = min(hi, SR / 2 * 0.95)
    return sosfilt(butter(o, [lo, hi], 'band', fs=SR, output='sos'), x)


def lp(x, f, o=2):
    return sosfilt(butter(o, min(f, SR / 2 * 0.95), 'low', fs=SR, output='sos'), x)


def hp(x, f, o=2):
    return sosfilt(butter(o, f, 'high', fs=SR, output='sos'), x)


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def sweep(f0, f1, d, shape='exp'):
    t = tt(d)
    f = f0 * (f1 / f0) ** (t / d) if shape == 'exp' else f0 + (f1 - f0) * t / d
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


def env(n, a=0.005, r=None):
    e = np.minimum(1, np.arange(n) / (a * SR + 1))
    if r:
        e = e * np.exp(-np.arange(n) / SR * r)
    return e


def edge_fade(x, fin=0.002, fout=0.004):
    """Raised-cosine fades on both ends so nothing ever starts/stops with a click."""
    x = np.array(x, dtype=float, copy=True)
    for n, sl in ((int(fin * SR), slice(None, None)), (int(fout * SR), slice(None, None, -1))):
        n = min(n, len(x) // 2)
        if n > 0:
            w = 0.5 - 0.5 * np.cos(np.pi * np.arange(n) / n)
            v = x[sl]
            v[:n] *= w if x.ndim == 1 else w[:, None]
    return x


class Buf:
    """Mono accumulation buffer with time-based add()."""

    def __init__(self, d):
        self.x = np.zeros(max(1, int(d * SR)))

    def add(self, sig, t, g=1.0):
        i = int(round(t * SR))
        if i < 0:
            sig, i = sig[-i:], 0
        j = min(len(self.x), i + len(sig))
        if j > i:
            self.x[i:j] += sig[: j - i] * g


class StereoBuf:
    def __init__(self, d):
        self.L = np.zeros(max(1, int(d * SR)))
        self.R = np.zeros_like(self.L)

    def add(self, sig, t, g=1.0, pan=0.0):
        i = int(round(t * SR))
        if i < 0:
            sig, i = sig[-i:], 0
        j = min(len(self.L), i + len(sig))
        if j <= i:
            return
        s = sig[: j - i] * g
        a = (np.clip(pan, -1, 1) + 1) * np.pi / 4                      # constant-power pan
        self.L[i:j] += s * np.cos(a) * 1.414
        self.R[i:j] += s * np.sin(a) * 1.414

    def out(self):
        return np.stack([self.L, self.R], 1)


# ─────────────────────────── instruments ───────────────────────────
def pluck(f, d=1.2, bright=0.5, damp=0.996, seed=0):
    """Karplus-Strong string (ukulele / bass): filtered noise burst in a damped delay loop."""
    n = max(2, int(SR / f))
    ex = lp(_rng('pluck', round(f, 2), seed).standard_normal(n), 1500 + 5000 * bright)
    x = np.zeros(int(d * SR))
    x[:n] = ex
    a = np.zeros(n + 2)
    a[0], a[n], a[n + 1] = 1, -damp / 2, -damp / 2
    y = lfilter([1], a, x)
    return edge_fade(y / (np.abs(y).max() + 1e-9) * env(len(y), 0.001), 0.0005, 0.03)


def glock(m, d=1.2):
    """Glockenspiel: sine + inharmonic 2.76x partial with fast decay."""
    t = tt(d)
    f = mtof(m)
    s = (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t * 6)) * np.exp(-t * 3.5)
    return edge_fade(s * env(len(t), 0.002))


def marimba(m, d=0.6):
    """Soft xylophone/marimba for the melody: fundamental + 4x partial + mallet click."""
    t = tt(d)
    f = mtof(m)
    s = np.sin(2 * np.pi * f * t) * np.exp(-t * 7) + 0.25 * np.sin(2 * np.pi * f * 3.93 * t) * np.exp(-t * 22)
    s += 0.08 * np.sin(2 * np.pi * f * 9.2 * t) * np.exp(-t * 90)
    return edge_fade(s * env(len(t), 0.0015))


def thud(f=110, d=0.18, seed=0):
    t = tt(d)
    nz = lp(_rng('thud', f, seed).standard_normal(len(t)), 1500)
    return edge_fade(sweep(f * 1.6, f, d) * np.exp(-t * 28) + 0.2 * nz * np.exp(-t * 80))


def noise_burst(d, lo, hi, k, seed=0):
    t = tt(d)
    return edge_fade(bp(_rng('nb', lo, hi, seed).standard_normal(len(t)), lo, hi) * np.exp(-t * k) * env(len(t), 0.002))


def whoosh_sig(d=0.25, lo=400, hi=3000, seed=0):
    t = tt(d)
    return edge_fade(bp(_rng('wh', lo, hi, seed).standard_normal(len(t)), lo, hi) * np.sin(np.pi * t / d) ** 2)


def slide_whistle(f0, f1, d, seed=0):
    t = tt(d)
    f = f0 + (f1 - f0) * (0.5 - 0.5 * np.cos(np.pi * t / d))
    f = f * (1 + 0.02 * np.sin(2 * np.pi * 6 * t))
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) + 0.03 * _rng('sw', seed).standard_normal(len(t))
    return edge_fade(lp(s, 4000) * np.minimum(1, t / 0.03) * np.minimum(1, (d - t) / 0.05))


# ─────────────────────────── babble voices ───────────────────────────
FORM = {'a': (800, 1250), 'e': (480, 1900), 'i': (320, 2300), 'o': (500, 950), 'u': (350, 800)}
DEACC = str.maketrans('áâãàéêíóôõúüç', 'aaaaeeiooouuc')
VOICE_F0 = {'leo': 230, 'bia': 330, 'léo': 230}
VOWELS = set('aeiou')
FRIC = set('sfvzxjc')          # hissy onsets
PLOS = set('ptkbdgq')          # clicky onsets


def syllable(f0, vowel, d=0.075, rise=1.0, seed=0):
    """One babble syllable: sawtooth glottal source through two formant band-passes."""
    t = tt(d)
    f = f0 * rise ** (t / d) * (1 + 0.03 * np.sin(2 * np.pi * 9 * t))
    ph = np.cumsum(f) / SR
    src = 2 * (ph % 1) - 1
    f1, f2 = FORM.get(vowel, (600, 1500))
    s = bp(src, f1 * 0.8, f1 * 1.25) + 0.6 * bp(src, f2 * 0.85, f2 * 1.15)
    if vowel not in FORM:
        s = s * 0.5 + 0.3 * noise_burst(d, 2000, 6000, 60, seed)
    # articulated envelope: quick 15 ms attack, sustain, release over the last ~40 % -> audible syllable gaps
    shape = np.minimum(1, t / 0.015) * np.clip((d - t) / (0.4 * d), 0, 1) ** 1.5 * (1 - 0.25 * t / d)
    return edge_fade(s * shape)


def _syllables(text):
    """Split text into syllables: (char index of onset, onset consonant, vowel nucleus)."""
    low = text.lower().translate(DEACC)
    out, i, n = [], 0, len(low)
    while i < n:
        if not low[i].isalpha():
            i += 1
            continue
        j = i
        while j < n and low[j].isalpha() and low[j] not in VOWELS:  # onset consonants
            j += 1
        if j >= n or not low[j].isalpha():                             # consonant cluster with no vowel
            out.append((i, low[i], 'e'))
            i = j
            continue
        k = j
        while k < n and low[k] in VOWELS:                              # vowel nucleus
            k += 1
        # a single following consonant before a vowel starts the next syllable; otherwise it's a coda
        if k < n and low[k].isalpha() and low[k] not in VOWELS and not (k + 1 < n and low[k + 1] in VOWELS):
            k += 1
        out.append((i, low[i] if i < j else '', low[j]))
        i = k
    return out


def babble_line(text, ct, who='leo', mood=None, seed=0):
    """Syllable babble synced to per-character times `ct` (absolute seconds). Returns (sig, t0)."""
    f0 = VOICE_F0.get(who.lower(), 280)
    if mood is None:
        mood = 'sad' if '...' in text else ('excited' if '!!' in text else 'happy')
    f0 *= {'sad': 0.85, 'excited': 1.12, 'kind': 1.0}.get(mood, 1.0)
    syl = _syllables(text)
    if not syl or not ct:
        return np.zeros(1), 0.0
    t0, t_end = ct[0], ct[-1] + 0.25
    buf = Buf(t_end - t0 + 0.4)
    for s_i, (ci, onset, vowel) in enumerate(syl):
        ts = ct[min(ci, len(ct) - 1)]
        nxt = ct[min(syl[s_i + 1][0], len(ct) - 1)] if s_i + 1 < len(syl) else ts + 0.16
        d = float(np.clip((nxt - ts) * 0.85, 0.06, 0.2))
        # phrase intonation: gentle declination, question lift near '?', random-ish wobble
        tail = text[ci:ci + 5]
        q = '?' in tail
        pos = s_i / max(1, len(syl) - 1)
        pitch = f0 * (1 + 0.1 * np.sin(s_i * 1.9 + seed)) * (1.06 - 0.12 * pos) * (1.22 if q else 1)
        if mood == 'sad':
            d = min(0.24, d * 1.15)
        g = 1.0
        if onset in FRIC:                                               # soft hiss before the vowel
            # kept ~8 dB under the vowels and band-limited to 4-8 kHz: louder bursts were the harshest
            # peaks in the whole voice stem (sibilance), made worse by mix.py's presence lift
            buf.add(noise_burst(0.045, 4000, 8000, 50, seed + s_i) * 0.15, ts - t0)
        elif onset in PLOS:                                             # little click
            buf.add(noise_burst(0.012, 1500, 5000, 250, seed + s_i) * 0.5, ts - t0)
        buf.add(syllable(pitch, vowel, d, 1.3 if q else (0.85 if mood == 'sad' else 1.0), seed + s_i), ts - t0 + 0.012, g)
    return buf.x, t0


# ─────────────────────────── SFX (keyed by cue id) ───────────────────────────
def _growl(seed):
    t = tt(0.8)
    n = lp(_rng('growl', seed).standard_normal(len(t)), 180)
    return edge_fade(n * (0.6 + 0.4 * np.sin(2 * np.pi * 22 * t)) * np.sin(np.pi * t / 0.8) * 3)


def _drizzle(d, seed):
    """Little rain cloud: soft band-limited shower + random droplet 'tiks' + a few pitched plinks (v1)."""
    r = _rng('drz', seed)
    t = tt(d)
    b = Buf(d)
    swell = np.minimum(1, t / 0.25) * np.minimum(1, (d - t) / 0.15)
    shower = bp(r.standard_normal(len(t)), 2500, 7000) * (0.7 + 0.3 * np.sin(2 * np.pi * 0.7 * t))
    b.add(shower * 0.012 * swell, 0)
    for _ in range(int(d * 28)):                                         # patter on the ground/hair
        t0 = r.uniform(0.05, d - 0.05)
        f = r.uniform(2200, 4200)
        b.add(np.sin(2 * np.pi * f * tt(0.02)) * np.exp(-tt(0.02) * 180) * r.uniform(0.01, 0.03), t0)
    for i in range(int((d - 0.15) / 0.1)):                               # v1 droplet plinks
        b.add(sweep(1800, 900, 0.03) * np.exp(-tt(0.03) * 60) * 0.03, 0.1 + i * 0.1 + (i % 3) * 0.02)
    return edge_fade(b.x, 0.01, 0.05)


def _birds(d, seed):
    b = Buf(max(d, 0.4))
    for i in range(int(max(1, (d - 0.2) / 0.3))):
        t0 = 0.3 * i + (i % 2) * 0.07
        b.add(sweep(2600, 4200, 0.07) * np.exp(-tt(0.07) * 20) * 0.16, t0)
        b.add(sweep(3000, 3800, 0.05) * 0.1, t0 + 0.09)
    return edge_fade(b.x)


def _sandwich_pop(seed):
    b = Buf(0.9)
    b.add(sweep(400, 900, 0.08) * np.exp(-tt(0.08) * 25) * 0.4, 0)
    b.add(glock(84, 0.8) * 0.2, 0.03)
    b.add(glock(88, 0.8) * 0.2, 0.12)
    return b.x / 0.4


def _bread_snap(seed):
    b = Buf(0.15)
    b.add(noise_burst(0.12, 1500, 6000, 45, seed), 0)
    b.add(noise_burst(0.06, 2500, 8000, 70, seed + 1) * 0.66, 0.04)
    return b.x


def _sparkle(seed):
    b = Buf(1.3)
    for i, m in enumerate((84, 88, 91, 96, 100)):
        b.add(glock(m, 1.0), i * 0.06)
    return b.x


def _boing(seed):
    t = tt(0.35)
    f = 180 * (1 + 1.5 * t / 0.35) * (1 + 0.12 * np.sin(2 * np.pi * 18 * t))
    return edge_fade(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 5))


def _bite(seed):
    b = Buf(0.16)
    b.add(noise_burst(0.07, 1500, 7000, 50, seed), 0)
    b.add(noise_burst(0.05, 1500, 7000, 60, seed + 1) * 0.66, 0.09)
    return b.x


def _dog_trot(d, seed):
    d = max(d, 0.1)
    b = Buf(d + 0.06)
    k, t0 = 0, 0.0
    while t0 < d:
        b.add(thud(260 + 20 * (k % 2), 0.06, seed + k), t0)
        t0 += 0.09
        k += 1
    return b.x


def _sniff(seed):
    b = Buf(0.12)
    for j in range(2):
        b.add(noise_burst(0.05, 3000, 9000, 40, seed + j), j * 0.06)
    return b.x


def _whimper(seed):
    t = tt(0.55)
    f = 900 + 400 * np.sin(np.pi * t / 0.55) + 30 * np.sin(2 * np.pi * 8 * t)
    return edge_fade(lp(np.sin(2 * np.pi * np.cumsum(f) / SR), 3000) * np.sin(np.pi * t / 0.55) ** 2)


def _giggle(seed):
    b = Buf(0.6)
    for i in range(5):
        b.add(syllable(VOICE_F0['leo'] * 1.2 * (1 + 0.05 * (i % 2)), 'a', 0.07, seed=seed + i), i * 0.085, 1.0)
        b.add(syllable(VOICE_F0['bia'] * 1.2 * (1 + 0.05 * (i % 3)), 'i', 0.07, seed=seed + 9 + i), 0.04 + i * 0.085, 0.89)
    return b.x


def _bark(seed):
    t = tt(0.17)
    f = np.interp(t, [0, 0.05, 0.17], [420, 720, 380])
    ph = np.cumsum(f) / SR
    src = 2 * (ph % 1) - 1
    s = bp(src, 500, 1100) + 0.7 * bp(src, 1300, 2200)
    return edge_fade(s * np.sin(np.pi * t / 0.17) ** 0.5)


def _fim_chord(seed):
    """'Ta-dá' accent: bright ukulele C chord + rising glock triad (the music stinger carries the bass)."""
    b = Buf(1.6)
    for k, m in enumerate([60, 64, 67, 72, 76]):
        b.add(pluck(mtof(m), 1.4, 0.6, seed=seed + k) * 0.2, k * 0.02)
    for i, m in enumerate((84, 88, 91)):
        b.add(glock(m, 1.0) * 0.2, 0.05 + i * 0.07)
    return b.x


# id -> fn(dur, seed). 'dur' matters only for loop-like cues (drizzle, dog_trot, birds).
CUES = {
    'iris_whistle_up':    lambda d, s: slide_whistle(400, 1200, 0.5, s),
    'birds':              lambda d, s: _birds(d or 2.2, s),
    'footstep':           lambda d, s: thud(140, 0.18, s),
    'page_flip':          lambda d, s: whoosh_sig(0.18, 1500, 7000, s),
    'look_up':            lambda d, s: edge_fade(sweep(500, 900, 0.1) * np.exp(-tt(0.1) * 20)),
    'book_thump':         lambda d, s: thud(180, 0.12, s),
    'tummy_growl':        lambda d, s: _growl(s),
    'cloud_poof':         lambda d, s: edge_fade(lp(noise_burst(0.3, 100, 1500, 12, s), 900)),
    'drizzle':            lambda d, s: _drizzle(d or 3.0, s),
    'whoosh':             lambda d, s: whoosh_sig(0.22, 300, 2000, s),
    'sandwich_pop':       lambda d, s: _sandwich_pop(s),
    'bread_snap':         lambda d, s: _bread_snap(s),
    'sparkle':            lambda d, s: _sparkle(s),
    'boing':              lambda d, s: _boing(s),
    'land_thud':          lambda d, s: thud(90, 0.2, s),
    'handoff_pop':        lambda d, s: edge_fade(sweep(600, 300, 0.1) * np.exp(-tt(0.1) * 20)),
    'bite':               lambda d, s: _bite(s),
    'dog_trot':           lambda d, s: _dog_trot(d or 0.45, s),
    'sniff':              lambda d, s: _sniff(s),
    'whimper':            lambda d, s: _whimper(s),
    'giggle':             lambda d, s: _giggle(s),
    'toss_whoosh':        lambda d, s: whoosh_sig(0.3, 800, 4000, s),
    'catch_chomp':        lambda d, s: noise_burst(0.06, 800, 4000, 50, s),
    'bark':               lambda d, s: _bark(s),
    'slide_whistle_down': lambda d, s: slide_whistle(1400, 280, 0.45, s),
    'wink_ting':          lambda d, s: glock(100, 0.6),
    'fim_chord':          lambda d, s: _fim_chord(s),
}
LOOPABLE = {'drizzle', 'dog_trot', 'birds'}


def render_cue(cue_id, dur=None, seed=0):
    """Synth version of a cue at its natural (v1) level, mono. Unknown ids -> tiny blip + warning."""
    fn = CUES.get(cue_id)
    if fn is None:
        print(f'[synth] unknown cue id {cue_id!r}; using a soft blip')
        return edge_fade(sweep(700, 1000, 0.08) * np.exp(-tt(0.08) * 25) * 0.2)
    return np.nan_to_num(np.asarray(fn(dur, seed), dtype=float))


# ─────────────────────────── music (ukulele underscore) ───────────────────────────
CH = {'C': [60, 64, 67, 72], 'G': [55, 62, 67, 71], 'Am': [57, 60, 64, 69], 'F': [53, 60, 65, 69],
      'Dm': [50, 57, 62, 65], 'E7': [52, 56, 62, 64]}
ROOT = {'C': 36, 'G': 43, 'Am': 45, 'F': 41, 'Dm': 38, 'E7': 40}
BEAT = 0.6                                  # 100 BPM; one chord = 2 beats (1.2 s), as in v1
# Per-mood chord loops + a simple xylophone tune (one 4-eighth cell per chord, None = rest).
PROG = {
    'happy':   [('C', [76, None, 79, 76]), ('G', [74, None, 71, 74]), ('Am', [72, None, 76, 72]), ('F', [69, 72, 77, None])],
    'happy2':  [('C', [79, 76, 72, 76]), ('F', [77, None, 81, 77]), ('G', [79, 74, 71, None]), ('C', [72, 76, 79, 84])],
    'sad':     [('Am', [76, None, None, None]), ('Dm', [74, None, None, None]), ('Am', [72, None, None, None]), ('E7', [71, None, None, None])],
    'curious': [('Dm', [74, None, 77, None]), ('G', [79, None, 74, None])],
}
STRUM = ((0, 0), (0.3, 0), (0.45, 1), (0.75, 1), (0.9, 0))    # D . D U . U D  (v1 island strum)


def _strum(sb, ch, t, g=0.16, up=False, b=0.55, seed=0):
    notes = CH[ch][::-1] if up else CH[ch]
    for k, m in enumerate(notes):
        sb.add(pluck(mtof(m), 1.1, b, seed=seed + k), t + k * 0.013, g * (0.7 if up else 1), (k - 1.5) * 0.25)


def music(sections, dur=15.0, stinger=None, seed=0):
    """Ukulele/xylophone underscore that follows timeline music.sections [{t, mood}], stereo (N,2).
    Each section renders into its own buffer and is 'choked' at its end: a short release before an
    'end' section (cartoon cut for the iris-out), a longer natural ring into the next mood."""
    total = StereoBuf(dur + 2.0)
    secs = sorted(sections or [{'t': 0, 'mood': 'happy'}], key=lambda s: s['t'])
    happy_seen = 0
    for si, sec in enumerate(secs):
        a = float(sec['t'])
        b = float(secs[si + 1]['t']) if si + 1 < len(secs) else (stinger if stinger else dur)
        mood = sec.get('mood', 'happy')
        if mood in ('end', 'silence', 'none') or b - a < 0.2:
            continue
        nxt = secs[si + 1].get('mood') if si + 1 < len(secs) else 'end'
        release = 0.2 if nxt in ('end', 'silence', 'none') else 0.9
        if mood == 'happy':
            key = 'happy2' if happy_seen else 'happy'
            happy_seen += 1
        else:
            key = mood if mood in PROG else 'happy'
        prog = PROG[key]
        sb = StereoBuf(dur + 2.0)
        t0, ci = a, 0
        while b - t0 >= BEAT - 1e-6:                                   # never start a chord in the last beat
            ch, tune = prog[ci % len(prog)]
            sd = seed * 100 + ci * 7 + si
            if key == 'sad':
                # slow broken-chord arpeggios, lonely glock line, soft low root
                tt0 = t0
                while tt0 < min(b, t0 + 2 * BEAT) - 0.05:
                    for k, m in enumerate(CH[ch]):
                        if tt0 + k * 0.15 < b:
                            sb.add(pluck(mtof(m), 1.3, 0.25, seed=sd + k), tt0 + k * 0.15, 0.1, (k - 1.5) * 0.3)
                    tt0 += BEAT
                sb.add(pluck(mtof(ROOT[ch]), 1.4, 0.15, 0.997, sd), t0, 0.24)
                if tune[0]:
                    g = glock(tune[0], 1.4)
                    g *= 1 + 0.08 * np.sin(2 * np.pi * 5 * tt(1.4))          # gentle tremolo = wistful
                    sb.add(g, t0 + 0.02, 0.07, 0.15)
            else:
                for off, up in STRUM:
                    if t0 + off < b - 0.05:
                        _strum(sb, ch, t0 + off, 0.17 if key == 'happy2' else 0.16, bool(up), seed=sd + int(off * 10))
                sb.add(pluck(mtof(ROOT[ch]), 1.2, 0.2, 0.997, sd), t0, 0.24)           # bass: root on 1
                if t0 + BEAT < b:
                    sb.add(pluck(mtof(ROOT[ch] + 7), 0.8, 0.2, 0.996, sd + 1), t0 + BEAT, 0.16)  # fifth on 3
                for k, m in enumerate(tune):                                  # xylophone melody
                    if m and t0 + k * 0.3 < b - 0.05:
                        sb.add(marimba(m, 0.7), t0 + k * 0.3, 0.075, 0.35)
                # shaker on eighths (v1 hi-hat noise), accents on the off-beats
                for e in range(8):
                    te = t0 + e * 0.15
                    if te < b - 0.05:
                        sb.add(noise_burst(0.04, 5000, 12000, 90, sd + e), te, 0.06 if e % 2 else 0.04, 0.4)
            t0 += 2 * BEAT
            ci += 1
        # choke: unity until b, then a raised-cosine release
        n = len(sb.L)
        tm = np.arange(n) / SR
        w = np.where(tm < b, 1.0, 0.5 + 0.5 * np.cos(np.pi * np.clip((tm - b) / release, 0, 1)))
        total.L += sb.L * w
        total.R += sb.R * w
    if stinger is not None and stinger < dur:
        # "button": ukulele C strum + low C, the classic cartoon end hit (V -> I after the happy loop)
        _strum(total, 'C', stinger, 0.2, False, 0.65, seed + 999)
        total.add(pluck(mtof(48), 1.4, 0.25, 0.998, seed + 998), stinger, 0.3)
        total.add(pluck(mtof(36), 1.4, 0.2, 0.997, seed + 997), stinger, 0.18)
    out = total.out()[: int(dur * SR)]
    out = sosfilt(butter(2, 45, 'high', fs=SR, output='sos'), out, axis=0)    # keep the low end light
    return np.nan_to_num(out)
