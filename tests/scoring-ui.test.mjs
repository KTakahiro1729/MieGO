import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const app=readFileSync(new URL("../public/app.mjs",import.meta.url),"utf8");
const worker=readFileSync(new URL("../src/katago/neural-worker.ts",import.meta.url),"utf8");
const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");

test("AI mode starts from the 新規対戦 sheet with a readiness-gated start",()=>{
  assert.match(html,/name="newGameMode" value="ai"/);
  // 五目並べ's computer needs no KataGo; every Go game waits for it.
  assert.match(app,/\$\("startAi"\)\.disabled=needsKatago && \(!katagoReady \|\| fallbackMode\)/);
  assert.match(app,/function leaveOnlineRoom\(\)/);
  assert.doesNotMatch(html,/id="aiMenu"/);
});
test("automatic dead-stone inference reuses scoring panel, no new permanent UI",()=>{
  // The dead stones come from KataGo's settle playout plus the ownership estimate.
  assert.match(app,/kind:"settle"/);
  assert.match(app,/deadFromPlayout\(game,run\.state\.board,run\.ownership\)/);
  assert.match(app,/suggestDeadStones\(game,run\.initialOwnership\)/);
  assert.match(app,/scoringReviewAction\("dead_auto"/);
  assert.match(app,/deadReviewTouched/);
  assert.match(html,/id="scoreBox"/);
  assert.doesNotMatch(html,/id="autoDeadButton"/);
  assert.match(worker,/event\.data\.kind === "settle"/);
});
test("scoring agreements do not restart model selection of dead stones",()=>{
  assert.match(app,/\["move","resume","mode","solo_scoring"\]\.includes\(action\.type\)/);
  assert.doesNotMatch(app,/\["move","resume","mode","solo_scoring","solo_score"\]/);
  assert.match(app,/deadReview==="complete"/);
});
test("tapping a counting stone on empty territory is ignored instead of alerting",()=>{
  assert.match(app,/game\.status==="scoring"\)\{\n\s*if\(room&&!connected\)return;\n(?:\s*\/\/.*\n)?\s*if\(!game\.board\[position\]\)return;/);
});
