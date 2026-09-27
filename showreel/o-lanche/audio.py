# Score + foley for "O Lanche": ukulele (Karplus-Strong), babble voices, cartoon SFX.
import numpy as np, wave
from scipy.signal import butter, sosfilt, lfilter
from tl import EV, LINES

SR = 48000; DUR = 15.0; N = int(SR * DUR)
rng = np.random.default_rng(3)
L = np.zeros(N); R = np.zeros(N)

def add(sig, t, g=1.0, pan=0.0):
    i = int(t * SR)
    if i >= N: return
    if i < 0: sig = sig[-i:]; i = 0
    j = min(N, i + len(sig)); s = sig[: j - i] * g
    L[i:j] += s * np.cos((pan + 1) * np.pi / 4) * 1.414; R[i:j] += s * np.sin((pan + 1) * np.pi / 4) * 1.414
def tt(d): return np.arange(int(d * SR)) / SR
def bp(x, lo, hi, o=2): return sosfilt(butter(o, [lo, hi], 'band', fs=SR, output='sos'), x)
def lp(x, f, o=2): return sosfilt(butter(o, f, 'low', fs=SR, output='sos'), x)
def hp(x, f, o=2): return sosfilt(butter(o, f, 'high', fs=SR, output='sos'), x)
def mtof(m): return 440 * 2 ** ((m - 69) / 12)
def sweep(f0, f1, d, shape='exp'):
    t = tt(d); f = f0 * (f1 / f0) ** (t / d) if shape == 'exp' else f0 + (f1 - f0) * t / d
    return np.sin(2 * np.pi * np.cumsum(f) / SR)
def env(n, a=0.005, r=None):
    e = np.minimum(1, np.arange(n) / (a * SR + 1))
    if r: e *= np.exp(-np.arange(n) / SR * r)
    return e

# ── instruments
def pluck(f, d=1.2, bright=0.5, damp=0.996):
    n = max(2, int(SR / f)); ex = lp(rng.standard_normal(n), 1500 + 5000 * bright)
    x = np.zeros(int(d * SR)); x[:n] = ex
    a = np.zeros(n + 2); a[0] = 1; a[n] = -damp / 2; a[n + 1] = -damp / 2
    y = lfilter([1], a, x)
    return y / (np.abs(y).max() + 1e-9) * env(len(y), 0.001)
def glock(m, d=1.2):
    t = tt(d); f = mtof(m)
    return (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t * 6)) * np.exp(-t * 3.5) * env(len(t), 0.002)
def thud(f=110, d=0.18):
    t = tt(d); return (sweep(f * 1.6, f, d) * np.exp(-t * 28) + 0.2 * lp(rng.standard_normal(len(t)), 1500) * np.exp(-t * 80))
def noise_burst(d, lo, hi, k):
    t = tt(d); return bp(rng.standard_normal(len(t)), lo, hi) * np.exp(-t * k) * env(len(t), 0.002)
def whoosh(d=0.25, lo=400, hi=3000):
    t = tt(d); x = t / d; return bp(rng.standard_normal(len(t)), lo, hi) * np.sin(np.pi * x) ** 2
def slide_whistle(f0, f1, d):
    t = tt(d); f = f0 + (f1 - f0) * (0.5 - 0.5 * np.cos(np.pi * t / d)); f *= 1 + 0.02 * np.sin(2 * np.pi * 6 * t)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) + 0.1 * rng.standard_normal(len(t)) * 0.3
    return lp(s, 4000) * np.minimum(1, t / 0.03) * np.minimum(1, (d - t) / 0.05)

# ── ukulele strums
CH = {'C': [60, 64, 67, 72], 'G': [55, 62, 67, 71], 'Am': [57, 60, 64, 69], 'F': [53, 60, 65, 69],
      'Dm': [50, 57, 62, 65], 'E7': [52, 56, 62, 64]}
ROOT = {'C': 36, 'G': 43, 'Am': 45, 'F': 41, 'Dm': 38, 'E7': 40}
def strum(ch, t, g=0.16, up=False, b=0.55):
    notes = CH[ch][::-1] if up else CH[ch]
    for k, m in enumerate(notes): add(pluck(mtof(m), 1.1, b), t + k * 0.013, g * (0.7 if up else 1), (k - 1.5) * 0.25)
happy = [('C', 0.0), ('G', 1.2), ('Am', 2.4), ('F', 3.6), ('C', 4.8)]
for ch, t0 in happy:
    for off, up in ((0, 0), (0.3, 0), (0.45, 1), (0.75, 1), (0.9, 0)):
        if t0 + off < EV['sad']: strum(ch, t0 + off, up=bool(up))
    add(pluck(mtof(ROOT[ch]), 1.2, 0.2, 0.997), t0, 0.3)
