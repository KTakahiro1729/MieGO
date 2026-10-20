import test from "node:test";
import assert from "node:assert/strict";
import {at,newGame,play} from "../public/core.mjs";
import {boardThumbnailSvg,recordThumbnailSvg} from "../public/board-thumbnail.mjs";

const stones=(svg,fill)=>svg.match(new RegExp(`<circle[^>]*r="4\\.[46]"[^>]*fill="${fill}"`,"g"))?.length??0;

test("thumbnail draws every stone of the saved position and marks the last move",()=>{
  let game=newGame();
  game=play(game,at(2,2));game=play(game,at(6,6));game=play(game,at(4,4));
  const svg=recordThumbnailSvg({snapshot:game});
  assert.match(svg,/^<svg viewBox="0 0 90 90"/);
  assert.equal(stones(svg,"#1c2427"),2);
  assert.equal(stones(svg,"#f8f6ee"),1);
  assert.match(svg,/<rect x="43\.2" y="43\.2" width="3\.6"/,"last move at the center is marked");
});

test("a trailing pass leaves no last-move marker and an empty board shows no stones",()=>{
  const passed=play(play(newGame(),at(0,0)),null);
  assert.doesNotMatch(recordThumbnailSvg({snapshot:passed}),/width="3\.6"/);
  const empty=boardThumbnailSvg(newGame().board);
  assert.equal(stones(empty,"#1c2427")+stones(empty,"#f8f6ee"),0);
});

test("thumbnail never emits markup from board values",()=>{
  const board=Array(81).fill(0);board[0]="<script>";
  assert.doesNotMatch(boardThumbnailSvg(board),/script/);
});

test("13x13 and 19x19 thumbnails share the 90x90 view box with scaled spacing",()=>{
  const big=play(newGame(true,{size:19}),at(18,18,19));
  const svg=recordThumbnailSvg({snapshot:big});
  assert.match(svg,/^<svg viewBox="0 0 90 90"/);
  assert.equal((svg.match(/<circle[^>]*fill="#1c2427"/g)||[]).length,1);
  assert.match(svg,/<circle cx="85" cy="85"/,"the far corner sits on the last line");
  assert.equal((svg.match(/fill="#685537"\/>/g)||[]).length,9,"19x19 has nine star points");
  assert.doesNotThrow(()=>boardThumbnailSvg(newGame(true,{size:13}).board));
});
