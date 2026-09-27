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
//   poof(x,y,s,u)                            smoke puff, u 0..1 (nothing drawn outside 0<u<1; fades out over u .65–1)
//   sparkleBurst(x,y,u,n=8,R=130,color)      ring of 4-point stars popping and flying out, u 0..1
//   hearts(x,y,u)                            three hearts popping and floating up, u 0..1
//   burst(x,y,s,label)                       comic starburst ("Arf!")
//   speechBubble(spec) → {x0,y0,w,h,outer}   spec = {x, y, w?, text | lines, visibleChars?, tail:[x,y], scale?,
//                                               px? (font, 54), style? 'talk'|'shout', align? 'left'|'center'}
//                                            (x,y) = bubble centre; scale pops about the tail tip.
//                                            {x0,y0,w,h} = the TEXT box.  outer = {x0,y0,w,h} = everything that is
//                                            inked (balloon bulges / shout spikes + tail + line width) — use `outer`
//                                            to keep a bubble on screen.  Both are at scale 1 (the settled size).
//   motionLines(pts,u)                       speed lines trailing a path pts (oldest → newest), u = strength 0..1
//
// Line boil: core keys each shape's jitter on a per-frame call counter, so every public function here
// consumes a FIXED number of T.J calls whatever its state/progress (padded at the end, see `budget`).
// That way a prop changing state (poof ending, a bite appearing, a bubble popping in) never re-jitters
// the lines of whatever is drawn after it in the same frame.
'use strict';
(function () {
  const T = window.TOON, C = T.C, INK = C.INK, TAU = T.TAU;
  const P = T.props = {};

  // ── local palette ──
  const K = {
    crumb: '#F7E1A6', crumbShade: '#EACB85', crust: '#D39149', crustShade: '#B8763A', crustHi: '#E6AD68',
    lettuce: '#7CC35A', lettuceShade: '#5EA546', lettuceHi: '#A6DB7E', lettuceLine: '#3E7A34',
    tomato: '#E6533C', tomatoShade: '#C23F2E', tomatoHi: '#F4876E', tomatoSeed: '#FBD3A0',
    cheese: '#FFD04A', cheeseShade: '#EDB42E', cheeseHi: '#FFE796',
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
  // clip to the union of several polygons
  function clippedAll(list, fn) {
    const g = c(); g.save(); g.beginPath();
    list.forEach(p => { p.forEach(([px, py], k) => k ? g.lineTo(px, py) : g.moveTo(px, py)); g.closePath(); });
    g.clip(); fn(); g.restore();
  }
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
  // point-in-polygon (even-odd)
  function inPoly(x, y, pts) {
    let ins = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins;
    }
    return ins;
  }
  // scale a polygon about a point
  const scaleAbout = (pts, k, cx = 0, cy = 0, ky = k) => pts.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * ky]);
  const shift = (pts, dx, dy) => pts.map(([x, y]) => [x + dx, y + dy]);
  // union of several shapes with ONE merged outline: ink all (double width) then fill all.
  // `fill` is one colour or an array (one per shape, drawn in order).
  function union(list, fill, lw = 4.5, jit = T.JA) {
    const J = list.map(p => T.J(p, jit));
    if (lw > 0) J.forEach(p => T.ink(p, lw * 2));
    J.forEach((p, i) => T.fillPts(p, Array.isArray(fill) ? fill[i] : fill));
    return J;
  }
  const dot = (x, y, r, col) => { const g = c(); g.fillStyle = col; g.beginPath(); g.arc(x, y, Math.max(0.01, r), 0, TAU); g.fill(); };
  const oval = (x, y, rx, ry, col, rot = 0) => { const g = c(); g.fillStyle = col; g.beginPath(); g.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, TAU); g.fill(); };
  const star5 = (x, y, r0, r1) => Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + i / 10 * TAU, r = i % 2 ? r1 : r0; return [x + Math.cos(a) * r, y + Math.sin(a) * r]; });

  // ── fixed jitter budget (see header) ──
  // Wraps a prop so it always consumes exactly N T.J calls (N may depend on the args).  Nested budgets
  // work: an inner prop's calls (and its padding) count toward the outer one.
  const PAD = [[0, 0]], over = {};
  P._jmax = {};                                                      // max calls seen per prop (for tests)
  function budget(name, N, fn) {
    return (...args) => {
      const J0 = T.J; let k = 0;
      T.J = (pts, amp) => { k++; return J0(pts, amp); };
      try { return fn(...args); }
      finally {
        T.J = J0;
        const n = typeof N === 'function' ? N(...args) : N;
        P._jmax[name] = Math.max(P._jmax[name] || 0, k);
        if (k > n && !over[name]) { over[name] = 1; console.warn(`props.${name}: ${k} T.J calls > budget ${n}`); }
        for (; k < n; k++) J0(PAD);
      }
    };
  }

  // ── group fade ──
  // Draw fn at full opacity into a scratch buffer (only the device-space bounds of the local box
  // [x0,y0,x1,y1]), then composite it at `alpha`.  Overlapping fills/inks inside the group then fade
  // as one cel instead of showing through each other.
  let FADE = null;
  function faded(alpha, box, fn) {
    if (alpha >= 0.995) { fn(); return; }
    if (alpha <= 0.004 || typeof document === 'undefined') return;
    const g = c(), m = g.getTransform(), W = g.canvas.width, H = g.canvas.height;
    const xs = [], ys = [];
    [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]].forEach(([x, y]) => { xs.push(m.a * x + m.c * y + m.e); ys.push(m.b * x + m.d * y + m.f); });
    const x0 = Math.max(0, Math.floor(Math.min(...xs))), y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const x1 = Math.min(W, Math.ceil(Math.max(...xs))), y1 = Math.min(H, Math.ceil(Math.max(...ys)));
    if (x1 <= x0 || y1 <= y0) return;
    const w = x1 - x0, h = y1 - y0;
    // one scratch buffer the size of the target canvas, allocated once: every call renders identically
    if (!FADE || FADE.width < W || FADE.height < H) { FADE = document.createElement('canvas'); FADE.width = W; FADE.height = H; }
    const b = FADE, bg = b.getContext('2d');
    bg.setTransform(1, 0, 0, 1, 0, 0); bg.clearRect(0, 0, w, h);
    bg.setTransform(m.a, m.b, m.c, m.d, m.e - x0, m.f - y0);
    T.ctx = bg;
    try { fn(); } finally { T.ctx = g; bg.setTransform(1, 0, 0, 1, 0, 0); }
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha *= alpha; g.drawImage(b, 0, 0, w, h, x0, y0, w, h); g.restore();
  }

  // ─────────────────────────── sandwich ───────────────────────────
  // Built back → front so that every edge carries at most ONE dark line, even at 6x:
  //   1. silhouette  — back slice + tomato bumps under one merged INK outline (union)
  //   2. lettuce     — a thin wavy strip along the bottom edge, lined in dark green (never INK)
  //   3. cheese      — a smooth corner + teardrop drip tucked under the bread's lower-right corner
  //   4. bread face  — crust band + crumb, inked
  // The back slice is offset straight down, so its side edges hide behind the bread and only its bottom
  // crust shows (well clear of the bread's bottom line).
  const soft = (pts, amp = 1, rad = 7) => T.chaikin(T.J(resample(pts, rad * 2), amp), 2);
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
    // a thin round-joined core line first: fills the tiny gaps the brush ribbon leaves at very sharp
    // corners (the horns of a bite), then the brush line on top
    const g = c(); T.path(O); g.lineJoin = 'round'; g.lineWidth = 2.6; g.strokeStyle = INK; g.stroke();
    T.ink(O, 4.2);
    return O;
  }
  // silhouette layer: back slice (its crust edge shows below the bread) + tomato slices, ONE outline.
  // tomatoes = [x, y, rx, ry]: flat slices lying between the slices; the part that pokes outside the
  // back slice gets the silhouette ink, the part inside just meets the crust colour (no extra line).
  function backLayer(B, tomatoes) {
    // B arrives already boiled (soft) — only the tomatoes get their own jitter, so a densely sampled
    // (bitten) back slice never turns jaggy
    const J = union([B, ...tomatoes.map(([x, y, rx, ry]) => T.J(T.ell(x, y, rx, ry, 20), 0.5))], [K.crust, ...tomatoes.map(() => K.tomato)], 2.1, 0);
    clipped(J[0], () => { T.fillPts(shift(J[0], 0, -3.5), K.crustShade); T.fillPts(shift(J[0], 0, -6), K.crust); });   // darker underside
    tomatoes.forEach(([x, y, rx, ry], i) => clipped(J[i + 1], () => {
      oval(x + rx * 0.1, y + ry * 0.55, rx * 1.05, ry * 0.6, K.tomatoShade);     // shade along the lower rim
      oval(x - rx * 0.3, y - ry * 0.05, rx * 0.35, ry * 0.28, K.tomatoHi);       // wet highlight
    }));
  }
  // lettuce strip: top edge y0 (hidden under the bread) spanning [xa..xb]; its lower edge is a row of
  // soft scallops hanging to y1; both ends curl up to yEnd (little leaf ears beside the bread corners)
  function lettuceStrip(xa, xb, y0, y1, yEnd, period) {
    const n = Math.max(3, Math.round((xb - xa) / period)), bot = [];
    for (let i = 0; i <= n * 4; i++) {
      const u = i / (n * 4), x = T.lerp(xa, xb, u), ph = (u * n) % 1;
      const edge = Math.min(1, Math.min(u, 1 - u) * n * 1.3);             // taper the scallops toward the ends
      bot.push([x, T.lerp(y1 - 3.2, y1, Math.sin(Math.PI * ph)) * edge + (y1 - 2) * (1 - edge)]);
    }
    const pts = [[xa + 4, y0], [xb - 4, y0], [xb + 1.5, yEnd], ...bot.reverse(), [xa - 1.5, yEnd]];
    const L = T.chaikin(T.J(pts, 0.5), 1);
    T.fillPts(L, K.lettuce);
    clipped(L, () => {
      T.fillPts(shift(L, 0, -2.4), K.lettuceShade); T.fillPts(shift(L, 0, -4.2), K.lettuce);   // shade along the ruffle
      for (let i = 1; i < n; i++) { const x = T.lerp(xa, xb, i / n); T.stroke([[x, y0 + 3], [x - 0.8, y1 - 2.5]], 1.2, K.lettuceHi, 0.7, 0.3); }   // ribs
    });
    T.ink(L, 2, K.lettuceLine);
    return L;
  }
  // cheese: the corner of a slice poking out from under the bread corner (cx,cy), drooping, with one
  // smooth teardrop drip (≤ 12 px) hanging from its underside.  dir = +1 corner on the right.
  function cheese(cx, cy, drop = 11, dir = 1) {
    const d = dir, bx = cx - d * 1;                                       // drip centre-x (under the corner)
    const bulb = T.arcPts(bx, cy + drop - 3.2, 3.3, 3.4, d > 0 ? 0 : Math.PI, d > 0 ? Math.PI : 0, 6);   // round drip end
    const pts = [[cx - d * 20, cy - 7], [cx - d * 2, cy - 7], [cx + d * 7, cy - 2], [cx + d * 8.5, cy + 2.5], [cx + d * 5, cy + 5],
      [bx + d * 2.2, cy + 6], [bx + d * 2, cy + drop * 0.6], ...bulb, [bx - d * 2, cy + drop * 0.55], [bx - d * 3.4, cy + 5.5], [cx - d * 7, cy + 3], [cx - d * 12, cy - 2], [cx - d * 20, cy - 3]];
    const Q = T.chaikin(T.J(pts, 0.35), 2);
    T.fillPts(Q, K.cheese);
    clipped(Q, () => {
      T.fillPts(shift(Q, d * 1.2, 2.4), K.cheeseShade); T.fillPts(shift(Q, -d * 0.6, -1.2), K.cheese);
      oval(bx - d * 0.9, cy + drop - 4.2, 1.1, 1.8, K.cheeseHi);        // glint on the drip
    });
    T.ink(Q, 2.4);
    return Q;
  }

  // triangle half (point up) and its crumb interior
  const HALF_TRI = [[0, -34], [39, 22], [-39, 22]], HALF_IN = [[0, -21], [27, 15], [-27, 15]];
  // bite (state 1): a mouth-sized scoop taking the apex off at a slight diagonal, whose rim is three
  // tooth scallops (small circles along the mouth's lower rim) with sharp cusps between them.
  const BITE_MOUTH = [4, -22, 15.5];
  const BITE_TEETH = [146, 102, 58].map(deg => { const a = deg * Math.PI / 180; return [4 + Math.cos(a) * 15, -22 + Math.sin(a) * 15, 6]; });
  const BITES = [BITE_MOUTH, ...BITE_TEETH];
  // The bite region (mouth ∪ teeth, every radius grown by dr) is star-shaped about the mouth centre, so
  // its boundary is a polar curve ρ(θ): a (slightly soft) max of the mouth radius and each tooth's far
  // ray intersection — the soft max rounds the cusps just enough for the brush line to stay clean.
  function biteRho(th, dr) {
    const [mx, my, mr] = BITE_MOUTH, dx = Math.cos(th), dy = Math.sin(th), k = 0.9;
    let acc = Math.exp((mr + dr) / k), top = mr + dr;
    for (const [tx, ty, tr] of BITE_TEETH) {
      const fx = tx - mx, fy = ty - my, b = fx * dx + fy * dy, R = tr + dr, disc = b * b - (fx * fx + fy * fy - R * R);
      if (disc > 0) { const r = b + Math.sqrt(disc); acc += Math.exp(r / k); top = Math.max(top, r); }
    }
    return Math.max(top, k * Math.log(acc) - 0.4);
  }
  // Cut the bite out of a closed outline: every run of outline points inside the bite is replaced by
  // the densely sampled bite curve between the run's entry and exit angles — taken the way round that
  // lies inside the shape — so the scallops are true round arcs with crisp cusps.  dr > 0 bites deeper
  // (layers behind the bread then sit recessed inside the bite).
  function bite(pts, dr = 0) {
    const Pp = resample(pts, 3), n = Pp.length, [mx, my] = BITE_MOUTH;
    const pol = Pp.map(([x, y]) => [Math.atan2(y - my, x - mx), Math.hypot(x - mx, y - my)]);
    const inside = pol.map(([th, r]) => r < biteRho(th, dr));
    const s0 = inside.indexOf(false); if (s0 < 0) return Pp;
    const at = i => (s0 + i + n) % n, wrap = d => d > Math.PI ? d - TAU : d < -Math.PI ? d + TAU : d;
    const curve = (thA, sw) => { const m = Math.max(2, Math.ceil(Math.abs(sw) * (BITE_MOUTH[2] + 4) / 2.6)); return Array.from({ length: m + 1 }, (_, q) => { const th = thA + sw * q / m, r = biteRho(th, dr); return [mx + Math.cos(th) * r, my + Math.sin(th) * r]; }); };
    const out = [];
    for (let i = 0; i < n;) {
      if (!inside[at(i)]) { out.push(Pp[at(i)]); i++; continue; }
      let j = i; while (j < n && inside[at(j)]) j++;
      let S = 0; for (let q = i - 1; q < j; q++) S += wrap(pol[at(q + 1)][0] - pol[at(q)][0]);
      const thA = pol[at(i - 1)][0];
      // the bite curve joins entry→exit either the same way round as the eaten run or the other way:
      // keep the one whose middle lies inside the original shape
      const alt = S - Math.sign(S) * TAU, cS = curve(thA, S), midS = cS[cS.length >> 1];
      out.push(...curve(thA, inPoly(midS[0], midS[1], Pp) ? S : alt));
      i = j;
    }
    return T.chaikin(out, 1);                                            // soften the horns a touch
  }

  P.sandwichWhole = budget('sandwichWhole', 18, (x, y, s = 1, rot = 0) => {
    begin(x, y, s, rot);
    const sq = [[-38, -34], [38, -34], [38, 34], [-38, 34]];
    backLayer(soft(scaleAbout(shift(sq, 0, 12), 0.96, 0, 46, 1), 0.6, 9), [[-33, 40.5, 10, 5.5], [8, 42, 13, 4.6]]);
    lettuceStrip(-40, 40, 26, 40, 30, 11);
    cheese(37, 34, 12, 1);
    breadFace(soft(sq, 1, 9), soft(scaleAbout(sq, 0.8), 0.8, 7), [[-14, -12, 2.2], [10, -16, 1.6], [-4, 8, 2], [16, 12, 1.8], [-20, 14, 1.5]]);
    // the pre-cut diagonal (where Bia snaps it)
    T.stroke([[-30, 28], [0, 0], [30, -28]], 3.2, K.crumbShade, 0.4, 0.8);
    T.stroke([[-22, 22], [20, -18]], 2, T.rgba(C.PAPER, 0.8), 0.9, 0.6);
    c().restore();
  });

  P.sandwichHalf = budget('sandwichHalf', 16, (x, y, s = 1, rot = 0, state = 0) => {
    begin(x, y, s, rot);
    if (state >= 2) { crust(); c().restore(); return; }
    const bitten = state === 1;
    // bites: dr > 0 carves layers behind the bread deeper, so they sit recessed inside the bite
    const fix = (pts, dr = 0) => bitten ? bite(pts, dr) : pts;
    backLayer(fix(soft(shift(HALF_TRI, 0, 12), 0.6, 6), 2.5), [[-30, 28.5, 9, 5.2], [8, 30, 11, 4.4]]);
    lettuceStrip(-34, 34, 15, 28, 18, 10);
    cheese(37, 22, 11, 1);
    const O = fix(soft(HALF_TRI, 1, 6)), I = fix(soft(HALF_IN, 0.7, 5));
    // bitten: the bite edge is soft crumb all round (no crust band) with a shaded, torn lip
    const biteEdge = () => {
      BITES.forEach(([bx, by, r]) => dot(bx, by, r + 6.5, K.crumb));
      BITE_TEETH.forEach(([bx, by, r]) => { const g = c(); g.strokeStyle = K.crumbShade; g.lineWidth = 2.2; g.lineCap = 'round'; g.beginPath(); g.arc(bx, by, r + 2.8, 0.1 * Math.PI, 0.9 * Math.PI); g.stroke(); });
      [[-10, -8], [3, -3], [12, -4], [-4, -10]].forEach(([bx, by]) => dot(bx, by, 1.2, K.crumbShade));
    };
    breadFace(O, I, [[-8, 6, 2], [9, 0, 1.6], [4, 11, 1.8], [-15, 13, 1.4]], bitten ? biteEdge : null);
    c().restore();
  });
  // state 2: the leftover crust — a fat golden arch, nibbled along the inside, rounded torn ends
  function crust() {
    const outer = T.arcPts(0, 12, 36, 38, Math.PI * 1.02, Math.PI * 1.98, 16);
    // inside edge: five soft tooth marks (smooth waves, no cusps — they stay clean under the brush line)
    const inner = Array.from({ length: 17 }, (_, i) => {
      const u = i / 16, a = Math.PI * (1.96 - 0.92 * u), r = 22.9 - 1.5 * Math.cos(TAU * u * 4);
      return [Math.cos(a) * r, 14 + Math.sin(a) * r];
    });
    // rounded torn cap from point a to point b, bulging away from the arch (a little wobble = torn)
    const cap = (a, b, n = 5) => {
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, r = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2;
      const a0 = Math.atan2(a[1] - my, a[0] - mx);                     // sweep through "down" (away from the arch)
      return Array.from({ length: n }, (_, i) => {
        const u = (i + 1) / (n + 1), ang = a0 + Math.PI * u, rr = r * (1.04 + 0.08 * Math.sin(i * 2.7));
        return [mx + Math.cos(ang) * rr, my + Math.sin(ang) * rr];
      });
    };
    const ring = [...outer, ...cap(outer[outer.length - 1], inner[0]), ...inner, ...cap(inner[inner.length - 1], outer[0])];
    const B = T.chaikin(T.J(ring, 0.4), 2);
    T.fillPts(B, K.crust);
    clipped(B, () => {
      T.fillPts(shift(B, 3, 4), K.crustShade); T.fillPts(shift(B, 1.5, 2), K.crust);
      T.fillPts(shift(B.map(([x, y]) => [x * 0.9, y * 0.9]), -2, -2), K.crustHi); T.fillPts(B.map(([x, y]) => [x * 0.93, y * 0.93 + 2]), K.crust);
      // crumb left along the WHOLE bitten inside edge (and round into both torn ends)
      const rim = T.arcPts(0, 14, 23.5, 23.5, Math.PI * 2.03, Math.PI * 0.97, 22);
      T.ribbon(rim, false, () => 6.5, K.crumb);
      T.ribbon(T.arcPts(0, 14, 27.2, 27.2, Math.PI * 1.9, Math.PI * 1.1, 16), false, (i, n) => 1.6 * Math.sin(Math.PI * i / (n - 1)), K.crumbShade);
    });
    T.ink(B, 4.2);
  }

  // ─────────────────────────── book ───────────────────────────
  // text lines on a page panel [x0..x1] (x1 may be < x0 for a mirrored page)
  function pageLines(x0, x1, top, n, seed) {
    const w = x1 - x0;
    for (let i = 0; i < n; i++) {
      if (Math.abs(w) < 14) { T.J(PAD); continue; }                  // keep the jitter count constant
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
  P.book = budget('book', 16, (x, y, s = 1, rot = 0, open = 1) => {
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
    const details = T.smooth(0.45, 0.65, o);                           // page text & picture fade in (no pop)
    // back cover + right page block (hidden while closed)
    if (o > 0.02) {
      T.shape([[sx, -H + 1], [sx + W + 4, -H - 2], [sx + W + 4, H + 2], [sx, H + 4]], K.cover, 4.2, { jitter: 1 });
      const pg = [[sx, topAt(sx) + 4], [sx + W - 2, -H + 2], [sx + W - 2, H - 2], [sx, H]];
      const Pp = T.shape(pg, K.page, 3.2, { jitter: 0.7 });
      clipped(Pp, () => T.fillPts(shift(Pp, -W * 0.75, 0), T.rgba('#D8CCB4', 0.35)));  // gutter shade
      faded(details, [sx - 2, -H - 4, sx + W + 4, H + 4], () => {
        pageLines(sx + 2, sx + W - 4, -H + 2, 3, 11);
        // small picture on the right page: sun over a green hill
        const px = sx + W * 0.2, pw = W * 0.64, py = 0;
        T.shape([[px, py], [px + pw, py], [px + pw, py + 26], [px, py + 26]], '#CDE8F2', 2.4, { jitter: 0.5 });
        T.blob(px + pw * 0.28, py + 9, 5, 5, C.gold, 1.8, 10);
        T.shape([[px, py + 26], [px, py + 19], [px + pw * 0.5, py + 14], [px + pw, py + 20], [px + pw, py + 26]], C.grass, 2, { jitter: 0.4 });
      });
    }
    // front cover swinging around the spine
    const ca = Math.cos(a), ex = sx + W * ca, bulge = 1 + 0.08 * Math.sin(a);
    const cv = [[sx, -H], [ex, -H * bulge], [ex, H * bulge], [sx, H + 2]];
    const cw = Math.abs(ex - sx), clw = T.lerp(2.2, 4.4, T.clamp((cw - 6) / 22));   // thinner ink on a foreshortened cover
    if (Math.abs(ca) < 0.1) {                                         // edge-on: just the board's thin edge
      const mx = (sx + ex) / 2;
      T.stroke([[mx, -H * bulge + 1], [mx, H * bulge + 1]], 3.4, K.coverShade, 0.15, 0.5);
    } else if (ca > 0) {                                              // still on the right: we see the cover front
      const Cv = T.shape(cv, K.cover, clw, { jitter: 1 });
      clipped(Cv, () => { T.fillPts(shift(Cv, 0, 8), K.coverShade); T.fillPts(shift(Cv, 0, 4), K.cover); T.fillPts([[sx, -H - 5], [sx + 10, -H - 5], [sx + 10, H + 5], [sx, H + 5]], K.coverShade); });
      coverArt(sx + 8, ex, -H, H);
      if (o < 0.05) T.stroke([[ex - 2, -H + 6], [ex - 2, H - 4]], 2.2, K.pageEdge, 0.3, 0.5);  // page edge peeking
    } else {                                                          // flipped to the left: cover inside + left page
      T.shape(cv, K.cover, clw, { jitter: 1 });
      if (cw > 12) {                                                  // left page only once it has some width
        const lp = [[sx, topAt(sx) + 4], [ex + 3, -H * bulge + 3], [ex + 3, H * bulge - 3], [sx, H]];
        const Lp = T.shape(lp, K.page, T.lerp(2, 3.2, T.clamp((cw - 12) / 16)), { jitter: 0.7 });
        clipped(Lp, () => T.fillPts(shift(Lp, W * 0.78, 0), T.rgba('#D8CCB4', 0.35)));
        faded(details, [ex - 4, -H - 6, sx + 2, H + 6], () => pageLines(sx - 3, ex + 4, -H + 2, 5, 3));
      }
    }
    T.stroke([[sx, -H + 4], [sx, H]], 2.6, T.shade(K.cover, 0.35), 0.3, 0.6);   // spine / gutter line
    g.restore();
  });

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
  P.crumbs = budget('crumbs', 9, (x, y, t0, t, seed = 1) => {
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
  });

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
    clippedAll(J, () => {
      oval(6, 34, 70, 22, K.cloudShade);
      CLOUD_PARTS.slice(0, 4).forEach(([px, py, r]) => oval(px - r * 0.25, py - r * 0.35, r * 0.55, r * 0.35, K.cloudHi, -0.3));
    });
    // grumbly squiggle on the belly
    T.stroke([[-18, 22], [-10, 18], [-2, 23], [6, 18], [14, 23]], 2.6, T.shade(K.cloud, 0.35), 0.5, 0.6);
    g.restore();
  };

  // ─────────────────────────── poof ───────────────────────────
  // One cloud of overlapping puffs: pops (back-eased), then shrinks while the whole cel fades
  // (alpha → 0 and line width → 0 over u .65–1) so it never breaks into separate little circles.
  P.poof = budget('poof', 16, (x, y, s = 1, u = 0) => {
    if (u <= 0 || u >= 1) return;
    const g = begin(x, y, s);
    const grow = u < 0.28 ? T.E.back(u / 0.28) : 1 - T.E.in((u - 0.28) / 0.72);
    // ring radius grows only early and is capped by the puff size, so neighbours always overlap
    const R = Math.min(16 + 30 * T.E.out(T.clamp(u / 0.35)), 34 * grow);
    const fade = 1 - T.smooth(0.65, 1, u);
    const lw = 4.4 * (1 - 0.3 * T.clamp(u / 0.65)) * fade;
    // flash star at the very start
    if (u < 0.3) T.star4(0, 0, 70 * (1 - u / 0.3) + 10, 0.4, C.PAPER, 3);
    faded(fade, [-100, -100, 100, 90], () => {
      const parts = [];
      for (let i = 0; i < 7; i++) {
        const a = i / 7 * TAU + 0.4, r = Math.max(0.5, (22 + 10 * T.hash(i * 2.3)) * grow);
        parts.push(T.ell(Math.cos(a) * R, Math.sin(a) * R * 0.8 - 8 * u, r, r * 0.9, 16));
      }
      parts.push(T.ell(0, -6 * u, Math.max(0.5, 30 * grow), Math.max(0.5, 26 * grow), 18));
      const J = union(parts, K.smokeShade, lw, 1);                    // whole cloud in shade first …
      clippedAll(J, () => J.forEach(p => T.fillPts(shift(p, -4 * grow, -5 * grow), K.smoke)));   // … lit copy up-left
    });
    // speed ticks flying out
    if (u < 0.75) for (let i = 0; i < 6; i++) {
      const a = i / 6 * TAU + 0.1, r0 = R + 30 + 40 * u, r1 = r0 + 22 * (1 - u);
      T.stroke([[Math.cos(a) * r0, Math.sin(a) * r0 * 0.85], [Math.cos(a) * r1, Math.sin(a) * r1 * 0.85]], 4 * (1 - u), INK, 0.8, 0.5);
    }
    g.restore();
  });

  // ─────────────────────────── sparkles ───────────────────────────
  // Stars pop from zero (back-eased over u 0–.15) while flying out, and are never bigger than the gap
  // to their neighbours, so the first frames read as a burst, not a knot.
  P.sparkleBurst = budget('sparkleBurst', (x, y, u, n = 8) => 2 * n, (x, y, u, n = 8, R = 130, color = C.gold) => {
    if (u <= 0 || u >= 1) return;
    const g = c(); g.save();
    const r = R * T.E.out(u), k = Math.pow(1 - u, 0.8), pop = Math.max(0, T.E.back(T.clamp(u / 0.15)));
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU + 0.3, big = i % 2 === 0, rr = r * (big ? 1 : 0.78);
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr * 0.85;
      const gap = 2 * rr * Math.sin(Math.PI / n) * 0.45 + 1;                  // just under half the spacing to the next star
      const size = Math.min(((big ? 20 : 12) * k + 3) * pop, gap);
      if (u < 0.45) {                                                   // streak from the centre early on
        const r0 = rr * 0.45; T.stroke([[x + Math.cos(a) * r0, y + Math.sin(a) * r0 * 0.85], [px, py]], 3.2 * (1 - u / 0.45) * pop, color === C.PAPER ? INK : color, 0.9, 0.4);
      }
      if (size > 0.8) T.star4(px, py, size, u * 3 + i, color, Math.min(3, size * 0.3));
      if (big) dot(x + Math.cos(a + 0.35) * rr * 0.72, y + Math.sin(a + 0.35) * rr * 0.62, 3.5 * k * pop, INK);
    }
    g.restore();
  });

  // ─────────────────────────── hearts ───────────────────────────
  P.hearts = budget('hearts', 3, (x, y, u) => {
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
  });

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
  P.speechBubble = budget('speechBubble', 2, (spec) => {
    const g = c(), px = spec.px || 54, lh = px * 1.08, padX = px * 0.7, padY = px * 0.5;
    const lines = spec.lines && Array.isArray(spec.lines) ? spec.lines : String(spec.text || '').split('\n');
    g.save(); g.font = T.FONT(px);
    const tw = Math.max(...lines.map(l => g.measureText(l).width), px);
    const w = Math.max(spec.w || 0, tw + padX * 2), h = lines.length * lh + padY * 2;
    const x0 = spec.x - w / 2, y0 = spec.y - h / 2;
    const tip = spec.tail || [spec.x, y0 + h + 60], sc = spec.scale ?? 1;
    const shout = spec.style === 'shout', lw = 4.6;
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
    // outer bounds of everything inked (at scale 1): points + jitter + line width
    let ox0 = 1e9, oy0 = 1e9, ox1 = -1e9, oy1 = -1e9;
    body.concat(tail).forEach(([qx, qy]) => { ox0 = Math.min(ox0, qx); oy0 = Math.min(oy0, qy); ox1 = Math.max(ox1, qx); oy1 = Math.max(oy1, qy); });
    const m = lw * 1.3 + 1.5;
    const box = { x0, y0, w, h, outer: { x0: ox0 - m, y0: oy0 - m, w: ox1 - ox0 + 2 * m, h: oy1 - oy0 + 2 * m } };
    if (sc <= 0.01) { g.restore(); return box; }
    g.translate(tip[0], tip[1]); g.scale(sc, sc); g.translate(-tip[0], -tip[1]);
    const Jb = T.J(body, 1.2), Jt = T.J(tail, 1);
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
  });

  // ─────────────────────────── motion lines ───────────────────────────
  P.motionLines = budget('motionLines', 4, (pts, u = 1) => {
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
  });
})();
