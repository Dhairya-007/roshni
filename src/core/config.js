import { clamp } from './util.js';

/**
 * One place for every tunable. Quality is picked from what the device
 * actually has, not from a user-agent guess.
 */
function detectTier() {
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory ?? 4; // GiB, Chromium only
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const smallViewport = Math.min(window.innerWidth, window.innerHeight) < 620;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let score = 2; // 0 low, 1 mid, 2 high
  if (cores <= 4) score -= 1;
  if (cores <= 2 || mem <= 2) score -= 1;
  if (coarse && smallViewport) score -= 1;
  if (reduced) score = Math.min(score, 1);

  return ['low', 'mid', 'high'][clamp(score, 0, 2)];
}

const TIER = detectTier();

const TIERS = {
  low: {
    diyas: 64,
    waterLights: 10,
    maxParticles: 9000,
    bloom: { strength: 0.50, radius: 0.60, threshold: 0.62, scale: 0.5 },
    dprCap: 1.5,
    stars: 900,
    rangoliSize: 512,
    ambientShells: 0.55,
  },
  mid: {
    diyas: 84,
    waterLights: 16,
    maxParticles: 16000,
    bloom: { strength: 0.56, radius: 0.62, threshold: 0.60, scale: 0.6 },
    dprCap: 1.75,
    stars: 1500,
    rangoliSize: 768,
    ambientShells: 0.8,
  },
  high: {
    diyas: 108,
    waterLights: 28,
    maxParticles: 26000,
    bloom: { strength: 0.62, radius: 0.64, threshold: 0.58, scale: 0.75 },
    dprCap: 2,
    stars: 2400,
    rangoliSize: 1024,
    ambientShells: 1,
  },
};

export const CONFIG = {
  tier: TIER,
  reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  ...TIERS[TIER],

  /** Fraction of diyas that must burn before the sky opens up. */
  skyUnlockRatio: 0.55,

  river: {
    centre: [0, 0, -16],
    innerRadius: 3.4,
    outerRadius: 20,
  },

  camera: {
    fov: 52,
    start: [0, 5.0, 17.2],
    look: [0, 3.0, -10],
    /** Where the eye goes when the name is written in the sky. */
    finaleLook: [0, 11.5, -26],
    /**
     * Portrait is not the landscape shot letterboxed: seen from a low eye a
     * wide river collapses into a thin band, so the phone view climbs and
     * looks further down to give the water some of the frame.
     */
    portrait: {
      start: [0, 8.5, 17.2],
      look: [0, 2.0, -10],
      finaleLook: [0, 13.0, -26],
    },
  },

  palette: {
    flame: [0xfff1c4, 0xffc21a, 0xff8a1f, 0xff6a2a],
    shells: [0xffc21a, 0xff2e88, 0x00e5c0, 0xff8a1f, 0xfff3dc, 0x8b5cf6, 0x34d399, 0xff3b3b],
  },
};

export const isLow = TIER === 'low';
