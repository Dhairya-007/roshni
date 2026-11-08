import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { rand, pick, TAU, clamp } from '../core/util.js';
import { flameMaterial } from './flame.js';

/**
 * Everything built rather than burning: the stone ghat you stand on, two
 * temple lamps at its edge, strings of bulbs overhead, and the far bank —
 * domes, arches and lit windows kept almost black so the fireworks have
 * something to rim-light.
 */

const STONE = 0x241a30;

/** Onion dome in profile, finial included. */
function domeProfile(r = 1) {
  const pts = [];
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // bulges past r at the shoulder, pinches at the neck: the Mughal curve
    const rad = Math.sin(Math.PI * t * 0.92) * r * (1.0 + 0.22 * Math.sin(Math.PI * t));
    const y = t * r * 1.45;
    pts.push(new THREE.Vector2(Math.max(0.001, rad), y));
  }
  pts.push(new THREE.Vector2(0.07, r * 1.52));
  pts.push(new THREE.Vector2(0.11, r * 1.62));
  pts.push(new THREE.Vector2(0.025, r * 1.86));
  pts.push(new THREE.Vector2(0.0, r * 1.9));
  return pts;
}

export function createCity() {
  const group = new THREE.Group();
  group.name = 'city';

  const stoneMat = new THREE.MeshStandardMaterial({
    color: STONE, roughness: 0.94, metalness: 0.02,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x0d0814, roughness: 0.98, metalness: 0,
  });

  /* ── the ghat ─────────────────────────────────────────────── */

  const ghat = new THREE.Group();

  const terrace = new THREE.Mesh(new THREE.BoxGeometry(46, 1.5, 13), stoneMat);
  terrace.position.set(0, 0.0, 10.0);
  ghat.add(terrace);

  // steps down into the river
  for (let i = 0; i < 4; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(30 - i * 1.6, 0.26, 0.9), stoneMat);
    step.position.set(0, 0.62 - i * 0.2, 3.2 - i * 0.85);
    ghat.add(step);
  }

  // low parapet with a lip, so the terrace edge catches light
  const lip = new THREE.Mesh(new THREE.BoxGeometry(31, 0.14, 1.1), new THREE.MeshStandardMaterial({
    color: 0x2a1c33, roughness: 0.8, metalness: 0.05,
  }));
  lip.position.set(0, 0.78, 3.9);
  ghat.add(lip);

  // loose marigold petals on the stone — no ghat on Diwali is ever swept
  const petalGeo = new THREE.SphereGeometry(0.085, 7, 5);
  petalGeo.scale(1, 0.42, 1.25);
  const petalMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.72, metalness: 0,
    emissive: new THREE.Color(0xff6a12), emissiveIntensity: 0.1,
  });
  const PETALS = 150;
  const petals = new THREE.InstancedMesh(petalGeo, petalMat, PETALS);
  const pd = new THREE.Object3D();
  const pc = new THREE.Color();
  for (let i = 0; i < PETALS; i++) {
    // clustered near the rangoli, thinning out toward the back of the terrace
    const a = rand(0, TAU);
    const r = Math.pow(rand(0.05, 1), 0.65) * 13;
    pd.position.set(Math.cos(a) * r, 0.772, 6.6 + Math.sin(a) * r * 0.6);
    pd.rotation.set(rand(-0.3, 0.3), rand(0, TAU), rand(-0.3, 0.3));
    pd.scale.setScalar(rand(0.5, 1.15));
    pd.updateMatrix();
    petals.setMatrixAt(i, pd.matrix);
    pc.setHSL(rand(0.045, 0.135), rand(0.75, 1.0), rand(0.42, 0.6));
    if (Math.random() < 0.12) pc.setHSL(0.93, 0.8, 0.55);   // the odd rose petal
    petals.setColorAt(i, pc);
  }
  petals.instanceColor.needsUpdate = true;
  ghat.add(petals);

  group.add(ghat);

  /* ── two temple lamps at the water's edge ─────────────────── */

  const lampUniforms = { uTime: { value: 0 }, uPixelRatio: { value: 1 } };
  const bigFlameMat = flameMaterial(lampUniforms, { size: 5.2 });
  const bigHaloMat = flameMaterial(lampUniforms, { size: 17, halo: true });

  const PEDESTALS = [
    { x: -4.4, z: 4.6 },
    { x: 4.4, z: 4.6 },
  ];

  // a line of small lamps set along the lip, the way a ghat is actually dressed
  const EDGE = [];
  for (let i = 0; i < 22; i++) {
    const t = (i / 21) * 2 - 1;
    const x = t * 15.5;
    if (Math.abs(x) < 6.2) continue;        // leave room for the two big lamps
    EDGE.push({ x, z: 4.15 + Math.abs(t) * 0.25 });
  }

  const bowlProfile = [
    [0, 0], [0.34, 0.02], [0.52, 0.1], [0.6, 0.26], [0.62, 0.38],
    [0.58, 0.42], [0.5, 0.26], [0.34, 0.12], [0, 0.1],
  ].map(([x, y]) => new THREE.Vector2(x, y));

  const bowlGeo = new THREE.LatheGeometry(bowlProfile, 28);
  const brass = new THREE.MeshStandardMaterial({
    color: 0x6b5222, roughness: 0.38, metalness: 0.85,
    emissive: new THREE.Color(0xff6a12), emissiveIntensity: 0.26,
  });

  /** Every built-in flame: the two big bowls, then the row along the lip. */
  const LAMPS = [
    ...PEDESTALS.map((p) => ({ x: p.x, y: 2.62, z: p.z, scale: 1.0 })),
    ...EDGE.map((p) => ({ x: p.x, y: 1.02, z: p.z, scale: 0.17 })),
  ];

  const lampPos = new Float32Array(LAMPS.length * 3);
  const lampSeed = new Float32Array(LAMPS.length);
  const lampScale = new Float32Array(LAMPS.length);
  const lampIgnite = new Float32Array(LAMPS.length).fill(-1);

  LAMPS.forEach((l, i) => {
    lampPos[i * 3] = l.x;
    lampPos[i * 3 + 1] = l.y;
    lampPos[i * 3 + 2] = l.z;
    lampSeed[i] = rand(0, TAU);
    lampScale[i] = l.scale;
  });

  PEDESTALS.forEach((p) => {
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.38, 1.5, 14), stoneMat);
    column.position.set(p.x, 1.5, p.z);
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.26, 1.1), stoneMat);
    base.position.set(p.x, 0.86, p.z);
    const bowl = new THREE.Mesh(bowlGeo, brass);
    bowl.position.set(p.x, 2.22, p.z);
    group.add(column, base, bowl);
  });

  // the little clay lamps themselves
  const edgeGeo = new THREE.LatheGeometry(bowlProfile, 16);
  const edgeMat = new THREE.MeshStandardMaterial({
    color: 0x40251a, roughness: 0.88, metalness: 0.03,
    emissive: new THREE.Color(0xff5a10), emissiveIntensity: 0.0,
  });
  const edgeMesh = new THREE.InstancedMesh(edgeGeo, edgeMat, Math.max(1, EDGE.length));
  const edgeDummy = new THREE.Object3D();
  EDGE.forEach((p, i) => {
    edgeDummy.position.set(p.x, 0.78, p.z);
    edgeDummy.rotation.set(0, rand(0, TAU), 0);
    edgeDummy.scale.setScalar(0.42);
    edgeDummy.updateMatrix();
    edgeMesh.setMatrixAt(i, edgeDummy.matrix);
  });
  edgeMesh.instanceMatrix.needsUpdate = true;
  group.add(edgeMesh);

  function lampGeoFor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(lampPos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(lampSeed, 1));
    g.setAttribute('aScale', new THREE.BufferAttribute(lampScale, 1));
    const ig = new THREE.BufferAttribute(lampIgnite, 1);
    ig.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aIgnite', ig);
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 3, 5), 22);
    return g;
  }

  const bigFlames = new THREE.Points(lampGeoFor(), bigFlameMat);
  const bigHaloes = new THREE.Points(lampGeoFor(), bigHaloMat);
  bigFlames.renderOrder = 2;
  bigHaloes.renderOrder = 1;
  bigFlames.frustumCulled = false;
  bigHaloes.frustumCulled = false;
  group.add(bigHaloes, bigFlames);

  const pedestalLight = new THREE.PointLight(0xff8a2a, 0, 26, 2);
  pedestalLight.position.set(0, 2.9, 5.0);
  group.add(pedestalLight);

  /* ── strings of bulbs over the ghat ───────────────────────── */

  const bulbs = [];
  const strandMat = new THREE.LineBasicMaterial({ color: 0x120c18, transparent: true, opacity: 0.8 });

  const STRANDS = [
    { a: [-17, 8.6, 8.5], b: [17, 8.4, 8.5], sag: 1.4, n: 34 },
    { a: [-22, 8.3, 2.0], b: [22, 8.7, 2.0], sag: 1.1, n: 34 },
    { a: [-14, 10.2, 13.5], b: [14, 9.8, 13.5], sag: 1.3, n: 22 },
  ];

  const bulbColours = [0xffc21a, 0xff2e88, 0x00e5c0, 0xff8a1f, 0x8b5cf6];

  for (const s of STRANDS) {
    const a = new THREE.Vector3(...s.a);
    const b = new THREE.Vector3(...s.b);
    const pts = [];
    for (let i = 0; i <= s.n; i++) {
      const t = i / s.n;
      const p = a.clone().lerp(b, t);
      p.y -= Math.sin(Math.PI * t) * s.sag;    // catenary, close enough
      pts.push(p);
      if (i > 0 && i < s.n) {
        bulbs.push({ p: p.clone(), hex: bulbColours[i % bulbColours.length], seed: rand(0, TAU) });
      }
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), strandMat);
    line.frustumCulled = false;
    group.add(line);
  }

  const bulbGeo = new THREE.BufferGeometry();
  const bPos = new Float32Array(bulbs.length * 3);
  const bCol = new Float32Array(bulbs.length * 3);
  const bSeed = new Float32Array(bulbs.length);
  const c = new THREE.Color();
  bulbs.forEach((b, i) => {
    bPos[i * 3] = b.p.x; bPos[i * 3 + 1] = b.p.y; bPos[i * 3 + 2] = b.p.z;
    c.setHex(b.hex);
    bCol[i * 3] = c.r; bCol[i * 3 + 1] = c.g; bCol[i * 3 + 2] = c.b;
    bSeed[i] = b.seed;
  });
  bulbGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3));
  bulbGeo.setAttribute('aColor', new THREE.BufferAttribute(bCol, 3));
  bulbGeo.setAttribute('aSeed', new THREE.BufferAttribute(bSeed, 1));

  const bulbUniforms = { uTime: { value: 0 }, uPixelRatio: { value: 1 }, uOn: { value: 0 } };
  const bulbMat = new THREE.ShaderMaterial({
    uniforms: bulbUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aSeed;
      uniform float uTime, uPixelRatio, uOn;
      varying vec3 vColor;
      varying float vGlow;
      void main() {
        vColor = aColor;
        // bulbs chase along the strand, then settle into a gentle breathe
        float chase = 0.55 + 0.45 * sin(uTime * 2.2 - aSeed * 2.6);
        vGlow = uOn * mix(chase, 0.85 + 0.15 * sin(uTime * 1.1 + aSeed), smoothstep(0.0, 1.0, uOn));
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        // these strands hang a few metres from the camera; without a clamp
        // the perspective term alone puts a single bulb at 200 px across
        float px = (2.2 + vGlow * 3.4) * (170.0 / max(-mv.z, 0.1));
        gl_PointSize = clamp(px, 1.5, 13.0) * uPixelRatio;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vGlow;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        float core = pow(1.0 - d, 3.0);
        float halo = pow(1.0 - d, 1.2) * 0.3;
        float a = (core + halo) * vGlow * 0.58;
        if (a < 0.004) discard;
        gl_FragColor = vec4(mix(vColor, vec3(1.0), core * 0.6) * (0.8 + vGlow), a);
      }
    `,
  });

  const bulbPoints = new THREE.Points(bulbGeo, bulbMat);
  bulbPoints.frustumCulled = false;
  bulbPoints.renderOrder = 2;
  group.add(bulbPoints);

  /* ── far bank ─────────────────────────────────────────────── */

  const bank = new THREE.Group();
  const BANK_Z = -58;

  const wall = new THREE.Mesh(new THREE.BoxGeometry(170, 3.4, 10), darkMat);
  wall.position.set(0, 0.6, BANK_Z + 7);
  bank.add(wall);

  const windows = [];
  const shrineLights = [];

  let x = -74;
  while (x < 74) {
    const w = rand(5, 13);
    const h = rand(3.2, 9);
    const depth = rand(5, 9);
    const block = new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), darkMat);
    block.position.set(x + w / 2, h / 2 + 1.4, BANK_Z + rand(-3, 2));
    bank.add(block);

    // a dome or a pair of minarets on roughly every third block
    const roll = Math.random();
    if (roll < 0.44 && w > 6.5) {
      const r = Math.min(w * 0.42, 3.6);
      const dome = new THREE.Mesh(new THREE.LatheGeometry(domeProfile(r), 20), darkMat);
      dome.position.set(block.position.x, h + 1.4, block.position.z);
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.95, r * 1.05, 0.7, 18), darkMat);
      drum.position.set(block.position.x, h + 1.6, block.position.z);
      bank.add(dome, drum);
    } else if (roll < 0.60) {
      for (const sx of [-1, 1]) {
        const mh = rand(4.5, 9);
        const minaret = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.36, mh, 12), darkMat);
        minaret.position.set(block.position.x + sx * (w / 2 - 0.7), h + 1.4 + mh / 2, block.position.z);
        const cap = new THREE.Mesh(new THREE.LatheGeometry(domeProfile(0.62), 14), darkMat);
        cap.position.set(minaret.position.x, h + 1.4 + mh, block.position.z);
        // a balcony ring, so a minaret does not read as a factory chimney
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.16, 12), darkMat);
        ring.position.set(minaret.position.x, h + 1.4 + mh * 0.72, block.position.z);
        bank.add(minaret, cap, ring);
      }
    }

    // lit windows on the river-facing wall
    const cols = Math.max(1, Math.floor(w / 1.9));
    const rows = Math.max(1, Math.floor(h / 1.8));
    for (let cx = 0; cx < cols; cx++) {
      for (let cy = 0; cy < rows; cy++) {
        if (Math.random() > 0.52) continue;
        windows.push({
          x: x + 1.0 + cx * 1.9 + rand(-0.12, 0.12),
          y: 2.1 + cy * 1.8 + rand(-0.1, 0.1),
          z: block.position.z + depth / 2 + 0.06,
          hex: pick([0xffb347, 0xff8a1f, 0xffd86b, 0xff6a2a, 0xfff0c0]),
          seed: rand(0, TAU),
          w: rand(0.42, 0.72),
          h: rand(0.6, 1.0),
        });
      }
    }

    x += w + rand(0.4, 2.2);
  }

  const winGeo = new THREE.PlaneGeometry(1, 1);
  const winMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const winMesh = new THREE.InstancedMesh(winGeo, winMat, windows.length);
  winMesh.frustumCulled = false;
  const dummy = new THREE.Object3D();
  windows.forEach((win, i) => {
    dummy.position.set(win.x, win.y, win.z);
    dummy.scale.set(win.w, win.h, 1);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    winMesh.setMatrixAt(i, dummy.matrix);
    c.setHex(win.hex).multiplyScalar(rand(0.35, 0.8));
    winMesh.setColorAt(i, c);
  });
  winMesh.instanceColor.needsUpdate = true;
  bank.add(winMesh);

  // a second row further back, taller and flatter — pure depth cue
  const farMat = new THREE.MeshStandardMaterial({ color: 0x0a0612, roughness: 1, metalness: 0 });
  let fx = -86;
  while (fx < 86) {
    const w = rand(8, 20);
    const h = rand(5, 13);
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 6), farMat);
    b.position.set(fx + w / 2, h / 2 + 1.4, BANK_Z - rand(13, 24));
    bank.add(b);
    if (Math.random() < 0.3) {
      const r = Math.min(w * 0.3, 3.2);
      const dome = new THREE.Mesh(new THREE.LatheGeometry(domeProfile(r), 16), farMat);
      dome.position.set(b.position.x, h + 1.4, b.position.z);
      bank.add(dome);
    }
    fx += w + rand(2, 8);
  }

  // riverside shrines on both banks, well out to the sides, to frame the view
  for (const sx of [-1, 1]) {
    const shrine = new THREE.Group();
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(7, 2.4, 7), stoneMat);
    plinth.position.y = 1.2;
    const body = new THREE.Mesh(new THREE.BoxGeometry(5.2, 5, 5.2), darkMat);
    body.position.y = 4.8;
    const dome = new THREE.Mesh(new THREE.LatheGeometry(domeProfile(2.5), 20), darkMat);
    dome.position.y = 7.3;
    shrine.add(plinth, body, dome);

    for (const mx of [-1, 1]) {
      const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 7, 12), darkMat);
      spire.position.set(mx * 3.1, 5.9, 2.4);
      const cap = new THREE.Mesh(new THREE.LatheGeometry(domeProfile(0.7), 14), darkMat);
      cap.position.set(mx * 3.1, 9.4, 2.4);
      shrine.add(spire, cap);
    }

    // a lit doorway facing the water
    const door = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 2.1),
      new THREE.MeshBasicMaterial({
        color: 0xff9a3a, transparent: true, opacity: 0.3,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    door.position.set(0, 4.2, 2.63);
    shrine.add(door);

    shrine.position.set(sx * 31, 0, -24);
    shrine.rotation.y = -sx * 0.42;
    bank.add(shrine);
    shrineLights.push({ x: sx * 31, y: 1.0, z: -21, r: 1, g: 0.6, b: 0.24, i: 0.3 });
  }

  group.add(bank);

  // a handful of window lights the river gets to reflect
  const reflectedWindows = windows
    .filter((_, i) => i % Math.max(1, Math.floor(windows.length / 7)) === 0)
    .slice(0, 7)
    .map((w) => {
      c.setHex(w.hex);
      return { x: w.x, y: 1.1, z: BANK_Z + 4, r: c.r, g: c.g, b: c.b, i: 0.1 };
    });

  /* ── lighting rig ─────────────────────────────────────────── */

  const hemi = new THREE.HemisphereLight(0x2a1040, 0x0a0410, 0.55);
  group.add(hemi);
  // a low warm fill at the ghat: without it the foreground stone is a void
  const fill = new THREE.PointLight(0xff8a3a, 9, 32, 2.2);
  fill.position.set(0, 2.4, 7.5);
  group.add(fill);

  const key = new THREE.DirectionalLight(0xff8a3a, 0.22);
  key.position.set(-8, 9, 7);
  group.add(key);

  let bulbsOn = 0;
  let lampsLit = false;

  return {
    group,
    pedestals: PEDESTALS,

    /** Light the two big lamps — the first thing that happens at the ghat. */
    litPedestals(time) {
      if (lampsLit) return;
      lampsLit = true;
      // the two bowls are struck first, then the row runs out to both ends
      LAMPS.forEach((l, i) => {
        lampIgnite[i] = i < PEDESTALS.length
          ? time + i * 0.45
          : time + 1.0 + Math.abs(l.x) * 0.055 + rand(0, 0.1);
      });
      bigFlames.geometry.attributes.aIgnite.needsUpdate = true;
      bigHaloes.geometry.attributes.aIgnite.needsUpdate = true;
    },

    /** The bulb strands come up as the river fills. */
    setBulbs(t) { bulbsOn = clamp(t, 0, 1); },

    setPixelRatio(r) {
      lampUniforms.uPixelRatio.value = r;
      bulbUniforms.uPixelRatio.value = r;
    },

    update(time, dt) {
      lampUniforms.uTime.value = time;
      bulbUniforms.uTime.value = time;
      bulbUniforms.uOn.value += (bulbsOn - bulbUniforms.uOn.value) * Math.min(1, dt * 1.4);

      const want = lampsLit ? 22 : 0;
      pedestalLight.intensity += (want - pedestalLight.intensity) * Math.min(1, dt * 1.6);
      brass.emissiveIntensity = lampsLit ? 0.26 + Math.sin(time * 6.1) * 0.07 : 0.03;
      edgeMat.emissiveIntensity = lampsLit ? 0.42 + Math.sin(time * 4.3) * 0.09 : 0.0;

      // windows breathe very slightly; a dead-still city looks like a model
      winMat.opacity = 0.9 + Math.sin(time * 0.7) * 0.06;
    },

    /**
     * Reflections contributed by the built world. The river's own lamps are
     * collected first and matter more, so this only fills the space left.
     */
    collectLights(out, limit) {
      const take = (list) => {
        for (const l of list) {
          if (out.length >= limit) return;
          out.push(l);
        }
      };
      take(shrineLights);
      if (lampsLit) {
        take(EDGE.map((e) => ({ x: e.x, y: 0.95, z: e.z, r: 1, g: 0.5, b: 0.16, i: 0.1 })));
      }
      take(reflectedWindows);
      return out;
    },

    dispose() {
      group.traverse((o) => {
        o.geometry?.dispose?.();
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material?.dispose?.();
      });
    },
  };
}
