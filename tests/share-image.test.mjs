import test from "node:test";
import assert from "node:assert/strict";
import {at,newGame,play,boardHash} from "../public/core.mjs";
import {resultLabel,shareLabels,shareFrameSize,buildGameAnimation,paintShareFrame,SHARE_LINKS} from "../public/share-image.mjs";
import {OwnershipStore,encodeOwnership,decodeOwnership} from "../public/ownership-store.mjs";
import {TEXT} from "../public/texts.mjs";
import {source} from "./helpers/source.mjs";

test("results read the same plain way everywhere",()=>{
  assert.equal(resultLabel("B+3.5"),"黒が3.5目差で勝利");
  assert.equal(resultLabel("W+12"),"白が12.0目差で勝利");
  assert.equal(resultLabel("W+R"),"黒の投了で白が勝利");
  assert.equal(resultLabel("B+Resign"),"白の投了で黒が勝利");
  assert.equal(resultLabel("B+T"),"白の時間切れで黒が勝利");
  assert.equal(resultLabel("0"),"引き分け");
  assert.equal(resultLabel(null),null);
  assert.equal(resultLabel("?"),null);
  // No jargon a beginner would have to look up.
  for(const r of ["B+3.5","W+R","B+T"])assert.doesNotMatch(resultLabel(r),/中押|目半/);
  const app=source("app.mjs");
  const history=source("history-navigation.mjs");
  assert.match(app,/\$\("scoreTitle"\)\.textContent=resultLabel\(result\)/);
  assert.match(history,/resultLabel\(record\.snapshot\.result\)\|\|TEXT\.history\.statusFinished/);
});

test("labels name the moves, rules, result and winner",()=>{
  assert.deepEqual(shareLabels({step:42,total:60,result:"B+3.5",animated:false}),
    {moves:"42手目",rules:"コミ7.5目",result:"黒が3.5目差で勝利",winner:"B"});
  assert.deepEqual(shareLabels({step:12,total:12,result:null,animated:false,komi:.5,handicap:3}),
    {moves:"12手目",rules:"3子局 · コミ0.5目",result:"対局中",winner:null});
  assert.equal(shareLabels({step:60,total:60,result:"W+R",animated:true}).moves,"全60手");
  assert.equal(shareLabels({step:20,total:60,result:"W+R",animated:true}).moves,"20手目まで");
  assert.equal(shareLabels({step:5,total:5,result:"0",animated:false}).winner,null,"a draw has no winner");
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

test("the card reads brand and rules, result, board, legend (Black left), then links",()=>{
  assert.deepEqual(SHARE_LINKS,[["自分でプレイする","miego.fun"],["開発に参加する","github.com/KTakahiro1729/MieGO"]]);
  const ctx=recordingContext();
  paintShareFrame({width:800,getContext:()=>ctx},{width:720},
    {moves:"42手目",rules:"コミ7.5目",result:"白が3.5目差で勝利",winner:"W",theme:"wood",legend:{palette:"mono",opacity:.55}});
  assert.deepEqual(ctx.texts.map(t=>t.text),["MieGO","42手目 · コミ7.5目","白が3.5目差で勝利",
    "地合いの推定","黒の地","白の地","miego.fun","自分でプレイする","github.com/KTakahiro1729/MieGO","開発に参加する"]);
  const [[bx,by,bs]]=ctx.images;
  const at=text=>ctx.texts.find(t=>t.text===text);
  assert.equal(at("MieGO").x,bx+bs/10,"text aligns with the grid's edge");
  // The result is the headline between the top line and the board, centred with the winner's stone.
  const result=at("白が3.5目差で勝利"),stone=ctx.arcs.find(([,,r])=>r===16);
  assert.ok(result.y>at("MieGO").y && result.y<by && result.font.includes("Mincho"));
  assert.ok(Math.abs(((stone[0]-16)+(result.x+result.text.length*10))/2-400)<1,"stone and result are centred");
  // The legend is titled, centred and sits just under the board.
  assert.ok(at("地合いの推定").y>by+bs && at("黒の地").y<at("miego.fun").y);
  assert.ok(at("黒の地").x<at("白の地").x,"Black's end is on the left, as everywhere");
  assert.ok(Math.abs((at("白の地").x+at("黒の地").x)/2-400)<1);
  // Each link is centred in its half of the board's width, the address above its purpose.
  assert.equal(at("miego.fun").x,bx+bs/4);
  assert.equal(at("github.com/KTakahiro1729/MieGO").x,bx+bs*3/4);
  for(const [label,link] of SHARE_LINKS){
    assert.equal(at(link).x,at(label).x);
    assert.ok(at(link).y<at(label).y);
  }
  assert.ok(ctx.texts.every(t=>t.y<1000));
  const plain=recordingContext();
  paintShareFrame({width:800,getContext:()=>plain},{width:720},
    {moves:"1手目",result:"対局中",winner:null,theme:"dark",legend:null});
  assert.ok(!plain.texts.some(t=>t.text==="地合いの推定"),"no legend without colours");
  assert.equal(plain.arcs.length,0,"no stone before an unfinished result");
  assert.equal(plain.texts.find(t=>t.text==="対局中").x,400-15,"an unfinished result is centred alone");
  const large=recordingContext();
  paintShareFrame({width:800,getContext:()=>large},{width:720},
    {moves:"1手目",result:"対局中",theme:"wood",boardSize:13});
  assert.equal(large.texts[0].x,50+700/14,"a 13x13 card aligns to its own grid edge");
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
  assert.throws(()=>encodeOwnership([1,2]));
  const big=Array(361).fill(.5),bigBoard=Array(361).fill(0);
  new OwnershipStore(local).remember("game-1234",bigBoard,big);
  assert.equal(new OwnershipStore(local).recall("game-1234",bigBoard).length,361,"19x19 positions are kept too");
});

test("committed positions keep the ownership shown, and animation frames use it",()=>{
  const app=source("app.mjs");
  assert.match(app,/context\.hash===boardHash\(game\.board\)\)\s*rememberOwnership\(game\.board,result\.ownership\)/);
  assert.match(source("share-images.mjs"),/ownershipStore\.recall\(gameId,state\.board\) \?\? influence\(state\.board\)/);
});

test("a 棋風診断 line sits between the result and a smaller board",()=>{
  const ctx=recordingContext();
  paintShareFrame({width:800,getContext:()=>ctx},{width:720},
    {moves:"全42手",rules:"コミ7.5目",result:"白の中押し勝ち",winner:"W",theme:"wood",
      styles:[{color:"B",type:"AHFT"},{color:"W",type:"GLRQ"}]});
  const at=text=>ctx.texts.find(t=>t.text===text);
  const black=at("AHFT 風来の狐"),white=at("GLRQ 端正な石灯籠");
  const [[bx,by,bs]]=ctx.images;
  assert.ok(black && white);
  assert.ok(black.y>at("白の中押し勝ち").y && black.y<by,"under the result, above the board");
  assert.equal(black.y,white.y);
  assert.ok(bs<700 && Math.abs(bx+bs/2-400)<1,"the board makes room and stays centred");
  assert.ok(black.x<400 && white.x>400,"one per half");
  assert.equal(ctx.arcs.filter(([,,r])=>r===9).length,2,"each with its stone");
  assert.ok(ctx.texts.every(t=>t.y<1000));
});
