#!/usr/bin/env python3
"""eleven.py — ElevenLabs asset generator for "O Lanche" v2 (voices, SFX, music).

Endpoints (verified against elevenlabs.io/docs API reference, Sep 2026); auth header `xi-api-key`:
  GET  /v2/voices?category=premade&page_size=100[&next_page_token=..]
        -> {voices:[{voice_id,name,category,labels,...}], has_more, next_page_token}
  POST /v1/text-to-speech/{voice_id}/with-timestamps?output_format=mp3_44100_128
        body {text, model_id, voice_settings{stability,similarity_boost,style,use_speaker_boost,speed},
              seed, previous_text?, next_text?, language_code? (NOT for multilingual_v2), apply_text_normalization}
        -> {audio_base64, alignment{characters, character_start_times_seconds,
            character_end_times_seconds}, normalized_alignment{...}}
  POST /v1/sound-generation?output_format=mp3_44100_128
        body {text, duration_seconds (0.5..30), prompt_influence (0..1), loop? (v2 only), model_id}
        -> audio/mpeg bytes
  POST /v1/music?output_format=mp3_44100_128
        body {composition_plan{positive_global_styles, negative_global_styles,
              sections[{section_name, positive_local_styles, negative_local_styles, duration_ms 3000..120000, lines}]},
              model_id: music_v1, respect_sections_durations (music_v1 only), seed (plan only)}
          (music_v2/_v2_5: composition_plan{chunks[{text, duration_ms, positive_styles, negative_styles}]})
          or {prompt, music_length_ms 3000..600000, force_instrumental, model_id}   (no seed with a prompt)
        -> audio bytes.  The Music API is for paid subscribers: 401/402/403 is logged, mix.py falls back.

Usage:
  python3 eleven.py [--only voice,sfx,music] [--dry-run] [--force] [--lines script.json]
                    [--timeline timeline.json] [--ids bark,boing] [--assets DIR]
  env: ELEVENLABS_API_KEY, LEO_VOICE_ID, BIA_VOICE_ID, ELEVEN_TTS_MODEL, ELEVEN_MUSIC_MODEL, ELEVENLABS_BASE_URL
Outputs (cached by request hash + file sha256 in assets/<kind>/manifest.json):
  assets/voice/<line id>.mp3 + <line id>.json {characters, start, end, source:'elevenlabs', ...}
  assets/voice/INCOMPLETE.json   lines that could not be generated (mix.py then babbles that character)
  assets/sfx/<cue id>.mp3      assets/music/score.mp3   assets/music/UNAVAILABLE.json (plan refused, 24 h)
Robustness: every response is validated (JSON shape / audio content-type, size and an ffmpeg decode probe)
before it is written or cached; any failure is logged and that asset falls back. Exit code is ALWAYS 0
(so build.sh keeps going), except 2 for bad command-line usage.
"""
import argparse
import array
import base64
import hashlib
import http.client
import json
import os
import ssl
import subprocess
import sys
import tempfile
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, 'assets')
CA_BUNDLE = '/root/.ccr/ca-bundle.crt'                     # cloud sandbox egress-proxy CA, if present
RETRY_HTTP = (429, 500, 502, 503, 504)
NET_ERRORS = (urllib.error.URLError, http.client.HTTPException, ConnectionError, TimeoutError, ssl.SSLError, OSError)
MIN_AUDIO_BYTES = 1024
MUSIC_BLOCK_S = 24 * 3600                                   # skip /v1/music this long after a plan refusal


def log(*a):
    print('[eleven]', *a, flush=True)


class ApiError(Exception):
    """status = HTTP status (0 = network / bad response); code = ElevenLabs detail.status (e.g. quota_exceeded)."""

    def __init__(self, status, message, code=''):
        super().__init__(f'HTTP {status}: {message}')
        self.status, self.message, self.code = status, message, code or ''


