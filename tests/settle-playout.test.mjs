import test from "node:test";
import assert from "node:assert/strict";
import { BLACK, WHITE, at, boardHash, newGame, beginSoloScoring, play } from "../public/core.mjs";
import { damePoints, settleMax, settleStart, pickSettleMove, settleStep, deadFromPlayout, replayPlayout } from "../public/settle-playout.mjs";

// Black walls off the left, White the right; one white stone sits dead inside Black's area.
function position() {
  const board = Array(81).fill(0);
  for (let y = 0; y < 9; y++) { board[at(4, y)] = BLACK; board[at(5, y)] = WHITE; }
  board[at(1, 1)] = WHITE;
  return beginSoloScoring({ ...newGame(), board, history: [board.map(n => n + 1).join("")] });
}
const logits = (best = []) => {
  const policy = Array(81).fill(-20);
  best.forEach((p, rank) => policy[p] = 10 - rank);
  return policy;
};

test("only a runaway guard of four thirds of the board stops a playout before two passes", () => {
  assert.deepEqual([9, 13, 19].map(settleMax), [108, 225, 481]);
});

test("the playout starts from the scoring position without touching the match", () => {
  const game = position();
  const start = settleStart(game);
  assert.equal(start.status, "playing");
  assert.equal(game.status, "scoring");
  assert.deepEqual(start.board, game.board);
});

test("KataGo's best legal move is played; occupied points, eyes and a stronger pass are skipped", () => {
  const start = settleStart(position());
  assert.equal(pickSettleMove(start, logits([at(4, 4), at(0, 1)]), -5), at(0, 1));
  assert.equal(pickSettleMove(start, logits([at(0, 1)]), 20), null);
  // A point surrounded by the mover's own stones is never filled.
  const eye = { ...start, board: [...start.board] };
  for (const p of [at(0, 1), at(1, 0), at(2, 1), at(1, 2)]) eye.board[p] = BLACK;
  eye.board[at(1, 1)] = 0;
  assert.equal(pickSettleMove(eye, logits([at(1, 1)]), -15), null);
});

test("instead of passing, the mover fills the liberties of stones its ownership calls dead", () => {
  const start = settleStart(position());
  const ownership = Array(81).fill(0);
  for (let x = 0; x < 4; x++) for (let y = 0; y < 9; y++) ownership[at(x, y)] = 0.95;
  // Black to move; KataGo would pass, but the dead white stone at (1,1) is still on the board.
  const move = pickSettleMove(start, logits([at(0, 1)]), 20, ownership);
  assert.equal(move, at(0, 1));
  assert.equal(pickSettleMove(start, logits([at(0, 1)]), 20, Array(81).fill(0)), null);
});

test("stones the playout captured are dead, whole groups only", () => {
  const game = position();
  let state = settleStart(game);
  const moves = [at(0, 1), null, at(1, 0), null, at(2, 1), null, at(1, 2)];
  for (const p of moves) state = settleStep(state, p);
  assert.equal(state.board[at(1, 1)], 0);
  assert.deepEqual(deadFromPlayout(game, state.board, null), [at(1, 1)]);
  // Two passes in a row end the playout.
  const ended = settleStep(settleStep(state, null), null);
  assert.equal(ended.status, "settled");
  assert.equal(replayPlayout(game, [...moves, null, null]).length, moves.length + 3);
});

test("a group left on the board is dead only when ownership firmly gives it away", () => {
  const game = position();
  const ownership = Array(81).fill(0);
  ownership[at(1, 1)] = 0.95;
  assert.deepEqual(deadFromPlayout(game, game.board, ownership), [at(1, 1)]);
  ownership[at(1, 1)] = 0.5;
  assert.deepEqual(deadFromPlayout(game, game.board, ownership), []);
});

test("a received playout is replayed only if every move is legal", () => {
  const game = position();
  assert.equal(replayPlayout(game, [at(4, 4)]), null);
  assert.equal(replayPlayout(game, [999]), null);
  assert.equal(replayPlayout(game, "x"), null);
  assert.equal(replayPlayout(game, Array(40).fill(null)), null);
  assert.equal(replayPlayout(game, [at(0, 1)])[1].board[at(0, 1)], BLACK);
});

