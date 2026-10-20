/* RC Calc aero & design engine (pure, no DOM). Depends on rc-core.js.
   Airfoils, mission sizer, stability, lifting line, performance, motor model, parts list, designAircraft().
   Every model here is a simplified estimate; constants are editable at the top of each block. */
'use strict';

/* =====================================================================
   A. AIRFOILS: generated shapes + .dat import + thin-airfoil analysis
   Points are Selig order: upper surface TE → LE, then lower surface LE → TE, chord 0..1.
   ===================================================================== */
const Airfoil = (() => {
  const cosx = n => Array.from({ length:n + 1 }, (_, k) => (1 - Math.cos(Math.PI * k / n)) / 2);
  const yt = (x, t) => 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
  function fromSurfaces(xs, up, lo){ // up/lo: arrays of y at xs (LE→TE)
    const U = xs.map((x, i) => [x, up[i]]).reverse(), L = xs.map((x, i) => [x, lo[i]]).slice(1);
    return U.concat(L);
  }
  function naca4(m, p, t, n = 40){
    const xs = cosx(n), up = [], lo = [], ux = [], lx = [];
    for (const x of xs) {
      const yc = m === 0 ? 0 : x < p ? m / (p * p) * (2 * p * x - x * x) : m / ((1 - p) ** 2) * ((1 - 2 * p) + 2 * p * x - x * x);
      const dy = m === 0 ? 0 : x < p ? 2 * m / (p * p) * (p - x) : 2 * m / ((1 - p) ** 2) * (p - x);
      const th = Math.atan(dy), h = yt(x, t);
      ux.push(x - h * Math.sin(th)); up.push(yc + h * Math.cos(th));
      lx.push(x + h * Math.sin(th)); lo.push(yc - h * Math.cos(th));
    }
    const U = ux.map((x, i) => [x, up[i]]).reverse(), L = lx.map((x, i) => [x, lo[i]]).slice(1);
    return U.concat(L);
  }
  function clarkYLike(t = 0.117, n = 40){ // flat-bottom approximation, NOT exact Clark Y coordinates
    const xs = cosx(n);
    return fromSurfaces(xs, xs.map(x => 2 * yt(x, t) * (1 - 0.16 * x)), xs.map(x => x < 0.3 ? -0.55 * yt(x, t) * (1 - x / 0.3) : 0));
  }
  function reflexed(t = 0.09, k = 0.12, r = 0.78, n = 40){ // camber z = k·x(1-x)(r-x): positive front, reflexed tail
    const xs = cosx(n), zc = x => k * x * (1 - x) * (r - x);
    return fromSurfaces(xs, xs.map(x => zc(x) + yt(x, t)), xs.map(x => zc(x) - yt(x, t)));
  }
  function flatPlate(t = 0.03, n = 40){
    const xs = cosx(n), h = x => t / 2 * Math.min(1, Math.sqrt(x / 0.03)) * Math.min(1, (1 - x) / 0.06 + 0.15);
    return fromSurfaces(xs, xs.map(h), xs.map(x => -h(x)));
  }
  function kfm2(t1 = 0.045, step = 0.5, n = 60){ // KFm-2: full-chord base sheet + top step layer forward of `step`
    const xs = cosx(n), nose = x => Math.min(1, Math.sqrt(x / 0.04));
    return fromSurfaces(xs, xs.map(x => (x <= step ? 2 * t1 : t1) * (x <= step ? nose(x) : Math.min(1, (1 - x) / 0.04 + 0.2))), xs.map(() => 0));
  }
  function parseDat(text){
    const lines = String(text).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    let name = 'Imported airfoil'; const pts = [];
    for (const ln of lines) { const m = ln.match(/^(-?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+(-?\d*\.?\d+(?:[eE][-+]?\d+)?)$/); if (m) pts.push([+m[1], +m[2]]); else if (!pts.length) name = ln.slice(0, 60); }
    if (pts.length < 10) throw new Error('Could not find coordinate pairs in this file.');
    let out = pts;
    if (pts[0][0] > 1.5) { // Lednicer: first line = point counts; upper LE→TE, then lower LE→TE
      const nu = Math.round(pts[0][0]); const up = pts.slice(1, 1 + nu), lo = pts.slice(1 + nu);
      out = up.slice().reverse().concat(lo.slice(1));
    }
    const xmin = Math.min(...out.map(p => p[0])), xmax = Math.max(...out.map(p => p[0])), c = xmax - xmin;
    if (!(c > 0)) throw new Error('Coordinates have zero chord.');
    return { name, points: out.map(([x, y]) => [(x - xmin) / c, y / c]) };
  }
  function split(points){
    let iLE = 0; points.forEach((p, i) => { if (p[0] < points[iLE][0]) iLE = i; });
    const up = points.slice(0, iLE + 1).reverse(), lo = points.slice(iLE);
    const clean = a => a.filter((p, i) => i === 0 || p[0] > a[i - 1][0] - 1e-9).sort((a, b) => a[0] - b[0]);
    return { up:clean(up), lo:clean(lo) };
  }
  function interp(arr, x){
    if (x <= arr[0][0]) return arr[0][1];
    for (let i = 1; i < arr.length; i++) if (x <= arr[i][0]) { const a = arr[i - 1], b = arr[i], t = (x - a[0]) / ((b[0] - a[0]) || 1); return a[1] + t * (b[1] - a[1]); }
    return arr[arr.length - 1][1];
  }
  function resample(points, n = 30){
    const { up, lo } = split(points), xs = cosx(n);
    return { xs, yu:xs.map(x => interp(up, x)), yl:xs.map(x => interp(lo, x)) };
  }
  function stats(points){
    const r = resample(points, 120); let t = 0, xt = 0, cam = 0, xc = 0;
    r.xs.forEach((x, i) => { const th = r.yu[i] - r.yl[i], z = (r.yu[i] + r.yl[i]) / 2; if (th > t) { t = th; xt = x; } if (Math.abs(z) > Math.abs(cam)) { cam = z; xc = x; } });
    return { t, xt, camber:cam, xc };
  }
  /** Thin-airfoil theory on the mean line: zero-lift angle (deg) and Cm about c/4. */
  function thinAirfoil(points){
    const { up, lo } = split(points), z = x => (interp(up, x) + interp(lo, x)) / 2, N = 400;
    let i0 = 0, im = 0;
    for (let k = 0; k < N; k++) {
      const th = (k + 0.5) * Math.PI / N, x = (1 - Math.cos(th)) / 2, h = 1e-4;
      const dz = (z(Math.min(1, x + h)) - z(Math.max(0, x - h))) / (Math.min(1, x + h) - Math.max(0, x - h));
      i0 += dz * (Math.cos(th) - 1) * Math.PI / N; im += dz * (Math.cos(2 * th) - Math.cos(th)) * Math.PI / N;
    }
    return { alpha0Deg: -i0 / Math.PI * 180 / Math.PI, cm0: 0.5 * im };
  }
  // Typical low-Reynolds characteristics (Re ≈ 100k). Estimates for comparison, not wind-tunnel data.
  const PRESETS = [
    { id:'clarky',    name:'Clark Y–like (flat bottom)', gen:() => clarkYLike(),        clmax:1.25, cd0:0.013, use:'Trainers, easy to build on a flat board', approx:true },
    { id:'naca2412',  name:'NACA 2412',                  gen:() => naca4(0.02, 0.4, 0.12), clmax:1.15, cd0:0.012, use:'Sport, all-round' },
    { id:'naca4412',  name:'NACA 4412',                  gen:() => naca4(0.04, 0.4, 0.12), clmax:1.30, cd0:0.013, use:'Slow flyers, trainers, payload' },
    { id:'naca6409',  name:'NACA 6409',                  gen:() => naca4(0.06, 0.4, 0.09), clmax:1.40, cd0:0.014, use:'Gliders, slow thermal flying' },
    { id:'naca0012',  name:'NACA 0012 (symmetric)',      gen:() => naca4(0, 0.4, 0.12),    clmax:0.95, cd0:0.013, use:'Aerobatic (flies inverted equally)' },
    { id:'naca0009',  name:'NACA 0009 (symmetric)',      gen:() => naca4(0, 0.4, 0.09),    clmax:0.85, cd0:0.012, use:'Tail surfaces, fast aerobatic' },
    { id:'reflex',    name:'Reflexed (flying wing)',     gen:() => reflexed(),            clmax:0.90, cd0:0.012, use:'Flying wings: positive Cm0, pitch-stable alone', approx:true },
    { id:'kfm2',      name:'KFm-2 step (Depron)',        gen:() => kfm2(),                clmax:1.00, cd0:0.020, use:'Foam sheet builds, very simple', approx:true },
    { id:'folded',    name:'Folded foam board',          gen:() => clarkYLike(0.13),      clmax:1.15, cd0:0.022, use:'Foam-board (Flite Test style) folded wings', approx:true },
    { id:'flat',      name:'Flat plate (3%)',            gen:() => flatPlate(),           clmax:0.80, cd0:0.020, use:'Chuck gliders, profile aerobats', approx:true },
  ];
  function get(id, custom){
    if (id === 'custom' && custom && custom.points) {
      const st = stats(custom.points), ta = thinAirfoil(custom.points);
      return { id:'custom', name:custom.name || 'Imported airfoil', points:custom.points, clmax:Math.max(0.7, Math.min(1.6, 0.85 + 9 * st.camber + 1.5 * (st.t - 0.09))), cd0:0.013, use:'Imported coordinates', estimated:true, ...st, ...ta };
    }
    const p = PRESETS.find(a => a.id === id) || PRESETS[0], pts = p.gen();
    return { ...p, points:pts, ...stats(pts), ...thinAirfoil(pts) };
  }
  return { PRESETS, naca4, clarkYLike, reflexed, flatPlate, kfm2, parseDat, split, interp, resample, stats, thinAirfoil, get };
})();

/* =====================================================================
   B. MATERIALS & WEIGHT MODEL (areal densities are typical, edit to match your stock)
   ===================================================================== */
const MATERIALS = {
  depron:    { label:'Depron / foam sheet (6 mm)', method:'foam',  foamStyle:'kfm',    wing:4.2, tail:1.1, fuse:2.0, sheetT:6, tailT:3, sheet:[1000, 500], sheetName:'Depron sheet 1000×500 mm' },
  foamboard: { label:'Foam board (paper-faced, 5 mm)', method:'foam', foamStyle:'folded', wing:6.5, tail:2.6, fuse:2.6, sheetT:5, tailT:5, sheet:[762, 508],  sheetName:'Foam board 20×30 in' },
  balsa:     { label:'Balsa built-up, film covered', method:'balsa', foamStyle:null,  wing:3.6, tail:2.3, fuse:2.4, sheetT:2, tailT:3, sheet:[915, 100],  sheetName:'Balsa sheet 100×915 mm' },
}; // wing/tail/fuse in g per dm² of planform / box surface
const COMMON_MAH = [150,180,220,260,300,350,450,500,650,800,850,1000,1300,1500,1800,2200,2700,3000,3300,4000,5000,6000];
const MISSIONS = {
  trainer:   { label:'Trainer',          style:'trainer',   stall:6.5, ar:6.5, preset:'trainer' },
  sport:     { label:'Sport',            style:'sport',     stall:8.0, ar:6.0, preset:'lowwing' },
  aerobatic: { label:'Aerobatic',        style:'aerobatic', stall:8.0, ar:5.0, preset:'lowwing' },
  glider:    { label:'Powered glider',   style:'glider',    stall:5.5, ar:9.0, preset:'chuck' },
  payload:   { label:'FPV / payload',    style:'sport',     stall:7.0, ar:7.0, preset:'trainer', wpk:170 },
  wing:      { label:'Flying wing',      style:'sport',     stall:8.0, ar:5.0, preset:'flyingwing' },
};
const SIZING = { avgPowerFrac:0.45, usable:0.8, whPerGram:0.13, cellLeads_g:2, hardwareFrac:0.06, hardware_g:4, wiringFrac:0.05, clFactor3D:0.9 };

function cellsForPower(P){ return P < 12 ? 1 : P < 50 ? 2 : P < 250 ? 3 : P < 600 ? 4 : 6; }
function servoMass(auw){ return auw < 0.25 ? 4.5 : auw < 1 ? 9 : 17; }
function airframeMass(geom, g, mat){
  const S = g.S * 100, St = (g.Sh + g.Sv) * 100, Lf = geom.fuseLen * 10;
  const wing = mat.wing * S, tail = mat.tail * St;
  const fuse = g.body === 'stick' ? 0.009 * geom.fuseLen * 1000 : g.body === 'pod' ? mat.fuse * Math.PI * (g.hf + g.wf) * 5 * Lf * 0.7 : mat.fuse * 2 * Lf * (g.hf + g.wf) * 10 * 0.8;
  const sub = wing + tail + fuse;
  return { wing, tail, fuse, hardware: SIZING.hardwareFrac * sub + SIZING.hardware_g, total: sub * (1 + SIZING.hardwareFrac) + SIZING.hardware_g };
}
function batteryFor(P, cells, flightMin){
  const wh = P * SIZING.avgPowerFrac * flightMin / 60 / SIZING.usable;
  let mah = wh / (cells * V_NOMINAL) * 1000;
  const I = P / (cells * 3.5); if (I / (mah / 1000) > 40) mah = I / 40 * 1000;
  mah = COMMON_MAH.find(c => c >= mah) || Math.ceil(mah / 500) * 500;
  return { cells, mah, mass: cells * V_NOMINAL * mah / 1000 / SIZING.whPerGram + SIZING.cellLeads_g * cells };
}

/**
 * sizeAircraft(req): fixed-point iteration AUW → wing area (stall target) → geometry → component weights → AUW.
 * req: { mission, preset, payload_kg, stall_ms, span_m|null, flightMin, cells:'auto'|n, material, airfoil(clmax), maxAuw_kg|null, rho }
 */
function sizeAircraft(req){
  const ms = MISSIONS[req.mission] || MISSIONS.trainer, st = STYLES[ms.style], mat = MATERIALS[req.material] || MATERIALS.depron;
  const preset = req.preset || ms.preset, rho = req.rho || RHO_SL, vs = req.stall_ms > 0 ? req.stall_ms : ms.stall;
  const clw = (req.clmax || 1.1) * SIZING.clFactor3D, wpk = ms.wpk || st.wPerKg;
  const controls = PRESETS[preset] && PRESETS[preset].hRatio === 0 ? 'elevon' : (req.mission === 'trainer' || req.mission === 'glider') ? 're' : 'aer2';
  let flightMin = req.flightMin > 0 ? req.flightMin : 8;
  const run = fm => {
    let auw = 0.3, last = null, it = 0, converged = false;
    for (; it < 200; it++) {
      const Sstall = 2 * auw * G / (rho * vs * vs * clw);
      const S = req.span_m > 0 ? Math.max(req.span_m * req.span_m / ms.ar, Sstall) : Sstall;
      const b = req.span_m > 0 ? req.span_m : Math.sqrt(ms.ar * S);
      const geom = autoProportion(preset, b, ms.style, S); geom.washout = preset === 'flyingwing' ? 3 : 0;
      const g = airframeGeometry(geom, 0);
      const af = airframeMass(geom, g, mat);
      const P = auw * wpk, cells = req.cells > 0 ? +req.cells : cellsForPower(P);
      const I = P / (cells * 3.5), escA = ESC_SIZES.find(a => a >= Math.ceil(1.5 * I - 1e-9)) || Math.ceil(1.5 * I);
      const motor = Math.max(4, Phys.motorWeight(P)), esc = 2 + 0.7 * escA, prop = Math.max(1.5, 0.12 * motor);
      const nServo = (CONTROLS[controls] || CONTROLS.re).servos, servo = servoMass(auw) * nServo, rx = auw < 0.25 ? 4 : 7;
      const bat = batteryFor(P, cells, fm), payload = (req.payload_kg || 0) * 1000;
      const elec = motor + esc + prop + servo + rx;
      const wiring = SIZING.wiringFrac * elec + 2;
      const total_g = af.total + elec + wiring + bat.mass + payload;
      last = { S, b, geom, g, af, P, cells, I, escA, motor, esc, prop, servo, nServo, rx, bat, payload, wiring, total_g };
      const next = total_g / 1000;
      if (!isFinite(next) || next > 60) break;
      if (Math.abs(next - auw) < 5e-5) { converged = true; break; } // 0.05 g
      const damp = it < 40 ? 0.5 : it < 120 ? 0.2 : 0.05; // discrete parts (cells, ESC, pack sizes) can limit-cycle
      auw += damp * (next - auw);
    }
    if (!converged && last && isFinite(last.total_g) && Math.abs(last.total_g / 1000 - auw) < 1e-3) converged = true; // within 1 g
    return { auw, last, it, converged };
  };
  let r = run(flightMin);
  const warnings = [];
  if (req.maxAuw_kg > 0 && r.auw > req.maxAuw_kg) {
    while (flightMin > 3 && r.auw > req.maxAuw_kg) { flightMin -= 0.5; r = run(flightMin); }
    warnings.push(r.auw > req.maxAuw_kg
      ? { lvl:'warn', text:`Cannot reach the ${fmt(req.maxAuw_kg * 1000, 0)} g limit even with a 3-minute battery. Try a lighter material, a higher stall speed, or less payload.` }
      : { lvl:'info', text:`To stay under ${fmt(req.maxAuw_kg * 1000, 0)} g the battery was reduced to about ${fmt(flightMin, 1)} min of flying.` });
  }
  if (!r.converged) warnings.push({ lvl:'warn', text:'The sizing did not converge: the structure is too heavy for this stall speed (each gram of wing needs more wing). Raise the stall speed or choose a lighter material.' });
  const L = r.last, AR = L.b * L.b / L.S, wl = r.auw * 1000 / (L.S * 100);
  if (AR < 4) warnings.push({ lvl:'warn', text:`Aspect ratio ${fmt(AR, 1)} is very low for this span. The wing chord gets huge; consider more span.` });
  if (AR > 12) warnings.push({ lvl:'warn', text:`Aspect ratio ${fmt(AR, 1)} is very high; the wing will be flexible and fragile. Consider less span or a higher stall speed.` });
  if (wl > st.wlMax) warnings.push({ lvl:'warn', text:`Wing loading ${fmt(wl, 1)} g/dm² is high for a ${st.label.toLowerCase()}.` });
  if (r.auw >= 0.25 && !(req.maxAuw_kg > 0)) warnings.push({ lvl:'info', text:`Estimated AUW ${fmt(r.auw * 1000, 0)} g is 250 g or more. Check local registration / Remote ID rules, or tick "Keep under 250 g".` });
  const breakdown = [
    { key:'airframe', label:'Airframe', g:L.af.total }, { key:'battery', label:'Battery', g:L.bat.mass }, { key:'motor', label:'Motor', g:L.motor },
    { key:'esc', label:'ESC', g:L.esc }, { key:'servos', label:`Servos (${L.nServo})`, g:L.servo }, { key:'rx', label:'Receiver', g:L.rx },
    { key:'prop', label:'Prop', g:L.prop }, { key:'wiring', label:'Wiring / misc', g:L.wiring }, { key:'payload', label:'Payload', g:L.payload },
  ];
  const vsAct = Math.sqrt(2 * r.auw * G / (rho * L.S * clw));
  return { auw:r.auw, converged:r.converged, iterations:r.it, flightMin, S:L.S, b:L.b, AR, wl, vs:vsAct, vsTarget:vs, vc:vsAct * 1.4, rho, clw, wpk, style:ms.style, mission:req.mission,
    preset, controls, geom:L.geom, P:L.P, cells:L.cells, I:L.I, escA:L.escA, capacity_mAh:L.bat.mah, reqC:L.I / (L.bat.mah / 1000), recC:Math.ceil(1.5 * L.I / (L.bat.mah / 1000)),
    airframe:L.af, breakdown, material:req.material, warnings };
}

/* =====================================================================
   C. STABILITY: neutral point, static margin, CG range, spiral stability; multi-panel MAC/CG (cgCalc-style)
   ===================================================================== */
const liftSlope = AR => 2 * Math.PI * AR / (2 + Math.sqrt(AR * AR + 4)); // Helmbold, per rad
function stabilityAnalysis(d, g, o = {}){
  const sm = o.smTarget != null ? o.smTarget : 0.10, aw = liftSlope(g.AR), r = { aw, tailless:g.tailless };
  const p = Math.max(0.1, Math.min(0.6, g.xMacQC / d.fuseLen));
  const Kf = 0.1 * p * p;
  r.fus = Kf * g.wf * g.wf * d.fuseLen / (g.S * g.mac * (aw / 57.3));
  if (!g.tailless) {
    const ARh = d.hSpan * d.hSpan / g.Sh; r.at = liftSlope(ARh); r.deda = Math.min(0.6, 2 * aw / (Math.PI * g.AR)); r.eta = 0.9;
    r.tailTerm = r.eta * (r.at / aw) * (1 - r.deda) * g.Vh;
    r.xnp = 0.25 + r.tailTerm - r.fus;
  } else { r.xnp = 0.25 - r.fus; r.tailTerm = 0; }
  r.cgRec = r.xnp - sm; r.cgFwd = r.xnp - 0.15; r.cgAft = r.xnp - 0.05;
  r.cg = (d.cg != null ? d.cg : 28) / 100; r.SM = r.xnp - r.cg;
  r.fromRootLE = f => g.xMacLE - g.xwLE + f * g.mac;
  r.Vh = g.Vh; r.Vv = g.Vv;
  if (o.CLcruise > 0) r.blaine = (g.lv / d.span) * (Math.abs(d.dihedral) + 0.5 * Math.max(0, d.sweep)) / o.CLcruise;
  r.status = r.SM < 0 ? 'bad' : r.SM < 0.05 ? 'warn' : r.SM <= 0.15 ? 'ok' : r.SM <= 0.25 ? 'warn' : 'bad';
  r.notes = [];
  if (r.SM < 0) r.notes.push({ lvl:'warn', text:'CG is behind the neutral point: the plane is pitch-unstable and will likely be unflyable. Move the CG forward.' });
  else if (r.SM < 0.05) r.notes.push({ lvl:'warn', text:'Static margin under 5%: very sensitive in pitch. Fine for experts, not for a first flight.' });
  else if (r.SM > 0.2) r.notes.push({ lvl:'warn', text:'Static margin over 20%: very nose-heavy, needs lots of up-elevator and lands fast.' });
  if (g.tailless && o.cm0 != null && o.cm0 < -0.005 && !(d.washout > 2 && d.sweep > 15)) r.notes.push({ lvl:'warn', text:`Tailless with a cambered airfoil (Cm0 ${fmt(o.cm0, 3)}): it needs a reflexed airfoil, or sweep plus washout, to trim. Choose "Reflexed" or add washout.` });
  if (r.blaine != null && r.blaine < 5 && !g.tailless) r.notes.push({ lvl:'info', text:`Spiral stability index B = ${fmt(r.blaine, 1)} (≥ 5 recovers from banks by itself). More dihedral or fin helps a beginner plane.` });
  return r;
}
/** multiPanelWing: per-half panels [{span, chord (tip of panel), sweep (LE deg)}], rootChord. All metres. */
function multiPanelWing(rootChord, panels, smTarget = 0.1, tailless = false){
  let y0 = 0, c0 = rootChord, x0 = 0, A = 0, Ac2 = 0, Ay = 0, Ax = 0, segs = [];
  for (const p of panels) {
    const n = 40, tan = Math.tan(p.sweep * Math.PI / 180);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n, dy = p.span / n, y = y0 + t * p.span, c = c0 + (p.chord - c0) * t, x = x0 + t * p.span * tan;
      A += c * dy; Ac2 += c * c * dy; Ay += c * y * dy; Ax += c * x * dy;
    }
    segs.push({ y0, y1:y0 + p.span, c0, c1:p.chord, x0, x1:x0 + p.span * tan });
    x0 += p.span * tan; y0 += p.span; c0 = p.chord;
  }
  const mac = Ac2 / A, yMac = Ay / A, xMacLE = Ax / A, S = 2 * A, b = 2 * y0;
  const np = xMacLE + 0.25 * mac;
  return { S, b, AR:b * b / S, mac, yMac, xMacLE, np, cg:np - smTarget * mac, segs, note: tailless ? 'Tailless: neutral point ≈ MAC quarter-chord.' : 'With a tail the neutral point moves aft; use the full stability analysis.' };
}

