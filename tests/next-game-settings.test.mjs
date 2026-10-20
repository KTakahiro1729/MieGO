import test from "node:test";
import assert from "node:assert/strict";
import { capHandicaps, readSettings, toBoardSize, toRules, writeSettings } from "../public/next-game-settings.mjs";

const memory = () => { const items = new Map(); return { getItem:k => items.get(k) ?? null, setItem:(k, v) => items.set(k, v) }; };

test("the next game's choices survive a round trip, and none are remembered at first", () => {
  const storage = memory();
  assert.equal(readSettings(storage), null);
  writeSettings(storage, {boardSize:13, gameRules:"japanese"});
  assert.deepEqual(readSettings(storage), {boardSize:13, gameRules:"japanese"});
});

test("a full storage keeps the previous choices without throwing", () => {
  assert.doesNotThrow(() => writeSettings({setItem() { throw new Error("full"); }}, {boardSize:9}));
});

test("unknown values fall back to 9路 and 中国ルール, and 9路 takes at most five handicap stones", () => {
  assert.equal(toBoardSize("12"), 9);
  assert.equal(toRules("chess"), "chinese");
  assert.deepEqual(capHandicaps({aiHandicap:9, localHandicap:3}, 9), {aiHandicap:5, localHandicap:3});
  assert.deepEqual(capHandicaps({aiHandicap:9}, 19), {aiHandicap:9});
});
