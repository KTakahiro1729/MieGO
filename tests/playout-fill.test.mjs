import test from "node:test";
import assert from "node:assert/strict";
import { BLACK, WHITE, at, newGame, beginSoloScoring, areaScore, countingBoard, fillStones, resume,
  withPlayoutFill } from "../public/core.mjs";
import { replayPlayout, settleMax } from "../public/settle-playout.mjs";
import { scoringRegions } from "../public/scoring-regions.mjs";

// The players stopped early: Black's wall on column 3 and White's on column 5
// reach only halfway down, so the bottom of the board touches both colours.
function earlyEnd(rules = "chinese") {
  const board = Array(81).fill(0);
  for (let y = 0; y < 5; y++) { board[at(3, y)] = BLACK; board[at(5, y)] = WHITE; }
  return beginSoloScoring({ ...newGame(true, { rules }), board });
}
// Where the playout closed the walls, plus one black stone it put inside Black's own area.
function settled(game) {
  const board = [...game.board];
  for (let y = 5; y < 9; y++) { board[at(3, y)] = BLACK; board[at(5, y)] = WHITE; }
  board[at(1, 1)] = BLACK;
  return board;
}

test("the real board alone leaves an early end almost all neutral", () => {
  const score = areaScore(earlyEnd());
  assert.equal(score.owned.filter(o => o === 0).length, 71);
  assert.deepEqual([score.black, score.white], [5, 5 + 7.5]);
});

test("the playout's stones close the open borders, so the count decides the territory", () => {
  const game = withPlayoutFill(earlyEnd(), settled(earlyEnd()));
  const score = areaScore(game);
  // Columns 0-3 are Black's, 5-8 White's; the dame column 4 is neutral, and so
  // are the fill stones, played after the players stopped.
  assert.deepEqual([score.black, score.white], [32, 32 + 7.5]);
  assert.equal(score.owned.filter(o => o === 0).length, 9 + 8);
  assert.equal(scoringRegions(game).regions.find(r => r.color === BLACK).count, 32);
});

test("under area scoring an odd number of filled dame gives nobody the odd point", () => {
  // Full walls on columns 3 and 5 leave the 9 dame of column 4.
  const board = Array(81).fill(0);
  for (let y = 0; y < 9; y++) { board[at(3, y)] = BLACK; board[at(5, y)] = WHITE; }
  const game = beginSoloScoring({ ...newGame(true), board });
  const filled = first => {
    const settled = [...board];
    for (let y = 0; y < 9; y++) settled[at(4, y)] = y % 2 ? -first : first;
    return areaScore(withPlayoutFill(game, settled)).difference;
  };
  // Whoever fills first (the side that passed first), the result is the unfilled one.
  assert.equal(filled(BLACK), areaScore(game).difference);
  assert.equal(filled(WHITE), areaScore(game).difference);
  assert.equal(areaScore(game).difference, 36 - 36 - 7.5);
});

test("a fill stone inside its own territory counts as that territory, not as a border", () => {
  const game = withPlayoutFill(earlyEnd("japanese"), settled(earlyEnd()));
  assert.ok(!fillStones(game).some(s => s.position === at(1, 1)));
  assert.equal(countingBoard(game)[at(1, 1)], 0);
  assert.deepEqual(fillStones(game).filter(s => s.color === BLACK).map(s => s.position),
    [5, 6, 7, 8].map(y => at(3, y)));
  const score = areaScore(game);
  assert.deepEqual(score.territory, { black: 27, white: 27 });
});

test("fill stones only stand on empty points and leave with the count", () => {
  const game = earlyEnd(), board = settled(game);
  board[at(5, 0)] = BLACK; // a point White occupies in the match
  const filled = withPlayoutFill(game, board);
  assert.equal(filled.fill[at(5, 0)], 0);
  assert.equal(countingBoard(filled)[at(5, 0)], WHITE);
  assert.equal("fill" in resume(filled), false);
  assert.equal("fill" in withPlayoutFill(filled, null), false);
  // A fill that does not fit the board is ignored.
  assert.deepEqual(fillStones({ ...game, fill: [1, 1] }), []);
});

test("a long playout is accepted from the friend who ran it, up to the runaway guard", () => {
  const game = earlyEnd();
  // Each side fills its own area, point by point.
  const left = [], right = [];
  for (let y = 0; y < 9; y++) for (let x = 0; x < 3; x++) { left.push(at(x, y)); right.push(at(x + 6, y)); }
  const positions = left.flatMap((p, i) => [p, right[i]]).slice(0, 31);
  assert.ok(positions.length <= settleMax(9));
  assert.ok(replayPlayout(game, positions));
  assert.equal(replayPlayout(game, Array(settleMax(9) + 1).fill(at(0, 0))), null);
});
