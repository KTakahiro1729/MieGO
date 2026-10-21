import test from "node:test";
import assert from "node:assert/strict";
import { CALM_VOICES, countdownSound, createSoundEffects, DOPA_VOICES, moveSound } from "../public/sound.mjs";

function fakePage() {
  const elements = new Map();
  const $ = id => {
    if (!elements.has(id)) elements.set(id, { id, checked: false, listeners: [],
      addEventListener(type, listener) { this.listeners.push(listener); } });
    return elements.get(id);
  };
  const handlers = [];
  const target = { addEventListener: (type, listener) => handlers.push(listener) };
  return { $, target, tap: () => handlers.forEach(handler => handler()) };
}
class FakeContext {
  static made = 0;
  constructor() { FakeContext.made++; this.state = "running"; this.currentTime = 0; this.destination = {}; }
  resume() { return Promise.resolve(); }
}
function setup(saved = new Map()) {
  globalThis.localStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  FakeContext.made = 0;
  const page = fakePage();
  const heard = [];
  const voices = Object.fromEntries(["capture", "countdown", "countdownLast", "end", "move"]
    .map(name => [name, () => heard.push(name)]));
  const sound = createSoundEffects({ $: page.$, voices, AudioContextClass: FakeContext, target: page.target });
  return { page, sound, heard, saved };
}

test("効果音 start off: nothing plays and no audio context is made", () => {
  const { page, sound, heard } = setup();
  assert.equal(sound.enabled(), false);
  assert.equal(page.$("soundEffects").checked, false);
  page.tap();
  sound.play("move");
  assert.deepEqual(heard, []);
  assert.equal(FakeContext.made, 0);
});

test("turning 効果音 on is remembered and plays a stone to hear it", () => {
  const { page, sound, heard, saved } = setup();
  page.$("soundEffects").onchange({ target: { checked: true } });
  assert.equal(saved.get("miego-sound"), "on");
  assert.deepEqual(heard, ["move"]);
  sound.play("capture");
  assert.deepEqual(heard, ["move", "capture"]);
  // 初期状態に戻す turns them off again.
  page.$("resetAppearance").listeners.forEach(listener => listener());
  assert.equal(sound.enabled(), false);
  assert.equal(saved.get("miego-sound"), "off");
});

test("a saved switch waits for the first tap before playing", () => {
  const { page, sound, heard } = setup(new Map([["miego-sound", "on"]]));
  assert.equal(page.$("soundEffects").checked, true);
  sound.play("move");
  assert.deepEqual(heard, []);
  page.tap();
  sound.play("move");
  assert.deepEqual(heard, ["move"]);
});

test("blocked storage starts off and still switches", () => {
  const blocked = () => { throw new Error("SecurityError"); };
  globalThis.localStorage = { getItem: blocked, setItem: blocked };
  const page = fakePage();
  const sound = createSoundEffects({ $: page.$, voices: {}, AudioContextClass: FakeContext, target: page.target });
  assert.equal(sound.enabled(), false);
  page.$("soundEffects").onchange({ target: { checked: true } });
  assert.equal(sound.enabled(), true);
});

test("a move sounds as a stone, a capture or the end; a pass is quiet", () => {
  const playing = { status: "playing", captures: { black: 0, white: 0 } };
  assert.equal(moveSound(playing, { ...playing }, 40), "move");
  assert.equal(moveSound(playing, { ...playing, captures: { black: 2, white: 0 } }, 40), "capture");
  assert.equal(moveSound(playing, { ...playing }, null), null);
  assert.equal(moveSound(playing, { ...playing, status: "finished", result: "W+R" }, "resign"), "end");
  // 五目並べ has no captures; five in a row ends it.
  assert.equal(moveSound({ status: "playing" }, { status: "finished", result: "B+" }, 12), "end");
  // Agreeing a count ends the game with no move.
  assert.equal(moveSound({ status: "scoring" }, { status: "finished" }, null), "end");
});

