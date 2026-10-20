/* RC Calc core: units, physics formulas, calculator model, airframe geometry. Pure functions, no DOM. */
'use strict';
/* =====================================================================
   1. UNITS: everything stored internally in SI (kg, m, m², m/s, N, kg/m², Ah, m, °C)
   ===================================================================== */
const DIMS = {
  mass:        { label:'Weight',       metric:'g',     imperial:'oz',     units:{ g:{f:0.001,l:'g'}, oz:{f:0.0283495,l:'oz'}, lb:{f:0.453592,l:'lb'}, kg:{f:1,l:'kg'} } },
  length:      { label:'Length',       metric:'mm',    imperial:'in',     units:{ mm:{f:0.001,l:'mm'}, cm:{f:0.01,l:'cm'}, in:{f:0.0254,l:'in'} } },
  area:        { label:'Area',         metric:'dm2',   imperial:'in2',    units:{ dm2:{f:0.01,l:'dm²'}, cm2:{f:1e-4,l:'cm²'}, in2:{f:0.00064516,l:'in²'}, ft2:{f:0.092903,l:'ft²'} } },
  speed:       { label:'Speed',        metric:'m/s',   imperial:'mph',    units:{ 'm/s':{f:1,l:'m/s'}, 'km/h':{f:0.277778,l:'km/h'}, mph:{f:0.44704,l:'mph'}, knots:{f:0.514444,l:'knots'} } },
  force:       { label:'Thrust',       metric:'gf',    imperial:'ozf',    units:{ gf:{f:1/101.972,l:'gf'}, ozf:{f:28.3495/101.972,l:'ozf'}, N:{f:1,l:'N'}, lbf:{f:453.592/101.972,l:'lbf'} } },
  wingLoading: { label:'Wing loading', metric:'g/dm2', imperial:'oz/ft2', units:{ 'g/dm2':{f:0.1,l:'g/dm²'}, 'oz/ft2':{f:0.30515,l:'oz/ft²'} } },
  capacity:    { label:'Capacity',     metric:'mAh',   imperial:'mAh',    units:{ mAh:{f:0.001,l:'mAh'}, Ah:{f:1,l:'Ah'} } },
  altitude:    { label:'Altitude',     metric:'m',     imperial:'ft',     units:{ m:{f:1,l:'m'}, ft:{f:0.3048,l:'ft'} } },
  temperature: { label:'Temperature',  metric:'C',     imperial:'F',      units:{ C:{to:v=>v,from:v=>v,l:'°C'}, F:{to:v=>(v-32)*5/9,from:v=>v*9/5+32,l:'°F'} } },
};
function toSI(dim, unit, v){ const u = DIMS[dim].units[unit]; return u.to ? u.to(v) : v * u.f; }
function fromSI(dim, unit, v){ const u = DIMS[dim].units[unit]; return u.from ? u.from(v) : v / u.f; }
function unitLabel(dim, unit){ return DIMS[dim].units[unit].l; }

/* =====================================================================
   2. PHYSICS: small pure functions (units noted in names/args)
   ===================================================================== */
