import test from "node:test";
import assert from "node:assert/strict";
import { at, newGame, BLACK, WHITE } from "../public/core.mjs";
import { formatBoardForAi, AI_BOARD_LEGEND, AI_SELECTED_POINT } from "../public/board-text.mjs";

test("AI glyph diagrams use ●, ○, ・ without coordinate labels",()=>{
  const game=newGame();
  game.board[at(3,3)]=BLACK;
  game.board[at(4,4)]=WHITE;
  const rows=formatBoardForAi(game.board).split("\n");
  assert.equal(rows.length,9);
  assert.ok(rows.every(row=>row.split(" ").length===9));
  assert.equal(rows[3].split(" ")[3],"●");
  assert.equal(rows[4].split(" ")[4],"○");
  assert.equal((formatBoardForAi(game.board).match(/●/g)||[]).length,1);
  assert.equal((formatBoardForAi(game.board).match(/○/g)||[]).length,1);
  assert.equal((formatBoardForAi(game.board).match(/・/g)||[]).length,79);
  assert.doesNotMatch(formatBoardForAi(game.board),/[A-Z0-9]/);
  assert.match(AI_BOARD_LEGEND,/●=黒、○=白、・=空点/);
});
test("illegal candidate gets a ◇ marker instead of a coordinate",()=>{
  const game=newGame(),p=at(4,4);
  const diagram=formatBoardForAi(game.board,{selectedPosition:p});
  assert.equal(diagram.split("\n")[4].split(" ")[4],"◇");
  assert.equal((diagram.match(/◇/g)||[]).length,1);
  assert.match(AI_SELECTED_POINT,/◇=打とうとした空点/);
  assert.throws(()=>formatBoardForAi(game.board,{selectedPosition:-1}));
  game.board[p]=BLACK;
  assert.throws(()=>formatBoardForAi(game.board,{selectedPosition:p}));
});
test("unknown board shapes and colors are rejected",()=>{
  assert.throws(()=>formatBoardForAi(null));
  assert.throws(()=>formatBoardForAi(Array(9).fill(0)));
  assert.throws(()=>formatBoardForAi(Array(81).fill(5)));
});
