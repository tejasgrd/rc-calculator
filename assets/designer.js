/* RC Calc: Aircraft Designer page UI. Uses rc-common, rc-core, rc-diagram, rc-aero, rc-templates, rc-3d, rc-charts. */
'use strict';
(function(){
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const icon = RC.icon;
let sys = RC.unitSystem();
const UNITS = () => sys === 'imperial'
  ? { mass:'oz', length:'in', speed:'mph', area:'in2', wingLoading:'oz/ft2', force:'ozf', altitude:'ft' }
  : { mass:'g', length:'mm', speed:'m/s', area:'dm2', wingLoading:'g/dm2', force:'gf', altitude:'m' };
const conv = (dim, v) => fromSI(dim, UNITS()[dim], v);
const ul = dim => unitLabel(dim, UNITS()[dim]);
const show = (dim, v, d) => (v == null || !isFinite(v)) ? '—' : `${d != null ? fmt(conv(dim, v), d) : fmtS(conv(dim, v))} ${ul(dim)}`;
const CAT = { light:['#2a78d6','#eb6834','#1baf7a','#eda100','#e87ba4','#008300','#4a3aa7','#e34948'], dark:['#3987e5','#d95926','#199e70','#c98500','#d55181','#008300','#9085e9','#e66767'] };

/* ---------------- state ---------------- */
function defaultDesign(){
  const geom = Object.assign(autoProportion('trainer', 1.0, 'trainer', 1 / 6.5), { washout:0, surfaces:Object.assign({}, SURFACE_DEFAULTS) });
  return { v:1, name:'My trainer',
    req:{ mission:'trainer', preset:'trainer', payload_kg:0, stall_ms:null, span_m:1.0, flightMin:8, cells:'auto', material:'depron', keep250:false, budget:150, currency:'$' },
    airfoilId:'clarky', customAirfoil:null, geom, auw:0.16, sizing:null, power:null, perf:{ etaProp:0.6, etaMotor:0.75, gear:false, tempC:15, elevation:0 },
    smTarget:0.1, cells:2, capacity_mAh:450, maxPropD:11, panels:null, measured:{ use:false, auw_kg:null, cg_m:null } };
}
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
function merge(base, src){ if (!isObj(src)) return base; for (const k of Object.keys(src)) { if (isObj(base[k]) && isObj(src[k])) merge(base[k], src[k]); else if (src[k] !== undefined && (base[k] === null || base[k] === undefined || src[k] === null || typeof src[k] === typeof base[k] || isObj(src[k]))) base[k] = src[k]; } return base; }
function sanitize(d){
  if (!MISSIONS[d.req.mission]) d.req.mission = 'trainer';
  if (!PRESETS[d.req.preset]) d.req.preset = MISSIONS[d.req.mission].preset;
  if (!PRESETS[d.geom.preset]) d.geom.preset = 'trainer';
  if (!MATERIALS[d.req.material]) d.req.material = 'depron';
  if (d.airfoilId !== 'custom' && !Airfoil.PRESETS.some(a => a.id === d.airfoilId)) d.airfoilId = 'clarky';
  if (d.airfoilId === 'custom' && !(d.customAirfoil && Array.isArray(d.customAirfoil.points))) d.airfoilId = 'clarky';
  for (const k of ['span','rootChord','tipChord','fuseLen','vHeight','vChord']) if (!(d.geom[k] > 0)) d.geom[k] = defaultDesign().geom[k];
  for (const k of ['sweep','dihedral','washout','cg','hSpan','hChord','tailArm']) if (!isFinite(d.geom[k])) d.geom[k] = k === 'cg' ? 28 : 0;
  if (!(d.auw > 0)) d.auw = 0.16;
  d.geom.surfaces = Object.assign({}, SURFACE_DEFAULTS, d.geom.surfaces || {});
  d.measured = Object.assign({ use:false, auw_kg:null, cg_m:null }, d.measured || {});
  d.cells = Math.max(1, Math.min(6, Math.round(+d.cells || 2)));
  return d;
}
let design = sanitize(merge(defaultDesign(), RC.readHash('design') || RC.store.get(RC.KEYS.design)));
const firstRun = !RC.readHash('design') && !RC.store.get(RC.KEYS.design);
const getPath = (o, p) => p.split('.').reduce((a, k) => a == null ? a : a[k], o);
const setPath = (o, p, v) => { const ks = p.split('.'), last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };
const allMotors = () => MOTOR_DB.concat(RC.store.get(RC.KEYS.motors, []) || []);
const currentAirfoil = () => Airfoil.get(design.airfoilId, design.customAirfoil);
const style = () => MISSIONS[design.req.mission].style;

/* ---------------- analysis pipeline ---------------- */
let A = null;
const fieldRho = dz => airDensity(dz.perf && dz.perf.tempC != null ? dz.perf.tempC : 15, dz.perf && dz.perf.elevation != null ? dz.perf.elevation : 0);
function analyze(dz = design){
  dz = asBuilt(dz);
  const af = Airfoil.get(dz.airfoilId, dz.customAirfoil), d = dz.geom, ms = MISSIONS[dz.req.mission], rho = fieldRho(dz);
  const motor = dz.power ? allMotors().find(m => m.id === dz.power.motorId) : null;
  const power = motor ? { motor, cells:dz.power.cells, prop:dz.power.prop } : null;
  const propD = power ? power.prop.d : null;
  const g0 = airframeGeometry(d, (propD || 8) * 0.0254);
  const controls = g0.tailless ? 'elevon' : (dz.req.mission === 'trainer' || dz.req.mission === 'glider') ? 're' : 'aer2';
  const inp = { auw_kg:dz.auw, area_m2:g0.S, span_m:d.span, style:ms.style, wPerKg:ms.wpk || null, cells:power ? power.cells : dz.cells, cap_Ah:dz.capacity_mAh / 1000, cRating:null,
    kv:motor ? motor.kv : null, propD:propD, propP:power ? power.prop.p : null, clmax:af.clmax * SIZING.clFactor3D, rho:RHO_SL, vCell:3.5, rpmFactor:0.8, cp:0.04, fm:0.5, usable:0.8, cruiseFactor:1.4, throttle:0.5, controls, flaps:false };
  inp.rho = rho;
  const R = computeAll(inp);
  const g = airframeGeometry(d, R.prop.d * 0.0254);
  const W = dz.auw * G, CLc = W / (0.5 * rho * R.vc * R.vc * g.S);
  const stab = stabilityAnalysis(d, g, { smTarget:dz.smTarget, cm0:af.cm0, CLcruise:CLc });
  const ll = liftingLine({ b:d.span, cr:d.rootChord, ct:d.tipChord, washoutDeg:d.washout || 0, a0:2 * Math.PI * 0.9, alpha0Deg:af.alpha0Deg, CL:CLc, clmax2D:af.clmax });
  const op = power ? motorOperatingPoint({ motor, cells:power.cells, capacity_mAh:dz.capacity_mAh, prop:power.prop, rho }) : null;
  const C = dz.calibration && dz.calibration.factors && dz.calibration.applyDesigner !== false ? Object.assign({ cd0:1, clmax:1, thrust:1, current:1 }, dz.calibration.factors) : null, k = C || { cd0:1, clmax:1, thrust:1, current:1 };
  const pf = flightPerformance({ W, S:g.S, AR:g.AR, mac:g.mac, rho, e:Math.min(0.95, ll.e) * 0.93, cd0Airfoil:af.cd0 * k.cd0, Sh:g.Sh * k.cd0, Sv:g.Sv * k.cd0, frontalArea:g.wf * g.hf * k.cd0, body:g.body, gear:dz.perf.gear,
    CLmax:(ll.CLmax3D || af.clmax * 0.9) * k.clmax, T0:(op ? op.thrust : R.thrust) * k.thrust, pitchSpeed:op ? op.pitchSpeed : R.pitchSpeed, Vcruise:R.vc, batteryWh:inp.cells * V_NOMINAL * dz.capacity_mAh / 1000 / k.current,
    etaProp:dz.perf.etaProp, etaMotor:op ? op.eta : dz.perf.etaMotor });
  return { af, d, g, inp, R, W, CLc, stab, ll, op, power, pf, controls, calibrated:!!C, rho };
}

/* ---------------- field binding ---------------- */
function syncFields(){
  const act = document.activeElement;
  $$('[data-path]').forEach(el => {
    if (el === act && el.type !== 'checkbox' && el.tagName !== 'SELECT') return;
    const v = getPath(design, el.dataset.path);
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el.tagName === 'SELECT') el.value = String(v);
    else if (el.dataset.dim) el.value = v == null ? '' : String(+conv(el.dataset.dim, v).toPrecision(4));
    else if (el.dataset.scale) el.value = v == null ? '' : String(+(v * +el.dataset.scale).toPrecision(4));
    else el.value = v == null ? '' : (typeof v === 'number' ? String(+v.toPrecision(5)) : v);
    el.removeAttribute('aria-invalid');
  });
  $$('[data-u]').forEach(s => { s.textContent = `(${ul(s.dataset.u)})`; });
  $$('input[name=unitSystem]').forEach(r => { r.checked = r.value === sys; });
}
function onField(e){
  const el = e.target, path = el.dataset.path; if (!path) return;
  let v;
  if (el.type === 'checkbox') v = el.checked;
  else if (el.tagName === 'SELECT') v = ['cells', 'smTarget'].includes(path) ? +el.value : (path === 'req.cells' && el.value !== 'auto') ? +el.value : el.value;
  else if (el.type === 'text') v = el.value.slice(0, 60);
  else {
    const s = el.value.trim();
    if (s === '') { if ('optional' in el.dataset) v = null; else { el.setAttribute('aria-invalid', 'true'); return; } }
    else { const n = Number(s), mn = el.min !== '' ? +el.min : -Infinity, mx = el.max !== '' ? +el.max : Infinity;
      if (!isFinite(n) || n < mn || n > mx || (el.dataset.dim && n <= 0 && path !== 'req.payload_kg' && path !== 'measured.cg_m' && path !== 'perf.elevation')) { el.setAttribute('aria-invalid', 'true'); return; }
      v = el.dataset.dim ? toSI(el.dataset.dim, UNITS()[el.dataset.dim], n) : el.dataset.scale ? n / +el.dataset.scale : n; }
  }
  el.removeAttribute('aria-invalid');
  setPath(design, path, v);
  if (path === 'req.mission') { design.req.preset = MISSIONS[v].preset; syncFields(); }
  if (path === 'geom.preset') { const S = airframeGeometry(design.geom, 0.2).S, keep = { cg:design.geom.cg, washout:design.geom.washout };
    design.geom = Object.assign(autoProportion(v, design.geom.span, style(), S), keep, { surfaces:design.geom.surfaces }); syncFields(); }
  if (path === 'cells' || path === 'capacity_mAh' || path === 'maxPropD') design.power = null;
  if (path.startsWith('req.') || path === 'name') { save(); renderSizing(); return; }
  schedule();
}
let timer = null;
function schedule(){ clearTimeout(timer); timer = setTimeout(renderAnalyses, 140); }

/* ---------------- sizing ---------------- */
function runSizing(){
  const af = currentAirfoil(), q = design.req;
  const sz = sizeAircraft({ mission:q.mission, preset:q.preset, payload_kg:q.payload_kg || 0, stall_ms:q.stall_ms, span_m:q.span_m, flightMin:q.flightMin, cells:q.cells, material:q.material, clmax:af.clmax, maxAuw_kg:q.keep250 ? 0.249 : null });
  design.sizing = { auw:sz.auw, S:sz.S, b:sz.b, AR:sz.AR, wl:sz.wl, vs:sz.vs, vsTarget:sz.vsTarget, P:sz.P, cells:sz.cells, I:sz.I, escA:sz.escA, capacity_mAh:sz.capacity_mAh, reqC:sz.reqC, recC:sz.recC,
    flightMin:sz.flightMin, breakdown:sz.breakdown, airframe:sz.airframe, warnings:sz.warnings, converged:sz.converged, material:sz.material, controls:sz.controls, mission:sz.mission, style:sz.style, wpk:sz.wpk, clw:sz.clw };
  design.geom = Object.assign({}, sz.geom, { washout:q.preset === 'flyingwing' ? 3 : 0, surfaces:design.geom.surfaces || Object.assign({}, SURFACE_DEFAULTS) });
  design.auw = sz.auw; design.cells = sz.cells; design.capacity_mAh = sz.capacity_mAh; design.power = null; design.panels = null;
  design.maxPropD = Math.max(5, Math.min(14, Math.round(sz.b * (q.preset === 'flyingwing' || q.preset === 'chuck' ? 0.22 : 0.3) / 0.0254)));
  if (q.preset === 'flyingwing') design.airfoilId = design.airfoilId === 'custom' ? 'custom' : 'reflex';
  const a = analyze(); design.geom.cg = Math.round(a.stab.cgRec * 1000) / 10;
  syncFields(); renderSizing(); renderAirfoil(); renderAnalyses();
}

/* ---------------- small render helpers ---------------- */
const TAGS = { physics:'Physics', estimate:'Estimate', rule:'Rule of thumb' };
function stat(label, value, note, tag, cls = ''){ return `<div class="stat ${cls}"><span class="lbl">${esc(label)}${tag ? `<span class="tag tag-${tag}">${TAGS[tag]}</span>` : ''}</span><span class="val">${value}</span>${note ? `<span class="note">${note}</span>` : ''}</div>`; }
const vu = (v, u) => `${v}<small>${u}</small>`;
const showV = (dim, v, d) => vu(d != null ? fmt(conv(dim, v), d) : fmtS(conv(dim, v)), ul(dim));
function warnList(el, items){ el.innerHTML = items.length ? items.map(w => `<li class="${w.lvl}">${icon(w.lvl === 'warn' ? 'warn' : 'info')}<span>${esc(w.text)}</span></li>`).join('') : ''; }
function diagramColors(){ const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim();
  return { paper:v('--d-paper'), grid:v('--d-grid'), gridMajor:v('--d-grid-major'), ink:v('--d-ink'), fill:v('--d-fill'), accent:v('--d-accent'), cg:v('--d-cg'), band:v('--d-band'), dim:v('--d-dim') }; }

function renderSizing(){
  const s = design.sizing, box = $('#size-stats');
  if (!s) { box.innerHTML = `<div class="callout">${icon('info')}<span>Set your requirements and press <b>Size my plane</b>.</span></div>`; $('#bd-bar').innerHTML = ''; $('#bd-table').innerHTML = ''; $('#bd-legend').innerHTML = ''; warnList($('#size-warn'), []); return; }
  box.innerHTML = [
    stat('All-up weight', showV('mass', s.auw), s.auw < 0.25 ? 'under 250 g' : '250 g or more: check rules', 'estimate', s.auw < 0.25 ? 'is-ok' : 'is-warn'),
    stat('Wing area', showV('area', s.S), `span ${show('length', s.b)}`, 'physics'),
    stat('Aspect ratio', fmt(s.AR, 1), 'span² ÷ area', 'physics'),
    stat('Wing loading', showV('wingLoading', s.wl * 0.1), '', 'physics'),
    stat('Stall speed', showV('speed', s.vs), `target ${show('speed', s.vsTarget)} · CL ${fmt(s.clw, 2)}`, 'physics'),
    stat('Target power', vu(fmt(s.P, 0), 'W'), `${s.wpk} W/kg`, 'rule'),
    stat('Battery', vu(`${s.cells}S ${s.capacity_mAh}`, 'mAh'), `≥ ${s.recC}C · ${fmt(s.flightMin, 1)} min design`, 'estimate'),
    stat('ESC', vu(s.escA, 'A'), `${fmt(s.I, 1)} A full throttle`, 'rule'),
  ].join('');
  const mode = RC.effectiveDark() ? 'dark' : 'light';
  let items = s.breakdown.filter(b => b.g > 0.05).sort((a, b) => b.g - a.g);
  if (items.length > 8) { const rest = items.slice(7); items = items.slice(0, 7).concat([{ key:'other', label:'Other', g:rest.reduce((a, b) => a + b.g, 0) }]); }
  const tot = items.reduce((a, b) => a + b.g, 0);
  $('#bd-bar').innerHTML = items.map((b, i) => `<span style="width:${(b.g / tot * 100).toFixed(2)}%;background:${CAT[mode][i]}" title="${esc(b.label)} ${fmt(b.g, 1)} g"></span>`).join('');
  $('#bd-bar').setAttribute('aria-label', 'Weight breakdown: ' + items.map(b => `${b.label} ${fmt(b.g / tot * 100, 0)}%`).join(', '));
  $('#bd-legend').innerHTML = items.map((b, i) => `<span><i style="background:${CAT[mode][i]}"></i>${esc(b.label)}</span>`).join('');
  $('#bd-table').innerHTML = `<thead><tr><th scope="col">Item</th><th scope="col">Weight</th><th scope="col">Share</th></tr></thead><tbody>${s.breakdown.map(b => `<tr><th scope="row">${esc(b.label)}</th><td class="num">${show('mass', b.g / 1000)}</td><td class="num">${fmt(b.g / (s.auw * 1000) * 100, 0)}%</td></tr>`).join('')}<tr><th scope="row">Total</th><td class="num"><b>${show('mass', s.auw)}</b></td><td class="num">100%</td></tr></tbody>`;
  const m = MATERIALS[s.material];
  $('#bd-how').textContent = [`Fixed-point iteration: guess AUW → wing area → geometry → component weights → new AUW (converged: ${s.converged ? 'yes' : 'no'})`,
    `Wing area = max(span² ÷ AR_mission, 2W / (ρ·V_stall²·CL)), CL = ${fmt(s.clw, 2)} (airfoil CLmax × ${SIZING.clFactor3D})`,
    `Airframe (${m.label}): wing ${m.wing} g/dm², tail ${m.tail} g/dm², fuselage ${m.fuse} g/dm² of box surface, + ${SIZING.hardwareFrac * 100}% + ${SIZING.hardware_g} g hardware`,
    `Motor = 1.5 × P ÷ 3.3 W/g; ESC = 2 g + 0.7 g/A; servos ${s.auw < 0.25 ? '4.5' : s.auw < 1 ? '9' : '17'} g each; receiver ${s.auw < 0.25 ? 4 : 7} g`,
    `Battery: energy = P × ${SIZING.avgPowerFrac} (average) × time ÷ ${SIZING.usable} usable, at ${SIZING.whPerGram * 1000} Wh/kg + ${SIZING.cellLeads_g} g per cell; rounded up to a common size`,
    `Wiring/misc = ${SIZING.wiringFrac * 100}% of electronics + 2 g. Constants are editable in assets/rc-aero.js.`].join('\n');
  warnList($('#size-warn'), s.warnings);
}

function airfoilSVG(points, w, h, o = {}){
  const pad = o.pad || 6, sc0 = w - 2 * pad, ys = points.map(p => p[1]), ymin = Math.min(...ys), ymax = Math.max(...ys), sc = Math.min(sc0, (h - 2 * pad) / Math.max(1e-6, ymax - ymin)), mid = h / 2 + ((ymax + ymin) / 2) * sc;
  const P = points.map(([x, y]) => `${(pad + x * sc).toFixed(1)},${(mid - y * sc).toFixed(1)}`).join(' ');
  let extra = '';
  if (o.detail) { const r = Airfoil.resample(points, 60); extra = `<line x1="${pad}" x2="${w - pad}" y1="${mid}" y2="${mid}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="4 3"/><polyline points="${r.xs.map((x, i) => `${(pad + x * sc).toFixed(1)},${(mid - (r.yu[i] + r.yl[i]) / 2 * sc).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--amber)" stroke-width="1.5"/>`; }
  return `<svg viewBox="0 0 ${w} ${h}" ${o.detail ? 'style="width:100%;height:auto"' : `width="${w}" height="${h}"`} aria-hidden="true"><polygon points="${P}" fill="var(--accent-soft)" stroke="var(--accent-ink)" stroke-width="${o.detail ? 1.6 : 1.2}" stroke-linejoin="round"/>${extra}</svg>`;
}
function renderAirfoil(){
  const list = Airfoil.PRESETS.map(p => ({ id:p.id, name:p.name, use:p.use, clmax:p.clmax, pts:p.gen() }));
  if (design.customAirfoil) list.push({ id:'custom', name:design.customAirfoil.name, use:'Imported coordinates', clmax:Airfoil.get('custom', design.customAirfoil).clmax, pts:design.customAirfoil.points });
  $('#af-list').innerHTML = list.map(a => `<label class="choice" style="display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:center"><input type="radio" name="airfoil" value="${a.id}"${a.id === design.airfoilId ? ' checked' : ''}>${airfoilSVG(a.pts, 96, 30)}<span><b>${esc(a.name)}</b><span>${esc(a.use)} · CLmax ≈ ${fmt(a.clmax, 2)}</span></span></label>`).join('');
  const af = currentAirfoil();
  $('#af-view').innerHTML = `<h3 style="margin-bottom:6px">${esc(af.name)}</h3>${airfoilSVG(af.points, 640, 150, { detail:true, pad:14 })}<div class="legend"><span><i class="line" style="background:var(--accent-ink)"></i>Profile</span><span><i class="line" style="background:var(--amber)"></i>Mean camber line</span><span><i class="line" style="background:var(--muted)"></i>Chord line</span></div>`;
  $('#af-stats').innerHTML = [
    stat('Thickness', vu(fmt(af.t * 100, 1), '%'), `at ${fmt(af.xt * 100, 0)}% chord`, 'physics'),
    stat('Max camber', vu(fmt(af.camber * 100, 1), '%'), `at ${fmt(af.xc * 100, 0)}% chord`, 'physics'),
    stat('Zero-lift angle', vu(fmt(af.alpha0Deg, 2), '°'), 'thin-airfoil theory', 'physics'),
    stat('Cm about c/4', fmt(af.cm0, 3), af.cm0 >= 0 ? 'nose-up: OK for flying wings' : 'nose-down: needs a tail', 'physics'),
    stat('CLmax (2D)', fmt(af.clmax, 2), af.estimated ? 'estimated from shape' : 'typical at Re ≈ 100k', af.estimated ? 'estimate' : 'rule'),
    stat('Profile drag cd0', fmt(af.cd0, 3), 'at Re 100k; scaled with Re', 'rule'),
  ].join('');
  $('#af-note').innerHTML = af.approx || af.estimated ? `<div class="callout warn">${icon('warn')}<span>${af.approx ? 'This shape is a generated approximation, good for comparing. For balsa ribs of a named airfoil, import its exact .dat coordinates.' : 'CLmax and drag of imported airfoils are estimated from thickness and camber.'}</span></div>` : '';
}

function renderAnalyses(){
  A = analyze();
  renderGeometry(); renderStability(); renderWing(); renderPerf(); renderPower(); render3D(); updateLinks(); save();
}
function renderGeometry(){
  const { d, g } = A;
  const holder = $('#g-diagram');
  holder.innerHTML = buildAirframeSVG(d, { propD_m:A.R.prop.d * 0.0254, colors:diagramColors(), unit:UNITS().length, surf:CONTROLS[A.controls].surf, flaps:false });
  const svg = holder.querySelector('svg'); svg.removeAttribute('width'); svg.removeAttribute('height'); svg.setAttribute('class', 'diagram-svg');
  $('#g-readout').innerHTML = [`Area <b>${show('area', g.S)}</b>`, `AR <b>${fmt(g.AR, 1)}</b>`, `MAC <b>${show('length', g.mac)}</b>`, `Wing loading <b>${show('wingLoading', design.auw / g.S)}</b>`,
    `V<sub>h</sub> <b>${g.tailless ? 'n/a' : fmt(g.Vh, 2)}</b>`, `V<sub>v</sub> <b>${fmt(g.Vv, 3)}</b>`].map(t => `<span class="pill">${t}</span>`).join('');
}
function renderStability(){
  const { stab:s, g, d } = A, mm = f => show('length', s.fromRootLE(f));
  $('#st-stats').innerHTML = [
    stat('Neutral point', vu(fmt(s.xnp * 100, 1), '% MAC'), `${mm(s.xnp)} behind root LE`, 'estimate'),
    stat(design.measured.use ? 'CG (as built)' : 'Current CG', vu(fmt(s.cg * 100, 1), '% MAC'), `${mm(s.cg)} behind root LE`, 'physics'),
    stat('Static margin', vu(fmt(s.SM * 100, 1), '%'), 'aim 5–15%', 'estimate', s.status === 'ok' ? 'is-ok' : 'is-warn'),
    stat('Recommended CG', vu(fmt(s.cgRec * 100, 1), '% MAC'), `${mm(s.cgRec)} behind root LE`, 'estimate'),
    stat('Safe CG range', vu(`${fmt(s.cgFwd * 100, 0)}–${fmt(s.cgAft * 100, 0)}`, '% MAC'), `${mm(s.cgFwd)} – ${mm(s.cgAft)}`, 'estimate'),
    stat('Tail volume Vh', g.tailless ? 'n/a' : fmt(s.Vh, 2), 'typical 0.35–0.6', 'physics', g.tailless || (s.Vh >= 0.35 && s.Vh <= 0.6) ? '' : 'is-warn'),
    stat('Tail volume Vv', fmt(s.Vv, 3), 'typical 0.02–0.05', 'physics', s.Vv >= 0.02 && s.Vv <= 0.05 ? '' : 'is-warn'),
    stat('Spiral index B', s.blaine != null ? fmt(s.blaine, 1) : '—', '≥ 5 self-levels (Blaine)', 'rule'),
  ].join('');
  // CG bar 0..60% MAC
  const W = 640, H = 92, x = f => 20 + Math.max(0, Math.min(0.6, f)) / 0.6 * (W - 40);
  const ticks = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6].map(f => `<line x1="${x(f)}" x2="${x(f)}" y1="58" y2="62" stroke="var(--muted)"/><text x="${x(f)}" y="76" font-size="11" text-anchor="middle" fill="var(--ink-2)">${f * 100}%</text>`).join('');
  $('#st-bar').innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:760px;height:auto" role="img" aria-label="CG position on the mean aerodynamic chord: CG ${fmt(s.cg * 100, 0)} percent, neutral point ${fmt(s.xnp * 100, 0)} percent, safe range ${fmt(s.cgFwd * 100, 0)} to ${fmt(s.cgAft * 100, 0)} percent">
    <rect x="20" y="34" width="${W - 40}" height="24" rx="5" fill="var(--card-2)" stroke="var(--line)"/>
    <rect x="${x(s.cgFwd)}" y="34" width="${Math.max(2, x(s.cgAft) - x(s.cgFwd))}" height="24" fill="var(--ok-soft)" stroke="var(--ok)" stroke-width="1"/>
    <line x1="${x(s.xnp)}" x2="${x(s.xnp)}" y1="26" y2="62" stroke="var(--ink)" stroke-width="2"/><text x="${x(s.xnp)}" y="20" font-size="11.5" text-anchor="middle" font-weight="700" fill="var(--ink)">Neutral point</text>
    <line x1="${x(s.cgRec)}" x2="${x(s.cgRec)}" y1="34" y2="58" stroke="var(--ok)" stroke-width="2" stroke-dasharray="3 2"/>
    <circle cx="${x(s.cg)}" cy="46" r="8" fill="var(--card)" stroke="var(--amber)" stroke-width="2"/><path d="M${x(s.cg)} 46 L${x(s.cg)} 38 A8 8 0 0 1 ${x(s.cg) + 8} 46Z M${x(s.cg)} 46 L${x(s.cg)} 54 A8 8 0 0 1 ${x(s.cg) - 8} 46Z" fill="var(--amber)"/>
    <text x="20" y="20" font-size="11" fill="var(--ink-2)">LE of MAC</text>${ticks}</svg>
    <div class="legend"><span><i style="background:var(--ok)"></i>Safe CG range (SM 5–15%)</span><span><i class="line" style="background:var(--ok)"></i>Recommended</span><span><i style="background:var(--amber);border-radius:50%"></i>Current CG</span><span><i class="line" style="background:var(--ink)"></i>Neutral point</span></div>`;
  $('#st-how').textContent = [`Wing lift slope (Helmbold): a_w = 2πAR / (2 + √(AR² + 4)) = ${fmt(s.aw, 3)} /rad (AR ${fmt(g.AR, 2)})`,
    ...(g.tailless ? ['Tailless: neutral point ≈ MAC quarter-chord (25%) minus the fuselage effect'] : [
      `Tail lift slope a_t = ${fmt(s.at, 3)} /rad; downwash dε/dα = 2a_w / (πAR) = ${fmt(s.deda, 3)}; tail efficiency η = ${s.eta}`,
      `x_np = 0.25 + η·(a_t/a_w)·(1 − dε/dα)·V_h − Δ_fus = 0.25 + ${fmt(s.tailTerm, 3)} − ${fmt(s.fus, 3)} = ${fmt(s.xnp, 3)} MAC`]),
    `Fuselage (Gilruth): Δ = K_f·w_f²·L_f / (S·MAC·a_w[/deg]) = ${fmt(s.fus, 4)} MAC`,
    `Static margin = x_np − x_cg = ${fmt(s.xnp, 3)} − ${fmt(s.cg, 3)} = ${fmt(s.SM * 100, 1)}%`,
    `Recommended CG = x_np − ${fmt(design.smTarget * 100, 0)}%; safe range = x_np − 15% … x_np − 5%`,
    `MAC = ${show('length', g.mac)}, its LE is ${show('length', g.xMacLE - g.xwLE)} behind the root LE (sweep), at ${show('length', g.yMac)} from the centreline`].join('\n');
  warnList($('#st-warn'), s.notes);
  renderPanels(); renderAsBuilt();
}
function renderAsBuilt(){
  const m = design.measured, g = airframeGeometry(design.geom, 0.2), raw = Object.assign({}, design, { measured:Object.assign({}, m, { use:true }) }), eff = asBuilt(raw);
  const items = [];
  if (m.auw_kg > 0) items.push(stat('Measured weight', showV('mass', m.auw_kg), `estimate ${show('mass', design.auw)} (${m.auw_kg > design.auw ? '+' : ''}${fmt((m.auw_kg / design.auw - 1) * 100, 0)}%)`, 'physics', Math.abs(m.auw_kg / design.auw - 1) > 0.15 ? 'is-warn' : ''));
  if (typeof m.cg_m === 'number' && isFinite(m.cg_m)) {
    const st = stabilityAnalysis(eff.geom, airframeGeometry(eff.geom, 0.2), { smTarget:design.smTarget, cm0:currentAirfoil().cm0 });
    items.push(stat('Measured CG', vu(fmt(eff.geom.cg, 1), '% MAC'), `${show('length', m.cg_m)} behind root LE`, 'physics'));
    items.push(stat('As-built static margin', vu(fmt(st.SM * 100, 1), '%'), st.SM < 0.05 ? 'too far aft: add nose weight' : st.SM > 0.2 ? 'very nose-heavy' : 'in the safe range', 'estimate', st.status === 'ok' ? 'is-ok' : 'is-warn'));
    const move = cgToRootLE(design.geom, st.cgRec * 100) - m.cg_m;
    items.push(stat('To reach recommended CG', Math.abs(move) < 0.002 ? 'OK' : showV('length', Math.abs(move)), Math.abs(move) < 0.002 ? 'already there' : move > 0 ? 'move the CG back' : 'move the CG forward', 'estimate'));
  }
  $('#mb-out').innerHTML = items.length ? items.join('') + (m.use ? '' : `<div class="callout">${icon('info')}<span>Tick <b>Use my measurements</b> to apply them to the analyses and the simulator.</span></div>`) : `<p class="hint">No measurements yet. The analyses use the estimated weight and the CG from step 3.</p>`;
}
function renderPanels(){
  if (!design.panels) design.panels = { root:design.geom.rootChord, list:[{ span:design.geom.span / 2, chord:design.geom.tipChord, sweep:Math.atan(Math.tan(design.geom.sweep * Math.PI / 180)) * 180 / Math.PI }] };
  const p = design.panels, L = v => String(+conv('length', v).toPrecision(4));
  if (document.activeElement !== $('#mp-root')) $('#mp-root').value = L(p.root);
  if (!$('#mp-table').contains(document.activeElement)) $('#mp-table').innerHTML = `<thead><tr><th scope="col">Panel</th><th scope="col">Span ${esc('(' + ul('length') + ')')}</th><th scope="col">Tip chord ${esc('(' + ul('length') + ')')}</th><th scope="col">LE sweep (°)</th><th scope="col"><span class="sr-only">Remove</span></th></tr></thead><tbody>${p.list.map((q, i) => `<tr><th scope="row">${i + 1}</th>
    <td><input type="number" step="any" min="0" aria-label="Panel ${i + 1} span" data-mp="${i}" data-k="span" value="${L(q.span)}"></td><td><input type="number" step="any" min="0" aria-label="Panel ${i + 1} tip chord" data-mp="${i}" data-k="chord" value="${L(q.chord)}"></td>
    <td><input type="number" step="any" min="-30" max="60" aria-label="Panel ${i + 1} sweep" data-mp="${i}" data-k="sweep" value="${+q.sweep.toPrecision(4)}"></td><td>${p.list.length > 1 ? `<button type="button" class="btn sm danger" data-mp-del="${i}" aria-label="Remove panel ${i + 1}">${icon('trash')}</button>` : ''}</td></tr>`).join('')}</tbody>`;
  const r = multiPanelWing(p.root, p.list, design.smTarget, A.g.tailless);
  $('#mp-out').innerHTML = [stat('Area', showV('area', r.S), `span ${show('length', r.b)}`, 'physics'), stat('MAC', showV('length', r.mac), `at ${show('length', r.yMac)} from centre`, 'physics'),
    stat('MAC leading edge', showV('length', r.xMacLE), 'behind root LE', 'physics'), stat('Neutral point (tailless)', showV('length', r.np), 'MAC quarter-chord', 'physics'),
    stat(`CG at ${fmt(design.smTarget * 100, 0)}% margin`, showV('length', r.cg), 'behind root LE', 'estimate', 'is-ok')].join('');
  const W = 640, H = 200, maxX = Math.max(...r.segs.map(s => Math.max(s.x1 + s.c1, s.x0 + s.c0))), sc = Math.min((W - 40) / r.b * 2, (H - 30) / maxX) * 0.95;
  const pts = [[0, 0]].concat(r.segs.map(s => [s.y1, s.x1])).concat(r.segs.slice().reverse().map(s => [s.y1, s.x1 + s.c1])).concat([[0, p.root]]);
  const X = y => 20 + y * sc, Y = x => 15 + x * sc;
  $('#mp-svg').innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;max-width:640px" role="img" aria-label="Half-wing planform with MAC and CG">
    <polygon points="${pts.map(([y, x]) => `${X(y).toFixed(1)},${Y(x).toFixed(1)}`).join(' ')}" fill="var(--accent-soft)" stroke="var(--accent-ink)" stroke-width="1.5"/>
    <line x1="${X(r.yMac)}" x2="${X(r.yMac)}" y1="${Y(r.xMacLE)}" y2="${Y(r.xMacLE + r.mac)}" stroke="var(--accent)" stroke-width="3" stroke-dasharray="6 3"/>
    <line x1="10" x2="${X(r.b / 2) + 10}" y1="${Y(r.cg)}" y2="${Y(r.cg)}" stroke="var(--amber)" stroke-width="1.5" stroke-dasharray="4 3"/><text x="${X(r.b / 2) + 14}" y="${Y(r.cg) + 4}" font-size="11" fill="var(--ink)">CG</text>
    <text x="${X(r.yMac) + 6}" y="${Y(r.xMacLE + r.mac) + 14}" font-size="11" fill="var(--ink-2)">MAC</text></svg>`;
}
function renderWing(){
  const { ll, af, d } = A, sa = ll.stallStation;
  $('#ll-stats').innerHTML = [
    stat('Span efficiency e', fmt(ll.e, 3), '1.0 = ideal elliptic', 'physics', ll.e > 0.9 ? 'is-ok' : ''),
    stat('Cruise CL', fmt(ll.CL, 2), `at ${show('speed', A.R.vc)}`, 'physics'),
    stat('Induced drag CDi', fmt(ll.CDi, 4), 'at cruise', 'physics'),
    stat('Angle of attack', vu(fmt(ll.alphaDeg, 1), '°'), 'root, at cruise', 'physics'),
    stat('Wing CLmax (3D)', ll.CLmax3D != null ? fmt(ll.CLmax3D, 2) : '—', `airfoil ${fmt(af.clmax, 2)}`, 'estimate'),
    stat('Stall starts at', sa != null ? vu(fmt(sa * 100, 0), '% semispan') : '—', sa > 0.6 ? 'tip stall risk: add washout' : 'root-first: gentle', 'estimate', sa > 0.6 ? 'is-warn' : 'is-ok'),
    stat('Lift slope', vu(fmt(ll.CLalpha * Math.PI / 180, 3), '/°'), `2D ${fmt(2 * Math.PI * 0.9 * Math.PI / 180, 3)} /°`, 'physics'),
  ].join('');
  const pts = ll.stations;
  Charts.line($('#ch-load'), { title:'Spanwise lift distribution', series:[{ name:'Your wing', short:'Wing', color:'var(--series-1)', pts:pts.map(s => [s.eta * 100, s.load]) }, { name:'Elliptic (ideal)', short:'Elliptic', color:'var(--series-2)', dash:'5 4', pts:pts.map(s => [s.eta * 100, s.ell]) }],
    x:{ label:'Semispan (%)', fmt:v => fmt(v, 0) }, y:{ label:'Normalised load', fmt:v => fmt(v, 2), min:0 } });
  Charts.line($('#ch-stall'), { title:'Local lift coefficient ratio at stall onset', series:[{ name:'cl ÷ clmax', color:'var(--series-1)', pts:pts.map(s => [s.eta * 100, s.clStall / af.clmax]) }],
    x:{ label:'Semispan (%)', fmt:v => fmt(v, 0) }, y:{ label:'cl / clmax', fmt:v => fmt(v, 2), min:0, max:1.1 }, hlines:[{ y:1, label:'stall' }] });
  $('#ll-how').textContent = [`Glauert series: Γ(θ) = 2bV Σ A_n sin nθ (n odd), ${20} spanwise stations, solved as a linear system`,
    `μ = a₀·c / (4b), a₀ = 0.9 × 2π /rad, airfoil zero-lift angle ${fmt(af.alpha0Deg, 2)}°, washout ${fmt(d.washout || 0, 1)}° (linear to the tip)`,
    `CL = π·AR·A₁ = ${fmt(ll.CL, 3)};  CDi = π·AR·Σ n·A_n² = ${fmt(ll.CDi, 5)};  e = A₁² / Σ n·A_n² = ${fmt(ll.e, 3)}`,
    `Stall: the angle where the first station reaches the airfoil cl_max ${fmt(af.clmax, 2)} → CLmax(3D) = ${fmt(ll.CLmax3D, 3)} at ${fmt(ll.alphaStallDeg, 1)}°`,
    'Limitations: no sweep, no fuselage, linear lift curve up to cl_max.'].join('\n');
}
function renderCalib(){
  const c = design.calibration, box = $('#calib-body');
  if (!c || !c.factors) { box.innerHTML = `<p class="sub" style="margin:0">Not calibrated yet. Fly your plane with a logger (EdgeTX, INAV/Betaflight, ArduPilot, or just GPS) or measure a few speeds, then use the simulator's <b>Calibrate</b> tab and press <b>Save into the Designer design</b>. These predictions then use your real plane's drag, lift, thrust and current.</p><div class="actions"><a class="btn sm" href="${$('#to-sim').href}">Open the simulator</a></div>`; return; }
  const F = SimCalibFactors;
  box.innerHTML = `<p class="readout"><span class="pill">From <b>${esc((c.source_logs || []).join(', '))}</b></span><span class="pill">${esc(c.date || '')}</span><span class="pill">Error ${fmt((c.rms_error_before || 0) * 100, 0)}% → <b>${fmt((c.rms_error_after || 0) * 100, 0)}%</b></span><span class="pill">Confidence <b>${esc(c.confidence || '–')}</b></span></p>
    <div class="table-scroll"><table class="data"><tbody>${F.map(([k, l]) => `<tr><th scope="row">${l}</th><td class="num">×${fmt(c.factors[k] != null ? c.factors[k] : 1, 2)}</td><td>${c.identified && !c.identified[k] ? '<span class="hint">no data</span>' : ''}</td></tr>`).join('')}</tbody></table></div>
    <label class="check"><input type="checkbox" id="cal-apply-d" ${c.applyDesigner !== false ? 'checked' : ''}> Apply to the Designer's performance predictions</label>
    <div class="actions"><button type="button" class="btn sm danger" id="cal-remove-d">Remove calibration</button></div>`;
}
const SimCalibFactors = [['cd0', 'Drag (zero-lift)'], ['clmax', 'Maximum lift'], ['thrust', 'Thrust'], ['current', 'Current draw'], ['roll', 'Aileron effectiveness (simulator only)']];
function renderPerf(){
  renderCalib();
  { const r = A.rho, da = densityAltitude(r), dv = (Math.sqrt(RHO_SL / r) - 1) * 100; $('#p-air').innerHTML = `${fmt(r, 3)} kg/m³ · ${Math.abs(da) < 30 ? 'standard sea-level air' : `density altitude ${fmt(conv('altitude', Math.round(da / 10) * 10), 0)} ${ul('altitude')}`}${Math.abs(dv) >= 1 ? ` · stall ${dv > 0 ? '+' : ''}${fmt(dv, 0)}%` : ''}`; }
  const { pf, R, op } = A, sp = v => conv('speed', v);
  $('#pf-stats').innerHTML = [
    stat('Stall speed (3D)', showV('speed', pf.vs), A.calibrated ? 'calibrated from flight data' : 'with lifting-line CLmax', A.calibrated ? 'estimate' : 'physics'),
    stat('Best glide (L/D max)', fmt(pf.LDmax, 1), `at ${show('speed', pf.vLD)}`, 'estimate'),
    stat('Min sink', showV('speed', pf.sinkMin, 2), `at ${show('speed', pf.vMinPower)}`, 'estimate'),
    stat('Top speed', pf.vmax ? showV('speed', pf.vmax) : '—', op ? 'chosen motor' : 'calculator power model', 'estimate'),
    stat('Max climb rate', showV('speed', Math.max(0, pf.rocMax), 2), `at ${show('speed', pf.vClimb)}`, 'estimate', pf.rocMax < 1 ? 'is-warn' : ''),
    stat('Cruise power', vu(fmt(pf.cruise.Preq, 1), 'W'), `electrical at ${show('speed', pf.cruise.V)}`, 'estimate'),
    stat('Endurance at cruise', vu(fmt(pf.enduranceCruise, 1), 'min'), `ideal steady level flight; real flying with climbs and turns ≈ ⅓–½ of this`, 'estimate'),
    stat('Zero-lift drag CD0', fmt(pf.cd0Cruise, 4), `e ${fmt(pf.e, 2)}`, 'estimate'),
  ].join('');
  const P = pf.pts, uf = UNITS().force;
  Charts.line($('#ch-td'), { title:'Thrust available and drag vs speed', series:[{ name:'Thrust available', short:'Thrust', color:'var(--series-1)', pts:P.map(p => [sp(p.V), fromSI('force', uf, p.T)]) }, { name:'Drag', color:'var(--series-2)', pts:P.map(p => [sp(p.V), fromSI('force', uf, p.D)]) }],
    x:{ label:`Airspeed (${ul('speed')})`, fmt:v => fmt(v, 0) }, y:{ label:`Force (${ul('force')})`, fmt:v => fmtS(v), min:0 }, markers:[{ x:sp(R.vc), label:'cruise' }] });
  Charts.line($('#ch-pr'), { title:'Electrical power required vs speed', series:[{ name:'Power required', color:'var(--series-1)', pts:P.map(p => [sp(p.V), p.Preq]) }],
    x:{ label:`Airspeed (${ul('speed')})`, fmt:v => fmt(v, 0) }, y:{ label:'Power (W)', fmt:v => fmtS(v), min:0, max:Math.min(Math.max(...P.map(p => p.Preq)), (op ? op.Pin : R.P) * 1.6) }, markers:[{ x:sp(R.vc), label:'cruise' }, { x:sp(pf.vMinPower), label:'min power' }], hlines:[{ y:op ? op.Pin : R.P, label:'full power' }] });
  Charts.line($('#ch-glide'), { title:'Glide polar', series:[{ name:'Sink rate', color:'var(--series-1)', pts:P.filter(p => p.V < pf.vs * 2.6).map(p => [sp(p.V), sp(p.sink)]) }],
    x:{ label:`Airspeed (${ul('speed')})`, fmt:v => fmt(v, 0) }, y:{ label:`Sink rate (${ul('speed')})`, fmt:v => fmt(v, 2), min:0 }, markers:[{ x:sp(pf.vLD), label:'best L/D' }] });
  $('#pf-how').textContent = [`Drag polar: CD = CD0 + CL² / (π·e·AR), e = lifting-line e × 0.93 (fuselage) = ${fmt(pf.e, 3)}`,
    `CD0 = 1.15 × [cd0_airfoil·f(Re) + (0.012·f(Re)·(S_h+S_v) + CD_f·A_front)/S] ${design.perf.gear ? '+ 0.012 gear' : ''}; f(Re) = (Re/10⁵)^-0.4`,
    `Thrust available T(V) = T_static × (1 − V / (1.15 × pitch speed)), T_static = ${show('force', op ? op.thrust : R.thrust)}, pitch speed ${show('speed', op ? op.pitchSpeed : R.pitchSpeed)}`,
    `Power required (electrical) = D·V / (η_prop ${design.perf.etaProp} × η_motor ${fmt(op ? op.eta : design.perf.etaMotor, 2)} × η_esc 0.95)`,
    `Climb rate = (T − D)·V / W; sink (glide) = D·V / W; endurance = battery Wh × 0.8 ÷ P_required`].join('\n');
}
let matchCache = { key:'', list:[] };
function renderPower(){
  const { R, W } = A, d = design, key = JSON.stringify([d.cells, d.capacity_mAh, d.maxPropD, d.auw, R.P, R.vc, d.req.mission, allMotors().length, +A.rho.toFixed(4)]);
  if (matchCache.key !== key) matchCache = { key, list:matchPowerSystems({ motors:allMotors(), cellsList:[d.cells], props:PROPS_EXT, capacity_mAh:d.capacity_mAh, targetPower:R.P, cruise:R.vc, weightN:W, style:style(), maxPropD_in:d.maxPropD, limit:12, rho:A.rho }) };
  const list = matchCache.list;
  $('#pw-sub').textContent = `Target ${fmt(R.P, 0)} W on ${d.cells}S ${d.capacity_mAh} mAh, cruise ${show('speed', R.vc)}, props up to ${d.maxPropD} in. Ranked by power fit, thrust-to-weight, pitch speed 1.5–2× cruise, efficiency and headroom.`;
  $('#pw-table').innerHTML = list.length ? `<thead><tr><th scope="col">#</th><th scope="col">Motor</th><th scope="col">Prop</th><th scope="col">Current</th><th scope="col">Power in</th><th scope="col">RPM</th><th scope="col">Efficiency</th><th scope="col">Thrust</th><th scope="col">T/W</th><th scope="col">Pitch ×cruise</th><th scope="col">Load</th><th scope="col"><span class="sr-only">Select</span></th></tr></thead><tbody>${
    list.map((m, i) => { const sel = d.power && d.power.motorId === m.motor.id && d.power.prop.d === m.prop.d && d.power.prop.p === m.prop.p && d.power.cells === m.cells;
      return `<tr class="${sel ? 'hl' : ''}"><td>${i + 1}</td><th scope="row">${esc(m.motor.name)} · ${m.motor.kv} KV</th><td>${m.prop.d}×${m.prop.p}</td><td class="num">${fmt(m.op.I, 1)} A</td><td class="num">${fmt(m.op.Pin, 0)} W</td><td class="num">${fmt(m.op.rpm, 0)}</td><td class="num">${fmt(m.op.eta * 100, 0)}%</td><td class="num">${show('force', m.op.thrust)}</td><td class="num">${fmt(m.tw, 2)}</td><td class="num">${fmt(m.ratio, 2)}</td><td class="num">${fmt(m.op.load * 100, 0)}%</td>
      <td><button type="button" class="btn sm" data-use="${i}" aria-pressed="${sel}">${sel ? 'Selected' : 'Use'}</button></td></tr>`; }).join('')}</tbody>`
    : `<tbody><tr><td>No motor and prop in the database fits these limits. Try another cell count, a larger prop limit, or add your own motor below.</td></tr></tbody>`;
  const ch = $('#pw-chosen');
  if (A.power && A.op) {
    const m = A.power.motor, thr = +(ch.dataset.thr || 100);
    const opT = motorOperatingPoint({ motor:m, cells:A.power.cells, capacity_mAh:d.capacity_mAh, prop:A.power.prop, throttle:thr / 100 });
    const op = A.op;
    ch.hidden = false;
    ch.innerHTML = `<h3>${icon('motor')} Selected: ${esc(m.name)} ${m.kv} KV · ${A.power.cells}S · ${A.power.prop.d}×${A.power.prop.p} <span class="tag tag-estimate">Estimate</span></h3>
      <div class="stats" style="margin-top:10px">${[stat('Full-throttle current', vu(fmt(op.I, 1), 'A'), `motor max ${m.maxA} A (${fmt(op.I / m.maxA * 100, 0)}%)`, 'estimate', op.I / m.maxA > 0.85 ? 'is-warn' : 'is-ok'),
        stat('Power in', vu(fmt(op.Pin, 0), 'W'), `max ${m.maxW} W · shaft ${fmt(op.Pshaft, 0)} W`, 'estimate'), stat('Motor efficiency', vu(fmt(op.eta * 100, 0), '%'), `Rm ${m.rm} Ω, Io ${m.io} A`, 'estimate'),
        stat('Static thrust', showV('force', op.thrust), `T/W ${fmt(op.thrust / A.W, 2)}`, 'estimate'), stat('RPM', fmt(op.rpm, 0), `pitch speed ${show('speed', op.pitchSpeed)}`, 'estimate'),
        stat('Flight time (full)', vu(fmt(d.capacity_mAh / 1000 * 0.8 / op.I * 60, 1), 'min'), `${d.capacity_mAh} mAh, 80% usable`, 'estimate')].join('')}</div>
      <div class="field" style="margin-top:12px"><label for="pw-thr">Throttle: <output id="pw-thr-out">${thr}%</output></label><input id="pw-thr" type="range" min="10" max="100" step="5" value="${thr}"></div>
      <p class="readout">${opT ? [`Current <b>${fmt(opT.I, 1)} A</b>`, `Power <b>${fmt(opT.Pin, 0)} W</b>`, `RPM <b>${fmt(opT.rpm, 0)}</b>`, `Thrust <b>${show('force', opT.thrust)}</b>`, `Flight time <b>${fmt(d.capacity_mAh / 1000 * 0.8 / opT.I * 60, 1)} min</b>`].map(t => `<span class="pill">${t}</span>`).join('') : ''}</p>
      <div class="actions"><button type="button" class="btn sm" id="pw-clear">Clear selection</button></div>
      <details class="how"><summary>How it was calculated</summary><pre class="formula">${esc([`Battery: V_oc = ${A.power.cells} × 3.85 V, internal resistance ≈ ${A.power.cells} × 12 mΩ × (1000 / ${d.capacity_mAh} mAh)`,
        `Motor: RPM = Kv·(V_m − I·Rm), shaft power = (I − Io)·(V_m − I·Rm)`, `Prop: P = Cp·ρ·n³·D⁵, Cp = 0.04 × (pitch/diameter) / 0.475 = ${fmt(propCp(A.power.prop), 4)}`,
        `Solve shaft power = prop power for I (bisection) → I = ${fmt(op.I, 2)} A, ${fmt(op.rpm, 0)} RPM`, `Thrust (momentum theory, FM 0.6 on shaft power) = ${fmt(op.thrust, 3)} N`].join('\n'))}</pre></details>`;
  } else { ch.hidden = false; ch.innerHTML = `<p class="sub" style="margin:0">${icon('info')} No motor selected: performance uses the calculator's power model (${fmt(R.P, 0)} W, ${R.prop.d}×${R.prop.p} prop, ${fmt(R.kv, 0)} KV ${R.kvSrc}). Pick a row above to use the motor model.</p>`; }
  const custom = RC.store.get(RC.KEYS.motors, []) || [];
  $('#db-table').innerHTML = `<thead><tr><th scope="col">Motor</th><th scope="col">KV</th><th scope="col">Rm</th><th scope="col">Io</th><th scope="col">Max A</th><th scope="col">Max W</th><th scope="col">Weight</th><th scope="col">Cells</th><th scope="col">Source</th><th scope="col"><span class="sr-only">Remove</span></th></tr></thead><tbody>${allMotors().map(m => `<tr><th scope="row">${esc(m.name)}</th><td class="num">${m.kv}</td><td class="num">${m.rm} Ω</td><td class="num">${m.io} A</td><td class="num">${m.maxA}</td><td class="num">${m.maxW}</td><td class="num">${show('mass', m.mass / 1000)}</td><td>${m.cells ? m.cells.join('–') + 'S' : 'any'}</td><td>${esc(m.custom ? 'yours' : m.note)}</td><td>${m.custom ? `<button type="button" class="btn sm danger" data-del-motor="${esc(m.id)}" aria-label="Remove ${esc(m.name)}">${icon('trash')}</button>` : ''}</td></tr>`).join('')}</tbody>`;
}
let viewer = null;
function colors3D(){ const dark = RC.effectiveDark();
  return dark ? { bg:'#0b1a30', ink:'#000', wing:[56, 160, 190], tail:[70, 175, 200], fuse:[110, 130, 160], motor:[150, 165, 185], prop:[210, 220, 230], disc:'rgba(34,211,238,.13)', edge:'rgba(220,235,255,.35)' }
              : { bg:'#f3f7fb', ink:'#0b2545', wing:[120, 196, 220], tail:[140, 205, 225], fuse:[226, 232, 240], motor:[60, 74, 92], prop:[31, 45, 61], disc:'rgba(8,145,178,.12)', edge:'rgba(11,37,69,.35)' }; }
let meshCache = null;
function render3D(){
  if (!viewer) viewer = new Viewer3D($('#v3d'), { colors:colors3D });
  meshCache = Mesh3D.build(A.d, { airfoil:A.af, propD:A.R.prop.d * 0.0254 });
  viewer.setMesh(meshCache);
  $('#v-readout').innerHTML = [`Triangles <b>${fmt(meshCache.tris.length, 0)}</b>`, `Size <b>${show('length', meshCache.bounds.hi[0] - meshCache.bounds.lo[0])} × ${show('length', meshCache.bounds.hi[1] - meshCache.bounds.lo[1])} × ${show('length', meshCache.bounds.hi[2] - meshCache.bounds.lo[2])}</b>`, `Airfoil <b>${esc(A.af.name)}</b>`].map(t => `<span class="pill">${t}</span>`).join('');
}

/* ---------------- hand-off, save & compare ---------------- */
function calcState(){
  const { g, R } = A, d = design;
  return { weightMode:'auw', wingMode:'area', style:style(), cells:A.inp.cells, controls:A.controls, flaps:false,
    si:{ auw:d.auw, span:d.geom.span, area:g.S, chord:g.S / d.geom.span, cap:d.capacity_mAh / 1000 },
    num:{ kv:A.power ? A.power.motor.kv : null, propD:A.power ? A.power.prop.d : null, propP:A.power ? A.power.prop.p : null, cRating:null, throttle:50 },
    diagLink:true, diagram:Object.assign({}, d.geom) };
}
function updateLinks(){
  const dh = '#design=' + RC.b64urlEncode(JSON.stringify(design));
  ['#to-build', '#nav-build', '#flow-build'].forEach(s => { const a = $(s); if (a) a.href = 'build.html' + dh; });
  ['#to-sim', '#nav-sim', '#flow-sim'].forEach(s => { const a = $(s); if (a) a.href = 'simulator.html' + dh; });
  $('#to-calc').href = 'rc-plane-calculator.html#cfg=' + RC.b64urlEncode(JSON.stringify(calcState()));
}
let saveTimer = null;
function save(){ clearTimeout(saveTimer); saveTimer = setTimeout(() => RC.store.set(RC.KEYS.design, design), 250); }
function summary(dz){
  const a = analyze(dz);
  return { auw:dz.auw, span:dz.geom.span, S:a.g.S, AR:a.g.AR, wl:dz.auw / a.g.S, vs:a.pf.vs, P:a.R.P, cells:a.inp.cells, mah:dz.capacity_mAh, LD:a.pf.LDmax, vmax:a.pf.vmax, endurance:a.pf.enduranceCruise, SM:a.stab.SM, airfoil:a.af.name, motor:a.power ? `${a.power.motor.name} ${a.power.prop.d}×${a.power.prop.p}` : '—', material:MATERIALS[dz.req.material].label };
}
const savedList = () => RC.store.get(RC.KEYS.designs, []) || [];
const cmpSel = new Set();
function renderSaved(){
  const list = savedList();
  $('#sv-table').innerHTML = list.length ? `<thead><tr><th scope="col">Compare</th><th scope="col">Name</th><th scope="col">AUW</th><th scope="col">Span</th><th scope="col">Stall</th><th scope="col">Saved</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${list.map((it, i) => `<tr>
    <td><input type="checkbox" data-cmp="${i}" aria-label="Compare ${esc(it.name)}"${cmpSel.has(i) ? ' checked' : ''}></td><th scope="row">${esc(it.name)}</th><td class="num">${show('mass', it.summary.auw)}</td><td class="num">${show('length', it.summary.span)}</td><td class="num">${show('speed', it.summary.vs)}</td><td>${esc(new Date(it.savedAt).toLocaleString())}</td>
    <td><button type="button" class="btn sm" data-load="${i}">Load</button> <button type="button" class="btn sm danger" data-del="${i}" aria-label="Delete ${esc(it.name)}">${icon('trash')}</button></td></tr>`).join('')}</tbody>` : '<tbody><tr><td class="hint">No saved designs yet.</td></tr></tbody>';
  const sel = [...cmpSel].filter(i => list[i]).slice(0, 4).map(i => list[i]);
  if (sel.length < 2) { $('#cmp-table').innerHTML = sel.length ? '<tbody><tr><td class="hint">Tick at least two designs to compare.</td></tr></tbody>' : ''; return; }
  const rows = [['All-up weight', s => show('mass', s.auw)], ['Span', s => show('length', s.span)], ['Wing area', s => show('area', s.S)], ['Aspect ratio', s => fmt(s.AR, 1)], ['Wing loading', s => show('wingLoading', s.wl)],
    ['Stall speed', s => show('speed', s.vs)], ['Target power', s => fmt(s.P, 0) + ' W'], ['Battery', s => `${s.cells}S ${s.mah} mAh`], ['L/D max', s => fmt(s.LD, 1)], ['Top speed', s => show('speed', s.vmax)],
    ['Endurance (cruise)', s => fmt(s.endurance, 1) + ' min'], ['Static margin', s => fmt(s.SM * 100, 1) + '%'], ['Airfoil', s => esc(s.airfoil)], ['Motor / prop', s => esc(s.motor)], ['Material', s => esc(s.material)]];
  $('#cmp-table').innerHTML = `<thead><tr><th scope="col">Metric</th>${sel.map(s => `<th scope="col">${esc(s.name)}</th>`).join('')}</tr></thead><tbody>${rows.map(([k, f]) => `<tr><th scope="row">${k}</th>${sel.map(s => `<td>${f(s.summary)}</td>`).join('')}</tr>`).join('')}</tbody>`;
}
function loadDesign(obj){ design = sanitize(merge(defaultDesign(), obj)); matchCache.key = ''; syncFields(); renderSizing(); renderAirfoil(); renderAnalyses(); }

/* ---------------- events ---------------- */
function init(){
  RC.initChrome();
  $('#r-mission').innerHTML = Object.entries(MISSIONS).map(([k, m]) => `<option value="${k}">${m.label}</option>`).join('');
  $('#r-preset').innerHTML = $('#g-preset').innerHTML = Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('');
  $('#r-material').innerHTML = Object.entries(MATERIALS).map(([k, m]) => `<option value="${k}">${m.label}</option>`).join('');
  document.addEventListener('input', e => { if (e.target.dataset.path) onField(e); });
  document.addEventListener('change', e => { if (e.target.dataset.path && (e.target.tagName === 'SELECT' || e.target.type === 'checkbox')) return; });
  document.addEventListener('focusout', e => { if (e.target.dataset && e.target.dataset.path && e.target.getAttribute('aria-invalid') !== 'true') syncFields(); });
  $$('input[name=unitSystem]').forEach(r => r.addEventListener('change', () => { sys = r.value; RC.setUnitSystem(sys); syncFields(); renderSizing(); renderAirfoil(); renderAnalyses(); renderSaved(); }));
  $('#btn-size').addEventListener('click', () => { runSizing(); RC.toast('Sized. Every section below has been updated'); });
  $('#btn-reset-design').addEventListener('click', () => { if (!confirm('Start a new design? Unsaved changes to the current design will be lost.')) return; design = defaultDesign(); matchCache.key = ''; runSizing(); });
  $('#af-list').addEventListener('change', e => { if (e.target.name === 'airfoil') { design.airfoilId = e.target.value; renderAirfoil(); renderAnalyses(); } });
  const importText = (text) => { try { const a = Airfoil.parseDat(text); design.customAirfoil = a; design.airfoilId = 'custom'; renderAirfoil(); renderAnalyses(); RC.toast(`Imported ${a.name} (${a.points.length} points)`); } catch (err) { RC.toast(err.message); } };
  $('#af-use').addEventListener('click', () => importText($('#af-text').value));
  $('#af-file').addEventListener('change', e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => importText(String(r.result)); r.readAsText(f); });
  $('#g-auto').addEventListener('click', () => { const S = A.g.S, keep = { cg:design.geom.cg, washout:design.geom.washout, motorPos:design.geom.motorPos, wingMount:design.geom.wingMount };
    design.geom = Object.assign(autoProportion(design.geom.preset, design.geom.span, style(), S), keep, { surfaces:design.geom.surfaces }); syncFields(); renderAnalyses(); RC.toast('Tail and fuselage re-proportioned'); });
  $('#st-apply').addEventListener('click', () => { design.geom.cg = Math.round(A.stab.cgRec * 1000) / 10; syncFields(); renderAnalyses(); RC.toast(`CG set to ${fmt(design.geom.cg, 1)}% MAC`); });
  // multi-panel
  $('#mp-root').addEventListener('input', e => { const n = Number(e.target.value); if (n > 0) { design.panels.root = toSI('length', UNITS().length, n); renderPanels(); save(); } });
  $('#mp-table').addEventListener('input', e => { const i = e.target.dataset.mp; if (i == null) return; const n = Number(e.target.value), k = e.target.dataset.k;
    if (!isFinite(n) || (k !== 'sweep' && n <= 0)) { e.target.setAttribute('aria-invalid', 'true'); return; } e.target.removeAttribute('aria-invalid');
    design.panels.list[+i][k] = k === 'sweep' ? n : toSI('length', UNITS().length, n); renderPanels(); save(); });
  $('#mp-table').addEventListener('click', e => { const b = e.target.closest('[data-mp-del]'); if (b) { design.panels.list.splice(+b.dataset.mpDel, 1); $('#mp-table').innerHTML = ''; renderPanels(); save(); } });
  $('#mp-add').addEventListener('click', () => { const l = design.panels.list, last = l[l.length - 1]; l.push({ span:last.span * 0.5, chord:last.chord * 0.6, sweep:15 }); $('#mp-table').innerHTML = ''; renderPanels(); save(); });
  $('#mp-from').addEventListener('click', () => { design.panels = null; $('#mp-table').innerHTML = ''; renderPanels(); save(); });
  // power
  $('#pw-table').addEventListener('click', e => { const b = e.target.closest('[data-use]'); if (!b) return; const m = matchCache.list[+b.dataset.use];
    design.power = { motorId:m.motor.id, cells:m.cells, prop:{ d:m.prop.d, p:m.prop.p } }; renderAnalyses(); RC.toast(`Using ${m.motor.name} with ${m.prop.d}×${m.prop.p}`); });
  $('#pw-chosen').addEventListener('input', e => { if (e.target.id === 'pw-thr') { $('#pw-chosen').dataset.thr = e.target.value; const keep = e.target.value; renderPower(); const s = $('#pw-thr'); if (s) { s.value = keep; s.focus(); } } });
  $('#pw-chosen').addEventListener('click', e => { if (e.target.closest('#pw-clear')) { design.power = null; renderAnalyses(); } });
  $('#db-add').addEventListener('click', () => {
    const v = id => Number($(id).value), name = $('#db-name').value.trim(), cells = ($('#db-cells').value.match(/\d+/g) || []).map(Number);
    if (!name || !(v('#db-kv') > 0) || !(v('#db-rm') > 0) || !(v('#db-io') >= 0) || !(v('#db-maxa') > 0) || !(v('#db-maxw') > 0) || !(v('#db-mass') > 0)) { RC.toast('Fill in name, KV, Rm, Io, max current, max power and weight'); return; }
    const list = RC.store.get(RC.KEYS.motors, []) || [];
    list.push({ id:'c' + Date.now(), name, kv:v('#db-kv'), rm:v('#db-rm'), io:v('#db-io'), maxA:v('#db-maxa'), maxW:v('#db-maxw'), mass:v('#db-mass'), cells:cells.length ? [cells[0], cells[cells.length - 1]] : null, note:'yours', custom:true });
    RC.store.set(RC.KEYS.motors, list); matchCache.key = ''; $$('#db-form input').forEach(i => { i.value = ''; }); renderPower(); RC.toast(`Added ${name}`); });
  $('#db-table').addEventListener('click', e => { const b = e.target.closest('[data-del-motor]'); if (!b) return; RC.store.set(RC.KEYS.motors, (RC.store.get(RC.KEYS.motors, []) || []).filter(m => m.id !== b.dataset.delMotor));
    if (design.power && design.power.motorId === b.dataset.delMotor) design.power = null; matchCache.key = ''; renderAnalyses(); });
  // 3D
  $$('[data-view]').forEach(b => b.addEventListener('click', () => viewer.view(b.dataset.view)));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  $('#v-auto').addEventListener('click', e => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', String(on)); viewer.setAuto(on); if (on && reduce) RC.toast('Note: your system prefers reduced motion'); });
  $('#v-wire').addEventListener('click', e => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', String(on)); viewer.wire = on; viewer.draw(); });
  $('#v-png').addEventListener('click', () => $('#v3d').toBlob(b => { if (b) { RC.download(b, `${design.name.replace(/[^\w-]+/g, '_')}-3d.png`); RC.toast('PNG downloaded'); } }));
  $('#v-stl').addEventListener('click', () => { const name = design.name.replace(/[^\w-]+/g, '_') || 'rc_airframe'; RC.download(new Blob([Mesh3D.toSTL(meshCache, name)], { type:'model/stl' }), `${name}.stl`); RC.toast('STL downloaded (units: mm)'); });
  // save/compare
  $('#sv-save').addEventListener('click', () => { const list = savedList(), name = design.name || 'Untitled', i = list.findIndex(x => x.name === name), item = { name, savedAt:Date.now(), design:JSON.parse(JSON.stringify(design)), summary:summary(design) };
    if (i >= 0) list[i] = item; else list.push(item); RC.store.set(RC.KEYS.designs, list); renderSaved(); RC.toast(`Saved "${name}"`); });
  $('#sv-table').addEventListener('click', e => { const l = e.target.closest('[data-load]'), d = e.target.closest('[data-del]'), list = savedList();
    if (l) { loadDesign(list[+l.dataset.load].design); RC.toast(`Loaded "${list[+l.dataset.load].name}"`); }
    if (d) { const i = +d.dataset.del; if (!confirm(`Delete "${list[i].name}"?`)) return; list.splice(i, 1); RC.store.set(RC.KEYS.designs, list); cmpSel.clear(); renderSaved(); } });
  $('#sv-table').addEventListener('change', e => { const i = e.target.dataset.cmp; if (i == null) return; if (e.target.checked) { if (cmpSel.size >= 4) { e.target.checked = false; RC.toast('Compare up to four designs'); return; } cmpSel.add(+i); } else cmpSel.delete(+i); renderSaved(); });
  $('#sv-export').addEventListener('click', () => RC.download(new Blob([JSON.stringify(design, null, 2)], { type:'application/json' }), `${design.name.replace(/[^\w-]+/g, '_') || 'design'}.json`));
  $('#sv-import').addEventListener('change', e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { try { loadDesign(JSON.parse(String(r.result))); RC.toast('Design imported'); } catch (err) { RC.toast('That file is not a valid design JSON'); } }; r.readAsText(f); e.target.value = ''; });
  $('#sv-share').addEventListener('click', async () => { const url = location.href.split('#')[0] + '#design=' + RC.b64urlEncode(JSON.stringify(design)); $('#sv-share-field').hidden = false; $('#sv-url').value = url; $('#sv-url').select();
    try { await navigator.clipboard.writeText(url); RC.toast('Link copied'); } catch (err) { RC.toast('Copy the link from the field'); } });
  $('#calib-card').addEventListener('input', e => { if (e.target.id === 'cal-apply-d') { design.calibration.applyDesigner = e.target.checked; renderAnalyses(); } });
  $('#calib-card').addEventListener('click', e => { if (e.target.closest('#cal-remove-d') && confirm('Remove the flight-data calibration from this design?')) { delete design.calibration; renderAnalyses(); } });
  RC.onThemeChange(() => { renderSizing(); renderGeometry(); if (viewer) viewer.draw(); });
  RC.navHighlight('.subnav a');
  syncFields();
  if (firstRun) runSizing(); else { renderSizing(); renderAirfoil(); renderAnalyses(); }
  renderSaved();
  runSelfTest();
}
function runSelfTest(){
  let pass = 0, total = 0; const t = (c, m) => { total++; if (c) pass++; console.assert(c, '[designer self-test] ' + m); };
  const a = Airfoil.get('naca2412'); t(Math.abs(a.alpha0Deg + 2.08) < 0.15, 'NACA 2412 zero-lift angle');
  const ll = liftingLine({ b:1, cr:0.15, ct:0.06, CL:0.5, a0:2 * Math.PI }); t(ll.e > 0.97, 'tapered wing near-elliptic');
  const sz = sizeAircraft({ mission:'trainer', stall_ms:6.5, span_m:1, flightMin:8, cells:'auto', material:'depron', clmax:1.25 }); t(sz.converged && sz.vs <= 6.5 + 1e-6, 'sizer converges, stall ≤ target');
  t(!!A && isFinite(A.stab.xnp) && isFinite(A.pf.LDmax), 'analysis pipeline finite');
  const da = designAircraft({ mission:'trainer', targetStall_ms:6.5, targetSpan_m:1 }); t(da.wingArea_m2 > 0 && da.parts.length > 5, 'designAircraft implemented');
  console.info(`[designer self-test] ${pass}/${total} checks passed`);
}
init();
window.RCDesigner = { get design(){ return design; }, get analysis(){ return A; }, runSizing, loadDesign };
})();
