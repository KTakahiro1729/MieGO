import test from "node:test";
import assert from "node:assert/strict";
import {at,boardHash,newGame,play,WHITE} from "../public/core.mjs";
import {createBoardRenderer} from "../public/board-renderer.mjs";

function mockBoard(getView) {
  const calls=[];
  let alpha=1;
  const stack=[];
  const ctx={
    get globalAlpha(){return alpha;},
    set globalAlpha(value){alpha=value;},
    save(){stack.push(alpha);},restore(){alpha=stack.pop();},
    clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},
    setLineDash(){},
    fillRect(...args){calls.push({kind:"rect",args,alpha});},
    arc(...args){calls.push({kind:"arc",args,alpha});},
    fill(){},createRadialGradient(){return {addColorStop(){}};},
    drawImage(...args){calls.push({kind:"image",args});}
  };
  const overlay={data:null,createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)};},
    putImageData(image){this.data=image.data.slice();}};
  const renderer=createBoardRenderer({
    canvas:{width:500,getContext:()=>ctx},
    getView,createOverlayCanvas:()=>({getContext:()=>overlay})
  });
  return {draw:renderer.draw,calls,overlay};
}
const baseView=game=>({game,boardReview:null,candidate:null,lastPosition:null,
  displayedOwnership:null,palette:"mono",opacity:.55,humanTurn:false});

test("replay ignores a provisional move and paints the replay marker",()=>{
  const game=newGame();
  const candidate=play(game,at(1,1));
  const replay=play(game,at(6,6));
  const view={...baseView(game),candidate,boardReview:{display:replay,ownership:null}};
  const {draw,calls}=mockBoard(()=>view);
  draw();
  const stones=calls.filter(c=>c.kind==="arc"&&c.args[2]===22);
  assert.equal(stones.length,1);
  assert.deepEqual(stones[0].args.slice(0,2),[350,350]);
  assert.equal(stones[0].alpha,1);
  assert.equal(calls.some(c=>c.kind==="arc"&&c.args[2]===26),false,"no dashed preview marker");
  assert.ok(calls.some(c=>c.kind==="rect"&&c.args.join(",")==="346,346,8,8"));
});

test("forbidden points are unmarked until selected and draw a provisional stone without commits",()=>{
  const game=newGame();
  for(const p of [at(1,0),at(0,1),at(2,1),at(1,2)])game.board[p]=WHITE;
  game.history=[boardHash(game.board)];
  let illegalCandidate=null;
  const {draw,calls}=mockBoard(()=>({...baseView(game),illegalCandidate}));
  draw();
  assert.equal(calls.some(c=>c.kind==="arc"&&c.args[2]===9),false);
  assert.equal(calls.some(c=>c.kind==="arc"&&c.args[2]===22&&c.args[0]===100&&c.args[1]===100),false);
  calls.length=0;
  illegalCandidate={position:at(1,1),reason:"suicide",source:game};
  draw();
  const stone=calls.find(c=>c.kind==="arc"&&c.args[2]===22&&c.args[0]===100&&c.args[1]===100);
  assert.equal(stone?.alpha,.68);
  assert.equal(calls.some(c=>c.kind==="arc"&&c.args[2]===26&&c.args[0]===100),true);
  assert.equal(calls.some(c=>c.kind==="arc"&&c.args[2]===9),false,"no board-wide forbidden markers");
  assert.equal(game.board[at(1,1)],0);
  calls.length=0;
  illegalCandidate=null;
  draw();
  assert.equal(calls.some(c=>c.kind==="arc"&&c.args[2]===22&&c.args[0]===100&&c.args[1]===100),false);
});

test("ownership overlay uses preview-independent review values and hides with the none colour map",()=>{
  const game=newGame();
  let palette="mono";
  const boardReview={display:{...game},ownership:Array(81).fill(0)};
  boardReview.ownership[at(2,2)]=1;
  const view={...baseView(game),boardReview,displayedOwnership:Array(81).fill(-1)};
  const {draw,calls,overlay}=mockBoard(()=>({...view,palette}));
  draw();
  assert.equal(calls.filter(c=>c.kind==="image").length,1);
  assert.equal(overlay.data[3],0,"review neutral point should stay transparent");
  assert.ok(overlay.data[at(2,2)*4+3]>0,"review ownership draws only its own field");
  calls.length=0;
  palette="none";
  draw();
  assert.equal(calls.filter(c=>c.kind==="image").length,0);
});

test("board looks change the board fill and the overlay colours, unknown looks fall back to wood",()=>{
  const game=newGame();
  let boardTheme;
  const fills=[];
  const ownership=Array(81).fill(1);
  const view={...baseView(game),displayedOwnership:ownership};
  const {draw,overlay}=mockBoard(()=>({...view,boardTheme}));
  for(boardTheme of ["wood","modern","glass","bogus"]){
    draw();
    fills.push(overlay.data.slice(0,4).join(","));
  }
  assert.equal(new Set(fills.slice(0,3)).size,3,"each look tunes the black side");
  assert.equal(fills[3],fills[0]);
});
