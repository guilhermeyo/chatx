# Beat-synced score + sound design for the reel. 120 BPM, 15 s.
import numpy as np, wave
from scipy.signal import butter, sosfilt
SR = 48000; DUR = 15.0; N = int(SR * DUR); BEAT = 0.5
rng = np.random.default_rng(7)
L = np.zeros(N); R = np.zeros(N)
def at(t): return int(t * SR)
def add(sig, t, gain=1.0, pan=0.0):
    i = at(t); j = min(N, i + len(sig)); s = sig[: j - i] * gain
    L[i:j] += s * np.sqrt(0.5 * (1 - pan)) * 1.414; R[i:j] += s * np.sqrt(0.5 * (1 + pan)) * 1.414
def tt(d): return np.arange(int(d * SR)) / SR
def bp(x, lo, hi, o=2): return sosfilt(butter(o, [lo, hi], 'band', fs=SR, output='sos'), x)
def lp(x, f, o=2): return sosfilt(butter(o, f, 'low', fs=SR, output='sos'), x)
def hp(x, f, o=2): return sosfilt(butter(o, f, 'high', fs=SR, output='sos'), x)
def mtof(m): return 440 * 2 ** ((m - 69) / 12)

def kick(d=0.45):
    t = tt(d); f = 45 + 130 * np.exp(-t * 28); ph = 2 * np.pi * np.cumsum(f) / SR
    return np.tanh(2.2 * np.sin(ph) * np.exp(-t * 7)) + 0.3 * hp(rng.standard_normal(len(t)), 3000) * np.exp(-t * 180)
def hat(d=0.06, k=90):
    t = tt(d); return hp(rng.standard_normal(len(t)), 7000) * np.exp(-t * k)
def clap():
    t = tt(0.25); n = bp(rng.standard_normal(len(t)), 900, 3500)
    env = sum(np.exp(-np.clip(t - o, 0, None) * 60) * (t >= o) for o in (0, 0.011, 0.023)) * 0.6 + np.exp(-t * 18) * 0.5
    return n * env
def whoosh(d=0.45, rev=True):
    t = tt(d); n = rng.standard_normal(len(t))
    lo = lp(n, 900); mid = bp(n, 1200, 5000); x = t / d
    env = (x ** 2.5) if rev else np.exp(-x * 5)
    return (lo * (1 - x) + mid * x) * env * 0.9
def impact():
    t = tt(1.2); f = 30 + 70 * np.exp(-t * 12)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 3.2)
    return np.tanh(1.8 * boom) + lp(rng.standard_normal(len(t)), 2500) * np.exp(-t * 14) * 0.5
def blip(f0, f1, d=0.14):
    t = tt(d); f = f0 * (f1 / f0) ** (t / d)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 22) * np.minimum(1, t * 800)
def tick(f=3200):
    t = tt(0.025); return np.sin(2 * np.pi * f * t) * np.exp(-t * 300)
def pad(notes, d, bright=1.0):
    t = tt(d); out = np.zeros(len(t))
    for m in notes:
        for det in (-0.08, 0.0, 0.08):
            f = mtof(m + det); out += sum(np.sin(2 * np.pi * f * h * t + h) / h ** 1.6 for h in range(1, 7))
    env = np.minimum(1, t / 0.08) * np.minimum(1, (d - t) / 0.15).clip(0)
    return lp(out, 1800 * bright) * env / (len(notes) * 3)

# chords per 2s section (A minor-ish)
SECT = [(1.5, [57, 60, 64, 71]), (3.5, [53, 57, 60, 64]), (5.5, [48, 55, 60, 64]), (7.5, [55, 59, 62, 66]),
        (9.5, [57, 60, 64, 67]), (11.5, [53, 57, 60, 67])]
ROOT = {1.5: 33, 3.5: 29, 5.5: 36, 7.5: 31, 9.5: 33, 11.5: 29}

# ── intro heartbeat (0–1.5)
for b in (0.02, 0.5, 1.0): add(kick(0.5), b, 0.55)
add(blip(900, 1800, 0.2), 0.02, 0.15)
add(whoosh(0.5), 1.0, 0.7)
add(blip(200, 3000, 0.5) * 0.5, 1.0, 0.25)

# ── groove (1.5–13.0)
for i in range(int((13.0 - 1.5) / BEAT)):
    b = 1.5 + i * BEAT
    add(kick(), b, 0.85)
    add(hat(), b + 0.25, 0.22, 0.3)
    if b >= 3.5 and (i % 2 == 1): add(clap(), b, 0.45, -0.1)
    if b >= 5.5: add(hat(0.03, 160), b + 0.125, 0.1, -0.4); add(hat(0.03, 160), b + 0.375, 0.1, 0.4)
