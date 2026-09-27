// CLAUDE — Motion Reel 2026
// Deterministic, time-driven renderer: renderFrame(frameIndex) draws exactly one frame.
'use strict';

const W = 1920, H = 1080, CX = W / 2, CY = H / 2;
const FPS = 60, DUR = 15, BEAT = 0.5;
const SUB = 5;          // motion-blur subframes
const SHUTTER = 0.5;    // 180° shutter

const C = {
  ink: '#0A0A0F', paper: '#F2EEE6', coral: '#FF4D2E', blue: '#2F4BFF',
  acid: '#D7FF3A', violet: '#8A5CFF', navy: '#07081A',
};

// ───────────────────────── math / easing ─────────────────────────
const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const p = (t, a, b) => clamp((t - a) / (b - a));
const smooth = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const E = {
  outCubic: x => 1 - Math.pow(1 - x, 3),
  inCubic: x => x * x * x,
  inOutCubic: x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2,
  outQuart: x => 1 - Math.pow(1 - x, 4),
  inQuart: x => x * x * x * x,
  inOutQuart: x => x < .5 ? 8 * x ** 4 : 1 - Math.pow(-2 * x + 2, 4) / 2,
  outExpo: x => x >= 1 ? 1 : 1 - Math.pow(2, -10 * x),
  inExpo: x => x <= 0 ? 0 : Math.pow(2, 10 * x - 10),
  inOutExpo: x => x <= 0 ? 0 : x >= 1 ? 1 : x < .5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2,
  outBack: x => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
  outBackBig: x => { const c1 = 3.2, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
  outElastic: x => x <= 0 ? 0 : x >= 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - .75) * TAU / 3) + 1,
};
// damped spring from 0 → 1, dt in seconds
const spring = (dt, f = 2.6, d = 9) => dt <= 0 ? 0 : 1 - Math.exp(-d * dt) * Math.cos(TAU * f * dt);
const decay = (t, t0, k) => t < t0 ? 0 : Math.exp(-(t - t0) * k);
const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return x - Math.floor(x); };
const bezier = (x1, y1, x2, y2) => {            // CSS cubic-bezier solver
  const bx = s => 3 * x1 * s * (1 - s) ** 2 + 3 * x2 * s * s * (1 - s) + s ** 3;
  const by = s => 3 * y1 * s * (1 - s) ** 2 + 3 * y2 * s * s * (1 - s) + s ** 3;
  return x => { let lo = 0, hi = 1; for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (bx(m) < x) lo = m; else hi = m; } return by((lo + hi) / 2); };
};
const EZ = bezier(.7, 0, .2, 1);

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

// ───────────────────────── canvas plumbing ─────────────────────────
const out = document.getElementById('out');
const octx = out.getContext('2d');
const scene = document.createElement('canvas'); scene.width = W; scene.height = H;
const ctx = scene.getContext('2d');
const acc = document.createElement('canvas'); acc.width = W; acc.height = H;
const actx = acc.getContext('2d');

const F = {
  anton: px => `${px}px Anton`,
  grot: (px, w = 700) => `${w} ${px}px "Space Grotesk"`,
  mono: px => `500 ${px}px "JetBrains Mono"`,
  serif: px => `italic 400 ${px}px "Instrument Serif"`,
};

function bg(c) { ctx.fillStyle = c; ctx.fillRect(-50, -50, W + 100, H + 100); }

// lay out a word as individually positioned glyphs, centred on cx
function layout(str, font, cx, spacing = 0) {
  ctx.save(); ctx.font = font;
  const ws = [...str].map(ch => ctx.measureText(ch).width);
  ctx.restore();
  const total = ws.reduce((a, b) => a + b, 0) + spacing * (ws.length - 1);
  let x = cx - total / 2;
  return [...str].map((ch, i) => { const g = { ch, x, w: ws[i], cx: x + ws[i] / 2 }; x += ws[i] + spacing; return g; });
}

function rrect(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath(); c.roundRect(x, y, w, h, r);
}

// ───────────────────────── SCENE 1 · ignition (0 – 1.5) ─────────────────────────
function s1(t) {
  bg(C.ink);
  // faint dot grid that breathes in
  const ga = 0.10 * smooth(0, 0.6, t);
  ctx.fillStyle = rgba(C.paper, ga);
  for (let x = 0; x <= 24; x++) for (let y = 0; y <= 13; y++) {
    const px = x * 80 + 0, py = y * 80 + 20;
    const d = Math.hypot(px - CX, py - CY);
    const s = 1.6 + 2.2 * decay(t, 0.5 + d / 3000, 6) + 2.2 * decay(t, 1.0 + d / 3000, 6);
    ctx.beginPath(); ctx.arc(px, py, s, 0, TAU); ctx.fill();
  }
  // shockwaves on each beat
  for (const b of [0.02, 0.5, 1.0]) {
    if (t < b) continue;
    const u = p(t, b, b + 0.75);
    if (u >= 1) continue;
    ctx.strokeStyle = rgba(C.paper, (1 - u) * 0.55);
    ctx.lineWidth = 1 + (1 - u) * 5;
    ctx.beginPath(); ctx.arc(CX, CY, 24 + E.outExpo(u) * 560, 0, TAU); ctx.stroke();
  }
  // satellites
  const sat = E.outBackBig(p(t, 0.25, 0.55)) * (1 - E.inExpo(p(t, 0.85, 1.05)));
  for (let i = 0; i < 3; i++) {
    const a = t * 5 + i * TAU / 3;
    const r = 70 * sat;
    ctx.fillStyle = [C.coral, C.acid, C.blue][i];
    ctx.beginPath(); ctx.arc(CX + Math.cos(a) * r, CY + Math.sin(a) * r * 0.9, 7 * sat, 0, TAU); ctx.fill();
  }
  // the dot
  const appear = E.outBackBig(p(t, 0.0, 0.3));
  const pulse = 0.9 * decay(t, 0.5, 10) + 1.1 * decay(t, 1.0, 10);
  const r = 16 * appear * (1 + pulse);
  const su = p(t, 1.0, 1.3), ou = p(t, 1.28, 1.5);
  let w = lerp(2 * r, W * 1.25, E.inExpo(su));
  let h = lerp(2 * r, 5, E.outExpo(su));
  h = lerp(h, H + 40, E.inOutQuart(ou));
  const col = C.paper;
  ctx.fillStyle = col;
  rrect(ctx, CX - w / 2, CY - h / 2, w, h, h < 2 * r + 1 ? h / 2 : 0); ctx.fill();
  // tiny type
  const tu = p(t, 0.18, 0.75);
  const txt = 'initialising imagination';
  const n = Math.floor(tu * txt.length);
  ctx.globalAlpha = 1 - p(t, 0.9, 1.0);
  ctx.font = F.mono(20); ctx.textAlign = 'center'; ctx.fillStyle = rgba(C.paper, 0.7);
  ctx.fillText(txt.slice(0, n) + (tu < 1 || Math.floor(t * 8) % 2 ? '_' : ' '), CX, CY + 110);
  ctx.globalAlpha = 1;
}

