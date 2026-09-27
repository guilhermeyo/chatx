// rig.js — the kid rig for "O Lanche" v2: T.rig.drawKid(design, pose) → anchors. Designs: T.rig.LEO, T.rig.BIA.
// Original characters in a 90s TV-cartoon style. Body-local space: hip at (0,0), +x = the way the kid faces,
// y down, ground (shoe soles) at y = +120. Every outline goes through core primitives so it boils with the film.
'use strict';
(function () {
  const T = window.TOON;
  const { lerp, clamp } = T;
  const PI = Math.PI, TAU = T.TAU;
  const INK = T.C.INK, PAPER = T.C.PAPER;

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
    const c = T.ctx, P = smO(T.J(ctrl, 0.8), 3);
    c.save(); c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = INK;
    const seed = T.hash(P.length + ctrl[0][0] * 0.13) * 50;
    for (let i = 0; i < P.length - 1; i++) {
      c.lineWidth = w + 2 * lw * (0.78 + 0.44 * T.vnoise(seed + i * 0.4));
      c.beginPath(); c.moveTo(P[i][0], P[i][1]); c.lineTo(P[i + 1][0], P[i + 1][1]); c.stroke();
    }
    T.path(P, false); c.strokeStyle = color; c.lineWidth = w; c.stroke();
    c.restore();
    return P;
  }
  const g = (a, c0, w) => { let d = a - c0; d = Math.atan2(Math.sin(d), Math.cos(d)); return Math.exp(-(d / w) * (d / w)); };

  // ─────────────────────────── designs ───────────────────────────
  // Positions of face features are authored for the 3/4 view (a) and the frontal view (b); `turn` lerps a→b.
  const LEO = {
    id: 'leo', skin: '#F4C49A', shirt: '#E85D3F', trim: '#FFF6E6', shorts: '#3E5FA8', hair: '#6B3F22',
    shoe: '#F4EFE4', shoeTrim: '#E85D3F', sole: '#C9C1B4', sock: '#FFFDF7', sockStripe: '#E85D3F',
    head: [80, 88], lift: 94, hairStyle: 'spikes',
    eye: { rx: 15, ry: 20, y: -14, near: [24, -17], far: [55, 17], farRx: 12.5, pupil: 1 },
    nose: { kind: 'bulb', a: [84, 16], b: [0, 20], r: [19, 16] },
    mouth: { a: [46, 56], b: [0, 58], w: 21 },
    brow: { lw: 7.5, len: 24, gap: 13, color: INK },
    blushAt: { near: [[8, 34], [-44, 34]], far: [[72, 32], [44, 34]] },
    ear: [-34, 8], glasses: false, lashes: false, blush: 0, emblem: null,
  };
  const BIA = {
    id: 'bia', skin: '#B87850', shirt: '#8E6CC4', trim: '#B79AE6', shorts: '#F2B84B', hair: '#1F1A2E',
    shoe: '#E85D3F', shoeTrim: '#FFFDF7', sole: '#FFFDF7', sock: '#FFFDF7', sockStripe: null,
    clip: '#FFD23F', lens: null,
    head: [78, 84], lift: 90, hairStyle: 'bob',
    eye: { rx: 12, ry: 15, y: -4, near: [22, -19], far: [57, 19], farRx: 10.5, pupil: 1 },
    nose: { kind: 'button', a: [79, 22], b: [0, 22], r: [9.5, 8.5] },
    mouth: { a: [48, 48], b: [0, 50], w: 17.5 },
    brow: { lw: 5.5, len: 20, gap: 16, color: INK },
    blushAt: { near: [[4, 26], [-42, 26]], far: [[68, 24], [42, 26]] },
    ear: null, glasses: true, lashes: true, blush: 0.32, emblem: 'star',
  };

  // ─────────────────────────── head ───────────────────────────
  // Egg-shaped head: cheek bulge toward the face and a jaw tuck at the back (so the neck shows) in 3/4;
  // symmetric cheeks when frontal.
  function headPts(rx, ry, turn) {
    const n = 22, k = 1 - turn, pts = [];
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU, ca = Math.cos(a), sa = Math.sin(a);
      const r0 = rx * ry / Math.hypot(ry * ca, rx * sa);
      const b = k * (0.06 * g(a, 0.72, 0.5) - 0.11 * g(a, 2.2, 0.45) + 0.025 * g(a, -2.3, 0.6)) +
        turn * (0.045 * g(a, 0.85, 0.45) + 0.045 * g(a, PI - 0.85, 0.45) - 0.03 * g(a, PI / 2, 0.3));
      pts.push([ca * r0 * (1 + b), sa * r0 * (1 + b)]);
    }
    return pts;
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

  function brow(ex, y, s, P, D) {                 // s = +1 if the inner end is toward +x
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
    if (D.id === 'bia') {                          // thin skin halo so the brow reads over the black bangs
      const c = T.ctx; c.save(); T.path(B); c.lineJoin = 'round'; c.lineWidth = 3.4; c.strokeStyle = T.tint(D.skin, 0.1); c.stroke(); c.restore();
    }
    T.fillPts(B, D.brow.color);
  }

  // Visemes: w (half-width, × design width), hu/hl (upper/lower opening), pu/pl (curve exponents),
  // teeth top/bottom, tongue. 'rest' and 'M' are closed shapes.
  const VIS = {
    A: { w: 1.0, hu: 4, hl: 30, pu: 0.8, pl: 0.7, tt: 1, tb: 0, tongue: 1 },
    E: { w: 1.2, hu: 3, hl: 13, pu: 0.9, pl: 0.8, tt: 1, tb: 0, tongue: 0.6 },
    I: { w: 1.22, hu: 5, hl: 8, pu: 0.7, pl: 0.7, tt: 1, tb: 1, tongue: 0, smile: 0.35 },
    O: { w: 0.7, hu: 13, hl: 18, pu: 0.5, pl: 0.5, tt: 0, tb: 0, tongue: 0.8 },
    U: { w: 0.46, hu: 8, hl: 9, pu: 0.5, pl: 0.5, tt: 0, tb: 0, tongue: 0, pucker: 1 },
    F: { w: 0.8, hu: 2, hl: 9, pu: 0.9, pl: 0.6, tt: 1, tb: 0, tongue: 0, bite: 1 },
  };
  function mouth(mx, my, P, D, turn) {
    const M = P.mouth || {}, smile = M.smile ?? 0.4, w0 = D.mouth.w, farK = lerp(0.78, 1, turn);
    let v = M.viseme || null;
    if (!v || v === 'rest') v = (M.open || 0) > 0.06 ? 'open' : 'rest';
    const X = u => mx + u * (u > 0 ? farK : 1);
    if (v === 'rest' || v === 'M') {
      const w = w0 * (v === 'M' ? 0.75 : 0.9), s = v === 'M' ? smile * 0.3 : smile;
      const pts = []; for (let i = 0; i <= 6; i++) { const u = i / 3 - 1; pts.push([X(u * w), my - s * 10 * (u * u) + s * 4]); }
      ln(pts, v === 'M' ? 5.5 : 4.4, INK, 0.5, 0.5);
      if (v === 'M') {                              // pressed lips: little lower-lip arc + corner ticks
        ln(T.arcPts(mx + 1, my + 5, w * 0.45, 4, 0.3, PI - 0.3, 4), 2.6, INK, 0.7, 0.3);
        [-1, 1].forEach(sg => ln([[X(sg * w) - sg * 1, my - 4], [X(sg * w) + sg * 1.5, my + 4]], 2.4, INK, 0.6, 0.2));
      } else if (smile > 0.45) {                    // dimple ticks at the corners
        [-1, 1].forEach(sg => { const cx = X(sg * w), cy = my - smile * 6; ln([[cx - sg * 0.5, cy - 5], [cx + sg * 2.5, cy - 1], [cx + sg * 1.5, cy + 3]], 2.3, INK, 0.75, 0.2); });
      } else if (smile < -0.3) {
        ln([[mx - 4, my + 9], [mx + 4, my + 9]], 2.2, INK, 0.8, 0.3);   // little chin line for a pout
      }
      return;
    }
    let S;
    if (v === 'open') { const o = clamp(M.open); S = { w: 1 - 0.1 * o, hu: 3 + 3 * o, hl: 6 + 22 * o, pu: 0.8, pl: 0.7, tt: o > 0.3 ? 1 : 0, tb: 0, tongue: o }; }
    else S = VIS[v] || VIS.A;
    const sm2 = clamp(smile + (S.smile || 0), -1, 1) * (S.pucker ? 0.2 : 1);
    const w = w0 * S.w, base = u => -sm2 * 8 * u * u + sm2 * 3;
    const top = [], bot = [];
    for (let i = 0; i <= 10; i++) { const u = i / 5 - 1; top.push([X(u * w), my + base(u) - S.hu * Math.pow(1 - u * u, S.pu)]); }
    for (let i = 10; i >= 0; i--) { const u = i / 5 - 1; bot.push([X(u * w), my + base(u) + S.hl * Math.pow(1 - u * u, S.pl)]); }
    const c = T.ctx, Mp = T.J([...top, ...bot], 0.5);
    T.fillPts(Mp, '#5A1B2B');
    c.save(); T.path(Mp); c.clip();
    if (S.tongue) T.fillPts(T.ell(mx + 2, my + base(0) + S.hl * 0.95, w * 0.62, 5 + S.hl * 0.32, 14), '#E8687A');
    if (S.tt) { const th = S.bite ? 7.5 : 5.5; T.fillPts([...top, ...top.slice().reverse().map(([x, y]) => [x, y + th])], PAPER); }
    if (S.tb) { const th = 4.5; T.fillPts([...bot, ...bot.slice().reverse().map(([x, y]) => [x, y - th])], PAPER); }
    c.restore();
    T.ink(Mp, S.pucker ? 5.2 : 4);
    if (S.bite) { const lb = my + base(0) + S.hl; ln([[X(-w * 1.05), lb - 3], [mx, lb + 5], [X(w * 1.05), lb - 3]], 3.2, INK, 0.7, 0.3); }   // lower lip tucked under the teeth
    if (S.pucker) {                                  // pursed-lip creases
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
    // hairline (front → back): three forward-combed bang spikes, a sideburn, then the nape
    const line = [[72, -48], [66, -38], [56, -58], [48, -37], [36, -61], [28, -40], [14, -62], [4, -48], [-8, -60],
      [-16, -42], [-18, -18], [-22, 3], [-28, -16], [-42, -20], [-56, -6], [-68, 18]].map((p, i) => {
        const q = yawPt([p[0] * rx / 80, p[1] * ry / 88], rx, ry, turn);
        return add(q, drag, [1, 3, 5, 7].includes(i) ? 0.3 : 0);
      });
    const P = shp([...out, ...line], hair, 4.8, 1.1, 0);
    // strand accents: dark brush flicks that follow the spikes
    [1, 3, 5].forEach(j => {                       // strand flicks run from inside the mass up into a spike
      const b = mid([0, -ry * 0.35], bases[j], 0.72), t = mid(b, tips[j], 0.62);
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
      const pts = [...dome(-1.25, -0.25, 4), ...[[96, yb - 16], [93, yb], [84, yb + 7], [72, yb + 4], [62, yb - 10], [56, -34]].map(S)]
        .map((p, i) => (i >= 6 && i <= 8) ? add(p, drag, 0.6) : p);
      shp(pts, hair, 4.6, 1.1, 2);
      return;
    }
    // front layer: bangs (front → back), near-side curtain, curled-under ends, back of the bob, crown dome
    const bangs = [[88, -42], [78, -36], [66, -42], [54, -35], [42, -42], [30, -35], [18, -41], [6, -35], [-6, -40]].map(Y);
    const curtain = [[-16, -30], [-20, -4], [-22, 22], [-19, 40], [-8, 50]].map((p, i) => yawPt(S(p), rx, ry, turn, 0.55 + 0.3 * i / 4));
    const back = [[-18, 60], [-44, 65], [-70, 58], [-86, 38], [-93, 8]].map(S);
    const tips = [[curtain[3], 0.6], [curtain[4], 0.9], [back[0], 1], [back[1], 1], [back[2], 0.9], [back[3], 0.5]];
    tips.forEach(([p, w]) => { p[0] += drag[0] * w; p[1] += drag[1] * w; });
    const P = shp([...bangs, ...curtain, ...back, ...dome(PI - 0.12, TAU - 0.47, 9)], hair, 4.8, 1.2, 2);
    // glossy crown highlight + inner line where the bob curls under
    ln([[-62, -40], [-50, -62], [-28, -80], [-6, -86]].map(S), 5, T.tint(hair, 0.2), 0.9, 0.5);
    ln([[-66, 48], [-44, 55], [-24, 53]].map(S).map(p => add(p, drag, 0.9)), 3, T.tint(hair, 0.16), 0.8, 0.4);
    return P;
  }

  function drawHead(D, P, turn, drag, A) {
    const c = T.ctx, [rx, ry] = D.head, E = D.eye, bia = D.id === 'bia';
    const L = (a, b) => [lerp(a[0], b[0], turn), lerp(a[1], b[1], turn)];
    // 1 — behind the head
    if (bia) hairBia(D, rx, ry, turn, drag, 'back');
    if (D.ear && turn > 0.3) {                        // far ear peeks out as the face turns front
      const fe = yawPt([34, D.ear[1]], rx, ry, -turn); oval(Math.max(fe[0], rx * lerp(0.6, 0.98, turn)), D.ear[1], 11, 16, D.skin, 4.2, 0.8);
    }
    // 2 — head
    shp(headPts(rx, ry, turn), D.skin, 4.8, 1.1, 2);
    // 3 — cheeks
    const bl = Math.max(D.blush, P.blush || 0);
    const cheekN = L(...D.blushAt.near), cheekF = L(...D.blushAt.far);
    if (bl > 0.01) {
      c.save(); c.globalAlpha *= clamp(bl) * 0.75;
      T.fillPts(T.ell(cheekF[0], cheekF[1], lerp(8, 12, turn), 7, 16), T.C.pink);
      T.fillPts(T.ell(cheekN[0], cheekN[1], 13, 7.5, 16), T.C.pink);
      c.restore();
      if ((P.blush || 0) > 0.55) [cheekN, cheekF].forEach(([x, y]) => [-5, 0, 5].forEach(o => ln([[x + o - 2, y + 3], [x + o + 2, y - 3]], 2, T.shade(T.C.pink, 0.2), 0.6, 0.2)));
    }
    // 4 — eyes (far first)
    const en = L([E.near[0], E.y], [E.near[1], E.y]), ef = L([E.far[0], E.y], [E.far[1], E.y]);
    const frx = lerp(E.farRx, E.rx, turn);
    eye(ef[0], ef[1], frx, E.ry, P, 1, D);
    eye(en[0], en[1], E.rx, E.ry, P, -1, D);
    // 5 — glasses arm (goes under the hair)
    if (D.glasses) ln([[en[0] - E.rx - 7, en[1] - 3], yawPt([-10, en[1] - 1], rx, ry, turn)], 3.8, INK, 0.2, 0.4);
    // 6 — hair (front)
    if (bia) hairBia(D, rx, ry, turn, drag, 'front');
    else hairLeo(D, rx, ry, turn, drag);
    // 7 — ear (over the sideburn)
    if (D.ear) {
      const e = yawPt(D.ear, rx, ry, turn);
      oval(e[0], e[1], 12, 17, D.skin, 4.4, 0.8, -0.1);
      ln([[e[0] + 4, e[1] - 7], [e[0] - 3, e[1] - 3], [e[0] - 2, e[1] + 5], [e[0] + 3, e[1] + 7]], 3, INK, 0.7, 0.4);
    }
    // 8 — glasses frames (over the bangs)
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
    // 10 — mouth
    const mp = L(D.mouth.a, D.mouth.b);
    mouth(mp[0], mp[1], P, D, turn);
    A.mouth = A.at(mp[0], mp[1] + 6);
    // 11 — brows, over the hair
    const gap = D.brow.gap;
    brow(ef[0] + 2, ef[1] - E.ry - gap, -1, P, D);
    brow(en[0] - 1, en[1] - E.ry - gap, 1, P, D);
    // 12 — hair clip (Bia) on the bangs
    if (bia) {
      const cp = yawPt([2, -62], rx, ry, turn);
      shp(T.rrectPts(cp[0] - 16, cp[1] - 6, 32, 12, 6).map(p => add(rot([p[0] - cp[0], p[1] - cp[1]], -0.35), cp)), D.clip, 3.6, 0.6, 1);
      ln([[cp[0] - 8, cp[1] + 1], [cp[0] + 6, cp[1] - 4]], 2.4, PAPER, 0.7, 0.2);
    }
    // 13 — sweat drop
    const sw = clamp(P.sweat || 0);
    if (sw > 0.02) {
      const sp = bia ? yawPt([-8, -18], rx, ry, turn) : yawPt([-4, -30], rx, ry, turn), s = 0.6 + 0.5 * sw;
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
  function hand(kind, fill) {
    const J = (cx, cy, rx, ry, r = 0, amp = 0.6) => ovalPts(cx, cy, rx, ry, amp, r, 12);
    if (kind === 'fist' || kind === 'point') {
      const parts = [J(0, 12, 12.5, 12)];
      if (kind === 'point') parts.push(J(3.5, 28, 4.6, 11));
      union(parts, fill, 4);
      shp(T.ell(8.5, 8, 4.8, 8, 12, -0.25), fill, 3.4, 0.5);               // thumb wrapped on top
      [13, 18].forEach(y => ln([[2, y], [7, y + 1], [11, y - 1]], 2.4, INK, 0.7, 0.3));
      return;
    }
    if (kind === 'open') {
      union([J(0, 13, 12.5, 12.5), J(-1, 25, 10, 9.5), J(14, 5, 4.6, 9.5, -1.05)], fill, 4);
      ln([[-4, 16], [1, 19], [5, 16]], 1.8, T.shade(fill, 0.22), 0.8, 0.3);           // palm crease
      return;
    }
    if (kind === 'wave') {
      const parts = [J(0, 12, 12, 11.5)];
      [-0.55, -0.18, 0.18, 0.52].forEach(a => { const [dx, dy] = [Math.sin(a), Math.cos(a)]; parts.push(J(dx * 19, 8 + dy * 17, 4.3, 8.5, -a)); });
      parts.push(J(15, 6, 4.4, 8.5, -1.25));
      union(parts, fill, 4);
      ln([[-4, 13], [1, 16], [5, 13]], 1.8, T.shade(fill, 0.22), 0.8, 0.3);
      return;
    }
    // 'mitt' — relaxed mitten, thumb alongside
    union([J(0, 14, 11.5, 14), J(12, 9, 5, 8.5, -0.7)], fill, 4);
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
  const PROP_OFF = { sandHalf: [3, -24, 1], sandWhole: [4, -20, 1], book: [8, -34, 1] };

  // ─────────────────────────── arm ───────────────────────────
  // sh = shoulder, [a, e] = shoulder/elbow angles, str = rubber-hose stretch
  function armGeo(sh, ang, str) {
    const [a, e] = ang, L1 = 48 * str, L2 = 44 * str;
    const d1 = dirOf(a), d2 = dirOf(a + e);
    const el = add(sh, d1, L1), wr = add(el, d2, L2);
    return { sh, el, wr, d1, d2, hc: add(wr, d2, 13), str };
  }
  function drawArm(D, G, far, handKind, A, key) {
    const k = far ? 0.13 : 0, skin = T.shade(D.skin, k), shirt = T.shade(D.shirt, k);
    const w = 12.5 / Math.sqrt(G.str);
    hose([G.sh, mid(G.sh, G.el), G.el, mid(G.el, G.wr), G.wr], w, skin, 4.2);
    // sleeve: round shoulder cap, flared hem, a fold near the armpit
    const d = G.d1, n = [d[1], -d[0]], s0 = add(G.sh, d, -4), s1 = add(G.sh, d, 25);
    const cap = T.arcPts(0, 0, 16, 16, 0, -PI, 6).map(([x, y]) => add(s0, add(rot([x, y], Math.atan2(d[1], d[0]) - PI / 2), [0, 0])));
    const sleeve = [...cap, add(s1, n, -18), add(s1, d, 2), add(s1, n, 18)];
    shp(sleeve, shirt, 4.4, 0.9, 1);
    const cb = add(s1, d, -6);                                                             // cuff band
    shp([add(cb, n, -17), add(s1, n, -18), add(s1, d, 2), add(s1, n, 18), add(cb, n, 17)], T.shade(D.trim, k), 3, 0.5, 1);
    ln([add(add(G.sh, d, 12), n, -9), add(add(G.sh, d, 18), n, -4)], 2.4, INK, 0.8, 0.3);
    // hand in its own frame
    const c = T.ctx; c.save();
    const ex = [G.d2[1], -G.d2[0]], ey = G.d2;
    c.transform(ex[0], ex[1], ey[0], ey[1], G.wr[0], G.wr[1]);
    hand(handKind, skin);
    A[key] = A.at(0, 13);
    c.restore();
  }

  // ─────────────────────────── legs ───────────────────────────
  const THIGH = 58, SHIN = 54, HEM = 30;
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
  function drawShorts(D, gN, gF, sit, P) {
    const HM = HEM + 12 * sit;
    const pelvis = [[-41, -36], [43, -36], [47, -14], [45, 6], [20, 12], [-12, 12], [-42, 8], [-47, -14]];
    const legPts = G => {
      const d = dirOf(G.at), n = [d[1], -d[0]], top = add(G.hip, d, -10), hem = add(G.hip, d, HM);
      return [add(top, n, -17), add(hem, n, -19), add(hem, d, 1.5), add(hem, n, 19), add(top, n, 17), add(G.hip, d, -20)];
    };
    const parts = [pelvis, legPts(gF), legPts(gN)].map(p => sm(T.J(p, 1), 2));
    union(parts, D.shorts, 4.6);
    const dk = T.shade(D.shorts, 0.28);
    const dN = dirOf(gN.at), nN = [dN[1], -dN[0]];
    ln([add(add(gN.hip, dN, 8), nN, 18), add(add(gN.hip, dN, HM - 2), nN, 19)], 3.4, INK, 0.6, 0.5);    // inseam: near leg in front
    { const h = add(gN.hip, dN, HM - 5); ln([add(h, nN, -16), add(h, nN, 16)], 2.4, dk, 0.2, 0.4); }   // hem cuff
    if (D.id === 'leo' && sit < 0.4) ln([[30, -18], [33, -4], [30, 4]], 2.6, dk, 0.7, 0.4);          // fly seam
    if (sit > 0.4) { ln([[4, -10], [18, -6], [30, -8]], 2.6, INK, 0.7, 0.4); ln([[-10, -2], [2, 4]], 2.4, INK, 0.7, 0.3); }   // lap folds
    else ln([[-34, -6], [-28, 4]], 2.4, dk, 0.7, 0.3);
  }

  // ─────────────────────────── torso ───────────────────────────
  function drawTorso(D, P) {
    const lean = P.lean || 0;
    const pts = [[8, -133], [26, -131], [38, -122], [42, -104], [45, -80], [47, -52], [46, -28], [42, -19], [0, -16], [-38, -19], [-43, -26], [-42, -60], [-40, -100], [-36, -122], [-22, -132]];
    shp(pts, D.shirt, 4.8, 1.2, 2);
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
  }
  function drawCollar(D) {
    const outer = T.arcPts(8, -131, 22, 10, 0, PI, 6), inner = T.arcPts(8, -131, 15, 4.5, PI, 0, 6);
    shp([...outer, ...inner], D.trim, 3.6, 0.6, 1);
  }

  // ─────────────────────────── main ───────────────────────────
  function drawKid(D, pose) {
    const c = T.ctx;
    const P = Object.assign({ x: 0, y: 0, face: 1, scale: 1, sit: 0, walk: null, vel: 0, sq: 0, tilt: 0, nod: 0, turn: 0, strN: 1, strF: 1 }, pose);
    const sit = clamp(P.sit), turn = clamp(P.turn), walking = P.walk != null;
    const C0 = c.getTransform(), inv = C0.inverse();
    const A = { at: (x, y) => { const p = inv.multiply(c.getTransform()).transformPoint(new DOMPoint(x, y)); return [p.x, p.y]; } };
    c.save();
    c.translate(P.x, P.y); c.scale(P.face * P.scale, P.scale);

    // ── legs: walk cycle blended with the seated pose ──
    const ph = P.walk || 0;
    const legA = (side) => {
      const q = ph + (side ? 0 : PI);                       // side 1 = near
      let at = walking ? 0.42 * Math.sin(q) : (side ? -0.03 : 0.05);
      const kb = walking ? 0.06 + 0.95 * Math.pow(Math.max(0, Math.cos(q)), 1.5) : 0.03;
      let as = at - kb, fa = walking ? -0.3 * Math.sin(q) - 0.25 * Math.max(0, Math.cos(q)) * Math.sin(q * 2) : 0;
      const swing = (P.legSwing || 0) * (side ? 1 : -0.8);
      at = lerp(at, PI / 2 - (side ? 0.1 : 0.04), sit);
      as = lerp(as, (side ? 0.2 : 0.06) + swing, sit);
      fa = lerp(fa, 0.28 + swing * 0.5, sit);
      return [at, as, fa];
    };
    const hipY = -4 - 7 * sit;
    const gF = legGeo([10 + 10 * sit, hipY], ...legA(0), sit), gN = legGeo([-6 + 10 * sit, hipY], ...legA(1), sit);
    const bob = (1 - sit) * (THIGH + SHIN - Math.max(gF.an[1], gN.an[1]) + hipY + 4);

    // ── contact shadow (stays on the ground/seat, unaffected by bob & squash) ──
    if (P.shadow) {
      let gy = 120, k = 1;
      if (typeof P.shadow === 'number') { gy = (P.shadow - P.y) / P.scale; k = clamp(1 - (gy - 120) / 320, 0.35, 1); }
      if (sit < 0.5) T.shadow((gN.an[0] + gF.an[0]) / 2 + 12, gy + 2, (56 + Math.abs(gN.an[0] - gF.an[0]) * 0.5) * k * (1 + P.sq * 0.6), 11 * k, k);
      else T.shadow(26, 12, 72, 9, 1);
    }

    // ── squash & stretch about the feet (about the seat when sitting) ──
    const pv = lerp(120, 4, sit), sq = clamp(P.sq, -0.5, 0.6);
    c.translate(0, pv); c.scale(1 + sq * 0.6, 1 - sq); c.translate(0, -pv);
    c.translate(0, bob);

    // ── torso lean pivot, arm geometry (auto swing while walking) ──
    const lean = P.lean ?? (walking ? 0.06 : 0);
    const leanT = () => { c.translate(0, -10); c.rotate(lean); c.translate(0, 10); };
    const defN = walking ? [-0.5 * Math.sin(ph), 0.25 + 0.2 * Math.max(0, Math.sin(ph))] : sit > 0.5 ? [0.75, 0.75] : [-0.04, 0.2];
    const defF = walking ? [0.5 * Math.sin(ph), 0.25 + 0.2 * Math.max(0, -Math.sin(ph))] : sit > 0.5 ? [0.85, 0.7] : [0.3, 0.25];
    const aN = armGeo([2, -112], P.armN || defN, P.strN || 1), aF = armGeo([20, -116], P.armF || defF, P.strF || 1);
    const hN = P.handN || (P.holdN ? 'fist' : 'mitt'), hF = P.handF || (P.holdF ? 'fist' : 'mitt');
    const two = P.holdN && P.holdF && P.holdN.kind === P.holdF.kind && P.holdN.kind !== 'sandHalf';

    // hair secondary motion: tips drag against velocity (saturating), bounce on the walk
    const v = (P.vel || 0) * P.face;
    const drag = [-22 * Math.tanh(v / 300), 5 * Math.abs(Math.tanh(v / 300)) + (walking ? 3 * Math.cos(ph * 2 + 0.9) : 0) - 6 * sq];

    // 1 — far arm (behind everything)
    c.save(); leanT(); drawArm(D, aF, true, hF, A, 'handF'); c.restore();
    // 2 — legs, shorts
    drawLegSkin(D, gF, true, A, 'fF');
    drawLegSkin(D, gN, false, A, 'fN');
    drawShorts(D, gN, gF, sit, P);
    // 3 — neck, torso, head
    c.save(); leanT();
    const tilt = (P.tilt || 0) + (walking ? 0.025 * Math.sin(ph * 2) : 0), nod = P.nod || 0;
    const pivot = [6, -128], hc = add(pivot, rot([8, -D.lift + nod], tilt)), neckTop = add(pivot, rot([4, -D.lift + nod + D.head[1] * 0.66], tilt));
    hose([[7, -122], neckTop], 24, T.shade(D.skin, 0.14), 4.2);
    drawTorso(D, Object.assign({}, P, { lean }));
    drawCollar(D);
    c.save(); c.translate(hc[0], hc[1]); c.rotate(tilt);
    drawHead(D, P, turn, drag, A);
    c.restore();
    // 4 — props, then the near arm on top
    const off = h => PROP_OFF[h.kind] || [0, -20, 1];
    if (two) {
      const o = off(P.holdN), m = mid(aN.hc, aF.hc);
      prop(P.holdN, m[0] + o[0], m[1] + o[1] + 10, o[2], -0.04);
    } else {
      if (P.holdF) { const o = off(P.holdF); prop(P.holdF, aF.hc[0] + o[0], aF.hc[1] + o[1], o[2], 0.08); }
      if (P.holdN) { const o = off(P.holdN); prop(P.holdN, aN.hc[0] + o[0], aN.hc[1] + o[1], o[2], -0.08); }
    }
    drawArm(D, aN, false, hN, A, 'handN');
    c.restore();

    c.restore();
    return { head: A.head, headTop: A.headTop, mouth: A.mouth, handN: A.handN, handF: A.handF, feet: mid(A.fN, A.fF) };
  }

  T.rig = { drawKid, LEO, BIA };
})();
