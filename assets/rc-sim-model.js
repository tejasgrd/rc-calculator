/* RC Calc simulator: flight-model builder (pure, no DOM).
   Turns a Designer design into a strip-theory aircraft: aerodynamic strips, mass/inertia, ground contacts,
   a propulsion table from the motor model, and a cruise trim. Depends on rc-core.js and rc-aero.js.
   Frames: geometry (x aft, y right, z up, metres) → body (X forward, Y right, Z down, origin at CG). */
'use strict';
const SimModel = (() => {
  const DEG = Math.PI / 180;
  const v3 = (x, y, z) => [x, y, z];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  /** Flap effectiveness τ for a plain flap of chord fraction cf (thin-airfoil theory, ×0.8 for real hinges). */
  const flapTau = cf => { const th = Math.acos(2 * cf - 1); return 0.8 * (1 - (th - Math.sin(th)) / Math.PI); };
  const designThrows = SP => { const o = {}; if (SP.throwAil != null) o.ail = SP.throwAil; if (SP.throwEle != null) o.ele = SP.throwEle; if (SP.throwRud != null) o.rud = SP.throwRud; o.flap = SP.throwFlap; return o; };
  const PRESET_RIG = {
    trainer:    { gear:'tricycle', surf:'ailerons', throws:{ ail:14, ele:14, rud:22 } },
    lowwing:    { gear:'taildragger', surf:'ailerons', throws:{ ail:16, ele:15, rud:25 } },
    flyingwing: { gear:'none', surf:'elevons', throws:{ ail:16, ele:12, rud:0 } },
    chuck:      { gear:'none', surf:'none', throws:{ ail:0, ele:14, rud:25 } },
  };

  /**
   * build(design, opts): opts { gear:'auto'|'none'|'tricycle'|'taildragger', throws:{ail,ele,rud} (deg), strips }.
   * Returns everything the physics needs, plus `info` for the UI.
   */
  function build(design, opts = {}){
    const d = Object.assign({ washout:0 }, design.geom), af = Airfoil.get(design.airfoilId || 'clarky', design.customAirfoil);
    const ms = MISSIONS[(design.req || {}).mission] || MISSIONS.trainer, preset = PRESETS[d.preset] ? d.preset : 'trainer', rig = PRESET_RIG[preset];
    const auw = design.auw > 0 ? design.auw : 0.2, cells = design.power ? design.power.cells : (design.cells || 2), cap = design.capacity_mAh || 450;
    // ---- power system: chosen motor, else best match, else a synthetic motor ----
    let motor = null, prop = null;
    if (design.power) { motor = MOTOR_DB.concat(opts.customMotors || []).find(m => m.id === design.power.motorId) || null; prop = design.power.prop; }
    const g0 = airframeGeometry(d, 0.2);
    const Ptarget = auw * (ms.wpk || STYLES[ms.style].wPerKg), vcGuess = Math.sqrt(2 * auw * G / (RHO_SL * g0.S * af.clmax * 0.9)) * 1.4;
    if (!motor) {
      const best = matchPowerSystems({ motors:MOTOR_DB.concat(opts.customMotors || []), cellsList:[cells], props:PROPS_EXT, capacity_mAh:cap, targetPower:Ptarget, cruise:vcGuess, weightN:auw * G, style:ms.style, limit:1 })[0];
      if (best) { motor = best.motor; prop = best.prop; }
    }
    if (!motor) { const kv = Math.round(Phys.rpmForPower(Ptarget, 8, 0.04, RHO_SL) / (0.8 * cells * V_NOMINAL)); motor = { id:'synthetic', name:'Generic outrunner', kv, rm:0.15, io:0.5, maxA:Ptarget / (cells * 3.5) * 2, maxW:Ptarget * 2, mass:Phys.motorWeight(Ptarget) }; prop = { d:8, p:3.8 }; }
    const g = airframeGeometry(d, prop.d * 0.0254);
    const makeTable = rho => { const tab = [];
      for (let k = 0; k <= 20; k++) { const t = k / 20, op = t > 0 ? motorOperatingPoint({ motor, cells, capacity_mAh:cap, prop, throttle:t, rho }) : null;
        tab.push(op ? { t, T0:op.thrust, I:op.I, rpm:op.rpm, Psh:op.Pshaft, Pin:op.Pin, Vp:op.pitchSpeed } : { t, T0:0, I:0, rpm:0, Psh:0, Pin:0, Vp:1 }); }
      return tab; };
    const rhoField = opts.rho > 0 ? opts.rho : RHO_SL, tableCache = new Map();
    const thrTableAt = rho => { const key = Math.round((rho || rhoField) * 200); if (!tableCache.has(key)) { if (tableCache.size > 40) tableCache.clear(); tableCache.set(key, makeTable(key / 200)); } return tableCache.get(key); };
    const thrTable = thrTableAt(rhoField);
    // ---- mass distribution (grams, geometry frame) ----
    const bd = {}; ((design.sizing && design.sizing.breakdown) || []).forEach(b => { bd[b.key] = b.g; });
    const mat = MATERIALS[(design.req || {}).material] || MATERIALS.depron, afm = airframeMass(d, g, mat);
    const est = { airframe:afm.total, motor:motor.mass, esc:2 + 0.7 * Math.ceil(1.5 * thrTable[20].I), servos:(CONTROLS[rig.surf === 'elevons' ? 'elevon' : rig.surf === 'none' ? 're' : 'aer2'] || CONTROLS.re).servos * servoMass(auw), rx:auw < 0.25 ? 4 : 7, prop:Math.max(1.5, 0.1 * prop.d * prop.d), wiring:5, payload:0, battery:cells * V_NOMINAL * cap / 1000 / SIZING.whPerGram + 2 * cells };
    Object.keys(est).forEach(k => { if (!(bd[k] >= 0)) bd[k] = est[k]; });
    const sum0 = Object.values(bd).reduce((a, b) => a + b, 0), scale = auw * 1000 / sum0;
    const airframe = bd.airframe * scale, fW = afm.wing / afm.total, fT = afm.tail / afm.total, fF = 1 - fW - fT;
    const pts = []; // {m (kg), r:[x,y,z] geometry frame, tag}
    const b2 = d.span / 2, tanSw = Math.tan(d.sweep * DEG), tanDi = Math.tan(d.dihedral * DEG);
    const chordAt = y => d.rootChord + (d.tipChord - d.rootChord) * Math.abs(y) / b2, xLEat = y => g.xwLE + Math.abs(y) * tanSw;
    for (let i = 0; i < 10; i++) for (const s of [1, -1]) { const y = (i + 0.5) / 10 * b2, c = chordAt(y), w = c / (d.rootChord + d.tipChord) / 10;
      pts.push({ m:airframe * fW * w / 1000, r:[xLEat(y) + 0.42 * c, s * y, g.wingZ + y * tanDi], tag:'wing' }); }
    if (!g.tailless) pts.push({ m:airframe * fT * 0.75 / 1000, r:[g.xhLE + 0.4 * d.hChord, 0, g.hTailZ], tag:'tail' });
    const finMass = airframe * fT * (g.tailless ? 1 : 0.25) / 1000;
    (g.tailless ? [-b2, b2] : [0]).forEach(fy => pts.push({ m:finMass / (g.tailless ? 2 : 1), r:[g.xvLE + 0.45 * d.vChord, fy, g.vBaseZ + 0.4 * d.vHeight], tag:'fin' }));
    for (let i = 0; i < 6; i++) pts.push({ m:airframe * fF / 6 / 1000, r:[(i + 0.5) / 6 * d.fuseLen, 0, 0], tag:'fuse' });
    const pusher = d.motorPos === 'pusher';
    const motorX = pusher ? g.propX - g.mlen / 2 : 0.02 * d.fuseLen, motorZ = g.propZ;
    pts.push({ m:bd.motor * scale / 1000, r:[motorX, 0, motorZ], tag:'motor' }, { m:bd.prop * scale / 1000, r:[g.propX, 0, g.propZ], tag:'prop' });
    pts.push({ m:bd.esc * scale / 1000, r:[pusher ? g.xwLE + d.rootChord * 0.8 : 0.12 * d.fuseLen, 0, 0], tag:'esc' });
    pts.push({ m:(bd.servos + bd.rx + bd.wiring) * scale / 1000, r:[g.xwLE + 0.4 * d.rootChord, 0, 0], tag:'radio' });
    if (bd.payload > 0) pts.push({ m:bd.payload * scale / 1000, r:[g.xcg, 0, 0], tag:'payload' });
    // battery placed to hit the design CG, within the fuselage
    const mb = bd.battery * scale / 1000, others = pts.reduce((a, p) => a + p.m, 0), mx = pts.reduce((a, p) => a + p.m * p.r[0], 0);
    const xbIdeal = (g.xcg * (others + mb) - mx) / mb, xbMin = 0.04 * d.fuseLen, xbMax = Math.max(xbMin, Math.min(0.75 * d.fuseLen, g.xwLE + d.rootChord));
    const xb = Math.max(xbMin, Math.min(xbMax, xbIdeal));
    pts.push({ m:mb, r:[xb, 0, 0], tag:'battery' });
    let ballast = 0;
    if (opts.autoBallast !== false && xbIdeal < xbMin - 1e-6) { // CG unreachable with the battery alone: add nose weight
      const M0 = others + mb, Mx = mx + mb * xb, xn = 0.01 * d.fuseLen; ballast = Math.max(0, (Mx - g.xcg * M0) / (g.xcg - xn));
      if (ballast > 0) pts.push({ m:ballast, r:[xn, 0, 0], tag:'ballast' });
    }
    const mass = pts.reduce((a, p) => a + p.m, 0);
    const cgGeo = scl(pts.reduce((a, p) => add(a, scl(p.r, p.m)), [0, 0, 0]), 1 / mass); cgGeo[1] = 0;
    const toB = r => [-(r[0] - cgGeo[0]), r[1], -(r[2] - cgGeo[2])], dirB = v => [-v[0], v[1], -v[2]];
    const I = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const p of pts) { const r = toB(p.r), [x, y, z] = r;
      I[0][0] += p.m * (y * y + z * z); I[1][1] += p.m * (x * x + z * z); I[2][2] += p.m * (x * x + y * y); I[0][2] -= p.m * x * z; I[0][1] -= p.m * x * y; I[1][2] -= p.m * y * z; }
    // plank terms for distributed structure (span-wise wing, length-wise fuselage)
    I[0][0] += airframe * fW / 1000 * (d.span * d.span / 12) * 0.15; I[2][2] += airframe * fW / 1000 * (d.span * d.span / 12) * 0.15;
    I[1][1] += airframe * fF / 1000 * d.fuseLen * d.fuseLen / 12 * 0.2; I[2][2] += airframe * fF / 1000 * d.fuseLen * d.fuseLen / 12 * 0.2;
    I[1][0] = I[0][1]; I[2][0] = I[0][2]; I[2][1] = I[1][2];
    const cgPctActual = (cgGeo[0] - g.xMacLE) / g.mac * 100;

    // ---- aerodynamic strips ----
    const strips = [], N = opts.strips || 12;
    const ll = liftingLine({ b:d.span, cr:d.rootChord, ct:d.tipChord, washoutDeg:d.washout || 0, a0:2 * Math.PI * 0.9, alpha0Deg:af.alpha0Deg, CL:0.5, clmax2D:af.clmax });
    const kAt = eta => { const st = ll.stations; let a = st[0], b = st[st.length - 1];
      for (let i = 1; i < st.length; i++) if (st[i].eta >= eta) { a = st[i - 1]; b = st[i]; break; }
      const t = (eta - a.eta) / ((b.eta - a.eta) || 1), cl = a.cl + t * (b.cl - a.cl); return Math.max(0.05, eta < st[0].eta ? st[0].cl / ll.CL : cl / ll.CL); };
    const surf = opts.surf || (g.tailless ? 'elevons' : rig.surf);
    const aw3 = liftSlope(g.AR), alpha0 = af.alpha0Deg * DEG, iw = 1.5 * DEG;
    const SP = surfaceSpec(d), cfA = surf === 'elevons' ? SP.elevonCf : SP.ailCf, ailR = surf === 'elevons' ? [SP.elevonStart, SP.elevonEnd] : [SP.ailStart, SP.ailEnd];
    const hasFlaps = SP.flaps && surf !== 'elevons';
    const makeStrip = (o) => {
      const s = norm(o.span), up = o.up, th = o.inc;
      const c = norm(add(scl([1, 0, 0], Math.cos(th)), scl(up, Math.sin(th)))), n = norm(add(scl([1, 0, 0], -Math.sin(th)), scl(up, Math.cos(th))));
      const pitchAxis = s[1] >= 0 ? s : scl(s, -1);
      return Object.assign({ c, n, s, pitchAxis }, o);
    };
    // wing (each half)
    let wingSarea = 0;
    for (const side of [1, -1]) for (let i = 0; i < N; i++) {
      const e0 = i / N, e1 = (i + 1) / N, em = (e0 + e1) / 2, y = em * b2, ch = chordAt(y), dy = (e1 - e0) * b2;
      const qc = [xLEat(y) + 0.25 * ch, side * y, g.wingZ + y * tanDi];
      const span = side > 0 ? [0, Math.cos(d.dihedral * DEG), -Math.sin(d.dihedral * DEG)] : [0, -Math.cos(d.dihedral * DEG), -Math.sin(d.dihedral * DEG)];
      const up = [0, -side * Math.sin(d.dihedral * DEG), -Math.cos(d.dihedral * DEG)];
      const inAil = (surf === 'ailerons' || surf === 'elevons') && em >= ailR[0] && em <= ailR[1];
      const inFlap = hasFlaps && !inAil && em >= SP.flapStart && em <= SP.flapEnd;
      const dS = ch * dy / Math.cos(d.dihedral * DEG); wingSarea += dS;
      strips.push(makeStrip({ kind:'wing', side, eta:em, r:toB(qc), dS, chord:ch, span, up, inc:iw - (d.washout || 0) * DEG * em, a:aw3, k:kAt(em), alpha0, clmax:af.clmax, clmaxNeg:af.cm0 < -0.02 ? 0.75 * af.clmax : af.clmax * 0.95, cd0:af.cd0, cm0:af.cm0, AR:g.AR,
        ctrl:inAil ? (surf === 'elevons' ? { ail:side, ele:1, tau:flapTau(cfA) } : { ail:side, tau:flapTau(cfA) }) : null, flap:inFlap, flapTau:inFlap ? flapTau(SP.flapCf) : 0 }));
    }
    // horizontal tail
    const Nt = 5;
    if (!g.tailless) {
      const ARh = d.hSpan * d.hSpan / g.Sh, at = liftSlope(ARh);
      for (const side of [1, -1]) for (let i = 0; i < Nt; i++) {
        const em = (i + 0.5) / Nt, y = em * d.hSpan / 2, qc = [g.xhLE + 0.25 * d.hChord, side * y, g.hTailZ];
        strips.push(makeStrip({ kind:'htail', side, eta:em, r:toB(qc), dS:d.hChord * d.hSpan / 2 / Nt, chord:d.hChord, span:[0, side, 0], up:[0, 0, -1], inc:0, a:at, k:1, alpha0:0, clmax:0.9, clmaxNeg:0.9, cd0:0.014, cm0:0, AR:ARh,
          ctrl:{ ele:1, tau:flapTau(SP.eleCf) } }));
      }
    }
    // fin(s): normal points to +Y (right)
    const ARv = 2 * d.vHeight * d.vHeight / (g.Sv / g.fins), av = liftSlope(ARv);
    for (const fy of (g.tailless ? [-b2, b2] : [0])) for (let i = 0; i < 4; i++) {
      const em = (i + 0.5) / 4, z = g.vBaseZ + em * d.vHeight, ch = d.vChord * (1 - 0.45 * em), xle = g.xvLE + 0.45 * d.vChord * em;
      strips.push(makeStrip({ kind:'fin', side:0, eta:em, r:toB([xle + 0.25 * ch, fy, z]), dS:g.Sv / g.fins / 4, chord:ch, span:[0, 0, -1], up:[0, 1, 0], inc:0, a:av, k:1, alpha0:0, clmax:0.9, clmaxNeg:0.9, cd0:0.014, cm0:0, AR:ARv,
        ctrl:g.tailless ? null : { rud:1, tau:flapTau(SP.rudCf) } }));
    }
    // ---- fuselage, contacts, prop ----
    const fuseCenter = toB([d.fuseLen / 2, 0, 0]);
    const fuse = { r:fuseCenter, CDA:(g.body === 'stick' ? 0.6 : g.body === 'pod' ? 0.15 : 0.4) * g.wf * g.hf, side:0.8 * d.fuseLen * g.hf, top:0.8 * d.fuseLen * g.wf };
    let gear = opts.gear && opts.gear !== 'auto' ? opts.gear : rig.gear;
    const contacts = [];
    const D = prop.d * 0.0254, gearH = Math.max(0.35 * D, g.hf * 0.6) + (pusher ? 0 : Math.max(0, D / 2 - g.hf / 2) * 0.9);
    if (gear === 'tricycle') {
      const xm = g.xcg + 0.05 * d.fuseLen, zb = -g.hf / 2 - gearH;
      contacts.push({ r:toB([xm, 0.11 * d.span, zb]), kind:'wheel' }, { r:toB([xm, -0.11 * d.span, zb]), kind:'wheel' }, { r:toB([0.06 * d.fuseLen, 0, zb]), kind:'wheel', steer:true });
    } else if (gear === 'taildragger') {
      const xm = g.xcg - 0.06 * d.fuseLen, zb = -g.hf / 2 - gearH;
      contacts.push({ r:toB([xm, 0.11 * d.span, zb]), kind:'wheel' }, { r:toB([xm, -0.11 * d.span, zb]), kind:'wheel' }, { r:toB([0.97 * d.fuseLen, 0, -g.hf * 0.15]), kind:'wheel', steer:true });
    }
    const skids = [[0, 0, -g.hf * 0.3], [d.fuseLen * 0.5, 0, -g.hf / 2], [d.fuseLen, 0, 0], [xLEat(b2) + d.tipChord / 2, b2, g.wingZ + b2 * tanDi], [xLEat(b2) + d.tipChord / 2, -b2, g.wingZ + b2 * tanDi],
      [g.xvLE + d.vChord, 0, g.vBaseZ + d.vHeight], [g.xwLE + d.rootChord / 2, 0, g.wingZ + 0.06 * d.rootChord], [g.propX, 0, g.propZ - D / 2], [g.propX, 0, g.propZ + D / 2]];
    if (!g.tailless) skids.push([g.xhLE + d.hChord, d.hSpan / 2, g.hTailZ], [g.xhLE + d.hChord, -d.hSpan / 2, g.hTailZ]);
    skids.forEach((r, i) => contacts.push({ r:toB(r), kind:i >= 7 && i <= 8 ? 'prop' : 'skid' }));
    // thrust line: down-thrust (+ = thrust points below the fuselage datum) and right-thrust (+ = towards the right wing), degrees
    const tDown = opts.thrustDown != null ? opts.thrustDown : (+d.thrustDown || 0), tRight = opts.thrustRight != null ? opts.thrustRight : (+d.thrustRight || 0);
    const motorFx = opts.motorEffects !== false, axis = motorFx ? norm([Math.cos(tDown * DEG) * Math.cos(tRight * DEG), Math.sin(tRight * DEG), Math.sin(tDown * DEG)]) : [1, 0, 0];
    const propInfo = { r:toB([g.propX, 0, g.propZ]), D, A:Math.PI * D * D / 4, axis, pusher, dir:d.propRot === 'ccw' ? -1 : 1, thrustDown:motorFx ? tDown : 0, thrustRight:motorFx ? tRight : 0 };
    // slipstream: which strips are in the prop wash
    strips.forEach(s => { const dyz = Math.hypot(s.r[1] - propInfo.r[1], s.r[2] - propInfo.r[2]); s.inWash = (pusher ? s.r[0] < propInfo.r[0] : s.r[0] < propInfo.r[0]) && dyz < D * 0.55; });
    propInfo.torqueK = strips.some(s => s.kind === 'wing' && s.inWash) ? 0.6 : 0.9;
    const model = { name:design.name || 'Aircraft', motorFx, mass, I, Iinv:inv3(I), strips, fuse, contacts, gear, prop:propInfo, motor, propSpec:prop, cells, capacity_mAh:cap, thrTable, thrTableAt, rho:rhoField, asBuilt:!!design.asBuilt,
      throws:Object.assign({}, rig.throws, (design.sim && design.sim.throws) || {}, designThrows(SP), opts.throws || {}), surfaces:SP, hasFlaps, surf, Sref:g.S, bref:d.span, cref:g.mac, AR:g.AR, af, geom:d, g, cgGeo, cgPctActual, cgPctDesign:d.cg, cgShift:xb !== xbIdeal && !(ballast > 0),
      cal:Object.assign({ cd0:1, clmax:1, thrust:1, current:1, roll:1 }, design.calibration && design.calibration.factors && opts.calibrated !== false ? design.calibration.factors : {}), calibrated:!!(design.calibration && design.calibration.factors && opts.calibrated !== false),
      battery:{ x:xb, ideal:xbIdeal }, ballast_g:ballast * 1000, tailIncidence:0, elevonTrim:0, wingIncidence:iw, points:pts, alphaStallDeg:((0.9 * af.clmax) / aw3 + alpha0 - iw) / DEG };
    model.trim = trim(model, opts.trimSpeed || null);
    return model;
  }
  /**
   * Suggested motor-mount angles: the down- and right-thrust that make full power add no pitching or yawing moment at
   * the cruise trim (so opening the throttle climbs straight instead of ballooning/diving or swinging). Uses the same
   * physics as the simulator: thrust-line height vs CG, prop wash on the tail, spiral slipstream on the fin, P-factor.
   */
  function suggestThrustAngles(design, opts = {}){
    const base = Object.assign({}, opts, { motorEffects:true, thrustDown:0, thrustRight:0 }), m = build(design, base), V = m.trim.V, al = m.trim.alphaDeg * DEG;
    const st = { v:[V * Math.cos(al), 0, V * Math.sin(al)], w:[0, 0, 0] }, env = { windB:() => [0, 0, 0], rho:m.rho, soc:1, h:50 };
    const dM = (down, right) => { const pr = m.prop, keep = pr.axis;
      pr.axis = norm([Math.cos(down * DEG) * Math.cos(right * DEG), Math.sin(right * DEG), Math.sin(down * DEG)]);
      const lo = SimPhysics.forces(m, st, { ail:0, ele:0, rud:0, thr:m.trim.throttle, flap:0 }, env), hi = SimPhysics.forces(m, st, { ail:0, ele:0, rud:0, thr:1, flap:0 }, env);
      pr.axis = keep; return { pitch:hi.M[1] - lo.M[1], yaw:hi.M[2] - lo.M[2], roll:hi.M[0] - lo.M[0], dT:hi.T - lo.T }; };
    const z = dM(0, 0), pd = dM(1, 0), pr1 = dM(0, 1);
    const kd = pd.pitch - z.pitch, kr = pr1.yaw - z.yaw, lim = 6, r05 = v => Math.round(v * 2) / 2;
    const down = Math.abs(kd) > 1e-9 ? Math.max(-lim, Math.min(lim, -z.pitch / kd)) : 0, right = Math.abs(kr) > 1e-9 ? Math.max(-lim, Math.min(lim, -z.yaw / kr)) : 0;
    // what causes it (for the explanation)
    const g = m.g, d = m.geom, thrustBelowCG_mm = m.prop.r[2] * 1000, tailInWash = m.strips.some(s => s.kind === 'htail' && s.inWash), finInWash = m.strips.some(s => s.kind === 'fin' && s.inWash);
    const why = [];
    if (Math.abs(thrustBelowCG_mm) >= 5) why.push(`the thrust line is ${Math.abs(Math.round(thrustBelowCG_mm))} mm ${thrustBelowCG_mm > 0 ? 'below' : 'above'} the balance point, so power pitches the nose ${thrustBelowCG_mm > 0 ? 'up' : 'down'}`);
    if (tailInWash) why.push('the tailplane sits in the prop wash, so power changes its load');
    const yawSide = z.yaw < 0 ? 'left' : 'right';
    if (finInWash) why.push(`the spiral slipstream from the ${m.prop.dir > 0 ? 'clockwise' : 'anti-clockwise'} prop (seen from behind) pushes on the fin and yaws the nose ${yawSide}`);
    if (!m.prop.pusher) why.push(`P-factor at climb angles pulls the nose ${m.prop.dir > 0 ? 'left' : 'right'}`);
    if (Math.abs(z.roll) > 1e-3) why.push(`motor torque rolls the plane ${m.prop.dir > 0 ? 'left' : 'right'} (thrust angles can't cancel this: trim it with a little aileron)`);
    const pusher = m.prop.pusher;
    // refine on the real (dynamic) response: 1.5 s hands-off at full power from trimmed cruise, compared with an ideal
    // airframe whose thrust passes through the balance point with no wash, swirl, torque or P-factor
    let fin = { down:r05(down), right:r05(right) }, swing0 = null, swing = null, swingAt = null;
    if (opts.refine !== false) {
      const run = (mm, setup) => { const keep = { axis:mm.prop.axis.slice(), r:mm.prop.r.slice(), fx:mm.motorFx, ti:mm.tailIncidence, et:mm.elevonTrim, wash:mm.strips.map(s => s.inWash), tr:mm.trim };
        setup(mm); mm.trim = trim(mm, V); const sim = new SimPhysics.Sim(mm, { env:new SimPhysics.Environment({ speed:0 }) }); sim.reset('air', { alt:80, heading:0 });
        for (let k = 0; k < 30; k++) sim.step(1 / 60, { ail:0, ele:0, rud:0, thr:mm.trim.throttle, flap:0 });
        const w = []; for (let k = 0; k < 90; k++) { sim.step(1 / 60, { ail:0, ele:0, rud:0, thr:1, flap:0 }); if (k % 3 === 2) w.push(sim.s.w.slice()); }
        mm.prop.axis = keep.axis; mm.prop.r = keep.r; mm.motorFx = keep.fx; mm.tailIncidence = keep.ti; mm.elevonTrim = keep.et; mm.strips.forEach((s, i) => { s.inWash = keep.wash[i]; }); mm.trim = keep.tr; return w; };
      const ref = run(m, mm => { mm.motorFx = false; mm.prop.axis = [1, 0, 0]; mm.prop.r = [mm.prop.r[0], 0, 0]; mm.strips.forEach(s => { s.inWash = false; }); });
      const axisOf = (dn, rt) => norm([Math.cos(dn * DEG) * Math.cos(rt * DEG), Math.sin(rt * DEG), Math.sin(dn * DEG)]), memo = new Map();
      const J = (dn, rt) => { const k = dn + '/' + rt; if (memo.has(k)) return memo.get(k); const w = run(m, mm => { mm.prop.axis = axisOf(dn, rt); });
        let e = 0; w.forEach((x, i) => { e += 0.3 * (x[0] - ref[i][0]) ** 2 + (x[1] - ref[i][1]) ** 2 + (x[2] - ref[i][2]) ** 2; }); /* roll weighs less: torque roll is trimmed with aileron, not mount angles */ const v = Math.sqrt(e / w.length) / DEG; memo.set(k, v); return v; };
      swing0 = J(0, 0); let best = J(fin.down, fin.right) < swing0 ? { ...fin } : { down:0, right:0 }, bJ = J(best.down, best.right);
      for (const step of [2, 1, 0.5]) { let moved = true;
        while (moved) { moved = false; for (const [a, b] of [[step, 0], [-step, 0], [0, step], [0, -step]]) { const c = { down:Math.max(-lim, Math.min(lim, best.down + a)), right:Math.max(-lim, Math.min(lim, best.right + b)) }, v = J(c.down, c.right); if (v < bJ - 1e-6) { best = c; bJ = v; moved = true; } } } }
      fin = best; swing = bJ; swingAt = (dn, rt) => J(+dn || 0, +rt || 0);
    }
    return { down:fin.down, right:fin.right, staticDown:r05(down), staticRight:r05(right), downExact:down, rightExact:right, swing0, swing, swingAt, improvement:swing0 ? 1 - swing / swing0 : null, pusher, propRot:m.prop.dir > 0 ? 'cw' : 'ccw', V, throttleCruise:m.trim.throttle,
      noAngles:{ pitchNm:z.pitch, yawNm:z.yaw, rollNm:z.roll }, perDeg:{ pitch:kd, yaw:kr }, thrustBelowCG_mm, tailInWash, finInWash, why,
      large:Math.abs(down) >= lim || Math.abs(right) >= lim };
  }
  /** Human wording for a down/right thrust pair, e.g. "2.5° down, 1.5° right" or for pushers "2° up-thrust (prop end lower)". */
  function describeThrust(down, right, pusher){
    const parts = [], a = v => `${Math.abs(v).toFixed(1).replace(/\.0$/, '')}°`;
    if (Math.abs(down) >= 0.25) parts.push(down > 0 ? `${a(down)} down-thrust${pusher ? ' (prop end higher)' : ''}` : `${a(down)} up-thrust${pusher ? ' (prop end lower)' : ''}`);
    if (Math.abs(right) >= 0.25) parts.push(`${a(right)} ${right > 0 ? 'right' : 'left'}-thrust${pusher ? ` (prop end towards the ${right > 0 ? 'left' : 'right'})` : ''}`);
    return parts.length ? parts.join(', ') : 'straight (0°, 0°)';
  }
  /** Built-in models, generated by the same sizing pipeline as the Designer (so they are editable there). */
  const BUILTINS = {
    trainer:  { name:'Trainer (high wing)', req:{ mission:'trainer', preset:'trainer', span_m:1.2, stall_ms:null, payload_kg:0, flightMin:8, cells:'auto', material:'depron' }, airfoil:'clarky', dihedral:8, mount:[6, 5] },
    sport:    { name:'Sport (low wing)', req:{ mission:'sport', preset:'lowwing', span_m:1.0, stall_ms:null, payload_kg:0, flightMin:7, cells:'auto', material:'depron' }, airfoil:'naca2412', mount:[1, 3] },
    wing:     { name:'Flying wing', req:{ mission:'wing', preset:'flyingwing', span_m:0.9, stall_ms:null, payload_kg:0, flightMin:8, cells:'auto', material:'depron' }, airfoil:'reflex', washout:3, mount:[-2, -5.5] },
    glider:   { name:'Powered glider', req:{ mission:'glider', preset:'chuck', span_m:1.5, stall_ms:null, payload_kg:0, flightMin:10, cells:'auto', material:'depron' }, airfoil:'naca6409', dihedral:8, mount:[6, -3.5] },
    aerobat:  { name:'3D aerobat', req:{ mission:'aerobatic', preset:'lowwing', span_m:0.9, stall_ms:null, payload_kg:0, flightMin:5, cells:3, material:'depron' }, airfoil:'naca0012', dihedral:0, sim:{ throws:{ ail:32, ele:30, rud:35 } }, mount:[-1, 3] },
  };
  /** opts.req overrides the requirements (e.g. { span_m:1.4 }); the rest of the pipeline is identical. */
  function builtinDesign(key, opts = {}){
    const b = BUILTINS[key] || BUILTINS.trainer, af = Airfoil.get(b.airfoil), req = Object.assign({}, b.req, opts.req || {});
    const sz = sizeAircraft(Object.assign({ clmax:af.clmax }, req));
    const geom = Object.assign({}, sz.geom, { washout:b.washout || 0, propRot:'cw', thrustDown:b.mount ? b.mount[0] : 0, thrustRight:b.mount ? b.mount[1] : 0 }, b.dihedral != null ? { dihedral:b.dihedral } : {}); // mount = suggestThrustAngles()
    const design = { v:1, name:b.name, builtin:key, req:Object.assign({ keep250:false, budget:0, currency:'$' }, req), airfoilId:b.airfoil, customAirfoil:null, geom, auw:sz.auw,
      sizing:{ breakdown:sz.breakdown, auw:sz.auw }, power:null, perf:{ etaProp:0.6, etaMotor:0.75, gear:false }, smTarget:0.1, cells:sz.cells, capacity_mAh:sz.capacity_mAh, sim:b.sim || null };
    const vc = sz.vc, best = matchPowerSystems({ motors:MOTOR_DB, cellsList:[sz.cells], props:PROPS_EXT, capacity_mAh:sz.capacity_mAh, targetPower:sz.P, cruise:vc, weightN:sz.auw * G, style:sz.style, limit:1 })[0];
    if (best) design.power = { motorId:best.motor.id, cells:best.cells, prop:{ d:best.prop.d, p:best.prop.p } };
    const st = stabilityAnalysis(geom, airframeGeometry(geom, 0.2), { smTarget:0.1, cm0:af.cm0 });
    design.geom.cg = Math.round(st.cgRec * 1000) / 10;
    return design;
  }
  function inv3(m){
    const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2], A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
    return [[A / det, -(b * i - c * h) / det, (b * f - c * e) / det], [B / det, (a * i - c * g) / det, -(a * f - c * d) / det], [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]];
  }
  /** Solve level-flight trim at speed V: unknowns α, tail incidence, throttle. Sets model.tailIncidence. */
  function trim(model, Vwant){
    const W = model.mass * G, rho = model.rho || RHO_SL;
    const af = model.af, CLmax3 = 0.9 * af.clmax, vs = Math.sqrt(2 * W / (rho * model.Sref * CLmax3));
    const V = Vwant || Math.max(vs * 1.45, 4);
    const F = (al, it, thr) => {
      if (model.g.tailless) model.elevonTrim = it; else model.tailIncidence = it;
      const st = { v:[V * Math.cos(al), 0, V * Math.sin(al)], w:[0, 0, 0], rpm:null, alt:50 };
      const r = SimPhysics.forces(model, st, { ail:0, ele:0, rud:0, thr, flap:0 }, { windB:() => [0, 0, 0], rho, soc:1, h:50 });
      const gB = [-Math.sin(al) * W, 0, Math.cos(al) * W]; // gravity in body when pitch = α, level
      return [r.F[0] + gB[0], r.F[2] + gB[2], r.M[1]];
    };
    let x = [4 * DEG, -1 * DEG, 0.4], ok = false;
    for (let it = 0; it < 40; it++) {
      const f0 = F(...x), J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], h = [1e-4, 1e-4, 1e-3];
      for (let j = 0; j < 3; j++) { const xp = x.slice(); xp[j] += h[j]; const f1 = F(...xp); for (let i = 0; i < 3; i++) J[i][j] = (f1[i] - f0[i]) / h[j]; }
      const dx = solveLinear(J, f0.map(v => -v));
      x = x.map((v, i) => v + Math.max(-0.2, Math.min(0.2, dx[i])));
      x[2] = Math.max(0, Math.min(1, x[2])); x[1] = Math.max(-15 * DEG, Math.min(15 * DEG, x[1])); x[0] = Math.max(-8 * DEG, Math.min(20 * DEG, x[0]));
      if (!x.every(Number.isFinite)) break;
      if (Math.hypot(...f0.slice(0, 2)) / W < 1e-4 && Math.abs(f0[2]) < 1e-5) { ok = true; break; }
    }
    if (!x.every(Number.isFinite)) { x = [3 * DEG, 0, 0.5]; ok = false; }
    if (!ok) { const r = F(...x); ok = Math.abs(r[2]) < 1e-3 && Math.abs(r[1]) / W < 0.05; }
    if (model.g.tailless) model.elevonTrim = x[1]; else model.tailIncidence = x[1];
    return { V, alphaDeg:x[0] / DEG, tailIncDeg:x[1] / DEG, throttle:x[2], vs, converged:ok, feasible:ok && x[2] < 0.999 && Math.abs(x[1]) < 14.9 * DEG };
  }
  /** The Designer's predictions for a design (same models as designer.js), used to grade simulator tests. */
  function predictions(design, model){
    const af = Airfoil.get(design.airfoilId || 'clarky', design.customAirfoil), d = Object.assign({ washout:0 }, design.geom), g = airframeGeometry(d, model.propSpec.d * 0.0254);
    const rho = model.rho || RHO_SL, W = model.mass * G, vc = model.trim.V, CLc = W / (0.5 * rho * vc * vc * g.S);
    const ll = liftingLine({ b:d.span, cr:d.rootChord, ct:d.tipChord, washoutDeg:d.washout || 0, a0:2 * Math.PI * 0.9, alpha0Deg:af.alpha0Deg, CL:CLc, clmax2D:af.clmax });
    const op = motorOperatingPoint({ motor:model.motor, cells:model.cells, capacity_mAh:model.capacity_mAh, prop:model.propSpec, rho });
    const pf = flightPerformance({ W, S:g.S, AR:g.AR, mac:g.mac, rho, e:Math.min(0.95, ll.e) * 0.93, cd0Airfoil:af.cd0, Sh:g.Sh, Sv:g.Sv, frontalArea:g.wf * g.hf, body:g.body, gear:model.gear !== 'none',
      CLmax:ll.CLmax3D || af.clmax * 0.9, T0:op.thrust, pitchSpeed:op.pitchSpeed, Vcruise:vc, batteryWh:model.cells * V_NOMINAL * model.capacity_mAh / 1000, etaProp:0.6, etaMotor:op.eta });
    const st = stabilityAnalysis(Object.assign({}, d, { cg:model.cgPctActual }), g, { cm0:af.cm0 });
    return { SM:st.SM, vs:pf.vs, vLD:pf.vLD, LDmax:pf.LDmax, vmax:pf.vmax, rocMax:pf.rocMax, vClimb:pf.vClimb, cruisePower:pf.cruise.Preq, sinkMin:pf.sinkMin, stallStation:ll.stallStation };
  }
  return { build, trim, suggestThrustAngles, describeThrust, flapTau, inv3, PRESET_RIG, BUILTINS, builtinDesign, predictions, vec:{ add, sub, scl, dot, cross, norm } };
})();
if (typeof module !== 'undefined') module.exports = { SimModel };