/* =====================================================================
   D. LIFTING LINE (Prandtl/Glauert, symmetric loading). Straight-wing theory: sweep is ignored.
   ===================================================================== */
function solveLinear(A, bv){
  const n = bv.length, M = A.map((r, i) => r.concat([bv[i]]));
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; }
  return x;
}
function liftingLine(o){
  const N = o.N || 20, b = o.b, cr = o.cr, ct = o.ct, a0 = o.a0 || 2 * Math.PI * 0.9, al0 = (o.alpha0Deg || 0) * Math.PI / 180;
  const S = b * (cr + ct) / 2, AR = b * b / S, wash = (o.washoutDeg || 0) * Math.PI / 180;
  const th = [], cy = [], mu = [], tw = [], ys = [];
  for (let i = 1; i <= N; i++) { const t = i * Math.PI / (2 * N), y = b / 2 * Math.cos(t), c = cr + (ct - cr) * Math.abs(y) / (b / 2); th.push(t); ys.push(y); cy.push(c); mu.push(c * a0 / (4 * b)); tw.push(-wash * Math.abs(y) / (b / 2)); }
  const n = k => 2 * k + 1;
  const M = th.map((t, i) => Array.from({ length:N }, (_, k) => Math.sin(n(k) * t) * (Math.sin(t) + n(k) * mu[i])));
  const U = solveLinear(M, th.map((t, i) => mu[i] * Math.sin(t)));
  const W = solveLinear(M, th.map((t, i) => mu[i] * (tw[i] - al0) * Math.sin(t)));
  const A = alpha => U.map((u, k) => alpha * u + W[k]);
  const CLof = alpha => Math.PI * AR * A(alpha)[0];
  const clAt = (alpha, i) => 4 * b / cy[i] * A(alpha).reduce((s, a, k) => s + a * Math.sin(n(k) * th[i]), 0);
  const info = alpha => { const a = A(alpha), sum = a.reduce((s, x, k) => s + n(k) * x * x, 0); return { CL:Math.PI * AR * a[0], CDi:Math.PI * AR * sum, e:a[0] * a[0] / sum }; };
  const alphaFor = CL => (CL / (Math.PI * AR) - W[0]) / U[0];
  const res = { AR, S, CLalpha:Math.PI * AR * U[0] };
  const ac = alphaFor(o.CL || 0.5); Object.assign(res, info(ac)); res.alphaDeg = ac * 180 / Math.PI;
  if (o.clmax2D > 0) {
    let best = Infinity, bi = 0;
    for (let i = 0; i < N; i++) { const u = clAt(1, i) - clAt(0, i), w0 = clAt(0, i), a = (o.clmax2D - w0) / u; if (a < best) { best = a; bi = i; } }
    res.alphaStallDeg = best * 180 / Math.PI; res.CLmax3D = CLof(best); res.stallStation = Math.abs(ys[bi]) / (b / 2);
  }
  const alphaS = res.alphaStallDeg != null ? res.alphaStallDeg * Math.PI / 180 : ac;
  const cmean = S / b;
  res.stations = ys.map((y, i) => ({ eta:Math.abs(y) / (b / 2), c:cy[i], cl:clAt(ac, i), clStall:clAt(alphaS, i),
    load:clAt(ac, i) * cy[i] / (res.CL * cmean), ell:4 / Math.PI * Math.sqrt(Math.max(0, 1 - (y / (b / 2)) ** 2)) })).sort((a, b) => a.eta - b.eta);
  return res;
}

