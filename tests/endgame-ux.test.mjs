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
  assert.match(app,/endHintSuppressedUntil=game\.moveNumber\+4;\n    endExpanded=false;updateEndUi\(\);/);
});
test("the bar draws attention when a decision is asked, and honours reduced motion",()=>{
  assert.match(app,/classList\.toggle\("is-calling"/);
  assert.match(css,/\.endgame-bar\.is-calling\{[^}]*animation:end-call/);
  assert.match(css,/prefers-reduced-motion:reduce\)\{\*,\*::before,\*::after\{[^}]*animation:none!important/);
});
