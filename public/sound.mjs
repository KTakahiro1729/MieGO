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
// A finger's pointerdown does not count as a tap (the HTML standard lets
// pointerup and touchend do that for touch), so those wake it too: otherwise,
// on a phone, a context suspended by a reload or by leaving the app resumed
// only inside the move itself, often too late for its sound.
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

// A stone on a wooden board: two damped partials, the higher one dying
// first, after a soft tick. A burst of filtered noise alone sounded like
// static ("音割れ"), so the noise is now only the first few milliseconds.
// Every level rises over 2ms instead of jumping, so nothing clicks.
function knock(ctx, out, at, { frequency, gain, length }) {
  partial(ctx, out, at, frequency, gain, length);
  partial(ctx, out, at, frequency * 2.76, gain * .35, length * .45);
  const source = ctx.createBufferSource();
  source.buffer = noise(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 2500;
  const level = envelope(ctx, at, gain * .25, .008);
  source.connect(filter).connect(level).connect(out);
  source.start(at);
  source.stop(at + .01);
}
function partial(ctx, out, at, frequency, gain, length) {
  const oscillator = ctx.createOscillator();
  oscillator.type = "sine";
  // A slight drop in pitch, as a struck body settles.
  oscillator.frequency.setValueAtTime(frequency * 1.04, at);
  oscillator.frequency.exponentialRampToValueAtTime(frequency, at + .02);
  oscillator.connect(envelope(ctx, at, gain, length)).connect(out);
  oscillator.start(at);
  oscillator.stop(at + length + .01);
}
function envelope(ctx, at, gain, length) {
  const level = ctx.createGain();
  level.gain.setValueAtTime(.0001, at);
  level.gain.linearRampToValueAtTime(gain, at + .002);
  level.gain.exponentialRampToValueAtTime(.0001, at + length);
  return level;
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
    CALM_VOICES.move(ctx, out, at);
    knock(ctx, out, at + .07, { frequency: 2600, gain: .035, length: .03 });
    knock(ctx, out, at + .12, { frequency: 3000, gain: .025, length: .03 });
  },
  countdown(ctx, out, at) { tone(ctx, out, at, { frequency: 880, gain: .12, length: .09 }); },
  countdownLast(ctx, out, at) { tone(ctx, out, at, { frequency: 1320, gain: .14, length: .09 }); },
  end(ctx, out, at) {
    tone(ctx, out, at, { frequency: 523.25, gain: .1, length: .7 });
    tone(ctx, out, at + .12, { frequency: 783.99, gain: .08, length: .7 });
  },
  move(ctx, out, at) { knock(ctx, out, at, { frequency: 900, gain: .09, length: .09 }); },
};

// From this many stones taken (as the board's quake) a capture's ドーン echoes.
const ECHO_FROM = 4;
// Most stones a capture's sound grows for: past this it is as big as it gets.
const GROW_MOST = 10;
// When the crackle after a firework's ドーン pops, in seconds after it: a few,
// spread out, as fast pops of bright noise are the kind of sound people hate.
const CRACKLE = [.08, .17, .29, .41, .57];

