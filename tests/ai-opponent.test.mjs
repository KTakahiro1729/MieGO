
import test from "node:test";
import assert from "node:assert/strict";
import { newGame, play, at, boardHash } from "../public/core.mjs";
import { legalAiMoves, choosePolicyMove, canConsiderAiPass, scorePolicyCandidates, personalityFeatures } from "../public/ai-opponent.mjs";
const logits=point=>{const a=Array(81).fill(-100);a[point]=100;return a;};
test("KataGo policy selects legal moves and excludes occupied points",()=>{
  const g=newGame();
  assert.equal(choosePolicyMove(g,logits(at(4,4)),-100,{random:()=>.5}),at(4,4));
  const h=play(g,at(4,4)),p=logits(at(4,4));p[at(3,3)]=5;
  assert.equal(choosePolicyMove(h,p,-100,{random:()=>.5}),at(3,3));
});
test("legal move list rejects suicide",()=>{
  const s=newGame();
  s.board[at(8,8)]=1;
  for(const p of [at(1,0),at(0,1),at(2,1),at(1,2)])s.board[p]=-1;
  s.history=[boardHash(s.board)];
  assert.equal(legalAiMoves(s).includes(at(8,8)),false);
  assert.equal(legalAiMoves(s).includes(at(1,1)),false);
});
test("an unsettled board cannot pass, a settled one can",()=>{
  const s=newGame(),p=logits(at(4,4));
  assert.notEqual(choosePolicyMove(s,p,1000,{random:()=>.5}),null);
  assert.equal(choosePolicyMove(s,p,1000,{endgameStage:"near",random:()=>.5}),null);
});
test("invasion and reinforcement sliders adjust separate candidate scores",()=>{
  const s=newGame();
  s.board[at(1,1)]=1;
  for(const q of [at(0,1),at(1,0),at(2,1)])s.board[q]=-1;
  s.history=[boardHash(s.board)];
  const invading=at(6,6),defending=at(1,2);
  const owners=Array(81).fill(0);owners[invading]=-.9;owners[defending]=.45;
  const featuresIn=personalityFeatures(s,invading,owners);
  const featuresSafe=personalityFeatures(s,defending,owners);
  assert.ok(featuresIn.invasion>.5);
  assert.equal(featuresIn.reinforcement,0);
  assert.ok(featuresSafe.reinforcement>.3);
  const policy=Array(81).fill(-50);policy[invading]=0;policy[defending]=0;
  const get=(inv,rein)=>scorePolicyCandidates(s,policy,owners,{invasion:inv,reinforcement:rein});
  const find=(xs,p)=>xs.find(x=>x.position===p).score;
  assert.ok(find(get(100,50),invading)>find(get(50,50),invading));
  assert.equal(find(get(50,100),invading),find(get(50,50),invading));
  assert.ok(find(get(50,100),defending)>find(get(50,50),defending));
  assert.equal(find(get(100,50),defending),find(get(50,50),defending));
});
test("invalid policy and finished games cannot generate AI turns",()=>{
  assert.throws(()=>choosePolicyMove(newGame(),[1],0),/Invalid/);
  assert.equal(legalAiMoves({...newGame(),status:"finished"}).length,0);
});

test("KataGo pass eligibility follows how settled the board is, not the move number",()=>{
  const s=newGame(),position=at(4,4),p=logits(position);
  for(const moveNumber of [3,45,145,400]){
    s.moveNumber=moveNumber;
    assert.equal(canConsiderAiPass("ready"),true);
    assert.equal(canConsiderAiPass("near"),true);
    assert.equal(canConsiderAiPass("playing"),false);
    assert.equal(choosePolicyMove(s,p,1000,{endgameStage:"playing",random:()=>.5}),position);
    assert.equal(choosePolicyMove(s,p,1000,{endgameStage:"ready",random:()=>.5}),null);
    assert.equal(choosePolicyMove(s,p,-1000,{endgameStage:"ready",random:()=>.5}),position);
  }
  // The other side's pass does not open passing on an unsettled board.
  s.moveNumber=60;s.passes=1;
  assert.equal(choosePolicyMove(s,p,1000,{endgameStage:"playing",random:()=>.5}),position);
  assert.equal(choosePolicyMove(s,p,1000,{endgameStage:"near",random:()=>.5}),null);
});
test("no forced pass on a settled board; actual KataGo policy remains decisive",()=>{
  const s=newGame(),p=logits(at(4,4));
  s.moveNumber=145;
  assert.equal(choosePolicyMove(s,p,-1000,{endgameStage:"ready",random:()=>.5}),at(4,4));
  assert.equal(choosePolicyMove(s,p,1000,{endgameStage:"ready",random:()=>.5}),null);
});
test("weakened strengths use the same endgame-aware pass eligibility",()=>{
  const s=newGame(),position=at(4,4),p=logits(position);
  assert.equal(choosePolicyMove(s,p,105,{strength:"easy",endgameStage:"playing",random:()=>.5}),position);
  assert.equal(choosePolicyMove(s,p,105,{strength:"easy",endgameStage:"ready",random:()=>.5}),null);
  assert.equal(choosePolicyMove(s,p,-1000,{strength:"easy",endgameStage:"ready",random:()=>.5}),position);
});

test("AI pass eligibility is the same on every board size",()=>{
  for(const size of [9,13,19]){
    const s=newGame(true,{size}),p=Array(size*size).fill(-100);p[0]=100;
    assert.equal(choosePolicyMove(s,p,1000,{endgameStage:"playing",random:()=>.5}),0);
    assert.equal(choosePolicyMove(s,p,1000,{endgameStage:"near",random:()=>.5}),null);
  }
});
