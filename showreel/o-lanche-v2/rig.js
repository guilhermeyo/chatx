// rig.js — the kid rig for "O Lanche" v2: T.rig.drawKid(design, pose) → anchors. Designs: T.rig.LEO, T.rig.BIA.
// Original characters in a 90s TV-cartoon style. Body-local space: hip at (0,0), +x = the way the kid faces,
// y down, ground (shoe soles) at y = +120. Every outline goes through core primitives so it boils with the film.
//
// Extras beyond CONTRACT.md (all optional):
//   T.rig.STRIDE   px of ground covered per radian of walk phase (×scale). Film should move a walking kid with
//                  x = x0 + face * STRIDE * scale * (phase - phase0): the planted foot then stays put.
//   T.rig.POSE     arm presets checked to read cleanly (spread into a pose: {...T.rig.POSE.waveN, mouth:…}).
//   pose.tuck 0..1 airborne tuck (auto when `shadow` is a ground-y number and the kid is > 20px above it).
//   pose.autoReach false disables the automatic rubber-hose reach that keeps raised hands off the face.
//   pose.seed      extra boil salt (two copies of the same kid in one frame).
//   holdF.front    force a far-hand prop in front of the torso (auto when the far hand is forward of the chest).
//   mouth.open with a viseme scales the viseme's opening (0 → 35 %, 1 → 115 %); mouth.blend {from, u} eases
//                  from another viseme (u 0 = `from`, 1 = `viseme`), so lip-sync can in-between.
//   returned anchors also include footN / footF (sole contact points).
'use strict';
(function () {
  const T = window.TOON;
  const { lerp, clamp } = T;
  const PI = Math.PI, TAU = T.TAU;
  const INK = T.C.INK, PAPER = T.C.PAPER;

  // ─────────────────────────── stable line boil ───────────────────────────
  // core's T.J keys its jitter by a global per-frame shape counter, so any line that appears or disappears (a
  // viseme, a dimple, a prop) would re-jitter everything drawn after it — including other characters. While a kid
  // is drawn we swap in keyed versions of T.J / T.ink / T.stroke (same formulas as core): each feature opens a
  // section with a fixed key, and only calls inside that section share its counter. drawKid consumes no core SIDs.
  let KEY = 0, KC = 0, SALT = 0;
  const sec = k => { KEY = SALT + k * 37.17; KC = 0; };
  const seedK = () => KEY + KC * 1.618;
  function Jk(pts, amp = T.JA) {
    KC++; const s = seedK(), b = T.BOIL;
    return pts.map(([x, y], i) => [x + (T.hash(i * 1.7 + b * 13.1 + s * 7.3) - .5) * 2 * amp, y + (T.hash(i * 2.9 + b * 5.7 + s * 3.1) - .5) * 2 * amp]);
  }
  function inkK(pts, lw = 4.5, color = INK, closed = true) {
    KC += 0.5; const seed = seedK() * 3.7;
    T.ribbon(pts, closed, i => lw * (0.7 + 0.6 * T.vnoise(seed + i * 0.45)), color);
  }
  function strokeK(pts, lw = 4.5, color = INK, taper = 0.6, jitter = T.JA * 0.7) {
    const P = jitter ? Jk(pts, jitter) : (KC += 0.5, pts), seed = seedK() * 2.3;
    T.ribbon(P, false, (i, n) => { const u = n > 1 ? i / (n - 1) : 0.5; const tp = 1 - taper * Math.pow(Math.abs(2 * u - 1), 2.5); return lw * tp * (0.8 + 0.4 * T.vnoise(seed + i * 0.6)); }, color);
  }
  function keyed(fn) {
    const saved = [T.J, T.ink, T.stroke];
    T.J = Jk; T.ink = inkK; T.stroke = strokeK;
    try { return fn(); } finally { [T.J, T.ink, T.stroke] = saved; }
  }

  // ─────────────────────────── drawing helpers ───────────────────────────
  const sm = (pts, it = 2) => T.chaikin(pts, it, true);
  const smO = (pts, it = 2) => T.chaikin(pts, it, false);
  const rot = ([x, y], a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
  const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k];
  const mid = (a, b, u = 0.5) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u)];
  const dirOf = a => [Math.sin(a), Math.cos(a)];            // rig angle convention: 0 = down, +π/2 = forward
  // jitter a few control points (boil), smooth them, then fill + brush-ink → smooth boil, crisp at 3x zoom
  function shp(pts, fill, lw = 4.5, amp = 1.2, it = 2) {
    const P = sm(amp ? T.J(pts, amp) : pts, it);
    return T.shape(P, fill, lw, { jitter: 0 });
  }
  const oval = (cx, cy, rx, ry, fill, lw = 4.5, amp = 1, r = 0, n = 14) => shp(T.ell(cx, cy, rx * 1.03, ry * 1.03, n, r), fill, lw, amp);
  const ovalPts = (cx, cy, rx, ry, amp = 1, r = 0, n = 14) => sm(T.J(T.ell(cx, cy, rx * 1.03, ry * 1.03, n, r), amp), 2);
  // tapered brush line through control points
  function ln(pts, lw = 3.5, color = INK, taper = 0.6, amp = 0.7) {
    const P = amp ? T.J(pts, amp) : pts;
    T.stroke(P.length > 2 ? smO(P, 2) : P, lw, color, taper, 0);
  }
  // union of overlapping parts under ONE silhouette: thick ink under every part, fills on top
  function union(parts, fill, lw = 4.2) {
    parts.forEach(P => T.ink(P, lw * 2, INK, true));
    parts.forEach(P => T.fillPts(P, fill));
  }
  // rubber-hose tube (arm/leg): smooth curve through joints, brush-varying ink edge, round caps
  function hose(ctrl, w, color, lw = 4.2) {
    const c = T.ctx, P = smO(T.J(ctrl, 0.8), 3), seed = seedK() * 1.3;
    c.save(); c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = INK;
    for (let i = 0; i < P.length - 1; i++) {
      c.lineWidth = w + 2 * lw * (0.78 + 0.44 * T.vnoise(seed + i * 0.4));
      c.beginPath(); c.moveTo(P[i][0], P[i][1]); c.lineTo(P[i + 1][0], P[i + 1][1]); c.stroke();
    }
    T.path(P, false); c.strokeStyle = color; c.lineWidth = w; c.stroke();
    c.restore();
    return P;
  }
  // clip to everything OUTSIDE the given polygons (intersecting clips)
  function clipOutside(polys) {
    const c = T.ctx;
    polys.forEach(P => { c.beginPath(); c.rect(-9999, -9999, 19999, 19999); P.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath(); c.clip('evenodd'); });
  }
  const g = (a, c0, w) => { let d = a - c0; d = Math.atan2(Math.sin(d), Math.cos(d)); return Math.exp(-(d / w) * (d / w)); };

  // ─────────────────────────── designs ───────────────────────────
  // Positions of face features are authored for the 3/4 view (a) and the frontal view (b); `turn` lerps a→b.
  const LEO = {
    id: 'leo', salt: 0, skin: '#F4C49A', shirt: '#E85D3F', trim: '#FFF6E6', shorts: '#3E5FA8', hair: '#6B3F22',
    shoe: '#F4EFE4', shoeTrim: '#E85D3F', sole: '#C9C1B4', sock: '#FFFDF7', sockStripe: '#E85D3F',
    head: [80, 88], lift: 94, hairStyle: 'spikes',
    eye: { rx: 15, ry: 20, y: -14, near: [24, -17], far: [55, 17], farRx: 12.5, pupil: 1 },
    nose: { kind: 'bulb', a: [84, 16], b: [0, 20], r: [19, 16] },
    mouth: { a: [46, 56], b: [0, 58], w: 21 },
    brow: { lw: 7.5, len: 24, gap: 8, color: INK },
    blushAt: { near: [[8, 34], [-44, 34]], far: [[63, 33], [44, 34]] },
    ear: [-34, 8], glasses: false, lashes: false, blush: 0, emblem: null,
    faceBox: [[52, 6, 57, 64], [0, 6, 46, 64]], hairTop: 1.42,          // raised hands keep off the face / out of the hair
  };
  const BIA = {
    id: 'bia', salt: 700, skin: '#B87850', shirt: '#8E6CC4', trim: '#B79AE6', shorts: '#F2B84B', hair: '#1F1A2E',
    shoe: '#E85D3F', shoeTrim: '#FFFDF7', sole: '#FFFDF7', sock: '#FFFDF7', sockStripe: null,
    clip: '#FFD23F', lens: null,
    head: [78, 84], lift: 90, hairStyle: 'bob',
    eye: { rx: 12, ry: 15, y: -4, near: [22, -19], far: [57, 19], farRx: 10.5, pupil: 1 },
    nose: { kind: 'button', a: [79, 22], b: [0, 22], r: [9.5, 8.5] },
    mouth: { a: [48, 48], b: [0, 50], w: 17.5 },
    brow: { lw: 6.5, len: 21, gap: 12, color: INK },
    blushAt: { near: [[4, 26], [-42, 26]], far: [[61, 25], [42, 26]] },
    ear: null, glasses: true, lashes: true, blush: 0.32, emblem: 'star',
    faceBox: [[46, 10, 51, 54], [0, 10, 46, 54]], hairTop: 1.18,
  };

  // ─────────────────────────── head ───────────────────────────
  // Egg-shaped head: cheek bulge toward the face and a jaw tuck at the back (so the neck shows) in 3/4;
  // symmetric cheeks when frontal. `jaw` px drops the lower-front outline (gaussian around angle ja) so an
  // open mouth always stays inside the face — a squash-stretch jaw on shouted lines.
  function headPts(rx, ry, turn, jaw = 0, ja = 1, n = 22) {
    const k = 1 - turn, pts = [];
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU, ca = Math.cos(a), sa = Math.sin(a);
      const r0 = rx * ry / Math.hypot(ry * ca, rx * sa);
      const b = k * (0.06 * g(a, 0.72, 0.5) - 0.11 * g(a, 2.2, 0.45) + 0.025 * g(a, -2.3, 0.6)) +
        turn * (0.045 * g(a, 0.85, 0.45) + 0.045 * g(a, PI - 0.85, 0.45) - 0.03 * g(a, PI / 2, 0.3));
      pts.push([ca * r0 * (1 + b), sa * r0 * (1 + b) + (jaw ? jaw * g(a, ja, 0.55) : 0)]);
    }
    return pts;
  }
  // how far the jaw must drop so every point of the mouth's lower edge sits ≥ 8px inside the chin outline
  function jawDrop(rx, ry, turn, bottom) {
    if (!bottom.length) return { amt: 0, a: 1 };
    const H = headPts(rx, ry, turn, 0, 0, 120).filter(p => p[1] > 0).sort((p, q) => p[0] - q[0]);
    const edgeY = x => {
      if (x <= H[0][0]) return H[0][1]; if (x >= H[H.length - 1][0]) return H[H.length - 1][1];
      for (let i = 0; i < H.length - 1; i++) if (x <= H[i + 1][0]) return lerp(H[i][1], H[i + 1][1], (x - H[i][0]) / ((H[i + 1][0] - H[i][0]) || 1));
      return 0;
    };
    const cx = bottom.reduce((s, p) => s + p[0], 0) / bottom.length, ja = Math.atan2(edgeY(cx), cx);
    let amt = 0;
    bottom.forEach(([x, y]) => { const ey = edgeY(x) - 2.5, w = g(Math.atan2(ey, x), ja, 0.55); if (w > 0.2) amt = Math.max(amt, (y + 8 - ey) / w); });
    return { amt: clamp(amt, 0, 44), a: ja };
  }
  // rotate a point authored for the 3/4 view around the (ellipsoidal) head by turn; points that would
  // go behind the head stick to the silhouette — used for hairlines and ears.
  function yawPt([x, y], rx, ry, turn, k = 0.55) {
    const R = rx * Math.sqrt(Math.max(0.02, 1 - (y / ry) * (y / ry)));
    const a = Math.asin(clamp(x / R, -1, 1)) - turn * k;
    return [R * Math.sin(clamp(a, -PI / 2, PI / 2)), y];
  }

  function eye(ex, ey, rx, ry, P, outer, D) {
    const c = T.ctx, br = P.brows || {};
    const wideK = clamp(((br.raise || 0) - 0.3) / 0.7) + (P.wide || 0);
    ry *= 1 + 0.12 * clamp(wideK); rx *= 1 + 0.05 * clamp(wideK);
    if (P.sparkle) { rx *= 1.1; ry *= 1.08; }
    if (P.joy) {                                    // happy closed ^^ eyes
      ln(T.arcPts(ex, ey + ry * 0.45, rx * 1.05, ry * 0.8, PI + 0.3, TAU - 0.3, 6), 5.5, INK, 0.55, 0.5);
      return;
    }
    const bl = clamp(P.blink || 0);
    if (bl > 0.9) {                                 // closed: soft downward curve + outer lash
      ln(T.arcPts(ex, ey + ry * 0.05, rx * 1.05, ry * 0.32, 0.15, PI - 0.15, 6), 4.5, INK, 0.5, 0.5);
      if (D.lashes) ln([[ex + outer * rx * 0.95, ey + ry * 0.12], [ex + outer * (rx + 6), ey + ry * 0.3]], 3, INK, 0.7, 0.3);
      return;
    }
    const E = ovalPts(ex, ey, rx, ry, 0.55, 0, 14);
    T.fillPts(E, PAPER);
    c.save(); T.path(E); c.clip();
    const lk = P.look || [0.55, 0.05];
    const px = ex + clamp(lk[0], -1, 1) * rx * 0.42, py = ey + clamp(lk[1], -1, 1) * ry * 0.38;
    if (P.sparkle) {                                // star pupils
      const R = Math.min(rx, ry) * 0.95, sp = 0.12 * Math.sin(T.BOIL * 1.9 + ex);
      const star = Array.from({ length: 10 }, (_, i) => { const a = -PI / 2 + sp + i * PI / 5, r = i % 2 ? R * 0.46 : R; return [px + Math.cos(a) * r, py + 1 + Math.sin(a) * r]; });
      T.shape(star, T.C.gold, 2.6, { jitter: 0.4 });
      T.star4(px + rx * 0.3, py - ry * 0.3, R * 0.32, 0.4, PAPER, 0);
    } else {
      const pk = D.eye.pupil * (1 - 0.38 * clamp(wideK));
      const prx = rx * 0.47 * pk, pry = ry * 0.5 * pk;
      T.fillPts(ovalPts(px, py, prx, pry, 0.3, 0, 12), INK);
      T.fillPts(T.ell(px + prx * 0.35, py - pry * 0.42, prx * 0.36, prx * 0.36, 10), PAPER);
      T.fillPts(T.ell(px - prx * 0.35, py + pry * 0.45, prx * 0.15, prx * 0.15, 8), PAPER);
    }
    // eyelids: blink closes from the top; `lids` droops the OUTER corner (sad / tired)
    const sad = clamp(P.lids || 0);
    const top = ey - ry - 3, cover = 2 * ry * bl;
    const yIn = top + cover + ry * 0.55 * sad * (1 - bl), yOut = top + cover + ry * 1.15 * sad * (1 - bl);
    if (bl > 0.02 || sad > 0.02) {
      const L = outer < 0 ? [ex - rx - 4, yOut] : [ex - rx - 4, yIn], R = outer < 0 ? [ex + rx + 4, yIn] : [ex + rx + 4, yOut];
      T.fillPts([[ex - rx - 4, top - 6], [ex + rx + 4, top - 6], R, L], T.shade(D.skin, 0.06));
      T.stroke([L, R], 7.5, INK, 0.1, 0);
    }
    c.restore();
    T.ink(E, 3.8);
    if (D.lashes && bl < 0.5) {                    // two little lashes flicking out of the outer corner
      [0.62, 0.22].forEach((a, i) => {
        const ang = outer > 0 ? -a : PI + a, droop = sad * ry * (i ? 0.9 : 0.6);
        const b = [ex + Math.cos(ang) * rx, ey + Math.sin(ang) * ry + droop];
        ln([b, [b[0] + outer * (6 - i), b[1] - 5 + i * 3.5]], 3.2, INK, 0.7, 0.2);
      });
    }
  }

  function brow(ex, y, s, P, D, headP) {                 // s = +1 if the inner end is toward +x
    const br = P.brows || {}, raise = br.raise || 0, knit = br.knit || 0;
    const L = D.brow.len / 2, by = y - raise * 11 - (P.sparkle ? 5 : 0) - (P.joy ? 4 : 0);
    const inner = [ex + s * L, by + knit * 8 - raise * 2], outer = [ex - s * L, by - knit * 2 + raise * 1];
    const midp = [ex, by - 4 - raise * 2 + Math.abs(knit) * 1.5];
    // a clean brush crescent: thick in the middle, tapering to both ends
    const [o, m, n] = T.J([outer, midp, inner], 0.45), N = 10, up = [], dn = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N, a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c2 = u * u;
      const cx = [2 * m[0] - (o[0] + n[0]) / 2, 2 * m[1] - (o[1] + n[1]) / 2];     // control point so the curve passes through m
      const p = [a * o[0] + b * cx[0] + c2 * n[0], a * o[1] + b * cx[1] + c2 * n[1]];
      const d = [2 * (1 - u) * (cx[0] - o[0]) + 2 * u * (n[0] - cx[0]), 2 * (1 - u) * (cx[1] - o[1]) + 2 * u * (n[1] - cx[1])];
      const dl = Math.hypot(...d) || 1, w = D.brow.lw * (0.25 + 0.75 * Math.pow(Math.sin(PI * (0.08 + 0.84 * u)), 0.7)) / 2;
      up.push([p[0] + d[1] / dl * w, p[1] - d[0] / dl * w]); dn.push([p[0] - d[1] / dl * w, p[1] + d[0] / dl * w]);
    }
    const B = [...up, ...dn.reverse()];
    // skin knock-out: invisible on the forehead, a clean skin gap wherever a raised brow crosses the hair
    const c = T.ctx; c.save(); if (headP) { T.path(headP); c.clip(); } T.path(B); c.lineJoin = 'round'; c.lineWidth = 7; c.strokeStyle = D.skin; c.stroke(); c.fillStyle = D.skin; c.fill(); c.restore();
    T.fillPts(B, D.brow.color);
  }

  // ── mouth ──
  // Viseme params: w (half-width, × design width), hu/hl (upper/lower opening), pu/pl (curve exponents),
  // teeth top/bottom, tongue. 'rest' and 'M' are closed (zero opening) so any two shapes can be blended.
  const VIS = {
    rest: { w: 0.9, hu: 0, hl: 0, pu: 0.8, pl: 0.7, tt: 0, tb: 0, tongue: 0 },
    M: { w: 0.75, hu: 0, hl: 0, pu: 0.8, pl: 0.7, tt: 0, tb: 0, tongue: 0, press: 1 },
    A: { w: 1.0, hu: 4, hl: 30, pu: 0.8, pl: 0.7, tt: 1, tb: 0, tongue: 1 },
    E: { w: 1.2, hu: 3, hl: 13, pu: 0.9, pl: 0.8, tt: 1, tb: 0, tongue: 0.6 },
    I: { w: 1.22, hu: 5, hl: 8, pu: 0.7, pl: 0.7, tt: 1, tb: 1, tongue: 0, smile: 0.35 },
    O: { w: 0.7, hu: 13, hl: 18, pu: 0.5, pl: 0.5, tt: 0, tb: 0, tongue: 0.8 },
    U: { w: 0.46, hu: 8, hl: 9, pu: 0.5, pl: 0.5, tt: 0, tb: 0, tongue: 0, pucker: 1 },
    F: { w: 0.8, hu: 2, hl: 9, pu: 0.9, pl: 0.6, tt: 1, tb: 0, tongue: 0, bite: 1 },
  };
  const openParams = o => ({ w: 1 - 0.1 * o, hu: 3 + 3 * o, hl: 6 + 22 * o, pu: 0.8, pl: 0.7, tt: o > 0.3 ? 1 : 0, tb: 0, tongue: o });
  function mouthParams(M) {
    let v = M.viseme || null;
    if (!v || v === 'rest') v = (M.open || 0) > 0.06 ? 'open' : 'rest';
    const base = name => name === 'open' ? openParams(clamp(M.open || 0)) : Object.assign({}, VIS[name] || VIS.A);
    const S = base(v);
    if (v !== 'open' && M.open != null) { const f = lerp(0.35, 1.15, clamp(M.open)); S.hu *= f; S.hl *= f; }   // speech amplitude
    if (M.blend && M.blend.from && M.blend.from !== v) {                 // in-between from another viseme
      const S0 = base(M.blend.from), u = clamp(M.blend.u ?? 0.5);
      new Set([...Object.keys(S0), ...Object.keys(S)]).forEach(k => { S[k] = lerp(S0[k] || 0, S[k] || 0, u); });
    }
    S.closed = S.hu + S.hl < 3;
    return S;
  }
  // geometry first (so the jaw can make room), drawing second
  function mouthGeo(mx, my, P, D, turn) {
    const M = P.mouth || {}, smile = M.smile ?? 0.4, w0 = D.mouth.w, farK = lerp(0.78, 1, turn);
    const S = mouthParams(M), X = u => mx + u * (u > 0 ? farK : 1);
    const G = { S, mx, my, smile, X, bottom: [] };
    if (S.closed) {
      const press = (S.press || 0) > 0.5, w = w0 * S.w, s = press ? smile * 0.3 : smile;
      G.line = []; for (let i = 0; i <= 6; i++) { const u = i / 3 - 1; G.line.push([X(u * w), my - s * 10 * (u * u) + s * 4]); }
      G.w = w; G.press = press;
      G.bottom = G.line.map(([x, y]) => [x, y + 3]);
      if (!press && smile < -0.3) G.bottom.push([mx, my + 11]);
      return G;
    }
    const sm2 = clamp(smile + (S.smile || 0), -1, 1) * (S.pucker > 0.5 ? 0.2 : 1);
    const w = w0 * S.w, base = u => -sm2 * 8 * u * u + sm2 * 3;
    const top = [], bot = [];
    for (let i = 0; i <= 10; i++) { const u = i / 5 - 1; top.push([X(u * w), my + base(u) - S.hu * Math.pow(1 - u * u, S.pu)]); }
    for (let i = 10; i >= 0; i--) { const u = i / 5 - 1; bot.push([X(u * w), my + base(u) + S.hl * Math.pow(1 - u * u, S.pl)]); }
    Object.assign(G, { w, base, top, bot });
    G.bottom = bot.map(([x, y]) => [x, y + 2]);
    if (S.bite > 0.5) G.bottom.push([mx, my + base(0) + S.hl + 7]);
    return G;
  }
  function drawMouth(G) {
    const { S, mx, my, smile, X } = G;
    if (S.closed) {
      const w = G.w;
      ln(G.line, G.press ? 5.5 : 4.4, INK, 0.5, 0.5);
      if (G.press) {                                // pressed lips: little lower-lip arc + corner ticks
        ln(T.arcPts(mx + 1, my + 5, w * 0.45, 4, 0.3, PI - 0.3, 4), 2.6, INK, 0.7, 0.3);
        [-1, 1].forEach(sg => ln([[X(sg * w) - sg * 1, my - 4], [X(sg * w) + sg * 1.5, my + 4]], 2.4, INK, 0.6, 0.2));
      } else if (smile > 0.45) {                    // dimple ticks at the corners
        [-1, 1].forEach(sg => { const cx = X(sg * w), cy = my - smile * 6; ln([[cx - sg * 0.5, cy - 5], [cx + sg * 2.5, cy - 1], [cx + sg * 1.5, cy + 3]], 2.3, INK, 0.75, 0.2); });
      } else if (smile < -0.3) {
        ln([[mx - 4, my + 9], [mx + 4, my + 9]], 2.2, INK, 0.8, 0.3);   // little chin line for a pout
      }
      return;
    }
    const { w, base, top, bot } = G;
    const c = T.ctx, Mp = T.J([...top, ...bot], 0.5);
    T.fillPts(Mp, '#5A1B2B');
    c.save(); T.path(Mp); c.clip();
    if (S.tongue > 0.05) T.fillPts(T.ell(mx + 2, my + base(0) + S.hl * 0.95, w * 0.62, 5 + S.hl * 0.32, 14), '#E8687A');
    if (S.tt > 0.5) { const th = S.bite > 0.5 ? 7.5 : 5.5; T.fillPts([...top, ...top.slice().reverse().map(([x, y]) => [x, y + th])], PAPER); }
    if (S.tb > 0.5) { const th = 4.5; T.fillPts([...bot, ...bot.slice().reverse().map(([x, y]) => [x, y - th])], PAPER); }
    c.restore();
    T.ink(Mp, S.pucker > 0.5 ? 5.2 : 4);
    if (S.bite > 0.5) { const lb = my + base(0) + S.hl; ln([[X(-w * 1.05), lb - 3], [mx, lb + 5], [X(w * 1.05), lb - 3]], 3.2, INK, 0.7, 0.3); }   // lower lip tucked under the teeth
    if (S.pucker > 0.5) {                            // pursed-lip creases
      [-1, 1].forEach(sg => ln([[X(sg * (w + 3)), my - 3], [X(sg * (w + 7)), my + 1]], 2.2, INK, 0.8, 0.2));
    }
  }

  // ── hair ──
  // drag = [dx, dy] secondary-motion offset for loose hair tips (head-local), from velocity & walk bounce
  function hairLeo(D, rx, ry, turn, drag) {
    const hair = D.hair, dark = T.shade(hair, 0.28);
    const a0 = 160 * PI / 180, a1 = 336 * PI / 180, K = 7;
    const tipL = [1.2, 1.34, 1.44, 1.5, 1.44, 1.34, 1.22];
    const polar = (a, r) => [Math.cos(a) * rx * r, Math.sin(a) * ry * r];
    // outer silhouette: spikes swept back, each edge slightly convex; tips drag with motion (sharp, not smoothed)
    const out = [polar(a0, 1.0)], tips = [], bases = [];
    for (let j = 0; j < K; j++) {
      const v0 = polar(lerp(a0, a1, j / K), j ? 1.03 : 1.0), v1 = polar(lerp(a0, a1, (j + 1) / K), 1.03);
      const wt = (tipL[j] - 1) / 0.5;
      const tip = add(polar(lerp(a0, a1, (j + 0.55) / K) - 0.13, tipL[j]), drag, wt);
      const bulge = (p, q, k) => { const m = mid(p, q), d = [q[0] - p[0], q[1] - p[1]], L = Math.hypot(...d) || 1; return add(m, [d[1] / L, -d[0] / L], k); };
      if (j) out.push(v0);
      out.push(bulge(v0, tip, -4), tip, bulge(tip, v1, -2.5));
      tips.push(tip); bases.push(mid(v0, v1));
    }
    out.push(polar(a1, 1.02));
    // hairline (front → back): three forward-combed bang spikes (tips kept above the brows), a sideburn, the nape
    const line = [[72, -56], [66, -50], [57, -67], [48, -50], [36, -70], [28, -53], [14, -70], [4, -58], [-8, -66],
      [-16, -46], [-18, -18], [-22, 3], [-28, -16], [-42, -20], [-56, -6], [-68, 18]].map((p, i) => {
        const q = yawPt([p[0] * rx / 80, p[1] * ry / 88], rx, ry, turn);
        return add(q, drag, [1, 3, 5, 7].includes(i) ? 0.3 : 0);
      });
    const P = shp([...out, ...line], hair, 4.8, 1.1, 0);
    // strand accents: dark brush flicks that follow the spikes
    [1, 3, 5].forEach(j => {                       // strand flicks run from inside the mass up into a spike
      const b = mid([0, -ry * 0.45], bases[j], 0.72), t = mid(b, tips[j], 0.62);
      ln([b, mid(b, t, 0.5), t], 3.2, dark, 0.85, 0.4);
    });
    return P;
  }

  function hairBia(D, rx, ry, turn, drag, layer) {
    const hair = D.hair;
    const S = ([x, y]) => [x * rx / 78, y * ry / 84];
    const Y = p => yawPt(S(p), rx, ry, turn);
    const dome = (a0, a1, n) => Array.from({ length: n + 1 }, (_, i) => { const a = lerp(a0, a1, i / n); return S([Math.cos(a) * 92, Math.sin(a) * 97 - 5]); });
    if (layer === 'back') {
      // far-side lock of the bob, visible just beyond the forehead/cheek outline; lengthens when frontal
      const yb = lerp(0, 50, turn);
      const pts = [...dome(-1.25, -0.25, 4), ...[[96, yb - 16], [93, yb], [84, yb + 7], [72, yb + 4], [62, yb - 10], [56, -40]].map(S)]
        .map((p, i) => (i >= 6 && i <= 8) ? add(p, drag, 0.6) : p);
      shp(pts, hair, 4.6, 1.1, 2);
      return;
    }
    // front layer: bangs (front → back) cut high enough to leave a forehead strip for the brows above the glasses,
    // near-side curtain, curled-under ends, back of the bob, crown dome
    const bangs = [[88, -56], [78, -50], [66, -56], [54, -49], [42, -56], [30, -49], [18, -55], [6, -49], [-6, -54]].map(Y);
    const curtain = [[-16, -34], [-20, -4], [-22, 22], [-19, 40], [-8, 50]].map((p, i) => yawPt(S(p), rx, ry, turn, 0.55 + 0.3 * i / 4));
    const back = [[-18, 60], [-44, 65], [-70, 58], [-86, 38], [-93, 8]].map(S);
    const tips = [[curtain[3], 0.6], [curtain[4], 0.9], [back[0], 1], [back[1], 1], [back[2], 0.9], [back[3], 0.5]];
    tips.forEach(([p, w]) => { p[0] += drag[0] * w; p[1] += drag[1] * w; });
    const P = shp([...bangs, ...curtain, ...back, ...dome(PI - 0.12, TAU - 0.47, 9)], hair, 4.8, 1.2, 2);
    // glossy crown highlight + inner line where the bob curls under
    ln([[-62, -46], [-50, -66], [-28, -82], [-6, -88]].map(S), 5, T.tint(hair, 0.2), 0.9, 0.5);
    ln([[-66, 48], [-44, 55], [-24, 53]].map(S).map(p => add(p, drag, 0.9)), 3, T.tint(hair, 0.16), 0.8, 0.4);
    return P;
  }

  function drawHead(D, P, turn, drag, A) {
    const c = T.ctx, [rx, ry] = D.head, E = D.eye, bia = D.id === 'bia';
    const L = (a, b) => [lerp(a[0], b[0], turn), lerp(a[1], b[1], turn)];
    // mouth geometry first: an open mouth drops the jaw
    const mp = L(D.mouth.a, D.mouth.b), MG = mouthGeo(mp[0], mp[1], P, D, turn);
    const jaw = jawDrop(rx, ry, turn, MG.bottom);
    // 1 — behind the head
    sec(10); if (bia) hairBia(D, rx, ry, turn, drag, 'back');
    sec(11);
    if (D.ear && turn > 0.3) {                        // far ear peeks out as the face turns front
      const fe = yawPt([34, D.ear[1]], rx, ry, -turn); oval(Math.max(fe[0], rx * lerp(0.6, 0.98, turn)), D.ear[1], 11, 16, D.skin, 4.2, 0.8);
    }
    // 2 — head (keep the boiled outline: blush and mouth are clipped to it)
    sec(12); const headP = shp(headPts(rx, ry, turn, jaw.amt, jaw.a), D.skin, 4.8, 1.1, 2);
    // 3 — cheeks
    sec(13);
    const bl = Math.max(D.blush, P.blush || 0);
    const cheekN = L(...D.blushAt.near), cheekF = L(...D.blushAt.far);
    if (bl > 0.01) {
      c.save(); T.path(headP); c.clip();
      c.save(); c.globalAlpha *= clamp(bl) * 0.75;
      T.fillPts(T.ell(cheekF[0], cheekF[1] + jaw.amt * 0.15, lerp(8, 12, turn), 7, 16), T.C.pink);
      T.fillPts(T.ell(cheekN[0], cheekN[1] + jaw.amt * 0.1, 13, 7.5, 16), T.C.pink);
      c.restore();
      if ((P.blush || 0) > 0.55) [cheekN, cheekF].forEach(([x, y], j) => [-5, 0, 5].slice(j).forEach(o => ln([[x + o - 2, y + 3], [x + o + 2, y - 3]], 2, T.shade(T.C.pink, 0.2), 0.6, 0.2)));
      c.restore();
    }
    // 4 — eyes (far first)
    const en = L([E.near[0], E.y], [E.near[1], E.y]), ef = L([E.far[0], E.y], [E.far[1], E.y]);
    const frx = lerp(E.farRx, E.rx, turn);
    sec(14); eye(ef[0], ef[1], frx, E.ry, P, 1, D);
    sec(15); eye(en[0], en[1], E.rx, E.ry, P, -1, D);
    // 5 — glasses arm (goes under the hair)
    sec(16); if (D.glasses) ln([[en[0] - E.rx - 7, en[1] - 3], yawPt([-10, en[1] - 1], rx, ry, turn)], 3.8, INK, 0.2, 0.4);
    // 6 — hair (front)
    sec(17);
    if (bia) hairBia(D, rx, ry, turn, drag, 'front');
    else hairLeo(D, rx, ry, turn, drag);
    // 7 — ear (over the sideburn)
    sec(18);
    if (D.ear) {
      const e = yawPt(D.ear, rx, ry, turn);
      oval(e[0], e[1], 12, 17, D.skin, 4.4, 0.8, -0.1);
      ln([[e[0] + 4, e[1] - 7], [e[0] - 3, e[1] - 3], [e[0] - 2, e[1] + 5], [e[0] + 3, e[1] + 7]], 3, INK, 0.7, 0.4);
    }
    // 8 — glasses frames (over the bangs)
    sec(19);
    if (D.glasses) {
      const gr = [E.rx + 8, E.ry + 5], gf = [frx + 7, E.ry + 5];
      [[ef, gf], [en, gr]].forEach(([p, r]) => {
        const G = ovalPts(p[0], p[1], r[0], r[1], 0.5, 0, 14);
        if (D.lens) T.fillPts(G, D.lens); T.ink(G, 4);
        ln([[p[0] + r[0] * 0.2, p[1] - r[1] * 0.62], [p[0] + r[0] * 0.55, p[1] - r[1] * 0.3]], 2.4, PAPER, 0.7, 0.2);   // glint
      });
      ln([[en[0] + E.rx + 7, en[1] - 3], [mid(en, ef)[0], en[1] - 6], [ef[0] - frx - 6, ef[1] - 3]], 3.8, INK, 0.3, 0.3);
    }
    // 9 — nose
    sec(20);
    const N = D.nose, np = L(N.a, N.b);
    if (N.kind === 'bulb') {
      oval(np[0], np[1], N.r[0], N.r[1], D.skin, 4.6, 0.9, 0.15);
      T.fillPts(T.ell(np[0] + 5, np[1] - 6, 4, 3, 8), T.tint(D.skin, 0.45));     // shine
    } else {
      const nr = [N.r[0] * lerp(1, 0.85, turn), N.r[1]];
      T.fillPts(T.ell(np[0], np[1], nr[0] + 1, nr[1] + 1, 16), D.skin);
      if (turn < 0.5) ln(T.arcPts(np[0], np[1], nr[0], nr[1], -1.9, 1.9, 8), 4, INK, 0.45, 0.4);          // profile bump
      else ln(T.arcPts(np[0], np[1] + 1, nr[0] * 0.9, nr[1] * 0.8, 0.5, PI - 0.5, 6), 3.2, INK, 0.6, 0.3); // frontal: little smile of a nose
      if (turn < 0.5) ln([[np[0] + 1, np[1] + 3], [np[0] + 4, np[1] + 5]], 2.2, INK, 0.7, 0.2);   // nostril tick
    }
    // 10 — mouth (clipped to the face; the jaw has already made room for it)
    sec(21);
    c.save(); T.path(headP); c.clip(); drawMouth(MG); c.restore();
    A.mouth = A.at(mp[0], mp[1] + 6 + (MG.S.closed ? 0 : MG.S.hl * 0.3));
    // 11 — brows, over the hair
    const gap = D.brow.gap;
    sec(22); brow(ef[0] + 2, ef[1] - E.ry - gap, -1, P, D, headP);
    sec(23); brow(en[0] - 1, en[1] - E.ry - gap, 1, P, D, headP);
    // 12 — hair clip (Bia) on the bangs
    sec(24);
    if (bia) {
      const cp = yawPt([4, -68], rx, ry, turn);
      shp(T.rrectPts(cp[0] - 16, cp[1] - 6, 32, 12, 6).map(p => add(rot([p[0] - cp[0], p[1] - cp[1]], -0.35), cp)), D.clip, 3.6, 0.6, 1);
      ln([[cp[0] - 8, cp[1] + 1], [cp[0] + 6, cp[1] - 4]], 2.4, PAPER, 0.7, 0.2);
    }
    // 13 — sweat drop
    sec(25);
    const sw = clamp(P.sweat || 0);
    if (sw > 0.02) {
      const sp = bia ? yawPt([-15, -34], rx, ry, turn) : yawPt([-4, -34], rx, ry, turn), s = 0.6 + 0.5 * sw;
      const [x, y] = [sp[0], sp[1] + 10 * sw];
      const drop = [[x, y - 16 * s], [x + 5 * s, y - 5 * s], [x + 8 * s, y + 4 * s], [x + 5 * s, y + 9 * s], [x, y + 11 * s], [x - 5 * s, y + 9 * s], [x - 8 * s, y + 4 * s], [x - 5 * s, y - 5 * s]];
      shp(drop, '#8FD3F2', 3.2, 0.5, 2);
      T.fillPts(T.ell(x - 3 * s, y + 3 * s, 2 * s, 3.2 * s, 8), PAPER);
    }
    A.head = A.at(0, 0);
    A.headTop = A.at(0, -ry * (bia ? 1.12 : 1.36));
  }

  // ─────────────────────────── hands ───────────────────────────
  // Hand-local space: origin at the wrist, +y along the forearm (away from the elbow), +x = thumb side.
  // Chunky 90s mitten language: a ball palm, four fat separate fingers, a thumb clearly split off.
  // layer 'body' = everything but the thumb, 'thumb' = the thumb only (drawn over a held prop).
  const GRIP = [2, 14];                               // where a held prop's handle sits, hand-local
  function hand(kind, fill, layer = 'all', crease = INK) {
    const O = (cx, cy, rx, ry, r = 0, amp = 0.45) => ovalPts(cx, cy, rx, ry, amp, r, 12);
    const body = layer !== 'thumb', thumb = layer !== 'body';
    if (kind === 'fist' || kind === 'point') {
      if (body) {
        if (kind === 'point') {                       // index finger: 1.6× longer than a knuckle, thinner than the fist
          shp(O(4, 31.5, 4.3, 14, -0.05), fill, 3.8, 0, 0);
          ln([[6.6, 36.5], [5, 39], [5.4, 41.5]], 1.6, crease, 0.3, 0.1);     // fingernail
        }
        // the ball of the hand + the curled fingers as a row of rolls along the front-bottom
        const rolls = (kind === 'point' ? [[-9, 19.5], [-3, 23]] : [[-9, 19.5], [-3, 23], [3.5, 24.2]]).map(([x, y]) => O(x, y, 5.6, 5.4, 0, 0.3));
        union([O(0, 12, 12.5, 12), ...rolls], fill, 4);
        // separations between the rolls: short notches pointing into the fist
        (kind === 'point' ? [[-6.2, 22.2]] : [[-6.2, 22.2], [0.2, 24.6]]).forEach(([x, y]) => ln([[x + 0.8, y + 2.5], [x - 0.8, y - 3.5]], 2.4, INK, 0.5, 0.15));
      }
      // thumb lobe along the top, tip pointing forward over the curled index finger
      if (thumb) shp(O(10, 12.5, 4.5, 10, 0.3), fill, 3.6, 0, 0);
      return;
    }
    if (!body) return;
    if (kind === 'open' || kind === 'wave') {
      // four fat fingers fanned apart (pinky … index) + a thumb split off at ~65°; no palm crease
      const wv = kind === 'wave', spread = wv ? 0.34 : 0.28, len = [8.4, 9.8, 10, 9.2], fw = 4.1, db = 5.4;
      const cen = k => ({ a: k * spread, b: [k * db, 19] });
      const F = [-1.5, -0.5, 0.5, 1.5].map((k, i) => {
        const { a, b } = cen(k), d = [Math.sin(a), Math.cos(a)];
        return O(b[0] + d[0] * len[i] * 0.85, b[1] + d[1] * len[i] * 0.85, fw, len[i], -a, 0.3);
      });
      const ta = wv ? 1.2 : 1.1, td = [Math.sin(ta), Math.cos(ta)];
      const Th = O(td[0] * 12.5, 10 + td[1] * 12.5, 4.4, 8.6, -ta, 0.3);
      union([O(0, 11.5, 11.5, 11), ...F, Th], fill, 3.8);
      // separate the fingers: from each notch (where neighbouring fingers part) a short tapered line back into the hand
      for (let i = 0; i < 3; i++) {
        const A0 = cen(-1.5 + i), A1 = cen(-0.5 + i), d0 = [Math.sin(A0.a), Math.cos(A0.a)], d1 = [Math.sin(A1.a), Math.cos(A1.a)];
        let t = 0; for (; t < 20; t += 0.5) { if (Math.hypot(A1.b[0] + d1[0] * t - A0.b[0] - d0[0] * t, d1[1] * t - d0[1] * t) >= 2 * fw) break; }
        const nt = mid(add(A0.b, d0, t), add(A1.b, d1, t)), dm = mid(d0, d1);
        ln([add(nt, dm, 1.5), add(nt, dm, -6.5)], 2.6, INK, 0.55, 0.15);
      }
      return;
    }
    // 'mitt' — relaxed mitten, thumb alongside
    union([O(0, 14, 11.5, 14, 0, 0.6), O(12, 9, 5, 8.5, -0.7, 0.6)], fill, 4);
    ln([[8.5, 13], [10.5, 16.5]], 2.4, INK, 0.7, 0.2);
  }

  // props (T.props from props.js, or a placeholder so tests still run)
  function prop(h, x, y, s, r) {
    const P = T.props;
    if (h.kind === 'sandHalf') { if (P && P.sandwichHalf) return P.sandwichHalf(x, y, s, r, h.state || 0); }
    else if (h.kind === 'sandWhole') { if (P && P.sandwichWhole) return P.sandwichWhole(x, y, s, r); }
    else if (h.kind === 'book') { if (P && P.book) return P.book(x, y, s, r, h.open ?? 1); }
    const c = T.ctx; c.save(); c.translate(x, y); c.rotate(r); c.scale(s, s);
    if (h.kind === 'book') {
      const o = h.open ?? 1, w = lerp(52, 64, o);
      shp([[-w, -38], [0, -32], [w, -38], [w, 38], [0, 44], [-w, 38]], '#D9453B', 4.2, 0.8, 1);
      if (o > 0.2) { shp([[-w + 6, -33], [0, -28], [0, 38], [-w + 6, 33]], PAPER, 3.2, 0.6, 1); shp([[w - 6, -33], [0, -28], [0, 38], [w - 6, 33]], PAPER, 3.2, 0.6, 1); }
    } else if (h.kind === 'sandWhole') {
      shp(T.rrectPts(-40, -24, 80, 48, 12), '#7CC35A', 4, 0.8, 1); shp(T.rrectPts(-36, -30, 72, 44, 14), '#F1CF8A', 4.2, 0.8, 1);
    } else {
      const st = h.state || 0, pts = st === 0 ? [[-30, 20], [30, 20], [0, -30]] : st === 1 ? [[-30, 20], [30, 20], [14, -6], [8, -16], [0, -10], [-6, -18], [-12, -8]] : [[-30, 20], [30, 20], [22, 8], [-22, 8]];
      shp(pts.map(([a, b]) => [a * 1.08, b * 1.08 + 2]), '#7CC35A', 4, 0.8, 0); shp(pts, '#F1CF8A', 4.4, 0.8, 0);
    }
    c.restore();
  }
  // a held prop: offset from the grip point (in the prop's own rotated frame) and a per-kind rotation offset.
  // The prop follows the forearm partially (PROP_FOLLOW) so it stays mostly upright but swings with the wrist.
  const PROP_OFF = { sandHalf: [0, -24], sandWhole: [1, -38], book: [3, -40] };
  const PROP_ROT = { sandHalf: 0, sandWhole: 0, book: 0.05 };
  const TWO_OFF = { sandWhole: [4, -10], book: [8, -24] };
  const PROP_CUT = { sandHalf: 17, sandWhole: 31, book: 33 };     // prop-local y below which the fist is in front
  const PROP_FOLLOW = 0.35;
  function heldProp(h, G) {
    const r = (PROP_ROT[h.kind] || 0) - PROP_FOLLOW * (G.fa - PI / 2);
    const p = add(G.grip, rot(PROP_OFF[h.kind] || [0, -18], r));
    prop(h, p[0], p[1], 1, r);
    return { p, r, cut: h.kind === 'sandHalf' && (h.state || 0) >= 2 ? 12 : PROP_CUT[h.kind] ?? 14 };
  }

  // ─────────────────────────── arm ───────────────────────────
  // sh0 = rest shoulder, [a, e] = shoulder/elbow angles, str = rubber-hose stretch. The shoulder slides back as
  // the arm rises. A raised arm (a > 1.9) is auto-adjusted so the hand never lands on the face:
  //   forward raises (toss, reach) stretch the rubber hose until the hand is out past the nose;
  //   high raises (wave, cheer) swing the upper arm back to run up past the ear, keep the forearm's direction,
  //   and tip the forearm back only if the hand would still cover the face.
  // `keep` = {c, face:[cx,cy,rx,ry]} for the near arm (keep the hand off the FACE), {c, head:[rx,ry,top]} for the
  // far arm (keep it out from behind the head so it stays visible). Everything is continuous in the pose.
  function armGeo(sh0, ang, str0, keep, holding) {
    const [a, e] = ang, up = T.smooth(1.6, 2.8, a);
    const sh = [sh0[0] - 14 * up, sh0[1] + 3 * up];
    const geo = (str, ua = a, fa = a + e) => {                // ua / fa = absolute upper-arm / forearm angles
      const L1 = 48 * str, L2 = 44 * str, d1 = dirOf(ua), d2 = dirOf(fa);
      const el = add(sh, d1, L1), wr = add(el, d2, L2), ex = [d2[1], -d2[0]];
      return { sh, el, wr, d1, d2, ex, fa, hc: add(wr, d2, 13), grip: add(add(wr, d2, GRIP[1]), ex, GRIP[0]), str };
    };
    // inside test for the keep-out ellipse (m = extra margin)
    const inside = (p, m) => {
      if (!keep) return false;
      if (keep.face) { const [fx, fy, rx, ry] = keep.face; return ((p[0] - fx) / (rx + m)) ** 2 + ((p[1] - fy) / (ry + m)) ** 2 < 1; }
      const [rx, ry, top] = keep.head, dy = p[1] - keep.c[1];
      return ((p[0] - keep.c[0]) / (rx + m)) ** 2 + (dy / ((dy < 0 ? top : ry) + m)) ** 2 < 1;
    };
    const hm = 14 + (holding ? 20 : 0);                 // hand radius (+ a held prop)
    const clear = (s, ua, fa) => !inside(geo(s, ua, fa).hc, hm);
    let str = str0, ua = a, fa = a + e;
    if (keep && a > 1.9) {
      const bis = (f, lo, hi) => { for (let i = 0; i < 16; i++) { const m = (lo + hi) / 2; if (f(m)) hi = m; else lo = m; } return hi; };
      const far = !!keep.head;
      // forward strategy: stretch out past the nose (far arm: out from behind the head)
      const sF = clear(str0, a, a + e) ? str0 : clear(2.1, a, a + e) ? bis(s => clear(s, a, a + e), str0, 2.1) : 2.1;
      // high strategy: the near upper arm swings back to run up past the ear; the hand must end clear AND above the
      // brows. Near arm: tip the forearm back first, then stretch. Far arm (hidden by the head): stretch first.
      const uB = far ? a : Math.max(a, 3.25), top = keep.c[1] - keep.ry * 0.8;
      const ok = (s, f) => clear(s, uB, f) && geo(s, uB, f).hc[1] <= top;
      let sB = far ? str0 : Math.max(str0, 1.3), fB = a + e;
      if (far) {
        if (!ok(sB, fB)) { if (ok(1.9, fB)) sB = bis(s => ok(s, fB), sB, 1.9); else { sB = 1.9; const lo = fB; fB = lo + bis(d => clear(1.9, uB, lo + d), 0, 1.3); } }
      } else {
        if (!clear(sB, uB, fB)) { const lo = fB; fB = lo + bis(d => clear(sB, uB, lo + d), 0, 1.3); }
        if (!ok(sB, fB)) sB = ok(1.9, fB) ? bis(s => ok(s, fB), sB, 1.9) : 1.9;
      }
      const k = T.smooth(2.3, 2.5, a);               // blend the two so animation never pops
      str = lerp(sF, sB, k); ua = lerp(a, uB, k); fa = lerp(a + e, fB, k);
      // an in-between of the two may still be caught behind/over the head: stretch it out
      if (!clear(str, ua, fa)) { const s0 = str; str = clear(2.1, ua, fa) ? bis(s => clear(s, ua, fa), s0, 2.1) : Math.max(s0, 2.1); }
    }
    const G = geo(str, ua, fa);
    // does the raised near arm still pass over the face? then cheat like TV animation: the arm tucks behind the
    // head and only the hand is drawn in front
    G.overFace = false;
    if (keep && keep.face && a > 1.9) {
      for (let i = 3; i <= 12; i++) {
        const u = i / 12, p = u < 0.5 ? mid(G.sh, G.el, u * 2) : mid(G.el, G.wr, u * 2 - 1);
        if (inside(p, -4)) { G.overFace = true; break; }
      }
    }
    return G;
  }
  // o: { parts: 'all' | 'arm' | 'hand', prop, torsoP, clipOut }
  function drawArm(D, G, far, handKind, A, key, o = {}) {
    const c = T.ctx, base = far ? 60 : 80, parts = o.parts || 'all';
    const k = far ? 0.13 : 0, skin = T.shade(D.skin, k), shirt = T.shade(D.shirt, k), trim = T.shade(D.trim, k), crease = T.shade(D.skin, k + 0.3);
    if (parts !== 'hand') {
      c.save(); if (o.clipOut) clipOutside(o.clipOut);
      sec(base);
      const w = 12.5 / Math.sqrt(G.str);
      hose([G.sh, mid(G.sh, G.el), G.el, mid(G.el, G.wr), G.wr], w, skin, 4.2);
      // short sleeve: the cap is filled in shirt colour and only inked where it leaves the torso silhouette, so
      // it merges with the body; front/back edges inked from below the shoulder; bell hem + a cuff band
      sec(base + 1);
      const d = G.d1, n = [d[1], -d[0]], at = (u, v) => add(add(G.sh, d, u), n, v);   // u along the arm, v across
      const HL = 23;                                                     // sleeve length from the shoulder pivot
      // bell outline: rounded cap → curved back edge → slanted, flared hem (≈1.35× the arm) → curved front edge
      const cap = Array.from({ length: 7 }, (_, i) => { const th = (i / 6) * PI; return at(1 - 13 * Math.sin(th), 12.5 * Math.cos(th)); });
      const back = [at(9, -13.4), at(17, -15.2)], hB = at(HL + 2, -16.6), hM = at(HL + 1.5, 0), hF = at(HL - 2.5, 16.2), front = [at(15, 14.8), at(8, 13.2)];
      const Sv = T.J([...cap, ...back, hB, hM, hF, ...front], 0.7), SvS = sm(Sv, 1);
      T.fillPts(SvS, shirt);
      // the cap merges into the torso: only inked where the sleeve leaves the torso silhouette
      if (o.torsoP) { c.save(); clipOutside([o.torsoP]); T.ink(SvS, 4.4); c.restore(); }
      const j = Sv.slice(7);                                             // back0 back1 hB hM hF front0 front1
      ln([j[0], j[1], j[2]], 4.4, INK, 0.5, 0);                          // back edge
      ln([j[4], j[5], j[6]], 4.4, INK, 0.5, 0);                          // front edge
      // cuff band: its own outlined 6px band following the hem
      shp([at(HL - 4.2, -15.9), hB, hM, hF, at(HL - 8.6, 15.6), at(HL - 4.8, 0)], trim, 3.2, 0.5, 1);
      ln([at(10, -6.5), at(15.5, -2.5)], 2.3, T.shade(D.shirt, k + 0.3), 0.8, 0.3);                  // soft fold
      c.restore();
    }
    if (parts === 'arm') return;
    // hand in its own frame; a held prop sits between the palm and the wrapping fingers
    const hf = fn => { c.save(); c.transform(G.ex[0], G.ex[1], G.d2[0], G.d2[1], G.wr[0], G.wr[1]); fn(); c.restore(); };
    sec(base + 2); hf(() => { hand(handKind, skin, o.prop ? 'body' : 'all', crease); A[key] = A.at(0, 13); });
    if (o.prop) {
      sec(base + 3); const F = heldProp(o.prop, G);
      // the fingers wrap in front of the handle: redraw the hand clipped to the prop-frame half-plane below `cut`
      sec(base + 2);
      c.save(); c.translate(F.p[0], F.p[1]); c.rotate(F.r); c.beginPath(); c.rect(-300, F.cut, 600, 600); c.rotate(-F.r); c.translate(-F.p[0], -F.p[1]); c.clip();
      hf(() => hand(handKind, skin, 'body', crease));
      c.restore();
      sec(base + 4); hf(() => hand(handKind, skin, 'thumb', crease));
    }
  }

  // ─────────────────────────── legs ───────────────────────────
  const THIGH = 58, SHIN = 54, HEM = 30;
  // walk: swing legs follow a sinusoid; the stance leg is solved so its foot slides back LINEARLY with phase,
  // i.e. it stays planted when the body advances by STRIDE px per radian.
  const AMP = 0.42, KB0 = 0.06;
  const RA = Math.hypot(THIGH + SHIN * Math.cos(KB0), SHIN * Math.sin(KB0)), PHI = Math.atan2(-SHIN * Math.sin(KB0), THIGH + SHIN * Math.cos(KB0));
  const footX = at => RA * Math.sin(at + PHI);                       // = THIGH·sin(at) + SHIN·sin(at − KB0)
  const FX0 = footX(AMP), FX1 = footX(-AMP), STRIDE = (FX0 - FX1) / PI;
  const stanceAt = qq => Math.asin(clamp((FX0 - STRIDE * qq) / RA, -1, 1)) - PHI;

  function legGeo(hip, at, as, footA, sit) {
    const kn = add(hip, dirOf(at), THIGH + 6 * sit), an = add(kn, dirOf(as), SHIN);
    return { hip, kn, an, at, as, footA };
  }
  function drawLegSkin(D, G, far, A, key) {
    const k = far ? 0.13 : 0, skin = T.shade(D.skin, k);
    hose([G.hip, mid(G.hip, G.kn), G.kn, mid(G.kn, G.an), G.an], 14, skin, 4.2);
    // sock
    const sd = dirOf(G.as), top = add(G.an, sd, -16);
    hose([top, add(G.an, sd, -2)], 17, T.shade(D.sock, k), 4);
    if (D.sockStripe) [-12, -7].forEach(o => ln([add(add(G.an, sd, o), [sd[1], -sd[0]], -8), add(add(G.an, sd, o), [sd[1], -sd[0]], 8)], 2.6, T.shade(D.sockStripe, k), 0.1, 0.3));
    // sneaker
    const c = T.ctx; c.save(); c.translate(G.an[0], G.an[1]); c.rotate(G.footA);
    const shoe = T.shade(D.shoe, k), sole = T.shade(D.sole, k);
    shp([[-14, -4], [-10, -11], [2, -12], [12, -8], [24, -5], [34, -2], [39, 4], [37, 9], [16, 10], [-10, 10], [-16, 6]], shoe, 4.6, 1, 2);
    shp([[-16, 3], [37, 3.5], [39, 7], [36, 10.5], [-10, 10.5], [-16, 7.5]], sole, 3.4, 0.7, 1);
    shp([[-15, -4], [-10, -11], [-1, -12], [-3, 3], [-15, 3]], T.shade(D.shoeTrim, k), 3, 0.6, 1);   // heel counter
    ln([[2, -10], [7, -4]], 2.6, INK, 0.7, 0.3); ln([[8, -9], [12, -3]], 2.6, INK, 0.7, 0.3);   // laces
    A[key] = A.at(10, 10);
    c.restore();
  }
  // shorts: pelvis + both leg openings as ONE inked silhouette, then inseam & folds
  function shortsGeo(gN, gF, sit) {
    const HM = HEM + 12 * sit, up = 12 * sit;                        // seated: the seat of the shorts rests ON the plank
    const pelvis = [[-41, -36], [43, -36], [47, -14], [45, 6 - up * 0.6], [20, 12 - up], [-12, 12 - up], [-42, 8 - up], [-47, -14]];
    const legPts = G => {
      const d = dirOf(G.at), n = [d[1], -d[0]], top = add(G.hip, d, -10), hem = add(G.hip, d, HM);
      return [add(top, n, -17), add(hem, n, -19), add(hem, d, 1.5), add(hem, n, 19), add(top, n, 17), add(G.hip, d, -20)];
    };
    sec(6);
    return { HM, parts: [pelvis, legPts(gF), legPts(gN)].map(p => sm(T.J(p, 1), 2)) };
  }
  function drawShorts(D, gN, gF, sit) {
    const { HM, parts } = shortsGeo(gN, gF, sit);
    union(parts, D.shorts, 4.6);
    const dk = T.shade(D.shorts, 0.28);
    const dN = dirOf(gN.at), nN = [dN[1], -dN[0]];
    ln([add(add(gN.hip, dN, 8), nN, 18), add(add(gN.hip, dN, HM - 2), nN, 19)], 3.4, INK, 0.6, 0.5);    // inseam: near leg in front
    { const h = add(gN.hip, dN, HM - 5); ln([add(h, nN, -16), add(h, nN, 16)], 2.4, dk, 0.2, 0.4); }   // hem cuff
    if (D.id === 'leo' && sit < 0.4) ln([[30, -18], [33, -4], [30, 4]], 2.6, dk, 0.7, 0.4);          // fly seam
    if (sit > 0.4) { ln([[4, -10], [18, -6], [30, -8]], 2.6, INK, 0.7, 0.4); ln([[-10, -4], [2, 1]], 2.4, INK, 0.7, 0.3); }   // lap folds
    else ln([[-34, -6], [-28, 4]], 2.4, dk, 0.7, 0.3);
    return parts;
  }

  // ─────────────────────────── torso ───────────────────────────
  const TORSO = [[8, -133], [26, -131], [38, -122], [42, -104], [45, -80], [47, -52], [46, -28], [42, -19], [0, -16], [-38, -19], [-43, -26], [-42, -60], [-40, -100], [-36, -122], [-22, -132]];
  const torsoGeo = () => { sec(8); return sm(T.J(TORSO, 1.2), 2); };   // deterministic: same points every call
  function drawTorso(D, lean) {
    const P = torsoGeo();
    T.shape(P, D.shirt, 4.8, { jitter: 0 });
    // cloth folds: waist bunching; a belly crease that deepens with forward lean
    ln([[-30, -44], [-26, -36], [-27, -28]], 2.6, INK, 0.75, 0.5);
    ln([[34, -40 + lean * 20], [40, -34], [39, -26]], 2.6, INK, 0.75, 0.5);
    if (lean > 0.05) ln([[18, -70], [30, -66], [40, -68]], 2.2, T.shade(D.shirt, 0.3), 0.7, 0.4);
    ln([[-18, -98], [-14, -90]], 2.2, T.shade(D.shirt, 0.3), 0.8, 0.3);
    // chest emblem
    if (D.emblem === 'star') {
      const st = Array.from({ length: 10 }, (_, i) => { const a = -PI / 2 + i * PI / 5, r = i % 2 ? 5.5 : 12.5; return [24 + Math.cos(a) * r, -84 + Math.sin(a) * r]; });
      T.shape(st, D.clip || T.C.gold, 3, { jitter: 0.5 });
    }
    return P;
  }
  function drawCollar(D) {
    sec(9);
    const outer = T.arcPts(8, -131, 22, 10, 0, PI, 6), inner = T.arcPts(8, -131, 15, 4.5, PI, 0, 6);
    shp([...outer, ...inner], D.trim, 3.6, 0.6, 1);
  }

  // ─────────────────────────── main ───────────────────────────
  function drawKid(D, pose) { return keyed(() => drawKidK(D, pose || {})); }
  function drawKidK(D, pose) {
    const c = T.ctx;
    const P = Object.assign({ x: 0, y: 0, face: 1, scale: 1, sit: 0, walk: null, vel: 0, sq: 0, tilt: 0, nod: 0, turn: 0 }, pose);
    SALT = (D.salt || 0) + (P.seed || 0) * 1500;
    const sit = clamp(P.sit), turn = clamp(P.turn), walking = P.walk != null;
    const sitArc = Math.sin(PI * sit);                      // 0 at both ends of the stand↔sit blend, 1 mid-way
    const C0 = c.getTransform(), inv = C0.inverse();
    const A = { at: (x, y) => { const p = inv.multiply(c.getTransform()).transformPoint(new DOMPoint(x, y)); return [p.x, p.y]; } };
    c.save();
    c.translate(P.x, P.y); c.scale(P.face * P.scale, P.scale);

    // ── airborne? (shadow given as a ground y) → tuck the legs, throw the arms up ──
    const gy = typeof P.shadow === 'number' ? (P.shadow - P.y) / P.scale : 120;
    const tuck = clamp(P.tuck ?? (gy - 140) / 50) * (1 - sit * sit);

    // ── legs: walk cycle blended with the seated pose, then the air tuck ──
    const ph = P.walk || 0;
    const legA = (side, tk) => {
      const q = ph + (side ? 0 : PI);                       // side 1 = near
      let at, kb;
      if (walking) {
        const qq = ((q - PI / 2) % TAU + TAU) % TAU;         // 0..π = stance (foot planted), π..2π = swing
        at = qq < PI ? stanceAt(qq) : AMP * Math.sin(q);
        kb = KB0 + 0.95 * Math.pow(Math.max(0, Math.cos(q)), 1.5);
      } else { at = side ? -0.03 : 0.05; kb = 0.03; }
      let as = at - kb, fa = walking ? -0.3 * Math.sin(q) - 0.25 * Math.max(0, Math.cos(q)) * Math.sin(q * 2) : 0;
      const swing = (P.legSwing || 0) * (side ? 1 : -0.8);
      at = lerp(at, PI / 2 - (side ? 0.1 : 0.04), sit);
      as = lerp(as, (side ? 0.2 : 0.06) + swing, sit);
      fa = lerp(fa, 0.28 + swing * 0.5, sit);
      if (tk > 0) { const t0 = Math.max(at, side ? 0.9 : 1.1); at = lerp(at, t0, tk); as = lerp(as, t0 - (side ? 1.3 : 1.45), tk); fa = lerp(fa, 0.6, tk); }
      return [at, as, fa];
    };
    const hipY = -4 - 13 * sit;
    const hipsF = [10 + 10 * sit, hipY], hipsN = [-6 + 10 * sit, hipY];
    const gF = legGeo(hipsF, ...legA(0, tuck), sit), gN = legGeo(hipsN, ...legA(1, tuck), sit);
    // the body bob keeps the lowest (untucked) foot on the ground
    const gF0 = tuck > 0 ? legGeo(hipsF, ...legA(0, 0), sit) : gF, gN0 = tuck > 0 ? legGeo(hipsN, ...legA(1, 0), sit) : gN;
    const bob = (1 - sit) * (THIGH + SHIN - Math.max(gF0.an[1], gN0.an[1]) + hipY + 4);

    // ── squash & stretch about the feet (about the seat when sitting), volume-preserving ──
    const pv = lerp(120, 4, sit), sq = clamp(P.sq, -0.5, 0.45), sy = 1 - sq, sx = 1 / Math.sqrt(sy);

    // ── contact shadow (stays on the ground/seat, unaffected by bob & squash) ──
    if (P.shadow) {
      let k = 1;
      if (typeof P.shadow === 'number') k = clamp(1 - (gy - 120) / 320, 0.35, 1);
      if (sit < 0.5) T.shadow((gN.an[0] + gF.an[0]) / 2 + 12, gy + 2, (56 + Math.abs(gN.an[0] - gF.an[0]) * 0.5) * k * sx, 11 * k, k);
      else T.shadow(26, 1, 72, 5, 1);
    }

    c.translate(0, pv); c.scale(sx, sy); c.translate(0, -pv);
    c.translate(-8 * sitArc, bob);                          // sitting down: the butt goes back first

    // ── torso lean pivot, head placement, arm geometry (auto swing while walking) ──
    const lean = P.lean ?? ((walking ? 0.06 : 0) + 0.3 * sitArc);
    const leanT = () => { c.translate(0, -10); c.rotate(lean); c.translate(0, 10); };
    const tilt = (P.tilt || 0) + (walking ? 0.025 * Math.sin(ph * 2) : 0), nod = P.nod || 0;
    const pivot = [6, -128], hc = add(pivot, rot([8, -D.lift + nod], tilt)), neckTop = add(pivot, rot([4, -D.lift + nod + D.head[1] * 0.66], tilt));
    // keep-out regions for raised hands: the face features (near arm) and the whole head + hair (far arm)
    let keepN = null, keepF = null;
    if (P.autoReach !== false) {
      const f = T.lerpA(D.faceBox[0], D.faceBox[1], turn), fc = add(hc, rot([f[0], f[1]], tilt));
      keepN = { c: hc, ry: D.head[1], face: [fc[0], fc[1], f[2], f[3]] };
      keepF = { c: hc, ry: D.head[1], head: [D.head[0], D.head[1], D.head[1] * D.hairTop] };
    }
    let defN = walking ? [-0.5 * Math.sin(ph), 0.25 + 0.2 * Math.max(0, Math.sin(ph))] : sit > 0.5 ? [0.75, 0.75] : [-0.04, 0.2];
    let defF = walking ? [0.5 * Math.sin(ph), 0.25 + 0.2 * Math.max(0, -Math.sin(ph))] : sit > 0.5 ? [0.85, 0.7] : [0.3, 0.25];
    defN = [defN[0] + 0.55 * sitArc, defN[1]]; defF = [defF[0] + 0.45 * sitArc, defF[1]];     // arms forward for balance
    if (tuck > 0) { defN = T.lerpA(defN, POSE.hopArms.armN, tuck); defF = T.lerpA(defF, POSE.hopArms.armF, tuck); }
    const aN = armGeo([2, -112], P.armN || defN, P.strN || 1, keepN, !!P.holdN), aF = armGeo([20, -116], P.armF || defF, P.strF || 1, keepF, !!P.holdF);
    const hN = P.handN || (P.holdN ? 'fist' : 'mitt'), hF = P.handF || (P.holdF ? 'fist' : 'mitt');
    const two = P.holdN && P.holdF && P.holdN.kind === P.holdF.kind && P.holdN.kind !== 'sandHalf';
    // a far-hand prop held forward of the chest goes in front of the torso (and of the face when near the mouth)
    const farFront = !!(P.holdF && !two && (P.holdF.front || aF.grip[0] > 44));

    // hair secondary motion: tips drag against velocity (saturating), bounce on the walk
    const v = (P.vel || 0) * P.face;
    const drag = [-22 * Math.tanh(v / 300), 5 * Math.abs(Math.tanh(v / 300)) + (walking ? 3 * Math.cos(ph * 2 + 0.9) : 0) - 6 * sq];

    c.save(); leanT(); const torsoP = torsoGeo(); c.restore();
    // 1 — far arm (behind everything); its prop too unless it is held out in front
    if (!farFront) { c.save(); leanT(); drawArm(D, aF, true, hF, A, 'handF', { prop: two ? null : P.holdF, torsoP }); c.restore(); }
    // 2 — legs, shorts
    sec(4); drawLegSkin(D, gF, true, A, 'fF');
    sec(5); drawLegSkin(D, gN, false, A, 'fN');
    const shortsP = drawShorts(D, gN, gF, sit);
    // 3 — neck, torso, head
    c.save(); leanT();
    sec(7); hose([[7, -122], neckTop], 24, T.shade(D.skin, 0.14), 4.2);
    drawTorso(D, lean);
    drawCollar(D);
    if (farFront) drawArm(D, aF, true, hF, A, 'handF', { parts: 'arm', torsoP, clipOut: [torsoP, ...shortsP] });
    if (aN.overFace) drawArm(D, aN, false, hN, A, 'handN', { parts: 'arm', torsoP });
    c.save(); c.translate(hc[0], hc[1]); c.rotate(tilt);
    { // the head squashes only half as much as the body so the face stays readable on landings
      const syh = 1 - sq * 0.5, sxh = 1 / Math.sqrt(syh), cy0 = D.head[1] * 0.8;
      c.translate(0, cy0); c.scale(sxh / sx, syh / sy); c.translate(0, -cy0);
    }
    drawHead(D, P, turn, drag, A);
    c.restore();
    // 4 — props held out in front, then the near arm on top
    if (farFront) drawArm(D, aF, true, hF, A, 'handF', { parts: 'hand', prop: P.holdF });
    if (two) {
      sec(30);
      const o = TWO_OFF[P.holdN.kind] || [0, -10], m = mid(aN.grip, aF.grip);
      prop(P.holdN, m[0] + o[0], m[1] + o[1], 1, -0.04);
    }
    drawArm(D, aN, false, hN, A, 'handN', { parts: aN.overFace ? 'hand' : 'all', prop: two ? null : P.holdN, torsoP });
    c.restore();

    c.restore();
    return { head: A.head, headTop: A.headTop, mouth: A.mouth, handN: A.handN, handF: A.handF, feet: mid(A.fN, A.fF), footN: A.fN, footF: A.fF };
  }

  // Arm presets (visually checked; spread into a pose and override what you need)
  const POSE = {
    waveN: { armN: [3.3, -0.4], strN: 1.5, handN: 'wave' },      // near-arm hello, hand beside/above the back of the head
    waveF: { armF: [2.3, 0.35], strF: 1.4, handF: 'wave' },      // far-arm hello: the arm hides behind the head, the hand pops out in front
    tossN: { armN: [1.9, -0.5], strN: 1.4 },                     // underhand fling forward-up
    hopArms: { armN: [3.05, 0.1], armF: [2.2, 0.45], strN: 1.3, strF: 1.3 },      // "yay!": near arm straight up, far hand out front
  };

  T.rig = { drawKid, LEO, BIA, STRIDE, POSE, VISEMES: Object.keys(VIS) };
})();
