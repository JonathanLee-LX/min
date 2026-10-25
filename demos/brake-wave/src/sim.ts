/**
 * Single-lane traffic simulation: IDM car-following with a per-car reaction
 * delay (each car acts on its *remembered* view of the gap to the car ahead).
 *
 * The road is a ring, so the queue is always fully populated. A "pace car"
 * (index 0) is the wave trigger: it brakes hard on demand and the braking
 * propagates backwards through the line of followers — a brake wave / phantom
 * jam.
 *
 * Key regimes (see README):
 *  - Idle/cruise  : all cars flow freely at v0.
 *  - Brake wave   : one hard brake is amplified downstream and travels backwards;
 *                   cars briefly stop and then recover (delay low/moderate).
 *  - Phantom jam  : gridlock. The line's own instabilities plus delayed reaction
 *                   keep the jam alive with no external cause; speed drops to
 *                   crawl and stop-and-go waves persist.
 *  - ACC on       : every follower uses Adaptive Cruise Control (near-zero sensor
 *                   lag + calmer headway). Brake waves damp instead of amplifying.
 */

export const ROAD_LENGTH = 1200; // metres
export const CAR_LENGTH = 4.4; // metres

export interface SimParams {
  /** number of follower cars (excluding the pace car at index 0) */
  carCount: number;
  /** human reaction delay in seconds (ignored for followers when ACC is on) */
  reactionDelay: number;
  /** global driver aggressiveness / anticipation (1 = calm, <1 = twitchy) */
  caution: number;
  /**
   * When true, every follower runs Adaptive Cruise Control:
   * near-instant sensing (~50 ms) and a slightly longer time-headway.
   * The pace car still injects manual hard brakes as the disturbance source.
   */
  accEnabled: boolean;
}

interface Sample {
  t: number;
  gap: number;
  dv: number;
}

export class Car {
  id: number;
  s: number; // front bumper position, metres (wrapped to [0, ROAD_LENGTH))
  v: number; // speed, m/s
  a = 0; // last acceleration, m/s^2
  length = CAR_LENGTH;
  history: Sample[] = [];
  /** 0..1, smoothed hard-deceleration indicator for visuals */
  brakeLight = 0;
  isPace = false;
  brakeUntil = 0;
  /** exponential-moving average of |dv|, used for metrics */
  perceivedDv = 0;
  /** sim time at which this car first reacted (hard decel) to a brake wave, or -1 */
  waveRespondedAt = -1;
  /** front-bumper position when the car reacted to the wave */
  waveResponseS = 0;

  constructor(id: number, s: number, v: number, delay: number) {
    this.id = id;
    this.s = s;
    this.v = v;
    for (let t = -delay; t <= 0; t += 1 / 60) {
      this.history.push({ t, gap: 40, dv: 0 });
    }
  }
}

export interface SimStats {
  avgSpeed: number; // m/s over follower cars
  minSpeed: number;
  brakingCount: number;
  jamLength: number; // metres of contiguous slow cars
  waveSpeed: number; // m/s, negative = backwards
  elapsed: number;
}

export class TrafficSim {
  time = 0;
  cars: Car[] = []; // 0 = pace car, then followers; cars[i-1] leads cars[i]
  params: SimParams;

  // IDM parameters (per driver, jittered on reset)
  readonly v0base = 30; // desired speed m/s (108 km/h)
  readonly Tbase = 1.0; // desired time headway, s
  readonly aMaxBase = 2.0;
  readonly bComfBase = 3.0;
  readonly bHard = 9.0;
  readonly s0 = 2.0;

  private v0s: number[] = [];
  private Tn: number[] = [];

  jamLength = 0;
  /** measured brake-wave speed in m/s: negative = travelling backwards down the queue */
  waveSpeed = 0;
  /** signed distance the wave front has travelled since the last trigger (metres) */
  waveTravel = 0;
  /** number of follower cars that have reacted to the current wave */
  waveCars = 0;
  /** speed drop (m/s) below which a car counts as "hit" by the wave */
  readonly waveDropThreshold = 6;
  private waveFitted = 0;
  private waveArmed = false;

