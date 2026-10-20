// Generates small sample logs in each supported format from one synthetic flight (run: node tests/make-fixtures.mjs).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, '..', 'assets'), out = join(here, 'fixtures');
mkdirSync(out, { recursive:true });
const ctx = vm.createContext({ console, Math, JSON, Intl, Date });
for (const f of ['rc-core.js', 'rc-aero.js', 'rc-sim-model.js', 'rc-sim-physics.js', 'rc-sim-calib.js']) vm.runInContext(readFileSync(join(root, f), 'utf8'), ctx, { filename:f });
const log = vm.runInContext(`SimCalib.syntheticLog(SimModel.builtinDesign('trainer'), { cd0:1.3, clmax:0.9, thrust:0.85, current:1.12, roll:1.2 }, { airspeed:true })`, ctx);
const rows = log.rows.filter((r, i) => i % 2 === 0); // 5 Hz keeps the files small
const pad = (n, w = 2) => String(Math.floor(n)).padStart(w, '0'), hms = t => `${pad(10 + t / 3600)}:${pad((t / 60) % 60)}:${pad(t % 60)}.${pad((t % 1) * 1000, 3)}`, D = Math.PI / 180, alt0 = 400;
// EdgeTX / OpenTX SD-card log
writeFileSync(join(out, 'edgetx.csv'), ['Date,Time,Alt(m),GSpd(kts),ASpd(kts),Roll(rad),Ptch(rad),Yaw(rad),VFAS(V),Curr(A),Capa(mAh),GPS,Ail,Ele,Thr,Rud']
  .concat(rows.map(r => ['2026-10-20', hms(r.t), (r.alt).toFixed(1), (r.gs / 0.514444).toFixed(2), (r.as / 0.514444).toFixed(2), (r.roll * D).toFixed(3), (r.pitch * D).toFixed(3), (r.yaw * D).toFixed(3), r.V.toFixed(2), r.A.toFixed(2), Math.round(r.mAh),
    `${r.lat.toFixed(6)} ${r.lon.toFixed(6)}`, Math.round(r.ail * 1024), Math.round(r.ele * 1024), Math.round(r.thr * 2048 - 1024), Math.round(r.rud * 1024)].join(','))).join('\n'));
// INAV / Betaflight blackbox_decode CSV
writeFileSync(join(out, 'blackbox.csv'), ['"loopIteration","time (us)","rcCommand[0]","rcCommand[1]","rcCommand[2]","rcCommand[3]","attitude[0]","attitude[1]","attitude[2]","BaroAlt (cm)","vbat (V)","amperage (A)","GPS_coord[0]","GPS_coord[1]","GPS_speed (m/s)","airSpeed"']
  .concat(rows.map((r, i) => [i, Math.round(r.t * 1e6), Math.round(r.ail * 500), Math.round(r.ele * 500), Math.round(r.rud * 500), Math.round(1000 + r.thr * 1000), Math.round(r.roll * 10), Math.round(-r.pitch * 10), Math.round(((r.yaw + 360) % 360) * 10),
    Math.round(r.alt * 100), r.V.toFixed(2), r.A.toFixed(2), Math.round(r.lat * 1e7), Math.round(r.lon * 1e7), r.gs.toFixed(2), Math.round(r.as * 100)].join(','))).join('\n'));
// ArduPilot text dataflash log
const ap = ['FMT, 128, 89, FMT, BBnNZ, Type,Length,Name,Format,Columns', 'FMT, 1, 0, ATT, Qfff, TimeUS,Roll,Pitch,Yaw', 'FMT, 2, 0, GPS, QLLff, TimeUS,Lat,Lng,Alt,Spd', 'FMT, 3, 0, BARO, Qf, TimeUS,Alt',
  'FMT, 4, 0, BAT, Qfff, TimeUS,Volt,Curr,CurrTot', 'FMT, 5, 0, RCIN, Qhhhh, TimeUS,C1,C2,C3,C4', 'FMT, 6, 0, ARSP, Qf, TimeUS,Airspeed'];
rows.forEach(r => { const us = Math.round(r.t * 1e6); ap.push(`ATT, ${us}, ${r.roll.toFixed(2)}, ${r.pitch.toFixed(2)}, ${((r.yaw + 360) % 360).toFixed(2)}`, `GPS, ${us}, ${r.lat.toFixed(7)}, ${r.lon.toFixed(7)}, ${(r.alt + alt0).toFixed(2)}, ${r.gs.toFixed(2)}`,
  `BARO, ${us}, ${r.alt.toFixed(2)}`, `BAT, ${us}, ${r.V.toFixed(2)}, ${r.A.toFixed(2)}, ${r.mAh.toFixed(1)}`, `RCIN, ${us}, ${Math.round(1500 + r.ail * 500)}, ${Math.round(1500 - r.ele * 500)}, ${Math.round(1000 + r.thr * 1000)}, ${Math.round(1500 + r.rud * 500)}`, `ARSP, ${us}, ${r.as.toFixed(2)}`); });
writeFileSync(join(out, 'ardupilot.log'), ap.join('\n'));
// GPX track
const iso = t => new Date(Date.UTC(2026, 9, 20, 10, 0, 0) + t * 1000).toISOString();
writeFileSync(join(out, 'track.gpx'), `<?xml version="1.0"?>\n<gpx version="1.1" creator="RC Calc fixture"><trk><trkseg>\n${rows.map(r => `<trkpt lat="${r.lat.toFixed(7)}" lon="${r.lon.toFixed(7)}"><ele>${(r.alt + alt0).toFixed(1)}</ele><time>${iso(r.t)}</time></trkpt>`).join('\n')}\n</trkseg></trk></gpx>`);
// IGC (1 Hz B records)
const igc = ['AXXX RC Calc fixture', 'HFDTE201026'];
rows.filter((r, i) => i % 5 === 0).forEach(r => { const t = 36000 + r.t, la = Math.abs(r.lat), lo = Math.abs(r.lon), dm = (v, w) => pad(Math.floor(v), w) + pad(Math.round((v % 1) * 60000), 5);
  igc.push(`B${pad(t / 3600)}${pad((t / 60) % 60)}${pad(t % 60)}${dm(la, 2)}${r.lat >= 0 ? 'N' : 'S'}${dm(lo, 3)}${r.lon >= 0 ? 'E' : 'W'}A${pad(r.alt + alt0, 5)}${pad(r.alt + alt0, 5)}`); });
writeFileSync(join(out, 'flight.igc'), igc.join('\n'));
writeFileSync(join(out, 'truth.json'), JSON.stringify({ design:'builtin trainer', factors:{ cd0:1.3, clmax:0.9, thrust:0.85, current:1.12, roll:1.2 }, duration:log.meta.duration, maxAlt:Math.max(...log.rows.map(r => r.alt)) }, null, 1));
console.log('fixtures written to', out, rows.length, 'rows');
