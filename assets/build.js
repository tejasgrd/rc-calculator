/* RC Calc: Build page UI (templates, cutting list, parts & cost, build sequence). */
'use strict';
(function(){
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
let sys = RC.unitSystem();
const icon = RC.icon;

const fromHash = RC.readHash('design');
let design = fromHash || RC.store.get(RC.KEYS.design);
const isExample = !design || !design.geom;
if (isExample) design = { name:'Example trainer', req:{ mission:'trainer', material:'depron', currency:'$', budget:150 }, airfoilId:'clarky', geom:Object.assign(autoProportion('trainer', 1, 'trainer', 1 / 6.5), { washout:0 }), auw:0.16, cells:2, capacity_mAh:450, power:null };
if (fromHash) RC.store.set(RC.KEYS.design, design);
if (!PRESETS[design.geom.preset]) design.geom.preset = 'trainer';
design.req = Object.assign({ mission:'trainer', material:'depron', currency:'$', budget:0 }, design.req || {});
if (!MISSIONS[design.req.mission]) design.req.mission = 'trainer';
const af = Airfoil.get(design.airfoilId || 'clarky', design.customAirfoil);
const g0 = airframeGeometry(design.geom, 0.2);
const controls = g0.tailless ? 'elevon' : (design.req.mission === 'trainer' || design.req.mission === 'glider') ? 're' : 'aer2';
const mat0 = MATERIALS[design.req.material] || MATERIALS.depron;
const defaults = { method:mat0.method, foamStyle:mat0.foamStyle || 'kfm', paper:'a4', unit:sys === 'imperial' ? 'in' : 'mm', surf:CONTROLS[controls].surf === 'none' ? 'none' : CONTROLS[controls].surf, sheetT:mat0.sheetT,
  ribSpacing:50, sparW:3, sparH:3, le:5, te:10, inc:{ wing:true, tail:true, fuse:true } };
const saved = RC.store.get(RC.KEYS.build);
let opt = Object.assign({}, defaults, saved && saved.forDesign === design.name ? saved.opt : {});
opt.inc = Object.assign({ wing:true, tail:true, fuse:true }, opt.inc);
if (!Templates.PAPERS[opt.paper]) opt.paper = 'a4';

const materialKey = () => opt.method === 'balsa' ? 'balsa' : opt.foamStyle === 'folded' ? 'foamboard' : 'depron';
const L = mm => opt.unit === 'in' ? `${fmt(mm / 25.4, 2)} in` : `${fmt(mm, 0)} mm`;
const show = (dim, v) => { const u = sys === 'imperial' ? { mass:'oz', length:'in' }[dim] : { mass:'g', length:'mm' }[dim]; return `${fmtS(fromSI(dim, u, v))} ${unitLabel(dim, u)}`; };
let state = null;

function classify(p){ return /^Rib|^Wing/.test(p.name) ? 'wing' : /stabilizer|Fin|fin/.test(p.name) ? 'tail' : /Fuselage|Pod|Former|Nose/.test(p.name) ? 'fuse' : 'always'; }
function compute(){
  const parts = Templates.generateParts(design.geom, af, { method:opt.method, foamStyle:opt.foamStyle, ribSpacing:opt.ribSpacing / 1000, spar:{ w:opt.sparW, h:opt.sparH }, le:opt.le, te:opt.te, sheetT:opt.sheetT, unit:opt.unit, surf:opt.surf, propD_m:0.2 })
    .filter(p => { const k = classify(p); return k === 'always' || opt.inc[k]; });
  const paper = Templates.PAPERS[opt.paper], lay = Templates.layout(parts, paper), pages = Templates.paginate(lay, paper);
  const st = Templates.stats(parts, MATERIALS[materialKey()]);
  return { parts, paper, lay, pages, st };
}
function syncForm(){
  $$('[data-opt]').forEach(el => { el.value = String(opt[el.dataset.opt]); el.removeAttribute('aria-invalid'); });
  $$('[data-inc]').forEach(el => { el.checked = !!opt.inc[el.dataset.inc]; });
  $('#bo-foam-field').hidden = opt.method !== 'foam';
  $('#bo-balsa').hidden = opt.method !== 'balsa';
  $$('input[name=unitSystem]').forEach(r => { r.checked = r.value === sys; });
}
function renderSource(){
  const g = g0;
  $('#b-source').innerHTML = [`Design <b id="b-design-name">${esc(design.name || 'Untitled')}</b>`, `Span <b>${show('length', design.geom.span)}</b>`, `Wing area <b>${fmtS(g.S * 100)} dm²</b>`, `AUW <b>${show('mass', design.auw || 0)}</b>`, `Airfoil <b>${esc(af.name)}</b>`]
    .map(t => `<span class="pill">${t}</span>`).join('') + ` <a class="btn sm" href="designer.html#design=${RC.b64urlEncode(JSON.stringify(design))}">${icon('magic')}Edit in Designer</a>`;
  $('#nav-designer').href = 'designer.html#design=' + RC.b64urlEncode(JSON.stringify(design));
  $('#nav-sim').href = 'simulator.html#design=' + RC.b64urlEncode(JSON.stringify(design));
  $('#b-nodesign').innerHTML = isExample ? `<div class="callout warn">${icon('info')}<span>No design found, so this shows an example 1 m trainer. <a href="designer.html">Open the Designer</a> to size your own plane, then press <b>Open Build templates</b>.</span></div>` : '';
  if (af.approx && opt.method === 'balsa') $('#b-nodesign').innerHTML += `<div class="callout warn">${icon('warn')}<span>The ribs use a generated approximation of "${esc(af.name)}". For a named airfoil, import its exact .dat coordinates in the Designer before cutting balsa.</span></div>`;
}
function render(){
  state = compute();
  const { lay, pages, paper, parts, st } = state;
  $('#b-stats').innerHTML = [`<b>${pages.length}</b> ${paper.label} pages`, `<b>${parts.length}</b> templates`, `Sheet <b>${L(lay.width)} × ${L(lay.height)}</b>`, `Material ≈ <b>${st.sheets}</b> × ${esc(MATERIALS[materialKey()].sheetName)}`].map(t => `<span class="pill">${t}</span>`).join('');
  const title = design.name || 'design';
  $('#b-sheet').innerHTML = Templates.renderSheetSVG(lay, { pages, title }).replace(/width="[\d.]+mm" height="[\d.]+mm"/, '');
  $('#page-grid').innerHTML = pages.map(p => `<button type="button" class="page-thumb" data-page="${p.n - 1}" aria-label="Download page ${p.n} (row ${p.r + 1}, column ${p.c + 1}) as SVG" style="padding:0;cursor:pointer">${Templates.renderPageSVG(lay, pages, p, paper, { title, idPrefix:'th' }).replace(/width="[\d.]+mm" height="[\d.]+mm"/, '')}<span>${p.n} · ${p.r + 1}-${p.c + 1}</span></button>`).join('');
  $('#cut-table').innerHTML = `<thead><tr><th scope="col">Part</th><th scope="col">Qty</th><th scope="col">Material</th><th scope="col">Size</th><th scope="col">Note</th></tr></thead><tbody>${parts.filter(p => p.material !== 'paper').map(p => `<tr><th scope="row">${esc(p.name)}</th><td class="num">${p.qty}</td><td>${esc(p.material)}</td><td class="num">${L(p.w - 4)} × ${L(p.h - 4)}</td><td>${esc(p.note)}</td></tr>`).join('')}</tbody>`;
  renderBOM(); renderSteps();
  RC.store.set(RC.KEYS.build, { forDesign:design.name, opt });
}
function bomSizing(){
  const ms = MISSIONS[design.req.mission], P = (design.auw || 0.16) * (ms.wpk || STYLES[ms.style].wPerKg);
  const motor = design.power ? MOTOR_DB.concat(RC.store.get(RC.KEYS.motors, []) || []).find(m => m.id === design.power.motorId) : null;
  const cells = motor ? design.power.cells : design.cells || cellsForPower(P), cap = design.capacity_mAh || 450, I = P / (cells * 3.5);
  const sz = { auw:design.auw || 0.16, controls, P, cells, escA:ESC_SIZES.find(a => a >= Math.ceil(1.5 * I - 1e-9)) || Math.ceil(1.5 * I), capacity_mAh:cap, recC:Math.ceil(1.5 * I / (cap / 1000)), material:materialKey(), b:design.geom.span, extraServos:surfaceSpec(design.geom).flaps ? 2 : 0 };
  const power = motor ? { motor, cells, prop:design.power.prop, op:motorOperatingPoint({ motor, cells, capacity_mAh:cap, prop:design.power.prop }) } : null;
  return { sz, power };
}
function renderBOM(){
  const { sz, power } = bomSizing(), ov = RC.store.get(RC.KEYS.parts, {}) || {}, cur = design.req.currency || '$';
  const bom = buildBOM(sz, power, { count:state.st.sheets }, ov);
  state.bom = bom;
  const budget = +design.req.budget || 0;
  $('#bom-stats').innerHTML = [`<div class="stat ${budget && bom.cost > budget ? 'is-warn' : 'is-ok'}"><span class="lbl">Estimated cost<span class="tag tag-estimate">Estimate</span></span><span class="val">${esc(cur)}${fmt(bom.cost, 0)}</span><span class="note">${budget ? (bom.cost <= budget ? `within your ${esc(cur)}${fmt(budget, 0)} budget` : `over your ${esc(cur)}${fmt(budget, 0)} budget by ${esc(cur)}${fmt(bom.cost - budget, 0)}`) : 'set a budget in the Designer'}</span></div>`,
    `<div class="stat"><span class="lbl">Electronics weight<span class="tag tag-estimate">Estimate</span></span><span class="val">${show('mass', bom.electronicsWeight / 1000)}</span><span class="note">motor, ESC, battery, servos, receiver</span></div>`,
    `<div class="stat"><span class="lbl">Material sheets<span class="tag tag-rule">Rule of thumb</span></span><span class="val">${state.st.sheets}</span><span class="note">${esc(MATERIALS[materialKey()].sheetName)}, +35% waste</span></div>`].join('');
  $('#bom-table').innerHTML = `<thead><tr><th scope="col">Category</th><th scope="col">Item</th><th scope="col">Qty</th><th scope="col">Unit weight (g)</th><th scope="col">Unit price (${esc(cur)})</th><th scope="col">Total (${esc(cur)})</th></tr></thead><tbody>${bom.rows.map(r => `<tr><td>${esc(r.cat)}</td><th scope="row">${esc(r.name)}</th><td class="num">${r.qty}</td>
    <td><input type="number" step="any" min="0" value="${+(+r.g || 0).toFixed(1)}" data-ov="${esc(r.id)}" data-k="g" aria-label="Unit weight of ${esc(r.name)} in grams" style="min-height:32px;padding:4px 6px;max-width:90px"></td>
    <td><input type="number" step="any" min="0" value="${+(+r.price).toFixed(2)}" data-ov="${esc(r.id)}" data-k="price" aria-label="Unit price of ${esc(r.name)}" style="min-height:32px;padding:4px 6px;max-width:90px"></td><td class="num">${fmt(r.total, 2)}</td></tr>`).join('')}
    <tr><th scope="row" colspan="5">Total</th><td class="num"><b>${esc(cur)}${fmt(bom.cost, 2)}</b></td></tr></tbody>`;
}
function renderSteps(){
  const balsa = opt.method === 'balsa', folded = opt.foamStyle === 'folded', g = g0;
  const s = [
    'Print the templates at 100%. Measure the 50 mm square; if it is off, fix the printer scaling and reprint.',
    'Trim each page on its dashed border, overlap the pages, line up the red crosses and tape them together. Spray-mount or pin the templates to the material.',
    ...(balsa ? [
      `Cut ${state.parts.filter(p => /^Rib/.test(p.name)).length * 2} ribs from ${opt.sparW > 0 ? 'balsa sheet' : 'sheet'} (stack-cut pairs and sand them together). Cut the spar notches snug for a ${opt.sparW}×${opt.sparH} mm spar.`,
      'Pin the wing plan to a flat board, cover it with cling film, pin the bottom spar and TE stock, glue the ribs on their station lines, then add the top spar and LE stock.',
      `Join the halves with ${fmt(design.geom.dihedral, 1)}° total dihedral (block up one tip), add a ply dihedral brace, then sheet or cap the LE and cover with film.`,
    ] : folded ? [
      'Score the fold line (A-fold) at the leading edge on the inside skin. Score the top-skin bend lines so the skin curves smoothly over the spar.',
      'Glue the spar (foam strip or carbon) on its line on the bottom skin, fold the top skin over, and glue the trailing edge. Weigh the wing down flat while it cures.',
      `Join the halves with ${fmt(design.geom.dihedral, 1)}° total dihedral, and reinforce the centre joint with tape or a skewer brace.`,
    ] : [
      'Cut the base panels and the KFm step layers from Depron. Glue each step layer flush with the leading edge on top of its base panel.',
      'Sand the leading edge round and taper the trailing edge slightly. Glue a carbon strip on the spar line, then hinge the ailerons/elevons with tape (bevel the hinge line 45°).',
      `Bevel the root edges and join the halves at ${fmt(design.geom.dihedral, 1)}° total dihedral with foam-safe glue plus a tape hinge underneath.`,
    ]),
    g.tailless ? 'Glue the tip fins square to the wing tips.' : 'Cut the stabilizer, fin, elevator and rudder; bevel the hinge lines and hinge them with tape. Glue the tail on square to the wing (check from behind).',
    g.body === 'stick' ? 'Laminate the nose blocks either side of the boom, add the motor mount behind the wing, and glue the wing and tail to the boom.' : 'Glue the fuselage sides to the formers (check that the box is square), then add the top and bottom. Fit the firewall with the motor mount.',
    'Install the motor, ESC, receiver and servos. Make the pushrods, centre the servos with the radio on, and set the control throws (start with about 10 mm for a trainer).',
    `Balance the plane at the recommended CG (${fmt(design.geom.cg, 0)}% MAC, shown on the Designer's Stability step) with the battery installed. Move the battery, don't add weight, where possible.`,
    'Bind the receiver and set the failsafe to throttle off. Range-check, then do a restrained bench test while watching the current on a watt meter.',
  ];
  $('#steps').innerHTML = s.map(t => `<li>${esc(t)}</li>`).join('');
}

function printTemplates(){
  const { lay, pages, paper } = state, title = design.name || 'design';
  $('#print-pages').innerHTML = pages.map(p => Templates.renderPageSVG(lay, pages, p, paper, { title, idPrefix:'pr' })).join('');
  $('#page-size').textContent = `@page { size: ${paper.w}mm ${paper.h}mm; margin: 0; }`;
  document.body.classList.add('printing-templates');
  const done = () => { document.body.classList.remove('printing-templates'); $('#print-pages').innerHTML = ''; $('#page-size').textContent = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
}

function init(){
  RC.initChrome();
  syncForm(); renderSource(); render();
  $('#bo-form').addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.inc) { opt.inc[el.dataset.inc] = el.checked; render(); return; }
    const k = el.dataset.opt; if (!k) return;
    if (el.tagName === 'SELECT') {
      opt[k] = el.value;
      if (k === 'method' || k === 'foamStyle') opt.sheetT = MATERIALS[materialKey()].sheetT;
      if (k === 'method' && el.value === 'balsa') opt.sheetT = 1.5;
      syncForm(); renderSource();
    } else { const n = Number(el.value); if (el.value.trim() === '' || !isFinite(n) || n < +el.min || n > +el.max) { el.setAttribute('aria-invalid', 'true'); return; } el.removeAttribute('aria-invalid'); opt[k] = n; }
    render();
  });
  $('#page-grid').addEventListener('click', e => { const b = e.target.closest('[data-page]'); if (!b) return; const p = state.pages[+b.dataset.page];
    RC.download(new Blob([Templates.renderPageSVG(state.lay, state.pages, p, state.paper, { title:design.name })], { type:'image/svg+xml' }), `templates-page-${p.n}.svg`); RC.toast(`Page ${p.n} downloaded`); });
  $('#b-svg').addEventListener('click', () => { RC.download(new Blob([Templates.renderSheetSVG(state.lay, { pages:state.pages, title:design.name })], { type:'image/svg+xml' }), `${(design.name || 'design').replace(/[^\w-]+/g, '_')}-templates-fullsize.svg`); RC.toast('Full-size SVG downloaded (1 unit = 1 mm)'); });
  $('#b-print').addEventListener('click', printTemplates);
  $('#bom-table').addEventListener('change', e => { const el = e.target, id = el.dataset.ov; if (!id) return; const n = Number(el.value); if (!isFinite(n) || n < 0) { el.setAttribute('aria-invalid', 'true'); return; }
    const ov = RC.store.get(RC.KEYS.parts, {}) || {}; ov[id] = Object.assign(ov[id] || {}, { [el.dataset.k]:n }); RC.store.set(RC.KEYS.parts, ov); renderBOM(); });
  $('#bom-reset').addEventListener('click', () => { RC.store.set(RC.KEYS.parts, {}); renderBOM(); RC.toast('Prices reset to examples'); });
  $('#bom-csv').addEventListener('click', () => { const q = s => `"${String(s).replace(/"/g, '""')}"`;
    const csv = [['Category', 'Item', 'Qty', 'Unit weight g', 'Unit price', 'Total'].map(q).join(',')].concat(state.bom.rows.map(r => [r.cat, r.name, r.qty, (+r.g || 0).toFixed(1), (+r.price).toFixed(2), r.total.toFixed(2)].map(q).join(','))).join('\n');
    RC.download(new Blob([csv], { type:'text/csv' }), `${(design.name || 'design').replace(/[^\w-]+/g, '_')}-parts.csv`); });
  $$('input[name=unitSystem]').forEach(r => r.addEventListener('change', () => { sys = r.value; RC.setUnitSystem(sys); opt.unit = sys === 'imperial' ? 'in' : 'mm'; syncForm(); renderSource(); render(); }));
  RC.navHighlight('.subnav a');
}
init();
window.RCBuild = { get state(){ return state; }, get options(){ return opt; } };
})();
