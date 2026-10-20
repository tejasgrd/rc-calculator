/* RC Calc line charts: inline SVG, hairline grid, 2px lines, legend + selective end labels,
   crosshair tooltip on hover/focus, and a table view. Colours come from --series-N tokens (.viz-root). */
'use strict';
const Charts = (() => {
  const niceTicks = (lo, hi, n = 5) => {
    if (!(hi > lo)) hi = lo + 1;
    const step0 = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(step0))), step = [1, 2, 2.5, 5, 10].map(k => k * mag).find(s => s >= step0) || 10 * mag;
    const a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step, out = []; for (let v = a; v <= b + step * 0.001; v += step) out.push(+v.toFixed(10)); return out;
  };
  /**
   * line(el, o): o = { title, series:[{name, color:'var(--series-1)', pts:[[x,y]], dash}], x:{label, fmt}, y:{label, fmt, min, max},
   *                    markers:[{x, label}], hlines:[{y, label}], height }
   */
  function line(el, o){
    const W = 560, H = o.height || 260, m = { l:52, r:84, t:14, b:40 };
    const all = o.series.flatMap(s => s.pts).filter(p => isFinite(p[0]) && isFinite(p[1]));
    if (!all.length) { el.innerHTML = '<p class="hint">No data to plot.</p>'; return; }
    const xs = all.map(p => p[0]), ys = all.map(p => p[1]).concat((o.hlines || []).map(h => h.y));
    const xt = niceTicks(Math.min(...xs), Math.max(...xs)), yt = niceTicks(o.y.min != null ? o.y.min : Math.min(0, ...ys), o.y.max != null ? o.y.max : Math.max(...ys));
    const x0 = xt[0], x1 = xt[xt.length - 1], y0 = yt[0], y1 = yt[yt.length - 1];
    const X = v => m.l + (v - x0) / (x1 - x0) * (W - m.l - m.r), Y = v => H - m.b - (v - y0) / (y1 - y0) * (H - m.t - m.b);
    const fx = o.x.fmt || (v => fmt(v, 0)), fy = o.y.fmt || (v => fmtS(v));
    const grid = yt.map(v => `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid-line)" stroke-width="1"/><text x="${m.l - 8}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--text-secondary)">${fy(v)}</text>`).join('')
      + xt.map(v => `<text x="${X(v)}" y="${H - m.b + 16}" text-anchor="middle" font-size="11" fill="var(--text-secondary)">${fx(v)}</text>`).join('');
    const axes = `<line x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}" stroke="var(--text-muted)" stroke-width="1"/>
      <text x="${(m.l + W - m.r) / 2}" y="${H - 6}" text-anchor="middle" font-size="11.5" fill="var(--text-secondary)">${esc(o.x.label)}</text>
      <text x="14" y="${(m.t + H - m.b) / 2}" text-anchor="middle" font-size="11.5" fill="var(--text-secondary)" transform="rotate(-90 14 ${(m.t + H - m.b) / 2})">${esc(o.y.label)}</text>`;
    const hl = (o.hlines || []).map(h => `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(h.y)}" y2="${Y(h.y)}" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="4 3"/><text x="${W - m.r + 6}" y="${Y(h.y) + 4}" font-size="11" fill="var(--text-secondary)">${esc(h.label)}</text>`).join('');
    const mk = (o.markers || []).filter(k => k.x >= x0 && k.x <= x1).map(k => `<line x1="${X(k.x)}" x2="${X(k.x)}" y1="${m.t}" y2="${H - m.b}" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="2 3"/><text x="${X(k.x) + 4}" y="${m.t + 10}" font-size="10.5" fill="var(--text-secondary)">${esc(k.label)}</text>`).join('');
    const lines = o.series.map(s => { const pts = s.pts.filter(p => isFinite(p[1]));
      return `<polyline points="${pts.map(p => `${X(p[0]).toFixed(1)},${Y(Math.max(y0, Math.min(y1, p[1]))).toFixed(1)}`).join(' ')}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''}/>`; }).join('');
    const endY = o.series.map(s => { const p = s.pts.filter(q => isFinite(q[1])).slice(-1)[0]; return p ? Y(Math.max(y0, Math.min(y1, p[1]))) : null; });
    const collide = endY.some((a, i) => endY.some((b, j) => j > i && a != null && b != null && Math.abs(a - b) < 14));
    const ends = o.series.length <= 4 && !collide ? o.series.map(s => { const p = s.pts.filter(q => isFinite(q[1])).slice(-1)[0]; if (!p) return '';
      return `<circle cx="${X(p[0])}" cy="${Y(Math.max(y0, Math.min(y1, p[1])))}" r="4" fill="${s.color}" stroke="var(--surface-1)" stroke-width="2"/><text x="${X(p[0]) + 8}" y="${Y(Math.max(y0, Math.min(y1, p[1]))) + 4}" font-size="11" fill="var(--text-primary)">${esc(s.short || s.name)}</text>`; }).join('') : '';
    const legend = o.series.length >= 2 ? `<div class="legend" aria-hidden="true">${o.series.map(s => `<span><i class="line" style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
    const id = 'ch' + Math.random().toString(36).slice(2, 8);
    el.innerHTML = `${legend}<div class="chart-wrap"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.title)}" tabindex="0" focusable="true">${grid}${axes}${hl}${mk}${lines}${ends}
      <line class="xh" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" stroke="var(--text-muted)" stroke-width="1" opacity="0"/><g class="dots"></g>
      <rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent"/></svg><div class="chart-tip" role="status"></div></div>
      <details class="tableview"><summary>Show data table</summary><div class="mini-table"><table><thead><tr><th scope="col">${esc(o.x.label)}</th>${o.series.map(s => `<th scope="col">${esc(s.name)}</th>`).join('')}</tr></thead><tbody>${
        o.series[0].pts.filter((_, i) => i % Math.max(1, Math.round(o.series[0].pts.length / 24)) === 0).map(p => `<tr><td>${fx(p[0])}</td>${o.series.map(s => { const q = s.pts.reduce((a, b) => Math.abs(b[0] - p[0]) < Math.abs(a[0] - p[0]) ? b : a); return `<td>${isFinite(q[1]) ? fy(q[1]) : '–'}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div></details>`;
    const svg = el.querySelector('svg'), tip = el.querySelector('.chart-tip'), xh = svg.querySelector('.xh'), dots = svg.querySelector('.dots');
    let cur = null;
    const show = xv => {
      const rows = o.series.map(s => { const q = s.pts.reduce((a, b) => Math.abs(b[0] - xv) < Math.abs(a[0] - xv) ? b : a); return { s, q }; });
      const px = X(rows[0].q[0]); xh.setAttribute('x1', px); xh.setAttribute('x2', px); xh.setAttribute('opacity', '1');
      dots.innerHTML = rows.filter(r => isFinite(r.q[1]) && r.q[1] >= y0 && r.q[1] <= y1).map(r => `<circle cx="${X(r.q[0])}" cy="${Y(r.q[1])}" r="4" fill="${r.s.color}" stroke="var(--surface-1)" stroke-width="2"/>`).join('');
      tip.innerHTML = `<b>${esc(o.x.label)}: ${fx(rows[0].q[0])}</b>` + rows.map(r => `<div><span class="k" style="background:${r.s.color}"></span>${esc(r.s.name)}: ${isFinite(r.q[1]) ? fy(r.q[1]) : '–'}</div>`).join('');
      const box = svg.getBoundingClientRect(), sc = box.width / W; tip.style.left = Math.min(box.width - 170, Math.max(0, px * sc + 12)) + 'px'; tip.style.top = (m.t * sc) + 'px'; tip.classList.add('show'); cur = xv;
    };
    const hide = () => { xh.setAttribute('opacity', '0'); dots.innerHTML = ''; tip.classList.remove('show'); };
    svg.addEventListener('pointermove', e => { const b = svg.getBoundingClientRect(), xv = x0 + ((e.clientX - b.left) / b.width * W - m.l) / (W - m.l - m.r) * (x1 - x0); if (xv >= x0 && xv <= x1) show(xv); else hide(); });
    svg.addEventListener('pointerleave', hide); svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', e => { const stepv = (x1 - x0) / 40; if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); show(Math.max(x0, Math.min(x1, (cur == null ? x0 : cur) + (e.key === 'ArrowRight' ? stepv : -stepv)))); } else if (e.key === 'Escape') hide(); });
  }
  return { line, niceTicks };
})();
