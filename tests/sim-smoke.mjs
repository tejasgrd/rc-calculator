// Headless Chrome smoke test for simulator.html (software WebGL). Usage: node tests/sim-smoke.mjs [outDir]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..'), OUT = resolve(process.argv[2] || join(ROOT, 'tests', 'out'));
mkdirSync(OUT, { recursive:true });
const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
const port = 9700 + Math.floor(Math.random() * 200), prof = join(OUT, '.simprofile'); rmSync(prof, { recursive:true, force:true });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--no-first-run', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', 'about:blank'], { stdio:'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let tg; for (let k = 0; k < 60; k++) { try { tg = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); break; } catch { await sleep(200); } }
const ws = new WebSocket(tg.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map(), events = [];
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else events.push(d); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id:i, method, params })); });
const ev = async e => { const r = await send('Runtime.evaluate', { expression:e, returnByValue:true, awaitPromise:true }); return r.result.exceptionDetails ? { EXC:r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text } : r.result.result.value; };
const shot = async n => { const r = await send('Page.captureScreenshot', { format:'png' }); writeFileSync(join(OUT, n + '.png'), Buffer.from(r.result.data, 'base64')); };
const key = async (code, ms) => { await send('Input.dispatchKeyEvent', { type:'keyDown', code, key:code.replace('Key', '').toLowerCase() }); await sleep(ms); await send('Input.dispatchKeyEvent', { type:'keyUp', code, key:code.replace('Key', '').toLowerCase() }); };
await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width:1440, height:900, deviceScaleFactor:1, mobile:false });
await send('Emulation.setEmulatedMedia', { features:[{ name:'prefers-color-scheme', value:'light' }] });
await send('Page.navigate', { url:pathToFileURL(join(ROOT, 'simulator.html')).href }); await sleep(4000);
const R = {};
R.boot = await ev(`({ three:!!window.THREE && THREE.REVISION, model:RCSim.model && RCSim.model.name, gear:RCSim.model && RCSim.model.gear, fallback:!document.querySelector('#sim-fallback').hidden, tele:RCSim.sim.telemetry().onGround })`);
await shot('sim-runway');
// take off with the keyboard: throttle up (W), then a little up-elevator (ArrowDown)
await ev(`document.querySelector('#sim-canvas').focus()`);
await key('KeyW', 1600); await sleep(2500); await key('ArrowDown', 500); await sleep(4000);
R.flight = await ev(`(() => { const t = RCSim.sim.telemetry(); return { V:+t.V.toFixed(1), alt:+t.alt.toFixed(1), thr:+t.thr.toFixed(2), crashed:t.crashed && t.crashed.reason, onGround:t.onGround }; })()`);
await shot('sim-pilot-view');
await ev(`document.querySelector('#f-cam').value='chase'; document.querySelector('#f-cam').dispatchEvent(new Event('input'))`); await sleep(1200); await shot('sim-chase');
await ev(`document.querySelector('#f-cam').value='cockpit'; document.querySelector('#f-cam').dispatchEvent(new Event('input'))`); await sleep(800); await shot('sim-cockpit');
await ev(`document.querySelector('#f-cam').value='pilot'; document.querySelector('#f-cam').dispatchEvent(new Event('input'))`);
// tests panel: run two automatic tests
R.tests = await ev(`(() => { const a = RCSim.runOne('cruise'), b = RCSim.runOne('stability'); return [a.label, +a.measured.toFixed(2), +(a.pred||0).toFixed(2), a.match, b.label, +b.measured.toFixed(1), +b.pred.toFixed(1), b.match]; })()`);
await ev(`document.querySelector('#tab-tests').click()`); await sleep(300); await shot('sim-tests');
// lesson
await ev(`(async () => { document.querySelector('#tab-lessons').click(); await RCSim.startLesson('level'); })()`); await sleep(2500);
R.lesson = await ev(`({ text:document.querySelector('#hud-lesson').textContent.slice(0, 120), gates:RCSim.world.gates.length, path:!!RCSim.world.pathMesh, cards:document.querySelectorAll('#lesson-list [data-lesson]').length, groups:document.querySelectorAll('#lesson-list h3').length })`); await shot('sim-lesson');
await ev(`document.querySelector('[data-lesson-stop]') && document.querySelector('[data-lesson-stop]').click()`);
// "Show me": the demo pilot flies the circuit lesson (sped up)
R.demo = await ev(`(async () => { RCSim.settings.speed = 4; await RCSim.startLesson('circuit', true); await new Promise(r => setTimeout(r, 2500)); const a = { who:RCSim.who, hud:document.querySelector('#hud-msg') ? document.querySelector('#hud-msg').textContent : '', V:RCSim.sim.telemetry().V };
  for (let k = 0; k < 120 && !(RCSim.lesson && RCSim.lesson.reported); k++) await new Promise(r => setTimeout(r, 500));
  RCSim.settings.speed = 1; return Object.assign(a, { done:!!(RCSim.lesson && RCSim.lesson.reported), result:(document.querySelector('#lesson-result') || {}).textContent?.slice(0, 80), crashed:!!RCSim.sim.telemetry().crashed }); })()`);
