import test from "node:test";
import assert from "node:assert/strict";
import { at, BLACK, newGame, play, WHITE } from "../public/core.mjs";
import { bigWinPoints, countedLabel, createDopaMode, dopaEvent, dopaLevel } from "../public/dopa-mode.mjs";

const finished = (result, size = 9) => ({ ...newGame(true, { size }), status: "finished", result });

test("dopaEvent sees a capture and how many stones it took", () => {
  const game = newGame();
  for (const p of [at(1,0), at(0,1), at(2,1)]) game.board[p] = BLACK;
  game.board[at(1,1)] = WHITE;
  game.next = BLACK;
  const after = play(game, at(1,2));
  assert.deepEqual(dopaEvent(game, after), { kind: "capture", count: 1 });
  assert.equal(dopaEvent(after, play(after, at(5,5))), null, "a quiet move is nothing");
});

test("dopaEvent cheers a win only for the viewer, and marks a big one", () => {
  const playing = newGame();
  assert.deepEqual(dopaEvent(playing, finished("B+12.5")), { kind: "win", winner: "B", points: 12.5, big: true });
  assert.deepEqual(dopaEvent(playing, finished("W+3.5"), WHITE), { kind: "win", winner: "W", points: 3.5, big: false });
  assert.equal(dopaEvent(playing, finished("W+3.5"), BLACK), null, "the viewer's loss is not cheered");
  assert.deepEqual(dopaEvent(playing, finished("B+R"), BLACK), { kind: "win", winner: "B", points: null, big: false });
  assert.equal(dopaEvent(playing, finished("0")), null, "a draw has no winner");
  assert.equal(dopaEvent(finished("B+3.5"), finished("B+3.5")), null, "only the step that ends the game");
  assert.equal(dopaEvent(playing, finished("B+25.5", 19)).big, false, "19路 needs 30");
});

test("big wins grow with the board, and the count-up keeps the label's decimals", () => {
  assert.deepEqual([9, 13, 19].map(bigWinPoints), [10, 20, 30]);
  assert.equal(countedLabel("黒が12.5目差で勝利", 3), "黒が3.0目差で勝利");
  assert.equal(countedLabel("黒が12目差で勝利", 3), "黒が3目差で勝利");
  assert.equal(dopaLevel("loud"), "off");
});

function page({ level = null, reduced = false } = {}) {
  const saved = new Map(level ? [["miego-dopa", level]] : []);
  globalThis.localStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  const elements = new Map();
  const $ = id => {
    if (!elements.has(id)) elements.set(id, { id, value: "", listeners: [],
      addEventListener(type, listener) { this.listeners.push(listener); } });
    return elements.get(id);
  };
  const children = [];
  const ownerDocument = { createElement: tag => {
    const element = { tag, className: "", textContent: "", style: { setProperty() {} }, remove() { children.splice(children.indexOf(element), 1); } };
    return element;
  } };
  const stage = { ownerDocument, append: element => children.push(element) };
  const classes = new Set();
  const frame = { offsetWidth: 0, classList: { add: c => classes.add(c), remove: c => classes.delete(c) } };
  const score = { textContent: "黒が12.5目差で勝利" };
  const later = [], frames = [];
  let time = 0;
  const dopa = createDopaMode({ $, stage, frame, score: () => score, reducedMotion: () => reduced,
    random: () => .5, schedule: f => later.push(f), requestFrame: f => frames.push(f), now: () => time });
  return { $, dopa, saved, children, classes, score, later, frames, tick: ms => { time += ms; frames.shift()?.(); } };
}

test("the 設定 choice starts off, is remembered and goes back to off with 初期状態に戻す", () => {
  const p = page();
  assert.equal(p.dopa.level(), "off");
  assert.equal(p.$("dopaMode").value, "off");
  p.$("dopaMode").onchange({ target: { value: "ultra" } });
  assert.equal(p.saved.get("miego-dopa"), "ultra");
  assert.equal(page({ level: "ultra" }).dopa.level(), "ultra");
  p.$("resetAppearance").listeners.forEach(listener => listener());
  assert.equal(p.dopa.level(), "off");
});

test("off and reduced motion show nothing", () => {
  for (const options of [{}, { level: "ultra", reduced: true }]) {
    const p = page(options);
    p.dopa.celebrate({ kind: "win", winner: "B", points: 12.5, big: true });
    p.dopa.celebrate({ kind: "capture", count: 9 });
    assert.equal(p.children.length, 0);
    assert.equal(p.classes.size, 0);
    assert.equal(p.score.textContent, "黒が12.5目差で勝利");
  }
});

test("a win rains confetti and counts its points up; ULTRA adds 圧勝 for a big one", () => {
  const on = page({ level: "on" });
  on.dopa.celebrate({ kind: "win", winner: "B", points: 12.5, big: true });
  assert.equal(on.children.length, 40);
  assert.equal(on.children.some(c => c.className === "dopa-shout"), false);
  assert.equal(on.score.textContent, "黒が0.0目差で勝利");
  on.tick(450);
  assert.match(on.score.textContent, /^黒が(\d+)\.0目差で勝利$/);
  on.tick(1000);
  assert.equal(on.score.textContent, "黒が12.5目差で勝利", "ends on the real result");
  on.later.forEach(f => f());
  assert.equal(on.children.length, 0, "the confetti is cleared");

  const ultra = page({ level: "ultra" });
  ultra.dopa.celebrate({ kind: "win", winner: "B", points: 12.5, big: true });
  assert.equal(ultra.children.filter(c => c.className === "dopa-confetti").length, 90);
  assert.equal(ultra.children.find(c => c.className === "dopa-shout")?.textContent, "圧勝！");
});

test("only ULTRA shakes the board, and only for a capture of five or more", () => {
  const on = page({ level: "on" });
  on.dopa.celebrate({ kind: "capture", count: 9 });
  assert.equal(on.classes.size, 0);
  const ultra = page({ level: "ultra" });
  ultra.dopa.celebrate({ kind: "capture", count: 4 });
  assert.equal(ultra.classes.size, 0);
  ultra.dopa.celebrate({ kind: "capture", count: 5 });
  assert.ok(ultra.classes.has("dopa-shake"));
  ultra.later.forEach(f => f());
  assert.equal(ultra.classes.size, 0);
});
