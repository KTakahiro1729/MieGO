import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {settleLimit,settleStepMs} from "../public/settle-playout.mjs";
import {TEXT} from "../public/texts.mjs";
const app=readFileSync(new URL("../public/app.mjs",import.meta.url),"utf8");
const css=readFileSync(new URL("../public/style.css",import.meta.url),"utf8");

test("a full-length playout is shown in about ten seconds on every board",()=>{
  assert.deepEqual([9,13,19].map(settleStepMs),[333,161,120]);
  for(const size of [9,13,19])assert.ok(settleLimit(size)*settleStepMs(size)<=15000);
});
test("after one pass the bar says who passed and that the next pass starts scoring",()=>{
  assert.equal(TEXT.endgame.passedLocal("W"),"パスで採点へ。白はパス済み");
  assert.match(TEXT.endgame.passedAi,/^パスで採点へ。/);
  assert.match(app,/passed\?passed\.text:hint/);
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
  assert.match(app,/classList\.toggle\("is-calling"/);
  assert.match(css,/\.endgame-bar\.is-calling\{[^}]*animation:end-call/);
  assert.match(css,/prefers-reduced-motion:reduce\)\{\*,\*::before,\*::after\{[^}]*animation:none!important/);
});
test("a stone tapped during the playout is corrected on top of its result",()=>{
  assert.match(app,/else if\(settle\)\{settle\.taps=\[\.\.\.\(settle\.taps\|\|\[\]\),position\];skipSettle\(\);return;\}/);
  assert.match(app,/for\(const position of run\.taps\|\|\[\]\)\n\s*apply\(\{type:"dead",position,selected:!game\.dead\.includes\(position\)\}\);/);
});
test("a playout stopped at its move limit is not described as settled",()=>{
  assert.match(TEXT.scoring.settleCut(27),/^上限の27手で止めた盤面/);
  assert.match(app,/run\.cut=run\.state\.status==="playing";/);
});
test("a playout stopped at its move limit can be carried on by the AI",()=>{
  const html=readFileSync(new URL("../src/index.template.html",import.meta.url),"utf8");
  assert.match(html,/<button id="settleExtend" class="secondary" type="button" hidden>\{\{scoring\.settleExtend\}\}<\/button>/);
  assert.equal(TEXT.scoring.settleExtend,"AIに続きを打たせる");
  assert.equal(TEXT.scoring.settleExtendHint(27),"続きを打たせて地を決めてください。27手で停止");
  // Only a cut playout continues, from where it stopped, for another limit's worth of moves.
  assert.match(app,/return frames && frames\.at\(-1\)\.status==="playing" \? \{\.\.\.playout,state:frames\.at\(-1\)\} : null;/);
  assert.match(app,/limit:Math\.min\(settleMax\(sizeOf\(game\.board\)\),positions\.length\+settleLimit\(sizeOf\(game\.board\)\)\)/);
  assert.match(app,/\$\("settleExtend"\)\.onclick=extendSettle;/);
});
