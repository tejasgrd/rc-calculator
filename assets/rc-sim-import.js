/* RC Calc simulator: 3D model import (glTF/GLB, OBJ, STL), alignment, moving-part mapping, IndexedDB storage,
   and .rcsim model packages (flight data + 3D model + part mapping). Requires window.THREE with loaders. */
'use strict';
const SimImport = (() => {
  const T = () => window.THREE;
  const DB = 'rcSim', STORE = 'models', MAX_TRIS = 300000;
  /* ---------- IndexedDB (large binary models do not fit in localStorage) ---------- */
  function db(){ return new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath:'id' }); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  async function tx(mode, fn){ const d = await db(); return new Promise((res, rej) => { const t = d.transaction(STORE, mode), s = t.objectStore(STORE), out = fn(s); t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = () => rej(t.error); }); }
  const put = rec => tx('readwrite', s => s.put(rec)), del = id => tx('readwrite', s => s.delete(id));
  async function list(){ const d = await db(); return new Promise((res, rej) => { const r = d.transaction(STORE).objectStore(STORE).getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); }); }
  async function get(id){ const d = await db(); return new Promise((res, rej) => { const r = d.transaction(STORE).objectStore(STORE).get(id); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

  /* ---------- parsing ---------- */
  function typeOf(name){ const m = /\.([a-z0-9]+)$/i.exec(name || ''); return m ? m[1].toLowerCase() : ''; }
  const base = n => decodeURIComponent(String(n || '').split(/[\\/]/).pop().split('?')[0]).toLowerCase();
  const MAIN_ORDER = ['rcsim', 'glb', 'gltf', 'obj', 'stl', 'json'];
  /** Pick the main model from a multi-file selection; everything else (.bin, textures, .mtl, licence.txt) becomes an extra. */
  function pickMain(names){ return names.slice().sort((a, b) => (MAIN_ORDER.indexOf(typeOf(a)) + 99) % 99 - (MAIN_ORDER.indexOf(typeOf(b)) + 99) % 99).find(n => MAIN_ORDER.includes(typeOf(n))) || null; }
  const MIME = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp', ktx2:'image/ktx2', bin:'application/octet-stream' };
  function blobUrls(extras){ const urls = {}; for (const [n, b] of Object.entries(extras || {})) urls[base(n)] = URL.createObjectURL(new Blob([b], { type:MIME[typeOf(n)] || 'application/octet-stream' })); return urls; }
  /** Wavefront .mtl → { name: { color:[r,g,b], opacity, shininess, emissive, map } } (enough for colours and simple textures). */
  function parseMTL(text){
    const out = {}; let cur = null;
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.trim(); if (!line || line[0] === '#') continue; const [k, ...rest] = line.split(/\s+/), v = rest.map(Number), key = k.toLowerCase();
      if (key === 'newmtl') { cur = out[rest.join(' ')] = { color:[0.8, 0.8, 0.8], opacity:1, shininess:0 }; continue; }
      if (!cur) continue;
      if (key === 'kd') cur.color = v.slice(0, 3); else if (key === 'ke') cur.emissive = v.slice(0, 3); else if (key === 'ns') cur.shininess = v[0];
      else if (key === 'd') cur.opacity = v[0]; else if (key === 'tr') cur.opacity = 1 - v[0];
      else if (key === 'map_kd') cur.map = rest.filter(x => !x.startsWith('-')).pop();
    }
    return out;
  }
  function applyMTL(obj, mtl, urls){
    const THREE = T(), cache = {};
    const make = name => { if (cache[name]) return cache[name]; const m = mtl[name]; if (!m) return null;
      const mat = new THREE.MeshStandardMaterial({ name, color:new THREE.Color(m.color[0], m.color[1], m.color[2]), roughness:clamp(1 - Math.sqrt(m.shininess / 1000), 0.25, 1), metalness:0, transparent:m.opacity < 1, opacity:m.opacity });
      if (m.emissive) mat.emissive = new THREE.Color(m.emissive[0], m.emissive[1], m.emissive[2]);
      const u = m.map && urls[base(m.map)]; if (u) { const tex = new THREE.TextureLoader().load(u, () => { mat.needsUpdate = true; }); tex.colorSpace = THREE.SRGBColorSpace; mat.map = tex; mat.color.set(0xffffff); }
      return (cache[name] = mat); };
    let n = 0; obj.traverse(o => { if (!o.isMesh) return; const swap = m => { const r = m && make(m.name); if (r) n++; return r || m; }; o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material); });
    return n;
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  /** Licence / attribution from glTF asset fields (Sketchfab puts author/license/source/title in asset.extras) or a licence text file. */
  function metaFrom(asset, extras){
    const m = {}, x = (asset && asset.extras) || {};
    if (x.title) m.title = String(x.title); if (x.author) m.author = String(x.author); if (x.license) m.license = String(x.license); if (x.source) m.source = String(x.source);
    if (asset && asset.copyright) m.copyright = String(asset.copyright); if (asset && asset.generator) m.generator = String(asset.generator);
    const lic = Object.keys(extras || {}).find(n => /licen[cs]e|attribution|readme|credits/i.test(n) && /\.(txt|md)$/i.test(n));
    if (lic) { const t = new TextDecoder().decode(extras[lic]).slice(0, 4000); m.licenseText = t.slice(0, 600);
      const g = re => { const r = re.exec(t); return r ? r[1].trim().slice(0, 120) : null; };
      m.title = m.title || g(/\btitle[ \t]*:[ \t]*([^\n]+)/i);
      m.license = m.license || g(/licen[cs]e(?: type)?(?:d under|[ \t]*:)[ \t]*([^\n]+)/i) || g(/\b(CC[- ](?:BY|0)[\w\- .]*\d\.\d)/i);
      m.author = m.author || g(/(?:author|creator)[ \t]*:[ \t]*([^\n]+)/i) || g(/"[^"\n]+"[ \t]*\([^)\n]*\)[ \t]*by[ \t]+([^\n(]+)/i);
      m.source = m.source || g(/(https?:\/\/[^\s)]+)/i); }
    for (const k of Object.keys(m)) if (!m[k]) delete m[k];
    return m;
  }
  /** Parse a model; extras = { fileName: ArrayBuffer } for multi-file glTF (.bin/textures) and OBJ (.mtl/textures). Result has userData.meta. */
  function parse(buffer, type, extras){
    const THREE = T(), urls = blobUrls(extras), done = () => setTimeout(() => Object.values(urls).forEach(u => URL.revokeObjectURL(u)), 15000);
    return new Promise((res, rej) => {
      try {
        if (type === 'glb' || type === 'gltf') {
          if (type === 'gltf') { let j = null; try { j = JSON.parse(new TextDecoder().decode(buffer)); } catch (e) { /* GLTFLoader reports it */ }
            const need = j ? [].concat(j.buffers || [], j.images || []).map(x => x.uri).filter(u => u && !/^data:/.test(u)) : [], miss = need.filter(u => !urls[base(u)]);
            if (miss.length) { done(); rej(new Error(`This .gltf needs ${miss.map(base).join(', ')}: select ${miss.length > 1 ? 'them' : 'it'} together with the .gltf (or use a single-file .glb)`)); return; } }
          const mgr = new THREE.LoadingManager(); mgr.setURLModifier(u => (/^(data|blob):/.test(u) ? u : urls[base(u)] || u));
          new THREE.GLTFLoader(mgr).parse(type === 'gltf' ? new TextDecoder().decode(buffer) : buffer, '', g => { g.scene.userData.meta = metaFrom(g.asset, extras); done(); res(g.scene); },
            e => { done(); rej(new Error('Could not read this glTF file: ' + (e && e.message || e) + (type === 'gltf' ? '. If it uses separate .bin or texture files, select them together with the .gltf.' : ''))); });
        } else if (type === 'obj') {
          const text = new TextDecoder().decode(buffer), obj = new THREE.OBJLoader().parse(text), lib = /^\s*mtllib\s+(.+)$/m.exec(text);
          const mtlName = Object.keys(extras || {}).find(n => typeOf(n) === 'mtl' && (!lib || base(n) === base(lib[1].trim()))) || Object.keys(extras || {}).find(n => typeOf(n) === 'mtl');
          obj.userData.mtlMatched = mtlName ? applyMTL(obj, parseMTL(new TextDecoder().decode(extras[mtlName])), urls) : 0;
          obj.userData.mtlWanted = lib ? lib[1].trim() : null; obj.userData.meta = metaFrom(null, extras); done(); res(obj);
        }
        else if (type === 'stl') { const geo = new THREE.STLLoader().parse(buffer); geo.computeVertexNormals(); const g = new THREE.Group(); g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color:0xd8dee6, roughness:0.6 }))); g.userData.meta = metaFrom(null, extras); done(); res(g); }
        else { done(); rej(new Error('Unsupported file type. Use .glb, .gltf, .obj or .stl')); }
      } catch (e) { done(); rej(e); }
    });
  }
  /** Read a FileList into { main:{name,type,data}, extras:{name:ArrayBuffer} }. */
  async function readFiles(files){
    const list = Array.from(files), mainName = pickMain(list.map(f => f.name)); if (!mainName) throw new Error('No 3D model in the selection (.glb, .gltf, .obj, .stl or .rcsim)');
    const extras = {}; let main = null;
    for (const f of list) { const data = await readFile(f); if (f.name === mainName && !main) main = { name:f.name, type:typeOf(f.name), data, file:f }; else extras[f.name] = data; }
    return { main, extras };
  }
  const safeUrl = u => (/^https?:\/\//i.test(u || '') ? u : null);
  /** One-line credit, e.g. "“Cub” by Jane (CC-BY-4.0)". */
  function credit(meta){ if (!meta) return ''; const parts = []; if (meta.title) parts.push(`“${meta.title}”`); if (meta.author) parts.push(`by ${meta.author}`); let s = parts.join(' '); if (meta.license) s += ` (${meta.license})`; if (!s && meta.copyright) s = meta.copyright; return s.trim(); }
  function stats(obj){ let tris = 0, meshes = 0; obj.traverse(o => { if (o.isMesh && o.geometry) { meshes++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } }); return { tris:Math.round(tris), meshes }; }
  const ROLE_RE = [['aileron', /ail(eron)?/i], ['elevon', /elevon/i], ['elevator', /elev(ator)?|stab.*(flap|move)/i], ['rudder', /rud(der)?/i], ['flap', /\bflap/i], ['prop', /prop(eller)?|spinner|blade/i]];
  function guessRole(name){ for (const [r, re] of ROLE_RE) if (re.test(name || '')) return r; return null; }
  function sideOf(name, x){ if (/(^|[_\s.\-])(l|left|lh)([_\s.\-]|$)|left/i.test(name || '')) return -1; if (/(^|[_\s.\-])(r|right|rh)([_\s.\-]|$)|right/i.test(name || '')) return 1; return x >= 0 ? 1 : -1; }
  /** Named nodes that look like moving parts (for the mapping UI). */
  function candidates(obj){ const out = []; obj.traverse(o => { if (o === obj) return; if ((o.isMesh || o.children.length) && o.name) out.push({ name:o.name, uuid:o.uuid, role:guessRole(o.name) }); }); return out.slice(0, 200); }
  const AXES = { '+X':[1, 0, 0], '-X':[-1, 0, 0], '+Y':[0, 1, 0], '-Y':[0, -1, 0], '+Z':[0, 0, 1], '-Z':[0, 0, -1] };

  /**
   * prepare(obj, align, flight): orient + scale + place an imported object over a flight model and set up moving parts.
   * align: { forward:'+X'..., up:'+Y'..., span:metres|null, dx, dy, dz (metres), map:{uuid: role} }
   * flight: SimModel model (for span & CG). Returns a `visual` for SimWorld.setAircraft.
   */
  function prepare(obj, align, flight){
    const THREE = T();
    const f = new THREE.Vector3(...AXES[align.forward || '-Z']), u = new THREE.Vector3(...AXES[align.up || '+Y']);
    if (Math.abs(f.dot(u)) > 0.5) throw new Error('Forward and up axes must be different');
    const r = new THREE.Vector3().crossVectors(f, u);
    const m = new THREE.Matrix4().set(r.x, r.y, r.z, 0, u.x, u.y, u.z, 0, -f.x, -f.y, -f.z, 0, 0, 0, 0, 1);
    const holder = new THREE.Group(), inner = new THREE.Group(); inner.add(obj); inner.applyMatrix4(m); holder.add(inner);
    holder.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(holder), size = box.getSize(new THREE.Vector3());
    const span = align.span || flight.geom.span, k = span / Math.max(1e-6, size.x);
    inner.scale.multiplyScalar(k); holder.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(holder); size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    // default: nose at the flight model's nose (CG is cgGeo[0] behind the nose), centred left/right and vertically
    const noseZ = -flight.cgGeo[0];
    inner.position.add(new THREE.Vector3(-c.x + (align.dx || 0), -c.y + (align.dy || 0), noseZ - box.min.z + (align.dz || 0)));
    holder.updateMatrixWorld(true);
    holder.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material && o.material.isMeshBasicMaterial) o.material = new THREE.MeshStandardMaterial({ color:o.material.color, map:o.material.map }); } });
    // moving parts → pivots at their leading edge (hinge)
    const surfaces = [], map = align.map || {};
    const nodes = []; holder.traverse(o => { if (map[o.uuid] || (align.autoMap !== false && !map.__manual && guessRole(o.name))) nodes.push(o); });
    const isAnc = (a, b) => { for (let p = b.parent; p; p = p.parent) if (p === a) return true; return false; };
    const top = nodes.filter(n => !nodes.some(o => o !== n && isAnc(o, n)));
    for (const node of top) {
      const role = map[node.uuid] || guessRole(node.name); if (!role || role === 'none') continue;
      const nb = new THREE.Box3().setFromObject(node), nc = nb.getCenter(new THREE.Vector3()), ns = nb.getSize(new THREE.Vector3());
      let axis, hinge;
      if (role === 'prop') { axis = new THREE.Vector3(0, 0, -1); hinge = nc.clone(); }
      else if (role === 'rudder') { axis = new THREE.Vector3(0, 1, 0); hinge = new THREE.Vector3(nc.x, nc.y, nb.min.z); }
      else { axis = new THREE.Vector3(1, 0, 0); hinge = new THREE.Vector3(nc.x, nc.y, nb.min.z); }
      const pivot = new THREE.Group(); pivot.position.copy(hinge);
      const parent = node.parent; holder.attach(node); // keep world transform
      holder.add(pivot); pivot.attach(node);
      surfaces.push({ role, side:sideOf(node.name, nc.x), pivot, axis, sign:1, mesh:node, imported:true, size:ns });
      void parent;
    }
    return { object:holder, surfaces, stats:stats(holder) };
  }
  async function readFile(file){ return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsArrayBuffer(file); }); }
  function toB64(buf){ const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }
  function fromB64(s){ const bin = atob(s), b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b.buffer; }
  /** .rcsim package: one JSON file with flight design + optional 3D model + alignment/mapping. */
  function packageModel(rec){ const ex = {}; for (const [n, b] of Object.entries(rec.extras || {})) ex[n] = toB64(b);
    return JSON.stringify({ format:'rcsim-model', version:2, name:rec.name, meta:rec.meta || {}, design:rec.design, visual:rec.data ? { fileName:rec.fileName, type:rec.type, align:rec.align, data:toB64(rec.data), extras:ex } : null }); }
  function unpackage(text){ const j = JSON.parse(text); if (j.format !== 'rcsim-model') throw new Error('Not an RC Calc model package'); return { id:'m' + Date.now(), name:j.name || 'Imported model', design:j.design, fileName:j.visual && j.visual.fileName, type:j.visual && j.visual.type, align:j.visual ? j.visual.align : null, data:j.visual ? fromB64(j.visual.data) : null, extras:j.visual && j.visual.extras ? Object.fromEntries(Object.entries(j.visual.extras).map(([n, b]) => [n, fromB64(b)])) : {}, meta:j.meta || {}, created:Date.now() }; }
  return { put, get, list, del, parse, parseMTL, metaFrom, pickMain, readFiles, credit, safeUrl, prepare, readFile, candidates, guessRole, stats, typeOf, packageModel, unpackage, AXES, MAX_TRIS };
})();
