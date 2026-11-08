import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { damp, clamp, rand } from '../core/util.js';

/**
 * A hand-held camera rather than an orbit control: the composition is
 * art-directed, and the viewer only nudges it. Pointer position parallaxes
 * the eye, a pair of slow sines keeps it breathing, and every burst adds a
 * small decaying shake.
 */
export function createCameraRig(camera, dom) {
  const home = new THREE.Vector3(...CONFIG.camera.start);
  const homeLook = new THREE.Vector3(...CONFIG.camera.look);

  const basePos = home.clone();
  const baseLook = homeLook.clone();

  const pos = home.clone();
  const look = homeLook.clone();

  const pointer = new THREE.Vector2(0, 0);      // -1..1
  const smoothPointer = new THREE.Vector2(0, 0);
  const ndc = new THREE.Vector2(0, 0);

  const shake = new THREE.Vector3();
  let shakeEnergy = 0;

  const still = CONFIG.reducedMotion;

  function setPointer(clientX, clientY) {
    const r = dom.getBoundingClientRect();
    const x = (clientX - r.left) / r.width;
    const y = (clientY - r.top) / r.height;
    ndc.set(x * 2 - 1, -(y * 2 - 1));
    pointer.set(clamp(ndc.x, -1, 1), clamp(ndc.y, -1, 1));
  }

  return {
    pointer: ndc,

    /** Swap the resting composition, e.g. portrait vs landscape. */
    setHome(position, target) {
      home.set(...position);
      homeLook.set(...target);
      basePos.copy(home);
      baseLook.copy(homeLook);
    },

    /** Move the whole rig, e.g. to tilt up for the finale. */
    setPose(position, target) {
      if (position) basePos.set(...position);
      if (target) baseLook.set(...target);
    },

    resetPose() {
      basePos.copy(home);
      baseLook.copy(homeLook);
    },

    setPointer,

    impulse(strength = 1) {
      if (still) return;
      shakeEnergy = Math.min(1.6, shakeEnergy + strength);
    },

    update(time, dt) {
      smoothPointer.x = damp(smoothPointer.x, pointer.x, 2.6, dt);
      smoothPointer.y = damp(smoothPointer.y, pointer.y, 2.6, dt);

      const breatheX = still ? 0 : Math.sin(time * 0.17) * 0.55 + Math.sin(time * 0.071) * 0.3;
      const breatheY = still ? 0 : Math.sin(time * 0.13 + 1.7) * 0.18;

      const targetX = basePos.x + smoothPointer.x * 1.5 + breatheX;
      const targetY = basePos.y + smoothPointer.y * 0.55 + breatheY;
      const targetZ = basePos.z - Math.abs(smoothPointer.y) * 0.3;

      pos.x = damp(pos.x, targetX, 2.2, dt);
      pos.y = damp(pos.y, targetY, 2.2, dt);
      pos.z = damp(pos.z, targetZ, 1.6, dt);

      look.x = damp(look.x, baseLook.x + smoothPointer.x * 3.4, 2.0, dt);
      look.y = damp(look.y, baseLook.y + smoothPointer.y * 2.2, 2.0, dt);
      look.z = damp(look.z, baseLook.z, 1.2, dt);

      if (shakeEnergy > 0.001) {
        shakeEnergy *= Math.exp(-dt * 6.0);
        const s = shakeEnergy * 0.06;
        shake.set(rand(-s, s), rand(-s, s), rand(-s, s));
      } else {
        shake.set(0, 0, 0);
      }

      camera.position.copy(pos).add(shake);
      camera.lookAt(look);
    },
  };
}
