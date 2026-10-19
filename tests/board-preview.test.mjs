import test from "node:test";
import assert from "node:assert/strict";
import { at, boardHash, newGame, play } from "../public/core.mjs";
import { stoneForPreview } from "../public/board-preview.mjs";

test("provisional capture keeps an opponent stone visible but marked as captured", () => {
  const game = newGame();
  game.board[at(1, 1)] = -1;
  for (const point of [at(1, 0), at(0, 1), at(2, 1)]) game.board[point] = 1;
  game.history = [boardHash(game.board)];
  const candidate = play(game, at(1, 2));
  assert.equal(candidate.board[at(1, 1)], 0);
  assert.deepEqual(stoneForPreview(game.board, candidate.board, at(1, 1)),
    { color: -1, captured: true });
  assert.deepEqual(stoneForPreview(game.board, candidate.board, at(1, 2)),
    { color: 1, captured: false });
  assert.deepEqual(stoneForPreview(game.board, candidate.board, at(1, 0)),
    { color: 1, captured: false });
  assert.deepEqual(stoneForPreview(candidate.board, null, at(1, 1)),
    { color: 0, captured: false });
  assert.deepEqual(stoneForPreview(game.board, null, at(1, 1)),
    { color: -1, captured: false });
});

test("all stones in a captured group stay visible during preview", () => {
  const game = newGame();
  const taken = [at(1, 1), at(2, 1)];
  for (const point of taken) game.board[point] = -1;
  for (const point of [at(1, 0), at(2, 0), at(0, 1), at(3, 1), at(1, 2)]) game.board[point] = 1;
  game.history = [boardHash(game.board)];
  const candidate = play(game, at(2, 2));
  for (const point of taken) {
    assert.equal(candidate.board[point], 0);
    assert.deepEqual(stoneForPreview(game.board, candidate.board, point),
      { color: -1, captured: true });
  }
});