const G = 9.81, RHO_SL = 1.225, V_NOMINAL = 3.7;
/** Air density (kg/m³) from temperature (°C), field elevation (m), QNH (hPa) and height above the field (m). */
function airDensity(tempC = 15, elevation = 0, qnh = 1013.25, alt = 0){
  const h = elevation + Math.max(0, alt), T = tempC + 273.15 - 0.0065 * Math.max(0, alt), p = qnh * 100 * Math.pow(1 - 2.25577e-5 * h, 5.25588);
  return p / (287.05 * T);
}
/** ISA altitude (m) with the same density. */
function densityAltitude(rho){ return (1 - Math.pow(rho / RHO_SL, 1 / 4.25588)) / 2.25577e-5; }
const Phys = {
  wingLoading: (auw_g, area_dm2) => auw_g / area_dm2,                                   // g/dm²
  densityFromAltitude: (alt_m) => RHO_SL * Math.pow(1 - 2.25577e-5 * alt_m, 4.25588),  // kg/m³ (ISA)
  densityFromAltTemp: (alt_m, tempC) => 101325 * Math.pow(1 - 2.25577e-5 * alt_m, 5.25588) / (287.05 * (tempC + 273.15)),
  isaTemperature: (alt_m) => 15 - 0.0065 * alt_m,
  stallSpeed: (auw_kg, area_m2, rho = RHO_SL, clmax = 1.0) => Math.sqrt(2 * auw_kg * G / (rho * area_m2 * clmax)),
  cruiseSpeed: (vStall, factor = 1.4) => vStall * factor,
  targetPower: (auw_kg, wPerKg) => auw_kg * wPerKg,
  loadedVoltage: (cells, vPerCell = 3.5) => cells * vPerCell,
  current: (power_W, volts) => power_W / volts,
  requiredC: (current_A, capacity_mAh) => current_A / (capacity_mAh / 1000),
  recommendedC: (reqC, margin = 1.5) => Math.ceil(margin * reqC - 1e-9),
  flightTimeMin: (capacity_Ah, avgCurrent_A, usable = 0.8) => capacity_Ah * usable / avgCurrent_A * 60,
  loadedRPM: (kv, cells, loadFactor = 0.8, vPerCell = V_NOMINAL) => loadFactor * kv * (cells * vPerCell),
  pitchSpeed: (rpm, pitch_in) => rpm * pitch_in * 0.0254 / 60,                           // m/s
  propPower: (rpm, diam_in, cp = 0.04, rho = RHO_SL) => { const n = rpm / 60, D = diam_in * 0.0254; return cp * rho * n ** 3 * D ** 5; },
  rpmForPower: (power_W, diam_in, cp = 0.04, rho = RHO_SL) => 60 * Math.cbrt(power_W / (cp * rho * (diam_in * 0.0254) ** 5)),
  discArea: (diam_in) => Math.PI / 4 * (diam_in * 0.0254) ** 2,
  staticThrust: (power_W, diam_in, rho = RHO_SL, fm = 0.5) => Math.pow(fm * power_W * Math.sqrt(2 * rho * Phys.discArea(diam_in)), 2 / 3), // N
  thrustToWeight: (thrust_N, auw_kg) => thrust_N / (auw_kg * G),
  motorWeight: (power_W, wPerGram = 3.3, margin = 1.5) => margin * power_W / wPerGram,   // g
  escAmps: (current_A, factor) => Math.ceil(factor * current_A - 1e-9),
  aspectRatio: (span_m, area_m2) => span_m * span_m / area_m2,
  mac: (cr, ct) => { const l = ct / cr; return 2 / 3 * cr * (1 + l + l * l) / (1 + l); },
  macSpanPos: (b, cr, ct) => { const l = ct / cr; return b / 6 * (1 + 2 * l) / (1 + l); },
  tailVolumeH: (Sh, lh, S, mac) => Sh * lh / (S * mac),
  tailVolumeV: (Sv, lv, S, b) => Sv * lv / (S * b),
};

/* Editable reference constants */
const STYLES = {
  trainer:   { label:'Gentle trainer', wPerKg:150, wRange:[100,150], tw:[0.5,0.8], wlMax:30 },
  sport:     { label:'Sport',          wPerKg:200, wRange:[150,250], tw:[0.9,1.2], wlMax:45 },
  aerobatic: { label:'Aerobatic',      wPerKg:300, wRange:[250,400], tw:[1.5,2.5], wlMax:50 },
  glider:    { label:'Powered glider', wPerKg:100, wRange:[80,120],  tw:[0.3,0.6], wlMax:25 },
};
const REFERENCE_MOTORS = [ // reference classes, check local availability
  { name:'E-flite Park 180', mass:8.5, kv:2200, maxW:30,  contA:null, props:'3×3 to 6×3 on 2S' },
  { name:'E-flite Park 300', mass:24,  kv:1380, maxW:85,  contA:7,    props:'up to 10×3.8 on 2S' },
  { name:'E-flite Park 370', mass:45,  kv:1360, maxW:150, contA:12,   props:'8×3.8 to 10×4.7' },
];
const PROPS = [ {d:5,p:3}, {d:6,p:3}, {d:6,p:4}, {d:7,p:3.5}, {d:8,p:3.8}, {d:9,p:4.7}, {d:10,p:4.7} ];
const ESC_SIZES = [6,10,12,15,20,25,30,35,40,50,60,70,80,100,120,150];
const CONTROLS = {
  re:     { label:'Rudder + elevator (3-channel trainer)',            servos:2, channels:3, surf:'none' },
  ae:     { label:'Ailerons (1 servo) + elevator',                    servos:2, channels:3, surf:'ailerons' },
  aer1:   { label:'Ailerons (1 servo) + elevator + rudder',           servos:3, channels:4, surf:'ailerons' },
  aer2:   { label:'Ailerons (2 servos, Y-lead) + elevator + rudder',  servos:4, channels:4, surf:'ailerons' },
  elevon: { label:'Elevons (flying wing, mixed)',                     servos:2, channels:3, surf:'elevons' },
};