/* =====================================================================
   E. PERFORMANCE: drag build-up, power required/available, climb, glide, endurance
   ===================================================================== */
const NU_AIR = 1.5e-5;
function flightPerformance(o){
  const { W, S, AR, mac, rho } = o, e = o.e || 0.8, k = 1 / (Math.PI * e * AR);
  const etaP = o.etaProp || 0.6, etaM = o.etaMotor || 0.75, etaE = 0.95;
  const fusCDA = (o.body === 'stick' ? 0.6 : o.body === 'pod' ? 0.15 : 0.4) * o.frontalArea;
  const cd0At = V => { const Re = V * mac / NU_AIR, f = Math.max(0.7, Math.min(2.2, Math.pow(Re / 1e5, -0.4)));
    return 1.15 * (o.cd0Airfoil * f + (0.012 * f * (o.Sh + o.Sv) + fusCDA) / S) + (o.gear ? 0.012 : 0); };
  const vs = Math.sqrt(2 * W / (rho * S * o.CLmax)), vTop = Math.max(vs * 3.2, (o.pitchSpeed || 0) * 1.25);
  const pts = [];
  for (let i = 0; i <= 80; i++) {
    const V = vs * 1.02 + (vTop - vs * 1.02) * i / 80, q = 0.5 * rho * V * V, CL = W / (q * S), CD0 = cd0At(V), CD = CD0 + k * CL * CL, D = q * S * CD;
    const T = o.T0 > 0 && o.pitchSpeed > 0 ? Math.max(0, o.T0 * (1 - V / (1.15 * o.pitchSpeed))) : 0;
    pts.push({ V, CL, CD0, CD, D, T, Preq:D * V / (etaP * etaM * etaE), Pshaft:D * V / etaP, roc:(T - D) * V / W, sink:D * V / W, LD:W / D });
  }
  const arg = f => pts.reduce((a, p) => f(p) < f(a) ? p : a);
  const ld = arg(p => p.D), mp = arg(p => p.D * p.V), climb = pts.reduce((a, p) => p.roc > a.roc ? p : a);
  let vmax = null; for (const p of pts) if (p.T >= p.D) vmax = p.V;
  const cruise = pts.reduce((a, p) => Math.abs(p.V - o.Vcruise) < Math.abs(a.V - o.Vcruise) ? p : a);
  const whUse = o.batteryWh * (o.usable || 0.8);
  return { pts, vs, vLD:ld.V, LDmax:ld.LD, vMinPower:mp.V, sinkMin:mp.sink, vmax, rocMax:climb.roc, vClimb:climb.V,
    cruise, enduranceCruise:whUse / cruise.Preq * 60, enduranceBest:whUse / mp.Preq * 60, cd0Cruise:cruise.CD0, k, e };
}

