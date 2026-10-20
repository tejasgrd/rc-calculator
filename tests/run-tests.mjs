// Node test runner for the pure RC Calc modules: `node tests/run-tests.mjs`
// Loads the classic browser scripts into one shared VM context (same as the browser), then asserts.
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const ctx = vm.createContext({ console, Math, JSON, Intl, TextEncoder, TextDecoder, Date, btoa, atob });
for (const f of ['rc-core.js', 'rc-diagram.js', 'rc-aero.js', 'rc-templates.js', 'rc-3d.js', 'rc-sim-model.js', 'rc-sim-physics.js', 'rc-sim-input.js', 'rc-sim-calib.js', 'rc-sim-lessons.js', 'rc-sim-import.js']) {
  const p = join(root, f); if (existsSync(p)) vm.runInContext(readFileSync(p, 'utf8'), ctx, { filename:f });
}
const run = code => vm.runInContext(code, ctx);
let pass = 0, fail = 0;
const near = (a, b, tol) => Math.abs(a - b) <= tol;
function t(name, cond, info = ''){ if (cond) pass++; else { fail++; console.log('FAIL', name, info); } }

// --- calculator worked example (spec) ---
const R = run(`computeAll({ auw_kg:0.2, area_m2:0.1, span_m:1, style:'trainer', wPerKg:null, cells:2, cap_Ah:0.85, cRating:null, kv:1400, propD:8, propP:3.8, clmax:1, rho:1.225, vCell:3.5, rpmFactor:0.8, cp:0.04, fm:0.5, usable:0.8, cruiseFactor:1.4, throttle:1, controls:'re', flaps:false })`);
t('wing loading 20', near(R.wl, 20, 1e-9)); t('stall 5.66', near(R.vs, 5.66, 0.01)); t('power 30', near(R.P, 30, 1e-9));
t('current 4.29', near(R.I, 4.286, 0.002)); t('req C 5.04', near(R.reqC, 5.04, 0.01)); t('time 9.5', near(R.tFull, 9.52, 0.02));
t('rpm 8288', near(R.rpm, 8288, 0.1)); t('pitch speed 13.3', near(R.pitchSpeed, 13.33, 0.01));

// --- airfoils ---
if (run('typeof Airfoil') !== 'undefined') {
  const a2412 = run(`Airfoil.get('naca2412')`);
  t('NACA 2412 thickness 12%', near(a2412.t, 0.12, 0.003), a2412.t);
  t('NACA 2412 alpha0 ≈ -2.1°', near(a2412.alpha0Deg, -2.08, 0.15), a2412.alpha0Deg);
  t('NACA 2412 cm0 ≈ -0.053', near(a2412.cm0, -0.053, 0.006), a2412.cm0);
  const sym = run(`Airfoil.get('naca0012')`); t('NACA 0012 alpha0 = 0', near(sym.alpha0Deg, 0, 1e-6) && near(sym.cm0, 0, 1e-6));
  const rf = run(`Airfoil.get('reflex')`); t('reflexed foil has Cm0 ≥ 0', rf.cm0 >= 0, rf.cm0);
  for (const p of run(`Airfoil.PRESETS.map(p=>p.id)`)) { const a = run(`Airfoil.get('${p}')`); t(`airfoil ${p} valid`, a.points.length > 40 && a.t > 0.02 && a.t < 0.2 && isFinite(a.cm0), JSON.stringify([a.t, a.cm0])); }
  const dat = 'TEST FOIL\n1.0 0.0\n0.5 0.06\n0.25 0.07\n0.1 0.05\n0.0 0.0\n0.1 -0.02\n0.25 -0.02\n0.5 -0.015\n0.75 -0.008\n1.0 0.0\n0.75 0.03';
  const parsed = run(`Airfoil.parseDat(${JSON.stringify(dat)})`); t('parse .dat name + points', parsed.name === 'TEST FOIL' && parsed.points.length === 11);
  let threw = false; try { run(`Airfoil.parseDat('hello')`); } catch (e) { threw = true; } t('parse .dat rejects junk', threw);

  // --- sizing ---
  const sz = run(`sizeAircraft({ mission:'trainer', payload_kg:0, stall_ms:6.5, span_m:null, flightMin:8, cells:'auto', material:'depron', clmax:1.25 })`);
  const sz1 = run(`sizeAircraft({ mission:'trainer', payload_kg:0, stall_ms:6.5, span_m:1.0, flightMin:8, cells:'auto', material:'depron', clmax:1.25 })`);
  t('sizer converges', sz.converged, sz.iterations);
  t('sizer stall equation holds', near(Math.sqrt(2 * sz.auw * 9.81 / (1.225 * sz.S * sz.clw)), 6.5, 1e-3));
  t('sizer span honoured', near(sz1.b, 1.0, 1e-9));
  t('sizer auto AR = mission AR', near(sz.AR, 6.5, 1e-6), sz.AR);
  t('sizer breakdown sums to AUW', near(sz.breakdown.reduce((s, b) => s + b.g, 0), sz.auw * 1000, 1.0), [sz.breakdown.reduce((s, b) => s + b.g, 0), sz.auw * 1000]);
  t('sizer: span given → stall ≤ target', sz1.vs <= 6.5 + 1e-6, sz1.vs);
  t('sizer: 1 m trainer AUW plausible (120–600 g)', sz1.auw > 0.12 && sz1.auw < 0.6, sz1.auw);
  t('sizer: span given → AR ≤ mission AR', sz1.AR <= 6.5 + 1e-9, sz1.AR);
  const lim = run(`sizeAircraft({ mission:'trainer', payload_kg:0, stall_ms:6, span_m:0.9, flightMin:12, cells:'auto', material:'depron', clmax:1.25, maxAuw_kg:0.249 })`);
  t('250 g limit honoured or reported', lim.auw <= 0.249 || lim.warnings.some(w => /Cannot reach/.test(w.text)), lim.auw);
  const heavy = run(`sizeAircraft({ mission:'glider', stall_ms:1.5, span_m:null, flightMin:8, cells:'auto', material:'foamboard', clmax:1.0 })`);
  t('infeasible sizing is reported', !heavy.converged ? heavy.warnings.some(w => /did not converge/.test(w.text)) : true);

  // --- stability ---
  const d = run(`autoProportion('trainer', 1, 'trainer', 1/6)`); const g = run(`airframeGeometry(autoProportion('trainer', 1, 'trainer', 1/6), 0.2)`);
  const st = run(`stabilityAnalysis(autoProportion('trainer', 1, 'trainer', 1/6), airframeGeometry(autoProportion('trainer', 1, 'trainer', 1/6), 0.2), {})`);
  t('NP aft of quarter chord with tail', st.xnp > 0.35 && st.xnp < 0.55, st.xnp);
  t('recommended CG = NP - 10%', near(st.cgRec, st.xnp - 0.1, 1e-12));
  t('Helmbold AR→∞ tends to 2π', near(run('liftSlope(1e6)'), 2 * Math.PI, 1e-3));
  const mp = run(`multiPanelWing(0.2, [{span:0.5, chord:0.2, sweep:0}], 0.1, true)`);
  t('rect multi-panel MAC = chord', near(mp.mac, 0.2, 1e-9) && near(mp.S, 0.2, 1e-9) && near(mp.np, 0.05, 1e-9));
  const tp = run(`multiPanelWing(0.3, [{span:0.5, chord:0.15, sweep:0}], 0.1, true)`);
  t('tapered multi-panel MAC formula', near(tp.mac, run('Phys.mac(0.3,0.15)'), 1e-4), [tp.mac]);

  // --- lifting line ---
  const ll = run(`liftingLine({ b:1, cr:0.1, ct:0.1, CL:0.5, alpha0Deg:0, a0:2*Math.PI, clmax2D:1.2 })`);
  t('LLT rectangular AR10 e in 0.90–0.96 (Glauert δ≈0.05–0.1)', ll.e > 0.9 && ll.e < 0.96, ll.e);
  t('LLT CL hits target', near(ll.CL, 0.5, 1e-9));
  t('LLT lift slope below 2D', ll.CLalpha < 2 * Math.PI && ll.CLalpha > 4.5, ll.CLalpha);
  const lle = run(`liftingLine({ b:1, cr:0.15, ct:0.15*0.4, CL:0.5, a0:2*Math.PI })`);
  t('LLT taper 0.4 near-elliptic e > 0.98', lle.e > 0.98, lle.e);
  const ws = run(`liftingLine({ b:1, cr:0.15, ct:0.06, CL:0.5, a0:2*Math.PI, clmax2D:1.2, washoutDeg:4 })`);
  const nw = run(`liftingLine({ b:1, cr:0.15, ct:0.06, CL:0.5, a0:2*Math.PI, clmax2D:1.2, washoutDeg:0 })`);
  t('washout moves stall inboard', ws.stallStation < nw.stallStation, [ws.stallStation, nw.stallStation]);

  // --- performance ---
  const pf = run(`flightPerformance({ W:0.3*9.81, S:0.16, AR:6.25, mac:0.16, rho:1.225, e:0.85, cd0Airfoil:0.013, Sh:0.035, Sv:0.015, frontalArea:0.004, body:'fuse', CLmax:1.1, T0:3, pitchSpeed:16, Vcruise:8.5, batteryWh:7 })`);
  t('perf L/D plausible 5–15', pf.LDmax > 5 && pf.LDmax < 15, pf.LDmax);
  t('perf vmax between stall and pitch speed', pf.vmax > pf.vs && pf.vmax < 16 * 1.15, [pf.vs, pf.vmax]);
  t('perf min-power speed < L/D-max speed', pf.vMinPower <= pf.vLD);
  t('perf climb positive', pf.rocMax > 0.5, pf.rocMax);

  // --- motors ---
  const op = run(`motorOperatingPoint({ motor:MOTOR_DB.find(m=>m.id==='park300'), cells:2, capacity_mAh:850, prop:{d:8,p:3.8} })`);
  t('motor op converges (power balance)', near(op.Pshaft, 0.04 * 1.225 * (op.rpm / 60) ** 3 * (8 * 0.0254) ** 5, 0.05), op);
  t('motor op plausible current 4–10 A', op.I > 4 && op.I < 10, op.I);
  t('motor efficiency 50–90%', op.eta > 0.5 && op.eta < 0.9, op.eta);
  const mm = run(`matchPowerSystems({ motors:MOTOR_DB, cellsList:[3], props:PROPS_EXT, capacity_mAh:1300, targetPower:120, cruise:10, weightN:0.6*9.81, style:'sport' })`);
  t('matching returns ranked, in-limit results', mm.length > 0 && mm.every(r => !r.op.overA && !r.op.overW) && mm.every((r, i) => i === 0 || r.score >= mm[i - 1].score), mm.length);

  // --- designAircraft (formerly TODO) ---
  const da = run(`designAircraft({ mission:'trainer', payload_g:0, targetStall_ms:6.5, targetSpan_m:1, budget:150 })`);
  t('designAircraft returns planned shape', da.wingArea_m2 > 0 && da.battery.capacity_mAh > 0 && da.cgRange_pctMAC[0] < da.cgRange_pctMAC[1] && Array.isArray(da.parts) && da.cost > 0, Object.keys(da));
}

