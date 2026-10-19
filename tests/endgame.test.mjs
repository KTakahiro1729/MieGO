import test from "node:test";
import assert from "node:assert/strict";
import { newGame, play, proposeEnd, answerEndProposal, beginSoloScoring, finalizeSoloScore, agreeScore, BLACK, WHITE, at } from "../public/core.mjs";
import { EndgameAdvisor, endgameHint } from "../public/endgame.mjs";

test("end offer consumes no turn, move number or passes", () => {
  const start=newGame();
  const offered=proposeEnd(start,BLACK);
  assert.equal(offered.endProposal.from, BLACK);
  assert.equal(offered.moveNumber,0);
  assert.equal(offered.next,BLACK);
  assert.equal(offered.moves.length,0);
  assert.equal(answerEndProposal(offered, WHITE, false).status,"playing");
});
test("other player must accept explicitly to enter scoring", () => {
  let g=proposeEnd(newGame(), WHITE);
  assert.throws(()=>answerEndProposal(g,WHITE,true),/自分/);
  g=answerEndProposal(g,BLACK,true);
  assert.equal(g.status,"scoring");
  assert.equal(g.moves.length,0);
  assert.equal(g.passes,0);
  assert.equal(g.endProposal,null);
});
test("a real move clears outstanding offers without changing Go rules", () => {
  let g=proposeEnd(newGame(),WHITE);
  g=play(g,at(4,4));
  assert.equal(g.endProposal,null);
  assert.equal(g.moves.length,1);
  g=proposeEnd(g,BLACK);
  g=play(g,null);
  assert.equal(g.endProposal,null);
  assert.equal(g.passes,1);
});
test("the proposer may withdraw without consuming a move", () => {
  const g=proposeEnd(newGame(),BLACK);
  assert.equal(answerEndProposal(g,BLACK,false).endProposal,null);
});
test("endgame advisor rejects sudden/unstable estimates", () => {
  const a=new EndgameAdvisor();
  const g=newGame();
  assert.equal(a.observe(g,Array(81).fill(1)),"playing");
  assert.equal(a.observe({...g,moveNumber:1},Array(81).fill(-1)),"playing");
  a.reset();
  assert.equal(a.stage,"playing");
});
test("endgame advisor requires settled ownership across multiple real moves", () => {
  const a=new EndgameAdvisor();
  const board=Array(81).fill(0);
  for(let i=0;i<35;i++)board[i]=i%2===0?BLACK:WHITE;
  // Artificial tactical board may contain atari; the advisor must not
  // certify it on ownership alone, even when every empty area seems settled.
  for(const move of [45,46,47]){
    const status=a.observe({...newGame(),board,moveNumber:move},Array(81).fill(1));
    assert.notEqual(status,"ready");
  }
});

test("stable, settled territory reaches soft advice only after repeated evaluations", () => {
  const advisor=new EndgameAdvisor();
  const board=Array(81).fill(0);
  for(let i=0;i<27;i++)board[i]=BLACK;
  for(let i=54;i<81;i++)board[i]=WHITE;
  const score=Array(81).fill(1);
  let g={...newGame(),board,moveNumber:45};
  assert.equal(advisor.observe(g,score),"near");
  g={...g,moveNumber:46};
  assert.equal(advisor.observe(g,score),"near");
  g={...g,moveNumber:47};
  assert.equal(advisor.observe(g,score),"ready");
  // One sizable ownership shift revokes the ready suggestion.
  g={...g,moveNumber:48};
  assert.equal(advisor.observe(g,Array(81).fill(-1)),"near");
});

test("simultaneous opposite offers converge deterministically without passes",()=>{
  const initial=newGame();
  const blackFirst=proposeEnd(proposeEnd(initial,BLACK),WHITE);
  const whiteFirst=proposeEnd(proposeEnd(initial,WHITE),BLACK);
  assert.equal(blackFirst.endProposal.from,BLACK);
  assert.equal(whiteFirst.endProposal.from,BLACK);
  assert.equal(whiteFirst.moveNumber,0);
});