/* =====================================================================
   F. MOTOR MODEL & MATCHING (eCalc-lite). Typical class values, not specific products.
   ===================================================================== */
const MOTOR_DB = [
  { id:'m1306', name:'1306-class outrunner', kv:3100, rm:0.25, io:0.5, maxA:8,  maxW:60,  mass:11,  cells:[1,2], note:'typical class values' },
  { id:'park180', name:'Park 180 class (E-flite ref.)', kv:2200, rm:0.55, io:0.3, maxA:5, maxW:30, mass:8.5, cells:[2,2], note:'kv/mass/W from reference; Rm/Io assumed' },
  { id:'m1806', name:'1806-class outrunner', kv:2300, rm:0.18, io:0.5, maxA:8, maxW:85, mass:18, cells:[2,3], note:'typical class values' },
  { id:'park300', name:'Park 300 class (E-flite ref.)', kv:1380, rm:0.25, io:0.4, maxA:7, maxW:85, mass:24, cells:[2,2], note:'kv/mass/W/A from reference; Rm/Io assumed' },
  { id:'m2204', name:'2204-class outrunner', kv:1400, rm:0.2, io:0.4, maxA:10, maxW:110, mass:25, cells:[2,3], note:'typical class values' },
  { id:'m2208', name:'2208-class outrunner', kv:1100, rm:0.15, io:0.5, maxA:14, maxW:150, mass:40, cells:[2,3], note:'typical class values' },
  { id:'park370', name:'Park 370 class (E-flite ref.)', kv:1360, rm:0.12, io:0.6, maxA:12, maxW:150, mass:45, cells:[2,3], note:'kv/mass/W/A from reference; Rm/Io assumed' },
  { id:'m2212', name:'2212-class outrunner', kv:1000, rm:0.13, io:0.5, maxA:15, maxW:170, mass:50, cells:[3,3], note:'typical class values' },
  { id:'m2216', name:'2216-class outrunner', kv:1250, rm:0.09, io:0.6, maxA:20, maxW:230, mass:60, cells:[2,3], note:'typical class values' },
  { id:'m2826', name:'2826-class outrunner', kv:1200, rm:0.07, io:1.0, maxA:25, maxW:300, mass:70, cells:[3,4], note:'typical class values' },
  { id:'m3536', name:'3536-class outrunner', kv:910, rm:0.045, io:1.2, maxA:35, maxW:500, mass:100, cells:[3,4], note:'typical class values' },
  { id:'m3542', name:'3542-class outrunner', kv:1000, rm:0.035, io:1.5, maxA:45, maxW:650, mass:130, cells:[3,4], note:'typical class values' },
];
const PROPS_EXT = [[4,2.5],[4.5,3],[5,3],[5,4],[6,3],[6,4],[7,3.5],[7,4],[8,3.8],[8,4],[8,6],[9,4.7],[9,6],[10,4.7],[10,5],[10,7],[11,4.7],[11,7],[12,6],[13,6.5]].map(([d, p]) => ({ d, p }));
function propCp(prop, cpRef = 0.04){ return cpRef * (prop.p / prop.d) / 0.475; }
function motorOperatingPoint(o){
  const m = o.motor, cells = o.cells, rho = o.rho || RHO_SL, thr = o.throttle != null ? o.throttle : 1;
  const Rb = cells * Math.max(0.004, 0.012 * 1000 / (o.capacity_mAh || 1000)), Re = 0.004, Voc = cells * 3.85;
  const Cp = propCp(o.prop, o.cpRef), D = o.prop.d * 0.0254;
  const vm = I => (Voc - I * Rb) * thr - I * Re, rpm = I => m.kv * (vm(I) - I * m.rm);
  const f = I => (I - m.io) * (vm(I) - I * m.rm) - Cp * rho * (rpm(I) / 60) ** 3 * D ** 5;
  let lo = m.io, hi = Voc * thr / (Rb * thr + Re + m.rm) * 0.999;
  if (!(hi > lo)) return null;
  for (let k = 0; k < 80; k++) { const mid = (lo + hi) / 2; if (f(mid) < 0) lo = mid; else hi = mid; }
  const I = (lo + hi) / 2, V = vm(I), R = rpm(I), Pin = V * I, Psh = (I - m.io) * (V - I * m.rm), Pb = (Voc - I * Rb) * I;
  const T = Math.pow((o.fm || 0.6) * Psh * Math.sqrt(2 * rho * Math.PI / 4 * D * D), 2 / 3);
  return { I, Vm:V, rpm:R, Pin, Pshaft:Psh, Pbatt:Pb, eta:Psh / Pin, thrust:T, pitchSpeed:Phys.pitchSpeed(R, o.prop.p),
    overA:I > m.maxA, overW:Pin > m.maxW, load:Math.max(I / m.maxA, Pin / m.maxW) };
}
function matchPowerSystems(o){
  const out = [], st = STYLES[o.style] || STYLES.trainer;
  for (const m of o.motors) for (const cells of o.cellsList) {
    if (m.cells && (cells < m.cells[0] || cells > m.cells[1])) continue;
    for (const prop of o.props) {
      if (o.maxPropD_in && prop.d > o.maxPropD_in) continue;
      const op = motorOperatingPoint({ motor:m, cells, capacity_mAh:o.capacity_mAh, prop, rho:o.rho });
      if (!op || op.overA || op.overW || op.Pin < 0.55 * o.targetPower) continue;
      const ratio = op.pitchSpeed / o.cruise; if (ratio < 1.25 || ratio > 2.6) continue;
      const tw = op.thrust / o.weightN;
      const massRef = Math.max(4, Phys.motorWeight(o.targetPower));
      const score = Math.abs(op.Pin - o.targetPower) / o.targetPower + Math.max(0, st.tw[0] - tw) * 2 + Math.max(0, 1.5 - ratio, ratio - 2.0) + (1 - op.eta) * 0.6
        + Math.max(0, op.load - 0.85) * 2 + Math.max(0, 0.4 - op.load) * 0.8 + Math.max(0, m.mass / massRef - 1.3) * 0.25; // penalise overheating, oversizing and dead weight
      out.push({ motor:m, cells, prop, op, tw, ratio, score });
    }
  }
  return out.sort((a, b) => a.score - b.score).slice(0, o.limit || 12);
}