function propShortlist(o){
  const all = o.props.map(pr => {
    let rpm, power, kv = null;
    if (o.kv) { rpm = Phys.loadedRPM(o.kv, o.cells, o.rpmFactor); power = Phys.propPower(rpm, pr.d, o.cp, o.rho); }
    else { rpm = Phys.rpmForPower(o.targetPower, pr.d, o.cp, o.rho); power = o.targetPower; kv = rpm / (o.rpmFactor * o.cells * V_NOMINAL); }
    const ps = Phys.pitchSpeed(rpm, pr.p), ratio = ps / o.cruise, reasons = [];
    if (ratio < 1.5) reasons.push('pitch speed low'); else if (ratio > 2.0) reasons.push('pitch speed high');
    if (power > o.motorMax) reasons.push('over motor limit');
    if (kv != null && (kv < 300 || kv > 4000)) reasons.push('unusual KV');
    return { d:pr.d, p:pr.p, rpm, power, kv, ps, ratio, ok: !reasons.length, reasons };
  });
  const score = o.kv ? r => Math.abs(r.power - o.targetPower) : r => Math.abs(r.ratio - 1.75);
  const ranked = all.filter(r => r.ok).sort((a, b) => score(a) - score(b));
  const closest = [...all].sort((a, b) => Math.abs(a.ratio - 1.75) - Math.abs(b.ratio - 1.75))[0];
  return { all, ranked, closest, mode: o.kv ? 'kv' : 'suggest' };
}

