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

test("illegal move markers require a live human turn",()=>{
  const game=newGame();
  for(const p of [at(1,0),at(0,1),at(2,1),at(1,2)])game.board[p]=WHITE;
  game.history=[boardHash(game.board)];
  let humanTurn=false,boardReview=null;
  const {draw,calls}=mockBoard(()=>({...baseView(game),humanTurn,boardReview}));
  draw();
  assert.equal(calls.some(c=>c.kind==="arc"&&c.args[2]===9),false);
  calls.length=0;
  humanTurn=true;
  draw();
  assert.ok(calls.some(c=>c.kind==="arc"&&c.args[2]===9 && c.args[0]===100 && c.args[1]===100));
  calls.length=0;
  boardReview={display:game,ownership:null};
  draw();
  assert.equal(calls.some(c=>c.kind==="arc"&&c.args[2]===9),false);
});

test("ownership overlay uses preview-independent review values and honors assisted flag",()=>{
  const game=newGame();
  let assisted=true;
  const boardReview={display:{...game,assisted:true},ownership:Array(81).fill(0)};
  boardReview.ownership[at(2,2)]=1;
  const view={...baseView(game),boardReview,displayedOwnership:Array(81).fill(-1)};
  const {draw,calls,overlay}=mockBoard(()=>({...view,boardReview:{...boardReview,display:{...game,assisted}}}));
  draw();
  assert.equal(calls.filter(c=>c.kind==="image").length,1);
  assert.equal(overlay.data[3],0,"review neutral point should stay transparent");
  assert.ok(overlay.data[at(2,2)*4+3]>0,"review ownership draws only its own field");
  calls.length=0;
  assisted=false;
  draw();
  assert.equal(calls.filter(c=>c.kind==="image").length,0);
});
