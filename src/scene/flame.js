import * as THREE from 'three';

/**
 * The flame shader, shared by the river diyas and the big lamps on the ghat.
 *
 * A flame is drawn as a single point sprite: a teardrop whose tip wavers,
 * with a hot low core, a blue skirt at the wick and three beat frequencies
 * of flicker so no two lamps ever pulse together.
 */

export const FLAME_VERT = /* glsl */ `
  attribute float aSeed;
  attribute float aScale;
  attribute float aIgnite;

  uniform float uTime, uPixelRatio, uSize;

  varying float vLife;
  varying float vSeed;
  varying float vFlicker;

  void main() {
    float age = uTime - aIgnite;
    bool on = aIgnite >= 0.0 && age >= 0.0;

    // catch, flare, settle — a wick does not reach full height at once
    float birth = smoothstep(0.0, 0.5, age);
    float flare = 1.0 + 0.55 * exp(-age * 3.2) * sin(age * 18.0);
    vLife = on ? birth * flare : 0.0;

    vFlicker = 0.80
      + 0.16 * sin(uTime * 9.3 + aSeed * 7.0)
      + 0.09 * sin(uTime * 21.7 + aSeed * 3.1)
      + 0.07 * sin(uTime * 2.3 + aSeed);
    vSeed = aSeed;

    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aScale * uSize * vLife * vFlicker * uPixelRatio * (180.0 / max(-mv.z, 0.1));
    if (vLife <= 0.001) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }
`;

export const FLAME_FRAG = /* glsl */ `
  uniform float uTime;
  varying float vLife;
  varying float vSeed;
  varying float vFlicker;

  const float PI = 3.141592653589793;

  void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;              // y points down
    float ty = clamp(-uv.y * 0.5 + 0.5, 0.0, 1.0);    // 0 wick .. 1 tip

    float sway = sin(ty * 5.4 + uTime * 7.4 + vSeed * 5.0) * 0.17 * pow(ty, 1.7)
               + sin(ty * 11.0 - uTime * 11.3 + vSeed) * 0.06 * pow(ty, 2.2);
    float x = uv.x - sway;

    // zero width at both ends, fullest about a third of the way up
    float w = pow(sin(pow(ty, 0.80) * PI), 0.62) * (1.0 - 0.28 * ty) * 0.62;
    float body = smoothstep(w, w * 0.35, abs(x));
    body *= smoothstep(0.0, 0.06, ty) * smoothstep(1.0, 0.86, ty);

    float core = body * smoothstep(0.95, 0.18, length(vec2(x * 2.1, (ty - 0.26) * 1.45)));

    vec3 col = mix(vec3(1.00, 0.30, 0.03), vec3(1.00, 0.72, 0.22), body);
    col = mix(col, vec3(1.00, 0.93, 0.74), core);
    col = mix(col, vec3(1.0), pow(core, 3.0) * 0.9);
    col = mix(col, vec3(0.35, 0.52, 1.0), smoothstep(0.14, 0.0, ty) * body * 0.55);

    float a = (body * 0.55 + core * 0.34) * vLife * vFlicker;
    if (a < 0.004) discard;
    gl_FragColor = vec4(col, a);
  }
`;

export const HALO_FRAG = /* glsl */ `
  varying float vLife;
  varying float vFlicker;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float a = pow(1.0 - d, 3.4) * 0.11 * vLife * vFlicker;
    vec3 col = mix(vec3(1.0, 0.52, 0.16), vec3(1.0, 0.80, 0.42), pow(1.0 - d, 2.0));
    gl_FragColor = vec4(col, a);
  }
`;

export function flameMaterial(sharedUniforms, { size = 1.25, halo = false } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { ...sharedUniforms, uSize: { value: size } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: FLAME_VERT,
    fragmentShader: halo ? HALO_FRAG : FLAME_FRAG,
  });
}