/* computeAll: pure. Input in SI (+ inches for props). Returns results and warnings. */
function computeAll(i){
  const st = STYLES[i.style] || STYLES.trainer;
  const wpk = i.wPerKg > 0 ? i.wPerKg : st.wPerKg;
  const R = { style: st, wpk };
  R.wl = Phys.wingLoading(i.auw_kg * 1000, i.area_m2 * 100);
  R.vs = Phys.stallSpeed(i.auw_kg, i.area_m2, i.rho, i.clmax);
  R.vc = Phys.cruiseSpeed(R.vs, i.cruiseFactor);
  R.P = Phys.targetPower(i.auw_kg, wpk);
  R.Pmin = i.auw_kg * st.wRange[0];
  R.V = Phys.loadedVoltage(i.cells, i.vCell);
  R.I = Phys.current(R.P, R.V);
  R.reqC = Phys.requiredC(R.I, i.cap_Ah * 1000);
  R.recC = Phys.recommendedC(R.reqC, 1.5);
  R.tFull = Phys.flightTimeMin(i.cap_Ah, R.I, i.usable);
  R.Iavg = R.I * i.throttle;
  R.tAvg = Phys.flightTimeMin(i.cap_Ah, R.Iavg, i.usable);
  R.motorRating = 1.5 * R.P;
  R.motorW = Phys.motorWeight(R.P, 3.3, 1.5);
  R.motorRef = REFERENCE_MOTORS.find(m => m.maxW >= R.motorRating) || null;
  R.escMin = Phys.escAmps(R.I, 1.25); R.escMax = Phys.escAmps(R.I, 1.5);
  R.escRec = ESC_SIZES.find(a => a >= R.escMax) || R.escMax;
  const userKV = i.kv > 0, userProp = i.propD > 0 && i.propP > 0;
  R.shortlist = propShortlist({ props:PROPS, kv: userKV ? i.kv : null, cells:i.cells, rpmFactor:i.rpmFactor, cp:i.cp, rho:i.rho, targetPower:R.P, cruise:R.vc, motorMax:R.motorRating });
  const pick = R.shortlist.ranked[0] || R.shortlist.closest;
  R.prop = userProp ? { d:i.propD, p:i.propP, src:'user' } : { d:pick.d, p:pick.p, src:'suggested' };
  if (userKV) { R.kv = i.kv; R.kvSrc = 'user'; }
  else { R.kv = Math.round(Phys.rpmForPower(R.P, R.prop.d, i.cp, i.rho) / (i.rpmFactor * i.cells * V_NOMINAL) / 10) * 10; R.kvSrc = 'suggested'; }
  R.rpm = Phys.loadedRPM(R.kv, i.cells, i.rpmFactor);
  R.pitchSpeed = Phys.pitchSpeed(R.rpm, R.prop.p);
  R.pitchRatio = R.pitchSpeed / R.vc;
  R.propPower = Phys.propPower(R.rpm, R.prop.d, i.cp, i.rho);
  R.Pthrust = Math.min(R.P, R.propPower);
  R.thrust = Phys.staticThrust(R.Pthrust, R.prop.d, i.rho, i.fm);
  R.tw = Phys.thrustToWeight(R.thrust, i.auw_kg);
  const ctl = CONTROLS[i.controls] || CONTROLS.re;
  R.controls = ctl;
  R.servos = ctl.servos + (i.flaps ? 2 : 0);
  R.channels = ctl.channels + (i.flaps ? 1 : 0);
  R.ar = i.span_m > 0 ? Phys.aspectRatio(i.span_m, i.area_m2) : null;
  R.warnings = buildWarnings(i, R);
  return R;
}

function buildWarnings(i, R){
  const w = [], st = R.style, f = (v, d) => fmt(v, d), prop = `${R.prop.d}×${R.prop.p}`;
  if (i.auw_kg * 1000 >= 250) w.push({ lvl:'info', learn:'learn-auw', text:`AUW is ${f(i.auw_kg*1000,0)} g, which is 250 g or more. Many countries require registration and/or Remote ID at this weight. Check local regulations.` });
  if (R.wl > st.wlMax) w.push({ lvl:'warn', learn:'learn-wingloading', key:'wl', text:`High wing loading (${f(R.wl,1)} g/dm²) for a ${st.label.toLowerCase()}. Above about ${st.wlMax} g/dm² it lands fast and stalls abruptly. Add wing area or reduce weight.` });
  if (R.pitchRatio < 1.5) w.push({ lvl:'warn', learn:'learn-prop', key:'ps', text:`Pitch speed is only ${f(R.pitchRatio,2)}× cruise (aim for 1.5–2.0×). The plane may feel sluggish. Use more pitch or a higher KV.` });
  else if (R.pitchRatio > 2.0) w.push({ lvl:'warn', learn:'learn-prop', key:'ps', text:`Pitch speed is ${f(R.pitchRatio,2)}× cruise (aim for 1.5–2.0×). That is fast, but the prop is partly stalled at launch. Consider less pitch or a lower KV.` });
  if (i.cRating > 0) {
    if (i.cRating < R.reqC) w.push({ lvl:'warn', learn:'learn-crating', key:'C', text:`Battery C rating ${f(i.cRating,0)}C is below the required ${f(R.reqC,1)}C. The pack will sag, heat up and may be damaged. Use at least ${R.recC}C.` });
    else if (i.cRating < R.recC) w.push({ lvl:'warn', learn:'learn-crating', key:'C', text:`Battery C rating ${f(i.cRating,0)}C is too low: it is below the recommended ${R.recC}C (1.5× margin over ${f(R.reqC,1)}C).` });
  }
  if (R.propPower > R.motorRating) w.push({ lvl:'warn', learn:'learn-prop', key:'pp', text:`At ${f(R.rpm,0)} RPM the ${prop} prop absorbs about ${f(R.propPower,0)} W, more than the ${f(R.motorRating,0)} W motor rating, so the motor, ESC and battery may overheat. Use a smaller prop or a lower KV.` });
  if (R.kvSrc === 'user' && R.propPower < R.Pmin) w.push({ lvl:'warn', learn:'learn-power', key:'pp', text:`Power is too low: the ${prop} prop absorbs only about ${f(R.propPower,0)} W at ${f(R.rpm,0)} RPM. That is below the ${f(R.Pmin,0)} W minimum for a ${st.label.toLowerCase()}. Use a larger prop or a higher KV.` });
  if (R.tw < st.tw[0]) w.push({ lvl:'warn', learn:'learn-thrust', key:'tw', text:`Thrust-to-weight ${f(R.tw,2)} is below the ${st.tw[0]}–${st.tw[1]} target for a ${st.label.toLowerCase()}.` });
  if (R.tFull < 4) w.push({ lvl:'warn', learn:'learn-flighttime', key:'tFull', text:`Full-throttle flight time is under 4 minutes. Consider a larger pack (and watch the weight).` });
  if (!R.shortlist.ranked.length) w.push({ lvl:'warn', learn:'learn-prop', text:`No prop in the built-in list meets both the pitch-speed and power limits. The closest option is used.` });
  if (R.kvSrc === 'suggested') w.push({ lvl:'info', learn:'learn-kv', text:`No motor KV entered. Using a suggested ${f(R.kv,0)} KV, chosen so the ${prop} prop absorbs about the target power.` });
  if (R.prop.src === 'suggested') w.push({ lvl:'info', learn:'learn-prop', text:`No prop entered. Using the top shortlist prop, ${prop}.` });
  if (i.cells >= 4) w.push({ lvl:'info', learn:'learn-esc', text:`On ${i.cells}S, built-in linear BECs often overheat. Use an ESC with a switching BEC, or a separate UBEC.` });
  return w;
}