// ───────────────────────── SCENE 2 · kinetic type (1.5 – 3.5) ─────────────────────────
const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ#%&@$/<>*+=0123456789';
function s2(t) {
  bg(C.paper);
  const m = E.inOutExpo(p(t, 2.5, 2.85));

  // coral disc: slams in on the downbeat, then flies to become the dot of "is"
  if (t >= 2.0) {
    const cu = E.outExpo(p(t, 2.0, 2.4));
    const r = lerp(cu * 380, 64, m);
    const x = lerp(CX, CX - 330, m), y = lerp(CY, CY + 10, m);
    ctx.fillStyle = C.coral;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }

  // MOTION — CMY misregistration print
  ctx.save();
  const wy = lerp(CY, CY - 150, m), sc = lerp(1, 0.6, m);
  ctx.translate(CX, wy); ctx.scale(sc, sc);
  const font = F.anton(430);
  const glyphs = layout('MOTION', font, 0, 8);
  const reg = 26 * decay(t, 2.0, 8) + 18 * decay(t, 2.5, 8) + 3;
  ctx.font = font; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.beginPath(); ctx.rect(-1200, -250, 2400, 440); ctx.clip();
  const inks = [['#00C2FF', -1, 0], ['#FF2E88', 1, 0.4], ['#FFD400', 0, 1]];
  ctx.globalCompositeOperation = 'multiply';
  for (const [col, ox, oy] of inks) {
    ctx.fillStyle = col;
    glyphs.forEach((g, i) => {
      const st = 1.5 + i * 0.055;
      const k = spring(t - st, 1.9, 8.5);
      const y = (1 - k) * 470;
      const skew = (1 - k) * 0.25 * (i % 2 ? 1 : -1);
      ctx.save();
      ctx.translate(g.x + ox * reg, y + oy * reg * 0.6 + 18);
      ctx.transform(1, 0, skew, 1, 0, 0);
      ctx.fillText(g.ch, 0, 0);
      ctx.restore();
    });
  }
  ctx.restore();

  // "is"
  if (t >= 2.55) {
    const u = E.outBackBig(p(t, 2.55, 2.8));
    ctx.save();
    ctx.translate(CX - 330, CY + 10); ctx.scale(u, u);
    ctx.fillStyle = C.paper; ctx.font = F.serif(110); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('is', 0, -6);
    ctx.restore();
  }
  // EVERYTHING — scramble decode
  const word = 'EVERYTHING';
  const g2 = layout(word, F.grot(150), CX + 80, 2);
  ctx.font = F.grot(150); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  g2.forEach((g, i) => {
    const vis = 2.58 + i * 0.022, res = 2.68 + i * 0.038;
    if (t < vis) return;
    const ch = t >= res ? g.ch : GLYPHS[Math.floor(hash(Math.floor(t * 40) * 13 + i * 7) * GLYPHS.length)];
    ctx.fillStyle = t >= res ? C.ink : (i % 3 ? C.blue : C.coral);
    const pop = 1 + 0.25 * decay(t, res, 14);
    ctx.save(); ctx.translate(g.cx, CY + 150); ctx.scale(pop, pop);
    ctx.textAlign = 'center';
    ctx.fillText(ch, 0, 0); ctx.restore();
  });
  // underline sweep
  const ul = E.outExpo(p(t, 3.0, 3.3));
  if (ul > 0) {
    const x0 = g2[0].x, x1 = g2[g2.length - 1].x + g2[g2.length - 1].w;
    ctx.fillStyle = C.coral;
    ctx.fillRect(x0, CY + 230, (x1 - x0) * ul, 12);
  }
}

