'use strict';

const MODES = {
  oct:  [0],
  '5th': [0, 7],
  maj:  [0, 4, 7],
  min:  [0, 3, 7],
  dom7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  dim7: [0, 3, 6, 9],
};

const HUE = [195, 55, 280, 340, 20];

let S = {
  n: 12, spd: 0.4, minF: 25, maxF: 7040, bell: 1.5, vol: 0.45, mode: 'dim7', phase: 0, drift: 0,
};

let ax = null, mg = null;
let oscs = [];
let ph = 0;
let running = false, prevTs = null, raf = null;
let fading = false, fadeTimer = null;

function initAudio() {
  if (!ax) { ax = new AudioContext(); mg = ax.createGain(); mg.connect(ax.destination); }
  if (ax.state === 'suspended') ax.resume();
}

function scheduleFade(toVol, durationSec, fromVol = null) {
  if (fadeTimer) clearTimeout(fadeTimer);
  fading = true;
  mg.gain.cancelScheduledValues(ax.currentTime);
  mg.gain.setValueAtTime(fromVol ?? mg.gain.value, ax.currentTime);
  mg.gain.linearRampToValueAtTime(toVol, ax.currentTime + durationSec);
  fadeTimer = setTimeout(() => { fading = false; }, durationSec * 1000 + 100);
}

function makeWave(k) {
  const t   = ax.currentTime;
  const mod = S.drift > 0
    ? Math.sin(2 * Math.PI * S.drift * t + k * 2 * Math.PI / S.n)
    : k / S.n;
  const phi = S.phase * 2 * Math.PI * mod;
  return ax.createPeriodicWave(
    new Float32Array([0, Math.sin(phi)]),
    new Float32Array([0, Math.cos(phi)])
  );
}

function applyPhase() {
  oscs.forEach(({ osc, k }) => osc.setPeriodicWave(makeWave(k)));
}

function rebuild() {
  oscs.forEach(o => { try { o.osc.stop(); } catch(_){} o.osc.disconnect(); o.gain.disconnect(); });
  oscs = [];
  viz.querySelectorAll('.dot').forEach(el => el.remove());

  const dotSize = Math.min(viz.clientWidth / S.n / 1.6, viz.clientHeight * 0.28) * 1.25;

  MODES[S.mode].forEach((_, v) => {
    for (let k = 0; k < S.n; k++) {
      const osc = ax.createOscillator(), g = ax.createGain();
      g.gain.value = 0;
      osc.setPeriodicWave(makeWave(k));
      osc.connect(g); g.connect(mg); osc.start();

      const el = document.createElement('div');
      el.className = 'dot';
      el.style.setProperty('--hue', HUE[v % HUE.length]);
      el.style.width = el.style.height = dotSize + 'px';
      el.style.left = ((k + 0.5) / S.n * 100).toFixed(2) + '%';
      const label = document.createElement('span');
      el.appendChild(label);
      viz.appendChild(el);

      oscs.push({ osc, gain: g, k, v, el, label });
    }
  });

  rebuildGrid();
}

function rebuildGrid() {
  viz.querySelectorAll('hr').forEach(el => el.remove());
  const R = Math.log2(S.maxF / S.minF);
  for (let i = 1; i < Math.ceil(R); i++) {
    const f = S.minF * 2 ** i;
    if (f >= S.maxF) break;
    const hr = document.createElement('hr');
    hr.style.top = ((1 - i / R) * 100).toFixed(2) + '%';
    viz.appendChild(hr);
  }
}

function fa(k, v) {
  const voices = MODES[S.mode];
  const R = Math.log2(S.maxF / S.minF);
  const raw = ph + k * (R / S.n) + voices[v] / 12;
  const pos = ((raw % R) + R) % R;
  const freq = S.minF * 2 ** pos;
  const lc = Math.log2(freq / Math.sqrt(S.minF * S.maxF));
  const amp = Math.exp(-0.5 * (lc / S.bell) ** 2);
  return { freq, amp };
}