/* =====================================================================
   3. AIRFRAME GEOMETRY: pure (all lengths in m, angles in degrees)
   ===================================================================== */
const PRESETS = {
  trainer:    { label:'Conventional high-wing trainer', body:'fuse',  ar:6,   taper:1.0,  sweep:0,  dihedral:5, mount:'high', motor:'tractor', hRatio:0.22, hAR:3.5, vRatio:0.09, vAR:1.3, vh:0.5,  nose:0.17, cg:28 },
  lowwing:    { label:'Low-wing sport',                 body:'fuse',  ar:6.5, taper:0.7,  sweep:3,  dihedral:2, mount:'low',  motor:'tractor', hRatio:0.22, hAR:3.6, vRatio:0.09, vAR:1.3, vh:0.5,  nose:0.2,  cg:28 },
  flyingwing: { label:'Flying wing',                    body:'pod',   ar:5,   taper:0.45, sweep:28, dihedral:0, mount:'mid',  motor:'pusher',  hRatio:0,    hAR:0,   vRatio:0.06, vAR:1.6, vh:0,    nose:0,    cg:25, podLen:1.3 },
  chuck:      { label:'Chuck-glider style',             body:'stick', ar:7,   taper:0.8,  sweep:0,  dihedral:6, mount:'high', motor:'pusher',  hRatio:0.2,  hAR:3,   vRatio:0.08, vAR:1.4, vh:0.45, nose:0.12, cg:30 },
};
const BODIES = { fuse:{ hf:0.12, wf:0.085 }, stick:{ hf:0.035, wf:0.02 }, pod:{ hf:0.17, wf:0.15 } };

