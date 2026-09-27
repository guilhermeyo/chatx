// "O Lanche" — a 15s cartoon short. Deterministic: renderFrame(i) draws frame i at 24fps.
// Characters animate "on twos" (12 drawings/s) with boiling outlines; the camera moves on ones.
'use strict';
const W = 1920, H = 1080, FPS = 24, DUR = 15;
const TL = window.TL, EV = TL.ev;
const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const lerpA = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
const p = (t, a, b) => clamp((t - a) / (b - a));
const decay = (t, t0, k) => t < t0 ? 0 : Math.exp(-(t - t0) * k);
const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return x - Math.floor(x); };
const E = {
  inOut: x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2,
  out: x => 1 - Math.pow(1 - x, 3),
  back: x => { const c1 = 2.2, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
};
const win = (t, a, b, fin = 0.12, fout = 0.12) => Math.min(E.inOut(p(t, a, a + fin)), 1 - E.inOut(p(t, b - fout, b)));

const INK = '#2B2330', WHITE = '#FFFDF7';
const LEO = { skin: '#F4C49A', shirt: '#E85D3F', shorts: '#3E5FA8', hair: '#6B3F22', shoe: '#D9D3C7', kind: 'leo' };
const BIA = { skin: '#B87850', shirt: '#8E6CC4', shorts: '#F2B84B', hair: '#1F1A2E', shoe: '#E85D3F', kind: 'bia' };
const GROUND = 860, HIP = 740;

const cv = document.getElementById('out');
const ctx = cv.getContext('2d');

// ─────────── hand-drawn primitives (boiling lines) ───────────
let BOIL = 0, SID = 0, JA = 1.6;
function J(pts, amp = JA) {
  SID++;
  return pts.map(([x, y], i) => [x + (hash(i * 1.7 + BOIL * 13.1 + SID * 7.3) - .5) * 2 * amp, y + (hash(i * 2.9 + BOIL * 5.7 + SID * 3.1) - .5) * 2 * amp]);
}
function path(pts, close = true) {
  ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); if (close) ctx.closePath();
}
function poly(pts, fill, stroke = INK, lw = 4.5) {
  path(pts);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke(); }
}
function line(pts, color = INK, lw = 4.5) {
  path(J(pts, JA * 0.7), false); ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
}
function ell(cx, cy, rx, ry, n = 28, rot = 0) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return Array.from({ length: n }, (_, i) => { const a = i / n * TAU, x = Math.cos(a) * rx, y = Math.sin(a) * ry; return [cx + x * c - y * s, cy + x * s + y * c]; });
}
function blob(cx, cy, rx, ry, fill, stroke = INK, lw = 4.5, n = 28, rot = 0) { poly(J(ell(cx, cy, rx, ry, n, rot)), fill, stroke, lw); }
function limb(pts, w, color) {             // tube with outline
  const jp = J(pts, 1.1);
  path(jp, false); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = INK; ctx.lineWidth = w + 9; ctx.stroke();
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke();
}
function rrectPts(x, y, w, h, r, n = 6) {
  const pts = [];
  const corner = (cx, cy, a0) => { for (let i = 0; i <= n; i++) { const a = a0 + i / n * Math.PI / 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
  corner(x + w - r, y + r, -Math.PI / 2); corner(x + w - r, y + h - r, 0); corner(x + r, y + h - r, Math.PI / 2); corner(x + r, y + r, Math.PI);
  return pts;
}
function star4(cx, cy, r, rot, fill) {
  const pts = []; for (let i = 0; i < 8; i++) { const a = rot + i * Math.PI / 4, rr = i % 2 ? r * 0.32 : r; pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]); }
  poly(J(pts, 0.8), fill, INK, 3);
}
function heart(cx, cy, s, fill = '#F0546E') {
  const pts = []; for (let i = 0; i < 30; i++) { const a = i / 30 * TAU; const x = 16 * Math.sin(a) ** 3, y = -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)); pts.push([cx + x * s, cy + y * s]); }
  poly(J(pts, 0.8), fill, INK, 3.5);
}
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = c => Math.round(c * (1 - k));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
const FONT = px => `${px}px "Patrick Hand"`;
function hand(text, x, y, px, color = INK, align = 'center', rot = 0) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.font = FONT(px); ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillStyle = color;
  ctx.fillText(text, 0, 0); ctx.restore();
}

// ─────────── dialogue ───────────
const VOW = 'aeiouáéíóúâêôãõAEIOU';
function speech(who, t) {
  for (const L of TL.lines) {
    if (L.who !== who || t < L.start || t > L.end) continue;
    let idx = 0; while (idx < L.ct.length && L.ct[idx] <= t) idx++;
    const typing = idx > 0 && idx < L.text.length;
    const ch = idx > 0 ? L.text[idx - 1] : ' ';
    const open = !typing ? 0 : VOW.includes(ch) ? 0.9 : /[a-zç]/i.test(ch) ? 0.4 : 0.05;
    return { L, idx, open };
  }
  return null;
}