# bass 8ths with sidechain feel
for s0, root in ROOT.items():
    for k in range(8):
        t0 = s0 + k * 0.25; tb = tt(0.23); f = mtof(root + (12 if k % 4 == 3 else 0))
        sig = np.tanh(1.5 * (np.sin(2 * np.pi * f * tb) + 0.3 * np.sin(4 * np.pi * f * tb))) * np.minimum(1, tb * 60) * np.exp(-tb * 5)
        add(lp(sig, 700), t0 + 0.02, 0.38)
for s0, ch in SECT: add(pad(ch, 2.0, 1.4 if s0 in (9.5,) else 1.0), s0, 0.32)

# ── FX & sync points
for b in (1.5, 3.5, 5.5, 7.5, 9.5, 11.5): add(impact(), b, 0.55); add(whoosh(0.4), b - 0.4, 0.45, 0.2)
# type: scramble ticks + print slams
for i in range(20): add(tick(2400 + (i % 5) * 400), 2.6 + i * 0.026, 0.18, (i % 3 - 1) * 0.5)
add(blip(160, 60, 0.3), 2.0, 0.4); add(blip(180, 70, 0.3), 2.5, 0.3)
add(whoosh(0.35), 3.15, 0.5, -0.5); add(whoosh(0.45, False), 3.5, 0.45, 0.5)
# morph blips (pitched up the chord)
for k, (t0, m) in enumerate([(3.5, 69), (4.0, 72), (4.5, 76), (5.0, 79), (5.25, 84)]):
    add(blip(mtof(m) * 0.5, mtof(m), 0.22), t0, 0.28, (k % 2 - 0.5) * 0.8)
add(whoosh(0.3), 5.2, 0.6)
# tile ripples → dense ticks by distance
for w0, ox, oy, dl in ((5.52, 7.5, 4, 0.04), (6.42, 0, 0, 0.034), (6.92, 15, 8, 0.02)):
    ds = sorted({round(np.hypot(x - ox, y - oy), 1) for x in range(16) for y in range(9)})
    for d in ds[::3]: add(tick(1800 + d * 90), w0 + d * dl, 0.08, np.clip((d - 8) / 10, -0.8, 0.8))
for i in range(6): add(blip(500, 1200, 0.1), 6.4 + i * 0.045, 0.1, (i - 2.5) * 0.25)
# 3D: shimmering arpeggio
arp = [69, 72, 76, 79, 83, 79, 76, 72]
for i in range(16):
    t0 = 7.5 + i * 0.125; tb = tt(0.2); f = mtof(arp[i % 8] + 12)
    add(np.sin(2 * np.pi * f * tb) * np.exp(-tb * 18), t0, 0.1, np.sin(i) * 0.7)
add(whoosh(0.45) , 9.05, 0.8)
# fluid: wobbly low sine sweeps on beats
for i in range(4):
    t0 = 9.5 + i * 0.5; tb = tt(0.45); f = 110 * (1 + 0.3 * np.sin(2 * np.pi * 7 * tb))
    add(lp(np.tanh(np.sin(2 * np.pi * np.cumsum(f) / SR) * 2) * np.exp(-tb * 5), 900), t0, 0.22)
add(whoosh(0.3), 11.2, 0.7)
# montage: stutter hits on each cut
for k in range(6):
    t0 = 11.5 + k * 0.25; add(impact()[: int(0.24 * SR)], t0, 0.35)
    add(blip(mtof(60 + k * 2), mtof(72 + k * 2), 0.12), t0, 0.2, (k % 2 - 0.5))
    for s in range(4): add(hat(0.03, 200), t0 + s * 0.0625, 0.18, 0.5 - s * 0.3)
# riser into MAKE IT MOVE
tb = tt(1.0); x = tb / 1.0
riser = (bp(rng.standard_normal(len(tb)), 2000, 8000) * 0.5 + np.sin(2 * np.pi * np.cumsum(200 * 8 ** x) / SR) * 0.4) * x ** 2
add(riser, 12.0, 0.45)
for w0 in (13.0, 13.125, 13.25): add(kick(0.3), w0, 0.9); add(clap(), w0, 0.4)
add(whoosh(0.15), 13.35, 0.9)

# ── end card
add(impact(), 13.5, 0.9)
add(pad([57, 64, 69, 71, 76], 1.5, 1.8), 13.5, 0.55)
add(blip(1200, 2400, 0.3), 13.74, 0.2)
for i in range(31): add(tick(3800), 14.12 + i * 0.0155, 0.07)
tb = tt(1.2); chime = sum(np.sin(2 * np.pi * mtof(m) * tb) * np.exp(-tb * (3 + k)) for k, m in enumerate((88, 93, 95, 100)))
add(chime * 0.25, 14.28, 0.4)

# ── master
mix = np.stack([L, R], 1)
mix = np.tanh(mix * 1.3) / np.tanh(1.3)
mix *= 0.89 / np.abs(mix).max()
fade = np.ones(N); fade[-int(0.25 * SR):] = np.linspace(1, 0, int(0.25 * SR)) ** 2
mix *= fade[:, None]
with wave.open('score.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype('<i2').tobytes())
print('ok', mix.shape)
