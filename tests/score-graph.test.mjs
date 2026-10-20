import test from "node:test";
import assert from "node:assert/strict";
import {at,newGame,play,BLACK,WHITE} from "../public/core.mjs";
import {leadFromOwnership,leadSeries,swingSteps,stepAt,scoreGraphSvg} from "../public/score-graph.mjs";

test("lead counts each point's ownership share and white's komi",()=>{
  const game=newGame();
  assert.equal(leadFromOwnership(game,Array(81).fill(0)),-7.5);
  assert.equal(leadFromOwnership(game,Array(81).fill(1)),81-7.5);
  assert.equal(leadFromOwnership(game,Array(80).fill(0)),null,"wrong size");
  assert.equal(leadFromOwnership(game,[...Array(80).fill(0),NaN]),null,"not a number");
  assert.equal(leadFromOwnership(game,null),null);
});

test("series has one value per step and null where nothing is kept",()=>{
  const states=[newGame(),play(newGame(),at(4,4))];
  const kept=new Map([[states[1],Array(81).fill(0.5)]]);
  assert.deepEqual(leadSeries(states,s=>kept.get(s)),[null,81*0.75-81*0.25-7.5]);
});

test("turning points are the moves that cost their own player most",()=>{
  const moves=[{color:BLACK},{color:WHITE},{color:BLACK},{color:WHITE},{color:BLACK}];
  //            0    1(B)  2(W)  3(B)  4(W)  5(B)
  const series=[-7,  -6,    4,   -10,   -9,  -30];
  // Black's 3rd move lost 14, black's 5th lost 21; white's 2nd gained for white
  // only by black's count, so it is a loss of 10 for white.
  assert.deepEqual(swingSteps(series,moves),[2,3,5]);
  assert.deepEqual(swingSteps(series,moves,{count:2}),[3,5]);
  assert.deepEqual(swingSteps(series,moves,{minSwing:15}),[5]);
  assert.deepEqual(swingSteps([0,null,-20],moves),[],"no estimate on one side, no swing");
});

test("a tap maps to the nearest step within the game",()=>{
  assert.equal(stepAt(150,300,60),30);
  assert.equal(stepAt(-5,300,60),0);
  assert.equal(stepAt(400,300,60),60);
  assert.equal(stepAt(10,300,0),0);
});

test("graph draws black's lead up, breaks at gaps and marks the step",()=>{
  const svg=scoreGraphSvg([0,10,null,-10],{width:300,height:48,step:1,marks:[1]});
  assert.match(svg,/^<svg viewBox="0 0 300 48"/);
  assert.match(svg,/d="M0 24L100 2M300 46"/);
  assert.match(svg,/class="score-graph-mark" cx="100" cy="2"/);
  assert.match(svg,/class="score-graph-step" x1="100"/);
});

test("a close game stays near the axis and a big lead scales to fit",()=>{
  assert.match(scoreGraphSvg([0,2],{width:100,height:48}),/L100 19.6/);
  assert.match(scoreGraphSvg([0,40],{width:100,height:48}),/L100 2"/);
});

test("graph markup is built only from numbers",()=>{
  const svg=scoreGraphSvg([0,"<script>"],{marks:["x"],step:"<b>"});
  assert.doesNotMatch(svg,/script|<b>/);
});

test("values that are not numbers are left out like missing estimates",()=>{
  assert.match(scoreGraphSvg([0,"x",10],{width:100,height:48}),/d="M0 24M100 2"/);
});

test("the graph takes the step slider's place and keeps the range for keyboards",async()=>{
  const {readFile}=await import("node:fs/promises");
  const html=await readFile(new URL("../src/index.template.html",import.meta.url),"utf8");
  const scrubber=html.match(/<div class="review-scrubber">[\s\S]*?<\/div>\s*<\/div>/)?.[0]??"";
  assert.match(scrubber,/id="reviewGraph"[\s\S]*id="reviewGraphPlot"[\s\S]*id="reviewStepRange"/);
});

test("black fills up from the bottom and white down from the top, per run",()=>{
  const svg=scoreGraphSvg([0,10,null,-10],{width:300,height:48});
  assert.match(svg,/class="score-graph-black" d="M0 48L0 24L100 2L100 48ZM300 48L300 46L300 48Z"/);
  assert.match(svg,/class="score-graph-white" d="M0 0L0 24L100 2L100 0ZM300 0L300 46L300 0Z"/);
  assert.doesNotMatch(scoreGraphSvg([null,null]),/score-graph-black/,"nothing estimated, nothing filled");
});

test("the step line stays whole at the last step",()=>{
  assert.match(scoreGraphSvg([0,1,2],{width:300,height:48,step:2}),/class="score-graph-step" x1="299"/);
});
