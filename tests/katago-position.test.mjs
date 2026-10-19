import test from "node:test";
import assert from "node:assert/strict";
import { newGame, play, at } from "../public/core.mjs";
import { toKataGoPosition, fromBoardHash } from "../src/katago/position.mjs";

test("KataGo adapter encodes 9x9 Chinese-side stones and komi inputs", () => {
  let game = newGame();
  game = play(game, at(2, 2));
  game = play(game, at(5, 5));
  const a = toKataGoPosition(game);
  assert.equal(a.board[2][2], "black");
  assert.equal(a.board[5][5], "white");
  assert.equal(a.previousBoard[5][5], null);
  assert.equal(a.currentPlayer, "black");
  assert.deepEqual(a.moveHistory.map(m => m.player), ["black", "white"]);
  assert.equal(a.moveHistory[0].x, 2);
});
test("pass history is represented with (-1,-1)", () => {
  const g = play(play(newGame(), null), at(1, 1));
  const a = toKataGoPosition(g);
  assert.deepEqual(a.moveHistory[0], { x:-1, y:-1, player:"black" });
  assert.equal(a.currentPlayer, "black");
});
test("rejects mismatched history/invalid stones before neural feature extraction", () => {
  assert.throws(() => toKataGoPosition({board:[],moves:[],next:1}));
  assert.throws(() => fromBoardHash("010"));
});
test("13x13 and 19x19 positions keep their size and coordinates", () => {
  for (const size of [13, 19]) {
    const g = play(play(newGame(true, { size }), at(size - 1, 0, size)), null);
    const a = toKataGoPosition(g);
    assert.equal(a.size, size);
    assert.equal(a.board.length, size);
    assert.equal(a.board[0][size - 1], "black");
    assert.equal(a.previousBoard[0][size - 1], "black");
    assert.deepEqual(a.moveHistory[0], { x: size - 1, y: 0, player: "black" });
  }
  assert.throws(() => toKataGoPosition({ board: Array(100).fill(0), moves: [], next: 1 }));
});
