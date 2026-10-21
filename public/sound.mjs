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

// C major from C5 up two octaves: the notes ドパガキモード climbs through.
const SCALE = [523.25, 587.33, 659.25, 698.46, 783.99, 880, 987.77, 1046.5, 1174.66, 1318.51, 1396.91, 1567.98, 1760, 1975.53, 2093];
// C major's pentatonic over two octaves: each move rings the next one up, so
// a game's stones walk up and round it.
const STEPS = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98, 1760];
// Most stones a capture's run counts: past this it is as long as it gets.
const RUN_MOST = 10;
// From this many stones taken (as the board's quake) a capture also booms.
const BOOM_FROM = 4;

// ドパガキモード is louder and layered, so it runs through a compressor
// that holds its peaks down: a big capture or a win sounds bigger, not
// harsher, and the stone after it is as loud as the one before.
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
// A bright bell: a sine with a slightly detuned twin (for shimmer), its
// octave on a triangle, and a short high partial for the strike.
function bell(ctx, out, at, { frequency, gain, length }) {
  tone(ctx, out, at, { frequency, gain, length });
  tone(ctx, out, at, { frequency: frequency * 1.004, gain: gain * .5, length });
  wave(ctx, out, at, { type: "triangle", frequency: frequency * 2, gain: gain * .3, length: length * .7 });
  tone(ctx, out, at, { frequency: frequency * 3, gain: gain * .12, length: length * .25 });
}
function wave(ctx, out, at, { type, frequency, to = frequency, gain, length, attack = .005 }) {
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
// A brass-like note: two detuned saws whose filter opens as it is blown.
function brass(ctx, out, at, { frequency, gain, length }) {
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(frequency * 2, at);
  filter.frequency.exponentialRampToValueAtTime(frequency * 6, at + .05);
  filter.frequency.exponentialRampToValueAtTime(frequency * 3, at + length);
  filter.connect(out);
  for (const detune of [.997, 1.003])
    wave(ctx, filter, at, { type: "sawtooth", frequency: frequency * detune, gain: gain * .5, length, attack: .015 });
}
// Filtered noise whose band climbs from `from` to `to`: the rising whoosh.
function sweep(ctx, out, at, { from, to, gain, length }) {
  const source = ctx.createBufferSource();
  source.buffer = noise(ctx);
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 2;
  filter.frequency.setValueAtTime(from, at);
  filter.frequency.exponentialRampToValueAtTime(to, at + length);
  const level = ctx.createGain();
  level.gain.setValueAtTime(.0001, at);
  level.gain.linearRampToValueAtTime(gain, at + length * .8);
  level.gain.exponentialRampToValueAtTime(.0001, at + length);
  source.connect(filter).connect(level).connect(out);
  source.start(at);
  source.stop(at + length + .01);
}
// A low drum: a sine falling fast from 150Hz, felt more than heard.
function boom(ctx, out, at, { gain, length }) {
  wave(ctx, out, at, { type: "sine", frequency: 150, to: 40, gain, length, attack: .003 });
}
// A quick glitter of high notes, each a little later and quieter.
function sparkle(ctx, out, at, notes, gain) {
  notes.forEach((frequency, i) => tone(ctx, out, at + i * .035, { frequency, gain: gain * (1 - i * .1), length: .25 }));
}

/**
 * ドパガキモード's louder sounds, layered and rising. Each stone pops a two-note
 * chime one step up a pentatonic scale from the last; a capture runs up the
 * scale, longer and higher the more stones it took (and booms from 4), under
 * a rising whoosh; a good move glides up into a sparkling chord; the viewer's
 * win plays a brass fanfare (twice as long for 圧勝), while a loss or a draw
 * ends as calmly as usual; 秒読み beeps twice; a turning point of the replay
 * lands with a low ドン. It grows with what happened in that one move, never
 * with a streak, and the limiter keeps its peaks down.
 */
export const DOPA_VOICES = {
  capture(ctx, out, at, { count = 1 } = {}) {
    const bus = limited(ctx, out);
    CALM_VOICES.capture(ctx, bus, at);
    const stones = Math.max(1, Math.min(RUN_MOST, count));
    const notes = stones + 3;
    const gap = .06 - stones * .0025;
    // More stones start higher as well as run longer, up to the scale's top.
    const from = Math.min(SCALE.length - notes, stones - 1);
    sweep(ctx, bus, at, { from: 300, to: 3000 + stones * 600, gain: .05 + stones * .006, length: notes * gap + .05 });
    for (let i = 0; i < notes; i++)
      bell(ctx, bus, at + .03 + i * gap, { frequency: SCALE[from + i], gain: .1, length: .22 });
    const top = at + .03 + notes * gap;
    const root = SCALE[from + notes - 1];
    for (const ratio of [1, 1.25, 1.5]) bell(ctx, bus, top, { frequency: root * ratio / 2, gain: .07, length: .5 + stones * .05 });
    if (stones >= BOOM_FROM) {
      boom(ctx, bus, at, { gain: .5, length: .45 });
      sparkle(ctx, bus, top + .05, [root * 2, root * 2.5, root * 3, root * 4], .04);
    }
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
    boom(ctx, bus, at, { gain: .6, length: .6 });
    knock(ctx, bus, at, { frequency: 120, gain: .3, length: .35 });
    tone(ctx, bus, at, { frequency: 98, gain: .22, length: .7 });
  },
  end(ctx, out, at, detail) {
    if (detail?.kind !== "win") return CALM_VOICES.end(ctx, out, at);
    const bus = limited(ctx, out);
    // ソソソ・ドー: three short notes and a held one under its chord.
    const call = [783.99, 783.99, 783.99, 1046.5];
    call.forEach((frequency, i) => brass(ctx, bus, at + i * .12, { frequency: frequency / 2, gain: .12, length: i < 3 ? .1 : .9 }));
    const held = at + .36;
    boom(ctx, bus, held, { gain: .4, length: .5 });
    for (const frequency of [523.25, 659.25, 783.99, 1046.5]) bell(ctx, bus, held, { frequency, gain: .05, length: 1.2 });
    sparkle(ctx, bus, held + .1, [2093, 2637.02, 3135.96, 4186.01], .035);
    if (!detail.big) return;
    // 圧勝: the call again a third higher, with a longer whoosh into it.
    const again = at + 1.1;
    sweep(ctx, bus, again - .4, { from: 300, to: 6000, gain: .07, length: .4 });
    [987.77, 987.77, 987.77, 1318.51].forEach((frequency, i) =>
      brass(ctx, bus, again + i * .12, { frequency: frequency / 2, gain: .12, length: i < 3 ? .1 : 1.1 }));
    boom(ctx, bus, again + .36, { gain: .5, length: .6 });
    for (const frequency of [659.25, 830.61, 987.77, 1318.51]) bell(ctx, bus, again + .36, { frequency, gain: .05, length: 1.3 });
    sparkle(ctx, bus, again + .46, [2637.02, 3322.44, 3951.07, 5274.04], .035);
  },
  good(ctx, out, at) {
    const bus = limited(ctx, out);
    wave(ctx, bus, at + .05, { type: "sine", frequency: 1046.5, to: 4186.01, gain: .04, length: .15 });
    [659.25, 783.99, 1046.5, 1318.51].forEach((frequency, i) => bell(ctx, bus, at + .1 + i * .045, { frequency, gain: .08, length: .5 }));
    sparkle(ctx, bus, at + .3, [2637.02, 3135.96, 4186.01], .03);
  },
  move(ctx, out, at, { moveNumber = 1 } = {}) {
    const bus = limited(ctx, out);
    CALM_VOICES.move(ctx, bus, at);
    const step = ((moveNumber - 1) % STEPS.length + STEPS.length) % STEPS.length;
    bell(ctx, bus, at + .015, { frequency: STEPS[step], gain: .06, length: .14 });
    bell(ctx, bus, at + .06, { frequency: STEPS[step] * 1.5, gain: .05, length: .2 });
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