// ─────────── kid rig ───────────
function armGeo(sh, a, e, k = 1) {
  const d1 = [Math.sin(a), Math.cos(a)], d2 = [Math.sin(a + e), Math.cos(a + e)];
  const el = [sh[0] + d1[0] * 50 * k, sh[1] + d1[1] * 50 * k];
  return { sh, el, hd: [el[0] + d2[0] * 46 * k, el[1] + d2[1] * 46 * k], d1 };
}
function legGeo(side, th, kb) {
  const hip = [side * 12, -4];
  const kn = [hip[0] + Math.cos(th) * 58, hip[1] + Math.sin(th) * 58];
  const an = [kn[0] + Math.cos(th + kb) * 54, kn[1] + Math.sin(th + kb) * 54];
  return { hip, kn, an, sd: [Math.cos(th + kb), Math.sin(th + kb)] };
}
function drawLeg(D, g, dark) {
  const k = dark ? 0.14 : 0;
  limb([g.kn, g.an], 15, shade(D.skin, k));
  limb([[g.an[0] - g.sd[0] * 16, g.an[1] - g.sd[1] * 16], g.an], 17, shade(WHITE, k));
  blob(g.an[0] + 14, g.an[1] + 8, 24, 12, shade(D.shoe, k), INK, 4.5, 20);
  limb([g.hip, g.kn], 30, shade(D.shorts, k));
}
function drawArm(D, A, dark) {
  const k = dark ? 0.14 : 0;
  limb([A.sh, A.el, A.hd], 13, shade(D.skin, k));
  limb([A.sh, [A.sh[0] + A.d1[0] * 24, A.sh[1] + A.d1[1] * 24]], 27, shade(D.shirt, k));
  blob(A.hd[0], A.hd[1], 12, 12, shade(D.skin, k), INK, 4, 14);
}
function sandwichHalf(x, y, s, rot, bitten = false) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
  let pts = [[-30, 20], [30, 20], [0, -30]];
  if (bitten) pts = [[-30, 20], [30, 20], [14, -6], [8, -16], [0, -12], [-6, -18], [-12, -8]];
  const fat = pts.map(([x, y]) => [x * 1.08, y * 1.08 + 2]);
  poly(J(fat), '#7CC35A', INK, 4);
  poly(J(pts), '#F1CF8A', INK, 4.5);
  line([[-22, 12], [22, 12]], '#E0533D', 5);
  ctx.restore();
}
function book(x, y, open, rot = 0) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  if (open) {
    poly(J([[-62, -40], [0, -34], [62, -40], [62, 40], [0, 46], [-62, 40]]), '#D9453B');
    poly(J([[-56, -36], [0, -30], [0, 40], [-56, 34]]), WHITE, INK, 3.5);
    poly(J([[56, -36], [0, -30], [0, 40], [56, 34]]), WHITE, INK, 3.5);
    for (let i = 0; i < 4; i++) { line([[-46, -18 + i * 13], [-10, -15 + i * 13]], '#B9B2A6', 3); line([[10, -15 + i * 13], [46, -18 + i * 13]], '#B9B2A6', 3); }
  } else {
    poly(J(rrectPts(-50, -14, 100, 22, 4)), '#D9453B');
    line([[-44, -2], [44, -2]], WHITE, 3);
  }
  ctx.restore();
}

const HEADS = {};
function drawKid(D, P) {
  ctx.save();
  ctx.translate(P.x, P.y); ctx.scale(P.face, 1);
  ctx.translate(0, 122); ctx.scale(1 + P.sq * 0.6, 1 - P.sq); ctx.translate(0, -122);

  // legs
  const stTh = ph => Math.PI / 2 - (P.walk == null ? 0 : 0.5 * Math.sin(ph));
  const stKb = ph => P.walk == null ? 0.02 : 0.1 + 0.6 * Math.max(0, -Math.cos(ph));
  const ph = P.walk || 0;
  const lf = legGeo(-1, lerp(stTh(ph + Math.PI), 0.1, P.sit), lerp(stKb(ph + Math.PI), 1.42, P.sit));
  const ln = legGeo(1, lerp(stTh(ph), 0.04, P.sit), lerp(stKb(ph), 1.5, P.sit));
  const aF = armGeo([-8, -112], ...P.armF), aN = armGeo([10, -110], ...P.armN, P.strN || 1);
  drawArm(D, aF, true);
  drawLeg(D, lf, true);
  // torso
  poly(J(rrectPts(-40, -132, 82, 136, 24)), D.shirt);
  poly(J(rrectPts(-43, -30, 87, 38, 12)), D.shorts);
  if (D.kind === 'leo') line([[-10, -118], [0, -104], [10, -118]], shade(D.shirt, 0.25), 4);
  else blob(0, -112, 9, 9, '#F2B84B', INK, 3, 12);
  drawLeg(D, ln, false);

  // head
  ctx.save();
  ctx.translate(4, -126); ctx.rotate(P.tilt); ctx.translate(8, -78);
  drawHead(D, P);
  ctx.restore();
  HEADS[D.kind] = [P.x + P.face * 12, P.y - 204];

  // props held in hands
  if (P.book != null) {
    const bx = (aN.hd[0] + aF.hd[0]) / 2 + 6, by = (aN.hd[1] + aF.hd[1]) / 2 - 8;
    book(bx, by, true, -0.08 * P.book);
  }
  if (P.sandW) sandwichHalf((aN.hd[0] + aF.hd[0]) / 2, (aN.hd[1] + aF.hd[1]) / 2 - 6, 1.3, 0);
  if (P.sandF) sandwichHalf(aF.hd[0] + 4, aF.hd[1] - 16, 1, 0.1, P.sandF === 2);
  if (P.sandN) sandwichHalf(aN.hd[0] + 4, aN.hd[1] - 16, 1, -0.1, P.sandN === 2);
  drawArm(D, aN, false);
  P.handWorld = [P.x + P.face * aN.hd[0], P.y + aN.hd[1]];
  ctx.restore();
}