// --- templates ---
if (run('typeof Templates') !== 'undefined') {
  for (const method of ['foam', 'balsa']) for (const style of ['kfm', 'folded']) for (const preset of ['trainer', 'flyingwing', 'chuck', 'lowwing']) {
    const res = run(`(() => { const d = autoProportion('${preset}', 1, 'trainer', 1/6); d.washout = 0; const parts = Templates.generateParts(d, Airfoil.get('clarky'), { method:'${method}', foamStyle:'${style}', ribSpacing:0.05, spar:{w:3,h:6}, le:5, te:10, sheetT:6, unit:'mm' }); const lay = Templates.layout(parts, Templates.PAPERS.a5); const pages = Templates.paginate(lay, Templates.PAPERS.a5); return { n:parts.length, names:parts.map(p=>p.name), pages:pages.length, w:lay.width, h:lay.height, bad:parts.filter(p=>!(p.w>0&&p.h>0&&p.w<5000&&p.h<5000)).length }; })()`);
    t(`templates ${method}/${style}/${preset}`, res.n >= 4 && res.pages >= 1 && res.bad === 0, JSON.stringify(res));
  }
  const ribs = run(`Templates.generateParts(autoProportion('trainer', 1, 'trainer', 1/6), Airfoil.get('clarky'), { method:'balsa', ribSpacing:0.05, spar:{w:3,h:6}, le:5, te:10, sheetT:2, unit:'mm' }).filter(p=>/^Rib/.test(p.name))`);
  t('balsa rib count ≈ semispan / spacing + 1', ribs.length === 11, ribs.length);
  const pa = run(`Templates.PAPERS`); t('paper sizes A5 / Letter / A4', near(pa.a5.w, 148, 0) && near(pa.letter.w, 215.9, 0.01) && near(pa.a4.h, 297, 0));
}

// --- 3D ---
if (run('typeof Mesh3D') !== 'undefined') {
  const m = run(`Mesh3D.build(autoProportion('trainer', 1, 'trainer', 1/6), { airfoil:Airfoil.get('clarky'), propD:0.2 })`);
  t('3D mesh has triangles', m.tris.length > 300, m.tris.length);
  t('3D mesh finite', m.tris.every(tr => tr.p.every(v => v.every(Number.isFinite))));
  const stl = run(`Mesh3D.toSTL(Mesh3D.build(autoProportion('trainer', 1, 'trainer', 1/6), { airfoil:Airfoil.get('clarky'), propD:0.2 }), 'x')`);
  t('STL export well formed', stl.startsWith('solid x') && stl.trim().endsWith('endsolid x') && (stl.match(/facet normal/g) || []).length === m.tris.filter(tr => tr.solid !== false).length);
  const mw = run(`Mesh3D.build(autoProportion('flyingwing', 1, 'sport', 0.2), { airfoil:Airfoil.get('reflex'), propD:0.15 })`);
  t('3D flying wing mesh', mw.tris.length > 200);
  const mc = run(`Mesh3D.build(autoProportion('chuck', 1, 'glider', 0.11), { airfoil:Airfoil.get('naca6409'), propD:0.15 }).tris.length`);
  t('3D chuck-glider (stick fuselage) mesh', mc > 200, mc);
  const bp = run(`(() => { const r = Mesh3D.buildParts(autoProportion('trainer', 1, 'trainer', 1/6), { airfoil:Airfoil.get('clarky'), propD:0.2, surf:'ailerons' }); return r.parts.map(p => ({ n:p.name, k:p.tris.length, h:!!p.hinge, ok:p.tris.every(t => t.p.every(v => v.every(Number.isFinite))) })); })()`);
  const names = bp.map(p => p.n);
  t('3D parts: body, ailerons L/R, elevator, rudder, prop', ['body', 'aileron_R', 'aileron_L', 'elevator', 'rudder', 'prop'].every(n => names.includes(n)) && bp.every(p => p.ok && p.k > 0), JSON.stringify(bp));
  const bw = run(`Mesh3D.buildParts(autoProportion('flyingwing', 1, 'sport', 0.2), { airfoil:Airfoil.get('reflex'), propD:0.15 }).parts.map(p => p.name)`);
  t('3D parts: flying wing has elevons, no elevator', bw.includes('elevon_L') && bw.includes('elevon_R') && !bw.includes('elevator'), bw);
}

