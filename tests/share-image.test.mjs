import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {at,newGame,play,boardHash} from "../public/core.mjs";
import {resultLabel,shareCaption,shareFrameSize,buildGameAnimation} from "../public/share-image.mjs";
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

test("captions name the move and the result, or that the game is unfinished",()=>{
  assert.equal(shareCaption({step:42,total:60,result:"B+3.5",animated:false}),"42手目 · 黒の3.5目勝ち");
  assert.equal(shareCaption({step:12,total:12,result:null,animated:false}),"12手目 · 終局前");
  assert.equal(shareCaption({step:60,total:60,result:"W+R",animated:true}),"全60手 · 白の投了勝ち");
  assert.equal(shareCaption({step:20,total:60,result:"W+R",animated:true}),"0〜20手目 · 白の投了勝ち");
  assert.deepEqual(shareFrameSize(720),{width:720,height:828,footer:108});
});

test("the animation replays every move and ends on the board as drawn",async()=>{
  let game=newGame();
  for(const p of [at(2,2),at(6,6),at(6,2)])game=play(game,p);
  const rendered=[];
  const fakeCanvas=(width,height)=>{
    let source=null;
    return {width,height,getContext:()=>({
      drawImage(board){source=board;},fillRect(){},fillText(){},
      getImageData(){
        const data=new Uint8ClampedArray(width*height*4);
        data.fill(source.shade);
        return {data};
      }
    })};
  };
  const renderBoard=state=>{rendered.push(state.moves.length);return {width:8,shade:state.moves.length*40};};
  const bytes=await buildGameAnimation({snapshot:game,step:3,size:8,renderBoard,
    finalBoard:{width:8,shade:250},createCanvas:fakeCanvas,caption:"",url:"",pause:async()=>{}});
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
