# Engine API (core / props / sets / rig / dog)

A 15-second, 1920x1080, 24 fps cartoon short rendered deterministically on an HTML canvas
(headless Chromium screenshots each frame, ffmpeg encodes). Style: **90s TV cartoon, inspired by
"Doug" and "Peanuts" but with ORIGINAL characters** (never draw Doug, Snoopy or any existing
character): flat colours, dark brush-inked outlines (`TOON.ink`, varying width), outlines that "boil"
(re-jitter 8x/s via `TOON.J`), characters animated on twos (12 poses/s), camera on ones.

## Story of the example episode "O Lanche"
Park bench, late afternoon. **Léo** (kid, big oval head, big round nose, spiky brown hair, red tee,
blue shorts) walks in. **Bia** (kid, brown skin, black bob with bangs + yellow hair clip, round
glasses, purple tee, yellow shorts) reads a book on the bench. "Oi, Bia! Tudo bem?" / "Tudo ótimo!
E você?" / Léo, sad: "Tô bem... mas esqueci meu lanche." (tummy growl, little rain cloud over his
head) / Bia pulls a sandwich from behind her back, snaps it in half: "Metade?" / Léo's eyes turn to
stars, cloud poofs, he hops onto the bench, takes the half (stretchy arm): "Valeu!!" / **Pipoca**
(original small tan dog with brown spots and long floppy dark-brown ears — NOT a beagle, NOT white)
trots in, sniffs, puppy eyes / kids look at each other and laugh / Léo tosses the crust, Pipoca
catches it mid-air "Arf!" / iris-out on Pipoca, who winks / "Fim."

## Files & load order (all plain browser JS, no modules, no build step)
`core.js` (given, read it) → `props.js` → `sets.js` → `rig.js` → `dog.js` → `film.js`.
Everything hangs off `window.TOON` (alias `T`). All drawing uses `T.ctx` (set per frame by
`T.beginFrame(ctx, boil)`) in the CURRENT transform — modules never reset the transform
(use save/restore). Use core primitives (`T.shape`, `T.blob`, `T.ink`, `T.stroke`, `T.limb`,
`T.shadow`, `T.text`, `T.J`) so the whole film shares one line quality. Deterministic only:
no Math.random / Date / performance.now; randomness = `T.hash(seed)`.
Time `t` passed to modules is already quantised to twos by film.js (except camera).

## World layout (world units = pixels at camera zoom 1)
- Ground line (feet) y = 860; path band y 830–975; grass above 770.
- Bench seat top y = 740, bench spans x 850–1390, backrest planks y 600–676.
- Hip y for a standing AND a seated kid = 740 (legs 58+54 + shoe → feet at ~860).
- Léo stands at x≈760, later sits at x≈945. Bia sits at x≈1240 facing left. Pipoca sits at
  x≈1095, y(ground)=905 (in front of the bench, closer to camera).
