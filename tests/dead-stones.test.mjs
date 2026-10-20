import test from "node:test";
import assert from "node:assert/strict";
import { newGame, at, BLACK, WHITE, setDeadCandidates, areaScore } from "../public/core.mjs";
import { suggestDeadStones } from "../public/dead-stones.mjs";

test("KataGo ownership marks a strongly opponent-owned dead group",()=>{
  const s={...newGame(),status:"scoring"};
  s.board[at(4,4)]=WHITE;
  for(const [x,y] of [[3,4],[4,3],[5,4]])s.board[at(x,y)]=BLACK;
  const ownership=Array(81).fill(0);
  ownership[at(4,4)]=.97; // black owns position with white stone
  assert.deepEqual(suggestDeadStones(s,ownership),[at(4,4)]);
  const next=setDeadCandidates(s,suggestDeadStones(s,ownership));
  assert.deepEqual(next.dead,[at(4,4)]);
  assert.notDeepEqual(areaScore(next),areaScore(s));
});
test("uncertain ownership and secure friendly groups are not auto-marked",()=>{
  const s={...newGame(),status:"scoring"};
  s.board[at(4,4)]=BLACK;s.board[at(4,5)]=BLACK;
  const ownership=Array(81).fill(0);ownership[at(4,4)]=-.4;
  ownership[at(4,5)]=-.4;
  assert.deepEqual(suggestDeadStones(s,ownership),[]);
});
test("selected dead stones always expand to full groups and reset agreement",()=>{
  const s={...newGame(),status:"scoring"};
  s.board[at(2,2)]=BLACK;s.board[at(2,3)]=BLACK;
  s.agreed={black:true,white:true};
  const next=setDeadCandidates(s,[at(2,2)]);
  assert.deepEqual(next.dead,[at(2,2),at(2,3)]);
  assert.deepEqual(next.agreed,{black:false,white:false});
});
test("invalid and non-scoring inputs cannot set dead stones",()=>{
  assert.throws(()=>suggestDeadStones({...newGame(),status:"scoring"},Array(81).fill(2)));
  assert.throws(()=>setDeadCandidates(newGame(),[]));
  assert.throws(()=>setDeadCandidates({...newGame(),status:"scoring"},[100]));
});