await shot('sim-demo');
await ev(`RCSim.stopLesson()`);
// instructor auto take-over: roll the plane to 100° bank at 30 m
R.instr = await ev(`(async () => { const sel = document.querySelector('#f-instr'); sel.value = 'auto'; sel.dispatchEvent(new Event('input'));
  const sim = RCSim.sim; sim.reset('air', { alt:30 }); sim.s.q = SimPhysics.quat.fromEuler(100 * Math.PI / 180, -30 * Math.PI / 180, 0);
  let saw = false, hud = ''; for (let k = 0; k < 16; k++) { await new Promise(r => setTimeout(r, 250)); if (RCSim.who === 'instructor') { saw = true; hud = document.querySelector('#hud-msg') ? document.querySelector('#hud-msg').textContent : ''; } }
  const t = sim.telemetry(); sel.value = 'off'; sel.dispatchEvent(new Event('input')); return { saw, hud:hud.slice(0, 90), phi:+t.phi.toFixed(0), alt:+t.alt.toFixed(0), crashed:!!t.crashed }; })()`);
// every built-in model loads and flies 3 s in the air
R.models = await ev(`(async () => { const out = []; for (const k of ['builtin:sport','builtin:wing','builtin:glider','builtin:aerobat','builtin:trainer']) { await RCSim.loadAircraft(k); document.querySelector('#f-start').value='air'; document.querySelector('#f-start').dispatchEvent(new Event('input')); await new Promise(r => setTimeout(r, 1500)); const t = RCSim.sim.telemetry(); out.push(k + ' ' + RCSim.model.gear + ' alt ' + t.alt.toFixed(0) + ' V ' + t.V.toFixed(1) + (t.crashed ? ' CRASH ' + t.crashed.reason : '')); } return out; })()`);
await ev(`RCSim.loadAircraft('builtin:wing')`); await sleep(1500); await shot('sim-flyingwing');
// import round-trips: STL from Mesh3D, and GLB export → import
R.import = await ev(`(async () => { const glb0 = await new Promise(res => RCSim.world.exportGLB(b => res(b))); const m = RCSim.model, stl = Mesh3D.toSTL(Mesh3D.build(m.geom, { airfoil:m.af, propD:m.prop.D }), 'x'), buf = new TextEncoder().encode(stl).buffer;
  const obj = await SimImport.parse(buf, 'stl'), vis = SimImport.prepare(obj, { forward:'-X', up:'+Z' }, m); RCSim.world.setAircraft(m, vis);
  const ab = await glb0.arrayBuffer(); const back = await SimImport.parse(ab, 'glb'); const v2 = SimImport.prepare(back, { forward:'-Z', up:'+Y' }, m);
  return { stlTris:vis.stats.tris, glbBytes:ab.byteLength, glbTris:v2.stats.tris, surfacesFromGLB:v2.surfaces.map(s => s.role).sort().join(',') }; })()`);
