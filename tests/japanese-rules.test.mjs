import test from "node:test";
import assert from "node:assert/strict";
import { BLACK, WHITE, at, newGame, initialGame, play, areaScore, territoryScore, sekiStones,
  whiteCompensation, komiOf, toSGF, beginSoloScoring, finalizeSoloScore } from "../public/core.mjs";
import { parseSGF, exportSGF, replaySteps } from "../public/sgf.mjs";
import { scoreRows, scoreBreakdown, scoringRegions } from "../public/scoring-regions.mjs";
import { TEXT } from "../public/texts.mjs";

const japanese = (extra = {}) => ({ ...newGame(true, { rules: "japanese" }), status: "scoring", ...extra });

test("Japanese games default to 6.5 komi; handicap games get 0.5 and no per-stone bonus", () => {
  const even = newGame(true, { rules: "japanese" });
  assert.equal(even.rules, "japanese");
  assert.equal(komiOf(even), 6.5);
  const handicap = newGame(true, { rules: "japanese", handicap: 3 });
  assert.equal(whiteCompensation(handicap), 0.5);
  assert.equal(whiteCompensation(newGame(true, { handicap: 3 })), 3.5);
  assert.equal(newGame().rules, "chinese");
  assert.equal(initialGame(even).rules, "japanese");
  // Records saved before rules existed stay Chinese.
  const { rules, ...legacy } = newGame();
  assert.equal(komiOf(legacy), 7.5);
  assert.equal(areaScore({ ...legacy, status: "scoring" }).white, 7.5 + 0);
});

test("territory counts empty points and prisoners, not stones on the board", () => {
  // Black owns columns 0-3 (walls on column 3), White columns 5-8 (wall on 5); column 4 is dame.
  const board = Array(81).fill(0);
  for (let y = 0; y < 9; y++) { board[at(3, y)] = BLACK; board[at(5, y)] = WHITE; }
  const game = japanese({ board, captures: { black: 2, white: 1 } });
  const score = territoryScore(game);
  assert.deepEqual(score.territory, { black: 27, white: 27 });
  assert.deepEqual(score.prisoners, { black: 2, white: 1 });
  assert.equal(score.black, 29);
  assert.equal(score.white, 27 + 1 + 6.5);
  assert.equal(areaScore(game).difference, score.difference);
  // A dead white stone in Black's area is a prisoner and its point is territory.
  board[at(1, 1)] = WHITE;
  const withDead = territoryScore(japanese({ board, dead: [at(1, 1)], captures: { black: 2, white: 1 } }));
  assert.equal(withDead.territory.black, 27);
  assert.equal(withDead.prisoners.black, 3);
  assert.deepEqual(sekiStones(japanese({ board, dead: [at(1, 1)] })), []);
});

test("points enclosed by stones in seki are not territory", () => {
  // One eye each and one shared liberty in the top-left corner.
  //   x: 0 1 2 3
  // y0:  . B . W .        (0,0) Black eye, (2,0) shared, (4,0) White eye
  // y1:  B B W W W ...
  const g = Array(81).fill(0);
  const p = (c, ...pts) => pts.forEach(([x, y]) => g[at(x, y)] = c);
  p(BLACK, [1, 0], [0, 1], [1, 1], [2, 1]);
  p(WHITE, [3, 0], [3, 1], [4, 1], [5, 1], [5, 0]);
  // Outside: White surrounds Black from below, Black surrounds White from below.
  p(WHITE, [0, 2], [1, 2], [2, 2]);
  p(BLACK, [3, 2], [4, 2], [5, 2], [6, 1], [6, 0]);
  // Black (1,0),(0,1),(1,1),(2,1) liberties: (0,0) eye, (2,0) shared  -> 2
  // White (3,0),(3,1),(4,1),(5,1),(5,0) liberties: (2,0) shared, (4,0) eye -> 2
  const game = japanese({ board: g });
  const inSeki = new Set(sekiStones(game));
  assert.ok(inSeki.has(at(1, 0)) && inSeki.has(at(3, 0)));
  const owned = territoryScore(game).owned;
  assert.equal(owned[at(0, 0)], 0, "Black's eye in seki is not territory");
  assert.equal(owned[at(4, 0)], 0, "White's eye in seki is not territory");
  assert.equal(owned[at(2, 0)], 0);
  // Under Chinese area scoring the same eyes do count.
  assert.equal(areaScore({ ...game, rules: "chinese" }).owned[at(0, 0)], BLACK);
});

test("ordinary dame next to healthy groups is not mistaken for seki", () => {
  const board = Array(81).fill(0);
  for (let y = 0; y < 9; y++) { board[at(3, y)] = BLACK; board[at(4, y)] = WHITE; }
  assert.deepEqual(sekiStones(japanese({ board })), []);
});

test("scoreboard rows and labels follow territory scoring", () => {
  const board = Array(81).fill(0);
  for (let y = 0; y < 9; y++) { board[at(3, y)] = BLACK; board[at(5, y)] = WHITE; }
  const game = japanese({ board, captures: { black: 2, white: 1 } });
  assert.deepEqual(scoreRows(game), {
    black: { area: 27, detail: "27＋アゲハマ2", total: 29 },
    white: { area: 27, detail: "27＋アゲハマ1＋コミ6.5", total: 34.5 }, leader: "white" });
  assert.equal(scoreBreakdown(game), "黒：27＋アゲハマ2＝29\n白：27＋アゲハマ1＋コミ6.5＝34.5");
  const labels = scoringRegions(game).regions.map(r => r.count).sort((a, b) => a - b);
  assert.deepEqual(labels, [27, 27]);
});

test("captures, finishing and SGF keep the Japanese ruleset", () => {
  let game = newGame(true, { rules: "japanese" });
  // Black captures a white stone at (0,0).
  for (const p of [at(1, 0), at(0, 0), at(0, 1)]) game = play(game, p);
  assert.equal(game.captures.black, 1);
  const done = finalizeSoloScore(beginSoloScoring(game));
  assert.match(done.result, /^[BW]\+/);
  assert.match(toSGF(done), /RU\[Japanese\]KM\[6\.5\]|KM\[6\.5\]RU\[Japanese\]/);
  const sgf = exportSGF(done);
  assert.match(sgf, /RU\[Japanese\]/);
  const parsed = parseSGF(sgf);
  assert.equal(parsed.snapshot.rules, "japanese");
  assert.equal(replaySteps(parsed.snapshot).captures.black, 1);
  assert.equal(parseSGF("(;GM[1]FF[4]SZ[9]RU[Chinese];B[ee])").snapshot.rules, "chinese");
});

test("rule texts describe the Japanese choice", () => {
  assert.match(TEXT.game.ruleSummary(9, 6.5, 0, true), /日本式ルール · コミ6.5/);
  assert.match(TEXT.prompts.ruleLine(6.5, 0, true), /日本ルール.*アゲハマ/);
  assert.equal(TEXT.newGame.rulesChoices.japanese, "日本式");
});