/* =====================================================================
   G. PARTS / BILL OF MATERIALS: example prices (USD-ish), edit to your local shop
   ===================================================================== */
const PARTS_DB = {
  servo_micro:{ cat:'Servo', name:'Micro servo 4–5 g', g:4.5, price:5 }, servo_9g:{ cat:'Servo', name:'9 g micro servo', g:9, price:3.5 }, servo_17g:{ cat:'Servo', name:'17 g metal-gear servo', g:17, price:9 },
  rx_small:{ cat:'Receiver', name:'Small 6-ch receiver (e.g. FlySky AFHDS 2A)', g:4, price:12 }, rx_std:{ cat:'Receiver', name:'6-ch receiver (e.g. FlySky FS-iA6 class)', g:7, price:10 },
  prop:{ cat:'Prop', name:'Propeller (incl. 2 spares)', g:0, price:1.5 }, connector:{ cat:'Electrical', name:'XT30/XT60 connector pair + wire', g:0, price:2 },
  glue:{ cat:'Supplies', name:'Glue (hot glue / CA / foam-safe)', g:0, price:6 }, tape:{ cat:'Supplies', name:'Packing / hinge tape', g:0, price:4 },
  linkage:{ cat:'Hardware', name:'Pushrod + control horn set', g:0, price:1.2 }, velcro:{ cat:'Hardware', name:'Battery strap / velcro', g:0, price:2 },
  spar_cf:{ cat:'Material', name:'Carbon spar rod/strip 1 m', g:0, price:4 }, film:{ cat:'Material', name:'Covering film roll', g:0, price:12 },
  sheet_depron:{ cat:'Material', name:'Depron sheet 1000×500 mm', g:0, price:6 }, sheet_foamboard:{ cat:'Material', name:'Foam board 20×30 in', g:0, price:1.5 }, sheet_balsa:{ cat:'Material', name:'Balsa sheet 100×915 mm', g:0, price:3 },
  strip_balsa:{ cat:'Material', name:'Balsa/spruce strip 1 m (LE/TE/spar)', g:0, price:1 },
};
const priceMotor = W => 8 + 0.06 * W, priceEsc = A => 4 + 0.55 * A, priceLipo = (cells, mah) => 3 + 0.0042 * cells * mah;
/** buildBOM: rows for the shopping list. `power` = chosen match or null; `sheets` = {count, material} from templates. */
function buildBOM(sz, power, sheets, overrides = {}){
  const P = id => Object.assign({ id }, PARTS_DB[id], overrides[id] || {}), rows = [];
  const servoId = sz.auw < 0.25 ? 'servo_micro' : sz.auw < 1 ? 'servo_9g' : 'servo_17g', nServo = (CONTROLS[sz.controls] || CONTROLS.re).servos + (sz.extraServos || 0);
  const mot = power ? power.motor : null;
  rows.push(Object.assign({ id:'motor', cat:'Motor', name:mot ? `${mot.name} ${mot.kv} KV` : `Outrunner ≥ ${fmt(1.5 * sz.P, 0)} W (~${fmt(Phys.motorWeight(sz.P), 0)} g)`, qty:1, g:mot ? mot.mass : Phys.motorWeight(sz.P), price:priceMotor(mot ? mot.maxW : 1.5 * sz.P) }, overrides.motor || {}));
  const escA = power ? (ESC_SIZES.find(a => a >= Math.ceil(1.3 * power.op.I)) || sz.escA) : sz.escA;
  rows.push(Object.assign({ id:'esc', cat:'ESC', name:`${escA} A ESC${(power ? power.cells : sz.cells) >= 4 ? ' with switching BEC' : ' with BEC'}`, qty:1, g:2 + 0.7 * escA, price:priceEsc(escA) }, overrides.esc || {}));
  const cells = power ? power.cells : sz.cells;
  rows.push(Object.assign({ id:'battery', cat:'Battery', name:`${cells}S ${sz.capacity_mAh} mAh LiPo, ≥ ${sz.recC}C`, qty:1, g:cells * V_NOMINAL * sz.capacity_mAh / 1000 / SIZING.whPerGram + 2 * cells, price:priceLipo(cells, sz.capacity_mAh) }, overrides.battery || {}));
  rows.push(Object.assign(P(servoId), { qty:nServo }));
  rows.push(Object.assign(P(sz.auw < 0.25 ? 'rx_small' : 'rx_std'), { qty:1 }));
  rows.push(Object.assign(P('prop'), { qty:3, name:`Propeller ${power ? power.prop.d + '×' + power.prop.p : 'per shortlist'} (incl. 2 spares)` }));
  rows.push(Object.assign(P('connector'), { qty:1 }), Object.assign(P('linkage'), { qty:nServo }), Object.assign(P('velcro'), { qty:1 }), Object.assign(P('glue'), { qty:1 }), Object.assign(P('tape'), { qty:1 }));
  const matId = { depron:'sheet_depron', foamboard:'sheet_foamboard', balsa:'sheet_balsa' }[sz.material] || 'sheet_depron';
  rows.push(Object.assign(P(matId), { qty:Math.max(1, sheets && sheets.count || 1) }));
  rows.push(Object.assign(P('spar_cf'), { qty:Math.max(1, Math.ceil(sz.b / 1.0)) }));
  if (sz.material === 'balsa') rows.push(Object.assign(P('strip_balsa'), { qty:Math.ceil(sz.b * 3) }), Object.assign(P('film'), { qty:1 }));
  rows.forEach(r => { r.total = r.qty * r.price; });
  return { rows, cost:rows.reduce((s, r) => s + r.total, 0), electronicsWeight:rows.reduce((s, r) => s + (r.g || 0) * r.qty, 0) };
}

