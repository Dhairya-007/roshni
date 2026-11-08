<h1 align="center">रोशनी · Roshni</h1>

<p align="center">
  <em>A river gone dark, and a hundred and eight diyas waiting.<br/>
  Light one — the flame will find the next.</em>
</p>

<p align="center">
  <a href="https://dhairya-007.github.io/roshni/"><b>Open the wish →</b></a>
</p>

---

An interactive 3D Diwali wish. You stand on a ghat at night. The river in front
of you is full of unlit diyas. Tap one and it catches — and the flame spreads to
its neighbours in a travelling wave, so the river fills by your hand rather than
by a loading bar. Light enough of it and the sky opens: shells launch, break,
crackle and drift. At the end you can write a name across the sky in fire and
send the whole thing to someone as a link.

Everything on screen is generated at runtime. There are no textures, no models,
no audio files, and no build step — one HTML file, a stylesheet, and ES modules
that import three.js from a CDN.

## What is actually interesting here

**Reflections without a reflection pass.** Mirroring a scene into water normally
means rendering it twice. Instead the water shader takes a short list of
emitters and draws each one's reflection analytically: a streak running from the
lamp *toward the camera*, which is where a reflection on rippled water always
points, displaced sideways by the same wave field that shades the surface. One
draw call, a hundred-odd lamps, and the river reads correctly from any angle.
→ [`src/scene/water.js`](src/scene/water.js)

**Fireworks integrated in the vertex shader.** Every spark stores an origin, a
launch velocity, a drag coefficient and a gravity term. Its position at time *t*
is the closed-form solution of `v' = -dv`:

```
x(t) = x₀ + v₀·(1 − e^(−d·t)) / d − ½·g·t²
```

The CPU writes a slot once and never touches it again, so tens of thousands of
sparks cost almost nothing per frame. Drag is what makes a shell read as a
shell — the sparks sprint, stall, then drift.
→ [`src/scene/fireworks.js`](src/scene/fireworks.js)

**A name written in fire.** Because that solution is invertible, the finale runs
it backwards: sample the text into target points, solve for the velocity that
puts each spark exactly on a letterform at *t = T*, and let drag park it there.
The burst does not scatter and then rearrange — it assembles.

**Fire that spreads.** Ignition is a decaying branching process over a
nearest-neighbour graph. One tap gives you a wave of twenty-odd lamps that runs
out of breath on its own, so lighting the river stays an activity rather than a
single click.
→ [`src/scene/diyas.js`](src/scene/diyas.js)

**Every sound is synthesised live.** The temple bell is four inharmonic partials
(1, 2.76, 5.4, 8.93) over an FM strike — the inharmonicity is the whole
difference between a bell and a beep. A shell break is a sub thump plus
band-limited noise; the crackle is forty tiny high-passed impulses scattered
across a second and a half; the ambience is two detuned saws under a plucked
tanpura figure, through a convolution reverb whose impulse response is
decaying noise generated at startup. No sample is loaded.
→ [`src/audio/audio.js`](src/audio/audio.js)

**A rangoli that draws itself.** Twelve-fold rotational symmetry stamped layer by
layer into a canvas, then revealed outward from the centre with a lit frontier —
the way one is actually laid, ring by ring.
→ [`src/scene/rangoli.js`](src/scene/rangoli.js)

## Running it

Any static server will do; ES modules will not load over `file://`.

```bash
git clone https://github.com/Dhairya-007/roshni.git
cd roshni
python3 -m http.server 8000
# → http://localhost:8000
```

Add `?debug=1` to log the chosen quality tier and expose the scene on
`window.roshni`.

## Sharing a wish

The page reads `?to=` and `?from=`, so a finished wish is just a link:

```
https://dhairya-007.github.io/roshni/?to=Aai&from=Dhairya
```

## Controls

| | |
|---|---|
| Tap / click a diya | light it, and start a wave |
| Tap the sky | send up a shell (once the sky is open) |
| Move the pointer | parallax the camera |
| `M` | mute |
| `F` | skip to the finale |

## Quality

The renderer picks a tier from `hardwareConcurrency`, `deviceMemory`, pointer
type and `prefers-reduced-motion`, and scales diya count, particle budget,
bloom resolution and pixel ratio accordingly. Portrait gets its own camera
composition — a low eye collapses a wide river into a thin band, so the phone
view climbs and looks further down.

## Layout

```
index.html            markup and the import map
styles/style.css      interface layer
src/
  main.js             entry, WebGL capability check
  core/
    app.js            renderer, post chain, phases, input, frame loop
    config.js         every tunable, and the device tier
    bus.js            pub/sub between scene and DOM
    util.js           maths helpers
  scene/
    sky.js            gradient dome, haze, star field
    water.js          ripples and analytic reflections
    diyas.js          instanced lamps, flames, the ignition wave
    flame.js          the flame shader, shared
    city.js           ghat, temple lamps, bulb strands, far bank
    rangoli.js        procedural mandala
    fireworks.js      GPU particles, shell patterns, sky text
    cameraRig.js      drift, parallax, burst shake
  audio/audio.js      the whole soundtrack, synthesised
  ui/overlay.js       screens, hints, progress, wish card
```

Built with [three.js](https://threejs.org) r170 and the Web Audio API.

## Licence

MIT © Dhairya Oza
