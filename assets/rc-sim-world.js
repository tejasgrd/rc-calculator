/* RC Calc simulator: three.js world (sky, field, runway, trees, windsock, aircraft with moving surfaces, cameras,
   photo-field backdrop, custom scenery, lesson gates, smoke trail). Requires window.THREE (assets/vendor/three.bundle.min.js).
   NED (x north, y east, z down) ↔ three.js (x east, y up, z south). */
'use strict';
const SimWorld = (() => {
  const T = () => window.THREE;
  const nedToThree = p => [p[1], -p[2], -p[0]];
  const PILOT = [6, -16, -1.7]; // pilot station (NED)
  function rng(seed){ let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }
  function canvasTex(w, h, draw, repeat){
    const THREE = T(), c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); } return t;
  }
  function grassTex(seed, base, var1){ const r = rng(seed); return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 26000; i++) { const x = r() * w, y = r() * h, l = (r() - 0.5) * var1; g.fillStyle = `rgba(${l > 0 ? 255 : 0},${l > 0 ? 255 : 30},${l > 0 ? 200 : 0},${Math.abs(l) * 0.05})`; g.fillRect(x, y, 2 + r() * 3, 2 + r() * 4); } // soft, low-contrast speckle avoids shimmer
  }, [1, 1]); }
  function runwayTex(){ return canvasTex(128, 1024, (g, w, h) => {
    g.fillStyle = '#3b3f45'; g.fillRect(0, 0, w, h); const r = rng(9);
    for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(255,255,255,${r() * 0.05})`; g.fillRect(r() * w, r() * h, 1, 1); }
    g.fillStyle = '#e8e8e2'; for (let y = 60; y < h - 60; y += 70) g.fillRect(w / 2 - 2, y, 4, 36);
    for (const yy of [8, h - 30]) for (let x = 12; x < w - 12; x += 14) g.fillRect(x, yy, 8, 22);
    g.fillRect(4, 0, 3, h); g.fillRect(w - 7, 0, 3, h);
  }); }
  function cloudTex(){ return canvasTex(256, 128, (g, w, h) => { const r = rng(5); for (let i = 0; i < 22; i++) { const x = w * (0.15 + r() * 0.7), y = h * (0.35 + r() * 0.35), rad = 18 + r() * 34, gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); } }); }

  class World {
    constructor(canvas, o = {}){
      const THREE = T(); if (!THREE) throw new Error('three.js is not loaded');
      this.canvas = canvas; this.o = o;
      // logarithmic depth: keeps the stacked ground layers (grass / mown strip / runway) from z-fighting at long range and grazing FPV angles
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias:true, powerPreference:'high-performance', preserveDrawingBuffer:true, logarithmicDepthBuffer:true });
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.05;
      this.scene = new THREE.Scene(); this.scene.fog = new THREE.Fog(0xcfe2f0, 250, 2200);
      this.camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 6000);
      const hemi = new THREE.HemisphereLight(0xdbeeff, 0xa8b894, 1.15); this.scene.add(hemi);
      const fill = new THREE.DirectionalLight(0xcfe3ff, 0.55); fill.position.set(-0.3, -1, 0.4); this.scene.add(fill); // lights the underside seen from the ground
      const sun = this.sun = new THREE.DirectionalLight(0xfff3df, 2.2); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
      const sc = sun.shadow.camera; sc.left = sc.bottom = -25; sc.right = sc.top = 25; sc.near = 1; sc.far = 300; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
      this.scene.add(sun, sun.target);
      this.buildSky(); this.buildField(o.seed || 42);
      this.aircraft = null; this.camMode = 'pilot'; this.autoZoom = true; this.smooth = { pos:null, look:null }; this.trail = null; this.trailOn = false;
      this.gates = []; this.thermalMeshes = []; this.photo = null; this.scenery = null;
      new ResizeObserver(() => this.resize()).observe(canvas); this.resize();
    }
    resize(){ const r = this.canvas.getBoundingClientRect(); if (!r.width || !r.height) return; this.renderer.setSize(r.width, r.height, false); this.camera.aspect = r.width / r.height; this.camera.updateProjectionMatrix(); }
    buildSky(){
      const THREE = T();
      const mat = new THREE.ShaderMaterial({ side:THREE.BackSide, depthWrite:false, fog:false, uniforms:{ top:{ value:new THREE.Color(0x3d7fc4) }, mid:{ value:new THREE.Color(0x9ec9ec) }, bot:{ value:new THREE.Color(0xdfe9ef) }, sunDir:{ value:new THREE.Vector3(0.4, 0.6, -0.5).normalize() } },
        vertexShader:'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader:'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; uniform vec3 sunDir; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(mid, top, pow(clamp(h,0.0,1.0),0.55)) : bot; float s = max(dot(vP, sunDir), 0.0); c += vec3(1.0,0.92,0.75) * (pow(s, 450.0) * 1.5 + pow(s, 12.0) * 0.18); gl_FragColor = vec4(c,1.0); }' });
      this.sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), mat); this.scene.add(this.sky);
      const ct = cloudTex(), r = rng(77);
      this.clouds = new THREE.Group();
      for (let i = 0; i < 26; i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map:ct, transparent:true, opacity:0.75 + r() * 0.2, depthWrite:false, fog:false }));
        const a = r() * Math.PI * 2, d = 500 + r() * 1300; sp.position.set(Math.cos(a) * d, 180 + r() * 220, Math.sin(a) * d); const s = 160 + r() * 260; sp.scale.set(s, s * 0.45, 1); this.clouds.add(sp); }
      this.scene.add(this.clouds);
      const sunDir = mat.uniforms.sunDir.value; this.sunDir = sunDir;
    }
    buildField(seed){
      const THREE = T(), r = rng(seed); this.field = new THREE.Group();
      const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
      const g1 = grassTex(seed, '#5d8a3a', 1.0); g1.repeat.set(220, 220); g1.anisotropy = maxAniso;
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000), new THREE.MeshStandardMaterial({ map:g1, roughness:1, metalness:0 }));
      ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; this.field.add(ground); this.ground = ground;
      const g2 = grassTex(seed + 1, '#77a548', 0.8); g2.repeat.set(12, 8); g2.anisotropy = maxAniso;
      const mown = new THREE.Mesh(new THREE.PlaneGeometry(150, 110), new THREE.MeshStandardMaterial({ map:g2, roughness:1 })); mown.rotation.x = -Math.PI / 2; mown.position.set(0, 0.03, 0); mown.receiveShadow = true; this.field.add(mown);
      const rw = new THREE.Mesh(new THREE.PlaneGeometry(8, 90), new THREE.MeshStandardMaterial({ map:runwayTex(), roughness:0.95 })); rw.rotation.x = -Math.PI / 2; rw.position.set(0, 0.06, 0); rw.receiveShadow = true; this.field.add(rw);
      const box = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshStandardMaterial({ color:0xb9a27a, roughness:1 })); const pp = nedToThree(PILOT); box.rotation.x = -Math.PI / 2; box.position.set(pp[0], 0.05, pp[2]); this.field.add(box);
      // pilot-station fence and bench
      const wood = new THREE.MeshStandardMaterial({ color:0x8a6a45, roughness:0.9 });
      for (let i = -3; i <= 3; i++) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1, 0.08), wood); post.position.set(pp[0] + 2.2, 0.5, pp[2] + i * 1.4); post.castShadow = true; this.field.add(post); }
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 8.6), wood); rail.position.set(pp[0] + 2.2, 0.95, pp[2]); this.field.add(rail);
      // windsock
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 5, 8), new THREE.MeshStandardMaterial({ color:0xdddddd })); pole.position.set(-14, 2.5, -30); pole.castShadow = true; this.field.add(pole);
      this.sock = new THREE.Group(); this.sock.position.set(-14, 4.9, -30);
      const sockMesh = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.6, 16, 1, true), new THREE.MeshStandardMaterial({ color:0xff6a1a, side:THREE.DoubleSide, roughness:0.8 }));
      sockMesh.rotation.z = Math.PI / 2; sockMesh.position.x = 0.8; this.sock.add(sockMesh); this.field.add(this.sock);
      // trees (instanced), kept out of the field
      const trunkG = new THREE.CylinderGeometry(0.18, 0.28, 2.4, 6), crownG = new THREE.ConeGeometry(2.4, 7, 7), crown2 = new THREE.IcosahedronGeometry(3, 0);
      const n = 420, trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({ color:0x5b4330, roughness:1 }), n);
      const crowns = new THREE.InstancedMesh(crownG, new THREE.MeshStandardMaterial({ color:0x2f5a2c, roughness:1, flatShading:true }), n / 2), rounds = new THREE.InstancedMesh(crown2, new THREE.MeshStandardMaterial({ color:0x3e6e30, roughness:1, flatShading:true }), n / 2);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
      this.trees = [];
      for (let i = 0; i < n; i++) {
        let x, z; do { const a = r() * Math.PI * 2, d = 110 + Math.pow(r(), 0.7) * 700; x = Math.cos(a) * d; z = Math.sin(a) * d; } while (Math.abs(x) < 85 && Math.abs(z) < 70);
        const k = 0.7 + r() * 0.9; this.trees.push({ x, z, r:2.4 * k, h:9 * k });
        m.compose(p.set(x, 1.2 * k, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6), s.set(k, k, k)); trunks.setMatrixAt(i, m);
        if (i % 2) { m.compose(p.set(x, (2.4 + 3.5) * k, z), q, s.set(k, k * (0.8 + r() * 0.5), k)); crowns.setMatrixAt(i >> 1, m); }
        else { m.compose(p.set(x, (2.4 + 2.6) * k, z), q, s.set(k, k * (0.9 + r() * 0.3), k)); rounds.setMatrixAt(i >> 1, m); }
      }
      [trunks, crowns, rounds].forEach(im => { im.castShadow = true; im.receiveShadow = false; this.field.add(im); });
      // distant hills
      const hillMat = new THREE.MeshStandardMaterial({ color:0x6f8f6a, roughness:1, flatShading:true });
      for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2 + r() * 0.2, d = 1500 + r() * 500, hgt = 60 + r() * 140;
        const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), hillMat); hill.scale.set(260 + r() * 300, hgt, 200 + r() * 260); hill.position.set(Math.cos(a) * d, -2, Math.sin(a) * d); this.field.add(hill); }
      this.scene.add(this.field);
      // shadow catcher for photo fields
      this.shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShadowMaterial({ opacity:0.35 })); this.shadowCatcher.rotation.x = -Math.PI / 2; this.shadowCatcher.position.y = 0.08; this.shadowCatcher.receiveShadow = true; this.shadowCatcher.visible = false; this.scene.add(this.shadowCatcher);
    }
    /* ---------- aircraft ---------- */
    setAircraft(model, visual){
      const THREE = T();
      if (this.aircraft) { this.scene.remove(this.aircraft.root); this.aircraft.root.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
      const cg = model.cgGeo, L = v => new THREE.Vector3(v[1], v[2] - cg[2], v[0] - cg[0]); // geometry → aircraft-local (three axes)
      const root = new THREE.Group(), att = new THREE.Group(); root.add(att);
      const col = Object.assign({ wing:0x22a6c9, tail:0x22a6c9, body:0xeef2f6, motor:0x2d3a48, prop:0x1c2530, disc:0x9fd6e6, accent:0xff7a1a }, (visual && visual.colors) || {});
      const mats = { wing:new THREE.MeshStandardMaterial({ color:col.wing, roughness:0.55, metalness:0.05 }), tail:new THREE.MeshStandardMaterial({ color:col.tail, roughness:0.55 }),
        fuse:new THREE.MeshStandardMaterial({ color:col.body, roughness:0.6 }), motor:new THREE.MeshStandardMaterial({ color:col.motor, roughness:0.35, metalness:0.6 }),
        prop:new THREE.MeshStandardMaterial({ color:col.prop, roughness:0.5 }), disc:new THREE.MeshBasicMaterial({ color:col.disc, transparent:true, opacity:0.0, depthWrite:false, side:THREE.DoubleSide }),
        surf:new THREE.MeshStandardMaterial({ color:col.accent, roughness:0.55 }) };
      const geomOf = (tris, filter) => { const pos = [], nor = [], grp = {}; tris.filter(filter || (() => true)).forEach(t => { t.p.forEach(v => { const q = L(v); pos.push(q.x, q.y, q.z); }); });
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g; };
      const surfaces = [];
      let imported = null;
      if (visual && visual.object) { imported = visual.object; att.add(imported); }
      const parts = Mesh3D.buildParts(model.geom, { airfoil:model.af, propD:model.prop.D, surf:model.surf, flaps:model.hasFlaps }).parts;
      for (const p of parts) {
        if (imported && p.role !== 'prop' && p.role !== 'disc' && !(visual.keepGenerated)) continue;
        if (p.role === 'body') { for (const part of ['wing', 'tail', 'fuse', 'motor']) { const tr = p.tris.filter(t => t.part === part); if (!tr.length) continue; const mesh = new THREE.Mesh(geomOf(tr), mats[part]); mesh.castShadow = true; mesh.receiveShadow = true; att.add(mesh); } continue; }
        const a = L(p.hinge[0]), b = L(p.hinge[1]), pivot = new THREE.Group(); pivot.position.copy(a); pivot.name = p.name;
        const mesh = new THREE.Mesh(geomOf(p.tris), p.role === 'prop' ? mats.prop : p.role === 'disc' ? mats.disc : mats.surf); mesh.position.copy(a).multiplyScalar(-1); mesh.castShadow = p.role !== 'disc'; mesh.name = p.name + '_mesh';
        pivot.add(mesh); att.add(pivot);
        const axis = b.clone().sub(a).normalize();
        // sign so that +angle moves the trailing edge "down" (geometry −z) / right (+y) for the rudder
        let sign = 1; if (p.role !== 'prop' && p.role !== 'disc') { const te = L([p.hinge[0][0] + 0.05, p.hinge[0][1], p.hinge[0][2]]).sub(a), rot = te.clone().applyAxisAngle(axis, 0.1);
          sign = p.role === 'rudder' ? (rot.x - te.x > 0 ? 1 : -1) : (rot.y - te.y < 0 ? 1 : -1); }
        surfaces.push({ role:p.role, side:p.side || 0, pivot, axis, sign, mesh });
      }
      if (imported && visual.surfaces) for (const s of visual.surfaces) surfaces.push(s); // mapped imported parts (pivot set up by importer)
      this.scene.add(root);
      this.aircraft = { root, att, surfaces, model, propAngle:0, mats, span:model.geom.span };
      if (this.trail) { this.scene.remove(this.trail.line); this.trail = null; }
      return this.aircraft;
    }
    setAircraftColors(c){ if (!this.aircraft) return; const m = this.aircraft.mats; if (c.wing != null) { m.wing.color.set(c.wing); m.tail.color.set(c.wing); } if (c.body != null) m.fuse.color.set(c.body); if (c.accent != null) m.surf.color.set(c.accent); }
    /** Pose the aircraft from sim state (NED position + quaternion body→NED) and animate surfaces. */
    pose(p, q, ctrl, rpm, dt){
      const THREE = T(), A = this.aircraft; if (!A) return;
      const P = nedToThree(p); A.root.position.set(P[0], P[1], P[2]);
      const [w, x, y, z] = q, R = [[1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)], [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)], [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]];
      // M = P R Pᵀ with P = [[0,1,0],[0,0,−1],[−1,0,0]]
      const Pm = [[0, 1, 0], [0, 0, -1], [-1, 0, 0]], mul = (a, b) => a.map((r, i) => b[0].map((_, j) => r.reduce((s, v, k) => s + v * b[k][j], 0))), Pt = [[0, 0, -1], [1, 0, 0], [0, -1, 0]];
      const M = mul(mul(Pm, R), Pt), m4 = new THREE.Matrix4().set(M[0][0], M[0][1], M[0][2], 0, M[1][0], M[1][1], M[1][2], 0, M[2][0], M[2][1], M[2][2], 0, 0, 0, 0, 1);
      A.root.quaternion.setFromRotationMatrix(m4);
      const th = A.model.throws, D = Math.PI / 180;
      A.propAngle = (A.propAngle + (A.model.prop && A.model.prop.dir < 0 ? -1 : 1) * (rpm || 0) / 60 * 2 * Math.PI * Math.min(dt || 0, 0.05)) % (Math.PI * 2);
      for (const s of A.surfaces) {
        let ang = 0;
        if (s.role === 'aileron') ang = -s.side * th.ail * ctrl.ail;
        else if (s.role === 'elevon') ang = -s.side * th.ail * ctrl.ail - th.ele * ctrl.ele;
        else if (s.role === 'elevator') ang = -th.ele * ctrl.ele;
        else if (s.role === 'rudder') ang = th.rud * ctrl.rud;
        else if (s.role === 'flap') ang = (th.flap != null ? th.flap : 25) * (ctrl.flap || 0);
        if (s.role === 'prop') { s.pivot.quaternion.setFromAxisAngle(s.axis, A.propAngle); s.mesh.visible = (rpm || 0) < 2500; continue; }
        if (s.role === 'disc') { A.mats.disc.opacity = Math.min(0.28, (rpm || 0) / 9000); continue; }
        s.pivot.quaternion.setFromAxisAngle(s.axis, s.sign * ang * D);
      }
      if (this.trailOn) this.pushTrail(P);
    }
    pushTrail(P){
      const THREE = T();
      if (!this.trail) { const n = 1500, g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3)); g.setDrawRange(0, 0);
        const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color:0xffffff, transparent:true, opacity:0.75 })); line.frustumCulled = false; this.scene.add(line); this.trail = { line, n, i:0, count:0, last:null }; }
      const t = this.trail; if (t.last && Math.hypot(P[0] - t.last[0], P[1] - t.last[1], P[2] - t.last[2]) < 0.25) return; t.last = P;
      const arr = t.line.geometry.attributes.position.array;
      if (t.count < t.n) { arr.set(P, t.count * 3); t.count++; } else { arr.copyWithin(0, 3); arr.set(P, (t.n - 1) * 3); }
      t.line.geometry.setDrawRange(0, t.count); t.line.geometry.attributes.position.needsUpdate = true;
    }
    clearTrail(){ if (this.trail) { this.scene.remove(this.trail.line); this.trail.line.geometry.dispose(); this.trail = null; } }
    setWind(dirDeg, speed){ if (this.sock) { this.sock.rotation.y = -(dirDeg + 90) * Math.PI / 180 + Math.PI; this.sock.children[0].rotation.y = 0; this.sock.children[0].scale.set(1, 1, 1); this.sock.rotation.z = -Math.max(0, 1 - speed / 6) * 1.2; } }
    /* ---------- camera ---------- */
    updateCamera(dt){
      const THREE = T(), A = this.aircraft; if (!A) return;
      const tgt = A.root.position, cam = this.camera;
      if (this.camMode === 'pilot' || this.photo) {
        const pp = nedToThree(PILOT); cam.position.set(pp[0], -PILOT[2], pp[2]);
        const look = this.smooth.look ? this.smooth.look.lerp(tgt, Math.min(1, dt * 12)) : tgt.clone(); this.smooth.look = look;
        cam.up.copy(this.pilotUp(look.clone().sub(cam.position).normalize(), dt)); cam.lookAt(look);
        const dist = cam.position.distanceTo(tgt), fov = this.autoZoom ? Math.max(6, Math.min(55, 2 * Math.atan(A.span * 3.2 / Math.max(1, dist)) * 180 / Math.PI)) : 55;
        cam.fov += (fov - cam.fov) * Math.min(1, dt * 4); cam.updateProjectionMatrix();
      } else if (this.camMode === 'chase') {
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(A.root.quaternion); fwd.y *= 0.3; fwd.normalize();
        const want = tgt.clone().addScaledVector(fwd, -A.span * 2.4).add(new THREE.Vector3(0, A.span * 0.7, 0));
        this.smooth.pos = this.smooth.pos ? this.smooth.pos.lerp(want, Math.min(1, dt * 5)) : want.clone(); if (this.smooth.pos.y < 0.3) this.smooth.pos.y = 0.3;
        cam.position.copy(this.smooth.pos); cam.lookAt(tgt); if (cam.fov !== 60) { cam.fov = 60; cam.updateProjectionMatrix(); }
      } else if (this.camMode === 'cockpit') {
        const off = new THREE.Vector3(0, A.span * 0.06, -A.model.geom.fuseLen * 0.35).applyQuaternion(A.root.quaternion);
        cam.position.copy(tgt).add(off); const look = new THREE.Vector3(0, 0, -10).applyQuaternion(A.root.quaternion).add(cam.position); cam.up.set(0, 1, 0).applyQuaternion(A.root.quaternion); cam.lookAt(look);
        if (cam.fov !== 75) { cam.fov = 75; cam.updateProjectionMatrix(); }
      } else if (this.camMode === 'tower') {
        cam.position.set(-40, 30, 60); cam.lookAt(tgt); if (cam.fov !== 35) { cam.fov = 35; cam.updateProjectionMatrix(); }
      }
      if (this.camMode !== 'cockpit') cam.up.set(0, 1, 0);
      // shadow camera follows the aircraft
      const sd = this.sunDir; this.sun.position.set(tgt.x + sd.x * 120, tgt.y + sd.y * 120, tgt.z + sd.z * 120); this.sun.target.position.copy(tgt); this.sun.target.updateMatrixWorld();
      this.clouds.position.set(cam.position.x * 0.9, 0, cam.position.z * 0.9);
      this.sky.position.copy(cam.position);
    }
    /** Camera "up" for the ground view that never snaps: lookAt with a fixed world up flips 180° when the plane passes overhead.
        Keep the previous up (perpendicular to the view), and turn it back towards the sky at a limited rate, like a pilot turning around. */
    pilotUp(d, dt){
      const THREE = T(), u = this.smooth.up ? this.smooth.up.clone() : new THREE.Vector3(0, 1, 0);
      u.addScaledVector(d, -u.dot(d)); if (u.lengthSq() < 1e-6) u.set(0, 1, 0).addScaledVector(d, -d.y);
      if (u.lengthSq() < 1e-6) u.set(1, 0, 0).addScaledVector(d, -d.x); u.normalize();
      const w = new THREE.Vector3(0, 1, 0).addScaledVector(d, -d.y), elev = Math.asin(Math.max(-1, Math.min(1, d.y))) * 180 / Math.PI;
      if (w.lengthSq() > 1e-6) { w.normalize();
        const ang = Math.atan2(new THREE.Vector3().crossVectors(u, w).dot(d), u.dot(w)), f = Math.max(0, Math.min(1, (86 - elev) / 8)), maxStep = 4.2 * dt * f; // up to 240°/s once below ~78°
        u.applyAxisAngle(d, Math.max(-maxStep, Math.min(maxStep, ang))); }
      this.smooth.up = u; return u;
    }
    /** Graphics quality: shadows 'off'|'low'|'medium'|'high', drawDistance (m), resScale (0.4..1 of the device pixel ratio). */
    setGraphics(g){
      const THREE = T(), r = this.renderer, sun = this.sun, sh = g.shadows || 'medium', size = { low:1024, medium:2048, high:4096 }[sh] || 0;
      const wasOn = r.shadowMap.enabled; r.shadowMap.enabled = sh !== 'off'; sun.castShadow = sh !== 'off'; r.shadowMap.type = sh === 'low' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
      if (size && sun.shadow.mapSize.x !== size) { sun.shadow.mapSize.set(size, size); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
      const half = sh === 'high' ? 35 : 25, sc = sun.shadow.camera; sc.left = sc.bottom = -half; sc.right = sc.top = half; sc.updateProjectionMatrix();
      if (wasOn !== r.shadowMap.enabled) this.scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { m.needsUpdate = true; }); });
      this.drawDistance = Math.max(400, g.drawDistance || 2500);
      this.camera.far = this.drawDistance * 1.25; this.camera.updateProjectionMatrix(); this.sky.scale.setScalar(Math.min(1, this.drawDistance * 1.1 / 3000));
      this.scene.fog.far = Math.min(this.visibility || 3000, this.drawDistance); this.scene.fog.near = Math.min(this.scene.fog.near, this.scene.fog.far * 0.5);
      r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1) * Math.max(0.4, Math.min(1, g.resScale || 1))); this.resize();
      this.graphics = Object.assign({}, g);
    }
    /** Cloud cover (0..1) and visibility (m): cloud count/opacity, sky tint and fog distance. */
    setWeather(o){
      const n = this.clouds.children.length, show = Math.round((o.clouds != null ? o.clouds : 0.4) * n * 1.1);
      this.clouds.children.forEach((c, i) => { c.visible = i < show; c.material.opacity = 0.55 + 0.4 * Math.min(1, o.clouds || 0); });
      const k = Math.max(0, ((o.clouds || 0) - 0.6) / 0.4), u = this.sky.material.uniforms;
      u.top.value.setRGB(0.24 - 0.1 * k, 0.5 - 0.18 * k, 0.77 - 0.3 * k); u.mid.value.setRGB(0.62 - 0.1 * k, 0.79 - 0.15 * k, 0.93 - 0.2 * k);
      const vis = this.visibility = o.visibility || 3000, far = Math.min(vis, this.drawDistance || 1e9); this.scene.fog.near = Math.min(250, far * 0.1); this.scene.fog.far = far; this.scene.fog.color.setRGB(0.81 - 0.12 * k, 0.89 - 0.12 * k, 0.94 - 0.12 * k);
      this.sun.intensity = 2.2 * (1 - 0.55 * k);
    }
    setCamera(mode){ this.camMode = mode; this.smooth = { pos:null, look:null }; }
    /** Ideal-path ribbon (NED points) for lessons. */
    setPath(pts){ const THREE = T(); if (this.pathMesh) { this.scene.remove(this.pathMesh); this.pathMesh.geometry.dispose(); this.pathMesh = null; }
      if (!pts || pts.length < 2) return; const v = pts.map(p => { const q = nedToThree(p); return new THREE.Vector3(q[0], q[1], q[2]); });
      const curve = new THREE.CatmullRomCurve3(v, false, 'centripetal'), geo = new THREE.TubeGeometry(curve, Math.max(40, pts.length * 30), 0.09, 6, false);
      this.pathMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color:0x22d3ee, transparent:true, opacity:0.55, depthWrite:false, fog:false })); this.scene.add(this.pathMesh); }
    /* ---------- lesson gates, thermals ---------- */
    setGates(list){ const THREE = T(); this.gates.forEach(g => this.scene.remove(g.mesh)); this.gates = (list || []).map((g, i) => {
      const mesh = new THREE.Mesh(new THREE.TorusGeometry(g.r, 0.12, 8, 40), new THREE.MeshStandardMaterial({ color:0xffb020, emissive:0x5a3a00, roughness:0.4 }));
      const P = nedToThree(g.p); mesh.position.set(P[0], P[1], P[2]); mesh.rotation.y = -(g.heading || 0) * Math.PI / 180; this.scene.add(mesh); return Object.assign({ mesh, i }, g); }); }
    markGate(i, state){ const g = this.gates[i]; if (!g) return; g.mesh.material.color.set(state === 'done' ? 0x2ecc71 : state === 'next' ? 0xffb020 : 0x8899aa); g.mesh.material.emissive.set(state === 'next' ? 0x5a3a00 : 0x000000); }
    showThermals(list, on){ const THREE = T(); this.thermalMeshes.forEach(m => this.scene.remove(m)); this.thermalMeshes = [];
      if (!on) return; for (const t of list) { const m = new THREE.Mesh(new THREE.CylinderGeometry(t.R * 0.6, t.R * 0.9, 220, 24, 1, true), new THREE.MeshBasicMaterial({ color:0xffffff, transparent:true, opacity:0.06, depthWrite:false, side:THREE.DoubleSide }));
        const P = nedToThree([t.x, t.y, -110]); m.position.set(P[0], P[1], P[2]); this.scene.add(m); this.thermalMeshes.push(m); } }
    /* ---------- photo field & scenery ---------- */
    setPanorama(texture){
      const THREE = T();
      if (this.photo) { this.scene.remove(this.photo); this.photo.material.map.dispose(); this.photo = null; }
      const on = !!texture; this.field.visible = !on; this.shadowCatcher.visible = on; this.clouds.visible = !on; this.sky.visible = !on; this.scene.fog.far = on ? 9000 : 2200;
      if (!on) return;
      texture.colorSpace = THREE.SRGBColorSpace; texture.mapping = THREE.EquirectangularReflectionMapping;
      const g = new THREE.SphereGeometry(Math.min(2500, this.camera.far * 0.8), 64, 32); g.scale(-1, 1, 1);
      this.photo = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map:texture, fog:false, depthWrite:false })); this.photo.position.copy(this.camera.position); this.scene.add(this.photo);
      this.photo.onBeforeRender = () => this.photo.position.copy(this.camera.position);
    }
    setScenery(obj, o = {}){ if (this.scenery) this.scene.remove(this.scenery); this.scenery = obj || null; if (obj) { obj.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); this.scene.add(obj); }
      if (o.hideDefault != null) this.field.children.forEach(c => { if (c.isInstancedMesh) c.visible = !o.hideDefault; }); }
    /** Trees as NED obstacles for the wind model. */
    obstacles(){ return this.field.visible ? this.trees.map(t => ({ x:-t.z, y:t.x, r:t.r, h:t.h })) : []; }
    /** Tree collision check (NED position) for crashes into trees. */
    hitsTree(p){ const x = p[1], z = -p[0], h = -p[2]; if (!this.field.visible) return false; for (const t of this.trees) { const dx = x - t.x, dz = z - t.z; if (dx * dx + dz * dz < (t.r * 0.8) ** 2 && h < t.h) return true; } return false; }
    render(){ this.renderer.render(this.scene, this.camera); }
    exportGLB(done){ const THREE = T(); new THREE.GLTFExporter().parse(this.aircraft.att, r => done(new Blob([r], { type:'model/gltf-binary' })), err => done(null, err), { binary:true }); }
  }
  return { World, nedToThree, PILOT };
})();
