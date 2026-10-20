import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {gameStorageKey,parseGameSnapshot,needsSwitchConfirmation} from "../public/mode-state.mjs";
import {TEXT} from "../public/texts.mjs";
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
  // The three modes and 履歴 form one row of icon tabs in one sheet: [対COM|対友人] [1台で打つ] [履歴].
  assert.equal((sheet.match(/name="newGameMode"[^>]*><span><svg class="mode-icon"/g)||[]).length,4);
  const modes=sheet.slice(sheet.indexOf('<div class="new-game-modes">'),sheet.indexOf('<div id="newGameSetup">'));
  assert.deepEqual(modes.split('<div class="fused">').slice(1).map(group=>[...group.matchAll(/name="newGameMode" value="(\w+)"/g)].map(m=>m[1])),
    [["ai","online"],["local"],["history"]]);
  assert.match(sheet,/id="openHistoryFromNew" type="radio" name="newGameMode" value="history"/);
  // 対COM first, 履歴 last; 対COM is the first-visit default.
  assert.deepEqual([...sheet.matchAll(/name="newGameMode" value="(\w+)"/g)].map(m=>m[1]),["ai","online","local","history"]);
  assert.match(sheet,/name="newGameMode" value="ai" checked>/);
  assert.match(app,/let gameMode = room \? "online" : "ai";/);
  for(const id of ["historySetup","historyList","historyImportFile"])assert.match(sheet,new RegExp('id="'+id+'"'));
  assert.doesNotMatch(html,/id="historyPanel"|id="closeHistory"/);
  assert.match(app,/function openHistoryPanel\(\)\{openPanel\("history"\);\}/);
  assert.equal((sheet.match(/name="boardSize"[^>]*><span class="choice"><svg class="size-icon"/g)||[]).length,3);
  // Handicap and the AI's style live under 詳細設定; the sampling-variance setting is gone.
  const advanced=sheet.slice(sheet.indexOf('<details id="newGameAdvanced"'),sheet.indexOf('</details>',sheet.indexOf('<details id="newGameAdvanced"')));
  for(const id of ["handicap","aiInvasion","aiReinforcement","aiHints"])assert.match(advanced,new RegExp('id="'+id+'"'));
  // Strength stays outside 詳細設定 as five choices under its own tab, each with its note; the style sliders have three stops.
  assert.doesNotMatch(advanced,/name="aiStrength"/);
  assert.deepEqual([...sheet.matchAll(/name="aiStrength" value="(\w+)"/g)].map(m=>m[1]),["beginner","easy","normal","strong","strongest"]);
  assert.equal((sheet.slice(sheet.indexOf('id="aiStrengthChoices"'),sheet.indexOf('</fieldset>',sheet.indexOf('id="aiStrengthChoices"'))).match(/<small class="choice-note">/g)||[]).length,5);
  // 盤・ルール・自分の石・AIの強さ are one row of tabs over one panel of choices.
  assert.deepEqual([...sheet.matchAll(/id="setupTab(\w+)"[^>]*role="tab"/g)].map(m=>m[1]),["Board","Rules","Side","Strength"]);
  for(const key of ["Board","Rules","Side","Strength"])assert.match(sheet,new RegExp('id="setupPanel'+key+'" class="setup-panel" role="tabpanel"'));
  for(const id of ["aiInvasion","aiReinforcement"])
    assert.match(advanced,new RegExp('id="'+id+'" type="range" min="0" max="100" step="50"'));
  for(const id of ["aiInvasion","aiReinforcement"])
    assert.equal((sheet.slice(sheet.indexOf('id="'+id+'Row"')).split('</div>')[0].match(/data-note=/g)||[]).length,3);
  assert.doesNotMatch(html+app,/aiLevel/);
  for(const id of ["startLocal","startAi","copy","openHistoryFromNew"])assert.match(sheet,new RegExp('id="'+id+'"'));
  // The way back tops the sheet, then the start button, then the mode tabs and options.
  for(const id of ["startLocal","startAi","copy"]) {
    assert.ok(sheet.indexOf('id="returnToGame"')<sheet.indexOf('id="'+id+'"'),id);
    assert.ok(sheet.indexOf('id="'+id+'"')<sheet.indexOf('name="newGameMode"'),id);
  }
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
 // The primary action of each phase is the rightmost button; 投了 sits
 // away from ここに打つ so a slip never lands on it.
 const order=id=>row.indexOf('id="'+id+'"');
 assert.ok(order("resign")<order("pass") && order("pass")<order("confirm"));
 assert.equal(order("copyIllegalPrompt"),-1,"the AI question sits in the status line");
 assert.ok(order("openHistory")<order("newMatch"));
 assert.ok(order("newMatch")>order("confirm"),"no button follows the last primary");
 assert.match(row,/id="newMatch"/);
 assert.match(row,/id="openHistory"/);
 assert.doesNotMatch(row,/<details|id="gameMenu"/);
 assert.match(html,/id="startLocal"/);
 assert.doesNotMatch(html,/id="openHistorySettings"|id="openCurrentMode"/);
 assert.match(app,/if \(room \|\| gameMode!=="local"\) return;/);
 assert.match(app,/\$\("startLocal"\)\.onclick=\(\)=>continueFrom\?forkBoardReview\("local"\):startLocalGame\(\);/);
 assert.match(app,/game=freshLocalGame\(game,nextGameOptions\(localHandicap\)\);currentGameId=null;currentRevision=null;\s*save\(\);show\(\);requestAnalysis\(\);/);
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
  assert.match(sheet,/id="returnToGame"[^>]*>現在の対局に戻る<\/button>/);
  // The way back stays in every mode, so the sheet keeps its layout when the mode changes.
  assert.doesNotMatch(sheet,/id="returnToGame"[^>]*hidden/);
  assert.match(app,/const current=\{mode:null,label:TEXT\.history\.returnCurrent\};/);
  assert.equal(TEXT.history.returnCurrent,"現在の対局に戻る");
  assert.doesNotMatch(app,/label:[^\n]*手目/);
  // Finished games and friend rooms are not resumed from here: the button returns to the board instead.
  assert.match(app,/kind==="online" \|\| kind===\(room\?"online":gameMode\)\)return current;/);
  assert.match(app,/record\.snapshot\.status==="finished"\)return current;/);
  assert.match(app,/if\(target\.mode\)\{resumeModeGame\(target\.mode\);return;\}/);
});
test("every new game takes its options from nextGameOptions, so a new option is added in one place",()=>{
 const starts=app.match(/game=(newGame\(true,|freshLocalGame\(game,)[^;]*;/g);
 assert.equal(starts.length,3);
 for(const start of starts)assert.match(start,/nextGameOptions\((local|online|ai)Handicap\)/);
});
