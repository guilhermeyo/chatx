# Directing an episode (film.js + plan.py)

Read the example `film.js` alongside this file: it is a complete, working episode built this way.

## How film.js is organised

1. **Timing** comes from `window.TL` (written by `plan.py`): `TL.ev` beat times, `TL.lines` (dialogue with
   per-character start/end times from the real voice clips), `TL.fps`, `TL.dur`.
2. **Two clocks.** `Tc = frame / fps` drives the camera (moves on ones, smooth). `t = floor(Tc*12)/12`
   drives characters, props and FX (animated "on twos", 12 drawings/s — the classic TV-cartoon look).
   Line boil uses `floor(Tc*8)`.
3. **Shots.** `SHOTS = [{id, t0, cam: t => [cx, cy, z]}]`, hard cuts between shots. `cx, cy` is the world
   point at screen centre, `z` the zoom (1.2 wide … 3.2 extreme close-up). Visible world area is
   1920/z × 1080/z. Use `T.track(t, [[t0,[cx,cy,z]], [t1, ...]], ease)` for moves and the `snap()` helper
   for 3-frame punch-ins.
4. **Acting.** One pose function per character returns a pose object for time `t` (fields in
   `contract.md`). Build it in layers: defaults → per-beat overrides with `T.win(t, a, b, fadeIn, fadeOut)`
   blends → lip sync last (`speech(who, t)` sets `mouth.viseme`).
5. **Frame.** Background in screen space (`T.sets.drawBackground`, it does its own parallax) → world
   camera transform → bench/props → characters (drawKid/draw return anchors) → FX placed on anchors
   (cloud over `headTop`, crust from `handN` to the dog's `mouth`) → foreground in screen space → iris /
   titles in screen space.

## Craft that made "O Lanche" work

- **Cover the conversation with shot variety.** Establishing wide → medium on the speaker → close-up on the
  listener's reaction → back to a two-shot for the physical business. Cut on action or at the end of a line.
  An insert close-up (the dog's pleading eyes) sells the button gag.
- **Screen direction and lead room.** Léo on the left facing right, Bia on the right facing left. Frame a
  speaker slightly off-centre with space in front of their face.
- **Anticipation → action → hold.** Crouch before the hop, stretch in the air, squash on landing (`sq`).
  After every joke hold 0.3–0.5 s so it lands (the frozen forced smile before the tummy growl).
- **Overlapping action.** Hair drags with `vel` and settles; ears lag on the dog; the head follows the
  shoulders two drawings later when a character deflates.
- **Eye-lines tell the story.** Pupils first (`look`), then the head (`tilt`, `turn`). Characters look at
  whoever talks, at the object that matters (sandwich, dog), then at each other for the shared laugh.
- **Readable emotion = brows + lids + mouth together.** Worried: `brows {raise .3, knit -1}`, `lids .6`,
  `smile -.8`, head tilt/nod down. Delight: `sparkle`, `brows.raise 1`, open grin, blush.
- **Sound sells timing.** Put a cue on every impact (pop, snap, land, catch) and place music mood changes on
  story turns (the music turns sad on the confession, happy on the stars).

## Pitfalls we actually hit (check these on the contact sheet)

- **Framing crops the important thing:** a rain cloud above the head was off the top of a close-up; a low
  dog shot cut the kids mid-face (frame them at the shoulders instead, or include the whole head).
  Whenever an FX lives above a head, move the camera up (`cy` smaller) or zoom out for that beat.
- **Raised arms crossing the face:** use `T.rig.POSE.waveN` / `waveF` or leave `autoReach` on; a thumbs-up
  at `armN [1.45, 0.55]` sits at chest height, higher reads as "hand on mouth".
- **State leaking into later beats:** a sweat drop that stayed on after the character became happy. Reset
  transient features (`sweat`, `lids`, `sparkle`, `holdN`) explicitly when the emotion changes.
- **Voice overlaps:** TTS clips run longer than the text suggests (pauses after commas/"!"). Always rebuild
  the timeline with real clips (`build.py --audio`) and read the start–end printout before cutting shots.
- **Cutting mid-word:** place shot cuts after `line.end`, not at the scheduled start of the next line.
- **Anchors are per frame:** draw the dog before placing FX that use its anchors (crust flight, "Arf!").

## Review loop

`build.py <proj> --stills t1,t2,...` renders only those moments (seconds) and writes `contact.jpg`. Pick one
time per beat plus both sides of every cut. Look at the sheet, fix, repeat; only then run the full build and
look at a sheet of the final video (`ffmpeg -i out.mp4 -vf fps=2,scale=480:-1,tile=6x5 sheet.jpg`).
