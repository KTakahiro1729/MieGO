import test from "node:test";
import assert from "node:assert/strict";
import { at, newGame, BLACK, WHITE } from "../public/core.mjs";
import { formatBoardForAi, AI_BOARD_LEGEND } from "../public/board-text.mjs";

test("AI board glyphs mark black ●, white ○, empty ・ and align 9x9 coordinates",()=>{
  const game=newGame();
  game.board[at(3,3)]=BLACK; // D6
  game.board[at(4,4)]=WHITE; // E5
  const rows=formatBoardForAi(game.board).split("\n");
  assert.equal(rows.length,10);
  assert.match(rows[0],/A B C D E F G H J/);
  assert.equal(rows[4].trim().split(/\s+/)[0],"6");
  assert.equal(rows[5].trim().split(/\s+/)[0],"5");
  assert.equal((formatBoardForAi(game.board).match(/●/g)||[]).length,1);
  assert.equal((formatBoardForAi(game.board).match(/○/g)||[]).length,1);
  assert.equal((formatBoardForAi(game.board).match(/・/g)||[]).length,79);
  assert.match(AI_BOARD_LEGEND,/●=黒、○=白、・=空点/);
});
test("invalid board shapes and unknown stone colors never produce misleading AI diagrams",()=>{
  assert.throws(()=>formatBoardForAi(null));
  assert.throws(()=>formatBoardForAi(Array(9).fill(0)));
  assert.throws(()=>formatBoardForAi(Array(81).fill(5)));
});
