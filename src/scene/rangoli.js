import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { rand, pick, TAU } from '../core/util.js';

/**
 * A rangoli drawn into a canvas at load time, then revealed outward from
 * the centre as the river fills — the way one is actually laid, ring by
 * ring, with a bright frontier where the powder is falling.
 *
 * The pattern is a 12-fold rotational symmetry group: one motif per layer,
 * stamped around the circle, which is exactly how the real thing is built.
 */

const PALETTE = {
  magenta: '#ff2e88',
  saffron: '#ff8a1f',
  marigold: '#ffc21a',
  teal: '#00e5c0',
  violet: '#8b5cf6',
  cream: '#fff3dc',
  rose: '#ff5d7a',
  leaf: '#34d399',
};

function drawRangoli(size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  const R = size / 2;

  g.clearRect(0, 0, size, size);
  g.translate(R, R);
  g.lineJoin = 'round';
  g.lineCap = 'round';

  const unit = R / 100;
  const FOLD = 12;

  /** Stamp a motif FOLD times around the centre. */
  const around = (n, fn, offset = 0) => {
    for (let k = 0; k < n; k++) {
      g.save();
      g.rotate((k / n) * TAU + offset);
      fn(k);
      g.restore();
    }
  };

  const petal = (r0, r1, half, fill, stroke) => {
    g.beginPath();
    g.moveTo(0, -r0 * unit);
    g.quadraticCurveTo(half * unit, -(r0 + r1) * 0.5 * unit, 0, -r1 * unit);
    g.quadraticCurveTo(-half * unit, -(r0 + r1) * 0.5 * unit, 0, -r0 * unit);
    g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1.1 * unit; g.stroke(); }
  };

  const dot = (r, d, fill) => {
    g.beginPath();
    g.arc(0, -r * unit, d * unit, 0, TAU);
    g.fillStyle = fill;
    g.fill();
  };

  const ring = (r, w, stroke, dash) => {
    g.beginPath();
    g.arc(0, 0, r * unit, 0, TAU);
    g.strokeStyle = stroke;
    g.lineWidth = w * unit;
    if (dash) g.setLineDash(dash.map((d) => d * unit));
    g.stroke();
    g.setLineDash([]);
  };

  /* ── layer 1: lotus heart ──────────────────────────────────── */
  g.globalCompositeOperation = 'source-over';
  around(8, () => petal(0, 17, 7, PALETTE.marigold, PALETTE.saffron));
  around(8, () => petal(2, 11, 4.5, PALETTE.cream, null), Math.PI / 8);
  dot(0, 5.5, PALETTE.magenta);
  dot(0, 2.4, PALETTE.cream);

  /* ── layer 2: a band of teardrops ─────────────────────────── */
  ring(21, 1.4, PALETTE.cream, [3, 4]);
  around(FOLD, (k) => petal(22, 38, 8.5,
    k % 2 ? PALETTE.magenta : PALETTE.violet,
    PALETTE.cream));
  around(FOLD, () => dot(30, 2.2, PALETTE.marigold), Math.PI / FOLD);

  /* ── layer 3: leaf points and dot work ───────────────────────── */
  ring(41, 1.1, PALETTE.saffron);
  around(FOLD * 2, (k) => {
    petal(42, k % 2 ? 56 : 50, 5.2, k % 2 ? PALETTE.teal : PALETTE.leaf, null);
  });
  around(FOLD * 2, () => dot(59, 1.8, PALETTE.cream), Math.PI / (FOLD * 2));

  /* ── layer 4: outer petals, the widest ring ──────────────── */
  ring(62, 1.6, PALETTE.cream, [2, 5]);
  around(FOLD, (k) => {
    petal(64, 86, 13, k % 3 === 0 ? PALETTE.saffron : k % 3 === 1 ? PALETTE.rose : PALETTE.marigold,
      PALETTE.cream);
    petal(70, 80, 4, PALETTE.cream, null);
  });
  around(FOLD, () => {
    // a cluster of three, the way the dots are placed between petals
    dot(90, 2.6, PALETTE.magenta);
    g.save(); g.rotate(0.058); dot(88, 1.7, PALETTE.cream); g.restore();
    g.save(); g.rotate(-0.058); dot(88, 1.7, PALETTE.cream); g.restore();
  }, Math.PI / FOLD);
  around(FOLD * 3, () => dot(91, 2.0, PALETTE.marigold), Math.PI / (FOLD * 3));

  /* ── layer 5: the border ──────────────────────────────────── */
  ring(96, 2.0, PALETTE.saffron);
  ring(99, 1.0, PALETTE.marigold, [4, 3]);

  /* ── a dusting of loose powder, so it is not machine-perfect ── */
  for (let i = 0; i < 420; i++) {
    const a = rand(0, TAU);
    const r = Math.sqrt(rand(0.02, 1)) * 99;
    g.globalAlpha = rand(0.08, 0.4);
    g.fillStyle = pick(Object.values(PALETTE));
    g.beginPath();
    g.arc(Math.cos(a) * r * unit, Math.sin(a) * r * unit, rand(0.3, 1.1) * unit, 0, TAU);
    g.fill();
  }
  g.globalAlpha = 1;

  return canvas;
}

export function createRangoli() {
  const canvas = drawRangoli(CONFIG.rangoliSize);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;

  const uniforms = {
    uMap: { value: texture },
    uProgress: { value: 0 },
    uTime: { value: 0 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uProgress, uTime;
      varying vec2 vUv;

      void main() {
        vec4 tex = texture2D(uMap, vUv);
        if (tex.a < 0.02) discard;

        float r = length(vUv - 0.5) * 2.0;

        // the drawing frontier sweeps outward, with a lit edge at the front
        float front = uProgress * 1.18;
        float drawn = smoothstep(front, front - 0.13, r);
        float edge = exp(-pow((r - front) * 11.0, 2.0)) * step(0.01, uProgress) * (1.0 - step(1.0, uProgress));

        // powder catches the lamplight and glitters very slightly
        float shimmer = 0.88 + 0.12 * sin(uTime * 1.6 + r * 22.0);

        // powder reflects the ghat lamps; it does not glow on its own
        vec3 col = tex.rgb * shimmer * 0.42;
        col += vec3(1.0, 0.82, 0.5) * edge * 0.55;

        float a = tex.a * drawn;
        a = max(a, tex.a * edge);
        if (a < 0.01) discard;

        gl_FragColor = vec4(col, a * 0.92);
      }
    `,
  });

  const RADIUS = 3.3;
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(RADIUS, 72), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, 0.772, 6.6);
  mesh.renderOrder = 1;
  mesh.name = 'rangoli';

  let target = 0;

  return {
    mesh,
    /** 0 → nothing laid, 1 → complete. */
    setProgress(t) { target = Math.max(target, Math.min(1, t)); },
    get progress() { return uniforms.uProgress.value; },
    update(time, dt) {
      uniforms.uTime.value = time;
      uniforms.uProgress.value += (target - uniforms.uProgress.value) * Math.min(1, dt * 1.1);
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}