// ───────────────────────── SCENE 3 · shape morph (3.5 – 5.5) ─────────────────────────
const NS = 256;
function polyTable(verts) {          // radius at each sample angle for a star-shaped polygon
  const tab = new Float32Array(NS);
  for (let j = 0; j < NS; j++) {
    const a = j / NS * TAU - Math.PI / 2, dx = Math.cos(a), dy = Math.sin(a);
    let best = Infinity;
    for (let k = 0; k < verts.length; k++) {
      const [x1, y1] = verts[k], [x2, y2] = verts[(k + 1) % verts.length];
      const ex = x2 - x1, ey = y2 - y1;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const tt = (x1 * ey - y1 * ex) / den;
      const s = (x1 * dy - y1 * dx) / den;
      if (tt > 0 && s >= -1e-6 && s <= 1 + 1e-6) best = Math.min(best, tt);
    }
    tab[j] = best;
  }
  return tab;
}
const ngonV = (n, R, rot) => Array.from({ length: n }, (_, k) => [Math.cos(rot + k * TAU / n) * R, Math.sin(rot + k * TAU / n) * R]);
const starV = (n, R, r) => Array.from({ length: n * 2 }, (_, k) => { const a = -Math.PI / 2 + k * Math.PI / n, rr = k % 2 ? r : R; return [Math.cos(a) * rr, Math.sin(a) * rr]; });
const SHAPES = [
  Float32Array.from({ length: NS }, () => 1),
  polyTable(ngonV(4, 1.28, Math.PI / 4)),
  polyTable(ngonV(3, 1.45, -Math.PI / 2)),
  polyTable(starV(5, 1.45, 0.62)),
  Float32Array.from({ length: NS }, (_, j) => 1.05 + 0.2 * Math.cos(j / NS * TAU * 8)),
];
const SHAPE_NAMES = ['circle()', 'square()', 'triangle()', 'star()', 'bloom()'];
const KEYS = [3.5, 4.0, 4.5, 5.0, 5.25];

