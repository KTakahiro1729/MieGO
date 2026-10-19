import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const app=readFileSync(new URL("../public/app.mjs",import.meta.url),"utf8");
const worker=readFileSync(new URL("../src/katago/neural-worker.ts",import.meta.url),"utf8");
const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");

test("AI mode uses the main header mode selector and readiness-gated start",()=>{
  assert.match(html,/id="modePicker"/);
  assert.match(app,/\$\("startAi"\)\.disabled=!katagoReady \|\| fallbackMode/);
  assert.match(app,/function leaveOnlineRoom\(\)/);
  assert.doesNotMatch(html,/id="aiMenu"/);
});
test("automatic dead-stone inference reuses scoring panel, no new permanent UI",()=>{
  assert.match(app,/kind:"scoring"/);
  assert.match(app,/suggestDeadStones\(game,result\.ownership\)/);
  assert.match(app,/scoringReviewAction\("dead_auto"/);
  assert.match(app,/deadReviewTouched/);
  assert.match(html,/id="scoreBox"/);
  assert.doesNotMatch(html,/id="autoDeadButton"/);
  assert.match(worker,/event\.data\.kind === "scoring"/);
});
test("scoring agreements do not restart model selection of dead stones",()=>{
  assert.match(app,/\["move","resume","mode"\]\.includes\(action\.type\)/);
  assert.match(app,/deadReview==="complete"/);
});