- Camera: `{cx, cy, z}` world point at screen centre + zoom. Shots range z=1.2 (wide) to z≈3.2
  (extreme close-up on a face or on the dog's eyes). **Everything must still look good at z=3.**

## props.js  →  `T.props`
`sandwichWhole(x,y,s,rot)`, `sandwichHalf(x,y,s,rot,state)` state 0 full / 1 bitten / 2 crust only,
`book(x,y,s,rot,open)` (open: 0 closed…1 open spread), `lunchbox(x,y,s)`, `crumbs(x,y,t0,t,seed)`,
`rainCloud(x,y,s,t)` (with falling drops), `poof(x,y,s,u)` (u 0..1 smoke puff), `sparkleBurst(x,y,u,n,R,color)`,
`hearts(x,y,u)`, `burst(x,y,s,label)` (comic "Arf!" starburst), `speechBubble(spec)` (see film),
`motionLines(pts,u)` (speed lines). All in world coords, centred on (x,y).

## sets.js  →  `T.sets`
`T.sets.drawBackground(t, cam)`: sky, sun, clouds, far hills, houses, near hills, tree, lamp,
bushes, ground & path — with **parallax**: each layer has a depth factor; the function receives the
camera and applies its own per-layer transforms (layer factor 1 == the main world camera). When
`cam.z > 1.8` apply a depth-of-field softening to far layers (ctx.filter blur, 0–6px, scaled
by zoom). `T.sets.drawBench(t)` (world coords, called by film inside the main camera transform,
behind characters). `T.sets.drawForeground(t, cam)` (grass tufts / flowers in front of everything,
parallax factor > 1, optional). Light: warm late-afternoon sun from the upper left; long soft
shadows are fine. Palette `T.C`. Also `T.sets.WORLD` = the numbers above.

## rig.js  →  `T.rig.drawKid(design, pose)` → anchors
`T.rig.LEO`, `T.rig.BIA` design objects. `pose` fields (all optional, defaults sensible):
```
x, y            hip position (world). face: 1 right / -1 left.  scale (default 1)
sit 0..1        standing→seated blend.   walk: phase (radians) or null.   vel: px/s (for hair drag)
sq              squash(+)/stretch(-) about the feet.   lean: torso lean (rad, + = forward)
tilt, nod       head tilt (rad) and head vertical offset (px)
turn 0..1       0 = 3/4 view toward `face`; 1 = more frontal (features slide toward centre)
armN, armF      [shoulder, elbow] radians; shoulder 0 = hanging down, +π/2 forward, π up.
strN, strF      arm stretch factor (rubber-hose; 1 = normal)
handN, handF    'mitt' | 'fist' | 'open' | 'point' | 'wave'
holdN, holdF    prop in hand: null | {kind:'sandHalf', state} | {kind:'sandWhole'} | {kind:'book', open}
look [x,y]      pupils -1..1.   blink 0..1.   lids 0..1 (sad droop).   sparkle 0/1 (star pupils)
joy 0/1         happy closed "^^" eyes.   brows {raise:-1..1, knit:-1..1}
mouth {open 0..1, smile -1..1, viseme: 'rest'|'A'|'E'|'I'|'O'|'U'|'M'|'F'}
blush 0..1, sweat 0..1 (sweat drop), shadow: true (contact shadow at feet/seat)
```
Returns `{head:[x,y], headTop:[x,y], mouth:[x,y], handN:[x,y], handF:[x,y], feet:[x,y]}` in the
coordinate space of the caller's current transform (so film can place bubbles/props/cloud).

## dog.js  →  `T.dog.draw(pose)` → anchors
```
x, y (ground), face, scale, mode 'walk'|'sit'|'jump', walk phase, wag (phase), wagAmp,
tilt, look [x,y], blink, puppy 0..1 (huge glossy pleading eyes), wink 0/1, earPerk 0..1,
mouth 'closed'|'open'|'tongue'|'chew'|'bark', holding 'crust'|null, sniff 0..1, sq
```
Returns `{head, nose, mouth, eyes:[[x,y],[x,y]]}`.

## Audio
`script.json` (dialogue) → voices (`voices_free.py` or `eleven.py`) → `plan.py` → `timeline.json`:
```
{ "dur":15, "fps":24, "voice": bool,
  "ev": {name: seconds},
  "lines": [{"id","who","text","start","end","ct":[char start times],"ce":[char end times],"audio": path|null}],
  "cues": [{"id","t","gain","pan","dur"?}],
  "music": {"sections":[{"t":0,"mood":"happy"|"sad"|"end"},...], "stinger": seconds} }
```
`mix.py` uses a voice clip only if its text matches the line (otherwise babble), each cue id from
`assets/sfx` (ElevenLabs) or `synth.py`, music from `assets/music` or the procedural ukulele. Voice pitch
lift per character: `sound_design.json` → `voices.<who>.pitch_factor` (duration preserving).

## Implementation notes (beyond the contract above)
- **sets.js:** call `drawBackground(t, cam)` and `drawForeground(t, cam)` in SCREEN space (identity
  transform, plus camera shake if any) — they apply per-layer parallax themselves. Only `drawBench(t)` is
  called inside the world camera. `T.sets.layerTransform(cam, f)` places extra things in a layer.
  `cam` = `{cx, cy, z}`. Depth of field kicks in above z = 1.8.
- **rig.js extras:** `T.rig.POSE` arm presets (`waveN`, `waveF`, `tossN`, `hopArms`) — spread into a pose;
  `T.rig.STRIDE` (px per radian of walk phase, keeps planted feet from sliding); `pose.tuck` (airborne tuck,
  automatic when `shadow` is a ground-y number); `pose.autoReach: false` disables the automatic "keep raised
  hands off the face"; `pose.legSwing` (dangling feet), `pose.wide` (bigger eyes), `pose.seed`;
  `holdF.front`; `mouth.open` scales a viseme and `mouth.blend {from, u}` in-betweens visemes.
  The walk cycle bobs the body itself (don't add bob); arms swing automatically while walking if
  `armN`/`armF` are omitted. Anchors also include `footN`, `footF`.
- **dog.js extras:** `lift` (px above ground; the shadow stays), `jumpU` 0..1 (take-off → apex → landing),
  `beg` (begging paw override), `earLift`, `crustScale`, `crustT`, `sniffPh` / `chewPh` (explicit twitch
  phases). `holding: 'crust'` draws the crust in the mouth.
- **props.js:** `speechBubble(spec)` returns `{x0, y0, w, h, outer}`; `style: 'shout'` gives a spiky bubble;
  `book(..., open < 0)` draws a closed book lying flat.
- **Line boil:** backgrounds never boil; characters/props boil 8x/s via `T.J`; the rig uses its own
  per-part jitter so a pose change doesn't re-jitter unrelated lines.