sad = [('Am', 5.9, 7.1), ('Dm', 7.1, 8.3), ('Am', 8.3, 9.0), ('E7', 9.0, 10.25)]
for ch, a, b in sad:
    t0 = a
    while t0 < b - 0.05:
        for k, m in enumerate(CH[ch]): add(pluck(mtof(m), 1.3, 0.25), t0 + k * 0.15, 0.1)
        t0 += 0.6
    add(pluck(mtof(ROOT[ch]), 1.4, 0.15, 0.997), a, 0.3)
happy2 = [('C', 10.25), ('F', 11.45), ('G', 12.65)]
for ch, t0 in happy2:
    for off, up in ((0, 0), (0.3, 0), (0.45, 1), (0.75, 1), (0.9, 0)):
        if t0 + off < EV['irisOut']: strum(ch, t0 + off, up=bool(up), g=0.18)
    add(pluck(mtof(ROOT[ch]), 1.2, 0.2, 0.997), t0, 0.32)
for i in range(int((EV['sad']) / 0.15)):
    add(noise_burst(0.04, 5000, 12000, 90), i * 0.15, 0.04 if i % 2 else 0.06, 0.4)
for i in range(int((EV['irisOut'] - EV['cloudOut']) / 0.15)):
    add(noise_burst(0.04, 5000, 12000, 90), EV['cloudOut'] + i * 0.15, 0.05 if i % 2 else 0.07, 0.4)

# ── voices: babble synced to every typed character
FORM = {'a': (800, 1250), 'e': (480, 1900), 'i': (320, 2300), 'o': (500, 950), 'u': (350, 800)}
DEACC = str.maketrans('áâãàéêíóôõúç', 'aaaaeeiooouc')
def syllable(f0, ch, d=0.075, rise=1.0):
    t = tt(d); v = ch.lower().translate(DEACC)
    f = f0 * rise ** (t / d) * (1 + 0.03 * np.sin(2 * np.pi * 9 * t))
    ph = np.cumsum(f) / SR; src = 2 * (ph % 1) - 1
    f1, f2 = FORM.get(v, (600, 1500))
    s = bp(src, f1 * 0.8, f1 * 1.25) + 0.6 * bp(src, f2 * 0.85, f2 * 1.15)
    if v not in FORM: s = s * 0.5 + 0.3 * noise_burst(d, 2000, 6000, 60)
    return s * np.sin(np.pi * t / d) ** 0.6
VOICE = {'leo': 230, 'bia': 330}
for Ln in LINES:
    f0 = VOICE[Ln['who']]; text = Ln['text']
    for i, (ch, t) in enumerate(zip(text, Ln['ct'])):
        if not ch.isalpha(): continue
        q = '?' in text[i:i + 4]
        pitch = f0 * (1 + 0.12 * np.sin(i * 1.9)) * (1.25 if q else 1) * (0.85 if Ln['start'] == 5.8 else 1)
        add(syllable(pitch, ch, rise=1.3 if q else 1.0), t, 0.5, -0.3 if Ln['who'] == 'leo' else 0.3)

# ── foley / sfx
add(slide_whistle(400, 1200, 0.5), 0.0, 0.22)
for i in range(7):
    t0 = 0.3 + i * 0.3 + (i % 2) * 0.07; add(sweep(2600, 4200, 0.07) * np.exp(-tt(0.07) * 20), t0, 0.08, 0.6); add(sweep(3000, 3800, 0.05), t0 + 0.09, 0.05, 0.6)