function autoProportion(presetKey, span, style, area){
  const p = Object.assign({}, PRESETS[presetKey] || PRESETS.trainer);
  if (p.hRatio > 0) {
    if (style === 'aerobatic') { p.hRatio = 0.25; p.vRatio = 0.10; p.dihedral = Math.min(p.dihedral, 1); }
    else if (style === 'sport') { p.dihedral = Math.min(p.dihedral, 3); }
    else if (style === 'glider') { p.dihedral = Math.max(p.dihedral, 6); }
  }
  const b = span, S = area > 0 ? area : b * b / p.ar;
  const cr = 2 * S / (b * (1 + p.taper)), ct = p.taper * cr;
  const mac = Phys.mac(cr, ct), xMacOff = Phys.macSpanPos(b, cr, ct) * Math.tan(p.sweep * Math.PI / 180);
  const d = { preset:presetKey, span:b, rootChord:cr, tipChord:ct, sweep:p.sweep, dihedral:p.dihedral, motorPos:p.motor, wingMount:p.mount, cg:p.cg };
  if (p.hRatio > 0) {
    const Sh = p.hRatio * S; d.hSpan = Math.sqrt(Sh * p.hAR); d.hChord = Sh / d.hSpan;
    d.tailArm = p.vh * S * mac / Sh;
    d.fuseLen = p.nose * b + xMacOff + 0.25 * mac + d.tailArm + 0.75 * d.hChord;
  } else { d.hSpan = 0; d.hChord = 0; d.tailArm = 0; d.fuseLen = p.podLen * cr; }
  // Fin area starts at vRatio × S, then grows if needed so V_v reaches about 0.035 (short arms / high AR).
  const fins = p.hRatio > 0 ? 1 : 2;
  let Sv = p.vRatio * S;
  for (let k = 0; k < 4; k++) {
    d.vChord = Math.sqrt(Sv / fins / (0.775 * p.vAR)); d.vHeight = p.vAR * d.vChord;
    const lv = airframeGeometry(d, 0).lv;
    if (lv > 0) Sv = Math.max(p.vRatio * S, 0.035 * S * b / lv);
  }
  d.vChord = Math.sqrt(Sv / fins / (0.775 * p.vAR)); d.vHeight = p.vAR * d.vChord;
  return d;
}

function airframeGeometry(d, propD_m){
  const b = d.span, cr = d.rootChord, ct = d.tipChord, Lf = d.fuseLen, sw = d.sweep * Math.PI / 180;
  const body = BODIES[(PRESETS[d.preset] || PRESETS.trainer).body];
  const g = { body:(PRESETS[d.preset] || PRESETS.trainer).body };
  g.S = b * (cr + ct) / 2; g.mac = Phys.mac(cr, ct); g.yMac = Phys.macSpanPos(b, cr, ct); g.xMacOff = g.yMac * Math.tan(sw);
  g.AR = Phys.aspectRatio(b, g.S);
  g.tailless = !(d.hSpan > 0 && d.hChord > 0);
  g.tipZoff = b / 2 * Math.tan(d.dihedral * Math.PI / 180);
  g.Sh = g.tailless ? 0 : d.hSpan * d.hChord;
  g.fins = g.tailless ? 2 : 1;
  g.Sv = g.fins * 0.775 * d.vHeight * d.vChord;
  if (!g.tailless) {
    g.xhLE = Lf - d.hChord;
    const xMacQC = g.xhLE + 0.25 * d.hChord - d.tailArm;
    g.xwLE = xMacQC - 0.25 * g.mac - g.xMacOff;
    g.lh = d.tailArm;
    g.xvLE = Lf - d.vChord;
  } else {
    g.xwLE = Lf * 0.98 - cr;
    g.xvLE = g.xwLE + b / 2 * Math.tan(sw) + ct - d.vChord; // tip fins / winglets
  }
  g.xMacLE = g.xwLE + g.xMacOff; g.xMacQC = g.xMacLE + 0.25 * g.mac;
  g.lv = g.xvLE + 0.25 * d.vChord - g.xMacQC;
  g.Vh = g.tailless ? null : Phys.tailVolumeH(g.Sh, g.lh, g.S, g.mac);
  g.Vv = Phys.tailVolumeV(g.Sv, g.lv, g.S, b);
  g.xcg = g.xMacLE + d.cg / 100 * g.mac;
  g.band = [g.xMacLE + 0.25 * g.mac, g.xMacLE + 0.33 * g.mac];
  g.hf = body.hf * Lf; g.wf = body.wf * Lf;
  g.wingZ = d.wingMount === 'high' ? g.hf / 2 + 0.01 * cr : d.wingMount === 'low' ? -g.hf * 0.42 : 0;
  g.hTailZ = g.body === 'stick' ? g.hf / 2 : g.hf * 0.1;
  g.vBaseZ = g.body === 'stick' ? g.hf / 2 + 0.03 * (d.hChord || cr) : g.tailless ? g.wingZ + g.tipZoff + 0.04 * ct : g.hf * 0.16;
  const D = propD_m > 0 ? propD_m : 0.2 * b;
  g.D = D; g.mlen = 0.14 * D; g.mdia = 0.12 * D;
  if (d.motorPos === 'pusher') {
    g.propX = g.xwLE + cr + g.mlen + 0.01 * Lf;
    g.propZ = g.body === 'pod' ? g.wingZ : Math.max(g.hf / 2, g.wingZ) + D / 2 + 0.01 * Lf;
  } else { g.propX = -0.03 * Lf; g.propZ = 0; }
  return g;
}

