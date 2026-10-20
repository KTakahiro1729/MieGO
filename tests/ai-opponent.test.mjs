
import test from "node:test";
import assert from "node:assert/strict";
import { newGame, play, at, boardHash } from "../public/core.mjs";
import {
  answersPass,
  canConsiderAiPass,
  choosePolicyMove,
  createResignWatch,
  legalAiMoves,
  personalityFeatures,
  scorePolicyCandidates,
} from "../public/ai-opponent.mjs";
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
test("攻守 rewards invading and penalises reinforcing at 攻める, and the reverse at 守る",()=>{
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
  const get=stance=>scorePolicyCandidates(s,policy,owners,{stance});
  const find=(xs,p)=>xs.find(x=>x.position===p).score;
  assert.ok(find(get(100),invading)>find(get(50),invading));
  assert.ok(find(get(0),invading)<find(get(50),invading));
  assert.ok(find(get(0),defending)>find(get(50),defending));
  assert.ok(find(get(100),defending)<find(get(50),defending));
  // Saved settings from before: 侵入 重視 alone reads as 攻める.
  assert.equal(find(scorePolicyCandidates(s,policy,owners,{invasion:100,reinforcement:0}),invading),find(get(100),invading));
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

test("after the other side passes, the AI passes back instead of playing on a settled point",()=>{
  let state=play(newGame(),at(2,2));
  state=play(state,null);
  const ownership=Array(state.board.length).fill(0.9);
  ownership[at(6,6)]=0.2;
  assert.equal(answersPass(state,at(4,4),ownership,"ready"),true);
  assert.equal(answersPass(state,at(6,6),ownership,"ready"),false,"an open point is still played");
  assert.equal(answersPass(state,at(4,4),ownership,"playing"),false,"an unsettled board plays on");
  assert.equal(answersPass(play(state,at(5,5)),at(4,4),ownership,"ready"),false,"only right after a pass");
  assert.equal(answersPass(state,null,ownership,"ready"),false);
});

test("a COM set to 投了 resigns only after three hopeless turns in a row",()=>{
  const s=newGame(true,{size:9});s.moveNumber=30;
  const lost={winRate:.01,lead:-30},close={winRate:.4,lead:-2};
  const watch=createResignWatch();
  // 最後まで never resigns.
  for(let i=0;i<5;i++)assert.equal(watch.observe(s,0,lost),false);
  assert.equal(watch.observe(s,50,lost),false);
  assert.equal(watch.observe(s,50,close),false);
  assert.equal(watch.observe(s,50,lost),false);
  assert.equal(watch.observe(s,50,lost),false);
  assert.equal(watch.observe(s,50,lost),true);
  // 大差 waits for a quarter of the board; 早め gives up at an eighth.
  const behind={winRate:.05,lead:-15},fresh=createResignWatch();
  for(let i=0;i<3;i++)assert.equal(fresh.observe(s,50,behind),false);
  for(let i=0;i<2;i++)assert.equal(fresh.observe(s,100,behind),false);
  assert.equal(fresh.observe(s,100,behind),true);
  // Nobody resigns in the opening, and White reads the numbers from its side.
  const early=newGame(true,{size:9}),opening=createResignWatch();
  for(let i=0;i<4;i++)assert.equal(opening.observe(early,100,lost),false);
  const white=newGame(true,{size:9});white.moveNumber=30;white.next=-1;
  const w=createResignWatch();
  for(let i=0;i<4;i++)assert.equal(w.observe(white,100,lost),false);
  for(let i=0;i<2;i++)w.observe(white,100,{winRate:.99,lead:30});
  assert.equal(w.observe(white,100,{winRate:.99,lead:30}),true);
});
