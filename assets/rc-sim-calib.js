/* RC Calc simulator: flight-log import and model calibration (pure, no DOM).
   Parses EdgeTX/OpenTX CSV, INAV/Betaflight blackbox CSV, ArduPilot text logs, GPX, IGC and manual measurements into one
   schema; estimates wind; finds steady segments; evaluates the same segments on the flight model; fits bounded correction
   factors (drag, max lift, thrust, current, roll). Depends on rc-core, rc-aero, rc-sim-model, rc-sim-physics. */
'use strict';
const SimCalib = (() => {
  const DEG = Math.PI / 180, KTS = 0.514444, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const FACTORS = [
    { key:'cd0', label:'Drag (zero-lift)', range:[0.6, 2.0], affects:'cruise power, top speed, glide ratio' },
    { key:'clmax', label:'Maximum lift', range:[0.7, 1.3], affects:'stall speed' },
    { key:'thrust', label:'Thrust', range:[0.6, 1.3], affects:'climb rate, top speed' },
    { key:'current', label:'Current draw', range:[0.7, 1.4], affects:'battery time, current' },
    { key:'roll', label:'Aileron effectiveness', range:[0.6, 1.6], affects:'roll rate' },
  ];

  /* ---------------- CSV + helpers ---------------- */
  function csv(text){
    const rows = []; let row = [], f = '', q = false; const head = text.slice(0, 2000), sep = head.includes(',') ? ',' : head.includes(';') ? ';' : '\t';
    for (let i = 0; i < text.length; i++) { const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true; else if (c === sep) { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = []; }
      else f += c; }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows;
  }
  const num = v => { if (v == null) return NaN; const s = String(v).trim(); if (!s) return NaN; const n = Number(s.replace(/[^\d.eE+\-]/g, '')); return isFinite(n) ? n : NaN; };
  /** find a column by regexes; returns { i, unit } */
  function col(header, res){ for (const re of res) { const i = header.findIndex(h => re.test(h)); if (i >= 0) { const u = /\(([^)]+)\)/.exec(header[i]); return { i, unit:u ? u[1].toLowerCase() : '' }; } } return null; }
  const speedSI = (v, u) => /kts|kt|knot/.test(u) ? v * KTS : /km\/?h|kmh/.test(u) ? v / 3.6 : /mph/.test(u) ? v * 0.44704 : /cm\/s/.test(u) ? v / 100 : v;
  const lenSI = (v, u) => /ft|feet/.test(u) ? v * 0.3048 : /cm/.test(u) ? v / 100 : v;
  const angSI = (v, u) => /rad/.test(u) ? v / DEG : /decideg/.test(u) ? v / 10 : v; // to degrees
  function timeOf(s){ const m = /(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s || ''); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : NaN; }

  /* ---------------- parsers → raw samples [{t, lat, lon, alt, gs, as, roll, pitch, yaw, thr, ail, ele, rud, V, A, mAh}] ---------------- */
  function parseEdgeTX(text){
    const rows = csv(text), h = rows[0].map(s => s.trim()), out = [];
    const C = { date:col(h, [/^date$/i]), time:col(h, [/^time$/i]), alt:col(h, [/^alt\(/i, /^galt/i, /^alt$/i]), gs:col(h, [/^gspd/i]), as:col(h, [/^aspd/i, /^asp/i]),
      roll:col(h, [/^roll\(/i, /^roll$/i]), pitch:col(h, [/^ptch/i, /^pitch/i]), yaw:col(h, [/^yaw\(/i, /^hdg/i]), V:col(h, [/^vfas/i, /^rxbt/i, /^bat/i, /^a2\(/i]), A:col(h, [/^curr/i]), mAh:col(h, [/^capa/i, /^fuel/i]),
      gps:col(h, [/^gps$/i, /^gps\(/i]), thr:col(h, [/^thr$/i]), ail:col(h, [/^ail$/i]), ele:col(h, [/^ele$/i]), rud:col(h, [/^rud$/i]) };
    if (!C.time) throw new Error('EdgeTX log: no Time column found');
    let t0 = null, day = 0, prev = -1;
    for (const r of rows.slice(1)) {
      let t = timeOf(r[C.time.i]); if (!isFinite(t)) continue; if (prev >= 0 && t < prev - 3600) day += 86400; prev = t; t += day; if (t0 == null) t0 = t;
      const g = C.gps ? String(r[C.gps.i] || '').trim().split(/\s+/) : [], s = { t:t - t0 };
      if (g.length === 2 && isFinite(+g[0]) && isFinite(+g[1]) && (+g[0] || +g[1])) { s.lat = +g[0]; s.lon = +g[1]; }
      const put = (k, f) => { if (C[k]) { const v = num(r[C[k].i]); if (isFinite(v)) s[k] = f ? f(v, C[k].unit) : v; } };
      put('alt', lenSI); put('gs', speedSI); put('as', speedSI); put('roll', angSI); put('pitch', angSI); put('yaw', angSI); put('V'); put('A'); put('mAh');
      for (const k of ['ail', 'ele', 'rud']) put(k, v => clamp(v / 1024, -1, 1)); put('thr', v => clamp((v + 1024) / 2048, 0, 1));
      out.push(s);
    }
    return out;
  }
  function parseBlackbox(text){
    const rows = csv(text); let hi = rows.findIndex(r => r.some(c => /loopIteration|^time/i.test(c.trim()))); if (hi < 0) hi = 0;
    const h = rows[hi].map(s => s.trim()), out = [];
    const C = { time:col(h, [/^time\s*\(us\)/i, /^time$/i]), thr:col(h, [/^rcCommand\[3\]/i]), ail:col(h, [/^rcCommand\[0\]/i]), ele:col(h, [/^rcCommand\[1\]/i]), rud:col(h, [/^rcCommand\[2\]/i]),
      roll:col(h, [/^attitude\[0\]/i]), pitch:col(h, [/^attitude\[1\]/i]), yaw:col(h, [/^attitude\[2\]/i]), alt:col(h, [/^BaroAlt/i, /^navPos\[2\]/i]), V:col(h, [/^vbat/i]), A:col(h, [/^amperage/i]),
      mAh:col(h, [/^energyCumulative/i, /^mAhDrawn/i]), gs:col(h, [/^GPS_speed/i]), lat:col(h, [/^GPS_coord\[0\]/i]), lon:col(h, [/^GPS_coord\[1\]/i]), as:col(h, [/^airSpeed/i]) };
    if (!C.time) throw new Error('Blackbox CSV: no time column');
    let t0 = null;
    for (const r of rows.slice(hi + 1)) {
      const tu = num(r[C.time.i]); if (!isFinite(tu)) continue; if (t0 == null) t0 = tu; const s = { t:(tu - t0) / 1e6 };
      const g = (k, f) => { if (C[k]) { const v = num(r[C[k].i]); if (isFinite(v)) s[k] = f(v, C[k].unit); } };
      g('thr', v => clamp((v - 1000) / 1000, 0, 1)); for (const k of ['ail', 'ele', 'rud']) g(k, v => clamp(v / 500, -1, 1));
      g('roll', (v, u) => /deg/.test(u) && !/deci/.test(u) ? v : v / 10); g('pitch', (v, u) => -(/deg/.test(u) && !/deci/.test(u) ? v : v / 10)); g('yaw', (v, u) => /deg/.test(u) && !/deci/.test(u) ? v : v / 10);
      g('alt', (v, u) => /\bm\b/.test(u) ? v : v / 100); g('V', (v, u) => /v/.test(u) ? v : v / 100); g('A', (v, u) => /a\b/.test(u) ? v : v / 100); g('mAh', v => v);
      g('gs', (v, u) => /m\/s/.test(u) ? v : v / 100); g('as', (v, u) => /m\/s/.test(u) ? v : v / 100); g('lat', v => Math.abs(v) > 360 ? v / 1e7 : v); g('lon', v => Math.abs(v) > 360 ? v / 1e7 : v);
      out.push(s);
    }
    return out;
  }
  function parseArduPilot(text){
    const fmt = {}, msgs = {};
    for (const line of text.split(/\r?\n/)) {
      const p = line.split(',').map(s => s.trim()); if (p.length < 3) continue;
      if (p[0] === 'FMT') { const name = p[3], cols = p.slice(5); if (name) fmt[name] = cols; continue; }
      const f = fmt[p[0]]; if (!f) continue; const o = {}; f.forEach((c, i) => { o[c] = num(p[i + 1]); }); (msgs[p[0]] = msgs[p[0]] || []).push(o);
    }
    if (!Object.keys(msgs).length) throw new Error('ArduPilot log: no FMT/data lines found (export the .bin as a text .log)');
    const T = o => (o.TimeUS != null ? o.TimeUS / 1e6 : o.TimeMS / 1000);
    const base = msgs.ATT || msgs.GPS || msgs.BARO; if (!base) throw new Error('ArduPilot log: needs ATT, GPS or BARO messages');
    const t0 = T(base[0]), pick = (list, t) => { if (!list || !list.length) return null; let lo = 0, hi = list.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T(list[m]) < t) lo = m; else hi = m; } return Math.abs(T(list[lo]) - t) < Math.abs(T(list[hi]) - t) ? list[lo] : list[hi]; };
    const out = [];
    for (let i = 0; i < base.length; i++) {
      const t = T(base[i]), s = { t:t - t0 }, a = pick(msgs.ATT, t), g = pick(msgs.GPS, t), b = pick(msgs.BARO, t), bt = pick(msgs.BAT || msgs.CURR, t), rc = pick(msgs.RCIN, t), ar = pick(msgs.ARSP, t);
      if (a) { s.roll = a.Roll; s.pitch = a.Pitch; s.yaw = a.Yaw; }
      if (g && isFinite(g.Lat)) { s.lat = Math.abs(g.Lat) > 360 ? g.Lat / 1e7 : g.Lat; s.lon = Math.abs(g.Lng) > 360 ? g.Lng / 1e7 : g.Lng; s.gs = g.Spd; if (!b) s.alt = g.Alt; }
      if (b) s.alt = b.Alt; if (bt) { s.V = bt.Volt; s.A = bt.Curr; s.mAh = bt.CurrTot; } if (ar) s.as = ar.Airspeed;
      if (rc) { const n = v => clamp((v - 1500) / 500, -1, 1); s.ail = n(rc.C1); s.ele = -n(rc.C2); s.thr = clamp((rc.C3 - 1000) / 1000, 0, 1); s.rud = n(rc.C4); }
      out.push(s);
    }
    return out;
  }
  function parseGPX(text){
    const out = []; let t0 = null; const re = /<trkpt[^>]*lat="([-\d.]+)"[^>]*lon="([-\d.]+)"[^>]*>([\s\S]*?)<\/trkpt>/g; let m;
    while ((m = re.exec(text))) { const ele = /<ele>([-\d.]+)<\/ele>/.exec(m[3]), tm = /<time>([^<]+)<\/time>/.exec(m[3]); const t = tm ? Date.parse(tm[1]) / 1000 : NaN; if (!isFinite(t)) continue; if (t0 == null) t0 = t; out.push({ t:t - t0, lat:+m[1], lon:+m[2], alt:ele ? +ele[1] : undefined }); }
    if (!out.length) throw new Error('GPX: no timed track points'); return out;
  }
  function parseIGC(text){
    const out = []; let t0 = null;
    for (const line of text.split(/\r?\n/)) { const m = /^B(\d{2})(\d{2})(\d{2})(\d{2})(\d{5})([NS])(\d{3})(\d{5})([EW])[AV](\d{5}|-\d{4})(\d{5}|-\d{4})/.exec(line); if (!m) continue;
      const t = +m[1] * 3600 + +m[2] * 60 + +m[3], lat = (+m[4] + +m[5] / 60000) * (m[6] === 'S' ? -1 : 1), lon = (+m[7] + +m[8] / 60000) * (m[9] === 'W' ? -1 : 1);
      if (t0 == null) t0 = t; out.push({ t:t - t0, lat, lon, alt:+m[11] || +m[10] }); }
    if (!out.length) throw new Error('IGC: no B records'); return out;
  }
  function detect(name, text){
    const n = (name || '').toLowerCase();
    if (/\.gpx$/.test(n) || /<gpx[\s>]/i.test(text.slice(0, 500))) return 'gpx';
    if (/\.igc$/.test(n) || /^A[A-Z0-9]{3}/.test(text) && /\nB\d{6}/.test(text)) return 'igc';
    if (/^FMT,|\nFMT,/.test(text.slice(0, 5000))) return 'ardupilot';
    if (/loopIteration|rcCommand\[0\]/.test(text.slice(0, 20000))) return 'blackbox';
    if (/^Date,Time|^"?Date"?,"?Time/i.test(text.slice(0, 200))) return 'edgetx';
    if (/^t_s,/.test(text)) return 'normalized';
    throw new Error('Unknown log format. Supported: EdgeTX/OpenTX CSV, INAV/Betaflight blackbox CSV, ArduPilot .log (text), GPX, IGC');
  }
  function parseNormalized(text){ const rows = csv(text), h = rows[0]; return rows.slice(1).map(r => { const o = {}; h.forEach((k, i) => { const v = num(r[i]); if (isFinite(v)) o[k === 't_s' ? 't' : k] = v; }); return o; }); }

  /* ---------------- normalise: 10 Hz, local NED, derived speeds ---------------- */
  function normalize(raw, meta = {}){
    raw = raw.filter(s => isFinite(s.t)).sort((a, b) => a.t - b.t);
    if (raw.length < 5) throw new Error('Log has too few samples');
    const keys = ['lat', 'lon', 'alt', 'gs', 'as', 'roll', 'pitch', 'yaw', 'thr', 'ail', 'ele', 'rud', 'V', 'A', 'mAh'], T0 = raw[0].t, T1 = raw[raw.length - 1].t, dt = 0.1, rows = [];
    const idx = {}; keys.forEach(k => { idx[k] = raw.filter(s => isFinite(s[k])).map(s => [s.t, s[k]]); });
    const interp = (arr, t, wrap) => { if (!arr.length) return undefined; if (t <= arr[0][0]) return arr[0][1]; if (t >= arr[arr.length - 1][0]) return arr[arr.length - 1][1];
      let lo = 0, hi = arr.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (arr[m][0] < t) lo = m; else hi = m; }
      const a = arr[lo], b = arr[hi]; if (b[0] - a[0] > 3) return undefined; let d = b[1] - a[1]; if (wrap && Math.abs(d) > 180) d -= 360 * Math.sign(d); return a[1] + d * (t - a[0]) / ((b[0] - a[0]) || 1); };
    for (let t = T0; t <= T1 + 1e-9; t += dt) { const r = { t:t - T0 }; keys.forEach(k => { const v = interp(idx[k], t, k === 'yaw' || k === 'roll'); if (v !== undefined) r[k] = v; }); rows.push(r); }
    const home = rows.find(r => isFinite(r.lat)), hasGPS = !!home, R = 6371000;
    if (hasGPS) rows.forEach(r => { if (isFinite(r.lat)) { r.x = (r.lat - home.lat) * DEG * R; r.y = (r.lon - home.lon) * DEG * R * Math.cos(home.lat * DEG); } });
    const alt0 = Math.min(...rows.slice(0, 30).map(r => r.alt).filter(isFinite)); if (isFinite(alt0)) rows.forEach(r => { if (isFinite(r.alt)) r.alt -= alt0; });
    // derivatives (1 s centred window)
    const w = 5;
    for (let i = 0; i < rows.length; i++) { const a = rows[Math.max(0, i - w)], b = rows[Math.min(rows.length - 1, i + w)], d = b.t - a.t || 1, r = rows[i];
      if (isFinite(a.alt) && isFinite(b.alt)) r.vs = (b.alt - a.alt) / d;
      if (isFinite(a.x) && isFinite(b.x)) { r.vn = (b.x - a.x) / d; r.ve = (b.y - a.y) / d; if (!isFinite(r.gs)) r.gs = Math.hypot(r.vn, r.ve); }
      const a1 = rows[Math.max(0, i - 1)], b1 = rows[Math.min(rows.length - 1, i + 1)];
      if (isFinite(a1.roll) && isFinite(b1.roll)) { let dr = b1.roll - a1.roll; if (Math.abs(dr) > 180) dr -= 360 * Math.sign(dr); r.p = dr / ((b1.t - a1.t) || 1); } }
    const log = { meta:Object.assign({ name:meta.name || 'flight log', format:meta.format || 'unknown', rate:10, duration:rows[rows.length - 1].t }, meta), rows };
    const has = k => rows.filter(r => isFinite(r[k])).length > rows.length * 0.3;
    Object.assign(log.meta, { hasGPS, hasAirspeed:has('as'), hasAttitude:has('roll') && has('pitch'), hasCurrent:has('A'), hasThrottle:has('thr'), hasSticks:has('ail'), hasAlt:has('alt') });
    log.wind = estimateWindTurns(log) || estimateWind(log);
    const energy = () => { for (let i = 0; i < rows.length; i++) { const a = rows[Math.max(0, i - 5)], b = rows[Math.min(rows.length - 1, i + 5)], r = rows[i];
      if (isFinite(a.asEst) && isFinite(b.asEst) && isFinite(r.vs)) r.vsE = r.vs + r.asEst * (b.asEst - a.asEst) / ((b.t - a.t) || 1) / G; } };
    log.energy = energy;
    rows.forEach(r => { if (!isFinite(r.as) && isFinite(r.vn) && log.wind) { r.asEst = Math.hypot(r.vn - log.wind.n, r.ve - log.wind.e, r.vs || 0); } else if (isFinite(r.as)) r.asEst = r.as; else if (isFinite(r.gs)) r.asEst = r.gs; });
    energy(); return log;
  }
  /**
   * Wind from turns ("circle method"): within a turn at steady throttle and height the airspeed is ~constant, so each turn k
   * gives samples with |v_ground − w|² = Va_k². Linear least squares in (wn, we, c_1..c_K) with c_k = Va_k² − |w|².
   */
  function estimateWindTurns(log){
    const R = log.rows, wins = []; let i = 0;
    while (i < R.length) { const r0 = R[i]; if (!isFinite(r0.vn) || !isFinite(r0.thr) || (isFinite(r0.alt) && r0.alt < 5)) { i++; continue; }
      let j = i; while (j + 1 < R.length && R[j + 1].t - r0.t < 8 && isFinite(R[j + 1].vn) && Math.abs(R[j + 1].thr - r0.thr) < 0.04 && Math.abs(R[j + 1].vs || 0) < 1.2) j++;
      const w = R.slice(i, j + 1); if (w.length >= 30) { let hx = 0, hy = 0; w.forEach(r => { const h = Math.atan2(r.ve, r.vn); hx += Math.cos(h); hy += Math.sin(h); }); if (1 - Math.hypot(hx, hy) / w.length > 0.35) wins.push(w); }
      i = j + 1; }
    if (wins.length < 1) return null;
    const K = wins.length, n = 2 + K, A = Array.from({ length:n }, () => new Array(n).fill(0)), b = new Array(n).fill(0);
    wins.forEach((w, k) => w.forEach(r => { const row = new Array(n).fill(0); row[0] = 2 * r.vn; row[1] = 2 * r.ve; row[2 + k] = 1; const y = r.vn * r.vn + r.ve * r.ve;
      for (let p = 0; p < n; p++) { b[p] += row[p] * y; for (let q = 0; q < n; q++) A[p][q] += row[p] * row[q]; } }));
    let x; try { x = solveLinear(A, b); } catch (e) { return null; } if (!x.every(isFinite)) return null;
    const speed = Math.hypot(x[0], x[1]), Va = x.slice(2).map(c => Math.sqrt(Math.max(0, c + speed * speed)));
    return { n:x[0], e:x[1], speed, from:((Math.atan2(-x[1], -x[0]) / DEG) + 360) % 360, airspeeds:Va, turns:K, coverage:Math.min(1, K / 3), quality:K >= 3 ? 'good' : K >= 2 ? 'fair' : 'poor', method:'turns' };
  }
  /** Least-squares wind: |v_ground − w| ≈ constant airspeed in steady samples → linear in (wn, we, c). */
  function estimateWind(log){
    const S = log.rows.filter(r => isFinite(r.vn) && (r.alt == null || r.alt > 5) && Math.hypot(r.vn, r.ve) > 2);
    if (S.length < 30) return null;
    const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
    let hx = 0, hy = 0;
    for (const r of S) { const row = [2 * r.vn, 2 * r.ve, -1], y = r.vn * r.vn + r.ve * r.ve; for (let i = 0; i < 3; i++) { b[i] += row[i] * y; for (let j = 0; j < 3; j++) A[i][j] += row[i] * row[j]; } const hh = Math.atan2(r.ve, r.vn); hx += Math.cos(hh); hy += Math.sin(hh); }
    let x; try { x = solveLinear(A, b); } catch (e) { return null; }
    const coverage = 1 - Math.hypot(hx, hy) / S.length, Va = Math.sqrt(Math.max(0, x[0] * x[0] + x[1] * x[1] - x[2]));
    if (!x.every(isFinite) || !(Va > 0.5)) return null;
    const speed = Math.hypot(x[0], x[1]);
    return { n:x[0], e:x[1], speed, from:((Math.atan2(-x[1], -x[0]) / DEG) + 360) % 360, airspeed:Va, coverage, quality:coverage > 0.5 ? 'good' : coverage > 0.25 ? 'fair' : 'poor' };
  }
  /** Two-pass analysis: segments → wind from steady straight legs → airspeed estimate → segments again. */
  function analyze(log){
    let segs = segments(log);
    if (!log.meta.hasAirspeed && log.meta.hasGPS && !(log.wind && log.wind.method === 'turns')) {
      const legs = segs.filter(s => s.type === 'cruise' || s.type === 'topspeed'), sub = { rows:log.rows.filter(r => legs.some(s => r.t >= s.t0 && r.t <= s.t1)), meta:log.meta };
      const w = estimateWind(sub); if (w) { log.wind = Object.assign(w, { source:'steady legs' }); log.rows.forEach(r => { if (isFinite(r.vn)) r.asEst = Math.hypot(r.vn - w.n, r.ve - w.e, r.vs || 0); }); if (log.energy) log.energy(); segs = segments(log); }
    }
    return segs;
  }
  function parse(name, text){
    const fmt = detect(name, text);
    const raw = fmt === 'edgetx' ? parseEdgeTX(text) : fmt === 'blackbox' ? parseBlackbox(text) : fmt === 'ardupilot' ? parseArduPilot(text) : fmt === 'gpx' ? parseGPX(text) : fmt === 'igc' ? parseIGC(text) : parseNormalized(text);
    return normalize(raw, { name, format:fmt });
  }

  /* ---------------- segment detection ---------------- */
  function runs(rows, pred, minDur){ const out = []; let s = -1; for (let i = 0; i <= rows.length; i++) { const ok = i < rows.length && pred(rows[i], i); if (ok && s < 0) s = i; if (!ok && s >= 0) { if (rows[i - 1].t - rows[s].t >= minDur) out.push([s, i - 1]); s = -1; } } return out; }
  const mean = (a, k) => a.reduce((s, r) => s + r[k], 0) / a.length, sd = (a, k) => { const m = mean(a, k); return Math.sqrt(a.reduce((s, r) => s + (r[k] - m) ** 2, 0) / a.length); };
  const battery = s => ({ Vpack:s.every(r => isFinite(r.V)) ? mean(s, 'V') : null, mAhUsed:isFinite(s[0].mAh) ? s[0].mAh : null });
  function segments(log){
    const R = log.rows, m = log.meta, segs = [], air = r => (!isFinite(r.alt) || r.alt > 4) && isFinite(r.asEst) && r.asEst > 2.5;
    const level = r => !m.hasAttitude || Math.abs(r.roll) < 25;
    const steadyV = s => sd(s, 'asEst') < 0.45;
    const add = (type, [a, b], extra, needSteady) => { const s = R.slice(a + 3, b - 2); if (s.length < 15 || (needSteady && !steadyV(s))) return; const o = Object.assign({ type, t0:R[a].t, t1:R[b].t, V:mean(s, 'asEst'), vs:s.every(r => isFinite(r.vs)) ? mean(s, 'vs') : null, thr:m.hasThrottle ? mean(s, 'thr') : null, A:m.hasCurrent ? mean(s, 'A') : null }, battery(s), extra ? extra(s) : {}); segs.push(o); };
    if (m.hasThrottle && m.hasAlt) {
      runs(R, r => air(r) && level(r) && r.thr < 0.04 && isFinite(r.vs) && r.vs < 0, 4).forEach(rg => add('glide', rg, s => { const sink = -(s.every(r => isFinite(r.vsE)) ? mean(s, 'vsE') : mean(s, 'vs')); return { LD:Math.sqrt(Math.max(0, mean(s, 'asEst') ** 2 - sink * sink)) / Math.max(0.05, sink) }; }, true));
      runs(R, r => air(r) && level(r) && r.thr > 0.9 && r.vs > 0.3, 4).forEach(rg => add('climb', rg, s => s.every(r => isFinite(r.vsE)) ? { vs:mean(s, 'vsE'), vsRaw:mean(s, 'vs') } : {}));
      runs(R, (r, i) => air(r) && (!m.hasAttitude || Math.abs(r.roll) < 15) && r.thr > 0.12 && r.thr < 0.88 && Math.abs(r.vs) < 0.6 && (!isFinite(r.vsE) || Math.abs(r.vsE) < 0.5) && i > 4 && Math.abs(r.thr - R[i - 4].thr) < 0.03, 5).forEach(rg => add('cruise', rg, s => ({ vsE:s.every(r => isFinite(r.vsE)) ? mean(s, 'vsE') : 0 }), true));
      runs(R, r => air(r) && level(r) && r.thr > 0.95 && Math.abs(r.vs) < 0.6, 4).forEach(rg => add('topspeed', rg, null, true));
      // stall: slowing with low throttle, then a sharp sink or nose drop
      for (let i = 40; i < R.length - 20; i++) { const r = R[i]; if (!air(r) || r.thr > 0.3) continue;
        const prev = R.slice(i - 40, i), next = R.slice(i, i + 15), minV = Math.min(...prev.slice(-10).map(x => x.asEst));
        const drop = m.hasAttitude ? next.some(x => x.pitch < r.pitch - 10) : next.some(x => isFinite(x.vs) && x.vs < -1.5);
        const slowed = Math.max(...prev.slice(0, 15).map(x => x.asEst)) > minV * 1.12 && prev.slice(-20).every(x => x.thr < 0.3) && Math.abs(r.asEst - minV) < 0.4, noseUp = !m.hasAttitude || r.pitch > -3;
        if (drop && slowed && noseUp) { segs.push(Object.assign({ type:'stall' }, battery(next), { t0:R[i - 40].t, t1:R[i + 14].t, V:minV, wingDrop:m.hasAttitude ? Math.max(...next.map(x => Math.abs(x.roll))) : null })); i += 60; } }
    }
    if (m.hasAttitude && m.hasSticks) runs(R, r => air(r) && Math.abs(r.ail) > 0.8 && isFinite(r.p), 0.6).forEach(([a, b]) => { const s = R.slice(a, b + 1);
      const ok = s.filter(r => Math.abs(r.pitch) < 50).map(r => Math.abs(r.p)).sort((x, y) => x - y), turned = ok.reduce((acc, v) => acc + v * 0.1, 0); if (turned < 60 || ok.length < 5) return;
      const p80 = ok[Math.floor(ok.length * 0.8)]; segs.push({ ...battery(s), V0:R[a].asEst, phi0:isFinite(R[a].roll) ? R[a].roll : 0, theta0:isFinite(R[a].pitch) ? R[a].pitch : null, thr:m.hasThrottle ? mean(s, 'thr') : null, type:'roll', t0:R[a].t, t1:R[b].t, V:mean(s, 'asEst'), p:p80, ail:mean(s.map(r => ({ v:Math.abs(r.ail) })), 'v'), dir:Math.sign(mean(s.map(r => ({ v:r.ail != null ? r.ail : (r.p || 0) })), 'v')) || 1, rud:m.hasSticks ? mean(s.map(r => ({ v:r.rud || 0 })), 'v') : 0 }); });
    return segs.sort((a, b) => a.t0 - b.t0);
  }
  /** Manual measurements (no logger): { stall_ms, top_ms, climb_ms, cruise:{ V, thr, A }, glide:{ V, LD } } → segments */
  function manualSegments(o){
    const s = [];
    if (o.stall_ms > 0) s.push({ type:'stall', V:o.stall_ms, manual:true });
    if (o.top_ms > 0) s.push({ type:'topspeed', V:o.top_ms, thr:1, manual:true });
    if (o.climb_ms > 0) s.push({ type:'climb', V:o.climbV_ms > 0 ? o.climbV_ms : null, vs:o.climb_ms, thr:1, manual:true });
    if (o.cruise && o.cruise.V > 0 && o.cruise.thr > 0) s.push({ type:'cruise', V:o.cruise.V, thr:o.cruise.thr, A:o.cruise.A > 0 ? o.cruise.A : null, vs:0, manual:true });
    if (o.glide && o.glide.V > 0 && o.glide.LD > 0) s.push({ type:'glide', V:o.glide.V, LD:o.glide.LD, manual:true });
    if (o.flight && o.flight.min > 0 && o.flight.thr > 0) s.push({ type:'endurance', thr:o.flight.thr, min:o.flight.min, manual:true });
    return s;
  }

  /* ---------------- quasi-static evaluation of the model ---------------- */
  function newton(F, x0, lo, hi, it = 40){
    let x = x0.slice();
    for (let k = 0; k < it; k++) { const f = F(x); if (f.every(v => Math.abs(v) < 1e-6)) break;
      const J = f.map(() => x.map(() => 0)); x.forEach((_, j) => { const xp = x.slice(), h = 1e-4 * Math.max(1, Math.abs(x[j])); xp[j] += h; const f1 = F(xp); f.forEach((_, i) => { J[i][j] = (f1[i] - f[i]) / h; }); });
      let dx; try { dx = solveLinear(J, f.map(v => -v)); } catch (e) { break; } if (!dx.every(isFinite)) break;
      x = x.map((v, i) => clamp(v + clamp(dx[i], -0.25 * (hi[i] - lo[i]), 0.25 * (hi[i] - lo[i])), lo[i], hi[i])); }
    return x;
  }
  /** Battery state of charge during a segment: from measured pack voltage (loaded, so add a little sag back) or mAh used. */
  function socFor(model, seg){
    if (seg && seg.Vpack > 0) { const vc = seg.Vpack / model.cells + Math.min(0.15, (seg.A || 0) * 0.012 * 1000 / model.capacity_mAh), T = [[0, 3.3], [0.05, 3.5], [0.2, 3.7], [0.5, 3.82], [0.8, 3.95], [1, 4.2]];
      for (let i = 1; i < T.length; i++) if (vc <= T[i][1]) return clamp(T[i - 1][0] + (T[i][0] - T[i - 1][0]) * (vc - T[i - 1][1]) / (T[i][1] - T[i - 1][1]), 0, 1); return 1; }
    if (seg && seg.mAhUsed != null) return clamp(1 - seg.mAhUsed / model.capacity_mAh, 0.02, 1);
    return 0.85;
  }
  /** Steady straight flight at airspeed V with throttle thr (or solve throttle) → { alpha, gamma, thr, I, T } */
  function steady(model, V, o){
    const W = model.mass * G, rho = o.rho || model.rho || RHO_SL, env = { windB:() => [0, 0, 0], rho, soc:o.soc != null ? o.soc : 0.85, h:60, motorOff:!!o.motorOff };
    const f = (al, gam, thr) => { const r = SimPhysics.forces(model, { v:[V * Math.cos(al), 0, V * Math.sin(al)], w:[0, 0, 0] }, { ail:0, ele:0, rud:0, thr, flap:0 }, env), th = al + gam; return { F:[r.F[0] - Math.sin(th) * W, r.F[2] + Math.cos(th) * W], r }; };
    if (o.level) { const x = newton(([al, thr]) => f(al, 0, thr).F.map(v => v / W), [0.06, 0.4], [-0.15, 0], [0.35, 1]); const r = f(x[0], 0, x[1]).r; return { alpha:x[0], gamma:0, thr:x[1], I:r.I, T:r.T }; }
    const x = newton(([al, gam]) => f(al, gam, o.thr).F.map(v => v / W), [0.06, o.thr > 0.5 ? 0.15 : -0.08], [-0.15, -0.8], [0.35, 1.2]); const r = f(x[0], x[1], o.thr).r;
    return { alpha:x[0], gamma:x[1], thr:o.thr, I:r.I, T:r.T, vs:V * Math.sin(x[1]) };
  }
  function topSpeed(model, rho, soc = 0.85){ // level flight at full throttle: excess thrust = 0
    const ex = V => { const W = model.mass * G, env = { windB:() => [0, 0, 0], rho:rho || model.rho, soc, h:60 };
      const al = newton(([a]) => { const r = SimPhysics.forces(model, { v:[V * Math.cos(a), 0, V * Math.sin(a)], w:[0, 0, 0] }, { ail:0, ele:0, rud:0, thr:1, flap:0 }, env); return [(r.F[2] + Math.cos(a) * W) / W]; }, [0.03], [-0.15], [0.35])[0];
      const r = SimPhysics.forces(model, { v:[V * Math.cos(al), 0, V * Math.sin(al)], w:[0, 0, 0] }, { ail:0, ele:0, rud:0, thr:1, flap:0 }, env); return r.F[0] - Math.sin(al) * W; };
    let lo = model.trim.vs * 1.1, hi = model.trim.vs * 6; if (ex(hi) > 0) return hi; if (ex(lo) < 0) return lo;
    for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (ex(m) > 0) lo = m; else hi = m; } return (lo + hi) / 2;
  }
  function stallSpeed(model, rho){ // max lift over α at a reference speed → Vs = √(2W / (ρ S CLmax))
    const V = 8, r0 = rho || model.rho || RHO_SL, q = 0.5 * r0 * V * V, env = { windB:() => [0, 0, 0], rho:r0, soc:0.7, h:60 };
    let best = 0; for (let a = 0; a < 0.5; a += 0.005) { const r = SimPhysics.forces(model, { v:[V * Math.cos(a), 0, V * Math.sin(a)], w:[0, 0, 0] }, { ail:0, ele:0, rud:0, thr:0, flap:0 }, Object.assign({ motorOff:true }, env));
      const L = -(r.F[2] * Math.cos(a) - r.F[0] * Math.sin(a)); if (L > best) best = L; else if (a > 0.05 && L < best * 0.97) break; }
    const CL = best / (q * model.Sref); return Math.sqrt(2 * model.mass * G / (r0 * model.Sref * CL));
  }
  /** Roll rate the way it is measured in a log: a short simulated full-aileron roll from level flight (includes sideslip and dihedral effects). */
  function rollRateDynamic(model, V, ail = 1, dur = 1.6, soc = 0.85, thr = null, phi0 = 0, theta0 = null, rud = 0){
    const lv = steady(model, V, { level:true, soc }), st = { alpha:lv.alpha, gamma:0, thr:thr != null ? thr : lv.thr }, env = new SimPhysics.Environment({ speed:0, rhoFixed:model.rho || RHO_SL }), sim = new SimPhysics.Sim(model, { env });
    sim.reset('air', { alt:80 }); sim.s.q = SimPhysics.quat.fromEuler(phi0 * DEG, theta0 != null ? theta0 * DEG : st.alpha + st.gamma, 0); sim.s.v = [V * Math.cos(st.gamma), 0, -V * Math.sin(st.gamma)]; sim.s.spool = st.thr; sim.s.soc = soc; const ps = []; let prev = null;
    for (let k = 0; k * 6 < dur * 60; k++) { for (let j = 0; j < 6; j++) sim.step(1 / 60, { ail, ele:0, rud, thr:st.thr, flap:0 }); const e = SimPhysics.quat.toEuler(sim.s.q);
      if (prev != null && Math.abs(e.theta) < 50 * DEG) { let d = e.phi - prev; if (Math.abs(d) > Math.PI) d -= 2 * Math.PI * Math.sign(d); ps.push(Math.abs(d) / 0.1 / DEG); } prev = e.phi; } // Euler roll rate at 10 Hz, like the log
    ps.sort((a, b) => a - b); return ps.length ? ps[Math.floor(ps.length * 0.8)] : 0;
  }
  function rollRate(model, V, ail = 1){ // steady roll: Mx(p) = 0 with full aileron at trim α
    const st = steady(model, V, { level:true }), env = { windB:() => [0, 0, 0], rho:model.rho, soc:0.7, h:60 };
    const Mx = p => SimPhysics.forces(model, { v:[V * Math.cos(st.alpha), 0, V * Math.sin(st.alpha)], w:[p, 0, 0] }, { ail, ele:0, rud:0, thr:st.thr, flap:0 }, env).M[0];
    let lo = 0, hi = 30; if (Mx(hi) > 0) return hi / DEG; for (let k = 0; k < 50; k++) { const m = (lo + hi) / 2; if (Mx(m) > 0) lo = m; else hi = m; } return (lo + hi) / 2 / DEG;
  }
  /** Model prediction for one segment, same conditions as measured. */
  function predict(model, seg){
    const V = seg.V || model.trim.V, soc = socFor(model, seg);
    if (seg.type === 'cruise') { const s = steady(model, V, { thr:seg.thr, soc }); return { vsE:s.vs, A:s.I }; }
    if (seg.type === 'climb') { const s = steady(model, seg.V || model.trim.V * 0.9, { thr:seg.thr != null ? seg.thr : 1, soc }); return { vs:s.vs }; }
    if (seg.type === 'glide') { const s = steady(model, V, { thr:0, motorOff:true, soc }); return { LD:-1 / Math.tan(s.gamma), vs:s.vs }; }
    if (seg.type === 'topspeed') return { V:topSpeed(model, null, soc) };
    if (seg.type === 'stall') return { V:stallSpeed(model) };
    if (seg.type === 'roll') return { p:rollRateDynamic(model, seg.V0 || V, (seg.dir || 1) * (seg.ail || 1), Math.min(2.5, Math.max(0.8, (seg.t1 - seg.t0) || 1.6)), soc, seg.thr, seg.phi0 || 0, seg.theta0, seg.rud || 0) };
    if (seg.type === 'endurance') { const s = steady(model, model.trim.V, { level:true, soc:0.6 }); const k = seg.thr / Math.max(0.05, s.thr), I = s.I * k * k; return { min:model.capacity_mAh / 1000 * 0.8 / Math.max(0.05, I) * 60 }; }
    return {};
  }
  /** Relative residuals (prediction vs measurement) for a segment. */
  function residuals(model, seg){
    const p = predict(model, seg), out = [];
    const rel = (k, meas, pred, w = 1, floor = 0.1) => { if (meas != null && isFinite(meas) && pred != null && isFinite(pred)) out.push({ k, meas, pred, w, r:(pred - meas) / Math.max(floor, Math.abs(meas)) }); };
    if (seg.type === 'cruise') { if (seg.vsE != null && p.vsE != null) out.push({ k:'energy rate', meas:seg.vsE, pred:p.vsE, w:1, r:(p.vsE - seg.vsE) / 0.5 }); rel('current', seg.A, p.A, 1, 0.3); }
    if (seg.type === 'climb') rel('climb rate', seg.vs, p.vs, 1, 0.5);
    if (seg.type === 'glide') rel('glide ratio', seg.LD, p.LD, 1, 2);
    if (seg.type === 'topspeed') rel('top speed', seg.V, p.V, 1.5, 2);
    if (seg.type === 'stall') rel('stall speed', seg.V, p.V, 1.5, 2);
    if (seg.type === 'roll') rel('roll rate', seg.p, p.p, 1, 20);
    if (seg.type === 'endurance') rel('flight time', seg.min, p.min, 1, 1);
    return out;
  }
  const DEPS = { cruise:['cd0', 'thrust', 'current'], climb:['cd0', 'thrust'], glide:['cd0'], topspeed:['cd0', 'thrust'], stall:['clmax'], roll:['roll', 'cd0', 'thrust'], endurance:['cd0', 'thrust', 'current'] };
  function score(model, segs, f, lambda, memo){
    model.cal = f; let e = 0, n = 0;
    segs.forEach((s, i) => { const key = i + ':' + (DEPS[s.type] || Object.keys(f)).map(k => f[k].toFixed(4)).join(',');
      let rs = memo && memo.get(key); if (!rs) { rs = residuals(model, s); if (memo) memo.set(key, rs); }
      for (const r of rs) { e += r.w * r.r * r.r; n += r.w; } });
    let reg = 0; for (const F of FACTORS) reg += Math.log(f[F.key]) ** 2;
    return { obj:(n ? e / n : 0) + lambda * reg, rms:n ? Math.sqrt(e / n) : 0 };
  }
  /**
   * fit(design, segs, o) → { factors, before, after, identified, details, confidence }
   * Pattern search on log-factors with bounds and a pull towards 1 (lambda) so one log cannot over-fit.
   */
  function fit(design, segs, o = {}){
    const build = f => { const d = JSON.parse(JSON.stringify(design)); delete d.calibration; const m = SimModel.build(d, { rho:o.rho, calibrated:false }); m.cal = Object.assign({}, f); m.trim = SimModel.trim(m); return m; };
    const lambda = o.lambda != null ? o.lambda : 0.02, f0 = { cd0:1, clmax:1, thrust:1, current:1, roll:1 };
    const model = build(f0), memo = new Map(), base = score(model, segs, Object.assign({}, f0), lambda, memo);
    let f = Object.assign({}, f0), cur = base.obj, step = 0.25;
    const active = FACTORS.filter(F => segs.some(s => relevant(F.key, s)));
    for (let round = 0; round < 60 && step > 0.004; round++) {
      let improved = false;
      for (const F of active) for (const dir of [1, -1]) {
        const g = Object.assign({}, f); g[F.key] = clamp(f[F.key] * Math.exp(dir * step), F.range[0], F.range[1]); if (g[F.key] === f[F.key]) continue;
        const sc = score(model, segs, g, lambda, memo); if (sc.obj < cur - 1e-9) { f = g; cur = sc.obj; improved = true; }
      }
      if (!improved) step *= 0.5;
    }
    const after = score(model, segs, Object.assign({}, f), lambda, memo);
    const details = segs.map(s => ({ seg:s, before:(model.cal = Object.assign({}, f0), residuals(model, s)), after:(model.cal = Object.assign({}, f), residuals(model, s)) }));
    const identified = Object.fromEntries(FACTORS.map(F => [F.key, active.includes(F)]));
    const kinds = new Set(segs.map(s => s.type));
    let conf = Math.min(1, segs.length / 8) * 0.4 + Math.min(1, kinds.size / 5) * 0.3 + (o.meta && o.meta.hasAirspeed ? 0.2 : o.wind && o.wind.quality === 'good' ? 0.15 : 0.05) + (o.meta && o.meta.hasCurrent ? 0.1 : 0);
    if (o.meta && !o.meta.hasAirspeed) conf = Math.min(conf, 0.6); // GPS-only airspeed: wind errors dominate stall speed and roll rate
    if (segs.every(s => s.manual)) conf = Math.min(0.6, 0.12 * segs.length);
    const reliable = Object.fromEntries(FACTORS.map(F => [F.key, identified[F.key] && (o.meta && !o.meta.hasAirspeed ? ['cd0'].includes(F.key) || (F.key === 'current' && o.meta.hasCurrent) : true)]));
    return { factors:f, before:base.rms, after:after.rms, identified, reliable, details, confidence:{ value:conf, label:conf > 0.7 ? 'high' : conf > 0.45 ? 'medium' : 'low' }, model };
  }
  function relevant(k, s){ return { cd0:['cruise', 'glide', 'topspeed', 'climb', 'endurance'], clmax:['stall'], thrust:['climb', 'topspeed', 'cruise'], current:['cruise', 'endurance'], roll:['roll'] }[k].includes(s.type) && (k !== 'current' || s.A != null || s.type === 'endurance'); }

  /** Model predictions along a log (for overlay charts): current and climb rate at each sample's airspeed and throttle. */
  function overlay(model, log, step = 10){
    const out = [];
    for (let i = 0; i < log.rows.length; i += step) { const r = log.rows[i]; if (!isFinite(r.asEst) || r.asEst < 2.5 || !isFinite(r.thr) || (isFinite(r.alt) && r.alt < 3)) continue;
      try { const s = steady(model, r.asEst, { thr:r.thr, motorOff:r.thr < 0.02 }); out.push({ t:r.t, vsLog:r.vs, vsSim:s.vs, ALog:r.A, ASim:s.I }); } catch (e) { /* skip */ } }
    return out;
  }

  /* ---------------- synthetic log (for tests and the "try with a demo log" button) ---------------- */
  function syntheticLog(design, trueFactors, o = {}){
    const d = JSON.parse(JSON.stringify(design)); delete d.calibration;
    const m = SimModel.build(d, { calibrated:false }); m.cal = Object.assign({ cd0:1, clmax:1, thrust:1, current:1, roll:1 }, trueFactors); m.trim = SimModel.trim(m);
    const env = new SimPhysics.Environment({ speed:o.wind != null ? o.wind : 2, dir:270, gustPeak:0, turbulence:0, dirVar:0, seed:5 }); env.dirVar = 0;
    const sim = new SimPhysics.Sim(m, { env }); sim.reset('air', { alt:90, heading:0 }); const ap = new SimPhysics.Autopilot(sim);
    const vc = m.trim.V, rows = [], lat0 = 47.3, lon0 = 8.5, R = 6371000; let t = 0, hdg = 0;
    const record = () => { if (rows.length && t - rows[rows.length - 1].t < 0.1 - 1e-9) return; const s = sim.telemetry(), e = SimPhysics.quat.toEuler(sim.s.q);
      rows.push({ t, lat:lat0 + s.pos[0] / R / DEG, lon:lon0 + s.pos[1] / R / DEG / Math.cos(lat0 * DEG), alt:s.alt + 400, gs:s.Vg, as:o.airspeed ? s.V : undefined,
        roll:e.phi / DEG, pitch:e.theta / DEG, yaw:e.psi / DEG, thr:sim.ctrl.thr, ail:sim.ctrl.ail, ele:sim.ctrl.ele, rud:sim.ctrl.rud, V:s.Vcell * m.cells, A:s.I, mAh:s.mAh }); };
    const fly = (dur, tgf, until) => { const end = t + dur; while (t < end && !sim.s.crashed) { const tl = sim.telemetry(); if (until && until(tl)) break; sim.step(1 / 60, ap.fly(tgf(tl), 1 / 60)); t += 1 / 60; record(); } };
    const turn = () => { hdg = (hdg + 180) % 360; const h0 = sim.telemetry().alt; fly(25, () => ({ phi:28, alt:h0, thr:0.6 }), tl => Math.abs(SimPhysics.wrap180(tl.psi - hdg)) < 10); fly(3, () => ({ heading:hdg, alt:h0, thr:0.55 })); };
    const leg = (dur, tg) => { const h0 = sim.telemetry().alt; fly(dur, () => Object.assign({ heading:hdg }, tg.alt === 'hold' ? Object.assign({}, tg, { alt:h0 }) : tg)); };
    leg(10, { speedOnPitch:vc * 0.9, thr:1 }); turn();
    leg(12, { alt:'hold', thr:0.45 }); turn();
    leg(12, { alt:'hold', thr:0.6 }); turn();
    leg(12, { speedOnPitch:vc * 1.2, thr:0 }); turn();
    leg(18, { alt:'hold', thr:1 }); turn();
    const h1 = sim.telemetry().alt; fly(2.4, () => ({ ail:1, ele:0, thr:0.5 })); fly(4, () => ({ phi:0, theta:2, thr:0.8 })); fly(6, () => ({ phi:0, speed:vc * 1.25, alt:h1 - 8 }));
    const h2 = sim.telemetry().alt; let st = null; fly(18, tl => { if (!st && tl.stall > 0.35) st = t; return st ? { ail:0, ele:0, thr:0 } : { phi:0, alt:h2 + 2, thr:0 }; }, () => st && t > st + 2.5);
    fly(6, () => ({ phi:0, theta:0, thr:0.7 }));
    return normalize(rows, { name:'synthetic test flight', format:'synthetic' });
  }
  /** Write a normalised log as CSV (also re-importable). */
  function toCSV(log){ const keys = ['t', 'lat', 'lon', 'alt', 'gs', 'as', 'roll', 'pitch', 'yaw', 'thr', 'ail', 'ele', 'rud', 'V', 'A', 'mAh'];
    return ['t_s,' + keys.slice(1).join(',')].concat(log.rows.map(r => keys.map(k => isFinite(r[k]) ? (+r[k]).toFixed(k === 'lat' || k === 'lon' ? 7 : 3) : '').join(','))).join('\n'); }

  return { FACTORS, socFor, csv, parse, detect, normalize, estimateWind, segments, analyze, manualSegments, steady, topSpeed, stallSpeed, rollRate, rollRateDynamic, predict, residuals, fit, overlay, syntheticLog, toCSV,
    parsers:{ edgetx:parseEdgeTX, blackbox:parseBlackbox, ardupilot:parseArduPilot, gpx:parseGPX, igc:parseIGC } };
})();
if (typeof module !== 'undefined') module.exports = { SimCalib };
