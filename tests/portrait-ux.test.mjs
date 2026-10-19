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
  assert.match(app,/endgameHint\(game,endgameAdvisor/);
  assert.match(app,/\$\("endPropose"\)\.textContent=!room\?"採点を始める":"終局を提案"/);
  assert.doesNotMatch(app,/"終局しますか？"/);
  assert.match(app,/\$\("endAccept"\)\.textContent=!room\?"採点へ進む":"受け入れる"/);
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
test("pass is immediate; solo endgame uses in-bar accept/continue, not a dialog",()=>{
  assert.match(app,/\$\("pass"\)\.onclick=\(\)=>submitMove\(null\);/);
  assert.doesNotMatch(app,/confirm\("パスしますか？"\)/);
  assert.match(app,/if\(!room\)\{\s*endExpanded=true;/);
  assert.match(app,/if\(!room && endExpanded && !game\.endProposal\)/);
  assert.match(app,/type:"solo_scoring",number:game\.moveNumber/);
  assert.doesNotMatch(app,/type:"end_answer",color:-color,accept:true/);
  assert.match(app,/endExpanded=false;updateEndUi\(\);/);
  assert.match(app,/if\(isAiTurn\(\)\)requestAnalysis\(\)/);
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
  assert.match(app,/\$\("resign"\)\.textContent="確定"/);
  assert.match(app,/if\(!resignArmed\)/);
  assert.match(app,/resignArmed && e\.target!==\$\("resign"\)/);
});
test("finished view exposes next match and history without hidden menus",()=>{
  assert.match(html,/id="newMatch"/);
  assert.match(html,/id="openHistory"/);
  assert.match(app,/\$\("newMatch"\)\.hidden=!isFinished/);
  assert.match(app,/\$\("openHistory"\)\.hidden=!isFinished/);
});

test("AI scoring uses human-only confirmation, and remote scoring retains two-player consent",()=>{
  assert.match(app,/if\(!room\)apply\(\{type:"solo_score"\}\)/);
  assert.match(app,/else apply\(\{type:"agree",color\}\)/);
  assert.match(app,/game=finalizeSoloScore\(game\)/);
  assert.match(app,/game=beginSoloScoring\(game\)/);
  assert.doesNotMatch(app,/apply\(\{type:"agree",color:gameMode==="ai"\?/);
});
test("AI turn cannot dismiss a visible scoring decision and resumes after cancel",()=>{
  assert.match(app,/if\(endExpanded\)return;\s*if \(aiThinking\) return;/);
  assert.match(app,/if\(endExpanded\)return;\s*if\(result\.engine!=="katago"\)/);
  assert.match(app,/stopAiTurn\(\); \/\/ Invalidate pending AI workers/);
});
test("confirm button uses the original shared gold-and-opacity disabled appearance",()=>{
  assert.match(css,/button:disabled\{opacity:\.36;cursor:default\}/);
  assert.match(css,/\.primary\{color:#17191e;background:linear-gradient\(180deg,#f5d88f,#e4b85c\)/);
  assert.doesNotMatch(css,/\.action-row #confirm:disabled/);
  assert.match(html,/id="confirm" class="primary" type="button" disabled/);
  assert.match(app,/\$\("confirm"\)\.disabled=!candidate \|\| !myTurn/);
});
test("solo endgame prompt names AI only in AI games and shows the AI as paused",()=>{
  assert.match(app,/localPrompt\?\(gameMode==="ai"\?"あなたの判断で採点へ進みます。AIが終局を承認するわけではありません。":\s*"採点に進み、死石を確認します。対局の再開もできます。"\)/);
  assert.match(app,/isAiTurn\(\)&&endExpanded\?"採点するか確認中のため、AIは待機しています":\s*isAiTurn\(\)\?"AIが着手を計算しています"/);
  assert.match(app,/endExpanded=true;[\s\S]{0,120}if\(isAiTurn\(\)\)\{\s*stopAiTurn\(\);/);
});
