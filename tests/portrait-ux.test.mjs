import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
const css=readFileSync(new URL("../public/style.css",import.meta.url),"utf8");
const app=readFileSync(new URL("../public/app.mjs",import.meta.url),"utf8");
test("move counter is above board, not in the endgame strip",()=>{
  assert.ok(html.indexOf('id="moveLabel"')<html.indexOf('id="board"'));
  const strip=html.slice(html.indexOf('id="endgameBar"'),html.indexOf('id="scoreBox"'));
  assert.doesNotMatch(strip,/id="moveLabel"|交点をタップして仮置き/);
  assert.match(strip,/id="endToggle"/);
  assert.match(strip,/id="endActions"/);
});
test("endgame choices share exactly one fixed-height horizontal strip",()=>{
  assert.equal(html.split('id="endgameBar"').length-1,1);
  assert.match(css,/\.endgame-bar\{display:flex;align-items:center;min-height:44px;height:44px/);
  assert.match(css,/\.endgame-bar \.end-actions\{flex:1/);
  assert.match(app,/\$\("endgameBar"\)\.classList\.toggle\("is-expanded",expanded\)/);
});
test("final score is above sticky actions and visible in a compact score area",()=>{
  assert.ok(html.indexOf('id="scoreBox"')<html.indexOf('id="actionRow"'));
  assert.match(css,/\.game-panel\.is-scoring,\.game-panel\.is-finished\{--board-reserve:337px\}/);
  assert.match(css,/\.game-panel\.is-scoring \.ownership-legend,\.game-panel\.is-finished \.ownership-legend\{display:none\}/);
  assert.match(app,/\$\("scoreBox"\)\.querySelector\("strong"\)\.textContent=/);
  assert.match(app,/\$\("gamePanel"\)\.classList\.toggle\("is-finished",isFinished\)/);
});
test("game screen viewport never scrolls and board responds to available height",()=>{
  assert.match(css,/body\{overflow:hidden\}/);
  assert.match(css,/\.game-layout\{height:calc\(100dvh - var\(--topbar-height\)\);overflow:hidden/);
  assert.match(css,/calc\(100dvh - var\(--board-reserve\) - env\(safe-area-inset-bottom\)\)/);
});
test("frequent pass and solo endgame do not open redundant confirmation screens",()=>{
  assert.match(app,/\$\("pass"\)\.onclick=\(\)=>submitMove\(null\);/);
  assert.doesNotMatch(app,/confirm\("パスしますか？"\)/);
  assert.match(app,/if\(!room && game\.status==="playing" && game\.endProposal\?\.from===color\)/);
  assert.match(app,/type:"end_answer",color:-color,accept:true/);
});
