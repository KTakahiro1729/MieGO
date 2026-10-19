import test from "node:test";
import assert from "node:assert/strict";
import {newGame,play,at,boardHash} from "../public/core.mjs";
import {personalityFeatures} from "../public/ai-personality.mjs";
import {personalityFeatures as legacyFeatures,choosePolicyMove} from "../public/ai-opponent.mjs";
import {samplePolicyCandidate} from "../public/ai-policy-sampling.mjs";

test("existing AI personality export remains the exact feature function",()=>{
  assert.equal(legacyFeatures,personalityFeatures);
  assert.deepEqual(personalityFeatures(newGame(),at(4,4),null),{invasion:0,reinforcement:0});
});

test("policy sampler keeps candidate ordering and deterministic random boundaries",()=>{
  const candidates=[{position:0,score:0},{position:1,score:0}];
  assert.equal(samplePolicyCandidate(candidates,{random:()=>0}),0);
  assert.equal(samplePolicyCandidate(candidates,{random:()=>0.9999999999}),1);
  assert.equal(samplePolicyCandidate(candidates,{random:()=>0.5}),0);
  assert.equal(samplePolicyCandidate([]),null);
  assert.deepEqual(candidates,[{position:0,score:0},{position:1,score:0}]);
});

test("policy sampling ignores very low logits without changing legal move checks",()=>{
  const original=newGame();
  const logits=Array(81).fill(-100);
  logits[40]=10;
  assert.equal(choosePolicyMove(original,logits,-100,{random:()=>0.5}),40);
  const next=play(original,40);
  next.history=[boardHash(next.board)];
  logits[39]=9;
  assert.equal(choosePolicyMove(next,logits,-100,{random:()=>0}),39);
});

test("pass candidate remains eligible only after the existing move threshold",()=>{
  const state=newGame();
  const logits=Array(81).fill(-100);
  logits[40]=10;
  assert.equal(choosePolicyMove(state,logits,1e3,{random:()=>0}),40);
  state.moveNumber=65;
  assert.equal(choosePolicyMove(state,logits,1e3,{random:()=>0.5}),null);
});
