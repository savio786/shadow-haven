// Small synthesized sounds (no audio files): a bell, a snuff, a chime, a tick.
// Built with the Web Audio API on first use. Players can mute; it's remembered.

let ctx = null;
let muted = false;
try { muted = localStorage.getItem("sh.muted") === "1"; } catch {}

function audio() {
  if (muted) return null;
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  } catch { return null; }
}

export function isMuted() { return muted; }
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem("sh.muted", m ? "1" : "0"); } catch {}
}

function tone(a, freq, start, dur, gain, type = "sine") {
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(a.destination);
  o.start(start);
  o.stop(start + dur + 0.05);
}

export const sfx = {
  /** A harbor bell: a few inharmonic partials ringing out. */
  bell() {
    const a = audio(); if (!a) return;
    const t = a.currentTime;
    for (const [i, delay] of [[0, 0], [1, 0.9]]) {
      const s = t + delay;
      tone(a, 330, s, 2.6, 0.22);
      tone(a, 330 * 2.0, s, 1.8, 0.10);
      tone(a, 330 * 2.76, s, 1.2, 0.07);
      tone(a, 330 * 5.4, s, 0.6, 0.03);
      void i;
    }
  },
  /** A lantern snuffed: a soft breath of noise falling away. */
  snuff() {
    const a = audio(); if (!a) return;
    const t = a.currentTime;
    const buf = a.createBuffer(1, a.sampleRate * 0.8, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = a.createBufferSource();
    src.buffer = buf;
    const f = a.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(1800, t);
    f.frequency.exponentialRampToValueAtTime(120, t + 0.7);
    const g = a.createGain();
    g.gain.value = 0.35;
    src.connect(f).connect(g).connect(a.destination);
    src.start(t);
  },
  /** A gentle chime for a verdict or a good moment. */
  chime(up = true) {
    const a = audio(); if (!a) return;
    const t = a.currentTime;
    const notes = up ? [523, 659, 784] : [523, 415, 330];
    notes.forEach((f, i) => tone(a, f, t + i * 0.14, 0.9, 0.09, "triangle"));
  },
  /** The tiniest tick: a chat line or a vote landing. */
  tick() {
    const a = audio(); if (!a) return;
    tone(a, 1200, a.currentTime, 0.06, 0.04, "square");
  },
};

/** A short buzz on phones that support it. */
export function buzz(pattern) {
  if (muted) return;
  try { navigator.vibrate?.(pattern); } catch {}
}