/* Control surfaces: one shared spec (fractions of chord / semispan, throws in degrees) used by the diagram,
   3D model, templates and simulator. Missing values fall back to these defaults. */
const SURFACE_DEFAULTS = { ailCf:0.25, ailStart:0.5, ailEnd:0.95, elevonCf:0.22, elevonStart:0.14, elevonEnd:0.92,
  flaps:false, flapCf:0.25, flapStart:0.1, flapEnd:0.46, eleCf:0.35, rudCf:0.35, throwAil:null, throwEle:null, throwRud:null, throwFlap:25 };
function surfaceSpec(d){
  const s = Object.assign({}, SURFACE_DEFAULTS, (d && d.surfaces) || {}), cl = (v, a, b, def) => (typeof v === 'number' && isFinite(v)) ? Math.max(a, Math.min(b, v)) : def;
  for (const k of ['ailCf', 'elevonCf', 'flapCf', 'eleCf', 'rudCf']) s[k] = cl(s[k], 0.1, 0.5, SURFACE_DEFAULTS[k]);
  for (const p of ['ail', 'elevon', 'flap']) { s[p + 'Start'] = cl(s[p + 'Start'], 0, 0.9, SURFACE_DEFAULTS[p + 'Start']); s[p + 'End'] = cl(s[p + 'End'], s[p + 'Start'] + 0.05, 1, Math.max(s[p + 'Start'] + 0.05, SURFACE_DEFAULTS[p + 'End'])); }
  if (s.flaps && s.flapEnd > s.ailStart - 0.02 && s.ailStart > s.flapStart) s.flapEnd = Math.max(s.flapStart + 0.05, s.ailStart - 0.02); // flaps stop inboard of the ailerons
  for (const k of ['throwAil', 'throwEle', 'throwRud', 'throwFlap']) s[k] = (typeof s[k] === 'number' && isFinite(s[k])) ? Math.max(0, Math.min(60, s[k])) : (k === 'throwFlap' ? 25 : null);
  s.flaps = !!s.flaps; return s;
}

/* Formatting helpers (pure) */
function fmt(v, d = 1){ return (v == null || !isFinite(v)) ? '—' : v.toLocaleString('en-US', { minimumFractionDigits:d, maximumFractionDigits:d }); }
function smartDec(v){ const a = Math.abs(v); return a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3; }
function fmtS(v){ return (v == null || !isFinite(v)) ? '—' : fmt(v, smartDec(v)); }
function fmtInput(v){ return (v == null || !isFinite(v)) ? '' : String(+v.toPrecision(6)); }
function esc(s){ return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }

if (typeof module !== 'undefined') module.exports = { DIMS, toSI, fromSI, unitLabel, G, RHO_SL, V_NOMINAL, airDensity, densityAltitude, Phys, STYLES, REFERENCE_MOTORS, PROPS, ESC_SIZES, CONTROLS, propShortlist, computeAll, buildWarnings, PRESETS, BODIES, autoProportion, airframeGeometry, SURFACE_DEFAULTS, surfaceSpec, fmt, smartDec, fmtS, fmtInput, esc };