// ドパガキモード is louder and layered, so its bigger sounds run through a
// compressor that holds their peaks down: a big capture or a win sounds
// bigger, not harsher.
const limiters = new WeakMap();
function limited(ctx, out) {
  if (!limiters.has(ctx)) {
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -16;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = .002;
    limiter.release.value = .15;
    const trim = ctx.createGain();
    trim.gain.value = .9;
    limiter.connect(trim).connect(out);
    limiters.set(ctx, limiter);
  }
  return limiters.get(ctx);
}
function wave(ctx, out, at, { type, frequency, to = frequency, gain, length, attack = .003 }) {
  const oscillator = ctx.createOscillator();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, at);
  if (to !== frequency) oscillator.frequency.exponentialRampToValueAtTime(to, at + length);
  const level = ctx.createGain();
  level.gain.setValueAtTime(.0001, at);
  level.gain.linearRampToValueAtTime(gain, at + attack);
  level.gain.exponentialRampToValueAtTime(.0001, at + length);
  oscillator.connect(level).connect(out);
  oscillator.start(at);
  oscillator.stop(at + length + .01);
}
// ピューン: a square, softened by a low-pass, gliding from `from` to `to`
// with a sine under it; falling, it flies off, rising, it is launched.
function pew(ctx, out, at, { from, to, gain, length }) {
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 2500;
  filter.connect(out);
  wave(ctx, filter, at, { type: "square", frequency: from, to, gain: gain * .5, length });
  wave(ctx, out, at, { type: "sine", frequency: from, to, gain, length });
}
// Noise through a low-pass that closes from `from` to `to`: a blast's rumble.
function rumble(ctx, out, at, { from, to, gain, length }) {
  const source = ctx.createBufferSource();
  source.buffer = noise(ctx);
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(from, at);
  filter.frequency.exponentialRampToValueAtTime(to, at + length);
  source.connect(filter).connect(envelope(ctx, at, gain, length)).connect(out);
  source.start(at);
  source.stop(at + length + .01);
}
// ドーン: a drum falling fast from 140Hz to 45Hz under the rumble of a blast.
// A phone's speaker plays little below 400Hz, so its 2nd and 3rd harmonics
// carry the weight there; nothing goes lower than can be heard.
function boom(ctx, out, at, { gain, length }) {
  wave(ctx, out, at, { type: "sine", frequency: 140, to: 45, gain, length });
  wave(ctx, out, at, { type: "sine", frequency: 280, to: 90, gain: gain * .35, length: length * .6 });
  wave(ctx, out, at, { type: "sine", frequency: 420, to: 135, gain: gain * .2, length: length * .4 });
  rumble(ctx, out, at, { from: 2500, to: 120, gain: gain * .45, length: length * 1.2 });
}
// Pops of bright noise after a firework bursts.
function crackle(ctx, out, at, gain) {
  for (const [i, later] of CRACKLE.entries()) {
    const source = ctx.createBufferSource();
    source.buffer = noise(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1800 + i % 3 * 500;
    const pop = at + later;
    source.connect(filter).connect(envelope(ctx, pop, gain * (1 - i * .12), .03)).connect(out);
    source.start(pop);
    source.stop(pop + .04);
  }
}
// ヒュ～ドーン: a whistle climbing into a burst that crackles.
function firework(ctx, out, at, { gain }) {
  wave(ctx, out, at, { type: "sine", frequency: 500, to: 2200, gain: gain * .35, length: .45 });
  const burst = at + .45;
  boom(ctx, out, burst, { gain, length: .9 });
  crackle(ctx, out, burst, gain * .3);
}

/**
 * ドパガキモード's louder sounds: game-like ピューン and ドーン rather than
 * notes. Each stone lands with a short ピュン and a thump; a capture flies off
 * with a longer ピューン into a ドーン, both bigger the more stones it took
 * (echoing from 4); a good move rises with a キュイーン; the viewer's win is a
 * firework, ヒュ～ドーン (three for 圧勝), while a loss or a draw ends as
 * calmly as usual; 秒読み beeps twice; a turning point of the replay lands
 * with a ドーン. It grows with what happened in that one move, never with a
 * streak, and the limiter keeps the bigger ones from peaking.
 */
export const DOPA_VOICES = {
  capture(ctx, out, at, { count = 1 } = {}) {
    const bus = limited(ctx, out);
    const stones = Math.max(1, Math.min(GROW_MOST, count));
    CALM_VOICES.move(ctx, bus, at);
    const flight = .22 + stones * .03;
    pew(ctx, bus, at, { from: 1800, to: 180, gain: .16, length: flight });
    boom(ctx, bus, at + flight * .6, { gain: .3 + stones * .03, length: .45 + stones * .06 });
    if (stones >= ECHO_FROM) boom(ctx, bus, at + flight * .6 + .28, { gain: .25, length: .5 });
  },
  countdown(ctx, out, at) {
    const bus = limited(ctx, out);
    for (const later of [0, .1]) {
      tone(ctx, bus, at + later, { frequency: 880, gain: .12, length: .09 });
      wave(ctx, bus, at + later, { type: "triangle", frequency: 1760, gain: .04, length: .07 });
    }
  },
  countdownLast(ctx, out, at) {
    const bus = limited(ctx, out);
    tone(ctx, bus, at, { frequency: 1320, gain: .14, length: .09 });
    tone(ctx, bus, at + .1, { frequency: 1760, gain: .14, length: .12 });
    wave(ctx, bus, at + .1, { type: "square", frequency: 1760, gain: .025, length: .1 });
  },
  don(ctx, out, at) {
    const bus = limited(ctx, out);
    boom(ctx, bus, at, { gain: .55, length: .8 });
    knock(ctx, bus, at, { frequency: 120, gain: .3, length: .35 });
  },
  end(ctx, out, at, detail) {
    if (detail?.kind !== "win") return CALM_VOICES.end(ctx, out, at);
    const bus = limited(ctx, out);
    firework(ctx, bus, at, { gain: .5 });
    if (!detail.big) return;
    firework(ctx, bus, at + .55, { gain: .45 });
    firework(ctx, bus, at + 1.1, { gain: .55 });
  },
  good(ctx, out, at) {
    const bus = limited(ctx, out);
    // キュイーン: two glides up, a fifth apart.
    pew(ctx, bus, at + .05, { from: 300, to: 2400, gain: .07, length: .35 });
    wave(ctx, bus, at + .05, { type: "sine", frequency: 450, to: 3600, gain: .04, length: .35 });
  },
  move(ctx, out, at) {
    // Heard every move, so it stays well under a capture or a win: it skips
    // the limiter, whose make-up gain would lift it as high as they are.
    CALM_VOICES.move(ctx, out, at);
    pew(ctx, out, at, { from: 1600, to: 500, gain: .05, length: .1 });
    wave(ctx, out, at, { type: "sine", frequency: 160, to: 60, gain: .12, length: .16 });
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
  for (const type of ["keydown", "pointerdown", "pointerup", "touchend"]) target.addEventListener?.(type, primer, { capture: true });
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