function audioTick() {
  const t = ax.currentTime;
  const R = Math.log2(S.maxF / S.minF);
  const nv = MODES[S.mode].length;
  const activePerVoice = Math.max(1, S.bell * 2.507 * S.n / R);
  const norm = activePerVoice * nv;
  if (!fading) mg.gain.setTargetAtTime(S.vol, t, 0.03);
  oscs.forEach(({ osc, gain, k, v }) => {
    const { freq, amp } = fa(k, v);
    osc.frequency.setTargetAtTime(freq, t, 0.006);
    gain.gain.setTargetAtTime(amp / norm, t, 0.006);
  });
}

const viz = document.getElementById('viz');

function render() {
  const R = Math.log2(S.maxF / S.minF);
  oscs.forEach(({ k, v, el, label }) => {
    const { freq, amp } = fa(k, v);
    const pct = (1 - Math.log2(freq / S.minF) / R) * 100;
    el.style.top = pct.toFixed(2) + '%';
    el.style.setProperty('--amp', amp.toFixed(3));
    label.textContent = freq.toFixed(1) + 'Hz';
  });
}

function frame(ts) {
  if (!running) return;
  if (prevTs !== null) ph += (S.spd / 12) * (ts - prevTs) / 1000;
  prevTs = ts;
  audioTick();
  if (S.drift > 0) applyPhase();
  render();
  raf = requestAnimationFrame(frame);
}

const onBlur  = () => { if (ax && running) scheduleFade(0, 1); };
const onFocus = () => { if (ax && running) scheduleFade(S.vol, 1); };

document.addEventListener('visibilitychange', () => document.hidden ? onBlur() : onFocus());
window.addEventListener('blur',  onBlur);
window.addEventListener('focus', onFocus);

function bind(suffix, key, fmt, needRebuild) {
  const sl = document.getElementById('r' + suffix);
  const dl = document.getElementById('d' + suffix);
  sl.value = S[key];
  dl.textContent = fmt(S[key]);
  sl.addEventListener('input', () => {
    S[key] = parseFloat(sl.value);
    dl.textContent = fmt(S[key]);
    if (needRebuild && running) rebuild();
    else if ((key === 'minF' || key === 'maxF') && running) rebuildGrid();
  });
}

bind('N',     'n',     v => v,                                    true);
bind('Spd',   'spd',   v => (v >= 0 ? '+' : '') + v.toFixed(1), false);
bind('MinF',  'minF',  v => v,                                   false);
bind('MaxF',  'maxF',  v => v,                                   false);
bind('Bell',  'bell',  v => v.toFixed(1),                        false);
bind('Vol',   'vol',   v => v.toFixed(2),                        false);
bind('Phase', 'phase', v => v.toFixed(2),                        false);
document.getElementById('rPhase').addEventListener('input', () => { if (ax) applyPhase(); });
bind('Drift', 'drift', v => v.toFixed(2),                        false);

document.querySelector(`input[name=mode][value="${S.mode}"]`).checked = true;
document.querySelectorAll('input[name=mode]').forEach(radio => {
  radio.addEventListener('change', () => {
    S.mode = radio.value;
    if (running) rebuild();
  });
});

const btn = document.getElementById('btn');
btn.addEventListener('click', () => {
  if (!running) {
    initAudio();
    ph = 0; prevTs = null;
    rebuild();
    running = true;
    raf = requestAnimationFrame(frame);
    scheduleFade(S.vol, 1, 0);
    btn.textContent = 'STOP'; btn.classList.add('on');
  } else {
    running = false;
    cancelAnimationFrame(raf);
    oscs.forEach(o => { try { o.osc.stop(); } catch(_){} });
    oscs = [];
    viz.querySelectorAll('.dot, hr').forEach(el => el.remove());
    btn.textContent = 'START'; btn.classList.remove('on');
  }
});
