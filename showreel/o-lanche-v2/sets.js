// sets.js — the park set for "O Lanche" v2: a late-afternoon park painted in flat 90s TV-cartoon
// background style.  Loaded after core.js / props.js; exposes T.sets.
//
//   T.sets.WORLD                       layout numbers (ground, path, bench, character marks, REF camera)
//   T.sets.drawBackground(t, cam)      sky → sun → clouds → birds → far hills/town → mid hills/houses →
//                                      near hills/fence → lawn + big tree → bushes → path + lamp.
//                                      Call in SCREEN space (identity transform, or identity + camera shake),
//                                      NOT inside the world camera: each layer sets its own parallax camera.
//   T.sets.drawBench(t)                the bench (+ its cast shadow), in WORLD coords inside the main camera.
//   T.sets.drawForeground(t, cam)      out-of-focus grass tufts & daisies in front of everything (screen space).
//   T.sets.layerTransform(cam, f)      applies the parallax transform of a layer with depth factor f to T.ctx
//                                      (f = 1 is the main world camera).  Caller save()/restore()s.
//
// cam = {cx, cy, z} (an array [cx, cy, z] is accepted too).
// Parallax: a layer with factor f sees camera  c_f = REF + (cam − REF)·f  and zoom  REF.z·(cam.z/REF.z)^f,
// so at the REF (establishing wide) camera every layer lines up exactly as painted here.
// Depth of field: when cam.z > 1.8 the far layers are rendered to an offscreen buffer and blurred
// (up to 6px for the sky/far hills, less for nearer layers; the foreground is blurred too).
// Background art is a static painting: its wobbly lines never boil (seeded per layer, not per frame).
'use strict';
(function () {
  const T = window.TOON, C = T.C, TAU = T.TAU;
  const S = T.sets = {};

  const WORLD = S.WORLD = {
    ground: 860, pathTop: 830, pathBot: 975, grassTop: 770,
    seatTop: 740, benchX0: 850, benchX1: 1390, backTop: 600, backBot: 676, hip: 740,
    leoStandX: 760, leoSitX: 945, biaSitX: 1240, dogX: 1095, dogY: 905,
    treeX: 380, lampX: 1705,
    REF: { cx: 1010, cy: 590, z: 1.22 },
  };
  const REF = WORLD.REF;

  // ── set palette (warm late-afternoon light from the upper left) ──
  const K = S.COLORS = {
    sky0: '#5DB3DC', sky1: '#94CFE6', sky2: '#D9EBDD', sky3: '#FBE5BE', sky4: '#FFD39C',
    streak: '#FFF1DE',
    sunCore: '#FFF6D2', sun: '#FFE38F', sunShade: '#FFD06A', sunRim: '#F4B25C', glow: '255,232,160',
    cloud: '#FFF9F1', cloudShade: '#F6D8CF', cloudLine: '#E5BDB6', cloudHi: '#FFFFFF',
    bird: '#5B4B66',
    far0: '#BCD9C8', far0Line: '#A3C6B4', far1: '#AED4A8', far1Line: '#93BE91', farTree: '#9DC79B',
    townWall: '#E8E2D0', townWall2: '#F1D9C4', townRoof: '#C6A9A5', townRoof2: '#A9B7C9', townLine: '#9DB6AB',
    mid: '#A7D08A', midLine: '#86B270', midTree: '#7EB96A', midTreeLine: '#5F9A55',
    houseLine: '#6D5E6E', glass: '#FFE7A3', frame: '#FFF8EA',
    near: '#97C676', nearLine: '#74A95C', nearTree: '#6CAE5C', nearTreeHi: '#86C46C',
    fence: '#D8B489', fenceLine: '#8E6E52',
    grass: C.grass, grassDark: C.grassDark, grassLight: '#A2D07C', lawnLine: '#6FA84F',
    bgInk: '#3C4A3A',
    bark: '#8A5A3B', barkShade: '#6B4430', barkHi: '#A8744D',
    leaf: '#5FA85A', leafShade: '#4A8F4C', leafDeep: '#3F7D45', leafHi: '#80C266', fruit: '#E85D3F',
    bush: '#6DB35E', bushShade: '#569C4E', bushHi: '#8ECA74', blossom: '#F59AB4', blossom2: '#FFF4E6',
    path: '#EBD5A6', pathShade: '#DEC28F', pathHi: '#F6E6C3', pathLine: '#BE9B69', pebble: '#D0AF7C', pebbleHi: '#F3E2BD',
    front: '#7FBA5C', frontDark: '#62A046',
    iron: '#3D4F59', ironHi: '#5E7580', lampGlass: '#FFF0B5',
    wood: C.wood, woodDark: C.woodDark, woodHi: '#DDA66B', grain: '#A8703E',
  };

  // ───────────────────────── static "painted" line helpers ─────────────────────────
  // Same look as core's T.shape/T.ink, but the wobble is seeded per layer (SEED) instead of per frame,
  // so the background never boils and never changes when something else is drawn first.
  let SEED = 0, HAZE = 0;
  // atmospheric perspective: every colour drawn in a layer is mixed toward the horizon haze by HAZE
  const HAZE_RGB = [246, 232, 206], hzCache = new Map();
  function hz(col) {
    if (!HAZE || typeof col !== 'string') return col;
    const key = col + HAZE; let v = hzCache.get(key); if (v) return v;
    let r, g, b, a = 1;
    if (col[0] === '#') { const n = parseInt(col.slice(1), 16); r = n >> 16; g = (n >> 8) & 255; b = n & 255; }
    else { const m = col.match(/[\d.]+/g).map(Number); [r, g, b] = m; if (m.length > 3) a = m[3]; }
    const f = (c, i) => Math.round(c + (HAZE_RGB[i] - c) * HAZE);
    v = `rgba(${f(r, 0)},${f(g, 1)},${f(b, 2)},${a})`; hzCache.set(key, v); return v;
  }
  const wob = (pts, amp = 1) => { const s = ++SEED; return amp ? pts.map(([x, y], i) => [x + (T.hash(i * 1.7 + s * 7.31) - .5) * 2 * amp, y + (T.hash(i * 2.9 + s * 3.17 + 5) - .5) * 2 * amp]) : pts; };
  const ink = (P, lw, col, closed = true) => { const s = SEED * 3.7; T.ribbon(P, closed, (i) => lw * (0.75 + 0.5 * T.vnoise(s + i * 0.45)), hz(col)); };
  const fill = (P, col) => T.fillPts(P, hz(col));
  function shape(pts, col, lw = 0, line = K.bgInk, amp = 1) { const P = wob(pts, amp); if (col) fill(P, col); if (lw > 0) ink(P, lw, line); return P; }
  function stroke(pts, lw, col, taper = 0.7, amp = 0.6) {
    const P = wob(pts, amp), s = SEED * 2.3;
    T.ribbon(P, false, (i, n) => { const u = n > 1 ? i / (n - 1) : .5; return lw * (1 - taper * Math.pow(Math.abs(2 * u - 1), 2.5)) * (0.8 + 0.4 * T.vnoise(s + i * .6)); }, hz(col));
  }
  // several blobs → one silhouette with a single merged outline (ink all at 2x width, then fill all)
  function union(list, col, lw, line, amp = 1) { const P = list.map(p => wob(p, amp)); if (lw > 0) P.forEach(p => ink(p, lw * 2, line)); P.forEach(p => fill(p, col)); return P; }
  function clipTo(P, fn) { const c = T.ctx; c.save(); c.beginPath(); P.forEach(p => { p.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath(); }); c.clip(); fn(); c.restore(); }
  const shift = (pts, dx, dy) => pts.map(([x, y]) => [x + dx, y + dy]);
  const oval = (x, y, rx, ry, col, rot = 0) => { const c = T.ctx; c.fillStyle = hz(col); c.beginPath(); c.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU); c.fill(); };
  const H = T.hash;
  // soft cast shadow without a (slow, CPU) blur filter: stack 5 translucent copies grown/shrunk by ±soft px
  function softShadow(pts, alpha = 1, soft = 5) {
    const c = T.ctx, N = 5; let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    pts.forEach(([x, y]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); });
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hw = Math.max(1, (x1 - x0) / 2), hh = Math.max(1, (y1 - y0) / 2);
    c.save(); c.globalAlpha *= alpha / N * 1.6;
    for (let i = 0; i < N; i++) {
      const d = soft * (1 - 2 * i / (N - 1)), sx = Math.max(0.05, 1 + d / hw), sy = Math.max(0.05, 1 + d / hh);
      T.fillPts(pts.map(([x, y]) => [cx + (x - cx) * sx, cy + (y - cy) * sy]), T.C.shadow);
    }
    c.restore();
  }


  // ───────────────────────── camera / parallax / depth of field ─────────────────────────
  const normCam = cam => !cam ? { ...REF } : Array.isArray(cam) ? { cx: cam[0], cy: cam[1], z: cam[2] } : cam;
  const layerCam = (cam, f) => ({ cx: REF.cx + (cam.cx - REF.cx) * f, cy: REF.cy + (cam.cy - REF.cy) * f, z: REF.z * Math.pow(cam.z / REF.z, f) });
  S.layerTransform = (cam, f) => { const L = layerCam(normCam(cam), f), c = T.ctx; c.translate(T.W / 2, T.H / 2); c.scale(L.z, L.z); c.translate(-L.cx, -L.cy); return L; };
  // draw fn inside the parallax camera of depth factor f; `seed` pins the layer's line wobble
  function layer(cam, f, seed, fn, haze = 0) { const c = T.ctx; c.save(); const L = S.layerTransform(cam, f); SEED = seed; HAZE = haze; fn(L); HAZE = 0; c.restore(); }
  // depth-of-field strength 0..1 (0 until z = 1.8, full at z = 3.2)
  const dofK = cam => T.clamp((cam.z - 1.8) / 1.4);
  // Render fn into an offscreen buffer (same base transform, with a margin so edges blur against real
  // content), blur it and composite.  Blurred art needs little resolution, so strong blurs are rendered
  // at 1/2 or 1/3 scale — several times cheaper on the CPU rasteriser used by headless rendering.
  const BUF = {}; const MARGIN = 30;
  const buf = (key, w, h) => { let b = BUF[key]; if (!b || b.width !== w || b.height !== h) { b = BUF[key] = document.createElement('canvas'); b.width = w; b.height = h; } return b; };
  function blurred(px, fn) {
    const main = T.ctx, m = main.getTransform();
    px *= Math.hypot(m.a, m.b);
    if (px < 0.25 || typeof document === 'undefined') { fn(); return; }
    const r = px > 3 ? 1 / 3 : px > 1.2 ? 1 / 2 : 1;
    const W = main.canvas.width + MARGIN * 2, Hh = main.canvas.height + MARGIN * 2, w = Math.ceil(W * r), h = Math.ceil(Hh * r);
    const A = buf('a' + r, w, h), B = buf('b' + r, w, h), a = A.getContext('2d'), b = B.getContext('2d');
    a.setTransform(1, 0, 0, 1, 0, 0); a.clearRect(0, 0, w, h);
    a.setTransform(m.a * r, m.b * r, m.c * r, m.d * r, (m.e + MARGIN) * r, (m.f + MARGIN) * r);
    T.ctx = a;
    try { fn(); } finally { T.ctx = main; }
    b.setTransform(1, 0, 0, 1, 0, 0); b.clearRect(0, 0, w, h);
    b.filter = `blur(${(px * r).toFixed(2)}px)`; b.drawImage(A, 0, 0); b.filter = 'none';
    main.save(); main.setTransform(1, 0, 0, 1, 0, 0); main.imageSmoothingEnabled = true; main.imageSmoothingQuality = 'low';
    main.drawImage(B, 0, 0, w, h, -MARGIN, -MARGIN, w / r, h / r); main.restore();
  }

  // ───────────────────────── sky, sun, clouds, birds ─────────────────────────
  function sky() {
    const c = T.ctx, g = c.createLinearGradient(0, -60, 0, 720);
    g.addColorStop(0, K.sky0); g.addColorStop(0.3, K.sky1); g.addColorStop(0.55, K.sky2); g.addColorStop(0.8, K.sky3); g.addColorStop(1, K.sky4);
    c.fillStyle = g; c.fillRect(-4000, -3000, 10000, 8000);
    // thin sunset streaks (painted cirrus)
    c.save(); c.globalAlpha = 0.55;
    [[1180, 380, 190, 5], [1420, 402, 120, 4], [300, 420, 150, 4.5], [1650, 350, 110, 3.5], [860, 440, 90, 3]].forEach(([x, y, rx, ry]) => {
      shape(T.ell(x, y, rx, ry, 24).map(([px, py]) => [px, py + Math.pow((px - x) / rx, 2) * 4]), K.streak, 0, 0, 0.6);
    });
    c.restore();
  }
  function sun() {
    const c = T.ctx, x = 620, y = 222;
    const g = c.createRadialGradient(x, y, 40, x, y, 340);
    g.addColorStop(0, `rgba(${K.glow},0.75)`); g.addColorStop(0.35, `rgba(${K.glow},0.28)`); g.addColorStop(1, `rgba(${K.glow},0)`);
    c.fillStyle = g; c.fillRect(x - 360, y - 360, 720, 720);
    // flat painted halo rings (very 90s)
    oval(x, y, 122, 122, 'rgba(255,246,214,0.28)'); oval(x, y, 92, 92, 'rgba(255,244,205,0.4)');
    const D = shape(T.ell(x, y, 60, 60, 36), K.sun, 0, 0, 0.4);
    clipTo([D], () => { oval(x + 18, y + 20, 60, 58, K.sunShade); oval(x - 6, y - 6, 56, 55, K.sun); oval(x - 18, y - 20, 22, 18, K.sunCore, -0.6); });
    ink(D, 2.6, K.sunRim);
  }
  const CLOUDS = [                                                        // x, y, scale, drift px/s
    [120, 250, 1.1, 6], [1010, 215, 0.85, 4.5], [1560, 300, 0.6, 8], [1850, 200, 1.0, 5], [380, 370, 0.42, 9],
  ];
  const PUFFS = [[-96, 6, 28], [-62, -12, 40], [-20, -32, 50], [30, -26, 46], [70, -8, 38], [100, 6, 26]];
  function cloud(x, y, s) {
    const parts = PUFFS.map(([dx, dy, r]) => T.ell(x + dx * s, y + dy * s, r * s, r * s * 0.86, 22));
    parts.push(T.ell(x, y + 8 * s, 118 * s, 20 * s, 26));                       // flat-ish base
    const P = union(parts, K.cloud, 1.6, K.cloudLine, 0.8 * s);
    clipTo(P, () => {
      shape(T.rrectPts(x - 140 * s, y + 4 * s, 280 * s, 40 * s, 10 * s).map(([px, py]) => [px, py - 4 * s * Math.sin(px * 0.05 / s)]), K.cloudShade, 0, 0, 0.5);
      PUFFS.slice(1, 5).forEach(([dx, dy, r]) => oval(x + (dx - r * 0.3) * s, y + (dy - r * 0.35) * s, r * 0.42 * s, r * 0.26 * s, K.cloudHi, -0.35));
    });
  }
  function clouds(t) { CLOUDS.forEach(([x, y, s, v]) => cloud(x + t * v, y, s)); }
  function birds(t) {
    const flock = (t0, t1, x0, x1, y0, n, sz) => {
      if (t < t0 || t > t1) return;
      const u = (t - t0) / (t1 - t0);
      for (let i = 0; i < n; i++) {
        const bx = T.lerp(x0, x1, u) - i * 58 * Math.sign(x1 - x0), by = y0 + i * 22 + Math.sin(t * 2.2 + i) * 8;
        const f = Math.sin(t * 17 + i * 2.1) * 9 * sz;
        stroke([[bx - 17 * sz, by - f], [bx - 7 * sz, by - 3 * sz - f * 0.3], [bx, by + 2], [bx + 7 * sz, by - 3 * sz - f * 0.3], [bx + 17 * sz, by - f]], 3.4 * sz, K.bird, 0.8, 0.3);
      }
    };
    flock(0, 6, -150, 2100, 250, 3, 1);
    flock(8.5, 15, 2000, 700, 175, 2, 0.75);
  }

  // ───────────────────────── hills, town, houses ─────────────────────────
  const hillY = (x, base, amp, f, ph) => base - amp * Math.sin(x * f + ph) - amp * 0.45 * Math.sin(x * f * 2.3 + ph * 1.7) - amp * 0.18 * Math.sin(x * f * 5.1 + ph * 0.3);
  function hill(h, col, line, lw) {
    const top = []; for (let x = -1400; x <= 3400; x += 30) top.push([x, hillY(x, ...h)]);
    const P = wob(top.concat([[3400, 2400], [-1400, 2400]]), 0.8);
    fill(P, col);
    ink(P.slice(0, top.length), lw, line, false);
    return P;
  }
  const FAR0 = [582, 26, 0.0031, 0.7], FAR1 = [626, 20, 0.0046, 2.2], MID = [670, 22, 0.0027, 3.9], NEAR = [722, 14, 0.0021, 5.3];

  // distant hazy town silhouettes (no windows: too far)
  function townBit(x, by, w, h, wall, roof, kind) {
    const lw = 1.3, L = K.townLine;
    if (kind === 'steeple') {
      shape([[x - w / 2, by], [x + w / 2, by], [x + w / 2, by - h], [x - w / 2, by - h]], wall, lw, L, 0.3);
      shape([[x - w / 2 - 2, by - h], [x, by - h - w * 1.6], [x + w / 2 + 2, by - h]], roof, lw, L, 0.3);
      return;
    }
    if (kind === 'tower') {                                                // water tower
      [-0.3, 0.3].forEach(k => stroke([[x + w * k, by], [x + w * k * 0.6, by - h * 0.6]], 1.6, L, 0, 0.2));
      shape(T.rrectPts(x - w / 2, by - h, w, h * 0.42, 5, 3), wall, lw, L, 0.3);
      shape([[x - w / 2 - 2, by - h], [x, by - h - w * 0.35], [x + w / 2 + 2, by - h]], roof, lw, L, 0.3);
      return;
    }
    shape([[x - w / 2, by], [x + w / 2, by], [x + w / 2, by - h], [x - w / 2, by - h]], wall, lw, L, 0.3);
    shape([[x - w / 2 - 3, by - h + 1], [x, by - h - w * 0.45], [x + w / 2 + 3, by - h + 1]], roof, lw, L, 0.3);
  }
  function farHills() {
    hill(FAR0, K.far0, K.far0Line, 2);
    // hazy town on the farthest ridge
    [[330, 26, 16, 0, 0, 'h'], [362, 20, 13, 1, 1, 'h'], [405, 12, 30, 0, 0, 'steeple'], [440, 24, 15, 1, 0, 'h'],
     [1310, 22, 14, 0, 1, 'h'], [1345, 28, 18, 1, 0, 'h'], [1390, 24, 44, 0, 1, 'tower'], [1440, 20, 12, 0, 0, 'h'], [1470, 26, 16, 1, 1, 'h'],
     [1760, 22, 14, 1, 0, 'h'], [1795, 18, 12, 0, 1, 'h']].forEach(([x, w, h, wi, ri, kind]) =>
      townBit(x, hillY(x, ...FAR0) + 6, w, h, wi ? K.townWall2 : K.townWall, ri ? K.townRoof2 : K.townRoof, kind));
    hill(FAR1, K.far1, K.far1Line, 2);
    for (let i = 0; i < 26; i++) {                                         // tiny round trees along the ridge
      const x = -300 + i * 97 + H(i * 5.1) * 50, r = 7 + H(i * 2.7) * 7;
      if (H(i * 9.9) < 0.3) continue;
      const y = hillY(x, ...FAR1) + 2;
      shape(T.ell(x, y - r * 0.9, r, r * 1.05, 14), K.farTree, 1.2, K.far1Line, 0.4);
    }
  }
  // a little 90s cartoon house: front gable + shaded side wall & roof plane going back to the right
  function house(x, by, w, h, wall, roof, opts = {}) {
    const L = K.houseLine, lw = 2.1, sd = w * 0.34, rise = sd * 0.3, rh = w * 0.42;
    const apex = [x, by - h - rh];
    shape([[x + w / 2, by], [x + w / 2 + sd, by - rise], [x + w / 2 + sd, by - h - rise], [x + w / 2, by - h]], T.shade(wall, 0.2), lw, L, 0.5);
    if (opts.chimney) shape([[x + w * 0.42, by - h - rh * 0.55], [x + w * 0.42, by - h - rh - 8], [x + w * 0.58, by - h - rh - 8], [x + w * 0.58, by - h - rh * 0.35]], '#B7705E', lw, L, 0.4);
    shape([apex, [apex[0] + sd, apex[1] - rise], [x + w / 2 + sd + 5, by - h - rise + 3], [x + w / 2 + 5, by - h + 3]], T.shade(roof, 0.12), lw, L, 0.5);
    const F = shape([[x - w / 2, by], [x + w / 2, by], [x + w / 2, by - h], apex, [x - w / 2, by - h]], wall, lw, L, 0.5);
    clipTo([F], () => oval(x - w * 0.35, by - h * 0.6, w * 0.35, h * 0.9, T.tint(wall, 0.18)));     // warm light on the left
    stroke([[x - w / 2 - 6, by - h + 5], apex, [x + w / 2 + 6, by - h + 5]], 6, roof, 0.1, 0.4);      // roof fascia
    ink(wob([[x - w / 2 - 6, by - h + 8], [apex[0], apex[1] - 3], [x + w / 2 + 6, by - h + 8]], 0.3), 1.6, L, false);
    // windows (warm late-afternoon glass), door, attic window
    const win = (wx, wy, ww, wh) => {
      shape(T.rrectPts(wx - ww / 2 - 2, wy - wh / 2 - 2, ww + 4, wh + 4, 2, 2), K.frame, lw * 0.8, L, 0.3);
      shape(T.rrectPts(wx - ww / 2, wy - wh / 2, ww, wh, 1.5, 2), K.glass, 0, L, 0.2);
      stroke([[wx, wy - wh / 2], [wx, wy + wh / 2]], 1.3, K.frame, 0, 0.1);
    };
    const floors = opts.floors || 1, fh = h / floors;
    for (let f = 0; f < floors; f++) {
      const wy = by - fh * f - fh * 0.55;
      if (f === 0 && !opts.noDoor) {
        shape([[x - w * 0.12, by], [x - w * 0.12, by - fh * 0.68], [x + w * 0.12, by - fh * 0.68], [x + w * 0.12, by]], opts.door || T.shade(roof, 0.1), lw * 0.8, L, 0.3);
        win(x - w * 0.32, wy, w * 0.17, fh * 0.3); win(x + w * 0.32, wy, w * 0.17, fh * 0.3);
      } else { win(x - w * 0.25, wy, w * 0.2, fh * 0.34); win(x + w * 0.25, wy, w * 0.2, fh * 0.34); }
    }
    shape(T.ell(x, by - h - rh * 0.42, w * 0.07, w * 0.07, 12), K.glass, lw * 0.8, L, 0.2);
    // side-wall window (shaded)
    shape([[x + w / 2 + sd * 0.3, by - h * 0.62], [x + w / 2 + sd * 0.7, by - h * 0.62 - rise * 0.4], [x + w / 2 + sd * 0.7, by - h * 0.3 - rise * 0.4], [x + w / 2 + sd * 0.3, by - h * 0.3]], T.shade(K.glass, 0.12), lw * 0.7, L, 0.2);
  }
  function roundTree(x, by, r, col, line, lw = 1.8, trunkCol = '#8C6A55') {
    stroke([[x, by], [x, by - r * 1.1]], r * 0.28, trunkCol, 0.1, 0.3);
    const P = union([T.ell(x, by - r * 1.5, r, r * 0.95, 18), T.ell(x - r * 0.55, by - r * 1.2, r * 0.6, r * 0.55, 14), T.ell(x + r * 0.55, by - r * 1.25, r * 0.62, r * 0.55, 14)], col, lw, line, 0.5);
    clipTo(P, () => { oval(x + r * 0.35, by - r * 1.0, r * 0.9, r * 0.6, T.shade(col, 0.12)); oval(x - r * 0.35, by - r * 1.85, r * 0.45, r * 0.3, T.tint(col, 0.22), -0.4); });
  }
  function picket(x0, x1, by, hgt, col, line) {
    stroke([[x0, by - hgt * 0.35], [x1, by - hgt * 0.35 - 1]], 2, col, 0, 0.3);
    stroke([[x0, by - hgt * 0.72], [x1, by - hgt * 0.72 - 1]], 2, col, 0, 0.3);
    for (let x = x0; x <= x1; x += 10) shape([[x - 2, by], [x - 2, by - hgt], [x, by - hgt - 3], [x + 2, by - hgt], [x + 2, by]], col, 0.9, line, 0.2);
  }
  const HOUSES = [                        // x, width, height, wall, roof, opts
    [430, 74, 46, '#F4B183', '#A45A4A', { chimney: 1 }],
    [540, 58, 70, '#EFE4CC', '#5F7FA8', { floors: 2 }],
    [650, 68, 44, '#F6D66E', '#B8574A', {}],
    [1428, 70, 46, '#EDA396', '#6E5A7E', { chimney: 1 }],
    [1545, 62, 66, '#A5D4C3', '#B8574A', { floors: 2 }],
    [1660, 72, 44, '#F4C48E', '#5F7FA8', {}],
    [1775, 60, 48, '#E4D6F0', '#A45A4A', { chimney: 1 }],
  ];
  function midHills() {
    hill(MID, K.mid, K.midLine, 2.4);
    // lollipop trees behind/between houses
    [[370, 16], [488, 12], [600, 14], [715, 15], [1372, 15], [1488, 12], [1605, 14], [1720, 13], [1840, 16], [260, 13], [1950, 14]].forEach(([x, r]) =>
      roundTree(x, hillY(x, ...MID) + 8, r, K.midTree, K.midTreeLine, 1.6));
    HOUSES.forEach(([x, w, h, wall, roof, o]) => house(x, hillY(x, ...MID) + 12, w, h, wall, roof, o));
    // white picket fences in front of the houses
    [[395, 690], [1392, 1810]].forEach(([a, b]) => picket(a, b, hillY((a + b) / 2, ...MID) + 20, 10, '#F4EEE2', '#B9AEA8'));
  }
  function nearHills() {
    const P = hill(NEAR, K.near, K.nearLine, 2.6);
    clipTo([P], () => {                                                    // soft lit band along the crest
      const top = []; for (let x = -1400; x <= 3400; x += 40) top.push([x, hillY(x, ...NEAR) + 3]);
      fill(top.concat(top.slice().reverse().map(([x, y]) => [x, y + 16])), T.tint(K.near, 0.14));
    });
    // split-rail fence running along the near hill (right side) and a bit on the left
    const fence = (x0, x1) => {
      const yAt = x => hillY(x, ...NEAR) + 26;
      [0.35, 0.72].forEach(k => stroke(Array.from({ length: 9 }, (_, i) => { const x = T.lerp(x0, x1, i / 8); return [x, yAt(x) - 30 * k]; }), 4.2, K.fence, 0, 0.4));
      for (let x = x0; x <= x1 + 1; x += 70) shape(T.rrectPts(x - 3.5, yAt(x) - 36, 7, 38, 2, 2), K.fence, 1.6, K.fenceLine, 0.3);
    };
    fence(1180, 2300); fence(-400, 600);
    // two big round trees on the near hill
    [[690, 38], [1610, 44], [-120, 40], [2150, 42]].forEach(([x, r]) => roundTree(x, hillY(x, ...NEAR) + 16, r, K.nearTree, K.nearLine, 2.2, '#8A6450'));
  }

  // ───────────────────────── park lawn, big tree, bushes ─────────────────────────
  function grassTicks(x0, x1, y0, y1, n, seed, col, len = 12) {
    for (let i = 0; i < n; i++) {
      const x = T.lerp(x0, x1, H(seed + i * 1.37)), y = T.lerp(y0, y1, H(seed + i * 2.71)), l = len * (0.6 + 0.8 * H(seed + i * 0.73));
      const lean = (H(seed + i * 5.3) - 0.5) * 0.6;
      stroke([[x, y], [x + lean * l, y - l]], 2.4, col, 0.9, 0.2);
      stroke([[x + 5, y + 1], [x + 5 + lean * l * 0.7 + 2, y - l * 0.7]], 2.2, col, 0.9, 0.2);
    }
  }
  function lawn() {
    const top = []; for (let x = -1400; x <= 3400; x += 40) top.push([x, 752 + 5 * Math.sin(x * 0.006 + 1) + 3 * Math.sin(x * 0.017)]);
    const P = wob(top.concat([[3400, 2400], [-1400, 2400]]), 0.6);
    fill(P, K.grass);
    ink(P.slice(0, top.length), 2.4, K.lawnLine, false);
    // painted light pools & shade bands on the lawn
    clipTo([P], () => {
      oval(1000, 764, 900, 12, T.tint(K.grass, 0.12));
      oval(420, 815, 260, 22, T.shade(K.grass, 0.08));
    });
    grassTicks(-400, 2400, 768, 832, 120, 11, T.rgba(K.grassDark, 0.55));
    grassTicks(-400, 2400, 764, 820, 50, 71, T.rgba(K.grassLight, 0.7), 9);
    // little flower patches on the lawn
    [[560, 800], [640, 818], [1545, 806], [1620, 820], [1180, 790], [130, 822]].forEach(([x, y], j) => {
      for (let i = 0; i < 5; i++) {
        const fx = x + (H(j * 7 + i) - 0.5) * 60, fy = y + (H(j * 3 + i * 1.3) - 0.5) * 16, col = [K.blossom2, '#FFD85A', K.blossom][(i + j) % 3];
        for (let p = 0; p < 5; p++) oval(fx + Math.cos(p / 5 * TAU) * 3, fy + Math.sin(p / 5 * TAU) * 2.4, 2.4, 2, col);
        oval(fx, fy, 1.6, 1.4, '#F2A93B');
      }
    });
  }
  function bigTree(t) {
    const x = WORLD.treeX, by = 812, INKC = K.bgInk;
    // long soft shadow falling to the right (sun upper-left)
    softShadow(T.ell(x + 190, by + 6, 250, 18, 30), 0.55, 6);
    // trunk with root flare and two main branches
    const trunk = [[x - 62, by + 6], [x - 34, by - 14], [x - 28, by - 120], [x - 30, by - 250], [x - 62, by - 330], [x - 110, by - 380], [x - 92, by - 396],
      [x - 40, by - 350], [x - 6, by - 318], [x + 20, by - 346], [x + 70, by - 404], [x + 92, by - 392], [x + 44, by - 330], [x + 28, by - 250], [x + 28, by - 120], [x + 36, by - 14], [x + 70, by + 6]];
    const Tk = shape(T.chaikin(trunk, 2), K.bark, 0, INKC, 1.2);
    clipTo([Tk], () => {
      fill(shift(Tk, 14, 0), K.barkShade); fill(shift(Tk, 6, 0).map(([px, py]) => [px - (px - x) * 0.1, py]), K.bark);
      fill(shift(Tk, -20, 0).map(([px, py]) => [x - 26 + (px - x) * 0.25, py]), K.barkHi);
    });
    ink(Tk, 3.2, INKC);
    [[x - 6, by - 60, 26], [x + 8, by - 150, 30], [x - 4, by - 240, 22]].forEach(([bx, bY, l]) => stroke([[bx, bY], [bx + 3, bY - l * 0.5], [bx + 1, bY - l]], 2.4, K.barkShade, 0.8, 0.5));
    shape(T.ell(x + 8, by - 110, 6, 9, 12), K.barkShade, 2, INKC, 0.3);                       // knot hole
    // canopy: shade mass, then mid mass, then lit clumps on the upper-left
    const sway = Math.sin(t * 0.9) * 2;
    const clumps = [[x - 150, by - 450, 88], [x - 70, by - 540, 104], [x + 50, by - 568, 108], [x + 160, by - 500, 96], [x + 200, by - 420, 70],
      [x - 200, by - 390, 64], [x - 60, by - 430, 90], [x + 80, by - 435, 96], [x - 10, by - 630, 76], [x + 120, by - 610, 70], [x - 140, by - 560, 66]];
    const canopy = union(clumps.map(([cx, cy, r], i) => T.ell(cx + sway * (1 - (cy - by + 600) / 400), cy, r, r * 0.9, 24)), K.leaf, 3.2, INKC, 1.5);
    clipTo(canopy, () => {
      clumps.forEach(([cx, cy, r]) => oval(cx + r * 0.3, cy + r * 0.38, r * 0.85, r * 0.6, K.leafShade));
      oval(x + 40, by - 382, 250, 66, K.leafDeep);                                                 // underside in shadow
      clumps.forEach(([cx, cy, r], i) => { if (cy < by - 440 || cx < x - 100) oval(cx - r * 0.18 + sway, cy - r * 0.2, r * 0.62, r * 0.5, K.leaf); });
      clumps.forEach(([cx, cy, r], i) => { if (cy < by - 480 && cx < x + 140) oval(cx - r * 0.3 + sway, cy - r * 0.38, r * 0.4, r * 0.28, K.leafHi, -0.4); });
      // leaf ticks
      for (let i = 0; i < 70; i++) {
        const lx = x - 260 + H(i * 1.9 + 3) * 520, ly = by - 660 + H(i * 3.3 + 1) * 320, dark = ly > by - 470;
        stroke([[lx - 5, ly], [lx, ly + 4], [lx + 5, ly]], 2, dark ? K.leafDeep : T.shade(K.leaf, 0.15), 0.6, 0.3);
      }
      // dark leafy pockets where the branches disappear into the canopy
      [[x - 108, by - 418, 20, 11], [x + 104, by - 424, 18, 10], [x + 6, by - 440, 16, 9]].forEach(([px, py, rx, ry]) => oval(px, py, rx, ry, K.leafDeep));
    });
    // a few ripe fruits
    [[x - 150, by - 420], [x + 120, by - 470], [x - 30, by - 520], [x + 190, by - 410], [x - 90, by - 460]].forEach(([fx, fy]) => {
      const F = shape(T.ell(fx + sway, fy, 8, 8, 12), K.fruit, 2.2, INKC, 0.4);
      oval(fx - 2.5 + sway, fy - 3, 2.5, 2, 'rgba(255,255,255,0.7)');
    });
  }
  function fallingLeaves(t) {
    const x0 = WORLD.treeX;
    for (let i = 0; i < 4; i++) {
      const per = 4.6 + i * 0.9, u = ((t + i * 1.7) % per) / per;
      const lx = x0 - 120 + i * 70 + u * 260 + Math.sin(u * 9 + i) * 26, ly = 812 - 470 + u * 470;
      const a = Math.sin(u * 11 + i * 2) * 0.9, c = T.ctx;
      c.save(); c.globalAlpha *= Math.min(1, (1 - u) * 6, u * 10); c.translate(lx, ly); c.rotate(a);
      const P = shape([[-8, 0], [-3, -4.5], [5, -3.5], [9, 0], [5, 3.5], [-3, 4.5]], i % 2 ? K.leafHi : K.leaf, 1.6, K.bgInk, 0.3);
      stroke([[-7, 0], [7, 0]], 1.1, K.leafDeep, 0.4, 0);
      c.restore();
    }
  }
  function bush(x, by, r, flowers = true) {
    const c = T.ctx; c.save(); c.globalAlpha = 0.6; oval(x + r * 0.35, by + 2, r * 1.35, r * 0.16, T.C.shadow); c.restore();
    const parts = [T.ell(x - r * 0.55, by - r * 0.45, r * 0.6, r * 0.5, 18), T.ell(x, by - r * 0.7, r * 0.72, r * 0.66, 20), T.ell(x + r * 0.6, by - r * 0.42, r * 0.58, r * 0.48, 18), T.ell(x, by - r * 0.25, r * 1.05, r * 0.3, 20)];
    const P = union(parts, K.bush, 2.6, K.bgInk, 0.8);
    clipTo(P, () => {
      oval(x + r * 0.35, by - r * 0.15, r * 1.0, r * 0.45, K.bushShade);
      oval(x - r * 0.3, by - r * 0.95, r * 0.45, r * 0.28, K.bushHi, -0.3);
      oval(x - r * 0.75, by - r * 0.6, r * 0.25, r * 0.18, K.bushHi, -0.3);
      for (let i = 0; i < 8; i++) {
        const lx = x + (H(x + i * 1.3) - 0.5) * r * 1.6, ly = by - r * (0.2 + 0.8 * H(x * 0.3 + i * 2.1));
        stroke([[lx - 4, ly], [lx, ly + 3], [lx + 4, ly]], 1.8, K.bushShade, 0.6, 0.2);
      }
    });
    if (flowers) for (let i = 0; i < 6; i++) {
      const fx = x + (H(x * 0.7 + i) - 0.5) * r * 1.5, fy = by - r * (0.3 + 0.7 * H(x * 0.9 + i * 3.1));
      const col = i % 2 ? K.blossom : K.blossom2;
      for (let p = 0; p < 5; p++) oval(fx + Math.cos(p / 5 * TAU) * 3.2, fy + Math.sin(p / 5 * TAU) * 3.2, 2.6, 2.6, col);
      oval(fx, fy, 1.7, 1.7, '#F2A93B');
    }
  }
  const BUSHES = [[790, 812, 58], [870, 800, 66], [950, 812, 48], [1310, 812, 50], [1392, 800, 66], [1478, 812, 56], [165, 822, 44], [455, 826, 36], [1880, 816, 58]];
  function bushes() { BUSHES.forEach(([x, y, r], i) => bush(x, y, r, i % 3 !== 2)); }

  // ───────────────────────── path, front grass, lamp post ─────────────────────────
  function lamp(t) {
    const x = WORLD.lampX, by = 846, INKC = C.INK, lw = 3.4;
    const c = T.ctx;
    softShadow([[x - 14, by + 2], [x + 16, by + 2], [x + 250, by + 62], [x + 226, by + 66]], 0.7, 3);   // long shadow across the path
    softShadow(T.ell(x + 250, by + 64, 26, 8, 14), 0.7, 3);
    // soft warm glow around the lantern (just switched on)
    const g = c.createRadialGradient(x, by - 408, 6, x, by - 408, 90);
    g.addColorStop(0, 'rgba(255,236,160,0.55)'); g.addColorStop(1, 'rgba(255,236,160,0)');
    c.fillStyle = g; c.fillRect(x - 100, by - 500, 200, 200);
    // base, pole, collar rings
    shape([[x - 22, by + 2], [x - 16, by - 20], [x + 16, by - 20], [x + 22, by + 2]], K.iron, lw, INKC, 0.6);
    const pole = shape([[x - 7, by - 18], [x - 5, by - 380], [x + 5, by - 380], [x + 7, by - 18]], K.iron, 0, INKC, 0.4);
    clipTo([pole], () => oval(x - 4, by - 200, 2.5, 190, K.ironHi));
    ink(pole, lw, INKC);
    [by - 26, by - 250, by - 378].forEach(ry => shape(T.rrectPts(x - 11, ry - 5, 22, 10, 4, 2), K.iron, lw * 0.85, INKC, 0.4));
    // lantern: glass box, cap, finial
    const Gl = shape([[x - 16, by - 384], [x - 21, by - 430], [x + 21, by - 430], [x + 16, by - 384]], K.lampGlass, 0, INKC, 0.5);
    clipTo([Gl], () => { oval(x, by - 400, 12, 18, '#FFFBE6'); fill([[x + 8, by - 384], [x + 13, by - 430], [x + 24, by - 430], [x + 20, by - 384]], 'rgba(230,190,110,0.35)'); });
    ink(Gl, lw, INKC);
    stroke([[x, by - 384], [x, by - 430]], 2.4, K.iron, 0, 0.2);
    shape([[x - 30, by - 428], [x, by - 454], [x + 30, by - 428], [x + 24, by - 424], [x - 24, by - 424]], K.iron, lw, INKC, 0.5);
    shape(T.ell(x, by - 460, 6, 7, 12), K.iron, lw * 0.8, INKC, 0.3);
    stroke([[x - 20, by - 430], [x - 8, by - 447]], 2, K.ironHi, 0.5, 0.2);
  }
  // small tuft of filled blades rooted at (x, by)
  function miniTuft(x, by, h, n, seed, col, line) {
    for (let k = 0; k < n; k++) {
      const u = n > 1 ? k / (n - 1) - 0.5 : 0, bx = x + u * n * 4.5, a = u * 0.9 + (H(seed + k) - 0.5) * 0.4, l = h * (0.6 + 0.4 * H(seed + k * 2.3)) * (1 - Math.abs(u) * 0.5);
      const tip = [bx + Math.sin(a) * l, by - Math.cos(a) * l];
      shape([[bx - 3, by + 2], [bx - 1.2 + Math.sin(a) * l * 0.5, by - l * 0.5], tip, [bx + 1.2 + Math.sin(a) * l * 0.5, by - l * 0.5], [bx + 3, by + 2]], k % 2 ? col : T.shade(col, 0.1), 1.3, line, 0.2);
    }
  }
  function pathLayer(t) {
    // front lawn (below the path)
    const F = shape([[-1400, 960], [3400, 960], [3400, 2400], [-1400, 2400]], K.front, 0, 0, 0.5);
    grassTicks(-400, 2400, 1000, 1180, 160, 41, T.rgba(K.frontDark, 0.6), 15);
    grassTicks(-400, 2400, 995, 1150, 60, 97, T.rgba(K.grassLight, 0.6), 11);
    // the path band with gently wavy edges
    const top = [], bot = [];
    for (let x = -1400; x <= 3400; x += 40) { top.push([x, 830 + 2.5 * Math.sin(x * 0.011) + 1.5 * Math.sin(x * 0.031)]); bot.push([x, 975 + 3 * Math.sin(x * 0.009 + 2) + 1.5 * Math.sin(x * 0.027)]); }
    const P = wob(top.concat(bot.slice().reverse()), 0.6);
    fill(P, K.path);
    clipTo([P], () => {
      // painted tone bands: lighter near the top (catching light), darker toward the viewer
      fill(shift(top, 0, 8).concat(shift(top, 0, 24).reverse()), T.rgba(K.pathHi, 0.55));
      fill(shift(bot, 0, -26).concat(bot.slice().reverse()), T.rgba(K.pathShade, 0.7));
      oval(1120, 905, 420, 28, T.rgba(K.pathHi, 0.35));
      // pebbles
      for (let i = 0; i < 90; i++) {
        const x = -300 + H(i * 1.91 + 7) * 2500, y = 842 + H(i * 3.17 + 2) * 124, r = 1.6 + Math.pow(H(i * 0.77), 2) * 4.4;
        const col = [K.pebble, '#C9A57A', '#D9BE92'][i % 3];
        oval(x + r * 0.3, y + r * 0.35, r * 1.5, r * 0.75, T.rgba(K.pathLine, 0.35)); oval(x, y, r * 1.5, r * 0.75, col); oval(x - r * 0.5, y - r * 0.25, r * 0.6, r * 0.25, K.pebbleHi);
      }
      // a few hairline cracks / footprint scuffs
      for (let i = 0; i < 16; i++) {
        const x = -200 + H(i * 4.4 + 1) * 2300, y = 850 + H(i * 2.2 + 3) * 110;
        stroke([[x, y], [x + 14, y + 2], [x + 22, y - 1]], 1.6, T.rgba(K.pathLine, 0.55), 0.6, 0.4);
      }
    });
    ink(P.slice(0, top.length), 2.6, K.pathLine, false);
    ink(P.slice(top.length), 2.6, K.pathLine, false);
    // grass tufts spilling over both edges of the path (small filled blades, coloured outline)
    for (let i = 0; i < 46; i++) {
      const x = -300 + i * 56 + H(i * 3.3) * 30, y = 834 + 2 * Math.sin(x * 0.011);
      miniTuft(x, y, 9 + H(i * 1.1) * 7, 3 + Math.floor(H(i * 1.7) * 3), i * 3.1, K.grass, K.lawnLine);
    }
    for (let i = 0; i < 44; i++) {
      const x = -300 + i * 58 + H(i * 8.3) * 30, y = 982 + 3 * Math.sin(x * 0.009 + 2);
      miniTuft(x, y, 12 + H(i * 2.1) * 9, 3 + Math.floor(H(i * 2.9) * 3), i * 5.7, K.front, K.frontDark);
    }
    // daisies in the front lawn
    for (let i = 0; i < 18; i++) {
      const x = -200 + H(i * 6.1 + 2) * 2300, y = 1000 + H(i * 1.7 + 9) * 90, s = 0.8 + H(i) * 0.5;
      for (let p = 0; p < 6; p++) oval(x + Math.cos(p / 6 * TAU) * 5 * s, y + Math.sin(p / 6 * TAU) * 3.4 * s, 3.4 * s, 2.4 * s, i % 4 ? '#FFFBF2' : K.blossom, p / 6 * TAU);
      oval(x, y, 2.4 * s, 2 * s, '#F2B23B');
    }
    lamp(t);
  }

  // ───────────────────────── public: background ─────────────────────────
  S.drawBackground = (t = 0, camIn) => {
    const cam = normCam(camIn), k = dofK(cam);
    blurred(6 * k, () => {
      layer(cam, 0.02, 100, sky);
      layer(cam, 0.04, 200, sun);
      layer(cam, 0.08, 300, () => clouds(t));
      layer(cam, 0.2, 400, () => birds(t));
      layer(cam, 0.26, 500, farHills, 0.12);
    });
    blurred(5.2 * k, () => layer(cam, 0.42, 600, midHills, 0.2));
    blurred(4 * k, () => layer(cam, 0.62, 700, nearHills, 0.08));
    blurred(2.6 * k, () => layer(cam, 0.85, 800, () => { lawn(); bigTree(t); SEED = 880; fallingLeaves(t); }));
    blurred(1.2 * k, () => layer(cam, 0.95, 900, bushes));
    layer(cam, 1, 1000, () => pathLayer(t));
  };

  // ───────────────────────── public: bench ─────────────────────────
  // Wooden slats on cast-iron ends.  Seat top y = 740 (hip line), backrest planks 600–628 & 648–676,
  // spans x 850–1390, feet on the ground at y ≈ 860.  Full-ink lines: it lives in the character plane.
  S.drawBench = (t = 0) => {
    SEED = 2000;
    const INK = C.INK, lw = 4.2, X0 = WORLD.benchX0, X1 = WORLD.benchX1;
    const c = T.ctx;
    // cast shadows on the path, thrown to the right (sun upper-left): seat slab + the four feet
    softShadow([[X0 + 20, 856], [X1 - 14, 856], [X1 + 64, 884], [X0 + 96, 884]], 0.8, 5);
    [X0 + 34, X1 - 34].forEach(x => softShadow(T.ell(x + 22, 866, 30, 6, 14), 0.9, 2));
    // plank with top highlight, bottom shade, grain and bolts
    const plank = (x0, y0, w, h, bolts) => {
      const P = shape(T.rrectPts(x0, y0, w, h, 7, 3), K.wood, 0, INK, 1.1);
      clipTo([P], () => {
        fill(T.rrectPts(x0 - 4, y0 + h * 0.62, w + 8, h, 4, 2), K.woodDark);
        fill(T.rrectPts(x0 + 6, y0 + 3, w - 30, h * 0.22, 3, 2), K.woodHi);
        for (let i = 0; i < 7; i++) { const gx = x0 + 30 + H(y0 + i * 3.1) * (w - 90); stroke([[gx, y0 + h * 0.45], [gx + 40 + H(i + y0) * 40, y0 + h * 0.45 + (H(i * 2 + y0) - 0.5) * 4]], 1.6, K.grain, 0.8, 0.3); }
      });
      ink(P, lw, INK);
      bolts.forEach(bx => { oval(bx, y0 + h * 0.45, 3.2, 3.2, INK); oval(bx - 0.8, y0 + h * 0.45 - 0.8, 1, 1, '#8A7A70'); });
    };
    // iron end frames: back post (behind the backrest) + front leg + scrolled armrest
    const end = (x, dir) => {
      shape([[x - 8, 590], [x + 8, 590], [x + 9, 856], [x - 9, 856]], K.iron, lw, INK, 0.6);
      shape(T.ell(x, 588, 10, 7, 12), K.iron, lw * 0.8, INK, 0.3);
    };
    end(X0 + 36, -1); end(X1 - 36, 1);
    plank(X0 + 8, 600, X1 - X0 - 16, 28, [X0 + 36, X1 - 36]);
    plank(X0 + 8, 648, X1 - X0 - 16, 28, [X0 + 36, X1 - 36]);
    // seat: top surface (seen slightly from above) then the thick front slat
    shape([[X0 + 14, 722], [X1 - 14, 722], [X1 - 2, 742], [X0 + 2, 742]], K.woodHi, lw * 0.8, INK, 0.8);
    stroke([[X0 + 14, 731], [X1 - 10, 731]], 2, K.grain, 0.2, 0.4);
    // front legs with little scroll feet
    [[X0 + 34, -1], [X1 - 34, 1]].forEach(([x, d]) => {
      shape([[x - 9, 760], [x + 9, 760], [x + 10, 852], [x - 10, 852]], K.iron, lw, INK, 0.6);
      shape([[x - 16, 864], [x - 12, 850], [x + 12, 850], [x + 16, 864]], K.iron, lw * 0.9, INK, 0.5);
      stroke([[x - 4, 770], [x - 4, 846]], 2.4, K.ironHi, 0.5, 0.3);
    });
    plank(X0, 738, X1 - X0, 26, [X0 + 34, X1 - 34]);
    // armrests: an iron upright from the seat with a rounded wooden rest on top, at each end
    [[X0 + 20, -1], [X1 - 20, 1]].forEach(([x, d]) => {
      shape([[x - 6, 742], [x - 5, 700], [x + 5, 700], [x + 6, 742]], K.iron, lw * 0.9, INK, 0.4);
      const R = shape(T.rrectPts(x - 26 + d * 6, 688, 52, 15, 7, 3), K.wood, 0, INK, 0.5);
      clipTo([R], () => { fill(T.rrectPts(x - 30 + d * 6, 697, 60, 12, 4, 2), K.woodDark); fill(T.rrectPts(x - 20 + d * 6, 690, 34, 3.5, 2, 2), K.woodHi); });
      ink(R, lw, INK);
    });
  };

  // ───────────────────────── public: foreground ─────────────────────────
  function tuft(x, by, h, n, t, seed) {
    const sway = Math.sin(t * 1.6 + x * 0.013) * 0.05;
    const blades = [];
    for (let i = 0; i < n; i++) {
      const u = n > 1 ? i / (n - 1) : 0.5, bx = x + (u - 0.5) * n * 9, a = (u - 0.5) * 0.9 + (H(seed + i) - 0.5) * 0.3 + sway, l = h * (0.55 + 0.45 * H(seed + i * 2.3)) * (1 - Math.abs(u - 0.5) * 0.6);
      const tip = [bx + Math.sin(a) * l, by - Math.cos(a) * l], mid = [bx + Math.sin(a * 0.6) * l * 0.5, by - Math.cos(a * 0.6) * l * 0.5];
      blades.push([[bx - 9, by + 4], [mid[0] - 6, mid[1]], tip, [mid[0] + 6, mid[1]], [bx + 9, by + 4]]);
    }
    blades.forEach((b, i) => { const P = shape(T.chaikin(b, 1), ['#78B656', '#95CD6E', '#6AA84C'][i % 3], 0, 0, 0.5); ink(P, 2.2, '#3B5E36'); });
  }
  function daisy(x, by, h, t, seed) {
    const sway = Math.sin(t * 1.4 + x * 0.02) * 4, top = [x + sway, by - h];
    stroke([[x, by], [x + sway * 0.4, by - h * 0.5], top], 3.2, '#4E8C3E', 0.2, 0.3);
    for (let p = 0; p < 8; p++) { const a = p / 8 * TAU; const P = shape(T.ell(top[0] + Math.cos(a) * 9, top[1] + Math.sin(a) * 7, 7, 3.6, 12, a), '#FFFBF2', 0, 0, 0.3); ink(P, 1.6, '#6D5E6E'); }
    const Cc = shape(T.ell(top[0], top[1], 5.5, 5, 12), '#F2B23B', 0, 0, 0.3); ink(Cc, 1.6, '#6D5E6E');
  }
  S.drawForeground = (t = 0, camIn) => {
    const cam = normCam(camIn), k = dofK(cam);
    blurred(4.5 * k, () => layer(cam, 1.2, 3000, () => {
      [[150, 1066, 90, 7], [250, 1074, 110, 8], [360, 1070, 72, 6], [1690, 1072, 96, 7], [1790, 1064, 120, 9], [1890, 1074, 80, 6], [60, 1062, 104, 7]]
        .forEach(([x, y, h, n], i) => tuft(x, y, h, n, t, i * 13));
      daisy(300, 1070, 104, t, 1); daisy(1740, 1070, 128, t, 2); daisy(1830, 1074, 88, t, 3);
    }));
  };
})();
