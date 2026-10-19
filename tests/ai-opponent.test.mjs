import test from "node:test";
import assert from "node:assert/strict";
import { newGame, play, at, boardHash } from "../public/core.mjs";
import { legalAiMoves, choosePolicyMove, chooseFallbackMove } from "../public/ai-opponent.mjs";
const logits = p => { const arr = Array(81).fill(-100); arr[p] = 100; return arr; };
test("KataGo policy chooses a legal opening move", () => {
  const s = newGame(); assert.equal(choosePolicyMove(s, logits(at(4,4)), -100, {random:()=>.5}), at(4,4));
});
test("occupied points are excluded even when policy prefers them", () => {
  const s=play(newGame(),at(4,4)), policy=logits(at(4,4));
  policy[at(3,3)]=5; assert.equal(choosePolicyMove(s,policy,-100,{random:()=>.25}),at(3,3));
});
test("AI cannot select occupied or suicide points", () => {
  let s=play(newGame(),at(8,8));
  for(const p of [at(1,0),at(0,1),at(2,1),at(1,2)]) s.board[p]=-1;
  s.history=[boardHash(s.board)];s.next=1;
  const moves=legalAiMoves(s);
  assert.equal(moves.includes(at(8,8)),false);
  assert.equal(moves.includes(at(1,1)),false);
});
test("opening never passes and late game can pass", () => {
  const s=newGame(),scores=logits(at(2,2));
  assert.notEqual(choosePolicyMove(s,scores,1000,{random:()=>.5}),null);
  s.moveNumber=65;assert.equal(choosePolicyMove(s,scores,1000,{random:()=>.5}),null);
});
test("invalid neural outputs are rejected", () => {
  assert.throws(()=>choosePolicyMove(newGame(),[1,2],0),/不正/);
  assert.deepEqual(legalAiMoves({...newGame(),status:"finished"}),[]);
});
test("fallback produces legal moves and passes after long games", () => {
  const s=newGame(),p=chooseFallbackMove(s,()=>.25);
  assert.ok(Number.isInteger(p));assert.doesNotThrow(()=>play(s,p));
  s.moveNumber=121;assert.equal(chooseFallbackMove(s),null);
});
