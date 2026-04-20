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

  /* ---------- Three.js ---------- */
  const glCanvas = document.getElementById('gl');
  const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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

  /* ---------- Earth ---------- */
  const earthGroup = new THREE.Group();
  scene.add(earthGroup);

  const earthUniforms = {
    uTime: { value: 0 },
    uLightDir: { value: new THREE.Vector3(0.8, 0.25, 0.6).normalize() },
    uWater: { value: state.stats.water },
    uLife: { value: state.stats.life },
    uIntel: { value: state.stats.intelligence },
    uCompute: { value: state.stats.compute },
    uAscend: { value: state.stats.ascension },
  };

  const earthMat = new THREE.ShaderMaterial({
    uniforms: earthUniforms,
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vPos;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec3 vNormal;
      varying vec3 vPos;
      uniform float uTime;
      uniform vec3 uLightDir;
      uniform float uWater, uLife, uIntel, uCompute, uAscend;

      // ---- hash / noise ----
      vec3 hash3(vec3 p){
        p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
                 dot(p, vec3(269.5, 183.3, 246.1)),
                 dot(p, vec3(113.5, 271.9, 124.6)));
        return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
      }
      float noise(vec3 p){
        vec3 i = floor(p), f = fract(p);
        vec3 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(dot(hash3(i + vec3(0,0,0)), f - vec3(0,0,0)),
                           dot(hash3(i + vec3(1,0,0)), f - vec3(1,0,0)), u.x),
                       mix(dot(hash3(i + vec3(0,1,0)), f - vec3(0,1,0)),
                           dot(hash3(i + vec3(1,1,0)), f - vec3(1,1,0)), u.x), u.y),
                   mix(mix(dot(hash3(i + vec3(0,0,1)), f - vec3(0,0,1)),
                           dot(hash3(i + vec3(1,0,1)), f - vec3(1,0,1)), u.x),
                       mix(dot(hash3(i + vec3(0,1,1)), f - vec3(0,1,1)),
                           dot(hash3(i + vec3(1,1,1)), f - vec3(1,1,1)), u.x), u.y), u.z);
      }
      float fbm(vec3 p){
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 6; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; }
        return v;
      }

      void main(){
        vec3 n = normalize(vNormal);
        vec3 p = normalize(vPos);

        // Continent noise — stable topography regardless of water
        float cont = fbm(p * 1.9);
        float cont2 = fbm(p * 4.3 + 11.0);
        float elev = cont + 0.25 * cont2;  // pseudo-elevation

        // Water level: higher uWater floods more terrain (lower sea threshold)
        // uWater 0 -> threshold -0.25 (almost no ocean)
        // uWater 1 -> threshold  0.35 (mostly ocean)
        float seaLevel = mix(-0.25, 0.35, uWater);
        float landMask = smoothstep(seaLevel - 0.02, seaLevel + 0.08, elev);

        // --- Ocean palette ---
        vec3 deep  = vec3(0.04, 0.10, 0.22);
        vec3 mid   = vec3(0.10, 0.28, 0.48);
        vec3 shore = vec3(0.18, 0.48, 0.68);
        float oceanD = fbm(p * 3.0 + 5.0);
        vec3 ocean = mix(deep, mid, smoothstep(0.2, 0.6, oceanD));
        ocean = mix(ocean, shore, smoothstep(0.55, 0.85, oceanD));

        // --- Land palette: life drives green vs barren ---
        // Life low -> dusty brown/tan everywhere
        // Life high -> lush green with forest variation
        float dryness = fbm(p * 5.2 + 20.0);
        vec3 barren   = mix(vec3(0.38, 0.30, 0.18), vec3(0.55, 0.44, 0.26), dryness);
        vec3 lush     = mix(vec3(0.18, 0.34, 0.18), vec3(0.35, 0.52, 0.22), dryness);
        vec3 land     = mix(barren, lush, smoothstep(0.05, 0.85, uLife));

        // Ice caps: grow a bit when water is extreme low (frozen)
        float lat = abs(p.y);
        float iceBase = smoothstep(0.78, 0.92, lat + 0.06 * fbm(p * 6.0));
        float ice = iceBase * (0.6 + 0.4 * (1.0 - uLife));

        vec3 surface = mix(ocean, land, landMask);
        surface = mix(surface, vec3(0.88, 0.93, 0.98), ice);

        // Clouds: stronger with higher water + life
        float cloudCover = 0.3 + 0.5 * uWater * uLife + 0.1;
        float cloud = smoothstep(1.0 - cloudCover * 0.4, 1.0 - cloudCover * 0.15,
                                 fbm(p * 2.4 + vec3(uTime * 0.015, 0.0, 0.0)));
        cloud *= smoothstep(0.5, 0.9, fbm(p * 6.0));
        surface = mix(surface, vec3(0.92), cloud * 0.55);

        // --- Lighting ---
        float lambert = max(dot(n, uLightDir), 0.0);
        float dayFactor = smoothstep(-0.05, 0.25, dot(n, uLightDir));
        vec3 lit = surface * (0.06 + 1.1 * lambert);

        // --- Night side: intelligence = city lights on LAND only ---
        float nightMask = smoothstep(0.15, -0.05, dot(n, uLightDir));
        // coarse city pattern + fine detail
        float cityCoarse = smoothstep(0.35, 0.55, fbm(p * 10.0 + 3.0));
        float cityFine   = smoothstep(0.5, 0.7, fbm(p * 26.0 + 7.0));
        float cityPattern = cityCoarse * 0.6 + cityFine * 0.4;
        cityPattern *= smoothstep(0.05, 0.25, landMask);
        cityPattern *= (1.0 - ice);
        // Intelligence modulates density and brightness
        float cityIntensity = smoothstep(0.0, 1.0, uIntel) * (1.5 + uIntel * 2.0);
        cityPattern *= smoothstep(1.0 - uIntel, 1.0 - uIntel + 0.4, cityCoarse + 0.2);
        vec3 cityLight = vec3(1.0, 0.78, 0.42) * cityPattern * nightMask * cityIntensity;

        // Faint land glow at night
        vec3 nightTerrain = surface * 0.03 * nightMask;

        vec3 col = lit + cityLight + nightTerrain;

        // --- Compute: data grid overlay on dark side ---
        if (uCompute > 0.01) {
          float gridLat = abs(sin(p.y * 18.0));
          float gridLon = abs(sin(atan(p.z, p.x) * 20.0));
          float grid = smoothstep(0.92, 0.98, max(gridLat, gridLon));
          col += vec3(0.2, 0.5, 0.9) * grid * nightMask * uCompute * 0.6;
        }

        // --- Rim / atmosphere from the earth side ---
        float rim = pow(1.0 - max(dot(n, vec3(0.0, 0.0, 1.0)), 0.0), 3.0);
        col += vec3(0.25, 0.45, 0.75) * rim * 0.3 * dayFactor;

        // --- Ascension tint: golden surface wash ---
        col = mix(col, col * vec3(1.35, 1.15, 0.75) + vec3(0.15, 0.10, 0.02), uAscend * 0.55);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const earthGeo = new THREE.SphereGeometry(1.0, 128, 128);
  // Procedural shader earth (used as fallback + driver for stats-based coloring)
  const earth = new THREE.Mesh(earthGeo, earthMat);
  earth.rotation.z = 0.41;
  earthGroup.add(earth);

  /* ---------- Stat overlays on top of NASA Earth ---------- */
  // Each overlay is a thin translucent shader sphere that layers visual info
  // (water flood, vegetation, city lights, compute grid) on the photographic GLB.

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

  // Shared FBM noise
  const fbmGlsl = `
    float hash(vec3 p){ return fract(sin(dot(p, vec3(17.1,113.5,71.7))) * 43758.5453); }
    float noise(vec3 p){
      vec3 i = floor(p); vec3 f = fract(p);
      f = f*f*(3.0-2.0*f);
      float n000 = hash(i);
      float n100 = hash(i+vec3(1,0,0));
      float n010 = hash(i+vec3(0,1,0));
      float n110 = hash(i+vec3(1,1,0));
      float n001 = hash(i+vec3(0,0,1));
      float n101 = hash(i+vec3(1,0,1));
      float n011 = hash(i+vec3(0,1,1));
      float n111 = hash(i+vec3(1,1,1));
      return mix(
        mix(mix(n000,n100,f.x), mix(n010,n110,f.x), f.y),
        mix(mix(n001,n101,f.x), mix(n011,n111,f.x), f.y),
        f.z
      );
    }
    float fbm(vec3 p){
      float v=0.0; float a=0.5;
      for(int i=0;i<5;i++){ v += a*noise(p); p*=2.03; a*=0.5; }
      return v;
    }
  `;

  // Water overlay — translucent blue that floods low-altitude areas as water rises.
  // Uses noise to create coastline-like boundaries; amount 0 = no extra water,
  // amount 1 = nearly fully flooded.
  const waterUniforms = {
    uLightDir: earthUniforms.uLightDir,
    uAmount:  { value: 0.0 },
    uTime:    { value: 0.0 },
  };
  const waterMat = new THREE.ShaderMaterial({
    uniforms: waterUniforms,
    vertexShader: overlayVert,
    fragmentShader: `
      varying vec3 vNormalW; varying vec3 vPos; varying vec3 vView;
      uniform vec3 uLightDir;
      uniform float uAmount; uniform float uTime;
      ${fbmGlsl}
      void main(){
        // Terrain-like noise field. Threshold shifts with uAmount to flood.
        float n = fbm(vPos * 2.3);
        float n2 = fbm(vPos * 6.0 + vec3(uTime*0.02));
        float terrain = n * 0.7 + n2 * 0.3;
        // Water appears where terrain < threshold. Threshold rises with amount.
        float thresh = 0.35 + uAmount * 0.45;
        float waterMask = smoothstep(thresh - 0.05, thresh + 0.02, thresh - terrain + 0.5);
        // Lambert shading for sun-side sparkle
        float lit = max(dot(vNormalW, uLightDir), 0.0);
        vec3 deep = vec3(0.04, 0.18, 0.55);
        vec3 shallow = vec3(0.12, 0.52, 1.0);
        vec3 col = mix(deep, shallow, lit);
        // Specular glint on water
        vec3 h = normalize(uLightDir + vView);
        float spec = pow(max(dot(vNormalW, h), 0.0), 40.0) * lit;
        col += vec3(0.8, 0.9, 1.0) * spec * 0.9;
        float alpha = waterMask * uAmount * 0.55;
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const waterOverlay = new THREE.Mesh(new THREE.SphereGeometry(1.003, 128, 128), waterMat);
  waterOverlay.rotation.z = 0.41;
  earthGroup.add(waterOverlay);

  // Life overlay — green vegetation bloom on landmasses
  const lifeUniforms = {
    uLightDir: earthUniforms.uLightDir,
    uAmount:  { value: 0.0 },
    uTime:    { value: 0.0 },
    uWater:   { value: 0.5 },
  };
  const lifeMat = new THREE.ShaderMaterial({
    uniforms: lifeUniforms,
    vertexShader: overlayVert,
    fragmentShader: `
      varying vec3 vNormalW; varying vec3 vPos; varying vec3 vView;
      uniform vec3 uLightDir;
      uniform float uAmount; uniform float uTime; uniform float uWater;
      ${fbmGlsl}
      void main(){
        float n = fbm(vPos * 2.3);
        float n2 = fbm(vPos * 6.0);
        float terrain = n * 0.7 + n2 * 0.3;
        float thresh = 0.35 + uWater * 0.45;
        // Land mask (inverse of water)
        float landMask = smoothstep(thresh - 0.02, thresh + 0.05, thresh - terrain + 0.5);
        landMask = 1.0 - landMask;
        // Vegetation patches follow another noise scale
        float veg = fbm(vPos * 4.5 + vec3(0.7, 1.3, 2.1));
        float vegMask = smoothstep(0.35, 0.65, veg) * landMask;
        // Latitude falloff — less vegetation at poles
        float lat = abs(normalize(vPos).y);
        float polarFall = 1.0 - smoothstep(0.55, 0.92, lat);
        vegMask *= polarFall;
        float lit = max(dot(vNormalW, uLightDir), 0.0);
        vec3 forest = vec3(0.08, 0.55, 0.10);
        vec3 meadow = vec3(0.22, 0.82, 0.18);
        vec3 col = mix(forest, meadow, smoothstep(0.4, 0.8, veg)) * (0.3 + 0.9 * lit);
        float alpha = vegMask * uAmount * 0.75;
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const lifeOverlay = new THREE.Mesh(new THREE.SphereGeometry(1.0045, 128, 128), lifeMat);
  lifeOverlay.rotation.z = 0.41;
  earthGroup.add(lifeOverlay);

  // Intelligence overlay — warm city lights on the night side
  const intelUniforms = {
    uLightDir: earthUniforms.uLightDir,
    uAmount:  { value: 0.0 },
    uTime:    { value: 0.0 },
    uWater:   { value: 0.5 },
  };
  const intelMat = new THREE.ShaderMaterial({
    uniforms: intelUniforms,
    vertexShader: overlayVert,
    fragmentShader: `
      varying vec3 vNormalW; varying vec3 vPos; varying vec3 vView;
      uniform vec3 uLightDir;
      uniform float uAmount; uniform float uTime; uniform float uWater;
      ${fbmGlsl}
      void main(){
        float n = fbm(vPos * 2.3);
        float n2 = fbm(vPos * 6.0);
        float terrain = n * 0.7 + n2 * 0.3;
        float thresh = 0.35 + uWater * 0.45;
        float landMask = 1.0 - smoothstep(thresh - 0.02, thresh + 0.05, thresh - terrain + 0.5);
        // City clusters — high-frequency noise spikes
        float cities = fbm(vPos * 18.0);
        float cityMask = smoothstep(0.62, 0.82, cities) * landMask;
        // Night side only
        float night = clamp(-dot(vNormalW, uLightDir), 0.0, 1.0);
        night = smoothstep(0.0, 0.4, night);
        // Twinkle
        float tw = 0.8 + 0.2 * sin(uTime * 4.0 + cities * 40.0);
        vec3 warm = vec3(1.0, 0.72, 0.32) * tw;
        float alpha = cityMask * night * uAmount * 1.2;
        gl_FragColor = vec4(warm, clamp(alpha, 0.0, 1.0));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const intelOverlay = new THREE.Mesh(new THREE.SphereGeometry(1.006, 128, 128), intelMat);
  intelOverlay.rotation.z = 0.41;
  earthGroup.add(intelOverlay);

  // Ascension overlay — warm golden wash across the whole surface
  const ascendUniforms = {
    uLightDir: earthUniforms.uLightDir,
    uAmount:  { value: 0.0 },
    uTime:    { value: 0.0 },
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
        float pulse = 0.85 + 0.15 * sin(uTime * 1.3);
        vec3 gold = vec3(1.0, 0.82, 0.35);
        float a = (lit * 0.25 + fres * 0.55) * uAmount * pulse;
        gl_FragColor = vec4(gold, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const ascendOverlay = new THREE.Mesh(new THREE.SphereGeometry(1.008, 96, 96), ascendMat);
  earthGroup.add(ascendOverlay);

  // Load NASA GLB and swap in (higher-fidelity photographic base)
  let earthGLB = null;
  if (THREE.GLTFLoader) {
    const gltfLoader = new THREE.GLTFLoader();
    gltfLoader.load(
      'assets/earth.glb',
      (gltf) => {
        const model = gltf.scene;
        // Find innermost mesh (earth surface) — sort all meshes by bounding radius,
        // normalize to the smallest so overlays at 1.003+ sit flush on the surface.
        const meshInfos = [];
        model.traverse((o) => {
          if (o.isMesh) {
            const b = new THREE.Box3().setFromObject(o);
            const sp = b.getBoundingSphere(new THREE.Sphere());
            meshInfos.push({ mesh: o, radius: sp.radius, center: sp.center.clone() });
          }
        });
        meshInfos.sort((a, b) => a.radius - b.radius);
        if (meshInfos.length > 0) {
          const inner = meshInfos[0];
          for (const info of meshInfos) {
            if (info.radius > inner.radius * 1.03) info.mesh.visible = false;
          }
          const s = 1.0 / inner.radius;
          model.scale.setScalar(s);
          model.position.set(-inner.center.x * s, -inner.center.y * s, -inner.center.z * s);
        }
        model.rotation.z = 0.41;
        model.traverse((o) => {
          if (o.isMesh && o.material) {
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            mats.forEach((m) => {
              if (m.map)         m.map.encoding = THREE.sRGBEncoding;
              if (m.emissiveMap) m.emissiveMap.encoding = THREE.sRGBEncoding;
              m.needsUpdate = true;
            });
          }
        });
        // Hide procedural earth, show GLB
        earth.visible = false;
        earthGroup.add(model);
        earthGLB = model;
        // Add soft directional + ambient so the GLB reads well under stars
        if (!scene.userData.earthLightsAdded) {
          const amb = new THREE.AmbientLight(0x8090b0, 0.45);
          scene.add(amb);
          const dir = new THREE.DirectionalLight(0xfff1d8, 1.1);
          dir.position.set(3, 1.5, 2);
          scene.add(dir);
          scene.userData.earthLightsAdded = true;
        }
      },
      undefined,
      (err) => { console.warn('Sim earth GLB load failed, using shader fallback:', err); }
    );
  }

  /* ---------- Atmosphere ---------- */
  const atmUniforms = {
    uLightDir: earthUniforms.uLightDir,
    uColor: { value: new THREE.Color('#4a8fd9') },
    uIntensity: { value: 1.0 },
  };
  const atmMat = new THREE.ShaderMaterial({
    uniforms: atmUniforms,
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      varying vec3 vView;
      uniform vec3 uLightDir;
      uniform vec3 uColor;
      uniform float uIntensity;
      void main(){
        float fres = pow(1.0 - max(dot(vNormal, vView), 0.0), 2.3);
        float lit = smoothstep(-0.2, 0.7, dot(vNormal, uLightDir));
        float a = fres * (0.35 + 0.65 * lit) * uIntensity;
        gl_FragColor = vec4(uColor, a * 0.9);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
    depthWrite: false,
  });
  const atm = new THREE.Mesh(new THREE.SphereGeometry(1.08, 64, 64), atmMat);
  earthGroup.add(atm);

  /* ---------- Satellites (compute power) ---------- */
  const satGroup = new THREE.Group();
  earthGroup.add(satGroup);
  const SAT_COUNT = 40;
  const sats = [];
  for (let i = 0; i < SAT_COUNT; i++) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.018, 0.018, 0.018),
      new THREE.MeshBasicMaterial({ color: 0xc8cdd5 }),
    );
    g.add(body);
    // little "panel"
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.06, 0.012),
      new THREE.MeshBasicMaterial({ color: 0x3a5fb0, side: THREE.DoubleSide }),
    );
    g.add(panel);
    // orbital parameters
    const inclination = (Math.random() - 0.5) * Math.PI;
    const orbitRadius = 1.18 + Math.random() * 0.28;
    const phase = Math.random() * Math.PI * 2;
    const speed = 0.08 + Math.random() * 0.12;
    sats.push({ g, inclination, orbitRadius, phase, speed, body, panel });
    satGroup.add(g);
  }

  // Orbit ring lines (compute)
  const ringGroup = new THREE.Group();
  earthGroup.add(ringGroup);
  for (let i = 0; i < 3; i++) {
    const segs = 128;
    const pts = [];
    const r = 1.18 + i * 0.09;
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: 0x5ecfd4, transparent: true, opacity: 0.0 });
    const ring = new THREE.Line(geo, mat);
    ring.rotation.x = (Math.random() - 0.5) * 1.2;
    ring.rotation.z = (Math.random() - 0.5) * 0.5;
    ringGroup.add(ring);
  }

  /* ---------- Ascension halo ---------- */
  const haloMat = new THREE.ShaderMaterial({
    uniforms: {
      uAmount: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      varying vec3 vView;
      uniform float uAmount;
      uniform float uTime;
      void main(){
        float fres = pow(1.0 - max(dot(vNormal, vView), 0.0), 1.8);
        float pulse = 0.7 + 0.3 * sin(uTime * 0.8);
        vec3 col = vec3(1.0, 0.78, 0.35) * pulse;
        float a = fres * uAmount * 0.9;
        gl_FragColor = vec4(col, a);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
    depthWrite: false,
  });
  const halo = new THREE.Mesh(new THREE.SphereGeometry(1.28, 64, 64), haloMat);
  earthGroup.add(halo);

  // Dyson-ring for high ascension
  const dysonGroup = new THREE.Group();
  earthGroup.add(dysonGroup);
  for (let i = 0; i < 2; i++) {
    const segs = 256;
    const pts = [];
    const r = 1.55 + i * 0.12;
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    }
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const m = new THREE.LineBasicMaterial({ color: 0xffc87a, transparent: true, opacity: 0 });
    const line = new THREE.Line(g, m);
    line.rotation.x = i === 0 ? 0.4 : -0.3;
    line.rotation.z = i === 0 ? 0 : 0.6;
    dysonGroup.add(line);
  }

  /* ---------- Hero porthole Earth (mini scene) ---------- */
  const heroCanvas = document.getElementById('heroEarthCanvas');
  let heroRenderer = null, heroScene = null, heroCamera = null, heroEarth = null, heroAtm = null, heroHalo = null;

  if (heroCanvas) {
    // Create WebGL context explicitly before THREE grabs it, so other libs (e.g. html-to-image)
    // can't sneak in a 2D context and starve us of the canvas.
    const glCtxAttrs = { alpha: true, antialias: true, powerPreference: 'default' };
    const glCtx = heroCanvas.getContext('webgl2', glCtxAttrs) || heroCanvas.getContext('webgl', glCtxAttrs);
    heroRenderer = new THREE.WebGLRenderer({ canvas: heroCanvas, context: glCtx, antialias: true, alpha: true });
    heroRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    heroRenderer.setClearColor(0x000000, 0);
    heroRenderer.outputEncoding = THREE.sRGBEncoding;
    heroRenderer.setSize(400, 400, false); // initial size; positionHeroCanvas will adjust
    heroScene = new THREE.Scene();
    heroCamera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
    heroCamera.position.set(0, 0, 3.8);
    heroCamera.lookAt(0, 0, 0);

    // Soft star-cast lighting on the GLB Earth
    const ambient = new THREE.AmbientLight(0x8090b0, 0.35);
    heroScene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffeed1, 1.4);
    sun.position.set(3, 1.2, 2);
    heroScene.add(sun);
    const fill = new THREE.DirectionalLight(0x3a5a9a, 0.35);
    fill.position.set(-2, -0.5, 1);
    heroScene.add(fill);

    // Atmosphere rim (shader) still looks good behind real Earth
    heroAtm = new THREE.Mesh(new THREE.SphereGeometry(1.055, 48, 48), atmMat);
    heroScene.add(heroAtm);

    heroHalo = new THREE.Mesh(new THREE.SphereGeometry(1.22, 48, 48), haloMat);
    heroScene.add(heroHalo);

    // Placeholder shader-Earth while GLB loads (so the porthole isn't blank)
    heroEarth = new THREE.Mesh(earthGeo, earthMat);
    heroEarth.rotation.z = 0.41;
    heroScene.add(heroEarth);

    // Load NASA GLB and swap in
    if (THREE.GLTFLoader) {
      const loader = new THREE.GLTFLoader();
      loader.load(
        'assets/earth.glb',
        (gltf) => {
          const model = gltf.scene;
          // Same innermost-mesh normalization as main scene
          const meshInfos = [];
          model.traverse((o) => {
            if (o.isMesh) {
              const b = new THREE.Box3().setFromObject(o);
              const sp = b.getBoundingSphere(new THREE.Sphere());
              meshInfos.push({ mesh: o, radius: sp.radius, center: sp.center.clone() });
            }
          });
          meshInfos.sort((a, b) => a.radius - b.radius);
          if (meshInfos.length > 0) {
            const inner = meshInfos[0];
            for (const info of meshInfos) {
              if (info.radius > inner.radius * 1.03) info.mesh.visible = false;
            }
            const s = 1.0 / inner.radius;
            model.scale.setScalar(s);
            model.position.set(-inner.center.x * s, -inner.center.y * s, -inner.center.z * s);
          }
          model.rotation.z = 0.41;
          // Upgrade textures to sRGB so colors look right
          model.traverse((o) => {
            if (o.isMesh && o.material) {
              const mats = Array.isArray(o.material) ? o.material : [o.material];
              mats.forEach((m) => {
                if (m.map)         m.map.encoding = THREE.sRGBEncoding;
                if (m.emissiveMap) m.emissiveMap.encoding = THREE.sRGBEncoding;
                m.needsUpdate = true;
              });
            }
          });
          // Remove placeholder, swap in the GLB
          heroScene.remove(heroEarth);
          heroScene.add(model);
          heroEarth = model;
        },
        undefined,
        (err) => { console.warn('Earth GLB load failed, keeping shader fallback:', err); }
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
    // viewBox 1600x900 with preserveAspectRatio xMidYMax meet
    const vbW = 1600, vbH = 900;
    const scale = Math.min(svgRect.width / vbW, svgRect.height / vbH);
    const contentW = vbW * scale;
    const contentH = vbH * scale;
    const contentLeft = svgRect.left + (svgRect.width  - contentW) / 2;
    const contentTop  = svgRect.top  + (svgRect.height - contentH);          // xMid, yMax meet
    // Ring center in viewBox: (800, 340), inner radius 170
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

    // Also position press-hint just below the ring (y ~ 600 in viewBox)
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

    // push uniforms
    earthUniforms.uTime.value = time;
    earthUniforms.uWater.value = state.stats.water;
    earthUniforms.uLife.value = state.stats.life;
    earthUniforms.uIntel.value = state.stats.intelligence;
    earthUniforms.uCompute.value = state.stats.compute;
    earthUniforms.uAscend.value = state.stats.ascension;

    // Atmosphere tint shifts with life: dead planet -> cold blue-white, lush -> richer blue
    const lifeFactor = state.stats.life;
    atmUniforms.uColor.value.setRGB(
      0.29 + 0.05 * (1 - lifeFactor),
      0.56 - 0.05 * (1 - lifeFactor),
      0.85
    );
    atmUniforms.uIntensity.value = 0.6 + 0.4 * state.stats.water;

    // Rotate
    earth.rotation.y += dt * 0.06;
    if (earthGLB) earthGLB.rotation.y = earth.rotation.y;
    waterOverlay.rotation.y = earth.rotation.y;
    lifeOverlay.rotation.y = earth.rotation.y;
    intelOverlay.rotation.y = earth.rotation.y;
    satGroup.rotation.y = earth.rotation.y * 0.2;

    // Push overlay uniforms so stat bars drive the visual
    waterUniforms.uAmount.value = state.stats.water;
    waterUniforms.uTime.value = time;
    lifeUniforms.uAmount.value = state.stats.life;
    lifeUniforms.uWater.value = state.stats.water;
    lifeUniforms.uTime.value = time;
    intelUniforms.uAmount.value = state.stats.intelligence;
    intelUniforms.uWater.value = state.stats.water;
    intelUniforms.uTime.value = time;
    ascendUniforms.uAmount.value = state.stats.ascension;
    ascendUniforms.uTime.value = time;

    // Satellites
    satGroup.visible = state.stats.compute > 0.01;
    const satAmt = state.stats.compute;
    const satVisibleCount = Math.floor(satAmt * SAT_COUNT);
    for (let i = 0; i < SAT_COUNT; i++) {
      const s = sats[i];
      s.g.visible = i < satVisibleCount;
      if (!s.g.visible) continue;
      const a = s.phase + time * s.speed;
      const x = Math.cos(a) * s.orbitRadius;
      const z = Math.sin(a) * s.orbitRadius;
      const y = Math.sin(a) * Math.sin(s.inclination) * s.orbitRadius;
      const xr = x;
      const zr = z * Math.cos(s.inclination);
      s.g.position.set(xr, y, zr);
      s.g.lookAt(0, 0, 0);
      s.body.material.opacity = 1;
    }

    // Orbit rings opacity
    ringGroup.children.forEach((r, i) => {
      r.material.opacity = clamp(state.stats.compute * 0.6 - i * 0.15, 0, 0.8);
    });

    // Halo amount
    haloMat.uniforms.uAmount.value = state.stats.ascension;
    haloMat.uniforms.uTime.value = time;

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

    // Always render hero Earth while hero is visible
    if (heroRenderer && !state.inGame) {
      if (heroEarth) heroEarth.rotation.y = earth.rotation.y;
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
    // Earth code signature (fun detail)
    const sig =
      Math.round(state.stats.water * 9).toString() +
      Math.round(state.stats.life * 9).toString() +
      Math.round(state.stats.intelligence * 9).toString() +
      Math.round(state.stats.compute * 9).toString() +
      Math.round(state.stats.ascension * 9).toString();
    document.getElementById('statsCode').textContent = 'EARTH-' + sig;

    // Active preset highlight
    document.querySelectorAll('.preset').forEach(b => {
      const p = PRESETS[b.dataset.preset];
      const match = ['water','life','intelligence','compute','ascension']
        .every(k => Math.abs(p[k] - state.stats[k]) < 0.005);
      b.classList.toggle('active', match);
    });
  }

  // Drag logic on stat bars
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

    const onDown = (e) => {
      dragging = true;
      setFromEvent(e);
      e.preventDefault();
    };
    const onMove = (e) => { if (dragging) setFromEvent(e); };
    const onUp = () => { dragging = false; };

    bar.addEventListener('mousedown', onDown);
    bar.addEventListener('touchstart', onDown, { passive: false });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
  });

  // Presets
  document.querySelectorAll('.preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = PRESETS[btn.dataset.preset];
      // animate toward preset
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

  // Show scroll hint after a moment
  setTimeout(() => scrollHint.classList.add('show'), 900);

  function enterGame() {
    if (state.inGame || state.transitioning) return;
    state.transitioning = true;
    hero.classList.add('zooming');
    if (scrollHint) scrollHint.classList.remove('show');
    // Reveal game a bit before the zoom completes so there's a smooth handoff
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

  // Trigger via click on controller / porthole / press hint
  pressHint.addEventListener('click', enterGame);
  controller.addEventListener('click', enterGame);
  const playBtn = document.getElementById('playBtn');
  if (playBtn) playBtn.addEventListener('click', enterGame);
  const navPlay = document.getElementById('navPlay');
  if (navPlay) navPlay.addEventListener('click', (e) => { e.preventDefault(); enterGame(); });

  // Email form — graceful no-backend handler
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

  // Pre-order button — placeholder link behavior
  const preorderBtn = document.getElementById('preorderBtn');
  if (preorderBtn) {
    preorderBtn.addEventListener('click', (e) => {
      // let href="#preorder" behave; just provide a small nudge
      e.preventDefault();
      preorderBtn.innerHTML = 'Coming soon — join the list <span class="arrow">↓</span>';
      setTimeout(() => {
        preorderBtn.innerHTML = 'Pre-order the Book <span class="arrow">→</span>';
      }, 2400);
      const input = emailForm && emailForm.querySelector('input');
      if (input && !input.disabled) input.focus();
    });
  }

  // Trigger via scroll / wheel
  let scrollAccum = 0;
  window.addEventListener('wheel', (e) => {
    if (state.inGame || state.transitioning) return;
    scrollAccum += e.deltaY;
    if (scrollAccum > 30) enterGame();
  }, { passive: true });

  // Touch swipe up
  let touchStartY = null;
  window.addEventListener('touchstart', (e) => {
    if (!state.inGame) touchStartY = e.touches[0].clientY;
  }, { passive: true });
  window.addEventListener('touchmove', (e) => {
    if (state.inGame || touchStartY == null) return;
    const dy = touchStartY - e.touches[0].clientY;
    if (dy > 50) { enterGame(); touchStartY = null; }
  }, { passive: true });

  // Back button
  document.getElementById('backBtn').addEventListener('click', exitGame);

  // Escape key
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.inGame) exitGame();
    if ((e.key === 'Enter' || e.key === ' ') && !state.inGame) enterGame();
  });

})();
