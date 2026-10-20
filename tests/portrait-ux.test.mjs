import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {TEXT} from "../public/texts.mjs";
const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
const css=readFileSync(new URL("../public/style.css",import.meta.url),"utf8");
const app=readFileSync(new URL("../public/app.mjs",import.meta.url),"utf8");
const retap=readFileSync(new URL("../public/confirm-retap.mjs",import.meta.url),"utf8");
const appearance=readFileSync(new URL("../public/appearance-settings.mjs",import.meta.url),"utf8");
test("move counter is in the status row under the board, not in the endgame strip",()=>{
  assert.ok(html.indexOf('id="board"')<html.indexOf('id="moveLabel"'));
  assert.ok(html.indexOf('id="moveLabel"')<html.indexOf('id="endgameBar"'));
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
  assert.match(app,/\$\("endPropose"\)\.textContent=!room\?TEXT\.endgame\.startScoring:TEXT\.endgame\.propose/);
  assert.deepEqual([TEXT.endgame.startScoring,TEXT.endgame.propose],["採点を始める","終局を提案"]);
  assert.doesNotMatch(app,/"終局しますか？"/);
  assert.match(app,/\$\("endAccept"\)\.textContent=!room\?TEXT\.endgame\.goScoring:TEXT\.common\.accept/);
  assert.deepEqual([TEXT.endgame.goScoring,TEXT.common.accept],["採点へ進む","受け入れる"]);
});
test("final score is above sticky actions and visible in a compact score area",()=>{
  assert.ok(html.indexOf('id="scoreBox"')<html.indexOf('id="actionRow"'));
  assert.match(css,/\.game-panel\.is-scoring,\.game-panel\.is-finished\{--board-reserve:337px\}/);
  // The legend stays while counting and explains the counted areas.
  assert.doesNotMatch(css,/\.is-scoring \.ownership-legend[^}]*display:none/);
  assert.match(appearance,/\$\("legendNeutral"\)\.hidden=!counting/);
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
  assert.match(app,/if\(!room\)\{[\s\S]{0,240}endExpanded=true;show\(\);/);
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
  assert.match(app,/if\(!confirmByRetap\(\$\("resign"\),null,TEXT\.game\.resignConfirmAria\)\)return;/);
  assert.equal(TEXT.confirm.armedLabel(TEXT.common.resign),"投了？");
  assert.match(retap,/armedConfirm && !armedConfirm\.button\.contains\(e\.target\)/);
});
test("finished view exposes next match and history without hidden menus",()=>{
  assert.match(html,/id="newMatch"/);
  assert.match(html,/id="openHistory"/);
  assert.match(app,/\$\("newMatch"\)\.hidden=!isFinished/);
  assert.match(app,/\$\("openHistory"\)\.hidden=!isFinished/);
});

test("AI scoring uses human-only confirmation, and remote scoring retains two-player consent",()=>{
  // Japanese counting agrees on the dead stones first, the same way.
  assert.match(app,/if\(!room\)apply\(\{type:deadStep\?"solo_dead":"solo_score"\}\)/);
  assert.match(app,/else apply\(\{type:deadStep\?"agree_dead":"agree",color\}\)/);
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
test("solo endgame prompt names AI only in AI games",()=>{
  assert.match(app,/localPrompt\?\(gameMode==="ai"\?TEXT\.endgame\.detailLocalAi:\s*TEXT\.endgame\.detailLocal\)/);
  assert.match(TEXT.endgame.detailLocalAi,/AIが終局を承認するわけではありません/);
  assert.doesNotMatch(TEXT.endgame.detailLocal,/AI/);
});
test("continue-style choices sit left of the advancing choice, in the bar and while scoring",()=>{
  const bar=html.slice(html.indexOf('id="endActions"'),html.indexOf('id="analysisStatus"'));
  assert.ok(bar.indexOf('id="endDecline"')<bar.indexOf('id="endAccept"'));
  const scoring=html.slice(html.indexOf('id="scoringActions"'),html.indexOf('id="openHistory"'));
  assert.ok(scoring.indexOf('id="resume"')<scoring.indexOf('id="agree"'));
});
test("only a solo accept is gold; an incoming online offer gets two equal choices",()=>{
  assert.match(app,/\$\("endAccept"\)\.classList\.toggle\("primary",!room\)/);
  // Gold comes from the shared .primary class alone, never a per-button colour.
  assert.doesNotMatch(css,/#endAccept[^{]*\{[^}]*background/);
});
test("solo prompt hides the second gold button without shifting the action row",()=>{
  assert.match(app,/\$\("actionRow"\)\.classList\.toggle\("end-prompt-open",localPrompt\)/);
  assert.match(css,/\.action-row\.end-prompt-open #confirm\{visibility:hidden\}/);
  // Opening the prompt drops any provisional stone; tapping the board means "keep playing".
  assert.match(app,/candidate=null;illegalCandidate=null;illegalPromptCopied=false;[\s\S]{0,80}endExpanded=true;show\(\)/);
  assert.match(app,/if\(!room && endExpanded\)endExpanded=false;/);
});
test("AI scoring waits for a computing move instead of pausing the AI",()=>{
  assert.match(app,/if\(aiThinking\)\$\("endPropose"\)\.disabled=true;/);
  assert.match(app,/if\(!room\)\{\s*if\(aiThinking\)return;/);
  assert.doesNotMatch(app,/AIは待機しています/);
});
test("a disconnected online bar says why its buttons are disabled",()=>{
  assert.match(app,/const offline=!!room && \(!connected \|\| color===null\);/);
  assert.match(app,/!playing\?"":offline\?TEXT\.endgame\.offline:/);
  assert.equal(TEXT.endgame.offline,"相手を待っています");
  assert.match(app,/\$\(id\)\.disabled=offline;/);
});

test("leaving a friend's match is confirmed in place, never by a browser dialog",()=>{
  assert.doesNotMatch(app,/[^\w.]confirm\(/);
  assert.doesNotMatch(app,/[^\w.]alert\([^)]/);
  assert.match(retap,/function confirmByRetap\(button,message=null,armedAria=null\)/);
  assert.match(retap,/button\.classList\.add\("danger-armed"\)/);
});

test("an armed button itself changes: danger color and a trailing ？ on its label",()=>{
  assert.equal(TEXT.confirm.armedLabel("対局を始める"),"対局を始める？");
  assert.match(retap,/button\.textContent=TEXT\.confirm\.armedLabel/);
  assert.match(app,/keepArmedLabel\(\$\("copy"\)\)/);
});
