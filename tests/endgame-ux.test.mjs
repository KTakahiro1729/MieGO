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
  assert.match(css,/\.endgame-bar\.is-calling\{[^}]*animation:end-call/);
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
test("the COM's pass opens the same question as 採点を始める, and 採点へ進む is the player's pass",()=>{
  assert.match(TEXT.endgame.askAiPassed,/採点を始めますか？$/);
  assert.equal(TEXT.endgame.askAiPassed.split("\n").at(-1),TEXT.endgame.askLocal);
  assert.doesNotMatch(TEXT.endgame.detailAiPassed,/承認するわけではありません/);
  // Only against a COM, never while watching two COMs.
  assert.match(app,/const aiPassAsks = \(\) => !room && gameMode === "ai" && !watching/);
  assert.match(app,/if\(action\.type==="move"\)endExpanded=isAiMove && aiPassAsks\(\);/);
  assert.match(app,/if\(!room && endExpanded && aiPassAsks\(\)\)\{\n    endExpanded=false;submitMove\(null\);return;/);
  // A reloaded game asks again rather than leaving the pass unanswered.
  assert.equal(app.match(/endExpanded=!!game\.endProposal \|\| aiPassAsks\(\);/g).length,3);
});
