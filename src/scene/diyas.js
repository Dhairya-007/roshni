import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { emit, EVENTS } from '../core/bus.js';
import { TAU, GOLDEN_ANGLE, rand, clamp, smoothstep } from '../core/util.js';
import { flameMaterial } from './flame.js';

/** Hand-drawn lathe profile of a clay diya: outer wall up, lip, inner wall down. */
function diyaProfile() {
  const pts = [
    [0.000, 0.000], [0.105, 0.002], [0.192, 0.012], [0.252, 0.042],
    [0.291, 0.098], [0.300, 0.136], [0.286, 0.150], [0.248, 0.112],
    [0.196, 0.072], [0.108, 0.050], [0.000, 0.044],
  ];
  return pts.map(([x, y]) => new THREE.Vector2(x, y));
}

/**
 * One hundred and eight diyas on the water.
 *
 * Lamps are a single InstancedMesh; flames and their haloes are two Points
 * clouds driven by one `aIgnite` attribute (the timestamp a lamp caught, or
 * -1). Ignition spreads as a decaying branching process, so a click gives
 * you a travelling wave of twenty-odd lamps rather than all or nothing.
 */
export function createDiyas() {
  const COUNT = CONFIG.diyas;
  const { centre, innerRadius, outerRadius } = CONFIG.river;
  const group = new THREE.Group();
  group.name = 'diyas';

  /* ── layout: golden-angle spiral, jittered, pushed off the camera axis ── */

  const diyas = [];
  for (let i = 0; i < COUNT; i++) {
    const f = (i + 0.5) / COUNT;
    const r = innerRadius + Math.sqrt(f) * (outerRadius - innerRadius);
    const a = i * GOLDEN_ANGLE + rand(-0.09, 0.09);
    const x = centre[0] + Math.cos(a) * r * 1.35 + rand(-0.5, 0.5);
    const z = centre[2] + Math.sin(a) * r * 0.78 + rand(-0.4, 0.4);

    diyas.push({
      i,
      x, z,
      baseY: rand(-0.012, 0.012),
      y: 0,
      rot: rand(0, TAU),
      scale: rand(0.86, 1.22),
      seed: rand(0, TAU),
      bobAmp: rand(0.012, 0.036),
      bobRate: rand(0.5, 1.1),
      drift: rand(0.25, 0.7),
      lit: false,
      litAt: -1,
      neighbours: [],
    });
  }

  // nearest-neighbour graph, once, so the wave has somewhere to travel
  const LINK_R2 = 4.3 * 4.3;
  for (let i = 0; i < COUNT; i++) {
    const a = diyas[i];
    const near = [];
    for (let j = 0; j < COUNT; j++) {
      if (i === j) continue;
      const b = diyas[j];
      const d2 = (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
      if (d2 < LINK_R2) near.push({ j, d: Math.sqrt(d2) });
    }
    near.sort((p, q) => p.d - q.d);
    a.neighbours = near.slice(0, 6);
  }

  /* ── lamps ─────────────────────────────────────────────────── */

  const lampGeo = new THREE.LatheGeometry(diyaProfile(), 22);
  lampGeo.computeVertexNormals();

  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.82,
    metalness: 0.04,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 1,
  });

  // per-instance glow, fed into emissive — InstancedMesh colour alone cannot
  // do this because instanceColor only multiplies the diffuse term
  const glowAttr = new THREE.InstancedBufferAttribute(new Float32Array(COUNT), 1);
  glowAttr.setUsage(THREE.DynamicDrawUsage);

  lampMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n attribute float aGlow;\n varying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vGlow = aGlow;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n varying float vGlow;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         // oil pooled in the bowl glows hottest, the clay body only warms
         totalEmissiveRadiance *= vec3(1.0, 0.44, 0.13) * vGlow * 2.6;`
      );
  };

  const lamps = new THREE.InstancedMesh(lampGeo, lampMat, COUNT);
  lamps.geometry.setAttribute('aGlow', glowAttr);
  lamps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  lamps.castShadow = false;
  lamps.frustumCulled = false;
  group.add(lamps);

  const clay = new THREE.Color();
  for (let i = 0; i < COUNT; i++) {
    clay.setHSL(rand(0.03, 0.075), rand(0.42, 0.62), rand(0.085, 0.145));
    lamps.setColorAt(i, clay);
  }
  lamps.instanceColor.needsUpdate = true;

  /* ── hit proxies (raycasting against 3 cm lamps is no fun) ─── */

  const hitMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  const hitMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 8, 6), hitMat, COUNT);
  hitMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  hitMesh.frustumCulled = false;
  hitMesh.renderOrder = -2;
  group.add(hitMesh);

  /* ── flames + haloes ──────────────────────────────────────── */

  const fPos = new Float32Array(COUNT * 3);
  const fSeed = new Float32Array(COUNT);
  const fScale = new Float32Array(COUNT);
  const fIgnite = new Float32Array(COUNT).fill(-1);

  for (let i = 0; i < COUNT; i++) {
    const d = diyas[i];
    fSeed[i] = d.seed;
    fScale[i] = d.scale;
  }

  function makePointsGeo() {
    const g = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(fPos, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    const igAttr = new THREE.BufferAttribute(fIgnite, 1);
    igAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', posAttr);
    g.setAttribute('aSeed', new THREE.BufferAttribute(fSeed, 1));
    g.setAttribute('aScale', new THREE.BufferAttribute(fScale, 1));
    g.setAttribute('aIgnite', igAttr);
    g.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(centre[0], 0, centre[2]), outerRadius * 2.2
    );
    return g;
  }

  const sharedUniforms = {
    uTime: { value: 0 },
    uPixelRatio: { value: 1 },
  };

  const flameMat = flameMaterial(sharedUniforms, { size: 1.25 });
  const haloMat = flameMaterial(sharedUniforms, { size: 4.4, halo: true });

  const flames = new THREE.Points(makePointsGeo(), flameMat);
  const haloes = new THREE.Points(makePointsGeo(), haloMat);
  flames.frustumCulled = false;
  haloes.frustumCulled = false;
  haloes.renderOrder = 1;
  flames.renderOrder = 2;
  group.add(haloes, flames);

  const flamePos = flames.geometry.attributes.position;
  const haloPos = haloes.geometry.attributes.position;
  const flameIg = flames.geometry.attributes.aIgnite;
  const haloIg = haloes.geometry.attributes.aIgnite;

  /* ── ignition ─────────────────────────────────────────────── */

  const dummy = new THREE.Object3D();
  const pending = [];          // { i, at, gen }
  let litCount = 0;
  let now = 0;
  let hovered = -1;
  let chainIndex = 0;          // drives the musical scale as a cascade runs

  function light(i, gen) {
    const d = diyas[i];
    if (d.lit) return;
    d.lit = true;
    d.litAt = now;
    litCount++;

    fIgnite[i] = now;
    flameIg.needsUpdate = true;
    haloIg.needsUpdate = true;

    emit(EVENTS.DIYA_LIT, {
      index: i,
      x: d.x, y: d.y + 0.16, z: d.z,
      gen,
      step: chainIndex++,
      litCount,
      total: COUNT,
    });

    // decaying branching process: generous at first, out of breath by gen ~8
    const p = 0.96 * Math.pow(0.88, gen);
    const branch = gen === 0 ? 3 : Math.random() < 0.42 ? 2 : 1;
    let spawned = 0;

    for (const { j, d: dist } of d.neighbours) {
      if (spawned >= branch) break;
      if (diyas[j].lit) continue;
      if (Math.random() > p) continue;
      pending.push({
        i: j,
        at: now + 0.14 + dist * 0.085 + rand(0, 0.08),
        gen: gen + 1,
      });
      spawned++;
    }
  }

  function update(time, dt) {
    now = time;
    sharedUniforms.uTime.value = time;

    // drain the ignition queue
    for (let k = pending.length - 1; k >= 0; k--) {
      if (pending[k].at <= now) {
        const { i, gen } = pending.splice(k, 1)[0];
        light(i, gen);
      }
    }
    if (!pending.length) chainIndex = 0;

    // bob every lamp and keep flame + halo + hit proxy welded to it
    for (let i = 0; i < COUNT; i++) {
      const d = diyas[i];
      const t = time * d.bobRate + d.seed;
      d.y = d.baseY + Math.sin(t) * d.bobAmp + Math.sin(t * 2.3) * d.bobAmp * 0.35;
      const tiltX = Math.sin(t * 0.9) * 0.055;
      const tiltZ = Math.cos(t * 0.73 + 1.2) * 0.055;

      let s = d.scale;
      if (i === hovered && !d.lit) s *= 1.0 + 0.12 * (1 + Math.sin(time * 7));

      dummy.position.set(d.x, d.y, d.z);
      dummy.rotation.set(tiltX, d.rot + Math.sin(t * 0.21) * 0.12 * d.drift, tiltZ);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      lamps.setMatrixAt(i, dummy.matrix);

      dummy.scale.setScalar(1);
      dummy.rotation.set(0, 0, 0);
      dummy.position.y = d.y + 0.12;
      dummy.updateMatrix();
      hitMesh.setMatrixAt(i, dummy.matrix);

      const o = i * 3;
      // the flame sits above the lip and leans with the lamp
      fPos[o] = d.x + tiltZ * 0.1;
      fPos[o + 1] = d.y + 0.135 + 0.055;
      fPos[o + 2] = d.z - tiltX * 0.1;

      const target = d.lit ? clamp(smoothstep(0, 0.6, time - d.litAt), 0, 1) : 0;
      glowAttr.array[i] += (target - glowAttr.array[i]) * Math.min(1, dt * 6);
    }

    lamps.instanceMatrix.needsUpdate = true;
    hitMesh.instanceMatrix.needsUpdate = true;
    glowAttr.needsUpdate = true;
    flamePos.needsUpdate = true;
    haloPos.needsUpdate = true;
    flameMat.uniforms.uTime.value = time;
    haloMat.uniforms.uTime.value = time;
  }

  /* ── public surface ───────────────────────────────────────── */

  return {
    group,
    hitMesh,
    total: COUNT,
    get litCount() { return litCount; },
    get ratio() { return litCount / COUNT; },
    get allLit() { return litCount >= COUNT; },
    diyas,

    update,

    setPixelRatio(r) {
      flameMat.uniforms.uPixelRatio.value = r;
      haloMat.uniforms.uPixelRatio.value = r;
    },

    setHover(i) { hovered = i; },

    /** Returns false when that lamp was already burning. */
    ignite(i) {
      if (i < 0 || i >= COUNT || diyas[i].lit) return false;
      light(i, 0);
      return true;
    },

    /** The nearest unlit lamp to a world point — forgiving taps on mobile. */
    nearestUnlit(point, maxDist = 2.2) {
      let best = -1;
      let bestD = maxDist * maxDist;
      for (let i = 0; i < COUNT; i++) {
        const d = diyas[i];
        if (d.lit) continue;
        const d2 = (d.x - point.x) ** 2 + (d.z - point.z) ** 2;
        if (d2 < bestD) { bestD = d2; best = i; }
      }
      return best;
    },

    /** Finish the river: one ring of light running outward from the middle. */
    igniteAll(fromCentre = true) {
      for (let i = 0; i < COUNT; i++) {
        const d = diyas[i];
        if (d.lit || pending.some((p) => p.i === i)) continue;
        const dist = fromCentre
          ? Math.hypot(d.x - centre[0], d.z - centre[2])
          : rand(0, 20);
        pending.push({ i, at: now + 0.1 + dist * 0.085 + rand(0, 0.12), gen: 99 });
      }
    },

    /** Lamps worth reflecting, nearest to the camera first. */
    collectLights(camera, out, limit) {
      const cx = camera.position.x;
      const cz = camera.position.z;
      const lit = [];
      for (let i = 0; i < COUNT; i++) {
        const d = diyas[i];
        if (!d.lit) continue;
        lit.push({ d, dist: (d.x - cx) ** 2 + (d.z - cz) ** 2 });
      }
      lit.sort((a, b) => a.dist - b.dist);
      const n = Math.min(lit.length, limit);
      for (let k = 0; k < n; k++) {
        const d = lit[k].d;
        const age = clamp((now - d.litAt) / 0.6, 0, 1);
        out.push({
          x: d.x,
          y: d.y + 0.2,
          z: d.z,
          r: 1.0, g: 0.5, b: 0.17,
          i: 0.17 * age * d.scale,
        });
      }
      return out;
    },

    dispose() {
      lampGeo.dispose();
      lampMat.dispose();
      flames.geometry.dispose();
      haloes.geometry.dispose();
      flameMat.dispose();
      haloMat.dispose();
      hitMesh.geometry.dispose();
      hitMat.dispose();
    },
  };
}
