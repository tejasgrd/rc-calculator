/* RC Calc build templates: 1:1 parts (mm) for foam (KFm / folded) or balsa (ribs), shelf layout, page tiling.
   Pure string/geometry code, no DOM. Depends on rc-core.js and rc-aero.js. */
'use strict';
const Templates = (() => {
  const PAPERS = {
    a5:     { id:'a5',     label:'A5 (148 × 210 mm)',      w:148,   h:210,   margin:8, cal:{ size:50, label:'50 mm' } },
    letter: { id:'letter', label:'US Letter (8.5 × 11 in)', w:215.9, h:279.4, margin:8, cal:{ size:50.8, label:'2 in' } },
    a4:     { id:'a4',     label:'A4 (210 × 297 mm)',      w:210,   h:297,   margin:8, cal:{ size:50, label:'50 mm' } },
  };
  const OVERLAP = 10, GAP = 7;
  const LINE = {
    cut:   { w:0.45, dash:'',          label:'Cut' },
    fold:  { w:0.35, dash:'6 2',       label:'Fold (score one side)' },
    score: { w:0.3,  dash:'4 1.5 1 1.5', label:'Score / bend' },
    hinge: { w:0.35, dash:'2 1.2',     label:'Hinge line (bevel)' },
    spar:  { w:0.3,  dash:'0.6 1.2',   label:'Spar position' },
    ref:   { w:0.2,  dash:'3 3',       label:'Reference / alignment' },
  };
  const r2 = n => Math.round(n * 100) / 100;

  function normalize(part){
    const xs = [], ys = [];
    part.paths.forEach(p => p.pts.forEach(([x, y]) => { xs.push(x); ys.push(y); }));
    const x0 = Math.min(...xs), y0 = Math.min(...ys), pad = 2;
    part.paths.forEach(p => { p.pts = p.pts.map(([x, y]) => [x - x0 + pad, y - y0 + pad]); });
    (part.labels || []).forEach(l => { l.x = l.x - x0 + pad; l.y = l.y - y0 + pad; });
    part.w = Math.max(...xs) - x0 + 2 * pad; part.h = Math.max(...ys) - y0 + 2 * pad;
    return part;
  }
  const P = (name, qty, material, paths, labels, note) => normalize({ name, qty, material, paths, labels:labels || [], note:note || '' });
  const path = (kind, pts, closed = false) => ({ kind, pts, closed });
  const rect = (x, y, w, h, kind = 'cut') => path(kind, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true);

  function fuseProfiles(d, g){
    const Lf = d.fuseLen * 1000, hf = g.hf * 1000, wf = g.wf * 1000;
    const side = g.body === 'stick' ? [[0, hf / 2], [Lf, hf / 2], [Lf, -hf / 2], [0, -hf / 2]]
      : g.body === 'pod' ? Array.from({ length:25 }, (_, k) => { const t = k / 24; return [t * Lf, hf / 2 * Math.pow(Math.sin(Math.PI * Math.min(t * 1.15, 1)), 0.6)]; }).concat(Array.from({ length:25 }, (_, k) => { const t = 1 - k / 24; return [t * Lf, -0.8 * hf / 2 * Math.pow(Math.sin(Math.PI * Math.min(t * 1.15, 1)), 0.6)]; }))
      : [[0, .25 * hf], [.12 * Lf, .5 * hf], [.5 * Lf, .45 * hf], [Lf, .2 * hf], [Lf, .02 * hf], [.55 * Lf, -.38 * hf], [.15 * Lf, -.5 * hf], [0, -.3 * hf]];
    const halfW = g.body === 'fuse' ? [[0, .28], [.12, .5], [.42, .5], [1, .16]].map(([t, w]) => [t * Lf, w * wf]) : [[0, wf / 2], [Lf, wf / 2]];
    const lin = (pts, x) => { for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const a = pts[i - 1], b = pts[i], t = (x - a[0]) / ((b[0] - a[0]) || 1); return a[1] + t * (b[1] - a[1]); } return pts[pts.length - 1][1]; };
    const nTop = g.body === 'pod' ? 25 : g.body === 'stick' ? 2 : 4, topLine = side.slice(0, nTop), botLine = side.slice(nTop).reverse();
    return { side, halfW, Lf, hf, wf, top:x => lin(topLine, x), bot:x => lin(botLine, x), width:x => 2 * lin(halfW, x) };
  }

  /**
   * generateParts(d, airfoil, o)
   * o: { method:'foam'|'balsa', foamStyle:'kfm'|'folded', ribSpacing(m), spar:{w,h}(mm), le, te (mm), sheetT (mm), surf:'none'|'ailerons'|'elevons', unit }
   */
  function generateParts(d, airfoil, o){
    const g = airframeGeometry(d, o.propD_m || 0.2), parts = [];
    const s = d.span / 2 * 1000, cr = d.rootChord * 1000, ct = d.tipChord * 1000, tan = Math.tan(d.sweep * Math.PI / 180);
    const xLE = y => y * tan, c = y => cr + (ct - cr) * y / s, xTE = y => xLE(y) + c(y);
    const L = mm => o.unit === 'in' ? `${fmt(mm / 25.4, 2)} in` : `${fmt(mm, 0)} mm`;
    const surf = g.tailless ? 'elevons' : (o.surf || 'ailerons');
    const SP = surfaceSpec(d), eh = 1 - SP.eleCf, rh = 1 - SP.rudCf;
    const ail = surf === 'elevons' ? [SP.elevonStart, SP.elevonEnd, SP.elevonCf] : surf === 'ailerons' ? [SP.ailStart, SP.ailEnd, SP.ailCf] : null;
    const flap = SP.flaps && surf !== 'elevons' ? [SP.flapStart, SP.flapEnd, SP.flapCf] : null;
    const dihNote = Math.abs(d.dihedral) > 0.1 ? `root bevel ${fmt(d.dihedral / (o.method === 'balsa' ? 1 : 2), 1)}° each half (${fmt(d.dihedral, 1)}° total)` : 'no dihedral';
    const servoCut = (frac) => { const y = (ail ? (ail[0] + 0.08) : 0.3) * s, x = xLE(y) + 0.35 * c(y); return rect(x, y, 12, 23, 'cut'); };

    // calibration + line key
    parts.push(P('Scale check', 1, 'paper', [rect(0, 0, 50, 50, 'cut'), path('ref', [[0, 60], [50.8, 60]])],
      [{ x:2, y:-3, text:'50 mm square: measure before cutting', size:3 }, { x:2, y:58, text:'2 in line', size:3 }], 'Print at 100% / "Actual size"'));
    parts.push(P('Line key', 1, 'paper', Object.keys(LINE).map((k, i) => path(k, [[0, i * 7], [26, i * 7]])),
      Object.keys(LINE).map((k, i) => ({ x:29, y:i * 7 + 1.2, text:LINE[k].label, size:3 })), ''));

    const wingPaths = (offsetFn) => {
      const ps = [];
      for (const sfc of [ail, flap]) { if (!sfc) continue;
        const [a, z, fr] = sfc, ya = a * s, yz = z * s, h = y => xTE(y) - fr * c(y);
        ps.push(path('hinge', [[h(ya), ya], [h(yz), yz]]), path('cut', [[h(ya), ya], [xTE(ya), ya]]), path('cut', [[h(yz), yz], [xTE(yz), yz]]));
      }
      if (ail) ps.push(servoCut());
      return ps;
    };
    if (o.method === 'balsa') {
      // ribs
      const sp = Math.max(0.02, o.ribSpacing || 0.05) * 1000, n = Math.floor(s / sp + 1e-6), ys = Array.from({ length:n + 1 }, (_, k) => k * sp);
      if (s - ys[ys.length - 1] > sp * 0.3) ys.push(s); else ys[ys.length - 1] = s;
      const rs = Airfoil.resample(airfoil.points, 40), sw = o.spar.w, sh = o.spar.h, le = o.le, te = o.te;
      ys.forEach((y, k) => {
        const ch = c(y), xs = rs.xs.map(x => x * ch), yu = rs.yu.map(v => v * ch), yl = rs.yl.map(v => v * ch);
        const at = (arr, x) => { for (let i = 1; i < xs.length; i++) if (x <= xs[i]) { const t = (x - xs[i - 1]) / ((xs[i] - xs[i - 1]) || 1); return arr[i - 1] + t * (arr[i] - arr[i - 1]); } return arr[arr.length - 1]; };
        const x0 = le, x1 = ch - te, xs1 = 0.28 * ch - sw / 2, xs2 = 0.28 * ch + sw / 2;
        const up = [], lo = [];
        const grid = xs.filter(x => x > x0 && x < x1);
        const ux = [x0, ...grid.filter(x => x < xs1), xs1, xs2, ...grid.filter(x => x > xs2), x1];
        ux.forEach(x => { if (x === xs1) { up.push([x, -at(yu, x)], [x, -at(yu, x) + sh]); } else if (x === xs2) { up.push([x, -at(yu, x) + sh], [x, -at(yu, x)]); } else up.push([x, -at(yu, x)]); });
        ux.slice().reverse().forEach(x => { if (x === xs2) { lo.push([x, -at(yl, x)], [x, -at(yl, x) - sh]); } else if (x === xs1) { lo.push([x, -at(yl, x) - sh], [x, -at(yl, x)]); } else lo.push([x, -at(yl, x)]); });
        parts.push(P(`Rib R${k + 1}`, 2, `balsa ${o.sheetT || 1.5} mm`, [path('cut', up.concat(lo), true), path('ref', [[x0, 0], [x1, 0]])],
          [{ x:x0 + 2, y:-at(yu, 0.5 * ch) + Math.max(3, 0.3 * (at(yu, 0.5 * ch) - at(yl, 0.5 * ch))), text:`R${k + 1} · ${L(ch)}`, size:Math.min(3.2, Math.max(2, ch / 40)) }], `station ${L(y)} from root`));
      });
      // building plan (half wing)
      const plan = [path('cut', [[xLE(0), 0], [xLE(s), s], [xTE(s), s], [xTE(0), 0]], true), path('ref', [[xLE(0) + le, 0], [xLE(s) + le, s]]), path('ref', [[xTE(0) - te, 0], [xTE(s) - te, s]]),
        path('spar', [[xLE(0) + 0.28 * cr, 0], [xLE(s) + 0.28 * ct, s]])];
      ys.forEach(y => plan.push(path('ref', [[xLE(y), y], [xTE(y), y]])));
      plan.push(...wingPaths());
      parts.push(P('Wing plan (half): building board', 1, 'paper (pin over, cover with cling film)', plan, ys.map((y, k) => ({ x:xTE(y) + 2, y:y + 1, text:`R${k + 1}`, size:3 })).concat([{ x:xLE(0) + 2, y:-3, text:`ROOT · ${dihNote}`, size:3 }]), 'Build left and right on this plan (flip for the other side)'));
    } else if (o.foamStyle === 'folded') {
      const wrap = 1.08, top = y => xLE(y) - wrap * c(y);
      const ps = [path('cut', [[top(0), 0], [xTE(0), 0], [xTE(s), s], [top(s), s]], true), path('fold', [[xLE(0), 0], [xLE(s), s]]),
        path('spar', [[xLE(0) + 0.25 * cr, 0], [xLE(s) + 0.25 * ct, s]]),
        path('score', [[xLE(0) - 0.3 * cr, 0], [xLE(s) - 0.3 * ct, s]]), path('score', [[xLE(0) - 0.6 * cr, 0], [xLE(s) - 0.6 * ct, s]]), ...wingPaths()];
      parts.push(P('Wing (half), unfolded', 2, `foam board ${o.sheetT || 5} mm`, ps, [{ x:xLE(0) + 3, y:-3, text:`ROOT · fold at LE, top skin wraps over spar · ${dihNote}`, size:3 }, { x:top(0.5 * s) + 3, y:0.5 * s, text:'TOP SKIN', size:4 }, { x:xLE(0.5 * s) + 3, y:0.5 * s, text:'BOTTOM', size:4 }], 'cut 2, mirror one'));
    } else {
      parts.push(P('Wing panel (half), base layer', 2, `Depron ${o.sheetT || 6} mm`, [path('cut', [[xLE(0), 0], [xLE(s), s], [xTE(s), s], [xTE(0), 0]], true), path('spar', [[xLE(0) + 0.25 * cr, 0], [xLE(s) + 0.25 * ct, s]]), ...wingPaths()],
        [{ x:xLE(0) + 3, y:-3, text:`ROOT · ${dihNote}`, size:3 }], 'cut 2, mirror one'));
      parts.push(P('Wing step layer (KFm-2), front 50%', 2, `Depron ${o.sheetT || 6} mm`, [path('cut', [[xLE(0), 0], [xLE(s), s], [xLE(s) + 0.5 * ct, s], [xLE(0) + 0.5 * cr, 0]], true)],
        [{ x:xLE(0) + 3, y:-3, text:'ROOT · glue on top, LE flush, sand LE round', size:3 }], 'cut 2, mirror one'));
    }

    // tail surfaces
    const tailMat = o.method === 'balsa' ? 'balsa 3 mm sheet' : o.foamStyle === 'folded' ? `foam board ${o.sheetT || 5} mm` : 'Depron 3 mm';
    if (!g.tailless) {
      const hs = d.hSpan * 1000, hc = d.hChord * 1000;
      parts.push(P('Horizontal stabilizer + elevator', 1, tailMat, [rect(0, 0, hs, hc), path('hinge', [[0, eh * hc], [hs, eh * hc]]), path('ref', [[hs / 2, 0], [hs / 2, hc]])],
        [{ x:3, y:0.3 * hc, text:`H-STAB ${L(hs)} × ${L(hc)}`, size:3.5 }, { x:3, y:0.85 * hc, text:'ELEVATOR', size:3 }], 'centre line = fuselage centre'));
    }
    const hv = d.vHeight * 1000, cv = d.vChord * 1000;
    parts.push(P(g.tailless ? 'Tip fin' : 'Fin + rudder', g.tailless ? 2 : 1, tailMat, [path('cut', [[0, hv], [cv, hv], [cv, 0], [0.45 * cv, 0]], true), ...(g.tailless ? [] : [path('hinge', [[rh * cv, 0], [rh * cv, hv]])])],
      [{ x:0.5 * cv, y:hv - 3, text:g.tailless ? 'TIP FIN' : 'FIN', size:3.2 }].concat(g.tailless ? [] : [{ x:(rh + 0.02) * cv, y:hv / 2, text:'RUDDER', size:2.8 }]), g.tailless ? 'cut 2' : 'bottom edge sits on fuselage'));

    // fuselage
    const fp = fuseProfiles(d, g), fuseMat = o.method === 'balsa' ? 'balsa 2 mm sheet' : o.foamStyle === 'folded' ? `foam board ${o.sheetT || 5} mm` : 'Depron 6 mm';
    const wingX0 = g.xwLE * 1000, wingX1 = wingX0 + cr;
    if (g.body === 'stick') {
      parts.push(P('Fuselage boom (stick)', 1, `balsa / spruce ${L(fp.hf)} × ${L(fp.wf)}`, [rect(0, 0, fp.Lf, fp.hf), path('ref', [[wingX0, 0], [wingX0, fp.hf]]), path('ref', [[wingX1, 0], [wingX1, fp.hf]])],
        [{ x:2, y:fp.hf + 4, text:`${L(fp.Lf)} stick · wing between marks`, size:3 }], 'use as a cutting gauge'));
      parts.push(P('Nose block', 2, o.method === 'balsa' ? 'balsa 3 mm' : 'Depron 6 mm', [rect(0, 0, 0.14 * fp.Lf, 1.8 * fp.hf)], [{ x:1, y:-2, text:'NOSE', size:3 }], 'laminate both sides of the boom'));
    } else {
      const sidePts = fp.side.map(([x, z]) => [x, -z]);
      parts.push(P(g.body === 'pod' ? 'Pod side' : 'Fuselage side', 2, fuseMat, [path('cut', sidePts, true), path('ref', [[wingX0, -fp.top(wingX0)], [wingX1, -fp.top(wingX1)]]), path('ref', [[0, 0], [fp.Lf, 0]])],
        [{ x:fp.Lf * 0.3, y:2, text:`${g.body === 'pod' ? 'POD' : 'FUSELAGE'} SIDE · ${L(fp.Lf)} · wing seat dashed`, size:3.2 }], 'cut 2'));
      const topPts = fp.halfW.map(([x, w]) => [x, w]).concat(fp.halfW.slice().reverse().map(([x, w]) => [x, -w]));
      parts.push(P(g.body === 'pod' ? 'Pod top' : 'Fuselage top / bottom', g.body === 'pod' ? 1 : 2, fuseMat, [path('cut', topPts, true), path('ref', [[0, 0], [fp.Lf, 0]])], [{ x:fp.Lf * 0.3, y:1.5, text:'TOP / BOTTOM', size:3 }], g.body === 'pod' ? 'cut 1' : 'cut 2'));
      const frames = [['F1 firewall', 0.02 * fp.Lf], ['F2 wing LE', wingX0], ['F3 wing TE', wingX1]].filter(([, x]) => x > 0 && x < fp.Lf);
      frames.forEach(([nm, x]) => { const w = Math.max(5, fp.width(x) - 2 * (o.method === 'balsa' ? 2 : o.sheetT || 6)), h = Math.max(5, fp.top(x) - fp.bot(x));
        parts.push(P(`Former ${nm}`, 1, o.method === 'balsa' || nm.startsWith('F1') ? 'plywood 3 mm' : fuseMat, [rect(0, 0, w, h), path('ref', [[w / 2, 0], [w / 2, h]])], [{ x:1.5, y:4, text:nm.split(' ')[0], size:3 }], `at ${L(x)} from nose`)); });
    }
    return parts;
  }

  function layout(parts, paper){
    const pw = paper.w - 2 * paper.margin - OVERLAP, maxW = Math.max(...parts.map(p => Math.min(p.w, p.h)));
    const area = parts.reduce((a, p) => a + (p.w + GAP) * (p.h + GAP), 0);
    let cols = Math.max(Math.ceil((maxW + GAP) / pw), Math.round(Math.sqrt(area) / pw) || 1);
    const W = cols * pw;
    const items = parts.map(p => { const rot = p.w > W - GAP; return { part:p, rot, w:rot ? p.h : p.w, h:rot ? p.w : p.h }; }).sort((a, b) => b.h - a.h);
    let x = GAP, y = GAP, rowH = 0; const placed = [];
    for (const it of items) {
      if (x + it.w > W && x > GAP) { x = GAP; y += rowH + GAP; rowH = 0; }
      placed.push(Object.assign(it, { x, y })); x += it.w + GAP; rowH = Math.max(rowH, it.h);
    }
    return { placed, width:Math.max(W, ...placed.map(p => p.x + p.w + GAP)), height:y + rowH + GAP };
  }
  function paginate(lay, paper){
    const pw = paper.w - 2 * paper.margin, ph = paper.h - 2 * paper.margin, sx = pw - OVERLAP, sy = ph - OVERLAP;
    const cols = Math.max(1, Math.ceil((lay.width - OVERLAP) / sx)), rows = Math.max(1, Math.ceil((lay.height - OVERLAP) / sy)), pages = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x0 = c * sx, y0 = r * sy;
      const used = lay.placed.some(p => p.x < x0 + pw && p.x + p.w > x0 && p.y < y0 + ph && p.y + p.h > y0);
      if (used) pages.push({ r, c, x0, y0, w:pw, h:ph });
    }
    pages.forEach((p, i) => { p.n = i + 1; });
    return Object.assign(pages, { rows, cols, sx, sy });
  }
  function partSVG(it, ink){
    const p = it.part, tf = it.rot ? `translate(${r2(it.x + it.w)} ${r2(it.y)}) rotate(90)` : `translate(${r2(it.x)} ${r2(it.y)})`;
    const lines = p.paths.map(q => { const L = LINE[q.kind]; const pts = q.pts.map(([x, y]) => `${r2(x)},${r2(y)}`).join(' ');
      return `<${q.closed ? 'polygon' : 'polyline'} points="${pts}" fill="${q.kind === 'cut' && q.closed ? 'rgba(8,145,178,0.05)' : 'none'}" stroke="${q.kind === 'ref' || q.kind === 'spar' ? '#5a6b80' : ink}" stroke-width="${L.w}" ${L.dash ? `stroke-dasharray="${L.dash}"` : ''} stroke-linejoin="round" stroke-linecap="round"/>`; }).join('');
    const labels = (p.labels || []).map(l => `<text x="${r2(l.x)}" y="${r2(l.y)}" font-size="${l.size || 3}" fill="${ink}">${esc(l.text)}</text>`).join('');
    const title = `<text x="${r2(2)}" y="${r2(p.h + 4.2)}" font-size="3.4" font-weight="700" fill="${ink}">${esc(p.name)}${p.qty > 1 ? ` ×${p.qty}` : ''}</text><text x="${r2(2)}" y="${r2(p.h + 8)}" font-size="2.6" fill="#5a6b80">${esc(p.material)}${p.note ? ' · ' + esc(p.note) : ''}</text>`;
    return `<g transform="${tf}">${lines}${labels}${it.rot ? '' : title}</g>${it.rot ? `<text x="${r2(it.x)}" y="${r2(it.y + it.h + 4.2)}" font-size="3.4" font-weight="700" fill="${ink}">${esc(p.name)}${p.qty > 1 ? ` ×${p.qty}` : ''} (rotated)</text>` : ''}`;
  }
  function regMarks(lay, pages){
    const out = [];
    for (let c = 1; c < pages.cols; c++) { const x = c * pages.sx + OVERLAP / 2; for (let k = 0; k < Math.ceil(lay.height / 40); k++) { const y = k * 40 + 20; out.push(`<path d="M${r2(x - 2.5)} ${y}H${r2(x + 2.5)}M${r2(x)} ${y - 2.5}V${y + 2.5}" stroke="#d1495b" stroke-width="0.25"/>`); } }
    for (let r = 1; r < pages.rows; r++) { const y = r * pages.sy + OVERLAP / 2; for (let k = 0; k < Math.ceil(lay.width / 40); k++) { const x = k * 40 + 20; out.push(`<path d="M${x - 2.5} ${r2(y)}H${x + 2.5}M${x} ${r2(y - 2.5)}V${r2(y + 2.5)}" stroke="#d1495b" stroke-width="0.25"/>`); } }
    return out.join('');
  }
  /** Full sheet in real millimetres (for plotters / large-format printing). */
  function renderSheetSVG(lay, o = {}){
    const ink = o.ink || '#111', W = r2(lay.width), H = r2(lay.height);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" font-family="system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif"><title>${esc(o.title || 'RC Calc templates')}</title><rect width="${W}" height="${H}" fill="#fff"/>${o.pages ? regMarks(lay, o.pages) : ''}${lay.placed.map(it => partSVG(it, ink)).join('')}</svg>`;
  }
  function renderPageSVG(lay, pages, page, paper, o = {}){
    const ink = o.ink || '#111', m = paper.margin, id = `${o.idPrefix || 'tp'}-clip${page.n}`;
    const head = `RC Calc · ${esc(o.title || 'templates')} · page ${page.n}/${pages.length} (row ${page.r + 1}, column ${page.c + 1}) · print at 100% · overlap ${OVERLAP} mm, align red crosses`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${paper.w}mm" height="${paper.h}mm" viewBox="0 0 ${paper.w} ${paper.h}" font-family="system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif">
<rect width="${paper.w}" height="${paper.h}" fill="#fff"/><defs><clipPath id="${id}"><rect x="${m}" y="${m}" width="${page.w}" height="${page.h}"/></clipPath></defs>
<g clip-path="url(#${id})"><g transform="translate(${r2(m - page.x0)} ${r2(m - page.y0)})">${regMarks(lay, pages)}${lay.placed.map(it => partSVG(it, ink)).join('')}</g></g>
<rect x="${m}" y="${m}" width="${page.w}" height="${page.h}" fill="none" stroke="#9aa7b6" stroke-width="0.2" stroke-dasharray="1 1"/>
<text x="${m}" y="${m - 2.5}" font-size="2.6" fill="#5a6b80">${head}</text>
<text x="${paper.w - m}" y="${paper.h - m + 5}" font-size="4" font-weight="700" text-anchor="end" fill="#334155">${page.r + 1}-${page.c + 1}</text></svg>`;
  }
  function stats(parts, mat){
    const area = parts.filter(p => !/paper/.test(p.material)).reduce((a, p) => a + p.w * p.h * p.qty, 0);
    const sheetArea = mat && mat.sheet ? mat.sheet[0] * mat.sheet[1] : 1e6;
    return { partArea_mm2:area, sheets:Math.max(1, Math.ceil(area * 1.35 / sheetArea)) };
  }
  return { PAPERS, LINE, OVERLAP, generateParts, layout, paginate, renderSheetSVG, renderPageSVG, partSVG, stats, fuseProfiles };
})();
if (typeof module !== 'undefined') module.exports = { Templates };