/* =====================================================================
   G2. AS-BUILT: apply measured weight and CG (design.measured = { use, auw_kg, cg_m behind root LE })
   ===================================================================== */
function asBuilt(design){
  const m = design && design.measured;
  if (!m || !m.use) return design;
  const d = JSON.parse(JSON.stringify(design));
  if (m.auw_kg > 0) d.auw = m.auw_kg;
  if (typeof m.cg_m === 'number' && isFinite(m.cg_m)) { const g = airframeGeometry(d.geom, 0.2); d.geom.cg = (g.xwLE + m.cg_m - g.xMacLE) / g.mac * 100; }
  d.asBuilt = true; return d;
}
/** CG position (m behind the wing root leading edge) for a %MAC value, and back. */
function cgToRootLE(geom, pct){ const g = airframeGeometry(geom, 0.2); return g.xMacLE - g.xwLE + pct / 100 * g.mac; }

/* =====================================================================
   H. designAircraft(constraints): the full pipeline (was a TODO stub in v1)
   ===================================================================== */
/**
 * @param {{mission:string, preset?:string, payload_g:number, targetStall_ms:number, targetSpan_m:number|null,
 *          budget?:number, material?:string, airfoil?:string, flightMin?:number, maxAuw_g?:number}} c
 * @returns {{airfoil:string, wingArea_m2:number, aspectRatio:number, motor:object|null, prop:{d:number,p:number}|null,
 *   battery:{cells:number, capacity_mAh:number, c:number}, cgRange_pctMAC:[number,number], parts:object[], cost:number,
 *   withinBudget:boolean|null, sizing:object, stability:object}}
 */
