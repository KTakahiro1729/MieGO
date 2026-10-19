import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {at,boardHash,newGame,play} from "../public/core.mjs";
import {createBoardRenderer} from "../public/board-renderer.mjs";
import {createHistoryPanel} from "../public/history-panel.mjs";

function makeRenderer(view) {
  let alpha=1,arc=null;
  const stack=[],stones=[];
  const ctx={
    get globalAlpha(){return alpha;},
    set globalAlpha(next){alpha=next;},
    save(){stack.push(alpha);},
    restore(){alpha=stack.pop();},
    clearRect(){},fillRect(){},beginPath(){},moveTo(){},lineTo(){},
    stroke(){},setLineDash(){},
    arc(x,y,r){arc={x,y,r};},
    fill(){if(arc && Math.abs(arc.r-22)<0.01)stones.push({...arc,alpha});},
    createRadialGradient(){return {addColorStop(){}};}
  };
  const canvas={width:500,getContext:()=>ctx};
  const renderer=createBoardRenderer({
    canvas,getView:view,
    createOverlayCanvas:()=>({getContext:()=>({})})
  });
  return {draw:renderer.draw,stones};
}

test("board renderer preserves provisional capture, confirmation and cancel visibility",()=>{
  const game=newGame();
  game.board[at(1,1)]=-1;
  for(const p of [at(1,0),at(0,1),at(2,1)])game.board[p]=1;
  game.history=[boardHash(game.board)];
  const committed=play(game,at(1,2));
  let candidate=committed,boardReview=null;
  const {draw,stones}=makeRenderer(()=>({
    game,boardReview,candidate,lastPosition:null,displayedOwnership:null,
    palette:"mono",opacity:.55,humanTurn:false
  }));
  const stone=(x,y)=>stones.find(s=>s.x===x && s.y===y);
  draw();
  assert.equal(stone(100,100)?.alpha,.4,"captured stone is translucent before confirmation");
  assert.equal(stone(100,150)?.alpha,.68,"preview stone retains its distinct alpha");
  assert.equal(stone(100,50)?.alpha,1,"untouched stones remain opaque");
  stones.length=0;
  boardReview={display:committed,ownership:null}; // replay uses the committed position only
  draw();
  assert.equal(stone(100,100),undefined,"replay does not paint a captured stone");
  stones.length=0;
  boardReview=null;
  candidate=null; // cancellation restores the original full-opacity stone
  draw();
  assert.equal(stone(100,100)?.alpha,1);
  assert.equal(stone(100,150),undefined);
});

test("history panel is only a list and importer; main board owns replay state",()=>{
  const history=createHistoryPanel({
    $:()=>{throw Error("DOM not needed during construction");},
    gameLibrary:{},storageError:()=>{},onSelect:()=>{}
  });
  assert.equal(typeof history.renderHistoryList,"function");
  assert.equal(typeof history.showHistory,"function");
  assert.equal(typeof history.importHistoryFile,"function");
  assert.equal("selection" in history,false);
  assert.equal("step" in history,false);
});
test("opening saved games does not touch the removed game menu",()=>{
  const panel=readFileSync(new URL("../public/history-panel.mjs",import.meta.url),"utf8");
  assert.doesNotMatch(panel,/gameMenu/);
});