await sleep(800); await shot('sim-imported');
R.multi = await ev(`(async () => { const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), bin = pos.buffer;
  const gltf = { asset:{ version:'2.0', generator:'test', extras:{ author:'Tester', license:'CC-BY-4.0', title:'Tri', source:'https://example.org/tri' } }, scene:0, scenes:[{ nodes:[0] }], nodes:[{ mesh:0, name:'aileron_L' }],
    meshes:[{ primitives:[{ attributes:{ POSITION:0 } }] }], buffers:[{ uri:'tri%20data.bin', byteLength:36 }], bufferViews:[{ buffer:0, byteLength:36 }], accessors:[{ bufferView:0, componentType:5126, count:3, type:'VEC3', min:[0, 0, 0], max:[1, 1, 0] }] };
  const g = await SimImport.parse(new TextEncoder().encode(JSON.stringify(gltf)).buffer, 'gltf', { 'tri data.bin':bin });
  let missing = ''; try { await SimImport.parse(new TextEncoder().encode(JSON.stringify(gltf)).buffer, 'gltf', {}); } catch (e) { missing = e.message.slice(0, 120); }
  const obj = 'mtllib plane.mtl\\no wing\\nv 0 0 0\\nv 1 0 0\\nv 0 1 0\\nusemtl Red\\nf 1 2 3\\n', mtl = 'newmtl Red\\nKd 1 0 0\\n';
  const o = await SimImport.parse(new TextEncoder().encode(obj).buffer, 'obj', { 'plane.mtl':new TextEncoder().encode(mtl).buffer }); let col = null; o.traverse(x => { if (x.isMesh) col = x.material.color.getHexString(); });
  return { tris:SimImport.stats(g).tris, meta:g.userData.meta, credit:SimImport.credit(g.userData.meta), missing, mtl:o.userData.mtlMatched, col }; })()`);
await ev(`RCSim.loadAircraft('builtin:trainer')`); await sleep(800);
// weather presets, air density (re-trim), CG override, flaps
R.weather = await ev(`(async () => { const set = (id, v) => { const e = document.querySelector(id); e.value = v; e.dispatchEvent(new Event('input')); };
  document.querySelector('#tab-world').click(); set('#w-preset', 'gusty'); await new Promise(r => setTimeout(r, 300)); const g = { preset:RCSim.settings.weather.preset, gp:RCSim.settings.weather.gustPeak, summary:document.querySelector('#w-summary').textContent };
  const v0 = RCSim.model.trim.V; set('#w-temp', 35); set('#w-elev', 2000); await new Promise(r => setTimeout(r, 900)); const v1 = RCSim.model.trim.V, air = document.querySelector('#w-air').textContent;
  set('#w-temp', 15); set('#w-elev', 0); set('#w-preset', 'calm'); await new Promise(r => setTimeout(r, 900));
  document.querySelector('#tab-model').click(); const cg0 = RCSim.model.cgPctActual; set('#m-cg', 40); await new Promise(r => setTimeout(r, 600)); const cg1 = RCSim.model.cgPctActual; document.querySelector('#m-cg-reset').click(); await new Promise(r => setTimeout(r, 600));
  return { g, v0, v1, air, cg0, cg1, cgBack:RCSim.model.cgPctActual, hudWind:document.querySelector('#hud-tele').textContent.includes('Wind') }; })()`);
await ev(`document.querySelector('#tab-world').click(); (() => { const e = document.querySelector('#w-preset'); e.value = 'stormy'; e.dispatchEvent(new Event('input')); })()`); await sleep(1500); await shot('sim-stormy');
await ev(`(() => { const e = document.querySelector('#w-preset'); e.value = 'breeze'; e.dispatchEvent(new Event('input')); })()`);
// calibration: demo log → fit → apply
R.calib = await ev(`(async () => { document.querySelector('#tab-calib').click(); document.querySelector('#cal-demo').click(); await new Promise(r => setTimeout(r, 4000));
  const segs = document.querySelectorAll('#cal-segs tbody tr').length; document.querySelector('#cal-fit').click(); await new Promise(r => setTimeout(r, 9000));
  const res = document.querySelector('#cal-result').textContent.slice(0, 220); document.querySelector('#cal-apply') && document.querySelector('#cal-apply').click(); await new Promise(r => setTimeout(r, 1200));
  return { segs, res, calibrated:RCSim.model.calibrated, cal:RCSim.model.cal, charts:document.querySelectorAll('#cal-charts svg').length }; })()`);
