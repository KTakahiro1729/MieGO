import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {gameStorageKey,parseGameSnapshot,needsSwitchConfirmation} from "../public/mode-state.mjs";
const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
const app=readFileSync(new URL("../public/app.mjs",import.meta.url),"utf8");
test("a 新規対戦 button opens one sheet with the three modes, board size, handicap and saved games",()=>{
  assert.match(html,/<button id="newGameButton"[^>]*>新規対戦<\/button>/);
  assert.doesNotMatch(html,/<select id="modePicker"|<option value="history">/);
  const sheet=html.slice(html.indexOf('<aside id="modePanel"'),html.indexOf('</aside>',html.indexOf('<aside id="modePanel"')));
  for(const value of ["local","ai","online"])assert.match(sheet,new RegExp('name="newGameMode" value="'+value+'"'));
  for(const size of [9,13,19])assert.match(sheet,new RegExp('name="boardSize" value="'+size+'"'));
  const handicap=sheet.slice(sheet.indexOf('<select id="handicap"'),sheet.indexOf('</select>',sheet.indexOf('<select id="handicap"')));
  for(const stones of [0,2,3,4,5,6,7,8,9])assert.match(handicap,new RegExp('<option value="'+stones+'"'));
  // The three modes and 履歴 form a 2x2 grid of icon tabs in one sheet.
  assert.equal((sheet.match(/name="newGameMode"[^>]*><span><svg class="mode-icon"/g)||[]).length,4);
  assert.match(sheet,/id="openHistoryFromNew" type="radio" name="newGameMode" value="history"/);
  for(const id of ["historySetup","historyList","historyImportFile"])assert.match(sheet,new RegExp('id="'+id+'"'));
  assert.doesNotMatch(html,/id="historyPanel"|id="closeHistory"/);
  assert.match(app,/function openHistoryPanel\(\)\{openPanel\("history"\);\}/);
  assert.equal((sheet.match(/name="boardSize"[^>]*><span><svg class="size-icon"/g)||[]).length,3);
  // Handicap and the AI's style live under 詳細設定; the sampling-variance setting is gone.
  const advanced=sheet.slice(sheet.indexOf('<details id="newGameAdvanced"'),sheet.indexOf('</details>'));
  for(const id of ["handicap","aiInvasion","aiReinforcement","aiHints"])assert.match(advanced,new RegExp('id="'+id+'"'));
  // Strength stays outside 詳細設定 as a four-stop bar; the style sliders have three stops.
  assert.doesNotMatch(advanced,/id="aiStrength"/);
  assert.match(sheet,/id="aiStrength" type="range" min="0" max="3" step="1"/);
  for(const id of ["aiInvasion","aiReinforcement"])
    assert.match(advanced,new RegExp('id="'+id+'" type="range" min="0" max="100" step="50"'));
  for(const id of ["aiStrength","aiInvasion","aiReinforcement"])
    assert.equal((sheet.slice(sheet.indexOf('id="'+id+'Row"')).split('</div>')[0].match(/data-note=/g)||[]).length,id==="aiStrength"?4:3);
  assert.doesNotMatch(html+app,/aiLevel/);
  for(const id of ["startLocal","startAi","copy","openHistoryFromNew"])assert.match(sheet,new RegExp('id="'+id+'"'));
  assert.match(app,/\$\("newGameButton"\)\.onclick=\(\)=>openPanel\(room\?"online":gameMode\)/);
});
test("settings is presentation-only and has no board rotation",()=>{
  const [common] = html.split('<aside id="modePanel"');
  assert.match(common,/id="settingsPanel"/);
  assert.match(common,/name="palette"/);
  assert.match(common,/id="opacity"/);
  assert.match(common,/id="resetAppearance"/);
  // Credits and rule notes moved into the help sheet with the other explanations.
  const help=html.slice(html.indexOf('<aside id="helpPanel"'));
  assert.match(help,/github\.com\/lightvector\/KataGo/);
  assert.match(help,/id="ruleSummary"/);
  assert.doesNotMatch(common,/盤面を回転|id="aiLevel"|id="aiInvasion"|id="copy"/);
  // Board size and handicap are chosen when starting a game, not in settings.
  assert.doesNotMatch(common,/name="boardSize"|name="handicap"|id="localHandicap"|id="resetLocalGame"/);
  assert.doesNotMatch(html,/id="aiMenu"|id="returnLocal"|id="share"/);
});
test("offline mode saves are independent and valid snapshots are checked",()=>{
  assert.notEqual(gameStorageKey("local"),gameStorageKey("ai"));
  assert.throws(()=>gameStorageKey("online"));
  assert.equal(parseGameSnapshot("{"),null);
  assert.equal(parseGameSnapshot(JSON.stringify({board:[],moves:[]})),null);
  const snapshot={board:Array(81).fill(0),moves:[],moveNumber:0,next:1};
  assert.deepEqual(parseGameSnapshot(JSON.stringify(snapshot)),snapshot);
});
test("switch confirms only when a game or connection is active",()=>{
  assert.equal(needsSwitchConfirmation({moveNumber:0},"local","ai"),false);
  assert.equal(needsSwitchConfirmation({moveNumber:4},"local","ai"),true);
  assert.equal(needsSwitchConfirmation({moveNumber:0},"online","local",true),true);
  assert.equal(needsSwitchConfirmation({moveNumber:4},"ai","ai"),false);
  assert.match(app,/leaveOnlineRoom/);
});

