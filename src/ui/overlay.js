import { emit, on, EVENTS, PHASES } from '../core/bus.js';
import { audio } from '../audio/audio.js';
import { CONFIG } from '../core/config.js';
import { clamp } from '../core/util.js';

const $ = (id) => document.getElementById(id);

/** Fade a screen in or out, keeping it out of the a11y tree when hidden. */
function show(el, on_ = true) {
  if (!el) return;
  if (on_) {
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('is-active'));
  } else {
    el.classList.remove('is-active');
    setTimeout(() => { el.hidden = true; }, CONFIG.reducedMotion ? 20 : 900);
  }
}

export function createOverlay() {
  const els = {
    loader: $('loader'),
    intro: $('intro'),
    hud: $('hud'),
    card: $('card'),
    to: $('to'),
    from: $('from'),
    begin: $('begin'),
    mute: $('mute'),
    spread: $('spread'),
    finale: $('finale'),
    litCount: $('lit-count'),
    litTotal: $('lit-total'),
    fill: $('hud-fill'),
    hint: $('hint'),
    cardTo: $('card-to'),
    cardBody: $('card-body'),
    share: $('share'),
    again: $('again'),
    shareNote: $('share-note'),
  };

  const params = new URLSearchParams(location.search);
  const incomingTo = (params.get('to') || '').slice(0, 22).trim();
  const incomingFrom = (params.get('from') || '').slice(0, 22).trim();

  if (incomingTo) els.to.value = incomingTo;
  if (incomingFrom) els.from.value = incomingFrom;
  els.litTotal.textContent = String(CONFIG.diyas);

  /* ── hints ────────────────────────────────────────────────── */

  let hintUntil = 0;
  let hintTimer = 0;

  function hint(text, hold = 5200, force = false) {
    const now = performance.now();
    if (!force && now < hintUntil) return;
    hintUntil = now + hold;
    clearTimeout(hintTimer);
    els.hint.textContent = text;
    els.hint.classList.add('is-on');
    hintTimer = setTimeout(() => els.hint.classList.remove('is-on'), hold);
  }

  /* ── intro ────────────────────────────────────────────────── */

  let started = false;

  async function begin() {
    if (started) return;
    started = true;
    await audio.unlock();
    show(els.intro, false);
    show(els.hud, true);
    emit(EVENTS.BEGIN, { to: els.to.value.trim() });
    setTimeout(() => hint('Tap a diya on the water. The flame will find its neighbours.', 6400, true), 1500);
  }

  els.begin.addEventListener('click', begin);
  els.to.addEventListener('keydown', (e) => { if (e.key === 'Enter') begin(); });

  /* ── mute ─────────────────────────────────────────────────── */

  let muted = false;
  function setMuted(next) {
    muted = next;
    audio.setMuted(muted);
    els.mute.setAttribute('aria-pressed', String(muted));
    els.mute.title = muted ? 'Unmute sound (M)' : 'Mute sound (M)';
  }
  els.mute.addEventListener('click', () => setMuted(!muted));

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    const k = e.key.toLowerCase();
    if (k === 'm') setMuted(!muted);
    if ((k === ' ' || k === 'enter') && !started) { e.preventDefault(); begin(); }
    if (k === 'f' && !els.finale.hidden) els.finale.click();
  });

  /* ── progress ─────────────────────────────────────────────── */

  let milestones = new Set();

  on(EVENTS.PROGRESS, ({ litCount, total, ratio }) => {
    els.litCount.textContent = String(litCount);
    els.fill.style.width = `${clamp(ratio * 100, 0, 100).toFixed(1)}%`;

    if (litCount >= 14 && els.spread.hidden && ratio < 1) els.spread.hidden = false;
    if (litCount >= total) {
      els.spread.hidden = true;
      hint('One hundred and eight. Now put a name on the sky.', 7000, true);
    }

    const marks = [
      [0.12, 'It spreads on its own — but only so far. Light another.'],
      [0.35, 'The river is starting to remember.'],
      [0.85, 'Almost all of them.'],
    ];
    for (const [at, text] of marks) {
      if (ratio >= at && !milestones.has(at)) {
        milestones.add(at);
        hint(text);
      }
    }
  });

  on(EVENTS.SKY_UNLOCKED, () => {
    els.finale.hidden = false;
    hint('The sky is awake. Tap anywhere above the water to send one up.', 7200, true);
  });

  els.spread.addEventListener('click', () => {
    els.spread.hidden = true;
    emit(EVENTS.SPREAD_ALL, {});
    hint('Let it run.', 3200, true);
  });

  els.finale.addEventListener('click', () => {
    els.finale.hidden = true;
    els.spread.hidden = true;
    els.hint.classList.remove('is-on');
    emit(EVENTS.FINALE, {});
  });

  /* ── wish card ────────────────────────────────────────────── */

  on(EVENTS.CARD, ({ to }) => {
    const name = (to || els.to.value || '').trim();
    els.cardTo.textContent = name || 'you';
    if (incomingFrom) {
      els.from.value = incomingFrom;
    }
    show(els.card, true);
  });

  els.again.addEventListener('click', () => {
    show(els.card, false);
    hint('Tap the sky as long as you like.', 5000, true);
  });

  els.share.addEventListener('click', async () => {
    const url = new URL(location.href);
    url.search = '';
    const to = els.to.value.trim();
    const from = els.from.value.trim().replace(/^—\s*/, '');
    if (to) url.searchParams.set('to', to);
    if (from) url.searchParams.set('from', from);

    const link = url.toString();
    try {
      await navigator.clipboard.writeText(link);
      els.shareNote.textContent = 'Link copied. Send it on.';
    } catch {
      // clipboard refused (insecure context, or no permission) — fall back
      const ta = document.createElement('textarea');
      ta.value = link;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand?.('copy');
      ta.remove();
      els.shareNote.textContent = ok ? 'Link copied. Send it on.' : link;
    }
    audio.bell({ freq: 523.25, gain: 0.2, decay: 2.4 });
  });

  /* ── hand-off from the loader ─────────────────────────────── */

  return {
    ready() {
      show(els.loader, false);
      show(els.intro, true);
      if (incomingTo) {
        els.to.value = incomingTo;
      }
    },
    fail(message) {
      els.loader.innerHTML = `
        <h1 style="font-family:'Tiro Devanagari Hindi',serif;font-size:3.4rem;margin:0 0 1rem;color:var(--gold)">रोशनी</h1>
        <p style="max-width:26rem;color:rgb(255 243 220 / .72);line-height:1.6">${message}</p>`;
    },
    hint,
  };
}