// --- simulator ---
if (run('typeof SimPhysics') !== 'undefined') {
  const keys = run('Object.keys(SimModel.BUILTINS)');
  for (const k of keys) {
    const r = run(`(() => { const d = SimModel.builtinDesign('${k}'), m = SimModel.build(d), sim = new SimPhysics.Sim(m, { start:'air' }); sim.reset('air', { alt:80 });
      const c = { ail:0, ele:0, rud:0, thr:m.trim.throttle, flap:0 }; let bad = false; for (let i = 0; i < 60 * 10; i++) { sim.step(1 / 60, c); if (!isFinite(sim.s.p[2])) bad = true; }
      const t = sim.telemetry(); return { trim:m.trim, mass:m.mass, alt:t.alt, V:t.V, bad, crashed:!!t.crashed, ballast:m.ballast_g }; })()`);
    t(`sim ${k}: trims level flight`, r.trim.converged && r.trim.feasible, JSON.stringify(r.trim));
    t(`sim ${k}: 10 s hands-off stays finite and airborne`, !r.bad && !r.crashed && r.alt > 40, JSON.stringify(r));
  }
  const cmp = run(`(() => { const d = SimModel.builtinDesign('trainer'), m = SimModel.build(d), pr = SimModel.predictions(d, m), o = {};
    for (const id of ['cruise', 'stall', 'glide', 'topspeed', 'climb', 'stability', 'roll']) o[id] = SimPhysics.runTest(m, id, pr); return o; })()`);
  t('sim vs Designer: cruise power within 15%', cmp.cruise.match === 'ok', JSON.stringify(cmp.cruise));
  t('sim vs Designer: stall speed within 25%', Math.abs(cmp.stall.diff) < 0.25, JSON.stringify(cmp.stall));
  t('sim vs Designer: glide ratio within 15%', cmp.glide.match === 'ok', JSON.stringify(cmp.glide));
  t('sim vs Designer: top speed within 25%', Math.abs(cmp.topspeed.diff) < 0.25, JSON.stringify(cmp.topspeed));
  t('sim vs Designer: climb rate within 30%', Math.abs(cmp.climb.diff) < 0.3, JSON.stringify(cmp.climb));
  t('sim vs Designer: static margin within 6% MAC', Math.abs(cmp.stability.measured - cmp.stability.pred) < 6, JSON.stringify(cmp.stability));
  t('sim: roll rate plausible for a trainer (30–150 °/s)', cmp.roll.measured > 30 && cmp.roll.measured < 150, cmp.roll.measured);
  const smTrack = run(`(() => { const d = SimModel.builtinDesign('sport'); return [-6, 0, 6].map(o => { const dd = JSON.parse(JSON.stringify(d)); dd.geom.cg += o; return SimPhysics.measureStaticMargin(SimModel.build(dd)).SM; }); })()`);
  t('sim: moving CG aft reduces static margin ~1:1', smTrack[0] > smTrack[1] && smTrack[1] > smTrack[2] && Math.abs((smTrack[0] - smTrack[2]) - 0.12) < 0.03, smTrack);
  const gnd = run(`(() => { const m = SimModel.build(SimModel.builtinDesign('trainer')), sim = new SimPhysics.Sim(m, { start:'runway' }); sim.reset('runway');
    for (let i = 0; i < 180; i++) sim.step(1 / 60, { ail:0, ele:0, rud:0, thr:0, flap:0 }); const rest = sim.telemetry();
    let lift = null; for (let i = 0; i < 900; i++) { const t = sim.telemetry(); sim.step(1 / 60, { ail:-0.02 * t.phi, ele:t.V > m.trim.vs * 1.25 ? 0.35 : 0, rud:0, thr:1, flap:0 }); if (lift == null && t.alt > 3) lift = t.t; }
    return { restV:rest.Vg, restCrash:!!rest.crashed, lift, alt:sim.telemetry().alt, crashed:!!sim.telemetry().crashed }; })()`);
  t('sim: rests still on the runway', gnd.restV < 0.05 && !gnd.restCrash, JSON.stringify(gnd));
  t('sim: takes off and climbs', gnd.lift != null && gnd.lift < 9 && gnd.alt > 15 && !gnd.crashed, JSON.stringify(gnd));
  const crash = run(`(() => { const m = SimModel.build(SimModel.builtinDesign('trainer')), sim = new SimPhysics.Sim(m); sim.reset('air', { alt:3 }); sim.s.q = SimPhysics.quat.fromEuler(0, -1.2, 0); sim.s.v = [4, 0, 12];
    for (let i = 0; i < 240; i++) sim.step(1 / 60, { ail:0, ele:0, rud:0, thr:1, flap:0 }); return sim.telemetry().crashed; })()`);
  t('sim: a vertical dive into the ground is detected as a crash', !!crash, crash);
  const therm = run(`(() => { const e = new SimPhysics.Environment({ thermals:true, seed:7 }); e.update(0.01, { V:8 }); const th = e.thermalList[0]; return { n:e.thermalList.length, w:e.at([th.x, th.y, -60])[2] }; })()`);
  t('environment: thermals give lift in the core', therm.n >= 1 && therm.w < -0.5, JSON.stringify(therm));
  const gust = run(`(() => { const e = new SimPhysics.Environment({ speed:4, dir:270, gust:1, seed:3 }); let mx = 0; for (let i = 0; i < 2400; i++) { e.update(1 / 240, { V:8 }); mx = Math.max(mx, Math.abs(e.g[0])); } const w = e.meanWind(10); return { mx, w }; })()`);
  t('environment: west wind blows east, gusts present', gust.w[1] > 2.5 && Math.abs(gust.w[0]) < 2.5 && gust.mx > 0.2, JSON.stringify(gust));
  const rec = run(`(() => { const m = SimModel.build(SimModel.builtinDesign('trainer')), sim = new SimPhysics.Sim(m), r = new SimPhysics.Recorder(); for (let i = 0; i < 240 * 3; i++) { sim.substep(1 / 240); r.push(sim); } const csv = r.csv(); return { rows:r.rows.length, lines:csv.split('\\n').length, mid:!!r.sample(1.5) }; })()`);
  t('recorder: ~30 Hz samples, CSV and interpolation', rec.rows >= 85 && rec.rows <= 95 && rec.lines === rec.rows + 1 && rec.mid, JSON.stringify(rec));
  // mapping wizard: simulate an FS-i6 USB dongle with a scrambled channel order
  const wiz = run(`(() => { const w = new SimInput.MappingWizard('FS-i6 dongle'); const ax = [0, 0, -1, 0, 0, 0];
    const feed = a => w.feed(a, [{ pressed:false }, { pressed:false }]);
    feed([0, 0, -1, 0, 0, 0]); w.next();                                  // centre, throttle low on axis 2
    for (const v of [-1, -0.2, 0.6, 1]) feed([0, 0, v, 0, 0, 0]); w.next(); // throttle up on axis 2
    for (const v of [-1, 1, 0.98]) feed([v, 0, 1, 0, 0, 0]); w.next();      // aileron axis 0 right = +
    for (const v of [1, -1, -0.97]) feed([0, v, 1, 0, 0, 0]); w.next();     // elevator axis 1, back = negative → invert
    for (const v of [-1, 1, 1]) feed([0, 0, 1, v, 0, 0]); w.next();         // rudder axis 3
    w.next(true); w.next(true); w.next(true); const p = w.profile('FS-i6');
    const read = a => ({ ail:SimInput.readChannel(p.map.ail, a, []), ele:SimInput.readChannel(p.map.ele, a, []), rud:SimInput.readChannel(p.map.rud, a, []), thr:SimInput.readChannel(p.map.thr, a, []) });
    return { done:w.done, map:p.map, r1:read([1, -1, 1, 1, 0, 0]), r0:read([0, 0, -1, 0, 0, 0]) }; })()`);
  t('wizard: maps a scrambled transmitter correctly', wiz.done && wiz.map.thr.index === 2 && wiz.map.ail.index === 0 && wiz.map.ele.index === 1 && wiz.map.rud.index === 3 && wiz.map.ele.invert === true, JSON.stringify(wiz.map));
  t('wizard: read-back gives full deflection and throttle range', Math.abs(wiz.r1.ail - 1) < 1e-9 && Math.abs(wiz.r1.ele - 1) < 1e-9 && Math.abs(wiz.r1.thr - 1) < 1e-9 && Math.abs(wiz.r0.thr) < 1e-9 && Math.abs(wiz.r0.ail) < 1e-9, JSON.stringify([wiz.r1, wiz.r0]));
  const xb = run(`(() => { const prof = SimInput.standardProfile('Xbox'), st = { thr:0 }, bt = Array.from({ length:17 }, () => ({ pressed:false, value:0 })); bt[7] = { pressed:true, value:0.75 }; bt[0] = { pressed:true, value:1 };
    const r = SimInput.readStandard({ axes:[0.5, 0, -1, 1], buttons:bt }, prof, st, 0.016); const p1 = Object.assign({}, prof, { mode:1, thrMode:'stick-direct' }); const r1 = SimInput.readStandard({ axes:[0, 0.4, 0, -1], buttons:bt }, p1, { thr:0 }, 0.016); return { r, r1 }; })()`);
  t('Xbox mode 2: right stick ail/ele, left X rudder, RT throttle, A = reset', xb.r.ail === -1 && xb.r.ele === 1 && xb.r.rud === 0.5 && xb.r.thr === 0.75 && xb.r.btn.reset === true, JSON.stringify(xb.r));
  t('Xbox mode 1: left Y elevator, right Y throttle (direct)', xb.r1.ele === 0.4 && Math.abs(xb.r1.thr - 1) < 1e-9, JSON.stringify(xb.r1));
  t('input: expo keeps the end points and softens the centre', Math.abs(run('SimInput.shape(1, 0.4, 1, 0)') - 1) < 1e-9 && run('SimInput.shape(0.5, 0.4, 1, 0)') < 0.5);
}