  /** Sensor lag used by ACC (seconds) — far smaller than human reaction delay. */
  readonly accSensorLag = 0.05;

  constructor(params?: Partial<SimParams>) {
    this.params = {
      carCount: clampInt(params?.carCount ?? 30, 4, 140),
      reactionDelay: params?.reactionDelay ?? 0.55,
      caution: params?.caution ?? 1,
      accEnabled: params?.accEnabled ?? false,
    };
    this.reset();
  }

  /** Effective perception delay for a follower (ACC overrides human delay). */
  effectiveDelay(): number {
    return this.params.accEnabled ? this.accSensorLag : this.params.reactionDelay;
  }

  // ---------------------------------------------------------------- setup
  /** Build a fresh, fully-populated ring. */
  reset(): void {
    this.time = 0;
    this.waveFitted = 0;
    this.waveSpeed = 0;
    this.waveTravel = 0;
    this.waveCars = 0;
    this.waveArmed = false;
    this.jamLength = 0;

    const n = this.params.carCount;
    const spacing = ROAD_LENGTH / (n + 1);
    const pace = new Car(0, ROAD_LENGTH * 0.5, this.v0base, this.params.reactionDelay);
    pace.isPace = true;
    this.cars = [pace];
    this.v0s = [this.v0base];
    this.Tn = [this.Tbase];

    for (let i = 1; i <= n; i++) {
      const delay = this.params.reactionDelay;
      const car = new Car(i, wrap(pace.s - spacing * i), this.v0base * (0.92 + Math.random() * 0.08), delay);
      this.cars.push(car);
      this.v0s.push(this.v0base * (0.9 + Math.random() * 0.2));
      this.Tn.push(this.Tbase * (0.8 + Math.random() * 0.5));
    }
  }

  /** Duration of the pace car's hard brake */
  private readonly brakeDuration = 3.0;

  /**
   * Start a hard brake on the pace car. This is what injects the wave: the
   * follower directly behind it must first *see* the brake (reaction delay),
   * then its own follower, and so on — so the wave front travels backwards
   * through the queue at a finite speed.
   */
  triggerBrake(duration = this.brakeDuration): void {
    this.cars[0].brakeUntil = this.time + duration;
    for (const car of this.cars) car.waveRespondedAt = -1;
    this.waveFitted = 0;
    this.waveSpeed = 0;
    this.waveTravel = 0;
    this.waveCars = 0;
    this.waveArmed = true;
  }

  /** Cruise speed used by the renderer to normalise colours / arrows. */
  get v0(): number {
    return this.v0base;
  }

  /** Re-space the queue for a new density; speeds/gaps are preserved as far as possible. */
  setCarCount(n: number): void {
    n = clampInt(n, 4, 140);
    if (n === this.params.carCount) return;
    const old = this.cars;
    const pace = old[0];
    const spacing = ROAD_LENGTH / (n + 1);
    this.params.carCount = n;
    this.cars = [pace];
    this.v0s = [this.v0base];
    this.Tn = [this.Tbase];
    for (let i = 1; i <= n; i++) {
      const src = old[1 + Math.floor(((i - 1) * (old.length - 1)) / n)];
      const v = src ? Math.max(6, src.v) : this.v0base;
      const car = new Car(i, wrap(pace.s - spacing * i), v, this.params.reactionDelay);
      this.cars.push(car);
      this.v0s.push(src ? this.v0base : this.v0base);
      this.Tn.push(this.Tbase * (0.8 + Math.random() * 0.5));
    }
  }

  // ---------------------------------------------------------------- stepping
  step(dt: number): void {
    const maxSub = 1 / 60;
    let remaining = Math.min(dt, 0.2);
    while (remaining > 1e-6) {
      const h = Math.min(maxSub, remaining);
      this.substep(h);
      remaining -= h;
    }
  }

  private gapTo(leader: Car, follower: Car): number {
    return mod(leader.s - follower.s, ROAD_LENGTH) - leader.length;
  }

  private substep(dt: number): void {
    this.time += dt;
    const cars = this.cars;
    const delay = this.effectiveDelay();
    const acc = new Float64Array(cars.length);

    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];

