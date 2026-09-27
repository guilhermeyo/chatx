// core.js — shared toolkit for "O Lanche" v2. Loaded first; every module uses window.TOON.
// World space is 1920x1080 at camera zoom 1. Everything is deterministic: no Math.random, no Date.
'use strict';
(function () {
  const T = window.TOON = window.TOON || {};
  T.W = 1920; T.H = 1080; T.FPS = 24; T.DUR = 15;
  T.TAU = Math.PI * 2;

  // ── palette (late-afternoon park, 90s TV-cartoon flat colours) ──
  T.C = {
    INK: '#2B2330', PAPER: '#FFFDF7',
    skyTop: '#8FD0E8', skyLow: '#FBEBCB', sun: '#FFE08A',
    hillFar: '#B9D99A', hillNear: '#9ACB80', grass: '#86BE63', grassDark: '#6FA84F',
    path: '#EBD5A6', wood: '#C98B4F', woodDark: '#9C6536',
    red: '#E85D3F', yellow: '#F2B84B', gold: '#FFD23F', pink: '#F0546E', blue: '#3E5FA8', purple: '#8E6CC4',
    shadow: 'rgba(60,40,70,0.22)',
  };

  // ── math ──
  T.clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  T.lerp = (a, b, t) => a + (b - a) * t;
  T.lerpA = (a, b, t) => a.map((v, i) => T.lerp(v, b[i], t));
  T.p = (t, a, b) => T.clamp((t - a) / (b - a));                    // progress of t through [a,b]
  T.smooth = (a, b, x) => { const u = T.p(x, a, b); return u * u * (3 - 2 * u); };
  T.decay = (t, t0, k) => t < t0 ? 0 : Math.exp(-(t - t0) * k);
  T.hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return x - Math.floor(x); };
  T.vnoise = x => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return T.lerp(T.hash(i), T.hash(i + 1), u); };
  T.E = {
    lin: x => x,
    inOut: x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2,
    out: x => 1 - Math.pow(1 - x, 3),
    in: x => x * x * x,
    outQuad: x => 1 - (1 - x) * (1 - x),
    back: x => { const c1 = 2.2, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
    elastic: x => x <= 0 ? 0 : x >= 1 ? 1 : Math.pow(2, -9 * x) * Math.sin((x * 9 - .75) * T.TAU / 3) + 1,
  };
  // 0→1 ramp in over fin seconds after a, 1→0 ramp out over fout seconds before b
  T.win = (t, a, b, fin = 0.12, fout = 0.12) => Math.min(T.E.inOut(T.p(t, a, a + fin)), 1 - T.E.inOut(T.p(t, b - fout, b)));
  // damped spring 0→1 (overshoot + settle), dt seconds since start
  T.spring = (dt, f = 2.2, d = 8) => dt <= 0 ? 0 : 1 - Math.exp(-d * dt) * Math.cos(T.TAU * f * dt);
  // keyframe track: keys = [[t, value], ...] (value number or array); ease per segment (default inOut)
  T.track = (t, keys, ease = T.E.inOut) => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 0; i < keys.length - 1; i++) {
      const [t0, v0, e0] = keys[i], [t1, v1] = keys[i + 1];
      if (t < t1) { const u = (e0 || ease)((t - t0) / (t1 - t0)); return Array.isArray(v0) ? T.lerpA(v0, v1, u) : T.lerp(v0, v1, u); }
    }
    return keys[keys.length - 1][1];
  };

  // ── colour ──
  const rgb = hex => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  T.shade = (hex, k) => { const [r, g, b] = rgb(hex); const f = c => Math.round(c * (1 - k)); return `rgb(${f(r)},${f(g)},${f(b)})`; };
  T.tint = (hex, k) => { const [r, g, b] = rgb(hex); const f = c => Math.round(c + (255 - c) * k); return `rgb(${f(r)},${f(g)},${f(b)})`; };
  T.mix = (a, b, t) => { const A = rgb(a), B = rgb(b); return `rgb(${A.map((v, i) => Math.round(T.lerp(v, B[i], t))).join(',')})`; };
  T.rgba = (hex, a) => { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; };

  // ── frame state: line boil ──
  // Outlines "boil" (re-jitter) 8x per second like hand-traced cels. SID makes every shape jitter differently.
  T.BOIL = 0; let SID = 0;
  T.beginFrame = (ctx, boil) => { T.ctx = ctx; T.BOIL = boil; SID = 0; };
  T.JA = 1.5;
  T.J = (pts, amp = T.JA) => {
    SID++;
    const b = T.BOIL, s = SID;
    return pts.map(([x, y], i) => [x + (T.hash(i * 1.7 + b * 13.1 + s * 7.3) - .5) * 2 * amp, y + (T.hash(i * 2.9 + b * 5.7 + s * 3.1) - .5) * 2 * amp]);
  };

  // ── geometry helpers (return point arrays) ──
  T.ell = (cx, cy, rx, ry, n = 28, rot = 0) => {
    const c = Math.cos(rot), s = Math.sin(rot);
    return Array.from({ length: n }, (_, i) => { const a = i / n * T.TAU, x = Math.cos(a) * rx, y = Math.sin(a) * ry; return [cx + x * c - y * s, cy + x * s + y * c]; });
  };
  T.arcPts = (cx, cy, rx, ry, a0, a1, n = 12) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / n; return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]; });
  T.rrectPts = (x, y, w, h, r, n = 6) => {
    r = Math.min(r, w / 2, h / 2); const pts = [];
    const corner = (cx, cy, a0) => { for (let i = 0; i <= n; i++) { const a = a0 + i / n * Math.PI / 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
    corner(x + w - r, y + r, -Math.PI / 2); corner(x + w - r, y + h - r, 0); corner(x + r, y + h - r, Math.PI / 2); corner(x + r, y + r, Math.PI);
    return pts;
  };
  T.star4Pts = (cx, cy, r, rot = 0) => Array.from({ length: 8 }, (_, i) => { const a = rot + i * Math.PI / 4, rr = i % 2 ? r * 0.32 : r; return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]; });
  T.heartPts = (cx, cy, s) => Array.from({ length: 30 }, (_, i) => { const a = i / 30 * T.TAU; return [cx + 16 * Math.sin(a) ** 3 * s, cy - (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) * s]; });
  // smooth a polyline/polygon with Chaikin corner cutting
  T.chaikin = (pts, iter = 1, closed = true) => {
    let P = pts;
    for (let k = 0; k < iter; k++) {
      const out = []; const n = P.length;
      for (let i = 0; i < (closed ? n : n - 1); i++) {
        const a = P[i], b = P[(i + 1) % n];
        out.push([a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25], [a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75]);
      }
      if (!closed) { out.unshift(P[0]); out.push(P[n - 1]); }
      P = out;
    }
    return P;
  };

  // ── drawing primitives (all use T.ctx in the current transform) ──
  T.path = (pts, close = true) => { const c = T.ctx; c.beginPath(); pts.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); if (close) c.closePath(); };
  T.fillPts = (pts, color) => { T.path(pts); T.ctx.fillStyle = color; T.ctx.fill(); };

  // Brush ribbon: a filled polygon of varying width following pts. wfn(i, n) → width.
  T.ribbon = (pts, closed, wfn, color = T.C.INK) => {
    const c = T.ctx, n = pts.length; if (n < 2) return;
    const L = [], R = [];
    for (let i = 0; i < n; i++) {
      const a = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1]; const d = Math.hypot(tx, ty) || 1; tx /= d; ty /= d;
      const w = wfn(i, n) / 2;
      L.push([pts[i][0] - ty * w, pts[i][1] + tx * w]); R.push([pts[i][0] + ty * w, pts[i][1] - tx * w]);
    }
    c.fillStyle = color; c.beginPath();
    if (closed) {
      L.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath();
      R.slice().reverse().forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath();
      c.fill('evenodd');
    } else {
      L.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
      R.slice().reverse().forEach(([x, y]) => c.lineTo(x, y)); c.closePath(); c.fill();
      [0, n - 1].forEach(i => { const w = wfn(i, n) / 2; if (w > 0.4) { c.beginPath(); c.arc(pts[i][0], pts[i][1], w, 0, T.TAU); c.fill(); } });
    }
  };
  // Hand-inked outline: width wobbles along the stroke like a brush (lw = average width).
  T.ink = (pts, lw = 4.5, color = T.C.INK, closed = true) => {
    const seed = SID * 3.7;
    T.ribbon(pts, closed, (i, n) => lw * (0.7 + 0.6 * T.vnoise(seed + i * 0.45)), color);
  };
  // Filled + inked shape. Jitters pts (line boil) unless opts.jitter === 0. Returns the jittered points.
  T.shape = (pts, fill, lw = 4.5, opts = {}) => {
    const P = opts.jitter === 0 ? pts : T.J(pts, opts.jitter ?? T.JA);
    if (fill) T.fillPts(P, fill);
    if (lw > 0) T.ink(P, lw, opts.ink || T.C.INK, true);
    return P;
  };
  T.blob = (cx, cy, rx, ry, fill, lw = 4.5, n = 28, rot = 0, opts = {}) => T.shape(T.ell(cx, cy, rx, ry, n, rot), fill, lw, opts);
  // Open brush stroke with tapered ends (taper 0 = blunt, 1 = pointy both ends).
  T.stroke = (pts, lw = 4.5, color = T.C.INK, taper = 0.6, jitter = T.JA * 0.7) => {
    const P = jitter ? T.J(pts, jitter) : pts; const seed = SID * 2.3;
    T.ribbon(P, false, (i, n) => { const u = n > 1 ? i / (n - 1) : 0.5; const tp = 1 - taper * Math.pow(Math.abs(2 * u - 1), 2.5); return lw * tp * (0.8 + 0.4 * T.vnoise(seed + i * 0.6)); }, color);
  };
  // Tube limb (arm/leg): ink outline + colour core, round caps. pts = polyline joints.
  T.limb = (pts, w, color, lw = 4.5) => {
    const c = T.ctx, P = T.J(pts, 1.1);
    T.path(P, false); c.lineCap = 'round'; c.lineJoin = 'round';
    c.strokeStyle = T.C.INK; c.lineWidth = w + lw * 2; c.stroke();
    c.strokeStyle = color; c.lineWidth = w; c.stroke();
  };
  // Soft contact shadow on the ground (no outline).
  T.shadow = (cx, cy, rx, ry = rx * 0.18, a = 1) => {
    const c = T.ctx; c.save(); c.globalAlpha *= a;
    c.fillStyle = T.C.shadow; c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0, T.TAU); c.fill();
    c.restore();
  };
  T.FONT = px => `${px}px "Patrick Hand"`;
  T.text = (str, x, y, px, color = T.C.INK, align = 'center', rot = 0) => {
    const c = T.ctx; c.save(); c.translate(x, y); c.rotate(rot);
    c.font = T.FONT(px); c.textAlign = align; c.textBaseline = 'middle'; c.fillStyle = color; c.fillText(str, 0, 0); c.restore();
  };
  T.star4 = (cx, cy, r, rot, fill = T.C.gold, lw = 3) => T.shape(T.star4Pts(cx, cy, r, rot), fill, lw, { jitter: 0.8 });
  T.heart = (cx, cy, s, fill = T.C.pink) => T.shape(T.heartPts(cx, cy, s), fill, 3.5, { jitter: 0.8 });
})();
