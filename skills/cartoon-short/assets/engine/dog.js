// dog.js — Pipoca, the park dog of "O Lanche" v2.  T.dog.draw(pose) → anchors.
// An ORIGINAL design: small tan mutt with lopsided brown patches (one over the far eye), cream muzzle/bib/
// socks, long dark-brown floppy ears whose tips flip out, a tight curled tail, a popcorn tuft of cream
// kernels on top ("Pipoca" = popcorn), cheek fluff and a teal collar with a gold tag. Big head, stubby legs.
// Drawn in a local "facing right" frame (origin = ground under the body, y up = negative), mirrored with
// scale(face). Deterministic: sniff/chew twitches come from pose phases or, if absent, from T.BOIL.
//
// pose (all optional):
//   x, y        ground point (world)            face 1 right / -1 left      scale (default 1 ≈ 170px tall sitting)
//   mode        'sit' | 'walk' | 'jump'
//   walk        trot phase (radians; ~2.2 cycles/s reads well on twos)
//   jumpU       0 take-off … 0.5 apex … 1 landing (body angle, leg tuck, ear lag / flip)
//   lift        px above the ground (jump height). The contact shadow stays at y, shrinking with lift.
//   reach 0..1  stretch the head up toward a catch point (nose up, mouth opens unless holding)
//   sq          squash (+) / stretch (−) about the feet
//   wag, wagAmp tail wag phase (radians) and amplitude (0..1.2, default 0.5). film.js should animate
//               `wag`; pass wagAmp ≥ 0.8 only when it wants the motion-blur arcs (drawn when > 0.75).
//   tilt        extra head tilt (rad, + = nose down)
//   look [x,y]  gaze −1..1 (x + = toward the nose). Small (non-puppy) eyes slide as a whole; big puppy
//               eyes move the iris inside the white.
//   blink 0..1, wink 0/1 (near eye closes in a happy ^), puppy 0..1 (huge glossy pleading eyes,
//               brows up, pout + trembling lip, tear, begging paw when sitting — `beg` overrides the paw)
//   earPerk 0..1, earLift (rad, + = ears fly back/up; add for sudden moves)
//   mouth       'closed' | 'open' | 'tongue' | 'chew' | 'bark'      chewPh (optional jaw phase)
//   holding     'crust' | null  (T.props.sandwichHalf(..., state 2) gripped crosswise in the jaw). crustScale
//               (default 1 = the size the kids hold it), crustT {dx,dy,tilt,sy,rot} optional grip tweak.
//               A held crust turns 'bark' into 'open' (she can't bark without dropping it).
//   sniff 0..1  nose twitch + curious brows + air lines        sniffPh (optional twitch phase)
// returns {head, nose, mouth, eyes:[near, far]} in the caller's current transform.
//   mouth = the visible mouth line while closed, the centre of the open mouth / the gripped crust otherwise.
'use strict';
(function () {
  const T = window.TOON;
  const D = T.dog = {};

  // ── palette ──
  const C = D.COL = {
    body: '#E7B574', shade: '#D29E5F', spot: '#A0633A', ear: '#6A3B22', earIn: '#C0806A', earFold: '#9A5E45',
    cream: '#FCE7C2', creamSh: '#F0D2A2', tuft: '#FFF6E2', nose: '#2E2227', collar: '#2E9E96', tag: '#FFD23F',
    mouth: '#6E2433', tongue: '#EE7486', iris: '#4B2C1B', irisLt: '#9A6440', tear: '#A9DDF5', blush: '#F28A8A',
    crust: '#C98A45', crustLt: '#F1CF8A', farPaw: '#EFCF9E',
  };
  const LW = 4.4;          // main outline width (local units)
  const MJ = 0.35;         // facial-stroke boil: wiggles on every boil but never changes the feature's shape

  // ── geometry helpers ──
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  // convex hull (monotone chain)
  const hull = pts => {
    const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), lo = [], up = [];
    for (const p of P) { while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length > 1 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    lo.pop(); up.pop(); return lo.concat(up);
  };
  // resample a closed polygon to n evenly spaced points (so boil/brush width are even)
  const resample = (pts, n) => {
    const m = pts.length, L = [0];
    for (let i = 0; i < m; i++) { const a = pts[i], b = pts[(i + 1) % m]; L.push(L[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    const tot = L[m], out = []; let j = 0;
    for (let k = 0; k < n; k++) {
      const d = k / n * tot; while (L[j + 1] < d) j++;
      const a = pts[j], b = pts[(j + 1) % m], u = (d - L[j]) / ((L[j + 1] - L[j]) || 1);
      out.push([T.lerp(a[0], b[0], u), T.lerp(a[1], b[1], u)]);
    }
    return out;
  };
  // soft "bean" outline = hull of circles [[x,y,r],...]
  const blobOf = (circles, n = 64) => resample(hull(circles.flatMap(([x, y, r]) => T.ell(x, y, r, r, 36))), n);
  // tapered tube outline around a spine: wfn(u) = width at u∈[0,1]; round caps optional
  const tube = (sp, wfn, cap0 = true, cap1 = true) => {
    const n = sp.length, Lf = [], Rt = [], ang = [];
    for (let i = 0; i < n; i++) {
      const a = sp[Math.max(0, i - 1)], b = sp[Math.min(n - 1, i + 1)];
      const at = Math.atan2(b[1] - a[1], b[0] - a[0]); ang.push(at);
      const w = wfn(i / (n - 1)) / 2, nx = -Math.sin(at), ny = Math.cos(at);
      Lf.push([sp[i][0] + nx * w, sp[i][1] + ny * w]); Rt.push([sp[i][0] - nx * w, sp[i][1] - ny * w]);
    }
    const out = Lf.slice();
    if (cap1) { const w = wfn(1) / 2, [cx, cy] = sp[n - 1]; for (let k = 1; k < 8; k++) { const a = ang[n - 1] + Math.PI / 2 - k / 8 * Math.PI; out.push([cx + Math.cos(a) * w, cy + Math.sin(a) * w]); } }
    out.push(...Rt.reverse());
    if (cap0) { const w = wfn(0) / 2, [cx, cy] = sp[0]; for (let k = 1; k < 8; k++) { const a = ang[0] - Math.PI / 2 - k / 8 * Math.PI; out.push([cx + Math.cos(a) * w, cy + Math.sin(a) * w]); } }
    return out;
  };
  // resample a closed polygon to evenly spaced points about `step` units apart (at least 10)
  const perim = pts => pts.reduce((s, a, i) => { const b = pts[(i + 1) % pts.length]; return s + Math.hypot(b[0] - a[0], b[1] - a[1]); }, 0);
  const restep = (pts, step) => resample(pts, Math.max(10, Math.round(perim(pts) / step)));
  // boil + smooth: jitter COARSE control points (~step apart), then round them off with 2 Chaikin passes.
  // Few control points + smoothing = a gentle hand wobble that stays smooth (no facets, no fuzz) at 6x.
  const sm = (pts, amp = 1.1, step = 10, it = 2) => T.chaikin(T.J(step ? restep(pts, step) : pts, amp), it);
  // brush ink whose width wobble follows arc length (not point count), so dense and sparse outlines match
  const inkL = (P, lw = LW, col = T.C.INK, closed = true) => {
    const d = [0]; for (let i = 1; i < P.length; i++) d.push(d[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const s = P[0][0] * 0.37 + P[0][1] * 0.21;
    T.ribbon(P, closed, i => lw * (0.74 + 0.52 * T.vnoise(s + d[i] / 15)), col);
  };
  const inked = (pts, fill, lw = LW, amp = 1.1, step = 8) => { const P = sm(pts, amp, step); if (fill) T.fillPts(P, fill); if (lw > 0) inkL(P, lw); return P; };
  const oval = (cx, cy, rx, ry, fill, lw = LW, rot = 0, n = 22) => inked(T.ell(cx, cy, rx, ry, n, rot), fill, lw, 0.9, 0);
  // brush stroke; a 2-point segment is subdivided so the taper has room to show
  const stroke = (pts, ...r) => T.stroke(pts.length === 2 ? Array.from({ length: 5 }, (_, i) => T.lerpA(pts[0], pts[1], i / 4)) : pts, ...r);
  const shift = (pts, dx, dy) => pts.map(([x, y]) => [x + dx, y + dy]);
  // quadratic Bézier q0 → q2 bent toward q1 (9 points)
  const qb = (q0, q1, q2) => Array.from({ length: 9 }, (_, i) => { const u = i / 8, a = (1 - u) * (1 - u), b = 2 * u * (1 - u), d = u * u; return [a * q0[0] + b * q1[0] + d * q2[0], a * q0[1] + b * q1[1] + d * q2[1]]; });
  // run fn with the canvas clipped to polygon pts
  const clipped = (pts, fn) => { const c = T.ctx; c.save(); T.path(pts); c.clip(); fn(); c.restore(); };
  // flat cel shade: shade colour inside pts, then the base colour shifted toward the light (upper-left on screen)
  const celShade = (P, base, shade, L) => clipped(P, () => { T.fillPts(P, shade); T.fillPts(shift(P, L.dx, L.dy), base); });
  const dot = (x, y, r, col) => { const c = T.ctx; c.beginPath(); c.arc(x, y, r, 0, T.TAU); c.fillStyle = col; c.fill(); };
  const soft = (x, y, rx, ry, col, a) => { const c = T.ctx; c.save(); c.globalAlpha *= a; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, T.TAU); c.fillStyle = col; c.fill(); c.restore(); };
  // irregular "potato" patch for the mutt spots (lopsided, never a neat saddle); deterministic from seed
  const potato = (cx, cy, rx, ry, seed, rot = 0, n = 26) => {
    const c = Math.cos(rot), s = Math.sin(rot);
    return Array.from({ length: n }, (_, i) => {
      const a = i / n * T.TAU, k = 1 + 0.17 * Math.sin(2 * a + seed) + 0.1 * Math.sin(3 * a + seed * 2.3) + 0.06 * Math.sin(5 * a + seed * 1.7);
      const x = Math.cos(a) * rx * k, y = Math.sin(a) * ry * k; return [cx + x * c - y * s, cy + x * s + y * c];
    });
  };
  const spot = (cx, cy, rx, ry, seed, rot = 0) => T.fillPts(sm(potato(cx, cy, rx, ry, seed, rot), 0.6, 0, 2), C.spot);
  // popcorn kernel: k round lobes with soft notches between them (a cauliflower edge, not a smooth oval)
  const kernel = (cx, cy, R, k, ph, n = 40) => Array.from({ length: n }, (_, i) => {
    const a = i / n * T.TAU, r = R * (0.72 + 0.28 * Math.pow(Math.abs(Math.sin(k * a / 2 + ph)), 0.5));
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.9];
  });

  // ── limbs ──
  // stubby leg from hip to foot + oval paw. openTop: leg sits IN FRONT of the body, so no ink across its top.
  function leg(hip, foot, w, col, pawCol, openTop = false, bend = 3, skip = 0) {
    const mid = [(hip[0] + foot[0]) / 2 + bend, (hip[1] + foot[1]) / 2], ankle = [foot[0] + 1, foot[1] - 7];
    const sp = T.chaikin([hip, mid, ankle], 2, false);
    if (!openTop) inked(tube(sp, () => w, true, false), col, LW * 0.95, 1.0, 7);
    else openTube(sp, w, col, skip);
    paw(foot[0] + 4, foot[1] - 6, pawCol);
  }
  // tube in front of the body: fill it, ink only its two sides (no seam across the top).
  // skip = spine points left un-inked at the top (when the hip sits deep inside the body)
  function openTube(sp, w, col, skip = 0) {
    const P = T.J(tube(sp, () => w, false, false), 1.1), n = sp.length;
    T.fillPts(P, col);
    inkL(T.chaikin(P.slice(skip, n), 1, false), LW * 0.95, T.C.INK, false);
    inkL(T.chaikin(P.slice(n, 2 * n - skip), 1, false), LW * 0.95, T.C.INK, false);
  }
  function paw(x, y, col, rot = 0) {
    oval(x, y, 12.5, 8, col, LW * 0.9, rot, 18);
    const c = Math.cos(rot), s = Math.sin(rot), R = (dx, dy) => [x + dx * c - dy * s, y + dx * s + dy * c];
    [3, 8].forEach(k => stroke([R(k, 1), R(k + 0.5, 7.5)], 2.2, T.C.INK, 0.8, 0.4));     // toe splits
  }

  // tail: short tapered carrot with a brown tip; wag swings it through an arc with overlapping lag.
  // curl hooks the tip forward — a tight "popcorn" curl reads as a mutt, not a straight hound tail.
  function tail(bx, by, a0, wagPh, amp, len = 46, curl = 0.33) {
    const sw = i => 0.55 * amp * Math.sin(wagPh - i * 0.55);
    const pts = [[bx, by]]; let x = bx, y = by;
    for (let i = 1; i <= 6; i++) { const a = a0 + sw(i) + curl * i; x += Math.cos(a) * len / 6; y += Math.sin(a) * len / 6; pts.push([x, y]); }
    const P = sm(tube(pts, u => T.lerp(16, 9.5, u)), 0.8, 6);
    T.fillPts(P, C.body);
    clipped(P, () => T.blob(pts[6][0], pts[6][1], 12, 12, C.spot, 0, 14, 0, { jitter: 0.6 }));
    inkL(P, LW * 0.95);
    // motion arcs only when wagging hard (callers opt in with wagAmp > .75)
    if (amp > 0.75) {
      const tip = s => { let x = bx, y = by; for (let i = 1; i <= 6; i++) { const a = a0 + s * 0.55 * amp + curl * i; x += Math.cos(a) * len / 6; y += Math.sin(a) * len / 6; } return [x, y]; };
      const c = T.ctx; c.save(); c.globalAlpha *= 0.6;
      [1, -1].forEach(s => {
        const [tx, ty] = tip(s), r = Math.hypot(tx - bx, ty - by) + 8, a = Math.atan2(ty - by, tx - bx);
        stroke(T.arcPts(bx, by, r, r, a + s * 0.08, a + s * 0.5, 6), 2.6, T.C.INK, 1, 0.5);
        stroke(T.arcPts(bx, by, r - 9, r - 9, a + s * 0.12, a + s * 0.4, 5), 2.2, T.C.INK, 1, 0.5);
      });
      c.restore();
    }
    return pts[6];
  }

  // floppy ear: narrow root, wide rounded lobe. a = hang angle at the root (π/2 = straight down),
  // bend = tip curl. o.flip 0..1 turns it inside out in the air (S-curve: the root swings up, the tip
  // flops back down, and the pink lining shows); o.fold 0..1 = the tip flipped out at rest (lining
  // peeks at the tip); o.flut = extra tip flutter (rad); o.root = root width.
  function ear(rx, ry, a, bend, len, col, o = {}) {
    const f = T.clamp(o.flip || 0), n = 12;
    const angAt = u => a + (1 - f) * bend * u * u
      + f * (0.6 + 0.35 * T.smooth(0, 0.3, u) - 1.7 * T.smooth(0.3, 1, u)) + (o.flut || 0) * u * u;
    const sp = [[rx, ry]]; let x = rx, y = ry;
    for (let i = 1; i <= n; i++) { const g = angAt((i - 0.5) / n); x += Math.cos(g) * len / n; y += Math.sin(g) * len / n; sp.push([x, y]); }
    const root = o.root || 11, wf = u => root + (29 - root) * Math.sin(Math.min(1, u * 1.15) * Math.PI * 0.62);
    const P = sm(tube(sp, wf), 1.1, 9);
    T.fillPts(P, col);
    // lining (opaque): most of the lobe, inset ~4 from the edge, when flipped inside-out in the air;
    // at rest only a small flap where the tip curls out along its back edge (the fold line = flap edge)
    const fold = T.clamp(o.fold || 0);
    const nrm = k => { const q0 = sp[Math.max(0, k - 1)], q1 = sp[Math.min(n, k + 1)], at = Math.atan2(q1[1] - q0[1], q1[0] - q0[0]); return [-Math.sin(at), Math.cos(at)]; };
    if (f > 0.3) {
      const i0 = 3, u0 = i0 / n;
      const Q = sm(tube(sp.slice(i0), v => Math.max(4, wf(u0 + (1 - u0) * v) - 8), true, true), 0.7, 6);
      clipped(P, () => { T.fillPts(Q, C.earIn); inkL(Q, LW * 0.5, T.rgba(T.C.INK, 0.6)); });
    } else if (fold > 0.05) {
      const i0 = Math.round(n * (1 - 0.34 * fold)), u0 = i0 / n;
      const sub = sp.slice(i0).map((q, j) => { const [nx, ny] = nrm(i0 + j), w = wf(u0 + (1 - u0) * j / (n - i0)) * 0.34; return [q[0] + nx * w, q[1] + ny * w]; });
      const Q = sm(tube(sub, v => wf(u0 + (1 - u0) * v) * 0.62, true, true), 0.6, 5);
      clipped(P, () => { T.fillPts(Q, C.earFold); inkL(Q, LW * 0.75); });
    }
    inkL(P, LW);
    return P;
  }

  // ── eyes ──
  // p = puppy amount. hl = local x-sign that points to screen-left (highlights stay lit from the upper left
  // whichever way the dog faces). closed 0..1, happy = ^ arc when closed (wink), else a soft ︶ lid.
  function eye(ex, ey, sx, S, closed, happy, which, squint) {
    const p = S.puppy, hl = S.hl, INK = T.C.INK;
    if (closed > 0.55) {
      const w = T.lerp(9, 14, p) * sx;
      if (happy) stroke(T.chaikin([[ex - w, ey + 5], [ex - w * 0.35, ey - 4], [ex + w * 0.35, ey - 4], [ex + w, ey + 5]], 2, false), 5, INK, 0.75, MJ);
      else stroke(T.chaikin([[ex - w, ey], [ex - w * 0.4, ey + 4], [ex + w * 0.4, ey + 4], [ex + w, ey]], 2, false), 4.6, INK, 0.75, MJ);
      return;
    }
    const lid = 1 - closed * 0.9 - squint * 0.4;             // vertical openness
    const [lx, ly] = S.look;
    const srx = T.lerp(7.6, 17.5, p) * sx, sry = T.lerp(11, 20.5, p) * lid;     // sclera (puppy only)
    const irx = T.lerp(7.6, 13, p) * sx, iry = T.lerp(11, 16, p) * lid;         // iris (= the black eye when p = 0)
    const lo = which === 'far' ? 1 - 0.14 * p : 1;                               // far eye: trim the lower rim (clear of the nose)
    const ix = ex + lx * (srx - irx + 2.4), iy = ey + ly * (sry - iry + 2.4) - (1 - lo) * sry * 0.4;
    const drawIris = () => {
      const I = T.chaikin(T.J(T.ell(ix, iy, irx, iry, 18), p > 0.04 ? 0.6 : 0.8), 2);
      T.fillPts(I, T.mix(T.C.INK, C.iris, T.clamp(p * 1.4)));
      if (p > 0.04) {
        clipped(I, () => {
          soft(ix, iy + iry * 0.75, irx * 1.0, iry * 0.62, C.irisLt, 0.95 * p);            // glossy lower glow
          soft(ix, iy - iry * 0.2, irx * 0.62 * sx, iry * 0.55, T.C.INK, 0.9 * p);          // pupil
        });
      }
      // highlights: big soft oval + small round + (puppy) tiny dot and a curved rim reflection
      const k = T.lerp(1, 1.2, p);
      T.blob(ix - hl * irx * 0.34, iy - iry * 0.4, irx * 0.36 * k, iry * 0.3 * k, '#FFFFFF', 0, 16, 0.35 * hl, { jitter: 0.3 });
      dot(ix + hl * irx * 0.42, iy + iry * 0.38, irx * 0.15 * k, '#FFFFFF');
      if (p > 0.2) {
        const c = T.ctx; c.save(); c.globalAlpha *= T.p(p, 0.2, 0.6);
        dot(ix - hl * irx * 0.02, iy - iry * 0.66, irx * 0.08, '#FFFFFF');
        stroke(T.arcPts(ix, iy, irx * 0.72, iry * 0.74, hl > 0 ? 0.15 : Math.PI - 1.05, hl > 0 ? 1.05 : Math.PI - 0.15, 6), 1.8, 'rgba(255,255,255,0.8)', 1, 0);
        c.restore();
      }
    };
    if (p > 0.04) {
      const Sc = sm(T.ell(ex, ey, srx, sry, 26).map(([x, y]) => [x, y > ey ? ey + (y - ey) * lo : y]), 0.7, 6);
      T.fillPts(Sc, T.C.PAPER);
      clipped(Sc, () => {
        soft(ex, ey - sry * 0.62, srx * 1.2, sry * 0.5, '#D8D0E4', 0.6 * p);             // lid shadow
        drawIris();
        if (p > 0.3) stroke(T.arcPts(ex, ey, srx * 0.84, sry * 0.84 * lo, Math.PI * 0.22, Math.PI * 0.78, 8), 3 * p, C.tear, 0.9, 0.3);  // wet lower rim
      });
      inkL(Sc, T.lerp(2.4, 3.8, p));
      stroke(T.arcPts(ex, ey, srx * 1.03, sry * 1.03, Math.PI * 1.06, Math.PI * 1.94, 10), T.lerp(3, 6, p), INK, 0.85, MJ);  // upper lid
    } else drawIris();
    // a welling tear at the lower inner corner of the near eye when fully pleading
    if (which === 'near' && p > 0.75) {
      const a = T.p(p, 0.75, 1), tx = ex + srx * 0.5, ty = ey + sry * 0.95;
      const drop = Array.from({ length: 16 }, (_, i) => { const t = i / 16 * T.TAU, r = 1 - 0.55 * Math.max(0, -Math.sin(t)) ** 3; return [tx + Math.cos(t) * 3.4 * a * r, ty + Math.sin(t) * 4.2 * a - (Math.sin(t) < 0 ? 2.2 * a * (-Math.sin(t)) : 0)]; });
      T.shape(drop, C.tear, 1.8, { jitter: 0.3 });
      dot(tx - hl * 1, ty - 1, 1.1 * a, '#FFFFFF');
    }
  }
  // brow: short tapered, slightly arched ink stroke centred on (ex, cy). innerSide = +1 if the inner end
  // (toward the other eye) is at +x. raise > 0 lifts the inner end (pleading "/"), clamped to ≤ 35°.
  function brow(ex, cy, len, innerSide, raise) {
    const ang = T.clamp(Math.atan2(raise * 1.3, len), -0.5, 0.61);
    const dx = Math.cos(ang) * len / 2, dy = Math.sin(ang) * len / 2;
    const o = [ex - innerSide * dx, cy + dy], i = [ex + innerSide * dx, cy - dy];
    const m = [(o[0] + i[0]) / 2, (o[1] + i[1]) / 2 - 3];
    stroke(T.chaikin([o, m, i], 2, false), 4.6, T.C.INK, 0.9, MJ);
  }

  // the crust: T.props.sandwichHalf(state 2) when props.js is loaded (same prop Léo tosses), else a
  // built-in look-alike. Both are a fat golden arch centred on (x, y).
  function crust(x, y, s, rot) {
    if (T.props && T.props.sandwichHalf) return T.props.sandwichHalf(x, y, s, rot, 2);
    const c = T.ctx; c.save(); c.translate(x, y); c.rotate(rot); c.scale(s, s);
    const out = T.arcPts(0, 12, 36, 38, Math.PI * 1.02, Math.PI * 1.98, 14), inn = T.arcPts(0, 14, 23, 23, Math.PI * 1.96, Math.PI * 1.04, 14);
    const P = sm(out.concat(inn), 0.9, 6);
    T.fillPts(P, C.crust);
    clipped(P, () => T.fillPts(shift(P, -2, -3), C.crustLt));
    inkL(P, LW * 0.95);
    c.restore();
  }

  // ── head ──
  // Head-local frame: origin = head centre, facing +x. Returns anchors in head-local coords.
  function head(S) {
    const p = S.puppy, INK = T.C.INK, hl = S.hl, chJ = S.chewJ, hold = S.holding === 'crust';
    let m = S.mouth; if (hold && m === 'bark') m = 'open';         // can't bark with a crust in the jaw
    // puppy mode drops the muzzle & nose a little so the big eyes have room
    const mx = T.lerp(30, 20, p), my = T.lerp(19, 30, p) + chJ * 0.5;           // muzzle centre (short & round)
    const mrx = T.lerp(26, 25, p), mry = 19;
    const nx = mx + T.lerp(19, 14, p), ny = my - 11 + 3 * p - S.tw * 2.2;       // button nose
    const eN = [T.lerp(-6, -12, p), T.lerp(-13, -9, p)], eF = [T.lerp(25, 23, p), T.lerp(-15, -11, p)];
    // gaze: small eyes have no white to move in, so the whole eye slides with `look` (fades out by p = .3)
    const g = 1 - T.clamp(p / 0.3), [lx, ly] = S.look;
    const gN = [lx * 4.5 * g, T.clamp(ly * 3.5 * g, -3.5, 3.5)], gF = [lx * 3.8 * g, T.clamp(ly * 3.5 * g, -3.5, 1.5)];
    const L = { dx: -3 * S.face, dy: -6 };

    // far ear (behind the skull; peeks out when frontal/puppy, perked or flying)
    const fa = Math.PI / 2 - 0.08 - 0.5 * p - S.earLocal + S.earSwing * 0.85 + S.perk * -1.7;
    ear(T.lerp(18, 34, p), T.lerp(-30, -24, p), fa, -0.15 - S.earBend * 0.5 + S.perk * 1.2, T.lerp(62, 66, p), T.shade(C.ear, 0.12), { root: 11 });

    // skull + cheeks, with lopsided patches: behind the ear, over the far eye, low on the back cheek
    const H = sm(blobOf([[-4, -8, 44], [-15, 12, 36], [16, 14, 35]]), 1.0, 12);
    T.fillPts(H, C.body);
    clipped(H, () => {
      T.fillPts(H, C.shade); T.fillPts(shift(H, L.dx, L.dy), C.body);
      spot(-31, -29, 19, 15, 1.3, -0.5);
      spot(T.lerp(36, 33, p), T.lerp(-27, -22, p), 13, 11, 4.1, 0.5);
      spot(-44, 21, 10, 8, 2.2);
    });
    inkL(H, LW);
    // cheek fluff: a few fur points breaking the jaw line under the back of the head
    {
      // two soft tufts sweeping back (tips trail toward the ear), in the jaw's shade colour
      const Z = T.chaikin(T.J([[-4, 47], [-9, 51], [-15, 56], [-13, 50], [-17, 53], [-24, 57], [-21, 50], [-25, 45]], 0.4), 1, false);
      T.fillPts(Z.concat([[-25, 40], [-4, 40]]), C.shade);
      inkL(Z, LW * 0.85, INK, false);
    }
    // popcorn tuft: lumpy cream kernels sitting ON the skull line (drawn in front of it), back to front
    [[-21, -49, 7.5, 3, 0.4], [12, -50, 7.5, 3, 1.1], [-12, -58, 8.5, 4, 0.2], [3, -59, 9, 4, 0.9], [-4, -50, 8, 3, 1.7]].forEach(([x, y, r, k, ph]) => {
      const K = sm(kernel(x, y - S.perk * 2, r, k, ph), 0.5, 0, 1);
      T.fillPts(K, C.creamSh);
      clipped(K, () => T.fillPts(shift(K, L.dx * 0.5, -2.2), C.tuft));
      inkL(K, LW * 0.8);
    });

    // mouth interior (under the muzzle) for open / bark / tongue / holding (reach can force it open)
    let open = { open: 13, tongue: 12, bark: 25 }[m] || 0;
    if (!hold) open = Math.max(open, S.reachOpen);
    const grip = hold ? (open > 0 ? 8 : 3) : 0;                    // jaw drop while gripping the crust
    if (hold) open = grip + 2;
    const mouthC = [mx + 4, my + 19 + open * 0.5];
    if (open > 0) {
      const w0 = open > 20 ? 23 : 19;
      const top = T.arcPts(mx + 4, my + 10, w0, 8, Math.PI, T.TAU, 8), bot = T.arcPts(mx + 4, my + 12, w0 - 1, 9 + open, 0, Math.PI, 12);
      const M = sm(top.concat(bot), 0.9, 6);
      T.fillPts(M, C.mouth);
      clipped(M, () => {
        T.blob(mx + 1, my + 21 + open, w0 * 0.75, 11, C.tongue, 0, 16, 0, { jitter: 0.8 });
        soft(mx + 4, my + 14, w0 * 0.8, 6, '#3A1420', 0.55);
      });
      inkL(M, LW * 0.95);
    }
    // chewing: the back cheek puffs out (outer arc only, so it reads as a bulge, not a second chin)
    if (m === 'chew') {
      const cx = mx - 24, cy = my + 2 + chJ * 0.3, r = 12 + chJ * 0.4;
      soft(cx - 2, cy + 5, r * 0.8, r * 0.5, C.shade, 0.6);
      stroke(T.arcPts(cx, cy, r + 1, r, Math.PI * 0.5, Math.PI * 1.35, 10), LW * 0.8, INK, 0.8, MJ);
    }
    // held crust: gripped crosswise like a bone, drawn BEFORE the muzzle so the upper lip overlaps its
    // middle (the chin closes over it below). The arch is flipped to "∪" and squashed flat (it lies across
    // the jaw, seen from the side), tipped so one end pokes out past the nose and the other runs to the cheek.
    if (hold) {
      const c = T.ctx, K = Object.assign({ dx: 2, dy: -2, tilt: -0.2, sy: 0.36, rot: Math.PI }, S.crustT); c.save(); c.translate(mx + K.dx, my + mry + K.dy + grip * 0.6); c.rotate(K.tilt); c.scale(1, K.sy); c.rotate(K.rot);
      crust(0, 0, S.crustScale, 0); c.restore();
    }

    // muzzle (cream), with a soft shade along its underside
    const Mz = sm(T.ell(mx, my, mrx, mry + chJ * 0.4, 32), 1.0, 8);
    T.fillPts(Mz, C.cream);
    clipped(Mz, () => soft(mx + 4, my + mry + 1, mrx * 1.1, 8, C.shade, 0.35));
    inkL(Mz, LW * 0.95);
    // lower jaw / chin closing over the crust's middle
    if (hold) {
      const Lp = sm(T.ell(mx + 3, my + mry + 2 + grip, 11, 5.5, 22), 0.5, 0, 2);
      T.fillPts(Lp, C.cream);
      clipped(Lp, () => soft(mx + 3, my + mry + 7 + grip, 11, 3.5, C.shade, 0.45));
      inkL(Lp, LW * 0.85);
    }
    [[-9, -6], [-3, -2], [-13, -1]].forEach(([dx, dy]) => dot(mx + dx, my + dy, 1.6, 'rgba(106,59,34,0.8)'));   // whisker dots
    if (m === 'bark') [[mx - 5, 1], [mx + 15, 1]].forEach(([x]) => T.shape([[x - 4, my + mry - 2], [x + 4, my + mry - 2], [x + 0.5, my + mry + 6]], '#FFFFFF', 2.2, { jitter: 0.4 }));

    // blush (appeal): puppy, wink, chewing
    const blush = Math.max(p * 0.9, S.wink ? 0.9 : 0, m === 'chew' ? 0.5 : 0);
    if (blush > 0) { soft(eN[0] - 13, eN[1] + 27, 11, 6.5, C.blush, 0.5 * blush); soft(eF[0] + 17, eF[1] + 28, 8, 5, C.blush, 0.4 * blush); }

    // eyes + brows (sniff squints only the near eye a touch; bark squints both)
    const EN = [eN[0] + gN[0], eN[1] + gN[1]], EF = [eF[0] + gF[0], eF[1] + gF[1]];
    const bark = m === 'bark' ? 1 : 0;
    eye(EN[0], EN[1], 1, S, Math.max(S.blink, S.wink), S.wink > 0, 'near', bark * 0.25 + S.sniff * 0.45);
    eye(EF[0], EF[1], 0.84, S, S.blink, false, 'far', bark * 0.25);
    const lift = 2 + 1.5 * p + bark * 4 + S.perk * 3 + S.sniff * 1.5;
    const raise = 8 * p + S.sniff * 1.5;
    // brow height above each eye, kept at least 6 units inside the skull outline (brows follow the gaze a bit)
    const bY = (ex, ey) => Math.max(ey - T.lerp(11, 20.5, p) - T.lerp(7, 2, p), -8 - Math.sqrt(Math.max(0, 44 * 44 - (ex + 4) ** 2)) + 6 + lift);
    const rN = S.wink ? -3 : raise, rF = raise + S.sniff * 2;     // sniff: far brow cocks up = curious
    brow(EN[0] + 1, bY(EN[0], EN[1] - gN[1] * 0.4) + S.wink * 5 - (lift - S.wink * 2) - 0.35 * rN, T.lerp(13, 17, p), 1, rN);
    brow(EF[0] - 4 * p, bY(EF[0], EF[1] - gF[1] * 0.4) + 2 * p - lift - 0.35 * rF, T.lerp(10, 11.5, p), -1, rF);
    if (S.sniff > 0.2) {            // sniff: scrunch wrinkles on the muzzle bridge
      stroke([[mx - 5, my - 16], [mx + 1, my - 18.5]], 2.4, INK, 0.9, MJ); stroke([[mx, my - 12], [mx + 6, my - 14.5]], 2.2, INK, 0.9, MJ);
    }

    // nose: round-cornered triangle with a highlight; twitches (squash + hop) while sniffing
    const nsx = 1 + 0.14 * S.tw, nsy = 1 - 0.12 * S.tw, nr = T.lerp(12.5, 13, p);
    const NP = T.ell(0, 0, nr, nr * 0.76, 24).map(([x, y]) => [nx + x * nsx * (y > 0 ? 1 - 0.38 * y / (nr * 0.76) : 1), ny + y * nsy]);
    inked(NP, C.nose, LW * 0.8, 0.7, 5);
    T.blob(nx - hl * 4, ny - 4, 4.6, 2.5, 'rgba(255,255,255,0.85)', 0, 12, -0.25 * hl, { jitter: 0.3 });
    if (S.sniff > 0.05) {           // inhaled air: little strokes streaming into the nose
      const c = T.ctx; c.save(); c.globalAlpha *= T.clamp(S.sniff * 1.3) * 0.8;
      [[-0.35, 20], [0.05, 26], [0.45, 20]].forEach(([a, r]) => {
        const d = r + 4 + (S.tw > 0 ? 3 : 0), ca = Math.cos(a), sa = Math.sin(a);
        stroke([[nx + ca * d, ny + sa * d], [nx + ca * (d + 11), ny + sa * (d + 11) - 2]], 2.4, INK, 1, 0.4);
      });
      c.restore();
    }

    // closed mouth: one philtrum stroke + ONE continuous "ω" line (back corner → philtrum base → front
    // corner). In puppy mode it becomes a small pout with a single trembling lower lip.
    const ch = m === 'chew' ? chJ : 0;
    const py = ny + T.lerp(7, 6, p), jy = py + T.lerp(8, 6, p) + ch * 0.5;
    if (open === 0) {
      stroke([[nx - 1, py], [nx - 2, jy]], 3.4, INK, 0.5, MJ);
      if (p < 0.5) {
        const s0 = (1 - p * 2) * (m === 'chew' ? 0.5 : 1);        // smile amount
        const line = [[mx - 17, my + 4 - 6 * s0 + ch], [mx - 8, jy + 3 + 4 * s0 + ch], [nx - 8, jy + 2 + 2 * s0], [nx - 2, jy], [nx + 3, jy + 3], [nx + 8, jy - 1 - 3 * s0]];
        stroke(T.chaikin(line, 2, false), 3.6, INK, 0.7, MJ);
      } else {
        stroke(qb([nx - 13, jy + 6], [nx - 3, jy - 1.5], [nx + 7, jy + 5]), 3.6, INK, 0.75, MJ);          // pout "︵"
        stroke(T.J(qb([nx - 10, jy + 6.5], [nx - 3, jy + 12], [nx + 4, jy + 6]), 0.5 * p), 3, INK, 0.85, MJ);  // quivering lip "︶"
      }
    }
    if (m === 'tongue' && !hold) {  // tongue lolling out of the side
      inked(tube(T.chaikin([[mx - 1, my + 20], [mx + 2, my + 30], [mx + 8, my + 38]], 1, false), u => T.lerp(15, 17, u)), C.tongue, LW * 0.85, 0.9, 6);
      stroke([[mx + 2, my + 24], [mx + 3.5, my + 35]], 2.2, T.shade(C.tongue, 0.35), 0.9, 0.3);
    }
    if (m === 'chew') for (let i = 0; i < 3; i++) { const h = T.hash(T.BOIL * 3.1 + i); dot(mx - 12 + i * 12 + h * 4, my + 27 + h * 12 + i * 3, 2 + h, C.crust); }

    // near ear, hanging over the back of the skull (root tucked inside the skull line); tip flips out
    const na = Math.PI / 2 + 0.16 - S.earLocal + S.earSwing + S.perk * 1.9 - p * 0.1;
    ear(T.lerp(-32, -34, p), T.lerp(-24, -20, p), na, 0.45 + S.earBend - S.perk * 1.5, 70, C.ear,
      { flip: S.earFlip, flut: S.earFlut, fold: 1 - S.perk, root: 11 });

    return { nose: [nx, ny], mouth: open === 0 ? [nx - 2, jy + 2] : hold ? [mx + 5, my + mry + 1 + grip * 0.6] : mouthC, eyes: [EN, EF] };
  }

  // ── collar ── returns the point on the arc where the tag hangs (tagU 0..1 along the arc)
  function collar(cx, cy, r, a0, a1, tagU) {
    const sp = T.arcPts(cx, cy, r, r * 0.75, a0, a1, 10);
    inked(tube(sp, () => 9, true, true), C.collar, LW * 0.8, 0.9, 5);
    const a = T.lerp(a0, a1, tagU); return [cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.75];
  }
  // gold tag hanging from (x, y) along direction ang (π/2 = straight down)
  function tag(x, y, ang) {
    const c = Math.cos(ang), s = Math.sin(ang), at = d => [x + c * d, y + s * d];
    stroke([at(2), at(7)], 2.5, T.C.INK, 0, 0.3);
    const [tx, ty] = at(12);
    oval(tx, ty, 6.5, 6.5, C.tag, LW * 0.7, 0, 14);
    dot(tx - 2, ty - 2, 1.6, '#FFFFFF');
  }

  // ── main ──
  D.draw = function (pose = {}) {
    const P = Object.assign({
      x: 0, y: 0, face: 1, scale: 1, mode: 'sit', walk: 0, wag: 0, wagAmp: 0.5, tilt: 0, look: null, blink: 0,
      puppy: 0, wink: 0, earPerk: 0, mouth: 'closed', holding: null, sniff: 0, sq: 0, reach: 0,
      lift: 0, jumpU: 0.5, beg: null, crustScale: 1, sniffPh: null, chewPh: null, earLift: 0,
    }, pose);
    const c = T.ctx, face = P.face < 0 ? -1 : 1, puppy = T.clamp(P.puppy), reach = T.clamp(P.reach);
    const M0 = c.getTransform().inverse();
    const toCaller = (x, y) => { const q = M0.multiply(c.getTransform()).transformPoint({ x, y }); return [q.x, q.y]; };

    // twitch sources (alternate each boil tick unless the caller drives them)
    const tick = P.sniffPh != null ? Math.sin(P.sniffPh) : (T.BOIL % 2 ? 1 : -1);
    const tw = T.clamp(P.sniff) * tick;
    const chewJ = P.mouth === 'chew' ? 2.5 * (P.chewPh != null ? Math.sin(P.chewPh) : (T.BOIL % 2 ? 1 : -1)) : 0;

    c.save();
    c.translate(P.x, P.y); c.scale(face * P.scale, P.scale);
    // contact shadow (shrinks & fades with height)
    const air = T.clamp(P.lift / 220);
    T.shadow(-2, 2, (P.mode === 'sit' ? 64 : 76) * (1 - 0.45 * air), 11 * (1 - 0.45 * air), 1 - 0.55 * air);
    c.translate(0, -P.lift);
    c.scale(1 + 0.7 * P.sq, 1 - P.sq);            // squash (+) / stretch (−) about the feet

    const L = { dx: -3 * face, dy: -6 };
    const legW = 17, far = T.shade(C.body, 0.13), farPaw = C.farPaw;
    const wag = P.wag, amp = P.wagAmp;
    let headC, headRot = P.tilt, bodyRot = 0, earSwing = 0, earBend = 0, earFlip = 0, earFlut = 0, neck, collarArc, tagU, tagAng = Math.PI / 2;

    if (P.mode === 'sit') {
      const beg = T.clamp(P.beg != null ? P.beg : puppy);
      // tail sweeping on the ground behind, tip curling up
      tail(-42, -14, Math.PI + 0.3, wag, amp * 0.9, 44, 0.3);
      // far front leg + far back paw
      leg([27, -58], [32, 0], legW, far, farPaw, false, 2);
      paw(22, -5, farPaw);
      // body: rump on the ground, chest up (a pear)
      const B = sm(blobOf([[-16, -34, 33], [-4, -52, 28], [10, -72, 26]]), 1.1, 12);
      celShade(B, C.body, C.shade, L);
      clipped(B, () => {
        spot(-22, -66, 16, 11, 0.7, 0.6);                              // lopsided patch high on the back
        T.blob(21, -58, 13, 28, C.cream, 0, 18, -0.15, { jitter: 0.8 });      // chest bib
      });
      inkL(B, LW);
      // near haunch + back paw
      paw(8, -6, C.cream);
      const Hh = sm(T.ell(-14, -29, 25, 23, 32, -0.3), 1.0, 10);
      clipped(Hh, () => { T.fillPts(Hh, C.shade); T.fillPts(shift(Hh, L.dx, L.dy), C.body); spot(-27, -25, 9, 7, 3.3, 0.9); });
      inkL(Hh, LW);
      // near front leg: straight, or lifted in a begging paw (elbow bent, paw dangling)
      if (beg > 0.02) {
        const el = T.lerpA([19, -30], [36, -38], beg), ft = T.lerpA([20, 0], [40, -24], beg);
        openTube(T.chaikin([[16, -58], el, ft], 2, false), legW, C.body);
        paw(ft[0] + 3, ft[1] + 2, C.cream, beg * 0.9);
      } else leg([16, -58], [18, 0], legW, C.body, C.cream, true, 1);
      headC = [24, -128]; neck = [16, -90]; collarArc = [0.15, 2.3]; tagU = 0.62;
      earSwing = 0.03 * Math.sin(wag * 0.5) * amp;
    } else {
      // walk (trot) & jump share the horizontal body; jump rotates it around the belly
      const ph = P.walk || 0, walking = P.mode === 'walk';
      const bob = walking ? -2 - 2 * Math.cos(2 * ph) : 0;
      const hb = walking ? -2 - 2 * Math.cos(2 * ph - 0.9) : 0;
      let feet, u = T.clamp(P.jumpU);
      const sh = { nF: [24, -44 + bob], fF: [31, -46 + bob], nB: [-30, -44 + bob], fB: [-21, -46 + bob] };
      if (walking) {
        // trot: diagonal pairs move together. stance slides back, swing lifts forward.
        const foot = (base, off) => {
          const q = ((ph + off) / T.TAU % 1 + 1) % 1, st = 15;
          if (q < 0.5) return [base + T.lerp(st, -st, q * 2), 0];
          const v = (q - 0.5) * 2; return [base + T.lerp(-st, st, T.E.inOut(v)), -11 * Math.sin(Math.PI * v)];
        };
        feet = { nF: foot(26, 0), fB: foot(-21, 0.05), fF: foot(33, Math.PI), nB: foot(-28, Math.PI + 0.05) };
        earSwing = 0.32 + 0.18 * Math.sin(2 * ph - 1.4); earBend = 0.25 + 0.3 * Math.sin(2 * ph - 2.3);
        tagAng = Math.PI / 2 + 0.25 * Math.sin(2 * ph - 1.2);
      } else {
        // jump: 0 take-off (stretched up) → 0.5 apex (tucked) → 1 landing reach
        const rise = 1 - u * 2;                                    // +1 rising … −1 falling
        const tuck = Math.sin(Math.PI * u);
        feet = {
          nF: T.lerpA([44, -28], [34, 4], T.clamp(-rise)), fF: T.lerpA([50, -32], [42, 2], T.clamp(-rise)),
          // hind legs trail back and tuck, the near one behind the rump (in front of the body), the far one under it
          nB: T.lerpA([-62, -4], [-70, -34], tuck), fB: T.lerpA([-50, -2], [-52, -22], tuck),
        };
        // ears trail back while rising, flip up inside-out while falling (capped: an ear, not a horn)
        earSwing = rise > 0 ? 0.7 + 0.3 * rise : Math.min(1.1, 0.7 - rise * 0.75); earBend = rise > 0 ? 0.5 : 0.5 - rise * 0.5;
        earFlip = T.clamp(-rise * 1.2); earFlut = Math.sin(u * 20) * 0.15;
      }
      c.save();
      if (!walking) {
        const ang = T.lerp(-0.55, 0.3, T.E.inOut(u)); bodyRot = ang;
        c.translate(0, -56); c.rotate(ang); c.translate(0, 56);
        headRot += -ang * 0.4 + T.lerp(-0.25, 0.05, u);
        tagAng = Math.PI / 2 - ang + 0.35 * (1 - 2 * u);            // hangs toward the ground, trailing the motion
      } else { c.translate(0, -56); c.rotate(0.03 * Math.sin(2 * ph)); c.translate(0, 56); }
      tail(-50, -70 + bob, walking ? -2.3 : Math.PI + 0.15, wag, amp, 46, walking ? 0.36 : 0.2);
      leg(sh.fF, feet.fF, legW, far, farPaw, false, walking ? 3 : -4);
      leg(sh.fB, feet.fB, legW, far, farPaw, false, walking ? -3 : 4);
      if (walking) leg(sh.nB, feet.nB, legW, C.body, C.cream, false, -3);
      leg(sh.nF, feet.nF, legW, C.body, C.cream, false, walking ? 3 : -4);
      const stretch = walking ? 1 : 1.02 + 0.06 * T.clamp(1 - u * 2.2);     // jump: a bit long at take-off
      const B = sm(blobOf([[26 * stretch, -62 + bob, 29], [-2, -55 + bob, 27], [-30 * stretch, -59 + bob, 26]]), 1.1, 12);
      celShade(B, C.body, C.shade, L);
      clipped(B, () => {
        spot(6, -84 + bob, 14, 9, 2.6, 0.15);                        // shoulder patch
        spot(-40, -70 + bob, 11, 12, 5.2, -0.4);                     // rump patch (smaller, off-centre)
        T.blob(10, -40 + bob, 34, 10, C.cream, 0, 18, 0, { jitter: 0.8 });            // belly
        T.blob(46, -60 + bob, 10, 24, C.cream, 0, 16, -0.3, { jitter: 0.8 });         // chest bib
      });
      inkL(B, LW);
      if (!walking) leg(sh.nB, feet.nB, legW, C.body, C.cream, true, 4, 3);  // near hind leg in front, trailing
      headC = [60, -114 + hb + (walking ? 0 : 6)]; neck = [42, -80 + bob]; collarArc = [-0.2, 2.2]; tagU = 0.8;
      if (P.mode === 'jump') {           // draw head inside the rotated frame
        drawHeadGroup(); c.restore();
        c.restore(); return result;
      }
      c.restore();
    }
    drawHeadGroup();
    c.restore();
    return result;

    var result;
    function drawHeadGroup() {
      const tp = collar(neck[0], neck[1], 26, collarArc[0], collarArc[1], tagU);
      const sitting = P.mode === 'sit';
      if (sitting) tag(tp[0], tp[1], tagAng);     // on the chest, under the chin
      let rot = headRot - 0.4 * reach;
      if (P.mouth === 'bark' && !P.holding) rot -= 0.14;
      rot += T.clamp(P.sniff) * 0.12;
      c.save();
      c.translate(headC[0], headC[1]); c.rotate(rot);
      const look = P.look || (P.mode === 'jump' || reach > 0.2 ? [0.6, -0.6 - 0.4 * reach] : puppy > 0.1 ? [0.15 * puppy, -0.45 * puppy] : [0, 0]);
      const S = {
        face, hl: -face, puppy, mouth: P.mouth, wink: P.wink ? 1 : 0, blink: T.clamp(P.blink), look,
        perk: T.clamp(P.earPerk + (P.mouth === 'bark' ? 0.25 : 0)), sniff: T.clamp(P.sniff), tw, chewJ,
        earLocal: (rot + bodyRot) * 0.85, earSwing: earSwing + P.earLift - (P.mouth === 'bark' ? 0.25 : 0), earBend, earFlip, earFlut,
        holding: P.holding, crustScale: P.crustScale, crustT: P.crustT, reachOpen: P.mouth === 'closed' ? Math.round(16 * reach) : 0,
      };
      const a = head(S);
      result = {
        head: toCaller(0, 0), nose: toCaller(a.nose[0], a.nose[1]), mouth: toCaller(a.mouth[0], a.mouth[1]),
        eyes: [toCaller(a.eyes[0][0], a.eyes[0][1]), toCaller(a.eyes[1][0], a.eyes[1][1])],
      };
      c.restore();
      if (!sitting) tag(tp[0], tp[1], tagAng);    // horizontal body: hang it from the collar end below the head
    }
  };
})();