// --- weather, air density, control surfaces, as-built (v4) ---
if (run('typeof SimPhysics') !== 'undefined' && run('typeof surfaceSpec') !== 'undefined') {
  const rho0 = run('SimPhysics.airDensity(15, 0, 1013.25, 0)'), rhoHot = run('SimPhysics.airDensity(30, 1500, 1013.25, 0)');
  t('air: ISA sea level = 1.225 kg/m³', near(rho0, 1.225, 0.001), rho0);
  t('air: 1500 m field at 30 °C ≈ 0.97 kg/m³', near(rhoHot, 0.972, 0.01), rhoHot);
  t('air: density altitude of hot & high ≈ 2.35 km (rule of thumb: PA + 36.6 m/°C above ISA)', near(run(`SimPhysics.densityAltitude(${rhoHot})`), 1500 + 36.6 * (30 - (15 - 6.5 * 1.5)), 120), run(`SimPhysics.densityAltitude(${rhoHot})`));
  t('air: density falls with height above the field', run('SimPhysics.airDensity(15, 0, 1013.25, 300)') < rho0);
  const hh = run(`(() => { const d = SimModel.builtinDesign('trainer'), a = SimModel.build(d), b = SimModel.build(d, { rho:${rhoHot} });
    return { va:a.trim.V, vb:b.trim.V, ta:a.thrTable[20].T0, tb:b.thrTable[20].T0, sa:SimPhysics.runTest(a, 'stall', {}).measured, sb:SimPhysics.runTest(b, 'stall', {}).measured }; })()`);
  t('air: trim speed scales with √(ρ₀/ρ)', near(hh.vb / hh.va, Math.sqrt(1.225 / rhoHot), 0.03), JSON.stringify(hh));
  t('air: thin air gives less static thrust', hh.tb < hh.ta * 0.97, JSON.stringify(hh));
  t('air: thin air raises the flown stall speed', hh.sb > hh.sa * 1.05, JSON.stringify(hh));
  const wx = run(`(() => { const out = {}; for (const p of ['calm', 'gusty', 'stormy']) { const e = new SimPhysics.Environment({ preset:p, dir:270, seed:11 }); let mx = 0, mn = 99, dirs = [];
      for (let i = 0; i < 240 * 180; i++) { e.update(1 / 240, { V:8 }); if (i % 24 === 0) { const w = e.at([0, 0, -10]), sp = Math.hypot(w[0], w[1]); mx = Math.max(mx, sp); mn = Math.min(mn, sp); dirs.push(e.dirOff); } }
      out[p] = { mx, mn, maxDirOff:Math.max(...dirs.map(Math.abs)), mean:e.speed, gp:e.gustPeak }; } return out; })()`);
  t('weather: calm stays calm (< 2 m/s)', wx.calm.mx < 2, JSON.stringify(wx.calm));
  t('weather: gusty produces gusts well above the mean wind', wx.gusty.mx > wx.gusty.mean + 2.5 && wx.gusty.mx < wx.gusty.mean + wx.gusty.gp + 4, JSON.stringify(wx.gusty));
  t('weather: stormy is stronger than gusty', wx.stormy.mx > wx.gusty.mx, JSON.stringify(wx.stormy));
  t('weather: wind direction wanders but stays bounded', wx.gusty.maxDirOff > 3 && wx.gusty.maxDirOff <= 2.5 * 35 + 1e-9, wx.gusty.maxDirOff);
  t('weather: old gust slider still accepted', run(`new SimPhysics.Environment({ gust:0.5 }).gustPeak`) === 2);
  // control surfaces from the design
  const sp = run(`surfaceSpec({ surfaces:{ ailCf:0.9, ailStart:0.6, ailEnd:0.4, flaps:true, flapStart:0.1, flapEnd:0.8 } })`);
  t('surfaces: spec clamps chord and keeps ranges valid', sp.ailCf === 0.5 && sp.ailEnd > sp.ailStart && sp.flapEnd <= sp.ailStart, JSON.stringify(sp));
  const roll = run(`(() => { const d = SimModel.builtinDesign('trainer'), r = []; for (const cf of [0.15, 0.25, 0.4]) { const dd = JSON.parse(JSON.stringify(d)); dd.geom.surfaces = { ailCf:cf }; r.push(SimPhysics.runTest(SimModel.build(dd), 'roll', {}).measured); }
    const dd = JSON.parse(JSON.stringify(d)); dd.geom.surfaces = { ailStart:0.2, ailEnd:0.95 }; r.push(SimPhysics.runTest(SimModel.build(dd), 'roll', {}).measured); return r; })()`);
  t('surfaces: wider-chord ailerons roll faster', roll[0] < roll[1] && roll[1] < roll[2], roll);
  t('surfaces: longer ailerons roll faster', roll[3] > roll[1], roll);
  const thr = run(`(() => { const d = SimModel.builtinDesign('trainer'); d.geom.surfaces = { throwAil:28 }; return SimModel.build(d).throws.ail; })()`);
  t('surfaces: design throws are used by the simulator', thr === 28, thr);
  const fl = run(`(() => { const d = SimModel.builtinDesign('trainer'); d.geom.surfaces = { flaps:true }; const m = SimModel.build(d), n = m.strips.filter(s => s.flap).length;
    const f0 = SimPhysics.forces(m, { v:[7, 0, 0.3], w:[0, 0, 0] }, { ail:0, ele:0, rud:0, thr:0, flap:0 }, { windB:() => [0, 0, 0], soc:1, h:50 }).F[2];
    const f1 = SimPhysics.forces(m, { v:[7, 0, 0.3], w:[0, 0, 0] }, { ail:0, ele:0, rud:0, thr:0, flap:1 }, { windB:() => [0, 0, 0], soc:1, h:50 }).F[2];
    const parts = Mesh3D.buildParts(d.geom, { airfoil:m.af, surf:'ailerons' }).parts.map(p => p.name); return { n, f0, f1, hasFlaps:m.hasFlaps, parts }; })()`);
  t('flaps: flap strips exist and flaps add lift', fl.hasFlaps && fl.n > 0 && fl.f1 < fl.f0 - 0.05, JSON.stringify(fl));
  const fs = run(`(() => { const d = SimModel.builtinDesign('trainer'); d.geom.surfaces = { flaps:true }; const m = SimModel.build(d);
    const env = new SimPhysics.Environment({ rhoFixed:1.225 }), stallAt = flap => { const sim = new SimPhysics.Sim(m, { env }); sim.reset('air', { alt:60 }); const ap = new SimPhysics.Autopilot(sim); let minV = 99;
      for (let i = 0; i < 60 * 30; i++) { const t = sim.telemetry(); if (t.stall > 0.35) break; minV = Math.min(minV, t.V); const c = ap.fly({ alt:60, thr:0, phi:0 }, 1 / 60); c.flap = flap; sim.step(1 / 60, c); } return minV; };
    return { clean:stallAt(0), flaps:stallAt(1) }; })()`);
  t('flaps: lower the stall speed', fs.flaps < fs.clean * 0.97, JSON.stringify(fs));
  t('flaps: 3D model gets flap parts', fl.parts.includes('flap_L') && fl.parts.includes('flap_R'), fl.parts);
  const tp = run(`(() => { const d = autoProportion('trainer', 1, 'trainer', 1/6); d.surfaces = { eleCf:0.4 }; const p = Templates.generateParts(d, Airfoil.get('clarky'), { method:'foam', foamStyle:'kfm', sheetT:6, unit:'mm' }).find(q => /stabilizer/.test(q.name));
    const h = p.paths.find(q => q.kind === 'hinge'); return { y:h.pts[0][1] - p.paths[0].pts[0][1], hc:d.hChord * 1000 }; })()`);
  t('templates: elevator hinge follows the elevator chord %', near(tp.y / tp.hc, 0.6, 0.01), JSON.stringify(tp));
  // as-built
  const ab = run(`(() => { const d = SimModel.builtinDesign('sport'), g = airframeGeometry(d.geom, 0.2), target = 22, cgm = cgToRootLE(d.geom, target);
    d.measured = { use:true, auw_kg:d.auw * 1.2, cg_m:cgm }; const e = asBuilt(d), m = SimModel.build(e), off = asBuilt(Object.assign({}, d, { measured:{ use:false, cg_m:cgm } }));
    return { cg:e.geom.cg, mass:m.mass, want:d.auw * 1.2, cgSim:m.cgPctActual, flag:m.asBuilt, unchanged:off.geom.cg === d.geom.cg }; })()`);
  t('as-built: measured CG (mm) converts to % MAC', near(ab.cg, 22, 1e-6), ab.cg);
  t('as-built: simulator flies the measured weight and CG', near(ab.mass, ab.want, 1e-6) && near(ab.cgSim, 22, 0.3) && ab.flag, JSON.stringify(ab));
  t('as-built: ignored unless "use" is ticked', ab.unchanged);
}

