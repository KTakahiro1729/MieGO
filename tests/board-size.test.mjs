import test from "node:test";
import assert from "node:assert/strict";
import {newGame,play,at,areaScore,sizeOf,handicapPoints,starPoints,initialGame,toSGF,BLACK,WHITE}
  from "../public/core.mjs";
import {scoringRegions} from "../public/scoring-regions.mjs";
import {legalAiMoves} from "../public/ai-opponent.mjs";
import {formatBoardForAi} from "../public/board-text.mjs";
import {parseGameSnapshot} from "../public/mode-state.mjs";
import {replaySteps} from "../public/sgf.mjs";

test("new games are created at 9, 13 or 19 and other sizes are not restored",()=>{
  for(const size of [9,13,19]){
    const game=newGame(true,{size});
    assert.equal(game.board.length,size*size);
    assert.equal(sizeOf(game.board),size);
    assert.ok(parseGameSnapshot(JSON.stringify(game)));
  }
  assert.equal(newGame().board.length,81,"the default stays 9x9");
  assert.equal(parseGameSnapshot(JSON.stringify({...newGame(),board:Array(100).fill(0)})),null);
});

test("captures and edges use the board's own size",()=>{
  // Corner capture on the far corner of 19x19; with a 9x9 neighbour table the
  // stone at (18,18) would look connected to unrelated points.
  let g=newGame(true,{size:19});
  for(const p of [at(18,17,19),at(18,18,19),at(17,18,19)])g=play(g,p);
  assert.equal(g.board[at(18,18,19)],0);
  assert.equal(g.captures.black,1);
  // A stone on the left edge has no neighbour on the previous row's right edge.
  let h=newGame(true,{size:13});
  h=play(h,at(0,5,13));
  assert.equal(h.board[at(12,4,13)],0);
});

test("handicap and star points follow the standard placement on every size",()=>{
  const xy=(size,points)=>points.map(p=>[p%size,Math.floor(p/size)]);
  assert.deepEqual(xy(9,handicapPoints(9,5)),[[6,2],[2,6],[6,6],[2,2],[4,4]]);
  assert.deepEqual(xy(19,handicapPoints(19,6)),[[15,3],[3,15],[15,15],[3,3],[3,9],[15,9]]);
  assert.deepEqual(xy(19,handicapPoints(19,7)).at(-1),[9,9],"seven adds tengen");
  assert.equal(new Set(handicapPoints(19,9)).size,9);
  assert.deepEqual(xy(13,starPoints(13)),[[9,3],[3,9],[9,9],[3,3],[6,6]]);
  assert.equal(starPoints(19).length,9);
  const g=newGame(true,{size:19,handicap:9});
  assert.equal(g.board.filter(v=>v===BLACK).length,9);
  assert.equal(g.next,WHITE);
  assert.equal(newGame(true,{size:9,handicap:9}).handicap,0,"9x9 still allows at most five stones");
});

test("scoring, AI candidates, text boards and replays scale to the board",()=>{
  const g=play(newGame(true,{size:13}),at(6,6,13));
  assert.equal(areaScore(g).black,169,"a lone stone owns the whole 13x13 area");
  const regions=scoringRegions({...g,status:"scoring",dead:[]});
  assert.equal(regions.regions[0].count,169);
  assert.equal(legalAiMoves(newGame(true,{size:19})).length,361);
  const text=formatBoardForAi(g.board).split("\n");
  assert.equal(text.length,13);
  assert.equal(text[0].split(" ").length,13);
  assert.equal(initialGame(g).board.length,169);
  assert.equal(replaySteps(g).board.join(""),g.board.join(""));
  assert.match(toSGF(g),/SZ\[13\].*;B\[gg\]/);
});
