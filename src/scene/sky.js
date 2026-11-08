import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { TAU, rand } from '../core/util.js';

/**
 * The night itself: an inverted dome with a hand-tuned gradient, a warm
 * city glow sitting on the horizon, and a field of stars that twinkle
 * at their own pace. `flash()` lets a firework bounce light off the haze.
 */
export function createSky() {
  const group = new THREE.Group();
  group.name = 'sky';

  const uniforms = {
    uTime: { value: 0 },
    uTopColor: { value: new THREE.Color(0x05020c) },
    uMidColor: { value: new THREE.Color(0x1b0733) },
    uHorizon: { value: new THREE.Color(0x4a1038) },
    uGlow: { value: new THREE.Color(0xff7a2a) },
    uGlowStrength: { value: 0.26 },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(0xffffff) },
  };

  const domeMat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTopColor, uMidColor, uHorizon, uGlow, uFlashColor;
      uniform float uGlowStrength, uFlash, uTime;
      varying vec3 vDir;

      // cheap value noise for the haze bands
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }

      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);

        // three-stop vertical gradient, biased so most of the frame is deep night
        vec3 col = mix(uHorizon, uMidColor, smoothstep(0.42, 0.62, h));
        col = mix(col, uTopColor, smoothstep(0.58, 0.95, h));

        // warm glow of a city that is awake all night, strongest behind the skyline
        float band = pow(1.0 - abs(d.y - 0.03) * 3.4, 6.0);
        float lateral = 0.6 + 0.4 * smoothstep(-1.0, 1.0, -d.z);
        col += uGlow * max(band, 0.0) * uGlowStrength * lateral;

        // slow drifting haze so the sky is never a flat ramp
        float n = noise(d.xz * 3.2 + vec2(uTime * 0.012, 0.0));
        n = mix(n, noise(d.xz * 7.0 - vec2(uTime * 0.02, 0.0)), 0.5);
        col += vec3(0.055, 0.03, 0.08) * n * smoothstep(0.35, 0.8, h);

        // smoke haze catching a burst
        col += uFlashColor * uFlash * (0.26 + 0.5 * pow(max(0.0, 1.0 - abs(d.y - 0.25) * 2.0), 2.0));

        // subtle dither kills banding on wide gradients
        col += (hash(gl_FragCoord.xy) - 0.5) * 0.006;

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const dome = new THREE.Mesh(new THREE.SphereGeometry(320, 48, 32), domeMat);
  dome.frustumCulled = false;
  group.add(dome);

  /* ── stars ─────────────────────────────────────────────────── */

  const count = CONFIG.stars;
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const size = new Float32Array(count);
  const tint = new Float32Array(count * 3);

  const warm = new THREE.Color(0xffd9a0);
  const cool = new THREE.Color(0xbcd4ff);
  const c = new THREE.Color();

  for (let i = 0; i < count; i++) {
    // only the upper hemisphere, pushed away from the horizon haze
    const u = rand(0, 1);
    const y = Math.pow(u, 0.55);
    const r = Math.sqrt(1 - y * y);
    const a = rand(0, TAU);
    const R = rand(240, 300);
    pos[i * 3] = r * Math.cos(a) * R;
    pos[i * 3 + 1] = y * R + 10;
    pos[i * 3 + 2] = r * Math.sin(a) * R;

    seed[i] = rand(0, TAU);
    // a few bright ones, many faint — magnitude distribution, roughly
    size[i] = Math.pow(rand(0, 1), 3.4) * 7 + 0.9;

    c.copy(Math.random() < 0.3 ? warm : cool).lerp(new THREE.Color(0xffffff), rand(0.2, 0.8));
    tint[i * 3] = c.r; tint[i * 3 + 1] = c.g; tint[i * 3 + 2] = c.b;
  }

  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  starGeo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  starGeo.setAttribute('aTint', new THREE.BufferAttribute(tint, 3));

  const starUniforms = {
    uTime: { value: 0 },
    uPixelRatio: { value: 1 },
    uOpacity: { value: 0.0 },
  };

  const starMat = new THREE.ShaderMaterial({
    uniforms: starUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aSeed;
      attribute float aSize;
      attribute vec3 aTint;
      uniform float uTime, uPixelRatio;
      varying vec3 vTint;
      varying float vTwinkle;
      void main() {
        vTint = aTint;
        // two incommensurate rates so the field never pulses in unison
        vTwinkle = 0.55 + 0.45 * sin(uTime * 1.1 + aSeed * 3.0)
                        * (0.6 + 0.4 * sin(uTime * 0.37 + aSeed));
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uPixelRatio * (1.0 + vTwinkle * 0.35);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying vec3 vTint;
      varying float vTwinkle;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv);
        float core = smoothstep(0.5, 0.0, d);
        // a faint cross flare on the brightest stars reads as lens diffraction
        float flare = max(0.0, 1.0 - abs(uv.x) * 14.0) + max(0.0, 1.0 - abs(uv.y) * 14.0);
        float a = core * core + flare * 0.06 * core;
        gl_FragColor = vec4(vTint * (0.7 + vTwinkle), a * uOpacity * vTwinkle);
      }
    `,
  });

  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  group.add(stars);

  let flash = 0;

  return {
    group,
    /** A burst lights the haze and makes the stars wash out for a beat. */
    flash(color, strength = 1) {
      flash = Math.min(1.4, flash + strength);
      uniforms.uFlashColor.value.set(color);
    },
    setPixelRatio(r) { starUniforms.uPixelRatio.value = r; },
    update(time, dt) {
      uniforms.uTime.value = time;
      starUniforms.uTime.value = time;
      flash *= Math.exp(-dt * 3.4);
      uniforms.uFlash.value = flash * 0.1;
      starUniforms.uOpacity.value = Math.min(1, starUniforms.uOpacity.value + dt * 0.18);
    },
    /** Night deepens into festival as the river fills with light. */
    setMood(t) {
      uniforms.uGlowStrength.value = 0.26 + t * 0.22;
      uniforms.uHorizon.value.setHex(0x4a1038).lerp(new THREE.Color(0x6d1a2e), t);
    },
  };
}