function drawHead(D, P) {
  const leo = D.kind === 'leo';
  if (leo) blob(-34, 10, 14, 18, D.skin, INK, 4.5, 16);
  blob(0, 0, 84, 90, D.skin, INK, 4.5, 34);
  // hair
  if (leo) {
    const pts = [];
    const a0 = 150, a1 = 332, n = 13;
    for (let i = 0; i <= n; i++) {
      const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180;
      let r = i % 2 ? 1.22 : 1.04; if (i === 7) r = 1.42;
      pts.push([Math.cos(a) * 84 * r, Math.sin(a) * 90 * r]);
    }
    for (let i = n; i >= 0; i--) {
      const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180;
      pts.push([Math.cos(a) * 84 * 0.86, Math.sin(a) * 90 * 0.8 - 6]);
    }
    poly(J(pts), D.hair);
    blob(-34, 10, 14, 18, D.skin, INK, 4.5, 16);
    line([[-38, 4], [-30, 12]], INK, 3);
  } else {
    const pts = [[74, -34], [52, -28], [32, -38], [12, -29], [-8, -38], [-26, -22], [-34, 15], [-38, 50], [-64, 72], [-96, 60]];
    for (let d = 160; d <= 332; d += 12) { const a = d * Math.PI / 180; pts.push([Math.cos(a) * 84 * 1.1, Math.sin(a) * 90 * 1.1]); }
    poly(J(pts), D.hair);
    blob(18, -76, 12, 8, '#F2B84B', INK, 3.5, 12, -0.4);
  }
  // eyes
  const eyes = leo ? [[26, -12], [58, -14]] : [[26, -8], [58, -10]];
  const rx = leo ? 15 : 12, ry0 = leo ? 21 : 16;
  const ry = Math.max(1.5, ry0 * (1 - P.blink));
  eyes.forEach(([ex, ey], i) => {
    if (P.joy > 0.5) { line([[ex - rx, ey + 4], [ex, ey - 10], [ex + rx, ey + 4]], INK, 5); return; }
    const E1 = J(ell(ex, ey, rx, ry, 20), 1);
    poly(E1, WHITE, null);
    if (P.blink < 0.8) {
      const px = ex + P.look[0] * rx * 0.45, py = ey + P.look[1] * ry * 0.45;
      if (P.sparkle > 0) star4(px, py, 13, BOIL * 0.6, '#FFD23F');
      else { blob(px, py, leo ? 7 : 6, leo ? 8 : 7, INK, null, 0, 12); blob(px + 2.5, py - 3, 2, 2, WHITE, null, 0, 8); }
    }
    if (P.sad > 0) {
      ctx.save(); path(E1); ctx.clip();
      const outer = i === 0 ? -1 : 1;
      const yIn = ey - ry + ry * 0.55 * P.sad, yOut = ey - ry + ry * 1.05 * P.sad;
      const l = outer < 0 ? [ex - rx - 4, yOut] : [ex - rx - 4, yIn], r = outer < 0 ? [ex + rx + 4, yIn] : [ex + rx + 4, yOut];
      poly([[ex - rx - 4, ey - ry - 6], [ex + rx + 4, ey - ry - 6], r, l], D.skin, null);
      ctx.restore();
      line([l, r], INK, 4);
    }
    poly(E1, null, INK, 4);
    if (leo) {                      // brows
      const inner = i === 0 ? 1 : -1;
      const by = ey - 34 - P.joy * 6 - P.sparkle * 6;
      const yi = by - P.sad * 9, yo = by + P.sad * 3;
      line([[ex - inner * 13, yo], [ex + inner * 13, yi]], INK, 5);
    }
  });
  if (!leo) {                        // glasses
    eyes.forEach(([ex, ey]) => poly(J(ell(ex, ey, 21, 20, 20), 1), null, INK, 4.5));
    line([[37, -10], [47, -12]], INK, 4); line([[5, -8], [-26, -2]], INK, 4);
  }
  // nose
  if (leo) blob(86, 12, 18, 16, D.skin, INK, 4.5, 18);
  else line([[80, 2], [88, 12], [79, 16]], INK, 4);
  // blush
  if (!leo || P.joy > 0.3 || P.sparkle > 0) { ctx.globalAlpha = 0.35; blob(leo ? 64 : 70, 32, 13, 8, '#F0546E', null, 0, 14); ctx.globalAlpha = 1; }
  // mouth
  const mx = 52, my = 50;
  if (P.open > 0.05) {
    const h = 6 + 26 * P.open, w = 20;
    const top = [], bot = [];
    for (let i = 0; i <= 8; i++) { const u = i / 8, x = mx - w + 2 * w * u; top.push([x, my - 4 + P.smile * 4 * (1 - (2 * u - 1) ** 2) * -0.5]); }
    for (let i = 8; i >= 0; i--) { const u = i / 8, x = mx - w + 2 * w * u; bot.push([x, my - 4 + h * Math.sin(Math.PI * u) ** 0.8]); }
    const M = J([...top, ...bot], 1);
    poly(M, '#6E2433', null);
    ctx.save(); path(M); ctx.clip(); blob(mx + 2, my - 4 + h, 12, 8, '#E86A7A', null, 0, 12); ctx.restore();
    poly(M, null, INK, 4);
  } else {
    const pts = [];
    for (let i = 0; i <= 10; i++) { const u = i / 10, x = mx - 20 + 40 * u; pts.push([x, my + P.smile * 11 * (1 - (2 * u - 1) ** 2) - P.smile * 3]); }
    line(pts, INK, 4.5);
  }
}

