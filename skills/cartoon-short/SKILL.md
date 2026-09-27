---
name: cartoon-short
description: Make short 2D cartoon videos (MP4 with voices, lip sync, music and sound effects) in a 90s TV-cartoon style (Doug / Peanuts inspired, original characters) from a simple story or dialogue. Ships a procedural canvas animation engine with two kid characters (Léo, Bia), a dog (Pipoca), a park set, props, free Brazilian-Portuguese neural voices (optional ElevenLabs), camera direction and a one-command build. Use this skill whenever the user wants an animated short, cartoon scene, "desenho animado", "animação", "vídeo animado com personagens", a little story or conversation turned into a video, a new episode with Léo/Bia/Pipoca, or asks to make "O Lanche"-style videos — even if they don't say "skill" or name the characters.
---

# Cartoon short

This skill turns a short story (typically 10–30 s, one location, a simple conversation) into a finished
1920x1080 24 fps MP4. Everything is drawn procedurally on an HTML canvas and rendered frame by frame in
headless Chromium, so results are deterministic and editable as code. The bundled example episode,
"O Lanche" (15 s), is the reference for quality: study it before writing a new one.

## What's in the box

- `assets/engine/` — the shared engine, copied into every project:
  `core.js` (brush-inked, boiling line primitives), `props.js`, `sets.js` (late-afternoon park with parallax
  and depth of field), `rig.js` (kids Léo and Bia: visemes, expressions, hands, rubber-hose arms, walk, sit),
  `dog.js` (Pipoca: trot, sit, jump, puppy eyes, wink, bark), `voices_free.py` (free pt-BR TTS with word
  timings), `eleven.py` (ElevenLabs voices/SFX/music when `ELEVENLABS_API_KEY` is set), `synth.py`
  (procedural ukulele score + ~27 cartoon SFX), `mix.py`, `render.mjs`.
- `assets/example/` — the story files of "O Lanche": `script.json` (dialogue), `plan.py` (beat times +
  sound cues), `film.js` (shots, camera, acting, lip sync, FX).
- `scripts/new_project.py`, `scripts/check_env.py`, `scripts/build.py`.
- `references/contract.md` — the full engine API (pose fields, anchors, props, sets). Read it before
  writing `film.js`.
- `references/directing.md` — how to direct an episode: shot design, acting, timing, the pitfalls we hit.
  Read it before writing a new story.

## Workflow

1. **Set up once per project** (Windows/macOS/Linux; needs Python 3.9+ and Node 18+):
   ```
   python <skill>/scripts/new_project.py <project_dir>
   python <skill>/scripts/check_env.py <project_dir> --install
   ```
   `check_env.py --install` pip-installs numpy/scipy/edge-tts/certifi/imageio-ffmpeg, runs `npm install`
   (playwright) and downloads Chromium. ffmpeg comes from imageio-ffmpeg, so nothing system-wide is needed.
   Confirm the example builds (`python <skill>/scripts/build.py <project_dir>`) before changing anything,
   so a later failure is clearly caused by your edits.

2. **Write the story with the user.** Agree on: premise in one sentence, cast (Léo, Bia, Pipoca or new kids
   — see "Extending"), length, the dialogue lines (short, natural; ~13 characters/second of speech plus
   pauses), and the ending button (the example ends on the dog's wink + iris-out + "Fim."). Keep it to one
   location unless the user wants to invest in a new set.

3. **Dialogue → voices.** Put the lines in `script.json` (`id`, `who`, `text`, `start` = clip start in
   seconds). Optional `"cast"` overrides voices/pitch/rate per character. Run
   `python <skill>/scripts/build.py <project_dir> --audio` to synthesize voices and print each line's real
   start–end; adjust starts so lines don't overlap and leave room for reactions.

4. **Beats and sound → `plan.py`.** Edit `EV` (every story beat and shot cut, in seconds) and `cues()`
   (sound effects by id at beat times; ids are listed in `sound_design.json` → `sfx`, each has a synth
   fallback). Keep the total duration in `DUR`. Music moods switch at `music.sections`.

5. **Direction → `film.js`.** Rewrite `SHOTS` (camera per shot), the per-character pose functions and the
   FX block for the new story, using `EV` names. Follow `references/directing.md`. Lip sync is automatic:
   `speech(who, t)` reads the voice timings from the timeline.

6. **Review cheaply, then build.** Render stills at the key moments and look at the contact sheet
   (`--stills 0.5,2.1,4.3,...` → `contact.jpg`; open it and actually look). Fix framing/acting, repeat. Then
   run the full build (a 15 s film renders in about 1–3 minutes) and check a contact sheet of the final video
   too. Tell the user what you checked by eye and what you could not (you cannot listen to the audio —
   say so, and offer to tweak voice pitch/rate or levels on their feedback).

## Extending

- **New kid characters:** `T.rig.LEO` / `T.rig.BIA` are design objects (skin, shirt, shorts, hair colours,
  `hairStyle: 'spikes' | 'bob'`, eye/nose/mouth geometry, glasses, lashes, blush, emblem). Clone one with
  `Object.assign({}, T.rig.LEO, {...})` and vary colours/features for classmates. Keep them original — never
  recreate Doug, Snoopy or any existing copyrighted character, even if asked; offer an original character
  "in that style" instead.
- **New set:** write a module with the same interface as `sets.js` (`drawBackground(t, cam)` in screen
  space with per-layer parallax, `drawBench`-style world props, `drawForeground`, `WORLD` numbers) and load
  it in `film.html` instead of `sets.js`. It is the biggest single job; budget for it.
- **Other languages/voices:** `edge-tts --list-voices` lists free voices for many languages; set them in
  `script.json` → `cast`. With `ELEVENLABS_API_KEY` set, `eleven.py` is used instead (voices with
  character timestamps, SFX, and Eleven Music, which requires a paid ElevenLabs plan; failures fall back to
  the free/procedural path automatically).

## Troubleshooting

- `PAGE ERROR` during render: a JS exception in `film.js` (usually a typo or an `EV` name that doesn't
  exist in `plan.py`). Render one still to reproduce quickly.
- Voices not used ("est" in the plan output): the clip's text no longer matches `script.json`; re-run
  `--audio`. edge-tts needs internet access.
- Blank/black frames: fonts or `timeline.js` missing — run `build.py` (it regenerates the timeline) from
  the project folder created by `new_project.py`.
