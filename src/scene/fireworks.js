import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { emit, EVENTS } from '../core/bus.js';
import { rand, randInt, pick, randSphere, clamp, TAU } from '../core/util.js';

/**
 * Fireworks, integrated entirely in the vertex shader.
 *
 * Each particle stores an origin, a launch velocity, a drag coefficient and
 * a gravity term. Position at time t is the closed-form solution of
 *
 *     v' = -d v          ->   x(t) = x0 + v0 (1 - e^(-d t)) / d - ½ g t²
 *
 * so the CPU writes a slot once and never touches it again. Drag is what
 * makes a shell read as a shell: the sparks sprint, stall, then drift down.
 *
 * Because the solution is invertible, `writeText` can run it backwards and
 * solve for the velocity that lands a spark exactly on a letter — the burst
 * assembles into a name instead of merely scattering.
 */

const PATTERNS = ['sphere', 'ring', 'palm', 'willow', 'chrysanthemum', 'double', 'crossette'];

export function createFireworks() {
  const MAX = CONFIG.maxParticles;
  const group = new THREE.Group();
  group.name = 'fireworks';

  const position = new Float32Array(MAX * 3);
  const aVel = new Float32Array(MAX * 3);
  const aColor = new Float32Array(MAX * 3);
  const aBirth = new Float32Array(MAX).fill(-1);
  const aLife = new Float32Array(MAX).fill(1);
  const aSeed = new Float32Array(MAX);
  const aSize = new Float32Array(MAX);
  const aDrag = new Float32Array(MAX).fill(1);
  const aGrav = new Float32Array(MAX);
  const aTwinkle = new Float32Array(MAX);
  const aTurb = new Float32Array(MAX).fill(1);

  const geo = new THREE.BufferGeometry();
  const attrs = {
    position: new THREE.BufferAttribute(position, 3),
    aVel: new THREE.BufferAttribute(aVel, 3),
    aColor: new THREE.BufferAttribute(aColor, 3),
    aBirth: new THREE.BufferAttribute(aBirth, 1),
    aLife: new THREE.BufferAttribute(aLife, 1),
    aSeed: new THREE.BufferAttribute(aSeed, 1),
    aSize: new THREE.BufferAttribute(aSize, 1),
    aDrag: new THREE.BufferAttribute(aDrag, 1),
    aGrav: new THREE.BufferAttribute(aGrav, 1),
    aTwinkle: new THREE.BufferAttribute(aTwinkle, 1),
    aTurb: new THREE.BufferAttribute(aTurb, 1),
  };
  for (const [name, attr] of Object.entries(attrs)) {
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(name, attr);
  }
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 20, -10), 220);

  const uniforms = {
    uTime: { value: 0 },
    uPixelRatio: { value: 1 },
    uFade: { value: 1 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec3 aVel;
      attribute vec3 aColor;
      attribute float aBirth, aLife, aSeed, aSize, aDrag, aGrav, aTwinkle, aTurb;

      uniform float uTime, uPixelRatio;

      varying vec3 vColor;
      varying float vAlpha, vCore;

      void main() {
        float age = uTime - aBirth;
        if (aBirth < 0.0 || age < 0.0 || age > aLife) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          gl_PointSize = 0.0;
          return;
        }

        float d = max(aDrag, 1e-4);
        float k = (1.0 - exp(-d * age)) / d;
        vec3 p = position + aVel * k - vec3(0.0, 0.5 * aGrav * age * age, 0.0);

        // a little turbulence so a shell is never a perfect geometric shape.
        // Text sparks opt out (aTurb ~ 0) or the letterforms smear apart.
        p += vec3(
              sin(aSeed * 7.3 + age * 1.7),
              sin(aSeed * 3.1 + age * 1.1),
              cos(aSeed * 5.7 + age * 1.9)
            ) * age * 0.09 * aTurb;

        float lt = age / aLife;
        float fade = pow(1.0 - lt, 1.5);
        float tw = 0.62 + 0.38 * sin(age * aTwinkle + aSeed * 6.2831);

        vAlpha = fade * mix(1.0, tw, step(0.5, aTwinkle));
        // white-hot for a fixed third of a second, not for a third of the
        // particle's life — long-lived text sparks were staying blown out
        vCore = smoothstep(0.42, 0.0, age);
        vColor = aColor;

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uPixelRatio * fade * (1.0 + vCore * 0.7)
                     * (250.0 / max(-mv.z, 0.1));
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uFade;
      varying vec3 vColor;
      varying float vAlpha, vCore;

      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv) * 2.0;
        if (d > 1.0) discard;
        float g = pow(1.0 - d, 2.4);
        vec3 col = mix(vColor, vec3(1.0), vCore * 0.78);
        float a = g * vAlpha * uFade;
        if (a < 0.003) discard;
        gl_FragColor = vec4(col * (1.0 + vCore * 0.9), a);
      }
    `,
  });

  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  group.add(points);

  /* ── a few real lights so bursts actually illuminate the scene ── */

  const lightPool = [];
  const LIGHTS = CONFIG.tier === 'low' ? 2 : 3;
  for (let i = 0; i < LIGHTS; i++) {
    const l = new THREE.PointLight(0xffffff, 0, 90, 2);
    l.visible = false;
    group.add(l);
    lightPool.push({ light: l, energy: 0 });
  }
  let lightCursor = 0;

  /* ── slot allocation ──────────────────────────────────────── */

  let cursor = 0;
  let dirty = false;
  let now = 0;
  const scheduled = [];     // { at, fn }
  const col = new THREE.Color();

  function slot() {
    const i = cursor;
    cursor = (cursor + 1) % MAX;
    return i;
  }

  function spawn(o) {
    const i = slot();
    const i3 = i * 3;
    position[i3] = o.x; position[i3 + 1] = o.y; position[i3 + 2] = o.z;
    aVel[i3] = o.vx; aVel[i3 + 1] = o.vy; aVel[i3 + 2] = o.vz;
    aColor[i3] = o.r; aColor[i3 + 1] = o.g; aColor[i3 + 2] = o.b;
    aBirth[i] = o.birth;
    aLife[i] = o.life;
    aSeed[i] = o.seed ?? rand(0, TAU);
    aSize[i] = o.size;
    aDrag[i] = o.drag;
    aGrav[i] = o.grav;
    aTwinkle[i] = o.twinkle ?? 0;
    aTurb[i] = o.turb ?? 1;
    dirty = true;
    return i;
  }

  function later(seconds, fn) {
    scheduled.push({ at: now + seconds, fn });
  }

  function hexToRgb(hex, out = {}) {
    col.setHex(hex);
    out.r = col.r; out.g = col.g; out.b = col.b;
    return out;
  }

  function useLight(x, y, z, hex, energy) {
    const entry = lightPool[lightCursor];
    lightCursor = (lightCursor + 1) % lightPool.length;
    entry.light.position.set(x, y, z);
    entry.light.color.setHex(hex);
    entry.light.visible = true;
    entry.energy = energy;
  }

  /* ── bursts ───────────────────────────────────────────────── */

  const PRESETS = {
    sphere:        { n: 240, speed: [7.5, 1.4], drag: 1.75, grav: 2.4, life: [1.9, 0.35], size: 2.6, twinkle: 0 },
    ring:          { n: 190, speed: [8.6, 0.5], drag: 1.85, grav: 2.0, life: [2.0, 0.25], size: 2.4, twinkle: 0 },
    palm:          { n: 72,  speed: [12.5, 1.8], drag: 0.62, grav: 5.2, life: [2.9, 0.4], size: 4.0, twinkle: 0 },
    willow:        { n: 170, speed: [5.4, 0.9], drag: 1.05, grav: 7.0, life: [3.6, 0.5], size: 2.8, twinkle: 0 },
    chrysanthemum: { n: 300, speed: [8.0, 2.2], drag: 1.6, grav: 2.8, life: [2.3, 0.6], size: 2.4, twinkle: 34 },
    double:        { n: 260, speed: [8.6, 1.0], drag: 1.7, grav: 2.4, life: [2.1, 0.3], size: 2.6, twinkle: 0 },
    crossette:     { n: 46,  speed: [8.4, 0.7], drag: 1.2, grav: 3.0, life: [1.0, 0.1], size: 3.4, twinkle: 0 },
  };

  const dir = [0, 0, 0];

  /**
   * @param {{x:number,y:number,z:number}} at
   * @param {{pattern?:string, hex?:number, hex2?:number, scale?:number, silent?:boolean}} [opts]
   */
  function burst(at, opts = {}) {
    const pattern = opts.pattern ?? pick(PATTERNS);
    const P = PRESETS[pattern] ?? PRESETS.sphere;
    const scale = opts.scale ?? 1;
    const hex = opts.hex ?? pick(CONFIG.palette.shells);
    const hex2 = opts.hex2 ?? pick(CONFIG.palette.shells);
    const c1 = hexToRgb(hex, {});
    const c2 = hexToRgb(hex2, {});

    const count = Math.max(10, Math.round(P.n * CONFIG.ambientShells * scale));

    // a ring needs a plane; tilt it so it is never seen perfectly edge-on
    const axis = new THREE.Vector3(rand(-1, 1), rand(0.2, 1), rand(-1, 1)).normalize();
    const u = new THREE.Vector3(1, 0, 0).cross(axis).normalize();
    const v = new THREE.Vector3().crossVectors(axis, u);

    for (let k = 0; k < count; k++) {
      const useSecond = pattern === 'double' ? k % 2 === 1 : Math.random() < 0.18;
      const c = useSecond ? c2 : c1;
      let vx; let vy; let vz;
      const sp = Math.max(0.5, (P.speed[0] + rand(-P.speed[1], P.speed[1])) * scale);

      if (pattern === 'ring') {
        const a = (k / count) * TAU + rand(-0.02, 0.02);
        const p = u.clone().multiplyScalar(Math.cos(a)).addScaledVector(v, Math.sin(a));
        vx = p.x * sp; vy = p.y * sp; vz = p.z * sp;
      } else if (pattern === 'willow') {
        randSphere(dir);
        const squash = 0.55;
        vx = dir[0] * sp; vy = Math.abs(dir[1]) * sp * squash + sp * 0.15; vz = dir[2] * sp;
      } else {
        randSphere(dir);
        // slight cube-root bias fills the shell volume rather than its skin
        const rr = Math.cbrt(rand(0.25, 1));
        vx = dir[0] * sp * rr; vy = dir[1] * sp * rr; vz = dir[2] * sp * rr;
      }

      spawn({
        x: at.x, y: at.y, z: at.z,
        vx, vy, vz,
        r: c.r, g: c.g, b: c.b,
        birth: now + (pattern === 'double' && useSecond ? 0.14 : 0),
        life: Math.max(0.4, P.life[0] + rand(-P.life[1], P.life[1])) * (opts.lifeScale ?? 1),
        size: P.size * scale * rand(0.75, 1.3),
        drag: P.drag * rand(0.85, 1.2),
        grav: P.grav * rand(0.85, 1.15),
        twinkle: P.twinkle,
      });
    }

    // crossette: each petal splits again a beat later
    if (pattern === 'crossette') {
      for (let k = 0; k < 8; k++) {
        randSphere(dir);
        const sp = 8.2 * scale;
        const t = 0.85;
        const kk = (1 - Math.exp(-1.2 * t)) / 1.2;
        later(t, () => {
          burst({
            x: at.x + dir[0] * sp * kk,
            y: at.y + dir[1] * sp * kk - 0.5 * 3 * t * t,
            z: at.z + dir[2] * sp * kk,
          }, { pattern: 'sphere', hex: hex2, scale: scale * 0.42, silent: true });
        });
      }
    }

    // the flash of the break itself — brief, and small enough that a shell
    // never reads as a second moon
    for (let k = 0; k < Math.round(10 * scale); k++) {
      randSphere(dir);
      spawn({
        x: at.x, y: at.y, z: at.z,
        vx: dir[0] * 2.0, vy: dir[1] * 2.0, vz: dir[2] * 2.0,
        r: 0.85, g: 0.76, b: 0.6,
        birth: now, life: 0.18, size: 5.5 * scale, drag: 5.0, grav: 0,
      });
    }

    useLight(at.x, at.y, at.z, hex, 220 * scale);

    if (!opts.silent) {
      emit(EVENTS.BURST, { ...at, hex, scale, pattern });
    }
  }

  /**
   * Rocket plus break. The trail is a line of short-lived particles sharing
   * one velocity, staggered in birth time — identical arc, so they read as
   * a comet with a tail rather than as separate sparks.
   */
  function launch(opts = {}) {
    const from = opts.from ?? {
      x: rand(-16, 16),
      y: 0.3,
      z: rand(-44, -16),
    };
    const apexY = opts.apexY ?? rand(16, 27);
    const T = opts.rise ?? rand(1.05, 1.5);
    const G = 9.0;

    const target = opts.to ?? {
      x: from.x + rand(-4, 4),
      y: apexY,
      z: from.z + rand(-3, 3),
    };

    // solve for the launch velocity that reaches the break point at t = T
    const vx = (target.x - from.x) / T;
    const vz = (target.z - from.z) / T;
    const vy = (target.y - from.y) / T + 0.5 * G * T;

    const hex = opts.hex ?? pick(CONFIG.palette.shells);
    const trailColor = hexToRgb(0xffcf8a, {});
    const steps = CONFIG.tier === 'low' ? 26 : 48;

    for (let k = 0; k < steps; k++) {
      // spread the tail sideways and shrink it as it falls behind, or the
      // identical arcs stack into one solid white capsule
      const spread = 0.34;
      spawn({
        x: from.x, y: from.y, z: from.z,
        vx: vx + rand(-spread, spread),
        vy: vy + rand(-0.22, 0.22),
        vz: vz + rand(-spread, spread),
        r: trailColor.r, g: trailColor.g * rand(0.8, 1.0), b: trailColor.b * rand(0.5, 1.0),
        birth: now + (k / steps) * T,
        life: rand(0.16, 0.38),
        size: rand(0.8, 1.9),
        drag: 0.0001,
        grav: G * rand(0.9, 1.2),
        twinkle: 52,
      });
    }

    useLight(from.x, from.y + 0.4, from.z, 0xff9a3c, 30);
    emit(EVENTS.BURST, { ...from, hex, scale: 0, pattern: 'launch' });

    later(T, () => burst(target, { pattern: opts.pattern, hex, scale: opts.scale ?? rand(0.85, 1.25) }));
    return { target, at: now + T };
  }

  /* ── text in the sky ──────────────────────────────────────── */

  const canvas = document.createElement('canvas');

  /** Sample a string into 3D target points, in world units. */
  function sampleText(text, { height = 7.2, maxPoints = 1500 } = {}) {
    const fontPx = 150;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.font = `900 ${fontPx}px Fraunces, Georgia, serif`;
    const metrics = ctx.measureText(text);
    const w = Math.max(32, Math.ceil(metrics.width) + 40);
    const h = Math.ceil(fontPx * 1.5);
    canvas.width = w;
    canvas.height = h;

    const c = canvas.getContext('2d', { willReadFrequently: true });
    c.clearRect(0, 0, w, h);
    c.font = `900 ${fontPx}px Fraunces, Georgia, serif`;
    c.fillStyle = '#fff';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, w / 2, h / 2);

    const data = c.getImageData(0, 0, w, h).data;
    const found = [];
    const step = 3;
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        if (data[(y * w + x) * 4 + 3] > 140) found.push([x, y]);
      }
    }

    // thin evenly rather than truncating, so letters stay legible
    const keep = found.length > maxPoints
      ? found.filter((_, i) => i % Math.ceil(found.length / maxPoints) === 0)
      : found;

    const scale = height / h;
    return {
      points: keep.map(([x, y]) => ({
        x: (x - w / 2) * scale,
        y: (h / 2 - y) * scale,
      })),
      width: w * scale,
      height,
    };
  }

  /**
   * Run the physics backwards: given where a spark must be at t = T, solve
   * for the velocity that puts it there, then let drag park it in place.
   */
  function writeText(text, opts = {}) {
    const at = opts.at ?? { x: 0, y: 22, z: -24 };
    const sampled = sampleText(text, { height: opts.height ?? 7.6, maxPoints: CONFIG.tier === 'low' ? 620 : 1150 });
    if (!sampled.points.length) return null;

    const T = opts.form ?? 1.25;
    const drag = 2.3;
    const grav = 0.55;
    const k = (1 - Math.exp(-drag * T)) / drag;

    const warm = hexToRgb(0xffd86b, {});
    const hot = hexToRgb(0xff2e88, {});

    const half = sampled.width / 2;
    sampled.points.forEach((p) => {
      const tx = at.x + p.x;
      const ty = at.y + p.y;
      const tz = at.z + rand(-0.35, 0.35);

      const vx = (tx - at.x + rand(-0.04, 0.04)) / k;
      const vy = (ty - at.y + 0.5 * grav * T * T) / k;
      const vz = (tz - at.z) / k;

      const mix = clamp((p.x + half) / sampled.width, 0, 1);
      spawn({
        x: at.x, y: at.y, z: at.z,
        vx, vy, vz,
        r: warm.r + (hot.r - warm.r) * mix,
        g: warm.g + (hot.g - warm.g) * mix,
        b: warm.b + (hot.b - warm.b) * mix,
        birth: now + rand(0, 0.1),
        life: T + (opts.hold ?? 3.6) + rand(0, 0.8),
        size: rand(1.0, 1.8),
        drag,
        grav,
        twinkle: 12,
        turb: 0.07,
      });
    });

    useLight(at.x, at.y, at.z, 0xffd86b, 150);
    emit(EVENTS.BURST, { ...at, hex: 0xffd86b, scale: 1.6, pattern: 'text' });
    return sampled;
  }

  /** Slow drifting embers, for the finale sky. */
  function emberRain(count = 60, opts = {}) {
    for (let i = 0; i < count; i++) {
      spawn({
        x: rand(-30, 30), y: rand(14, 30), z: rand(-45, -4),
        vx: rand(-0.4, 0.4), vy: rand(-0.2, 0.1), vz: rand(-0.3, 0.3),
        r: 1, g: 0.72, b: 0.3,
        birth: now + rand(0, opts.spread ?? 3),
        life: rand(4, 8),
        size: rand(1.4, 2.6),
        drag: 0.35,
        grav: 0.45,
        twinkle: 8,
      });
    }
  }

  /* ── frame ────────────────────────────────────────────────── */

  function update(time, dt) {
    now = time;
    uniforms.uTime.value = time;

    for (let i = scheduled.length - 1; i >= 0; i--) {
      if (scheduled[i].at <= now) {
        const { fn } = scheduled.splice(i, 1)[0];
        fn();
      }
    }

    if (dirty) {
      for (const attr of Object.values(attrs)) attr.needsUpdate = true;
      dirty = false;
    }

    for (const entry of lightPool) {
      if (entry.energy <= 0.01) {
        if (entry.light.visible) { entry.light.visible = false; entry.light.intensity = 0; }
        continue;
      }
      entry.energy *= Math.exp(-dt * 5.5);
      entry.light.intensity = entry.energy;
    }
  }

  return {
    group,
    points,
    burst,
    launch,
    writeText,
    emberRain,
    sampleText,
    later,
    update,
    setPixelRatio(r) { uniforms.uPixelRatio.value = r; },
    get patterns() { return PATTERNS.slice(); },
    dispose() {
      geo.dispose();
      material.dispose();
    },
  };
}
