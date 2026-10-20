/* RC Calc 3D: lofted airframe mesh (pure), STL export, and a dependency-free canvas viewer.
   World axes: x aft (m), y right (m), z up (m). Depends on rc-core.js and rc-aero.js. */
'use strict';
const Mesh3D = (() => {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = v => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  function loft(tris, rings, part, closed = true){ // rings: arrays of points with equal length
    for (let i = 0; i < rings.length - 1; i++) { const A = rings[i], B = rings[i + 1], n = A.length;
      for (let k = 0; k < (closed ? n : n - 1); k++) { const k2 = (k + 1) % n; tris.push({ p:[A[k], B[k], B[k2]], part }, { p:[A[k], B[k2], A[k2]], part }); } }
  }
  function cap(tris, ring, part, flip){
    const c = ring.reduce((s, p) => [s[0] + p[0] / ring.length, s[1] + p[1] / ring.length, s[2] + p[2] / ring.length], [0, 0, 0]);
    for (let k = 0; k < ring.length; k++) { const a = ring[k], b = ring[(k + 1) % ring.length]; tris.push({ p:flip ? [c, b, a] : [c, a, b], part }); }
  }
  function section(foil, chord, xLE, y, z, twistRad, vertical){ // ring around the airfoil (TE upper → LE → TE lower)
    const pts = foil.xs.map((x, i) => [x, foil.yu[i]]).reverse().concat(foil.xs.slice(1, -1).map((x, i) => [x, foil.yl[i + 1]]));
    return pts.map(([x, h]) => {
      let lx = (x - 0.25) * chord, lz = h * chord; const c = Math.cos(twistRad), s = Math.sin(twistRad);
      const rx = lx * c + lz * s, rz = -lx * s + lz * c; lx = rx + 0.25 * chord; lz = rz;
      return vertical ? [xLE + lx, y + lz, z] : [xLE + lx, y, z + lz];
    });
  }
  /** build(d, {airfoil, propD}) → { tris:[{p:[[x,y,z]×3], part, n, solid}], bounds } */
  function build(d, o = {}){
    const g = airframeGeometry(d, o.propD || 0.2), tris = [];
    const foil = Airfoil.resample((o.airfoil || Airfoil.get('clarky')).points, 18), tail = Airfoil.resample(Airfoil.naca4(0, 0.4, 0.07, 24), 12);
    const b2 = d.span / 2, tsw = Math.tan(d.sweep * Math.PI / 180), tdi = Math.tan(d.dihedral * Math.PI / 180), wash = -(d.washout || 0) * Math.PI / 180;
    // wing: 4 stations per half so the planform/dihedral read well
    for (const side of [1, -1]) {
      const rings = [0, 0.33, 0.66, 1].map(t => { const y = t * b2, c = d.rootChord + (d.tipChord - d.rootChord) * t;
        return section(foil, c, g.xwLE + y * tsw, side * y, g.wingZ + y * tdi, wash * t, false); });
      if (side < 0) rings.forEach(r => r.reverse());
      loft(tris, rings, 'wing'); cap(tris, rings[rings.length - 1], 'wing', false);
    }
    if (!g.tailless) for (const side of [1, -1]) {
      const rings = [0, 1].map(t => section(tail, d.hChord, g.xhLE, side * t * d.hSpan / 2, g.hTailZ, 0, false));
      if (side < 0) rings.forEach(r => r.reverse());
      loft(tris, rings, 'tail'); cap(tris, rings[1], 'tail', false);
    }
    const finYs = g.tailless ? [-b2, b2] : [0];
    for (const fy of finYs) {
      const base = section(tail, d.vChord, g.xvLE, fy, g.vBaseZ, 0, true), top = section(tail, 0.55 * d.vChord, g.xvLE + 0.45 * d.vChord, fy, g.vBaseZ + d.vHeight, 0, true);
      loft(tris, [base, top], 'tail'); cap(tris, top, 'tail', false); cap(tris, base, 'tail', true);
    }
    // fuselage: superellipse sections along x
    const fp = Templates.fuseProfiles(d, g), K = 26, M = 16, ex = g.body === 'stick' ? 8 : 2.6, rings = [];
    for (let k = 0; k <= K; k++) {
      const x = fp.Lf * k / K, zt = fp.top(x) / 1000, zb = fp.bot(x) / 1000, w = Math.max(0.0008, fp.width(x) / 2000), zc = (zt + zb) / 2, hz = Math.max(0.0008, (zt - zb) / 2);
      rings.push(Array.from({ length:M }, (_, m) => { const a = 2 * Math.PI * m / M, ca = Math.cos(a), sa = Math.sin(a);
        return [x / 1000, w * Math.sign(ca) * Math.pow(Math.abs(ca), 2 / ex), zc + hz * Math.sign(sa) * Math.pow(Math.abs(sa), 2 / ex)]; }));
    }
    loft(tris, rings, 'fuse'); cap(tris, rings[0], 'fuse', true); cap(tris, rings[K], 'fuse', false);
    // motor + spinner (tilted by the mount's down/right-thrust about the point where the motor meets the airframe)
    const pusher = d.motorPos === 'pusher', mx0 = pusher ? g.propX - g.mlen - 0.004 * d.fuseLen : g.propX + 0.004 * d.fuseLen, r = g.mdia / 2, iMotor = tris.length;
    const cyl = [mx0, mx0 + g.mlen].map(x => Array.from({ length:14 }, (_, m) => { const a = 2 * Math.PI * m / 14; return [x, r * Math.cos(a), g.propZ + r * Math.sin(a)]; }));
    loft(tris, cyl, 'motor'); cap(tris, cyl[0], 'motor', true); cap(tris, cyl[1], 'motor', false);
    const tipX = g.propX + (pusher ? 1 : -1) * 0.09 * g.D, spin = Array.from({ length:14 }, (_, m) => { const a = 2 * Math.PI * m / 14; return [g.propX, 0.05 * g.D * Math.cos(a), g.propZ + 0.05 * g.D * Math.sin(a)]; });
    for (let m = 0; m < 14; m++) tris.push({ p:[[tipX, 0, g.propZ], spin[m], spin[(m + 1) % 14]], part:'motor' });
    // prop blades (2) and translucent disc (not part of STL)
    for (const s of [1, -1]) { const w = 0.045 * g.D, R = g.D / 2;
      const q = [[g.propX - 0.004, 0, g.propZ + s * 0.05 * g.D - w / 2], [g.propX + 0.004, 0, g.propZ + s * 0.05 * g.D + w / 2], [g.propX + 0.004, 0, g.propZ + s * R + w / 3], [g.propX - 0.004, 0, g.propZ + s * R - w / 3]];
      const qq = q.map(p => [p[0], p[2] - g.propZ > 0 ? -w * 0.6 : w * 0.6, p[2]]);
      tris.push({ p:[qq[0], qq[1], qq[2]], part:'prop' }, { p:[qq[0], qq[2], qq[3]], part:'prop' }); }
    const disc = Array.from({ length:36 }, (_, m) => { const a = 2 * Math.PI * m / 36; return [g.propX, g.D / 2 * Math.cos(a), g.propZ + g.D / 2 * Math.sin(a)]; });
    for (let m = 0; m < 36; m++) tris.push({ p:[[g.propX, 0, g.propZ], disc[m], disc[(m + 1) % 36]], part:'disc', solid:false });
    const tilt = mountTilt(d, g);
    if (tilt) for (let k = iMotor; k < tris.length; k++) tris[k].p = tris[k].p.map(tilt);
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    tris.forEach(t => { t.n = norm(cross(sub(t.p[1], t.p[0]), sub(t.p[2], t.p[0]))); t.p.forEach(v => { for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], v[i]); hi[i] = Math.max(hi[i], v[i]); } }); });
    const center = lo.map((v, i) => (v + hi[i]) / 2), size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
    return { tris, bounds:{ lo, hi, center, size }, geometry:g };
  }
  /** ASCII STL in millimetres; translucent prop disc excluded. */
  function toSTL(mesh, name = 'rc_airframe'){
    const f = v => (v * 1000).toFixed(3), lines = [`solid ${name}`];
    for (const t of mesh.tris) { if (t.solid === false) continue;
      lines.push(` facet normal ${t.n.map(v => v.toFixed(5)).join(' ')}`, '  outer loop', ...t.p.map(v => `   vertex ${f(v[0])} ${f(v[1])} ${f(v[2])}`), '  endloop', ' endfacet'); }
    lines.push(`endsolid ${name}`); return lines.join('\n');
  }
  /** Ring around an airfoil chord range [x0, x1] (for split control surfaces). */
  function rangeRing(points, x0, x1, n, chord, xLE, y, z, twist, vertical){
    const sp = Airfoil.split(points), xs = Array.from({ length:n + 1 }, (_, k) => x0 + (x1 - x0) * (1 - Math.cos(Math.PI * k / n)) / 2);
    const pts = xs.slice().reverse().map(x => [x, Airfoil.interp(sp.up, x)]).concat(xs.map(x => [x, Airfoil.interp(sp.lo, x)]));
    return pts.map(([x, h]) => { let lx = (x - 0.25) * chord, lz = h * chord; const c = Math.cos(twist), s2 = Math.sin(twist);
      const rx = lx * c + lz * s2, rz = -lx * s2 + lz * c; lx = rx + 0.25 * chord; lz = rz; return vertical ? [xLE + lx, y + lz, z] : [xLE + lx, y, z + lz]; });
  }
  /**
   * buildParts(d, {airfoil, propD, surf, flaps}) → { parts:[{name, tris, hinge:[a,b]|null, axis:'hinge'|'prop'|null}], geometry }
   * Same shapes as build(), but ailerons/elevons/flaps, elevator, rudder and prop are separate parts (geometry frame).
   */
  /** Rotation for the motor/prop: forward (−x) tilts down by thrustDown and right by thrustRight, about the mount point. */
  function mountTilt(d, g){
    const dn = (+d.thrustDown || 0) * Math.PI / 180, rt = (+d.thrustRight || 0) * Math.PI / 180; if (!dn && !rt) return null;
    const pusher = d.motorPos === 'pusher', px = pusher ? g.propX - g.mlen - 0.004 * d.fuseLen : g.propX + 0.004 * d.fuseLen + g.mlen, P = [px, 0, g.propZ];
    const cd = Math.cos(dn), sd = Math.sin(dn), cr = Math.cos(rt), sr = Math.sin(rt);
    return p => { const x = p[0] - P[0], y = p[1] - P[1], z = p[2] - P[2], x1 = x * cd - z * sd, z1 = x * sd + z * cd; return [P[0] + x1 * cr + y * sr, P[1] - x1 * sr + y * cr, P[2] + z1]; };
  }
  function buildParts(d, o = {}){
    const g = airframeGeometry(d, o.propD || 0.2), af = (o.airfoil || Airfoil.get('clarky')).points, tailPts = Airfoil.naca4(0, 0.4, 0.07, 24);
    const b2 = d.span / 2, tsw = Math.tan(d.sweep * Math.PI / 180), tdi = Math.tan(d.dihedral * Math.PI / 180), wash = -(d.washout || 0) * Math.PI / 180;
    const surf = g.tailless ? 'elevons' : (o.surf || 'ailerons');
    const SP = surfaceSpec(d), eh = 1 - SP.eleCf, rh = 1 - SP.rudCf;
    const cuts = surf === 'elevons' ? [[SP.elevonStart, SP.elevonEnd, 1 - SP.elevonCf, 'elevon']] : surf === 'ailerons' ? [[SP.ailStart, SP.ailEnd, 1 - SP.ailCf, 'aileron']] : [];
    if ((o.flaps || SP.flaps) && surf !== 'elevons') cuts.unshift([SP.flapStart, SP.flapEnd, 1 - SP.flapCf, 'flap']);
    const parts = [], body = [];
    const at = t => { const y = t * b2, c = d.rootChord + (d.tipChord - d.rootChord) * t; return { y, c, xle:g.xwLE + y * tsw, z:g.wingZ + y * tdi, tw:wash * t }; };
    for (const side of [1, -1]) {
      const marks = [0, ...cuts.flatMap(c => [c[0], c[1]]), 1].filter((v, i, a) => a.indexOf(v) === i).sort((p, q) => p - q);
      for (let i = 0; i < marks.length - 1; i++) {
        const t0 = marks[i], t1 = marks[i + 1], cut = cuts.find(c => c[0] <= t0 + 1e-9 && c[1] >= t1 - 1e-9), A = at(t0), B = at(t1);
        const ring = (S, x0, x1) => { const r = rangeRing(af, x0, x1, 14, S.c, S.xle, side * S.y, S.z, S.tw, false); return side < 0 ? r.reverse() : r; };
        const seg = (x0, x1, list) => { const r0 = ring(A, x0, x1), r1 = ring(B, x0, x1); loft(list, [r0, r1], 'wing'); cap(list, r0, 'wing', true); cap(list, r1, 'wing', false); };
        if (!cut) seg(0, 1, body);
        else { const h = cut[2], tris = []; seg(0, h, body); seg(h, 1, tris);
          const hp = S => [S.xle + h * S.c, side * S.y, S.z]; parts.push({ name:`${cut[3]}_${side > 0 ? 'R' : 'L'}`, tris, hinge:[hp(A), hp(B)], role:cut[3], side }); }
      }
    }
    if (!g.tailless) { const elev = [];
      for (const side of [1, -1]) { const mk = (x0, x1, list) => { const r = [0, 1].map(t => { const rr = rangeRing(tailPts, x0, x1, 10, d.hChord, g.xhLE, side * t * d.hSpan / 2, g.hTailZ, 0, false); return side < 0 ? rr.reverse() : rr; });
        loft(list, r, 'tail'); cap(list, r[0], 'tail', true); cap(list, r[1], 'tail', false); }; mk(0, eh, body); mk(eh, 1, elev); }
      const hx = g.xhLE + eh * d.hChord; parts.push({ name:'elevator', tris:elev, hinge:[[hx, -d.hSpan / 2, g.hTailZ], [hx, d.hSpan / 2, g.hTailZ]], role:'elevator' }); }
    const finYs = g.tailless ? [-b2, b2] : [0];
    for (const fy of finYs) {
      const fin = (x0, x1, list) => { const base = rangeRing(tailPts, x0, x1, 10, d.vChord, g.xvLE, fy, g.vBaseZ, 0, true), top = rangeRing(tailPts, x0, x1, 10, 0.55 * d.vChord, g.xvLE + 0.45 * d.vChord, fy, g.vBaseZ + d.vHeight, 0, true);
        loft(list, [base, top], 'tail'); cap(list, top, 'tail', false); cap(list, base, 'tail', true); };
      if (g.tailless) fin(0, 1, body);
      else { const rud = []; fin(0, rh, body); fin(rh, 1, rud);
        parts.push({ name:'rudder', tris:rud, hinge:[[g.xvLE + rh * d.vChord, 0, g.vBaseZ], [g.xvLE + 0.45 * d.vChord + rh * 0.55 * d.vChord, 0, g.vBaseZ + d.vHeight]], role:'rudder' }); }
    }
    // fuselage, motor, prop: reuse build() and pick by part
    const full = build(d, { airfoil:o.airfoil, propD:o.propD });
    full.tris.forEach(t => { if (t.part === 'fuse' || t.part === 'motor') body.push(t); });
    parts.unshift({ name:'body', tris:body, hinge:null, role:'body' });
    const tl = mountTilt(d, g) || (p => p), hub = tl([g.propX, 0, g.propZ]), hub2 = tl([g.propX - 1, 0, g.propZ]);
    parts.push({ name:'prop', tris:full.tris.filter(t => t.part === 'prop'), hinge:[hub, hub2], role:'prop' });
    parts.push({ name:'disc', tris:full.tris.filter(t => t.part === 'disc'), hinge:[hub, hub2], role:'disc' });
    parts.forEach(p => p.tris.forEach(t => { if (!t.n) t.n = norm(cross(sub(t.p[1], t.p[0]), sub(t.p[2], t.p[0]))); }));
    return { parts, geometry:g, bounds:full.bounds };
  }
  return { build, buildParts, toSTL };
})();