await shot('sim-calibrate');
await ev(`(() => { const b = document.querySelector('#cal-clear'); b && b.click(); })()`); await sleep(800);
// replay
R.replay = await ev(`(() => { RCSim.enterReplay(); return document.querySelector('#r-info').textContent; })()`); await sleep(1500); await shot('sim-replay');
// graphics presets
R.gfx = await ev(`(async () => { const set = (id, v) => { const e = document.querySelector(id); e.value = v; e.dispatchEvent(new Event('input')); }; const w = RCSim.world, out = {};
  for (const p of ['low', 'ultra', 'high']) { set('#g-preset', p); await new Promise(r => setTimeout(r, 400)); out[p] = { sh:w.renderer.shadowMap.enabled, map:w.sun.shadow.mapSize.x, far:Math.round(w.camera.far), fog:Math.round(w.scene.fog.far), pr:+w.renderer.getPixelRatio().toFixed(2) }; }
  set('#g-dist', 900); out.custom = { preset:RCSim.settings.gfx.preset, fog:Math.round(w.scene.fog.far) }; set('#g-preset', 'high'); return out; })()`);
// scenario link: shared design + weather + lesson + instructor, opened in a fresh load
R.share = await ev(`(async () => { const sel = document.querySelector('#f-instr'); sel.value = 'auto'; sel.dispatchEvent(new Event('input'));
  const w = document.querySelector('#w-preset'); w.value = 'windy'; w.dispatchEvent(new Event('input')); await RCSim.startLesson('circuit');
  document.querySelector('#share-box').open = true; await new Promise(r => setTimeout(r, 200)); const u = document.querySelector('#sh-url').value;
  const sc = JSON.parse(RC.b64urlDecode(u.split('#scenario=')[1])); sc.plane = 'designer'; sc.design = Object.assign(SimModel.builtinDesign('sport'), { name:'Shared Sporty' }); sc.cg = 31;
  sel.value = 'off'; sel.dispatchEvent(new Event('input')); w.value = 'calm'; w.dispatchEvent(new Event('input')); RCSim.stopLesson();
  return { len:u.length, url:location.href.split('#')[0] + '#scenario=' + RC.b64urlEncode(JSON.stringify(sc)) }; })()`);
await send('Page.navigate', { url:'about:blank' }); await sleep(500); const nav = await send('Page.navigate', { url:R.share.url }); await sleep(5000); R.navErr = nav.result && nav.result.errorText;
R.shareDbg = await ev(`({ hash:location.hash.slice(0, 40), rd:!!RC.readHash('scenario'), v:(RC.readHash('scenario') || {}).v })`);
R.shareLoaded = await ev(`({ model:RCSim.model.name, src:document.querySelector('#f-model').value, preset:RCSim.settings.weather.preset, wind:RCSim.settings.weather.speed, instr:RCSim.settings.instructor, lesson:RCSim.lesson && RCSim.lesson.def.id, cg:+RCSim.model.cgPctActual.toFixed(1) })`);
R.share = { len:R.share.len };
await ev(`RCSim.stopLesson(); history.replaceState(null, '', location.pathname)`);
// dark theme + 390px phone layout
await ev(`document.querySelector('#theme-toggle').click()`); await sleep(500); await shot('sim-dark');
await send('Emulation.setDeviceMetricsOverride', { width:390, height:844, deviceScaleFactor:1, mobile:true }); await sleep(1200); await shot('sim-phone');
R.phone = await ev(`[document.documentElement.scrollWidth, innerWidth]`);
R.errors = { exceptions:events.filter(e => e.method === 'Runtime.exceptionThrown').map(e => (e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text) + ' @ ' + (e.params.exceptionDetails.stackTrace?.callFrames || []).slice(0, 4).map(c => `${c.functionName}:${c.url.split('/').pop()}:${c.lineNumber + 1}`).join(' < ')),
  consoleErrors:events.filter(e => e.method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(e.params.type)).map(e => e.params.args.map(a => a.value ?? a.description).join(' ')),
  logErrors:events.filter(e => e.method === 'Log.entryAdded' && e.params.entry.level === 'error').map(e => e.params.entry.text),
  network:[...new Set(events.filter(e => e.method === 'Network.requestWillBeSent').map(e => e.params.request.url))].filter(u => !/^(file|data|blob):/.test(u)) };
console.log(JSON.stringify(R, null, 1));
ws.close(); chrome.kill();
