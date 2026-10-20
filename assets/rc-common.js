/* RC Calc shared UI helpers: icon sprite, theme, shared unit system, toast, downloads, base64 hand-off.
   Classic script (no modules) so every page works from file://. */
'use strict';
(function(){
  const ICONS = {
    logo:'<path d="M16 3v26M4 15l12-4 12 4M10 26l6-2 6 2M16 3c1.2 1.4 1.6 3 1.6 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="16" cy="13" r="2.2" fill="currentColor"/>',
    weight:'<path d="M5 9h14l2 11H3z"/><path d="M9 9a3 3 0 0 1 6 0"/>',
    wing:'<path d="M12 3v18M3 12l9-3 9 3M8 20l4-1.5 4 1.5"/>',
    style:'<path d="M3 17c4-9 8-9 9-5s5 4 9-5"/>',
    gauge:'<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-5"/>',
    bolt:'<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    battery:'<rect x="2.5" y="7" width="17" height="10" rx="2"/><path d="M21.5 10.5v3M7 10v4M11 10v4"/>',
    c:'<path d="M16 8.5a5 5 0 1 0 0 7"/><path d="M3 12h2M19 12h2"/>',
    thrust:'<path d="M3 12h14M13 7l5 5-5 5M3 7h4M3 17h4"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    rpm:'<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v4h-4"/>',
    prop:'<circle cx="12" cy="12" r="1.6"/><path d="M12 10.4C10.5 6 11.2 3 12 2c.8 1 1.5 4 0 8.4zM12 13.6c1.5 4.4.8 7.4 0 8.4-.8-1-1.5-4 0-8.4z"/>',
    motor:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/><path d="M12 4v5.5M12 14.5V20M4 12h5.5M14.5 12H20"/>',
    chip:'<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
    servo:'<rect x="3" y="9" width="18" height="9" rx="1.5"/><circle cx="8" cy="9" r="2.5"/><path d="M8 9l7-5"/>',
    antenna:'<rect x="5" y="14" width="14" height="7" rx="1.5"/><path d="M12 14V7M8.5 5.5a5 5 0 0 1 7 0M6 3a8.5 8.5 0 0 1 12 0"/>',
    ratio:'<path d="M5 19 19 5"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
    wl:'<path d="M3 17h18M8 5v8M16 5v8M5.5 10.5 8 13l2.5-2.5M13.5 10.5 16 13l2.5-2.5"/>',
    ruler:'<path d="M3 16 16 3l5 5L8 21z"/><path d="M7 12l2 2M10 9l2 2M13 6l2 2"/>',
    warn:'<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    check:'<path d="M4 12.5 9.5 18 20 6"/>',
    x:'<path d="M6 6l12 12M18 6 6 18"/>',
    download:'<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>',
    print:'<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3"/><rect x="7" y="14" width="10" height="7"/>',
    link:'<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon:'<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
    reset:'<path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 4v4h4"/>',
    flask:'<path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3"/><path d="M7 15h10"/>',
    swap:'<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
    magic:'<path d="M4 20 15 9M14 4v3M18 6l-2 2M20 10h-3M9 4l1 2M18 14l2 1"/>',
    book:'<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M8 7h7"/>',
    lock:'<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    cube:'<path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="M3 7l9 5 9-5M12 12v10"/>',
    airfoil:'<path d="M2 13c3-5 10-6 20-1-9 2-15 3-20 1z"/>',
    target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
    chart:'<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/>',
    scissors:'<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.1 8.1 20 20M8.1 15.9 20 4"/>',
    list:'<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    save:'<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>',
    upload:'<path d="M12 20V9M7 14l5-5 5 5M4 4h16"/>',
    trash:'<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/>',
    play:'<path d="M7 4v16l13-8z"/>',
    pause:'<path d="M7 4h4v16H7zM14 4h4v16h-4z"/>',
    layers:'<path d="M12 3 2 8l10 5 10-5z"/><path d="M2 13l10 5 10-5"/>',
  };
  function injectSprite(){
    if (document.getElementById('rc-sprite')) return;
    const box = document.createElement('div');
    box.innerHTML = '<svg id="rc-sprite" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>' +
      Object.entries(ICONS).map(([k, v]) => k === 'logo' ? `<symbol id="i-${k}" viewBox="0 0 32 32">${v}</symbol>` : `<symbol id="i-${k}" viewBox="0 0 24 24">${v}</symbol>`).join('') + '</defs></svg>';
    document.body.insertBefore(box.firstChild, document.body.firstChild);
  }

  const THEME_KEY = 'rcCalc.theme', UNITS_KEY = 'rcUnits.system';
  const themeListeners = [];
  const store = {
    get(k, fallback = null){ try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; } },
    set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    getRaw(k){ try { return localStorage.getItem(k); } catch (e) { return null; } },
    setRaw(k, v){ try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } },
  };
  function effectiveDark(){ const t = document.documentElement.getAttribute('data-theme'); return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; }
  function syncThemeButton(){
    const b = document.getElementById('theme-toggle'); if (!b) return;
    const dark = effectiveDark();
    b.setAttribute('aria-pressed', String(dark)); b.setAttribute('aria-label', dark ? 'Use light theme' : 'Use dark theme'); b.title = b.getAttribute('aria-label');
    const u = b.querySelector('use'); if (u) u.setAttribute('href', dark ? '#i-sun' : '#i-moon');
  }
  function toggleTheme(){
    const next = effectiveDark() ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    store.setRaw(THEME_KEY, next);
    syncThemeButton(); themeListeners.forEach(f => f());
  }
  function unitSystem(){ const v = store.getRaw(UNITS_KEY); return v === 'imperial' ? 'imperial' : 'metric'; }
  function setUnitSystem(sys){ store.setRaw(UNITS_KEY, sys); }

  let toastTimer = null;
  function toast(msg){
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite'); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }
  function download(blob, name){ const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); }
  function b64urlEncode(str){ const bytes = new TextEncoder().encode(str); let bin = ''; bytes.forEach(b => bin += String.fromCharCode(b)); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function b64urlDecode(s){ s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const bin = atob(s); return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))); }
  function readHash(prefix){ try { if (location.hash.startsWith('#' + prefix + '=')) return JSON.parse(b64urlDecode(location.hash.slice(prefix.length + 2))); } catch (e) { /* bad hash */ } return null; }
  function icon(id){ return `<span class="ico"><svg aria-hidden="true"><use href="#i-${id}"/></svg></span>`; }
  function svgToPng(svg, scale, name, done){
    const m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/), w = +m[1], h = +m[2], img = new Image();
    img.onload = () => {
      try { const c = document.createElement('canvas'); c.width = Math.round(w * scale); c.height = Math.round(h * scale); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(b => { if (b) { download(b, name); done && done(true); } else done && done(false); }, 'image/png'); } catch (e) { done && done(false); }
    };
    img.onerror = () => done && done(false);
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  function navHighlight(selector){
    const links = [...document.querySelectorAll(selector)], secs = links.map(a => document.getElementById(a.getAttribute('href').split('#')[1])).filter(Boolean);
    if (!secs.length) return;
    const on = () => { let cur = secs[0]; for (const s of secs) if (s.getBoundingClientRect().top < 160) cur = s;
      links.forEach(a => { const act = a.getAttribute('href').split('#')[1] === cur.id; a.classList.toggle('active', act); if (act) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); }); };
    window.addEventListener('scroll', on, { passive:true }); on();
  }
  function initChrome(){
    injectSprite();
    const b = document.getElementById('theme-toggle'); if (b) b.addEventListener('click', toggleTheme);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { syncThemeButton(); themeListeners.forEach(f => f()); });
    syncThemeButton();
  }
  window.RC = { store, toast, download, b64urlEncode, b64urlDecode, readHash, icon, svgToPng, navHighlight, initChrome, injectSprite,
    effectiveDark, toggleTheme, syncThemeButton, onThemeChange:f => themeListeners.push(f), unitSystem, setUnitSystem,
    KEYS:{ calc:'rcCalc.v1', design:'rcDesign.v1', designs:'rcDesigns.v1', motors:'rcMotors.v1', parts:'rcParts.v1', build:'rcBuild.v1' } };
})();