test("秒読み beeps in the last 10 seconds, higher in the last 5", () => {
  assert.equal(countdownSound(null), null);
  assert.equal(countdownSound({ left: 11000, out: false }), null);
  assert.equal(countdownSound({ left: 10000, out: false }), "countdown");
  assert.equal(countdownSound({ left: 6000, out: false }), "countdown");
  assert.equal(countdownSound({ left: 5000, out: false }), "countdownLast");
  assert.equal(countdownSound({ left: 400, out: false }), "countdownLast");
  assert.equal(countdownSound({ left: 0, out: true }), null);
});

test("a voices getter is read at each play, and a capture's count reaches the voice", () => {
  globalThis.localStorage = { getItem: () => "on", setItem() {} };
  const page = fakePage();
  const heard = [];
  let loud = false;
  const calm = { capture: () => heard.push("calm") };
  const dopa = { capture: (ctx, out, at, detail) => heard.push("dopa:" + detail?.count) };
  const sound = createSoundEffects({ $: page.$, voices: () => loud ? dopa : calm, AudioContextClass: FakeContext, target: page.target });
  page.tap();
  sound.play("capture", { count: 3 });
  loud = true;
  sound.play("capture", { count: 3 });
  assert.deepEqual(heard, ["calm", "dopa:3"]);
});

test("ドパガキモード's voices cover every calm sound", () => {
  for (const name of Object.keys(CALM_VOICES)) assert.equal(typeof DOPA_VOICES[name], "function", name);
});

// An audio context that only notes the frequencies its oscillators start at.
function recordingContext() {
  const heard = [];
  const param = () => ({ value: 0, setValueAtTime(v) { this.value = v; }, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = extra => ({ connect: next => next, start() {}, stop() {}, ...extra });
  const ctx = {
    sampleRate: 8000, currentTime: 0,
    createBuffer: (channels, length) => ({ getChannelData: () => new Float32Array(length) }),
    createBufferSource: () => node(),
    createBiquadFilter: () => node({ frequency: param(), Q: param() }),
    createDynamicsCompressor: () => node({ threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }),
    createGain: () => node({ gain: param() }),
    createOscillator() {
      const oscillator = node({ frequency: param(), start: () => heard.push(oscillator.frequency.value) });
      return oscillator;
    },
  };
  return { ctx, heard };
}

test("ドパガキモード's capture runs longer and higher the more stones it takes, and stays in tune", () => {
  const run = count => { const { ctx, heard } = recordingContext(); DOPA_VOICES.capture(ctx, {}, 0, { count }); return heard; };
  for (let count = 1; count <= 30; count++)
    assert.ok(run(count).every(frequency => Number.isFinite(frequency) && frequency > 0), `count ${count}`);
  assert.ok(run(4).length > run(1).length);
  // The run's bells, above the stone and below its taps.
  const top = count => Math.max(...run(count).filter(frequency => frequency > 500 && frequency < 2200));
  assert.ok(top(8) > top(1));
});

test("ドパガキモード cheers only a win: a loss or a draw ends as calmly as usual", () => {
  const end = (voices, detail) => { const { ctx, heard } = recordingContext(); voices.end(ctx, {}, 0, detail); return heard; };
  assert.deepEqual(end(DOPA_VOICES, undefined), end(CALM_VOICES));
  assert.ok(end(DOPA_VOICES, { kind: "win", big: false }).length > end(CALM_VOICES).length);
  assert.ok(end(DOPA_VOICES, { kind: "win", big: true }).length > end(DOPA_VOICES, { kind: "win", big: false }).length);
});

test("ドパガキモード's stones step up a scale with the move number", () => {
  const stone = recordingContext();
  CALM_VOICES.move(stone.ctx, {}, 0);
  // The first sound beyond the calm stone is the step's chime.
  const first = moveNumber => { const { ctx, heard } = recordingContext(); DOPA_VOICES.move(ctx, {}, 0, { moveNumber }); return heard.find(frequency => !stone.heard.includes(frequency)); };
  assert.ok(first(2) > first(1));
  assert.equal(first(11), first(1), "it goes round after ten");
});
