/* RC Calc simulator: 6-DOF flight physics (pure, no DOM). Depends on rc-core.js, rc-aero.js, rc-sim-model.js.
   World frame: x north, y east, z down (ground at z = 0). Body frame: X forward, Y right, Z down. Fixed 240 Hz steps. */
'use strict';
const SimPhysics = (() => {
  const DEG = Math.PI / 180, DT = 1 / 240;
  const { add, sub, scl, dot, cross, norm } = SimModel.vec;
  // ---------- quaternions (w, x, y, z), body → world ----------
  const qmul = (a, b) => [a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3], a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2], a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1], a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];
  const qnorm = q => { const l = Math.hypot(...q) || 1; return q.map(v => v / l); };
  const qrot = (q, v) => { const p = qmul(qmul(q, [0, v[0], v[1], v[2]]), [q[0], -q[1], -q[2], -q[3]]); return [p[1], p[2], p[3]]; };
  const qinvrot = (q, v) => qrot([q[0], -q[1], -q[2], -q[3]], v);
  const fromEuler = (phi, th, psi) => { const c1 = Math.cos(psi / 2), s1 = Math.sin(psi / 2), c2 = Math.cos(th / 2), s2 = Math.sin(th / 2), c3 = Math.cos(phi / 2), s3 = Math.sin(phi / 2);
    return [c1 * c2 * c3 + s1 * s2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * s2 * c3 + s1 * c2 * s3, s1 * c2 * c3 - c1 * s2 * s3]; };
  const toEuler = q => { const [w, x, y, z] = q;
    return { phi:Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)), theta:Math.asin(Math.max(-1, Math.min(1, 2 * (w * y - z * x)))), psi:Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)) }; };
  const mat3v = (M, v) => [M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2], M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2], M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2]];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerpTable = (tab, t) => { const x = clamp(t, 0, 1) * 20, i = Math.min(19, Math.floor(x)), f = x - i, a = tab[i], b = tab[i + 1], o = {}; for (const k in a) o[k] = a[k] + (b[k] - a[k]) * f; return o; };
  const VOC = [[0, 3.3], [0.05, 3.5], [0.2, 3.7], [0.5, 3.82], [0.8, 3.95], [1, 4.2]];
  const vocCell = s => { for (let i = 1; i < VOC.length; i++) if (s <= VOC[i][0]) { const a = VOC[i - 1], b = VOC[i]; return a[1] + (b[1] - a[1]) * (s - a[0]) / (b[0] - a[0]); } return 4.2; };

  /** Beard/Mueller blended lift: linear below stall, flat plate above. αe = effective angle (rad). */
  const CAL1 = { cd0:1, clmax:1, thrust:1, current:1, roll:1 };
  function section(s, ae, V, dClmax = 0, cal = CAL1){
    const a = s.a * s.k, aPos = (s.clmax * cal.clmax + dClmax) / a, aNeg = s.clmaxNeg * cal.clmax / a, M = 40;
    const ep = Math.exp(-M * (ae - aPos)), en = Math.exp(M * (ae + aNeg));
    const sigma = (1 + ep + en) / ((1 + ep) * (1 + en));
    const clLin = a * ae, sa = Math.sin(ae), ca = Math.cos(ae);
    const cl = (1 - sigma) * clLin + sigma * 2 * Math.sign(ae) * sa * sa * ca;
    const Re = Math.max(2e4, V * s.chord / 1.5e-5), f = clamp(Math.pow(Re / 1e5, -0.4), 0.7, 2.2);
    const cd = s.cd0 * cal.cd0 * f + (1 - sigma) * clLin * clLin / (Math.PI * 0.85 * s.AR) + sigma * 1.2 * sa * sa;
    const cm = (1 - sigma) * s.cm0 - sigma * 0.12 * sa;
    return { cl, cd, cm, sigma };
  }

  /**
   * forces(model, st, ctrl, env): total aerodynamic + propulsion force/moment in body axes about the CG.
   * st: { v (body velocity), w (body rates), alt, spool }, ctrl: { ail, ele, rud, thr, flap } (-1..1, thr 0..1)
   * env: { windB(rBody) → wind velocity in body axes, rho, soc, h }
   */
  function forces(model, st, ctrl, env){
    const rho = env.rho || RHO_SL, F = [0, 0, 0], M = [0, 0, 0], th = model.throws, cal = model.cal || CAL1;
    // propulsion first (slipstream feeds the strips)
    const spool = st.spool != null ? st.spool : ctrl.thr;
    const p = lerpTable(model.thrTableAt ? model.thrTableAt(rho) : model.thrTable, spool), fv = Math.min(1.12, (vocCell(env.soc != null ? env.soc : 1) - 0.0) / 3.85);
    const vaxial = dot(sub(st.v, env.windB(model.prop.r)), [1, 0, 0]);
    let T = cal.thrust * p.T0 * fv * fv * (1 - vaxial / (1.15 * Math.max(1, p.Vp * fv)));
    if (env.motorOff) T = 0;
    T = Math.max(-0.08 * model.mass * G * Math.min(1, Math.abs(vaxial) / 15), T);
    const Va = Math.max(0, vaxial), vi = T > 0 ? (-Va + Math.sqrt(Va * Va + 2 * T / (rho * model.prop.A))) / 2 : 0, wash = 1.6 * vi;
    F[0] += T; const Mt = cross(model.prop.r, [T, 0, 0]); M[0] += Mt[0]; M[1] += Mt[1]; M[2] += Mt[2];
    // shaft power from momentum theory: P = T (V + v_i) / η, η rising from the static figure of merit to ~0.7 in cruise
    const xJ = clamp(Va / Math.max(1, 1.15 * p.Vp * fv), 0, 1), etaP = 0.6 + 0.1 * xJ;
    const PshDyn = env.motorOff || T <= 0 ? 0 : Math.min(p.Psh * fv * fv * fv, T * (Va + vi) / etaP);
    const etaM = p.Pin > 0 ? p.Psh / p.Pin : 0.75, PinDyn = PshDyn / Math.max(0.3, etaM), Iscale = p.Pin > 0 ? PinDyn / (p.Pin * fv * fv * fv) : 0;
    const omegaP = Math.max(50, p.rpm * fv * 2 * Math.PI / 60), Q = PshDyn / omegaP;
    M[0] -= Q * (model.torqueFactor != null ? model.torqueFactor : 0.6); // prop torque reaction (partly cancelled by slipstream swirl)
    // ground effect factor
    const hb = Math.max(0.02, (env.h != null ? env.h : 50) / model.bref), ge = (16 * hb) ** 2 / (1 + (16 * hb) ** 2);
    let wingL = 0, wingQS = 0, stalled = 0, area = 0;
    const out = { strips:[] };
    const doStrip = (s, eps) => {
      const vs = add(st.v, cross(st.w, s.r)), wa = sub(vs, env.windB(s.r));
      let uc = dot(wa, s.c), un = dot(wa, s.n);
      if (s.inWash && wash > 0) uc += wash * 0.8;
      const V2 = uc * uc + un * un; if (V2 < 1e-6) return;
      const V = Math.sqrt(V2), alpha = Math.atan2(-un, uc) - (eps || 0) + (s.kind === 'htail' ? (model.tailIncidence || 0) : 0);
      let dAlpha = 0;
      if (s.ctrl) { const c = s.ctrl;
        const defl = (c.ail ? -c.ail * th.ail * ctrl.ail * cal.roll : 0) + (c.ele ? -c.ele * (s.kind === 'wing' ? th.ele : th.ele) * ctrl.ele : 0) + (c.rud ? -c.rud * th.rud * ctrl.rud : 0);
        dAlpha = c.tau * clamp(defl - (c.ele && s.kind === 'wing' ? (model.elevonTrim || 0) / DEG : 0), -30, 30) * DEG; }
      let dClmax = 0; // plain flap: raises max lift (≈ +0.8 at 25° for a 25 % chord flap)
      if (s.flap && ctrl.flap) { const fd = (th.flap != null ? th.flap : 25) * ctrl.flap; dAlpha += s.flapTau * fd * DEG; dClmax = 0.8 * Math.min(1, fd / 25) * Math.sqrt(s.flapTau / 0.49); }
      const ae = alpha + dAlpha - s.alpha0;
      const sec = section(s, ae, V, dClmax, cal), q = 0.5 * rho * V2;
      const cdUse = sec.cd - (1 - ge) * (1 - sec.sigma) * (s.a * s.k * ae) ** 2 / (Math.PI * 0.85 * s.AR);
      const eL = [(uc * s.n[0] - un * s.c[0]) / V, (uc * s.n[1] - un * s.c[1]) / V, (uc * s.n[2] - un * s.c[2]) / V];
      const eD = [-(uc * s.c[0] + un * s.n[0]) / V, -(uc * s.c[1] + un * s.n[1]) / V, -(uc * s.c[2] + un * s.n[2]) / V];
      const f = scl(add(scl(eL, sec.cl), scl(eD, cdUse)), q * s.dS);
      F[0] += f[0]; F[1] += f[1]; F[2] += f[2];
      const m = cross(s.r, f); M[0] += m[0]; M[1] += m[1]; M[2] += m[2];
      if (sec.cm) { const mc = scl(s.pitchAxis, sec.cm * q * s.dS * s.chord); M[0] += mc[0]; M[1] += mc[1]; M[2] += mc[2]; }
      if (s.kind === 'wing') { wingL += -dot(f, [0, 0, 1]) * 0 + sec.cl * q * s.dS; wingQS += q * s.dS; stalled += sec.sigma * s.dS; area += s.dS; }
      if (env.debug) out.strips.push({ kind:s.kind, eta:s.eta, side:s.side, alpha:alpha / DEG, cl:sec.cl, sigma:sec.sigma });
    };
    const strips = model.strips;
    for (const s of strips) if (s.kind === 'wing') doStrip(s, 0);
    const CLw = wingQS > 0 ? wingL / wingQS : 0, eps = ge * 2 * CLw / (Math.PI * model.AR);
    for (const s of strips) if (s.kind !== 'wing') doStrip(s, s.kind === 'htail' ? eps : 0);
    // fuselage: frontal drag + cross-flow (side and vertical)
    const fu = model.fuse, wf = sub(add(st.v, cross(st.w, fu.r)), env.windB(fu.r)), Vf = Math.hypot(...wf);
    if (Vf > 1e-3) {
      const fd = scl(wf, -0.5 * rho * Vf * fu.CDA * cal.cd0), fs = [0, -0.5 * rho * Math.abs(wf[1]) * wf[1] * fu.side * 0.9, -0.5 * rho * Math.abs(wf[2]) * wf[2] * fu.top * 0.9];
      const ft = add(fd, fs); F[0] += ft[0]; F[1] += ft[1]; F[2] += ft[2]; const m = cross(fu.r, ft); M[0] += m[0]; M[1] += m[1]; M[2] += m[2];
      if (model.gear !== 'none') { const gd = scl(wf, -0.5 * rho * Vf * 0.0012 * Math.max(0.3, model.mass) * cal.cd0); F[0] += gd[0]; F[1] += gd[1]; F[2] += gd[2]; }
    }
    out.F = F; out.M = M; out.T = T; out.CLw = CLw; out.stallFrac = area ? stalled / area : 0;
    out.I = env.motorOff ? 0 : p.I * fv * fv * Iscale * cal.current; out.Pin = env.motorOff ? 0 : PinDyn * cal.current; out.Psh = PshDyn; out.rpm = env.motorOff ? 0 : p.rpm * fv * (0.92 + 0.08 * xJ);
    return out;
  }

  /* ---------- environment: wind with gradient, gusts (Gauss-Markov), thermals ---------- */
  function rng(seed){ let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296); }; }
  /** Weather presets. Speeds m/s, direction ° the wind blows FROM, gusts are discrete 1−cos events on top of turbulence. */
  const WEATHER_PRESETS = {
    calm:    { label:'Calm morning',  speed:0.5, dirVar:10, shear:0.14, gustPeak:0,   gustInterval:30, turbulence:0.05, thermals:false, thermalStrength:1.2, thermalSize:28, thermalCount:3, sink:0.2, clouds:0.2,  visibility:4000 },
    breeze:  { label:'Stable breeze', speed:3,   dirVar:10, shear:0.16, gustPeak:1,   gustInterval:20, turbulence:0.15, thermals:false, thermalStrength:1.2, thermalSize:28, thermalCount:3, sink:0.2, clouds:0.35, visibility:3500 },
    windy:   { label:'Windy',         speed:7,   dirVar:20, shear:0.2,  gustPeak:3,   gustInterval:12, turbulence:0.4,  thermals:false, thermalStrength:1.2, thermalSize:28, thermalCount:3, sink:0.3, clouds:0.55, visibility:3000 },
    gusty:   { label:'Gusty',         speed:4,   dirVar:35, shear:0.22, gustPeak:5,   gustInterval:7,  turbulence:0.6,  thermals:false, thermalStrength:1.2, thermalSize:28, thermalCount:3, sink:0.3, clouds:0.5,  visibility:3000 },
    stormy:  { label:'Stormy',        speed:10,  dirVar:45, shear:0.25, gustPeak:7,   gustInterval:5,  turbulence:0.9,  thermals:false, thermalStrength:1.2, thermalSize:28, thermalCount:3, sink:0.6, clouds:0.95, visibility:1200 },
    thermal: { label:'Thermal day',   speed:2,   dirVar:15, shear:0.15, gustPeak:1,   gustInterval:25, turbulence:0.2,  thermals:true,  thermalStrength:2.0, thermalSize:30, thermalCount:5, sink:0.3, clouds:0.45, visibility:4000 },
  };
  const WEATHER_KEYS = ['speed', 'dir', 'dirVar', 'shear', 'gustPeak', 'gustInterval', 'turbulence', 'thermals', 'thermalStrength', 'thermalSize', 'thermalCount', 'sink', 'clouds', 'visibility', 'tempC', 'elevation', 'qnh'];
  /** ISA-based air density at `alt` metres above a field at `elevation` m, with field temperature tempC and sea-level pressure qnh (hPa). */
  const airDensity = globalThis.airDensity, densityAltitude = globalThis.densityAltitude; // from rc-core.js
  class Environment {
    constructor(o = {}){
      Object.assign(this, { speed:0, dir:270, dirVar:10, shear:0.2, gustPeak:0, gustInterval:15, turbulence:0, thermals:false, thermalStrength:1.4, thermalSize:30, thermalCount:4, sink:0.25, clouds:0.4, visibility:3000, tempC:15, elevation:0, qnh:1013.25 });
      this.r = rng(o.seed || 12345); this.g = [0, 0, 0]; this.thermalList = []; this.t = 0; this.dirOff = 0; this.spdOff = 0; this.gusts = []; this.nextGust = 3; this.gustNow = 0; this.gustDir = 0;
      this.rhoFixed = o.rhoFixed || null; this.obstacles = o.obstacles || []; this.wake = 0; this.wk = [0, 0, 0]; this.set(o);
    }
    /** Accepts any WEATHER_KEYS, a { preset } name, or the old { gust } (0..1) slider. */
    set(o){
      if (o.preset && WEATHER_PRESETS[o.preset]) Object.assign(this, WEATHER_PRESETS[o.preset]);
      if (o.gust != null && o.turbulence == null) { this.turbulence = o.gust; if (o.gustPeak == null) this.gustPeak = o.gust * 4; }
      for (const k of WEATHER_KEYS) if (o[k] != null) this[k] = o[k];
      this.thermalsOn = !!this.thermals; return this;
    }
    gauss(){ let u = 0, v = 0; while (u === 0) u = this.r(); while (v === 0) v = this.r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
    ou(x, tau, sigma, dt){ return x + (-x / tau) * dt + sigma * Math.sqrt(2 * dt / tau) * this.gauss(); }
    update(dt, plane){
      this.t += dt;
      // slow wander of direction and strength
      this.dirOff = clamp(this.ou(this.dirOff, 40, this.dirVar / 2, dt), -2.5 * this.dirVar, 2.5 * this.dirVar);
      this.spdOff = clamp(this.ou(this.spdOff, 30, this.speed * 0.08, dt), -0.4 * this.speed, 0.4 * this.speed);
      // discrete gusts (1 − cos shape), exponential spacing with the chosen mean interval
      if (this.gustPeak > 0 && this.t >= this.nextGust) {
        this.gusts.push({ t0:this.t, dur:1.5 + this.r() * 3, amp:this.gustPeak * (0.4 + 0.6 * this.r()), dir:(this.r() - 0.5) * 40, up:(this.r() - 0.5) * 0.3 });
        this.nextGust = this.t + Math.max(1, -Math.log(Math.max(1e-6, this.r())) * this.gustInterval);
      }
      this.gusts = this.gusts.filter(g => this.t < g.t0 + g.dur);
      let gs = 0, gd = 0, gu = 0; for (const g of this.gusts) { const k = 0.5 * (1 - Math.cos(2 * Math.PI * (this.t - g.t0) / g.dur)); gs += g.amp * k; gd += g.dir * k; gu += g.up * g.amp * k; }
      this.gustNow = gs; this.gustDir = gs > 0 ? gd / Math.max(1e-6, this.gusts.reduce((a, g) => a + 0.5 * (1 - Math.cos(2 * Math.PI * (this.t - g.t0) / g.dur)), 0)) : 0; this.gustUp = gu;
      // continuous turbulence (Gauss-Markov, Dryden-like time scale L/V)
      const sigma = this.turbulence * (0.4 + 0.12 * this.speed), tau = 50 / Math.max(5, plane ? plane.V : 8);
      for (let i = 0; i < 3; i++) this.g[i] = this.ou(this.g[i], tau, sigma * (i === 2 ? 0.5 : 1), dt);
      if (this.thermals) {
        this.thermalList = this.thermalList.filter(t => this.t < t.end);
        while (this.thermalList.length < this.thermalCount) { const a = this.r() * 2 * Math.PI, d = 40 + this.r() * 260;
          this.thermalList.push({ x:Math.cos(a) * d, y:Math.sin(a) * d, R:this.thermalSize * (0.7 + 0.6 * this.r()), w:this.thermalStrength * (0.6 + 0.8 * this.r()), end:this.t + 120 + this.r() * 200 }); }
        const wv = this.meanWind(30); this.thermalList.forEach(t => { t.x += wv[0] * dt; t.y += wv[1] * dt; });
      } else this.thermalList = [];
      this.thermalsOn = !!this.thermals;
      this.wake = plane && plane.p && this.obstacles.length ? this.wakeAt(plane.p) : 0;
      if (this.wake > 0) for (let i = 0; i < 3; i++) this.wk[i] = this.ou(this.wk[i], 0.5, i === 2 ? 0.7 : 1, dt);
    }
    /** Mechanical turbulence behind obstacles {x, y, r, h} (NED): 0..1, strongest just downwind and below ~1.5 × height, gone after ~12 heights. */
    wakeAt(p){
      if (this.speed + this.spdOff < 0.5) return 0;
      const a = (this.dir + this.dirOff) * DEG, u0 = -Math.cos(a), u1 = -Math.sin(a), hgt = -p[2]; let I = 0;
      for (const o of this.obstacles) {
        if (hgt > 1.8 * o.h) continue; const dx = p[0] - o.x, dy = p[1] - o.y, d = dx * u0 + dy * u1, L = 12 * o.h;
        if (d < -o.r || d > L) continue; const width = o.r + 0.2 * Math.max(0, d), c = Math.abs(-dx * u1 + dy * u0); if (c > 2 * width) continue;
        const k = (1 - Math.max(0, d) / L) * Math.exp(-((c / width) ** 2)) * clamp(1.8 - hgt / o.h, 0, 1); if (k > I) I = k;
      }
      return Math.min(1, I);
    }
    /** Mean wind (plus current gust) at height h, NED vector (blowing towards). dir = where the wind comes FROM. */
    meanWind(h){
      const k = Math.pow(clamp(h, 0.3, 300) / 10, this.shear), a = (this.dir + this.dirOff + this.gustDir) * DEG, v = Math.max(0, this.speed + this.spdOff + this.gustNow) * k;
      return [-Math.cos(a) * v, -Math.sin(a) * v, 0];
    }
    at(pw){ const h = -pw[2], w = this.meanWind(h), gk = clamp(h / 5, 0.3, 1);
      w[0] += this.g[0] * gk; w[1] += this.g[1] * gk; w[2] += this.g[2] * gk - (this.gustUp || 0) * gk;
      if (this.wake > 0.01) { const sp = Math.max(0, this.speed + this.spdOff), k = this.wake; w[0] *= 1 - 0.45 * k; w[1] *= 1 - 0.45 * k; w[0] += this.wk[0] * k * 0.35 * sp; w[1] += this.wk[1] * k * 0.35 * sp; w[2] += this.wk[2] * k * 0.35 * sp; }
      for (const t of this.thermalList) { const r2 = ((pw[0] - t.x) ** 2 + (pw[1] - t.y) ** 2) / (t.R * t.R), lift = t.w * Math.exp(-r2) * clamp(h / 25, 0, 1) - (r2 < 4 && r2 > 1 ? this.sink * t.w * Math.exp(-((r2 - 2) ** 2)) : 0); w[2] -= lift; }
      return w; }
    rhoAt(alt){ return this.rhoFixed || airDensity(this.tempC, this.elevation, this.qnh, alt); }
    snapshot(){ const o = {}; for (const k of WEATHER_KEYS) o[k] = this[k]; return o; }
  }

  /* ---------- the simulation ---------- */
  class Sim {
    constructor(model, o = {}){
      this.model = model; this.env = o.env || new Environment(); this.acc = 0; this.ctrl = { ail:0, ele:0, rud:0, thr:0, flap:0 };
      this.events = []; this.failures = {}; this.reset(o.start || 'air');
    }
    reset(mode = 'air', o = {}){
      const m = this.model;
      this.s = { p:[0, 0, -30], v:[0, 0, 0], q:[1, 0, 0, 0], w:[0, 0, 0], spool:0, soc:1, mAh:0, t:0, crashed:null, onGround:false, propStrike:false };
      const heading = (o.heading != null ? o.heading : 0) * DEG;
      if (mode === 'runway') {
        const pitch = m.gear === 'taildragger' ? Math.atan2(m.contacts[0].r[2] - m.contacts[2].r[2], m.contacts[0].r[0] - m.contacts[2].r[0]) : 0;
        this.s.q = fromEuler(0, pitch, heading);
        const low = Math.max(...m.contacts.filter(c => c.kind !== 'prop').map(c => qrot(this.s.q, c.r)[2]));
        this.s.p = [o.x != null ? o.x : -25, o.y || 0, -low - 0.001];
      } else if (mode === 'hand') {
        const V = (m.trim ? m.trim.vs : 6) * 1.3; this.s.q = fromEuler(0, 8 * DEG, heading); this.s.p = [o.x || 0, o.y || -10, -1.8];
        this.s.v = [Math.cos(heading) * V, Math.sin(heading) * V, -0.6]; this.s.spool = this.ctrl.thr;
      } else {
        const V = m.trim ? m.trim.V : 10, al = (m.trim ? m.trim.alphaDeg : 3) * DEG; this.s.q = fromEuler(0, al, heading); this.s.p = [o.x || 0, o.y || 0, -(o.alt || 40)];
        this.s.v = [Math.cos(heading) * V, Math.sin(heading) * V, 0]; this.s.spool = m.trim ? m.trim.throttle : 0.5;
      }
      this.tele = this.telemetry(null);
    }
    step(frameDt, ctrl){
      if (ctrl) this.ctrl = ctrl;
      this.acc = Math.min(this.acc + frameDt, 0.1);
      let n = 0; while (this.acc >= DT) { this.substep(DT); this.acc -= DT; n++; }
      return n;
    }
    substep(dt){
      const s = this.s, m = this.model; if (s.crashed) return;
      const F = this.failures, rawCtrl = this.ctrl;
      if (F.failsafeUntil != null && s.t < F.failsafeUntil) this.ctrl = { ail:0, ele:0, rud:0, thr:0, flap:0 }; // radio failsafe: neutral surfaces, throttle off
      else if (F.stuckAil != null) this.ctrl = Object.assign({}, rawCtrl, { ail:F.stuckAil });
      this.env.update(dt, { V:Math.hypot(...s.v), p:s.p });
      const tau = 0.12; s.spool += (clamp(this.ctrl.thr, 0, 1) - s.spool) * Math.min(1, dt / tau);
      const vB = qinvrot(s.q, s.v), h = -s.p[2];
      const env = { rho:this.env.rhoAt(h), soc:s.soc, h, motorOff:s.soc < 0.03 || s.propStrike || !!F.motor, windB:rB => qinvrot(s.q, this.env.at(add(s.p, qrot(s.q, rB)))) };
      const r = forces(m, { v:vB, w:s.w, spool:s.spool }, this.ctrl, env);
      let Fw = qrot(s.q, r.F), Mb = r.M.slice();
      Fw[2] += m.mass * G;
      // ground contacts
      let onG = false;
      const nC = Math.max(2, m.contacts.filter(c => c.kind === 'wheel').length || 3), k = m.mass * G / (nC * 0.006), cd = 2 * 0.75 * Math.sqrt(k * m.mass / nC);
      const fwdW = qrot(s.q, [1, 0, 0]);
      for (const c of m.contacts) {
        const rw = qrot(s.q, c.r), pc = add(s.p, rw); if (pc[2] < 0) continue;
        const vc = add(s.v, qrot(s.q, cross(s.w, c.r))), pen = pc[2];
        if (vc[2] > (c.kind === 'wheel' ? 4.0 : 3.2) && !s.crashed) { s.crashed = { reason:c.kind === 'wheel' ? 'Hard landing' : 'Crashed into the ground', speed:vc[2], t:s.t }; this.events.push({ type:'crash', t:s.t, ...s.crashed }); }
        const horiz = Math.hypot(vc[0], vc[1]);
        if (c.kind === 'prop' && s.spool > 0.15 && !s.propStrike) { s.propStrike = true; this.events.push({ type:'propstrike', t:s.t }); }
        if (c.kind === 'skid' && horiz > 9 && pen > 0.01 && !s.crashed) { s.crashed = { reason:'Cartwheeled', speed:horiz, t:s.t }; this.events.push({ type:'crash', t:s.t, ...s.crashed }); }
        const Fn = Math.max(0, k * pen + cd * vc[2]);
        let Ft;
        if (c.kind === 'wheel') {
          let rd = norm([fwdW[0], fwdW[1], 0]);
          if (c.steer) { const a = -this.ctrl.rud * 20 * DEG * (m.gear === 'taildragger' ? -1 : 1); rd = [rd[0] * Math.cos(a) - rd[1] * Math.sin(a), rd[0] * Math.sin(a) + rd[1] * Math.cos(a), 0]; }
          const lat = [-rd[1], rd[0], 0], vr = vc[0] * rd[0] + vc[1] * rd[1], vl = vc[0] * lat[0] + vc[1] * lat[1];
          const fr = -0.04 * Fn * Math.tanh(vr / 0.2) - (this.ctrl.brake ? 0.5 * Fn * Math.tanh(vr / 0.2) : 0), fl = -0.9 * Fn * Math.tanh(vl / 0.25);
          Ft = [rd[0] * fr + lat[0] * fl, rd[1] * fr + lat[1] * fl, 0];
        } else { const mu = c.kind === 'prop' ? 0.5 : 0.45, sp = Math.max(horiz, 1e-6); Ft = [-mu * Fn * Math.tanh(horiz / 0.3) * vc[0] / sp, -mu * Fn * Math.tanh(horiz / 0.3) * vc[1] / sp, 0]; }
        const Fc = [Ft[0], Ft[1], -Fn];
        Fw = add(Fw, Fc); const mc = cross(c.r, qinvrot(s.q, Fc)); Mb = add(Mb, mc); onG = true;
      }
      s.onGround = onG;
      // integrate (semi-implicit Euler)
      const a = scl(Fw, 1 / m.mass); s.v = add(s.v, scl(a, dt)); s.p = add(s.p, scl(s.v, dt));
      const Iw = mat3v(m.I, s.w), wdot = mat3v(m.Iinv, sub(Mb, cross(s.w, Iw)));
      s.w = add(s.w, scl(wdot, dt));
      if (onG) s.w = scl(s.w, 1 - 0.5 * dt); // contact rotational damping
      s.q = qnorm(add4(s.q, scl4(qmul(s.q, [0, s.w[0], s.w[1], s.w[2]]), 0.5 * dt)));
      s.soc = Math.max(0, s.soc - r.I * dt / 3600 / (m.capacity_mAh / 1000)); s.mAh += r.I * dt / 3.6;
      s.t += dt; this.last = r; this.lastAcc = a;
      if (!isFinite(s.p[0] + s.v[0] + s.w[0] + s.q[0])) { s.crashed = { reason:'Numerical failure (reset)', t:s.t }; }
      this.ctrlApplied = this.ctrl; this.ctrl = rawCtrl;
    }
    telemetry(){
      const s = this.s, m = this.model, e = toEuler(s.q), vB = qinvrot(s.q, s.v), wind = this.env.at(s.p), wB = qinvrot(s.q, sub(s.v, wind));
      const V = Math.hypot(...wB), alpha = Math.atan2(wB[2], Math.max(1e-6, wB[0])), beta = V > 0.5 ? Math.asin(clamp(wB[1] / V, -1, 1)) : 0;
      const r = this.last || { I:0, Pin:0, rpm:0, T:0, stallFrac:0, F:[0, 0, 0] };
      const nz = -(r.F[2]) / (m.mass * G);
      const Vcell = (vocCell(s.soc) - r.I * 0.012 * 1000 / m.capacity_mAh);
      return { t:s.t, V, Vg:Math.hypot(s.v[0], s.v[1]), alt:-s.p[2], vs:-s.v[2], alpha:alpha / DEG, beta:beta / DEG, phi:e.phi / DEG, theta:e.theta / DEG, psi:e.psi / DEG,
        p:s.w[0] / DEG, q:s.w[1] / DEG, r:s.w[2] / DEG, nz, thr:this.ctrl.thr, spool:s.spool, I:r.I, Pin:r.Pin, rpm:r.rpm, T:r.T, soc:s.soc, mAh:s.mAh, Vcell, stall:r.stallFrac, onGround:s.onGround, crashed:s.crashed, pos:s.p.slice(), vB, wind };
    }
  }
  const add4 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]], scl4 = (a, k) => a.map(v => v * k);

  /* ---------- assists + autopilot (PD controllers scaled by dynamic pressure) ---------- */
  function pilotAssist(sim, sticks, o = {}){
    const t = sim.telemetry(), m = sim.model, qref = 0.5 * RHO_SL * (m.trim ? m.trim.V : 10) ** 2, q = 0.5 * RHO_SL * Math.max(2, t.V) ** 2, gk = clamp(qref / q, 0.4, 3);
    const out = Object.assign({}, sticks);
    const level = (phiCmd, thCmd, kp = 0.035, kd = 0.006) => ({ ail:clamp((kp * (phiCmd - t.phi) - kd * t.p) * gk, -1, 1), ele:clamp((kp * 1.4 * (thCmd - t.theta) - kd * 1.4 * t.q) * gk, -1, 1) });
    if (o.rescue) { const c = level(0, 12); out.ail = c.ail; out.ele = c.ele; out.thr = Math.max(out.thr, 0.7); out.rud = 0; return out; }
    if (o.mode === 'angle') {
      const thTrim = m.trim ? m.trim.alphaDeg - m.wingIncidence / DEG : 0;
      const c = level(sticks.ail * 50, thTrim + sticks.ele * 28 + (Math.abs(t.phi) > 10 ? Math.min(8, Math.abs(t.phi) / 6) : 0)); out.ail = c.ail; out.ele = c.ele;
      out.rud = clamp(sticks.rud + 0.25 * sticks.ail, -1, 1);
    } else if (o.mode === 'level') {
      if (Math.abs(sticks.ail) < 0.08) out.ail = clamp(sticks.ail + (0.03 * (0 - t.phi) - 0.006 * t.p) * gk, -1, 1);
      if (Math.abs(sticks.ele) < 0.08 && Math.abs(t.phi) < 60) out.ele = clamp(sticks.ele + (0.02 * (2 - t.theta) - 0.006 * t.q) * gk, -1, 1);
    }
    if (m.surf === 'none') { out.rud = clamp(out.rud + (o.mode ? 1.6 : 1) * out.ail, -1, 1); out.ail = 0; } // 3-channel plane: the aileron stick steers with rudder
    if (o.stallGuard) { const lim = (m.alphaStallDeg || 12) - 2.5; if (t.alpha > lim && out.ele > 0) out.ele = Math.max(-0.3, out.ele - 0.25 * (t.alpha - lim)); }
    return out;
  }
  class Autopilot {
    constructor(sim){ this.sim = sim; this.i = { alt:0, spd:0 }; }
    fly(tg, dt){
      const t = this.sim.telemetry(), m = this.sim.model, qref = 0.5 * RHO_SL * (m.trim ? m.trim.V : 10) ** 2, gk = clamp(qref / (0.5 * RHO_SL * Math.max(2, t.V) ** 2), 0.4, 3);
      let thCmd = tg.theta != null ? tg.theta : 0;
      if (tg.alt != null) { const e = tg.alt - t.alt; this.i.alt = clamp(this.i.alt + e * dt, -30, 30); thCmd = clamp(0.8 * e + 0.08 * this.i.alt - 1.2 * t.vs, -25, 25) + (m.trim ? m.trim.alphaDeg - m.wingIncidence / DEG : 0); }
      if (tg.speedOnPitch != null) { const e = t.V - tg.speedOnPitch; this.i.spd = clamp(this.i.spd + e * dt, -30, 30); thCmd = clamp(2.4 * e + 0.2 * this.i.spd, -35, 30); }
      const phiCmd = tg.phi != null ? tg.phi : tg.heading != null ? clamp(1.2 * wrap180(tg.heading - t.psi), -30, 30) : 0;
      const c = { ail:clamp((0.04 * (phiCmd - t.phi) - 0.007 * t.p) * gk, -1, 1), ele:clamp((0.05 * (thCmd - t.theta) - 0.01 * t.q) * gk, -1, 1), rud:clamp(0.02 * -t.beta, -1, 1), thr:0, flap:0 };
      if (m.surf === 'none') { c.rud = clamp(c.rud + 1.6 * c.ail, -1, 1); c.ail = 0; } // rudder-elevator plane: bank with rudder (dihedral rolls it)
      if (tg.ele != null) c.ele = tg.ele; if (tg.ail != null) c.ail = tg.ail;
      if (tg.speed != null) { const e = tg.speed - t.V; this.i.thr = clamp((this.i.thr || 0.5) + 0.04 * e * dt, 0, 1); c.thr = clamp(this.i.thr + 0.08 * e, 0, 1); } else c.thr = tg.thr != null ? tg.thr : 0;
      return c;
    }
  }
  const wrap180 = a => ((a + 540) % 360) - 180;

  /* ---------- automated flight tests (compare with Designer predictions) ---------- */
  const TESTS = {
    cruise:{ name:'Cruise (level at design cruise speed)', dur:28 },
    stall:{ name:'Stall speed and wing drop', dur:40 },
    climb:{ name:'Max climb rate', dur:18 },
    glide:{ name:'Glide ratio (motor off)', dur:22 },
    topspeed:{ name:'Top speed (level, full throttle)', dur:30 },
    roll:{ name:'Roll rate (full aileron)', dur:2.6 },
    stability:{ name:'Static margin (pitch stiffness, CG check)', dur:0 },
  };
  /** runTest(model, id, pred, o): runs a test on its own Sim instance (no wind) and returns measured results. */
  /** Pitch stiffness from the simulator's own aerodynamics: SM = −dCm/dCL at the trim point. */
  function measureStaticMargin(model){
    const rho0 = model.rho || RHO_SL, V = model.trim.V, al = model.trim.alphaDeg * DEG, q = 0.5 * rho0 * V * V, S = model.Sref, c = model.cref, env = { windB:() => [0, 0, 0], rho:rho0, soc:1, h:60 };
    const at = a => { const r = forces(model, { v:[V * Math.cos(a), 0, V * Math.sin(a)], w:[0, 0, 0] }, { ail:0, ele:0, rud:0, thr:model.trim.throttle, flap:0 }, env);
      const L = -(r.F[2] * Math.cos(a) - r.F[0] * Math.sin(a)); return { CL:L / (q * S), Cm:r.M[1] / (q * S * c) }; };
    const d = 0.5 * DEG, a1 = at(al - d), a2 = at(al + d), dCm = (a2.Cm - a1.Cm), dCL = (a2.CL - a1.CL);
    return { SM:-dCm / dCL, CLalpha:dCL / (2 * d), Cmalpha:dCm / (2 * d) };
  }
  function runTest(model, id, pred = {}, o = {}){
    if (id === 'stability') { const r = measureStaticMargin(model), res = { trimOk:model.trim.converged, id, name:TESTS[id].name, measured:r.SM * 100, pred:pred.SM != null ? pred.SM * 100 : null, unit:'% MAC', label:'Static margin', CLalpha:r.CLalpha,
      note:!model.trim.converged ? 'cannot trim level flight at this CG: move the CG towards the recommended position' : r.SM < 0 ? 'unstable in pitch: move the CG forward' : r.SM < 0.05 ? 'very lively: CG near the aft limit' : r.SM > 0.2 ? 'very nose-heavy' : 'stable: CG in the normal range' };
      if (res.pred != null) { const dd = res.measured - res.pred; res.diff = dd / 100; res.match = Math.abs(dd) <= 5 ? 'ok' : Math.abs(dd) <= 10 ? 'warn' : 'bad'; } return res; }
    const env = new Environment({ speed:0, gust:0, thermals:false, rhoFixed:model.rho || RHO_SL }), sim = new Sim(model, { env, start:'air' }), ap = new Autopilot(sim);
    const vc = model.trim.V, alt0 = 60; sim.reset('air', { alt:alt0 });
    const dt = 1 / 60, res = { id, name:TESTS[id].name }, samples = [];
    let tg = {}, phase = 0, t0 = 0, minV = Infinity, stallAt = null, maxRoll = 0, start = null, thetaRel = null;
    for (let t = 0; t < TESTS[id].dur; t += dt) {
      const tl = sim.telemetry();
      if (id === 'cruise') { tg = { alt:alt0, speed:vc }; if (t > 15) samples.push(tl); }
      else if (id === 'stall') {
        if (!stallAt) { tg = { alt:alt0, thr:0, phi:0 }; if (tl.V < minV) minV = tl.V;
          if (t > 3 && (tl.stall > 0.35 || tl.alpha > model.alphaStallDeg + 3 || Math.abs(tl.phi) > 25 || (tl.q < -15 && tl.alt < alt0 - 1))) stallAt = { t, V:minV, alpha:tl.alpha }; }
        else { tg = { ele:clamp(1, -1, 1), ail:0, thr:0 }; maxRoll = Math.max(maxRoll, Math.abs(tl.phi)); if (t > stallAt.t + 2.5) break; }
      }
      else if (id === 'climb') { tg = { speedOnPitch:pred.vClimb || vc * 0.85, thr:1, phi:0 }; if (t > 7) samples.push(tl); }
      else if (id === 'glide') { tg = { speedOnPitch:pred.vLD || vc * 0.9, thr:0, phi:0 }; if (t > 8) samples.push(tl); }
      else if (id === 'topspeed') { tg = { alt:alt0, thr:1, phi:0 }; samples.push(tl); }
      else if (id === 'roll') { tg = t < 1.5 ? { alt:alt0, speed:vc } : { ail:1, ele:0, thr:model.trim.throttle }; if (t >= 1.5 && t <= 2.5) maxRoll = Math.max(maxRoll, Math.abs(tl.p)); }
      sim.step(dt, ap.fly(tg, dt)); if (o.rec) o.rec.push(sim);
      if (sim.s.crashed || sim.s.p[2] > -2) { res.aborted = sim.s.crashed ? sim.s.crashed.reason : 'Too low'; break; }
    }
    const avg = k => samples.reduce((a, s) => a + s[k], 0) / Math.max(1, samples.length);
    if (id === 'cruise') Object.assign(res, { V:avg('V'), thr:avg('thr'), I:avg('I'), P:avg('Pin'), pred:pred.cruisePower, measured:avg('Pin'), unit:'W', label:'Cruise power' });
    if (id === 'stall') Object.assign(res, stallAt ? { V:stallAt.V, wingDrop:maxRoll, measured:stallAt.V, pred:pred.vs, unit:'m/s', label:'Stall speed', note:maxRoll > 30 ? `drops a wing (${Math.round(maxRoll)}° bank)` : 'stalls straight ahead' } : { note:'no clear stall found' });
    if (id === 'climb') Object.assign(res, { measured:avg('vs'), pred:pred.rocMax, unit:'m/s', label:'Climb rate', V:avg('V') });
    if (id === 'glide') { const a = samples[0], b = samples[samples.length - 1]; const dx = a && b ? Math.hypot(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1]) : 0, dh = a && b ? a.alt - b.alt : 1; Object.assign(res, { measured:dh > 0 ? dx / dh : null, pred:pred.LDmax, unit:':1', label:'Glide ratio', V:avg('V') }); }
    if (id === 'topspeed') { const last = samples.slice(-120); Object.assign(res, { measured:last.reduce((a, s) => a + s.V, 0) / Math.max(1, last.length), pred:pred.vmax, unit:'m/s', label:'Top speed' }); }
    if (id === 'roll') Object.assign(res, { measured:maxRoll, pred:null, unit:'°/s', label:'Peak roll rate' });
    if (res.pred != null && res.measured != null) { res.diff = (res.measured - res.pred) / res.pred; res.match = Math.abs(res.diff) <= 0.15 ? 'ok' : Math.abs(res.diff) <= 0.3 ? 'warn' : 'bad'; }
    return res;
  }

  /* ---------- recorder (30 Hz) ---------- */
  class Recorder {
    constructor(max = 30 * 60 * 15){ this.max = max; this.clear(); }
    clear(){ this.rows = []; this.lastT = -1; this.offset = 0; this.prevSimT = 0; }
    /** Start a new segment (after a reset) so recorded time keeps increasing. */
    segment(){ this.offset = (this.rows.length ? this.rows[this.rows.length - 1].t : 0) + 0.5; this.prevSimT = 0; }
    push(sim){ const s = sim.s; if (s.t < this.prevSimT) this.segment(); this.prevSimT = s.t; const T = s.t + this.offset; if (T - this.lastT < 1 / 30 - 1e-6) return; this.lastT = T; const t = sim.telemetry();
      this.rows.push({ t:T, p:s.p.slice(), q:s.q.slice(), c:Object.assign({}, sim.ctrl), V:t.V, alt:t.alt, vs:t.vs, alpha:t.alpha, beta:t.beta, phi:t.phi, theta:t.theta, psi:t.psi, I:t.I, mAh:t.mAh, rpm:t.rpm });
      if (this.rows.length > this.max) this.rows.shift(); }
    sample(t){ const R = this.rows; if (!R.length) return null; let lo = 0, hi = R.length - 1; if (t <= R[0].t) return R[0]; if (t >= R[hi].t) return R[hi];
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (R[mid].t < t) lo = mid; else hi = mid; }
      const a = R[lo], b = R[hi], f = (t - a.t) / ((b.t - a.t) || 1); return Object.assign({}, a, { t, p:a.p.map((v, i) => v + (b.p[i] - v) * f), q:qnorm(a.q.map((v, i) => v + ((dot4(a.q, b.q) < 0 ? -b.q[i] : b.q[i]) - v) * f)) }); }
    csv(){ const h = ['t_s', 'x_m', 'y_m', 'alt_m', 'airspeed_ms', 'vs_ms', 'alpha_deg', 'beta_deg', 'roll_deg', 'pitch_deg', 'heading_deg', 'throttle', 'aileron', 'elevator', 'rudder', 'current_A', 'used_mAh', 'rpm'];
      return [h.join(',')].concat(this.rows.map(r => [r.t, r.p[0], r.p[1], r.alt, r.V, r.vs, r.alpha, r.beta, r.phi, r.theta, r.psi, r.c.thr, r.c.ail, r.c.ele, r.c.rud, r.I, r.mAh, r.rpm].map(v => (+v).toFixed(3)).join(','))).join('\n'); }
  }
  const dot4 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];

  return { DT, CAL1, forces, section, Environment, WEATHER_PRESETS, WEATHER_KEYS, airDensity, densityAltitude, Sim, pilotAssist, Autopilot, TESTS, runTest, measureStaticMargin, Recorder, quat:{ qmul, qrot, qinvrot, fromEuler, toEuler, qnorm }, vocCell, wrap180 };
})();
if (typeof module !== 'undefined') module.exports = { SimPhysics };
