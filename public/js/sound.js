/**
 * Soundeffekte, synthetisch per WebAudio erzeugt (keine Audiodateien nötig).
 * Stummschaltung wird in localStorage gespeichert.
 */
import { storage } from './util.js';

let ctx = null;
let master = null;
let muted = storage.get('mono.muted', false);

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Browser erlauben Audio erst nach einer Nutzeraktion
window.addEventListener('pointerdown', () => ac(), { once: true });

function tone({ freq = 440, to = null, type = 'sine', dur = 0.15, gain = 0.2, delay = 0, attack = 0.005 }) {
  const c = ac();
  if (!c || muted) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise({ dur = 0.08, gain = 0.25, delay = 0, freq = 3000, q = 1.5, type = 'bandpass', sweepTo = null }) {
  const c = ac();
  if (!c || muted) return;
  const t = c.currentTime + delay;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  f.Q.value = q;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

export const sfx = {
  dice() {
    // Würfel klappern: unregelmäßige, leiser werdende Klicks
    let t = 0;
    for (let i = 0; i < 9; i++) {
      t += 0.04 + Math.random() * 0.08;
      noise({ dur: 0.035, gain: 0.5 * (1 - i / 11), delay: t, freq: 2200 + Math.random() * 2500, q: 3 });
    }
  },
  step() { tone({ freq: 680, type: 'triangle', dur: 0.05, gain: 0.05 }); },
  coin() {
    tone({ freq: 988, type: 'square', dur: 0.08, gain: 0.05 });
    tone({ freq: 1319, type: 'square', dur: 0.28, gain: 0.05, delay: 0.07 });
  },
  pay() {
    tone({ freq: 520, to: 330, type: 'triangle', dur: 0.22, gain: 0.1 });
  },
  buy() {
    [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.22, gain: 0.1, delay: i * 0.07 }));
  },
  build() {
    noise({ dur: 0.06, gain: 0.5, freq: 600, q: 4 });
    noise({ dur: 0.06, gain: 0.4, freq: 800, q: 4, delay: 0.11 });
  },
  jail() {
    tone({ freq: 220, to: 110, type: 'sawtooth', dur: 0.5, gain: 0.08 });
    noise({ dur: 0.35, gain: 0.35, freq: 5200, q: 8, delay: 0.05 });
    noise({ dur: 0.25, gain: 0.25, freq: 4300, q: 8, delay: 0.25 });
  },
  card() { noise({ dur: 0.35, gain: 0.25, freq: 800, sweepTo: 5000, q: 0.8 }); },
  turn() {
    tone({ freq: 784, type: 'sine', dur: 0.18, gain: 0.12 });
    tone({ freq: 1175, type: 'sine', dur: 0.3, gain: 0.1, delay: 0.12 });
  },
  bid() { tone({ freq: 1200, type: 'square', dur: 0.05, gain: 0.04 }); },
  error() { tone({ freq: 160, type: 'sawtooth', dur: 0.18, gain: 0.06 }); },
  chat() { tone({ freq: 900, to: 1300, type: 'sine', dur: 0.08, gain: 0.06 }); },
  bankrupt() {
    [392, 370, 349, 294].forEach((f, i) => tone({ freq: f, to: f * 0.97, type: 'sawtooth', dur: 0.4, gain: 0.06, delay: i * 0.35 }));
  },
  win() {
    const notes = [523, 659, 784, 1047, 784, 1047];
    notes.forEach((f, i) => tone({ freq: f, type: 'triangle', dur: i === notes.length - 1 ? 0.7 : 0.18, gain: 0.12, delay: i * 0.13 }));
  },
};

export const isMuted = () => muted;
export function setMuted(v) {
  muted = Boolean(v);
  storage.set('mono.muted', muted);
}
