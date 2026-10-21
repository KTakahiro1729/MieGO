import test from "node:test";
import assert from "node:assert/strict";
import {source} from "./helpers/source.mjs";
const app=source("app.mjs");
const settle=source("settle-control.mjs");
const worker=source("../src/katago/neural-worker.ts");
const html=source("index.html");

test("AI mode starts from the 新規対戦 sheet with a readiness-gated start",()=>{
  assert.match(html,/name="newGameMode" value="ai"/);
  // 五目並べ's computer needs no KataGo; every Go game waits for it.
  assert.match(app,/\$\("startAi"\)\.disabled=needsKatago && \(!katagoReady \|\| fallbackMode\)/);
  assert.doesNotMatch(html,/id="aiMenu"/);
});
test("automatic dead-stone inference reuses scoring panel, no new permanent UI",()=>{
  // The dead stones come from KataGo's settle playout plus the ownership estimate.
  assert.match(settle,/kind:"settle"/);
  assert.match(settle,/deadFromPlayout\(game,run\.state\.board,run\.ownership\)/);
  assert.match(settle,/suggestDeadStones\(game,run\.initialOwnership\)/);
  assert.match(app,/scoringReviewAction\("dead_auto"/);
  assert.match(app,/deadReviewTouched/);
  assert.doesNotMatch(html,/id="autoDeadButton"/);
  assert.match(worker,/event\.data\.kind === "settle"/);
});
test("対局を再開 names the side that asks, so its opponent moves first",()=>{
  assert.match(app,/game=resume\(game,action\.color\)/);
  assert.match(app,/const color=room\?myOnlineColor\(\):gameMode==="ai" && !isWatching\(\)\?humanColor:null;\n  apply\(color\?\{type:"resume",color\}:\{type:"resume"\}\);/);
});
test("scoring agreements do not restart model selection of dead stones",()=>{
  assert.match(app,/\["move","resume","mode","solo_scoring"\]\.includes\(action\.type\)/);
  assert.doesNotMatch(app,/\["move","resume","mode","solo_scoring","solo_score"\]/);
  assert.match(app,/deadReview==="complete"/);
});
test("tapping a counting stone on empty territory is ignored instead of alerting",()=>{
  assert.match(app,/game\.status==="scoring"\)\{\n\s*if\(room&&!connected\)return;\n(?:\s*\/\/.*\n)?\s*if\(!game\.board\[position\]\)return;/);
});
test("無勝負: one board and the COM end at once, a friend is asked, and a watched cycle ends by itself",()=>{
  assert.match(app,/else if\(action\.type==="void"\) \{/);
  assert.match(app,/apply\(\{type:"void",number:game\.moveNumber,before:boardHash\(game\.board\)\}\)/);
  assert.match(app,/apply\(\{type:"end_offer",color,\.\.\.kind,/);
  assert.match(app,/if\(isAiMove && watching && repeatedPosition\(game\)>=2\)\{stopAiTurn\(\);game=voidGame\(game\);\}/);
});
test("対COM, the player's offer is answered at once and costs no move",()=>{
  assert.match(app,/const accept=comAcceptsEnd\(-humanColor\);\n      apply\(\{type:"end_offer",color,/);
  assert.match(app,/apply\(\{type:"end_answer",color:-humanColor,accept,proposalFrom:color,/);
  assert.match(app,/text:TEXT\.endgame\.comDeclined/);
  assert.doesNotMatch(app,/askedComToEnd|submitMove\(null\);return;/);
});
