import test from "node:test";
import assert from "node:assert/strict";
import { newGame, play, group, at, boardHash, areaScore, toggleDead, resume, agreeScore } from "../public/core.mjs";
import { exportSGF } from "../public/sgf.mjs";

test("initial game and alternating moves", () => {
  let g = newGame(); g = play(g, at(0, 0)); g = play(g, at(1, 0));
  assert.equal(g.board[0], 1);
  assert.equal(g.board[1], -1);
  assert.equal(g.next, 1);
  assert.equal(g.moveNumber, 2);
  assert.throws(() => play(g, at(0, 0)));
});
test("captures a group and forbids suicide", () => {
  const g = newGame();
  g.board[at(1, 1)] = -1;
  for (const p of [at(1, 0), at(0, 1), at(2, 1)]) g.board[p] = 1;
  g.history = [boardHash(g.board)];
  const next = play(g, at(1, 2));
  assert.equal(next.board[at(1, 1)], 0);
  assert.equal(next.captures.black, 1);
  assert.equal(group(next.board, at(1, 2)).stones.size, 1);
  const suicide = newGame();
  for (const p of [at(1, 0), at(0, 1), at(2, 1), at(1, 2)]) suicide.board[p] = -1;
  suicide.history = [boardHash(suicide.board)];
  assert.throws(() => play(suicide, at(1, 1)), /自殺手/);
});
test("two passes, dead marking and double acceptance", () => {
  let g = newGame(); g = play(g, at(4, 4)); g = play(g, null); g = play(g, null);
  assert.equal(g.status, "scoring");
  const s = areaScore(g);
  assert.equal(s.black, 81);
  assert.equal(s.white, 7.5);
  g = toggleDead(g, at(4, 4)); assert.equal(areaScore(g).black, 0);
  g = agreeScore(g, 1); assert.equal(g.status, "scoring");
  g = agreeScore(g, -1); assert.equal(g.status, "finished");
});
test("passes are written to SGF as empty moves", () => {
  let g = play(newGame(), at(3, 3)); g = play(g, null);
  assert.match(exportSGF(g), /;B\[dd\];W\[\]/);
});

test("dead marks from a resumed count do not carry into the next count", () => {
  let g = play(newGame(), 40);
  g = play(play(g, null), null);
  g = toggleDead(g, 40);
  assert.deepEqual(resume(g).dead, []);
  // Saves written before resume() cleared marks are reset on the next two passes.
  g = play({ ...resume(g), dead: [40] }, 0);
  g = play(play(g, null), null);
  assert.equal(g.status, "scoring");
  assert.deepEqual(g.dead, []);
});