// --- flight-log import & calibration (v5) ---
if (run('typeof SimCalib') !== 'undefined') {
  const fx = join(dirname(fileURLToPath(import.meta.url)), 'fixtures'), truth = JSON.parse(readFileSync(join(fx, 'truth.json'), 'utf8'));
  ctx.__fx = {}; for (const n of ['edgetx.csv', 'blackbox.csv', 'ardupilot.log', 'track.gpx', 'flight.igc']) ctx.__fx[n] = readFileSync(join(fx, n), 'utf8');
  const fmts = run(`Object.fromEntries(Object.keys(__fx).map(n => { const L = SimCalib.parse(n, __fx[n]); return [n, { fmt:L.meta.format, dur:L.meta.duration, maxAlt:Math.max(...L.rows.map(r => r.alt).filter(isFinite)), gps:L.meta.hasGPS, as:L.meta.hasAirspeed, att:L.meta.hasAttitude, cur:L.meta.hasCurrent, thr:L.meta.hasThrottle, gs:Math.max(...L.rows.map(r => r.gs).filter(isFinite)) }]; }))`);
  const want = { 'edgetx.csv':'edgetx', 'blackbox.csv':'blackbox', 'ardupilot.log':'ardupilot', 'track.gpx':'gpx', 'flight.igc':'igc' };
  for (const [n, r] of Object.entries(fmts)) {
    t(`log import: ${n} detected as ${want[n]}`, r.fmt === want[n], r.fmt);
    t(`log import: ${n} duration and altitude match the flight`, near(r.dur, truth.duration, 2) && near(r.maxAlt, truth.maxAlt, 2.5), JSON.stringify(r));
  }
  t('log import: EdgeTX units (kts, rad) converted', fmts['edgetx.csv'].as && fmts['edgetx.csv'].att && fmts['edgetx.csv'].cur && near(fmts['edgetx.csv'].gs, fmts['blackbox.csv'].gs, 0.3), JSON.stringify([fmts['edgetx.csv'].gs, fmts['blackbox.csv'].gs]));
  t('log import: GPX/IGC are position-only', fmts['track.gpx'].gps && !fmts['track.gpx'].thr && fmts['flight.igc'].gps && !fmts['flight.igc'].att);
  let bad = 0; try { run(`SimCalib.parse('x.txt', 'hello,world\\n1,2')`); } catch (e) { bad = 1; } t('log import: unknown formats are rejected with a message', bad === 1);
  // calibration on a synthetic flight with known factors
  const cal = run(`(() => { const d = SimModel.builtinDesign('trainer'), T = ${JSON.stringify(truth.factors)}, L = SimCalib.syntheticLog(d, T, { airspeed:true }), segs = SimCalib.analyze(L), r = SimCalib.fit(d, segs, { meta:L.meta, wind:L.wind });
    return { f:r.factors, before:r.before, after:r.after, kinds:[...new Set(segs.map(s => s.type))], conf:r.confidence.label }; })()`);
  for (const k of Object.keys(truth.factors)) t(`calibration: recovers ${k} within ±5 % (synthetic flight with airspeed)`, Math.abs(cal.f[k] / truth.factors[k] - 1) <= 0.05, `${cal.f[k]} vs ${truth.factors[k]}`);
  t('calibration: fit reduces the error', cal.after < cal.before * 0.5, JSON.stringify([cal.before, cal.after]));
  t('calibration: all segment kinds found', ['climb', 'cruise', 'glide', 'topspeed', 'roll', 'stall'].every(k => cal.kinds.includes(k)), cal.kinds);
  const gps = run(`(() => { const d = SimModel.builtinDesign('trainer'), L = SimCalib.syntheticLog(d, ${JSON.stringify(truth.factors)}, { airspeed:false }), segs = SimCalib.analyze(L), r = SimCalib.fit(d, segs, { meta:L.meta, wind:L.wind });
    return { wind:L.wind, cd0:r.factors.cd0, conf:r.confidence.label, reliable:r.reliable }; })()`);
  t('calibration (GPS only): wind estimated from turns', gps.wind && gps.wind.method === 'turns' && gps.wind.speed > 1 && gps.wind.speed < 3.5, JSON.stringify(gps.wind));
  t('calibration (GPS only): drag still within ±10 %', Math.abs(gps.cd0 / truth.factors.cd0 - 1) <= 0.1, gps.cd0);
  t('calibration (GPS only): confidence is not "high" and stall/roll are flagged unreliable', gps.conf !== 'high' && !gps.reliable.clmax && !gps.reliable.roll, JSON.stringify(gps));
  const fxfit = run(`(() => { const L = SimCalib.parse('edgetx.csv', __fx['edgetx.csv']), segs = SimCalib.analyze(L), r = SimCalib.fit(SimModel.builtinDesign('trainer'), segs, { meta:L.meta, wind:L.wind }); return { f:r.factors, n:segs.length }; })()`);
  t('calibration: EdgeTX fixture fit within ±8 % on drag, thrust, current', ['cd0', 'thrust', 'current'].every(k => Math.abs(fxfit.f[k] / truth.factors[k] - 1) <= 0.08), JSON.stringify(fxfit));
  const man = run(`(() => { const d = SimModel.builtinDesign('trainer'), m = SimModel.build(d), vs = SimCalib.stallSpeed(m), top = SimCalib.topSpeed(m);
    const r = SimCalib.fit(d, SimCalib.manualSegments({ stall_ms:vs * 1.1, top_ms:top * 0.9 }), {}); return { f:r.factors, conf:r.confidence.label }; })()`);
  t('calibration (manual entry): slower-than-predicted stall lowers max lift, slower top speed raises drag', man.f.clmax < 0.92 && man.f.cd0 > 1.05 && man.conf !== 'high', JSON.stringify(man));
  const rt = run(`(() => { const L = SimCalib.syntheticLog(SimModel.builtinDesign('trainer'), {}, { airspeed:true }), csv = SimCalib.toCSV(L), back = SimCalib.parse('log.csv', csv); return [L.rows.length, back.rows.length, back.meta.format]; })()`);
  t('calibration: normalised CSV round-trips', near(rt[0], rt[1], 2) && rt[2] === 'normalized', rt);
  const app = run(`(() => { const d = SimModel.builtinDesign('trainer'); d.calibration = { factors:{ cd0:1.3, thrust:0.85 } }; const a = SimModel.build(d), b = SimModel.build(d, { calibrated:false }); return [a.trim.throttle, b.trim.throttle, a.calibrated, b.calibrated]; })()`);
  t('calibration: applied factors change the flight model (more throttle to cruise)', app[0] > app[1] * 1.05 && app[2] && !app[3], app);
}

