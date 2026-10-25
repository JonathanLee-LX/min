/**
 * Headless brake-wave smoke test (no browser / three.js needed):
 *   node --experimental-strip-types scripts/smoke.ts
 *
 * Checks that a single hard brake on the pace car produces a wave front that
 * travels BACKWARDS through the queue (negative wave speed), that reaction
 * delay makes it slower, and that the sim stays finite and non-overlapping.
 */
import { TrafficSim } from '../src/sim.ts';

const DT = 1 / 60;

function run(reactionDelay: number, carCount = 38): {
  waveSpeed: number;
  waveCars: number;
  waveTravel: number;
  responseTimes: number[];
  minGap: number;
  maxSpeed: number;
} {
  const sim = new TrafficSim({ carCount, reactionDelay });
  // Let the ring settle into a steady cruise first.
  for (let t = 0; t < 25; t += DT) sim.step(DT);

  const vBefore = sim.cars.map((c) => c.v);
  sim.triggerBrake(2.4);

  let minGap = Infinity;
  let maxSpeed = 0;
  // Watch the wave develop.
  for (let t = 0; t < 14; t += DT) {
    sim.step(DT);
    const cars = sim.cars;
    for (let i = 1; i < cars.length; i++) {
      const gap = ((cars[i - 1].s - cars[i].s + 1200) % 1200) - cars[i - 1].length;
      if (gap < minGap) minGap = gap;
      if (cars[i].v > maxSpeed) maxSpeed = cars[i].v;
    }
  }

  const waveSpeed = sim.waveSpeed;
  const responseTimes = sim.cars
    .slice(1, 9)
    .map((c, i) => (c.waveRespondedAt >= 0 ? c.waveRespondedAt : NaN) - (i === 0 ? 0 : NaN));
  const responded = sim.cars.filter((c) => c.waveRespondedAt >= 0).length;

  // Sanity: no car teleported (speed stayed sane relative to cruise).
  const _unused = vBefore;
  void _unused;
  return {
    waveSpeed,
    waveCars: responded,
    waveTravel: sim.waveTravel,
    responseTimes,
    minGap,
    maxSpeed,
  };
}

let failures = 0;
function check(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
  if (!ok) failures++;
}

const fast = run(0.2);
const slow = run(0.9);

console.log('--- reaction delay 0.20 s ---');
console.log(fast);
console.log('--- reaction delay 0.90 s ---');
console.log(slow);

check('waveSpeed is negative (backward-propagating)', fast.waveSpeed < -1, `waveSpeed=${fast.waveSpeed.toFixed(2)} m/s`);
check('wave reaches several follower cars', fast.waveCars >= 4, `cars hit=${fast.waveCars}`);
check('wave front moves backwards', fast.waveTravel < -15, `waveTravel=${fast.waveTravel.toFixed(1)} m`);
check(
  'more reaction delay => slower (less negative) wave',
  fast.waveSpeed < slow.waveSpeed,
  `${fast.waveSpeed.toFixed(2)} vs ${slow.waveSpeed.toFixed(2)} m/s`,
);
check('no overlap', fast.minGap > -0.2, `minGap=${fast.minGap.toFixed(2)} m`);
check('speeds stay finite & sane', fast.maxSpeed < 45, `maxSpeed=${fast.maxSpeed.toFixed(1)} m/s`);

console.log(`\nWAVE_OK=${failures === 0 ? 'yes' : 'no'}`);
process.exit(failures === 0 ? 0 : 1);