# ───────────────────────── HTTP client ─────────────────────────
class Client:
    def __init__(self, cfg, dry):
        api = cfg['api']
        self.base = os.environ.get('ELEVENLABS_BASE_URL', api['base_url']).rstrip('/')
        self.key = os.environ.get(api.get('key_env', 'ELEVENLABS_API_KEY'), '')
        self.timeout = api.get('timeout_s', 120)
        self.retries = api.get('retries', 3)
        self.dry = dry
        self.net_down = None                                    # set once a request exhausts its network retries
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

    def _backoff(self, attempt, what, retry_after=None):
        wait = 2 ** attempt * 2
        if retry_after:
            try:
                wait = min(30.0, max(wait, float(retry_after)))
            except ValueError:
                pass
        log(f'{what}; retry in {wait:.0f}s')
        time.sleep(wait)

    def request(self, method, path, query=None, body=None, accept='application/json'):
        """Returns (bytes, content_type). Retries 429/5xx and network/truncation errors with backoff;
        raises ApiError for everything else (never any other exception type)."""
        url = self.url(path, query)
        if not self.key:
            raise ApiError(401, 'ELEVENLABS_API_KEY is not set')
        if self.net_down:                                        # offline: fail fast instead of 14 s per asset
            raise ApiError(0, f'network error: skipped, API unreachable earlier ({self.net_down})')
        data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
        headers = {'xi-api-key': self.key, 'Accept': accept}
        if data is not None:
            headers['Content-Type'] = 'application/json'
        for attempt in range(self.retries + 1):
            req = urllib.request.Request(url, data=data, method=method, headers=headers)
            try:
                with urllib.request.urlopen(req, timeout=self.timeout, context=self.ctx) as r:
                    raw = r.read()                                        # may raise IncompleteRead
                    return raw, r.headers.get('Content-Type', '') or ''
            except urllib.error.HTTPError as e:                          # must precede URLError/OSError
                try:
                    raw = e.read()
                except Exception:
                    raw = b''
                msg, code = _err_detail(raw)
                if e.code in RETRY_HTTP and attempt < self.retries:
                    self._backoff(attempt, f'{method} {path}: HTTP {e.code} ({msg})', e.headers.get('Retry-After'))
                    continue
                raise ApiError(e.code, msg, code)
            except NET_ERRORS as e:
                if attempt < self.retries:
                    self._backoff(attempt, f'{method} {path}: {type(e).__name__}: {e}')
                    continue
                self.net_down = f'{type(e).__name__}'
                raise ApiError(0, f'network error: {type(e).__name__}: {e}')
        raise ApiError(0, 'retries exhausted')

    def json(self, method, path, query=None, body=None):
        raw, ctype = self.request(method, path, query, body)
        try:
            d = json.loads(raw)
        except ValueError:
            raise ApiError(0, f'bad JSON ({ctype or "no content-type"}, {len(raw)} bytes): {raw[:80]!r}')
        if not isinstance(d, dict):
            raise ApiError(0, f'unexpected JSON ({type(d).__name__})')
        return d

    def audio(self, method, path, query=None, body=None):
        """POST expecting audio bytes; the response is validated (see check_audio). Returns (bytes, seconds)."""
        raw, ctype = self.request(method, path, query, body, accept='audio/mpeg')
        return raw, check_audio(raw, ctype)


def _err_detail(raw):
    """ElevenLabs errors look like {"detail": {"status": "...", "message": "..."}} or {"detail": "..."}.
    Returns (message, status code string)."""
    try:
        d = json.loads(raw).get('detail', raw)
        if isinstance(d, dict):
            return f"{d.get('status', '')}: {d.get('message', '')}".strip(': '), str(d.get('status', ''))
        if isinstance(d, list):                                  # 422 validation errors
            return '; '.join(f"{'.'.join(map(str, x.get('loc', [])))}: {x.get('msg')}" for x in d), ''
        return str(d)[:300], ''
    except Exception:
        return (raw[:300].decode('utf-8', 'replace') if isinstance(raw, bytes) else str(raw)[:300]), ''


# ───────────────────────── audio validation ─────────────────────────
def ffmpeg_exe():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return 'ffmpeg'


