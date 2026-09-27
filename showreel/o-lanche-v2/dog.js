// dog.js — Pipoca, the park dog of "O Lanche" v2.  T.dog.draw(pose) → anchors.
// An ORIGINAL design: small tan mutt with brown spots, cream muzzle/bib/socks, long dark-brown floppy
// ears with a flicked tip, a curled tail, a popcorn-puff cream tuft on top ("Pipoca" = popcorn) and a
// teal collar with a gold tag. Big head (≈ body length), stubby legs.
// Drawn in a local "facing right" frame (origin = ground under the body, y up = negative), mirrored with
// scale(face). Deterministic: sniff/chew twitches come from pose phases or, if absent, from T.BOIL.
//
// pose (all optional):
//   x, y        ground point (world)            face 1 right / -1 left      scale (default 1 ≈ 170px tall sitting)
//   mode        'sit' | 'walk' | 'jump'
//   walk        trot phase (radians; ~2.2 cycles/s reads well on twos)
//   jumpU       0 take-off … 0.5 apex … 1 landing (body angle, leg tuck, ear lag)
//   lift        px above the ground (jump height). The contact shadow stays at y, shrinking with lift.
//   sq          squash (+) / stretch (−) about the feet
//   wag, wagAmp tail wag phase (radians) and amplitude (0..1.2; > .75 adds motion arcs)
//   tilt        extra head tilt (rad, + = nose down)          look [x,y] pupils −1..1
//   blink 0..1, wink 0/1 (near eye closes in a happy ^), puppy 0..1 (huge glossy pleading eyes,
//               brows up, pout + trembling lip, tear, begging paw when sitting — `beg` overrides the paw)
//   earPerk 0..1, earLift (rad, + = ears fly back/up; add for sudden moves)
//   mouth       'closed' | 'open' | 'tongue' | 'chew' | 'bark'      chewPh (optional jaw phase)
//   holding     'crust' | null  (uses T.props.sandwichHalf(..., state 2) when present; crustScale)
//   sniff 0..1  nose twitch + squint + scrunch + air lines        sniffPh (optional twitch phase)
// returns {head, nose, mouth, eyes:[near, far]} in the caller's current transform.
'use strict';
(function () {
  const T = window.TOON;
  const D = T.dog = {};

  // ── palette ──
  const C = D.COL = {
    body: '#E7B574', shade: '#D29E5F', spot: '#A0633A', ear: '#6A3B22', earIn: '#8A5234',
    cream: '#FCE7C2', tuft: '#FFF3D9', nose: '#2E2227', collar: '#2E9E96', tag: '#FFD23F',
    mouth: '#6E2433', tongue: '#EE7486', iris: '#4B2C1B', irisLt: '#9A6440', tear: '#A9DDF5', blush: '#F28A8A',
    crust: '#C98A45', crustLt: '#F1CF8A',
  };
  const LW = 4.4;          // main outline width (local units)

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
  const blobOf = (circles, n = 44) => resample(hull(circles.flatMap(([x, y, r]) => T.ell(x, y, r, r, 36))), n);
  // spine polyline from (x,y) heading a0, curving by `bend` over its length
  const spine = (x, y, a0, bend, len, n = 7, bendFn = u => u) => {
    const pts = [[x, y]]; let a;
    for (let i = 1; i <= n; i++) { a = a0 + bend * bendFn(i / n); x += Math.cos(a) * len / n; y += Math.sin(a) * len / n; pts.push([x, y]); }
    return pts;
  };
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
  // boil + smooth: jitter the points, then round them off so curves stay smooth at 3x zoom
  const sm = (pts, amp = T.JA) => T.chaikin(T.J(pts, amp), 1);
  const inked = (pts, fill, lw = LW, amp = T.JA) => T.shape(sm(pts, amp), fill, lw, { jitter: 0 });
  const oval = (cx, cy, rx, ry, fill, lw = LW, rot = 0, n = 22) => inked(T.ell(cx, cy, rx, ry, n, rot), fill, lw);
  // brush stroke; a 2-point segment is subdivided so the taper has room to show
  const stroke = (pts, ...r) => T.stroke(pts.length === 2 ? Array.from({ length: 5 }, (_, i) => T.lerpA(pts[0], pts[1], i / 4)) : pts, ...r);
  const shift = (pts, dx, dy) => pts.map(([x, y]) => [x + dx, y + dy]);
  // run fn with the canvas clipped to polygon pts
  const clipped = (pts, fn) => { const c = T.ctx; c.save(); T.path(pts); c.clip(); fn(); c.restore(); };
  // flat cel shade: shade colour inside pts, then the base colour shifted toward the light (upper-left on screen)
  const celShade = (P, base, shade, L) => clipped(P, () => { T.fillPts(P, shade); T.fillPts(shift(P, L.dx, L.dy), base); });
  const dot = (x, y, r, col) => { const c = T.ctx; c.beginPath(); c.arc(x, y, r, 0, T.TAU); c.fillStyle = col; c.fill(); };
  const soft = (x, y, rx, ry, col, a) => { const c = T.ctx; c.save(); c.globalAlpha *= a; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, T.TAU); c.fillStyle = col; c.fill(); c.restore(); };

  // ── limbs ──
  // stubby leg from hip to foot + oval paw. openTop: leg sits IN FRONT of the body, so no ink across its top.
  function leg(hip, foot, w, col, pawCol, openTop = false, bend = 3) {
    const mid = [(hip[0] + foot[0]) / 2 + bend, (hip[1] + foot[1]) / 2], ankle = [foot[0] + 1, foot[1] - 7];
    const sp = T.chaikin([hip, mid, ankle], 2, false);
    if (!openTop) inked(tube(sp, () => w, true, false), col, LW * 0.95);
    else openTube(sp, w, col);
    paw(foot[0] + 4, foot[1] - 6, pawCol);
  }
  // tube in front of the body: fill it, ink only its two sides (no seam across the top)
  function openTube(sp, w, col) {
    const P = T.J(tube(sp, () => w, false, false), 1.1), n = sp.length;
    T.fillPts(P, col);
    T.ink(T.chaikin(P.slice(0, n), 1, false), LW * 0.95, T.C.INK, false);
    T.ink(T.chaikin(P.slice(n), 1, false), LW * 0.95, T.C.INK, false);
  }
  function paw(x, y, col, rot = 0) {
    oval(x, y, 12.5, 8, col, LW * 0.9, rot, 18);
    const c = Math.cos(rot), s = Math.sin(rot), R = (dx, dy) => [x + dx * c - dy * s, y + dx * s + dy * c];
    [3, 8].forEach(k => stroke([R(k, 1), R(k + 0.5, 7.5)], 2.2, T.C.INK, 0.8, 0.5));     // toe splits
  }

  // tail: short tapered carrot with a brown tip; wag swings it through an arc with overlapping lag
  // curl > 0 hooks the tail tip forward (a perky curled mutt tail, not a straight hound tail)
  function tail(bx, by, a0, wagPh, amp, len = 46, curl = 0.2) {
    const sw = i => 0.55 * amp * Math.sin(wagPh - i * 0.55);
    const pts = [[bx, by]]; let x = bx, y = by;
    for (let i = 1; i <= 6; i++) { const a = a0 + sw(i) + curl * i; x += Math.cos(a) * len / 6; y += Math.sin(a) * len / 6; pts.push([x, y]); }
    const P = sm(tube(pts, u => T.lerp(16, 9.5, u)), 0.8);
    T.fillPts(P, C.body);
    clipped(P, () => T.blob(pts[6][0], pts[6][1], 12, 12, C.spot, 0, 14));
    T.ink(P, LW * 0.95, T.C.INK, true);
    // motion arcs when wagging hard
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

  // floppy ear: narrow root, wide rounded lobe. a = hang angle (π/2 = straight down), bend = tip curl.
  function ear(rx, ry, a, bend, len, col, showInside = 0) {
    const sp = spine(rx, ry, a, bend, len, 8, u => u * u);
    const P = inked(tube(sp, u => 14 + 16 * Math.sin(Math.min(1, u * 1.15) * Math.PI * 0.62), true, true), col, LW);
    if (showInside > 0.05) {          // lining shows when the ear flips up
      const c = T.ctx; c.save(); c.globalAlpha *= T.clamp(showInside);
      const sp2 = spine(rx, ry, a, bend, len * 0.8, 8, u => u * u);
      T.fillPts(T.J(tube(sp2, u => 6 + 9 * Math.sin(u * Math.PI * 0.6)), 0.8), C.earIn); c.restore();
    }
    return P;
  }

  // ── eyes ──
  // p = puppy amount. hl = local x-sign that points to screen-left (highlights stay lit from the upper left
  // whichever way the dog faces). closed 0..1, happy = ^ arc when closed (wink), else a soft ︶ lid.
  function eye(ex, ey, sx, S, closed, happy, which) {
    const p = S.puppy, hl = S.hl, INK = T.C.INK;
    if (closed > 0.55) {
      const w = T.lerp(9, 14, p) * sx;
      if (happy) stroke(T.chaikin([[ex - w, ey + 5], [ex - w * 0.35, ey - 4], [ex + w * 0.35, ey - 4], [ex + w, ey + 5]], 2, false), 5, INK, 0.75);
      else stroke(T.chaikin([[ex - w, ey], [ex - w * 0.4, ey + 4], [ex + w * 0.4, ey + 4], [ex + w, ey]], 2, false), 4.6, INK, 0.75);
      return;
    }
    const lid = 1 - closed * 0.9 - S.squint * 0.4;             // vertical openness
    const [lx, ly] = S.look;
    const srx = T.lerp(7.6, 17.5, p) * sx, sry = T.lerp(11, 20.5, p) * lid;     // sclera (puppy only)
    const irx = T.lerp(7.6, 13, p) * sx, iry = T.lerp(11, 16, p) * lid;         // iris (= the black eye when p = 0)
    const ix = ex + lx * (srx - irx + 2.4), iy = ey + ly * (sry - iry + 2.4);
    const drawIris = () => {
      const I = T.chaikin(T.J(T.ell(ix, iy, irx, iry, 18), p > 0.04 ? 0.7 : 1), 1);
      T.fillPts(I, T.mix(T.C.INK, C.iris, T.clamp(p * 1.4)));
      if (p > 0.04) {
        clipped(I, () => {
          soft(ix, iy + iry * 0.75, irx * 1.0, iry * 0.62, C.irisLt, 0.95 * p);            // glossy lower glow
          soft(ix, iy - iry * 0.2, irx * 0.62 * sx, iry * 0.55, T.C.INK, 0.9 * p);          // pupil
        });
      }
      // highlights: big soft oval + small round + (puppy) tiny dot and a curved rim reflection
      const k = T.lerp(1, 1.2, p);
      T.blob(ix - hl * irx * 0.34, iy - iry * 0.4, irx * 0.36 * k, iry * 0.3 * k, '#FFFFFF', 0, 16, 0.35 * hl, { jitter: 0.35 });
      dot(ix + hl * irx * 0.42, iy + iry * 0.38, irx * 0.15 * k, '#FFFFFF');
      if (p > 0.2) {
        const c = T.ctx; c.save(); c.globalAlpha *= T.p(p, 0.2, 0.6);
        dot(ix - hl * irx * 0.02, iy - iry * 0.66, irx * 0.08, '#FFFFFF');
        stroke(T.arcPts(ix, iy, irx * 0.72, iry * 0.74, hl > 0 ? 0.15 : Math.PI - 1.05, hl > 0 ? 1.05 : Math.PI - 0.15, 6), 1.8, 'rgba(255,255,255,0.8)', 1, 0);
        c.restore();
      }
    };
    if (p > 0.04) {
      const Sc = sm(T.ell(ex, ey, srx, sry, 26), 0.9);
      T.fillPts(Sc, T.C.PAPER);
      clipped(Sc, () => {
        soft(ex, ey - sry * 0.62, srx * 1.2, sry * 0.5, '#D8D0E4', 0.6 * p);             // lid shadow
        drawIris();
        if (p > 0.3) stroke(T.arcPts(ex, ey, srx * 0.84, sry * 0.84, Math.PI * 0.22, Math.PI * 0.78, 8), 3 * p, C.tear, 0.9, 0.3);  // wet lower rim
      });
      T.ink(Sc, T.lerp(2.4, 3.8, p), INK, true);
      stroke(T.arcPts(ex, ey, srx * 1.03, sry * 1.03, Math.PI * 1.06, Math.PI * 1.94, 10), T.lerp(3, 6, p), INK, 0.85, 0.4);  // upper lid
    } else drawIris();
    // a welling tear at the lower inner corner of the near eye when fully pleading
    if (which === 'near' && p > 0.75) {
      const a = T.p(p, 0.75, 1), tx = ex + srx * 0.5, ty = ey + sry * 0.95;
      const drop = Array.from({ length: 16 }, (_, i) => { const t = i / 16 * T.TAU, r = 1 - 0.55 * Math.max(0, -Math.sin(t)) ** 3; return [tx + Math.cos(t) * 3.4 * a * r, ty + Math.sin(t) * 4.2 * a - (Math.sin(t) < 0 ? 2.2 * a * (-Math.sin(t)) : 0)]; });
      T.shape(drop, C.tear, 1.8, { jitter: 0.3 });
      dot(tx - hl * 1, ty - 1, 1.1 * a, '#FFFFFF');
    }
  }
  // brow: short tapered ink stroke. innerSide = +1 if the inner end (toward the other eye) is at +x.
  function brow(ex, by, len, innerSide, lift, innerRaise) {
    const o = [ex - innerSide * len / 2, by - lift + innerRaise * 0.3], i = [ex + innerSide * len / 2, by - lift - innerRaise];
    const m = [(o[0] + i[0]) / 2, (o[1] + i[1]) / 2 - 3];
    stroke(T.chaikin([o, m, i], 2, false), 4.6, T.C.INK, 0.9, 0.5);
  }

  // crust in the mouth: T.props.sandwichHalf(state 2) when props.js is loaded, else a built-in crust
  function crust(x, y, s, rot) {
    if (T.props && T.props.sandwichHalf) return T.props.sandwichHalf(x, y, s, rot, 2);
    const c = T.ctx; c.save(); c.translate(x, y); c.rotate(rot); c.scale(s, s);
    // a fat bread-crust "smile": crescent of golden crust with a pale crumb edge on top
    const out = T.arcPts(0, -30, 48, 48, Math.PI * 0.15, Math.PI * 0.85, 14), inn = T.arcPts(0, -36, 40, 36, Math.PI * 0.82, Math.PI * 0.18, 14);
    const P = sm(out.concat(inn), 1);
    T.fillPts(P, C.crust);
    clipped(P, () => { T.fillPts(T.arcPts(0, -40, 44, 44, 0, Math.PI, 16), C.crustLt); soft(-10, 14, 12, 4, '#FFFFFF', 0.35); });
    T.ink(P, LW * 0.85, T.C.INK, true);
    [[-18, 8], [4, 12], [22, 6]].forEach(([dx, dy]) => dot(dx, dy, 1.6, T.shade(C.crust, 0.35)));
    c.restore();
  }

  // ── head ──
  // Head-local frame: origin = head centre, facing +x. Returns anchors in head-local coords.
  function head(S) {
    const p = S.puppy, INK = T.C.INK, m = S.mouth, hl = S.hl, chJ = S.chewJ;
    const mx = T.lerp(30, 20, p), my = T.lerp(19, 27, p) + chJ * 0.5;           // muzzle centre (short & round)
    const mrx = T.lerp(26, 25, p), mry = T.lerp(19, 18.5, p);
    const nx = mx + T.lerp(19, 13, p), ny = my - 11 - S.tw * 2.2;                // button nose
    const eN = [T.lerp(-6, -12, p), T.lerp(-13, -7, p)], eF = [T.lerp(25, 23, p), T.lerp(-15, -9, p)];
    const L = { dx: -3 * S.face, dy: -6 };

    // far ear (behind the skull; peeks out when frontal/puppy, perked or flying)
    const fa = Math.PI / 2 - 0.08 - 0.5 * p - S.earLocal + S.earSwing * 0.85 + S.perk * -1.7;
    ear(T.lerp(20, 38, p), T.lerp(-32, -26, p), fa, -0.15 - S.earBend * 0.5 + S.perk * 1.2, T.lerp(62, 66, p), T.shade(C.ear, 0.12), 0);
    // popcorn tuft (behind the skull so only the puffs show)
    [[-15, -49, 9.5], [10, -50, 9], [-2, -56, 11]].forEach(([x, y, r], i) => oval(x, y - S.perk * 2, r, r * 0.9, C.tuft, LW * 0.85, i * 0.7, 16));

    // skull + cheeks
    const H = sm(blobOf([[-4, -8, 44], [-15, 12, 36], [16, 14, 35]], 44), 1.3);
    T.fillPts(H, C.body);
    clipped(H, () => {
      T.fillPts(H, C.shade); T.fillPts(shift(H, L.dx, L.dy), C.body);
      T.blob(-34, -24, 20, 16, C.spot, 0, 18, -0.5);                      // spot on the back of the skull
      T.blob(-46, 20, 12, 10, C.spot, 0, 14);
    });
    T.ink(H, LW, INK, true);

    // mouth interior (under the muzzle) for open / bark / tongue / holding
    let open = { open: 13, tongue: 12, bark: 25 }[m] || 0;
    if (S.holding) open = Math.max(open, 5);
    const mouthC = [mx + 4, my + 19 + open * 0.5];
    if (open > 0) {
      const w0 = open > 20 ? 23 : 19;
      const top = T.arcPts(mx + 4, my + 10, w0, 8, Math.PI, T.TAU, 8), bot = T.arcPts(mx + 4, my + 12, w0 - 1, 9 + open, 0, Math.PI, 12);
      const M = sm(top.concat(bot), 1.1);
      T.fillPts(M, C.mouth);
      clipped(M, () => {
        T.blob(mx + 1, my + 21 + open, w0 * 0.75, 11, C.tongue, 0, 16);
        soft(mx + 4, my + 14, w0 * 0.8, 6, '#3A1420', 0.55);
      });
      T.ink(M, LW * 0.95, INK, true);
    }
    // chewing: puffed cheek bulging out behind the muzzle
    if (m === 'chew') oval(mx - 20, my + 12 + chJ * 0.6, 13, 11 - chJ * 0.5, C.body, LW * 0.9);

    // muzzle (cream), with a soft shade along its underside
    const Mz = sm(T.ell(mx, my, mrx, mry + chJ * 0.4, 28), 1.2);
    T.fillPts(Mz, C.cream);
    clipped(Mz, () => soft(mx + 4, my + mry + 1, mrx * 1.1, 8, C.shade, 0.35));
    T.ink(Mz, LW * 0.95, INK, true);
    [[-11, -1], [-5, 3], [-14, 5]].forEach(([dx, dy]) => dot(mx + dx, my + dy, 1.6, 'rgba(106,59,34,0.8)'));   // whisker dots
    if (m === 'bark') [[mx - 5, 1], [mx + 15, 1]].forEach(([x]) => T.shape([[x - 4, my + mry - 2], [x + 4, my + mry - 2], [x + 0.5, my + mry + 6]], '#FFFFFF', 2.2, { jitter: 0.4 }));

    // blush (appeal): puppy, wink, chewing
    const blush = Math.max(p * 0.9, S.wink ? 0.9 : 0, m === 'chew' ? 0.5 : 0);
    if (blush > 0) { soft(eN[0] - 13, eN[1] + 27, 11, 6.5, C.blush, 0.5 * blush); soft(eF[0] + 17, eF[1] + 28, 8, 5, C.blush, 0.4 * blush); }

    // eyes + brows
    eye(eN[0], eN[1], 1, S, Math.max(S.blink, S.wink), S.wink > 0, 'near');
    eye(eF[0], eF[1], 0.84, S, S.blink, false, 'far');
    const bark = m === 'bark' ? 1 : 0;
    const lift = 2 + 1.5 * p + bark * 4 + S.perk * 3 - S.sniff * 3;
    const raise = 8 * p - S.sniff * 3.5;
    // brow height above each eye, kept at least 6 units inside the skull outline
    const bY = (ex, ey) => Math.max(ey - T.lerp(11, 20.5, p) - T.lerp(7, 2, p), -8 - Math.sqrt(Math.max(0, 44 * 44 - (ex + 4) ** 2)) + 6 + lift);
    brow(eN[0] + 1, bY(eN[0], eN[1]) + S.wink * 5, T.lerp(13, 15, p), 1, lift - S.wink * 2, S.wink ? -3 : raise);
    brow(eF[0] - 4 * p, bY(eF[0], eF[1]) + 2 * p, T.lerp(10, 11, p), -1, lift, raise);
    if (S.sniff > 0.2) {            // sniff: scrunch wrinkles on the muzzle bridge
      stroke([[mx - 5, my - 16], [mx + 1, my - 18.5]], 2.4, INK, 0.9, 0.5); stroke([[mx, my - 12], [mx + 6, my - 14.5]], 2.2, INK, 0.9, 0.5);
    }

    // nose: round-cornered triangle with a highlight; twitches (squash + hop) while sniffing
    const nsx = 1 + 0.14 * S.tw, nsy = 1 - 0.12 * S.tw, nr = T.lerp(12.5, 13.5, p);
    const NP = T.ell(0, 0, nr, nr * 0.76, 24).map(([x, y]) => [nx + x * nsx * (y > 0 ? 1 - 0.38 * y / (nr * 0.76) : 1), ny + y * nsy]);
    inked(NP, C.nose, LW * 0.8, 0.8);
    T.blob(nx - hl * 4, ny - 4, 4.6, 2.5, 'rgba(255,255,255,0.85)', 0, 12, -0.25 * hl, { jitter: 0.3 });
    if (S.sniff > 0.05) {           // inhaled air: little strokes streaming into the nose
      const c = T.ctx; c.save(); c.globalAlpha *= T.clamp(S.sniff * 1.3) * 0.8;
      [[-0.35, 20], [0.05, 26], [0.45, 20]].forEach(([a, r], i) => {
        const d = r + 4 + (S.tw > 0 ? 3 : 0), ca = Math.cos(a), sa = Math.sin(a);
        stroke([[nx + ca * d, ny + sa * d], [nx + ca * (d + 11), ny + sa * (d + 11) - 2]], 2.4, INK, 1, 0.4);
      });
      c.restore();
    }

    // closed mouth: philtrum + "ω" smile; in puppy mode it becomes a small pout with a trembling lower lip
    if (open === 0) {
      const ch = m === 'chew' ? chJ : 0, py = ny + 7, jy = py + 8 + ch * 0.5;
      const qb = (q0, q1, q2) => Array.from({ length: 9 }, (_, i) => { const u = i / 8, a = (1 - u) * (1 - u), b = 2 * u * (1 - u), d = u * u; return [a * q0[0] + b * q1[0] + d * q2[0], a * q0[1] + b * q1[1] + d * q2[1]]; });
      stroke([[nx - 1, py], [nx - 2, jy]], 3.4, INK, 0.5);
      if (p < 0.5) {
        const sm0 = (1 - p * 2) * (m === 'chew' ? 0.5 : 1);
        const q0 = [nx - 2, jy], q2 = [mx - 16, my + 5 - 6 * sm0 + ch];       // philtrum → back corner (sag = smile)
        stroke(qb(q0, [(q0[0] + q2[0]) / 2, jy + 4 + 5 * sm0 + ch], q2), 3.8, INK, 0.7);
        stroke(T.chaikin([[nx - 2, jy], [nx + 4, jy + 3], [nx + 8, jy - 1 - 3 * sm0]], 1, false), 3.4, INK, 0.7);
      } else {
        // pout: a little "︵" and, under it, a wobbling lower lip (extra jitter every boil = quiver)
        stroke(qb([nx - 13, jy + 5], [nx - 3, jy - 3], [nx + 7, jy + 4]), 3.6, INK, 0.75);
        const q = T.J(qb([nx - 8, jy + 7], [nx - 3, jy + 12], [nx + 2, jy + 7]), 0.9 * p);
        stroke(q, 3, INK, 0.8, 0);
      }
    }
    if (m === 'tongue') {           // tongue lolling out of the side
      inked(tube(spine(mx - 1, my + 20, Math.PI / 2 - 0.25, 0.45, 20, 5), u => T.lerp(15, 17, u)), C.tongue, LW * 0.85, 1);
      stroke([[mx + 2, my + 24], [mx + 2.5, my + 35]], 2.2, T.shade(C.tongue, 0.35), 0.9, 0.3);
    }
    if (m === 'chew') for (let i = 0; i < 3; i++) { const h = T.hash(T.BOIL * 3.1 + i); dot(mx - 12 + i * 12 + h * 4, my + 27 + h * 12 + i * 3, 2 + h, C.crust); }
    if (S.holding === 'crust') crust(mx + 5, my + mry + 1, S.crustScale, 0.08);

    // near ear, hanging over the back of the skull; tip flicks back
    const na = Math.PI / 2 + 0.16 - S.earLocal + S.earSwing + S.perk * 1.9 - p * 0.1;
    ear(T.lerp(-36, -38, p), T.lerp(-26, -22, p), na, 0.45 + S.earBend - S.perk * 1.5, 70, C.ear, S.earFlip);

    return { nose: [nx, ny], mouth: mouthC, eyes: [eN, eF] };
  }

  // ── collar ──
  function collar(cx, cy, r, a0, a1) {
    const sp = T.arcPts(cx, cy, r, r * 0.75, a0, a1, 10);
    inked(tube(sp, () => 9, true, true), C.collar, LW * 0.8, 1);
    const k = Math.floor(sp.length * 0.62), [tx, ty] = sp[k];
    stroke([[tx, ty + 2], [tx, ty + 7]], 2.5, T.C.INK, 0, 0.3);
    oval(tx, ty + 12, 6.5, 6.5, C.tag, LW * 0.7, 0, 14);
    dot(tx - 2, ty + 10, 1.6, '#FFFFFF');
  }

  // ── main ──
  D.draw = function (pose = {}) {
    const P = Object.assign({
      x: 0, y: 0, face: 1, scale: 1, mode: 'sit', walk: 0, wag: 0, wagAmp: 1, tilt: 0, look: [0, 0], blink: 0,
      puppy: 0, wink: 0, earPerk: 0, mouth: 'closed', holding: null, sniff: 0, sq: 0,
      lift: 0, jumpU: 0.5, beg: null, crustScale: 0.62, sniffPh: null, chewPh: null, earLift: 0,
    }, pose);
    const c = T.ctx, face = P.face < 0 ? -1 : 1, puppy = T.clamp(P.puppy);
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
    T.shadow(P.mode === 'sit' ? -2 : -2, 2, (P.mode === 'sit' ? 64 : 76) * (1 - 0.45 * air), 11 * (1 - 0.45 * air), 1 - 0.55 * air);
    c.translate(0, -P.lift);
    c.scale(1 + 0.7 * P.sq, 1 - P.sq);            // squash (+) / stretch (−) about the feet

    const L = { dx: -3 * face, dy: -6 };
    const legW = 17, far = T.shade(C.body, 0.13), farPaw = T.shade(C.cream, 0.12);
    const wag = P.wag, amp = P.wagAmp;
    let headC, headRot = P.tilt, bodyRot = 0, earSwing = 0, earBend = 0, earFlip = 0, neck, collarArc;

    if (P.mode === 'sit') {
      const beg = T.clamp(P.beg != null ? P.beg : puppy);
      // tail sweeping on the ground behind, tip curling up
      tail(-42, -14, Math.PI + 0.3, wag, amp * 0.9, 44, 0.16);
      // far front leg + far back paw
      leg([27, -58], [32, 0], legW, far, farPaw, false, 2);
      paw(22, -5, farPaw);
      // body: rump on the ground, chest up (a pear)
      const B = sm(blobOf([[-16, -34, 33], [-4, -52, 28], [10, -72, 26]], 46), 1.3);
      celShade(B, C.body, C.shade, L);
      clipped(B, () => {
        T.blob(-26, -58, 14, 11, C.spot, 0, 16, 0.5);
        T.blob(21, -58, 13, 28, C.cream, 0, 18, -0.15);            // chest bib
      });
      T.ink(B, LW, T.C.INK, true);
      // near haunch + back paw
      paw(8, -6, C.cream);
      const Hh = sm(T.ell(-14, -29, 25, 23, 24, -0.3), 1.2);
      clipped(Hh, () => { T.fillPts(Hh, C.shade); T.fillPts(shift(Hh, L.dx, L.dy), C.body); T.blob(-22, -39, 11, 9, C.spot, 0, 14); });
      T.ink(Hh, LW, T.C.INK, true);
      // near front leg: straight, or lifted in a begging paw (elbow bent, paw dangling)
      if (beg > 0.02) {
        const el = T.lerpA([19, -30], [36, -38], beg), ft = T.lerpA([20, 0], [40, -24], beg);
        openTube(T.chaikin([[16, -58], el, ft], 2, false), legW, C.body);
        paw(ft[0] + 3, ft[1] + 2, C.cream, beg * 0.9);
      } else leg([16, -58], [18, 0], legW, C.body, C.cream, true, 1);
      headC = [24, -128]; neck = [16, -90]; collarArc = [0.15, 2.3];
      earSwing = 0.03 * Math.sin(wag * 0.5) * amp;
    } else {
      // walk (trot) & jump share the horizontal body; jump rotates it around the belly
      const ph = P.walk || 0, walking = P.mode === 'walk';
      const bob = walking ? -2 - 2 * Math.cos(2 * ph) : 0;
      const hb = walking ? -2 - 2 * Math.cos(2 * ph - 0.9) : 0;
      let feet, u = T.clamp(P.jumpU);
      const sh = { nF: [24, -44 + bob], fF: [31, -46 + bob], nB: [-30, -44 + bob], fB: [-23, -46 + bob] };
      if (walking) {
        // trot: diagonal pairs move together. stance slides back, swing lifts forward.
        const foot = (base, off) => {
          const q = ((ph + off) / T.TAU % 1 + 1) % 1, st = 15;
          if (q < 0.5) return [base + T.lerp(st, -st, q * 2), 0];
          const v = (q - 0.5) * 2; return [base + T.lerp(-st, st, T.E.inOut(v)), -11 * Math.sin(Math.PI * v)];
        };
        feet = { nF: foot(26, 0), fB: foot(-21, 0.05), fF: foot(33, Math.PI), nB: foot(-28, Math.PI + 0.05) };
        earSwing = 0.32 + 0.18 * Math.sin(2 * ph - 1.4); earBend = 0.25 + 0.3 * Math.sin(2 * ph - 2.3);
      } else {
        // jump: 0 take-off (stretched up) → 0.5 apex (tucked) → 1 landing reach
        const rise = 1 - u * 2;                                    // +1 rising … −1 falling
        const tuck = Math.sin(Math.PI * u);
        feet = {
          nF: T.lerpA([44, -28], [34, 4], T.clamp(-rise)), fF: T.lerpA([50, -32], [42, 2], T.clamp(-rise)),
          nB: T.lerpA([-58, -6], [-46, -30], tuck), fB: T.lerpA([-52, -10], [-40, -34], tuck),
        };
        // ears trail down-back while rising, fly up while falling (tips flutter behind)
        earSwing = rise > 0 ? 0.7 + 0.3 * rise : 0.7 - rise * 0.75; earBend = rise > 0 ? 0.5 : 0.5 - rise * 0.5;
        earFlip = T.clamp(-rise * 1.2);
      }
      c.save();
      if (!walking) {
        const ang = T.lerp(-0.55, 0.3, T.E.inOut(u)); bodyRot = ang;
        c.translate(0, -56); c.rotate(ang); c.translate(0, 56);
        headRot += -ang * 0.4 + T.lerp(-0.25, 0.05, u);
      } else { c.translate(0, -56); c.rotate(0.03 * Math.sin(2 * ph)); c.translate(0, 56); }
      tail(-50, -70 + bob, walking ? -2.3 : Math.PI + 0.15, wag, amp, 46, walking ? 0.24 : 0.1);
      leg(sh.fF, feet.fF, legW, far, farPaw, false, walking ? 3 : -4);
      leg(sh.fB, feet.fB, legW, far, farPaw, false, walking ? -3 : 4);
      leg(sh.nB, feet.nB, legW, C.body, C.cream, false, walking ? -3 : 4);
      leg(sh.nF, feet.nF, legW, C.body, C.cream, false, walking ? 3 : -4);
      const stretch = walking ? 1 : 1.06 + 0.1 * T.clamp(1 - u * 2.2);     // jump: long at take-off
      const B = sm(blobOf([[26 * stretch, -62 + bob, 29], [-2, -55 + bob, 27], [-30 * stretch, -59 + bob, 26]], 48), 1.3);
      celShade(B, C.body, C.shade, L);
      clipped(B, () => {
        T.blob(-8, -86 + bob, 17, 11, C.spot, 0, 16, 0.2);
        T.blob(-40, -66 + bob, 12, 10, C.spot, 0, 14);
        T.blob(10, -40 + bob, 34, 10, C.cream, 0, 18);            // belly
        T.blob(46, -60 + bob, 10, 24, C.cream, 0, 16, -0.3);      // chest bib
      });
      T.ink(B, LW, T.C.INK, true);
      headC = [60, -114 + hb + (walking ? 0 : 6)]; neck = [42, -80 + bob]; collarArc = [-0.2, 2.2];
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
      collar(neck[0], neck[1], 26, collarArc[0], collarArc[1]);
      let rot = headRot;
      if (P.mouth === 'bark') rot -= 0.14;
      rot += T.clamp(P.sniff) * 0.12;
      c.save();
      c.translate(headC[0], headC[1]); c.rotate(rot);
      const S = {
        face, hl: -face, puppy, mouth: P.mouth, wink: P.wink ? 1 : 0, blink: T.clamp(P.blink), look: P.mode === 'jump' && !pose.look ? [0.6, -0.6] : (pose.look || (puppy > 0.1 ? [0.15 * puppy, -0.45 * puppy] : [0, 0])),
        perk: T.clamp(P.earPerk + (P.mouth === 'bark' ? 0.25 : 0)), sniff: T.clamp(P.sniff), tw, chewJ,
        squint: P.sniff * 0.8 + (P.mouth === 'bark' ? 0.25 : 0),
        earLocal: (rot + bodyRot) * 0.85, earSwing: earSwing + P.earLift - (P.mouth === 'bark' ? 0.25 : 0), earBend, earFlip,
        holding: P.holding, crustScale: P.crustScale,
      };
      const a = head(S);
      result = {
        head: toCaller(0, 0), nose: toCaller(a.nose[0], a.nose[1]), mouth: toCaller(a.mouth[0], a.mouth[1]),
        eyes: [toCaller(a.eyes[0][0], a.eyes[0][1]), toCaller(a.eyes[1][0], a.eyes[1][1])],
      };
      c.restore();
    }
  };
})();
