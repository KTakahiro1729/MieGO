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
  assert.match(strip,/id="endStatus"/);
  assert.match(strip,/id="endPropose"/);
  assert.match(strip,/id="endActions"/);
});
test("endgame choices share exactly one fixed-height horizontal strip",()=>{
  assert.equal(html.split('id="endgameBar"').length-1,1);
  assert.match(css,/\.endgame-bar\{height:48px;min-height:48px;max-height:48px/);
  assert.match(css,/\.endgame-bar \.end-status\{flex:1/);
  assert.match(app,/near\?"終局はいかがですか？":"終局はまだのようです"/);
  assert.match(app,/\$\("endPropose"\)\.textContent="終局を提案"/);
  assert.match(app,/\$\("endAccept"\)\.textContent="受け入れる"/);
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
test("pass is a single tap in every mode; solo endgame stays in-bar",()=>{
  assert.match(app,/\$\("pass"\)\.onclick=\(\)=>submitMove\(null\);/);
  assert.doesNotMatch(app,/passArmed|パス？/);
  assert.doesNotMatch(app,/confirm\("パスしますか？"\)/);
  assert.match(app,/if\(!room\)\{endExpanded=true;updateEndUi\(\);return;\}/);
  assert.match(app,/if\(!room && endExpanded && !game\.endProposal\)/);
  assert.match(app,/type:"end_answer",color:-color,accept:true/);
  assert.match(app,/endExpanded=false;updateEndUi\(\);return;/);
});
test("autosaved everyday navigation has no blocking browser confirmation",()=>{
  assert.doesNotMatch(app,/confirm\("パスしますか？"\)/);
  assert.doesNotMatch(app,/confirm\("新しい対局を始めますか？/);
  assert.doesNotMatch(app,/confirm\("現在の対局を離れて、友人対局を開始しますか？/);
  assert.match(app,/if\(room && connected &&/);
});
test("resignation is a visible button with inline two-tap safety",()=>{
  assert.doesNotMatch(html,/id="gameMenu"/);
  assert.doesNotMatch(app,/confirm\("投了しますか？"\)/);
  assert.match(app,/\$\("resign"\)\.textContent="投了？"/);
  assert.match(app,/if\(!resignArmed\)/);
  assert.match(app,/resignArmed && e\.target!==\$\("resign"\)/);
});
test("finished view exposes next match and history without hidden menus",()=>{
  assert.match(html,/id="newMatch"/);
  assert.match(html,/id="openHistory"/);
  assert.match(app,/\$\("newMatch"\)\.hidden=!isFinished/);
  assert.match(app,/\$\("openHistory"\)\.hidden=!isFinished/);
});

test("confirm button uses the original shared gold-and-opacity disabled appearance",()=>{
  assert.match(css,/button:disabled\{opacity:\.36;cursor:default\}/);
  assert.match(css,/\.primary\{color:#17191e;background:linear-gradient\(180deg,#f5d88f,#e4b85c\)/);
  assert.doesNotMatch(css,/\.action-row #confirm:disabled/);
  assert.match(html,/id="confirm" class="primary" type="button" disabled/);
  assert.match(app,/\$\("confirm"\)\.disabled=!candidate \|\| !myTurn/);
});
