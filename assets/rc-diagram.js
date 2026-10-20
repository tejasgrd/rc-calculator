/* RC Calc 2D airframe diagram renderer (top/side/front SVG). Depends on rc-core.js. */
'use strict';
/* =====================================================================
   5. DIAGRAM RENDERER: builds a standalone SVG string (explicit colours so exports look right)
   ===================================================================== */
class View {
  constructor(){ this.items = []; this.umin = Infinity; this.umax = -Infinity; this.vmin = Infinity; this.vmax = -Infinity; }
  ext(u, v){ if (u < this.umin) this.umin = u; if (u > this.umax) this.umax = u; if (v < this.vmin) this.vmin = v; if (v > this.vmax) this.vmax = v; }
  poly(pts, a){ this.items.push({ t:'poly', pts, a }); pts.forEach(p => this.ext(p[0], p[1])); }
  line(p, q, a){ this.items.push({ t:'line', p, q, a }); this.ext(p[0], p[1]); this.ext(q[0], q[1]); }
  ellipse(c, rx, ry, a){ this.items.push({ t:'ellipse', c, rx, ry, a }); this.ext(c[0] - rx, c[1] - ry); this.ext(c[0] + rx, c[1] + ry); }
  text(p, s, a){ this.items.push({ t:'text', p, s, a }); }
  cg(p){ this.items.push({ t:'cg', p }); }
  dim(o){ this.items.push(Object.assign({ t:'dim' }, o)); }
  get w(){ return this.umax - this.umin; } get h(){ return this.vmax - this.vmin; }
}
const attrs = a => Object.entries(a || {}).map(([k, v]) => `${k}="${esc(v)}"`).join(' ');
const r1 = n => Math.round(n * 10) / 10;

