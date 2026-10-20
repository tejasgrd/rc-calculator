/* RC Calc simulator: lessons, scoring, coaching, demo pilot and the buddy-box instructor (pure, no DOM).
   Field frame NED: runway along x (−45…45 m), centre line y = 0; pilot stands at (6, −16) looking east (+y).
   Depends on rc-core, rc-sim-physics (Autopilot, wrap180). */
'use strict';
const SimLessons = (() => {
  const DEG = Math.PI / 180, clamp = (v, a, b) => Math.max(a, Math.min(b, v)), wrap = a => ((a + 540) % 360) - 180;
  const PILOT = [6, -16];
  const RUNWAY = { x0:-45, x1:45, halfWidth:6 };
  const gatesFrom = (pts, r = 4.5) => pts.map((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; return { p:[p[0], p[1], -p[2]], heading:Math.atan2(b[1] - a[1], b[0] - a[0]) / DEG, r }; });
  const circle = (cx, cy, R, alt, n, a0 = 0, dir = 1) => Array.from({ length:n }, (_, k) => { const a = a0 + dir * 2 * Math.PI * k / n; return [cx + R * Math.cos(a), cy + R * Math.sin(a), alt]; });

  /* ---------------- lesson definitions ---------------- */
  const DEFS = [
    { id:'level', group:'Basics', name:'Straight, level and gentle turns', goal:'Fly through the 4 rings in a big circle. Beginner assist keeps the wings level for you.', kind:'gates', start:'air', startOpts:{ x:0, y:-70, alt:30, heading:0 }, assist:'angle', weather:{ speed:0.5 },
      gates:() => gatesFrom(circle(0, 0, 70, 30, 4, -Math.PI / 2, 1).concat([[0, -70, 30]]).slice(1, 5)), par:60 },
    { id:'orient', group:'Basics', name:'Flying towards you', goal:'When the plane comes towards you, left and right look reversed. Fly through the 4 rings that weave back towards you.', kind:'gates', start:'air', startOpts:{ x:150, y:-30, alt:30, heading:180 }, assist:'level', weather:{ speed:0.5 },
      gates:() => gatesFrom([[115, -40, 28], [80, 5, 26], [45, -35, 24], [12, 0, 22]]), par:40 },
    { id:'takeoff', group:'Basics', name:'Take-off', goal:'Open the throttle smoothly, keep it straight with rudder, lift off gently and climb to 25 m with the wings level.', kind:'takeoff', start:'runway', assist:'level', weather:{ speed:1 }, par:20 },
    { id:'circuit', group:'Basics', name:'Circuits', goal:'Fly the rectangular circuit through all 4 corner rings, twice. This is the pattern you use to land.', kind:'gates', start:'air', startOpts:{ x:-70, y:40, alt:25, heading:0 }, assist:'level', weather:{ speed:1.5 },
      gates:() => gatesFrom([[70, 40, 25], [70, -40, 25], [-70, -40, 25], [-70, 40, 25]]), laps:2, par:110 },
    { id:'landing', group:'Basics', name:'Approach and landing', goal:'Throttle back, line up with the runway and touch down gently (sink under 1.2 m/s) on the runway, then roll to a stop.', kind:'landing', start:'air', startOpts:{ x:-120, y:-45, alt:22, heading:90 }, assist:'level', weather:{ speed:1.5 }, landHeading:0, par:60 },
    { id:'stall', group:'Basics', name:'Stall and recovery', goal:'Close the throttle and hold the nose up until it stalls, then recover: stick forward, wings level, power on. Lose less than 20 m.', kind:'stall', start:'air', startOpts:{ alt:70 }, assist:'off', weather:{ speed:0 }, par:25 },
    { id:'thermal', group:'Basics', name:'Thermal soaring', goal:'Motor off. Find a thermal (faint columns) and circle in it to gain 30 m.', kind:'thermal', start:'air', startOpts:{ alt:50 }, assist:'level', weather:{ speed:1, thermals:true, thermalStrength:2.2, thermalSize:30, thermalCount:5 }, show:true, par:120, motorOff:true },
    { id:'xwind-to', group:'Wind', name:'Crosswind take-off', goal:'A 2 m/s wind blows across the runway (strong for a light plane). Keep straight with rudder, hold a little aileron into the wind, then climb to 25 m.', kind:'takeoff', start:'runway', assist:'off', weather:{ speed:2, dir:90, gustPeak:0.8, turbulence:0.2 }, par:20 },
    { id:'xwind-land', group:'Wind', name:'Crosswind landing', goal:'Crab into the wind on final (nose pointing slightly into it), straighten just before touchdown, land on the runway.', kind:'landing', start:'air', startOpts:{ x:-120, y:-45, alt:22, heading:90 }, assist:'off', weather:{ speed:2, dir:90, gustPeak:0.8, turbulence:0.2 }, landHeading:0, par:60, xwind:true },
    { id:'deadstick', group:'Emergencies', name:'Dead-stick landing', goal:'The motor has stopped. Use your height wisely: turn base early, keep the speed up, and land on the runway.', kind:'landing', start:'air', startOpts:{ x:70, y:45, alt:40, heading:180 }, assist:'level', weather:{ speed:1 }, landHeading:0, failure:{ motor:true }, par:45 },
    { id:'fig8', group:'Precision', name:'Figure eight', goal:'Fly a figure eight in front of you through the 8 rings, keeping the height constant.', kind:'gates', start:'air', startOpts:{ x:-20, y:40, alt:25, heading:30 }, assist:'level', weather:{ speed:1 },
      gates:() => gatesFrom([[0, 60, 25], [40, 95, 25], [80, 60, 25], [40, 25, 25], [0, 60, 25], [-40, 95, 25], [-80, 60, 25], [-40, 25, 25]], 5), par:80 },
    { id:'drill', group:'Precision', name:'Orientation drill', goal:'Rings appear at changing headings, some flying straight at you. Fly through all 6.', kind:'gates', start:'air', startOpts:{ x:0, y:60, alt:28, heading:0 }, assist:'off', weather:{ speed:1 },
      gates:() => gatesFrom([[70, 70, 28], [90, 0, 26], [40, -10, 25], [-30, 30, 27], [-90, 60, 28], [-40, 10, 24]], 5), par:75 },
    { id:'handlaunch', group:'Precision', name:'Hand launch', goal:'Throw into wind at full power, keep the wings level and climb straight through the ring at 15 m.', kind:'gates', start:'hand', assist:'level', weather:{ speed:1.5 }, gates:() => gatesFrom([[45, -12, 15]], 6), par:15 },
    { id:'loop', group:'Aerobatics', name:'Loop', goal:'Dive a little for speed, then pull smoothly and hold full up elevator with wings level until you are back level. Exit at the entry height.', kind:'aero', manoeuvre:'loop', start:'air', startOpts:{ alt:60 }, assist:'off', weather:{ speed:0 }, model:'builtin:aerobat', par:15 },
    { id:'roll', group:'Aerobatics', name:'Axial roll', goal:'Raise the nose a touch, then hold full aileron for one complete roll and level out without losing height.', kind:'aero', manoeuvre:'roll', start:'air', startOpts:{ alt:60 }, assist:'off', weather:{ speed:0 }, model:'builtin:aerobat', par:10 },
    { id:'stallturn', group:'Aerobatics', name:'Stall turn', goal:'Pull to a vertical climb, and as the plane stops apply full rudder so it pivots and points straight down, then pull out.', kind:'aero', manoeuvre:'stallturn', start:'air', startOpts:{ alt:50 }, assist:'off', weather:{ speed:0 }, model:'builtin:aerobat', par:15 },
    { id:'inverted', group:'Aerobatics', name:'Inverted pass', goal:'Roll inverted and hold it for 5 seconds without losing more than 10 m (push forward to hold the nose up), then roll upright.', kind:'aero', manoeuvre:'inverted', start:'air', startOpts:{ alt:60 }, assist:'off', weather:{ speed:0 }, model:'builtin:aerobat', par:18 },
    { id:'fail-servo', group:'Emergencies', name:'Stuck aileron', goal:'The aileron servo has failed at neutral. Steer with rudder only (dihedral rolls the plane) and fly the circuit rings once.', kind:'gates', start:'air', startOpts:{ x:-70, y:40, alt:28, heading:0 }, assist:'off', weather:{ speed:0.5 }, failure:{ stuckAil:0 },
      gates:() => gatesFrom([[70, 40, 28], [70, -40, 28], [-70, -40, 28], [-70, 40, 28]], 6), par:90 },
    { id:'fail-radio', group:'Emergencies', name:'Radio failsafe', goal:'The radio link drops for 3 seconds (throttle off, surfaces neutral). When control returns, recover to level flight and climb back to 35 m.', kind:'failsafe', start:'air', startOpts:{ alt:40 }, assist:'off', weather:{ speed:1, turbulence:0.3 }, failure:{ failsafeAt:4, failsafeFor:3 }, par:20 },
    { id:'fail-battery', group:'Emergencies', name:'Low battery', goal:'The battery is nearly flat and the motor will cut soon. Land on the runway before it does.', kind:'landing', start:'air', startOpts:{ x:-100, y:-50, alt:30, heading:90 }, assist:'level', weather:{ speed:1 }, landHeading:0, failure:{ soc:0.09 }, par:50 },
  ];

  /* ---------------- scoring helpers ---------------- */
  const stars = s => s >= 85 ? 3 : s >= 65 ? 2 : s >= 40 ? 1 : 0;
  class Lesson {
    constructor(def, ctx = {}){
      this.def = def; this.ctx = ctx; this.gates = def.gates ? def.gates() : []; this.gi = 0; this.lap = 0; this.t = 0; this.done = false; this.failed = null;
      this.m = { gateMiss:[], altErr:[], stick:0, stickN:0, prev:null, takeovers:0, maxBank:0, rudSum:0, ailRev:0, lastAilSign:0, alt0:null, extra:{} };
      this.text = def.goal; this.phase = 'start'; this.aero = { start:null, pitchTurn:0, rollTurn:0, invTime:0 };
    }
    /** Setup for the UI / headless runner: { start, startOpts, weather, assist, failure } */
    setup(){ const d = this.def; return { start:d.start, startOpts:Object.assign({}, d.startOpts || {}), weather:Object.assign({ speed:0, dir:270, gustPeak:0, turbulence:0.05, thermals:false, dirVar:5 }, d.weather), assist:d.assist, failure:d.failure || null, show:!!d.show, model:d.model || null }; }
    /** Ideal path (NED points) for the ghost ribbon. */
    path(){
      const d = this.def;
      if (this.gates.length) { const pts = this.gates.map(g => g.p); return (d.laps || 1) > 1 ? pts.concat([pts[0]]) : pts; }
      if (d.kind === 'landing') { const h = (d.landHeading || 0) * DEG, dx = Math.cos(h), td = [-30 * dx, 0]; return [[td[0] - 140 * dx, 0, -14], [td[0] - 70 * dx, 0, -7], [td[0], 0, -0.3], [td[0] + 40 * dx, 0, -0.2]]; }
      return [];
    }
    /** Per-frame update: tele from Sim.telemetry(), ctrl = pilot controls (after assist), who = 'student'|'instructor'. */
    update(t, ctrl, dt, who){
      if (this.done || this.failed) return this.status();
      this.t += dt; const m = this.m, d = this.def;
      if (m.alt0 == null) m.alt0 = t.alt;
      if (ctrl) { if (m.prev) { const r = (Math.abs(ctrl.ail - m.prev.ail) + Math.abs(ctrl.ele - m.prev.ele) + Math.abs(ctrl.rud - m.prev.rud)) / Math.max(1e-3, dt); m.stick += Math.min(30, r); m.stickN++; }
        const s = Math.sign(Math.round(ctrl.ail * 3)); if (s && m.lastAilSign && s !== m.lastAilSign) m.ailRev++; if (s) m.lastAilSign = s; m.rudSum += Math.abs(ctrl.rud) * dt; m.prev = Object.assign({}, ctrl); }
      if (who === 'instructor' && this.lastWho === 'student') m.takeovers++; this.lastWho = who;
      if (!t.onGround) m.maxBank = Math.max(m.maxBank, Math.abs(t.phi));
      if (t.crashed) { this.failed = `Crashed (${t.crashed.reason})`; return this.status(); }
      if (this.t > (d.par || 60) * 4 + 30) { this.failed = 'Out of time'; return this.status(); }
      const f = this['_' + d.kind]; if (f) f.call(this, t, ctrl, dt);
      return this.status();
    }
    status(){ return { text:this.failed ? `${this.failed}. Press R to try again.` : this.text, done:this.done, failed:this.failed, progress:this.progress(), gate:this.gi, lap:this.lap }; }
    progress(){ if (this.done) return 1; if (this.gates.length) return (this.lap * this.gates.length + this.gi) / (this.gates.length * (this.def.laps || 1)); return this.phase === 'start' ? 0 : 0.5; }
    _gates(t){
      const g = this.gates[this.gi], d3 = Math.hypot(t.pos[0] - g.p[0], t.pos[1] - g.p[1], t.pos[2] - g.p[2]);
      this.closest = Math.min(this.closest != null ? this.closest : 1e9, d3);
      const h = (g.heading || 0) * DEG, along = (t.pos[0] - g.p[0]) * Math.cos(h) + (t.pos[1] - g.p[1]) * Math.sin(h);
      if (d3 < g.r * 1.6) { if (!this.armed) this.armedAlt = t.alt; this.armed = true; if (d3 <= this.closest) this.armedAlt = t.alt; }
      if (this.armed && (along > 0 || d3 > this.closest + 1.5)) { this.m.gateMiss.push(this.closest / g.r); this.m.altErr.push(this.armedAlt - (-g.p[2])); this.closest = null; this.armed = false; this.gi++;
        if (this.gi >= this.gates.length) { this.lap++; if (this.lap >= (this.def.laps || 1)) { this.done = true; this.text = 'Lesson complete!'; return; } this.gi = 0; } }
      else if (this.closest != null && d3 > this.closest + 25 && this.closest < 40) { this.m.gateMiss.push(Math.min(5, this.closest / g.r)); this.closest = null; } // passed it: counts as a miss but keep going to that ring
      const gg = this.gates[this.gi], dist = Math.hypot(t.pos[0] - gg.p[0], t.pos[1] - gg.p[1]);
      this.text = `Ring ${this.gi + 1} of ${this.gates.length}${(this.def.laps || 1) > 1 ? ` · lap ${this.lap + 1}/${this.def.laps}` : ''}: ${Math.round(dist)} m away at ${Math.round(-gg.p[2])} m (you: ${Math.round(t.alt)} m)`;
    }
    _takeoff(t){
      const m = this.m; if (t.onGround) { m.extra.groundTime = (m.extra.groundTime || 0) + 1; m.extra.hdgDev = Math.max(m.extra.hdgDev || 0, Math.abs(wrap(t.psi - (this.ctx.runwayHeading || 0)))); }
      if (!t.onGround && t.alt > 1 && this.phase === 'start') this.phase = 'airborne';
      if (t.alt > 25 && Math.abs(t.phi) < 30) { this.done = true; this.text = 'Nice take-off! You reached 25 m.'; return; }
      this.text = t.onGround ? (t.V < 1 ? 'Add throttle smoothly and keep straight with rudder.' : `Rolling at ${t.V.toFixed(1)} m/s: lift off with a little up-elevator when it feels light.`) : `Climbing: ${Math.round(t.alt)} / 25 m. Keep the wings level.`;
    }
    _landing(t){
      const m = this.m;
      if (!t.onGround) this.wasAir = true;
      if (t.onGround && this.wasAir && !m.extra.touch) m.extra.touch = { vs:-t.vs, x:t.pos[0], y:t.pos[1], phi:t.phi, V:t.V };
      const tch = m.extra.touch;
      if (tch) { const onRw = Math.abs(tch.y) < RUNWAY.halfWidth && tch.x > RUNWAY.x0 - 5 && tch.x < RUNWAY.x1 + 5;
        if (!onRw) { this.failed = 'Touched down off the runway'; return; }
        if (tch.vs > 2.5) { this.failed = `Hard landing (sink ${tch.vs.toFixed(1)} m/s)`; return; }
        if (t.Vg < 0.5) { this.done = true; this.text = `Landed! Touchdown sink ${tch.vs.toFixed(2)} m/s, ${Math.abs(tch.y).toFixed(1)} m off the centre line.`; return; }
        this.text = 'Touched down. Throttle closed, keep it straight and roll to a stop.'; return; }
      this.text = `Line up with the runway, throttle back and descend gently. Height ${Math.round(t.alt)} m${this.def.failure && this.def.failure.motor ? ' (no motor!)' : ''}.`;
    }
    _stall(t){
      const m = this.m;
      if (!m.extra.stalled && t.stall > 0.35) m.extra.stalled = { alt:t.alt };
      if (!m.extra.stalled) { this.text = 'Throttle to zero, then slowly pull back and hold until the plane stalls.'; return; }
      m.extra.minAlt = Math.min(m.extra.minAlt != null ? m.extra.minAlt : t.alt, t.alt);
      if (Math.abs(t.phi) < 20 && t.V > (this.ctx.vs || 5) * 1.2 && t.stall < 0.1 && t.vs > -1) { this.done = true; const lost = m.extra.stalled.alt - m.extra.minAlt; m.extra.lost = lost; this.text = lost < 20 ? `Recovered, losing only ${lost.toFixed(0)} m. Excellent!` : `Recovered, but lost ${lost.toFixed(0)} m. Push forward sooner next time.`; return; }
      this.text = 'Stalled! Recover: stick forward, wings level, add power.';
    }
    _thermal(t){ const gain = t.alt - this.m.alt0; this.m.extra.gain = gain; if (gain >= 30) { this.done = true; this.text = `You climbed ${gain.toFixed(0)} m on thermals alone. Soaring!`; return; } this.text = `Height gained: ${gain.toFixed(1)} / 30 m. Circle tightly where the climb is best.`; }
    _failsafe(t){
      const f = this.def.failure, T = this.t, m = this.m;
      if (T < f.failsafeAt) { this.text = 'Fly level… (the link will drop in a moment)'; return; }
      if (T < f.failsafeAt + f.failsafeFor) { this.text = 'LINK LOST: failsafe active (throttle off, surfaces neutral)'; return; }
      if (!m.extra.back) m.extra.back = { t:T, alt:t.alt };
      m.extra.minAlt = Math.min(m.extra.minAlt != null ? m.extra.minAlt : t.alt, t.alt);
      if (Math.abs(t.phi) < 15 && t.alt > 35 && t.vs > -0.5) { this.done = true; m.extra.recoverTime = T - m.extra.back.t; this.text = `Recovered in ${m.extra.recoverTime.toFixed(1)} s.`; return; }
      this.text = `Control is back: level the wings, add power and climb to 35 m (now ${Math.round(t.alt)} m).`;
    }
    _aero(t, ctrl, dt){
      const a = this.aero, man = this.def.manoeuvre;
      if (!a.start) a.start = { alt:t.alt, psi:t.psi };
      a.pitchTurn += Math.abs(t.q) * dt; a.rollTurn += t.p * dt;
      if (man === 'loop') { if (a.pitchTurn > 330 && Math.abs(t.theta) < 20 && Math.abs(t.phi) < 30 && !a.inLoop) { this.done = true; this.m.extra.altErr = Math.abs(t.alt - a.entryAlt); this.m.extra.hdgErr = Math.abs(wrap(t.psi - a.entryPsi)); this.text = 'Loop complete!'; }
        if (!a.inLoopStarted && t.q > 40) { a.inLoopStarted = true; a.entryAlt = t.alt; a.entryPsi = t.psi; a.pitchTurn = 0; }
        if (!a.inLoopStarted) a.pitchTurn = 0;
        this.text = this.done ? this.text : a.inLoopStarted ? `Hold full up elevator, wings level… ${Math.round(Math.min(360, a.pitchTurn))}°` : 'Dive a little for speed, then pull smoothly into the loop.'; }
      if (man === 'roll') { if (!a.rollStarted && Math.abs(t.p) > 60) { a.rollStarted = true; a.entryAlt = t.alt; a.entryPsi = t.psi; a.rollTurn = 0; }
        if (!a.rollStarted) a.rollTurn = 0;
        if (a.rollStarted && Math.abs(a.rollTurn) > 330 && Math.abs(t.phi) < 20) { this.done = true; this.m.extra.altErr = Math.abs(t.alt - a.entryAlt); this.m.extra.hdgErr = Math.abs(wrap(t.psi - a.entryPsi)); this.text = 'Roll complete!'; }
        this.text = this.done ? this.text : a.rollStarted ? `Keep the aileron in… ${Math.round(Math.min(360, Math.abs(a.rollTurn)))}°` : 'Nose up slightly, then full aileron.'; }
      if (man === 'stallturn') { if (t.theta > 70) a.vertical = true; if (a.vertical && t.theta < -60) a.down = true;
        if (a.down && Math.abs(t.theta) < 20 && Math.abs(t.phi) < 40) { this.done = true; this.text = 'Stall turn complete!'; }
        this.text = this.done ? this.text : a.down ? 'Now pull out of the dive.' : a.vertical ? 'Wait until it slows, then full rudder!' : 'Pull up to a vertical climb.'; }
      if (man === 'inverted') { if (Math.abs(t.phi) > 150) { a.invTime += dt; if (a.invAlt == null) a.invAlt = t.alt; a.invMin = Math.min(a.invMin != null ? a.invMin : t.alt, t.alt); } else if (a.invTime < 5) { a.invTime = 0; a.invAlt = null; a.invMin = null; }
        if (a.invTime >= 5 && Math.abs(t.phi) < 25) { const lost = a.invAlt - a.invMin; this.m.extra.lost = lost; if (lost > 10) { this.failed = `Lost ${lost.toFixed(0)} m while inverted`; return; } this.done = true; this.text = 'Inverted pass complete!'; }
        this.text = this.done ? this.text : a.invTime > 0 ? `Inverted ${a.invTime.toFixed(1)} / 5 s: push forward to hold the nose up.` : 'Roll inverted (half a roll) and hold it.'; }
    }
    /** Final score, stars and coaching tips. */
    result(){
      const m = this.m, d = this.def, tips = []; let s = 100;
      if (this.failed || !this.done) return { score:0, stars:0, tips:[(this.failed || 'Not finished') + '.'].concat(this.coach()), time:this.t };
      if (m.gateMiss.length) { const avg = m.gateMiss.reduce((a, b) => a + b, 0) / m.gateMiss.length; s -= clamp((avg - 0.4) * 25, 0, 35); }
      if (m.altErr.length) { const rms = Math.sqrt(m.altErr.reduce((a, b) => a + b * b, 0) / m.altErr.length); s -= clamp((rms - 2) * 2, 0, 20); }
      if (m.extra.touch) { s -= clamp((m.extra.touch.vs - 0.6) * 25, 0, 30); s -= clamp((Math.abs(m.extra.touch.y) - 1.5) * 4, 0, 15); s -= clamp((Math.abs(m.extra.touch.phi) - 5) * 1.5, 0, 10); }
      if (m.extra.lost != null) s -= clamp((m.extra.lost - 8) * 2, 0, 35);
      if (m.extra.altErr != null) s -= clamp((m.extra.altErr - 5) * 2, 0, 25);
      if (m.extra.hdgErr != null) s -= clamp((m.extra.hdgErr - 10) * 0.6, 0, 20);
      if (m.extra.hdgDev != null) s -= clamp((m.extra.hdgDev - 10) * 0.8, 0, 15);
      if (m.extra.recoverTime != null) s -= clamp((m.extra.recoverTime - 6) * 3, 0, 25);
      const smooth = m.stickN ? m.stick / m.stickN : 0; s -= clamp((smooth - 3) * 3, 0, 15);
      s -= m.takeovers * 10;
      s -= clamp((this.t / (d.par || 60) - 1.5) * 10, 0, 15);
      s = Math.round(clamp(s, 5, 100));
      return { score:s, stars:stars(s), tips:this.coach(), time:this.t, metrics:{ smooth, takeovers:m.takeovers, maxBank:m.maxBank, gateMiss:m.gateMiss, touch:m.extra.touch || null } };
    }
    coach(){
      const m = this.m, tips = [], smooth = m.stickN ? m.stick / m.stickN : 0;
      if (m.altErr.length && m.altErr.some(e => e < -4)) tips.push('You lost height in the turns: add a little up-elevator (and power) as you bank.');
      if (m.altErr.length && m.altErr.some(e => e > 5)) tips.push('You were high at some rings: ease the nose down or reduce power on the straights.');
      if (m.gateMiss.some(g => g > 1.6)) tips.push('Plan each ring early: line up from further out so you fly straight through.');
      if (smooth > 4) tips.push('Your stick inputs were busy: small, smooth movements fly better.');
      if (m.ailRev > Math.max(8, this.t / 3)) tips.push('The wings were rocking (many aileron reversals): hold the stick still once the bank is set.');
      if (m.maxBank > 60 && this.def.kind !== 'aero') tips.push(`Bank reached ${Math.round(m.maxBank)}°: keep turns under about 45° while learning.`);
      if (m.extra.touch && m.extra.touch.vs > 1.2) tips.push(`Touchdown sink was ${m.extra.touch.vs.toFixed(1)} m/s: start the flare (gentle up-elevator) about 1 m above the runway.`);
      if (m.extra.touch && Math.abs(m.extra.touch.y) > 3) tips.push('You drifted off the centre line: line up earlier and use small rudder/aileron corrections on final.');
      if (m.extra.hdgDev > 15) tips.push('The take-off run wandered: use more rudder early, before the plane picks up speed.');
      if (m.extra.lost > 20) tips.push('Recover from the stall sooner: release back pressure as soon as the nose drops.');
      if (m.takeovers) tips.push(`The instructor had to take over ${m.takeovers} time${m.takeovers > 1 ? 's' : ''}. Keep an eye on bank, height and speed.`);
      if (m.rudSum > this.t * 0.4 && this.def.kind === 'gates' && !(this.def.failure && this.def.failure.stuckAil != null)) tips.push('Lots of rudder: in normal turns, roll with aileron and use only a little rudder.');
      if (!tips.length) tips.push('Clean flying: try it with less assist, or more wind.');
      return tips.slice(0, 4);
    }
  }

  /* ---------------- demo pilot: flies every lesson (proves achievability, powers "Show me") ---------------- */
  class DemoPilot {
    constructor(sim, lesson){ this.sim = sim; this.L = lesson; this.ap = new SimPhysics.Autopilot(sim); this.st = {}; }
    fly(dt){
      const t = this.sim.telemetry(), L = this.L, d = L.def, m = this.sim.model, vt = m.trim.V, vs = m.trim.vs, ap = this.ap, st = this.st;
      const toward = (x, y) => Math.atan2(y - t.pos[1], x - t.pos[0]) / DEG;
      if (L.done || (L.gates.length && L.gi >= L.gates.length)) return t.onGround ? { ail:0, ele:0, rud:0, thr:0, flap:0 } : ap.fly({ heading:st.endHdg != null ? st.endHdg : (st.endHdg = t.psi), alt:Math.max(25, t.alt), speed:vt * 1.2 }, dt);
      if (d.kind === 'gates' && L.gates.length) {
        const g = L.gates[L.gi], h = g.heading * DEG, lead = Math.max(0, Math.min(25, Math.hypot(t.pos[0] - g.p[0], t.pos[1] - g.p[1]) - 12));
        const ax = g.p[0] - Math.cos(h) * lead, ay = g.p[1] - Math.sin(h) * lead;
        const tg = { heading:toward(ax, ay), alt:-g.p[2], speed:vt * 1.35 };
        if (d.failure && d.failure.stuckAil != null) { const c = ap.fly(tg, dt), phiCmd = clamp(1.2 * wrap(tg.heading - t.psi), -25, 25); c.rud = clamp(0.06 * (phiCmd - t.phi) - 0.01 * t.p, -1, 1); c.ail = 0; return c; }
        if (d.start === 'hand' && t.alt < 6) return { ail:clamp(-0.03 * t.phi, -1, 1), ele:clamp(0.05 * (8 - t.theta) - 0.01 * t.q, -1, 1), rud:0, thr:1, flap:0 };
        return ap.fly(tg, dt);
      }
      if (d.kind === 'takeoff') {
        const hd = L.ctx.runwayHeading || 0;
        if (t.onGround || t.alt < 2) { const c = { ail:clamp(-0.04 * t.phi, -1, 1), ele:t.V > vs * 1.35 ? 0.4 : 0, rud:clamp(0.08 * wrap(hd - t.psi), -1, 1), thr:1, flap:0 }; return c; }
        return ap.fly({ heading:hd, theta:10, thr:1, phi:undefined }, dt);
      }
      if (d.kind === 'landing') return this.landing(t, dt);
      if (d.kind === 'stall') { if (!st.stalled && t.stall > 0.35) st.stalled = true; if (!st.stalled) return ap.fly({ alt:L.m.alt0 != null ? L.m.alt0 : t.alt, thr:0, phi:0 }, dt); return ap.fly({ theta:-5, phi:0, thr:0.9 }, dt); }
      if (d.kind === 'thermal') {
        const th = (this.sim.env.thermalList || []).slice().sort((a, b) => (Math.hypot(a.x - t.pos[0], a.y - t.pos[1]) - 60 * a.w) - (Math.hypot(b.x - t.pos[0], b.y - t.pos[1]) - 60 * b.w))[0];
        if (!th) return ap.fly({ phi:0, speedOnPitch:vt * 1.1, thr:0 }, dt);
        const dist = Math.hypot(th.x - t.pos[0], th.y - t.pos[1]);
        if (dist > th.R * 0.5) st.circling = false; else if (dist < th.R * 0.22) st.circling = true; // re-centre: fly to the core, then circle tightly
        if (!st.circling) return ap.fly({ heading:toward(th.x, th.y), speedOnPitch:vt * 1.05, thr:0 }, dt);
        return ap.fly({ phi:35, speedOnPitch:vt * 1.05, thr:0 }, dt);
      }
      if (d.kind === 'failsafe') { if (L.t < (d.failure.failsafeAt || 4)) return ap.fly({ alt:L.m.alt0 != null ? L.m.alt0 : t.alt, phi:0, speed:vt * 1.2 }, dt); return ap.fly({ phi:0, theta:t.alt < 35 ? 8 : 2, thr:0.9 }, dt); }
      if (d.kind === 'aero') return this.aero(t, dt);
      return ap.fly({ phi:0, alt:30, speed:vt * 1.2 }, dt);
    }
    landing(t, dt){
      const L = this.L, d = L.def, ap = this.ap, m = this.sim.model, vt = m.trim.V, vs = m.trim.vs, h = (d.landHeading || 0) * DEG, dx = Math.cos(h), st = this.st;
      const deadstick = !!(d.failure && (d.failure.motor || (d.failure.soc && this.sim.s.soc < 0.04))), tdX = (deadstick ? -40 : -30) * dx, along = (t.pos[0] - tdX) * dx, cross = t.pos[1];
      if (t.onGround) return { ail:clamp(-0.05 * t.phi, -1, 1), ele:0.1, rud:clamp(0.08 * wrap(d.landHeading - t.psi), -1, 1), thr:0, flap:0, brake:true };
      if (!st.final) {
        const fx = tdX - (deadstick ? 60 : 110) * dx, close = Math.hypot(t.pos[0] - fx, t.pos[1]);
        if ((close < 18 && Math.abs(cross) < 8) || (along > -(deadstick ? 70 : 120) && along < -25 && Math.abs(cross) < 6)) { st.final = true; st.ci = 0; }
        const target = close > 40 ? { x:fx - 30 * dx, y:0 } : { x:fx, y:0 };
        if (deadstick) { // energy planning: glide distance available vs distance still to fly
          const avail = Math.max(0, t.alt - 1) * 7.5, need = Math.hypot(t.pos[0] - target.x, t.pos[1] - target.y) + 60 + (close > 40 ? 30 : 0);
          if (avail > need + 30) st.extend = true; else if (avail < need + 8) st.extend = false;
          if (st.extend) return ap.fly({ heading:d.landHeading + 180 + (Math.abs(t.pos[1]) < 35 ? 25 * Math.sign(t.pos[1] || 1) : 0), speedOnPitch:vs * 1.35, thr:0 }, dt);
        }
        return ap.fly({ heading:Math.atan2(target.y - t.pos[1], target.x - t.pos[0]) / DEG, alt:deadstick ? undefined : 16, speedOnPitch:deadstick ? vt * 1.15 : undefined, speed:deadstick ? undefined : vt * 1.2, thr:deadstick ? 0 : undefined }, dt);
      }
      st.ci = clamp((st.ci || 0) + cross * dx * dt, -60, 60); const hdgCmd = d.landHeading - clamp(2.4 * cross * dx + 0.25 * st.ci, -40, 40);
      if (t.alt < 2.2) { const thFlare = clamp(1 + (-t.vs - 0.25) * 9, -1, 10); return Object.assign(ap.fly({ heading:d.landHeading - clamp(1.5 * cross * dx, -10, 10), theta:thFlare, thr:0 }, dt), { thr:0 }); } // flare: pitch up in proportion to sink rate
      const glide = Math.max(1.2, -along * Math.tan(6 * DEG));
      if (deadstick) { const excess = t.alt - Math.max(0, -along * Math.tan(8 * DEG)), sturn = excess > 3 && along < -12 ? 50 * Math.sign(Math.sin(L.t * 0.35)) : 0;
        return ap.fly({ heading:hdgCmd + sturn, speedOnPitch:vs * (excess > 2 ? 1.75 : 1.35), thr:0 }, dt); }
      const vApp = vs * (d.xwind ? 1.5 : 1.3);
      return deadstick ? ap.fly({ heading:hdgCmd, speedOnPitch:vs * 1.35, thr:0 }, dt) : ap.fly({ heading:hdgCmd, alt:glide, speed:vApp }, dt);
    }
    aero(t, dt){
      const d = this.L.def, ap = this.ap, st = this.st, vt = this.sim.model.trim.V;
      if (d.manoeuvre === 'loop') { if (!st.go) { if (t.V > vt * 2) st.go = true; return ap.fly({ theta:-12, phi:0, thr:1 }, dt); }
        if (!st.over && this.L.aero.pitchTurn > 300) st.over = true; if (st.over && Math.abs(t.theta) < 15) return ap.fly({ theta:0, phi:0, thr:0.6 }, dt);
        return { ail:clamp(0.03 * (t.theta > 80 || t.theta < -80 ? 0 : -t.phi * (Math.abs(t.phi) > 90 ? 0 : 1)), -1, 1), ele:1, rud:0, thr:1, flap:0 }; }
      if (d.manoeuvre === 'roll') { if (!st.go) { if (t.V > vt * 1.7 && t.theta > 6) st.go = true; return ap.fly(t.V > vt * 1.7 ? { theta:12, phi:0, thr:1 } : { theta:-6, phi:0, thr:1 }, dt); }
        if (Math.abs(this.L.aero.rollTurn) > 320) return ap.fly({ phi:0, theta:0, thr:0.7 }, dt); return { ail:1, ele:Math.abs(t.phi) > 90 ? -0.25 : 0.1, rud:0, thr:1, flap:0 }; }
      // body-axis references: world "up" seen from the aircraft (continuous through vertical and inverted)
      const up = SimPhysics.quat.qinvrot(this.sim.s.q, [0, 0, -1]), elevErr = Math.atan2(-up[2], up[0]) / DEG, rollB = Math.atan2(-up[1], -up[2]) / DEG, qd = this.sim.s.w[1] / DEG, pd = this.sim.s.w[0] / DEG;
      if (d.manoeuvre === 'stallturn') {
        if (!st.speed) { if (t.V > vt * 1.9) st.speed = true; return ap.fly({ theta:-15, phi:0, thr:1 }, dt); }
        if (!st.up) { if (up[0] > 0.96) st.up = true; return { ail:clamp(-0.03 * t.phi, -1, 1), ele:up[0] > 0.8 ? clamp(0.05 * elevErr - 0.01 * qd, -1, 1) : 1, rud:0, thr:1, flap:0 }; }
        if (!st.kick && up[0] < 0.55) { st.kick = true; st.down = true; } // fell off the vertical line: just recover
        if (!st.kick) { if ((t.V < vt * 0.55 || t.vs < 2) && up[0] > 0.9) { st.kick = true; st.kickT = this.L.t; } const yawErr = Math.atan2(up[1], up[0]) / DEG, rd = this.sim.s.w[2] / DEG; // vertical line: elevator for pitch tilt, rudder for yaw tilt, ailerons only stop the roll
          return { ail:clamp(-0.012 * pd, -1, 1), ele:clamp(0.05 * elevErr - 0.01 * qd, -1, 1), rud:clamp(0.05 * yawErr - 0.01 * rd, -1, 1), thr:t.V > vt ? 0.15 : 0.45, flap:0 }; }
        if (!st.down) { if (up[0] < -0.6 || this.L.t - (st.kickT || 0) > 2.2) st.down = true; return { ail:clamp(-0.012 * pd, -1, 1), ele:0, rud:1, thr:0.35, flap:0 }; }
        if (up[0] < -0.3) { const rd = this.sim.s.w[2] / DEG; // stop the rotation, let speed build, then pull out (pulling too early spins it)
          return { ail:clamp(-0.012 * pd, -1, 1), ele:t.V < this.sim.model.trim.vs * 1.6 ? 0 : 0.6, rud:clamp(-0.03 * rd, -1, 1), thr:0.2, flap:0 }; }
        return ap.fly({ theta:2, phi:0, thr:0.6 }, dt);
      }
      if (d.manoeuvre === 'inverted') {
        const alt0 = this.L.m.alt0 != null ? this.L.m.alt0 : t.alt;
        if (!st.go) { if (t.V > vt * 1.6) st.go = true; return ap.fly({ alt:alt0 + 3, phi:0, thr:1 }, dt); }
        const doneInv = this.L.aero.invTime >= 5.3;
        if (doneInv) { const e = SimPhysics.wrap180(0 - rollB); return Math.abs(rollB) > 25 ? { ail:clamp(0.03 * e, -1, 1), ele:0, rud:0, thr:0.8, flap:0 } : ap.fly({ phi:0, theta:2, thr:0.7 }, dt); }
        const e = SimPhysics.wrap180(180 - rollB);
        if (Math.abs(rollB) < 150) return { ail:1, ele:Math.abs(rollB) > 90 ? -0.3 : 0.1, rud:0, thr:1, flap:0 };
        const thetaCmd = clamp(4 + 0.6 * (alt0 - t.alt) - 1.5 * t.vs, -5, 15); // inverted: push (negative elevator) raises the nose
        return { ail:clamp(0.03 * e - 0.005 * pd, -1, 1), ele:clamp(-0.08 * (thetaCmd - t.theta) - 0.012 * qd, -1, 1), rud:0, thr:1, flap:0 };
      }
      return ap.fly({ phi:0, theta:0, thr:0.6 }, dt);
    }
  }

  /* ---------------- buddy-box instructor ---------------- */
  const LIMITS = { bank:60, pitchMin:-35, pitchMax:40, minAlt:8, minSpeedFactor:1.15 };
  class Instructor {
    constructor(sim, o = {}){ this.sim = sim; this.mode = o.mode || 'off'; this.limits = Object.assign({}, LIMITS, o.limits || {}); this.ap = new SimPhysics.Autopilot(sim); this.has = 'student'; this.stable = 0; this.reason = ''; this.holdAlt = 35; }
    danger(t){ const L = this.limits, vs = this.sim.model.trim.vs;
      if (t.onGround || t.alt < 1.5) return 0;
      return clamp(Math.max((Math.abs(t.phi) - L.bank * 0.6) / (L.bank * 0.4), (t.theta - L.pitchMax * 0.65) / (L.pitchMax * 0.35), (L.pitchMin * 0.6 - t.theta) / (-L.pitchMin * 0.4), (L.minAlt + 10 - t.alt) / 10 * (t.vs < 0 ? 1 : 0.3), (vs * (L.minSpeedFactor + 0.2) - t.V) / (vs * 0.25)), 0, 1); }
    exceeded(t){ const L = this.limits; if (t.onGround || t.alt < 1.5) return null;
      if (Math.abs(t.phi) > L.bank) return `bank ${Math.round(Math.abs(t.phi))}°`; if (t.theta > L.pitchMax) return 'nose too high'; if (t.theta < L.pitchMin) return 'diving'; if (t.alt < L.minAlt && t.vs < -0.5) return 'too low'; if (t.V < this.sim.model.trim.vs * L.minSpeedFactor && t.alt > 3) return 'too slow';
      return null; }
    /** The instructor's own controls: recover, then hold a safe circle over the field. */
    advice(t, dt){
      const ap = this.ap, vt = this.sim.model.trim.V;
      if (Math.abs(t.phi) > 100) return { ail:t.phi > 0 ? 1 : -1, ele:0, rud:0, thr:t.theta < -20 ? 0.2 : 0.6, flap:0 };
      if (t.theta < -25) return ap.fly({ phi:0, theta:5, thr:0.2 }, dt);
      const far = Math.hypot(t.pos[0] - PILOT[0], t.pos[1] - PILOT[1]) > 110, alt = Math.max(this.holdAlt, 25);
      return ap.fly({ heading:far ? Math.atan2(30 - t.pos[1], 0 - t.pos[0]) / DEG : undefined, phi:far ? undefined : (t.alt < 20 ? 0 : 12), alt:t.alt < alt - 8 ? undefined : alt, theta:t.alt < alt - 8 ? 10 : undefined, speed:vt * 1.3 }, dt);
    }
    /** studentHeld: the student switch/button is held (for 'switch' mode). Returns { ctrl, who, reason, hint }. */
    update(student, studentHeld, dt){
      const t = this.sim.telemetry(), adv = this.advice(t, dt);
      if (this.mode === 'off') return { ctrl:student, who:'student', hint:adv };
      if (this.mode === 'switch') { this.has = studentHeld ? 'student' : 'instructor'; this.reason = studentHeld ? '' : 'release = instructor flies'; }
      else if (this.mode === 'auto') {
        const ex = this.exceeded(t);
        if (this.has === 'student' && ex) { this.has = 'instructor'; this.reason = ex; this.stable = 0; }
        if (this.has === 'instructor') { const ok = Math.abs(t.phi) < 15 && Math.abs(t.theta) < 15 && t.V > this.sim.model.trim.vs * 1.3 && t.alt > this.limits.minAlt + 8; this.stable = ok ? this.stable + dt : 0;
          const centred = Math.abs(student.ail) < 0.2 && Math.abs(student.ele) < 0.2 && Math.abs(student.rud) < 0.3; if (this.stable > 1.5 && centred) { this.has = 'student'; this.reason = ''; } }
      } else if (this.mode === 'shared') {
        const k = this.danger(t), mix = (a, b) => a * (1 - k) + b * k;
        return { ctrl:{ ail:mix(student.ail, adv.ail), ele:mix(student.ele, adv.ele), rud:mix(student.rud, adv.rud), thr:Math.max(student.thr * (1 - k), adv.thr * k), flap:student.flap }, who:k > 0.5 ? 'instructor' : 'student', share:k, reason:k > 0.05 ? 'helping' : '', hint:adv };
      }
      return { ctrl:this.has === 'instructor' ? Object.assign({}, adv, { flap:student.flap }) : student, who:this.has, reason:this.reason, hint:adv };
    }
  }

  /* ---------------- headless runner (tests) ---------------- */
  function runDemo(model, id, o = {}){
    const def = DEFS.find(d => d.id === id), L = new Lesson(def, { vs:model.trim.vs, runwayHeading:o.runwayHeading || 0 }), su = L.setup();
    const env = new SimPhysics.Environment(Object.assign({ seed:o.seed || 3 }, su.weather)); env.dirVar = su.weather.dirVar || 0;
    const sim = new SimPhysics.Sim(model, { env }); let start = su.start; if (start === 'runway' && model.gear === 'none') start = 'hand';
    sim.ctrl.thr = start === 'hand' ? 1 : 0; sim.reset(start, Object.assign({ heading:o.runwayHeading || 0, alt:40 }, su.startOpts));
    if (start === 'runway') { sim.s.p[0] = -30; }
    if (su.failure) applyFailure(sim, su.failure, 0);
    const pilot = new DemoPilot(sim, L), dt = 1 / 60; let st = L.status();
    for (let k = 0; k < 60 * ((def.par || 60) * 4 + 20) && !st.done && !st.failed; k++) {
      if (su.failure) applyFailure(sim, su.failure, L.t);
      const c = pilot.fly(dt); if (o.noise) { const n = o.noise, r = () => (Math.sin(k * 0.37 + n * 11) + Math.sin(k * 0.91)) * 0.5; c.ail = clamp(c.ail + n * r(), -1, 1); c.ele = clamp(c.ele + n * 0.5 * Math.sin(k * 0.53), -1, 1); }
      sim.step(dt, c); st = L.update(sim.telemetry(), c, dt, 'student');
      if (o.trace && k % (o.every || 30) === 0) o.trace(sim.telemetry(), c, L, pilot);
    }
    return { status:st, result:L.result(), t:L.t, sim };
  }
  function applyFailure(sim, f, t){
    if (f.motor) sim.failures.motor = true;
    if (f.stuckAil != null) sim.failures.stuckAil = f.stuckAil;
    if (f.failsafeAt != null) sim.failures.failsafeUntil = t >= f.failsafeAt ? Math.min(sim.failures.failsafeUntil != null ? sim.failures.failsafeUntil : Infinity, sim.s.t - t + f.failsafeAt + f.failsafeFor) : null;
    if (f.soc != null && !sim.failures.socSet) { sim.s.soc = f.soc; sim.failures.socSet = true; }
  }
  return { DEFS, Lesson, DemoPilot, Instructor, LIMITS, runDemo, applyFailure, stars, PILOT, RUNWAY };
})();
if (typeof module !== 'undefined') module.exports = { SimLessons };
