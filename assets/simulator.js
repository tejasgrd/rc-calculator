/* RC Calc: Flight simulator page. Wires SimModel/SimPhysics (flight), SimInput (controls), SimWorld (three.js view),
   SimImport (3D model import) into one page with lessons, test flights, replay and sound. */
'use strict';
(function(){
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
RC.initChrome();
const imperial = RC.unitSystem() === 'imperial';
const SPD = v => imperial ? `${fmt(v * 2.23694, 0)} mph` : `${fmt(v, 1)} m/s`, ALT = v => imperial ? `${fmt(v * 3.28084, 0)} ft` : `${fmt(v, 0)} m`, VS = v => imperial ? `${fmt(v * 196.85, 0)} ft/min` : `${fmt(v, 1)} m/s`;
const SET_KEY = 'rcSim.settings.v1';
const settings = Object.assign({ model:'builtin:trainer', start:'runway', cam:'pilot', assist:'angle', speed:1, stallGuard:true, zoom:true, trail:false, sound:false,
  weather:null, trees:true, throws:{}, gear:{}, cg:{}, color:'#22a6c9' }, RC.store.get(SET_KEY) || {});
if (!settings.weather) { const old = settings.wind; settings.weather = Object.assign({ preset:'breeze' }, SimPhysics.WEATHER_PRESETS.breeze, { dir:270, tempC:15, elevation:0, qnh:1013.25, show:false }, old ? { preset:'custom', speed:old.speed, dir:old.dir, turbulence:old.gust, gustPeak:old.gust * 4, thermals:old.thermals, show:old.show } : {}); delete settings.wind; }
if (!settings.instructor) settings.instructor = 'off'; if (settings.hints == null) settings.hints = false; if (settings.ghost == null) settings.ghost = true;
settings.mount = settings.mount || {}; if (settings.motorFx == null) settings.motorFx = true;
settings.cg = settings.cg || {}; settings.calibrations = settings.calibrations || {}; if (settings.useCal == null) settings.useCal = true;
const saveSettings = () => RC.store.set(SET_KEY, settings);

if (!window.THREE || !THREE.WebGLRenderer) {
  const fb = $('#sim-fallback'); fb.hidden = false;
  fb.innerHTML = `<div><h2>3D library not found</h2><p>The simulator needs <code>assets/vendor/three.bundle.min.js</code> (three.js, bundled for offline use). Please make sure the <code>assets/vendor</code> folder is next to this page.</p></div>`;
  return;
}
let world;
try { world = new SimWorld.World($('#sim-canvas'), { seed:42 }); }
catch (e) { const fb = $('#sim-fallback'); fb.hidden = false; fb.innerHTML = `<div><h2>3D view unavailable</h2><p>${esc(e.message)}. Your browser or graphics driver may have WebGL turned off.</p></div>`; return; }

const env = new SimPhysics.Environment(Object.assign({ seed:Date.now() & 0xffff }, settings.weather));
env.obstacles = world.obstacles();
const input = new SimInput.InputManager({ onKey, onPad:(gp, on) => { RC.toast(on ? `Controller connected: ${gp.id.slice(0, 40)}` : 'Controller disconnected'); renderDevices(); } });
let sim = null, model = null, design = null, preds = null, sourceKey = null;
let instructor = null, who = 'student', whyInstr = '', hint = null, share = 0;
let paused = false, flaps = 0, rescueKey = false, recorder = new SimPhysics.Recorder(), replay = null, measuring = null, lesson = null, prevStalled = false;
const sources = new Map();

/* ---------------- aircraft sources ---------------- */
async function buildSources(){
  sources.clear();
  for (const [k, b] of Object.entries(SimModel.BUILTINS)) sources.set('builtin:' + k, { name:b.name, group:'Built-in', design:() => SimModel.builtinDesign(k) });
  if (scenario && scenario.design && scenario.design.geom) sources.set('scenario', { name:`${scenario.design.name || 'Design'} (shared scenario)`, group:'Your designs', design:() => scenario.design });
  const hash = RC.readHash('design'); if (hash && hash.geom) sources.set('hash', { name:`${hash.name || 'Design'} (from link)`, group:'Your designs', design:() => hash });
  const cur = RC.store.get(RC.KEYS.design); if (cur && cur.geom) sources.set('designer', { name:`${cur.name || 'Current design'} (Designer)`, group:'Your designs', design:() => cur });
  (RC.store.get(RC.KEYS.designs, []) || []).forEach((it, i) => sources.set('saved:' + i, { name:`${it.name} (saved)`, group:'Your designs', design:() => it.design }));
  try { (await SimImport.list()).forEach(r => sources.set('imp:' + r.id, { name:`${r.name} (imported 3D)`, group:'Imported models', design:() => r.design, rec:r })); } catch (e) { /* IndexedDB unavailable */ }
  const sel = $('#f-model'), groups = {};
  for (const [k, s] of sources) (groups[s.group] = groups[s.group] || []).push(`<option value="${esc(k)}">${esc(s.name)}</option>`);
  sel.innerHTML = Object.entries(groups).map(([g, o]) => `<optgroup label="${esc(g)}">${o.join('')}</optgroup>`).join('');
  $('#imp-flight').innerHTML = [...sources].filter(([k]) => !k.startsWith('imp:')).map(([k, s]) => `<option value="${esc(k)}">${esc(s.name)}</option>`).join('');
  renderImported();
}
async function loadAircraft(key, keepPose){
  const src = sources.get(key) || sources.get('builtin:trainer'); sourceKey = sources.has(key) ? key : 'builtin:trainer';
  design = JSON.parse(JSON.stringify(src.design()));
  model = buildModel();
  preds = SimModel.predictions(flightDesign(), model);
  const prevS = keepPose && sim ? sim.s : null;
  sim = new SimPhysics.Sim(model, { env });
  let visual = { colors:{ wing:settings.color } };
  if (src.rec && src.rec.data) {
    try { const obj = await SimImport.parse(src.rec.data, src.rec.type, src.rec.extras); visual = SimImport.prepare(obj, src.rec.align || {}, model); visual.colors = { wing:settings.color }; }
    catch (e) { RC.toast('Could not load the imported 3D model: ' + e.message); }
  }
  world.setAircraft(model, visual);
  if (prevS) { sim.s = Object.assign(sim.s, { p:prevS.p, v:prevS.v, q:prevS.q, w:prevS.w }); } else reset();
  $('#f-model').value = sourceKey; settings.model = sourceKey; saveSettings();
  renderModelPanel(); renderTests(); updateLinks();
}
/** The design as flown: as-built measurements applied, then the per-aircraft CG override from the Model tab. */
function flightDesign(){ const d = JSON.parse(JSON.stringify(asBuilt(design)));
  if (settings.calibrations[sourceKey]) d.calibration = settings.calibrations[sourceKey];
  if (!settings.useCal) delete d.calibration;
  if (settings.cg[sourceKey] != null) d.geom.cg = settings.cg[sourceKey];
  const mo = settings.mount[sourceKey]; if (mo) { if (mo.down != null) d.geom.thrustDown = mo.down; if (mo.right != null) d.geom.thrustRight = mo.right; if (mo.rot) d.geom.propRot = mo.rot; }
  if (settings.motorFx === false) { d.geom.thrustDown = 0; d.geom.thrustRight = 0; } return d; }
function buildModel(){ return SimModel.build(flightDesign(), { gear:settings.gear[sourceKey] || 'auto', throws:settings.throws[sourceKey], customMotors:RC.store.get(RC.KEYS.motors, []) || [], rho:env.rhoAt(0), motorEffects:settings.motorFx !== false }); }
function startMode(){ let m = lesson && lesson.start ? lesson.start : settings.start; if (m === 'runway' && model.gear === 'none') m = 'hand'; return m; }
function reset(){
  if (!sim) return;
  const m = startMode(), heading = runwayHeading();
  sim.ctrl.thr = m === 'hand' ? Math.max(0.6, input.state.thr || 0) : 0;
  sim.reset(m, Object.assign({ heading, alt:40 }, lesson && lesson.startOpts ? lesson.startOpts : {}));
  if (m === 'runway') { const h = heading * Math.PI / 180; sim.s.p[0] = -30 * Math.cos(h); sim.s.p[1] = -30 * Math.sin(h); }
  if (m === 'hand') setThrottleInput(sim.ctrl.thr);
  if (m === 'runway') setThrottleInput(0);
  if (input.virtual.on && typeof drawGimbal === 'function') { drawGimbal('left'); drawGimbal('right'); }
  world.clearTrail(); recorder.segment(); sim.events = []; prevStalled = false; sim.failures = {};
  instructor = new SimLessons.Instructor(sim, { mode:settings.instructor });
  if (lesson && lesson.onReset) lesson.onReset();
}
const runwayHeading = () => { const w = env.speed > 1 ? env.dir : 0; return Math.abs(SimPhysics.wrap180(w - 0)) <= 90 ? 0 : 180; }; // take off into wind along the runway (N/S)

/* ---------------- main loop ---------------- */
let last = performance.now(), hudT = 0, thermT = 0, fps = 60;
function frame(now){
  const realDt = Math.min(0.05, (now - last) / 1000); last = now; fps += (1 / Math.max(1e-3, realDt) - fps) * 0.05;
  const inp = input.read(realDt);
  handleCommands(inp);
  if (replay) stepReplay(realDt);
  else if (sim) {
    const sticks = { ail:inp.ail, ele:inp.ele, rud:inp.rud, thr:inp.thr, flap:flaps };
    const assist = lesson && lesson.assist ? lesson.assist : settings.assist;
    let ctrl = SimPhysics.pilotAssist(sim, sticks, { mode:assist === 'off' ? null : assist, stallGuard:settings.stallGuard, rescue:rescueKey || inp.held.rescue });
    ctrl.flap = flaps; who = 'student'; hint = null;
    if (lesson && lesson.demo && lesson.pilot) { ctrl = lesson.pilot.fly(realDt * settings.speed); who = 'demo'; }
    else if (instructor && settings.instructor !== 'off') { const r = instructor.update(ctrl, input.keys.has('Space') || !!inp.held.student, realDt * settings.speed); ctrl = r.ctrl; who = r.who; whyInstr = r.reason; hint = r.hint; share = r.share || 0; }
    else if (settings.hints && instructor) hint = instructor.advice(sim.telemetry(), realDt);
    if (lesson && lesson.su.failure && !paused) SimLessons.applyFailure(sim, lesson.su.failure, lesson.L.t);
    if (!paused) {
      sim.step(realDt * settings.speed, ctrl); recorder.push(sim);
      if (settings.trees && !sim.s.crashed && world.hitsTree(sim.s.p)) { sim.s.crashed = { reason:'Flew into a tree', t:sim.s.t }; }
      if (Math.hypot(sim.s.p[0], sim.s.p[1]) > 1500 && !sim.s.crashed) sim.s.crashed = { reason:'Out of radio range', t:sim.s.t };
    }
    const tl = sim.telemetry();
    world.pose(sim.s.p, sim.s.q, sim.ctrl, tl.rpm, paused ? 0 : realDt * settings.speed);
    if (measuring) measuring.push(tl);
    detectStall(tl);
    if (lesson && !paused) lesson.check(tl, realDt * settings.speed, ctrl, who === 'demo' ? 'student' : who);
    sound.update(tl, world);
    hudT += realDt; if (hudT > 0.1) { watchFps(hudT); hudT = 0; renderHUD(tl, who === 'demo' ? Object.assign({}, inp, { ail:ctrl.ail, ele:ctrl.ele, rud:ctrl.rud, thr:ctrl.thr, source:'demo pilot' }) : inp); }
  }
  thermT += realDt; if (thermT > 2) { thermT = 0; if (settings.weather.show || (lesson && lesson.show)) world.showThermals(env.thermalList, true); }
  world.setWind(env.dir, env.speed);
  world.updateCamera(realDt); world.render();
  if (wizardOpen) renderWizard();
  requestAnimationFrame(frame);
}
function handleCommands(inp){
  const e = inp.edges;
  if (e.reset) { if (replay) exitReplay(); reset(); }
  if (e.camera) cycleCam();
  if (e.assist) cycleAssist();
  if (e.flaps) toggleFlaps();
  if (e.slowmo) cycleSpeed();
  if (e.pause) togglePause();
  if (e.launch) { settings.start = 'hand'; $('#f-start').value = 'hand'; reset(); }
}
function onKey(e){
  if (e.repeat) return;
  const k = e.code;
  if (k === 'KeyR') { if (replay) exitReplay(); reset(); }
  else if (k === 'KeyC') cycleCam(); else if (k === 'KeyP') togglePause(); else if (k === 'KeyH') cycleAssist(); else if (k === 'KeyF') toggleFlaps(); else if (k === 'KeyT') cycleSpeed();
  else if (k === 'KeyG') { settings.trail = !settings.trail; $('#f-trail').checked = settings.trail; world.trailOn = settings.trail; if (!settings.trail) world.clearTrail(); }
  else if (k === 'KeyB') rescueKey = true;
}
window.addEventListener('keyup', e => { if (e.code === 'KeyB') rescueKey = false; });
const CAMS = ['pilot', 'chase', 'cockpit', 'tower'], CAM_LABEL = { pilot:'Pilot view', chase:'Chase', cockpit:'Cockpit', tower:'Tower' };
function cycleCam(){ settings.cam = CAMS[(CAMS.indexOf(settings.cam) + 1) % CAMS.length]; applyCam(); }
function applyCam(){ world.setCamera(settings.cam); $('#f-cam').value = settings.cam; $('#hud-cam').textContent = CAM_LABEL[settings.cam]; saveSettings(); }
function cycleAssist(){ const a = ['angle', 'level', 'off']; settings.assist = a[(a.indexOf(settings.assist) + 1) % 3]; $('#f-assist').value = settings.assist; RC.toast(`Assist: ${$('#f-assist').selectedOptions[0].textContent}`); saveSettings(); }
function toggleFlaps(){ if (!model || !model.hasFlaps) { RC.toast('This design has no flaps (add them in the Designer, step 3)'); return; } flaps = flaps ? 0 : 1; RC.toast(flaps ? 'Flaps down' : 'Flaps up'); }
function cycleSpeed(){ const s = [1, 0.5, 0.25]; settings.speed = s[(s.indexOf(+settings.speed) + 1) % 3]; $('#f-speed').value = String(settings.speed); saveSettings(); }
function togglePause(){ paused = !paused; $('#hud-pause').setAttribute('aria-pressed', String(paused)); $('#hud-pause').textContent = paused ? 'Resume' : 'Pause'; }

/* ---------------- HUD ---------------- */
function renderHUD(t, inp){
  const m = model, soc = t.soc, flightLeft = t.I > 0.2 ? Math.max(0, soc - 0.2) * m.capacity_mAh / 1000 / t.I * 60 : null;
  $('#hud-tele').innerHTML = `<div class="hrow"><span>Airspeed</span><b>${SPD(t.V)}</b></div><div class="hrow"><span>Altitude</span><b>${ALT(t.alt)}</b></div><div class="hrow"><span>Climb</span><b>${VS(t.vs)}</b></div>
    <div class="hrow"><span>Throttle</span><span>${fmt(t.spool * 100, 0)}%</span></div><div class="bar"><i style="width:${(t.spool * 100).toFixed(0)}%"></i></div>
    <div class="hrow"><span>Battery ${fmt(t.Vcell, 2)} V/cell</span><span>${fmt(soc * 100, 0)}%</span></div><div class="bar"><i class="${soc < 0.1 ? 'crit' : soc < 0.25 ? 'low' : ''}" style="width:${(soc * 100).toFixed(0)}%"></i></div>
    <div class="hrow"><span>Current</span><span>${fmt(t.I, 1)} A · ${fmt(t.mAh, 0)} mAh</span></div><div class="hrow"><span>Time</span><span>${fmtTime(t.t)}${flightLeft != null ? ` · ~${fmt(flightLeft, 1)} min left` : ''}</span></div>
    <div class="hrow"><span>Wind</span><span>${windText()[0]}</span></div>${windText()[1] ? `<div class="hrow"><span>Runway</span><span>${windText()[1]}</span></div>` : ''}`;
  const msgs = [];
  if (replay) msgs.push(['', 'REPLAY']);
  if (env.wake > 0.25 && !tl.onGround) msgs.push(['', 'Bumpy air behind the trees']);
  if (who === 'demo') msgs.push(['ok', 'DEMO: watch the sticks, then try it yourself']);
  else if (who === 'instructor') msgs.push(['warn', `INSTRUCTOR has control${whyInstr ? ` (${whyInstr})` : ''}${settings.instructor === 'switch' ? ' · hold SPACE / LB for control' : settings.instructor === 'auto' ? ' · centre the sticks to take over' : ''}`]);
  else if (settings.instructor === 'shared' && share > 0.1) msgs.push(['', `Instructor helping ${Math.round(share * 100)}%`]);
  if (paused && !replay) msgs.push(['', 'PAUSED']);
  if (t.crashed) msgs.push(['bad', `${t.crashed.reason.toUpperCase()} · press R (or A) to reset`]);
  else {
    if (t.stall > 0.35 && !t.onGround && t.alt > 1) msgs.push(['warn', 'STALL: push forward, wings level, add power']);
    if (soc < 0.03) msgs.push(['bad', 'BATTERY EMPTY: glide in and land']); else if (soc < 0.2) msgs.push(['warn', 'LOW BATTERY: land soon']);
    if (sim.s.propStrike) msgs.push(['warn', 'PROP STRIKE: motor stopped']);
    const d = Math.hypot(t.pos[0] - SimWorld.PILOT[0], t.pos[1] - SimWorld.PILOT[1]); if (d > 350) msgs.push(['warn', 'Too far: turn back towards you']);
  }
  $('#hud-msg').innerHTML = msgs.map(([c, s]) => `<span class="msg ${c}">${esc(s)}</span>`).join('<br>');
  const m2 = (input.saved.prefs.mode || 2) !== 1, l = m2 ? [inp.rud, 1 - 2 * inp.thr] : [inp.rud, inp.ele], r = m2 ? [inp.ail, inp.ele] : [inp.ail, 1 - 2 * inp.thr];
  const dot = ([x, y]) => `<i style="left:${50 + x * 42}%;top:${50 + y * 42}%"></i>`, hdot = ([x, y]) => `<i class="hint" style="left:${50 + x * 42}%;top:${50 + y * 42}%"></i>`;
  const H = (settings.hints || who === 'demo') && hint ? (m2 ? [[hint.rud, 1 - 2 * hint.thr], [hint.ail, hint.ele]] : [[hint.rud, hint.ele], [hint.ail, 1 - 2 * hint.thr]]) : null;
  $('#hud-sticks').innerHTML = `<div><div class="stk">${H ? hdot(H[0]) : ''}${dot(l)}</div><small>${m2 ? 'rud / thr' : 'rud / ele'}</small></div><div><div class="thr"><i style="height:${(inp.thr * 100).toFixed(0)}%"></i></div><small>thr</small></div><div><div class="stk">${H ? hdot(H[1]) : ''}${dot(r)}</div><small>${m2 ? 'ail / ele' : 'ail / thr'}</small></div>`;
  const assist = lesson && lesson.assist ? lesson.assist : settings.assist;
  $('#hud-chips').innerHTML = [`${{ angle:'Beginner assist', level:'Auto-level', off:'No assist' }[assist]}`, `Input: ${inp.source}`, settings.speed < 1 ? `${settings.speed}× time` : '', flaps ? 'Flaps' : '', env.speed > 0.2 ? `Wind ${SPD(env.speed)} from ${fmt(env.dir, 0)}°` : 'Calm', `${fmt(fps, 0)} fps`]
    .filter(Boolean).map(s => `<span>${esc(s)}</span>`).join('');
  if (inp.needsSetup && !wizardOpen && !renderHUD.warned) { renderHUD.warned = true; RC.toast('A controller needs setup: open Controls → Set up'); renderDevices(); }
}
function windText(){
  const w = env.meanWind(10), sp = Math.hypot(w[0], w[1]), from = (Math.atan2(-w[1], -w[0]) * 180 / Math.PI + 360) % 360, rh = runwayHeading() * Math.PI / 180;
  const head = -(w[0] * Math.cos(rh) + w[1] * Math.sin(rh)), cross = Math.abs(-w[0] * Math.sin(rh) + w[1] * Math.cos(rh));
  return sp < 0.3 ? ['calm', ''] : [`${SPD(sp)} from ${fmt(from, 0)}°${env.gustNow > 0.8 ? ' · GUST' : ''}`, `${head >= 0 ? 'head' : 'tail'} ${SPD(Math.abs(head))} · cross ${SPD(cross)}`];
}
const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function detectStall(t){
  const st = t.stall > 0.35 && !t.onGround && t.alt > 2;
  if (st && !prevStalled) { const li = document.createElement('li'); li.className = 'warn'; li.innerHTML = `${RC.icon('warn')}<span>${fmtTime(t.t)}: stalled at ${SPD(t.V)}, angle of attack ${fmt(t.alpha, 1)}°, bank ${fmt(t.phi, 0)}°</span>`; $('#stall-log').prepend(li); while ($('#stall-log').children.length > 12) $('#stall-log').lastChild.remove(); }
  prevStalled = st;
}

/* ---------------- sound (WebAudio) ---------------- */
const sound = (() => {
  let ctx = null, o1, o2, g, wind, wg, lp;
  function start(){ if (ctx) return; const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; ctx = new AC();
    o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o2 = ctx.createOscillator(); o2.type = 'square'; lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800; g = ctx.createGain(); g.gain.value = 0;
    o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(ctx.destination); o1.start(); o2.start();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    wind = ctx.createBufferSource(); wind.buffer = buf; wind.loop = true; const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 600; bp.Q.value = 0.6; wg = ctx.createGain(); wg.gain.value = 0; wind.connect(bp); bp.connect(wg); wg.connect(ctx.destination); wind.start(); }
  function update(t, w){
    if (!settings.sound) { if (ctx && g) { g.gain.value = 0; wg.gain.value = 0; } return; } start(); if (!ctx) return; if (ctx.state === 'suspended') ctx.resume();
    const dist = settings.cam === 'pilot' ? Math.max(3, Math.hypot(t.pos[0] - SimWorld.PILOT[0], t.pos[1] - SimWorld.PILOT[1], t.pos[2] - SimWorld.PILOT[2])) : 6, att = Math.min(1, 12 / dist);
    const f = Math.max(20, t.rpm / 60), now = ctx.currentTime;
    o1.frequency.setTargetAtTime(f * 7, now, 0.05); o2.frequency.setTargetAtTime(f * 2, now, 0.05);
    g.gain.setTargetAtTime(paused || t.crashed ? 0 : Math.min(0.12, (t.rpm / 12000) * 0.12) * att, now, 0.08);
    wg.gain.setTargetAtTime(paused || t.crashed ? 0 : Math.min(0.08, (t.V / 25) ** 2 * 0.08) * (settings.cam === 'pilot' ? att : 1), now, 0.1);
  }
  return { update, start };
})();

/* ---------------- lessons ---------------- */
const PROGRESS_KEY = 'rcSim.progress.v1';
const progress = RC.store.get(PROGRESS_KEY, {}) || {};
const starStr = n => '★★★'.slice(0, n) + '☆☆☆'.slice(0, 3 - n);
const starHtml = n => `<span aria-label="${n} of 3 stars" style="font-weight:700;letter-spacing:1px"><span style="color:var(--amber)">${'★★★'.slice(0, n)}</span><span style="color:var(--muted)">${'☆☆☆'.slice(0, 3 - n)}</span></span>`;
function renderLessons(){
  const groups = {}; SimLessons.DEFS.forEach(d => (groups[d.group] = groups[d.group] || []).push(d));
  $('#lesson-list').innerHTML = Object.entries(groups).map(([g, list]) => `<h3 class="sub-h">${esc(g)}</h3>` + list.map(d => { const p = progress[d.id], act = lesson && lesson.def.id === d.id;
    return `<div class="card${act ? ' is-ok' : ''}"><b>${esc(d.name)} ${starHtml(p ? p.stars : 0)}</b><p>${esc(d.goal)}${d.model ? ` <em>(uses the ${esc(SimModel.BUILTINS[d.model.split(':')[1]].name)})</em>` : ''}</p>
      ${p ? `<p class="hint" style="margin-top:-4px">Best ${p.best} · ${p.runs} attempt${p.runs > 1 ? 's' : ''}</p>` : ''}
      <button type="button" class="btn sm" data-lesson="${d.id}">${act && !lesson.demo ? 'Restart' : 'Start'}</button> <button type="button" class="btn sm" data-demo="${d.id}">Show me</button>${act ? ' <button type="button" class="btn sm" data-lesson-stop>Stop</button>' : ''}</div>`; }).join('')).join('') + `<div id="lesson-result"></div>`;
}
async function startLesson(id, demo){
  const def = SimLessons.DEFS.find(d => d.id === id); if (!def) return;
  if (def.model && sourceKey !== def.model) { await loadAircraft(def.model); RC.toast(`Loaded the ${SimModel.BUILTINS[def.model.split(':')[1]].name} for this lesson`); }
  if (def.id === 'thermal' && model.motor && sourceKey === 'builtin:trainer') { await loadAircraft('builtin:glider'); RC.toast('Loaded the powered glider for soaring'); }
  const L = new SimLessons.Lesson(def, { vs:model.trim.vs, runwayHeading:runwayHeading() }), su = L.setup();
  env.set(Object.assign({}, su.weather, { tempC:W.tempC, elevation:W.elevation, qnh:W.qnh })); env.dirOff = 0;
  lesson = { def, L, su, demo:!!demo, start:su.start, startOpts:su.startOpts, assist:su.assist, show:su.show, reported:false };
  lesson.onReset = () => { lesson.L = new SimLessons.Lesson(def, { vs:model.trim.vs, runwayHeading:runwayHeading() }); lesson.reported = false; sim.failures = {}; lesson.pilot = lesson.demo ? new SimLessons.DemoPilot(sim, lesson.L) : null;
    instructor = new SimLessons.Instructor(sim, { mode:settings.instructor }); if (def.motorOff) { sim.ctrl.thr = 0; setThrottleInput(0); }
    world.setGates((lesson.L.gates || []).map(g => ({ p:g.p, heading:g.heading, r:g.r }))); lesson.L.gates.forEach((_, i) => world.markGate(i, i === 0 ? 'next' : 'todo')); world.setPath(settings.ghost ? lesson.L.path() : []); };
  lesson.check = (tl, dt, c, who) => checkLesson(tl, dt, c, who);
  if (su.show) world.showThermals(env.thermalList, true);
  reset(); renderLessons(); $('#hud-lesson').hidden = false; $('#lesson-result').innerHTML = '';
  $('#sim-canvas').focus();
}
function stopLesson(){ lesson = null; world.setGates([]); world.setPath([]); $('#hud-lesson').hidden = true; sim.failures = {}; env.set(settings.weather); world.showThermals(env.thermalList, settings.weather.show); renderLessons(); }
function checkLesson(tl, dt, c, who){
  const L = lesson.L, st = L.update(tl, c, dt, who);
  if (L.gates.length) L.gates.forEach((_, i) => world.markGate(i, i < st.gate ? 'done' : i === st.gate ? 'next' : 'todo'));
  $('#hud-lesson').innerHTML = `<b>${esc(lesson.def.name)}${lesson.demo ? ' (demo)' : ''}</b><br>${esc(st.text)}<div class="bar" style="height:4px;background:rgba(255,255,255,.2);border-radius:2px;margin-top:6px"><i style="display:block;height:100%;width:${Math.round(st.progress * 100)}%;background:#ffd166;border-radius:2px"></i></div>`;
  if ((st.done || st.failed) && !lesson.reported) {
    lesson.reported = true; const r = L.result();
    if (!lesson.demo) { const p = progress[lesson.def.id] || { best:0, stars:0, runs:0 }; p.runs++; if (r.score > p.best) { p.best = r.score; p.stars = r.stars; } p.last = { score:r.score, date:new Date().toISOString().slice(0, 10) }; progress[lesson.def.id] = p; RC.store.set(PROGRESS_KEY, progress); }
    renderLessons();
    $('#lesson-result').innerHTML = `<div class="card wide" role="status"><h3>${esc(lesson.def.name)}: ${st.done ? `${r.score} / 100 ${starHtml(r.stars)}` : 'not completed'}${lesson.demo ? ' (demo)' : ''}</h3><ul>${r.tips.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      <div class="actions"><button type="button" class="btn sm primary" data-lesson="${lesson.def.id}">Try again</button>${st.done && !lesson.demo ? '' : ` <button type="button" class="btn sm" data-demo="${lesson.def.id}">Show me</button>`}</div></div>`;
    if (st.done) RC.toast(lesson.demo ? 'Demo finished: now you try!' : `Lesson complete: ${r.score} points ${starStr(r.stars)}`);
    selectTab($('#tab-lessons'));
  }
}
/* ---------------- test flights ---------------- */
const testRes = {};
function renderTests(){
  const ids = Object.keys(SimPhysics.TESTS);
  const f = (r, v) => v == null || !isFinite(v) ? '–' : r.unit === 'm/s' ? SPD(v) : r.unit === ':1' ? `${fmt(v, 1)} : 1` : `${fmt(v, 1)} ${r.unit}`;
  $('#t-table').innerHTML = `<tbody>${ids.map(id => { const r = testRes[id];
    const res = r ? (r.measured != null ? `<span class="pill">Sim <b>${f(r, r.measured)}</b></span>${r.pred != null ? `<span class="pill">Designer <b>${f(r, r.pred)}</b></span>` : ''}${r.match ? `<span class="fit ${r.match === 'ok' ? 'ok' : 'no'}">${RC.icon(r.match === 'ok' ? 'check' : 'warn')}${r.diff != null ? (r.diff > 0 ? '+' : '') + fmt(r.diff * 100, 0) + '%' : ''}</span>` : ''}` : '<span class="hint">no result</span>') : '';
    return `<tr><td><b>${esc(SimPhysics.TESTS[id].name)}</b><div class="readout" style="margin:4px 0">${res}</div>${r && r.note ? `<small class="hint">${esc(r.note)}</small><br>` : ''}${r && r.aborted ? `<small class="hint">aborted: ${esc(r.aborted)}</small><br>` : ''}
      <button type="button" class="btn sm" data-test="${id}">${r ? 'Run again' : 'Run'}</button>${r && r.rec ? ` <button type="button" class="btn sm" data-watch="${id}">Watch</button>` : ''}</td></tr>`; }).join('')}</tbody>`;
}
function runOne(id){ const rec = new SimPhysics.Recorder(); const r = SimPhysics.runTest(model, id, preds, { rec }); r.rec = rec.rows.length ? rec : null; testRes[id] = r; renderTests(); return r; }
async function runAll(){ for (const id of Object.keys(SimPhysics.TESTS)) { runOne(id); await new Promise(r => setTimeout(r, 30)); } RC.toast('All test flights finished'); }

/* ---------------- replay ---------------- */
function enterReplay(rec){
  const r = rec || recorder; if (!r.rows.length) { RC.toast('Nothing recorded yet. Fly first.'); return; }
  replay = { rec:r, t:r.rows[0].t, playing:true, speed:+$('#r-speed').value };
  $('#r-toggle').setAttribute('aria-pressed', 'true'); $('#r-toggle').textContent = 'Back to flying'; $('#r-play').disabled = false; $('#r-pos').disabled = false; $('#r-play').textContent = 'Pause'; $('#r-play').setAttribute('aria-pressed', 'true');
  $('#r-pos').min = r.rows[0].t; $('#r-pos').max = r.rows[r.rows.length - 1].t; $('#r-pos').step = 0.05;
  $('#r-info').innerHTML = `<span class="pill">${fmt(r.rows.length, 0)} samples</span><span class="pill">${fmtTime(r.rows[r.rows.length - 1].t - r.rows[0].t)} long</span>`;
}
function exitReplay(){ replay = null; $('#r-toggle').setAttribute('aria-pressed', 'false'); $('#r-toggle').textContent = 'Replay'; $('#r-play').disabled = true; $('#r-pos').disabled = true; }
function stepReplay(dt){
  const R = replay, rows = R.rec.rows; if (R.playing) R.t += dt * R.speed; const end = rows[rows.length - 1].t; if (R.t >= end) { R.t = end; R.playing = false; $('#r-play').textContent = 'Play'; }
  const s = R.rec.sample(R.t); if (!s) return; world.pose(s.p, s.q, s.c, s.rpm, R.playing ? dt * R.speed : 0);
  if (document.activeElement !== $('#r-pos')) $('#r-pos').value = R.t; $('#r-pos-o').textContent = `${fmt(R.t - rows[0].t, 1)} s`;
  hudT += dt; if (hudT > 0.1) { hudT = 0; renderHUD(Object.assign(sim.telemetry(), { V:s.V, alt:s.alt, vs:s.vs, t:s.t, rpm:s.rpm, I:s.I, mAh:s.mAh, crashed:null, stall:0, pos:s.p, spool:s.c.thr }), { ail:s.c.ail, ele:s.c.ele, rud:s.c.rud, thr:s.c.thr, source:'replay', held:{} }); }
}

/* ---------------- measure while flying ---------------- */
$('#m-toggle').addEventListener('click', e => {
  if (!measuring) { measuring = []; e.currentTarget.textContent = 'Stop measuring'; e.currentTarget.setAttribute('aria-pressed', 'true'); $('#m-out').innerHTML = '<span class="pill">Measuring…</span>'; return; }
  const S = measuring; measuring = null; e.currentTarget.textContent = 'Start measuring'; e.currentTarget.setAttribute('aria-pressed', 'false');
  if (S.length < 10) { $('#m-out').innerHTML = '<span class="pill">Too short</span>'; return; }
  const a = S[0], b = S[S.length - 1], dur = b.t - a.t, avg = k => S.reduce((s, x) => s + x[k], 0) / S.length, dh = a.alt - b.alt, dx = Math.hypot(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1]);
  const items = [`Duration <b>${fmt(dur, 1)} s</b>`, `Avg airspeed <b>${SPD(avg('V'))}</b>`, `Min airspeed <b>${SPD(Math.min(...S.map(s => s.V)))}</b>`, `Avg climb <b>${VS((b.alt - a.alt) / Math.max(0.1, dur))}</b>`,
    `Peak roll rate <b>${fmt(Math.max(...S.map(s => Math.abs(s.p))), 0)} °/s</b>`, `Avg current <b>${fmt(avg('I'), 1)} A</b>`, `Avg power <b>${fmt(avg('Pin'), 0)} W</b>`, `Used <b>${fmt(b.mAh - a.mAh, 0)} mAh</b>`];
  if (dh > 1 && avg('spool') < 0.05) items.push(`Glide ratio <b>${fmt(dx / dh, 1)} : 1</b>`);
  $('#m-out').innerHTML = items.map(t => `<span class="pill">${t}</span>`).join('');
});

/* ---------------- model panel ---------------- */
function renderModelPanel(){
  { const src = sources.get(sourceKey), meta = src && src.rec && src.rec.meta, c = SimImport.credit(meta), el = $('#m-attrib'); el.hidden = !c;
    if (c) el.innerHTML = `3D model: ${esc(c)}${SimImport.safeUrl(meta.source) ? ` · <a href="${esc(meta.source)}" target="_blank" rel="noopener noreferrer">source</a>` : ''}`; }
  const m = model, tr = m.trim, op = m.thrTable[Math.round(tr.throttle * 20)];
  const stat = (l, v, n, cls = '') => `<div class="stat ${cls}"><span class="lbl">${esc(l)}</span><span class="val">${v}</span>${n ? `<span class="note">${n}</span>` : ''}</div>`;
  $('#mdl-stats').innerHTML = [stat('Weight', `${fmt(m.mass * 1000, 0)}<small>g</small>`, m.ballast_g > 0.5 ? `incl. ${fmt(m.ballast_g, 0)} g nose ballast` : ''), stat('CG', `${fmt(m.cgPctActual, 1)}<small>% MAC</small>`, `design ${fmt(m.cgPctDesign, 1)}%`, Math.abs(m.cgPctActual - m.cgPctDesign) > 2 ? 'is-warn' : ''),
    stat('Trim speed', SPD(tr.V), `${fmt(tr.throttle * 100, 0)}% throttle, α ${fmt(tr.alphaDeg, 1)}°`, tr.feasible ? '' : 'is-warn'), stat('Stall (predicted)', SPD(preds.vs), `wing stalls at ${fmt(m.alphaStallDeg, 1)}°`),
    stat('Power system', `${m.cells}S`, `${esc(m.motor.name)} · ${m.propSpec.d}×${m.propSpec.p} · ${m.capacity_mAh} mAh`), stat('Static thrust', `${fmt(m.thrTable[20].T0 / G * 1000, 0)}<small>gf</small>`, `T/W ${fmt(m.thrTable[20].T0 / (m.mass * G), 2)}`)].join('');
  const w = [];
  if (!tr.converged) w.push(['warn', 'This design cannot trim for level flight. Check the CG and tail in the Designer.']);
  else if (!tr.feasible) w.push(['warn', 'Needs (nearly) full throttle to cruise: the power system is too small.']);
  if (m.ballast_g > 0.5) w.push(['info', `To reach the design CG the battery would have to sit ahead of the nose, so ${fmt(m.ballast_g, 0)} g of nose ballast was added (as you would when building).`]);
  if (m.cgShift) w.push(['warn', `The design CG cannot be reached by moving the battery, so the simulator flies with the actual CG at ${fmt(m.cgPctActual, 1)}% MAC.`]);
  if (m.asBuilt) w.push(['info', 'Flying with your as-built measurements (weight and CG) from the Designer.']);
  if (m.calibrated) w.push(['info', `Calibrated from flight data: drag ×${fmt(m.cal.cd0, 2)}, max lift ×${fmt(m.cal.clmax, 2)}, thrust ×${fmt(m.cal.thrust, 2)}, current ×${fmt(m.cal.current, 2)}, ailerons ×${fmt(m.cal.roll, 2)}.`]);
  if (Math.abs(m.rho - RHO_SL) > 0.01) w.push(['info', `Air density ${fmt(m.rho, 3)} kg/m³ (density altitude ${fmt(SimPhysics.densityAltitude(m.rho), 0)} m): stall and trim speeds are ${fmt((Math.sqrt(RHO_SL / m.rho) - 1) * 100, 0)}% higher than on a standard sea-level day.`]);
  if (!design.power) w.push(['info', `No motor chosen in the Designer, so the best match (${m.motor.name}, ${m.propSpec.d}×${m.propSpec.p}) is used.`]);
  $('#mdl-warn').innerHTML = w.map(([c, t]) => `<li class="${c}">${RC.icon(c === 'warn' ? 'warn' : 'info')}<span>${esc(t)}</span></li>`).join('');
  for (const a of ['ail', 'ele', 'rud']) { $(`#m-${a}`).value = m.throws[a]; $(`#m-${a}-o`).textContent = `${m.throws[a]}°`; }
  $('#m-gear').value = settings.gear[sourceKey] || 'auto'; $('#m-wing').value = settings.color;
  $('#m-usecal').checked = settings.useCal !== false; $('#m-usecal-hint').textContent = settings.calibrations[sourceKey] || design.calibration ? `Calibration from ${(settings.calibrations[sourceKey] || design.calibration).date || 'flight data'}` : 'No calibration yet (see the Calibrate tab)';
  renderMountPanel();
  const baseCg = asBuilt(design).geom.cg, cgNow = settings.cg[sourceKey] != null ? settings.cg[sourceKey] : baseCg;
  $('#m-cg').value = cgNow; $('#m-cg-o').textContent = `${fmt(m.cgPctActual, 1)}% MAC`;
  $('#m-cg-hint').textContent = `${settings.cg[sourceKey] != null ? 'Overridden for testing. ' : ''}${design.measured && design.measured.use ? 'Design file uses as-built measurements' : 'Design CG'}: ${fmt(baseCg, 1)}% MAC. Neutral point ≈ ${fmt(m.cgPctActual + SimPhysics.measureStaticMargin(m).SM * 100, 1)}% MAC.`;
}
let mountSugCache = { key:'', res:null };
function mountSuggestion(){ const d = flightDesign(), base = JSON.parse(JSON.stringify(asBuilt(design))); if (settings.cg[sourceKey] != null) base.geom.cg = settings.cg[sourceKey]; const mo = settings.mount[sourceKey]; if (mo && mo.rot) base.geom.propRot = mo.rot;
  const key = JSON.stringify([sourceKey, base.geom, base.auw, base.power, env.rhoAt(0).toFixed(3)]); if (mountSugCache.key !== key) mountSugCache = { key, res:SimModel.suggestThrustAngles(base, { customMotors:RC.store.get(RC.KEYS.motors, []) || [], rho:env.rhoAt(0) }) }; return mountSugCache.res; }
function renderMountPanel(){
  const fx = settings.motorFx !== false, base = asBuilt(design).geom, mo = settings.mount[sourceKey] || {}, dn = mo.down != null ? mo.down : (+base.thrustDown || 0), rt = mo.right != null ? mo.right : (+base.thrustRight || 0);
  $('#m-motorfx').checked = fx; $('#m-tdown').value = dn; $('#m-tright').value = rt; $('#m-prot').value = mo.rot || base.propRot || 'cw';
  $('#m-tdown-o').textContent = `${fmt(dn, 1)}°${dn < 0 ? ' (up)' : ''}`; $('#m-tright-o').textContent = `${fmt(rt, 1)}°${rt < 0 ? ' (left)' : ''}`;
  ['#m-tdown', '#m-tright', '#m-prot', '#m-mount-sug'].forEach(id => { $(id).disabled = !fx; });
  const over = settings.mount[sourceKey] && Object.keys(settings.mount[sourceKey]).length;
  $('#m-mount-hint').textContent = !fx ? 'Motor effects are off: thrust acts straight along the fuselage, with no torque or slipstream.' :
    `${over ? 'Changed for this flight. ' : ''}Design mount: ${SimModel.describeThrust(+base.thrustDown || 0, +base.thrustRight || 0, base.motorPos === 'pusher')}. Run “Test power response”, or open the throttle in level flight, to feel the difference.`;
}
let mountT = null;
const mountChanged = () => { saveSettings(); renderMountPanel(); clearTimeout(mountT); mountT = setTimeout(() => loadAircraft(sourceKey, true), 200); };
$('#m-motorfx').addEventListener('input', e => { settings.motorFx = e.target.checked; mountChanged(); RC.toast(e.target.checked ? 'Motor effects on: torque, slipstream, P-factor and mount angles' : 'Motor effects off: ideal straight-ahead thrust'); });
$('#m-tdown').addEventListener('input', e => { settings.mount[sourceKey] = Object.assign({}, settings.mount[sourceKey], { down:+e.target.value }); mountChanged(); });
$('#m-tright').addEventListener('input', e => { settings.mount[sourceKey] = Object.assign({}, settings.mount[sourceKey], { right:+e.target.value }); mountChanged(); });
$('#m-prot').addEventListener('input', e => { settings.mount[sourceKey] = Object.assign({}, settings.mount[sourceKey], { rot:e.target.value }); mountChanged(); });
$('#m-mount-reset').addEventListener('click', () => { delete settings.mount[sourceKey]; mountChanged(); });
$('#m-mount-sug').addEventListener('click', () => { $('#m-mount-hint').textContent = 'Working out the best mount…'; setTimeout(() => { const r = mountSuggestion();
  settings.mount[sourceKey] = Object.assign({}, settings.mount[sourceKey], { down:r.down, right:r.right }); mountChanged(); RC.toast(`Mount set to ${SimModel.describeThrust(r.down, r.right, r.pusher)} (${Math.round(r.improvement * 100)}% calmer)`); }, 30); });
$('#m-mount-test').addEventListener('click', () => { selectTab($('#tab-tests')); const r = runOne('power'); RC.toast(`Power response: ${r.note}`); });
function updateLinks(){
  const h = '#design=' + RC.b64urlEncode(JSON.stringify(design));
  $('#m-open-designer').href = 'designer.html' + h; $('#nav-designer').href = 'designer.html' + h; $('#nav-build').href = 'build.html' + h;
}
['ail', 'ele', 'rud'].forEach(a => $(`#m-${a}`).addEventListener('input', e => { settings.throws[sourceKey] = Object.assign({}, settings.throws[sourceKey], { [a]:+e.target.value }); model.throws[a] = +e.target.value; $(`#m-${a}-o`).textContent = `${e.target.value}°`; saveSettings(); }));
$('#m-cg').addEventListener('input', e => { settings.cg[sourceKey] = +e.target.value; saveSettings(); clearTimeout(cgT); cgT = setTimeout(() => loadAircraft(sourceKey, true), 150); });
$('#m-usecal').addEventListener('input', e => { settings.useCal = e.target.checked; saveSettings(); loadAircraft(sourceKey, true); });
$('#m-cg-reset').addEventListener('click', () => { delete settings.cg[sourceKey]; saveSettings(); loadAircraft(sourceKey, true); });
let cgT = null;
$('#m-gear').addEventListener('input', e => { settings.gear[sourceKey] = e.target.value; saveSettings(); loadAircraft(sourceKey); });
$('#m-wing').addEventListener('input', e => { settings.color = e.target.value; world.setAircraftColors({ wing:e.target.value }); saveSettings(); });
$('#m-glb').addEventListener('click', () => world.exportGLB((blob, err) => { if (blob) { RC.download(blob, `${(design.name || 'aircraft').replace(/[^\w-]+/g, '_')}.glb`); RC.toast('GLB exported'); } else RC.toast('GLB export failed: ' + err); }));
$('#m-pack').addEventListener('click', () => { const src = sources.get(sourceKey), rec = src && src.rec ? src.rec : { name:design.name, design };
  RC.download(new Blob([SimImport.packageModel(Object.assign({}, rec, { design }))], { type:'application/json' }), `${(design.name || 'aircraft').replace(/[^\w-]+/g, '_')}.rcsim`); RC.toast('Model package exported'); });

/* ---------------- import wizard ---------------- */
let imp = null;
$('#imp-file').addEventListener('change', async e => {
  const files = Array.from(e.target.files); if (!files.length) return; e.target.value = '';
  try {
    const { main, extras } = await SimImport.readFiles(files), f = main.file, type = main.type, data = main.data;
    if (type === 'rcsim' || type === 'json') { const rec = SimImport.unpackage(await f.text()); await SimImport.put(rec); await buildSources(); await loadAircraft('imp:' + rec.id); RC.toast(`Imported ${rec.name}${SimImport.credit(rec.meta) ? ': ' + SimImport.credit(rec.meta) : ''}`); return; }
    const obj = await SimImport.parse(data, type, extras), st = SimImport.stats(obj), meta = obj.userData.meta || {};
    if (st.tris > SimImport.MAX_TRIS) { RC.toast(`That model has ${fmt(st.tris, 0)} triangles; please simplify it below ${fmt(SimImport.MAX_TRIS, 0)} (e.g. Blender Decimate).`); return; }
    imp = { data, type, fileName:f.name, extras, obj, cands:SimImport.candidates(obj), map:{} };
    imp.cands.forEach(c => { if (c.role) imp.map[c.uuid] = c.role; });
    $('#imp-name').value = meta.title || f.name.replace(/\.[^.]+$/, ''); $('#imp-author').value = meta.author || ''; $('#imp-license').value = meta.license || ''; $('#imp-source').value = SimImport.safeUrl(meta.source) || ''; licHint(obj); $('#imp-flight').value = sourceKey.startsWith('imp:') ? 'builtin:trainer' : sourceKey;
    $('#imp-stats').innerHTML = `<span class="pill">${fmt(st.tris, 0)} triangles</span><span class="pill">${st.meshes} meshes</span><span class="pill">${imp.cands.filter(c => c.role).length} moving parts detected</span>${Object.keys(extras).length ? `<span class="pill">+${Object.keys(extras).length} extra file${Object.keys(extras).length > 1 ? 's' : ''}</span>` : ''}${obj.userData.mtlMatched ? `<span class="pill">${obj.userData.mtlMatched} MTL materials</span>` : ''}`;
    $('#imp-parts').innerHTML = `<thead><tr><th scope="col">Part name</th><th scope="col">Role</th></tr></thead><tbody>${imp.cands.slice(0, 60).map(c => `<tr><th scope="row">${esc(c.name)}</th><td><select data-uuid="${c.uuid}" aria-label="Role of ${esc(c.name)}">${['none', 'aileron', 'elevator', 'rudder', 'elevon', 'flap', 'prop'].map(r => `<option value="${r}"${(imp.map[c.uuid] || 'none') === r ? ' selected' : ''}>${r}</option>`).join('')}</select></td></tr>`).join('') || '<tr><td colspan="2" class="hint">No named parts found. The model will fly as one piece.</td></tr>'}</tbody>`;
    $('#imp-wizard').hidden = false; $('#imp-box').open = true; previewImport();
  } catch (err) { RC.toast(err.message || String(err)); }
});
['#imp-fwd', '#imp-up', '#imp-dz', '#imp-dy', '#imp-flight'].forEach(s => $(s).addEventListener('input', () => { $('#imp-dz-o').textContent = $('#imp-dz').value; $('#imp-dy-o').textContent = $('#imp-dy').value; previewImport(); }));
$('#imp-parts').addEventListener('input', e => { const u = e.target.dataset.uuid; if (u) { imp.map[u] = e.target.value; imp.map.__manual = true; previewImport(); } });
function alignOf(){ return { forward:$('#imp-fwd').value, up:$('#imp-up').value, dz:+$('#imp-dz').value / 1000, dy:+$('#imp-dy').value / 1000, map:imp.map, autoMap:false }; }
async function previewImport(){
  if (!imp) return;
  try { const src = sources.get($('#imp-flight').value); design = JSON.parse(JSON.stringify(src.design())); model = SimModel.build(design, { rho:env.rhoAt(0) }); preds = SimModel.predictions(design, model); sim = new SimPhysics.Sim(model, { env }); reset();
    const obj = await SimImport.parse(imp.data, imp.type, imp.extras); const vis = SimImport.prepare(obj, alignOf(), model); world.setAircraft(model, vis); renderModelPanel(); }
  catch (err) { RC.toast(err.message); }
}
$('#imp-cancel').addEventListener('click', () => { imp = null; $('#imp-wizard').hidden = true; loadAircraft(sourceKey); });
$('#imp-save').addEventListener('click', async () => {
  const src = sources.get($('#imp-flight').value), rec = { id:'m' + Date.now(), name:$('#imp-name').value || 'Imported model', fileName:imp.fileName, type:imp.type, data:imp.data, extras:imp.extras, meta:impMeta(), align:alignOf(), design:JSON.parse(JSON.stringify(src.design())), created:Date.now() };
  rec.design.name = rec.name;
  try { await SimImport.put(rec); imp = null; $('#imp-wizard').hidden = true; await buildSources(); await loadAircraft('imp:' + rec.id); RC.toast('Model saved in this browser'); }
  catch (err) { RC.toast('Could not save: ' + err.message); }
});
function impMeta(){ const m = { title:$('#imp-name').value.trim(), author:$('#imp-author').value.trim(), license:$('#imp-license').value.trim(), source:SimImport.safeUrl($('#imp-source').value.trim()) || '' };
  if (imp && imp.obj && imp.obj.userData.meta) { const o = imp.obj.userData.meta; if (o.copyright) m.copyright = o.copyright; if (o.licenseText) m.licenseText = o.licenseText; }
  for (const k of Object.keys(m)) if (!m[k]) delete m[k]; return m; }
function licHint(obj){ const lic = $('#imp-license').value.trim(), u = obj && obj.userData;
  const msg = [u && u.mtlWanted && !u.mtlMatched ? `This OBJ uses “${u.mtlWanted}”: select it together with the .obj to get its colours.` : '',
    !lic ? 'No licence found in the file: check where it came from before you share it (e.g. exporting an .rcsim).' : /\bNC\b|non.?commercial/i.test(lic) ? 'Non-commercial licence: fine for personal flying; do not sell or use it commercially.' : /\bND\b|no.?deriv/i.test(lic) ? 'No-derivatives licence: you may fly it but should not share modified versions.' : /BY/i.test(lic) ? 'Attribution licence: keep the author credit when you share it (it is saved with the model and in .rcsim packages).' : ''].filter(Boolean);
  $('#imp-lic-hint').textContent = msg.join(' '); }
$('#imp-license').addEventListener('input', () => licHint(imp && imp.obj));
async function renderImported(){
  let list = []; try { list = await SimImport.list(); } catch (e) { /* none */ }
  $('#imp-list').innerHTML = list.length ? `<h3 class="sub-h">Imported models</h3>${list.map(r => `<div class="dev"><span><b>${esc(r.name)}</b><small class="hint">${esc(r.fileName || 'package')} · flight data: ${esc((r.design && r.design.name) || '')}${SimImport.credit(r.meta) ? ` · ${esc(SimImport.credit(r.meta))}` : ''}${r.meta && SimImport.safeUrl(r.meta.source) ? ` · <a href="${esc(r.meta.source)}" target="_blank" rel="noopener noreferrer">source</a>` : ''}</small></span><span><button type="button" class="btn sm" data-fly="${r.id}">Fly</button> <button type="button" class="btn sm danger" data-del-imp="${r.id}" aria-label="Delete ${esc(r.name)}">${RC.icon('trash')}</button></span></div>`).join('')}` : '';
}
$('#imp-list').addEventListener('click', async e => { const f = e.target.closest('[data-fly]'), d = e.target.closest('[data-del-imp]');
  if (f) loadAircraft('imp:' + f.dataset.fly);
  if (d && confirm('Delete this imported model?')) { await SimImport.del(d.dataset.delImp); await buildSources(); if (sourceKey === 'imp:' + d.dataset.delImp) loadAircraft('builtin:trainer'); } });

/* ---------------- controls panel & wizard ---------------- */
let wizardOpen = false;
function renderDevices(){
  const pads = input.pads();
  $('#dev-list').innerHTML = `<div class="dev"><span><b>Keyboard</b><small class="hint">Always available</small></span><span class="fit ok">${RC.icon('check')}ready</span></div>` +
    (pads.length ? pads.map(gp => { const prof = input.saved.profiles[gp.id], std = gp.mapping === 'standard';
      return `<div class="dev"><span><b>${esc(gp.id.slice(0, 60))}</b><small class="hint">${prof ? 'Custom profile (wizard)' : std ? 'Standard layout: works without setup' : 'Unknown layout: needs setup'}</small></span><span>${!std || prof ? `<button type="button" class="btn sm" data-setup="${esc(gp.id)}">${prof ? 'Set up again' : 'Set up'}</button>` : ''}${prof ? ` <button type="button" class="btn sm" data-forget="${esc(gp.id)}">Forget</button>` : ''}${std && !prof ? ` <button type="button" class="btn sm" data-setup="${esc(gp.id)}">Map manually</button>` : ''}</span></div>`; }).join('')
      : `<p class="hint">No controller detected. Plug in the Xbox controller (USB or Bluetooth) or your transmitter's USB adapter, then press any button or move a stick.</p>`);
}
$('#dev-list').addEventListener('click', e => { const s = e.target.closest('[data-setup]'), f = e.target.closest('[data-forget]');
  if (s) { const gp = input.pads().find(p => p.id === s.dataset.setup); if (gp) { input.startWizard(gp); wizardOpen = true; $('#wiz').hidden = false; $('#wiz-msg').textContent = ''; } }
  if (f) { input.forget(f.dataset.forget); renderDevices(); } });
function renderWizard(){
  const w = input.wizard; if (!w) return;
  if (w.done) { const p = input.finishWizard(input.pads().find(g => g.id === w.id)?.id.slice(0, 40)); wizardOpen = false; $('#wiz').hidden = true; RC.toast(`Saved profile for ${p.name}`); renderDevices(); return; }
  $('#wiz-text').textContent = `Step ${w.step + 1} of ${SimInput.WIZARD_STEPS.length}: ${w.current.text}`;
  $('#wiz-skip').hidden = !w.current.optional;
  const ax = w.last || []; $('#wiz-axes').innerHTML = ax.map((v, i) => `<div><span>Axis ${i}</span><span class="ab"><i style="left:${((v + 1) / 2 * 100).toFixed(1)}%"></i></span></div>`).join('');
}
$('#wiz-next').addEventListener('click', () => { const r = input.wizard.next(false); $('#wiz-msg').textContent = r.ok ? '' : r.msg; });
$('#wiz-skip').addEventListener('click', () => { input.wizard.next(true); });
$('#wiz-cancel').addEventListener('click', () => { input.wizard = null; wizardOpen = false; $('#wiz').hidden = true; });
const prefs = input.saved.prefs, tun = input.saved.tuning;
$('#c-mode').value = String(prefs.mode || 2); $('#c-thr').value = prefs.thrMode || 'trigger'; $('#c-inv').checked = !!prefs.invertEle; $('#c-dual').checked = !!tun.dual;
$('#c-mode').addEventListener('input', e => { prefs.mode = +e.target.value; input.save(); });
$('#c-thr').addEventListener('input', e => { prefs.thrMode = e.target.value; input.save(); });
$('#c-inv').addEventListener('input', e => { prefs.invertEle = e.target.checked; input.save(); });
$('#c-dual').addEventListener('input', e => { tun.dual = e.target.checked; input.save(); });
$('#c-tune').innerHTML = ['ail', 'ele', 'rud'].map(a => `<div class="field" style="margin:0"><label for="ce-${a}">${{ ail:'Aileron', ele:'Elevator', rud:'Rudder' }[a]} expo <output id="ce-${a}-o">${tun.expo[a]}</output></label><input id="ce-${a}" type="range" min="0" max="0.8" step="0.05" value="${tun.expo[a]}" data-expo="${a}">
  <label for="cr-${a}">rate <output id="cr-${a}-o">${tun.rate[a]}</output></label><input id="cr-${a}" type="range" min="0.3" max="1" step="0.05" value="${tun.rate[a]}" data-rate="${a}"></div>`).join('');
$('#c-tune').addEventListener('input', e => { const a = e.target.dataset.expo || e.target.dataset.rate; if (!a) return; (e.target.dataset.expo ? tun.expo : tun.rate)[a] = +e.target.value; $(`#${e.target.id}-o`).textContent = e.target.value; input.save(); });
// on-screen remote: two gimbals like a transmitter (Mode 2: left = throttle/rudder, right = elevator/aileron)
const TOUCH = matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints || 0) > 0;
if (settings.touch == null) settings.touch = TOUCH;
function setThrottleInput(v){ input.state.thr = v; if (input.virtual.on) input.virtual.thr = v; }
function stickRoles(){ return (input.saved.prefs.mode || 2) === 1 ? { left:['rud', 'ele'], right:['ail', 'thr'] } : { left:['rud', 'thr'], right:['ail', 'ele'] }; }
const LAB = { rud:'rudder', thr:'throttle', ail:'aileron', ele:'elevator' };
function drawGimbal(side){
  const el = $(`#gb-${side}`), [ax, ay] = stickRoles()[side], v = input.virtual, kx = v[ax] || 0, ky = ay === 'thr' ? 1 - 2 * (v.thr || 0) : (v[ay] || 0);
  const w = el.clientWidth || 160; el.querySelector('.knob').style.transform = `translate(calc(-50% + ${(kx * 0.38 * w).toFixed(1)}px), calc(-50% + ${(ky * 0.38 * w).toFixed(1)}px))`;
  const g = el.querySelector('.gb-thr'); g.hidden = ay !== 'thr'; if (ay === 'thr') g.firstElementChild.style.height = `${Math.round((v.thr || 0) * 100)}%`;
  el.querySelector('.gb-lab').textContent = `${LAB[ay]} ↕ · ${LAB[ax]} ↔`;
}
function bindGimbal(side){
  const el = $(`#gb-${side}`); let pid = null, o = null;
  const r = () => el.getBoundingClientRect(), R = () => r().width * 0.42;
  const apply = e => { const [ax, ay] = stickRoles()[side], dx = (e.clientX - o.x) / R(), dy = (e.clientY - o.y) / R();
    input.virtual[ax] = Math.max(-1, Math.min(1, dx));
    if (ay === 'thr') input.virtual.thr = Math.max(0, Math.min(1, o.thr - dy / 2)); // ratchet: moves from where it was, never jumps
    else input.virtual[ay] = Math.max(-1, Math.min(1, dy));
    drawGimbal(side); };
  el.addEventListener('pointerdown', e => { e.preventDefault(); pid = e.pointerId; el.setPointerCapture(pid); o = { x:e.clientX, y:e.clientY, thr:input.virtual.thr || 0 }; el.classList.add('active'); apply(e); });
  el.addEventListener('pointermove', e => { if (e.pointerId === pid) apply(e); });
  const up = e => { if (e.pointerId !== pid) return; pid = null; el.classList.remove('active'); const [ax, ay] = stickRoles()[side]; input.virtual[ax] = 0; if (ay !== 'thr') input.virtual[ay] = 0; drawGimbal(side); };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
}
['left', 'right'].forEach(bindGimbal);
function setRemote(on){
  input.virtual.on = on; settings.touch = on; saveSettings(); $('#c-touch').checked = on; $('#remote').hidden = !on; document.body.classList.toggle('remote-on', on);
  if (on) { input.virtual.thr = input.state.thr || 0; input.virtual.ail = input.virtual.ele = input.virtual.rud = 0; drawGimbal('left'); drawGimbal('right'); }
  checkOrientation();
}
$('#c-touch').addEventListener('input', e => setRemote(e.target.checked));
$('#c-mode').addEventListener('input', () => { drawGimbal('left'); drawGimbal('right'); });
$('#rm-reset').addEventListener('click', () => { if (replay) exitReplay(); reset(); });
const rr = $('#rm-rescue'); rr.addEventListener('pointerdown', e => { e.preventDefault(); rescueKey = true; rr.classList.add('on'); }); ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => rr.addEventListener(ev, () => { rescueKey = false; rr.classList.remove('on'); }));
$('#rm-cam').addEventListener('click', () => $('#hud-cam').click());
$('#rm-assist').addEventListener('click', () => { const order = ['angle', 'level', 'off'], i = order.indexOf(settings.assist); settings.assist = order[(i + 1) % 3]; $('#f-assist').value = settings.assist; saveSettings(); RC.toast(`Assist: ${{ angle:'beginner', level:'auto-level', off:'off (real)' }[settings.assist]}`); });
// phones: full screen + landscape, compact layout
const fsOK = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
$('#hud-fs').hidden = !(TOUCH && fsOK);
$('#hud-fs').addEventListener('click', async () => { const d = document.documentElement;
  try { if (document.fullscreenElement || document.webkitFullscreenElement) { await (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
    await (d.requestFullscreen || d.webkitRequestFullscreen).call(d, { navigationUI:'hide' }); if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape').catch(() => {}); } catch (e) { /* not allowed */ }
  setTimeout(() => world.resize(), 200); });
document.addEventListener('fullscreenchange', () => { $('#hud-fs').textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen'; setTimeout(() => world.resize(), 200); });
let portraitOK = false;
function checkOrientation(){ const portrait = innerHeight > innerWidth && innerWidth < 700; $('#rotate-hint').hidden = !(settings.touch && TOUCH && portrait && !portraitOK); document.body.classList.toggle('sim-compact', TOUCH && Math.min(innerWidth, innerHeight) < 560); $('#hud-home').hidden = !document.body.classList.contains('sim-compact'); }
$('#rotate-ok').addEventListener('click', () => { portraitOK = true; checkOrientation(); });
addEventListener('resize', () => { checkOrientation(); setTimeout(() => world.resize(), 100); });
if (TOUCH && Math.min(innerWidth, innerHeight) < 560) { const sh = $('.sim-shell'); sh.classList.add('panel-hidden'); $('#hud-panel').setAttribute('aria-expanded', 'false'); }
setRemote(!!settings.touch);

/* ---------------- scenario sharing (#scenario=) ---------------- */
function scenarioPlane(){ const k = scenario.plane; return k && k.startsWith('builtin:') && sources.has(k) ? k : sources.has('scenario') ? 'scenario' : settings.model; }
function makeScenario(withLesson){
  const sc = { v:1, title:(design && design.name) || '', plane:sourceKey, weather:Object.assign({}, W, { show:undefined }), start:settings.start, assist:settings.assist, instructor:settings.instructor, gear:settings.gear[sourceKey], throws:settings.throws[sourceKey], cg:settings.cg[sourceKey], mount:settings.mount[sourceKey], motorFx:settings.motorFx !== false };
  if (!sourceKey.startsWith('builtin:')) { const d = flightDesign(); delete d.calibration; sc.design = d; }
  if (withLesson && lesson) sc.lesson = lesson.def.id; return sc;
}
function scenarioUrl(){ return location.href.split('#')[0] + '#scenario=' + RC.b64urlEncode(JSON.stringify(makeScenario($('#sh-lesson').checked))); }
function applyScenario(sc){
  const num = (v, a, b) => (typeof v === 'number' && isFinite(v) ? Math.max(a, Math.min(b, v)) : undefined), pick = (v, list) => (list.includes(v) ? v : undefined);
  if (sc.weather && typeof sc.weather === 'object') { const w = {}; for (const k of SimPhysics.WEATHER_KEYS) if (sc.weather[k] != null) w[k] = typeof sc.weather[k] === 'boolean' ? sc.weather[k] : num(+sc.weather[k], -1e4, 1e5);
    Object.assign(settings.weather, w, { preset:pick(sc.weather.preset, Object.keys(SimPhysics.WEATHER_PRESETS).concat('custom')) || 'custom' }); }
  settings.start = pick(sc.start, ['runway', 'hand', 'air']) || settings.start; settings.assist = pick(sc.assist, ['angle', 'level', 'off']) || settings.assist; settings.instructor = pick(sc.instructor, ['off', 'switch', 'auto', 'shared']) || settings.instructor;
  const key = sc.plane && String(sc.plane).startsWith('builtin:') ? sc.plane : 'scenario';
  if (sc.gear) settings.gear[key] = pick(sc.gear, ['auto', 'tricycle', 'taildragger', 'skid', 'none']); if (num(sc.cg, 0, 60) != null) settings.cg[key] = sc.cg;
  if (typeof sc.motorFx === 'boolean') settings.motorFx = sc.motorFx;
  if (sc.mount && typeof sc.mount === 'object') settings.mount[key] = { down:num(sc.mount.down, -8, 8), right:num(sc.mount.right, -8, 8), rot:pick(sc.mount.rot, ['cw', 'ccw']) };
  if (sc.throws && typeof sc.throws === 'object') settings.throws[key] = { ail:num(sc.throws.ail, 0, 45), ele:num(sc.throws.ele, 0, 45), rud:num(sc.throws.rud, 0, 45) };
}
const scenario = (() => { const sc = RC.readHash('scenario'); if (!sc || sc.v !== 1) return null; try { applyScenario(sc); } catch (e) { setTimeout(() => RC.toast('That scenario link could not be read: ' + e.message), 500); return null; } return sc; })();
$('#share-box').addEventListener('toggle', e => { if (e.target.open) $('#sh-url').value = scenarioUrl(); });
$('#sh-lesson').addEventListener('input', () => { $('#sh-url').value = scenarioUrl(); });
$('#sh-copy').addEventListener('click', async () => { const u = scenarioUrl(); $('#sh-url').value = u;
  try { await navigator.clipboard.writeText(u); RC.toast('Scenario link copied'); } catch (e) { $('#sh-url').select(); RC.toast('Press Ctrl/Cmd+C to copy the selected link'); } });

/* ---------------- world panel (weather & air) ---------------- */
const W = settings.weather;
const WSL = { 'w-speed':['speed', v => SPD(v)], 'w-dir':['dir', v => `${v}° (${['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(v / 45) % 8]})`], 'w-dirvar':['dirVar', v => `±${v}°`],
  'w-shear':['shear', v => v < 0.13 ? `${v} (open water)` : v < 0.2 ? `${v} (open field)` : v < 0.27 ? `${v} (trees nearby)` : `${v} (town / forest)`],
  'w-gpeak':['gustPeak', v => v ? `+${SPD(v)}` : 'none'], 'w-gint':['gustInterval', v => `${v} s`], 'w-turb':['turbulence', v => `${Math.round(v * 100)}%`],
  'w-tstr':['thermalStrength', v => VS(v)], 'w-tsize':['thermalSize', v => `${v} m radius`], 'w-tcount':['thermalCount', v => `${v}`], 'w-sink':['sink', v => `${Math.round(v * 100)}%`],
  'w-temp':['tempC', v => `${v} °C`], 'w-elev':['elevation', v => ALT(v)], 'w-qnh':['qnh', v => `${v} hPa`], 'w-clouds':['clouds', v => `${Math.round(v * 100)}%`], 'w-vis':['visibility', v => `${fmt(v / 1000, 1)} km`] };
const AIR_KEYS = ['tempC', 'elevation', 'qnh'];
function syncWeather(){
  $('#w-preset').value = W.preset || 'custom';
  for (const [id, [k, f]] of Object.entries(WSL)) { $('#' + id).value = W[k]; $('#' + id + '-o').textContent = f(+W[k]); }
  $('#w-thermals').checked = !!W.thermals; $('#w-showth').checked = !!W.show;
  const rho = env.rhoAt(0), da = SimPhysics.densityAltitude(rho);
  $('#w-air').innerHTML = [`Density <b>${fmt(rho, 3)} kg/m³</b>`, `Density altitude <b>${ALT(da)}</b>`, `Stall speed <b>${(Math.sqrt(RHO_SL / rho) - 1) >= 0 ? '+' : ''}${fmt((Math.sqrt(RHO_SL / rho) - 1) * 100, 0)}%</b> vs standard`].map(t => `<span class="pill">${t}</span>`).join('');
  $('#w-summary').innerHTML = [`<b>${esc((SimPhysics.WEATHER_PRESETS[W.preset] || { label:'Custom' }).label)}</b>`, `${SPD(W.speed)} from ${W.dir}°`, W.gustPeak ? `gusts +${SPD(W.gustPeak)}` : 'no gusts', W.thermals ? 'thermals' : ''].filter(Boolean).map(t => `<span class="pill">${t}</span>`).join('');
}
function applyWeather(airChanged){
  if (!lesson) env.set(W); else env.set({ tempC:W.tempC, elevation:W.elevation, qnh:W.qnh });
  world.setWeather({ clouds:W.clouds, visibility:W.visibility }); world.showThermals(env.thermalList, W.show);
  syncWeather(); saveSettings();
  if (airChanged && model) { clearTimeout(airT); airT = setTimeout(() => loadAircraft(sourceKey, true), 250); }
}
let airT = null;
$('#w-preset').addEventListener('input', e => { if (e.target.value !== 'custom') Object.assign(W, SimPhysics.WEATHER_PRESETS[e.target.value]); W.preset = e.target.value; applyWeather(false); });
Object.keys(WSL).forEach(id => $('#' + id).addEventListener('input', e => { const k = WSL[id][0]; W[k] = +e.target.value; if (!AIR_KEYS.includes(k) && k !== 'clouds' && k !== 'visibility' && k !== 'dir') W.preset = 'custom'; applyWeather(AIR_KEYS.includes(k)); }));
$('#w-thermals').addEventListener('input', e => { W.thermals = e.target.checked; W.preset = 'custom'; applyWeather(false); });
$('#w-showth').addEventListener('input', e => { W.show = e.target.checked; applyWeather(false); });
$('#w-trees').addEventListener('input', e => { settings.trees = e.target.checked; saveSettings(); });
$('#w-photo').addEventListener('change', e => { const f = e.target.files[0]; if (!f) return; const url = URL.createObjectURL(f);
  new THREE.TextureLoader().load(url, tex => { world.setPanorama(tex); env.obstacles = []; settings.cam = 'pilot'; applyCam(); RC.toast('Photo field loaded (pilot view)'); }, undefined, () => RC.toast('Could not load that image')); });
$('#w-photo-clear').addEventListener('click', () => { world.setPanorama(null); env.obstacles = world.obstacles(); applyWeather(false); });
$('#w-scene').addEventListener('change', async e => { if (!e.target.files.length) return; try { const { main, extras } = await SimImport.readFiles(e.target.files), obj = await SimImport.parse(main.data, main.type, extras); world.setScenery(obj, { hideDefault:$('#w-hidetrees').checked }); RC.toast('Scenery loaded'); } catch (err) { RC.toast(err.message); } });
$('#w-hidetrees').addEventListener('input', e => world.setScenery(world.scenery, { hideDefault:e.target.checked }));
$('#w-scene-clear').addEventListener('click', () => world.setScenery(null, { hideDefault:false }));

/* ---------------- graphics ---------------- */
const GFX_PRESETS = { low:{ shadows:'off', drawDistance:1200, resScale:0.6 }, medium:{ shadows:'low', drawDistance:2000, resScale:0.85 }, high:{ shadows:'medium', drawDistance:3000, resScale:1 }, ultra:{ shadows:'high', drawDistance:5000, resScale:1 } };
if (!settings.gfx) { const phone = (matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0) && Math.min(screen.width, screen.height) < 820; settings.gfx = Object.assign({ preset:phone ? 'medium' : 'high' }, phone ? GFX_PRESETS.medium : GFX_PRESETS.high); }
function applyGraphics(){ const g = settings.gfx; world.setGraphics(g); $('#g-preset').value = g.preset; $('#g-shadows').value = g.shadows; $('#g-res').value = g.resScale; $('#g-dist').value = g.drawDistance;
  $('#g-res-o').textContent = `${Math.round(g.resScale * 100)}%`; $('#g-dist-o').textContent = ALT(g.drawDistance); saveSettings(); }
$('#g-preset').addEventListener('input', e => { if (GFX_PRESETS[e.target.value]) Object.assign(settings.gfx, GFX_PRESETS[e.target.value]); settings.gfx.preset = e.target.value; applyGraphics(); });
[['#g-shadows', 'shadows', v => v], ['#g-res', 'resScale', Number], ['#g-dist', 'drawDistance', Number]].forEach(([id, k, f]) => $(id).addEventListener('input', e => { settings.gfx[k] = f(e.target.value); settings.gfx.preset = 'custom'; applyGraphics(); }));
let lowFpsT = 0, gfxHinted = false;
function watchFps(dt){ if (document.hidden) return; lowFpsT = fps < 28 ? lowFpsT + dt : Math.max(0, lowFpsT - dt);
  if (lowFpsT > 6 && !gfxHinted && settings.gfx.preset !== 'low') { gfxHinted = true; RC.toast('Running slowly: try World → Graphics → Low'); }
  $('#g-fps').textContent = `${Math.round(fps)} frames per second${fps < 28 ? ': lower the quality for smoother flying' : ''}`; }

/* ---------------- fly panel & HUD buttons ---------------- */
$('#f-model').addEventListener('input', e => { if (lesson) stopLesson(); loadAircraft(e.target.value); });
$('#f-start').addEventListener('input', e => { settings.start = e.target.value; saveSettings(); reset(); });
$('#f-cam').addEventListener('input', e => { settings.cam = e.target.value; applyCam(); });
$('#f-assist').addEventListener('input', e => { settings.assist = e.target.value; saveSettings(); });
$('#f-speed').addEventListener('input', e => { settings.speed = +e.target.value; saveSettings(); });
$('#f-instr').addEventListener('input', e => { settings.instructor = e.target.value; if (instructor) instructor.mode = e.target.value; saveSettings(); RC.toast({ off:'Instructor off', switch:'Buddy box: hold SPACE / LB (or your student switch) to fly; let go and the instructor flies', auto:'The instructor takes over if you exceed the limits', shared:'The instructor blends in help as you approach the limits' }[e.target.value]); });
$('#f-hints').addEventListener('input', e => { settings.hints = e.target.checked; saveSettings(); });
$('#f-ghost').addEventListener('input', e => { settings.ghost = e.target.checked; saveSettings(); world.setPath(settings.ghost && lesson ? lesson.L.path() : []); });
$('#f-stallguard').addEventListener('input', e => { settings.stallGuard = e.target.checked; saveSettings(); });
$('#f-zoom').addEventListener('input', e => { settings.zoom = e.target.checked; world.autoZoom = e.target.checked; saveSettings(); });
$('#f-trail').addEventListener('input', e => { settings.trail = e.target.checked; world.trailOn = e.target.checked; if (!e.target.checked) world.clearTrail(); saveSettings(); });
$('#f-sound').addEventListener('input', e => { settings.sound = e.target.checked; if (e.target.checked) sound.start(); saveSettings(); });
$('#b-reset').addEventListener('click', () => { if (replay) exitReplay(); reset(); $('#sim-canvas').focus(); });
const rb = $('#b-rescue'); rb.addEventListener('pointerdown', () => { rescueKey = true; }); rb.addEventListener('pointerup', () => { rescueKey = false; }); rb.addEventListener('pointerleave', () => { rescueKey = false; });
$('#hud-cam').addEventListener('click', cycleCam); $('#hud-pause').addEventListener('click', togglePause); $('#hud-reset').addEventListener('click', () => { if (replay) exitReplay(); reset(); });
$('#hud-panel').addEventListener('click', e => { const sh = $('.sim-shell'), hidden = sh.classList.toggle('panel-hidden'); e.currentTarget.setAttribute('aria-expanded', String(!hidden)); setTimeout(() => world.resize(), 50); });
// tabs (keyboard: arrows move between tabs)
const tabs = $$('.sim-tabs [role=tab]');
function selectTab(t){ tabs.forEach(x => { const on = x === t; x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1; $('#' + x.getAttribute('aria-controls')).hidden = !on; }); if (t.id === 'tab-controls') renderDevices(); }
tabs.forEach((t, i) => { t.addEventListener('click', () => selectTab(t)); t.addEventListener('keydown', e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; selectTab(n); n.focus(); e.preventDefault(); } }); });
$('#lesson-list').addEventListener('click', e => { const b = e.target.closest('[data-lesson]'), dm = e.target.closest('[data-demo]'); if (b) startLesson(b.dataset.lesson, false); if (dm) startLesson(dm.dataset.demo, true); if (e.target.closest('[data-lesson-stop]')) stopLesson(); });
$('#t-table').addEventListener('click', e => { const r = e.target.closest('[data-test]'), wt = e.target.closest('[data-watch]'); if (r) { r.disabled = true; setTimeout(() => runOne(r.dataset.test), 10); } if (wt && testRes[wt.dataset.watch].rec) { enterReplay(testRes[wt.dataset.watch].rec); selectTab($('#tab-replay')); } });
$('#t-all').addEventListener('click', runAll);
$('#r-toggle').addEventListener('click', () => replay ? exitReplay() : enterReplay());
$('#r-play').addEventListener('click', e => { if (!replay) return; replay.playing = !replay.playing; if (replay.playing && replay.t >= +$('#r-pos').max) replay.t = +$('#r-pos').min; e.currentTarget.textContent = replay.playing ? 'Pause' : 'Play'; e.currentTarget.setAttribute('aria-pressed', String(replay.playing)); });
$('#r-pos').addEventListener('input', e => { if (replay) { replay.t = +e.target.value; replay.playing = false; $('#r-play').textContent = 'Play'; } });
$('#r-speed').addEventListener('input', e => { if (replay) replay.speed = +e.target.value; });
$('#r-csv').addEventListener('click', () => { const r = replay ? replay.rec : recorder; if (!r.rows.length) { RC.toast('Nothing recorded yet'); return; } RC.download(new Blob([r.csv()], { type:'text/csv' }), 'flight-log.csv'); });

/* ---------------- calibration (flight logs) ---------------- */
let calLog = null, calSegs = [], calRes = null;
const SEG_LABEL = { cruise:'Steady cruise', climb:'Full-throttle climb', glide:'Motor-off glide', topspeed:'Top speed', stall:'Stall', roll:'Full-aileron roll', endurance:'Flight time' };
function segText(s){ const p = [];
  if (s.V != null) p.push(SPD(s.V)); if (s.thr != null) p.push(`${fmt(s.thr * 100, 0)}% thr`); if (s.type === 'climb' && s.vs != null) p.push(`climb ${VS(s.vs)}`);
  if (s.type === 'cruise' && s.A != null) p.push(`${fmt(s.A, 1)} A`); if (s.LD) p.push(`L/D ${fmt(s.LD, 1)}`); if (s.p) p.push(`${fmt(s.p, 0)} °/s`); if (s.min) p.push(`${fmt(s.min, 1)} min`); return p.join(' · '); }
function renderCalSegs(){
  $('#cal-segs').innerHTML = calSegs.length ? `<h3 class="sub-h">Segments found</h3><div class="table-scroll"><table class="data"><tbody>${calSegs.map((s, i) => `<tr><td><input type="checkbox" data-seg="${i}"${s.off ? '' : ' checked'} aria-label="Use ${esc(SEG_LABEL[s.type])} segment"></td><th scope="row">${esc(SEG_LABEL[s.type] || s.type)}${s.t0 != null ? `<br><small class="hint">${fmtTime(s.t0)}–${fmtTime(s.t1)}</small>` : '<br><small class="hint">measured</small>'}</th><td>${esc(segText(s))}</td></tr>`).join('')}</tbody></table></div>`
    : (calLog ? '<p class="hint">No steady segments found. Fly straight legs at a constant throttle for 5 s or more, a full-throttle climb, a motor-off glide, a stall and a roll.</p>' : '');
  $('#cal-fit').disabled = !calSegs.some(s => !s.off);
}
function renderCalSummary(){
  if (!calLog) { $('#cal-summary').innerHTML = ''; return; }
  const m = calLog.meta, w = calLog.wind, sens = [m.hasGPS && 'GPS', m.hasAirspeed && 'airspeed', m.hasAttitude && 'attitude', m.hasThrottle && 'throttle', m.hasCurrent && 'current', m.hasAlt && 'altitude'].filter(Boolean);
  $('#cal-summary').innerHTML = [`<b>${esc(m.name)}</b>`, `${esc(m.format)}`, `${fmtTime(m.duration)}`, `sensors: ${esc(sens.join(', ') || 'none')}`, w ? `wind ${SPD(w.speed)} from ${fmt(w.from, 0)}° (${esc(w.quality)})` : (m.hasAirspeed ? 'airspeed sensor' : 'no wind estimate')].map(t => `<span class="pill">${t}</span>`).join('');
}
async function loadCalLog(name, text){
  try { calLog = SimCalib.parse(name, text); calSegs = SimCalib.analyze(calLog); calRes = null; renderCalSummary(); renderCalSegs(); $('#cal-result').innerHTML = ''; $('#cal-charts').innerHTML = ''; $('#cal-play').disabled = !calLog.meta.hasGPS && !calLog.meta.hasAlt; RC.toast(`${calSegs.length} segments found`); }
  catch (e) { RC.toast(e.message); }
}
$('#cal-file').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; e.target.value = ''; loadCalLog(f.name, await f.text()); });
$('#cal-demo').addEventListener('click', () => {
  const truth = { cd0:1.25, clmax:0.92, thrust:0.88, current:1.1, roll:1.15 };
  RC.toast('Flying a demo test flight…');
  setTimeout(() => { calLog = SimCalib.syntheticLog(design, truth, { airspeed:true }); calLog.meta.name = 'demo flight (hidden truth: drag ×1.25, lift ×0.92, thrust ×0.88, current ×1.10, aileron ×1.15)';
    calSegs = SimCalib.analyze(calLog); calRes = null; renderCalSummary(); renderCalSegs(); $('#cal-result').innerHTML = ''; $('#cal-charts').innerHTML = ''; $('#cal-play').disabled = false; }, 30);
});
$$('[data-cu]').forEach(s => { s.textContent = `(${imperial ? 'mph' : 'm/s'})`; });
$('#cal-use-manual').addEventListener('click', () => {
  const o = {}; $$('[data-cm]').forEach(el => { const v = Number(el.value); if (!(el.value.trim() && isFinite(v) && v > 0)) return; let x = 'speed' in el.dataset ? (imperial ? v * 0.44704 : v) : 'pct' in el.dataset ? v / 100 : v;
    const [a, b] = el.dataset.cm.split('.'); if (b) { o[a] = o[a] || {}; o[a][b] = x; } else o[a] = x; });
  calLog = null; calSegs = SimCalib.manualSegments(o); calRes = null; renderCalSummary(); renderCalSegs(); $('#cal-play').disabled = true;
  RC.toast(calSegs.length ? `${calSegs.length} measurements ready` : 'Enter at least one measurement');
});
$('#cal-segs').addEventListener('input', e => { const i = e.target.dataset.seg; if (i != null) { calSegs[+i].off = !e.target.checked; renderCalSegs(); } });
$('#cal-fit').addEventListener('click', () => {
  $('#cal-fit').disabled = true; $('#cal-result').innerHTML = '<p class="hint">Fitting… (a few seconds)</p>';
  setTimeout(() => {
    try {
      const segs = calSegs.filter(s => !s.off), base = JSON.parse(JSON.stringify(asBuilt(design)));
      calRes = SimCalib.fit(base, segs, { meta:calLog ? calLog.meta : { hasAirspeed:false }, wind:calLog && calLog.wind, rho:env.rhoAt(0) });
      renderCalResult();
    } catch (e) { $('#cal-result').innerHTML = `<p class="hint">Fit failed: ${esc(e.message)}</p>`; }
    $('#cal-fit').disabled = false;
  }, 40);
});
function renderCalResult(){
  const r = calRes, F = SimCalib.FACTORS, cur = settings.calibrations[sourceKey];
  $('#cal-result').innerHTML = `<h3 class="sub-h">Calibration</h3>
    <p class="readout"><span class="pill">Error before <b>${fmt(r.before * 100, 0)}%</b></span><span class="pill">after <b>${fmt(r.after * 100, 0)}%</b></span><span class="pill">Confidence <b>${esc(r.confidence.label)}</b></span></p>
    <div class="table-scroll"><table class="data"><thead><tr><th scope="col">Factor</th><th scope="col">Value</th><th scope="col">Status</th></tr></thead><tbody>${F.map(f => `<tr><th scope="row">${esc(f.label)}<br><small class="hint">${esc(f.affects)}</small></th><td class="num">×${fmt(r.factors[f.key], 2)}</td>
      <td>${!r.identified[f.key] ? '<span class="hint">no data</span>' : r.reliable[f.key] ? `<span class="fit ok">${RC.icon('check')}fitted</span>` : `<span class="fit no">${RC.icon('warn')}rough (no airspeed sensor)</span>`}</td></tr>`).join('')}</tbody></table></div>
    <details class="assume"><summary>Segment by segment</summary><div class="table-scroll"><table class="data"><thead><tr><th scope="col">Segment</th><th scope="col">Measured</th><th scope="col">Before</th><th scope="col">After</th></tr></thead><tbody>${r.details.flatMap(d => d.after.map((a, j) => `<tr><th scope="row">${esc(SEG_LABEL[d.seg.type])}: ${esc(a.k)}</th><td class="num">${fmt(a.meas, 2)}</td><td class="num">${d.before[j] ? fmt(d.before[j].pred, 2) : '–'}</td><td class="num">${fmt(a.pred, 2)}</td></tr>`)).join('')}</tbody></table></div></details>
    <div class="actions"><button type="button" class="btn primary" id="cal-apply">Apply to this aircraft</button>${sourceKey === 'designer' || sourceKey === 'hash' ? '<button type="button" class="btn" id="cal-save-designer">Save into the Designer design</button>' : ''}${cur ? '<button type="button" class="btn sm danger" id="cal-clear">Remove calibration</button>' : ''}</div>
    ${r.confidence.label === 'low' ? `<div class="callout warn">${RC.icon('warn')}<span>Low confidence: add more kinds of segments (or use a log with airspeed and current) before trusting these factors.</span></div>` : ''}`;
  if (calLog && calLog.meta.hasThrottle) {
    r.model.cal = Object.assign({}, r.factors); const before = SimCalib.overlay(r.model, calLog, 10); // calibrated model along the log
    r.model.cal = Object.assign({}, SimPhysics.CAL1); const ov0 = SimCalib.overlay(r.model, calLog, 10); r.model.cal = Object.assign({}, r.factors);
    const vs = [{ name:'Log', color:'var(--series-1)', pts:before.filter(p => isFinite(p.vsLog)).map(p => [p.t, p.vsLog]) }, { name:'Model (before)', short:'Before', color:'var(--series-2)', dash:'5 4', pts:ov0.map(p => [p.t, p.vsSim]) }, { name:'Model (calibrated)', short:'After', color:'var(--series-3)', pts:before.map(p => [p.t, p.vsSim]) }];
    $('#cal-charts').innerHTML = '<h3 class="sub-h">Climb rate: log vs model</h3><div id="cal-ch1"></div>' + (calLog.meta.hasCurrent ? '<h3 class="sub-h">Current: log vs model</h3><div id="cal-ch2"></div>' : '');
    Charts.line($('#cal-ch1'), { title:'Climb rate, log vs model', series:vs, x:{ label:'Time (s)', fmt:v => fmt(v, 0) }, y:{ label:'Climb rate (m/s)', fmt:v => fmt(v, 1) }, height:220 });
    if (calLog.meta.hasCurrent) Charts.line($('#cal-ch2'), { title:'Current, log vs model', series:[{ name:'Log', color:'var(--series-1)', pts:before.filter(p => isFinite(p.ALog)).map(p => [p.t, p.ALog]) }, { name:'Model (before)', short:'Before', color:'var(--series-2)', dash:'5 4', pts:ov0.map(p => [p.t, p.ASim]) }, { name:'Model (calibrated)', short:'After', color:'var(--series-3)', pts:before.map(p => [p.t, p.ASim]) }],
      x:{ label:'Time (s)', fmt:v => fmt(v, 0) }, y:{ label:'Current (A)', fmt:v => fmt(v, 1), min:0 }, height:220 });
  }
}
$('#cal-result').addEventListener('click', e => {
  if (e.target.closest('#cal-apply')) { settings.calibrations[sourceKey] = calibrationRecord(); saveSettings(); loadAircraft(sourceKey, true); RC.toast('Calibration applied to this aircraft'); renderCalResult(); }
  if (e.target.closest('#cal-clear')) { delete settings.calibrations[sourceKey]; saveSettings(); loadAircraft(sourceKey, true); RC.toast('Calibration removed'); renderCalResult(); }
  if (e.target.closest('#cal-save-designer')) { const d = RC.store.get(RC.KEYS.design); if (d) { d.calibration = calibrationRecord(); RC.store.set(RC.KEYS.design, d); RC.toast('Saved into the Designer design'); } }
});
function calibrationRecord(){ return { factors:Object.assign({}, calRes.factors), identified:calRes.identified, reliable:calRes.reliable, rms_error_before:calRes.before, rms_error_after:calRes.after, confidence:calRes.confidence.label,
  source_logs:[calLog ? calLog.meta.name : 'manual measurements'], segments:calSegs.filter(s => !s.off).length, date:new Date().toISOString().slice(0, 10), applyDesigner:true }; }
$('#cal-play').addEventListener('click', () => {
  if (!calLog) return; const rec = new SimPhysics.Recorder(), R = calLog.rows, Q = SimPhysics.quat, D = Math.PI / 180;
  rec.rows = R.filter(r => isFinite(r.alt) || isFinite(r.x)).map((r, i) => { const yaw = isFinite(r.yaw) ? r.yaw : (isFinite(r.vn) ? Math.atan2(r.ve, r.vn) / D : 0), pitch = isFinite(r.pitch) ? r.pitch : (isFinite(r.vs) && r.gs > 1 ? Math.atan2(r.vs, r.gs) / D : 0), roll = isFinite(r.roll) ? r.roll : 0;
    return { t:r.t, p:[isFinite(r.x) ? r.x : 0, isFinite(r.y) ? r.y : 0, -(isFinite(r.alt) ? Math.max(0.2, r.alt) : 20)], q:Q.fromEuler(roll * D, pitch * D, yaw * D), c:{ thr:r.thr || 0, ail:r.ail || 0, ele:r.ele || 0, rud:r.rud || 0 }, V:r.asEst || r.gs || 0, alt:r.alt || 0, vs:r.vs || 0, I:r.A || 0, mAh:r.mAh || 0, rpm:(r.thr || 0) * 9000 }; });
  enterReplay(rec); selectTab($('#tab-replay')); RC.toast('Playing the real flight log');
});

/* ---------------- start ---------------- */
$('#f-start').value = settings.start; $('#f-cam').value = settings.cam; $('#f-assist').value = settings.assist; $('#f-speed').value = String(settings.speed);
$('#f-stallguard').checked = settings.stallGuard; $('#f-instr').value = settings.instructor; $('#f-hints').checked = settings.hints; $('#f-ghost').checked = settings.ghost; $('#f-zoom').checked = settings.zoom; $('#f-trail').checked = settings.trail; $('#f-sound').checked = settings.sound; $('#w-trees').checked = settings.trees;
world.autoZoom = settings.zoom; world.trailOn = settings.trail; applyGraphics(); applyWeather(false); applyCam(); renderLessons(); renderTests();
buildSources().then(() => loadAircraft(scenario ? scenarioPlane() : RC.readHash('design') ? 'hash' : settings.model)).then(async () => {
  if (scenario) { if (scenario.lesson && SimLessons.DEFS.some(d => d.id === scenario.lesson)) await startLesson(scenario.lesson, false); RC.toast(`Shared scenario loaded${scenario.title ? ': ' + scenario.title : ''}`); } requestAnimationFrame(t => { last = t; requestAnimationFrame(frame); }); });
window.RCSim = { get sim(){ return sim; }, get model(){ return model; }, get world(){ return world; }, get input(){ return input; }, runOne, startLesson, stopLesson, get lesson(){ return lesson; }, get who(){ return who; }, get progress(){ return progress; }, loadAircraft, enterReplay, get settings(){ return settings; } };
})();
