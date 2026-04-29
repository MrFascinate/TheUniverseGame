/* ==========================================================
   The Universe Game — game.js
   Cover-page logic only. The full simulation lives in
   simulation.html and is reached through the Press Start
   zoom + fade-to-black handoff. This file is responsible for:
     - the live Earth sitting in the controller's porthole,
       rendered with the same shader stack as simulation.html
       so the cover and the simulation read as one continuous
       artifact
     - Press Start → fade → redirect
     - email + preorder UI bits
   ========================================================== */

(() => {
  const state = { inGame: false, transitioning: false };

  /* ============================================================
     PORTHOLE EARTH — same shader as simulation.html, default state
     (water 0.5, life 0.5, ascension 0). Continents fixed; clouds drift.
     ============================================================ */
  const heroCanvas = document.getElementById('heroEarthCanvas');
  let heroRenderer = null, heroScene = null, heroCamera = null;
  let earthUniforms = null, cloudUniforms = null, atmUniforms = null;
  let cloudMesh = null;

  if (heroCanvas) {
    heroRenderer = new THREE.WebGLRenderer({ canvas: heroCanvas, antialias: true, alpha: true });
    heroRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    heroRenderer.setClearColor(0x000000, 0);
    heroRenderer.outputEncoding = THREE.sRGBEncoding;
    heroRenderer.setSize(400, 400, false);

    heroScene = new THREE.Scene();
    heroCamera = new THREE.PerspectiveCamera(35, 1, 0.05, 100);
    heroCamera.position.set(0, 0.20, 4.7);
    heroCamera.lookAt(0, 0, 0);

    const SUN_DIR = new THREE.Vector3(-1, 0.3, 0.5).normalize();
    const sunLight = new THREE.DirectionalLight(0xfff4d6, 1.6);
    sunLight.position.copy(SUN_DIR.clone().multiplyScalar(50));
    heroScene.add(sunLight);
    heroScene.add(new THREE.HemisphereLight(0x8aa6cc, 0x101428, 0.10));

    const dummyTex = new THREE.DataTexture(new Uint8Array([0,0,0,255]), 1, 1, THREE.RGBAFormat);
    dummyTex.needsUpdate = true;

    earthUniforms = {
      uTime:    { value: 0 },
      uDiffuse: { value: dummyTex },
      uNormal:  { value: dummyTex },
      uSpec:    { value: dummyTex },
      uNight:   { value: dummyTex },
      uHasTex:  { value: 0 },
      uWater:   { value: 0.5 },
      uLife:    { value: 0.5 },
      uSunDir:  { value: SUN_DIR.clone() },
      uWarm:    { value: 0 },
    };

    const earthVS = `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec3 vViewDir;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vViewDir = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `;
    const earthFS = `
      precision highp float;
      uniform float uTime;
      uniform sampler2D uDiffuse;
      uniform sampler2D uNormal;
      uniform sampler2D uSpec;
      uniform sampler2D uNight;
      uniform float uHasTex;
      uniform float uWater;
      uniform float uLife;
      uniform vec3  uSunDir;
      uniform float uWarm;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec3 vViewDir;

      float hash31(vec3 p) {
        p = fract(p * vec3(443.897, 441.423, 437.195));
        p += dot(p, p.yzx + 19.19);
        return fract((p.x + p.y) * p.z);
      }
      float vnoise(vec3 p) {
        vec3 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(hash31(i+vec3(0,0,0)), hash31(i+vec3(1,0,0)), f.x),
              mix(hash31(i+vec3(0,1,0)), hash31(i+vec3(1,1,0)), f.x), f.y),
          mix(mix(hash31(i+vec3(0,0,1)), hash31(i+vec3(1,0,1)), f.x),
              mix(hash31(i+vec3(0,1,1)), hash31(i+vec3(1,1,1)), f.x), f.y),
          f.z);
      }
      float fbm(vec3 p) {
        float a = 0.5, r = 0.0;
        for (int i = 0; i < 5; i++) { r += a * vnoise(p); p *= 2.07; a *= 0.5; }
        return r;
      }

      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(vViewDir);
        vec3 L = normalize(uSunDir);

        float elevation;
        vec3  baseDiffuse;
        float originalSpec;

        if (uHasTex > 0.5) {
          vec4 d = texture2D(uDiffuse, vUv);
          originalSpec = texture2D(uSpec, vUv).r;
          elevation = 1.0 - originalSpec;
          baseDiffuse = d.rgb;
          vec3 nm = texture2D(uNormal, vUv).rgb * 2.0 - 1.0;
          N = normalize(N + nm * 0.35);
        } else {
          vec3 dir = normalize(vWorldPos);
          float e = fbm(dir * 2.6 + vec3(13.7, 4.1, 21.3));
          e = smoothstep(0.42, 0.72, e + 0.05 * fbm(dir * 8.0));
          elevation = e;
          originalSpec = 1.0 - smoothstep(0.45, 0.55, e);
          vec3 oceanCol = vec3(0.05, 0.18, 0.36);
          vec3 dryCol   = vec3(0.50, 0.42, 0.30);
          vec3 lushCol  = vec3(0.18, 0.48, 0.20);
          vec3 land = mix(dryCol, lushCol, uLife);
          baseDiffuse = mix(oceanCol, land, smoothstep(0.46, 0.54, e));
          float h0 = fbm(dir * 8.0);
          float h1 = fbm(dir * 8.0 + vec3(0.01, 0.0, 0.0));
          float h2 = fbm(dir * 8.0 + vec3(0.0, 0.01, 0.0));
          vec3 bump = vec3((h1-h0)*30.0, (h2-h0)*30.0, 0.0);
          N = normalize(N + bump * 0.06);
        }

        float seaLevel = mix(-0.10, 1.10, uWater);
        float band = 0.025;
        float oceanMask = 1.0 - smoothstep(seaLevel - band, seaLevel + band, elevation);

        float wasOcean = smoothstep(0.35, 0.7, originalSpec);
        float landLuma = dot(baseDiffuse, vec3(0.299, 0.587, 0.114));

        float ridgeNoise = fbm(normalize(vWorldPos) * 28.0);
        vec3 dryCol = mix(
          vec3(0.62, 0.48, 0.34),
          vec3(0.78, 0.62, 0.42),
          smoothstep(0.4, 0.7, ridgeNoise)
        );
        dryCol *= 0.7 + 0.4 * landLuma;

        vec3 lushCol = vec3(baseDiffuse.r * 0.55, baseDiffuse.g * 1.20 + 0.08, baseDiffuse.b * 0.42);
        vec3 dustCol = vec3(landLuma * 1.25, landLuma * 0.95, landLuma * 0.65) * vec3(1.05, 0.85, 0.62);
        vec3 lifeCol = mix(dustCol, lushCol, uLife);

        float vegN = fbm(normalize(vWorldPos) * 18.0 + vec3(7.0));
        lifeCol *= 1.0 + 0.18 * uLife * (vegN - 0.5);

        vec3 landColor = mix(lifeCol, dryCol, wasOcean * (1.0 - smoothstep(0.0, 0.4, uWater)));

        float lat = abs(vUv.y - 0.5) * 2.0;
        float poleIce = smoothstep(0.82, 0.95, lat) * smoothstep(0.10, 0.35, uWater);
        landColor = mix(landColor, vec3(0.93, 0.96, 1.00), poleIce);

        float dryness = clamp(1.0 - uWater * 2.0, 0.0, 1.0);
        landColor = mix(landColor, dryCol * 1.05, dryness * 0.55);

        vec3 oceanShallow = vec3(0.10, 0.38, 0.55);
        vec3 oceanDeep    = vec3(0.020, 0.08, 0.22);
        float depth = smoothstep(seaLevel, seaLevel - 0.30, elevation);
        vec3 oceanColor = mix(oceanShallow, oceanDeep, depth);

        float rip = fbm(normalize(vWorldPos) * 80.0 + vec3(uTime * 0.4));
        vec3 oceanN = normalize(N + vec3(rip - 0.5, (rip - 0.5) * 0.7, 0.0) * 0.04);

        vec3 H = normalize(L + V);
        float specStrength = pow(max(dot(oceanN, H), 0.0), 96.0);
        float fres = pow(1.0 - max(dot(oceanN, V), 0.0), 3.5);
        vec3 sunSpec = vec3(1.0, 0.95, 0.82) * specStrength * (0.35 + 0.7 * fres);

        vec3 albedo = mix(landColor, oceanColor, oceanMask);
        float NdotL = clamp(dot(N, L), 0.0, 1.0);
        float wrap = clamp((dot(N, L) + 0.18) / 1.18, 0.0, 1.0);

        vec3 sunCol = vec3(1.00, 0.96, 0.86);
        vec3 lit = albedo * sunCol * wrap;
        lit += albedo * vec3(0.06, 0.08, 0.13);
        lit += sunSpec * oceanMask;

        float nightSide = smoothstep(0.0, -0.18, dot(N, L));
        vec3 nightTex = (uHasTex > 0.5) ? texture2D(uNight, vUv).rgb : vec3(0.0);
        if (uHasTex < 0.5) {
          float ns = step(0.78, fbm(normalize(vWorldPos) * 60.0));
          nightTex = vec3(ns, ns * 0.9, ns * 0.55) * 0.6;
        }
        lit += nightTex * nightSide * (1.0 - oceanMask) * (1.0 - poleIce) * 1.7;

        if (uWarm > 0.0) {
          float dayFace = clamp(dot(N, L), 0.0, 1.0);
          lit += vec3(0.32, 0.18, 0.06) * uWarm * (0.4 + 0.6 * dayFace);
        }

        gl_FragColor = vec4(lit, 1.0);
      }
    `;

    const earthMat = new THREE.ShaderMaterial({
      uniforms: earthUniforms,
      vertexShader: earthVS,
      fragmentShader: earthFS,
    });
    const earthMesh = new THREE.Mesh(new THREE.SphereGeometry(1.0, 128, 128), earthMat);
    heroScene.add(earthMesh);

    /* Clouds — fully procedural 3D fbm, matches simulation */
    cloudUniforms = {
      uTime:   { value: 0 },
      uWater:  { value: 0.5 },
      uSunDir: { value: SUN_DIR.clone() },
    };
    const cloudMat = new THREE.ShaderMaterial({
      uniforms: cloudUniforms,
      transparent: true, depthWrite: false,
      vertexShader: `
        varying vec3 vN;
        varying vec3 vLP;
        void main() {
          vN = normalize(mat3(modelMatrix) * normal);
          vLP = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uWater;
        uniform vec3 uSunDir;
        varying vec3 vN;
        varying vec3 vLP;

        float h31(vec3 p) {
          p = fract(p * vec3(443.897, 441.423, 437.195));
          p += dot(p, p.yzx + 19.19);
          return fract((p.x + p.y) * p.z);
        }
        float vn(vec3 p) {
          vec3 i = floor(p), f = fract(p);
          f = f*f*(3.0-2.0*f);
          return mix(
            mix(mix(h31(i+vec3(0,0,0)),h31(i+vec3(1,0,0)),f.x),
                mix(h31(i+vec3(0,1,0)),h31(i+vec3(1,1,0)),f.x),f.y),
            mix(mix(h31(i+vec3(0,0,1)),h31(i+vec3(1,0,1)),f.x),
                mix(h31(i+vec3(0,1,1)),h31(i+vec3(1,1,1)),f.x),f.y),
            f.z);
        }
        float fb(vec3 p){ float a=0.5,r=0.0; for(int i=0;i<5;i++){r+=a*vn(p);p*=2.07;a*=0.5;} return r; }

        void main() {
          vec3 dir = normalize(vLP);
          float c1 = fb(dir * 3.1  + vec3(uTime * 0.012, 0.0, uTime * 0.008));
          float c2 = fb(dir * 8.6  + vec3(uTime * 0.020, uTime * 0.011, 0.0));
          float c3 = fb(dir * 22.0 + vec3(0.0, uTime * 0.030, uTime * 0.018));
          float c = c1 * 1.0 + c2 * 0.55 + c3 * 0.28;
          c = c / 1.83;
          c = smoothstep(0.46, 0.74, c);
          c *= 1.0 - 0.20 * abs(dir.y);
          c *= 1.0 + uWater * 0.30;
          c *= smoothstep(0.0, 0.18, uWater);
          c = clamp(c, 0.0, 1.0);

          float wrap = clamp((dot(normalize(vN), normalize(uSunDir)) + 0.25) / 1.25, 0.0, 1.0);
          vec3 col = mix(vec3(0.55, 0.62, 0.78), vec3(1.0, 0.99, 0.96), wrap);
          gl_FragColor = vec4(col, c * (0.35 + 0.65 * wrap));
        }
      `,
    });
    cloudMesh = new THREE.Mesh(new THREE.SphereGeometry(1.005, 96, 96), cloudMat);
    heroScene.add(cloudMesh);

    /* Atmosphere — backside fresnel sphere, matches simulation */
    atmUniforms = { uSunDir: { value: SUN_DIR.clone() } };
    const atmMat = new THREE.ShaderMaterial({
      uniforms: atmUniforms,
      transparent: true, depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        varying vec3 vN;
        varying vec3 vWP;
        void main() {
          vN = normalize(mat3(modelMatrix) * normal);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWP = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 uSunDir;
        varying vec3 vN;
        varying vec3 vWP;
        void main() {
          vec3 V = normalize(cameraPosition - vWP);
          float fres = pow(1.0 - abs(dot(vN, V)), 2.6);
          float daySide = clamp(dot(normalize(vWP), normalize(uSunDir)), 0.0, 1.0);
          float dayBoost = 0.55 + daySide * 0.85;
          vec3 col = mix(vec3(0.18, 0.42, 0.95), vec3(0.6, 0.78, 1.0), daySide);
          gl_FragColor = vec4(col * fres * dayBoost, fres * dayBoost);
        }
      `,
    });
    const atmMesh = new THREE.Mesh(new THREE.SphereGeometry(1.04, 96, 96), atmMat);
    heroScene.add(atmMesh);

    /* Texture loading — identical URLs and fallback semantics to simulation.html */
    (function loadTextures() {
      const loader = new THREE.TextureLoader();
      loader.crossOrigin = 'anonymous';
      const URLS = {
        diffuse: 'https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg',
        normal:  'https://threejs.org/examples/textures/planets/earth_normal_2048.jpg',
        spec:    'https://threejs.org/examples/textures/planets/earth_specular_2048.jpg',
        night:   'https://threejs.org/examples/textures/planets/earth_lights_2048.png',
      };
      let pending = 4, anyFailed = false;
      const resolve = () => {
        pending--;
        if (pending !== 0) return;
        earthUniforms.uHasTex.value = anyFailed ? 0 : 1;
      };
      const maxAniso = heroRenderer.capabilities.getMaxAnisotropy();
      function bind(key, srgb) {
        loader.load(URLS[key],
          (tex) => {
            if (srgb) tex.encoding = THREE.sRGBEncoding;
            tex.wrapS = THREE.RepeatWrapping;
            tex.anisotropy = maxAniso;
            tex.minFilter = THREE.LinearMipmapLinearFilter;
            tex.magFilter = THREE.LinearFilter;
            tex.generateMipmaps = true;
            if (key === 'diffuse')     earthUniforms.uDiffuse.value = tex;
            else if (key === 'normal') earthUniforms.uNormal.value = tex;
            else if (key === 'spec')   earthUniforms.uSpec.value = tex;
            else if (key === 'night')  earthUniforms.uNight.value = tex;
            resolve();
          },
          undefined,
          () => { anyFailed = true; resolve(); }
        );
      }
      bind('diffuse', true);
      bind('normal',  false);
      bind('spec',    false);
      bind('night',   true);
    })();
  }

  /* ============================================================
     POSITION HERO CANVAS — keep the porthole canvas aligned with
     the SVG ring as the layout changes.
     ============================================================ */
  function positionHeroCanvas() {
    if (state.transitioning) return;
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

  /* ============================================================
     ANIMATION — Earth fixed; clouds drift; atmosphere static.
     Stop rendering once we've started transitioning to the sim
     so we don't waste cycles during the fade.
     ============================================================ */
  const clock = new THREE.Clock();
  let cloudRotY = 0;
  function animate() {
    const dt = clock.getDelta();
    const t = clock.elapsedTime;
    if (heroRenderer && !state.transitioning) {
      cloudRotY += dt * 0.045;
      if (cloudMesh) cloudMesh.rotation.y = cloudRotY;
      if (earthUniforms) earthUniforms.uTime.value = t;
      if (cloudUniforms) cloudUniforms.uTime.value = t;
      heroRenderer.render(heroScene, heroCamera);
    }
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  /* ============================================================
     PRESS START → fade-to-black → redirect to simulation.html
     ============================================================ */
  const hero = document.getElementById('hero');
  const controller = document.getElementById('controller');
  const pressHint = document.getElementById('pressHint');
  const scrollHint = document.getElementById('scrollHint');

  if (scrollHint) setTimeout(() => scrollHint.classList.add('show'), 900);

  function enterGame() {
    if (state.transitioning) return;
    state.transitioning = true;
    if (hero) hero.classList.add('zooming');
    if (scrollHint) scrollHint.classList.remove('show');
    const fade = document.getElementById('zoomFade');
    setTimeout(() => { if (fade) fade.classList.add('active'); }, 650);
    setTimeout(() => {
      window.location.href = 'simulation.html';
    }, 1350);
  }

  if (pressHint)  pressHint.addEventListener('click', enterGame);
  if (controller) controller.addEventListener('click', enterGame);
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

  /* Pre-order modal — opens from the cover's CTA */
  const preorderBtn = document.getElementById('preorderBtn');
  const preorderModal = document.getElementById('preorderModal');
  const preorderForm = document.getElementById('preorderForm');
  let lastPreorderFocus = null;
  function openPreorder() {
    if (!preorderModal) return;
    lastPreorderFocus = document.activeElement;
    preorderModal.hidden = false;
    const input = preorderForm && preorderForm.querySelector('input');
    if (input) setTimeout(() => input.focus(), 30);
  }
  function closePreorder() {
    if (!preorderModal) return;
    preorderModal.hidden = true;
    if (lastPreorderFocus && lastPreorderFocus.focus) {
      try { lastPreorderFocus.focus(); } catch (_) {}
    }
  }
  if (preorderBtn) {
    preorderBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openPreorder();
    });
  }
  if (preorderModal) {
    preorderModal.querySelectorAll('[data-close]').forEach(el => {
      el.addEventListener('click', closePreorder);
    });
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && preorderModal && !preorderModal.hidden) closePreorder();
  });
  if (preorderForm) {
    preorderForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = preorderForm.querySelector('input');
      const btn = preorderForm.querySelector('button');
      if (!input.value || !input.checkValidity()) { input.focus(); return; }
      preorderForm.classList.add('sent');
      btn.textContent = '✓ On the list';
      input.value = 'See you at launch.';
      input.disabled = true;
      btn.disabled = true;
      setTimeout(closePreorder, 1500);
    });
  }

  let scrollAccum = 0;
  window.addEventListener('wheel', (e) => {
    if (state.transitioning) return;
    scrollAccum += e.deltaY;
    if (scrollAccum > 30) enterGame();
  }, { passive: true });

  let touchStartY = null;
  window.addEventListener('touchstart', (e) => {
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  window.addEventListener('touchmove', (e) => {
    if (state.transitioning || touchStartY == null) return;
    const dy = touchStartY - e.touches[0].clientY;
    if (dy > 50) { enterGame(); touchStartY = null; }
  }, { passive: true });

  window.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !state.transitioning) enterGame();
  });
})();