// ─────────── dog ───────────
function drawDog(Q) {
  ctx.save(); ctx.translate(Q.x, Q.y); ctx.scale(Q.face * 1.35, 1.35);
  const body = '#E3B071', spot = '#9A6235', ear = '#7A4A2A';
  // tail
  const ta = -1.2 + 0.5 * Math.sin(Q.wag);
  line([[-40, -30], [-40 + Math.cos(ta + 3.3) * 34, -30 + Math.sin(ta + 3.3) * 34 - 10], [-40 + Math.cos(ta + 3.6) * 55, -30 + Math.sin(ta + 3.6) * 55 - 30]], INK, 13);
  line([[-40, -30], [-40 + Math.cos(ta + 3.3) * 34, -30 + Math.sin(ta + 3.3) * 34 - 10], [-40 + Math.cos(ta + 3.6) * 55, -30 + Math.sin(ta + 3.6) * 55 - 30]], body, 6);
  if (Q.walk != null) {
    const s = Math.sin(Q.walk);
    [[-30, s], [30, -s]].forEach(([x, k]) => limb([[x - 8, -24], [x - 8 + k * 10, 0]], 12, shade(body, 0.14)));
    blob(0, -44, 60, 32, body, INK, 4.5, 26);
    [[-30, -s], [30, s]].forEach(([x, k]) => limb([[x + 6, -24], [x + 6 + k * 10, 0]], 12, body));
  } else {
    blob(-16, -30, 34, 30, shade(body, 0.08), INK, 4.5, 20);
    blob(0, -50, 44, 50, body, INK, 4.5, 26, 0.25);
    limb([[18, -40], [22, -2]], 14, body); limb([[34, -40], [40, -2]], 14, body);
  }
  blob(-8, -60, 14, 11, spot, null, 0, 14);
  const hx = Q.walk != null ? 52 : 34, hy = Q.walk != null ? -84 : -112;
  ctx.save(); ctx.translate(hx, hy); ctx.rotate(Q.tilt);
  // ears
  const es = 0.25 * Math.sin(Q.wag * 0.5);
  poly(J(ell(-26, 12, 14, 36, 18, 0.35 + es)), ear);
  blob(0, 0, 40, 38, body, INK, 4.5, 24);
  blob(30, 12, 26, 18, '#F5D6A6', INK, 4, 18);
  blob(52, 4, 9, 7, INK, null, 0, 10);
  line([[34, 22], [42, 26], [50, 22]], INK, 3.5);
  if (Q.puppy > 0) {
    [[4, -10], [28, -12]].forEach(([ex, ey], i) => {
      const r = 8 + 8 * Q.puppy;
      if (Q.wink && i === 1) { line([[ex - 9, ey], [ex, ey - 6], [ex + 9, ey]], INK, 4.5); return; }
      blob(ex, ey, r, r * 1.1, WHITE, INK, 3.5, 16);
      blob(ex + 2, ey + 2, r * 0.7, r * 0.75, INK, null, 0, 14);
      blob(ex - 1, ey - 3, r * 0.28, r * 0.28, WHITE, null, 0, 8);
      blob(ex + 5, ey + 5, r * 0.12, r * 0.12, WHITE, null, 0, 6);
    });
  } else {
    [[6, -10], [28, -12]].forEach(([ex, ey], i) => {
      if (Q.wink && i === 1) line([[ex - 8, ey], [ex, ey - 6], [ex + 8, ey]], INK, 4.5);
      else blob(ex + Q.look[0] * 2, ey + Q.look[1] * 2, 5.5, 7, INK, null, 0, 10);
    });
  }
  poly(J(ell(-4, 8, 12, 30, 16, -0.25 - es)), ear);
  if (Q.crust) sandwichHalf(46, 30, 0.45, 0.4, true);
  ctx.restore();
  ctx.restore();
  HEADS.dog = [Q.x + Q.face * hx * 1.35, Q.y + hy * 1.35];
}

// ─────────── poses (sampled on twos) ───────────
function blinkAt(t, list) { let b = 0; for (const s of list) { const u = p(t, s, s + 0.17); if (u > 0 && u < 1) b = Math.sin(Math.PI * u); } return b; }

