import test from "node:test";
import assert from "node:assert/strict";
import {at,boardHash,newGame,play,WHITE} from "../public/core.mjs";
import {createBoardRenderer} from "../public/board-renderer.mjs";
import {ownershipPixel,countingOpacity} from "../public/territory-view.mjs";

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
    fill(){},fillText(){},createRadialGradient(){return {addColorStop(){}};},
    drawImage(...args){calls.push({kind:"image",args,smoothing:this.imageSmoothingEnabled});}
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
  const alphaAt=(x,y)=>overlay.data[((y+1)*11+x+1)*4+3];
  assert.equal(alphaAt(0,0),0,"review neutral point should stay transparent");
  assert.ok(alphaAt(2,2)>0,"review ownership draws only its own field");
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
  for(boardTheme of ["wood","light","dark","bogus"]){
    draw();
    fills.push(overlay.data.slice(12*4,12*4+4).join(","));
  }
  assert.equal(new Set(fills.slice(0,3)).size,3,"each look tunes the black side");
  assert.equal(fills[3],fills[0]);
});

test("the estimate fades out past the outer lines instead of ending in a hard edge",()=>{
  const game=newGame();
  const view={...baseView(game),displayedOwnership:Array(81).fill(1)};
  const {draw,calls,overlay}=mockBoard(()=>view);
  draw();
  const image=calls.find(c=>c.kind==="image");
  const gap=500/10;
  assert.deepEqual(image.args.slice(1),[gap/2-gap,gap/2-gap,gap*11,gap*11]);
  assert.equal(image.smoothing,true);
  for(let i=0;i<11;i++){
    assert.equal(overlay.data[i*4+3],0,"top ring is transparent");
    assert.equal(overlay.data[(10*11+i)*4+3],0,"bottom ring is transparent");
    assert.equal(overlay.data[(i*11)*4+3],0,"left ring is transparent");
    assert.equal(overlay.data[(i*11+10)*4+3],0,"right ring is transparent");
  }
  assert.ok(overlay.data[(11+1)*4+3]>0,"the corner point itself is coloured");
});

test("counting paints flat cells in the chosen colour map and rings neutral points",()=>{
  // Black owns the left five columns, White the right three; column 5 is neutral.
  const game={...newGame(),status:"scoring",board:Array(81).fill(0)};
  for(let y=0;y<9;y++){game.board[at(4,y)]=1;game.board[at(6,y)]=WHITE;}
  const view={...baseView(game),palette:"orangePurple",opacity:.2,boardTheme:"wood"};
  const {draw,calls,overlay}=mockBoard(()=>view);
  draw();
  const pixel=i=>[...overlay.data.slice(i*4,i*4+4)];
  const black=ownershipPixel(1,"orangePurple",countingOpacity(.2),"wood");
  const white=ownershipPixel(-1,"orangePurple",countingOpacity(.2),"wood");
  assert.deepEqual(pixel(at(0,0)),black);
  assert.deepEqual(pixel(at(8,0)),white);
  assert.equal(pixel(at(5,0))[3],0,"neutral points stay uncoloured");
  const image=calls.find(c=>c.kind==="image");
  assert.equal(image.smoothing,false,"counted areas have hard edges");
  const rings=calls.filter(c=>c.kind==="arc" && Math.abs(c.args[2]-500/10*.13)<1e-9);
  assert.equal(rings.length,9,"one ring per neutral point");
  // Counting is never hidden: the none colour map falls back to the default.
  view.palette="none";draw();
  assert.deepEqual(pixel(at(0,0)),ownershipPixel(1,"mono",countingOpacity(.2),"wood"));
});
