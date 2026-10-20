/* RC Calc guide: interactive fundamentals, two worked examples (Depron trainer + flying wing) generated live
   by the same models as the Designer/Build/Simulator pages, and the A–Z glossary from rc-info.js. */
'use strict';
(() => {
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
let sys = RC.unitSystem();
const UN = () => sys === 'imperial' ? { length:'in', mass:'oz', speed:'mph', area:'in2', wingLoading:'oz/ft2' } : { length:'mm', mass:'g', speed:'m/s', area:'dm2', wingLoading:'g/dm2' };
const show = (dim, v, d) => (v == null || !isFinite(v)) ? '—' : `${d != null ? fmt(fromSI(dim, UN()[dim], v), d) : fmtS(fromSI(dim, UN()[dim], v))} ${unitLabel(dim, UN()[dim])}`;
const g2 = kg => show('mass', kg), L = m => show('length', m), SPD = v => show('speed', v, 1), AREA = m2 => show('area', m2), WL = gdm2 => show('wingLoading', gdm2 / 1000 * 100);
const stat = (lbl, val, note, tag, cls) => `<div class="stat ${cls || ''}${/[a-z]{3}/i.test(String(val).replace(/<[^>]+>/g, '').replace(/\b(mm|in|g|oz|kg|m\/s|mph|dm²|in²|MAC|min|KV|mAh|Wh)\b/g, '')) && String(val).length > 9 ? ' is-text' : ''}"><span class="lbl">${lbl}${tag ? `<span class="tag tag-${tag}">${{ physics:'Physics', estimate:'Estimate', rule:'Rule of thumb' }[tag]}</span>` : ''}</span><span class="val">${val}</span>${note ? `<span class="note">${note}</span>` : ''}</div>`;
const slider = (id, label, min, max, step, val, out) => `<div class="field"><label for="${id}">${label}: <output id="${id}-o">${out}</output></label><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${val}"></div>`;
const verdict = (cls, text) => `<p class="g-verdict ${cls}" role="status">${RC.icon(cls === 'ok' ? 'check' : cls === 'warn' ? 'warn' : 'x')}<span>${text}</span></p>`;
const enc = o => RC.b64urlEncode(JSON.stringify(o));
const diagramColors = () => { const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim();
  return { paper:v('--d-paper'), grid:v('--d-grid'), gridMajor:v('--d-grid-major'), ink:v('--d-ink'), fill:v('--d-fill'), accent:v('--d-accent'), cg:v('--d-cg'), band:v('--d-band'), dim:v('--d-dim') }; };
const cleanSVG = html => html.replace(/ width="[\d.]+(mm)?" height="[\d.]+(mm)?"/, ' class="diagram-svg"');
const airfoilPath = (af, w, h, x0 = 0, y0 = 0) => { const pts = af.points, ys = pts.map(p => p[1]), s = w; return 'M' + pts.map(([x, y]) => `${(x0 + x * s).toFixed(1)},${(y0 - y * s).toFixed(1)}`).join('L') + 'Z'; };
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/* ======================= chapter table of contents ======================= */
function renderTOC(){
  const ch = $$('.g-ch');
  $('#g-toc').innerHTML = `<div class="g-tocgrid">${ch.map((c, i) => `<a class="g-tocitem" href="#${c.id}"><span class="ico">${RC.icon(c.dataset.icon || 'book')}</span><span><small>1.${i + 1}</small>${esc(c.dataset.title)}</span></a>`).join('')}
    <a class="g-tocitem ex" href="#ex-trainer"><span class="ico">${RC.icon('wing')}</span><span><small>Example</small>Depron trainer</span></a>
    <a class="g-tocitem ex" href="#ex-wing"><span class="ico">${RC.icon('airfoil')}</span><span><small>Example</small>Depron flying wing</span></a>
    <a class="g-tocitem" href="#glossary"><span class="ico">${RC.icon('list')}</span><span><small>Reference</small>Glossary A–Z</span></a></div>`;
}

/* ======================= widgets ======================= */
const W = {};
function widget(id, render, bind){ const el = document.getElementById(id); if (!el) return; W[id] = { el, render, state:null }; render(el); if (bind) bind(el); el.addEventListener('input', () => render(el, true)); }
const val = (id, d) => { const e = document.getElementById(id); return e ? +e.value : d; };
const setOut = (id, t) => { const o = document.getElementById(id + '-o'); if (o) o.textContent = t; };
function keepInputs(el, html){ // re-render results without losing focus on sliders
  let res = el.querySelector('.w-res'); if (!res) { el.innerHTML = `<div class="w-ctl">${html.controls}</div><div class="w-res"></div>`; res = el.querySelector('.w-res'); } res.innerHTML = html.res;
}

// 1.1 materials
widget('w-material', el => {
  const span = val('wm-span', 1.0), chord = val('wm-chord', 0.18), mat = (el.querySelector('#wm-mat') || {}).value || 'depron';
  const S = span * chord, dm2 = S * 100, M = Object.assign({}, MATERIALS, { epp:{ label:'EPP foam (6 mm) + carbon', wing:5.6 } });
  setOut('wm-span', L(span)); setOut('wm-chord', L(chord));
  const rows = Object.entries(M).map(([k, m]) => ({ k, label:m.label, g:m.wing * dm2 })), mx = Math.max(...rows.map(r => r.g));
  keepInputs(el, { controls:`<h4>Try it: how heavy is the wing?</h4>${slider('wm-span', 'Span', 0.5, 1.8, 0.05, span, L(span))}${slider('wm-chord', 'Chord', 0.1, 0.35, 0.01, chord, L(chord))}
      <div class="field"><label for="wm-mat">Material</label><select id="wm-mat">${Object.entries(M).map(([k, m]) => `<option value="${k}"${k === mat ? ' selected' : ''}>${esc(m.label)}</option>`).join('')}</select></div>`,
    res:`<div class="stats">${stat('Wing area', AREA(S), `${fmt(dm2, 1)} dm²`)}${stat('Finished wing', g2(M[mat].wing * dm2 / 1000), `${fmt(M[mat].wing, 1)} g/dm² incl. spar, tape`, 'estimate')}</div>
      <div class="g-bars" role="img" aria-label="Wing weight for each material">${rows.map(r => `<div class="g-bar${r.k === mat ? ' on' : ''}"><span>${esc(r.label.split(' (')[0])}</span><i style="width:${(r.g / mx * 100).toFixed(1)}%"></i><b>${g2(r.g / 1000)}</b></div>`).join('')}</div>` });
});

// 1.2 lift
widget('w-lift', el => {
  const V = val('wl-v', 7), Sd = val('wl-s', 22), CL = val('wl-cl', 0.33), Wg = val('wl-w', 220), S = Sd / 100;
  const Lg = 0.5 * RHO_SL * V * V * S * CL / G * 1000, stalled = CL > 1.2, vs = Phys.stallSpeed(Wg / 1000, S, RHO_SL, 1.1);
  setOut('wl-v', SPD(V)); setOut('wl-s', AREA(S)); setOut('wl-cl', fmt(CL, 2)); setOut('wl-w', g2(Wg / 1000));
  const lift = stalled ? Lg * 0.55 : Lg, ratio = lift / Wg, sc = 70 / Math.max(Wg, lift, 1);
  const ink = css('--ink') || '#0b2545', acc = css('--accent') || '#0891b2', amber = css('--amber-line') || '#f59e0b';
  const svg = `<svg viewBox="0 0 320 190" class="g-fig" role="img" aria-label="Lift ${Math.round(lift)} grams against weight ${Wg} grams">
    <path d="${airfoilPath(Airfoil.get('clarky'), 180, 0, 70, 98)}" fill="${css('--card-2')}" stroke="${ink}" stroke-width="1.5" transform="rotate(${Math.min(16, CL * 10)} 160 95)"/>
    <line x1="160" y1="92" x2="160" y2="${92 - lift * sc}" stroke="${acc}" stroke-width="5" marker-end="url(#ah1)"/><text x="170" y="${Math.max(14, 92 - lift * sc + 12)}" fill="${acc}" font-size="12" font-weight="700">Lift ${Math.round(lift)} g</text>
    <line x1="150" y1="100" x2="150" y2="${100 + Wg * sc}" stroke="${amber}" stroke-width="5" marker-end="url(#ah2)"/><text x="60" y="${Math.min(186, 100 + Wg * sc)}" fill="${amber}" font-size="12" font-weight="700">Weight ${Math.round(Wg)} g</text>
    <defs><marker id="ah1" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="${acc}"/></marker><marker id="ah2" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="${amber}"/></marker></defs></svg>`;
  keepInputs(el, { controls:`<h4>Try it: balance lift against weight</h4>${slider('wl-v', 'Airspeed', 2, 20, 0.5, V, SPD(V))}${slider('wl-s', 'Wing area', 5, 45, 1, Sd, AREA(S))}${slider('wl-cl', 'Lift coefficient <span>C<sub>L</sub></span> (angle of attack)', 0, 1.5, 0.05, CL, fmt(CL, 2))}${slider('wl-w', 'Weight', 80, 800, 10, Wg, g2(Wg / 1000))}`,
    res:svg + (stalled ? verdict('bad', `C<sub>L</sub> above about 1.2: the wing has <b>stalled</b>. Lift collapses and the plane drops; lower the nose to recover.`) : ratio > 1.05 ? verdict('ok', `Lift exceeds weight by ${Math.round((ratio - 1) * 100)} %: the plane <b>climbs</b> (or you can fly slower at a lower angle).`) : ratio > 0.95 ? verdict('ok', `Lift ≈ weight: <b>level flight</b>.`) : verdict('warn', `Lift is ${Math.round((1 - ratio) * 100)} % short: the plane <b>sinks</b>. Fly faster, raise the angle of attack, or use a bigger wing.`)) +
      `<p class="hint">At this weight and area the stall speed is about <b>${SPD(vs)}</b> (C<sub>L</sub>max ≈ 1.1). Wing loading: <b>${WL(Wg / Sd)}</b>.</p>` });
});

// 1.3 design loop diagram (clickable)
widget('w-loop', el => {
  if (el.dataset.done) return; el.dataset.done = '1';
  const st = [['Requirements', 'ch-design'], ['Weight guess', 'ch-weight'], ['Wing size', 'ch-wing'], ['Tail & fuselage', 'ch-stability'], ['Power system', 'ch-power'], ['Recompute weight', 'ch-weight'], ['Check CG & performance', 'ch-stability'], ['Build, balance, fly', 'ch-fly']];
  const cx = 160, cy = 120, R = 90, ink = css('--ink'), acc = css('--accent'), card = css('--card');
  el.innerHTML = `<h4>The design loop (click a step)</h4><svg viewBox="0 0 320 240" class="g-fig" role="img" aria-label="Design loop: ${st.map(s => s[0]).join(', ')}">
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${acc}" stroke-width="2" stroke-dasharray="5 4"/>
    <text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="12" font-weight="700" fill="${ink}">repeat until</text><text x="${cx}" y="${cy + 12}" text-anchor="middle" font-size="12" font-weight="700" fill="${ink}">the weight settles</text>
    ${st.map(([t, href], i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / st.length, x = cx + R * Math.cos(a), y = cy + R * Math.sin(a);
      return `<a href="#${href}"><g class="g-node"><rect x="${x - 52}" y="${y - 13}" width="104" height="26" rx="13" fill="${card}" stroke="${acc}" stroke-width="1.5"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-size="10.5" font-weight="650" fill="${ink}">${i + 1}. ${esc(t)}</text></g></a>`; }).join('')}</svg>`;
});

// 1.4 wing planform + airfoil
widget('w-wing', el => {
  const b = val('ww-b', 1.2), cr = val('ww-cr', 0.2), tap = val('ww-t', 0.6), sw = val('ww-sw', 0), di = val('ww-di', 4), wo = val('ww-wo', 1), Wg = val('ww-w', 250);
  const afId = (el.querySelector('#ww-af') || {}).value || 'clarky', af = Airfoil.get(afId), ct = cr * tap, S = b * (cr + ct) / 2, AR = b * b / S, mac = Phys.mac(cr, ct);
  const ll = liftingLine({ b, cr, ct, washoutDeg:wo, a0:2 * Math.PI * 0.9, alpha0Deg:af.alpha0Deg, CL:0.5, clmax2D:af.clmax }), wl = Wg / (S * 100), vs = Phys.stallSpeed(Wg / 1000, S, RHO_SL, (ll.CLmax3D || af.clmax * 0.9));
  [['ww-b', L(b)], ['ww-cr', L(cr)], ['ww-t', fmt(tap, 2)], ['ww-sw', `${sw}°`], ['ww-di', `${di}°`], ['ww-wo', `${wo}°`], ['ww-w', g2(Wg / 1000)]].forEach(([i, t]) => setOut(i, t));
  const k = 280 / Math.max(b, 0.5), hb = b / 2, tsw = Math.tan(sw * Math.PI / 180), ink = css('--ink'), acc = css('--accent'), fill = css('--card-2');
  const P = (y, x) => `${(160 + y * k).toFixed(1)},${(20 + x * k).toFixed(1)}`;
  const plan = `<svg viewBox="0 0 320 ${Math.max(90, 40 + (cr + hb * tsw) * k)}" class="g-fig" role="img" aria-label="Wing seen from above">
    <polygon points="${[P(-hb, hb * tsw), P(0, 0), P(hb, hb * tsw), P(hb, hb * tsw + ct), P(0, cr), P(-hb, hb * tsw + ct)].join(' ')}" fill="${fill}" stroke="${ink}" stroke-width="1.5"/>
    <line x1="${160 + b / 6 * (1 + 2 * tap) / (1 + tap) * k}" y1="${20 + (b / 6 * (1 + 2 * tap) / (1 + tap)) * tsw * k}" x2="${160 + b / 6 * (1 + 2 * tap) / (1 + tap) * k}" y2="${20 + ((b / 6 * (1 + 2 * tap) / (1 + tap)) * tsw + mac) * k}" stroke="${acc}" stroke-width="3" stroke-dasharray="6 3"/>
    <text x="164" y="14" font-size="11" fill="${acc}" font-weight="700">MAC</text></svg>`;
  const front = `<svg viewBox="0 0 320 60" class="g-fig" role="img" aria-label="Wing seen from the front with ${di} degrees dihedral"><polyline points="${20},${40 - 140 * Math.tan(di * Math.PI / 180)} 160,40 ${300},${40 - 140 * Math.tan(di * Math.PI / 180)}" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round"/><text x="164" y="56" font-size="11" fill="${css('--muted')}">front view · dihedral ${di}° each side</text></svg>`;
  const foil = `<svg viewBox="0 0 320 70" class="g-fig" role="img" aria-label="${esc(af.name)} airfoil"><path d="${airfoilPath(af, 280, 0, 20, 45)}" fill="${fill}" stroke="${ink}" stroke-width="1.5"/><text x="20" y="66" font-size="11" fill="${css('--muted')}">${esc(af.name)} · CLmax ${fmt(af.clmax, 2)} · ${fmt((af.t || 0) * 100, 0)} % thick</text></svg>`;
  const stall = ll.stallStation != null ? ll.stallStation : null;
  keepInputs(el, { controls:`<h4>Try it: shape a wing</h4><div class="g-grid2 tight">${slider('ww-b', 'Span', 0.5, 1.8, 0.05, b, L(b))}${slider('ww-cr', 'Root chord', 0.1, 0.35, 0.01, cr, L(cr))}${slider('ww-t', 'Taper (tip ÷ root)', 0.3, 1, 0.05, tap, fmt(tap, 2))}${slider('ww-sw', 'Sweep', 0, 35, 1, sw, sw + '°')}${slider('ww-di', 'Dihedral', 0, 10, 0.5, di, di + '°')}${slider('ww-wo', 'Washout', 0, 5, 0.5, wo, wo + '°')}${slider('ww-w', 'All-up weight', 80, 900, 10, Wg, g2(Wg / 1000))}
      <div class="field"><label for="ww-af">Airfoil</label><select id="ww-af">${Airfoil.PRESETS.map(a => `<option value="${a.id}"${a.id === afId ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div></div>`,
    res:plan + front + foil + `<div class="stats">${stat('Wing area', AREA(S))}${stat('Aspect ratio', fmt(AR, 1), AR < 5 ? 'short, strong, rolls fast' : AR > 9 ? 'slender: glides well' : 'all-round')}${stat('MAC', L(mac))}${stat('Wing loading', WL(wl), wl < 20 ? 'floaty' : wl < 35 ? 'sporty' : 'fast', 'physics')}${stat('Stall speed', SPD(vs), '3D wing CLmax ' + fmt(ll.CLmax3D || 0, 2), 'physics')}${stat('Span efficiency e', fmt(ll.e, 2), 'ideal ellipse = 1', 'physics')}</div>` +
      (stall != null ? (stall > 0.6 ? verdict('warn', `The stall starts near the <b>tips</b> (${Math.round(stall * 100)} % of the half-span): the plane may drop a wing. Add washout or less taper.`) : verdict('ok', `The stall starts at ${Math.round(stall * 100)} % of the half-span, inboard of the ailerons: gentle, straight stalls.`)) : '') });
});

// 1.5 CG and static margin on the example trainer
let TR0 = null; const trainer0 = () => TR0 || (TR0 = SimModel.builtinDesign('trainer'));
widget('w-cg', el => {
  const d0 = trainer0(), cg = val('wc-cg', d0.geom.cg), tf = val('wc-tail', 1), af = Airfoil.get(d0.airfoilId);
  const geom = Object.assign({}, d0.geom, { cg, hSpan:d0.geom.hSpan * Math.sqrt(tf), hChord:d0.geom.hChord * Math.sqrt(tf) }), g = airframeGeometry(geom, 0.18), st = stabilityAnalysis(geom, g, { smTarget:0.1, cm0:af.cm0 });
  setOut('wc-cg', `${fmt(cg, 1)} % MAC`); setOut('wc-tail', `${Math.round(tf * 100)} %`);
  const np = st.xnp * 100, sm = np - cg, pos = v => `${Math.max(0, Math.min(100, v / 70 * 100))}%`;
  const cls = sm < 0 ? 'bad' : sm < 5 ? 'warn' : sm > 25 ? 'warn' : 'ok';
  keepInputs(el, { controls:`<h4>Try it: move the balance point of the example trainer</h4>${slider('wc-cg', 'CG position', 5, 60, 0.5, cg, fmt(cg, 1) + ' % MAC')}${slider('wc-tail', 'Tailplane size', 0.4, 1.8, 0.05, tf, Math.round(tf * 100) + ' %')}`,
    res:`<div class="g-scale" role="img" aria-label="CG ${fmt(cg, 1)} percent, neutral point ${fmt(np, 1)} percent of MAC"><div class="band" style="left:${pos(np - 15)};width:${(10 / 70 * 100).toFixed(1)}%"></div><div class="np" style="left:${pos(np)}"><span>NP ${fmt(np, 0)} %</span></div><div class="cgm" style="left:${pos(cg)}"><span>CG ${fmt(cg, 0)} %</span></div>
      <div class="ticks">${[0, 10, 20, 30, 40, 50, 60, 70].map(t => `<i style="left:${pos(t)}">${t}</i>`).join('')}</div></div>
      <div class="stats">${stat('Neutral point', fmt(np, 1) + ' % MAC', `${L(st.fromRootLE(st.xnp))} behind root LE`, 'estimate')}${stat('Static margin', fmt(sm, 1) + ' %', 'aim 5–15 %', 'estimate', cls === 'ok' ? '' : 'is-warn')}${stat('Tail volume Vh', fmt(g.Vh, 2), 'typical 0.35–0.6', 'physics')}${stat('Recommended CG', fmt(st.cgRec * 100, 1) + ' % MAC', `${L(st.fromRootLE(st.cgRec))} behind root LE`, 'estimate')}</div>` +
      (sm < 0 ? verdict('bad', 'CG is <b>behind the neutral point</b>: the plane is unstable and will flip nose-up or nose-down. Move the battery forward.') : sm < 5 ? verdict('warn', 'Very little static margin: lively and twitchy in pitch. Fine for experts, not for a first flight.') : sm > 25 ? verdict('warn', 'Very nose-heavy: rock-steady, but the elevator may not flare it for landing and it needs extra speed.') : verdict('ok', `Static margin ${fmt(sm, 0)} %: stable and forgiving.`)) +
      `<p class="hint">A bigger tail moves the neutral point back, which widens the safe CG range. Notice how the tail-volume number follows the tail size.</p>` });
});

// 1.6 control surfaces & elevon mixing
widget('w-controls', el => {
  const mode = (el.querySelector('#wct-mode') || {}).value || 'plane', ail = val('wct-a', 0), ele = val('wct-e', 0), rud = val('wct-r', 0), T = 14;
  ['wct-a', 'wct-e', 'wct-r'].forEach(i => setOut(i, fmt(val(i, 0), 2)));
  const ink = css('--ink'), acc = css('--accent'), amber = css('--amber-line'), fill = css('--card-2');
  const col = v => v > 0.02 ? acc : v < -0.02 ? amber : fill, lab = (v, up) => Math.abs(v) < 0.02 ? '0°' : `${Math.round(Math.abs(v) * T)}° ${v > 0 ? up[0] : up[1]}`;
  let svg, text;
  if (mode === 'plane') {
    // surface deflection: + = trailing edge up
    const aR = ail, aL = -ail, eU = ele, rR = rud;
    svg = `<svg viewBox="0 0 320 200" class="g-fig" role="img" aria-label="Plane from above: ailerons ${lab(aR, ['up right', 'down right'])}, elevator ${lab(eU, ['up', 'down'])}, rudder ${lab(rR, ['right', 'left'])}">
      <rect x="150" y="20" width="20" height="160" rx="9" fill="${fill}" stroke="${ink}"/><rect x="20" y="60" width="280" height="44" rx="4" fill="${fill}" stroke="${ink}"/>
      <rect x="22" y="92" width="80" height="12" fill="${col(aL)}" stroke="${ink}"/><rect x="218" y="92" width="80" height="12" fill="${col(aR)}" stroke="${ink}"/>
      <rect x="105" y="150" width="110" height="26" fill="${fill}" stroke="${ink}"/><rect x="107" y="168" width="106" height="8" fill="${col(eU)}" stroke="${ink}"/>
      <line x1="160" y1="150" x2="${160 + rR * 14}" y2="192" stroke="${col(Math.abs(rR) > 0.02 ? 1 : 0)}" stroke-width="5" stroke-linecap="round"/>
      <text x="62" y="122" text-anchor="middle" font-size="11" fill="${ink}">L aileron ${lab(aL, ['up', 'down'])}</text><text x="258" y="122" text-anchor="middle" font-size="11" fill="${ink}">R aileron ${lab(aR, ['up', 'down'])}</text>
      <text x="230" y="168" font-size="11" fill="${ink}">elevator ${lab(eU, ['up', 'down'])}</text><text x="178" y="196" font-size="11" fill="${ink}">rudder ${lab(rR, ['right', 'left'])}</text></svg>`;
    text = [Math.abs(ail) > 0.02 ? `rolls ${ail > 0 ? 'right' : 'left'} (the ${ail > 0 ? 'right' : 'left'} aileron goes up, pushing that wing down)` : '', Math.abs(ele) > 0.02 ? `pitches ${ele > 0 ? 'up' : 'down'} (elevator ${ele > 0 ? 'up pushes the tail down' : 'down lifts the tail'})` : '', Math.abs(rud) > 0.02 ? `yaws ${rud > 0 ? 'right' : 'left'}` : ''].filter(Boolean);
  } else {
    const R = Math.max(-1, Math.min(1, ele + ail)), Lf = Math.max(-1, Math.min(1, ele - ail));
    svg = `<svg viewBox="0 0 320 170" class="g-fig" role="img" aria-label="Flying wing from above: left elevon ${lab(Lf, ['up', 'down'])}, right elevon ${lab(R, ['up', 'down'])}">
      <polygon points="160,20 300,110 300,140 160,70 20,140 20,110" fill="${fill}" stroke="${ink}" stroke-width="1.5"/>
      <polygon points="40,122 110,95 110,108 40,136" fill="${col(Lf)}" stroke="${ink}"/><polygon points="280,122 210,95 210,108 280,136" fill="${col(R)}" stroke="${ink}"/>
      <text x="70" y="160" text-anchor="middle" font-size="11" fill="${ink}">L elevon ${lab(Lf, ['up', 'down'])}</text><text x="250" y="160" text-anchor="middle" font-size="11" fill="${ink}">R elevon ${lab(R, ['up', 'down'])}</text></svg>`;
    text = [`left elevon = elevator ${ele >= 0 ? '+' : '−'} aileron mix, right elevon = elevator + aileron`, Math.abs(R - Lf) > 0.04 ? `rolls ${R > Lf ? 'right' : 'left'}` : '', Math.abs(R + Lf) > 0.04 ? `pitches ${R + Lf > 0 ? 'up' : 'down'}` : ''].filter(Boolean);
  }
  keepInputs(el, { controls:`<h4>Try it: move the sticks</h4><div class="field"><label for="wct-mode">Plane</label><select id="wct-mode"><option value="plane"${mode === 'plane' ? ' selected' : ''}>Trainer (ailerons, elevator, rudder)</option><option value="wing"${mode === 'wing' ? ' selected' : ''}>Flying wing (elevons, mixed)</option></select></div>
      ${slider('wct-a', 'Aileron stick (left ← → right)', -1, 1, 0.05, ail, fmt(ail, 2))}${slider('wct-e', 'Elevator stick (push ← → pull)', -1, 1, 0.05, ele, fmt(ele, 2))}${slider('wct-r', 'Rudder stick', -1, 1, 0.05, rud, fmt(rud, 2))}`,
    res:svg + `<p class="hint">${text.length ? 'The plane ' + esc(text.join('; ')) + '.' : 'Sticks centred: all surfaces neutral.'} Coloured = trailing edge up, amber = down.</p>` });
});

// 1.7 motor & prop explorer
widget('w-power', el => {
  const kv = val('wp-kv', 1380), cells = val('wp-c', 2), D = val('wp-d', 7), Pp = val('wp-p', 3.5), auw = val('wp-w', 220) / 1000;
  const R = computeAll({ auw_kg:auw, area_m2:0.22, span_m:1.2, style:'trainer', wPerKg:null, cells, cap_Ah:0.35, cRating:null, kv, propD:D, propP:Pp, clmax:1.1, rho:RHO_SL, vCell:3.5, rpmFactor:0.8, cp:0.04, fm:0.5, usable:0.8, cruiseFactor:1.4, throttle:0.5, controls:'aer1', flaps:false });
  [['wp-kv', `${kv} KV`], ['wp-c', `${cells}S`], ['wp-d', `${D} in`], ['wp-p', `${Pp} in`], ['wp-w', g2(auw)]].forEach(([i, t]) => setOut(i, t));
  const I = R.propPower / (cells * 3.5) / 0.75, pr = R.pitchSpeed / R.vc, wpk = R.propPower / 0.75 / auw;
  keepInputs(el, { controls:`<h4>Try it: pick a motor KV and prop</h4><div class="g-grid2 tight">${slider('wp-kv', 'Motor KV', 600, 3000, 20, kv, kv + ' KV')}${slider('wp-c', 'Battery cells', 1, 4, 1, cells, cells + 'S')}${slider('wp-d', 'Prop diameter', 4, 11, 0.5, D, D + ' in')}${slider('wp-p', 'Prop pitch', 2, 7, 0.1, Pp, Pp + ' in')}${slider('wp-w', 'All-up weight', 100, 800, 10, auw * 1000, g2(auw))}</div>`,
    res:`<div class="stats">${stat('Loaded RPM', fmt(R.rpm, 0), 'KV × volts × 0.8', 'physics')}${stat('Prop power absorbed', fmt(R.propPower, 0) + ' W', `${fmt(wpk, 0)} W/kg (trainer 100–150)`, 'physics')}${stat('Battery current', fmt(I, 1) + ' A', 'at full throttle', 'estimate')}${stat('Static thrust', g2(R.thrust / G), `T/W ${fmt(R.thrust / (auw * G), 2)}`, 'estimate')}${stat('Pitch speed', SPD(R.pitchSpeed), `${fmt(pr, 1)} × cruise (aim 1.5–2)`, 'physics')}</div>` +
      (wpk < 90 ? verdict('warn', 'Underpowered: it will struggle to climb. Use a bigger prop, more KV or another cell.') : wpk > 320 ? verdict('warn', 'Very powerful: check that the motor, ESC and battery can handle the current.') : verdict('ok', 'A sensible power level for a trainer.')) +
      (pr < 1.3 ? verdict('warn', 'Pitch speed is low: it will run out of thrust as it speeds up. More pitch or RPM.') : pr > 2.6 ? verdict('warn', 'Pitch speed is very high: a lot of the prop\'s work is wasted at cruise. Less pitch, more diameter.') : '') });
});

// 1.8 battery
widget('w-battery', el => {
  const S = val('wb-s', 2), mAh = val('wb-c', 350), C = val('wb-cr', 25), I = val('wb-i', 4.5);
  [['wb-s', `${S}S`], ['wb-c', `${mAh} mAh`], ['wb-cr', `${C}C`], ['wb-i', `${fmt(I, 1)} A`]].forEach(([i, t]) => setOut(i, t));
  const Wh = S * 3.7 * mAh / 1000, Imax = mAh / 1000 * C, wt = Wh / SIZING.whPerGram + 2 * S, tmin = mAh / 1000 * 0.8 / I * 60;
  keepInputs(el, { controls:`<h4>Try it: size a LiPo</h4><div class="g-grid2 tight">${slider('wb-s', 'Cells', 1, 4, 1, S, S + 'S')}${slider('wb-c', 'Capacity', 150, 2200, 50, mAh, mAh + ' mAh')}${slider('wb-cr', 'C rating', 10, 75, 5, C, C + 'C')}${slider('wb-i', 'Current your motor draws', 0.5, 25, 0.5, I, fmt(I, 1) + ' A')}</div>`,
    res:`<div class="stats">${stat('Voltage', `${fmt(S * 3.7, 1)} V`, `${fmt(S * 4.2, 1)} V full · ${fmt(S * 3.3, 1)} V empty`)}${stat('Energy', `${fmt(Wh, 1)} Wh`)}${stat('Max safe current', `${fmt(Imax, 1)} A`, `${mAh} mAh × ${C}C`, 'physics', I > Imax ? 'is-warn' : '')}${stat('Pack weight', g2(wt / 1000), 'about 0.13 Wh/g + leads', 'estimate')}${stat('Flight time', `${fmt(tmin, 1)} min`, 'at this current, 80 % used', 'estimate')}</div>` +
      (I > Imax ? verdict('bad', 'The motor draws more than the pack can deliver: it will sag, puff and get damaged. Higher C rating or more capacity.') : I > 0.8 * Imax ? verdict('warn', 'Close to the pack\'s limit: buy a higher C rating for some margin.') : verdict('ok', 'The pack can deliver this current comfortably.')) });
});

// 1.10 balance: battery position on the example trainer
widget('w-balance', el => {
  const d0 = trainer0(), m = (W['w-balance'].model ||= SimModel.build(d0)), g = m.g, pts = m.points, bat = pts.find(p => p.tag === 'battery');
  const Lf = d0.geom.fuseLen, xb = val('wbl-x', bat.r[0] / Lf), mass = pts.reduce((a, p) => a + p.m, 0);
  const cgx = pts.reduce((a, p) => a + p.m * (p === bat ? xb * Lf : p.r[0]), 0) / mass, cgPct = (cgx - g.xMacLE) / g.mac * 100;
  const st = stabilityAnalysis(d0.geom, airframeGeometry(d0.geom, 0.18), { smTarget:0.1, cm0:Airfoil.get(d0.airfoilId).cm0 }), lo = st.cgFwd * 100, hi = st.cgAft * 100;
  setOut('wbl-x', `${L(xb * Lf)} from the nose`);
  const k = 290 / Lf, X = x => 15 + x * k, ink = css('--ink'), acc = css('--accent'), amber = css('--amber-line'), fill = css('--card-2'), cgc = css('--d-cg') || amber;
  const groups = {}; pts.forEach(p => { const t = p.tag; (groups[t] = groups[t] || { m:0, x:0 }); groups[t].m += p.m; groups[t].x += p.m * (p === bat ? xb * Lf : p.r[0]); });
  const dots = Object.entries(groups).map(([t, o]) => ({ t, m:o.m, x:o.x / o.m })).filter(o => o.m > 0.0015);
  const ok = cgPct >= lo && cgPct <= hi;
  keepInputs(el, { controls:`<h4>Try it: slide the battery</h4>${slider('wbl-x', 'Battery position', 0.04, 0.75, 0.005, xb, L(xb * Lf) + ' from the nose')}`,
    res:`<svg viewBox="0 0 320 120" class="g-fig" role="img" aria-label="Side view with parts; CG at ${fmt(cgPct, 0)} percent MAC">
      <rect x="${X(g.xMacLE + lo / 100 * g.mac)}" y="30" width="${(hi - lo) / 100 * g.mac * k}" height="60" fill="${acc}" opacity=".15"/>
      <line x1="${X(0)}" y1="60" x2="${X(Lf)}" y2="60" stroke="${ink}" stroke-width="3"/><rect x="${X(g.xwLE)}" y="40" width="${d0.geom.rootChord * k}" height="8" rx="3" fill="${fill}" stroke="${ink}"/>
      ${dots.map(o => `<circle cx="${X(o.x)}" cy="60" r="${Math.max(3, Math.sqrt(o.m * 1000) * 1.1)}" fill="${o.t === 'battery' ? amber : fill}" stroke="${ink}"/><text x="${X(o.x)}" y="${o.t === 'battery' ? 104 : 26}" text-anchor="middle" font-size="9.5" fill="${ink}">${o.t}</text>`).join('')}
      <path d="M${X(cgx)},70 l-7,14 h14z" fill="${ok ? acc : cgc}"/><text x="${X(cgx) + 10}" y="88" font-size="11" font-weight="700" fill="${ok ? acc : cgc}">CG ${fmt(cgPct, 0)} %</text></svg>
      <div class="stats">${stat('CG', `${fmt(cgPct, 1)} % MAC`, `safe ${fmt(lo, 0)}–${fmt(hi, 0)} %`, 'physics', ok ? '' : 'is-warn')}${stat('All-up weight', g2(mass))}</div>` +
      (ok ? verdict('ok', 'Inside the safe range. Mark the battery position so it goes back in the same place every flight.') : cgPct < lo ? verdict('warn', 'Nose-heavy: slide the battery back.') : verdict('bad', 'Tail-heavy: slide the battery forward (or add a little nose weight).')) });
});

// 1.11 motor mount on the example trainer
widget('w-mount', el => {
  const d0 = trainer0(), dn = val('wmt-d', 0), rt = val('wmt-r', 0);
  setOut('wmt-d', `${fmt(dn, 1)}°`); setOut('wmt-r', `${fmt(rt, 1)}°`);
  const run = () => { const d = JSON.parse(JSON.stringify(d0)); d.geom.thrustDown = dn; d.geom.thrustRight = rt; const m = SimModel.build(d); return SimPhysics.runTest(m, 'power'); };
  const r = run();
  keepInputs(el, { controls:`<h4>Try it: open the throttle on the example trainer</h4><p class="hint">The simulator trims it level at cruise, then opens full throttle with the sticks held still for 1.5 s.</p>${slider('wmt-d', 'Down-thrust', -4, 8, 0.5, dn, fmt(dn, 1) + '°')}${slider('wmt-r', 'Right-thrust', -4, 8, 0.5, rt, fmt(rt, 1) + '°')}`,
    res:`<div class="stats">${stat('Nose swing', `${fmt(Math.abs(r.yaw), 1)}° ${r.yaw < 0 ? 'left' : 'right'}`, 'in 1.5 s', 'physics', Math.abs(r.yaw) > 10 ? 'is-warn' : '')}${stat('Bank', `${fmt(Math.abs(r.bank), 1)}° ${r.bank < 0 ? 'left' : 'right'}`, '', 'physics')}${stat('Pitch change', `${r.pitch >= 0 ? '+' : '−'}${fmt(Math.abs(r.pitch), 1)}°`, 'some climb is normal', 'physics')}</div>` +
      (Math.abs(r.yaw) < 5 ? verdict('ok', 'Calm: the plane climbs nearly straight when you open the throttle.') : verdict('warn', `It swings ${r.yaw < 0 ? 'left' : 'right'}: ${r.yaw < 0 ? 'add right-thrust' : 'reduce right-thrust'}. The example uses ${SimModel.describeThrust(d0.geom.thrustDown, d0.geom.thrustRight, false)}.`)) });
});

/* ======================= worked examples ======================= */
const PROG_KEY = 'rcGuide.v1', prog = RC.store.get(PROG_KEY, {}) || {};
const EX = {
  trainer:{ title:'Depron trainer', builtin:'trainer', lesson:'takeoff', ranges:{ span_m:[0.9, 1.5, 0.05], flightMin:[5, 12, 1], payload_kg:[0, 0.06, 0.005] } },
  wing:{ title:'Depron flying wing', builtin:'wing', lesson:'handlaunch', ranges:{ span_m:[0.7, 1.2, 0.05], flightMin:[5, 12, 1], payload_kg:[0, 0.05, 0.005] } },
};
function analyse(key, req){
  const base = SimModel.BUILTINS[EX[key].builtin], custom = Object.keys(req).some(k => req[k] !== base.req[k]);
  const d = SimModel.builtinDesign(EX[key].builtin, { req }); d.name = `Guide ${EX[key].title}${custom ? ' (custom)' : ''}`;
  const af = Airfoil.get(d.airfoilId), sz = sizeAircraft(Object.assign({ clmax:af.clmax }, d.req)), motor = MOTOR_DB.find(m => m.id === (d.power && d.power.motorId));
  const prop = d.power ? d.power.prop : { d:7, p:3.5 }, g = airframeGeometry(d.geom, prop.d * 0.0254), W = d.auw * G;
  const op = motor ? motorOperatingPoint({ motor, cells:d.power.cells, capacity_mAh:d.capacity_mAh, prop }) : null;
  const ms = MISSIONS[d.req.mission], vc = sz.vc, CLc = W / (0.5 * RHO_SL * vc * vc * g.S), st = stabilityAnalysis(d.geom, g, { smTarget:0.1, cm0:af.cm0, CLcruise:CLc });
  const ll = liftingLine({ b:d.geom.span, cr:d.geom.rootChord, ct:d.geom.tipChord, washoutDeg:d.geom.washout || 0, a0:2 * Math.PI * 0.9, alpha0Deg:af.alpha0Deg, CL:CLc, clmax2D:af.clmax });
  const pf = flightPerformance({ W, S:g.S, AR:g.AR, mac:g.mac, rho:RHO_SL, e:Math.min(0.95, ll.e) * 0.93, cd0Airfoil:af.cd0, Sh:g.Sh, Sv:g.Sv, frontalArea:g.wf * g.hf, body:g.body, gear:false,
    CLmax:ll.CLmax3D || af.clmax * 0.9, T0:op ? op.thrust : 1, pitchSpeed:op ? op.pitchSpeed : 12, Vcruise:vc, batteryWh:d.cells * V_NOMINAL * d.capacity_mAh / 1000, etaProp:0.6, etaMotor:op ? op.eta : 0.75 });
  const controls = g.tailless ? 'elevon' : 'aer1', surf = CONTROLS[controls].surf;
  const parts = Templates.generateParts(d.geom, af, { method:'foam', foamStyle:'kfm', ribSpacing:0.05, spar:{ w:3, h:3 }, le:5, te:10, sheetT:6, unit:'mm', surf, propD_m:prop.d * 0.0254 });
  const tst = Templates.stats(parts, MATERIALS.depron), paper = Templates.PAPERS.a4, lay = Templates.layout(parts, paper), pages = Templates.paginate(lay, paper);
  const I = sz.P / (d.cells * 3.5), bomSz = { auw:d.auw, controls, P:sz.P, cells:d.cells, escA:ESC_SIZES.find(a => a >= Math.ceil(1.5 * I - 1e-9)) || Math.ceil(1.5 * I), capacity_mAh:d.capacity_mAh, recC:Math.ceil(1.5 * I / (d.capacity_mAh / 1000)), material:'depron', b:d.geom.span, extraServos:0 };
  const bom = buildBOM(bomSz, motor ? { motor, cells:d.cells, prop, op } : null, { count:tst.sheets }, {});
  return { key, d, af, sz, motor, prop, op, g, st, ll, pf, CLc, controls, parts, tst, lay, pages, bom, custom, shims:Templates.mountShims(d.geom), wing:!!g.tailless };
}
const reqOf = key => { const s = (prog[key] && prog[key].req) || {}; return Object.assign({}, SimModel.BUILTINS[EX[key].builtin].req, s); };
function renderExample(key){
  const host = document.getElementById(`ex-${key}-body`), req = reqOf(key), A = analyse(key, req), d = A.d, g = A.g, st = A.st, wing = A.wing, R = EX[key].ranges;
  const done = (prog[key] && prog[key].done) || {}, steps = exampleSteps(A), nDone = steps.filter(s => done[s.id]).length;
  const scen = { v:1, title:d.name, plane:A.custom ? 'design' : 'builtin:' + EX[key].builtin, design:A.custom ? d : undefined, start:wing ? 'hand' : 'runway', assist:'angle', instructor:'auto', lesson:EX[key].lesson };
  const links = `<a class="btn sm" href="designer.html#design=${enc(d)}">${RC.icon('magic')}Open in Designer</a><a class="btn sm" href="build.html#design=${enc(d)}">${RC.icon('scissors')}Build templates</a><a class="btn sm primary" href="simulator.html#scenario=${enc(scen)}">${RC.icon('play')}Fly it in the simulator</a>`;
  host.innerHTML = `<div class="panel g-exhead">
      <div class="g-grid2"><div><h3 style="margin-top:0">Requirements <span class="tag tag-estimate">Try your own</span></h3>
        ${slider(`ex-${key}-span`, 'Wingspan', ...R.span_m, req.span_m, L(req.span_m))}${slider(`ex-${key}-flt`, 'Flight time target', ...R.flightMin, req.flightMin, req.flightMin + ' min')}${slider(`ex-${key}-pay`, 'Payload (camera etc.)', ...R.payload_kg, req.payload_kg || 0, req.payload_kg ? g2(req.payload_kg) : 'none')}
        <div class="actions" style="margin-top:0"><button type="button" class="btn sm" data-ex-reset="${key}">Back to the standard example</button></div></div>
        <div><div class="g-diagram">${cleanSVG(buildAirframeSVG(d.geom, { propD_m:A.prop.d * 0.0254, colors:diagramColors(), unit:UN().length, surf:CONTROLS[A.controls].surf, flaps:false }))}</div></div></div>
      <div class="g-progress" aria-label="Build progress"><div><b>${nDone}</b> of ${steps.length} steps done</div><span><i style="width:${(nDone / steps.length * 100).toFixed(0)}%"></i></span></div>
      <div class="actions">${links}</div></div>
    ${steps.map((s, i) => `<article class="g-step${done[s.id] ? ' done' : ''}" id="${key}-${s.id}"><header><span class="step-num">${i + 1}</span><h3>${s.title}</h3><label class="check g-done"><input type="checkbox" data-step="${key}:${s.id}"${done[s.id] ? ' checked' : ''}> Done</label></header>
      <div class="g-grid2"><div>${s.decide}</div><div>${s.concepts.map(c => `<div class="concept"><b>Concept: ${c[0]}.</b> ${c[1]}</div>`).join('')}</div></div>
      ${s.doit ? `<div class="practical"><b>Do it:</b><ol>${s.doit.map(t => `<li>${t}</li>`).join('')}</ol></div>` : ''}${s.extra || ''}</article>`).join('')}`;
}
function exampleSteps(A){
  const { d, g, st, sz, af, op, motor, prop, ll, pf, wing, bom, parts } = A, geo = d.geom, mpct = v => `${fmt(v * 100, 1)} % MAC`;
  const brk = (d.sizing && d.sizing.breakdown) || sz.breakdown, tot = brk.reduce((a, b) => a + b.g, 0);
  const shim = A.shims, mountTxt = SimModel.describeThrust(geo.thrustDown || 0, geo.thrustRight || 0, wing);
  const servoN = CONTROLS[A.controls].servos, ch = CONTROLS[A.controls].channels;
  return [
    { id:'req', title:'Requirements and a first weight estimate',
      decide:`<p>We want a ${wing ? 'fast-building, tough flying wing that launches by hand and has no tail to break' : 'calm, slow plane to learn on, that takes off from grass and forgives mistakes'}, ${L(geo.span)} span, about ${d.req.flightMin} minutes of flying, built from <b>6 mm Depron</b>.</p>
        <p>The Designer's sizing loop guessed the weight, sized the wing and power system for it, re-weighed, and settled after <b>${sz.iterations}</b> rounds:</p>
        <div class="stats">${stat('All-up weight', g2(d.auw), 'airframe + electronics', 'estimate')}${stat('Wing area', AREA(g.S))}${stat('Wing loading', WL(d.auw * 1000 / (g.S * 100)), wing ? 'sporty for a wing' : 'gentle trainer', 'physics')}${stat('Stall speed', SPD(sz.vs), 'landing ≈ 1.25 ×', 'physics')}${stat('Cruise speed', SPD(sz.vc), `${fmt(sz.vc / sz.vs, 1)} × stall`, 'rule')}</div>`,
      concepts:[['mission', wing ? 'a flying wing has no tail, so it is quick to build, hard to break and great for FPV, but it is less forgiving than a trainer: smaller CG range and no rudder.' : 'a trainer flies slowly with a lot of stability. A high wing, dihedral, a long tail and a low wing loading all make it calm and self-correcting.'],
        ['wing loading', `${WL(d.auw * 1000 / (g.S * 100))} means the wing carries that much weight on each unit of area. Below about 25 g/dm² a plane floats in slowly; this decides the stall and landing speed more than anything else.`]],
      doit:['Decide what the plane is for, how big it may be and how long you want to fly. Put those into the Designer step 1 (it is pre-filled with this example).', 'Weigh any parts you already own and use their real weights.'] },
    { id:'airfoil', title:'Material and airfoil',
      decide:`<p>Airfoil: <b>${esc(af.name)}</b> (CLmax ${fmt(af.clmax, 2)}, ${fmt(af.t * 100, 0)} % thick). On Depron we build it as a <b>KFm-2 step</b>: a full-size bottom sheet with a second layer over the front ${wing ? '40' : '50'} %, sanded round at the leading edge.</p>
        <svg viewBox="0 0 320 70" class="g-fig" role="img" aria-label="${esc(af.name)} airfoil"><path d="${airfoilPath(af, 280, 0, 20, 45)}" fill="${css('--card-2')}" stroke="${css('--ink')}" stroke-width="1.5"/></svg>
        <div class="stats">${stat('Zero-lift angle', `${fmt(af.alpha0Deg, 1)}°`, '', 'physics')}${stat('Cm about c/4', fmt(af.cm0, 3), wing ? 'near zero or positive: stable alone' : 'nose-down: balanced by the tail', 'physics')}${stat('Material sheets', A.tst.sheets, 'Depron 1000×500, incl. waste', 'rule')}</div>`,
      concepts:wing ? [['reflex', 'a normal cambered airfoil always pitches nose-down, which a tail would fix. A wing has no tail, so its airfoil must not pitch down: the trailing edge is turned up (reflex). On a flat Depron wing we get the same effect by trimming both elevons 2–3 mm up.'], ['KFm step', 'the step creates a vortex that acts like a thicker, rounded airfoil. It is crude, but it gives decent lift and a gentle stall with almost no work.']] :
        [['camber', 'the Clark Y\'s curved top and flat bottom give strong lift at low speed and a soft, predictable stall, which is exactly what a trainer needs. Its nose-down pitching moment (Cm) is balanced by the tailplane.'], ['KFm step', 'the step creates a vortex that acts like a thicker, rounded airfoil: decent lift and a gentle stall from two flat sheets.']],
      doit:['Buy Depron 6 mm sheets (and 3 mm for the tail if you like it lighter), foam-safe CA with activator, a 3×3 mm carbon or bamboo spar, packing tape and hot glue.', 'Keep the sheets flat; store them under a board so they do not warp.'] },
    { id:'wing', title:wing ? 'Wing size, sweep and twist' : 'Wing size and shape',
      decide:`<div class="stats">${stat('Wingspan', L(geo.span))}${stat('Root chord', L(geo.rootChord))}${stat('Tip chord', L(geo.tipChord), `taper ${fmt(geo.tipChord / geo.rootChord, 2)}`)}${stat('Aspect ratio', fmt(g.AR, 1))}${stat('MAC', L(g.mac))}${wing ? stat('LE sweep', `${fmt(geo.sweep, 0)}°`) + stat('Washout', `${fmt(geo.washout, 1)}°`) : stat('Dihedral', `${fmt(geo.dihedral, 1)}°`, 'each side')}${stat('Span efficiency e', fmt(ll.e, 2), '', 'physics')}${stat('Cruise CL', fmt(A.CLc, 2), 'comfortable 0.3–0.6', 'physics')}</div>`,
      concepts:wing ? [['sweep and washout', `on a flying wing the swept tips sit far behind the CG and act like a tailplane. Twisting them nose-down (${fmt(geo.washout, 1)}° washout) makes them carry a little down-load, which keeps the wing stable in pitch and makes the root stall first.`], ['aspect ratio', `${fmt(g.AR, 1)} is low: a stiff, strong wing that rolls quickly. Gliding is not its strength.`]] :
        [['aspect ratio', `${fmt(g.AR, 1)} is a good all-round value: efficient enough to glide well, short enough to be stiff in Depron.`], ['dihedral', `${fmt(geo.dihedral, 1)}° each side makes the plane roll back level on its own after a gust, and lets it turn with rudder alone if you prefer.`], ['cruise CL', `${fmt(A.CLc, 2)} means the wing is working well below its maximum at cruise, so there is plenty of margin before the stall.`]],
      doit:wing ? ['Cut the two wing halves from the template (step 10), including the elevon cut lines.', 'Glue the step layer on the front 40 %, sand the leading edge round.', 'Glue a carbon spar along the 25 % line, then join the halves flat (no dihedral) with foam-safe CA and tape underneath.', 'Twist in the washout while the glue sets: prop each tip trailing edge up by about ' + L(Math.tan(geo.washout * Math.PI / 180) * geo.tipChord) + '.'] :
        ['Cut the wing panels and step layers from the template.', 'Glue the step layer flush with the leading edge, sand the LE round, taper the trailing edge.', `Glue the spar on its line, then join the halves at ${fmt(geo.dihedral, 1)}° per side: lift each tip by ${L(Math.tan(geo.dihedral * Math.PI / 180) * geo.span / 2)} while the centre joint cures.`, 'Reinforce the centre joint with packing tape top and bottom.'] },
    wing ? { id:'fins', title:'Winglets and the "tail" that is not there',
      decide:`<div class="stats">${stat('Winglet height', L(geo.vHeight))}${stat('Winglet chord', L(geo.vChord))}${stat('Tail volume Vv', fmt(g.Vv, 3), 'typical 0.02–0.05', 'physics')}${stat('Spiral index B', st.blaine != null ? fmt(st.blaine, 1) : '—', 'rule of thumb', 'rule')}</div>`,
      concepts:[['directional stability', 'with no fuselage tail, two winglets at the swept tips keep the wing pointing into the airflow. Their lever arm is the sweep: the further back the tips, the smaller the winglets can be.'], ['no rudder', 'a flying wing turns with roll only (elevons). That is why it needs no rudder servo and only 3 channels.']],
      doit:['Cut two winglets from 3 mm Depron.', 'Glue them square to the tips (check from the front), with the straight edge at the trailing edge.'] } :
    { id:'tail', title:'Tail and fuselage',
      decide:`<div class="stats">${stat('H-tail span', L(geo.hSpan))}${stat('H-tail chord', L(geo.hChord))}${stat('Fin height', L(geo.vHeight))}${stat('Tail arm', L(g.lh))}${stat('Fuselage length', L(geo.fuseLen))}${stat('Tail volume Vh', fmt(g.Vh, 2), 'typical 0.35–0.6', 'physics')}${stat('Tail volume Vv', fmt(g.Vv, 3), 'typical 0.02–0.05', 'physics')}</div>`,
      concepts:[['tail volume', `the tail's power is its area × its lever arm. Vh = ${fmt(g.Vh, 2)} gives the trainer firm pitch stability and a generous CG range; Vv = ${fmt(g.Vv, 3)} keeps it pointing straight without making it spiral.`], ['tail arm', `a long fuselage (${L(geo.fuseLen)}) lets a small, light tail do the job and damps pitch wobbles, so the plane feels calm.`]],
      doit:['Cut the stabiliser, elevator, fin and rudder from 3 mm Depron. Bevel the hinge lines at 45° and hinge with tape on both sides.', 'Build the fuselage box: two sides, top and bottom, and the formers F1–F3. Check it is square and straight before the glue sets.', 'Glue the stabiliser exactly square to the wing (check from behind and from above), then the fin vertical.'] },
    { id:'cg', title:'Balance point and stability',
      decide:`<div class="stats">${stat(wing ? 'Neutral point (tailless)' : 'Neutral point', mpct(st.xnp), `${L(st.fromRootLE(st.xnp))} behind root LE`, 'estimate')}${stat('Recommended CG', mpct(st.cgRec), `<b>${L(st.fromRootLE(st.cgRec))}</b> behind root LE`, 'estimate')}${stat('Safe CG range', `${fmt(st.cgFwd * 100, 0)}–${fmt(st.cgAft * 100, 0)} %`, `${L(st.fromRootLE(st.cgFwd))} – ${L(st.fromRootLE(st.cgAft))}`, 'estimate')}${stat('Static margin', `${fmt((st.xnp - st.cgRec) * 100, 0)} %`, 'aim 5–15 %', 'estimate')}</div>`,
      concepts:wing ? [['CG far forward', `on a flying wing the neutral point is close to the front (${mpct(st.xnp)}), so the CG must be too: about ${L(st.fromRootLE(st.cgRec))} behind the root leading edge. A wing that is tail-heavy by even 1 cm is unflyable, so check it twice.`], ['glide test', 'throw it gently level over grass, motor off: it should glide straight and land flat. Diving: trim the elevons up a little. Stalling and diving: move the CG forward.']] :
        [['static margin', `with the CG at ${mpct(st.cgRec)} it sits ${fmt((st.xnp - st.cgRec) * 100, 0)} % of the MAC ahead of the neutral point: stable and calm, with room to move the battery.`], ['measuring', 'percentages of the MAC are for the maths; for balancing, use the distance behind the wing root leading edge.']],
      doit:[`Mark the CG <b>${L(st.fromRootLE(st.cgRec))}</b> behind the root leading edge on both sides of the ${wing ? 'wing' : 'fuselage under the wing'}.`, 'With everything installed, balance on your fingertips at the marks. Move the battery until it hangs level or slightly nose-down.'] },
    { id:'power', title:'Power system: motor, prop, ESC and battery',
      decide:`<p>Target power: <b>${fmt(sz.P, 0)} W</b> (${MISSIONS[d.req.mission].wpk || STYLES[MISSIONS[d.req.mission].style].wPerKg} W/kg × ${g2(d.auw)}). The motor matcher chose:</p>
        <div class="stats">${stat('Motor', esc(motor ? motor.name : 'generic'), motor ? `${motor.kv} KV · ${motor.mass} g` : '')}${stat('Prop', `${prop.d}×${prop.p}`, wing ? 'pusher prop on a rear mount' : 'standard tractor prop')}${stat('Battery', `${d.cells}S ${d.capacity_mAh} mAh`, `≥ ${sz.recC}C`)}${stat('ESC', `${A.bom.rows.find(r => r.cat === 'ESC') ? esc(A.bom.rows.find(r => r.cat === 'ESC').name) : sz.escA + ' A'}`)}
          ${op ? stat('Full-throttle current', `${fmt(op.I, 1)} A`, '', 'physics') + stat('Static thrust', g2(op.thrust / G), `T/W ${fmt(op.thrust / (d.auw * G), 2)}`, 'physics') + stat('Pitch speed', SPD(op.pitchSpeed), `${fmt(op.pitchSpeed / sz.vc, 1)} × cruise`, 'physics') : ''}${stat('Top speed', SPD(pf.vmax), '', 'estimate')}${stat('Max climb rate', SPD(pf.rocMax), '', 'estimate')}</div>`,
      concepts:[['matching', `the motor's KV, the prop and the battery voltage have to agree: ${motor ? motor.kv : ''} KV × ${d.cells * 3.7} V spins the ${prop.d}×${prop.p} to a pitch speed of about ${fmt(op ? op.pitchSpeed / sz.vc : 2, 1)} × cruise${op && op.pitchSpeed / sz.vc > 2.1 ? ' (a little above the 1.5–2 × guideline: lively, and handy in wind; fly at part throttle)' : op && op.pitchSpeed / sz.vc < 1.4 ? ' (on the low side: a prop with more pitch would help top speed)' : ''}, while drawing a current the ${d.capacity_mAh} mAh pack can deliver.`], [wing ? 'pusher prop' : 'thrust-to-weight', wing ? 'a pusher needs a "pusher" prop (marked P) or a normal prop flipped with the motor reversed, so the air is still thrown backwards. Swap two motor wires if it blows forwards.' : `${fmt(op ? op.thrust / (d.auw * G) : 0.8, 2)} is plenty for a trainer: it can climb steadily from grass without being twitchy on the throttle.`]],
      doit:['Solder (or plug) the motor to the ESC, the ESC to the battery connector, and check the motor direction with the prop OFF.', 'Fit the prop with the numbers facing forward (towards where the plane flies), tighten the nut, and do a restrained bench test with a watt meter.'] },
    { id:'radio', title:'Radio, servos and control throws',
      decide:`<div class="stats">${stat('Controls', esc(CONTROLS[A.controls].label))}${stat('Servos', `${servoN} × micro (4–5 g)`)}${stat('Receiver channels', `${ch}+`)}${stat('Aileron throw', `±${d.geom.surfaces ? d.geom.surfaces.throwAil || (wing ? 16 : 14) : (wing ? 16 : 14)}°`, 'start on low rates')}${stat('Elevator throw', `±${wing ? 12 : 14}°`)}</div>`,
      concepts:wing ? [['elevon mixing', 'in the transmitter, enable the elevon (delta) mix: elevator stick moves both elevons together, aileron stick moves them opposite. Check: stick back → both up; stick right → right elevon up, left down.'], ['expo', '30–40 % expo on elevons makes the wing much easier to fly smoothly, because wings are sensitive in pitch.']] :
        [['one aileron servo', 'a single servo in the wing centre drives both ailerons through torque rods: lighter and simpler than two servos.'], ['throws', 'start with about ±12–15°, measure them with a ruler at the trailing edge, and add 25–30 % expo.']],
      doit:['Bind the receiver to the transmitter and create a new model memory.', wing ? 'Set up the elevon mix, centre the servos with the radio on, then fit the horns and pushrods with the elevons neutral (or 2–3 mm up for reflex).' : 'Centre the servos with the radio on, then fit the horns and pushrods with the surfaces neutral.', 'Set the failsafe to throttle off.'] },
    { id:'weight', title:'Weight breakdown',
      decide:`<div class="table-scroll"><table class="data"><thead><tr><th scope="col">Item</th><th scope="col">Weight</th><th scope="col">Share</th></tr></thead><tbody>${brk.filter(b => b.g > 0.05).map(b => `<tr><th scope="row">${esc(b.label)}</th><td class="num">${g2(b.g / 1000)}</td><td class="num">${fmt(b.g / tot * 100, 0)} %</td></tr>`).join('')}<tr><th scope="row">Total</th><td class="num"><b>${g2(tot / 1000)}</b></td><td></td></tr></tbody></table></div>`,
      concepts:[['where the grams go', `the airframe is ${fmt(brk.find(b => b.key === 'airframe').g / tot * 100, 0)} % of the weight. Hot glue is heavy: use foam-safe CA for long joints and keep hot glue for the firewall and servos.`], ['payload', 'every extra gram raises the stall speed. If you add an FPV camera, enter it as payload so the wing and power system are resized.']],
      doit:['Weigh the finished plane ready to fly and enter the weight in the Designer (step 3, "As built") so every number uses reality.'] },
    { id:'mount', title:'Motor mount angles',
      decide:`<p>Suggested mount: <b>${esc(mountTxt)}</b>.</p>${shim.any ? `<div class="table-scroll"><table class="data"><thead><tr><th scope="col">Hole spacing</th>${Math.abs(shim.dn) >= 0.25 ? `<th scope="col">${shim.dn > 0 ? 'Down' : 'Up'}-thrust spacer (${shim.pitchSide})</th>` : ''}${Math.abs(shim.rt) >= 0.25 ? `<th scope="col">${shim.rt > 0 ? 'Right' : 'Left'}-thrust spacer (${shim.yawSide})</th>` : ''}</tr></thead><tbody>${shim.rows.map(r => `<tr><th scope="row">${r.spacing} mm</th>${Math.abs(shim.dn) >= 0.25 ? `<td class="num">${fmt(r.pitch, 1)} mm</td>` : ''}${Math.abs(shim.rt) >= 0.25 ? `<td class="num">${fmt(r.yaw, 1)} mm</td>` : ''}</tr>`).join('')}</tbody></table></div>` : ''}`,
      concepts:[[wing ? 'pusher mount' : 'down- and right-thrust', wing ? 'on a pusher the motor faces backwards, so the corrections are mirrored: the suggestion moves the prop end down and to the right, with spacers at the top and left of the mount (seen from behind).' : `the thrust line here sits below the balance point and the prop wash hits the tail, so full power would pitch the nose up and swing it left. ${mountTxt} cancels most of it; chapter 1.11 lets you feel the difference.`]],
      doit:['Put the spacers (washers) behind the mount screws on the sides shown, or glue the printed wedge behind the mount.', 'Check by eye from above and from the side before gluing the firewall in.'] },
    { id:'templates', title:'Print the templates and cut the parts',
      decide:`<p><b>${parts.length}</b> templates on <b>${A.pages.length}</b> A4 pages, about <b>${A.tst.sheets}</b> Depron sheets.</p><div class="g-sheet">${cleanSVG(Templates.renderSheetSVG(A.lay, { pages:A.pages, title:d.name }))}</div>`,
      concepts:[['1:1 templates', 'the templates are full size. Print at 100 % (no "fit to page"), check the 50 mm scale square, then tape the pages together on the red crosses.']],
      doit:['Open the Build page with this example, print, and check the scale square.', 'Pin or spray-mount the templates to the Depron and cut with a fresh blade in several light passes, using a steel ruler for straight lines.'] },
    { id:'build', title:'Building it',
      decide:'', concepts:[['foam-friendly joints', 'bevel edges that meet at an angle, use foam-safe CA with activator for instant joints, and reinforce load paths (wing joint, motor mount, landing skid) with packing tape or a strip of carbon.']],
      doit:wing ? ['Wing halves: step layer, spar, join, twist in the washout (step 3).', 'Cut the elevons free, bevel 45° and hinge them with tape on top and bottom.', 'Cut the motor-mount slot at the trailing edge, glue in the ply mount with the suggested angles, and hot-glue the servos into pockets.', 'Glue the winglets, install the receiver, ESC and battery bay (velcro), and run the pushrods.', 'Cover the leading edge with packing tape against dents; balance; glide test.'] :
        ['Wing: step layer, spar, dihedral joint, aileron hinges, centre torque rods and servo pocket.', 'Fuselage box with formers, ply firewall with the mount angles, battery hatch and landing gear (or a skid for grass).', 'Tail: stabiliser square to the wing, fin vertical, hinges taped.', 'Install the motor, ESC, receiver and servos; make the pushrods; centre everything with the radio on.', 'Strap the wing on with rubber bands (they let it pop off in a crash instead of breaking).'] },
    { id:'fly', title:'Checks and the first flight',
      decide:`<p>Practise this exact plane in the simulator first: the link below loads it with the <b>${wing ? 'hand launch' : 'take-off'}</b> lesson, beginner assist and the instructor ready to take over.</p>`,
      concepts:[[wing ? 'launching a wing' : 'taking off', wing ? 'hold it under the CG, full power, and throw it firmly level into the wind (or slightly nose-up). Do not pull hard until it has flying speed: wings stall easily straight after a launch.' : 'point it into the wind, open the throttle smoothly, steer with the rudder to keep straight, and let it lift off by itself with a touch of up-elevator.'],
        ['trimming', 'once it is two mistakes high, use the trim buttons until it flies straight and level with the sticks centred. Then land early with battery to spare and copy the trims to the linkages.']],
      doit:['Control check, failsafe check, range check, CG check (chapter 1.12).', wing ? 'Glide test over long grass, then the first powered launch into a light wind.' : 'First take-off into a light wind; fly big gentle circuits; land into the wind.'] },
  ];
}
function bindExamples(){
  document.addEventListener('input', e => {
    const m = /^ex-(trainer|wing)-(span|flt|pay)$/.exec(e.target.id); if (m) { const key = m[1], k = { span:'span_m', flt:'flightMin', pay:'payload_kg' }[m[2]];
      prog[key] = prog[key] || {}; prog[key].req = Object.assign({}, prog[key].req, { [k]:+e.target.value }); const fmtv = { span_m:v => L(v), flightMin:v => v + ' min', payload_kg:v => v ? g2(v) : 'none' }[k]; setOut(e.target.id, fmtv(+e.target.value));
      clearTimeout(bindExamples.t); bindExamples.t = setTimeout(() => { RC.store.set(PROG_KEY, prog); const y = window.scrollY; renderExample(key); window.scrollTo(0, y); const s = document.getElementById(e.target.id); if (s) s.focus(); }, 250); }
    const st = e.target.dataset && e.target.dataset.step; if (st) { const [key, id] = st.split(':'); prog[key] = prog[key] || {}; prog[key].done = Object.assign({}, prog[key].done, { [id]:e.target.checked }); RC.store.set(PROG_KEY, prog);
      const y = window.scrollY; renderExample(key); window.scrollTo(0, y); }
  });
  document.addEventListener('click', e => { const b = e.target.closest('[data-ex-reset]'); if (!b) return; const key = b.dataset.exReset; if (prog[key]) delete prog[key].req; RC.store.set(PROG_KEY, prog); renderExample(key); RC.toast('Back to the standard example'); });
}

/* ======================= glossary ======================= */
function renderGlossary(){
  const all = (window.RCInfo && RCInfo.list ? RCInfo.list() : []).sort((a, b) => a.title.localeCompare(b.title)), q = ($('#gl-q').value || '').toLowerCase().trim();
  const hit = all.filter(e => !q || (e.title + ' ' + e.text + ' ' + e.keys.join(' ')).toLowerCase().includes(q)), groups = {};
  hit.forEach(e => { const L0 = e.title[0].toUpperCase(); (groups[L0] = groups[L0] || []).push(e); });
  $('#gl-count').textContent = `${hit.length} of ${all.length} terms`;
  $('#gl-list').innerHTML = Object.entries(groups).map(([l, es]) => `<div class="g-gletter"><h3>${esc(l)}</h3>${es.map(e => `<div class="g-term"><b>${esc(e.title)}</b><p>${esc(e.text)}</p>${e.typical ? `<small>${esc(e.typical)}</small>` : ''}</div>`).join('')}</div>`).join('') || '<p class="hint">No term matches.</p>';
}

/* ======================= init ======================= */
function renderAll(){ const lp = document.getElementById('w-loop'); if (lp) { delete lp.dataset.done; lp.innerHTML = ''; } Object.values(W).forEach(w => w.render(w.el)); renderExample('trainer'); renderExample('wing'); }
function init(){
  RC.initChrome(); renderTOC(); bindExamples(); renderExample('trainer'); renderExample('wing'); renderGlossary();
  $('#gl-q').addEventListener('input', renderGlossary);
  $$('input[name=unitSystem]').forEach(r => { r.checked = r.value === sys; r.addEventListener('change', () => { sys = r.value; RC.setUnitSystem(sys); renderAll(); }); });
  RC.onThemeChange(() => renderAll());
  RC.navHighlight('.subnav a');
}
init();
window.RCGuide = { analyse, exampleSteps, W, renderExample };
})();
