# Free pt-BR neural voices (Microsoft Edge read-aloud via the edge-tts package; no API key).
# Writes assets/voice/<id>.mp3 plus <id>.json = {characters, start, end} (per-character times in
# seconds), the same alignment format eleven.py produces, so plan.py / mix.py treat them identically.
#   python3 voices_free.py [lines.json]     lines.json: [{"id","who","text"}, ...]  (default: script.json)
import asyncio, json, os, sys, hashlib
import certifi
if os.path.exists('/root/.ccr/ca-bundle.crt'):      # cloud sandbox: trust the egress proxy's CA
    certifi.where = lambda: '/root/.ccr/ca-bundle.crt'
import edge_tts

# Default cast: voice + prosody tuned toward a cartoon kid read. script.json may override/add entries
# under "cast": {"who": {"voice": "pt-BR-...Neural", "pitch": "+20Hz", "rate": "+5%"}}.
# List voices with:  edge-tts --list-voices   (pt-BR: AntonioNeural, FranciscaNeural, ThalitaMultilingualNeural)
CAST = {
    'leo': dict(voice='pt-BR-AntonioNeural', pitch='+38Hz', rate='+14%'),
    'bia': dict(voice='pt-BR-FranciscaNeural', pitch='+22Hz', rate='+4%'),
}
OUT = 'assets/voice'


def load_lines(path):
    d = json.load(open(path, encoding='utf-8'))
    if isinstance(d, dict):
        CAST.update(d.get('cast', {}))
    lines = d['lines'] if isinstance(d, dict) else d
    return [dict(id=l['id'], who=l['who'].lower().replace('é', 'e'), text=l['text'].replace('\n', ' ')) for l in lines]


async def synth(line):
    cfg = CAST[line['who']]
    key = hashlib.sha1(json.dumps([line['text'], cfg], sort_keys=True).encode()).hexdigest()[:12]
    mp3, meta = f"{OUT}/{line['id']}.mp3", f"{OUT}/{line['id']}.json"
    if os.path.exists(meta) and json.load(open(meta, encoding='utf-8')).get('key') == key:
        return 'cached'
    com = edge_tts.Communicate(line['text'], cfg['voice'], rate=cfg['rate'], pitch=cfg['pitch'], boundary='WordBoundary',
                                proxy=os.environ.get('HTTPS_PROXY') or None)
    audio, words = bytearray(), []
    async for ch in com.stream():
        if ch['type'] == 'audio':
            audio += ch['data']
        elif ch['type'] == 'WordBoundary':
            words.append((ch['offset'] / 1e7, (ch['offset'] + ch['duration']) / 1e7, ch['text']))
    open(mp3, 'wb').write(audio)
    # spread each word's span over its characters; punctuation/spaces get the gap times
    text = line['text']
    chars, start, end = list(text), [0.0] * len(text), [0.0] * len(text)
    pos, last = 0, 0.0
    for w0, w1, w in words:
        i = text.find(w, pos)
        if i < 0:
            continue
        for k in range(pos, i):
            start[k] = end[k] = last
        for k in range(len(w)):
            start[i + k] = w0 + (w1 - w0) * k / len(w)
            end[i + k] = w0 + (w1 - w0) * (k + 1) / len(w)
        pos, last = i + len(w), w1
    for k in range(pos, len(text)):
        start[k] = end[k] = last
    json.dump(dict(characters=chars, start=start, end=end, key=key, voice=cfg), open(meta, 'w', encoding='utf-8'), ensure_ascii=False)
    return f'{len(words)} words, {last:.2f}s'


async def main():
    src = sys.argv[1] if len(sys.argv) > 1 else 'script.json'
    os.makedirs(OUT, exist_ok=True)
    for l in load_lines(src):
        print(l['id'], l['who'], repr(l['text']), await synth(l))

asyncio.run(main())
