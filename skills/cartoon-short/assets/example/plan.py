# plan.py — the single source of timing for "O Lanche" v2.
# Reads script.json (dialogue + clip starts) and the voice alignments in assets/voice/<id>.json,
# then writes timeline.json (for mix.py) and timeline.js (window.TL, for film.js).
# Story beats (EV) are authored here; dialogue character times come from the real voice clips when they
# exist (free pt-BR TTS or ElevenLabs), otherwise from a ~13 chars/s estimate.
import json, math, os

DUR, FPS = 15.0, 24
EV = {
    # S1 establishing wide
    'irisIn': 0.45, 'walk0': 0.1, 'walk1': 1.8, 'page': 0.9,
    # shot cuts
    's1': 0.0, 's2': 1.9, 's3': 4.04, 's4': 5.75, 's5': 8.68, 's6': 10.2, 's7': 10.62, 's8': 11.9, 's9': 12.9, 's10': 13.45,
    # S3 Bia
    'bookClose': 3.98,
    # S4 Léo: forced "Tô bem!", freeze, tummy growl, confession, rain cloud
    'thumb': 5.8, 'freeze': 6.42, 'growl': 6.62, 'growlEnd': 7.12, 'cloudIn': 7.95,
    # S5 two-shot: idea, sandwich from behind the back, snap, offer
    'idea': 8.74, 'behind': 8.86, 'pop': 9.0, 'snap': 9.15, 'offer': 9.22,
    # S6 ECU stars
    'stars': 10.26, 'cloudOut': 10.36,
    # S7 hop onto the bench, grab, bite
    'crouch': 10.64, 'hop': 10.72, 'land': 11.0, 'grab': 11.04, 'got': 11.16, 'bite': 11.82,
    # S8 dog
    'dogIn': 11.9, 'dogSit': 12.26, 'sniff': 12.3, 'puppy': 12.52, 'lookDog': 12.12,
    # S9 kids react
    'lookEach': 13.02, 'laugh': 13.1, 'laughEnd': 13.44,
    # S10 toss, catch, iris out
    'windup': 13.47, 'toss': 13.56, 'catch': 13.88, 'irisOut': 14.06, 'irisHold': 14.24, 'wink': 14.3,
    'irisClose': 14.5, 'fim': 14.58,
}

VOW = 'aeiouáéíóúâêôãõ'


def est_ct(text, start):
    ts, t = [], start
    for i, ch in enumerate(text):
        ts.append(round(t, 4)); t += 1 / 13.0
        if ch in '.!?,' and i + 1 < len(text) and text[i + 1] == ' ':
            t += 0.12
    return ts


def load_lines():
    lines, all_voiced = [], True
    for L in json.load(open('script.json', encoding='utf-8'))['lines']:
        meta = f"assets/voice/{L['id']}.json"
        audio, ct, end = None, None, None
        if os.path.exists(meta):
            m = json.load(open(meta, encoding='utf-8'))
            if ''.join(m['characters']) == L['text']:
                audio = f"assets/voice/{L['id']}.mp3"
                ct = [round(L['start'] + s, 4) for s in m['start']]
                ce = [round(L['start'] + e, 4) for e in m['end']]
                end = round(max(ce) + 0.08, 3)
        if audio is None:
            all_voiced = False
            ct = est_ct(L['text'], L['start'])
            end = round(ct[-1] + 0.25, 3)
            ce = [c + 1 / 13.0 for c in ct]
        lines.append(dict(id=L['id'], who=L['who'], text=L['text'], start=L['start'], end=end, ct=ct, ce=ce, audio=audio,
                          mood='sad' if L['id'] == 'l4' else None))
    for a, b in zip(lines, lines[1:]):
        if a['end'] > b['start'] + 0.02:
            print(f"WARNING: {a['id']} ends {a['end']:.2f} after {b['id']} starts {b['start']:.2f}")
    return lines, all_voiced


def cues():
    E, C = EV, []
    add = lambda cid, t, gain=1.0, pan=0.0, dur=None: C.append(dict(id=cid, t=round(t, 3), gain=gain, pan=pan, **({'dur': dur} if dur else {})))
    add('iris_whistle_up', 0.0, 0.8)
    add('birds', 0.15, 0.6, 0.4, 2.2)
    k = 1                                   # rig walk phase = t*TAU*1.9 → a foot lands every 1/3.8 s
    while E['walk0'] + k / 3.8 <= E['walk1'] + 0.01:
        add('footstep', E['walk0'] + k / 3.8, 0.9, -0.6 + 0.08 * k); k += 1
    add('page_flip', E['page'], 0.8, 0.35)
    add('book_thump', E['bookClose'] + 0.05, 0.7, 0.2)
    add('tummy_growl', E['growl'], 1.1, -0.1)
    add('cloud_poof', E['cloudIn'], 0.7, -0.1)
    add('drizzle', E['cloudIn'] + 0.05, 0.55, -0.15, E['cloudOut'] - E['cloudIn'] - 0.05)
    add('whoosh', E['behind'], 0.7, 0.3)
    add('sandwich_pop', E['pop'], 0.9, 0.3)
    add('bread_snap', E['snap'], 1.0, 0.25)
    add('sparkle', E['stars'], 0.9)
    add('cloud_poof', E['cloudOut'], 0.8)
    add('boing', E['hop'] - 0.02, 0.8, -0.3)
    add('land_thud', E['land'], 0.9, -0.1)
    add('handoff_pop', E['got'], 0.8)
    add('bite', E['bite'], 0.9, -0.2); add('bite', E['bite'] + 0.06, 0.8, 0.25)
    add('dog_trot', E['dogIn'], 0.8, 0.5, E['dogSit'] - E['dogIn'])
    add('sniff', E['sniff'], 0.9, 0.1); add('sniff', E['sniff'] + 0.13, 0.8, 0.1)
    add('whimper', E['puppy'] + 0.05, 0.8, 0.05)
    add('giggle', E['laugh'], 1.0)
    add('toss_whoosh', E['toss'], 0.8)
    add('catch_chomp', E['catch'], 0.9, 0.1)
    add('bark', E['catch'] + 0.03, 1.0, 0.1)
    add('slide_whistle_down', E['irisOut'], 0.8)
    add('wink_ting', E['wink'], 0.9)
    add('fim_chord', E['fim'], 1.0)
    return sorted(C, key=lambda c: c['t'])


def main():
    lines, voiced = load_lines()
    tl = dict(dur=DUR, fps=FPS, voice=voiced, ev=EV, lines=lines, cues=cues(),
              music=dict(sections=[dict(t=0, mood='happy'), dict(t=EV['s4'], mood='sad'),
                                   dict(t=EV['stars'], mood='happy'), dict(t=EV['irisOut'], mood='end')],
                         stinger=EV['fim']))
    json.dump(tl, open('timeline.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    open('timeline.js', 'w', encoding='utf-8').write('window.TL = ' + json.dumps(tl, ensure_ascii=False) + ';\n')
    for l in lines:
        print(f"{l['id']} {l['who']:3} {l['start']:5.2f}-{l['end']:5.2f} {'VOICE' if l['audio'] else 'est  '} {l['text']}")
    print('voice:', voiced, '| cues:', len(tl['cues']))


if __name__ == '__main__':
    main()
