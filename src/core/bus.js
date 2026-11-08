/** Dead-simple pub/sub. The scene and the DOM talk only through this. */

const channels = new Map();

export function on(event, handler) {
  if (!channels.has(event)) channels.set(event, new Set());
  channels.get(event).add(handler);
  return () => off(event, handler);
}

export function off(event, handler) {
  channels.get(event)?.delete(handler);
}

export function emit(event, payload) {
  const set = channels.get(event);
  if (!set) return;
  for (const handler of [...set]) {
    try {
      handler(payload);
    } catch (err) {
      console.error(`[bus] handler for "${event}" threw`, err);
    }
  }
}

export const EVENTS = {
  READY: 'ready',
  BEGIN: 'begin',
  DIYA_LIT: 'diya:lit',
  PROGRESS: 'progress',
  SKY_UNLOCKED: 'sky:unlocked',
  BURST: 'firework:burst',
  PHASE: 'phase',
  FINALE: 'finale',
  CARD: 'card',
  MUTE: 'mute',
  SPREAD_ALL: 'spread:all',
};

export const PHASES = {
  LOADING: 'loading',
  INTRO: 'intro',
  LIGHTING: 'lighting',
  CELEBRATION: 'celebration',
  FINALE: 'finale',
};
