# Brake Wave — phantom jam demo

A single-lane 3D traffic toy that shows how a **phantom jam** (a.k.a. a **brake wave** / traffic
shockwave) forms: one car brakes hard, and the braking ripples **backwards** through the queue —
cars further back stop even though there is no obstacle, no accident and no lane closure ahead of
them. Nothing is blocking the road; the jam is created purely by human reaction time plus the
instability of driving too close.

Classic regimes you can produce here:

| Regime | What you see |
| --- | --- |
| Free flow | All cars cruise at ~30 m/s (108 km/h) at a comfortable headway. |
| Brake wave | One hard brake is amplified downstream and travels backwards; cars briefly slow/stop, then recover. |
| Phantom jam | Low headway + high reaction delay: the jam never fully clears, stop-and-go waves persist with no external cause. |

## How the demo shows it

- **IDM car following** — each follower uses the Intelligent Driver Model
  (`src/sim.ts`): desired speed `v0 ≈ 30 m/s`, desired time headway `T ≈ 1 s` (jittered per
  driver), `a = 2 m/s²`, comfortable braking `b = 3 m/s²`, hard braking up to `9 m/s²`,
  minimum gap `s0 = 2 m`.
- **Reaction delay** — every car keeps a short history of what it saw (gap and closing speed to
  its leader) and acts on the sample from `delay` seconds ago, so information propagates at a
  *finite* speed instead of instantly.
- **Pace car brake** — car 0 (grey) is the "pace car". *Trigger brake* makes it brake hard for
  ~3 s. The car behind reacts first, then the next, and so on: the wave front travels down the
  queue at a measurable speed.
- **Colour by braking** — follower bodies are tinted by a smoothed brake signal:
  <span>🟩 cruising</span> → <span>🟨 easing</span> → <span>🟥 hard brake</span>; tail lights
  glow red, optional red **brake trails** and blue **speed arrows** show deceleration and flow.
  The pace car flashes red while braking.
- **Measured output** — the HUD shows avg speed, number of braking cars, jam length and the fitted
  **wave speed** (negative = moving backwards through the queue), plus the same sign convention
  as the smoke test.

The road is a 1200 m ring, so the queue is always fully populated and the simulation can run
indefinitely.

## Controls

In the HUD (keys in brackets):

- **Brake (pace car)** — `Space`: inject the wave.
- **Reset** — `R`: new randomised traffic at the current density.
- **Pause** — `P`: freeze/continue the simulation (camera still usable).
- **Density** slider — 15–120: number of follower cars (more = closer headways, more jams).
- **Reaction delay** slider — 0–1.6 s: response lag; higher delay → slower, longer-lasting wave.
- **Time scale** slider — 0.1–3×: slow motion to watch the wave front propagate.
- **Brake trails** / **Speed arrows** checkboxes — toggle the visual aids.
- Mouse: drag to orbit, scroll to zoom.

## Run

```sh
pnpm install && pnpm dev
```

Vite binds **0.0.0.0:4317** (strict port), so open <http://localhost:4317> — or the machine's LAN
address from another device.

Production build / preview: `pnpm build` then `pnpm preview` (also 0.0.0.0:4317).

## Headless smoke test (optional)

No browser or three.js needed — verifies the wave really propagates backwards and that delay makes
it slower:

```sh
node --experimental-strip-types scripts/smoke.ts
```

It runs the sim for a while, triggers a pace-car brake, and checks that the fitted wave speed is
negative, that several cars are hit, that the wave front moves backwards, that a 0.9 s delay yields
a slower wave than 0.2 s, and that no cars overlap. Prints `PASS`/`FAIL` per check and
`WAVE_OK=yes|no` (exit code 1 on failure).

## Layout

```
index.html        HUD, sliders, legend
src/sim.ts        IDM ring-road simulation, reaction delay, wave-speed fit
src/scene.ts      three.js rendering, colours, trails, arrows, stats
src/main.ts       wiring between HUD and sim/scene
scripts/smoke.ts  headless wave check
```