k = 1
while k / 3.8 < EV['stop'] + 0.01: add(thud(140), k / 3.8, 0.35, -0.5 + k * 0.08); k += 1
add(whoosh(0.18, 1500, 7000), EV['page'], 0.25, 0.3)
add(sweep(500, 900, 0.1) * np.exp(-tt(0.1) * 20), EV['lookUp'], 0.2, 0.3)
add(thud(180, 0.12), EV['bookDrop'] + 0.15, 0.4, 0.4)
t = tt(0.8); growl = lp(rng.standard_normal(len(t)), 180) * (0.6 + 0.4 * np.sin(2 * np.pi * 22 * t)) * np.sin(np.pi * t / 0.8)
add(growl * 3, EV['growl'], 0.7, -0.2)
add(lp(noise_burst(0.3, 100, 1500, 12), 900), EV['cloudIn'], 0.6)
d = EV['cloudOut'] - EV['cloudIn']; t = tt(d)
add(hp(rng.standard_normal(len(t)), 4000) * 0.05 * np.minimum(1, t / 0.2) * np.minimum(1, (d - t) / 0.1), EV['cloudIn'], 0.8, -0.3)
for i in range(30): add(sweep(1800, 900, 0.03) * np.exp(-tt(0.03) * 60), EV['cloudIn'] + 0.1 + i * 0.1 + (i % 3) * 0.02, 0.04, -0.3)
add(whoosh(0.22, 300, 2000), EV['hammer'], 0.5, 0.4)
add(sweep(400, 900, 0.08) * np.exp(-tt(0.08) * 25), EV['sandOut'], 0.4, 0.3)
add(glock(84, 0.8), EV['sandOut'] + 0.03, 0.2); add(glock(88, 0.8), EV['sandOut'] + 0.12, 0.2)
add(noise_burst(0.12, 1500, 6000, 45), EV['snap'], 0.6, 0.2); add(noise_burst(0.06, 2500, 8000, 70), EV['snap'] + 0.04, 0.4, 0.2)
for i, m in enumerate((84, 88, 91, 96, 100)): add(glock(m, 1.0), EV['cloudOut'] + i * 0.06, 0.25, -0.4 + i * 0.2)
add(lp(noise_burst(0.2, 200, 3000, 20), 2000), EV['cloudOut'], 0.4)
t = tt(0.35); boing = np.sin(2 * np.pi * np.cumsum(180 * (1 + 1.5 * t / 0.35) * (1 + 0.12 * np.sin(2 * np.pi * 18 * t))) / SR) * np.exp(-t * 5)
add(boing, EV['hop'] - 0.02, 0.35, -0.3)
add(thud(90, 0.2), EV['land'], 0.5); add(sweep(600, 300, 0.1) * np.exp(-tt(0.1) * 20), EV['hand'], 0.25)
for b in (EV['biteBia'], EV['biteLeo']):
    add(noise_burst(0.07, 1500, 7000, 50), b, 0.45, 0.2 if b == EV['biteBia'] else -0.2); add(noise_burst(0.05, 1500, 7000, 60), b + 0.09, 0.3)
t0 = EV['dogIn']
while t0 < EV['dogSit']: add(thud(260, 0.06), t0, 0.18, 0.7); t0 += 0.09
for s0 in (EV['sniff1'], EV['sniff2']):
    for j in range(2): add(noise_burst(0.05, 3000, 9000, 40), s0 + j * 0.06, 0.18, 0.1)
t = tt(0.55); f = 900 + 400 * np.sin(np.pi * t / 0.55) + 30 * np.sin(2 * np.pi * 8 * t)
add(lp(np.sin(2 * np.pi * np.cumsum(f) / SR), 3000) * np.sin(np.pi * t / 0.55) ** 2, EV['puppy'] + 0.05, 0.16)
for i in range(5):
    add(syllable(VOICE['leo'] * 1.2, 'a', 0.07), EV['laugh'] + i * 0.085, 0.45, -0.3)
    add(syllable(VOICE['bia'] * 1.2, 'i', 0.07), EV['laugh'] + 0.04 + i * 0.085, 0.4, 0.3)
add(whoosh(0.3, 800, 4000), EV['toss'], 0.4)
add(noise_burst(0.06, 800, 4000, 50), EV['catch'], 0.5)
def bark():
    t = tt(0.17); f = np.interp(t, [0, 0.05, 0.17], [420, 720, 380]); ph = np.cumsum(f) / SR
    src = 2 * (ph % 1) - 1; s = bp(src, 500, 1100) + 0.7 * bp(src, 1300, 2200)
    return s * np.sin(np.pi * t / 0.17) ** 0.5
add(bark(), EV['catch'] + 0.05, 0.9, 0.1)
add(slide_whistle(1400, 280, 0.45), EV['irisOut'], 0.25)
add(glock(100, 0.6), EV['wink'], 0.3)
for k, m in enumerate(CH['C'] + [76]): add(pluck(mtof(m), 1.4, 0.6), EV['fim'] + k * 0.02, 0.2)
add(pluck(mtof(36), 1.4, 0.2, 0.998), EV['fim'], 0.35)
for i, m in enumerate((84, 88, 91)): add(glock(m, 1.0), EV['fim'] + 0.05 + i * 0.07, 0.2)

mix = np.stack([L, R], 1)
mix = np.tanh(mix * 1.2) / np.tanh(1.2)
mix *= 0.89 / np.abs(mix).max()
f = np.ones(N); n = int(0.12 * SR); f[-n:] = np.linspace(1, 0, n)
mix *= f[:, None]
with wave.open('score.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype('<i2').tobytes())
print('audio ok')