function leoPose(t) {
  const P = { face: 1, sit: 0, sq: 0, tilt: 0, walk: null, look: [0.8, 0.05], blink: blinkAt(t, [1.3, 4.7, 9.6, 12.7]), open: 0, smile: 0.6, sad: 0, joy: 0, sparkle: 0, armN: [0.15, -0.15], armF: [-0.1, -0.1] };
  if (t < EV.stop) { P.x = lerp(-170, 760, t / EV.stop); P.walk = t * TAU * 1.9; }
  else if (t < EV.hop) P.x = 760;
  else P.x = lerp(760, 945, E.inOut(p(t, EV.hop, EV.land)));
  P.y = HIP;
  if (P.walk != null) {
    P.y -= Math.abs(Math.sin(P.walk)) * 10;
    P.armN = [0.45 * Math.sin(P.walk + Math.PI), -0.35]; P.armF = [0.45 * Math.sin(P.walk), -0.35];
  }
  P.sq = 0.09 * decay(t, EV.stop, 10) + 0.12 * decay(t, EV.land, 10) + (t > EV.hop - 0.17 && t < EV.hop ? 0.12 : 0);
  const air = p(t, EV.hop, EV.land);
  if (air > 0 && air < 1) { P.y -= 150 * Math.sin(Math.PI * air); P.armN = [2.4, 0.3]; P.armF = [2.2, 0.4]; }
  P.sit = E.inOut(p(t, EV.hop + 0.05, EV.land - 0.08));
  // wave
  const wv = win(t, 2.3, 3.7, 0.12, 0.15);
  if (wv > 0) P.armN = lerpA(P.armN, [2.75, 0.5 * Math.sin(t * 17)], wv);
  // sad stretch
  const sd = win(t, EV.sad, EV.cloudOut, 0.25, 0.1);
  P.sad = sd; P.smile = lerp(P.smile, -0.8, sd); P.tilt = 0.08 * sd;
  P.look = lerpA(P.look, [0.3, 0.55], sd);
  const tum = win(t, EV.growl - 0.05, EV.growl + 0.75, 0.12, 0.15);
  if (tum > 0) { P.armN = lerpA(P.armN, [0.55, 1.8], tum); P.armF = lerpA(P.armF, [0.4, 1.9], tum); }
  // joy
  const sp = win(t, EV.cloudOut, EV.land + 0.1, 0.05, 0.1);
  P.sparkle = sp > 0.5 ? 1 : 0;
  if (t >= EV.cloudOut) { P.smile = 1; P.open = t < EV.hop ? 0.35 : 0; }
  // sandwich
  if (t >= EV.land - 0.02) {
    const reach = win(t, EV.land + 0.02, EV.hand + 0.12, 0.08, 0.1);
    P.armN = lerpA([0.15, -0.1], [1.4, 0.05], reach); P.strN = 1 + 0.55 * reach;
    if (t >= EV.hand) {
      P.sandN = t >= EV.biteLeo + 0.1 ? 2 : 1;
      const hold = E.inOut(p(t, EV.hand + 0.05, EV.hand + 0.25));
      P.armN = lerpA(P.armN, [0.95, 1.35], hold);
      const bite = win(t, EV.biteLeo - 0.08, EV.biteLeo + 0.15, 0.06, 0.08);
      P.armN = lerpA(P.armN, [0.9, 2.1], bite);
      if (bite > 0.5) P.open = 0.5;
    }
  }
  // dog & ending
  if (t >= EV.dogSit + 0.05) P.look = [0.5, 0.95];
  if (t >= EV.lookEach) P.look = [1, -0.1];
  const lg = win(t, EV.laugh, EV.toss + 0.1, 0.05, 0.08);
  if (lg > 0.5) { P.joy = 1; P.open = 0.55 + 0.35 * Math.abs(Math.sin(t * 25)); P.y -= 6 * Math.abs(Math.sin(t * 25)); }
  if (t >= EV.toss - 0.12) {
    P.sandN = 0;
    const wind = E.inOut(p(t, EV.toss - 0.12, EV.toss)), fling = E.out(p(t, EV.toss, EV.toss + 0.12));
    P.armN = lerpA(lerpA([0.95, 1.35], [0.2, 0.3], wind), [2.1, 0.1], fling);
    P.armN = lerpA(P.armN, [0.3, 0.4], p(t, EV.toss + 0.3, EV.toss + 0.5));
    P.look = t < EV.catch + 0.1 ? [0.6, 0.7] : [1, -0.1];
    if (t > EV.catch) { P.joy = 1; P.open = 0.35; }
  }
  const s = speech('leo', t);
  if (s) { P.open = Math.max(P.open, s.open); }
  return P;
}

function biaPose(t) {
  const P = { x: 1240, y: HIP, face: -1, sit: 1, sq: 0, tilt: 0, walk: null, look: [0.2, 0.85], blink: blinkAt(t, [5.9, 8.0, 10.6, 12.8]), open: 0, smile: 0.5, sad: 0, joy: 0, sparkle: 0, armN: [1.25, 1.3], armF: [1.15, 1.4] };
  P.book = t < EV.bookDrop ? 1 - E.inOut(p(t, 3.2, 3.5)) : null;
  const lu = E.inOut(p(t, EV.lookUp, EV.lookUp + 0.2));
  P.look = lerpA(P.look, [1, -0.1], lu);
  P.tilt = -0.06 * lu + (t > 0.95 && t < 1.25 ? 0.05 : 0);
  const lowr = E.inOut(p(t, 3.2, 3.5));
  P.armN = lerpA(P.armN, [0.55, 0.95], lowr); P.armF = lerpA(P.armF, [0.45, 1.0], lowr);
  if (t >= EV.bookDrop) { P.armN = [0.35, 0.9]; P.armF = [0.3, 0.95]; }
  P.sq = 0.06 * decay(t, EV.lookUp, 10);
  // concern while Leo is sad
  const cn = win(t, EV.sad + 0.3, EV.hammer, 0.2, 0.1);
  P.smile = lerp(P.smile, -0.1, cn);
  // hammerspace sandwich
  const behind = win(t, EV.hammer, EV.sandOut, 0.08, 0.05);
  if (behind > 0) { P.armN = lerpA(P.armN, [-0.9, -0.3], behind); P.armF = lerpA(P.armF, [-0.8, -0.3], behind); }
  if (t >= EV.sandOut && t < EV.snap) { P.armN = [1.0, 1.35]; P.armF = [0.95, 1.4]; P.sandW = true; P.sq = 0.06 * decay(t, EV.sandOut, 12); }
  if (t >= EV.snap) {
    const off = E.back(p(t, EV.snap + 0.02, EV.snap + 0.25));
    P.armF = [0.95, 1.4];
    P.armN = lerpA([1.0, 1.35], [1.45, 0.05], off); P.strN = 1 + 0.45 * clamp(off) * (1 - E.inOut(p(t, EV.hand + 0.05, EV.hand + 0.3)));
    P.sandF = t >= EV.biteBia + 0.1 ? 2 : 1;
    P.sandN = t < EV.hand ? 1 : 0;
    P.smile = 0.9;
    if (t >= EV.hand) P.armN = lerpA([1.45, 0.05], [0.35, 0.9], E.inOut(p(t, EV.hand + 0.05, EV.hand + 0.3)));
    const bite = win(t, EV.biteBia - 0.08, EV.biteBia + 0.15, 0.06, 0.08);
    P.armF = lerpA(P.armF, [0.9, 2.1], bite);
    if (bite > 0.5) P.open = 0.5;
  }
  if (t >= EV.dogSit + 0.05) P.look = [0.55, 0.95];
  if (t >= EV.lookEach) P.look = [1, -0.1];
  const lg = win(t, EV.laugh, EV.toss + 0.25, 0.05, 0.08);
  if (lg > 0.5) { P.joy = 1; P.open = 0.5 + 0.35 * Math.abs(Math.sin(t * 23 + 1)); P.y -= 5 * Math.abs(Math.sin(t * 23 + 1)); }
  if (t > EV.catch) { P.joy = 1; P.open = 0.3; }
  const s = speech('bia', t);
  if (s) P.open = Math.max(P.open, s.open);
  return P;
}

