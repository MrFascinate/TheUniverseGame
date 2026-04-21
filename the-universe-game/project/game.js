/* ==========================================================
   The Universe Game — game.js
   Handles: hero→game transition, CSS starfield, Three.js Earth,
   5-stat slider panel, presets.
   ========================================================== */

(() => {
  /* ---------- Utility ---------- */
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ---------- Background starfield (2D canvas) ---------- */
  const sfCanvas = document.getElementById('starfield');
  const sfCtx = sfCanvas.getContext('2d');
  let sfStars = [];
  function sfInit() {
    const dpr = Math.min(window.devicePixelRatio, 2);
    sfCanvas.width = window.innerWidth * dpr;
    sfCanvas.height = window.innerHeight * dpr;
    sfCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sfStars = [];
    const n = Math.floor((window.innerWidth * window.innerHeight) / 2600);
    for (let i = 0; i < n; i++) {
      sfStars.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        r: Math.random() * 1.2 + 0.2,
        tw: Math.random() * Math.PI * 2,
        tws: 0.6 + Math.random() * 1.4,
        c: Math.random() < 0.08 ? '#ffc87a' : (Math.random() < 0.5 ? '#f5e8c7' : '#c9d4ee'),
      });
    }
  }
  window.addEventListener('resize', sfInit);
  sfInit();

  function sfDraw(t) {
    sfCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (const s of sfStars) {
      const a = 0.5 + 0.5 * Math.sin(t * 0.001 * s.tws + s.tw);
      sfCtx.globalAlpha = 0.35 + 0.55 * a;
      sfCtx.fillStyle = s.c;
      sfCtx.beginPath();
      sfCtx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      sfCtx.fill();
    }
    sfCtx.globalAlpha = 1;
  }

  /* ---------- State ---------- */
  const state = {
    inGame: false,
    transitioning: false,
    stats: {
      water: 0.62,
      life: 0.48,
      intelligence: 0.30,
      compute: 0.18,
      ascension: 0.04,
    },
  };

  const PRESETS = {
    dead:   { water: 0.10, life: 0.02, intelligence: 0.0,  compute: 0.0, ascension: 0.0 },
    now:    { water: 0.62, life: 0.48, intelligence: 0.30, compute: 0.18, ascension: 0.04 },
    utopia: { water: 0.68, life: 0.90, intelligence: 0.82, compute: 0.65, ascension: 0.25 },
    ascend: { water: 0.55, life: 0.60, intelligence: 0.95, compute: 0.95, ascension: 0.92 },
  };

  /* ==========================================================
     Three.js — Simulation
     EARTH_R is the single source of truth for every sphere radius.
     Camera z=4.2, FOV=38° → visible half-height ≈ 1.446 units,
     so EARTH_R=1.4 fills ~97% of screen height.
     ========================================================== */
  const EARTH_R = 1.4;

  const glCanvas = document.getElementById('gl');
  const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 0, 4.2);

  function resizeGL() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resizeGL);
  resizeGL();

  // Lights — added at scene level before anything loads
  const ambLight = new THREE.AmbientLight(0x8090b0, 0.45);
  scene.add(ambLight);
  const sunLight = new THREE.DirectionalLight(0xfff1d8, 1.1);
  sunLight.position.set(3, 1.5, 2);
  scene.add(sunLight);
  const LIGHT_DIR = new THREE.Vector3(3, 1.5, 2).normalize();

  /* ---------- Earth group ---------- */
  const earthGroup = new THREE.Group();
  scene.add(earthGroup);

  // Normalize a loaded GLTF model so its bounding sphere equals targetR.
  // Uses the full model (not innermost mesh) to guarantee overlays at targetR+delta
  // always sit outside the model surface regardless of internal mesh structure.
  function normalizeGLB(model, targetR) {
    const box = new THREE.Box3().setFromObject(model);
    const sp = box.getBoundingSphere(new THREE.Sphere());
    const s = targetR / sp.radius;
    model.scale.setScalar(s);
    model.position.set(-sp.center.x * s, -sp.center.y * s, -sp.center.z * s);
    model.traverse((o) => {
      if (o.isMesh && o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(m => {
          if (m.map) m.map.encoding = THREE.sRGBEncoding;
          if (m.emissiveMap) m.emissiveMap.encoding = THREE.sRGBEncoding;
          m.needsUpdate = true;
        });
      }
    });
  }

  let earthGLB = null;
  let simRotY = 0;

  if (THREE.GLTFLoader) {
    const gltfLoader = new THREE.GLTFLoader();
    gltfLoader.load(
      'assets/earth.glb',
      (gltf) => {
        const model = gltf.scene;
        normalizeGLB(model, EARTH_R);
        model.rotation.z = 0.41;
        earthGroup.add(model);
        earthGLB = model;
      },
      undefined,
      (err) => { console.warn('Earth GLB load failed:', err); }
    );
  }

  /* ---------- Shared shader chunks ---------- */
  const overlayVert = `
    varying vec3 vNormalW;
    varying vec3 vPos;
    varying vec3 vView;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vNormalW = normalize(mat3(modelMatrix) * normal);
      vPos = position;
      vec4 mv = viewMatrix * wp;
      vView = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }
  `;

  const fbmGlsl = `
    float hash(vec3 p){ return fract(sin(dot(p, vec3(17.1,113.5,71.7))) * 43758.5453); }
    float noise(vec3 p){
      vec3 i = floor(p); vec3 f = fract(p);
      f = f*f*(3.0-2.0*f);
      return mix(
        mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
        mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),
        f.z
      );
    }
    float fbm(vec3 p){
      float v=0.0,a=0.5;
      for(int i=0;i<5;i++){v+=a*noise(p);p*=2.03;a*=0.5;}
      return v;
    }
  `;

  /* ---------- Water overlay ---------- */
  const waterUniforms = {
    uLightDir: { value: LIGHT_DIR },
    uAmount:   { value: 0.0 },
    uTime:     { value: 0.0 },
  };
  const waterMat = new THREE.ShaderMaterial({
    uniforms: waterUniforms,
    vertexShader: overlayVert,
    fragmentShader: `
      varying vec3 vNormalW; varying vec3 vPos; varying vec3 vView;
      uniform vec3 uLightDir; uniform float uAmount; uniform float uTime;
      ${fbmGlsl}
      void main(){
        float terrain = fbm(vPos * 2.3) * 0.7 + fbm(vPos * 6.0 + vec3(uTime*0.02)) * 0.3;
        float thresh = 0.35 + uAmount * 0.45;
        float waterMask = smoothstep(thresh-0.05, thresh+0.02, thresh - terrain + 0.5);
        float lit = max(dot(vNormalW, uLightDir), 0.0);
        vec3 col = mix(vec3(0.04,0.18,0.55), vec3(0.12,0.52,1.0), lit);
        vec3 h = normalize(uLightDir + vView);
        col += vec3(0.8,0.9,1.0) * pow(max(dot(vNormalW,h),0.0),40.0) * lit * 0.9;
        gl_FragColor = vec4(col, waterMask * uAmount * 0.55);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const waterOverlay = new THREE.Mesh(new THREE.SphereGeometry(EARTH_R * 1.001, 128, 128), waterMat);
  waterOverlay.rotation.z = 0.41;
  earthGroup.add(waterOverlay);

  /* ---------- Life overlay ---------- */
  const lifeUniforms = {
    uLightDir: { value: LIGHT_DIR },
    uAmount:   { value: 0.0 },
    uTime:     { value: 0.0 },
    uWater:    { value: 0.5 },
  };
  const lifeMat = new THREE.ShaderMaterial({
    uniforms: lifeUniforms,
    vertexShader: overlayVert,
    fragmentShader: `
      varying vec3 vNormalW; varying vec3 vPos; varying vec3 vView;
      uniform vec3 uLightDir; uniform float uAmount; uniform float uTime; uniform float uWater;
      ${fbmGlsl}
      void main(){
        float terrain = fbm(vPos * 2.3) * 0.7 + fbm(vPos * 6.0) * 0.3;
        float thresh = 0.35 + uWater * 0.45;
        float landMask = 1.0 - smoothstep(thresh-0.02, thresh+0.05, thresh - terrain + 0.5);
        float veg = fbm(vPos * 4.5 + vec3(0.7,1.3,2.1));
        float vegMask = smoothstep(0.35, 0.65, veg) * landMask;
        vegMask *= 1.0 - smoothstep(0.55, 0.92, abs(normalize(vPos).y));
        float lit = max(dot(vNormalW, uLightDir), 0.0);
        vec3 col = mix(vec3(0.08,0.55,0.10), vec3(0.22,0.82,0.18), smoothstep(0.4,0.8,veg)) * (0.3 + 0.9*lit);
        gl_FragColor = vec4(col, vegMask * uAmount * 0.75);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const lifeOverlay = new THREE.Mesh(new THREE.SphereGeometry(EARTH_R * 1.002, 128, 128), lifeMat);
  lifeOverlay.rotation.z = 0.41;
  earthGroup.add(lifeOverlay);

  /* ---------- Intelligence overlay ---------- */
  const intelUniforms = {
    uLightDir: { value: LIGHT_DIR },
    uAmount:   { value: 0.0 },
    uTime:     { value: 0.0 },
    uWater:    { value: 0.5 },
  };
  const intelMat = new THREE.ShaderMaterial({
    uniforms: intelUniforms,
    vertexShader: overlayVert,
    fragmentShader: `
      varying vec3 vNormalW; varying vec3 vPos; varying vec3 vView;
      uniform vec3 uLightDir; uniform float uAmount; uniform float uTime; uniform float uWater;
      ${fbmGlsl}
      void main(){
        float terrain = fbm(vPos * 2.3) * 0.7 + fbm(vPos * 6.0) * 0.3;
        float thresh = 0.35 + uWater * 0.45;
        float landMask = 1.0 - smoothstep(thresh-0.02, thresh+0.05, thresh - terrain + 0.5);
        float cities = fbm(vPos * 18.0);
        float cityMask = smoothstep(0.62, 0.82, cities) * landMask;
        float night = smoothstep(0.0, 0.4, clamp(-dot(vNormalW, uLightDir), 0.0, 1.0));
        float tw = 0.8 + 0.2*sin(uTime*4.0 + cities*40.0);
        gl_FragColor = vec4(vec3(1.0,0.72,0.32)*tw, clamp(cityMask*night*uAmount*1.2,0.0,1.0));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const intelOverlay = new THREE.Mesh(new THREE.SphereGeometry(EARTH_R * 1.003, 128, 128), intelMat);
  intelOverlay.rotation.z = 0.41;
  earthGroup.add(intelOverlay);

  /* ---------- Ascension overlay ---------- */
  const ascendUniforms = {
    uLightDir: { value: LIGHT_DIR },
    uAmount:   { value: 0.0 },
    uTime:     { value: 0.0 },
  };
  const ascendMat = new THREE.ShaderMaterial({
    uniforms: ascendUniforms,
    vertexShader: overlayVert,
    fragmentShader: `
      varying vec3 vNormalW; varying vec3 vView;
      uniform vec3 uLightDir; uniform float uAmount; uniform float uTime;
      void main(){
        float lit = max(dot(vNormalW, uLightDir), 0.0);
        float fres = pow(1.0 - max(dot(vNormalW, vView), 0.0), 1.8);
        float pulse = 0.85 + 0.15*sin(uTime*1.3);
        float a = (lit*0.25 + fres*0.55) * uAmount * pulse;
        gl_FragColor = vec4(vec3(1.0,0.82,0.35), a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const ascendOverlay = new THREE.Mesh(new THREE.SphereGeometry(EARTH_R * 1.004, 96, 96), ascendMat);
  earthGroup.add(ascendOverlay);

  /* ---------- Atmosphere ---------- */
  const atmUniforms = {
    uLightDir:  { value: LIGHT_DIR },
    uColor:     { value: new THREE.Color('#4a8fd9') },
    uIntensity: { value: 1.0 },
  };
  const atmMat = new THREE.ShaderMaterial({
    uniforms: atmUniforms,
    vertexShader: `
      varying vec3 vNormal; varying vec3 vView;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying vec3 vNormal; varying vec3 vView;
      uniform vec3 uLightDir; uniform vec3 uColor; uniform float uIntensity;
      void main(){
        float fres = pow(1.0 - max(dot(vNormal, vView), 0.0), 2.3);
        float lit = smoothstep(-0.2, 0.7, dot(vNormal, uLightDir));
        float a = fres * (0.35 + 0.65*lit) * uIntensity * 0.9;
        gl_FragColor = vec4(uColor, a);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
    depthWrite: false,
  });
  // 1.035x — thin atmosphere ring; keeps glow without a visible hard sphere edge
  const atm = new THREE.Mesh(new THREE.SphereGeometry(EARTH_R * 1.035, 64, 64), atmMat);
  earthGroup.add(atm);

  /* ---------- Satellites (compute) ---------- */
  const satGroup = new THREE.Group();
  earthGroup.add(satGroup);
  const SAT_COUNT = 40;
  const sats = [];
  for (let i = 0; i < SAT_COUNT; i++) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(
      new THREE.BoxGeometry(0.018, 0.018, 0.018),
      new THREE.MeshBasicMaterial({ color: 0xc8cdd5 }),
    ));
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.06, 0.012),
      new THREE.MeshBasicMaterial({ color: 0x3a5fb0, side: THREE.DoubleSide }),
    );
    g.add(panel);
    sats.push({
      g,
      inclination: (Math.random() - 0.5) * Math.PI,
      orbitRadius: EARTH_R * (1.12 + Math.random() * 0.18),
      phase: Math.random() * Math.PI * 2,
      speed: 0.08 + Math.random() * 0.12,
    });
    satGroup.add(g);
  }

  /* ---------- Orbit ring lines (compute) ---------- */
  const ringGroup = new THREE.Group();
  earthGroup.add(ringGroup);
  for (let i = 0; i < 3; i++) {
    const r = EARTH_R * (1.12 + i * 0.065);
    const pts = [];
    for (let j = 0; j <= 128; j++) {
      const a = (j / 128) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    }
    const ring = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0x5ecfd4, transparent: true, opacity: 0.0 }),
    );
    ring.rotation.x = (Math.random() - 0.5) * 1.2;
    ring.rotation.z = (Math.random() - 0.5) * 0.5;
    ringGroup.add(ring);
  }

  /* ---------- Ascension halo ---------- */
  const haloMat = new THREE.ShaderMaterial({
    uniforms: {
      uAmount: { value: 0 },
      uTime:   { value: 0 },
    },
    vertexShader: `
      varying vec3 vNormal; varying vec3 vView;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying vec3 vNormal; varying vec3 vView;
      uniform float uAmount; uniform float uTime;
      void main(){
        float fres = pow(1.0 - max(dot(vNormal, vView), 0.0), 1.8);
        float pulse = 0.7 + 0.3*sin(uTime*0.8);
        float a = fres * uAmount * 0.9;
        gl_FragColor = vec4(vec3(1.0,0.78,0.35)*pulse, a);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
    depthWrite: false,
  });
  const halo = new THREE.Mesh(new THREE.SphereGeometry(EARTH_R * 1.18, 64, 64), haloMat);
  earthGroup.add(halo);

  /* ---------- Dyson rings (high ascension) ---------- */
  const dysonGroup = new THREE.Group();
  earthGroup.add(dysonGroup);
  for (let i = 0; i < 2; i++) {
    const r = EARTH_R * (1.55 + i * 0.085);
    const pts = [];
    for (let j = 0; j <= 256; j++) {
      const a = (j / 256) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    }
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0xffc87a, transparent: true, opacity: 0 }),
    );
    line.rotation.x = i === 0 ? 0.4 : -0.3;
    line.rotation.z = i === 0 ? 0 : 0.6;
    dysonGroup.add(line);
  }

  /* ---------- Hero porthole Earth (mini scene) ---------- */
  const heroCanvas = document.getElementById('heroEarthCanvas');
  let heroRenderer = null, heroScene = null, heroCamera = null, heroEarth = null;

  if (heroCanvas) {
    const glCtxAttrs = { alpha: true, antialias: true, powerPreference: 'default' };
    const glCtx = heroCanvas.getContext('webgl2', glCtxAttrs) || heroCanvas.getContext('webgl', glCtxAttrs);
    heroRenderer = new THREE.WebGLRenderer({ canvas: heroCanvas, context: glCtx, antialias: true, alpha: true });
    heroRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    heroRenderer.setClearColor(0x000000, 0);
    heroRenderer.outputEncoding = THREE.sRGBEncoding;
    heroRenderer.setSize(400, 400, false);
    heroScene = new THREE.Scene();
    heroCamera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
    heroCamera.position.set(0, 0, 3.8);
    heroCamera.lookAt(0, 0, 0);

    const heroAmb = new THREE.AmbientLight(0x8090b0, 0.35);
    heroScene.add(heroAmb);
    const heroSun = new THREE.DirectionalLight(0xffeed1, 1.4);
    heroSun.position.set(3, 1.2, 2);
    heroScene.add(heroSun);
    const heroFill = new THREE.DirectionalLight(0x3a5a9a, 0.35);
    heroFill.position.set(-2, -0.5, 1);
    heroScene.add(heroFill);

    const heroGroup = new THREE.Group();
    heroScene.add(heroGroup);

    // Thin atmosphere and halo for the hero porthole
    const heroAtm = new THREE.Mesh(new THREE.SphereGeometry(1.055, 48, 48), atmMat);
    heroGroup.add(heroAtm);
    const heroHalo = new THREE.Mesh(new THREE.SphereGeometry(1.22, 48, 48), haloMat);
    heroGroup.add(heroHalo);

    if (THREE.GLTFLoader) {
      const loader = new THREE.GLTFLoader();
      loader.load(
        'assets/earth.glb',
        (gltf) => {
          const model = gltf.scene;
          normalizeGLB(model, 1.0);  // hero scene: earth fills unit sphere
          model.rotation.z = 0.41;
          heroGroup.add(model);
          heroEarth = model;
        },
        undefined,
        (err) => { console.warn('Hero earth GLB failed:', err); }
      );
    }
  }

  function positionHeroCanvas() {
    const wrap = document.querySelector('.controller-wrap');
    const svgEl = wrap && wrap.querySelector('svg.controller-svg');
    if (!wrap || !svgEl || !heroCanvas || !heroRenderer) return;
    const wrapRect = wrap.getBoundingClientRect();
    const svgRect = svgEl.getBoundingClientRect();
    if (svgRect.width < 10 || svgRect.height < 10) return;
    const vbW = 1600, vbH = 900;
    const scale = Math.min(svgRect.width / vbW, svgRect.height / vbH);
    const contentW = vbW * scale;
    const contentH = vbH * scale;
    const contentLeft = svgRect.left + (svgRect.width  - contentW) / 2;
    const contentTop  = svgRect.top  + (svgRect.height - contentH);
    const cxPx = contentLeft + 800 * scale;
    const cyPx = contentTop  + 340 * scale;
    const rPx  = 168 * scale;
    const size = Math.max(60, Math.round(rPx * 2));
    const left = Math.round(cxPx - rPx - wrapRect.left);
    const top  = Math.round(cyPx - rPx - wrapRect.top);
    heroCanvas.style.left   = left + 'px';
    heroCanvas.style.top    = top + 'px';
    heroCanvas.style.width  = size + 'px';
    heroCanvas.style.height = size + 'px';
    heroRenderer.setSize(size, size, false);
    heroCamera.aspect = 1;
    heroCamera.updateProjectionMatrix();

    const hint = document.getElementById('pressHint');
    if (hint) {
      const hintY = contentTop + 605 * scale - wrapRect.top;
      hint.style.left = '50%';
      hint.style.top  = hintY + 'px';
      hint.style.transform = 'translateX(-50%)';
    }
  }
  if (heroCanvas) {
    window.addEventListener('resize', positionHeroCanvas);
    positionHeroCanvas();
    requestAnimationFrame(positionHeroCanvas);
    setTimeout(positionHeroCanvas, 100);
    setTimeout(positionHeroCanvas, 500);
    setTimeout(positionHeroCanvas, 1200);
  }

  /* ---------- Animation loop ---------- */
  const clock = new THREE.Clock();
  function animate(t) {
    const dt = clock.getDelta();
    const time = clock.elapsedTime;

    sfDraw(t);

    // Atmosphere tint shifts with life: dead planet → cold blue-white, lush → richer blue
    const lifeFactor = state.stats.life;
    atmUniforms.uColor.value.setRGB(
      0.29 + 0.05 * (1 - lifeFactor),
      0.56 - 0.05 * (1 - lifeFactor),
      0.85
    );
    atmUniforms.uIntensity.value = 0.6 + 0.4 * state.stats.water;

    // Rotate all overlay meshes in sync with the GLB
    simRotY += dt * 0.06;
    if (earthGLB) earthGLB.rotation.y = simRotY;
    waterOverlay.rotation.y = simRotY;
    lifeOverlay.rotation.y  = simRotY;
    intelOverlay.rotation.y = simRotY;
    satGroup.rotation.y = simRotY * 0.2;

    // Push overlay uniforms so stat bars drive the visual
    waterUniforms.uAmount.value = state.stats.water;
    waterUniforms.uTime.value   = time;
    lifeUniforms.uAmount.value  = state.stats.life;
    lifeUniforms.uWater.value   = state.stats.water;
    lifeUniforms.uTime.value    = time;
    intelUniforms.uAmount.value = state.stats.intelligence;
    intelUniforms.uWater.value  = state.stats.water;
    intelUniforms.uTime.value   = time;
    ascendUniforms.uAmount.value = state.stats.ascension;
    ascendUniforms.uTime.value   = time;

    // Satellites
    satGroup.visible = state.stats.compute > 0.01;
    const satVisibleCount = Math.floor(state.stats.compute * SAT_COUNT);
    for (let i = 0; i < SAT_COUNT; i++) {
      const s = sats[i];
      s.g.visible = i < satVisibleCount;
      if (!s.g.visible) continue;
      const a = s.phase + time * s.speed;
      const x = Math.cos(a) * s.orbitRadius;
      const z = Math.sin(a) * s.orbitRadius;
      const y = Math.sin(a) * Math.sin(s.inclination) * s.orbitRadius;
      s.g.position.set(x, y, z * Math.cos(s.inclination));
      s.g.lookAt(0, 0, 0);
    }

    // Orbit rings opacity
    ringGroup.children.forEach((r, i) => {
      r.material.opacity = clamp(state.stats.compute * 0.6 - i * 0.15, 0, 0.8);
    });

    // Halo
    haloMat.uniforms.uAmount.value = state.stats.ascension;
    haloMat.uniforms.uTime.value   = time;

    // Dyson rings
    dysonGroup.children.forEach((r, i) => {
      r.material.opacity = clamp((state.stats.ascension - 0.5) * 2 - i * 0.15, 0, 0.8);
      r.rotation.y += dt * 0.05;
    });

    // Mild camera bob
    camera.position.x = Math.sin(time * 0.08) * 0.08;
    camera.position.y = Math.cos(time * 0.06) * 0.05;
    camera.lookAt(0, 0, 0);

    if (state.inGame || state.transitioning) {
      renderer.render(scene, camera);
    }

    // Hero porthole
    if (heroRenderer && !state.inGame) {
      if (heroEarth) heroEarth.rotation.y = simRotY;
      heroCamera.position.x = Math.sin(time * 0.08) * 0.05;
      heroCamera.position.y = Math.cos(time * 0.06) * 0.03;
      heroCamera.lookAt(0, 0, 0);
      heroRenderer.render(heroScene, heroCamera);
    }

    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  /* ---------- Stat panel interactions ---------- */
  const stats = document.querySelectorAll('.stat');

  function updateStatUI() {
    for (const el of stats) {
      const key = el.dataset.key;
      const v = state.stats[key];
      el.querySelector(`[data-fill="${key}"]`).style.width = (v * 100).toFixed(1) + '%';
      el.querySelector(`[data-val="${key}"]`).textContent = Math.round(v * 100) + '%';
    }
    const sig =
      Math.round(state.stats.water * 9).toString() +
      Math.round(state.stats.life * 9).toString() +
      Math.round(state.stats.intelligence * 9).toString() +
      Math.round(state.stats.compute * 9).toString() +
      Math.round(state.stats.ascension * 9).toString();
    document.getElementById('statsCode').textContent = 'EARTH-' + sig;

    document.querySelectorAll('.preset').forEach(b => {
      const p = PRESETS[b.dataset.preset];
      const match = ['water','life','intelligence','compute','ascension']
        .every(k => Math.abs(p[k] - state.stats[k]) < 0.005);
      b.classList.toggle('active', match);
    });
  }

  stats.forEach(el => {
    const key = el.dataset.key;
    const bar = el.querySelector('.stat-bar');
    let dragging = false;

    const setFromEvent = (e) => {
      const rect = bar.getBoundingClientRect();
      const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      state.stats[key] = clamp(x / rect.width);
      updateStatUI();
    };

    const onDown = (e) => { dragging = true; setFromEvent(e); e.preventDefault(); };
    const onMove = (e) => { if (dragging) setFromEvent(e); };
    const onUp   = () => { dragging = false; };

    bar.addEventListener('mousedown', onDown);
    bar.addEventListener('touchstart', onDown, { passive: false });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
  });

  document.querySelectorAll('.preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = PRESETS[btn.dataset.preset];
      const start = { ...state.stats };
      const t0 = performance.now();
      const DUR = 900;
      const step = (now) => {
        const k = clamp((now - t0) / DUR);
        const e = k * k * (3 - 2 * k);
        for (const key of Object.keys(target)) {
          state.stats[key] = lerp(start[key], target[key], e);
        }
        updateStatUI();
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  });

  updateStatUI();

  /* ---------- Hero → Game transition ---------- */
  const hero = document.getElementById('hero');
  const game = document.getElementById('game');
  const controller = document.getElementById('controller');
  const pressHint = document.getElementById('pressHint');
  const scrollHint = document.getElementById('scrollHint');

  setTimeout(() => scrollHint.classList.add('show'), 900);

  function enterGame() {
    if (state.inGame || state.transitioning) return;
    state.transitioning = true;
    hero.classList.add('zooming');
    if (scrollHint) scrollHint.classList.remove('show');
    setTimeout(() => {
      game.classList.add('show');
      state.inGame = true;
    }, 800);
    setTimeout(() => {
      hero.classList.add('hidden');
      state.transitioning = false;
    }, 1600);
  }

  function exitGame() {
    if (!state.inGame) return;
    game.classList.remove('show');
    hero.classList.remove('hidden');
    setTimeout(() => {
      hero.classList.remove('zooming');
      state.inGame = false;
    }, 700);
  }

  pressHint.addEventListener('click', enterGame);
  controller.addEventListener('click', enterGame);
  const playBtn = document.getElementById('playBtn');
  if (playBtn) playBtn.addEventListener('click', enterGame);
  const navPlay = document.getElementById('navPlay');
  if (navPlay) navPlay.addEventListener('click', (e) => { e.preventDefault(); enterGame(); });

  const emailForm = document.getElementById('emailForm');
  if (emailForm) {
    emailForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = emailForm.querySelector('input');
      const btn = emailForm.querySelector('button');
      if (!input.value) return;
      emailForm.classList.add('sent');
      btn.textContent = '✓ On the list';
      input.value = 'See you at launch.';
      input.disabled = true;
      btn.disabled = true;
    });
  }

  const preorderBtn = document.getElementById('preorderBtn');
  if (preorderBtn) {
    preorderBtn.addEventListener('click', (e) => {
      e.preventDefault();
      preorderBtn.innerHTML = 'Coming soon — join the list <span class="arrow">↓</span>';
      setTimeout(() => {
        preorderBtn.innerHTML = 'Pre-order the Book <span class="arrow">→</span>';
      }, 2400);
      const input = emailForm && emailForm.querySelector('input');
      if (input && !input.disabled) input.focus();
    });
  }

  let scrollAccum = 0;
  window.addEventListener('wheel', (e) => {
    if (state.inGame || state.transitioning) return;
    scrollAccum += e.deltaY;
    if (scrollAccum > 30) enterGame();
  }, { passive: true });

  let touchStartY = null;
  window.addEventListener('touchstart', (e) => {
    if (!state.inGame) touchStartY = e.touches[0].clientY;
  }, { passive: true });
  window.addEventListener('touchmove', (e) => {
    if (state.inGame || touchStartY == null) return;
    const dy = touchStartY - e.touches[0].clientY;
    if (dy > 50) { enterGame(); touchStartY = null; }
  }, { passive: true });

  document.getElementById('backBtn').addEventListener('click', exitGame);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.inGame) exitGame();
    if ((e.key === 'Enter' || e.key === ' ') && !state.inGame) enterGame();
  });

})();
