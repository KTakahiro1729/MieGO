import test from "node:test";
import assert from "node:assert/strict";
import {BLACK,WHITE,newGame,at,areaScore,KOMI} from "../public/core.mjs";
import {scoringRegions,scoreBreakdown} from "../public/scoring-regions.mjs";

test("connected same-color area includes live stones and separated pockets joined by stones",()=>{
  const game={...newGame(),status:"scoring",board:Array(81).fill(WHITE)};
  // Two isolated empty pockets share a connected chain of surrounding stones.
  for(let y=3;y<=5;y++)for(let x=2;x<=6;x++)game.board[at(x,y)]=BLACK;
  for(const x of [3,5])game.board[at(x,4)]=0;
  const view=scoringRegions(game);
  const black=view.regions.filter(r=>r.color===BLACK);
  assert.equal(black.length,1);
  assert.equal(black[0].count,15);
  assert.equal(black[0].stones,13);
  assert.equal(black[0].territory,2);
  assert.deepEqual(new Set(black[0].positions).has(at(4,4)),true);
  assert.equal(view.regions.filter(r=>r.color===WHITE).length,1);
});
test("regions total equals Chinese area score excluding white komi, not just empty territory",()=>{
  const game={...newGame(),status:"scoring",board:Array(81).fill(WHITE)};
  for(let y=3;y<=5;y++)for(let x=2;x<=6;x++)game.board[at(x,y)]=BLACK;
  game.board[at(3,4)]=0;game.board[at(5,4)]=0;
  const score=areaScore(game),regions=scoringRegions(game).regions;
  assert.equal(regions.filter(x=>x.color===BLACK).reduce((n,r)=>n+r.count,0),score.black);
  assert.equal(regions.filter(x=>x.color===WHITE).reduce((n,r)=>n+r.count,0),score.white-KOMI);
  assert.ok(regions.every(r=>Number.isInteger(r.position)&&r.positions.includes(r.position)));
});
test("dead stones become countable points but are no longer live stones",()=>{
  const game={...newGame(),status:"scoring",board:Array(81).fill(WHITE)};
  game.board[at(4,4)]=BLACK;game.dead=[at(4,4)];
  const view=scoringRegions(game);
  assert.equal(view.regions.length,1);
  assert.equal(view.regions[0].color,WHITE);
  assert.equal(view.regions[0].count,81);
  assert.equal(view.regions[0].stones,80);
  assert.equal(view.regions[0].territory,1);
});
test("neutral regions do not create artificial stones or region labels",()=>{
  const game={...newGame(),status:"scoring"};
  assert.equal(scoringRegions(game).regions.length,0);
  assert.ok(scoringRegions(game).filled.every(c=>c===0));
});

import {createBoardRenderer} from "../public/board-renderer.mjs";
test("renderer paints one area label per connected region only for scored games",()=>{
  const game={...newGame(),status:"scoring",board:Array(81).fill(WHITE)};
  for(let y=3;y<=5;y++)for(let x=2;x<=6;x++)game.board[at(x,y)]=BLACK;
  game.board[at(3,4)]=0;game.board[at(5,4)]=0;
  const labels=[];
  const ctx={
    save(){},restore(){},clearRect(){},fillRect(){},strokeText(){},beginPath(){},moveTo(){},
    lineTo(){},arc(){},fill(){},stroke(){},setLineDash(){},fillText(t){labels.push(t);},
    createRadialGradient(){return {addColorStop(){}}}
  };
  const canvas={width:720,getContext:()=>ctx};
  const renderer=createBoardRenderer({canvas,
    getView:()=>({game,boardReview:null,candidate:null,lastPosition:null,
      displayedOwnership:null,palette:"mono",opacity:.55,humanTurn:false}),
    createOverlayCanvas:()=>({getContext:()=>({})})
  });
  renderer.draw();
  assert.deepEqual(labels.sort(),["15","66"].sort());
  game.status="playing";labels.length=0;renderer.draw();
  assert.equal(labels.length,0);
  game.status="finished";game.result="W+R";labels.length=0;renderer.draw();
  assert.equal(labels.length,0,"resignation has no invented area score");
});

test("scoring overlay is never drawn in active game replay",()=>{
  const state={...newGame(),status:"scoring",board:Array(81).fill(WHITE)};
  const labels=[];
  const ctx={
    save(){},restore(){},clearRect(){},fillRect(){},strokeText(){},beginPath(){},
    moveTo(){},lineTo(){},arc(){},fill(){},stroke(){},setLineDash(){},
    fillText(text){labels.push(text);},createRadialGradient(){return {addColorStop(){}};}
  };
  const renderer=createBoardRenderer({
    canvas:{width:720,getContext:()=>ctx},
    getView:()=>({game:state,boardReview:{display:newGame(),ownership:null},
      candidate:null,lastPosition:null,displayedOwnership:null,palette:"mono",opacity:.55,humanTurn:false}),
    createOverlayCanvas:()=>({getContext:()=>({})})
  });
  renderer.draw();
  assert.equal(labels.length,0);
});

test("score breakdown shows white area and komi separately so it matches the board labels",()=>{
  const game={...newGame(),status:"scoring",board:Array(81).fill(0)};
  for(let y=0;y<9;y++)for(let x=0;x<9;x++)game.board[at(x,y)]=x<5?BLACK:WHITE;
  assert.equal(scoreBreakdown(game),"黒：45\n白：36＋コミ7.5＝43.5");
  const handicap={...newGame(true,{handicap:3}),status:"scoring"};
  assert.equal(scoreBreakdown(handicap),"黒：81\n白：0＋コミ0.5＋置き石補正3＝3.5");
});
