import test from "node:test";
import assert from "node:assert/strict";
import {newGame,play,at,boardHash} from "../public/core.mjs";
import {choosePolicyMove} from "../public/ai-opponent.mjs";
import {
  AI_STRENGTHS,
  fillsOwnEye,
  normalizeStrength,
  pickCount,
  pickWeakenedMove,
  STYLE_SLACK,
} from "../public/ai-strength.mjs";
import {STRONG_NETWORKS,strongNetworkFor} from "../public/strong-networks.mjs";

// A deterministic generator so sampling tests do not flake.
function seeded(seed) {
  return ()=>((seed=(seed*1664525+1013904223)>>>0)/2**32);
}
// A flat-ish policy: centre preferred, every other point plausible.
function flatPolicy(best=at(4,4)) {
  const logits=Array.from({length:81},(_,p)=>-((p*7)%13)/6);
  logits[best]=1.2;
  return logits;
}

test("weaker levels consider fewer random candidates than stronger ones",()=>{
  const counts=["beginner","easy","normal"].map(s=>pickCount(AI_STRENGTHS[s].kyu,81));
  assert.ok(counts[0]<counts[1] && counts[1]<counts[2],counts.join(","));
  assert.ok(counts[0]>=1);
});

test("weakened AI deviates from the top policy move more often at lower levels",()=>{
  const state=newGame(),logits=flatPolicy();
  const topRate=strength=>{
    const random=seeded(7);let top=0;
    for(let i=0;i<400;i++)
      if(choosePolicyMove(state,logits,-50,{strength,random})===at(4,4))top++;
    return top/400;
  };
  const beginner=topRate("beginner"),easy=topRate("easy"),normal=topRate("normal");
  assert.ok(beginner<easy && easy<normal,[beginner,easy,normal].join(","));
  assert.ok(normal<1);
});

test("a dominant policy move (e.g. an urgent capture) is always played",()=>{
  const state=newGame(),logits=Array(81).fill(-10);
  logits[at(2,2)]=6;
  for(let i=0;i<50;i++)
    assert.equal(choosePolicyMove(state,logits,-50,{strength:"beginner",random:seeded(i)}),at(2,2));
});

test("weakened AI only returns legal points and never fills its own eye by sampling",()=>{
  const s=newGame();
  // Black eye at (0,0): neighbours (1,0) and (0,1) are black.
  s.board[at(1,0)]=1;s.board[at(0,1)]=1;s.board[at(1,1)]=1;
  s.history=[boardHash(s.board)];
  assert.equal(fillsOwnEye(s,at(0,0)),true);
  const logits=flatPolicy();
  for(let i=0;i<200;i++){
    const move=choosePolicyMove(s,logits,-50,{strength:"beginner",random:seeded(i)});
    assert.notEqual(move,at(0,0));
    assert.equal(s.board[move],0);
  }
});

test("weakened AI passes only when passing is allowed and policy favours it",()=>{
  const s=newGame(),logits=flatPolicy();
  assert.notEqual(choosePolicyMove(s,logits,20,{strength:"easy",random:seeded(1)}),null);
  assert.equal(choosePolicyMove(s,logits,20,{strength:"easy",endgameStage:"near",random:seeded(1)}),null);
  assert.throws(()=>pickWeakenedMove([{position:0,raw:0,score:0}],0,{strength:"strong"}),/Unknown/);
});

test("strength values from storage are validated with a full-strength fallback",()=>{
  assert.equal(normalizeStrength("beginner"),"beginner");
  assert.equal(normalizeStrength(undefined),"strong");
  assert.equal(normalizeStrength("bogus","easy"),"easy");
});

test("a weakened level's style picks only among drawn moves close to the best of them",()=>{
  const pick=badRaw=>{
    const candidates=Array.from({length:9},(_,i)=>({position:i+10,raw:0,score:0}));
    candidates.push({position:40,raw:badRaw,score:10});
    const draws=[0.999];
    return pickWeakenedMove(candidates,-Infinity,{strength:"normal",state:newGame(),
      random:()=>draws.shift() ?? 0});
  };
  assert.equal(pick(-STYLE_SLACK/2),40);
  assert.notEqual(pick(-STYLE_SLACK-0.5),40);
});

test("最強 plays the network's top move whatever the personality, and passes only when allowed",()=>{
  const state=newGame(),logits=flatPolicy(at(2,6));
  for(const invasion of [0,100])
    assert.equal(choosePolicyMove(state,logits,-50,{strength:"strongest",invasion,reinforcement:100-invasion,
      random:seeded(3)}),at(2,6));
  assert.equal(choosePolicyMove(state,logits,5,{strength:"strongest",endgameStage:"ready"}),null);
  assert.equal(choosePolicyMove(state,logits,5,{strength:"strongest",endgameStage:"playing"}),at(2,6));
});

test("最強 plays the move its read found best, unless that move is not a legal candidate",()=>{
  const state=newGame(),logits=flatPolicy(at(2,6));
  assert.equal(choosePolicyMove(state,logits,-50,{strength:"strongest",readMove:at(6,6)}),at(6,6));
  const taken=play(state,at(6,6));
  assert.equal(choosePolicyMove(taken,logits,-50,{strength:"strongest",readMove:at(6,6)}),at(2,6));
});

test("最強 plays 9路 with the 9x9 network and larger boards with the b18 network",()=>{
  assert.equal(normalizeStrength("strongest"),"strongest");
  assert.equal(strongNetworkFor(9),"kata9x9");
  assert.equal(strongNetworkFor(13),"b18");
  assert.equal(strongNetworkFor(19),"b18");
  for(const network of Object.values(STRONG_NETWORKS)){
    assert.match(network.url,/^https:\/\/.+\.bin\.gz$/);
    assert.match(network.sha256,/^[0-9a-f]{64}$/);
  }
});

test("kyuBoost draws as many moves as a level that many kyu stronger",()=>{
  const candidates=Array.from({length:60},(_,i)=>({position:i,raw:-i/10,score:-i/10}));
  const picks=options=>Array.from({length:40},(_,i)=>pickWeakenedMove(candidates,-Infinity,{state:newGame(),random:seeded(i),...options}));
  assert.deepEqual(picks({strength:"easy",kyuBoost:8}),picks({strength:"normal"}));
  assert.notDeepEqual(picks({strength:"easy"}),picks({strength:"normal"}));
});