test("late P2P events cannot modify a local game after leaving a room",()=>{
  const transport=readFileSync(new URL("../public/p2p-transport.mjs",import.meta.url),"utf8");
  assert.match(transport,/epoch!==generation\|\|channel!==c\|\|!current/);
  assert.match(transport,/function leave\(\)/);
  assert.match(app,/function leaveOnlineRoom\(\)/);
  assert.match(app,/p2pTransport\?\.leave\(\)/);
});

test("a local reset creates an empty independent game while retaining display assist preference",async()=>{
  const {newGame,play}=await import("../public/core.mjs");
  const {freshLocalGame}=await import("../public/mode-state.mjs");
  const previous=play(newGame(false),40);
  const reset=freshLocalGame(previous);
  assert.equal(reset.assisted,false);
  assert.equal(reset.moveNumber,0);
  assert.equal(reset.next,1);
  assert.equal(reset.status,"playing");
  assert.ok(reset.board.every(s=>s===0));
  assert.equal(previous.moveNumber,1);
  assert.equal(reset.moves.length,0);
});
test("direct game controls replace hidden action menus; new local games start from 新規対戦",()=>{
 const row=html.slice(html.indexOf('<div id="actionRow"'),html.indexOf('<section id="reviewPanel"'));
 assert.ok(row.indexOf('id="pass"')<row.indexOf('id="resign"'));
 assert.match(row,/id="newMatch"/);
 assert.match(row,/id="openHistory"/);
 assert.doesNotMatch(row,/<details|id="gameMenu"/);
 assert.match(html,/id="startLocal"/);
 assert.match(html,/id="openHistorySettings"/);
 assert.match(app,/if \(room \|\| gameMode!=="local"\) return;/);
 assert.match(app,/\$\("startLocal"\)\.onclick=startLocalGame/);
 assert.match(app,/game=freshLocalGame\(game,localHandicap,boardSize\);currentGameId=null;currentRevision=null;\s*save\(\);show\(\);requestAnalysis\(\);/);
});
test("settings button shows a toothed gear and is labeled",()=>{
  const gear=html.slice(html.indexOf('id="settingsToggle"'),html.indexOf('</button>',html.indexOf('id="settingsToggle"')));
  assert.match(gear,/aria-label="設定を開く"/);
  assert.match(gear,/circle/);
  assert.match(gear,/m9\.7 2\.5/);
  assert.match(gear,/<circle cx="11\.5" cy="12\.5"/);
});

test("reset discards endgame and dead-stone hints",()=>{
  const block=app.slice(app.indexOf("function freshLocalBoard()"),app.indexOf("function startLocalGame()"));
  assert.match(block,/endgameAdvisor\.reset\(\)/);
  assert.match(block,/deadReview="idle"/);
  assert.match(block,/deadEvaluation=null/);
  assert.match(block,/analysisContext=null/);
});
test("the 新規対戦 sheet offers a way back to the current or an unfinished saved game",()=>{
  const sheet=html.slice(html.indexOf('<aside id="modePanel"'),html.indexOf('</aside>',html.indexOf('<aside id="modePanel"')));
  assert.match(sheet,/id="returnToGame"[^>]*hidden>現在の対局に戻る<\/button>/);
  assert.match(app,/return \{mode:null,label:"現在の対局に戻る"\};/);
  assert.doesNotMatch(app,/label:[^\n]*手目/);
  // Finished games and friend rooms are not resumed from here.
  assert.match(app,/if\(kind==="online"\)return null;/);
  assert.match(app,/record\.snapshot\.status==="finished"\)return null;/);
  assert.match(app,/if\(target\.mode\)\{resumeModeGame\(target\.mode\);return;\}/);
});
