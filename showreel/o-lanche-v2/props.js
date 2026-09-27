// props.js — hand props & cartoon FX for "O Lanche" v2.  Loaded after core.js; exposes T.props.
// Every function draws with T.ctx in the CURRENT transform, centred on (x, y) in world units, and
// uses the core primitives so props boil with the characters (they live on the character cels).
//
//   sandwichWhole(x,y,s,rot)                 square sandwich, pre-cut diagonal (bread/lettuce/tomato/cheese)
//   sandwichHalf(x,y,s,rot,state)            triangle half, point up. state 0 full / 1 bitten / 2 crust only
//   book(x,y,s,rot,open)                     open 0 closed (front cover) … 1 open spread;  open < 0 = lying flat (edge view)
//   lunchbox(x,y,s)                          red lunchbox with handle
//   crumbs(x,y,t0,t,seed)                    crumbs spray from (x,y) starting at t0 (ballistic, ~0.7 s)
//   rainCloud(x,y,s,t)                       grumpy little rain cloud + falling drops (drops fall ~130*s below)
//   poof(x,y,s,u)                            smoke puff, u 0..1 (nothing drawn outside 0<u<1)
//   sparkleBurst(x,y,u,n=8,R=130,color)      ring of 4-point stars flying out, u 0..1
//   hearts(x,y,u)                            three hearts popping and floating up, u 0..1
//   burst(x,y,s,label)                       comic starburst ("Arf!")
//   speechBubble(spec) → {x0,y0,w,h}         spec = {x, y, w?, text | lines, visibleChars?, tail:[x,y], scale?,
//                                               px? (font, 54), style? 'talk'|'shout', align? 'left'|'center'}
//                                            (x,y) = bubble centre; scale pops about the tail tip.
//   motionLines(pts,u)                       speed lines trailing a path pts (oldest → newest), u = strength 0..1
'use strict';
(function () {
  const T = window.TOON, C = T.C, INK = C.INK, TAU = T.TAU;
  const P = T.props = {};

  // ── local palette ──
  const K = {
    crumb: '#F7E1A6', crumbShade: '#EACB85', crust: '#D39149', crustShade: '#B8763A', crustHi: '#E6AD68',
    lettuce: '#7CC35A', lettuceShade: '#5EA546', tomato: '#E6533C', tomatoShade: '#C23F2E', cheese: '#FFD04A', cheeseShade: '#EDB42E',
    cover: '#D9453B', coverShade: '#B3352D', coverHi: '#EC6A5C', page: C.PAPER, pageEdge: '#E9DFC9', textLine: '#BDB3A6',
    box: '#E85D3F', boxShade: '#C4452C', boxHi: '#F58A6C', latch: '#FFD23F',
    cloud: '#A9B2C6', cloudShade: '#8C96AE', cloudHi: '#C9D0DE', drop: '#6FA0E6', dropHi: '#CFE2FF',
    smoke: C.PAPER, smokeShade: '#E3DAE8',
  };
  P.COLORS = K;

  // ── helpers ──
  const c = () => T.ctx;
  function begin(x, y, s = 1, rot = 0) { const g = c(); g.save(); g.translate(x, y); if (rot) g.rotate(rot); if (s !== 1) g.scale(s, s); return g; }
  // clip to a polygon and run fn (for in-shape shading)
  function clipped(pts, fn) { const g = c(); g.save(); T.path(pts); g.clip(); fn(); g.restore(); }
  // insert points so no edge is longer than `step` (lets bites/wobbles act smoothly)
  function resample(pts, step = 5, closed = true) {
    const out = [], n = pts.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = pts[i], b = pts[(i + 1) % n], d = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.ceil(d / step));
      for (let j = 0; j < k; j++) out.push([T.lerp(a[0], b[0], j / k), T.lerp(a[1], b[1], j / k)]);
    }
    if (!closed) out.push(pts[n - 1]);
    return out;
  }
  // rounded polygon: resample then corner-cut
  const round = (pts, step = 6, it = 2) => T.chaikin(resample(pts, step), it);
  // bite: points inside a bite circle [cx,cy,r] slide toward the shape centre (ox,oy) until they exit it
  function biteOut(pts, bites, dr = 0, ox = 0, oy = 4) {
    return pts.map(p => {
      let [x, y] = p;
      for (let pass = 0; pass < 2; pass++) for (const [bx, by, r0] of bites) {
        const r = r0 + dr, fx = x - bx, fy = y - by;
        if (fx * fx + fy * fy >= r * r) continue;
        let dx = ox - x, dy = oy - y; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
        const b = fx * dx + fy * dy, t = -b + Math.sqrt(Math.max(0, b * b - (fx * fx + fy * fy - r * r)));
        x += dx * t; y += dy * t;
      }
      return [x, y];
    });
  }
  // scale a polygon about a point
  const scaleAbout = (pts, k, cx = 0, cy = 0, ky = k) => pts.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * ky]);
  const shift = (pts, dx, dy) => pts.map(([x, y]) => [x + dx, y + dy]);
  // union of several shapes with ONE merged outline: ink all (double width) then fill all
  function union(list, fill, lw = 4.5, jit = T.JA) {
    const J = list.map(p => T.J(p, jit));
    J.forEach(p => T.ink(p, lw * 2));
    J.forEach(p => T.fillPts(p, fill));
    return J;
  }
  const dot = (x, y, r, col) => { const g = c(); g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); };
  const oval = (x, y, rx, ry, col, rot = 0) => { const g = c(); g.fillStyle = col; g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, TAU); g.fill(); };
  const star5 = (x, y, r0, r1) => Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + i / 10 * TAU, r = i % 2 ? r1 : r0; return [x + Math.cos(a) * r, y + Math.sin(a) * r]; });

  // ─────────────────────────── sandwich ───────────────────────────
  // coarse polygon → boil-jitter → corner-rounded (smooth brush edge, never hairy)
  const soft = (pts, amp = 1, rad = 7) => T.chaikin(T.J(resample(pts, rad * 2), amp), 2);
  // lettuce ruffle: offset a (dense) outline outward in little scallops of `period` px
  function ruffle(pts, amp, period, cx = 0, cy = 0, phase = 0) {
    let s = phase;
    return pts.map(([x, y], i) => {
      if (i) s += Math.hypot(x - pts[i - 1][0], y - pts[i - 1][1]);
      const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1, w = amp * (0.25 + 0.75 * Math.abs(Math.sin(Math.PI * s / period)));
      return [x + dx / d * w, y + dy / d * w];
    });
  }
  // bread slice face: crust band + crumb interior with pores, soft shade lower-right, highlight upper-left
  function breadFace(O, I, pores, inside) {
    T.fillPts(O, K.crust);
    clipped(O, () => {
      T.fillPts(shift(O, 4, 5), K.crustShade);                      // crust darker on the lower-right
      T.fillPts(shift(O, 2.5, 3), K.crust);
      T.fillPts(shift(O, -3, -3.5).map(([x, y]) => [x * 0.97, y * 0.97]), K.crustHi);   // lit rim upper-left
      T.fillPts(O.map(([x, y]) => [x * 0.95 + 1, y * 0.95 + 1]), K.crust);
      T.fillPts(I, K.crumb);
      clipped(I, () => { T.fillPts(shift(I, 5, 6), K.crumbShade); T.fillPts(shift(I, 2.5, 3), K.crumb); });
      pores.forEach(([x, y, r]) => oval(x, y, r, r * 0.7, K.crumbShade, 0.4));
      if (inside) inside();
    });
    T.ink(O, 4.2);
    return O;
  }
  // fillings band behind the bread: ruffled lettuce with its own shading
  function lettuce(base, amp, period) {
    const L = ruffle(T.chaikin(resample(base, 4), 1), amp, period);
    T.fillPts(L, K.lettuce);
    clipped(L, () => { T.fillPts(shift(L, 2.5, 4), K.lettuceShade); });
    T.ink(L, 3.4);
    return L;
  }
  const HALF_TRI = [[0, -34], [39, 22], [-39, 22]];

  P.sandwichWhole = (x, y, s = 1, rot = 0) => {
    begin(x, y, s, rot);
    const sq = [[-38, -34], [38, -34], [38, 34], [-38, 34]];
    T.shape(soft(shift(sq, 2, 8), 1, 9), K.crustShade, 2.6, { jitter: 0 });               // back slice
    T.blob(-28, 33, 18, 9, K.tomato, 3.6, 18, 0.15);                                    // tomato slices peeking
    T.blob(37, -22, 9, 15, K.tomato, 3.6, 16, 0.1);
    lettuce(T.J(scaleAbout(sq, 1.05, 0, 3), 1), 4.5, 10);
    T.shape([[16, 32], [46, 36], [40, 44], [37, 53], [31, 45], [21, 41]], K.cheese, 3.6, { jitter: 0.7 });  // cheese corner + drip
    breadFace(soft(sq, 1, 9), soft(scaleAbout(sq, 0.8), 0.8, 7), [[-14, -12, 2.2], [10, -16, 1.6], [-4, 8, 2], [16, 12, 1.8], [-20, 14, 1.5]]);
    // the pre-cut diagonal (where Bia snaps it)
    T.stroke([[-30, 28], [0, 0], [30, -28]], 3.2, K.crumbShade, 0.4, 0.8);
    T.stroke([[-22, 22], [20, -18]], 2, T.rgba(C.PAPER, 0.8), 0.9, 0.6);
    c().restore();
  };

  // bite circles on the apex of a half (state 1): one big concave bite with tooth scallops
  const BITES = [[-15, -21, 12], [1, -28, 15], [17, -18, 11.5]];

  P.sandwichHalf = (x, y, s = 1, rot = 0, state = 0) => {
    begin(x, y, s, rot);
    if (state >= 2) { crust(); c().restore(); return; }
    const bites = state === 1 ? BITES : [];
    const fix = (pts, dr = 0) => bites.length ? biteOut(resample(pts, 3), bites, dr) : pts;
    T.shape(fix(soft(shift(HALF_TRI, 2, 8), 1, 6)), K.crustShade, 2.4, { jitter: 0 });   // back slice
    T.blob(-22, 26, 17, 7.5, K.tomato, 3.4, 18, -0.08);                                // tomato peeking lower-left
    lettuce(fix(T.J(scaleAbout(HALF_TRI, 1.07, 0, 5), 1), -3.5), 4, 9);
    T.shape([[12, 22], [45, 22], [39, 31], [36, 41], [29, 32], [18, 30]], K.cheese, 3.4, { jitter: 0.7 });
    const O = fix(soft(HALF_TRI, 1, 6)), I = fix(soft([[0, -21], [27, 15], [-27, 15]], 0.7, 5));
    // bitten: the bite edge shows soft crumb (no crust) with a torn, shaded lip
    const biteEdge = () => {
      BITES.forEach(([bx, by, r]) => { const g = c(); g.fillStyle = K.crumb; g.beginPath(); g.arc(bx, by, r + 6, 0, TAU); g.fill(); });
      BITES.forEach(([bx, by, r]) => { const g = c(); g.strokeStyle = K.crumbShade; g.lineWidth = 3; g.beginPath(); g.arc(bx, by, r + 3, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke(); });
      [[-9, -6], [8, -8], [0, -10], [-3, -3]].forEach(([bx, by]) => dot(bx, by, 1.3, K.crumbShade));
    };
    breadFace(O, I, [[-8, 2, 2], [9, -6, 1.6], [4, 10, 1.8], [-14, 12, 1.4]], state === 1 ? biteEdge : null);
    c().restore();
  };
  // state 2: the leftover crust — a fat golden arch, nibbled along the inside, ragged ends
  function crust() {
    const outer = T.arcPts(0, 12, 36, 38, Math.PI * 1.02, Math.PI * 1.98, 12);
    const inner = T.arcPts(0, 14, 23, 23, Math.PI * 1.96, Math.PI * 1.04, 12)
      .map(([x, y], i) => [x, y + 2 * Math.abs(Math.sin(i * 1.6))]);                   // tooth scallops
    const B = T.chaikin(T.J(outer.concat([[33, 18], [29, 15], [30, 20]], inner, [[-27, 19], [-31, 15], [-35, 20]]), 0.9), 2);
    T.fillPts(B, K.crust);
    clipped(B, () => {
      T.fillPts(shift(B, 3, 4), K.crustShade); T.fillPts(shift(B, 1.5, 2), K.crust);
      T.fillPts(shift(B.map(([x, y]) => [x * 0.9, y * 0.9]), -2, -2), K.crustHi); T.fillPts(B.map(([x, y]) => [x * 0.93, y * 0.93 + 2]), K.crust);
      T.stroke(T.chaikin(inner, 1, false).slice(1, -1).map(([x, y]) => [x * 1.03, y * 1.03]), 4, K.crumb, 0.8, 0.4);   // crumb left inside
    });
    T.ink(B, 4.2);
  }

  // ─────────────────────────── book ───────────────────────────
  // text lines on a page panel [x0..x1] (x1 may be < x0 for a mirrored page)
  function pageLines(x0, x1, top, n, seed) {
    const w = x1 - x0; if (Math.abs(w) < 14) return;
    for (let i = 0; i < n; i++) {
      const L = 0.55 + 0.4 * T.hash(seed + i * 3.1), a = x0 + w * 0.14, b = x0 + w * (0.14 + 0.72 * L), yy = top + 14 + i * 12;
      T.stroke([[a, yy], [b, yy + 0.5]], 2.6, K.textLine, 0.3, 0.5);
    }
  }
  function coverArt(x0, x1, top, bot) {                               // front cover decoration
    const w = x1 - x0, m = (x0 + x1) / 2 + w * 0.06; if (Math.abs(w) < 10) return;
    T.shape([[x0 + w * 0.2, top + 16], [x1 - w * 0.1, top + 16], [x1 - w * 0.1, top + 34], [x0 + w * 0.2, top + 34]], C.gold, 2.8, { jitter: 0.6 });
    T.stroke([[x0 + w * 0.3, top + 25], [x1 - w * 0.22, top + 25]], 2.4, T.shade(C.gold, 0.35), 0.4, 0.4);
    const r = Math.min(Math.abs(w) * 0.22, 13);
    T.shape(T.star4Pts(m, (top + bot) / 2 + 12, r, 0).map(([px, py]) => [m + (px - m) * Math.sign(w || 1), py]), C.PAPER, 2.6, { jitter: 0.6 });
  }
  P.book = (x, y, s = 1, rot = 0, open = 1) => {
    const g = begin(x, y, s, rot);
    if (open < 0) {                                                    // lying flat on the bench: edge view
      T.shape(T.rrectPts(-52, -12, 104, 22, 4), K.cover, 4.2);
      T.shape(T.rrectPts(-46, -7, 94, 12, 2), K.pageEdge, 2.6, { jitter: 0.6 });
      [-2, 2].forEach(dy => T.stroke([[-42, dy], [44, dy]], 1.6, K.textLine, 0.3, 0.4));
      T.stroke([[-48, -10], [48, -10]], 2, K.coverHi, 0.6, 0.4);
      g.restore(); return;
    }
    const o = T.clamp(open), W = 62, H = 42, a = o * Math.PI;
    const sx = T.lerp(-W / 2, 0, o);                                   // spine x
    const topAt = (px) => -H + 5 * (1 - Math.abs(px - sx) / W) * o;      // page tops dip toward the spine when open
    // back cover + right page block (hidden while closed)
    if (o > 0.02) {
      T.shape([[sx, -H + 1], [sx + W + 4, -H - 2], [sx + W + 4, H + 2], [sx, H + 4]], K.cover, 4.2, { jitter: 1 });
      const pg = [[sx, topAt(sx) + 4], [sx + W - 2, -H + 2], [sx + W - 2, H - 2], [sx, H]];
      const Pp = T.shape(pg, K.page, 3.2, { jitter: 0.7 });
      clipped(Pp, () => T.fillPts(shift(Pp, -W * 0.75, 0), T.rgba('#D8CCB4', 0.35)));  // gutter shade
      if (o > 0.5) {
        pageLines(sx + 2, sx + W - 4, -H + 2, 3, 11);
        // small picture on the right page: sun over a green hill
        const px = sx + W * 0.2, pw = W * 0.64, py = 0;
        T.shape([[px, py], [px + pw, py], [px + pw, py + 26], [px, py + 26]], '#CDE8F2', 2.4, { jitter: 0.5 });
        T.blob(px + pw * 0.28, py + 9, 5, 5, C.gold, 1.8, 10);
        T.shape([[px, py + 26], [px, py + 19], [px + pw * 0.5, py + 14], [px + pw, py + 20], [px + pw, py + 26]], C.grass, 2, { jitter: 0.4 });
      }
    }
    // front cover swinging around the spine
    const ex = sx + W * Math.cos(a), bulge = 1 + 0.08 * Math.sin(a);
    const cv = [[sx, -H], [ex, -H * bulge], [ex, H * bulge], [sx, H + 2]];
    if (Math.cos(a) >= 0) {                                           // still on the right: we see the cover front
      const Cv = T.shape(cv, K.cover, 4.4, { jitter: 1 });
      clipped(Cv, () => { T.fillPts(shift(Cv, 0, 8), K.coverShade); T.fillPts(shift(Cv, 0, 4), K.cover); T.fillPts([[sx, -H - 5], [sx + 10, -H - 5], [sx + 10, H + 5], [sx, H + 5]], K.coverShade); });
      coverArt(sx + 8, ex, -H, H);
      if (o < 0.05) T.stroke([[ex - 2, -H + 6], [ex - 2, H - 4]], 2.2, K.pageEdge, 0.3, 0.5);  // page edge peeking
    } else {                                                          // flipped to the left: cover inside + left page
      T.shape(cv, K.cover, 4.2, { jitter: 1 });
      const lp = [[sx, topAt(sx) + 4], [ex + 3, -H * bulge + 3], [ex + 3, H * bulge - 3], [sx, H]];
      const Lp = T.shape(lp, K.page, 3.2, { jitter: 0.7 });
      clipped(Lp, () => T.fillPts(shift(Lp, W * 0.78, 0), T.rgba('#D8CCB4', 0.35)));
      if (o > 0.6) pageLines(sx - 3, ex + 4, -H + 2, 5, 3);
    }
    T.stroke([[sx, -H + 4], [sx, H]], 2.6, T.shade(K.cover, 0.35), 0.3, 0.6);   // spine / gutter line
    g.restore();
  };

  // ─────────────────────────── lunchbox ───────────────────────────
  P.lunchbox = (x, y, s = 1) => {
    const g = begin(x, y, s);
    T.limb(T.arcPts(0, -24, 17, 17, Math.PI, TAU, 8), 5, '#7A8392', 3.6);          // handle
    const B = T.shape(T.rrectPts(-40, -24, 80, 50, 9, 3), K.box, 4.4);
    clipped(B, () => {
      T.fillPts(T.rrectPts(-34, -20, 80, 50, 9, 3), K.boxShade);
      T.fillPts(T.rrectPts(-40, -24, 74, 45, 9, 3), K.box);
      T.fillPts([[-36, -20], [-22, -20], [-30, 16], [-36, 16]], T.rgba('#FFFFFF', 0.25));   // glossy streak
    });
    T.stroke([[-38, -8], [38, -8]], 3, K.boxShade, 0.2, 0.6);                   // lid seam
    T.shape(T.rrectPts(-7, -13, 14, 12, 3, 2), K.latch, 3, { jitter: 0.6 });        // latch
    // sticker: little yellow star on the side
    T.shape(star5(21, 9, 10, 4.4), C.gold, 2.4, { jitter: 0.5 });
    g.restore();
  };

  // ─────────────────────────── crumbs ───────────────────────────
  P.crumbs = (x, y, t0, t, seed = 1) => {
    const dt = t - t0; if (dt < 0 || dt > 0.75) return;
    const g = c(); g.save();
    g.globalAlpha *= 1 - T.E.in(T.p(dt, 0.45, 0.75));
    for (let i = 0; i < 9; i++) {
      const h1 = T.hash(seed * 7.1 + i), h2 = T.hash(seed * 3.3 + i * 1.7), h3 = T.hash(seed + i * 9.1);
      const vx = (h1 - 0.5) * 260, vy = -120 - h2 * 220, px = x + vx * dt, py = y + vy * dt + 900 * dt * dt;
      const r = 3 + h3 * 3.5;
      T.shape(T.ell(px, py, r * 1.2, r, 7, dt * (6 + h1 * 8)), h3 > 0.35 ? K.crumb : K.crust, 2.2, { jitter: 0.5 });
    }
    g.restore();
  };

  // ─────────────────────────── rain cloud ───────────────────────────
  const CLOUD_PARTS = [[-44, 6, 30], [-16, -14, 36], [20, -12, 32], [46, 6, 27], [2, 12, 40], [-26, 16, 26], [30, 16, 26]];
  P.rainCloud = (x, y, s = 1, t = 0) => {
    const g = begin(x, y + Math.sin(t * 5.5) * 3 * s, s);
    // drops first (they fall from behind the cloud's belly)
    for (let i = 0; i < 7; i++) {
      const ph = (i * 3 % 7) / 7 + 0.08 * T.hash(i * 3.7), u = (t * 1.7 + ph) % 1, dx = -48 + (i + 0.5) / 7 * 96 + (T.hash(i) - 0.5) * 10;
      const dy = 24 + u * 118, a = 1 - T.E.in(T.p(u, 0.75, 1));
      g.save(); g.globalAlpha *= a;
      const d = [[dx, dy - 13], [dx + 6, dy], [dx + 6.5, dy + 5], [dx, dy + 10], [dx - 6.5, dy + 5], [dx - 6, dy]];
      T.shape(T.chaikin(d, 1), K.drop, 2.6, { jitter: 0.5 });
      oval(dx - 2.5, dy + 3, 1.6, 2.6, K.dropHi);
      g.restore();
    }
    const parts = CLOUD_PARTS.map(([px, py, r]) => T.ell(px, py, r, r * 0.82, 20));
    const J = union(parts, K.cloud, 4.4);
    // shading inside the silhouette: darker belly, lighter tops (lit from upper-left)
    g.save(); g.beginPath(); J.forEach(p => { p.forEach(([px, py], k) => k ? g.lineTo(px, py) : g.moveTo(px, py)); g.closePath(); }); g.clip();
    oval(6, 34, 70, 22, K.cloudShade);
    CLOUD_PARTS.slice(0, 4).forEach(([px, py, r]) => oval(px - r * 0.25, py - r * 0.35, r * 0.55, r * 0.35, K.cloudHi, -0.3));
    g.restore();
    // grumbly squiggle on the belly
    T.stroke([[-18, 22], [-10, 18], [-2, 23], [6, 18], [14, 23]], 2.6, T.shade(K.cloud, 0.35), 0.5, 0.6);
    g.restore();
  };

  // ─────────────────────────── poof ───────────────────────────
  P.poof = (x, y, s = 1, u = 0) => {
    if (u <= 0 || u >= 1) return;
    const g = begin(x, y, s);
    const grow = u < 0.28 ? T.E.back(u / 0.28) : 1 - T.E.in((u - 0.28) / 0.72);
    const R = 16 + 30 * T.E.out(u), lw = 4.4 * (1 - 0.5 * u);
    // flash star at the very start
    if (u < 0.3) T.star4(0, 0, 70 * (1 - u / 0.3) + 10, 0.4, C.PAPER, 3);
    const parts = [];
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * TAU + 0.4, r = (22 + 10 * T.hash(i * 2.3)) * grow;
      if (r > 1) parts.push(T.ell(Math.cos(a) * R, Math.sin(a) * R * 0.8 - 8 * u, r, r * 0.9, 16));
    }
    if (grow > 0.02) parts.push(T.ell(0, -6 * u, 30 * grow, 26 * grow, 18));
    if (parts.length) {
      const J = union(parts, K.smoke, lw, 1);
      g.save(); g.beginPath(); J.forEach(p => { p.forEach(([px, py], k) => k ? g.lineTo(px, py) : g.moveTo(px, py)); g.closePath(); }); g.clip();
      J.forEach(p => { T.fillPts(shift(p, 5 * grow, 7 * grow), K.smokeShade); });
      J.forEach(p => { T.fillPts(scaleAbout(p, 0.78, p[0][0] - (p[0][0] - p[14 % p.length][0]) / 2 - 3, p[4 % p.length][1] + 2), K.smoke); });
      g.restore();
    }
    // speed ticks flying out
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * TAU + 0.1, r0 = R + 18 + 40 * u, r1 = r0 + 22 * (1 - u);
      if (u < 0.75) T.stroke([[Math.cos(a) * r0, Math.sin(a) * r0 * 0.85], [Math.cos(a) * r1, Math.sin(a) * r1 * 0.85]], 4 * (1 - u), INK, 0.8, 0.5);
    }
    g.restore();
  };

  // ─────────────────────────── sparkles ───────────────────────────
  P.sparkleBurst = (x, y, u, n = 8, R = 130, color = C.gold) => {
    if (u <= 0 || u >= 1) return;
    const g = c(); g.save();
    const r = R * T.E.out(u), k = Math.pow(1 - u, 0.8);
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU + 0.3, big = i % 2 === 0, rr = r * (big ? 1 : 0.78);
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr * 0.85;
      if (u < 0.45) {                                                   // streak from the centre early on
        const r0 = rr * 0.45; T.stroke([[x + Math.cos(a) * r0, y + Math.sin(a) * r0 * 0.85], [px, py]], 3.2 * (1 - u / 0.45), color === C.PAPER ? INK : color, 0.9, 0.4);
      }
      T.star4(px, py, (big ? 20 : 12) * k + 3, u * 3 + i, color, 3);
      if (big) dot(x + Math.cos(a + 0.35) * rr * 0.72, y + Math.sin(a + 0.35) * rr * 0.62, 3.5 * k, INK);
    }
    g.restore();
  };

  // ─────────────────────────── hearts ───────────────────────────
  P.hearts = (x, y, u) => {
    if (u <= 0 || u >= 1) return;
    [[-46, 0, 1.35, 0], [44, -22, 1.0, 0.12], [0, -64, 0.8, 0.25]].forEach(([dx, dy, sz, d], i) => {
      const v = T.clamp((u - d) / (1 - d)); if (v <= 0) return;
      const pop = T.E.back(T.clamp(v * 4)) * (1 - T.E.in(T.p(v, 0.7, 1)));
      if (pop <= 0.01) return;
      const hx = x + dx + Math.sin(v * 9 + i) * 10, hy = y + dy - 150 * T.E.out(v);
      const g = begin(hx, hy, pop * sz, Math.sin(v * 7 + i * 2) * 0.18);
      T.heart(0, 0, 1.25, C.pink);
      oval(-8, -6, 4, 2.6, T.rgba('#FFFFFF', 0.85), -0.6);
      g.restore();
    });
  };

  // ─────────────────────────── comic burst ───────────────────────────
  P.burst = (x, y, s = 1, label = 'Arf!') => {
    const g = begin(x, y, s, -0.1);
    const spikes = (n, r0, r1, sx, seed) => Array.from({ length: n * 2 }, (_, i) => {
      const a = i / (n * 2) * TAU, r = i % 2 ? r0 : r1 * (0.86 + 0.28 * T.hash(seed + i));
      return [Math.cos(a) * r * sx, Math.sin(a) * r];
    });
    T.shape(spikes(13, 64, 104, 1.3, 3), C.red, 5);
    T.shape(spikes(13, 50, 78, 1.28, 9), C.gold, 3.6);
    // action flecks outside
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * TAU + 0.35, r0 = 112, r1 = 130;
      T.stroke([[Math.cos(a) * r0 * 1.3, Math.sin(a) * r0], [Math.cos(a) * r1 * 1.3, Math.sin(a) * r1]], 5, INK, 0.8, 0.8);
    }
    // label: fat paper outline, ink fill, fitted to the burst
    g.font = T.FONT(70); const w = g.measureText(label).width, k = Math.min(1, 150 / w);
    g.save(); g.scale(k, k); g.rotate(0.02 * Math.sin(T.BOIL * 2.1));
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    g.lineWidth = 12; g.strokeStyle = C.PAPER; g.strokeText(label, 0, 4);
    g.fillStyle = INK; g.fillText(label, 0, 4);
    g.restore();
    g.restore();
  };

  // ─────────────────────────── speech bubble ───────────────────────────
  P.speechBubble = (spec) => {
    const g = c(), px = spec.px || 54, lh = px * 1.08, padX = px * 0.7, padY = px * 0.5;
    const lines = spec.lines && Array.isArray(spec.lines) ? spec.lines : String(spec.text || '').split('\n');
    g.save(); g.font = T.FONT(px);
    const tw = Math.max(...lines.map(l => g.measureText(l).width), px);
    const w = Math.max(spec.w || 0, tw + padX * 2), h = lines.length * lh + padY * 2;
    const x0 = spec.x - w / 2, y0 = spec.y - h / 2;
    const tip = spec.tail || [spec.x, y0 + h + 60], sc = spec.scale ?? 1;
    const box = { x0, y0, w, h };
    if (sc <= 0.01) { g.restore(); return box; }
    g.translate(tip[0], tip[1]); g.scale(sc, sc); g.translate(-tip[0], -tip[1]);
    const shout = spec.style === 'shout';
    // balloon outline: a rounded rect with soft bulges (talk) or a spiky edge (shout)
    let body;
    if (shout) {
      const n = Math.round((w + h) / 26) * 2;
      body = Array.from({ length: n }, (_, i) => {
        const a = i / n * TAU, r = i % 2 ? 1.0 : 1.2 + 0.12 * T.hash(i * 3.3);
        return [spec.x + Math.cos(a) * (w / 2 + 10) * r, spec.y + Math.sin(a) * (h / 2 + 8) * r];
      });
    } else {
      body = resample(T.rrectPts(x0, y0, w, h, Math.min(h / 2, 44), 7), 26)
        .map(([bx, by]) => { const dx = bx - spec.x, dy = by - spec.y, d = Math.hypot(dx / w, dy / h) || 1; return [bx + dx / d / w * 5, by + dy / d / h * 5]; });
    }
    // tail: curved wedge from the balloon edge to the tip
    const dx = tip[0] - spec.x, dy = tip[1] - spec.y;
    let bx = spec.x + T.clamp(dx * 0.55, -w / 2 + 50, w / 2 - 50), by = spec.y + Math.sign(dy || 1) * (h / 2 - 12);
    if (Math.abs(dy) < h / 2) { bx = spec.x + Math.sign(dx) * (w / 2 - 14); by = spec.y + T.clamp(dy, -h / 2 + 30, h / 2 - 30); }
    const nx = -(tip[1] - by), ny = tip[0] - bx, nl = Math.hypot(nx, ny) || 1, bw = shout ? 26 : 20;
    const bend = (a, b, u, k) => { const mx = T.lerp(a[0], b[0], u), my = T.lerp(a[1], b[1], u); return [mx + nx / nl * k, my + ny / nl * k]; };
    const L0 = [bx - nx / nl * bw, by - ny / nl * bw], R0 = [bx + nx / nl * bw, by + ny / nl * bw];
    const tail = [L0, bend(L0, tip, 0.5, 6), tip, bend(R0, tip, 0.5, 8), R0];
    const Jb = T.J(body, 1.2), Jt = T.J(tail, 1);
    const lw = 4.6;
    T.ink(Jt, lw * 2); T.ink(Jb, lw * 2);
    T.fillPts(Jt, C.PAPER); T.fillPts(Jb, C.PAPER);
    // text (typewriter): visibleChars counts '\n' as one char
    let shown = spec.visibleChars == null ? 1e9 : spec.visibleChars;
    g.fillStyle = INK; g.textBaseline = 'middle';
    const align = spec.align || (lines.length > 1 ? 'left' : 'center');
    lines.forEach((l, i) => {
      const vis = l.slice(0, Math.max(0, shown)); shown -= l.length + 1;
      const ly = y0 + padY + lh * (i + 0.5) + px * 0.04;
      if (align === 'center') { g.textAlign = 'left'; g.fillText(vis, spec.x - g.measureText(l).width / 2, ly); }
      else { g.textAlign = 'left'; g.fillText(vis, spec.x - tw / 2, ly); }
    });
    g.restore();
    return box;
  };

  // ─────────────────────────── motion lines ───────────────────────────
  P.motionLines = (pts, u = 1) => {
    if (u <= 0 || !pts || pts.length < 2) return;
    const g = c(); g.save(); g.globalAlpha *= T.clamp(u);
    // cumulative length so each line can be trimmed along the path
    const Lc = [0]; for (let i = 1; i < pts.length; i++) Lc.push(Lc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = Lc[Lc.length - 1]; if (total < 4) { g.restore(); return; }
    const at = (d) => { let i = 1; while (i < Lc.length - 1 && Lc[i] < d) i++; const k = (d - Lc[i - 1]) / ((Lc[i] - Lc[i - 1]) || 1); const a = pts[i - 1], b = pts[i]; return [[T.lerp(a[0], b[0], k), T.lerp(a[1], b[1], k)], [b[0] - a[0], b[1] - a[1]]]; };
    [[-22, 0.55], [-8, 0.95], [7, 0.8], [21, 0.45]].forEach(([off, frac], j) => {
      const d1 = total - 26 - 10 * (j % 2), d0 = Math.max(0, d1 - total * frac * T.clamp(u * 1.3));
      if (d1 - d0 < 6) return;
      const line = [];
      for (let k = 0; k <= 8; k++) {
        const [[px, py], [tx, ty]] = at(T.lerp(d0, d1, k / 8)), tl = Math.hypot(tx, ty) || 1;
        line.push([px - ty / tl * off, py + tx / tl * off]);
      }
      T.stroke(line, 4.2, INK, 0.9, 0.6);
    });
    g.restore();
  };
})();