function dogPose(t) {
  const Q = { face: -1, x: 2200, y: 905, walk: null, wag: t * 22, tilt: 0, look: [-0.3, -1], puppy: 0, wink: false, crust: false };
  if (t < EV.dogIn) return null;
  if (t < EV.dogSit) { Q.x = lerp(2150, 1095, E.out(p(t, EV.dogIn, EV.dogSit))); Q.walk = t * 30; Q.y -= Math.abs(Math.sin(t * 30)) * 6; }
  else Q.x = 1095;
  if (t > EV.sniff1 && t < EV.puppy) Q.tilt = 0.12 * Math.sin(t * 40);
  Q.puppy = win(t, EV.puppy, EV.catch - 0.3, 0.15, 0.15);
  if (Q.puppy > 0) Q.tilt = 0.18;
  const jump = p(t, EV.catch - 0.1, EV.catch + 0.2);
  if (jump > 0 && jump < 1) Q.y -= 80 * Math.sin(Math.PI * jump);
  Q.crust = t >= EV.catch;
  Q.wink = t >= EV.wink && t < EV.wink + 0.3;
  if (t >= EV.catch) Q.wag = t * 40;
  return Q;
}

// ─────────── background ───────────
function background(t) {
  const g = ctx.createLinearGradient(0, -200, 0, 800);
  g.addColorStop(0, '#8FD0E8'); g.addColorStop(1, '#FBEBCB');
  ctx.fillStyle = g; ctx.fillRect(-600, -600, W + 1200, H + 1200);
  blob(300, 190, 70, 70, '#FFE08A', null, 0, 26);
  ctx.globalAlpha = 0.35; blob(300, 190, 105, 105, '#FFE08A', null, 0, 26); ctx.globalAlpha = 1;
  // clouds
  [[380, 170, 1], [1150, 120, 0.8], [1700, 230, 1.1]].forEach(([x, y, s], i) => {
    const cx = x + t * (10 + i * 4);
    const parts = [[-60, 10, 50], [0, -10, 62], [60, 8, 48], [20, 22, 50], [-30, 24, 44]];
    parts.forEach(([dx, dy, r]) => blob(cx + dx * s, y + dy * s, r * s, r * s * 0.8, WHITE, null, 0, 20));
  });
  // hills + houses
  const hill = (base, amp, f, ph, col) => {
    const pts = [[-600, H + 400]];
    for (let x = -600; x <= W + 600; x += 60) pts.push([x, base - amp * Math.sin(x * f + ph) - amp * 0.4 * Math.sin(x * f * 2.3 + ph * 2)]);
    pts.push([W + 600, H + 400]);
    poly(J(pts, 1), col, null);
  };
  hill(610, 60, 0.004, 1, '#B9D99A');
  [[520, 548, '#F0A868'], [640, 560, '#E8E1D0'], [1480, 548, '#E88E7A'], [1600, 560, '#F2CF6B']].forEach(([x, y, c]) => {
    poly(J([[x - 34, y], [x + 34, y], [x + 34, y - 44], [x - 34, y - 44]], 1), c, INK, 3);
    poly(J([[x - 44, y - 42], [x, y - 80], [x + 44, y - 42]], 1), '#9C5A48', INK, 3);
    poly(J(rrectPts(x - 8, y - 32, 16, 16, 2, 2), 0.6), '#FFE9A8', INK, 2.5);
  });
  hill(700, 45, 0.003, 3, '#9ACB80');
  // ground
  poly(J([[-600, 770], [W + 600, 770], [W + 600, H + 600], [-600, H + 600]], 1), '#86BE63', null);
  poly(J([[-600, 830], [W + 600, 830], [W + 600, 975], [-600, 975]], 1.2), '#EBD5A6', null);
  line([[-600, 830], [W + 600, 830]], shade('#EBD5A6', 0.18), 4);
  for (let i = 0; i < 18; i++) { const x = hash(i) * 2400 - 200, y = 1000 + hash(i + 9) * 60; line([[x, y], [x + 6, y - 18]], '#6FA84F', 4); line([[x + 10, y], [x + 12, y - 14]], '#6FA84F', 4); }
  // tree
  limb([[240, 830], [248, 600], [236, 470]], 40, '#8A5A3B');
  const canopy = [[180, 420, 110], [300, 400, 120], [240, 320, 120], [130, 340, 80], [340, 320, 80]];
  canopy.forEach(([x, y, r]) => poly(J(ell(x, y, r, r * 0.9, 26)), '#5FA85A', INK, 4.5));
  canopy.forEach(([x, y, r]) => poly(J(ell(x, y, r - 4, r * 0.9 - 4, 26), 0.6), '#5FA85A', null));
  [[200, 380], [290, 340], [330, 420], [150, 330]].forEach(([x, y]) => blob(x, y, 9, 9, '#E85D3F', INK, 3, 10));
  // bushes behind bench
  [[900, 770, 70], [990, 760, 60], [1370, 770, 70], [1450, 775, 55]].forEach(([x, y, r]) => blob(x, y, r, r * 0.7, '#6DB35E', INK, 4.5, 22));
  // lamp
  limb([[1680, 832], [1680, 470]], 14, '#3C4A5C');
  poly(J([[1650, 470], [1710, 470], [1698, 430], [1662, 430]]), '#3C4A5C');
  blob(1680, 478, 16, 12, '#FFE9A8', INK, 3.5, 14);
  // birds
  if (t < 4) for (let i = 0; i < 3; i++) {
    const bx = -100 + t * 420 + i * 70, by = 260 + i * 30 + Math.sin(t * 6 + i) * 10, f = Math.sin(t * 20 + i * 2) * 12;
    line([[bx - 16, by - f], [bx, by], [bx + 16, by - f]], INK, 4);
  }
}
function bench() {
  const wood = '#C98B4F', dk = '#9C6536';
  [[890, 760, 890, 860], [1370, 760, 1370, 860]].forEach(([a, b, c, d]) => limb([[a, b], [c, d]], 14, dk));
  [[910, 740, 910, 600], [1350, 740, 1350, 600]].forEach(([a, b, c, d]) => limb([[a, b], [c, d]], 12, dk));
  poly(J(rrectPts(860, 600, 520, 28, 8)), wood);
  poly(J(rrectPts(860, 648, 520, 28, 8)), wood);
  poly(J(rrectPts(850, 736, 540, 26, 8)), wood);
  // lunchbox
  poly(J(rrectPts(1300, 686, 76, 52, 8)), '#E85D3F');
  poly(J([[1320, 686], [1325, 668], [1351, 668], [1356, 686]]), null, INK, 5);
  line([[1303, 708], [1373, 708]], shade('#E85D3F', 0.25), 3);
}

