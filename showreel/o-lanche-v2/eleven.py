#!/usr/bin/env python3
"""eleven.py — ElevenLabs asset generator for "O Lanche" v2 (voices, SFX, music).

Endpoints (verified against elevenlabs.io/docs API reference, Sep 2026); auth header `xi-api-key`:
  GET  /v2/voices?category=premade&page_size=100[&next_page_token=..]
        -> {voices:[{voice_id,name,category,labels,...}], has_more, next_page_token}
  POST /v1/text-to-speech/{voice_id}/with-timestamps?output_format=mp3_44100_128
        body {text, model_id, voice_settings{stability,similarity_boost,style,use_speaker_boost,speed},
              seed, language_code?, apply_text_normalization}
        -> {audio_base64, alignment{characters, character_start_times_seconds,
            character_end_times_seconds}, normalized_alignment{...}}
  POST /v1/sound-generation?output_format=mp3_44100_128
        body {text, duration_seconds (0.5..30), prompt_influence (0..1), loop?, model_id}
        -> audio/mpeg bytes
  POST /v1/music?output_format=mp3_44100_128
        body {composition_plan{positive_global_styles, negative_global_styles,
              sections[{section_name, positive_local_styles, negative_local_styles, duration_ms 3000..120000, lines}]},
              model_id: music_v1, respect_sections_durations: true, seed}
          (music_v2/_v2_5: composition_plan{chunks[{text, duration_ms, positive_styles, negative_styles}]})
          or {prompt, music_length_ms 3000..600000, force_instrumental, model_id}
        -> audio bytes.  The Music API is for paid subscribers: 401/402/403 is logged, mix.py falls back.

Usage:
  python3 eleven.py [--only voice,sfx,music] [--dry-run] [--force] [--lines lines.json]
                    [--timeline timeline.json] [--ids bark,boing] [--assets DIR]
  env: ELEVENLABS_API_KEY, LEO_VOICE_ID, BIA_VOICE_ID, ELEVEN_TTS_MODEL, ELEVEN_MUSIC_MODEL, ELEVENLABS_BASE_URL
Outputs (cached by request hash in assets/<kind>/manifest.json):
  assets/voice/<line id>.mp3 + <line id>.json {characters, start, end, ...}
  assets/sfx/<cue id>.mp3      assets/music/score.mp3
Exit code is 0 even when a part falls back (so build.sh keeps going); 2 only for bad usage.
"""
import argparse
import base64
import hashlib
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, 'assets')
CA_BUNDLE = '/root/.ccr/ca-bundle.crt'                     # cloud sandbox egress-proxy CA, if present


def log(*a):
    print('[eleven]', *a, flush=True)


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(f'HTTP {status}: {message}')
        self.status, self.message = status, message


# ───────────────────────── HTTP client ─────────────────────────
class Client:
    def __init__(self, cfg, dry):
        api = cfg['api']
        self.base = os.environ.get('ELEVENLABS_BASE_URL', api['base_url']).rstrip('/')
        self.key = os.environ.get(api.get('key_env', 'ELEVENLABS_API_KEY'), '')
        self.timeout = api.get('timeout_s', 120)
        self.retries = api.get('retries', 3)
        self.dry = dry
        cafile = os.environ.get('SSL_CERT_FILE') or (CA_BUNDLE if os.path.exists(CA_BUNDLE) else None)
        self.ctx = ssl.create_default_context(cafile=cafile)

    def url(self, path, query=None):
        q = {k: v for k, v in (query or {}).items() if v is not None}
        return self.base + path + ('?' + urllib.parse.urlencode(q) if q else '')

    def show(self, method, url, body):
        """Print the exact request (key redacted) — used by --dry-run."""
        print(f'\n>>> {method} {url}')
        print('    xi-api-key: ' + ('<ELEVENLABS_API_KEY set>' if self.key else '<ELEVENLABS_API_KEY>'))
        if body is not None:
            print('    Content-Type: application/json')
            print('    ' + json.dumps(body, ensure_ascii=False, indent=2).replace('\n', '\n    '))

    def request(self, method, path, query=None, body=None, accept='application/json'):
        """Returns (bytes, content_type). Retries 429/5xx with backoff; raises ApiError otherwise."""
        url = self.url(path, query)
        if not self.key:
            raise ApiError(401, 'ELEVENLABS_API_KEY is not set')
        data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
        headers = {'xi-api-key': self.key, 'Accept': accept}
        if data is not None:
            headers['Content-Type'] = 'application/json'
        for attempt in range(self.retries + 1):
            req = urllib.request.Request(url, data=data, method=method, headers=headers)
            try:
                with urllib.request.urlopen(req, timeout=self.timeout, context=self.ctx) as r:
                    return r.read(), r.headers.get('Content-Type', '')
            except urllib.error.HTTPError as e:
                msg = _err_message(e.read())
                if e.code in (429, 500, 502, 503, 504) and attempt < self.retries:
                    wait = 2 ** attempt * 2
                    log(f'{method} {path}: HTTP {e.code} ({msg}); retry in {wait}s')
                    time.sleep(wait)
                    continue
                raise ApiError(e.code, msg)
            except (urllib.error.URLError, TimeoutError) as e:
                if attempt < self.retries:
                    time.sleep(2 ** attempt * 2)
                    continue
                raise ApiError(0, f'network error: {e}')

    def json(self, method, path, query=None, body=None):
        raw, _ = self.request(method, path, query, body)
        return json.loads(raw)


