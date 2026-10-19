import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {at,newGame,play,boardHash} from "../public/core.mjs";
import {resultLabel,shareLabels,shareFrameSize,buildGameAnimation,paintShareFrame,SHARE_LINKS} from "../public/share-image.mjs";
import {OwnershipStore,encodeOwnership,decodeOwnership} from "../public/ownership-store.mjs";

test("results read in Japanese",()=>{
  assert.equal(resultLabel("B+3.5"),"黒の3.5目勝ち");
  assert.equal(resultLabel("W+12"),"白の12.0目勝ち");
  assert.equal(resultLabel("W+R"),"白の投了勝ち");
  assert.equal(resultLabel("B+Resign"),"黒の投了勝ち");
  assert.equal(resultLabel("0"),"引き分け");
  assert.equal(resultLabel(null),null);
  assert.equal(resultLabel("?"),null);
});

test("labels name the moves, the result and the winner",()=>{
  assert.deepEqual(shareLabels({step:42,total:60,result:"B+3.5",animated:false}),{moves:"42手目",result:"黒の3.5目勝ち",winner:"B"});
  assert.deepEqual(shareLabels({step:12,total:12,result:null,animated:false}),{moves:"12手目",result:"終局前",winner:null});
  assert.deepEqual(shareLabels({step:60,total:60,result:"W+R",animated:true}),{moves:"全60手",result:"白の投了勝ち",winner:"W"});
  assert.equal(shareLabels({step:5,total:5,result:"0",animated:false}).winner,null,"a draw has no winner");
  assert.equal(shareLabels({step:20,total:60,result:"W+R",animated:true}).moves,"0〜20手目");
  assert.deepEqual(shareFrameSize(800),{width:800,height:1000});
});

function recordingContext() {
  const texts=[],images=[],arcs=[];
  const noop=()=>{};
  return {texts,images,arcs,font:"",fillStyle:"",
    fillRect:noop,save:noop,restore:noop,clip:noop,beginPath:noop,roundRect:noop,fill:noop,stroke:noop,
    arc:(x,y,r)=>arcs.push([x,y,r]),
    drawImage:(board,...rect)=>images.push(rect),
    fillText(text,x,y){texts.push({text,x,y,font:this.font});},
    measureText:t=>({width:t.length*10})};
}

test("the card is the board with brand, result, legend and links beneath",()=>{
  assert.deepEqual(SHARE_LINKS,[["自分でプレイする","miego.fun"],["開発に参加する","github.com/KTakahiro1729/MieGO"]]);
  const ctx=recordingContext();
  paintShareFrame({width:800,getContext:()=>ctx},{width:720},
    {moves:"42手目",result:"白の3.5目勝ち",winner:"W",theme:"wood",legend:{palette:"mono",opacity:.55}});
  assert.deepEqual(ctx.texts.map(t=>t.text),["MieGO","42手目","白の3.5目勝ち","白寄り","黒寄り",
    "miego.fun","自分でプレイする","github.com/KTakahiro1729/MieGO","開発に参加する"]);
  assert.deepEqual(ctx.images,[[0,0,800,800]],"the board fills the card's top");
  const at=text=>ctx.texts.find(t=>t.text===text);
  assert.equal(at("MieGO").x,80,"text aligns with the grid's edge");
  assert.ok(at("白の3.5目勝ち").y>800 && at("白の3.5目勝ち").font.includes("Mincho"));
  assert.ok(ctx.arcs.some(([x,y,r])=>r===16 && y<866),"the winner's stone precedes the result");
  // Each link: the address on top, what it is for underneath.
  for(const [label,link] of SHARE_LINKS){
    assert.equal(at(link).x,at(label).x);
    assert.ok(at(link).y<at(label).y);
  }
  assert.ok(at("github.com/KTakahiro1729/MieGO").x>at("miego.fun").x,"links sit side by side");
  assert.ok(ctx.texts.every(t=>t.y<1000));
  const plain=recordingContext();
  paintShareFrame({width:800,getContext:()=>plain},{width:720},
    {moves:"1手目",result:"終局前",winner:null,theme:"dark",legend:null});
  assert.ok(!plain.texts.some(t=>t.text==="白寄り"),"no legend without colours");
  assert.equal(plain.arcs.length,0,"no stone before an unfinished result");
});

test("the animation replays every move and ends on the board as drawn",async()=>{
  let game=newGame();
  for(const p of [at(2,2),at(6,6),at(6,2)])game=play(game,p);
  const rendered=[];
  const fakeCanvas=(width,height)=>{
    let source=null;
    return {width,height,getContext:()=>({
      ...recordingContext(),drawImage(board){source=board;},
      getImageData(){
        const data=new Uint8ClampedArray(width*height*4);
        data.fill(source.shade);
        return {data};
      }
    })};
  };
  const renderBoard=state=>{rendered.push(state.moves.length);return {width:8,shade:state.moves.length*40};};
  const bytes=await buildGameAnimation({snapshot:game,step:3,size:8,renderBoard,
    finalBoard:{width:8,shade:250},createCanvas:fakeCanvas,labels:{moves:"",result:"",theme:"wood"},pause:async()=>{}});
  assert.equal(String.fromCharCode(...bytes.slice(0,6)),"GIF89a");
  assert.deepEqual([...new Set(rendered)].sort(),[0,1,2],"each earlier move is replayed");
});

test("ownership is kept per game and position as signed bytes",()=>{
  const values=Array.from({length:81},(_,i)=>(i-40)/40);
  const back=decodeOwnership(encodeOwnership(values));
  back.forEach((v,i)=>assert.ok(Math.abs(v-values[i])<.01));
  const storage=new Map();
  const local={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)};
  const board=newGame().board;
  new OwnershipStore(local).remember("game-1234",board,values);
  const fresh=new OwnershipStore(local);
  assert.ok(Math.abs(fresh.recall("game-1234",board)[0]+1)<.01,"survives a reload");
  assert.equal(fresh.recall("other-game",play(newGame(),at(4,4)).board),null);
  assert.ok(storage.get("miego:ownership:v1:game-1234").includes(boardHash(board)));
  assert.throws(()=>encodeOwnership([1,2]),/地合い/);
});

test("committed positions keep the ownership shown, and animation frames use it",()=>{
  const app=readFileSync(new URL("../public/app.mjs",import.meta.url),"utf8");
  assert.match(app,/context\.hash===boardHash\(game\.board\)\)\s*rememberOwnership\(game\.board,result\.ownership\)/);
  assert.match(app,/ownershipStore\.recall\(gameId,state\.board\) \?\? influence\(state\.board\)/);
});
