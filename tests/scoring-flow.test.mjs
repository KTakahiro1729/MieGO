import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { newGame, play, at, BLACK } from "../public/core.mjs";
import {
  canApproveScoring, canApplyAutomatedReview, deadSignature
} from "../public/scoring-flow.mjs";
const app=readFileSync(new URL("../public/app.mjs",import.meta.url),"utf8");
const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
const css=readFileSync(new URL("../public/style.css",import.meta.url),"utf8");

test("score approval is blocked during preparation, loading and awaiting host",()=>{
  const scoring={...newGame(),status:"scoring"};
  for(const stage of ["idle","pending","loading","awaiting"])
    assert.equal(canApproveScoring(scoring,stage,null,false),false);
  for(const stage of ["complete","none","modified","unavailable"])
    assert.equal(canApproveScoring(scoring,stage,null,false),true);
  assert.equal(canApproveScoring(newGame(),"complete",null,false),false);
});
test("online scoring requires connection and a completed review",()=>{
  const scoring={...newGame(),status:"scoring"};
  assert.equal(canApproveScoring(scoring,"complete","room",false),false);
  assert.equal(canApproveScoring(scoring,"complete","room",true),true);
  assert.equal(canApproveScoring(scoring,"awaiting","room",true),false);
});
test("stale or manually overridden automatic dead marks cannot replace corrections",()=>{
  const scoring={...newGame(),status:"scoring"};
  const action={number:scoring.moveNumber,before:scoring.board.map(n=>n+1).join(""),
    deadBefore:deadSignature(scoring.dead),positions:[]};
  assert.equal(canApplyAutomatedReview(scoring,false,action),true);
  assert.equal(canApplyAutomatedReview(scoring,true,action),false);
  const stale={...action,deadBefore:"0"};
  assert.equal(canApplyAutomatedReview(scoring,false,stale),false);
  const touched={...scoring,dead:[at(4,4)]};
  assert.equal(canApplyAutomatedReview(touched,false,action),false);
  assert.equal(canApplyAutomatedReview({...scoring,agreed:{black:true,white:false}},false,action),false);
});
test("scoring actions occupy the existing action row, above which the score remains",()=>{
  assert.ok(html.indexOf('id="scoreBox"') < html.indexOf('id="actionRow"'));
  assert.ok(html.indexOf('id="actionRow"') < html.indexOf('id="scoringActions"'));
  for(const id of ["agree","resume","scoreBox","scoringActions","openCurrentMode"])
    assert.equal(html.split('id="'+id+'"').length-1,1);
  assert.match(app,/\$\("scoringActions"\)\.hidden=!isScoring/);
  assert.match(css,/\.inline-score-actions\{display:flex/);
});
test("context game menu supplies AI rematch and online re-invitation",()=>{
  assert.match(app,/\$\("openCurrentMode"\)\.textContent=room\?"招待URLを表示":"AIの設定・再戦"/);
  assert.match(app,/if\(room\)openPanel\("online"\)/);
  assert.match(app,/else if\(gameMode==="ai"\)openPanel\("ai"\)/);
});
test("manual score correction sends desired state and blocks late AI proposals",()=>{
  assert.match(app,/selected:!game\.dead\.includes\(position\)/);
  assert.match(app,/if\(!canApplyAutomatedReview\(game,deadReviewTouched,action\)\)return;/);
  assert.match(app,/deadReviewTouched=true;\s*deadReview="modified"/);
  assert.match(app,/scoringReview:game\.status==="scoring"/);
  assert.match(app,/scoringReviewAction\("dead_unavailable"/);
});
