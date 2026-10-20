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
  const finished=finalizeSoloScore(staged);
  assert.equal(finished.status,"finished");
  assert.equal(finished.result,"W+7.5");
  assert.deepEqual(finished.agreed,{black:false,white:false});
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
  assert.equal(endgameHint(g,advisor),"終局まではまだまだです");
  assert.equal(endgameHint({...g,moveNumber:5},advisor),"終局の目安を更新中");
  advisor.stage="near";
  assert.equal(endgameHint(g,advisor),"そろそろ終局です");
  advisor.stage="ready";
  assert.equal(endgameHint(g,advisor),"終局をご検討ください");
  assert.equal(endgameHint(g,advisor,{suppressedUntil:3}),"そろそろ終局です","after 打ち続ける the milder step stands in");
});

// Ownership maps that move a given number of points from one estimate to the next.
const shifted=(base,points)=>base.map((v,i)=>i<points?-v:v);

test("the advice follows how much one stone moves the estimate",async()=>{
  const {ENDGAME_SWING}=await import("../public/endgame.mjs");
  assert.deepEqual({...ENDGAME_SWING},{near:2,ready:1,window:2});
  const board=Array(81).fill(0);
  for(let i=0;i<27;i++)board[i]=BLACK;
  for(let i=54;i<81;i++)board[i]=WHITE;
  const base=board.map((_,i)=>i<41?1:-1);
  const a=new EndgameAdvisor();
  const at=(moveNumber,own)=>a.observe({...newGame(),board,moveNumber},own);
  assert.equal(at(10,base),"playing","one estimate says nothing about a stone's effect");
  assert.equal(at(11,shifted(base,6)),"playing","six points moved by one stone");
  assert.equal(at(12,shifted(base,4)),"playing","the window still holds the six-point move");
  assert.equal(at(13,shifted(base,3)),"near","each stone now moves about 2 points or less");
  assert.equal(at(14,shifted(base,3)),"ready","nothing moved at all");
  assert.equal(at(15,shifted(base,4)),"ready");
  assert.equal(at(16,shifted(base,7)),"playing","a big swing takes the advice back");
});

test("a dead stone left in atari does not hold back the advice, a live one does",()=>{
  const board=Array(81).fill(0);
  for(let i=0;i<27;i++)board[i]=BLACK;
  for(let i=54;i<81;i++)board[i]=WHITE;
  const dead=at(4,3);
  board[dead]=WHITE;board[at(3,3)]=BLACK;board[at(5,3)]=BLACK;
  const ownership=board.map((_,i)=>i<45?1:-1);
  const quiet=new EndgameAdvisor();
  let stage;
  for(const moveNumber of [40,41,42])stage=quiet.observe({...newGame(),board,moveNumber},ownership);
  assert.equal(stage,"ready");
  const fight=new EndgameAdvisor();
  const alive=[...ownership];alive[dead]=-.9;
  for(const moveNumber of [40,41,42])stage=fight.observe({...newGame(),board,moveNumber},alive);
  assert.equal(stage,"near","a live group in atari keeps 'ready' back");
});

test("a short, decisive game is offered scoring without any move or stone count",()=>{
  // The reported 30-move position: every empty point all but decided, one
  // dead Black stone in atari inside White's area.
  const rows=[".........",".........","...BBBBB.","..BBWWWB.","BBBW..WBB","BWW.W.WWW","W.BW.....",".WW......","........."];
  const board=rows.join("").split("").map(c=>c==="B"?BLACK:c==="W"?WHITE:0);
  const ownership=board.map((_,i)=>{const x=i%9,y=Math.floor(i/9);
    return y<3||(y===3&&(x<4||x>6))||(y===4&&(x<3||x>6))||(y===5&&x===0)?1:-1;});
  const advisor=new EndgameAdvisor();
  for(const moveNumber of [28,29])advisor.observe({...newGame(),board,moveNumber},ownership);
  assert.equal(advisor.observe({...newGame(),board,moveNumber:30},ownership),"ready");
  assert.equal(endgameHint({...newGame(),board,moveNumber:30},advisor),"終局をご検討ください");
});

