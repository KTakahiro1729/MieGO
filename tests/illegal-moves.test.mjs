import test from "node:test";
import assert from "node:assert/strict";
import { at, boardHash, newGame, play, BLACK, WHITE } from "../public/core.mjs";
import {
  illegalMoveReasons, drawIllegalMoveMarker, ILLEGAL_KO, ILLEGAL_SUICIDE
} from "../public/illegal-moves.mjs";
import { readFileSync } from "node:fs";

test("suicide is marked only on empty intersections",()=>{
  const state=newGame();
  for(const p of [at(1,0),at(0,1),at(2,1),at(1,2)])
    state.board[p]=WHITE;
  state.history=[boardHash(state.board)];
  const markers=illegalMoveReasons(state);
  assert.equal(markers.get(at(1,1)),ILLEGAL_SUICIDE);
  assert.equal(markers.has(at(1,0)),false);
  assert.equal(markers.has(at(7,7)),false);
});
test("legal capture into an otherwise surrounded point is NOT marked suicide",()=>{
  const state=newGame();
  state.board[at(1,1)]=WHITE;
  for(const p of [at(1,0),at(0,1),at(2,1)])state.board[p]=BLACK;
  state.history=[boardHash(state.board)];
  assert.doesNotThrow(()=>play(state,at(1,2)));
  assert.equal(illegalMoveReasons(state).has(at(1,2)),false);
});
test("a true single-stone immediate ko recapture has its own mark",()=>{
  const state=newGame();
  for(const p of [at(3,4),at(5,4),at(4,5)])state.board[p]=BLACK;
  for(const p of [at(4,4),at(3,3),at(5,3),at(4,2)])state.board[p]=WHITE;
  state.history=[boardHash(state.board)];
  assert.equal(illegalMoveReasons(state).has(at(4,3)),false);
  const afterCapture=play(state,at(4,3));
  assert.equal(afterCapture.board[at(4,4)],0);
  assert.throws(()=>play(afterCapture,at(4,4)),/コウ/);
  assert.equal(illegalMoveReasons(afterCapture).get(at(4,4)),ILLEGAL_KO);
});
test("markers are not generated while scoring or after finishing",()=>{
  const state=newGame();
  assert.equal(illegalMoveReasons({...state,status:"scoring"}).size,0);
  assert.equal(illegalMoveReasons({...state,status:"finished"}).size,0);
});
function mockCanvas(){
  const calls=[];
  const ctx={
    save(){calls.push(["save"])},restore(){calls.push(["restore"])},
    beginPath(){calls.push(["begin"])},
    arc(...args){calls.push(["arc",...args])},
    moveTo(...args){calls.push(["move",...args])},
    lineTo(...args){calls.push(["line",...args])},
    fill(){calls.push(["fill",this.fillStyle,this.globalAlpha])},
    stroke(){calls.push(["stroke",this.strokeStyle,this.lineWidth,this.globalAlpha])}
  };
  return {ctx,calls};
}
test("ko and suicide use identical stroke, size, opacity and fill",()=>{
  const ko=mockCanvas(),suicide=mockCanvas();
  drawIllegalMoveMarker(ko.ctx,50,50,40,ILLEGAL_KO);
  drawIllegalMoveMarker(suicide.ctx,50,50,40,ILLEGAL_SUICIDE);
  assert.deepEqual(ko.calls.filter(x=>x[0]==="arc"),suicide.calls.filter(x=>x[0]==="arc"));
  assert.deepEqual(ko.calls.filter(x=>x[0]==="fill"),suicide.calls.filter(x=>x[0]==="fill"));
  assert.deepEqual(ko.calls.filter(x=>x[0]==="stroke"),suicide.calls.filter(x=>x[0]==="stroke"));
  assert.equal(ko.calls.filter(x=>x[0]==="line").length,1);
  assert.equal(suicide.calls.filter(x=>x[0]==="line").length,2);
});
test("markers are confined to the board canvas and current human turn",()=>{
  const app=readFileSync(new URL("../public/app.mjs",import.meta.url),"utf8");
  const renderer=readFileSync(new URL("../public/board-renderer.mjs",import.meta.url),"utf8");
  assert.match(app,/humanTurn:isHumanTurn\(\)/);
  assert.match(renderer,/game\.status==="playing" && humanTurn/);
  assert.match(renderer,/illegalCacheGame!==game/);
  assert.match(renderer,/drawIllegalMoveMarker\(ctx,x,y,gap,reason\)/);
  const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  assert.doesNotMatch(html,/illegalMoveLegend|illegalMoveToggle/);
});