      if (car.isPace) {
        // Pace car: hard brake when triggered; otherwise cruise (ACC does not
        // take over the disturbance injector so the wave source stays clear).
        acc[i] =
          this.time < car.brakeUntil ? -this.bHard : clamp((this.v0base - car.v) * 0.8, -this.bHard, 1.5);
        continue;
      }

      const leader = cars[i - 1];
      // Record the *true* current state; the driver / ACC uses it after `delay`.
      car.history.push({ t: this.time, gap: this.gapTo(leader, car), dv: car.v - leader.v });
      while (car.history.length > 2 && this.time - car.history[0].t > delay + 1.5) {
        car.history.shift();
      }

      const obs = this.lookup(car, this.time - delay);
      car.perceivedDv = car.perceivedDv * Math.exp(-dt * 1.5) + Math.abs(obs.dv) * (1 - Math.exp(-dt * 1.5));
      acc[i] = this.idm(i, car.v, obs.gap, obs.dv);

      // Wave diagnostic: a car "joins" the wave once it decelerates hard, i.e.
      // once the brake information has actually reached it.
      if (this.waveArmed && car.waveRespondedAt < 0 && acc[i] < -this.bComfBase * 0.75) {
        car.waveRespondedAt = this.time;
        car.waveResponseS = car.s;
      }
    }

    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      car.a = acc[i];
      car.v = Math.max(0, car.v + car.a * dt);
      car.s = wrap(car.s + car.v * dt);

      // Brake light: fast attack, slower release. Also lights when the driver
      // is *about* to brake (negative accel from delayed info).
      const decel = Math.max(0, -car.a);
      const target = decel < 0.3 ? 0 : Math.min(1, decel / this.bHard);
      const rate = target > car.brakeLight ? 14 : 3.5;
      car.brakeLight += (target - car.brakeLight) * (1 - Math.exp(-dt * rate));
    }

    // Safety net: hard non-overlap. Only triggers on numerical edge cases and
    // adds realism (cars cannot pass through each other).
    for (let i = 1; i < cars.length; i++) {
      const leader = cars[i - 1];
      const car = cars[i];
      const gap = this.gapTo(leader, car);
      if (gap < 0.05) {
        car.s = wrap(leader.s - leader.length - 0.05);
        car.v = Math.min(car.v, leader.v);
      }
    }
    // Tail-gate the ring: car 0 is led by the last car.
    if (cars.length > 1) {
      const last = cars[cars.length - 1];
      const pace = cars[0];
      if (this.gapTo(last, pace) < 0.05) {
        pace.s = wrap(last.s - last.length - 0.05);
        pace.v = Math.min(pace.v, last.v);
      }
    }

    this.updateMetrics(dt);
  }

  private lookup(car: Car, t: number): Sample {
    const h = car.history;
    if (h.length === 0) return { t, gap: 40, dv: 0 };
    if (t >= h[h.length - 1].t) return h[h.length - 1];
    for (let k = h.length - 1; k > 0; k--) {
      if (h[k - 1].t <= t) {
        const a = h[k - 1];
        const b = h[k];
        const u = b.t - a.t > 1e-9 ? (t - a.t) / (b.t - a.t) : 0;
        return { t, gap: a.gap + (b.gap - a.gap) * u, dv: a.dv + (b.dv - a.dv) * u };
      }
    }
    return h[0];
  }

  /** Intelligent Driver Model (human or ACC-tuned). */
  private idm(i: number, v: number, gap: number, dv: number): number {
    const v0 = this.v0s[i];
    // ACC keeps a bit more time-headway and softer accel — damps stop-and-go.
    const T =
      this.Tn[i] * this.params.caution * (this.params.accEnabled ? 1.25 : 1);
    const a = this.params.accEnabled ? this.aMaxBase * 0.75 : this.aMaxBase;
    const b = this.params.accEnabled ? this.bComfBase * 1.15 : this.bComfBase;
    const free = 1 - Math.pow(Math.max(0, v) / v0, 4);
    const sStar = this.s0 + Math.max(0, v * T + (v * dv) / (2 * Math.sqrt(a * b)));
    const g = Math.max(0.2, gap);
    const interaction = sStar / g;
    const out = a * (free - interaction * interaction);
    return clamp(out, -this.bHard, a);
  }

  private updateMetrics(dt: number): void {
    const cars = this.cars;

    // Jam = contiguous run (in queue order) of cars slower than 8 m/s.
    let jam = 0;
    let runStart = -1;
    let bestStart = -1;
    let bestLen = 0;
    for (let i = 1; i < cars.length; i++) {
      if (cars[i].v < 8) {
        if (runStart < 0) runStart = i;
        const len = i - runStart + 1;
        if (len > bestLen) {
          bestLen = len;
          bestStart = runStart;
        }
      } else {
        runStart = -1;
      }
    }
    if (bestStart >= 0 && bestLen > 1) {
      const rear = cars[bestStart + bestLen - 1];
      const front = cars[bestStart];
      jam = mod(front.s - rear.s, ROAD_LENGTH) + front.length;
    }
    this.jamLength += (jam - this.jamLength) * (1 - Math.exp(-dt * 2));

    this.updateWaveSpeed();
  }

  /**
   * Brake-wave speed estimator.
   *
   * Every follower records the time and position at which the brake
   * information actually reached it (hard deceleration after a trigger):
   *   (s_i, t_i)  for car i = 1, 2, 3, ...
   * Because each driver waits `reactionDelay` before acting, t_i grows with i
   * while s_i decreases (cars sit further back the further down the queue).
   * A least-squares fit of s on t over all cars hit so far gives the wave
   * speed ds/dt: NEGATIVE means the brake wave runs backwards through the
   * queue, even though every car is still moving forwards.
   */
  private updateWaveSpeed(): void {
    const cars = this.cars;
    const pts: { t: number; s: number }[] = [];
    let travel = 0;
    for (let i = 1; i < cars.length; i++) {
      const c = cars[i];
      if (c.waveRespondedAt >= 0) {
        pts.push({ t: c.waveRespondedAt, s: c.waveResponseS });
        travel += i === 1 ? 0 : unwrapDelta(c.waveResponseS - cars[i - 1].waveResponseS);
      }
    }
    this.waveCars = pts.length;
    this.waveTravel = travel;
    if (pts.length < 3) {
      if (!this.waveArmed) this.waveSpeed *= 0.995;
      return;
    }
    if (this.time - pts[pts.length - 1].t > 2.5) return; // wave died out: hold last value

    let st = 0;
    let ss = 0;
    for (const p of pts) {
      st += p.t;
      ss += p.s;
    }
    const mt = st / pts.length;
    const ms = ss / pts.length;
    let num = 0;
    let den = 0;
    for (const p of pts) {
      num += (p.t - mt) * (p.s - ms);
      den += (p.t - mt) * (p.t - mt);
    }
    if (den > 1e-6) {
      const slope = num / den;
      this.waveFitted += (slope - this.waveFitted) * 0.4;
      this.waveSpeed = this.waveFitted;
    }
  }

  stats(): SimStats {
    let sum = 0;
    let min = Infinity;
    let braking = 0;
    for (let i = 1; i < this.cars.length; i++) {
      const c = this.cars[i];
      sum += c.v;
      min = Math.min(min, c.v);
      if (c.brakeLight > 0.35 || c.a < -1.2) braking++;
    }
    const n = Math.max(1, this.cars.length - 1);
    return {
      avgSpeed: sum / n,
      minSpeed: min === Infinity ? 0 : min,
      brakingCount: braking,
      jamLength: this.jamLength,
      waveSpeed: this.waveSpeed,
      elapsed: this.time,
    };
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function clampInt(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(x)));
}

/** Shortest signed difference a - b on the ring (metres). */
function unwrapDelta(d: number): number {
  if (d > ROAD_LENGTH / 2) return d - ROAD_LENGTH;
  if (d < -ROAD_LENGTH / 2) return d + ROAD_LENGTH;
  return d;
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

function wrap(a: number): number {
  return mod(a, ROAD_LENGTH);
}
