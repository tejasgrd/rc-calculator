// Headless Chrome smoke test over the DevTools protocol (no dependencies; Node 22+).
// Usage: node tests/browser-smoke.mjs [outDir]
// Opens each page from file://, checks console errors, exceptions, network requests and self-tests, takes screenshots.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(process.argv[2] || join(ROOT, 'tests', 'out'));
mkdirSync(OUT, { recursive:true });
const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
if (!CHROME) { console.error('Chrome not found'); process.exit(2); }
const port = 9400 + Math.floor(Math.random() * 300), prof = join(OUT, '.profile');
rmSync(prof, { recursive:true, force:true });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio:'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets; for (let k = 0; k < 60; k++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); break; } catch { await sleep(200); } }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map(), events = [];
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else events.push(d); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id:i, method, params })); });
const ev = async expr => { const r = await send('Runtime.evaluate', { expression:expr, returnByValue:true, awaitPromise:true }); return r.result.exceptionDetails ? { EXC:r.result.exceptionDetails.exception?.description } : r.result.result.value; };
const size = async (w, h) => { await send('Emulation.setDeviceMetricsOverride', { width:w, height:h, deviceScaleFactor:1, mobile:w < 768 }); await sleep(250); };
const shot = async (name, full = false) => { const r = await send('Page.captureScreenshot', { format:'png', captureBeyondViewport:full }); writeFileSync(join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64')); };
const scrollTo = async sel => { await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:'start',behavior:'instant'}); window.scrollBy({top:-110,behavior:'instant'})`); await sleep(400); };
await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable'); await send('Page.enable');
await send('Emulation.setEmulatedMedia', { features:[{ name:'prefers-color-scheme', value:'light' }] });
const url = f => pathToFileURL(join(ROOT, f)).href;
const results = {};
async function open(file, hash = ''){ events.length = 0; await send('Page.navigate', { url:url(file) + hash }); await sleep(1800); }
function collect(){
  return { logs:events.filter(e => e.method === 'Runtime.consoleAPICalled').map(e => e.params.type + ': ' + e.params.args.map(a => a.value ?? a.description).join(' ')),
    exceptions:events.filter(e => e.method === 'Runtime.exceptionThrown').map(e => e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text),
    logErrors:events.filter(e => e.method === 'Log.entryAdded' && e.params.entry.level === 'error').map(e => e.params.entry.text),
    network:[...new Set(events.filter(e => e.method === 'Network.requestWillBeSent').map(e => e.params.request.url))].filter(u => !u.startsWith('file:') && !u.startsWith('data:') && !u.startsWith('blob:')) };
}
await size(1440, 900);
await open('rc-plane-calculator.html'); await ev('localStorage.clear()'); await open('rc-plane-calculator.html');
results.calculator = { ...collect(), example:await ev(`(document.querySelector('#btn-example').click(), Object.fromEntries(['wl','vs','vc','P','I','C','tFull','rpm','ps'].map(k=>[k,document.querySelector('#card-'+k+' [data-v]').textContent])))`), width360:null };
await shot('calc-top');
await open('designer.html');
results.designer = collect();
results.designer.state = await ev(`(()=>{const d=RCDesigner.design,a=RCDesigner.analysis;return {auw:d.auw, S:a.g.S, np:a.stab.xnp, sm:a.stab.SM, e:a.ll.e, LD:a.pf.LDmax, vmax:a.pf.vmax, matches:document.querySelectorAll('#pw-table tbody tr').length, tris:document.querySelector('#v-readout').textContent}})()`);
for (const s of ['#d-req', '#d-airfoil', '#d-geom', '#d-stab', '#d-wing', '#d-perf', '#d-power', '#d-3d', '#d-save']) { await scrollTo(s); await shot('designer-' + s.slice(3)); }
// interactions: choose motor, change airfoil, save, unit toggle, dark theme
results.designer.interact = await ev(`(async()=>{const out={};document.querySelector('[data-use="0"]')?.click();await new Promise(r=>setTimeout(r,300));out.power=!!RCDesigner.design.power;
  document.querySelector('input[name=airfoil][value=naca4412]').click();await new Promise(r=>setTimeout(r,300));out.airfoil=RCDesigner.design.airfoilId;
  document.querySelector('#sv-save').click();out.saved=JSON.parse(localStorage.getItem('rcDesigns.v1')||'[]').length;
  document.querySelector('#us-imperial').click();await new Promise(r=>setTimeout(r,400));out.imperialSpan=document.querySelector('#g-span').value;
  document.querySelector('#us-metric').click();
  const dat='CUSTOM\\n'+Array.from({length:21},(_,i)=>{const x=1-i/20;return x.toFixed(3)+' '+(0.06*Math.sin(Math.PI*x)).toFixed(4)}).join('\\n')+'\\n'+Array.from({length:20},(_,i)=>{const x=(i+1)/20;return x.toFixed(3)+' '+(-0.02*Math.sin(Math.PI*x)).toFixed(4)}).join('\\n');
  document.querySelector('#af-text').value=dat;document.querySelector('#af-use').click();await new Promise(r=>setTimeout(r,300));out.custom=RCDesigner.design.airfoilId;
  return out;})()`);
results.designer.asbuilt = await ev(`(async()=>{const set=(id,v)=>{const e=document.querySelector(id);if(e.type==='checkbox'){e.checked=v;}else e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));};
  set('#s-ailcf',35); set('#s-flaps',true); await new Promise(r=>setTimeout(r,400)); const surf=JSON.stringify(RCDesigner.design.geom.surfaces);
  const cg0=RCDesigner.analysis.stab.cg; set('#mb-cg',60); set('#mb-auw',300); set('#mb-use',true); await new Promise(r=>setTimeout(r,500));
  return { surf, ail:RCDesigner.design.geom.surfaces.ailCf, flaps:RCDesigner.design.geom.surfaces.flaps, cg0, cg1:RCDesigner.analysis.stab.cg, auw:RCDesigner.analysis.inp.auw_kg, out:document.querySelector('#mb-out').textContent.slice(0,160) }; })()`);
results.designer.air = await ev(`(async()=>{const set=(id,v)=>{const e=document.querySelector(id);e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));};const a0=RCDesigner.analysis;const v0=a0.pf.vs,r0=a0.rho;
  set('#p-temp','35');set('#p-elev','2000');await new Promise(r=>setTimeout(r,500));const a1=RCDesigner.analysis,out={r0,v0,r1:a1.rho,v1:a1.pf.vs,roc0:a0.pf.rocMax,roc1:a1.pf.rocMax,txt:document.querySelector('#p-air').textContent};
  set('#p-temp','15');set('#p-elev','0');await new Promise(r=>setTimeout(r,400));out.back=RCDesigner.analysis.rho;return out;})()`);
await scrollTo('#asbuilt'); await shot('designer-asbuilt'); await scrollTo('#d-geom'); await shot('designer-surfaces');
await ev(`(()=>{const e=document.querySelector('#mb-use');e.checked=false;e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
await scrollTo('#d-power'); await shot('designer-power-selected');
await ev(`document.querySelector('#theme-toggle').click()`); await scrollTo('#d-3d'); await shot('designer-3d-dark'); await scrollTo('#d-perf'); await shot('designer-perf-dark');
await ev(`document.querySelector('#theme-toggle').click()`);
results.designer.after = collect();
const buildHash = await ev(`document.querySelector('#to-build').getAttribute('href').replace('build.html','')`);
await open('build.html', buildHash);
results.build = collect();
results.build.state = await ev(`(()=>({pages:document.querySelectorAll('#page-grid .page-thumb').length, parts:document.querySelectorAll('#cut-table tbody tr').length, bom:document.querySelectorAll('#bom-table tbody tr').length, title:document.querySelector('#b-design-name')?.textContent}))()`);
await shot('build-top'); await scrollTo('#b-pages'); await shot('build-pages'); await scrollTo('#b-bom'); await shot('build-bom');
results.build.variants = await ev(`(async()=>{const out=[];for(const m of ['balsa','foam']){for(const p of ['a5','letter','a4']){document.querySelector('#bo-method').value=m;document.querySelector('#bo-method').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#bo-paper').value=p;document.querySelector('#bo-paper').dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,250));out.push(m+'/'+p+': '+document.querySelectorAll('#page-grid .page-thumb').length+' pages, '+document.querySelectorAll('#cut-table tbody tr').length+' parts');}}return out;})()`);
results.build.after = collect();
await size(360, 800);
for (const f of ['rc-plane-calculator.html', 'designer.html', 'build.html']) {
  await open(f, f === 'build.html' ? buildHash : '');
  results[f + '@360'] = await ev(`[document.documentElement.scrollWidth, [...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.right>362&&!e.closest('.table-scroll,.nav,.subnav,.ribbon,.sheet-preview,.mini-table,#rc-sprite')}).slice(0,6).map(e=>e.tagName+'#'+e.id+'.'+e.className)]`);
  await shot(f.replace('.html', '') + '-360');
}
console.log(JSON.stringify(results, null, 1));
ws.close(); chrome.kill();