test("before passing, the mover fills the dame between the two sides", () => {
  const board = Array(81).fill(0);
  for (let y = 0; y < 9; y++) { board[at(3, y)] = BLACK; board[at(5, y)] = WHITE; }
  const start = settleStart(beginSoloScoring({ ...newGame(), board, history: [board.map(n => n + 1).join("")] }));
  // KataGo would pass; column 4 touches both walls, so it is dame.
  const move = pickSettleMove(start, logits([at(4, 6), at(0, 0)]), 20, Array(81).fill(0));
  assert.equal(move, at(4, 6));
  assert.equal(damePoints(start).size, 9);
  // Points inside one side's area are never dame.
  assert.ok(!damePoints(start).has(at(0, 0)));
});

test("a dame fill that would put the mover's own group in atari is left open", () => {
  // Black (0,0)-(1,0) and White (0,1)-(1,1)... a shared liberty at (2,0) and (2,1) in a corner seki-like shape.
  const board = Array(81).fill(0);
  board[at(0, 0)] = BLACK; board[at(1, 0)] = BLACK; board[at(0, 1)] = WHITE; board[at(1, 1)] = WHITE;
  board[at(3, 0)] = WHITE; board[at(2, 1)] = WHITE; board[at(2, 2)] = BLACK; board[at(1, 2)] = BLACK; board[at(0, 2)] = BLACK;
  const start = settleStart(beginSoloScoring({ ...newGame(), board, history: [board.map(n => n + 1).join("")] }));
  // Black's corner pair has one liberty left at (2,0); filling it would be its last.
  assert.ok(!damePoints(start).has(at(2, 0)));
});

test("the playout never plays inside an area KataGo calls settled, except to close its own border", () => {
  const start = settleStart(position());
  // Without the dead white stone, nothing is left to capture.
  start.board = [...start.board];
  start.board[at(1, 1)] = 0;
  const ownership = Array(81).fill(0);
  for (let y = 0; y < 9; y++) {
    for (let x = 0; x < 4; x++) ownership[at(x, y)] = 0.95;
    for (let x = 6; x < 9; x++) ownership[at(x, y)] = -0.95;
  }
  // Black to move: a ko threat in White's settled area and a move inside its own are both skipped.
  assert.equal(pickSettleMove(start, logits([at(7, 4), at(2, 6), at(3, 2)]), -15, ownership), null);
  // An open point is still played.
  ownership[at(2, 6)] = 0.5;
  assert.equal(pickSettleMove(start, logits([at(7, 4), at(2, 6)]), -15, ownership), at(2, 6));
  // A settled point of one's own next to an opponent stone closes the border.
  const border = { ...start, board: [...start.board] };
  border.board[at(4, 7)] = 0;
  border.board[at(5, 7)] = WHITE;
  ownership[at(4, 7)] = 0.9;
  assert.equal(pickSettleMove(border, logits([at(7, 4), at(4, 7)]), -15, ownership), at(4, 7));
});

test("a dame the opponent's area already holds is left for the opponent to fill", () => {
  const board = Array(81).fill(0);
  for (let y = 0; y < 9; y++) { board[at(3, y)] = BLACK; board[at(5, y)] = WHITE; }
  const start = settleStart(beginSoloScoring({ ...newGame(), board, history: [board.map(n => n + 1).join("")] }));
  const ownership = Array(81).fill(0);
  for (let y = 0; y < 9; y++) ownership[at(4, y)] = -0.9;
  assert.equal(pickSettleMove(start, logits([at(4, 4)]), 20, ownership), null);
  assert.equal(pickSettleMove({ ...start, next: WHITE }, logits([at(4, 4)]), 20, ownership.map(v => v)), at(4, 4));
});

test("the playout never brings back a board it has already had", () => {
  const start = settleStart(position());
  const after = play(start, at(0, 1));
  // The board after Black's move at (0,1) is marked as seen: that move is skipped for the next one.
  const seen = { ...start, history: [...start.history, boardHash(after.board)] };
  assert.equal(pickSettleMove(seen, logits([at(0, 1), at(2, 6)]), -15), at(2, 6));
});
