import test from "node:test";
import assert from "node:assert/strict";
import { at, newGame, BLACK, WHITE } from "../public/core.mjs";
import { formatBoardForAi, formatBoardSection, AI_BOARD_LEGEND, AI_SELECTED_POINT } from "../public/board-text.mjs";
import {source} from "./helpers/source.mjs";

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
});
test("every AI handoff lays out its board the same way and shares one URL check",()=>{
  const board=Array(81).fill(0);board[40]=1;
  assert.equal(formatBoardSection("現在の盤面",board).split("\n").slice(0,3).join("\n"),
    AI_BOARD_LEGEND+"\n\n現在の盤面：");
  assert.match(formatBoardSection("現在の盤面",Array(81).fill(0),{selectedPosition:0}),
    new RegExp(AI_SELECTED_POINT+"\n\n現在の盤面：\n◇ "));
  const clipboard=source("clipboard.mjs");
  const app=source("app.mjs");
  assert.equal((clipboard.match(/navigator\.clipboard\.writeText/g)||[]).length,1);
  assert.doesNotMatch(app,/navigator\.clipboard\.writeText/);
  for(const file of ["illegal-moves.mjs","beginner-prompts.mjs","sgf-link.mjs"]){
    assert.match(source(file),/formatBoardSection\(/);
    assert.match(source(file),/shareableReviewUrl\(/);
  }
});
