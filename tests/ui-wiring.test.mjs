import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
const dir=new URL("../public/",import.meta.url);
const html=readFileSync(new URL("index.html",dir),"utf8");
const app=readFileSync(new URL("app.mjs",dir),"utf8");
const css=readFileSync(new URL("style.css",dir),"utf8");
const ids=new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]));
test("every $(id) lookup in UI modules names an element in index.html",()=>{
  // A removed element left behind as $("x").prop=... throws and aborts the handler.
  for(const file of readdirSync(dir).filter(f=>f.endsWith(".mjs") && !f.includes("bundle"))){
    const source=readFileSync(new URL(file,dir),"utf8");
    for(const [,id] of source.matchAll(/\$\("([^"]+)"\)/g))
      assert.ok(ids.has(id),file+" references missing #"+id);
  }
});
test("saved-game import, SGF export and resume controls are wired",()=>{
  assert.match(app,/\$\("historyImportFile"\)\.onchange=/);
  assert.match(app,/\$\("shareSgf"\)\.onclick=exportSharedSGF/);
  assert.match(app,/\$\("reviewContinue"\)\.onclick=\(\)=>canResumeSelectedReview\(\)\?resumeSelectedReview\(\):atLiveLatest\(\)\?leaveBoardReview\(\):openContinuePanel\(\)/);
});
test("sheets make the board and header inert while open",()=>{
  assert.match(app,/function openPanel\(kind\) \{\n  setBackgroundInert\(true\);/);
  assert.match(app,/function closePanels\(\) \{\n  resetArmedButtons\(\);\n  setBackgroundInert\(false\);/);
});
test("game errors use the inline notice, never a blocking alert",()=>{
  assert.doesNotMatch(app,/\balert\(error/);
  assert.match(css,/\.save-status\{position:fixed/);
});
test("endgame advice never claims 'not yet' until KataGo has evaluated a position",()=>{
  // endgameHint reports 確認中／判定できません instead (see tests/endgame.test.mjs).
  assert.match(app,/endgameHint\(game,endgameAdvisor,\{\s*unavailable:fallbackMode/);
  assert.doesNotMatch(app,/near\?"終局はいかがですか？":"終局はまだのようです"/);
});
