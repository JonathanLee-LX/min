/**
 * Headless ACC probe (no browser / three.js needed):
 *   node --experimental-strip-types scripts/acc-probe.ts
 *
 * Runs the same pace-car brake with ACC off and on and checks that ACC damps
 * the brake wave: fewer follower cars get dragged into hard braking, the
 * minimum follower speed stays higher, and the pace car still hard-brakes
 * (ACC never takes over the disturbance source).
 */
import { TrafficSim } from '../src/sim.ts';

const DT = 1 / 60;

interface Result {
  acc: boolean;
  waveCars: number;
  minSpeed: number;
  avgSpeedKmh: number;
  paceBrakeApplied: boolean;
  paceIsAcc: boolean;
  minGap: number;
}

function run(acc: boolean, carCount = 38, reactionDelay = 0.7): Result {
  const sim = new TrafficSim({ carCount, reactionDelay, acc });
  // Settle into a steady cruise first.
  for (let t = 0; t < 25; t += DT) sim.step(DT);

  sim.triggerBrake(2.4);
  const pace = sim.cars[0];
  const paceBrakeApplied = pace.brakeUntil >= sim.time + 2.3 && !pace.acc;

  let minSpeed = Infinity;
  let sum = 0;
  let n = 0;
  let minGap = Infinity;
  for (let t = 0; t < 14; t += DT) {
    sim.step(DT);
    const cars = sim.cars;
    for (let i = 1; i < cars.length; i++) {
      minSpeed = Math.min(minSpeed, cars[i].v);
      sum += cars[i].v;
      n++;
      const gap = ((cars[i - 1].s - cars[i].s + 1200) % 1200) - cars[i - 1].length;
      minGap = Math.min(minGap, gap);
    }
  }

  return {
    acc,
    waveCars: sim.waveCars,
    minSpeed,
    avgSpeedKmh: (sum / n) * 3.6,
    paceBrakeApplied,
    paceIsAcc: pace.acc,
    minGap,
  };
}

let failures = 0;
function check(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
  if (!ok) failures++;
}

const off = run(false);
const on = run(true);

const fmt = (r: Result) =>
  `acc=${r.acc} waveCars=${r.waveCars} minSpeed=${r.minSpeed.toFixed(2)} m/s ` +
  `avg=${r.avgSpeedKmh.toFixed(1)} km/h minGap=${r.minGap.toFixed(2)} m`;
console.log('--- ACC off ---\n' + fmt(off));
console.log('--- ACC on  ---\n' + fmt(on));

check(
  'ACC: fewer cars pulled into the wave',
  on.waveCars < off.waveCars,
  `${off.waveCars} -> ${on.waveCars} cars`,
);
check(
  'ACC: higher minimum follower speed',
  on.minSpeed > off.minSpeed,
  `${off.minSpeed.toFixed(2)} -> ${on.minSpeed.toFixed(2)} m/s`,
);
check('Pace car still hard-brakes with ACC on', on.paceBrakeApplied, `brakeUntil=${on.paceBrakeApplied}`);
check('Pace car is not ACC', on.paceIsAcc === false, `paceIsAcc=${on.paceIsAcc}`);
check('ACC: no overlap', on.minGap > -0.2, `minGap=${on.minGap.toFixed(2)} m`);

console.log(`\nACC_OK=${failures === 0 ? 'yes' : 'no'}`);
process.exit(failures === 0 ? 0 : 1);
