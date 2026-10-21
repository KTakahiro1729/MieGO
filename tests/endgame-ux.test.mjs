import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {TEXT} from "../public/texts.mjs";
const app=readFileSync(new URL("../public/app.mjs",import.meta.url),"utf8");
const settle=readFileSync(new URL("../public/settle-control.mjs",import.meta.url),"utf8");
const css=readFileSync(new URL("../public/style.css",import.meta.url),"utf8");

test("the playout stays off the board: no pause between its moves, no 再生 and no スキップ",()=>{
  const html=readFileSync(new URL("../src/index.template.html",import.meta.url),"utf8");
  assert.doesNotMatch(settle,/setTimeout|replay|skip/);
  // The board shows the count of the real position meanwhile, not a playout view.
  assert.doesNotMatch(app,/settle:settleControl\.view\(\)/);
  assert.doesNotMatch(html,/settleSkip|settleReplay/);
  assert.equal(TEXT.scoring.settleSkip,undefined);
  assert.equal(TEXT.scoring.settleReplay,undefined);
});
test("after one pass the bar says who passed and that the next pass starts scoring",()=>{
  assert.equal(TEXT.endgame.passedLocal("W"),"パスで採点へ。白はパス済み");
  assert.match(TEXT.endgame.passedAi,/^パスで採点へ。/);
});
test("a friend's answer to an end offer is shown to the one who offered",()=>{
  assert.match(app,/TEXT\.endgame\.withdrawnByPeer:TEXT\.endgame\.declinedByPeer/);
  assert.match(app,/text:TEXT\.endgame\.cancelledByMove/);
  assert.match(app,/peerAgreed\(\)\?\(scoringStepOf\(game\)==="dead"\?TEXT\.scoring\.peerAgreedDead:TEXT\.scoring\.peerAgreed\)/);
});
test("keeping on playing holds back the strongest advice in every mode",()=>{
  assert.match(app,/endgameAdvisor\.hold\(\);\n    endExpanded=false;updateEndUi\(\);/);
  assert.match(app,/if\(!action\.accept\)endgameAdvisor\.hold\(\);/);
  assert.doesNotMatch(app,/endHintSuppressedUntil/);
});
test("the bar draws attention when a decision is asked, and honours reduced motion",()=>{
  assert.match(app,/for\(const \[name,on\] of Object\.entries\(classes\)\)\$\(id\)\.classList\.toggle\(name,on\);/);
  assert.match(css,/\.endgame-bar\.is-calling \.end-action:not\(\[hidden\]\)\{[^}]*animation:end-call/);
  // The glow is on the buttons themselves: a frame round the bar would read as a button holding buttons.
  assert.doesNotMatch(css,/\.endgame-bar\.is-calling\{/);
  assert.match(css,/prefers-reduced-motion:reduce\)\{\*,\*::before,\*::after\{[^}]*animation:none!important/);
});
test("a stone tapped during the playout is corrected on top of its result",()=>{
  assert.match(app,/if\(settleControl\.tap\(position\)\)return;/);
  assert.match(settle,/settle\.taps=\[\.\.\.\(settle\.taps\|\|\[\]\),position\];return true;/);
  assert.match(app,/for\(const position of run\.taps\|\|\[\]\)\n\s*apply\(\{type:"dead",position,selected:!game\.dead\.includes\(position\)\}\);/);
});
test("a playout runs to two passes, with no stop to carry it on",()=>{
  const html=readFileSync(new URL("../src/index.template.html",import.meta.url),"utf8");
  assert.doesNotMatch(html,/settleExtend/);
  assert.equal(TEXT.scoring.settleExtend,undefined);
  assert.match(settle,/limit:settleMax\(sizeOf\(game\.board\)\)/);
});
test("starting scoring before the board has settled says open areas count for nobody",()=>{
  // Worked out by endgameBarView (tests/endgame-bar.test.mjs).
  assert.match(TEXT.endgame.detailUnsettled,/どちらの地にもなりません/);
});
test("against a COM a pass is a move and the end is an offer, never one for the other",()=>{
  // The COM's pass asks nothing; the bar only says the next pass starts the count.
  assert.doesNotMatch(app,/aiPassAsks/);
  assert.equal(TEXT.endgame.askAiPassed,undefined);
  assert.match(app,/if\(action\.type==="move"\)endExpanded=false;/);
  // The COM offers instead of a stone, and moves only once its offer is answered.
  assert.match(app,/apply\(\{type:"end_offer",color:game\.next,number:game\.moveNumber,before:boardHash\(game\.board\)\},false,true\);/);
  assert.match(app,/const isAiTurn = \(\) => !room && gameMode === "ai" && game\.status === "playing" && !game\.endProposal &&/);
  // A reloaded game shows the COM's offer again rather than leaving it unanswered.
  assert.equal(app.match(/endExpanded=!!game\.endProposal;/g).length,4);
});