def _err_message(raw):
    """ElevenLabs errors look like {"detail": {"status": "...", "message": "..."}} or {"detail": "..."}."""
    try:
        d = json.loads(raw).get('detail', raw)
        if isinstance(d, dict):
            return f"{d.get('status', '')}: {d.get('message', '')}".strip(': ')
        if isinstance(d, list):                                  # 422 validation errors
            return '; '.join(f"{'.'.join(map(str, x.get('loc', [])))}: {x.get('msg')}" for x in d)
        return str(d)[:300]
    except Exception:
        return raw[:300].decode('utf-8', 'replace') if isinstance(raw, bytes) else str(raw)[:300]


# ───────────────────────── cache / manifest ─────────────────────────
def req_hash(*parts):
    return hashlib.sha256(json.dumps(parts, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]


class Manifest:
    def __init__(self, kind):
        self.dir = os.path.join(ASSETS, kind)
        self.path = os.path.join(self.dir, 'manifest.json')
        try:
            self.d = json.load(open(self.path))
        except (OSError, ValueError):
            self.d = {}

    def fresh(self, key, h, files):
        e = self.d.get(key)
        return bool(e and e.get('hash') == h and all(os.path.exists(os.path.join(self.dir, f)) for f in files))

    def put(self, key, h, files, **meta):
        os.makedirs(self.dir, exist_ok=True)
        self.d[key] = dict(hash=h, files=files, **meta)
        tmp = self.path + '.tmp'
        json.dump(self.d, open(tmp, 'w'), ensure_ascii=False, indent=1)
        os.replace(tmp, self.path)


def write_bytes(path, b):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    open(tmp, 'wb').write(b)
    os.replace(tmp, path)


# ───────────────────────── voices ─────────────────────────
def list_premade(cl):
    """All premade voices from GET /v2/voices (paginated)."""
    voices, token = [], None
    for _ in range(10):
        d = cl.json('GET', '/v2/voices', {'category': 'premade', 'page_size': 100, 'next_page_token': token})
        voices += d.get('voices', [])
        token = d.get('next_page_token')
        if not d.get('has_more') or not token:
            break
    return voices


def _first_name(name):
    return name.replace('-', ' ').split()[0].lower() if name else ''


def resolve_voices(cfg, cl, dry):
    """who -> (voice_id, source). Priority: env var > sound_design voice_id > live premade list > known ids."""
    out, listing = {}, None
    for who, v in cfg['voices'].items():
        vid = os.environ.get(v.get('env', ''), '') or v.get('voice_id')
        if vid:
            out[who] = (vid, 'env/config')
            continue
        if listing is None and not dry:
            try:
                listing = list_premade(cl)
                log(f'{len(listing)} premade voices available: ' + ', '.join(sorted({x.get("name", "?") for x in listing})))
            except ApiError as e:
                log(f'could not list voices ({e}); using known ids')
                listing = []
        by_name = {_first_name(x.get('name')): x for x in (listing or [])}
        pick = next((by_name[n.lower()] for n in v['prefer'] if n.lower() in by_name), None)
        if pick is None and listing:                                     # any voice with the right gender/age
            cands = [x for x in listing if (x.get('labels') or {}).get('gender') == v.get('fallback_gender')]
            cands.sort(key=lambda x: 0 if 'young' in json.dumps(x.get('labels') or {}).lower() else 1)
            pick = cands[0] if cands else None
        if pick:
            out[who] = (pick['voice_id'], f"premade '{pick.get('name')}'")
            continue
        known = cfg.get('known_voice_ids', {})
        name = next((n for n in v['prefer'] if n in known), None)
        if name:
            out[who] = (known[name], f"known id for '{name}'" + (' (dry-run, not verified)' if dry else ''))
        else:
            log(f'no voice for {who}')
    return out


def load_lines(cfg, path):
    """Lines from --lines (list or {lines:[...]}) else sound_design.json. Newlines become spaces."""
    src = cfg['lines']
    if path:
        d = json.load(open(path))
        src = d['lines'] if isinstance(d, dict) else d
    by_id = {l['id']: l for l in cfg['lines']}
    lines = []
    for l in src:
        base = dict(by_id.get(l.get('id'), {}))
        base.update(l)
        base['who'] = base['who'].lower().replace('é', 'e')
        base['text'] = ' '.join(base['text'].split())
        lines.append(base)
    return lines


def tts_body(cfg, line):
    tts = cfg['tts']
    model = os.environ.get('ELEVEN_TTS_MODEL') or line.get('model_id') or tts['model_id']
    vs = dict(cfg['voices'][line['who']]['voice_settings'])
    vs.update(line.get('voice_settings') or {})
    if model == 'eleven_v3':                             # v3 accepts stability 0.0 / 0.5 / 1.0 only
        vs['stability'] = min((0.0, 0.5, 1.0), key=lambda s: abs(s - vs['stability']))
    body = dict(text=line['text'], model_id=model, voice_settings=vs,
                apply_text_normalization=tts.get('apply_text_normalization', 'auto'))
    if tts.get('seed') is not None:
        body['seed'] = int(tts['seed'])
    if tts.get('language_code') and model in tts.get('language_code_models', []):
        body['language_code'] = tts['language_code']
    return body


def do_voice(cfg, cl, args):
    man = Manifest('voice')
    fmt = cfg['api']['output_format']
    lines = load_lines(cfg, args.lines)
    if args.ids:
        lines = [l for l in lines if l['id'] in args.ids]
    voices = resolve_voices(cfg, cl, args.dry_run)
    for vwho, (vid, src) in voices.items():
        log(f'voice {vwho}: {vid} ({src})')
    ok = 0
    for line in lines:
        if line['who'] not in voices:
            continue
        vid = voices[line['who']][0]
        body = tts_body(cfg, line)
        path, query = f'/v1/text-to-speech/{vid}/with-timestamps', {'output_format': fmt}
        h = req_hash(path, query, body)
        files = [f"{line['id']}.mp3", f"{line['id']}.json"]
        if args.dry_run:
            cl.show('POST', cl.url(path, query), body)
            continue
        if not args.force and man.fresh(line['id'], h, files):
            log(f"{line['id']}: cached")
            ok += 1
            continue
        try:
            try:
                d = cl.json('POST', path, query, body)
            except ApiError as e:
                if e.status in (400, 422) and 'language_code' in body:  # model refused the language hint
                    log(f"{line['id']}: {e}; retrying without language_code")
                    body = {k: v for k, v in body.items() if k != 'language_code'}
                    d = cl.json('POST', path, query, body)
                else:
                    raise
        except ApiError as e:
            log(f"{line['id']}: TTS failed ({e}) — mix.py will babble this line")
            if e.status in (401, 402, 403):
                break                                                # auth/plan problem: stop hammering
            continue
        al = d.get('alignment') or d.get('normalized_alignment') or {}
        align = dict(characters=al.get('characters', []),
                     start=al.get('character_start_times_seconds', []),
                     end=al.get('character_end_times_seconds', []))
        if ''.join(align['characters']) != line['text']:
            log(f"{line['id']}: note — alignment text differs from the line text (normalized?)")
        write_bytes(os.path.join(man.dir, files[0]), base64.b64decode(d['audio_base64']))
        meta = dict(align, text=line['text'], who=line['who'], key=h, voice_id=vid, model_id=body['model_id'],
                    source='elevenlabs')
        write_bytes(os.path.join(man.dir, files[1]), json.dumps(meta, ensure_ascii=False).encode())
        man.put(line['id'], h, files, text=line['text'], voice_id=vid)
        dur = align['end'][-1] if align['end'] else 0
        log(f"{line['id']} {line['who']}: {line['text']!r} -> {dur:.2f}s")
        ok += 1
    return ok


# ───────────────────────── sfx ─────────────────────────
def load_timeline(path):
    try:
        return json.load(open(path))
    except (OSError, ValueError):
        return None


def sfx_body(cfg, cid, spec, dur=None):
    dflt = cfg['sfx_defaults']
    d = float(dur if dur else spec.get('dur', 1.0))
    body = dict(text=spec['prompt'] + dflt.get('suffix', ''), model_id=dflt['model_id'],
                duration_seconds=round(min(30.0, max(0.5, d)), 2),
                prompt_influence=spec.get('prompt_influence', dflt['prompt_influence']))
    if spec.get('loopable') and dflt['model_id'] == 'eleven_text_to_sound_v2':
        body['loop'] = True                                              # loop only exists on v2
    return body


def do_sfx(cfg, cl, args):
    man = Manifest('sfx')
    fmt = cfg['api']['output_format']
    ids = list(cfg['sfx'])
    tl = load_timeline(args.timeline)
    if tl and tl.get('cues'):                                            # only cues the film actually uses
        used = {c['id'] for c in tl['cues']}
        ids = [i for i in ids if i in used] + sorted(used - set(ids))
    if args.ids:
        ids = [i for i in ids if i in args.ids]
    ok = 0
    for cid in ids:
        spec = cfg['sfx'].get(cid)
        if not spec:
            log(f'{cid}: no prompt in sound_design.json — synth only')
            continue
        body = sfx_body(cfg, cid, spec)
        path, query = '/v1/sound-generation', {'output_format': fmt}
        h = req_hash(path, query, body)
        files = [f'{cid}.mp3']
        if args.dry_run:
            cl.show('POST', cl.url(path, query), body)
            continue
        if not args.force and man.fresh(cid, h, files):
            ok += 1
            continue
        try:
            raw, ctype = cl.request('POST', path, query, body, accept='audio/mpeg')
        except ApiError as e:
            log(f'{cid}: sound generation failed ({e}) — synth fallback')
            if e.status in (401, 402, 403):
                break
            continue
        write_bytes(os.path.join(man.dir, files[0]), raw)
        man.put(cid, h, files, prompt=body['text'], duration=body['duration_seconds'])
        log(f'{cid}: {len(raw) // 1024} KB')
        ok += 1
    return ok


# ───────────────────────── music ─────────────────────────
def music_sections(cfg, tl):
    """Timeline music.sections -> [(mood, start_s, dur_s)], every span >= 3 s (API minimum)."""
    m = cfg['music']
    total = float((tl or {}).get('dur', 15.0))
    secs = ((tl or {}).get('music') or {}).get('sections') or m['default_sections']
    secs = sorted(secs, key=lambda s: s['t'])
    spans = []
    for i, s in enumerate(secs):
        a = float(s['t'])
        b = float(secs[i + 1]['t']) if i + 1 < len(secs) else total
        if b > a:
            spans.append(dict(mood=s.get('mood', 'happy'), a=a, d=b - a, tags=set()))
    # a span shorter than 3 s is absorbed by its previous neighbour (or the next one if it is first);
    # its mood is kept as a tag so e.g. a short trailing 'end' still asks for the button chord.
    while len(spans) > 1:
        i = next((k for k, s in enumerate(spans) if s['d'] < 3.0), None)
        if i is None:
            break
        cur = spans.pop(i)
        host = spans[i - 1] if i > 0 else spans[0]
        if i == 0:
            host['a'] = cur['a']
        host['d'] += cur['d']
        host['tags'] |= {cur['mood']} | cur['tags']
    return [(s['mood'], s['a'], s['d'], s['tags']) for s in spans], total


def music_body(cfg, tl):
    m = cfg['music']
    model = os.environ.get('ELEVEN_MUSIC_MODEL', m['model_id'])
    spans, total = music_sections(cfg, tl)
    stinger = ((tl or {}).get('music') or {}).get('stinger', m.get('default_stinger'))
    ms = [int(round(d * 1000)) for _, _, d, _ in spans]
    ms[-1] += int(round(total * 1000)) - sum(ms)                      # exact total length
    sections = []
    for k, ((mood, a, d, merged), dur_ms) in enumerate(zip(spans, ms)):
        mm = m['moods'].get(mood, m['moods']['happy'])
        pos, neg = list(mm['pos']), list(mm['neg'])
        if 'end' in merged or (k == len(spans) - 1 and stinger):
            pos += m['moods']['end']['pos']
            if stinger:
                pos.append(f'final button chord hits {max(0.0, stinger - a):.1f}s into this section, then silence')
        name = mm['name'] + (' (reprise)' if any(x['section_name'].endswith(mm['name']) for x in sections) else '')
        sections.append(dict(section_name=f"{k + 1}. {name}", positive_local_styles=pos,
                             negative_local_styles=neg, duration_ms=dur_ms, lines=[]))
    if model == 'music_v1':
        plan = dict(positive_global_styles=m['global_positive'], negative_global_styles=m['global_negative'],
                    sections=sections)
    else:                                                               # music_v2 / music_v2_5 chunk plan
        plan = dict(chunks=[dict(text=f"[{s['section_name']}]", duration_ms=s['duration_ms'],
                                 positive_styles=m['global_positive'] + s['positive_local_styles'],
                                 negative_styles=m['global_negative'] + s['negative_local_styles'])
                            for s in sections])
    body = dict(composition_plan=plan, model_id=model, respect_sections_durations=True)
    fallback = dict(prompt=m['prompt'], music_length_ms=int(round(total * 1000)), force_instrumental=True, model_id=model)
    if m.get('seed') is not None:
        body['seed'] = fallback['seed'] = int(m['seed'])
    return body, fallback


def do_music(cfg, cl, args):
    man = Manifest('music')
    tl = load_timeline(args.timeline)
    body, fallback = music_body(cfg, tl)
    path, query = '/v1/music', {'output_format': cfg['api']['output_format']}
    files = ['score.mp3']
    if args.dry_run:
        cl.show('POST', cl.url(path, query), body)
        print('    (if the composition plan is rejected with 400/422, eleven.py retries with:)')
        cl.show('POST', cl.url(path, query), fallback)
        return 0
    h = req_hash(path, query, body)
    if not args.force and man.fresh('score', h, files):
        log('music: cached')
        return 1
    try:
        try:
            raw, _ = cl.request('POST', path, query, body, accept='audio/mpeg')
            used = 'composition_plan'
        except ApiError as e:
            if e.status not in (400, 422):
                raise
            log(f'music: composition plan rejected ({e}); retrying with the plain prompt')
            raw, _ = cl.request('POST', path, query, fallback, accept='audio/mpeg')
            used = 'prompt'
    except ApiError as e:
        if e.status in (401, 402, 403):
            log(f'music: not available on this plan/key ({e}). The Music API is for paid subscribers; '
                'mix.py will use the synth ukulele score.')
        else:
            log(f'music: failed ({e}) — mix.py will use the synth score')
        return 0
    write_bytes(os.path.join(man.dir, files[0]), raw)
    man.put('score', h, files, mode=used, model_id=body['model_id'])
    log(f'music: score.mp3 {len(raw) // 1024} KB via {used}')
    return 1


# ───────────────────────── main ─────────────────────────
def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--only', default='voice,sfx,music', help='comma list of voice,sfx,music')
    ap.add_argument('--dry-run', action='store_true', help='print exact requests, no network')
    ap.add_argument('--force', action='store_true', help='ignore the cache')
    ap.add_argument('--lines', help='lines json (list or {lines:[...]}) overriding sound_design.json lines')
    ap.add_argument('--timeline', default=os.path.join(HERE, 'timeline.json'))
    ap.add_argument('--ids', help='comma list: restrict to these line/cue ids')
    ap.add_argument('--design', default=os.path.join(HERE, 'sound_design.json'))
    ap.add_argument('--assets', default=ASSETS, help='output root (voice/, sfx/, music/)')
    args = ap.parse_args()
    globals()['ASSETS'] = os.path.abspath(args.assets)
    args.ids = set(args.ids.split(',')) if args.ids else None
    parts = [p.strip() for p in args.only.split(',') if p.strip()]
    bad = [p for p in parts if p not in ('voice', 'sfx', 'music')]
    if bad:
        ap.error(f'unknown --only part(s): {bad}')
    cfg = json.load(open(args.design))
    cl = Client(cfg, args.dry_run)
    if not cl.key and not args.dry_run:
        log('ELEVENLABS_API_KEY not set — nothing generated; mix.py will use fallbacks')
        return 0
    for p in parts:
        n = {'voice': do_voice, 'sfx': do_sfx, 'music': do_music}[p](cfg, cl, args)
        if not args.dry_run:
            log(f'{p}: {n} asset(s) ready')
    return 0


if __name__ == '__main__':
    sys.exit(main())