// ─────────── fx ───────────
function rainCloud(t) {
  const a = E.back(p(t, EV.cloudIn, EV.cloudIn + 0.25)) * (1 - E.inOut(p(t, EV.cloudOut, EV.cloudOut + 0.15)));
  if (a <= 0.01) return;
  const [hx, hy] = HEADS.leo;
  const cx = hx - 5, cy = hy - 170;
  ctx.save(); ctx.translate(cx, cy); ctx.scale(a, a);
  for (let i = 0; i < 7; i++) {
    const x = -50 + hash(i + BOIL * 3) * 100, y0 = 30 + ((t * 700 + i * 37) % 110);
    line([[x, y0], [x - 4, y0 + 18]], '#5B8BD9', 4);
  }
  const parts = [[-45, 5, 34], [0, -12, 44], [45, 5, 34], [0, 16, 36]];
  parts.forEach(([x, y, r]) => poly(J(ell(x, y, r, r * 0.8, 20)), '#9AA3B5', INK, 4.5));
  parts.forEach(([x, y, r]) => poly(J(ell(x, y, r - 4, r * 0.8 - 4, 20), 0.6), '#9AA3B5', null));
  ctx.restore();
}
function sparkles(cx, cy, t0, t, n = 6, R = 130, col = '#FFD23F') {
  const u = p(t, t0, t0 + 0.55);
  if (u <= 0 || u >= 1) return;
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU + 0.3, r = R * E.out(u);
    star4(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8, 16 * (1 - u) + 4, u * 3, col);
  }
}
function drawBubble(L, t) {
  const who = L.who;
  let idx = 0; while (idx < L.ct.length && L.ct[idx] <= t) idx++;
  const sIn = E.back(p(t, L.start - 0.08, L.start + 0.1)), sOut = 1 - E.inOut(p(t, L.end - 0.12, L.end));
  const s = Math.min(sIn, sOut);
  if (s <= 0.01) return;
  const [hx, hy] = HEADS[who];
  const lines = L.text.split('\n');
  ctx.font = FONT(54);
  const tw = Math.max(...lines.map(l => ctx.measureText(l).width));
  const bw = tw + 70, bh = lines.length * 58 + 44;
  const ax = hx + (who === 'leo' ? 20 : -20), ay = hy - 108;
  const bx = ax + (who === 'leo' ? -bw * 0.3 : -bw * 0.7), by = ay - 40 - bh;
  ctx.save();
  ctx.translate(ax, ay); ctx.scale(s, s); ctx.translate(-ax, -ay);
  const tail = J([[ax + (who === 'leo' ? -26 : 26), by + bh - 6], [ax + (who === 'leo' ? 14 : -14), by + bh - 6], [ax, ay]]);
  poly(tail, WHITE);
  poly(J(rrectPts(bx, by, bw, bh, 36, 7)), WHITE);
  poly(tail.map(([x, y], i) => i < 2 ? [x + (i ? -5 : 5) * (who === 'leo' ? 1 : -1), y - 6] : [x, y - 9]), WHITE, null);
  let shown = idx;
  lines.forEach((l, i) => {
    const vis = l.slice(0, Math.max(0, shown)); shown -= l.length + 1;
    ctx.font = FONT(54); ctx.fillStyle = INK; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(vis, bx + 35, by + 50 + i * 58);
  });
  ctx.restore();
}

// ─────────── camera + frame ───────────
function camera(t) {
  let c = [1010, 590, 1.22 + 0.04 * p(t, 0, 5.8)];
  const zin = E.inOut(p(t, 5.75, 6.25)), zout = E.inOut(p(t, 8.2, 8.55));
  c = lerpA(c, [800, 480, 1.6], zin * (1 - zout));
  c = lerpA(c, [1090, 620, 1.3], E.inOut(p(t, 11.65, 12.2)));
  return c;
}
function worldToScreen(c, [x, y]) { return [W / 2 + (x - c[0]) * c[2], H / 2 + (y - c[1]) * c[2]]; }