function shapeState(t) {
  let idx = 0;
  for (let i = 0; i < KEYS.length; i++) if (t >= KEYS[i]) idx = i;
  const u = idx === 0 ? 1 : E.outBack(p(t, KEYS[idx], KEYS[idx] + 0.3));
  const a = SHAPES[Math.max(0, idx - 1)], b = SHAPES[idx];
  let rot = t * 0.4;
  for (let i = 1; i < KEYS.length; i++) rot += E.outExpo(p(t, KEYS[i], KEYS[i] + 0.45)) * Math.PI / 2;
  let sq = 0;
  for (let i = 1; i < KEYS.length; i++) if (t >= KEYS[i]) sq += 0.24 * Math.exp(-(t - KEYS[i]) * 7) * Math.cos((t - KEYS[i]) * 26);
  const scale = E.outBackBig(p(t, 3.5, 3.85)) * (1 + E.inExpo(p(t, 5.2, 5.5)) * 5);
  return { a, b, u, rot, sx: 1 + sq, sy: 1 / (1 + sq), scale, idx };
}
function shapePath(st, R) {
  ctx.beginPath();
  for (let j = 0; j <= NS; j++) {
    const jj = j % NS;
    const r = lerp(st.a[jj], st.b[jj], st.u) * R * st.scale;
    const ang = jj / NS * TAU - Math.PI / 2 + st.rot;
    const x = Math.cos(ang) * r * st.sx, y = Math.sin(ang) * r * st.sy;
    j ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath();
}

function s3(t) {
  bg(C.blue);
  // outlined marquee
  ctx.save();
  ctx.font = F.anton(640); ctx.textBaseline = 'middle'; ctx.lineWidth = 3;
  ctx.strokeStyle = rgba(C.paper, 0.16);
  const mw = ctx.measureText('FORM·').width;
  const off = ((t - 3.5) * 900) % mw;
  for (let k = -1; k < 4; k++) ctx.strokeText('FORM·', k * mw - off, CY + 20);
  ctx.restore();

  // orbit dots
  for (let i = 0; i < 18; i++) {
    const a = i / 18 * TAU + (t - 3.5) * 1.3;
    const beatK = decay(t, Math.floor(t / BEAT) * BEAT, 8);
    const rr = (410 + 26 * Math.sin(t * 4 + i)) * E.outExpo(p(t, 3.55 + i * 0.012, 3.95 + i * 0.012));
    const s = 5 + 7 * beatK * (i % 3 === 0);
    ctx.fillStyle = i % 3 === 0 ? C.acid : rgba(C.paper, 0.8);
    ctx.beginPath(); ctx.arc(CX + Math.cos(a) * rr, CY + Math.sin(a) * rr * 0.92, s, 0, TAU); ctx.fill();
  }

  ctx.save(); ctx.translate(CX, CY);
  // echo trails
  for (let j = 7; j >= 1; j--) {
    const st = shapeState(t - j * 0.03);
    shapePath(st, 250);
    ctx.strokeStyle = rgba(C.acid, (1 - j / 8) * 0.8); ctx.lineWidth = 3;
    ctx.stroke();
  }
  const st = shapeState(t);
  shapePath(st, 250);
  ctx.fillStyle = C.paper; ctx.fill();
  // inner label
  ctx.fillStyle = C.ink; ctx.font = F.mono(30); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const lblPop = E.outBackBig(p(t, KEYS[st.idx] + 0.05, KEYS[st.idx] + 0.3));
  ctx.save(); ctx.scale(lblPop * st.scale ** 0.3, lblPop * st.scale ** 0.3);
  ctx.fillText(SHAPE_NAMES[st.idx], 0, 8); ctx.restore();
  ctx.restore();

  // iris to acid
  const iu = p(t, 5.22, 5.5);
  if (iu > 0) {
    ctx.fillStyle = C.acid;
    ctx.beginPath(); ctx.arc(CX, CY, E.inExpo(iu) * 1200, 0, TAU); ctx.fill();
  }
}

// ───────────────────────── SCENE 4 · tile ripple (5.5 – 7.5) ─────────────────────────
const COLS = 16, ROWS = 9, TS = 120;
const WAVES = [
  { t0: 5.52, ox: 7.5, oy: 4, dl: 0.04, dur: 0.3, col: C.ink, axis: 'x' },
  { t0: 6.42, ox: 0, oy: 0, dl: 0.034, dur: 0.28, col: C.coral, axis: 'y' },
  { t0: 6.92, ox: 15, oy: 8, dl: 0.02, dur: 0.22, col: C.navy, axis: 'xy' },
];
function s4(t) {
  bg(C.ink);
  for (let cx = 0; cx < COLS; cx++) for (let cy = 0; cy < ROWS; cy++) {
    let prev = C.acid, cur = null, u = 1, axis = 'x';
    for (const w of WAVES) {
      const d = Math.hypot(cx - w.ox, cy - w.oy);
      const st = w.t0 + d * w.dl;
      if (t < st) break;
      const uu = p(t, st, st + w.dur);
      if (uu >= 1) { prev = w.col; continue; }
      cur = w.col; u = uu; axis = w.axis;
      break;
    }
    const x = cx * TS + TS / 2, y = cy * TS + TS / 2;
    let sx = 1, sy = 1, col = prev;
    if (cur) {
      const k = Math.abs(Math.cos(Math.PI * E.inOutCubic(u)));
      if (axis.includes('x')) sx = k;
      if (axis.includes('y')) sy = k;
      col = u < 0.5 ? prev : cur;
    }
    ctx.fillStyle = col;
    const ww = (TS + 1) * sx, hh = (TS + 1) * sy;
    const r = cur ? 14 * Math.sin(Math.PI * u) : 0;
    rrect(ctx, x - ww / 2, y - hh / 2, ww, hh, r); ctx.fill();
    if (cur) { ctx.fillStyle = `rgba(0,0,0,${0.35 * Math.sin(Math.PI * u)})`; ctx.fill(); }
  }

  // TIMING → RHYTHM, drawn in difference so it inverts over every tile
  ctx.save();
  ctx.globalCompositeOperation = 'difference';
  ctx.fillStyle = C.paper; ctx.strokeStyle = C.paper;
  const font = F.anton(520);
  const A = layout('TIMING', font, CX, 10), B = layout('RHYTHM', font, CX, 10);
  ctx.font = font; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  ctx.save();
  ctx.beginPath(); ctx.rect(0, CY - 270, W, 520); ctx.clip();
  for (let i = 0; i < 6; i++) {
    const inU = E.outExpo(p(t, 5.66 + i * 0.05, 6.06 + i * 0.05));
    const roll = EZ(p(t, 6.4 + i * 0.045, 6.78 + i * 0.045));
    const exitU = E.inExpo(p(t, 7.08 + i * 0.03, 7.38 + i * 0.03));
    const x = lerp(A[i].cx, B[i].cx, roll);
    const base = CY + 30 + (1 - inU) * 540 + exitU * 560;
    ctx.fillText(A[i].ch, x, base - roll * 540);
    if (roll > 0) ctx.fillText(B[i].ch, x, base + (1 - roll) * 540);
  }
  ctx.restore();

  // easing curve panel
  const pa = E.outExpo(p(t, 5.8, 6.2)) * (1 - p(t, 7.2, 7.4));
  if (pa > 0) {
    ctx.globalAlpha = pa;
    const px = W - 430, py = H - 350, pw = 300, ph = 200;
    ctx.lineWidth = 2; ctx.strokeStyle = rgba(C.paper, 0.5);
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py + ph); ctx.lineTo(px + pw, py + ph); ctx.stroke();
    const cu = p(t, 5.85, 6.9);
    ctx.lineWidth = 4; ctx.strokeStyle = C.paper; ctx.beginPath();
    for (let s = 0; s <= 60 * cu; s++) { const xx = s / 60; const X = px + xx * pw, Y = py + ph - EZ(xx) * ph; s ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
    ctx.stroke();
    const ball = EZ(cu);
    ctx.beginPath(); ctx.arc(px + cu * pw, py + ph - ball * ph, 9, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(px + pw + 40, py + ph - ball * ph, 14, 0, TAU); ctx.fill();
    ctx.font = F.mono(20); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('cubic-bezier(.7, 0, .2, 1)', px, py + ph + 40);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// ───────────────────────── SCENE 5 · 3D point field (7.5 – 9.5) ─────────────────────────
const NP = 1200;
const PTS = (() => {
  const S = [], T = [], G = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  const gc = 48, gr = 25;
  for (let i = 0; i < NP; i++) {
    const y = 1 - (i / (NP - 1)) * 2, r = Math.sqrt(1 - y * y), th = ga * i;
    S.push([Math.cos(th) * r * 360, y * 360, Math.sin(th) * r * 360]);
    const u = (i % 60) / 60 * TAU, v = Math.floor(i / 60) / 20 * TAU;
    T.push([(330 + 120 * Math.cos(v)) * Math.cos(u), 120 * Math.sin(v), (330 + 120 * Math.cos(v)) * Math.sin(u)]);
    const gx = (i % gc) / (gc - 1) - 0.5, gz = Math.floor(i / gc) / (gr - 1) - 0.5;
    G.push([gx * 1300, 0, gz * 900]);
  }
  return { S, T, G };
})();

function s5(t) {
  bg(C.navy);
  // radial glow
  const gg = ctx.createRadialGradient(CX, CY, 0, CX, CY, 800);
  gg.addColorStop(0, rgba(C.blue, 0.35)); gg.addColorStop(1, rgba(C.blue, 0));
  ctx.fillStyle = gg; ctx.fillRect(0, 0, W, H);

  const ry = (t - 7.5) * 1.3 + 0.3, rx = 0.35 + 0.25 * Math.sin((t - 7.5) * 1.6);
  const cyr = Math.cos(ry), syr = Math.sin(ry), cxr = Math.cos(rx), sxr = Math.sin(rx);
  let camZ = lerp(2000, 1150, E.outCubic(p(t, 7.5, 8.3)));
  camZ = lerp(camZ, -400, E.inExpo(p(t, 9.1, 9.5)));
  const f = 1000;
  const grow = E.outExpo(p(t, 7.5, 8.0));
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < NP; i++) {
    const s = i / NP;
    const a = E.inOutCubic(p(t, 7.95 + s * 0.25, 8.4 + s * 0.25));
    const b = E.inOutCubic(p(t, 8.6 + (1 - s) * 0.2, 9.0 + (1 - s) * 0.2));
    const P = PTS.S[i], Q = PTS.T[i], R = PTS.G[i];
    let x = lerp(lerp(P[0], Q[0], a), R[0], b);
    let y = lerp(lerp(P[1], Q[1], a), R[1], b);
    let z = lerp(lerp(P[2], Q[2], a), R[2], b);
    if (b > 0) y += b * 70 * Math.sin(Math.hypot(R[0], R[2]) * 0.018 - t * 9);
    x *= grow; y *= grow; z *= grow;
    // rotate Y then X
    let x1 = x * cyr + z * syr, z1 = -x * syr + z * cyr;
    let y1 = y * cxr - z1 * sxr, z2 = y * sxr + z1 * cxr;
    const zz = z2 + camZ;
    if (zz < 40) continue;
    const sc = f / zz;
    const X = CX + x1 * sc, Y = CY + y1 * sc;
    const depth = clamp((z2 + 400) / 800);
    const size = Math.max(1, 5.2 * sc);
    ctx.fillStyle = depth < 0.5 ? rgba(C.acid, 0.95) : rgba('#9FB0FF', 0.95 - depth * 0.4);
    ctx.fillRect(X - size / 2, Y - size / 2, size, size);
  }
  ctx.globalCompositeOperation = 'source-over';

  // orbit ellipse + HUD read-outs
  const ha = E.outExpo(p(t, 7.7, 8.1)) * (1 - p(t, 9.1, 9.3));
  ctx.globalAlpha = ha;
  ctx.strokeStyle = rgba(C.paper, 0.35); ctx.lineWidth = 1.5; ctx.setLineDash([6, 10]);
  ctx.beginPath(); ctx.ellipse(CX, CY, 620, 150, -0.12, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
  const oa = (t - 7.5) * 2.2;
  ctx.fillStyle = C.coral; ctx.beginPath();
  ctx.arc(CX + Math.cos(oa) * 620 * Math.cos(-0.12) - Math.sin(oa) * 150 * Math.sin(-0.12),
    CY + Math.cos(oa) * 620 * Math.sin(-0.12) + Math.sin(oa) * 150 * Math.cos(-0.12), 9, 0, TAU); ctx.fill();
  ctx.font = F.mono(20); ctx.fillStyle = rgba(C.paper, 0.8); ctx.textAlign = 'left';
  const deg = x => ((x * 180 / Math.PI) % 360 + 360) % 360;
  ctx.fillText(`ROT.Y  ${deg(ry).toFixed(1).padStart(5, '0')}°`, 160, CY - 30);
  ctx.fillText(`ROT.X  ${deg(rx).toFixed(1).padStart(5, '0')}°`, 160, CY + 2);
  ctx.fillText(`CAM.Z  ${Math.round(camZ).toString().padStart(4, '0')}`, 160, CY + 34);
  ctx.fillText(`PTS    ${NP}`, 160, CY + 66);
  ctx.textAlign = 'right';
  const mode = t < 8.2 ? 'SPHERE' : t < 8.8 ? 'TORUS' : 'FIELD';
  ctx.font = F.grot(64); ctx.fillStyle = C.paper;
  ctx.fillText(mode, W - 160, CY + 20);
  ctx.globalAlpha = 1;

  // flash into next scene
  const fl = E.inExpo(p(t, 9.3, 9.5));
  if (fl > 0) { ctx.fillStyle = rgba(C.paper, fl); ctx.fillRect(0, 0, W, H); }
}

// ───────────────────────── SCENE 6 · metaballs (9.5 – 11.5) ─────────────────────────
const MW = 960, MH = 540, MS = W / MW;
const meta = document.createElement('canvas'); meta.width = MW; meta.height = MH;
const mctx = meta.getContext('2d');
const mimg = mctx.createImageData(MW, MH);
const mbuf = new Uint32Array(mimg.data.buffer);
const PAL = (() => {                      // 256-step gradient coral → violet → blue → coral
  const stops = [[255, 77, 46], [138, 92, 255], [47, 75, 255], [255, 77, 46]];
  const arr = [];
  for (let i = 0; i < 256; i++) {
    const x = i / 256 * 3, k = Math.floor(x), f = x - k;
    const a = stops[k], b = stops[k + 1];
    arr.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
  }
  return arr;
})();

function blobs(t) {
  const lt = t - 9.5;
  const merge1 = E.inOutCubic(p(t, 10.1, 10.45)) * (1 - E.outBack(p(t, 10.5, 10.8)));
  const merge2 = E.inOutCubic(p(t, 10.85, 11.2));
  const g = Math.max(merge1, merge2);
  const spread = E.outExpo(p(t, 9.5, 9.9));
  const B = [];
  const beat = 1 + 0.12 * decay(t, Math.floor(t / BEAT) * BEAT, 7);
  for (let i = 0; i < 9; i++) {
    const dir = i % 2 ? 1 : -1;
    const a = i / 9 * TAU + lt * 0.9 * dir;
    const orr = (240 + 110 * Math.sin(lt * 1.7 + i * 1.3)) * spread * (1 - g);
    B.push([CX + Math.cos(a) * orr * 1.5, CY + Math.sin(a) * orr, (70 + 26 * Math.sin(lt * 3 + i * 1.7)) * beat]);
  }
  const fin = E.inExpo(p(t, 11.2, 11.5));
  B.push([CX, CY, (150 + 60 * g) * beat * E.outBackBig(p(t, 9.5, 9.8)) + fin * 1500]);
  return B;
}
function s6(t) {
  bg(C.ink);
  const B = blobs(t).map(([x, y, r]) => [x / MS, y / MS, (r / MS) ** 2]);
  const shift = Math.floor((t - 9.5) * 90);
  for (let py = 0; py < MH; py++) {
    for (let px = 0; px < MW; px++) {
      let f = 0;
      for (let k = 0; k < B.length; k++) {
        const dx = px - B[k][0], dy = py - B[k][1];
        f += B[k][2] / (dx * dx + dy * dy + 1);
      }
      const idx = py * MW + px;
      if (f < 0.92) { mbuf[idx] = 0; continue; }
      const alpha = clamp((f - 0.92) / 0.16);
      const ci = ((px * 0.22 + py * 0.3 + shift) | 0) & 255;
      const c = PAL[ci];
      // rim light + inner depth
      const rim = Math.max(0, 1 - Math.abs(f - 1.35) * 2.2) * 0.45;
      const inner = Math.min(1, (f - 1) * 0.12);
      const r = Math.min(255, c[0] + rim * 255 - inner * 60);
      const gC = Math.min(255, c[1] + rim * 255 - inner * 40);
      const bC = Math.min(255, c[2] + rim * 255 - inner * 20);
      mbuf[idx] = ((alpha * 255) << 24) | (Math.max(0, bC) << 16) | (Math.max(0, gC) << 8) | Math.max(0, r);
    }
  }
  mctx.putImageData(mimg, 0, 0);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(meta, 0, 0, W, H);

  // words in serif italic, difference blend
  const words = [['fluid.', 9.72, 10.42], ['organic.', 10.5, 10.95], ['alive.', 11.0, 11.3]];
  ctx.save();
  ctx.globalCompositeOperation = 'difference';
  ctx.fillStyle = C.paper; ctx.font = F.serif(300); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const [w, a, b] of words) {
    if (t < a || t > b) continue;
    const u = E.outExpo(p(t, a, a + 0.25)), o = E.inExpo(p(t, b - 0.12, b));
    ctx.save(); ctx.translate(CX, CY + 10 + (1 - u) * 60 - o * 40);
    ctx.globalAlpha = u * (1 - o);
    ctx.scale(0.9 + 0.1 * u, 0.9 + 0.1 * u);
    ctx.fillText(w, 0, 0); ctx.restore();
  }
  ctx.restore();

  const fl = 1 - p(t, 9.5, 9.7);
  if (fl > 0) { ctx.fillStyle = rgba(C.paper, E.outCubic(fl)); ctx.fillRect(0, 0, W, H); }
}

// ───────────────────────── SCENE 7 · rapid montage (11.5 – 13.5) ─────────────────────────
function s7(t) {
  const lt0 = t - 11.5;
  const k = Math.min(6, Math.floor(lt0 / 0.25));
  const lt = k < 6 ? lt0 - k * 0.25 : t - 13.0;
  const u = k < 6 ? lt / 0.25 : 0;
  const cutT = k < 6 ? 11.5 + k * 0.25 : 13.0;
  const sh = 22 * decay(t, cutT, 16);
  ctx.save();
  ctx.translate((hash(k * 3.1 + 1) - 0.5) * sh * 2, (hash(k * 7.7 + 2) - 0.5) * sh * 2);
  const shake2 = 1 + 0.04 * decay(t, cutT, 12);
  ctx.translate(CX, CY); ctx.scale(shake2, shake2); ctx.translate(-CX, -CY);

  if (k === 0) {                               // stripes
    bg(C.acid);
    ctx.save(); ctx.translate(CX, CY); ctx.rotate(-0.5);
    ctx.fillStyle = C.ink;
    for (let i = -20; i < 20; i++) ctx.fillRect(i * 120 + u * 480, -1400, 58, 2800);
    ctx.restore();
    ctx.fillStyle = C.ink; ctx.fillRect(CX - 470, CY - 200, 940, 400);
    ctx.fillStyle = C.acid; ctx.font = F.anton(360); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('BOLD', CX, CY + 18);
  } else if (k === 1) {                        // tunnel
    bg(C.paper);
    for (let j = 22; j >= 0; j--) {
      const r = Math.pow(j + u * 2, 2.3) * 7;
      ctx.fillStyle = j % 2 ? C.coral : C.paper;
      ctx.beginPath(); ctx.arc(CX, CY, r, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(CX, CY, 34, 0, TAU); ctx.fill();
  } else if (k === 2) {                        // counter
    bg(C.blue);
    const n = Math.floor(lerp(0, 2026, E.outExpo(u * 1.25)));
    ctx.fillStyle = C.paper; ctx.font = F.anton(480); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(n).padStart(4, '0'), CX, CY + 20);
    ctx.font = F.mono(26); ctx.fillStyle = C.acid;
    ctx.fillText('KEYFRAMES / YEAR', CX, CY + 290);
  } else if (k === 3) {                        // bar chart
    bg(C.paper);
    const n = 14, bw = 70, gap = 34, x0 = CX - (n * bw + (n - 1) * gap) / 2, base = CY + 300;
    for (let i = 0; i < n; i++) {
      const h = (140 + hash(i * 9.3) * 420 + (i === 10 ? 160 : 0)) * E.outBack(p(lt, i * 0.009, 0.14 + i * 0.009));
      ctx.fillStyle = i === 10 ? C.coral : C.ink;
      ctx.fillRect(x0 + i * (bw + gap), base - h, bw, h);
    }
    ctx.fillStyle = C.ink; ctx.fillRect(x0 - 30, base, n * (bw + gap) + 26, 4);
    ctx.font = F.mono(26); ctx.textAlign = 'left'; ctx.fillText('DATA → STORY', x0 - 30, CY - 330);
  } else if (k === 4) {                        // particle burst
    bg(C.ink);
    ctx.lineCap = 'round';
    for (let i = 0; i < 260; i++) {
      const a = hash(i * 1.37) * TAU, v = 900 + hash(i * 4.1) * 2400;
      const d = s => v * (1 - Math.exp(-s * 7)) / 7;
      const r1 = d(lt), r0 = d(Math.max(0, lt - 0.035));
      ctx.strokeStyle = i % 4 === 0 ? C.coral : i % 3 === 0 ? C.paper : C.acid;
      ctx.lineWidth = 2 + hash(i * 2.2) * 7;
      ctx.beginPath();
      ctx.moveTo(CX + Math.cos(a) * r0, CY + Math.sin(a) * r0);
      ctx.lineTo(CX + Math.cos(a) * r1 + 0.1, CY + Math.sin(a) * r1);
      ctx.stroke();
    }
    ctx.fillStyle = C.paper; ctx.beginPath(); ctx.arc(CX, CY, 120 * (1 - E.outExpo(u)), 0, TAU); ctx.fill();
  } else if (k === 5) {                        // checker warp
    bg(C.ink);
    const s = 96;
    for (let j = -1; j < 13; j++) for (let i = -2; i < 23; i++) {
      if ((i + j) % 2) continue;
      const wv = Math.sin(j * 0.55 + u * TAU * 1.2) * 70;
      const sc = 0.55 + 0.45 * Math.cos(i * 0.4 + j * 0.3 - u * TAU);
      ctx.fillStyle = (i * 7 + j * 3) % 11 === 0 ? C.coral : C.paper;
      const x = i * s + wv, y = j * s - 10;
      ctx.fillRect(x + s * (1 - sc) / 2, y + s * (1 - sc) / 2, s * sc, s * sc);
    }
  } else {                                     // MAKE · IT · MOVE
    const wi = t < 13.125 ? 0 : t < 13.25 ? 1 : 2;
    const wt = [13.0, 13.125, 13.25][wi];
    const bgc = [C.coral, C.ink, C.acid][wi], fg = [C.ink, C.paper, C.ink][wi];
    bg(bgc);
    const s = lerp(1.5, 1, E.outExpo(p(t, wt, wt + 0.1)));
    const smear = wi === 2 ? E.inExpo(p(t, 13.36, 13.5)) : 0;
    ctx.save(); ctx.translate(CX, CY);
    ctx.scale(s * (1 + smear * 4), s * (1 - smear * 0.97));
    ctx.fillStyle = fg; ctx.font = F.anton(wi === 1 ? 700 : 560); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(['MAKE', 'IT', 'MOVE'][wi], 0, 24);
    ctx.restore();
  }
  ctx.restore();
  const fl = decay(t, cutT, 22) * (k === 0 ? 1 : 0.35);
  if (fl > 0.01) { ctx.fillStyle = rgba(C.paper, fl); ctx.fillRect(0, 0, W, H); }
}

// ───────────────────────── SCENE 8 · end card (13.5 – 15) ─────────────────────────
function s8(t) {
  bg(C.ink);
  const push = lerp(1, 1.035, E.outCubic(p(t, 13.6, 15)));
  ctx.save(); ctx.translate(CX, CY); ctx.scale(push, push); ctx.translate(-CX, -CY);

  // blueprint grid
  const gu = E.outExpo(p(t, 13.55, 14.2));
  ctx.strokeStyle = rgba(C.paper, 0.06); ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 80) { ctx.beginPath(); ctx.moveTo(x, CY - CY * gu); ctx.lineTo(x, CY + CY * gu); ctx.stroke(); }
  for (let y = 0; y <= H; y += 80) { ctx.beginPath(); ctx.moveTo(CX - CX * gu, y); ctx.lineTo(CX + CX * gu, y); ctx.stroke(); }

  const font = F.anton(300);
  const G = layout('CLAUDE', font, CX, 14);
  const wordW = G[5].x + G[5].w - G[0].x;
  const lineY = CY + 95;
  // the dot returns (bookend of the intro) then stretches into the underline
  const dotIn = E.outBackBig(p(t, 13.5, 13.7));
  const su = E.outExpo(p(t, 13.74, 14.1));
  const dy = lerp(CY, lineY, E.inOutCubic(p(t, 13.66, 13.9)));
  const lw = lerp(32 * dotIn, wordW, su), lh = lerp(32 * dotIn, 10, su);
  ctx.fillStyle = su > 0.02 ? C.coral : C.paper;
  rrect(ctx, CX - lw / 2, dy - lh / 2, lw, lh, lh / 2); ctx.fill();
  // ring on stretch
  if (t > 13.74) {
    const ru = p(t, 13.74, 14.3);
    ctx.strokeStyle = rgba(C.coral, 1 - ru); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(CX, lineY, 40 + ru * 900, 20 + ru * 300, 0, 0, TAU); ctx.stroke();
  }

  // letters rise from behind the line
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, lineY - 8); ctx.clip();
  ctx.font = font; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.fillStyle = C.paper;
  G.forEach((g, i) => {
    const k = spring(t - (13.86 + i * 0.045), 2.2, 9);
    ctx.fillText(g.ch, g.x, lineY - 30 + (1 - k) * 320);
  });
  ctx.restore();

  // sparkle
  const sp = E.outBackBig(p(t, 14.25, 14.55));
  if (sp > 0) {
    ctx.save(); ctx.translate(G[5].x + G[5].w + 46, lineY - 290); ctx.rotate(t * 2.2); ctx.scale(sp, sp);
    ctx.fillStyle = C.acid; ctx.beginPath();
    for (let i = 0; i < 8; i++) { const r = i % 2 ? 9 : 38, a = i * Math.PI / 4; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    ctx.closePath(); ctx.fill(); ctx.restore();
  }

  // subtitle typed
  const sub = 'MOTION DESIGNER — SHOWREEL 2026';
  const tu = p(t, 14.12, 14.6);
  const n = Math.floor(tu * sub.length + 0.001);
  ctx.font = F.mono(30); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const sw = ctx.measureText(sub).width;
  const sx = CX - sw / 2;
  ctx.fillStyle = C.paper;
  ctx.fillText(sub.slice(0, n), sx, lineY + 70);
  if (t > 14.1 && (tu < 1 || Math.floor(t * 4) % 2 === 0)) {
    const cw = ctx.measureText(sub.slice(0, n)).width;
    ctx.fillStyle = C.acid; ctx.fillRect(sx + cw + 4, lineY + 52, 16, 36);
  }
  // availability
  const av = E.outExpo(p(t, 14.5, 14.8));
  if (av > 0) {
    ctx.globalAlpha = av;
    ctx.font = F.mono(20); ctx.fillStyle = rgba(C.paper, 0.7); ctx.textAlign = 'left';
    const lab = 'AVAILABLE FOR WORK';
    const lw2 = ctx.measureText(lab).width;
    const bx = CX - (lw2 + 30) / 2;
    ctx.fillText(lab, bx + 30, lineY + 140 + (1 - av) * 16);
    const pl = 1 + 0.5 * Math.sin(t * 12) ** 2;
    ctx.fillStyle = C.acid; ctx.beginPath(); ctx.arc(bx + 8, lineY + 140 + (1 - av) * 16, 7 * pl, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// ───────────────────────── transitions ─────────────────────────
function barsWipe(t, b, colors, angle) {
  const u0 = b - 0.3;
  if (t < u0 - 0.1 || t > b + 0.45) return;
  const diag = Math.hypot(W, H) + 200, n = colors.length, bh = diag / n + 2;
  ctx.save(); ctx.translate(CX, CY); ctx.rotate(angle);
  colors.forEach((col, k) => {
    const s = u0 + (k - (n - 1) / 2) * 0.022;
    const u = p(t, s, s + 0.6);
    if (u <= 0 || u >= 1) return;
    const cx = lerp(-5 * W, 5 * W, E.inOutCubic(u));
    ctx.fillStyle = col;
    ctx.fillRect(cx - 4 * W, -diag / 2 + k * (bh - 2), 8 * W, bh);
  });
  ctx.restore();
}
function transitions(t) {
  barsWipe(t, 3.5, [C.acid, C.coral, C.ink, C.coral, C.acid], -0.35);
  if (t >= 13.5 && t < 13.62) { ctx.fillStyle = rgba(C.paper, 0.9 * (1 - p(t, 13.5, 13.62))); ctx.fillRect(0, 0, W, H); }
}

// ───────────────────────── composition ─────────────────────────
const SCENES = [[0, s1], [1.5, s2], [3.5, s3], [5.5, s4], [7.5, s5], [9.5, s6], [11.5, s7], [13.5, s8]];
const LABELS = ['00  IGNITION', '01  TYPE', '02  FORM', '03  TIMING', '04  SPACE', '05  FLOW', '06  CUTS', '07  HELLO'];
function sceneIndex(t) { let i = 0; for (let k = 0; k < SCENES.length; k++) if (t >= SCENES[k][0]) i = k; return i; }

function drawScene(t) {
  t = clamp(t, 0, DUR - 1e-4);
  ctx.save();
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  SCENES[sceneIndex(t)][1](t);
  ctx.restore();
  ctx.save(); transitions(t); ctx.restore();
}

function hud(t, frame) {
  const c = octx;
  c.save();
  c.globalCompositeOperation = 'difference';
  const fade = 1 - p(t, 14.2, 14.6) * 0.75;
  c.globalAlpha = 0.75 * fade * smooth(0.05, 0.35, t);
  c.strokeStyle = '#fff'; c.fillStyle = '#fff'; c.lineWidth = 2;
  const m = 48, L = 34;
  for (const [x, y, dx, dy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) {
    c.beginPath(); c.moveTo(x + dx * L, y); c.lineTo(x, y); c.lineTo(x, y + dy * L); c.stroke();
  }
  c.font = F.mono(18); c.textBaseline = 'middle';
  c.textAlign = 'left'; c.fillText('CLAUDE / MOTION REEL', m + 22, m + 18 + 12);
  const ss = Math.floor(frame / FPS), ff = frame % FPS;
  c.textAlign = 'right';
  c.fillText(`● REC  00:00:${String(ss).padStart(2, '0')}:${String(ff).padStart(2, '0')}`, W - m - 22, m + 30);
  c.textAlign = 'left';
  c.fillText(LABELS[sceneIndex(t)], m + 22, H - m - 30);
  // beat counter
  const beatN = Math.floor(t / BEAT) % 4;
  for (let i = 0; i < 4; i++) {
    const x = W - m - 22 - (3 - i) * 22 - 12, y = H - m - 30 - 6;
    if (i === beatN) c.fillRect(x, y, 12, 12); else c.strokeRect(x + 1, y + 1, 10, 10);
  }
  c.textAlign = 'right';
  c.fillText('120 BPM', W - m - 22 - 4 * 22 - 8, H - m - 30);
  // progress hairline
  c.fillRect(m, H - m + 14, (W - 2 * m) * (t / DUR), 2);
  c.restore();
}

window.renderFrame = function (frame) {
  actx.globalCompositeOperation = 'source-over';
  for (let s = 0; s < SUB; s++) {
    const t = (frame + (s / SUB) * SHUTTER) / FPS;
    drawScene(t);
    actx.globalAlpha = 1 / (s + 1);
    actx.drawImage(scene, 0, 0);
  }
  actx.globalAlpha = 1;
  octx.globalCompositeOperation = 'source-over';
  octx.drawImage(acc, 0, 0);
  hud(frame / FPS, frame);
};
window.TOTAL_FRAMES = FPS * DUR;
window.ready = document.fonts.ready.then(() => Promise.all([
  document.fonts.load(F.anton(100)), document.fonts.load(F.grot(100)),
  document.fonts.load(F.mono(100)), document.fonts.load(F.serif(100)),
]));
