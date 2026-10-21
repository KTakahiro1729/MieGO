import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { at, BLACK, newGame, play, WHITE } from "../public/core.mjs";
import {
  bigWinPoints,
  countedLabel,
  createDopaMode,
  dopaEvent,
  dopaLevel,
  goodMove,
} from "../public/dopa-mode.mjs";

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

test("goodMove is the network's favourite empty point, or one it weighs at least half as much", () => {
  const board = [0, 0, 0, BLACK];
  const policy = [2, 2 + Math.log(.6), 2 + Math.log(.4), 9];
  assert.equal(goodMove(policy, board, 0), true, "the favourite; the higher logit is on a stone");
  assert.equal(goodMove(policy, board, 1), true);
  assert.equal(goodMove(policy, board, 2), false);
  assert.equal(goodMove(policy, board, null), false, "a pass");
  assert.equal(goodMove(null, board, 0), false, "no policy kept");
  assert.equal(goodMove(policy.slice(1), board, 0), false, "another board");
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
  const classList = set => ({ add: c => set.add(c), remove: (...names) => names.forEach(c => set.delete(c)),
    toggle: (c, on) => on ? set.add(c) : set.delete(c) });
  const frame = { offsetWidth: 0, classList: classList(classes) };
  const graphClasses = new Set();
  const graph = { offsetWidth: 0, classList: classList(graphClasses) };
  const score = { textContent: "黒が12.5目差で勝利" };
  const later = [], frames = [];
  let time = 0;
  const dopa = createDopaMode({ $, stage, frame, graph, score: () => score, ...(reduced === null ? {} : { reducedMotion: () => reduced }),
    random: () => .5, schedule: f => later.push(f), requestFrame: f => frames.push(f), now: () => time });
  return { $, dopa, saved, children, classes, graphClasses, score, later, frames, tick: ms => { time += ms; frames.shift()?.(); } };
}

test("the 設定 switch starts off, is remembered and goes back to off with 初期状態に戻す", () => {
  const p = page();
  assert.equal(p.dopa.level(), "off");
  assert.equal(p.$("dopaMode").checked, false);
  p.$("dopaMode").onchange({ target: { checked: true } });
  assert.equal(p.saved.get("miego-dopa"), "on");
  assert.equal(p.$("dopaMode").checked, true);
  // 初期状態に戻す resets the board's look only: the mode stays on.
  p.$("resetAppearance").listeners.forEach(listener => listener());
  assert.equal(p.dopa.level(), "on");
  assert.equal(p.saved.get("miego-dopa"), "on");
  assert.equal(page({ level: "on" }).dopa.level(), "on");
  assert.equal(page({ level: "ultra" }).dopa.level(), "on", "the old ULTRA reads as on");
});

test("off and reduced motion show nothing", () => {
  for (const options of [{}, { level: "on", reduced: true }]) {
    const p = page(options);
    p.dopa.celebrate({ kind: "win", winner: "B", points: 12.5, big: true });
    p.dopa.celebrate({ kind: "capture", count: 9 });
    assert.equal(p.children.length, 0);
    assert.equal(p.classes.size, 0);
    assert.equal(p.score.textContent, "黒が12.5目差で勝利");
  }
});

test("a win rains confetti under 勝利！ or 圧勝！, quakes the board and counts its points up", () => {
  const p = page({ level: "on" });
  p.dopa.celebrate({ kind: "win", winner: "B", points: 3.5, big: false });
  assert.equal(p.children.filter(c => c.className === "dopa-confetti").length, 120);
  assert.equal(p.children.find(c => c.className === "dopa-shout")?.textContent, "勝利！");
  assert.ok(p.classes.has("dopa-quake"));
  p.later.forEach(f => f());
  assert.equal(p.children.length, 0, "the confetti is cleared");

  const big = page({ level: "on" });
  big.dopa.celebrate({ kind: "win", winner: "B", points: 12.5, big: true });
  assert.equal(big.children.filter(c => c.className === "dopa-confetti").length, 180);
  assert.equal(big.children.find(c => c.className === "dopa-shout")?.textContent, "圧勝！");
  assert.equal(big.score.textContent, "黒が0.0目差で勝利");
  big.tick(500);
  assert.match(big.score.textContent, /^黒が(\d+)\.0目差で勝利$/);
  big.tick(1000);
  assert.equal(big.score.textContent, "黒が12.5目差で勝利", "ends on the real result");
});

test("every capture shakes the board, and four stones or more quake it", () => {
  const p = page({ level: "on" });
  p.dopa.celebrate({ kind: "capture", count: 1 });
  assert.deepEqual([...p.classes], ["dopa-shake"]);
  p.dopa.celebrate({ kind: "capture", count: 4 });
  assert.deepEqual([...p.classes], ["dopa-quake"], "a bigger capture replaces the shake");
  p.later.forEach(f => f());
  assert.equal(p.classes.size, 0);
});

test("a good move shakes the board", () => {
  const p = page({ level: "on" });
  p.dopa.praise();
  assert.ok(p.classes.has("dopa-shake"));
  for (const options of [{}, { level: "on", reduced: true }]) {
    const still = page(options);
    still.dopa.praise();
    assert.equal(still.classes.size, 0);
  }
});

test("a turning point of the replay lands with ドン！, a shake and a bouncing mark", () => {
  const p = page({ level: "on" });
  p.dopa.don();
  assert.equal(p.children.find(c => c.className === "dopa-shout dopa-don")?.textContent, "ドン！");
  assert.ok(p.classes.has("dopa-shake"));
  assert.ok(p.graphClasses.has("dopa-bounce"));
  p.later.forEach(f => f());
  assert.equal(p.children.length, 0);
  assert.equal(p.graphClasses.size, 0);

  const still = page({ level: "on", reduced: true });
  still.dopa.don();
  assert.equal(still.children.length, 1, "reduced motion keeps the word, standing still");
  assert.equal(still.classes.size + still.graphClasses.size, 0);
  const off = page();
  off.dopa.don();
  assert.equal(off.children.length, 0);
});

test("秒読み grows the clock from 10 seconds and pulses the board's edge from 5", () => {
  const p = page({ level: "on" });
  assert.equal(p.dopa.countdown({ left: 12000 }), false);
  assert.equal(p.dopa.countdown({ left: 9000 }), true);
  assert.equal(p.classes.has("dopa-pulse"), false);
  assert.equal(p.dopa.countdown({ left: 4000 }), true);
  assert.ok(p.classes.has("dopa-pulse"));
  assert.equal(p.dopa.countdown(null), false, "no clock shown");
  assert.equal(p.classes.has("dopa-pulse"), false);

  const still = page({ level: "on", reduced: true });
  assert.equal(still.dopa.countdown({ left: 4000 }), true, "the bigger number stands still");
  assert.equal(still.classes.size, 0);
  assert.equal(page().dopa.countdown({ left: 4000 }), false);
});

test("without its own check, it follows the page's prefers-reduced-motion", () => {
  for (const reduce of [false, true]) {
    globalThis.matchMedia = query => ({ matches: reduce && query.includes("reduce") });
    const p = page({ level: "on", reduced: null });
    p.dopa.celebrate({ kind: "capture", count: 1 });
    assert.equal(p.classes.has("dopa-shake"), !reduce);
  }
  delete globalThis.matchMedia;
});

test("the shout's outline sits under its fill so a kanji's overlapping strokes stay hidden", () => {
  const css = readFileSync(new URL("../public/style.css", import.meta.url), "utf8");
  const rule = css.match(/\.dopa-shout\{[^}]*\}/)?.[0] ?? "";
  assert.match(rule, /-webkit-text-stroke:/);
  assert.match(rule, /paint-order:stroke fill/);
});