function designAircraft(c){
  const af = Airfoil.get(c.airfoil || 'clarky');
  const sz = sizeAircraft({ mission:c.mission || 'trainer', preset:c.preset, payload_kg:(c.payload_g || 0) / 1000, stall_ms:c.targetStall_ms, span_m:c.targetSpan_m,
    flightMin:c.flightMin || 8, cells:'auto', material:c.material || 'depron', clmax:af.clmax, maxAuw_kg:c.maxAuw_g ? c.maxAuw_g / 1000 : null });
  const g = airframeGeometry(sz.geom, 0.2);
  const stab = stabilityAnalysis(sz.geom, g, { cm0:af.cm0 });
  const match = matchPowerSystems({ motors:MOTOR_DB, cellsList:[sz.cells], props:PROPS_EXT, capacity_mAh:sz.capacity_mAh, targetPower:sz.P, cruise:sz.vc, weightN:sz.auw * G, style:sz.style, rho:sz.rho })[0] || null;
  const bom = buildBOM(sz, match, { count:1 });
  return { airfoil:af.name, wingArea_m2:sz.S, aspectRatio:sz.AR, motor:match ? match.motor : null, prop:match ? match.prop : null,
    battery:{ cells:sz.cells, capacity_mAh:sz.capacity_mAh, c:sz.recC }, cgRange_pctMAC:[stab.cgFwd * 100, stab.cgAft * 100],
    parts:bom.rows, cost:bom.cost, withinBudget:c.budget > 0 ? bom.cost <= c.budget : null, sizing:sz, stability:stab };
}

if (typeof module !== 'undefined') module.exports = { Airfoil, MATERIALS, MISSIONS, SIZING, COMMON_MAH, sizeAircraft, airframeMass, batteryFor, cellsForPower, liftSlope, stabilityAnalysis, multiPanelWing, solveLinear, liftingLine, flightPerformance, MOTOR_DB, PROPS_EXT, propCp, motorOperatingPoint, matchPowerSystems, PARTS_DB, buildBOM, asBuilt, cgToRootLE, designAircraft };