function renderView(view, s, ox, oy, C){
  const M = (u, v) => [r1(ox + (u - view.umin) * s), r1(oy + (v - view.vmin) * s)];
  const top = oy, bottom = oy + view.h * s, left = ox, right = ox + view.w * s;
  const out = [];
  const halo = `paint-order="stroke" stroke="${C.paper}" stroke-width="4" stroke-linejoin="round"`;
  for (const it of view.items) {
    if (it.t === 'poly') out.push(`<polygon points="${it.pts.map(p => M(p[0], p[1]).join(',')).join(' ')}" ${attrs(it.a)}/>`);
    else if (it.t === 'line') { const a = M(...it.p), b = M(...it.q); out.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" ${attrs(it.a)}/>`); }
    else if (it.t === 'ellipse') { const c = M(...it.c); out.push(`<ellipse cx="${c[0]}" cy="${c[1]}" rx="${r1(it.rx * s)}" ry="${r1(Math.max(it.ry * s, 0.8))}" ${attrs(it.a)}/>`); }
    else if (it.t === 'text') { const p = M(...it.p), a = it.a || {}; out.push(`<text x="${r1(p[0] + (a.dx || 0))}" y="${r1(p[1] + (a.dy || 0))}" font-size="${a.size || 12}" fill="${a.fill || C.dim}" text-anchor="${a.anchor || 'start'}" font-weight="${a.weight || 500}" ${halo}>${esc(it.s)}</text>`); }
    else if (it.t === 'cg') {
      const [x, y] = M(...it.p), r = 8;
      out.push(`<g aria-label="Center of gravity"><circle cx="${x}" cy="${y}" r="${r}" fill="${C.paper}" stroke="${C.cg}" stroke-width="1.8"/><path d="M${x} ${y}L${x} ${y - r}A${r} ${r} 0 0 1 ${x + r} ${y}Z M${x} ${y}L${x} ${y + r}A${r} ${r} 0 0 1 ${x - r} ${y}Z" fill="${C.cg}"/></g>`);
    } else if (it.t === 'dim') {
      let a, b, n;
      if (it.axis === 'h') {
        const y = it.at === 'min' ? top - it.off : it.at === 'max' ? bottom + it.off : M(0, it.at)[1] + it.off;
        a = [M(it.a, 0)[0], y]; b = [M(it.b, 0)[0], y];
        const ea = M(it.a, it.fa), eb = M(it.b, it.fb), dir = y < ea[1] ? -1 : 1;
        out.push(`<line x1="${ea[0]}" y1="${r1(ea[1] + dir * 3)}" x2="${a[0]}" y2="${r1(y + dir * 4)}" stroke="${C.dim}" stroke-width=".8" opacity=".7"/>`);
        out.push(`<line x1="${eb[0]}" y1="${r1(eb[1] + dir * 3)}" x2="${b[0]}" y2="${r1(y + dir * 4)}" stroke="${C.dim}" stroke-width=".8" opacity=".7"/>`);
        out.push(`<line x1="${a[0]}" y1="${r1(y)}" x2="${b[0]}" y2="${r1(y)}" stroke="${C.dim}" stroke-width="1" marker-start="url(#ad-arw)" marker-end="url(#ad-arw)"/>`);
        out.push(`<text x="${r1((a[0] + b[0]) / 2)}" y="${r1(y - 5)}" font-size="12" text-anchor="middle" fill="${C.dim}" font-weight="600" ${halo}>${esc(it.label)}</text>`);
      } else {
        const x = it.at === 'min' ? left - it.off : it.at === 'max' ? right + it.off : M(it.at, 0)[0] + it.off;
        a = [x, M(0, it.a)[1]]; b = [x, M(0, it.b)[1]];
        const ea = M(it.fa, it.a), eb = M(it.fb, it.b), dir = x < ea[0] ? -1 : 1;
        out.push(`<line x1="${r1(ea[0] + dir * 3)}" y1="${ea[1]}" x2="${r1(x + dir * 4)}" y2="${a[1]}" stroke="${C.dim}" stroke-width=".8" opacity=".7"/>`);
        out.push(`<line x1="${r1(eb[0] + dir * 3)}" y1="${eb[1]}" x2="${r1(x + dir * 4)}" y2="${b[1]}" stroke="${C.dim}" stroke-width=".8" opacity=".7"/>`);
        out.push(`<line x1="${r1(x)}" y1="${a[1]}" x2="${r1(x)}" y2="${b[1]}" stroke="${C.dim}" stroke-width="1" marker-start="url(#ad-arw)" marker-end="url(#ad-arw)"/>`);
        const my = r1((a[1] + b[1]) / 2), tx = r1(x + dir * 6);
        out.push(`<text x="${tx}" y="${my}" font-size="12" text-anchor="middle" fill="${C.dim}" font-weight="600" transform="rotate(-90 ${tx} ${my})" dy="${dir < 0 ? -1 : 9}" ${halo}>${esc(it.label)}</text>`);
      }
    }
  }
  return out.join('\n');
}

function airfoilPts(xle, c, zc, t = 0.11, m = 0.025, p = 0.4, n = 16){
  const up = [], lo = [];
  for (let k = 0; k <= n; k++) {
    const x = (1 - Math.cos(Math.PI * k / n)) / 2;
    const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    const yc = x < p ? m / (p * p) * (2 * p * x - x * x) : m / ((1 - p) ** 2) * ((1 - 2 * p) + 2 * p * x - x * x);
    up.push([xle + x * c, zc + (yc + yt) * c]); lo.push([xle + x * c, zc + (yc - yt) * c]);
  }
  return up.concat(lo.reverse());
}

/**
 * buildAirframeSVG(d, opts): pure apart from string building.
 * opts: { propD_m, colors, unit, surf:'none'|'ailerons'|'elevons', flaps }
 */
function buildAirframeSVG(d, opts){
  const C = opts.colors, unit = opts.unit;
  const g = airframeGeometry(d, opts.propD_m);
  const L = m => `${fmtS(fromSI('length', unit, m))} ${unitLabel('length', unit)}`;
  const b = d.span, half = b / 2, cr = d.rootChord, ct = d.tipChord, Lf = d.fuseLen;
  const tsw = Math.tan(d.sweep * Math.PI / 180), tdi = Math.tan(d.dihedral * Math.PI / 180);
  const xLE = y => g.xwLE + Math.abs(y) * tsw, cAt = y => cr + (ct - cr) * Math.abs(y) / half, xTE = y => xLE(y) + cAt(y);
  const solid = { fill:C.fill, stroke:C.ink, 'stroke-width':1.6, 'stroke-linejoin':'round' };
  const hatch = { fill:'url(#ad-hatch)', stroke:C.accent, 'stroke-width':1.1, 'stroke-linejoin':'round' };
  const thin = { fill:'none', stroke:C.ink, 'stroke-width':1, 'stroke-dasharray':'4 3', opacity:.6 };
  const fw = g.wf, hf = g.hf, D = g.D;
  const surf = g.tailless ? 'elevons' : opts.surf, SP = surfaceSpec(d), eh = 1 - SP.eleCf, rh = 1 - SP.rudCf;

  /* ---------- TOP VIEW (u = spanwise y, v = x aft) ---------- */
  const top = new View();
  const fuseTop = g.body === 'fuse'
    ? [[-.28*fw,0],[.28*fw,0],[.5*fw,.12*Lf],[.5*fw,.42*Lf],[.16*fw,Lf],[-.16*fw,Lf],[-.5*fw,.42*Lf],[-.5*fw,.12*Lf]]
    : g.body === 'stick'
      ? [[-fw,0],[fw,0],[fw,.14*Lf],[fw/2,.18*Lf],[fw/2,Lf],[-fw/2,Lf],[-fw/2,.18*Lf],[-fw,.14*Lf]]
      : Array.from({ length:24 }, (_, k) => { const t = k / 23, w = fw / 2 * Math.pow(Math.sin(Math.PI * Math.min(t * 1.15, 1)), 0.6); return [w, t * Lf]; }).concat(Array.from({ length:24 }, (_, k) => { const t = 1 - k / 23, w = fw / 2 * Math.pow(Math.sin(Math.PI * Math.min(t * 1.15, 1)), 0.6); return [-w, t * Lf]; }));
  const wingTop = [[-half, xLE(-half)], [0, g.xwLE], [half, xLE(half)], [half, xTE(half)], [0, g.xwLE + cr], [-half, xTE(-half)]];
  const surfPoly = (y1, y2, frac) => [[y1, xTE(y1) - frac * cAt(y1)], [y2, xTE(y2) - frac * cAt(y2)], [y2, xTE(y2)], [y1, xTE(y1)]];
  const drawWingTop = () => {
    top.poly(wingTop, solid);
    const spans = [];
    if (surf === 'ailerons') spans.push([SP.ailStart, SP.ailEnd, SP.ailCf]);
    if (surf === 'elevons') spans.push([SP.elevonStart, SP.elevonEnd, SP.elevonCf]);
    if ((opts.flaps || SP.flaps) && surf !== 'elevons') spans.push([SP.flapStart, SP.flapEnd, SP.flapCf]);
    for (const [a, z, fr] of spans) { top.poly(surfPoly(a * half, z * half, fr), hatch); top.poly(surfPoly(-a * half, -z * half, fr), hatch); }
  };
  if (d.wingMount === 'low') { drawWingTop(); top.poly(fuseTop, solid); } else { top.poly(fuseTop, solid); drawWingTop(); }
  if (!g.tailless) {
    const hs = d.hSpan / 2, hc = d.hChord;
    top.poly([[-hs, g.xhLE], [hs, g.xhLE], [hs, g.xhLE + hc], [-hs, g.xhLE + hc]], solid);
    top.poly([[-hs, g.xhLE + eh * hc], [hs, g.xhLE + eh * hc], [hs, g.xhLE + hc], [-hs, g.xhLE + hc]], hatch);
  }
  const vt = Math.max(d.vChord * 0.05, b * 0.004);
  const finYs = g.tailless ? [-half, half] : [0];
  for (const fy of finYs) top.poly([[fy - vt, g.xvLE], [fy + vt, g.xvLE], [fy + vt, g.xvLE + d.vChord], [fy - vt, g.xvLE + d.vChord]], { fill:C.ink, stroke:C.ink, 'stroke-width':1 });
  // motor + prop
  const motorX0 = d.motorPos === 'pusher' ? g.propX - g.mlen - 0.004 * Lf : g.propX + 0.004 * Lf;
  top.poly([[-g.mdia/2, motorX0], [g.mdia/2, motorX0], [g.mdia/2, motorX0 + g.mlen], [-g.mdia/2, motorX0 + g.mlen]], { fill:C.ink, stroke:C.ink, 'stroke-width':1, opacity:.85 });
  top.ellipse([0, g.propX], D / 2, D * 0.035, { fill:C.band, stroke:C.accent, 'stroke-width':1.2, 'stroke-dasharray':'5 3' });
  top.line([-D / 2, g.propX], [D / 2, g.propX], { stroke:C.ink, 'stroke-width':3, 'stroke-linecap':'round' });
  // CG band, MAC, CG
  const bw = Math.max(fw * 1.4, b * 0.09);
  top.poly([[-bw, g.band[0]], [bw, g.band[0]], [bw, g.band[1]], [-bw, g.band[1]]], { fill:C.band, stroke:C.accent, 'stroke-width':.8, 'stroke-dasharray':'3 2' });
  top.line([g.yMac, g.xMacLE], [g.yMac, g.xMacLE + g.mac], { stroke:C.accent, 'stroke-width':2.6, 'stroke-dasharray':'7 4' });
  top.text([g.yMac, g.xMacLE + g.mac], `MAC ${L(g.mac)}`, { dx:6, dy:14, fill:C.accent, weight:700, size:11 });
  top.cg([0, g.xcg]);
  top.text([bw, g.xcg], `CG ${fmt(d.cg, 0)}% MAC`, { dx:8, dy:4, fill:C.cg, weight:700, size:11 });
  top.dim({ axis:'h', a:-half, b:half, at:'min', off:22, fa:xLE(-half), fb:xLE(half), label:`Span ${L(b)}` });
  top.dim({ axis:'v', a:0, b:Lf, at:'max', off:22, fa:fw / 2, fb:fw / 2, label:`Fuselage ${L(Lf)}` });
  top.dim({ axis:'v', a:xLE(-half), b:xTE(-half), at:'min', off:16, fa:-half, fb:-half, label:`Tip ${L(ct)}` });

  /* ---------- SIDE VIEW (u = x, v = -z) ---------- */
  const side = new View(), Sx = (x, z) => [x, -z];
  const fuseSide = g.body === 'fuse'
    ? [[0,.25*hf],[.12*Lf,.5*hf],[.5*Lf,.45*hf],[Lf,.2*hf],[Lf,.02*hf],[.55*Lf,-.38*hf],[.15*Lf,-.5*hf],[0,-.3*hf]]
    : g.body === 'stick'
      ? [[0,hf/2],[Lf,hf/2],[Lf,-hf/2],[.14*Lf,-hf/2],[.14*Lf,-hf*1.3],[0,-hf*1.3]]
      : Array.from({ length:24 }, (_, k) => { const t = k / 23, h = hf / 2 * Math.pow(Math.sin(Math.PI * Math.min(t * 1.15, 1)), 0.6); return [t * Lf, h]; }).concat(Array.from({ length:24 }, (_, k) => { const t = 1 - k / 23, h = hf / 2 * Math.pow(Math.sin(Math.PI * Math.min(t * 1.15, 1)), 0.6); return [t * Lf, -h * 0.8]; }));
  const tR = g.tailless ? 0.09 : 0.11, mR = g.tailless ? 0.01 : 0.025;
  const vb = g.vBaseZ, hv = d.vHeight, cv = d.vChord;
  side.poly([[g.xvLE, vb], [g.xvLE + .45 * cv, vb + hv], [g.xvLE + cv, vb + hv], [g.xvLE + cv, vb]].map(p => Sx(...p)), solid);
  side.poly([[g.xvLE + rh * cv, vb], [g.xvLE + rh * cv, vb + hv], [g.xvLE + cv, vb + hv], [g.xvLE + cv, vb]].map(p => Sx(...p)), hatch);
  side.poly(fuseSide.map(p => Sx(...p)), solid);
  if (g.body === 'fuse' && d.wingMount !== 'high') side.poly([[.2*Lf,.42*hf],[.27*Lf,.75*hf],[.4*Lf,.72*hf],[.46*Lf,.45*hf]].map(p => Sx(...p)), { fill:C.band, stroke:C.ink, 'stroke-width':1.2 });
  side.poly(airfoilPts(xLE(half), ct, g.wingZ + half * tdi, tR, mR).map(p => Sx(...p)), thin);
  side.poly(airfoilPts(g.xwLE, cr, g.wingZ, tR, mR).map(p => Sx(...p)), solid);
  if (!g.tailless) {
    const hc = d.hChord, ht = Math.max(0.035 * hc, 0.002);
    side.poly([[g.xhLE, g.hTailZ + ht], [g.xhLE + hc, g.hTailZ + ht * .4], [g.xhLE + hc, g.hTailZ - ht * .4], [g.xhLE, g.hTailZ - ht]].map(p => Sx(...p)), solid);
    side.poly([[g.xhLE + eh * hc, g.hTailZ + ht * .7], [g.xhLE + hc, g.hTailZ + ht * .4], [g.xhLE + hc, g.hTailZ - ht * .4], [g.xhLE + eh * hc, g.hTailZ - ht * .7]].map(p => Sx(...p)), hatch);
  }
  if (d.motorPos === 'pusher' && g.propZ > g.wingZ + 0.02 * cr) side.line(Sx(motorX0 + g.mlen / 2, g.wingZ + 0.06 * cr), Sx(motorX0 + g.mlen / 2, g.propZ), { stroke:C.ink, 'stroke-width':2 });
  side.poly([[motorX0, g.propZ + g.mdia / 2], [motorX0 + g.mlen, g.propZ + g.mdia / 2], [motorX0 + g.mlen, g.propZ - g.mdia / 2], [motorX0, g.propZ - g.mdia / 2]].map(p => Sx(...p)), { fill:C.ink, stroke:C.ink, 'stroke-width':1, opacity:.85 });
  side.ellipse(Sx(g.propX, g.propZ), D * 0.035, D / 2, { fill:C.band, stroke:C.accent, 'stroke-width':1.2, 'stroke-dasharray':'5 3' });
  side.line(Sx(g.propX, g.propZ - D / 2), Sx(g.propX, g.propZ + D / 2), { stroke:C.ink, 'stroke-width':3, 'stroke-linecap':'round' });
  const sp = d.motorPos === 'pusher' ? 1 : -1;
  side.poly([[g.propX, g.propZ + D * .05], [g.propX + sp * D * .08, g.propZ], [g.propX, g.propZ - D * .05]].map(p => Sx(...p)), { fill:C.ink, stroke:C.ink });
  const bh = Math.max(hf * 0.9, cr * 0.25);
  side.poly([[g.band[0], g.wingZ + bh], [g.band[1], g.wingZ + bh], [g.band[1], g.wingZ - bh], [g.band[0], g.wingZ - bh]].map(p => Sx(...p)), { fill:C.band, stroke:C.accent, 'stroke-width':.8, 'stroke-dasharray':'3 2' });
  side.cg(Sx(g.xcg, g.wingZ));
  side.dim({ axis:'h', a:Math.min(0, g.propX), b:Lf, at:'max', off:22, fa:-Math.min(-hf/2, g.propZ - D/2), fb:-0.02*hf, label:`Length ${L(Lf - Math.min(0, g.propX))} (incl. prop)` });
  if (!g.tailless) side.dim({ axis:'h', a:g.xMacQC, b:g.xhLE + 0.25 * d.hChord, at:'max', off:50, fa:-g.wingZ, fb:-g.hTailZ, label:`Tail arm ${L(g.lh)}` });
  side.dim({ axis:'h', a:g.xwLE, b:g.xwLE + cr, at:'min', off:20, fa:-(g.wingZ + 0.06 * cr), fb:-g.wingZ, label:`Root ${L(cr)}` });
  side.dim({ axis:'v', a:-(vb + hv), b:-vb, at:'max', off:18, fa:g.xvLE + cv, fb:g.xvLE + cv, label:`Fin ${L(hv)}` });

  /* ---------- FRONT VIEW (u = y, v = -z) ---------- */
  const front = new View(), Fz = (y, z) => [y, -z];
  if (!g.tailless) { const hs = d.hSpan / 2, ht = Math.max(0.035 * d.hChord, 0.002); front.poly([[-hs, g.hTailZ + ht], [hs, g.hTailZ + ht], [hs, g.hTailZ - ht], [-hs, g.hTailZ - ht]].map(p => Fz(...p)), solid); }
  for (const fy of finYs) front.poly([[fy - vt, vb], [fy + vt, vb], [fy + vt * .6, vb + hv], [fy - vt * .6, vb + hv]].map(p => Fz(...p)), solid);
  const trr = tR * cr / 2, ttt = tR * ct / 2, tipZ = g.wingZ + half * tdi;
  front.poly([[0, g.wingZ + trr], [half, tipZ + ttt], [half, tipZ - ttt], [0, g.wingZ - trr], [-half, tipZ - ttt], [-half, tipZ + ttt]].map(p => Fz(...p)), solid);
  if (g.body === 'stick') front.poly([[-fw/2, hf/2], [fw/2, hf/2], [fw/2, -hf/2], [-fw/2, -hf/2]].map(p => Fz(...p)), solid);
  else front.ellipse(Fz(0, 0), fw / 2, hf / 2, solid);
  front.ellipse(Fz(0, g.propZ), D / 2, D / 2, { fill:C.band, stroke:C.accent, 'stroke-width':1.2, 'stroke-dasharray':'5 3' });
  front.ellipse(Fz(0, g.propZ), g.mdia / 2, g.mdia / 2, { fill:C.ink, stroke:C.ink });
  front.line(Fz(-D / 2 * .96, g.propZ), Fz(D / 2 * .96, g.propZ), { stroke:C.ink, 'stroke-width':3, 'stroke-linecap':'round', opacity:.8 });
  if (Math.abs(d.dihedral) > 0.05) {
    front.line(Fz(0, g.wingZ), Fz(half, g.wingZ), { stroke:C.dim, 'stroke-width':.9, 'stroke-dasharray':'3 3', opacity:.8 });
    front.text(Fz(half * .55, g.wingZ), `Dihedral ${fmt(d.dihedral, 1)}°`, { dy:16, anchor:'middle', size:11, weight:700 });
  }
  front.dim({ axis:'v', a:-(vb + hv), b:-Math.min(-hf / 2, g.propZ - D / 2, tipZ), at:'max', off:20, fa:half, fb:half, label:`Height ${L(vb + hv - Math.min(-hf / 2, g.propZ - D / 2, tipZ))}` });
  front.text(Fz(0, g.propZ - D / 2), `Prop ⌀ ${L(D)}`, { dy:16, anchor:'middle', size:11, fill:C.accent, weight:700 });

  /* ---------- LAYOUT ---------- */
  const W = 1000, PAD = 66, TH = 26, sideW = 600, frontW = 400;
  let s = Math.min((W - 2 * PAD) / top.w, 560 / top.h, (sideW - 2 * PAD) / side.w, (frontW - 2 * PAD) / front.w);
  if (!isFinite(s) || s <= 0) s = 1;
  const topH = TH + 2 * PAD + top.h * s;
  const rowC = Math.max(side.h, front.h) * s, rowH = TH + 2 * PAD + rowC, footH = 60;
  const H = Math.ceil(topH + rowH + footH);
  const title = (x, y, t) => `<text x="${x}" y="${y}" font-size="11" letter-spacing="2" font-weight="700" fill="${C.accent}">${t}</text>`;
  // scale bar
  const target = fromSI('length', unit, b * 0.25), pow = Math.pow(10, Math.floor(Math.log10(target)));
  const nice = [1, 2, 5, 10].map(k => k * pow).reduce((a, c) => Math.abs(c - target) < Math.abs(a - target) ? c : a);
  const barPx = toSI('length', unit, nice) * s, by = H - 30;
  const segs = [0, 1, 2, 3].map(k => `<rect x="${r1(30 + k * barPx / 4)}" y="${r1(by)}" width="${r1(barPx / 4)}" height="6" fill="${k % 2 ? C.paper : C.ink}" stroke="${C.ink}" stroke-width=".8"/>`).join('');
  const presetLabel = (PRESETS[d.preset] || PRESETS.trainer).label;
  const info = `Span ${L(b)} · Area ${fmtS(g.S * 100)} dm² · AR ${fmt(g.AR, 1)} · MAC ${L(g.mac)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif" role="img" aria-labelledby="ad-title ad-desc">
<title id="ad-title">Airframe diagram: ${esc(presetLabel)}</title>
<desc id="ad-desc">Top, side and front views. ${esc(info)}. CG at ${fmt(d.cg, 0)} percent of MAC. Motor: ${esc(d.motorPos)}.</desc>
<defs>
<pattern id="ad-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="${C.grid}" stroke-width="1"/></pattern>
<pattern id="ad-grid5" width="100" height="100" patternUnits="userSpaceOnUse"><rect width="100" height="100" fill="url(#ad-grid)"/><path d="M100 0H0V100" fill="none" stroke="${C.gridMajor}" stroke-width="1"/></pattern>
<pattern id="ad-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="${C.fill}"/><line x1="0" y1="0" x2="0" y2="6" stroke="${C.accent}" stroke-width="1.6"/></pattern>
<marker id="ad-arw" viewBox="0 0 8 6" refX="8" refY="3" markerWidth="8" markerHeight="6" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M0 0L8 3L0 6z" fill="${C.dim}"/></marker>
</defs>
<rect width="${W}" height="${H}" fill="${C.paper}"/><rect width="${W}" height="${H}" fill="url(#ad-grid5)"/>
<rect x="6" y="6" width="${W - 12}" height="${H - 12}" fill="none" stroke="${C.ink}" stroke-width="1.2" opacity=".5"/>
<line x1="6" y1="${r1(topH)}" x2="${W - 6}" y2="${r1(topH)}" stroke="${C.ink}" stroke-width=".8" opacity=".35"/>
<line x1="${sideW}" y1="${r1(topH)}" x2="${sideW}" y2="${r1(topH + rowH)}" stroke="${C.ink}" stroke-width=".8" opacity=".35"/>
<line x1="6" y1="${r1(topH + rowH)}" x2="${W - 6}" y2="${r1(topH + rowH)}" stroke="${C.ink}" stroke-width=".8" opacity=".35"/>
${title(22, 26, 'TOP VIEW')}${title(22, r1(topH + 22), 'SIDE VIEW')}${title(sideW + 16, r1(topH + 22), 'FRONT VIEW')}
${renderView(top, s, (W - top.w * s) / 2, TH + PAD, C)}
${renderView(side, s, (sideW - side.w * s) / 2, topH + TH + PAD + (rowC - side.h * s) / 2, C)}
${renderView(front, s, sideW + (frontW - front.w * s) / 2, topH + TH + PAD + (rowC - front.h * s) / 2, C)}
${segs}<text x="${r1(30 + barPx + 8)}" y="${r1(by + 7)}" font-size="11" fill="${C.dim}" font-weight="600">${esc(fmtS(nice))} ${esc(unitLabel('length', unit))}</text>
<text x="30" y="${r1(by - 8)}" font-size="10" fill="${C.dim}" letter-spacing="1">SCALE</text>
<text x="${W - 24}" y="${r1(H - 36)}" font-size="13" text-anchor="end" font-weight="700" fill="${C.ink}">${esc(presetLabel)}</text>
<text x="${W - 24}" y="${r1(H - 19)}" font-size="11" text-anchor="end" fill="${C.dim}">${esc(info)} · RC Calc · estimate, not a building plan</text>
</svg>`;
}

if (typeof module !== 'undefined') module.exports = { View, renderView, airfoilPts, buildAirframeSVG };
