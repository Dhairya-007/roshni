import * as THREE from 'three';
import { CONFIG } from '../core/config.js';

/**
 * The river.
 *
 * Instead of a planar-reflection pass (a second render of the whole scene),
 * each light is reflected analytically: the shader walks a short list of
 * emitters and draws, for every one, a streak running from the lamp toward
 * the camera — the way a real reflection on rippled water always points at
 * the viewer. The ripple field displaces the streak sideways as it travels,
 * which is what sells it. One draw call, no extra render target.
 */
export function createWater() {
  const MAX = CONFIG.waterLights;

  const lightData = new Float32Array(MAX * 4); // xyz = position, w = intensity
  const lightCols = new Float32Array(MAX * 3);

  const uniforms = {
    uTime: { value: 0 },
    uLights: { value: lightData },
    uLightCols: { value: lightCols },
    uLightCount: { value: 0 },
    uDeep: { value: new THREE.Color(0x03010a) },
    uShallow: { value: new THREE.Color(0x1d0a33) },
    uHorizonCol: { value: new THREE.Color(0x3a0c2c) },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(0xffffff) },
    uWarmth: { value: 0 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    defines: { MAX_LIGHTS: MAX },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform float uTime, uFlash, uWarmth;
      uniform int uLightCount;
      uniform vec4 uLights[MAX_LIGHTS];
      uniform vec3 uLightCols[MAX_LIGHTS];
      uniform vec3 uDeep, uShallow, uHorizonCol, uFlashColor;

      varying vec3 vWorld;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
                   mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }

      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 3; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
        return v;
      }

      /* Height field: three crossing swells plus drifting chop. */
      float waves(vec2 q, float t) {
        float h = 0.0;
        h += sin(q.x * 0.72 + t * 0.95) * 0.060;
        h += sin(q.y * 1.13 - t * 0.74) * 0.048;
        h += sin((q.x + q.y) * 0.51 + t * 1.37) * 0.032;
        h += (fbm(q * 0.62 + vec2(t * 0.06, -t * 0.045)) - 0.5) * 0.085;
        return h;
      }

      void main() {
        vec3 p = vWorld;
        vec2 q = p.xz;
        vec3 V = normalize(cameraPosition - p);
        float dist = length(cameraPosition.xz - q);

        // fade the ripple detail with distance or it aliases into noise
        float detail = exp(-dist * 0.016);

        float e = 0.32;
        float h0 = waves(q, uTime);
        float hx = waves(q + vec2(e, 0.0), uTime);
        float hz = waves(q + vec2(0.0, e), uTime);
        vec3 nrm = normalize(vec3(-(hx - h0) / e * detail, 1.0, -(hz - h0) / e * detail));

        float fres = pow(1.0 - max(dot(nrm, V), 0.0), 4.0);
        vec3 col = mix(uDeep, uShallow, fres * 0.75);
        col += uHorizonCol * fres * 0.25;

        /* ── reflections ──────────────────────────────────────── */
        for (int i = 0; i < MAX_LIGHTS; i++) {
          if (i >= uLightCount) break;

          vec4 L = uLights[i];
          if (L.w <= 0.0) continue;

          vec2 toL = q - L.xz;
          vec2 dir = normalize(cameraPosition.xz - L.xz + vec2(1e-4));
          float along = dot(toL, dir);
          float perp = dot(toL, vec2(-dir.y, dir.x));

          // the ripples drag the reflection sideways, more the further it runs
          float wob = waves(vec2(along * 3.1, L.x * 7.0 + L.z * 3.0), uTime * 1.9);
          perp += wob * 3.4 * clamp(along * 0.5, 0.0, 1.6);

          float len = 0.9 + L.y * 2.4;                    // taller flame, longer streak
          float width = 0.085 + max(along, 0.0) * 0.075;  // widens toward the eye
          float streak = exp(-abs(perp) / width) * exp(-max(along, 0.0) / len);
          streak *= smoothstep(-0.45, 0.1, along);

          // the soft pool of light directly beneath the lamp
          float d2 = dot(toL, toL);
          float pool = 1.0 / (1.0 + d2 * 2.2);

          col += uLightCols[i] * (streak * 0.95 + pool * 0.30) * L.w;
        }

        /* ── glitter, flash, horizon ──────────────────────────── */

        // sparse specular glints, only once the river is actually alight
        float g = pow(noise(q * 7.3 + vec2(uTime * 0.35, uTime * -0.21)), 24.0);
        col += vec3(1.0, 0.78, 0.45) * g * detail * (0.15 + uWarmth * 0.45);

        col += uFlashColor * uFlash * (0.30 + 0.55 * fres) * detail;

        float horizon = smoothstep(90.0, 400.0, dist);
        col = mix(col, uHorizonCol * 0.85, horizon);

        col += (hash(gl_FragCoord.xy + uTime) - 0.5) * 0.004;

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(900, 900, 1, 1), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0;
  mesh.name = 'water';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;

  let flash = 0;

  return {
    mesh,
    maxLights: MAX,

    /**
     * @param {Array<{x:number,y:number,z:number,r:number,g:number,b:number,i:number}>} list
     * Already sorted by relevance; anything past MAX is dropped.
     */
    setLights(list) {
      const n = Math.min(list.length, MAX);
      for (let i = 0; i < n; i++) {
        const l = list[i];
        lightData[i * 4] = l.x;
        lightData[i * 4 + 1] = l.y;
        lightData[i * 4 + 2] = l.z;
        lightData[i * 4 + 3] = l.i;
        lightCols[i * 3] = l.r;
        lightCols[i * 3 + 1] = l.g;
        lightCols[i * 3 + 2] = l.b;
      }
      uniforms.uLightCount.value = n;
    },

    flash(color, strength = 1) {
      flash = Math.min(2.2, flash + strength);
      uniforms.uFlashColor.value.set(color);
    },

    setWarmth(t) { uniforms.uWarmth.value = t; },

    update(time, dt) {
      uniforms.uTime.value = time;
      flash *= Math.exp(-dt * 4.2);
      uniforms.uFlash.value = flash * 0.16;
    },
  };
}