// --- instructor, lessons, failures (v5) ---
if (run('typeof SimLessons') !== 'undefined') {
  const ids = run('SimLessons.DEFS.map(d => d.id)');
  const runs = run(`(() => { const cache = {}, get = k => cache[k] || (cache[k] = SimModel.build(SimModel.builtinDesign(k))), out = {};
    for (const d of SimLessons.DEFS) { const key = d.id === 'thermal' ? 'glider' : (d.model || 'builtin:trainer').split(':')[1], r = SimLessons.runDemo(get(key), d.id); out[d.id] = { done:r.status.done, failed:r.status.failed, score:r.result.score, stars:r.result.stars, tips:r.result.tips.length }; } return out; })()`);
  for (const id of ids) t(`lesson "${id}": the demo pilot completes it with a score`, runs[id].done && runs[id].score >= 40 && runs[id].tips > 0, JSON.stringify(runs[id]));
  const sloppy = run(`(() => { const m = SimModel.build(SimModel.builtinDesign('trainer')); return [SimLessons.runDemo(m, 'circuit').result.score, SimLessons.runDemo(m, 'circuit', { noise:0.6 }).result.score]; })()`);
  t('scoring: busy, noisy stick work scores lower than smooth flying', sloppy[1] < sloppy[0], sloppy);
  t('scoring: gates are judged at the closest approach (accurate demo flying scores ≥ 85 on gate lessons)', ['level', 'orient', 'circuit', 'fig8'].every(id => runs[id].score >= 85), ['level', 'orient', 'circuit', 'fig8'].map(id => runs[id].score));
  const ins = run(`(() => { const m = SimModel.build(SimModel.builtinDesign('trainer')), out = {};
    for (const mode of ['auto', 'off']) { const sim = new SimPhysics.Sim(m, { env:new SimPhysics.Environment({ speed:0 }) }); sim.reset('air', { alt:22 }); sim.s.q = SimPhysics.quat.fromEuler(90 * Math.PI / 180, -45 * Math.PI / 180, 0); sim.s.v = [7, 0, 5];
      const I = new SimLessons.Instructor(sim, { mode }); let minAlt = 99, who = new Set(), back = false;
      for (let k = 0; k < 60 * 25; k++) { const tl = sim.telemetry(); const hostile = k < 60 * 3 ? { ail:1, ele:-0.5, rud:0, thr:0.5, flap:0 } : { ail:0, ele:0, rud:0, thr:0.5, flap:0 };
        const r = I.update(hostile, false, 1 / 60); who.add(r.who); sim.step(1 / 60, r.ctrl); minAlt = Math.min(minAlt, sim.telemetry().alt); if (who.has('instructor') && r.who === 'student') back = true; }
      const tl = sim.telemetry(); out[mode] = { crashed:!!tl.crashed, minAlt, phi:tl.phi, who:[...who], back }; }
    return out; })()`);
  t('instructor (auto): recovers from 90° bank / 45° dive at 22 m without hitting the ground', !ins.auto.crashed && ins.auto.minAlt > 1 && Math.abs(ins.auto.phi) < 30 && ins.auto.who.includes('instructor'), JSON.stringify(ins.auto));
  t('instructor (auto): hands control back once stable and sticks centred', ins.auto.back, JSON.stringify(ins.auto));
  t('instructor: without it the same upset crashes', ins.off.crashed, JSON.stringify(ins.off));
  const sw = run(`(() => { const m = SimModel.build(SimModel.builtinDesign('trainer')), sim = new SimPhysics.Sim(m, { env:new SimPhysics.Environment({ speed:1 }) }); sim.reset('air', { alt:35 }); const I = new SimLessons.Instructor(sim, { mode:'switch' }); let who = new Set();
    for (let k = 0; k < 60 * 40; k++) { const r = I.update({ ail:0, ele:0, rud:0, thr:0, flap:0 }, k > 60 * 30, 1 / 60); who.add(r.who); sim.step(1 / 60, r.ctrl); } const tl = sim.telemetry(); return { alt:tl.alt, crashed:!!tl.crashed, who:[...who], d:Math.hypot(tl.pos[0] - 6, tl.pos[1] + 16) }; })()`);
  t('instructor (switch): flies a safe circle over the field until the student switch is held', !sw.crashed && sw.alt > 15 && sw.d < 200 && sw.who.includes('instructor') && sw.who.includes('student'), JSON.stringify(sw));
  const sh = run(`(() => { const m = SimModel.build(SimModel.builtinDesign('trainer')), sim = new SimPhysics.Sim(m, { env:new SimPhysics.Environment({ speed:0 }) }); sim.reset('air', { alt:40 }); const I = new SimLessons.Instructor(sim, { mode:'shared' }); let maxShare = 0, minAlt = 99;
    for (let k = 0; k < 60 * 15; k++) { const r = I.update({ ail:0.8, ele:-0.3, rud:0, thr:0.5, flap:0 }, false, 1 / 60); maxShare = Math.max(maxShare, r.share || 0); sim.step(1 / 60, r.ctrl); minAlt = Math.min(minAlt, sim.telemetry().alt); } return { maxShare, minAlt, crashed:!!sim.telemetry().crashed }; })()`);
  t('instructor (shared): blends in help as limits approach and keeps the plane flying', sh.maxShare > 0.3 && !sh.crashed && sh.minAlt > 5, JSON.stringify(sh));
  const fl = run(`(() => { const m = SimModel.build(SimModel.builtinDesign('trainer')), mk = () => { const s = new SimPhysics.Sim(m, { env:new SimPhysics.Environment({ speed:0 }) }); s.reset('air', { alt:60 }); return s; };
    const a = mk(); a.failures.motor = true; for (let k = 0; k < 120; k++) a.step(1 / 60, { ail:0, ele:0, rud:0, thr:1, flap:0 });
    const b = mk(); b.failures.stuckAil = 0; for (let k = 0; k < 120; k++) b.step(1 / 60, { ail:1, ele:0, rud:0, thr:0.5, flap:0 });
    const c = mk(); c.failures.failsafeUntil = 5; for (let k = 0; k < 60; k++) c.step(1 / 60, { ail:1, ele:1, rud:1, thr:1, flap:0 });
    return { thrust:a.telemetry().T, roll:Math.abs(b.telemetry().phi), fsThr:c.ctrlApplied.thr, fsAil:c.ctrlApplied.ail, raw:c.ctrl.ail }; })()`);
  t('failures: motor cut gives no thrust, stuck aileron ignores the stick, failsafe neutralises controls', fl.thrust <= 0.01 && fl.roll < 10 && fl.fsThr === 0 && fl.fsAil === 0 && fl.raw === 1, JSON.stringify(fl));
  const r3 = run(`(() => { const m = SimModel.build(SimModel.builtinDesign('glider')), sim = new SimPhysics.Sim(m); sim.reset('air', { alt:50 }); const c = SimPhysics.pilotAssist(sim, { ail:1, ele:0, rud:0, thr:0.5 }, {}); return [m.surf, c.ail, c.rud]; })()`);
  const stw = run(`(() => { const w = new SimInput.MappingWizard('tx'); const B = p => [{ pressed:false }, { pressed:p }];
    w.feed([0, 0, -1, 0, 0], B(false)); w.next(); for (const v of [-1, 1]) w.feed([0, 0, v, 0, 0], B(false)); w.next(); for (const v of [-1, 1]) w.feed([v, 0, 1, 0, 0], B(false)); w.next();
    for (const v of [1, -1]) w.feed([0, v, 1, 0, 0], B(false)); w.next(); for (const v of [-1, 1]) w.feed([0, 0, 1, v, 0], B(false)); w.next(); w.next(true); w.next(true);
    w.feed([0, 0, 1, 0, 1], B(false)); w.next(); const p = w.profile('tx'); return { done:w.done, sw:p.switches.student, held:SimInput.readCustom({ axes:[0, 0, 1, 0, 1], buttons:B(false) }, p).btn.student, std:SimInput.standardProfile('x').buttons.student }; })()`);
  t('student switch: mapped from a transmitter switch in the wizard, Xbox LB by default', stw.done && stw.sw && stw.sw.index === 4 && stw.held === true && stw.std === 4, JSON.stringify(stw));
  const wake = run(`(() => { const mk = () => new SimPhysics.Environment({ speed:6, dir:270, dirVar:0, turbulence:0, gustPeak:0, seed:7, obstacles:[{ x:0, y:0, r:3, h:10 }] });
    const probe = p => { const e = mk(); let sum = 0, sq = 0, n = 0, I = 0; for (let k = 0; k < 2400; k++) { e.update(1 / 240, { V:10, p }); const w = e.at(p); sum += w[1]; sq += w[1] * w[1] + w[2] * w[2]; n++; I = Math.max(I, e.wake); } const m = sum / n; return { I:+I.toFixed(2), mean:+m.toFixed(2), sd:+Math.sqrt(sq / n - m * m).toFixed(2) }; };
    return { down:probe([0, 30, -6]), up:probe([0, -40, -6]), high:probe([0, 30, -30]), far:probe([0, 200, -6]) }; })()`);
  t('tree turbulence: slower, bumpier air just downwind and low; none upwind, high above or far away', wake.down.I > 0.4 && wake.down.mean < wake.up.mean * 0.85 && wake.down.sd > 0.5 && wake.up.I === 0 && wake.high.I === 0 && wake.far.I === 0, JSON.stringify(wake));
  const im = run(`(() => { const enc = s => new TextEncoder().encode(s).buffer;
    const mtl = SimImport.parseMTL('# test\\nnewmtl Red Wing\\nKd 0.9 0.1 0.1\\nNs 250\\nd 0.5\\nmap_Kd -bm 1 tex/wing.png\\nnewmtl Clear\\nTr 0.75\\n');
    const m1 = SimImport.metaFrom({ generator:'Sketchfab', extras:{ author:'Jane (https://x)', license:'CC-BY-4.0', source:'https://sketchfab.com/m/1', title:'Cub' } }, {});
    const m2 = SimImport.metaFrom(null, { 'license.txt':enc('Model Information:\\n* title:\\tSpitfire\\n* source:\\thttps://example.org/spit\\n* author:\\tBob\\n\\nModel License:\\n* license type:\\tCC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)\\n') });
    const pick = SimImport.pickMain(['scene.bin', 'tex.png', 'license.txt', 'scene.gltf']), pick2 = SimImport.pickMain(['a.mtl', 'a.obj']);
    const pkg = SimImport.unpackage(SimImport.packageModel({ name:'X', design:{ name:'X' }, fileName:'scene.gltf', type:'gltf', data:enc('{}'), extras:{ 'scene.bin':new Uint8Array([1, 2, 3]).buffer }, meta:m1 }));
    return { mtl, m1, m2, pick, pick2, credit:SimImport.credit(m1), safe:[SimImport.safeUrl('javascript:alert(1)'), SimImport.safeUrl('https://a.b')], ex:Array.from(new Uint8Array(pkg.extras['scene.bin'])), meta:pkg.meta.author }; })()`);
  t('import: .mtl colours, opacity, shininess and texture names are read', im.mtl['Red Wing'].color[0] === 0.9 && im.mtl['Red Wing'].opacity === 0.5 && im.mtl['Red Wing'].map === 'tex/wing.png' && im.mtl.Clear.opacity === 0.25, JSON.stringify(im.mtl));
  t('import: licence/attribution from glTF asset extras and from a licence.txt', im.m1.license === 'CC-BY-4.0' && im.m1.title === 'Cub' && im.m2.license && im.m2.license.startsWith('CC-BY-4.0') && im.m2.source === 'https://example.org/spit' && im.credit === '“Cub” by Jane (https://x) (CC-BY-4.0)', JSON.stringify([im.m1, im.m2, im.credit]));
  t('import: picks the main file from a multi-file selection; extras and credits survive .rcsim packages; unsafe links dropped', im.pick === 'scene.gltf' && im.pick2 === 'a.obj' && im.ex.join() === '1,2,3' && im.meta === 'Jane (https://x)' && im.safe[0] === null && im.safe[1] === 'https://a.b', JSON.stringify(im));
  const den = run(`[airDensity(15, 0), airDensity(35, 2000), densityAltitude(airDensity(35, 2000)), SimPhysics.airDensity === airDensity]`);
  t('air density lives in rc-core (Designer + simulator share it): ISA sea level 1.225, hot & high ≈ 0.90', Math.abs(den[0] - 1.225) < 0.002 && Math.abs(den[1] - 0.899) < 0.01 && den[2] > 3000 && den[3], den);
  // --- motor mount: thrust angles, prop rotation, torque, spiral slipstream, P-factor ---
  const mt = run(`(() => { const D = 180 / Math.PI, base = SimModel.builtinDesign('trainer'), env = { windB:() => [0, 0, 0], rho:1.225, soc:1, h:50 };
    const rates = m => { const sim = new SimPhysics.Sim(m, { env:new SimPhysics.Environment({ speed:0 }) }); sim.reset('air', { alt:80 }); for (let k = 0; k < 60; k++) sim.step(1 / 60, { ail:0, ele:0, rud:0, thr:m.trim.throttle, flap:0 });
      let p = 0, r = 0; for (let k = 0; k < 90; k++) { sim.step(1 / 60, { ail:0, ele:0, rud:0, thr:1, flap:0 }); p += sim.s.w[0]; r += sim.s.w[2]; } return { p:p / 90 * D, r:r / 90 * D }; };
    const withG = g => Object.assign({}, base, { geom:Object.assign({}, base.geom, g) });
    const dM = (dn, rt) => { const m = SimModel.build(base, { thrustDown:dn, thrustRight:rt }), V = m.trim.V, a = m.trim.alphaDeg / D, st = { v:[V * Math.cos(a), 0, V * Math.sin(a)], w:[0, 0, 0] };
      const f = t => SimPhysics.forces(m, st, { ail:0, ele:0, rud:0, thr:t, flap:0 }, env).M; return f(1); };
    const m00 = dM(0, 0), mR = dM(0, 1), mD = dM(1, 0);
    return { off:rates(SimModel.build(base, { motorEffects:false })), cw:rates(SimModel.build(withG({ thrustDown:0, thrustRight:0, propRot:'cw' }))), ccw:rates(SimModel.build(withG({ thrustDown:0, thrustRight:0, propRot:'ccw' }))),
      right:{ dyaw:mR[2] - m00[2], dpitch:mR[1] - m00[1] }, down:{ dpitch:mD[1] - m00[1], dyaw:mD[2] - m00[2] } }; })()`);
  t('motor effects off: full power adds no roll or yaw (ideal motor)', Math.abs(mt.off.p) < 0.05 && Math.abs(mt.off.r) < 0.05, JSON.stringify(mt.off));
  t('straight mount, clockwise prop (from behind): torque, slipstream and P-factor swing the nose left; an anti-clockwise prop swings it right', mt.cw.r < -2 && mt.cw.p < 0 && mt.ccw.r > 2 && mt.ccw.p > 0, JSON.stringify([mt.cw, mt.ccw]));
  t('right-thrust yaws the nose right and down-thrust pitches it down, without cross-coupling', mt.right.dyaw > 0 && Math.abs(mt.right.dpitch) < 0.2 * mt.right.dyaw && mt.down.dpitch < 0 && Math.abs(mt.down.dyaw) < 0.2 * Math.abs(mt.down.dpitch), JSON.stringify([mt.right, mt.down]));
  const sug = run(`(() => { const out = {}; for (const k of ['trainer', 'sport', 'wing', 'aerobat']) { const d = SimModel.builtinDesign(k), sg = SimModel.suggestThrustAngles(d);
    out[k] = { down:sg.down, right:sg.right, built:[d.geom.thrustDown, d.geom.thrustRight], imp:+sg.improvement.toFixed(2), why:sg.why.length, text:SimModel.describeThrust(sg.down, sg.right, sg.pusher) }; } return out; })()`);
  t('suggested mount angles cut the full-power swing by ≥ 40 % (trainer, sport, flying wing, aerobat)', Object.values(sug).every(x => x.imp >= 0.4 && x.why >= 1), JSON.stringify(sug));
  t('built-in planes ship with their suggested mount angles (±1°)', Object.values(sug).every(x => Math.abs(x.down - x.built[0]) <= 1 && Math.abs(x.right - x.built[1]) <= 1), JSON.stringify(sug));
  t('mount wording: tractor down/right, pusher explains which end of the motor moves', sug.trainer.text.includes('down-thrust') && sug.trainer.text.includes('right-thrust') && /prop end/.test(sug.wing.text), [sug.trainer.text, sug.wing.text]);
  t('3-channel planes: the aileron stick steers with rudder', r3[0] === 'none' && r3[1] === 0 && r3[2] > 0.9, r3);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
