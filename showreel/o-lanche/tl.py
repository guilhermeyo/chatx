# Single source of truth for timing, shared by the renderer (timeline.js) and the audio (audio.py).
import json

EV = {
    'stop': 2.2, 'page': 1.0, 'lookUp': 3.0, 'bookDrop': 3.55,
    'sad': 5.9, 'growl': 7.0, 'cloudIn': 7.2, 'cloudOut': 10.25,
    'hammer': 8.45, 'sandOut': 8.7, 'snap': 9.0,
    'hop': 10.4, 'land': 10.9, 'hand': 11.05, 'biteBia': 11.3, 'biteLeo': 11.5,
    'dogIn': 11.7, 'dogSit': 12.15, 'sniff1': 12.18, 'sniff2': 12.32, 'puppy': 12.45,
    'lookEach': 12.95, 'laugh': 13.05, 'toss': 13.45, 'catch': 13.8,
    'irisOut': 14.0, 'wink': 14.25, 'irisClose': 14.45, 'fim': 14.5,
}

DIALOG = [
    # speaker, text, start, end
    ('leo', 'Oi, Bia!\nTudo bem?', 2.45, 3.9),
    ('bia', 'Tudo ótimo!\nE você?', 4.05, 5.6),
    ('leo', 'Tô bem... mas\nesqueci meu lanche.', 5.8, 8.2),
    ('bia', 'Metade?', 9.15, 10.2),
    ('leo', 'Valeu!!', 10.95, 11.7),
]


def char_times(text, start, rate=22.0):
    ts, t = [], start
    for i, ch in enumerate(text):
        ts.append(round(t, 4))
        t += 1.0 / rate
        nxt = text[i + 1] if i + 1 < len(text) else ''
        if ch in '.!?' and nxt not in '.!?':
            t += 0.16
        elif ch == ',':
            t += 0.1
    return ts


LINES = [dict(who=w, text=s, start=a, end=b, ct=char_times(s, a)) for w, s, a, b in DIALOG]

if __name__ == '__main__':
    open('timeline.js', 'w').write('window.TL = ' + json.dumps({'ev': EV, 'lines': LINES}, ensure_ascii=False) + ';\n')
    for l in LINES:
        print(l['who'], repr(l['text']), 'typed by', l['ct'][-1], 'ends', l['end'])
