import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { CONFIG } from './config.js';
import { emit, on, EVENTS, PHASES } from './bus.js';
import { clamp, rand, pick, damp } from './util.js';

import { createSky } from '../scene/sky.js';
import { createWater } from '../scene/water.js';
import { createDiyas } from '../scene/diyas.js';
import { createCity } from '../scene/city.js';
import { createRangoli } from '../scene/rangoli.js';
import { createFireworks } from '../scene/fireworks.js';
import { createCameraRig } from '../scene/cameraRig.js';
import { audio } from '../audio/audio.js';

export function createApp(canvas) {
  /* ── renderer ─────────────────────────────────────────────── */

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: CONFIG.tier !== 'low',
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setClearColor(0x04010a, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const dpr = Math.min(window.devicePixelRatio || 1, CONFIG.dprCap);
  renderer.setPixelRatio(dpr);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x180630, 0.0062);

  const camera = new THREE.PerspectiveCamera(
    CONFIG.camera.fov, window.innerWidth / window.innerHeight, 0.1, 700
  );
  camera.position.set(...CONFIG.camera.start);

  /* ── world ────────────────────────────────────────────────── */

  const sky = createSky();
  const water = createWater();
  const city = createCity();
  const diyas = createDiyas();
  const rangoli = createRangoli();
  const fireworks = createFireworks();
  const rig = createCameraRig(camera, canvas);

  scene.add(sky.group, water.mesh, city.group, diyas.group, rangoli.mesh, fireworks.group);

  for (const m of [sky, diyas, city, fireworks]) m.setPixelRatio(dpr);

  /* ── post ─────────────────────────────────────────────────── */

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(dpr);
  const renderPass = new RenderPass(scene, camera);

  const bloomRes = new THREE.Vector2(
    Math.max(128, window.innerWidth * CONFIG.bloom.scale),
    Math.max(128, window.innerHeight * CONFIG.bloom.scale)
  );
  const bloom = new UnrealBloomPass(
    bloomRes, CONFIG.bloom.strength, CONFIG.bloom.radius, CONFIG.bloom.threshold
  );
  const output = new OutputPass();
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(output);

  /* ── state ────────────────────────────────────────────────── */

  const state = {
    phase: PHASES.LOADING,
    skyUnlocked: false,
    finaleDone: false,
    recipient: '',
    running: true,
    nextAmbient: Infinity,
    bloomTarget: CONFIG.bloom.strength,
  };

  const clock = new THREE.Clock();
  let elapsed = 0;

  /* ── picking ──────────────────────────────────────────────── */

  const raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = 0.4;
  const waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint = new THREE.Vector3();

  function pickDiya() {
    raycaster.setFromCamera(rig.pointer, camera);
    const hits = raycaster.intersectObject(diyas.hitMesh, false);
    if (hits.length) return hits[0].instanceId ?? -1;

    // forgiving fallback: whatever unlit lamp is nearest where the ray
    // crosses the water — taps on a phone are not precise
    if (raycaster.ray.intersectPlane(waterPlane, hitPoint)) {
      return diyas.nearestUnlit(hitPoint, 2.4);
    }
    return -1;
  }

  function skyPointFromPointer() {
    raycaster.setFromCamera(rig.pointer, camera);
    const d = raycaster.ray.direction;
    // where the ray leaves the frame, pulled back to a plausible shell depth
    const depth = rand(18, 34);
    const p = raycaster.ray.origin.clone().addScaledVector(d, depth);
    p.y = clamp(p.y, 9, 24);
    return p;
  }

  /* ── interaction ──────────────────────────────────────────── */

  let downAt = 0;
  let downPos = { x: 0, y: 0 };
  let moved = false;

  function onPointerMove(e) {
    rig.setPointer(e.clientX, e.clientY);
    if (Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 12) moved = true;
    if (state.phase === PHASES.LIGHTING || state.phase === PHASES.CELEBRATION) {
      const i = pickDiya();
      diyas.setHover(i);
      canvas.style.cursor = i >= 0 ? 'pointer' : 'crosshair';
    }
  }

  function onPointerDown(e) {
    canvas.setPointerCapture?.(e.pointerId);
    downAt = performance.now();
    downPos = { x: e.clientX, y: e.clientY };
    moved = false;
    rig.setPointer(e.clientX, e.clientY);
  }

  function onPointerUp(e) {
    rig.setPointer(e.clientX, e.clientY);
    const quick = performance.now() - downAt < 600;
    if (!quick || moved) return;
    if (state.phase === PHASES.INTRO || state.phase === PHASES.LOADING) return;

    const i = pickDiya();
    if (i >= 0 && diyas.ignite(i)) return;

    // nothing to light here — send a shell up instead
    if (state.skyUnlocked) {
      const p = skyPointFromPointer();
      fireworks.launch({
        from: { x: clamp(p.x * 0.6, -22, 22), y: 0.4, z: clamp(p.z, -46, -14) },
        to: { x: p.x, y: p.y, z: p.z },
        scale: rand(0.9, 1.3),
      });
      audio.whoosh({ pan: clamp(p.x / 18, -1, 1) });
    }
  }

  canvas.addEventListener('pointermove', onPointerMove, { passive: true });
  canvas.addEventListener('pointerdown', onPointerDown, { passive: true });
  canvas.addEventListener('pointerup', onPointerUp, { passive: true });
  canvas.addEventListener('pointercancel', () => { moved = true; }, { passive: true });

  /* ── reactions ────────────────────────────────────────────── */

  on(EVENTS.DIYA_LIT, ({ x, z, step, litCount, total }) => {
    const pan = clamp(x / 18, -1, 1);
    audio.spark({ pan, step });

    const ratio = litCount / total;
    rangoli.setProgress(ratio * 1.3);
    city.setBulbs(clamp(ratio * 1.6, 0, 1));
    sky.setMood(ratio);
    water.setWarmth(ratio);
    // a hundred flames bloom a hundred times over, so the pass has to give
    // ground as the river fills or the whole frame turns to milk
    state.bloomTarget = CONFIG.bloom.strength * (1 - ratio * 0.42);

    emit(EVENTS.PROGRESS, { litCount, total, ratio });

    if (!state.skyUnlocked && ratio >= CONFIG.skyUnlockRatio) unlockSky();
  });

  on(EVENTS.BURST, ({ x, y, z, hex, scale, pattern }) => {
    if (pattern === 'launch') return;
    const pan = clamp(x / 20, -1, 1);
    water.flash(hex, 0.5 * scale);
    sky.flash(hex, 0.4 * scale);
    rig.impulse(0.35 * scale);

    // light travels faster than sound, and the river is wide
    const dist = Math.hypot(x - camera.position.x, y - camera.position.y, z - camera.position.z);
    const delay = Math.min(0.55, dist / 160);
    setTimeout(() => {
      audio.boom({ pan, size: clamp(scale, 0.5, 1.6) });
      if (pattern === 'chrysanthemum' || pattern === 'crossette' || Math.random() < 0.6) {
        audio.crackle({ pan, density: 26 + 20 * scale });
      }
      if (pattern === 'willow' || pattern === 'palm' || pattern === 'text') {
        audio.shimmer({ pan });
      }
    }, delay * 1000);
  });

  on(EVENTS.SPREAD_ALL, () => {
    diyas.igniteAll(true);
    audio.bell({ freq: 196, gain: 0.26, decay: 4.5 });
  });

  /* ── phases ───────────────────────────────────────────────── */

  function setPhase(phase) {
    state.phase = phase;
    emit(EVENTS.PHASE, phase);
  }

  function begin(recipient) {
    state.recipient = (recipient || '').trim();
    setPhase(PHASES.LIGHTING);
    city.litPedestals(elapsed + 0.4);
    audio.startDrone();
    audio.bell({ freq: 261.63, gain: 0.3, decay: 4.2 });
    rangoli.setProgress(0.12);
  }

  function unlockSky() {
    state.skyUnlocked = true;
    setPhase(PHASES.CELEBRATION);
    audio.liftDrone(0.13);
    emit(EVENTS.SKY_UNLOCKED, {});

    // opening volley
    const patterns = ['sphere', 'ring', 'chrysanthemum', 'palm'];
    for (let i = 0; i < 6; i++) {
      fireworks.later(i * 0.42 + 0.1, () => {
        fireworks.launch({
          from: { x: rand(-22, 22), y: 0.4, z: rand(-44, -18) },
          pattern: patterns[i % patterns.length],
          scale: rand(1.0, 1.45),
        });
        audio.whoosh({ pan: rand(-0.8, 0.8) });
      });
    }
    state.nextAmbient = elapsed + 3.2;
  }

  function finale() {
    if (state.finaleDone) return;
    state.finaleDone = true;
    setPhase(PHASES.FINALE);
    diyas.igniteAll(true);
    rangoli.setProgress(1);
    city.setBulbs(1);
    rig.setPose(null, portrait ? CONFIG.camera.portrait.finaleLook : CONFIG.camera.finaleLook);
    audio.liftDrone(0.17);

    const name = state.recipient;
    const line1 = name ? `For ${name}` : 'Shubh';
    const line2 = name ? 'Shubh Deepawali' : 'Deepawali';

    // sweep of shells left to right, then the writing
    for (let i = 0; i < 9; i++) {
      fireworks.later(i * 0.26, () => {
        fireworks.launch({
          from: { x: -22 + i * 5.5, y: 0.4, z: rand(-42, -20) },
          apexY: rand(13, 18),
          pattern: pick(['sphere', 'ring', 'chrysanthemum', 'willow']),
          scale: rand(1.0, 1.4),
        });
        audio.whoosh({ pan: clamp((-22 + i * 5.5) / 20, -1, 1) });
      });
    }

    fireworks.later(2.6, () => {
      fireworks.writeText(line1, { at: { x: 0, y: 20.4, z: -28 }, height: 3.4, hold: 4.6 });
      audio.bell({ freq: 329.63, gain: 0.3, decay: 5 });
    });
    fireworks.later(3.5, () => {
      fireworks.writeText(line2, { at: { x: 0, y: 15.6, z: -28 }, height: 4.6, hold: 5.0 });
      audio.bell({ freq: 392, gain: 0.32, decay: 6 });
    });
    fireworks.later(4.0, () => fireworks.emberRain(CONFIG.tier === 'low' ? 40 : 110, { spread: 5 }));

    fireworks.later(7.4, () => {
      emit(EVENTS.CARD, { to: state.recipient });
      rig.resetPose();
      state.nextAmbient = elapsed + 1.0;
    });

    state.nextAmbient = Infinity;
  }

  on(EVENTS.BEGIN, ({ to }) => begin(to));
  on(EVENTS.FINALE, () => finale());

  /* ── ambient shells ───────────────────────────────────────── */

  function ambient(dt) {
    if (!state.skyUnlocked || elapsed < state.nextAmbient) return;
    const n = Math.random() < 0.22 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      fireworks.later(i * rand(0.12, 0.4), () => {
        const fromZ = rand(-46, -18);
        fireworks.launch({
          from: { x: rand(-23, 23), y: 0.4, z: fromZ },
          apexY: 12.5 + ((-fromZ - 18) / 28) * 7.0,
          scale: rand(0.8, 1.3),
        });
        audio.whoosh({ pan: rand(-0.85, 0.85), dur: rand(0.7, 1.0) });
      });
    }
    const busy = state.phase === PHASES.FINALE ? 0.6 : 1;
    state.nextAmbient = elapsed + rand(1.5, 3.4) * busy;
  }

  /* ── frame ────────────────────────────────────────────────── */

  const lights = [];

  function frame() {
    const raw = clock.getDelta();
    const dt = Math.min(raw, 1 / 20);   // a tab switch must not teleport the sim
    elapsed += dt;

    rig.update(elapsed, dt);
    sky.update(elapsed, dt);
    water.update(elapsed, dt);
    diyas.update(elapsed, dt);
    city.update(elapsed, dt);
    rangoli.update(elapsed, dt);
    fireworks.update(elapsed, dt);
    ambient(dt);

    lights.length = 0;
    diyas.collectLights(camera, lights, water.maxLights - 6);
    city.collectLights(lights, water.maxLights);
    water.setLights(lights);

    bloom.strength = damp(bloom.strength, state.bloomTarget, 1.5, dt);

    composer.render();
  }

  let raf = 0;
  function loop() {
    raf = requestAnimationFrame(loop);
    if (state.running) frame();
  }

  /* ── resize & lifecycle ───────────────────────────────────── */

  let portrait = null;

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;

    const isPortrait = h > w;
    // a phone in portrait needs a wider lens, a higher eye and more tilt
    camera.fov = isPortrait ? Math.min(74, CONFIG.camera.fov * 1.4) : CONFIG.camera.fov;

    if (isPortrait !== portrait) {
      portrait = isPortrait;
      const pose = isPortrait ? CONFIG.camera.portrait : CONFIG.camera;
      rig.setHome(pose.start, pose.look);
      if (state.phase === PHASES.FINALE) rig.setPose(null, pose.finaleLook);
    }
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.resolution.set(
      Math.max(128, w * CONFIG.bloom.scale),
      Math.max(128, h * CONFIG.bloom.scale)
    );
  }

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 120));

  document.addEventListener('visibilitychange', () => {
    state.running = !document.hidden;
    if (state.running) clock.getDelta();      // swallow the gap
  });

  resize();
  loop();

  return {
    scene,
    camera,
    renderer,
    state,
    diyas,
    fireworks,
    begin,
    finale,
    get phase() { return state.phase; },
    stop() {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    },
  };
}
