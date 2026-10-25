import { SceneView } from './scene';
import { TrafficSim } from './sim';

const app = document.getElementById('app')!;
const sim = new TrafficSim();
const view = new SceneView(app, sim);

// ---- UI wiring ----------------------------------------------------------
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const btnBrake = $<HTMLButtonElement>('btn-brake');
const btnPause = $<HTMLButtonElement>('btn-pause');
const btnReset = $<HTMLButtonElement>('btn-reset');
const density = $<HTMLInputElement>('density');
const delay = $<HTMLInputElement>('delay');
const timeScale = $<HTMLInputElement>('time-scale');
const densityVal = $('density-val');
const delayVal = $('delay-val');
const timeVal = $('time-val');
const chkAcc = $<HTMLInputElement>('chk-acc');
const chkTrails = $<HTMLInputElement>('chk-trails');
const chkVectors = $<HTMLInputElement>('chk-vectors');
const delayRow = $('delay-row');
const accHint = $('acc-hint');

const statSpeed = $('stat-speed');
const statBraking = $('stat-braking');
const statJam = $('stat-jam');
const statWave = $('stat-wave');

let paused = false;
let needsRebuild = false;

function syncPauseLabel(): void {
  btnPause.textContent = paused ? 'Resume' : 'Pause';
  view.paused = paused;
}

function syncAccUi(): void {
  const on = chkAcc.checked;
  sim.params.accEnabled = on;
  delay.disabled = on;
  delayRow.classList.toggle('disabled', on);
  accHint.hidden = !on;
  delayVal.textContent = on
    ? `ACC ~${(sim.accSensorLag * 1000).toFixed(0)} ms`
    : `${Number(delay.value).toFixed(2)} s`;
}

function triggerBrake(): void {
  sim.triggerBrake(2.4);
  if (paused) {
    paused = false;
    syncPauseLabel();
  }
}

function reset(): void {
  sim.params.carCount = Number(density.value);
  sim.params.reactionDelay = Number(delay.value);
  sim.params.accEnabled = chkAcc.checked;
  sim.reset();
  needsRebuild = true;
  syncAccUi();
}

btnBrake.addEventListener('click', triggerBrake);
btnPause.addEventListener('click', () => {
  paused = !paused;
  syncPauseLabel();
});
btnReset.addEventListener('click', reset);

density.addEventListener('input', () => {
  densityVal.textContent = `${density.value} cars`;
  reset();
});

delay.addEventListener('input', () => {
  if (chkAcc.checked) return;
  sim.params.reactionDelay = Number(delay.value);
  delayVal.textContent = `${Number(delay.value).toFixed(2)} s`;
});

timeScale.addEventListener('input', () => {
  view.timeScale = Number(timeScale.value);
  timeVal.textContent = `${Number(timeScale.value).toFixed(1)}×`;
});

chkAcc.addEventListener('change', syncAccUi);
chkTrails.addEventListener('change', () => (view.showTrails = chkTrails.checked));
chkVectors.addEventListener('change', () => (view.showVectors = chkVectors.checked));

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const key = e.key.toLowerCase();
  if (e.code === 'Space' || key === 'b') {
    e.preventDefault();
    triggerBrake();
  } else if (key === 'a') {
    chkAcc.checked = !chkAcc.checked;
    syncAccUi();
  } else if (key === 'p') {
    paused = !paused;
    syncPauseLabel();
  } else if (key === 'r') {
    reset();
  }
});

view.onStats = (s) => {
  statSpeed.textContent = `${(s.avgSpeed * 3.6).toFixed(0)} km/h`;
  statBraking.textContent = `${s.brakingCount}`;
  statJam.textContent = `${s.jamLength.toFixed(0)} m`;
  const w = s.waveSpeed;
  const back = w < -0.3;
  statWave.textContent = Math.abs(w) < 0.3 ? '—' : `${Math.abs(w * 3.6).toFixed(0)} km/h ${back ? '◀ back' : '▶ fwd'}`;
  statWave.style.color = back ? '#ff6b5e' : '';
};

// Initialise labels + first rebuild, then start the loop.
densityVal.textContent = `${density.value} cars`;
timeVal.textContent = `${Number(timeScale.value).toFixed(1)}×`;
view.timeScale = Number(timeScale.value);
view.showTrails = chkTrails.checked;
view.showVectors = chkVectors.checked;
reset();
needsRebuild = false;
view.rebuildCars();
view.start();

// Renders triggered by density changes are handled by rebuilding once per frame
// if a reset slipped in while the loop was running.
setInterval(() => {
  if (needsRebuild) {
    needsRebuild = false;
    view.rebuildCars();
  }
}, 100);

// Kick off an automatic brake shortly after load so the wave is obvious.
setTimeout(triggerBrake, 2500);