/* ---------- Canvas viewer (browser only) ---------- */
class Viewer3D {
  constructor(canvas, opts = {}){
    this.c = canvas; this.ctx = canvas.getContext('2d'); this.yaw = 0.75; this.pitch = 0.42; this.zoom = 1; this.wire = false; this.auto = false;
    this.colors = opts.colors || (() => ({}));
    this.mesh = null; this.ptrs = new Map(); this.raf = 0;
    const onDown = e => { canvas.setPointerCapture(e.pointerId); this.ptrs.set(e.pointerId, [e.clientX, e.clientY]); };
    const onMove = e => {
      if (!this.ptrs.has(e.pointerId)) return;
      const prev = this.ptrs.get(e.pointerId); this.ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (this.ptrs.size === 1) { this.yaw += (e.clientX - prev[0]) * 0.01; this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch + (e.clientY - prev[1]) * 0.01)); }
      else if (this.ptrs.size === 2) { const [a, b] = [...this.ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (this.pinch) this.zoom = Math.max(0.3, Math.min(5, this.zoom * d / this.pinch)); this.pinch = d; }
      this.draw();
    };
    const onUp = e => { this.ptrs.delete(e.pointerId); if (this.ptrs.size < 2) this.pinch = null; };
    canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove); canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', e => { e.preventDefault(); this.zoom = Math.max(0.3, Math.min(5, this.zoom * Math.exp(-e.deltaY * 0.0015))); this.draw(); }, { passive:false });
    canvas.addEventListener('keydown', e => {
      const k = e.key, st = 0.12;
      if (k === 'ArrowLeft') this.yaw -= st; else if (k === 'ArrowRight') this.yaw += st; else if (k === 'ArrowUp') this.pitch = Math.min(1.5, this.pitch + st);
      else if (k === 'ArrowDown') this.pitch = Math.max(-1.5, this.pitch - st); else if (k === '+' || k === '=') this.zoom = Math.min(5, this.zoom * 1.15); else if (k === '-') this.zoom = Math.max(0.3, this.zoom / 1.15); else return;
      e.preventDefault(); this.draw();
    });
    new ResizeObserver(() => this.resize()).observe(canvas);
  }
  resize(){ const r = this.c.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1); if (!r.width) return; this.c.width = Math.round(r.width * dpr); this.c.height = Math.round(r.width * 0.625 * dpr); this.draw(); }
  setMesh(m){ this.mesh = m; this.draw(); }
  view(name){ const v = { iso:[0.75, 0.42], front:[0, 0], side:[Math.PI / 2, 0], top:[Math.PI, 1.5], rear:[Math.PI, 0.15] }[name]; if (v) { this.yaw = v[0]; this.pitch = v[1]; this.zoom = 1; this.draw(); } }
  setAuto(on){ this.auto = on; cancelAnimationFrame(this.raf); const tick = () => { if (!this.auto) return; this.yaw += 0.008; this.draw(); this.raf = requestAnimationFrame(tick); }; if (on) tick(); }
  draw(){
    const ctx = this.ctx, W = this.c.width, H = this.c.height, C = this.colors();
    ctx.fillStyle = C.bg || '#f8fafc'; ctx.fillRect(0, 0, W, H);
    if (!this.mesh) return;
    const p = Math.max(-1.5, Math.min(1.5, this.pitch)), y = this.yaw;
    const dvec = [-Math.cos(p) * Math.cos(y), Math.cos(p) * Math.sin(y), Math.sin(p)], f = dvec.map(v => -v);
    let r = [f[1] * 1 - f[2] * 0, f[2] * 0 - f[0] * 1, 0]; const rl = Math.hypot(...r) || 1; r = r.map(v => v / rl);
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    const { center, size } = this.mesh.bounds, scale = Math.min(W, H) * 0.82 / size * this.zoom, dist = size * 3.2;
    const light = [0.35 * r[0] + 0.6 * u[0] - 0.7 * f[0], 0.35 * r[1] + 0.6 * u[1] - 0.7 * f[1], 0.35 * r[2] + 0.6 * u[2] - 0.7 * f[2]], ll = Math.hypot(...light);
    const proj = v => { const q = [v[0] - center[0], v[1] - center[1], v[2] - center[2]], z = q[0] * f[0] + q[1] * f[1] + q[2] * f[2], k = dist / (dist + z);
      return [W / 2 + (q[0] * r[0] + q[1] * r[1] + q[2] * r[2]) * scale * k, H / 2 - (q[0] * u[0] + q[1] * u[1] + q[2] * u[2]) * scale * k, z]; };
    // ground shadow
    ctx.save(); ctx.globalAlpha = 0.12; ctx.fillStyle = C.ink || '#000'; ctx.beginPath();
    const gz = this.mesh.bounds.lo[2] - size * 0.08, sh = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([a, b]) => proj([center[0] + a * size * 0.9, center[1] + b * size, gz]));
    sh.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.closePath(); ctx.filter = 'blur(6px)'; ctx.fill(); ctx.restore();
    const list = this.mesh.tris.map(t => { const a = proj(t.p[0]), b = proj(t.p[1]), c = proj(t.p[2]); return { t, a, b, c, z:(a[2] + b[2] + c[2]) / 3 }; }).sort((m, n) => n.z - m.z);
    const base = { wing:C.wing, tail:C.tail, fuse:C.fuse, motor:C.motor, prop:C.prop, disc:C.disc };
    for (const it of list) {
      const t = it.t; ctx.beginPath(); ctx.moveTo(it.a[0], it.a[1]); ctx.lineTo(it.b[0], it.b[1]); ctx.lineTo(it.c[0], it.c[1]); ctx.closePath();
      if (t.part === 'disc') { ctx.fillStyle = base.disc; ctx.fill(); continue; }
      const lam = Math.abs(t.n[0] * light[0] + t.n[1] * light[1] + t.n[2] * light[2]) / ll, k = 0.42 + 0.58 * lam;
      const rgb = base[t.part] || [180, 190, 200], col = `rgb(${Math.round(rgb[0] * k)},${Math.round(rgb[1] * k)},${Math.round(rgb[2] * k)})`;
      ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = this.wire ? (C.edge || 'rgba(0,0,0,.35)') : col; ctx.lineWidth = this.wire ? 0.6 : 0.8; ctx.stroke();
    }
  }
}
if (typeof module !== 'undefined') module.exports = { Mesh3D };