def probe_seconds(raw):
    """Decode audio bytes with ffmpeg (8 kHz mono) -> (seconds, peak). Raises ValueError if undecodable.
    Returns None when ffmpeg itself is unavailable (then only the cheap checks apply)."""
    fd, tmp = tempfile.mkstemp(suffix='.bin')
    try:
        os.write(fd, raw)
        os.close(fd)
        try:
            p = subprocess.run([ffmpeg_exe(), '-v', 'error', '-i', tmp, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'],
                               capture_output=True, timeout=60)
        except (OSError, subprocess.TimeoutExpired):
            return None
        if p.returncode != 0 or len(p.stdout) < 2:
            raise ValueError(p.stderr.decode('utf-8', 'replace').strip().splitlines()[-1:] or 'no audio')
        pcm = array.array('h', p.stdout[: len(p.stdout) // 2 * 2])          # s16le (x86/arm are little-endian)
        return len(pcm) / 8000.0, max(max(pcm), -min(pcm)) / 32768.0
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def check_audio(raw, ctype=None, min_s=0.05):
    """Reject anything that is not real audio: wrong content-type, < 1 KB, undecodable, too short or silent."""
    ct = (ctype or '').split(';')[0].strip().lower()
    if ctype is not None and not (ct.startswith('audio/') or ct == 'application/octet-stream'):
        raise ApiError(0, f'not audio: content-type {ct or "missing"} ({len(raw)} bytes): {raw[:60]!r}')
    if len(raw) < MIN_AUDIO_BYTES:
        raise ApiError(0, f'audio too small ({len(raw)} bytes)')
    try:
        pr = probe_seconds(raw)
    except ValueError as e:
        raise ApiError(0, f'undecodable audio: {e}')
    if pr is None:                                               # no ffmpeg: fall back to a magic-number check
        if not (raw[:3] == b'ID3' or (raw[0] == 0xFF and raw[1] & 0xE0 == 0xE0) or raw[:4] in (b'RIFF', b'OggS', b'fLaC')):
            raise ApiError(0, 'unknown audio container')
        return 0.0
    secs, pk = pr
    if secs < min_s or pk < 1e-4:
        raise ApiError(0, f'audio empty/silent ({secs:.3f}s, peak {pk:.5f})')
    return secs


# ───────────────────────── cache / manifest ─────────────────────────
def req_hash(*parts):
    return hashlib.sha256(json.dumps(parts, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]


def file_sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 16), b''):
            h.update(chunk)
    return h.hexdigest()


class Manifest:
    """assets/<kind>/manifest.json: {key: {hash, files, sha:{file: sha256}, ...meta}}.
    An entry is only 'fresh' when the request hash matches AND every file still has the exact bytes this
    script wrote — so files overwritten by another tool (voices_free.py) are never mistaken for ours."""

    def __init__(self, kind, root=None):
        self.dir = os.path.join(root or ASSETS, kind)
        self.path = os.path.join(self.dir, 'manifest.json')
        try:
            self.d = json.load(open(self.path, encoding='utf-8'))
            if not isinstance(self.d, dict):
                self.d = {}
        except (OSError, ValueError):
            self.d = {}

    def valid(self, key, h=None):
        """Entry exists, (hash matches if given) and all its files are intact. Returns the entry or None."""
        e = self.d.get(key)
        if not isinstance(e, dict) or (h is not None and e.get('hash') != h):
            return None
        sha = e.get('sha') or {}
        for f in e.get('files', []):
            p = os.path.join(self.dir, f)
            try:
                if f not in sha or file_sha(p) != sha[f]:
                    return None
            except OSError:
                return None
        return e

    def fresh(self, key, h, files):
        e = self.valid(key, h)
        return bool(e and sorted(e.get('files', [])) == sorted(files))

    def put(self, key, h, files, **meta):
        os.makedirs(self.dir, exist_ok=True)
        sha = {f: file_sha(os.path.join(self.dir, f)) for f in files}
        self.d[key] = dict(hash=h, files=files, sha=sha, **meta)
        self.save()

    def drop(self, key):
        if self.d.pop(key, None) is not None:
            self.save()

    def save(self):
        os.makedirs(self.dir, exist_ok=True)
        tmp = self.path + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(self.d, f, ensure_ascii=False, indent=1)
        os.replace(tmp, self.path)


def write_bytes(path, b):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(b)
    os.replace(tmp, path)


def read_json(path, default=None):
    try:
        return json.load(open(path, encoding='utf-8'))
    except (OSError, ValueError):
        return default


# ───────────────────────── voices ─────────────────────────
def list_premade(cl):
    """All premade voices from GET /v2/voices (paginated)."""
    voices, token = [], None
    for _ in range(10):
        d = cl.json('GET', '/v2/voices', {'category': 'premade', 'page_size': 100, 'next_page_token': token})
        voices += [v for v in d.get('voices') or [] if isinstance(v, dict) and v.get('voice_id')]
        token = d.get('next_page_token')
        if not d.get('has_more') or not token:
            break
    return voices


def _first_name(name):
    return name.replace('-', ' ').split()[0].lower() if name else ''


def explicit_voice(v):
    return os.environ.get(v.get('env', ''), '') or v.get('voice_id') or None


def pref_key(v):
    """Identity of a character's voice *choice rule*, so a cached auto-picked voice id is reused only while
    the preference list is unchanged."""
    return req_hash(v.get('prefer'), v.get('fallback_gender'))


def resolve_voices(cfg, cl, dry):
    """who -> (voice_id, source). Priority: env var > sound_design voice_id > live premade list > known ids."""
    out, listing = {}, None
    for who, v in cfg['voices'].items():
        vid = explicit_voice(v)
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


def default_lines_path():
    p = os.path.join(HERE, 'script.json')
    return p if os.path.exists(p) else None


def load_lines(cfg, path):
    """Dialogue in film order. Source: --lines, else script.json (the file plan.py times), else
    sound_design.json lines. sound_design.json lines with the same id add per-line overrides
    (voice_settings, mood, model_id); the TEXT always comes from the source so plan.py can match it."""
    src = cfg.get('lines', [])
    if path:
        d = json.load(open(path, encoding='utf-8'))
        src = d['lines'] if isinstance(d, dict) else d
    by_id = {l['id']: l for l in cfg.get('lines', [])}
    lines = []
    for l in src:
        base = dict(by_id.get(l.get('id'), {}))
        base.update(l)
        base['who'] = base['who'].lower().replace('é', 'e')
        base['text'] = ' '.join(base['text'].split())
        lines.append(base)
    return lines


def tts_body(cfg, line, prev_text=None, next_text=None):
    """Request body for one line. previous_text/next_text give the model the neighbouring dialogue so it
    keeps Portuguese + a continuous prosody even on 1-word lines (multilingual_v2 takes no language_code)."""
    tts = cfg['tts']
    model = os.environ.get('ELEVEN_TTS_MODEL') or line.get('model_id') or tts['model_id']
    short = tts.get('short_line_model')
    if short and not os.environ.get('ELEVEN_TTS_MODEL') and len(line['text']) < tts.get('short_line_chars', 10):
        model = short
    vs = dict(cfg['voices'][line['who']]['voice_settings'])
    vs.update(line.get('voice_settings') or {})
    if model == 'eleven_v3':                             # v3 accepts stability 0.0 / 0.5 / 1.0 only
        vs['stability'] = min((0.0, 0.5, 1.0), key=lambda s: abs(s - vs['stability']))
    body = dict(text=line['text'], model_id=model, voice_settings=vs,
                apply_text_normalization=tts.get('apply_text_normalization', 'auto'))
    if tts.get('seed') is not None:
        body['seed'] = int(tts['seed'])
    if tts.get('context', True) and model not in tts.get('context_unsupported_models', []):
        if prev_text:
            body['previous_text'] = prev_text
        if next_text:
            body['next_text'] = next_text
    if tts.get('language_code') and model in tts.get('language_code_models', []):
        body['language_code'] = tts['language_code']
    return body


OPTIONAL_TTS = ('language_code', 'previous_text', 'next_text')


def tts_request(cl, path, query, body):
    """POST with-timestamps; on 400/422 retry once without the optional hint fields. Validates the reply.
    Returns (audio bytes, alignment dict, body actually used)."""
    try:
        d = cl.json('POST', path, query, body)
    except ApiError as e:
        opt = [k for k in OPTIONAL_TTS if k in body]
        if e.status not in (400, 422) or not opt:
            raise
        log(f'  {e}; retrying without {", ".join(opt)}')
        body = {k: v for k, v in body.items() if k not in OPTIONAL_TTS}
        d = cl.json('POST', path, query, body)
    b64 = d.get('audio_base64')
    if not isinstance(b64, str) or not b64:
        raise ApiError(0, f'no audio_base64 in response (keys: {sorted(d)[:6]})')
    try:
        audio = base64.b64decode(b64, validate=True)
    except (ValueError, TypeError) as e:
        raise ApiError(0, f'audio_base64 does not decode: {e}')
    check_audio(audio)
    al = d.get('alignment') or d.get('normalized_alignment') or {}
    align = dict(characters=list(al.get('characters') or []),
                 start=[float(x) for x in al.get('character_start_times_seconds') or []],
                 end=[float(x) for x in al.get('character_end_times_seconds') or []])
    if not align['characters'] or not (len(align['characters']) == len(align['start']) == len(align['end'])):
        raise ApiError(0, 'missing/inconsistent alignment')
    return audio, align, body


def voice_fatal(e):
    """Errors that will hit every following request too: stop the whole voice pass."""
    return e.status in (401, 402) or e.code in ('quota_exceeded', 'invalid_api_key', 'payment_required')


def do_voice(cfg, cl, args):
    man = Manifest('voice')
    fmt = cfg['api']['output_format']
    lines = load_lines(cfg, args.lines)
    ctx = {l['id']: (lines[i - 1]['text'] if i else None, lines[i + 1]['text'] if i + 1 < len(lines) else None)
           for i, l in enumerate(lines)}                             # neighbours in film order (before --ids)
    todo = [l for l in lines if not args.ids or l['id'] in args.ids]

    def request_for(line, vid):
        body = tts_body(cfg, line, *ctx[line['id']])
        path, query = f'/v1/text-to-speech/{vid}/with-timestamps', {'output_format': fmt}
        return path, query, body, req_hash(path, query, body)

    def files_of(line):
        return [f"{line['id']}.mp3", f"{line['id']}.json"]

    def cached(line):
        """Fresh without touching the network? Reuses the voice id of the cached take when that voice was
        auto-picked under the current preference list (so /v2/voices is only listed when needed)."""
        v = cfg['voices'].get(line['who'])
        if v is None or args.force:
            return False
        vid = explicit_voice(v)
        e = man.d.get(line['id']) or {}
        if not vid and e.get('pref') == pref_key(v):
            vid = e.get('voice_id')
        if not vid:
            return False
        meta = read_json(os.path.join(man.dir, files_of(line)[1]), {})
        return man.fresh(line['id'], request_for(line, vid)[3], files_of(line)) and meta.get('source') == 'elevenlabs'

    if args.dry_run:
        voices = resolve_voices(cfg, cl, True)
        for line in todo:
            if line['who'] in voices:
                path, query, body, _ = request_for(line, voices[line['who']][0])
                cl.show('POST', cl.url(path, query), body)
        return 0

    ok, failed = 0, {}
    pending = []
    for line in todo:
        if cached(line):
            log(f"{line['id']}: cached")
            ok += 1
        else:
            pending.append(line)
    voices = {}
    if pending:
        voices = resolve_voices(cfg, cl, False)
        for vwho, (vid, src) in voices.items():
            log(f'voice {vwho}: {vid} ({src})')
    stop, dead = None, {}                                    # dead: who -> reason (voice id refused)
    for line in pending:
        lid, who = line['id'], line['who']
        if stop or who in dead or who not in voices:
            failed[lid] = stop or dead.get(who) or f'no voice for {who}'
            continue
        vid = voices[who][0]
        path, query, body, h = request_for(line, vid)
        files = files_of(line)
        try:
            audio, align, used = tts_request(cl, path, query, body)
        except ApiError as e:
            failed[lid] = str(e)
            log(f'{lid}: TTS failed ({e})')
            if voice_fatal(e):
                stop = f'stopped after {lid}: {e}'
                log('  auth/quota problem — not requesting the remaining lines')
            elif e.status in (403, 404):
                dead[who] = f'voice {vid} refused: {e}'
                log(f'  voice {vid} refused — skipping the rest of {who}\'s lines')
            continue
        if ''.join(align['characters']) != line['text']:
            log(f'{lid}: note — alignment text differs from the line text (normalized?)')
        man.drop(lid)                                        # never leave a stale entry pointing at new bytes
        write_bytes(os.path.join(man.dir, files[0]), audio)
        meta = dict(align, text=line['text'], who=who, key=h, voice_id=vid, model_id=used['model_id'],
                    source='elevenlabs')
        write_bytes(os.path.join(man.dir, files[1]), json.dumps(meta, ensure_ascii=False).encode())
        man.put(lid, h, files, text=line['text'], voice_id=vid, who=who, pref=pref_key(cfg['voices'][who]))
        log(f"{lid} {who}: {line['text']!r} -> {align['end'][-1]:.2f}s")
        ok += 1
    mark_incomplete(man.dir, [l['id'] for l in todo], failed, {l['id']: l['who'] for l in lines})
    return ok


def mark_incomplete(vdir, attempted, failed, who_of):
    """assets/voice/INCOMPLETE.json lists lines this script could not produce (merged across runs, cleared
    line by line when they succeed). mix.py treats a character's voice set as a unit: if any of its lines
    lacks a take from the same engine+voice it babbles all of that character's lines."""
    p = os.path.join(vdir, 'INCOMPLETE.json')
    cur = (read_json(p, {}) or {}).get('failed', {})
    for lid in attempted:
        cur.pop(lid, None)
    cur.update(failed)
    if cur:
        os.makedirs(vdir, exist_ok=True)
        with open(p, 'w', encoding='utf-8') as f:
            json.dump(dict(failed=cur, who=sorted({who_of.get(k, '?') for k in cur})), f, ensure_ascii=False, indent=1)
        log(f'voice set INCOMPLETE ({", ".join(sorted(cur))}) — mix.py will babble the affected character(s)')
    elif os.path.exists(p):
        os.remove(p)


# ───────────────────────── sfx ─────────────────────────
def load_timeline(path):
    d = read_json(path)
    return d if isinstance(d, dict) else None


def sfx_body(cfg, cid, spec, dur=None):
    dflt = cfg['sfx_defaults']
    d = float(dur if dur else spec.get('dur', 1.0))
    suffix = spec.get('suffix', dflt.get('suffix', ''))               # vocal cues override the "no speech" suffix
    body = dict(text=spec['prompt'] + suffix, model_id=dflt['model_id'],
                duration_seconds=round(min(30.0, max(0.5, d)), 2),
                prompt_influence=spec.get('prompt_influence', dflt['prompt_influence']))
    if spec.get('loopable') and dflt['model_id'] == 'eleven_text_to_sound_v2':
        body['loop'] = True                                              # loop only exists on v2
    return body


def sfx_request(cfg, cid):
    """(path, query, body, hash) for one cue — also used by mix.py to reject stale files."""
    body = sfx_body(cfg, cid, cfg['sfx'][cid])
    path, query = '/v1/sound-generation', {'output_format': cfg['api']['output_format']}
    return path, query, body, req_hash(path, query, body)


def do_sfx(cfg, cl, args):
    man = Manifest('sfx')
    ids = list(cfg['sfx'])
    tl = load_timeline(args.timeline)
    if tl and tl.get('cues'):                                            # only cues the film actually uses
        used = {c['id'] for c in tl['cues']}
        ids = [i for i in ids if i in used] + sorted(used - set(ids))
    if args.ids:
        ids = [i for i in ids if i in args.ids]
    ok = 0
    for cid in ids:
        if not cfg['sfx'].get(cid):
            log(f'{cid}: no prompt in sound_design.json — synth only')
            continue
        path, query, body, h = sfx_request(cfg, cid)
        files = [f'{cid}.mp3']
        if args.dry_run:
            cl.show('POST', cl.url(path, query), body)
            continue
        if not args.force and man.fresh(cid, h, files):
            ok += 1
            continue
        try:
            raw, secs = cl.audio('POST', path, query, body)
        except ApiError as e:
            log(f'{cid}: sound generation failed ({e}) — synth fallback')
            if e.status in (401, 402) or e.code in ('quota_exceeded', 'invalid_api_key'):
                log('  auth/quota problem — not requesting the remaining SFX')
                break
            continue
        man.drop(cid)
        write_bytes(os.path.join(man.dir, files[0]), raw)
        man.put(cid, h, files, prompt=body['text'], duration=body['duration_seconds'])
        log(f'{cid}: {len(raw) // 1024} KB, {secs:.2f}s')
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
    # its mood is kept as a tag so e.g. a short trailing 'end' still asks for the gentle ending.
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


def music_stinger(cfg, tl):
    return ((tl or {}).get('music') or {}).get('stinger', cfg['music'].get('default_stinger'))


def music_body(cfg, tl):
    """(composition-plan body, plain-prompt fallback body). The fim_chord SFX is the film's only 'ta-da':
    the score is asked for a soft sustained final chord that has died away just before the stinger
    (mix.py additionally fades the score out from stinger-0.05 s), never for a hit at an exact time."""
    m = cfg['music']
    model = os.environ.get('ELEVEN_MUSIC_MODEL', m['model_id'])
    spans, total = music_sections(cfg, tl)
    stinger = music_stinger(cfg, tl)
    ms = [int(round(d * 1000)) for _, _, d, _ in spans]
    ms[-1] += int(round(total * 1000)) - sum(ms)                      # exact total length
    sections = []
    for k, ((mood, a, d, merged), dur_ms) in enumerate(zip(spans, ms)):
        mm = m['moods'].get(mood, m['moods']['happy'])
        pos, neg = list(mm['pos']), list(mm['neg'])
        if 'end' in merged or (k == len(spans) - 1 and stinger):
            pos += m['moods']['end']['pos']
            neg += m['moods']['end']['neg']
            if stinger:
                pos.append(f'final chord sustained, decaying away by {max(0.5, stinger - 0.25 - a):.1f}s into this section')
        name = mm['name'] + (' (reprise)' if any(x['section_name'].endswith(mm['name']) for x in sections) else '')
        sections.append(dict(section_name=f"{k + 1}. {name}", positive_local_styles=pos,
                             negative_local_styles=neg, duration_ms=dur_ms, lines=[]))
    if model == 'music_v1':
        plan = dict(positive_global_styles=m['global_positive'], negative_global_styles=m['global_negative'],
                    sections=sections)
    else:                                                               # music_v2 / music_v2_5 chunk plan
        # chunk 'text' is sung lyrics -> '[Instrumental]' so no section name is ever sung
        plan = dict(chunks=[dict(text='[Instrumental]', duration_ms=s['duration_ms'],
                                 positive_styles=m['global_positive'] + s['positive_local_styles'],
                                 negative_styles=m['global_negative'] + s['negative_local_styles'])
                            for s in sections])
    body = dict(composition_plan=plan, model_id=model)
    if model == 'music_v1':
        body['respect_sections_durations'] = True                      # documented for music_v1 only
    if m.get('seed') is not None:
        body['seed'] = int(m['seed'])                                   # seed is plan-only (rejected with prompt)
    fallback = dict(prompt=m['prompt'], music_length_ms=int(round(total * 1000)), force_instrumental=True, model_id=model)
    return body, fallback


def music_request(cfg, tl):
    """(path, query, body, fallback, hash) — the hash is also recomputed by mix.py to detect a stale score."""
    body, fallback = music_body(cfg, tl)
    path, query = '/v1/music', {'output_format': cfg['api']['output_format']}
    return path, query, body, fallback, req_hash(path, query, body)


def do_music(cfg, cl, args):
    man = Manifest('music')
    tl = load_timeline(args.timeline)
    path, query, body, fallback, h = music_request(cfg, tl)
    files = ['score.mp3']
    if args.dry_run:
        cl.show('POST', cl.url(path, query), body)
        print('    (if the composition plan is rejected with 400/422, eleven.py retries with:)')
        cl.show('POST', cl.url(path, query), fallback)
        return 0
    if not args.force and man.fresh('score', h, files):
        log('music: cached')
        return 1
    block = os.path.join(man.dir, 'UNAVAILABLE.json')
    b = read_json(block, {}) or {}
    if not args.force and b.get('key') == cl.key[-6:] and time.time() - float(b.get('time', 0)) < MUSIC_BLOCK_S:
        log(f"music: skipped — refused {(time.time() - float(b['time'])) / 3600:.1f} h ago ({b.get('error')}); "
            '--force to retry. mix.py uses the synth score.')
        return 0
    try:
        try:
            raw, secs = cl.audio('POST', path, query, body)
            used = 'composition_plan'
        except ApiError as e:
            if e.status not in (400, 422):
                raise
            log(f'music: composition plan rejected ({e}); retrying with the plain prompt')
            raw, secs = cl.audio('POST', path, query, fallback)
            used = 'prompt'
    except ApiError as e:
        if e.status in (401, 402, 403):
            log(f'music: not available on this plan/key ({e}). The Music API is for paid subscribers; '
                'mix.py will use the synth ukulele score.')
            os.makedirs(man.dir, exist_ok=True)
            with open(block, 'w', encoding='utf-8') as f:                          # remember for 24 h (key suffix only, never the key)
                json.dump(dict(time=time.time(), error=str(e), key=cl.key[-6:]), f)
        else:
            log(f'music: failed ({e}) — mix.py will use the synth score')
        return 0
    man.drop('score')
    write_bytes(os.path.join(man.dir, files[0]), raw)
    man.put('score', h, files, mode=used, model_id=body['model_id'])
    if os.path.exists(block):
        os.remove(block)
    log(f'music: score.mp3 {len(raw) // 1024} KB, {secs:.2f}s via {used}')
    return 1


# ───────────────────────── main ─────────────────────────
def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--only', default='voice,sfx,music', help='comma list of voice,sfx,music')
    ap.add_argument('--dry-run', action='store_true', help='print exact requests, no network')
    ap.add_argument('--force', action='store_true', help='ignore the cache (and the music 24 h block)')
    ap.add_argument('--lines', default=default_lines_path(),
                    help='lines json (list or {lines:[...]}); default script.json, else sound_design.json lines')
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
    try:
        cfg = json.load(open(args.design, encoding='utf-8'))
        cl = Client(cfg, args.dry_run)
    except Exception as e:                                               # unreadable config: nothing to do
        log(f'cannot start ({type(e).__name__}: {e}) — mix.py will use fallbacks')
        return 0
    if not cl.key and not args.dry_run:
        log('ELEVENLABS_API_KEY not set — nothing generated; mix.py will use fallbacks')
        return 0
    for p in parts:
        try:                                                             # one broken part never blocks the next
            n = {'voice': do_voice, 'sfx': do_sfx, 'music': do_music}[p](cfg, cl, args)
            if not args.dry_run:
                log(f'{p}: {n} asset(s) ready')
        except Exception as e:
            log(f'{p}: unexpected {type(e).__name__}: {e} — skipped, fallback will be used')
            traceback.print_exc(limit=3, file=sys.stdout)
    return 0


if __name__ == '__main__':
    sys.exit(main())