window.renderFrame = function (frame) {
  const T = frame / FPS;
  const AT = Math.floor(T * 12) / 12;           // animation on twos
  BOIL = Math.floor(T * 8); SID = 0;
  const cam = camera(T);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const weave = [(hash(BOIL * 1.3) - .5) * 1.5, (hash(BOIL * 2.1) - .5) * 1.5];
  ctx.setTransform(cam[2], 0, 0, cam[2], W / 2 - cam[0] * cam[2] + weave[0], H / 2 - cam[1] * cam[2] + weave[1]);

  background(AT);
  bench();
  if (AT >= EV.bookDrop) {
    const u = E.out(p(AT, EV.bookDrop, EV.bookDrop + 0.15));
    book(lerp(1170, 1338, u), lerp(620, 662, u) - 60 * Math.sin(Math.PI * u), false, lerp(0.6, -0.05, u));
  }
  const bia = biaPose(AT); drawKid(BIA, bia);
  const leo = leoPose(AT); drawKid(LEO, leo);
  const dog = dogPose(AT); if (dog) drawDog(dog);

  // fx
  rainCloud(AT);
  sparkles(HEADS.leo[0], HEADS.leo[1] - 170, EV.cloudOut, AT, 8, 150);
  sparkles(HEADS.leo[0], HEADS.leo[1] - 20, EV.cloudOut + 0.05, AT, 6, 120, WHITE);
  const gr = win(AT, EV.growl, EV.growl + 0.8, 0.08, 0.15);
  if (gr > 0) { ctx.globalAlpha = gr; hand('grrrr...', leo.x + 120 + Math.sin(AT * 40) * 3, 650, 42, INK, 'left', -0.1); ctx.globalAlpha = 1; }
  if (AT >= EV.snap && AT < EV.snap + 0.4) {
    const u = p(AT, EV.snap, EV.snap + 0.4);
    for (let i = 0; i < 7; i++) blob(1140 + (hash(i) - .5) * 160 * u, 640 + (hash(i + 3) - .3) * 60 * u + 200 * u * u, 5, 4, '#F1CF8A', INK, 2.5, 8);
    hand('crac!', 1160, 560 - 20 * u, 44, INK, 'center', 0.12);
  }
  if (AT >= EV.hand && AT < EV.hand + 0.8) {
    const u = p(AT, EV.hand, EV.hand + 0.8);
    heart(1060 - 20 * u, 520 - 140 * u, 1.6 * (1 - u * 0.5)); heart(1120 + 25 * u, 480 - 110 * u, 1.1 * (1 - u * 0.5));
  }
  if (dog && AT > EV.sniff1 && AT < EV.puppy + 0.5) {
    const a = win(AT, EV.sniff1 + 0.15, EV.puppy + 0.5, 0.06, 0.1);
    ctx.globalAlpha = a; hand('?', HEADS.dog[0] - 10, HEADS.dog[1] - 110, 90); ctx.globalAlpha = 1;
  }
  if (AT >= EV.sniff1 && AT < EV.sniff2 + 0.25) hand('snif', HEADS.dog[0] - 110, HEADS.dog[1] + 10, 36, INK, 'center', -0.2);
  // crust toss
  if (AT >= EV.toss && AT < EV.catch) {
    const u = p(AT, EV.toss, EV.catch);
    const s0 = leo.handWorld, s1 = [HEADS.dog[0] - 40, HEADS.dog[1] + 20];
    sandwichHalf(lerp(s0[0], s1[0], u), lerp(s0[1], s1[1], u) - 220 * Math.sin(Math.PI * u), 0.5, u * 9, true);
  }
  if (AT >= EV.catch && AT < EV.catch + 0.5) {
    const u = E.back(p(AT, EV.catch, EV.catch + 0.15));
    ctx.save(); ctx.translate(HEADS.dog[0] + 120, HEADS.dog[1] - 90); ctx.scale(u, u); ctx.rotate(-0.15);
    const pts = []; for (let i = 0; i < 16; i++) { const r = i % 2 ? 58 : 88; const a = i / 16 * TAU; pts.push([Math.cos(a) * r * 1.3, Math.sin(a) * r * 0.8]); }
    poly(J(pts), '#FFD23F'); hand('Arf!', 0, 4, 60);
    ctx.restore();
  }
  for (const L of TL.lines) drawBubble(L, AT);

  // iris in / out (screen space)
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  let ir = null, ic = [W / 2, H / 2];
  if (T < 0.7) ir = 1300 * E.out(p(T, 0, 0.7));
  if (T >= EV.irisOut) {
    ic = worldToScreen(cam, [HEADS.dog[0] + 10, HEADS.dog[1] + 10]);
    ir = lerp(1400, 170, E.inOut(p(T, EV.irisOut, EV.irisOut + 0.2)));
    ir = lerp(ir, 0, E.inOut(p(T, EV.wink + 0.1, EV.irisClose)));
  }
  if (ir != null) {
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.arc(ic[0], ic[1], Math.max(0, ir), 0, TAU, true);
    ctx.fillStyle = '#0E0B12'; ctx.fill();
  }
  if (T >= EV.fim) {
    const u = E.back(p(T, EV.fim, EV.fim + 0.25));
    ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(u, u); ctx.rotate(-0.04);
    BOIL = Math.floor(T * 8);
    hand('Fim.', 0, 0, 170, WHITE);
    ctx.restore();
  }
};
window.TOTAL_FRAMES = FPS * DUR;
window.ready = document.fonts.load(FONT(50));