test("AI/solo scoring begins only by human command, without a forged AI offer",()=>{
  const original=newGame(),staged=beginSoloScoring(original);
  assert.equal(staged.status,"scoring");
  assert.equal(staged.endProposal,null);
  assert.deepEqual(staged.agreed,{black:false,white:false});
  assert.equal(staged.moveNumber,original.moveNumber);
  assert.throws(()=>beginSoloScoring(staged),/対局中/);
  const finished=finalizeSoloScore(staged);
  assert.equal(finished.status,"finished");
  assert.equal(finished.result,"W+7.5");
  assert.deepEqual(finished.agreed,{black:false,white:false});
  assert.throws(()=>finalizeSoloScore(original),/採点中/);
});
test("solo score uses same rules and points as two-player score acceptance",()=>{
  let two=beginSoloScoring(play(newGame(),at(4,4)));
  const solo=finalizeSoloScore(two);
  two=agreeScore(agreeScore(two,BLACK),WHITE);
  assert.equal(solo.result,two.result);
  assert.deepEqual(solo.agreed,{black:false,white:false});
  assert.deepEqual(two.agreed,{black:true,white:true});
});
test("advice with no valid NN estimate is not reported as 'not near endgame'",()=>{
  const g=newGame(),advisor=new EndgameAdvisor();
  assert.equal(endgameHint(g,advisor),"終局の目安を確認中");
  assert.equal(endgameHint(g,advisor,{unavailable:true}),"終局の目安を判定できません");
  advisor.observe(g,Array(81).fill(0));
  assert.equal(endgameHint(g,advisor),"終局はまだのようです");
  assert.equal(endgameHint({...g,moveNumber:5},advisor),"終局の目安を更新中");
  advisor.stage="near";
  assert.equal(endgameHint(g,advisor),"終局はいかがですか？");
  assert.equal(endgameHint(g,advisor,{suppressedUntil:3}),"終局はまだのようです");
});

test("a dead stone left in atari inside settled territory does not hold back the advice",()=>{
  // Black owns the top, White the bottom; one White stone sits in atari in
  // Black's area and the estimate shows it in Black's settled colour.
  const board=Array(81).fill(0);
  for(let i=0;i<27;i++)board[i]=BLACK;
  for(let i=54;i<81;i++)board[i]=WHITE;
  const dead=at(4,3);
  board[dead]=WHITE;board[at(3,3)]=BLACK;board[at(5,3)]=BLACK;
  const ownership=board.map((_,i)=>i<45?1:-1);
  const advisor=new EndgameAdvisor();
  let stage;
  for(const moveNumber of [45,46,47])stage=advisor.observe({...newGame(),board,moveNumber},ownership);
  assert.equal(stage,"ready");
  // The same stone in atari while the estimate still sees it as alive is a fight.
  const fight=new EndgameAdvisor();
  const alive=[...ownership];alive[dead]=-.9;
  for(const moveNumber of [45,46,47])stage=fight.observe({...newGame(),board,moveNumber},alive);
  assert.equal(stage,"playing");
});

test("move-count thresholds scale with the board area",async()=>{
  const {boardScale}=await import("../public/endgame.mjs");
  assert.equal(boardScale(81),1);
  assert.equal(boardScale(361),361/81);
  const size=13,board=Array(size*size).fill(0);
  for(let i=0;i<60;i++)board[i]=BLACK;
  for(let i=109;i<169;i++)board[i]=WHITE;
  const ownership=board.map((_,i)=>i<84?1:-1);
  const early=new EndgameAdvisor();
  for(const moveNumber of [45,46,47])early.observe({...newGame(true,{size}),board,moveNumber},ownership);
  assert.equal(early.stage,"playing","45 moves is still early on 13x13");
  const late=new EndgameAdvisor();
  for(const moveNumber of [95,96,97])late.observe({...newGame(true,{size}),board,moveNumber},ownership);
  assert.equal(late.stage,"ready");
});
