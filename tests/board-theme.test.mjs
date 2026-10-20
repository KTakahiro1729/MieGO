import test from "node:test";
import assert from "node:assert/strict";
import {BOARD_CUSTOM,boardColours,boardTheme,isBoardTheme,setCustomBoardColours} from "../public/board-theme.mjs";

test("the custom board is drawn from the four picked colours",()=>{
  assert.ok(isBoardTheme(BOARD_CUSTOM));
  assert.equal(setCustomBoardColours({board:"#F3E1E6",line:"#8a5a6a",black:"#1d2050",white:"#f0dfb8"}),true);
  const look=boardTheme(BOARD_CUSTOM);
  assert.deepEqual(look.surface,[243,225,230]);
  assert.deepEqual(look.fill,["#f3e1e6"]);
  assert.equal(look.line,"#8a5a6a");
  assert.equal(look.stones.black.outer,"#1d2050");
  assert.deepEqual(boardColours(BOARD_CUSTOM),{board:"#f3e1e6",line:"#8a5a6a",black:"#1d2050",white:"#f0dfb8"});
  // A bad colour leaves the board as it was.
  assert.equal(setCustomBoardColours({board:"red",line:"#000000",black:"#000000",white:"#ffffff"}),false);
  assert.equal(boardTheme(BOARD_CUSTOM).line,"#8a5a6a");
});

test("the pickers start from the chosen look's own colours",()=>{
  assert.deepEqual(boardColours("wood"),{board:"#e5c58c",line:"#685537",black:"#101718",white:"#ffffff"});
  // The dark board's translucent lines are shown as they look on the board.
  assert.match(boardColours("dark").line,/^#[0-9a-f]{6}$/);
  assert.equal(boardTheme("bogus"),boardTheme("wood"));
});
