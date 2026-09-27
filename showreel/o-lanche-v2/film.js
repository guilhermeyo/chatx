// film.js — direction for "O Lanche" v2: shots, camera, acting, lip sync, FX. renderFrame(i) draws frame i.
// Timing comes from timeline.js (window.TL, written by plan.py). Characters/props animate on twos
// (12 poses/s, t quantised); the camera moves on ones.
'use strict';
(function () {
  const T = window.TOON, TL = window.TL, EV = TL.ev;
  const { W, H, TAU, lerp, lerpA, clamp, p, E, win, decay, hash, track } = T;
  const cv = document.getElementById('out'), ctx = cv.getContext('2d');
  const R = T.rig, D = T.dog, P = T.props, S = T.sets;
  const WD = S.WORLD;

  // ───────────────── lip sync from the voice alignment ─────────────────
  const VIS = ch => {
    const c = ch.toLowerCase();
    if ('aáàâã'.includes(c)) return 'A';
    if ('eéê'.includes(c)) return 'E';
    if ('ií'.includes(c)) return 'I';
    if ('oóôõ'.includes(c)) return 'O';
    if ('uú'.includes(c)) return 'U';
    if ('mbp'.includes(c)) return 'M';
    if ('fv'.includes(c)) return 'F';
    if (/[a-zç]/.test(c)) return 'E';
    return null;
  };
  // → {viseme, open, talking} for `who` at time t (null when not speaking)
  function speech(who, t) {
    for (const L of TL.lines) {
      if (L.who !== who || t < L.start - 0.02 || t > L.end) continue;
      let v = null;
      for (let i = 0; i < L.text.length; i++) if (t >= L.ct[i] && t < (L.ce ? L.ce[i] : L.ct[i] + 0.08)) { v = VIS(L.text[i]); if (v) break; }
      return { viseme: v || 'rest', talking: !!v, line: L };
    }
    return null;
  }

  // ───────────────── shots & camera ─────────────────
  // cam = {cx, cy, z}. Hard cuts between shots (cartoon cutting); snap zooms happen on ones.
  const snap = (t, t0, dz, hold = 0.35) => t < t0 ? 0 : dz * (t < t0 + 3 / 24 ? p(t, t0, t0 + 3 / 24) : 1 - E.inOut(p(t, t0 + hold, t0 + hold + 0.3)) * 0.6);
  let DOGHEAD = [1080, 765];                       // calibrated at load (sitting puppy pose)
  const SHOTS = [
    { id: 'S1 wide', t0: 0, cam: t => track(t, [[0, [1070, 612, 1.22]], [1.9, [1012, 616, 1.3]]], E.inOut) },
    { id: 'S2 Léo MS', t0: EV.s2, cam: t => { const c = track(t, [[EV.s2, [828, 520, 2.25]], [EV.s3, [820, 514, 2.36]]], E.lin); return c; } },
    { id: 'S3 Bia CU', t0: EV.s3, cam: t => track(t, [[EV.s3, [1172, 548, 2.7]], [EV.s4, [1178, 544, 2.82]]], E.lin) },
    { id: 'S4 Léo MCU', t0: EV.s4, cam: t => {
        let c = track(t, [[EV.s4, [802, 532, 2.4]], [EV.growl, [800, 530, 2.45]], [EV.growl + 0.45, [790, 556, 2.75]], [EV.cloudIn - 0.15, [792, 540, 2.6]], [EV.cloudIn + 0.25, [796, 470, 2.25]], [EV.s5, [798, 466, 2.3]]], E.inOut);
        c = [c[0], c[1], c[2] + snap(t, EV.growl, 0.35, 0.2)];
        return c;
      } },
    { id: 'S5 two-shot', t0: EV.s5, cam: t => track(t, [[EV.s5, [1002, 602, 1.74]], [EV.snap, [1008, 600, 1.78]], [EV.s6, [1012, 598, 1.8]]], E.lin) },
    { id: 'S6 Léo ECU', t0: EV.s6, cam: t => { const c = [792, 478, 2.8]; c[2] += snap(t, EV.stars, 0.3, 0.15); return c; } },
    { id: 'S7 seated two-shot', t0: EV.s7, cam: t => track(t, [[EV.s7, [1060, 612, 1.8]], [EV.land, [1092, 612, 1.86]], [EV.s8, [1098, 614, 1.9]]], E.inOut) },
    { id: 'S8 dog', t0: EV.s8, cam: t => {
        const a = track(t, [[EV.s8, [1180, 862, 2.4]], [EV.dogSit + 0.05, [1108, 866, 2.45]]], E.inOut);
        const u = E.inOut(p(t, EV.puppy - 0.1, EV.s9 - 0.05));
        return lerpA(a, [DOGHEAD[0], DOGHEAD[1] + 6, 3.15], u);
      } },
    { id: 'S9 kids react', t0: EV.s9, cam: t => track(t, [[EV.s9, [1092, 598, 1.92]], [EV.s10, [1094, 596, 1.96]]], E.lin) },
    { id: 'S10 toss & iris', t0: EV.s10, cam: t => track(t, [[EV.s10, [1080, 690, 1.52]], [EV.toss + 0.12, [1080, 664, 1.55]], [EV.catch + 0.1, [1085, 690, 1.58]], [EV.irisOut, [1088, 700, 1.62]]], E.inOut) },
  ];
  const shotAt = t => { let s = SHOTS[0]; for (const x of SHOTS) if (t >= x.t0) s = x; return s; };
  const shake = t => {
    const k = 5 * decay(t, EV.land, 14) + 3 * decay(t, EV.growl, 10) * (t < EV.growlEnd ? 1 : 0) + 2.5 * decay(t, EV.pop, 16) + 4 * decay(t, EV.catch, 14);
    const f = Math.floor(t * 24);
    return [(hash(f * 1.3) - .5) * 2 * k, (hash(f * 2.7) - .5) * 2 * k];
  };

  // ───────────────── acting: Léo ─────────────────
  const REST_STAND = [[-0.04, 0.2], [0.3, 0.25]];
  function leoPose(t) {
    const Q = { design: R.LEO, face: 1, y: WD.hip, shadow: true, sq: 0, look: [0.8, 0.05], mouth: { smile: 0.55 }, brows: { raise: 0.1, knit: 0 }, lids: 0 };
    // walk in
    if (t < EV.walk1) {
      Q.x = lerp(-170, WD.leoStandX, p(t, EV.walk0, EV.walk1)); Q.walk = (t - EV.walk0) * TAU * 1.9; Q.vel = 520;
    } else if (t < EV.hop) {
      Q.x = WD.leoStandX; Q.vel = -60 * decay(t, EV.walk1, 8);
    } else {
      const u = p(t, EV.hop, EV.land);
      Q.x = lerp(WD.leoStandX, WD.leoSitX, E.inOut(u)); Q.y -= 170 * Math.sin(Math.PI * u) * (u < 1 ? 1 : 0); Q.vel = u < 1 ? 600 : -80 * decay(t, EV.land, 8);
      Q.sit = E.inOut(p(t, EV.hop + 0.05, EV.land - 0.05));
      Q.shadow = WD.ground;
    }
    Q.sq = 0.1 * decay(t, EV.walk1, 10) + 0.18 * decay(t, EV.land, 11)
      + (t >= EV.crouch && t < EV.hop ? 0.16 * E.out(p(t, EV.crouch, EV.hop)) : 0) - (t >= EV.hop && t < EV.land ? 0.14 * Math.sin(Math.PI * p(t, EV.hop, EV.land)) : 0);
    if (t < EV.walk1) { Q.armN = null; Q.armF = null; } else { [Q.armN, Q.armF] = REST_STAND; }

    // S2: greeting wave (big, with anticipation)
    const wv = win(t, EV.s2 + 0.02, EV.s3 - 0.3, 0.1, 0.18);
    if (wv > 0) { Q.armN = lerpA(Q.armN, [3.35 + 0.14 * Math.sin(t * 15), -0.35 + 0.35 * Math.sin(t * 15)], wv); Q.strN = 1 + 0.25 * wv; Q.handN = 'wave'; Q.brows.raise = 0.5; Q.mouth.smile = 0.9; Q.tilt = -0.04; }
    // S4: forced "Tô bem!" with thumbs-up → freeze → growl → collapse
    const th = win(t, EV.thumb, EV.growl + 0.1, 0.12, 0.14);
    if (th > 0) { Q.armN = lerpA(Q.armN, [1.45, 0.55], th); Q.handN = 'fist'; Q.mouth.smile = 1; Q.brows.raise = 0.55; Q.sweat = p(t, EV.freeze - 0.1, EV.freeze + 0.2) * 0.9; Q.nod = -3 * th; }
    if (t >= EV.freeze && t < EV.growl) { Q.look = [0.9, -0.05]; Q.blink = 0; }
    if (t >= EV.growl) {
      const g = E.inOut(p(t, EV.growl, EV.growl + 0.18));
      Q.look = lerpA(Q.look, [0.25, 1], g);                           // eyes slide down to the belly
      Q.mouth.smile = lerp(1, -0.35, E.inOut(p(t, EV.growl + 0.12, EV.growl + 0.35)));
      Q.brows = { raise: 0.3, knit: -0.7 }; Q.sweat = 1;
      const tum = win(t, EV.growl + 0.06, EV.growlEnd + 0.5, 0.1, 0.2);
      Q.armN = lerpA(Q.armN || REST_STAND[0], [0.5, 1.85], tum); Q.armF = lerpA(Q.armF || REST_STAND[1], [0.42, 1.95], tum); Q.handN = 'open'; Q.handF = 'open';
    }
    const sad = win(t, EV.growlEnd, EV.stars, 0.3, 0.05);
    if (sad > 0) {
      Q.lids = 0.6 * sad; Q.brows = { raise: 0.35 * sad, knit: -1 * sad }; Q.mouth.smile = lerp(Q.mouth.smile, -0.85, sad);
      Q.tilt = 0.1 * sad; Q.nod = 6 * sad; Q.lean = -0.04 * sad; Q.sweat = Math.max(0, (Q.sweat || 0) - p(t, EV.growlEnd, EV.growlEnd + 0.8));
      Q.look = lerpA(Q.look, [0.35, 0.6], sad);
    }
    // S5: listens; the sandwich catches his eye
    if (t >= EV.s5 && t < EV.stars) { Q.look = [1, 0.15]; if (t >= EV.pop) { Q.look = [1, 0.35]; Q.brows = { raise: 0.8 * sad, knit: -0.4 }; Q.lids = 0.2; } }
    // S6: stars!
    if (t >= EV.stars) {
      Q.sparkle = t < EV.land + 0.3 ? 1 : 0; Q.brows = { raise: 1, knit: 0 }; Q.lids = 0; Q.blush = 0.7;
      Q.mouth = { smile: 1, open: 0.55, viseme: 'A' }; Q.look = [1, 0];
      Q.sq = Q.sq - 0.08 * decay(t, EV.stars, 9);
    }
    // S7: hop, stretchy grab, "Valeu!!", bite
    if (t >= EV.crouch && t < EV.land) { Q.armN = t < EV.hop ? [0.6, 0.5] : [2.6, 0.3]; Q.armF = t < EV.hop ? [0.5, 0.6] : [2.4, 0.4]; Q.handN = Q.handF = 'open'; }
    if (t >= EV.land) {
      const reach = win(t, EV.grab, EV.got + 0.16, 0.05, 0.12);
      Q.armN = lerpA([0.75, 0.75], [1.5, 0.02], reach); Q.strN = 1 + 0.75 * reach; Q.handN = t < EV.got ? 'open' : 'fist';
      Q.armF = [0.85, 0.7];
      if (t >= EV.got) {
        Q.holdN = { kind: 'sandHalf', state: t >= EV.bite + 0.08 ? 1 : 0 };
        const hold = E.inOut(p(t, EV.got + 0.1, EV.got + 0.3));
        Q.armN = lerpA(Q.armN, [0.98, 1.35], hold);
        const bite = win(t, EV.bite - 0.1, EV.bite + 0.16, 0.08, 0.08);
        Q.armN = lerpA(Q.armN, [0.92, 2.1], bite);
        if (bite > 0.5) Q.mouth = { smile: 0.6, open: 0, viseme: 'M' };
      }
      Q.legSwing = t > EV.bite ? Math.sin(t * 7) * 0.5 : 0;
      if (t > EV.bite + 0.16 && t < EV.lookEach) Q.mouth = { smile: 0.6, viseme: Math.floor(t * 8) % 2 ? 'M' : 'E', open: 0.2 };  // chewing
    }
    // S8/S9: dog, look at Bia, laugh
    if (t >= EV.lookDog) Q.look = [0.45, 0.95];
    if (t >= EV.lookEach) { Q.look = [1, -0.1]; Q.brows = { raise: 0.6, knit: 0 }; }
    if (t >= EV.laugh && t < EV.windup) { Q.joy = 1; Q.mouth = { smile: 1, open: 0.5 + 0.35 * Math.abs(Math.sin(t * 24)), viseme: 'A' }; Q.nod = -5 * Math.abs(Math.sin(t * 24)); Q.lean = -0.06; }
    // S10: toss the crust
    if (t >= EV.windup) {
      Q.holdN = t < EV.toss ? { kind: 'sandHalf', state: 2 } : null;
      const wind = E.inOut(p(t, EV.windup, EV.toss)), fling = E.out(p(t, EV.toss, EV.toss + 0.12));
      Q.armN = lerpA(lerpA([0.98, 1.35], [0.25, 0.3], wind), [2.25, 0.05], fling);
      Q.armN = lerpA(Q.armN, [0.75, 0.75], p(t, EV.toss + 0.3, EV.toss + 0.55));
      Q.handN = t < EV.toss ? 'fist' : 'open'; Q.look = t < EV.catch + 0.08 ? [0.6, 0.55] : [0.9, 0.2];
      Q.mouth = { smile: 0.8 }; Q.joy = 0; Q.brows = { raise: 0.4, knit: 0 };
      if (t > EV.catch + 0.05) { Q.joy = 1; Q.mouth = { smile: 1, open: 0.3, viseme: 'A' }; }
    }
    // blinks
    for (const b of [1.3, 3.2, 5.2, 9.9, 12.4]) { const u = p(t, b, b + 0.17); if (u > 0 && u < 1) Q.blink = Math.sin(Math.PI * u); }
    const s = speech('leo', t);
    if (s) { Q.mouth = Object.assign({}, Q.mouth, { viseme: s.viseme, open: s.talking ? 0.6 : 0.05 }); }
    return Q;
  }

  // ───────────────── acting: Bia ─────────────────
  function biaPose(t) {
    const Q = { design: R.BIA, x: WD.biaSitX, y: WD.hip, face: -1, sit: 1, shadow: true, look: [0.2, 0.8], mouth: { smile: 0.45 }, brows: { raise: 0, knit: 0 }, turn: 0.1 };
    // reading
    if (t < EV.bookClose + 0.2) {
      const open = t < EV.bookClose ? 1 : 1 - E.inOut(p(t, EV.bookClose, EV.bookClose + 0.2));
      Q.holdN = Q.holdF = { kind: 'book', open: open * (t > EV.page && t < EV.page + 0.25 ? 0.85 : 1) };
      Q.armN = [1.2, 1.35]; Q.armF = [1.1, 1.42];
      Q.tilt = 0.06; Q.nod = 4;
      if (t > 2.35) { Q.look = [1, -0.1]; Q.tilt = 0; Q.nod = 0; Q.brows.raise = 0.4; }   // hears "Bia!"
    } else if (t < EV.behind) {
      Q.holdN = Q.holdF = { kind: 'book', open: 0 }; Q.armN = [0.62, 0.95]; Q.armF = [0.55, 1.0];
    }
    if (t >= EV.s5 - 0.05 && t < EV.behind) { Q.holdN = Q.holdF = null; Q.armN = [0.75, 0.75]; Q.armF = [0.85, 0.7]; }
    if (t >= EV.s3) { Q.look = [1, -0.08]; Q.mouth.smile = 0.85; Q.brows = { raise: 0.3, knit: 0 }; Q.tilt = -0.05; }
    // listening to Léo's confession: concern
    const cn = win(t, EV.growl + 0.2, EV.idea, 0.25, 0.08);
    if (cn > 0) { Q.mouth.smile = lerp(0.85, -0.2, cn); Q.brows = { raise: 0.5 * cn, knit: -0.7 * cn }; Q.tilt = 0.06 * cn; }
    // idea → hammerspace sandwich → snap → offer
    if (t >= EV.idea) { Q.brows = { raise: 1, knit: 0 }; Q.mouth = { smile: 0.9 }; Q.look = [1, -0.1]; Q.glint = t < EV.idea + 0.3; }
    const bh = win(t, EV.behind, EV.pop, 0.08, 0.04);
    if (bh > 0) { Q.armN = lerpA([0.75, 0.75], [-0.95, -0.3], bh); Q.armF = lerpA([0.85, 0.7], [-0.85, -0.3], bh); Q.lean = -0.08 * bh; }
    if (t >= EV.pop && t < EV.snap) { Q.armN = [1.02, 1.35]; Q.armF = [0.96, 1.42]; Q.holdN = Q.holdF = { kind: 'sandWhole' }; Q.sq = 0.08 * decay(t, EV.pop, 12); }
    if (t >= EV.snap) {
      const off = E.back(p(t, EV.snap + 0.02, EV.offer + 0.2));
      Q.armF = [0.96, 1.42]; Q.holdF = { kind: 'sandHalf', state: t >= EV.bite + 0.08 ? 1 : 0 };
      Q.armN = lerpA([1.02, 1.35], [1.48, 0.02], clamp(off)); Q.strN = 1 + 0.4 * clamp(off);
      Q.holdN = t < EV.got ? { kind: 'sandHalf', state: 0 } : null;
      Q.tilt = 0.09; Q.mouth.smile = 0.95;
      if (t >= EV.got) { const back = E.inOut(p(t, EV.got + 0.05, EV.got + 0.3)); Q.armN = lerpA(Q.armN, [0.75, 0.75], back); Q.strN = lerp(Q.strN, 1, back); Q.tilt = 0; }
      const bite = win(t, EV.bite - 0.1, EV.bite + 0.16, 0.08, 0.08);
      Q.armF = lerpA(Q.armF, [0.9, 2.1], bite);
      if (bite > 0.5) Q.mouth = { smile: 0.6, viseme: 'M' };
      if (t > EV.bite + 0.16 && t < EV.lookEach) Q.mouth = { smile: 0.6, viseme: Math.floor(t * 8 + 1) % 2 ? 'M' : 'E', open: 0.2 };
    }
    if (t >= EV.stars && t < EV.s8) { Q.look = [1, 0.05]; Q.blush = 0.5; }
    if (t >= EV.lookDog) Q.look = [0.55, 0.95];
    if (t >= EV.lookEach) { Q.look = [1, -0.1]; Q.brows = { raise: 0.6, knit: 0 }; }
    if (t >= EV.laugh && t < EV.windup + 0.2) { Q.joy = 1; Q.mouth = { smile: 1, open: 0.45 + 0.3 * Math.abs(Math.sin(t * 22 + 1)), viseme: 'A' }; Q.nod = -4 * Math.abs(Math.sin(t * 22 + 1)); }
    if (t >= EV.windup + 0.2) { Q.look = [0.6, 0.5]; Q.mouth = { smile: 0.9 }; if (t > EV.catch + 0.05) { Q.joy = 1; Q.mouth = { smile: 1, open: 0.3, viseme: 'A' }; } }
    for (const b of [4.9, 7.6, 10.9, 12.6]) { const u = p(t, b, b + 0.17); if (u > 0 && u < 1) Q.blink = Math.sin(Math.PI * u); }
    const s = speech('bia', t);
    if (s) Q.mouth = Object.assign({}, Q.mouth, { viseme: s.viseme, open: s.talking ? 0.55 : 0.05 });
    return Q;
  }

  // ───────────────── acting: Pipoca ─────────────────
  function dogPose(t) {
    if (t < EV.dogIn) return null;
    const Q = { x: WD.dogX, y: WD.dogY, face: -1, mode: 'sit', wag: t * 18, wagAmp: 0.6, look: [-0.3, -1], earPerk: 0.3 };
    if (t < EV.dogSit) {
      Q.mode = 'walk'; Q.walk = t * TAU * 2.2; Q.x = lerp(2150, WD.dogX, E.out(p(t, EV.dogIn, EV.dogSit))); Q.look = [-1, 0];
    }
    Q.sq = 0.14 * decay(t, EV.dogSit, 12);
    if (t >= EV.sniff && t < EV.puppy) { Q.sniff = 1; Q.sniffPh = t * 40; Q.look = [-0.4, -0.6]; }
    const pu = win(t, EV.puppy, EV.catch - 0.25, 0.14, 0.12);
    if (pu > 0) { Q.puppy = pu; Q.tilt = -0.12 * pu; Q.earPerk = 0; Q.wagAmp = 0.25; Q.look = [0, -1]; }
    if (t >= EV.laugh && t < EV.toss) { Q.tilt = 0.22; Q.look = [0.3, -1]; Q.earPerk = 0.6; }   // puzzled at the laughter
    if (t >= EV.toss && t < EV.catch - 0.12) { Q.look = [0.6, -1]; Q.earPerk = 1; Q.wagAmp = 1; }
    const jU = p(t, EV.catch - 0.14, EV.catch + 0.2);
    if (jU > 0 && jU < 1) { Q.mode = 'jump'; Q.jumpU = jU; Q.lift = 120 * Math.sin(Math.PI * jU); Q.earLift = 0.5; }
    if (t >= EV.catch) { Q.holding = 'crust'; Q.mouth = 'chew'; Q.chewPh = t * 16; Q.wagAmp = 1.1; Q.wag = t * 30; Q.look = [0, -0.5]; }
    if (t >= EV.catch && t < EV.catch + 0.25) Q.mouth = 'closed';
    if (t >= EV.wink && t < EV.wink + 0.18) Q.wink = 1;
    for (const b of [12.95, 14.05]) { const u = p(t, b, b + 0.15); if (u > 0 && u < 1) Q.blink = Math.sin(Math.PI * u); }
    return Q;
  }

  // ───────────────── frame ─────────────────
  const FIM_BG = '#1A1420';
  const toScreen = (cam, sh, [x, y]) => [W / 2 + (x - cam[0]) * cam[2] + sh[0], H / 2 + (y - cam[1]) * cam[2] + sh[1]];

  window.renderFrame = function (frame) {
    const Tc = frame / TL.fps;                             // continuous (camera)
    const t = Math.floor(Tc * 12) / 12;                    // on twos (animation)
    T.beginFrame(ctx, Math.floor(Tc * 8));
    const shot = shotAt(Tc), cam = shot.cam(Tc), sh = shake(Tc);
    const camO = { cx: cam[0], cy: cam[1], z: cam[2] };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = FIM_BG; ctx.fillRect(0, 0, W, H);

    // background in screen space (sets apply their own parallax)
    ctx.save(); ctx.translate(sh[0], sh[1]); S.drawBackground(Tc, camO); ctx.restore();

    // world camera
    ctx.setTransform(cam[2], 0, 0, cam[2], W / 2 - cam[0] * cam[2] + sh[0], H / 2 - cam[1] * cam[2] + sh[1]);
    S.drawBench(t);
    P.lunchbox(1342, 713, 1);
    if (t >= EV.behind) P.book(1335, 684, 0.85, 0.04, -1);

    const bia = biaPose(t), leo = leoPose(t), dog = dogPose(t);
    const aB = R.drawKid(R.BIA, bia);
    if (bia.glint) { const g = p(t, EV.idea, EV.idea + 0.3); T.star4(aB.head[0] - 40, aB.head[1] - 16, 16 * Math.sin(Math.PI * g), g * 3, '#FFFFFF', 2.5); }
    const aL = R.drawKid(R.LEO, leo);
    let aD = null; if (dog) aD = D.draw(dog);

    // ── FX ──
    // rain cloud over Léo
    const cl = E.back(p(t, EV.cloudIn, EV.cloudIn + 0.25)) * (t < EV.cloudOut ? 1 : 0);
    if (cl > 0.01) P.rainCloud(aL.headTop[0] - 6, aL.headTop[1] - 95, 0.95 * cl, t);
    P.poof(aL.headTop[0] - 6, aL.headTop[1] - 95, 1, p(t, EV.cloudIn - 0.05, EV.cloudIn + 0.3));
    P.poof(aL.headTop[0] - 6, aL.headTop[1] - 95, 1.1, p(t, EV.cloudOut, EV.cloudOut + 0.35));
    P.sparkleBurst(aL.head[0], aL.head[1] - 30, p(t, EV.stars, EV.stars + 0.55), 8, 170);
    // growl lettering
    const gr = win(t, EV.growl, EV.growlEnd + 0.1, 0.06, 0.12);
    if (gr > 0) { ctx.save(); ctx.globalAlpha = gr; T.text('grrrrr...', aL.feet[0] + 150 + Math.sin(t * 45) * 3, 690, 44, T.C.INK, 'left', -0.12); ctx.restore(); }
    // sandwich snap
    if (t >= EV.snap) P.crumbs(1150, 640, EV.snap, t, 3);
    if (t >= EV.snap && t < EV.snap + 0.35) { ctx.save(); ctx.globalAlpha = 1 - p(t, EV.snap + 0.2, EV.snap + 0.35); T.text('crac!', 1175, 575 - 30 * p(t, EV.snap, EV.snap + 0.35), 46, T.C.INK, 'center', 0.14); ctx.restore(); }
    // hop speed lines
    if (t >= EV.hop && t < EV.land + 0.05) {
      const pts = []; for (let i = 0; i <= 6; i++) { const u = p(t, EV.hop, EV.land) - i * 0.06; if (u < 0) break; pts.unshift([lerp(WD.leoStandX, WD.leoSitX, E.inOut(u)), WD.hip - 150 - 170 * Math.sin(Math.PI * u)]); }
      if (pts.length > 1) P.motionLines(pts, 1 - p(t, EV.land - 0.05, EV.land + 0.05));
    }
    P.hearts((aL.head[0] + aB.head[0]) / 2, aL.head[1] - 60, p(t, EV.got, EV.got + 0.9));
    // crust flight
    if (t >= EV.toss && t < EV.catch && aD) {
      const u = p(t, EV.toss, EV.catch), s0 = aL.handN, s1 = aD.mouth;
      P.sandwichHalf(lerp(s0[0], s1[0], u), lerp(s0[1], s1[1], u) - 230 * Math.sin(Math.PI * u), 0.62, u * 10, 2);
    }
    if (t >= EV.catch && t < EV.catch + 0.5 && aD) {
      const u = E.back(p(t, EV.catch, EV.catch + 0.15));
      ctx.save(); ctx.globalAlpha = 1 - p(t, EV.catch + 0.38, EV.catch + 0.5); P.burst(aD.head[0] + 150, aD.head[1] - 90, 0.9 * u, 'Arf!'); ctx.restore();
    }
    if (dog && t >= EV.sniff && t < EV.puppy) T.text('snif snif', aD.nose[0] - 90, aD.nose[1] - 50, 34, T.C.INK, 'center', -0.15);

    // fallback speech bubbles when there is no recorded voice
    if (!TL.voice) for (const L of TL.lines) {
      if (t < L.start || t > L.end + 0.3) continue;
      const a = L.who === 'leo' ? aL : aB, n = L.ct.filter(c => c <= t).length;
      P.speechBubble({ x: a.headTop[0] + (L.who === 'leo' ? 60 : -60), y: a.headTop[1] - 110, text: L.text, visibleChars: n, tail: [a.headTop[0], a.headTop[1] - 20], scale: E.back(p(t, L.start - 0.05, L.start + 0.12)), px: 44 });
    }

    // ── foreground (screen space) ──
    ctx.setTransform(1, 0, 0, 1, sh[0], sh[1]);
    S.drawForeground(Tc, camO);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // ── iris in / out ──
    let ir = null, ic = [W / 2, H / 2];
    if (Tc < EV.irisIn + 0.1) ir = 1250 * E.out(p(Tc, 0, EV.irisIn + 0.1));
    if (Tc >= EV.irisOut && aD) {
      ic = toScreen(cam, sh, [aD.head[0], aD.head[1] + 8]);
      ir = lerp(1500, 200, E.inOut(p(Tc, EV.irisOut, EV.irisHold)));
      ir = lerp(ir, 0, E.in(p(Tc, EV.wink + 0.18, EV.irisClose)));
    }
    if (ir != null) {
      ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.arc(ic[0], ic[1], Math.max(0, ir), 0, TAU, true);
      ctx.fillStyle = FIM_BG; ctx.fill();
      if (ir > 0) { ctx.beginPath(); ctx.arc(ic[0], ic[1], ir, 0, TAU); ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.stroke(); }
    }
    if (Tc >= EV.fim) {
      const u = E.back(p(Tc, EV.fim, EV.fim + 0.25));
      ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(u, u); ctx.rotate(-0.04);
      T.text('Fim.', 0, 0, 180, T.C.PAPER);
      ctx.restore();
    }
    window.__shot = shot.id;
  };

  // calibrate the dog's sitting head position once (for the S8 push-in framing)
  function calibrate() {
    const scratch = document.createElement('canvas').getContext('2d');
    T.beginFrame(scratch, 0);
    const a = D.draw({ x: WD.dogX, y: WD.dogY, face: -1, mode: 'sit', puppy: 1 });
    DOGHEAD = a.head;
  }
  window.TOTAL_FRAMES = Math.round(TL.dur * TL.fps);
  window.ready = document.fonts.load(T.FONT(50)).then(calibrate);
})();
