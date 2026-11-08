import { createApp } from './core/app.js';
import { createOverlay } from './ui/overlay.js';
import { on, EVENTS, PHASES } from './core/bus.js';
import { CONFIG } from './core/config.js';

const canvas = document.getElementById('stage');
const overlay = createOverlay();

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}

if (!hasWebGL()) {
  overlay.fail(
    'This wish is drawn with WebGL, and this browser will not give us a canvas. ' +
    'Try a recent Chrome, Safari or Firefox — or check that hardware acceleration is on.'
  );
} else {
  try {
    const app = createApp(canvas);

    // give the first frames a moment to compile shaders before we fade in
    const start = performance.now();
    const waitForFirstPaint = () => {
      if (performance.now() - start > 700) {
        overlay.ready();
        return;
      }
      requestAnimationFrame(waitForFirstPaint);
    };
    requestAnimationFrame(waitForFirstPaint);

    if (new URLSearchParams(location.search).has('debug')) {
      window.roshni = { app, CONFIG };
      console.info('[roshni] tier:', CONFIG.tier, CONFIG);
    }
  } catch (err) {
    console.error(err);
    overlay.fail(
      'Something went wrong setting up the scene. ' +
      'If you are on a very old GPU driver, that is usually the cause.'
    );
  }
}
