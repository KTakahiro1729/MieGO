import test from "node:test";
import assert from "node:assert/strict";
import {
  BLACK,
  WHITE,
  agreeScore,
  areaScore,
  at,
  boardHash,
  group,
  groups,
  newGame,
  play,
  resume,
  toggleDead,
} from "../public/core.mjs";
import {
  exportSGF,
  parseSGF,
  replaySteps,
} from "../public/sgf.mjs";

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

test("対局を再開: the opponent of the side that resumes moves first", () => {
  // Black plays, then White and Black pass: Black, who passed last, is not to move.
  const g = play(play(play(newGame(), 40), null), null);
  assert.equal(g.status, "scoring");
  assert.equal(g.next, WHITE);
  assert.equal(resume(g, WHITE).next, BLACK);
  assert.equal(resume(g, BLACK).next, WHITE);
  // Nobody in particular asks on one board for two players: the turn stays.
  assert.equal(resume(g).next, WHITE);
  // A record with the resumer's opponent moving first replays, and exports and imports again.
  const resumed = play(resume(g, WHITE), 0);
  assert.equal(resumed.moves.at(-1).color, BLACK);
  assert.equal(replaySteps(resumed).next, WHITE);
  assert.equal(parseSGF(exportSGF(resumed)).snapshot.board[0], BLACK);
});

test("groups yields every group of stones once, with its colour and liberties", () => {
  const board = Array(81).fill(0);
  board[at(0, 0, 9)] = 1; board[at(1, 0, 9)] = 1; board[at(0, 1, 9)] = -1; board[at(4, 4, 9)] = 1;
  const found = [...groups(board)].map(({ color, stones, liberties }) => [color, [...stones].sort((a, b) => a - b), liberties.size]);
  assert.deepEqual(found, [[1, [0, 1], 2], [-1, [9], 2], [1, [40], 4]]);
});
