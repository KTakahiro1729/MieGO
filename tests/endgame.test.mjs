import test from "node:test";
import assert from "node:assert/strict";
import { newGame, play, proposeEnd, answerEndProposal, BLACK, WHITE, at } from "../public/core.mjs";
import { EndgameAdvisor } from "../public/endgame.mjs";

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
