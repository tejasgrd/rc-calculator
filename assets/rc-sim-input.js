/* RC Calc simulator input: Xbox/standard gamepads, any USB RC-transmitter adapter (via a mapping wizard),
   keyboard and on-screen sticks. Pure helpers (shape/map/wizard) + a small DOM InputManager. */
'use strict';
const SimInput = (() => {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  /** Expo + rate: y = rate·((1−e)x + e·x³), with a small deadband. */
  function shape(x, expo = 0, rate = 1, dead = 0.02){ const s = Math.sign(x), a = Math.abs(x); const d = a < dead ? 0 : (a - dead) / (1 - dead); const v = s * d; return clamp(rate * ((1 - expo) * v + expo * v * v * v), -1, 1); }
  const defaultTuning = () => ({ expo:{ ail:0.3, ele:0.3, rud:0.2 }, rate:{ ail:1, ele:1, rud:1 }, lowRate:0.6, dual:false });

  /** Read a channel description {src:'axis'|'button', index, min, max, center, invert, unipolar}. Returns −1..1 (or 0..1 if unipolar). */
  function readChannel(ch, axes, buttons){
    if (!ch) return 0;
    let raw = ch.src === 'button' ? (buttons[ch.index] ? (buttons[ch.index].value != null ? buttons[ch.index].value : +buttons[ch.index].pressed) : 0) : (axes[ch.index] || 0);
    if (ch.unipolar) { let u = (raw - ch.min) / ((ch.max - ch.min) || 1); u = clamp(u, 0, 1); return ch.invert ? 1 - u : u; }
    const c = ch.center != null ? ch.center : 0;
    let v = raw >= c ? (raw - c) / ((ch.max - c) || 1) : -(c - raw) / ((c - ch.min) || 1);
    v = clamp(v, -1, 1); return ch.invert ? -v : v;
  }
  /** Standard-mapping gamepads (Xbox One S, etc.). Mode 2: left = throttle/rudder, right = aileron/elevator. */
  function standardProfile(id){
    return { id, name:'Gamepad (standard layout)', kind:'standard', mode:2, thrMode:'trigger', invertEle:false,
      buttons:{ reset:0, rescue:1, camera:2, assist:3, student:4, flaps:12, slowmo:5, cut:6, pause:9, launch:8 }, tuning:defaultTuning() };
  }
  function readStandard(gp, prof, state, dt){
    const ax = gp.axes, bt = gp.buttons, m2 = prof.mode !== 1;
    const lx = ax[0] || 0, ly = ax[1] || 0, rx = ax[2] || 0, ry = ax[3] || 0;
    const out = { ail:m2 ? rx : rx, ele:(m2 ? ry : ly) * (prof.invertEle ? -1 : 1), rud:lx };
    const thrAxis = m2 ? ly : ry;
    if (prof.thrMode === 'trigger') state.thr = bt[7] ? bt[7].value : 0;
    else if (prof.thrMode === 'stick-direct') state.thr = clamp((1 - thrAxis) / 2, 0, 1);
    else state.thr = clamp((state.thr || 0) - shape(thrAxis, 0, 1, 0.12) * dt * 0.9, 0, 1);
    out.thr = state.thr;
    const pressed = i => !!(bt[i] && bt[i].pressed);
    out.btn = {}; for (const [k, i] of Object.entries(prof.buttons)) out.btn[k] = pressed(i);
    return out;
  }
  function readCustom(gp, prof){
    const ax = gp.axes, bt = gp.buttons, m = prof.map, out = { ail:readChannel(m.ail, ax, bt), ele:readChannel(m.ele, ax, bt), rud:readChannel(m.rud, ax, bt), thr:readChannel(m.thr, ax, bt) };
    out.btn = {}; for (const [k, s] of Object.entries(prof.switches || {})) { const v = s.src === 'button' ? !!(bt[s.index] && bt[s.index].pressed) : (ax[s.index] || 0) * (s.sign || 1) > 0.5; out.btn[k] = v; }
    return out;
  }

  /* ---------- mapping wizard (pure: feed it axis/button arrays every frame) ---------- */
  const WIZARD_STEPS = [
    { key:'center', text:'Centre the aileron, elevator and rudder sticks and put the throttle all the way DOWN. Then press Next.' },
    { key:'thr', text:'Move the THROTTLE stick all the way up, then hold it fully UP and press Next.' },
    { key:'ail', text:'Move the AILERON stick (roll) fully left and right, then hold it fully RIGHT and press Next.' },
    { key:'ele', text:'Move the ELEVATOR stick fully up and down, then hold it fully BACK (towards you, nose-up) and press Next.' },
    { key:'rud', text:'Move the RUDDER stick fully left and right, then hold it fully RIGHT and press Next.' },
    { key:'reset', text:'Optional: flip the switch you want to use for RESET (or press Skip).', optional:true },
    { key:'assist', text:'Optional: flip the switch you want for AUTO-LEVEL assist (or press Skip).', optional:true },
    { key:'student', text:'Optional: hold the switch or button you want as the STUDENT switch for buddy-box training (or press Skip).', optional:true },
  ];
  class MappingWizard {
    constructor(id){ this.id = id; this.step = 0; this.base = null; this.map = {}; this.switches = {}; this.reset(); }
    reset(){ this.lo = []; this.hi = []; this.last = null; this.lastB = null; this.baseB = null; }
    get current(){ return WIZARD_STEPS[this.step]; }
    get done(){ return this.step >= WIZARD_STEPS.length; }
    feed(axes, buttons){
      const a = Array.from(axes), b = Array.from(buttons || []).map(x => (x && x.value != null ? x.value : +(x && x.pressed)) || 0);
      a.forEach((v, i) => { this.lo[i] = Math.min(this.lo[i] != null ? this.lo[i] : v, v); this.hi[i] = Math.max(this.hi[i] != null ? this.hi[i] : v, v); });
      this.last = a; this.lastB = b; if (!this.baseB) this.baseB = b.slice();
    }
    used(){ return new Set(Object.values(this.map).filter(c => c && c.src === 'axis').map(c => c.index)); }
    next(skip = false){
      const st = this.current; if (!st || !this.last) { if (st && st.optional && skip) { this.step++; this.reset(); } return { ok:!!skip, msg:'No controller input seen yet' }; }
      if (st.key === 'center') { this.base = this.last.slice(); this.baseB0 = this.lastB.slice(); this.step++; this.reset(); return { ok:true }; }
      if (st.optional && skip) { this.step++; this.reset(); return { ok:true }; }
      if (st.optional) {
        const bi = this.lastB.findIndex((v, i) => Math.abs(v - (this.baseB0[i] || 0)) > 0.5);
        if (bi >= 0) { this.switches[st.key] = { src:'button', index:bi }; this.step++; this.reset(); return { ok:true }; }
        const used = this.used(), ai = this.last.map((v, i) => ({ i, d:v - this.base[i] })).filter(x => !used.has(x.i) && Math.abs(x.d) > 0.6).sort((p, q) => Math.abs(q.d) - Math.abs(p.d))[0];
        if (ai) { this.switches[st.key] = { src:'axis', index:ai.i, sign:Math.sign(this.last[ai.i]) || 1 }; this.step++; this.reset(); return { ok:true }; }
        return { ok:false, msg:'No switch change detected: flip it, or press Skip' };
      }
      const used = this.used();
      const cand = this.lo.map((lo, i) => ({ i, range:(this.hi[i] - lo) || 0 })).filter(c => !used.has(c.i)).sort((p, q) => q.range - p.range)[0];
      if (!cand || cand.range < 0.4) return { ok:false, msg:'Not enough stick movement detected: move the stick through its full range, then hold it at the end' };
      const i = cand.i, min = this.lo[i], max = this.hi[i], end = this.last[i];
      if (st.key === 'thr') { const low = this.base[i]; this.map.thr = { src:'axis', index:i, min:Math.min(low, end), max:Math.max(low, end), unipolar:true, invert:end < low }; }
      else { const center = this.base[i], invert = end < center; this.map[st.key] = { src:'axis', index:i, min, max, center, invert }; }
      this.step++; this.reset(); return { ok:true, axis:i };
    }
    profile(name){ return { id:this.id, name:name || 'RC transmitter', kind:'custom', map:this.map, switches:this.switches, tuning:defaultTuning() }; }
  }

  /* ---------- keyboard ---------- */
  function readKeyboard(keys, state, dt){
    const k = c => keys.has(c), axis = (neg, pos) => (k(pos) ? 1 : 0) - (k(neg) ? 1 : 0);
    const target = { ail:axis('ArrowLeft', 'ArrowRight'), ele:axis('ArrowUp', 'ArrowDown'), rud:axis('KeyA', 'KeyD') };
    state.kb = state.kb || { ail:0, ele:0, rud:0 };
    for (const a of ['ail', 'ele', 'rud']) { const t = target[a], c = state.kb[a]; state.kb[a] = c + clamp(t - c, -dt * 4, dt * 4); } // smooth keys like a stick
    const dthr = (k('KeyW') || k('ShiftLeft') ? 1 : 0) - (k('KeyS') || k('ControlLeft') ? 1 : 0);
    state.thr = clamp((state.thr || 0) + dthr * dt * 0.7, 0, 1);
    return { ail:state.kb.ail, ele:state.kb.ele, rud:state.kb.rud, thr:state.thr, btn:{} };
  }

  /* ---------- DOM manager ---------- */
  const STORE = 'rcSim.input.v1';
  class InputManager {
    constructor(o = {}){
      this.keys = new Set(); this.state = { thr:0 }; this.active = 'keyboard'; this.prevBtn = {}; this.virtual = { ail:0, ele:0, rud:0, thr:null, on:false };
      this.saved = (() => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; } })();
      this.saved.profiles = this.saved.profiles || {}; this.saved.tuning = this.saved.tuning || defaultTuning(); this.saved.prefs = this.saved.prefs || { mode:2, thrMode:'trigger', invertEle:false };
      this.wizard = null; this.lastPadId = null;
      window.addEventListener('keydown', e => { if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return; if (/^Arrow|^Key[WASD]$|Space/.test(e.code)) e.preventDefault(); this.keys.add(e.code); this.active = 'keyboard'; if (o.onKey) o.onKey(e); });
      window.addEventListener('keyup', e => this.keys.delete(e.code));
      window.addEventListener('blur', () => this.keys.clear());
      window.addEventListener('gamepadconnected', e => { this.lastPadId = e.gamepad.id; if (o.onPad) o.onPad(e.gamepad, true); });
      window.addEventListener('gamepaddisconnected', e => { if (o.onPad) o.onPad(e.gamepad, false); });
    }
    save(){ try { localStorage.setItem(STORE, JSON.stringify(this.saved)); } catch (e) { /* storage unavailable */ } }
    pads(){ try { return Array.from(navigator.getGamepads ? navigator.getGamepads() : []).filter(Boolean); } catch (e) { return []; } }
    profileFor(gp){
      if (this.saved.profiles[gp.id]) return this.saved.profiles[gp.id];
      if (gp.mapping === 'standard') return Object.assign(standardProfile(gp.id), this.saved.prefs);
      return null; // needs the wizard
    }
    startWizard(gp){ this.wizard = new MappingWizard(gp.id); this.wizardPad = gp.id; return this.wizard; }
    finishWizard(name){ const p = this.wizard.profile(name); this.saved.profiles[p.id] = p; this.save(); this.wizard = null; return p; }
    forget(id){ delete this.saved.profiles[id]; this.save(); }
    /** Poll everything; returns { ail, ele, rud, thr, source, edges:{reset,...}, held:{...} } */
    read(dt){
      const tun = this.saved.tuning, pads = this.pads();
      let raw = null, source = 'keyboard', padName = null, needsSetup = null;
      for (const gp of pads) {
        if (this.wizard && gp.id === this.wizardPad) { this.wizard.feed(gp.axes, gp.buttons); continue; }
        const prof = this.profileFor(gp);
        if (!prof) { needsSetup = gp; continue; }
        const r = prof.kind === 'standard' ? readStandard(gp, prof, this.state, dt) : readCustom(gp, prof);
        const moved = Math.abs(r.ail) + Math.abs(r.ele) + Math.abs(r.rud) > 0.15 || Object.values(r.btn).some(Boolean) || (prof.kind === 'custom');
        if (moved || this.active === gp.id) { this.active = gp.id; raw = r; source = prof.kind === 'standard' ? 'gamepad' : 'transmitter'; padName = gp.id; break; }
      }
      if (!raw && this.virtual.on) { raw = { ail:this.virtual.ail, ele:this.virtual.ele, rud:this.virtual.rud, thr:this.virtual.thr != null ? this.virtual.thr : this.state.thr, btn:{} }; source = 'touch'; }
      if (!raw || this.active === 'keyboard') { const kb = readKeyboard(this.keys, this.state, dt); if (!raw || Math.abs(kb.ail) + Math.abs(kb.ele) + Math.abs(kb.rud) > 0.01 || this.keys.size) { raw = Object.assign(kb, { btn:raw ? raw.btn : {} }); source = 'keyboard'; } }
      const dual = tun.dual ? tun.lowRate : 1;
      const out = { ail:shape(raw.ail, tun.expo.ail, tun.rate.ail * dual), ele:shape(raw.ele, tun.expo.ele, tun.rate.ele * dual), rud:shape(raw.rud, tun.expo.rud, tun.rate.rud * dual), thr:clamp(raw.thr, 0, 1), source, padName, needsSetup, raw };
      out.edges = {}; out.held = raw.btn || {};
      for (const [k, v] of Object.entries(out.held)) { if (v && !this.prevBtn[k]) out.edges[k] = true; }
      this.prevBtn = Object.assign({}, out.held);
      if (out.held.cut) out.thr = 0;
      return out;
    }
  }
  return { shape, readChannel, standardProfile, readStandard, readCustom, MappingWizard, WIZARD_STEPS, readKeyboard, InputManager, defaultTuning };
})();
if (typeof module !== 'undefined') module.exports = { SimInput };
