import { clockSeconds } from "./game-clock.mjs";

// 効果音: the 設定 sheet's 音 switch and the short sounds it allows. They are
// made with Web Audio, so there are no sound files, no licences and nothing
// for the CSP to allow. The switch starts off: someone playing in public
// hears nothing until they turn it on. On an iPhone Web Audio also follows
// the silent switch, which is left as it is.
// Each sound has a name; play(name) is all other code calls. A louder mode
// (ドパガキモード) passes a getter that picks its own voices for the same names.
// The browser keeps audio blocked until the page is tapped, so the context is
// made, or resumed, inside the first tap or key press after the switch is on.
const SOUND_KEY = "miego-sound";
const stored = key => { try { return localStorage.getItem(key); } catch { return null; } };
const store = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
const COUNTDOWN_FROM = 10;
const COUNTDOWN_LAST = 5;

/** The sound for a move from `before` to `after`: "end" when it ends the game, null for a pass. */
export function moveSound(before, after, position) {
  if (before?.status !== "finished" && after?.status === "finished") return "end";
  if (!Number.isInteger(position)) return null;
  const taken = state => (state?.captures?.black || 0) + (state?.captures?.white || 0);
  return taken(after) > taken(before) ? "capture" : "move";
}

/** The 秒読み beep for a clock reading: the last 10 seconds, higher in the last 5. */
export function countdownSound(reading) {
  if (!reading || reading.out) return null;
  const seconds = clockSeconds(reading.left);
  if (seconds < 1 || seconds > COUNTDOWN_FROM) return null;
  return seconds <= COUNTDOWN_LAST ? "countdownLast" : "countdown";
}

// A short burst of noise through a band-pass filter: the click of a stone on wood.
function knock(ctx, out, at, { frequency, gain, length }) {
  const source = ctx.createBufferSource();
  source.buffer = noise(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = frequency;
  filter.Q.value = 4;
  const level = ctx.createGain();
  level.gain.setValueAtTime(gain, at);
  level.gain.exponentialRampToValueAtTime(.001, at + length);
  source.connect(filter).connect(level).connect(out);
  source.start(at);
  source.stop(at + length);
}
function tone(ctx, out, at, { frequency, gain, length }) {
  const oscillator = ctx.createOscillator();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  const level = ctx.createGain();
  level.gain.setValueAtTime(.0001, at);
  level.gain.linearRampToValueAtTime(gain, at + .005);
  level.gain.exponentialRampToValueAtTime(.0001, at + length);
  oscillator.connect(level).connect(out);
  oscillator.start(at);
  oscillator.stop(at + length);
}
const noises = new WeakMap();
function noise(ctx) {
  if (!noises.has(ctx)) {
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * .1), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noises.set(ctx, buffer);
  }
  return noises.get(ctx);
}

/** The calm default sounds, each drawn at time `at` into `out`. */
export const CALM_VOICES = {
  capture(ctx, out, at) {
    knock(ctx, out, at, { frequency: 1400, gain: .5, length: .07 });
    knock(ctx, out, at + .07, { frequency: 3200, gain: .18, length: .04 });
    knock(ctx, out, at + .12, { frequency: 3600, gain: .12, length: .04 });
  },
  countdown(ctx, out, at) { tone(ctx, out, at, { frequency: 880, gain: .12, length: .09 }); },
  countdownLast(ctx, out, at) { tone(ctx, out, at, { frequency: 1320, gain: .14, length: .09 }); },
  end(ctx, out, at) {
    tone(ctx, out, at, { frequency: 523.25, gain: .1, length: .7 });
    tone(ctx, out, at + .12, { frequency: 783.99, gain: .08, length: .7 });
  },
  move(ctx, out, at) { knock(ctx, out, at, { frequency: 1400, gain: .5, length: .07 }); },
};

// C major from C5 up: the notes ドパガキモード climbs through.
const SCALE = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51];
/** ドパガキモード's louder sounds: a capture rings one rising note per stone taken (up to 8), a win plays a fanfare. */
export const DOPA_VOICES = {
  ...CALM_VOICES,
  capture(ctx, out, at, { count = 1 } = {}) {
    CALM_VOICES.capture(ctx, out, at);
    const notes = Math.max(1, Math.min(SCALE.length, count));
    for (let i = 0; i < notes; i++)
      tone(ctx, out, at + .05 + i * .06, { frequency: SCALE[i], gain: .12, length: .18 });
  },
  end(ctx, out, at) {
    [0, 2, 3, 5].forEach((note, i) => tone(ctx, out, at + i * .11, { frequency: SCALE[note], gain: .13, length: .35 }));
    for (const note of [0, 2, 3, 5]) tone(ctx, out, at + .5, { frequency: SCALE[note], gain: .08, length: 1.1 });
  },
};

/** `voices` is a set of voices, or a getter read at each play (so a mode can switch them). */
export function createSoundEffects({ $, voices = CALM_VOICES, AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext, target = globalThis }) {
  let enabled = stored(SOUND_KEY) === "on";
  let ctx = null;
  const toggle = $("soundEffects");
  toggle.checked = enabled;
  // Made or resumed only inside a tap or key press; null where Web Audio is missing.
  function wake() {
    if (!enabled || !AudioContextClass) return null;
    try {
      ctx ??= new AudioContextClass({ latencyHint: "interactive" });
      if (ctx.state !== "running") ctx.resume?.()?.catch?.(() => {});
    } catch { ctx = null; }
    return ctx;
  }
  const primer = () => { wake(); };
  for (const type of ["pointerdown", "keydown"]) target.addEventListener?.(type, primer, { capture: true });
  function setEnabled(on) {
    enabled = !!on;
    toggle.checked = enabled;
    store(SOUND_KEY, enabled ? "on" : "off");
  }
  toggle.onchange = e => {
    setEnabled(e.target.checked);
    // Turning it on is a tap, so the sound can be heard right away.
    if (enabled) { wake(); play("move"); }
  };
  $("resetAppearance").addEventListener?.("click", () => setEnabled(false));
  function play(name, detail) {
    const voice = (typeof voices === "function" ? voices() : voices)?.[name];
    if (!enabled || !voice) return;
    // Only a tap makes the context, so a COM's move before any tap stays quiet.
    const context = ctx;
    if (!context) return;
    const draw = () => { try { voice(context, context.destination, context.currentTime, detail); } catch {} };
    if (context.state === "running") draw();
    // Safari can still be starting the context it made inside this tap; a
    // sound that would come late is dropped.
    else if (context.state === "suspended") {
      const asked = Date.now();
      context.resume?.()?.then?.(() => { if (enabled && context.state === "running" && Date.now() - asked < 300) draw(); }, () => {});
    }
  }
  return { enabled: () => enabled, play };
}
