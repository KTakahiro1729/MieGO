import test from "node:test";
import assert from "node:assert/strict";
import {gameStorageKey,parseGameSnapshot,needsSwitchConfirmation} from "../public/mode-state.mjs";
import {TEXT} from "../public/texts.mjs";
import {app,between,css,html,source} from "./helpers/source.mjs";

const sheet=between(html,'<aside id="modePanel"','</aside>');
const panel=key=>{
  const start=sheet.indexOf('id="setupPanel'+key+'"'),next=sheet.indexOf('<div id="setupPanel',start);
  return sheet.slice(start,next>0?next:sheet.indexOf('</section>',start));
};

test("a 新規対戦 button opens one sheet with the modes as icon tabs, then 戻る and 対戦履歴を見る",()=>{
  assert.match(html,/<button id="newGameButton"[^>]*>新規対戦<\/button>/);
  assert.match(app,/\$\("newGameButton"\)\.onclick=\(\)=>openPanel\(room\?"online":gameMode\)/);
  assert.doesNotMatch(html,/<select id="modePicker"|<option value="history">/);
  // The modes form one row of icon tabs in one sheet, [対COM|観戦|対友人] [1台で打つ];
  // under them, [現在の対局に戻る] [対戦履歴を見る].
  assert.equal((sheet.match(/name="newGameMode"[^>]*><span><svg class="mode-icon"/g)||[]).length,5);
  const modes=between(sheet,'<div class="new-game-modes">','<div class="new-game-nav">');
  assert.deepEqual(modes.split('<div class="fused">').slice(1).map(group=>[...group.matchAll(/name="newGameMode" value="(\w+)"/g)].map(m=>m[1])),
    [["ai","watch","online"],["local"]]);
  const nav=between(sheet,'<div class="new-game-nav">','<div id="newGameSetup">');
  assert.ok(nav.indexOf('id="returnToGame"')>=0 && nav.indexOf('id="returnToGame"')<nav.indexOf('id="openHistoryFromNew"'));
  assert.match(sheet,/id="openHistoryFromNew" type="radio" name="newGameMode" value="history"/);
  // 対COM first, 履歴 last; 対COM is the first-visit default.
  assert.deepEqual([...sheet.matchAll(/name="newGameMode" value="(\w+)"/g)].map(m=>m[1]),["ai","watch","online","local","history"]);
  assert.match(sheet,/name="newGameMode" value="ai" checked>/);
  assert.match(app,/let gameMode = room \? "online" : "ai";/);
  // 履歴 lives in this sheet; there is no separate history sheet.
  for(const id of ["historySetup","historyList","historyImportFile"])assert.match(sheet,new RegExp('id="'+id+'"'));
  assert.doesNotMatch(html,/id="historyPanel"|id="closeHistory"/);
  assert.match(app,/function openHistoryPanel\(\)\{openPanel\("history"\);\}/);
});

test("自分の石・COMのキャラ・盤・ルール・時間 are one row of tabs over one panel of choices",()=>{
  assert.deepEqual([...sheet.matchAll(/id="setupTab(\w+)"[^>]*role="tab"/g)].map(m=>m[1]),["Side","Strength","Board","Rules","Time"]);
  for(const key of ["Board","Rules","Side","Strength","Time"])assert.match(sheet,new RegExp('id="setupPanel'+key+'" class="setup-panel" role="tabpanel"'));
  for(const size of [9,13,19])assert.match(sheet,new RegExp('name="boardSize" value="'+size+'"'));
  assert.equal((sheet.match(/name="boardSize"[^>]*><span class="choice"><svg class="size-icon"/g)||[]).length,3);
  // No 詳細設定 disclosure: handicap sits under ルール's choices; the sampling-variance setting is gone.
  assert.doesNotMatch(sheet,/id="newGameAdvanced"/);
  for(const id of ["handicap","gomokuForbidden","hideStones"])assert.match(panel("Rules"),new RegExp('id="'+id+'"'));
  const handicap=between(sheet,'<select id="handicap"','</select>');
  for(const stones of [0,2,3,4,5,6,7,8,9])assert.match(handicap,new RegExp('<option value="'+stones+'"'));
  assert.doesNotMatch(html+app,/aiHints|policyHints|aiLevel/);
});

test("the COM is eight characters with notes, then カスタム's strength and four style rows",()=>{
  const advanced=panel("Strength");
  // 観戦's two COM cards take the character list's place, so they come first.
  assert.ok(advanced.indexOf('id="watchAiOptions"')<advanced.indexOf('name="aiCharacter"'));
  assert.ok(advanced.indexOf('id="aiCharacterChoices"')<advanced.indexOf('id="aiCustom"') && advanced.indexOf('id="aiCustom"')<advanced.indexOf('id="aiStrengthNote"'));
  // カスタム's rows follow the list directly, with no card around them.
  assert.match(advanced,/<fieldset id="aiCustom" class="ai-advanced com-rows" hidden>\s*<legend class="visually-hidden">/);
  assert.deepEqual([...sheet.matchAll(/name="aiCharacter" value="(\w+)"/g)].map(m=>m[1]),
    ["chick","steady","raider","brawler","wide","serious","master","custom"]);
  assert.equal((between(sheet,'id="aiCharacterChoices"','</fieldset>').match(/<small class="choice-note">/g)||[]).length,8);
  assert.deepEqual([...sheet.matchAll(/name="aiStrength" value="(\w+)"/g)].map(m=>m[1]),["beginner","easy","normal","strong","strongest"]);
  for(const name of ["aiStance","aiHeight","aiTenuki"])
    assert.deepEqual([...sheet.matchAll(new RegExp('name="'+name+'" value="(\\d+)"',"g"))].map(m=>m[1]),["0","50","100"]);
});

test("the mode tabs and the way back, then the options, then the start button",()=>{
  for(const id of ["startLocal","startAi","copy"]) {
    assert.ok(sheet.indexOf('id="returnToGame"')<sheet.indexOf('id="newGameSetup"'),id);
    assert.ok(sheet.indexOf('id="aiStrengthRow"')<sheet.indexOf('id="'+id+'"'),id);
  }
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
});

test("late P2P events cannot modify a local game after leaving a room",()=>{
  const transport=source("p2p-transport.mjs");
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
 assert.doesNotMatch(html,/id="openHistorySettings"|id="openCurrentMode"/);
 assert.match(app,/\$\("startLocal"\)\.onclick=\(\)=>continueFrom\?forkBoardReview\("local"\):startLocalGame\(\);/);
 assert.match(app,/function freshLocalBoard\(fresh=freshLocalGame\(game,nextGameOptions\(localHandicap\)\)\)/);
 assert.match(app,/game=fresh;currentGameId=null;currentRevision=null;lastPosition=null;\s*resetPositionState\(\);\s*save\(\);show\(\);requestAnalysis\(\);/);
});
test("settings button shows a toothed gear and is labeled",()=>{
  const gear=html.slice(html.indexOf('id="settingsToggle"'),html.indexOf('</button>',html.indexOf('id="settingsToggle"')));
  assert.match(gear,/aria-label="設定を開く"/);
  assert.match(gear,/circle/);
  assert.match(gear,/m9\.7 2\.5/);
  assert.match(gear,/<circle cx="11\.5" cy="12\.5"/);
});

test("replacing the game discards every signal of the previous position",()=>{
  const reset=app.slice(app.indexOf("function resetPositionState()"),app.indexOf("function afterTakeback()"));
  for(const signal of [/pending=\+\+seq;analysisContext=null/,/cancelAnimationFrame\(transitionFrame\)/,
    /displayedOwnership=null/,/clearProvisional\(\)/,/endgameAdvisor\.reset\(\)/,
    /endNotice=null;takebackNotice=null/,/deadEvaluation=null/])
    assert.match(reset,signal);
  // A resumed scoring game keeps the dead stones already marked.
  assert.match(reset,/game\.dead\.length \|\| game\.agreed\.black \|\| game\.agreed\.white\)\?"modified":"idle"/);
  // Every place that puts another game on the board goes through it.
  for(const name of ["afterTakeback","freshLocalBoard","resumeModeGame","beginOnlineRoom",
    "forkBoardReview","startAiGame"]){
    const start=app.indexOf("function "+name+"(");
    assert.match(app.slice(start,app.indexOf("\n}",start)),/resetPositionState\(\)/,name);
  }
  assert.match(app,/lastPosition=record\.lastPosition;resetPositionState\(\);/);
});
test("the 新規対戦 sheet offers a way back to the current or an unfinished saved game",()=>{
  assert.match(sheet,/id="returnToGame"[^>]*>現在の対局に戻る<\/button>/);
  // The way back stays in every mode, so the sheet keeps its layout when the mode changes.
  assert.doesNotMatch(sheet,/id="returnToGame"[^>]*hidden/);
  assert.match(app,/const current=\{mode:null,label:TEXT\.history\.returnCurrent\};/);
  assert.equal(TEXT.history.returnCurrent,"現在の対局に戻る");
  // Finished games and friend rooms are not resumed from here: the button returns to the board instead.
  assert.match(app,/kind==="online" \|\| kind===\(room\?"online":gameMode\)\)return current;/);
  assert.match(app,/record\.snapshot\.status==="finished"\)return current;/);
  assert.match(app,/if\(target\.mode\)\{resumeModeGame\(target\.mode\);return;\}/);
});
test("every new game takes its options from nextGameOptions, so a new option is added in one place",()=>{
 const starts=app.match(/(game=newGame\(true,|startAiGame\(newGame\(true,|fresh=freshLocalGame\(game,)[^;]*;/g);
 assert.equal(starts.length,3);
 for(const start of starts)assert.match(start,/nextGameOptions\((local|online|ai)Handicap\)/);
 // もう一局 replays the finished game's own options instead of the sheet's.
 assert.match(app,/startAiGame\(initialGame\(game\),watching,/);
 assert.match(app,/freshLocalBoard\(initialGame\(game\)\);/);
});
test("every mode's start button reads 新しい対局を始める and stays at the bottom of the sheet",()=>{
 assert.equal(TEXT.newGame.start,"新しい対局を始める");
 assert.match(app,/function startLabel\(\)\{return continueFrom\?TEXT\.review\.continue:TEXT\.newGame\.start;\}/);
 assert.match(app,/\$\("copy"\)\.textContent=!room\?TEXT\.newGame\.start:/);
 assert.match(css,/\.mode-panel #localSetup,\.mode-panel #aiSetup,\.mode-panel #onlineStart\{[^}]*position:sticky/);
 // 対友人's button is its own section, so it can stick like the others.
 assert.match(html,/<section id="onlineStart" class="settings-section" hidden>\s*<button id="copy"/);
});
test("the 時間 tab holds the clock and 観戦's speed, each greyed out where the mode does not use it",()=>{
  const time=panel("Time");
  assert.ok(time.indexOf('id="timeControlSetup"')>=0 && time.indexOf('id="timeControlSetup"')<time.indexOf('id="watchSpeedRow"'));
  assert.doesNotMatch(panel("Rules"),/id="mainTime"|id="byoyomi"/);
  assert.doesNotMatch(panel("Side"),/name="watchSpeed"/);
  assert.match(app,/const untimedRules=kind=>gameRules==="free" \|\| kind==="online" \|\| kind==="ai" && watchChoice;/);
  // 観戦 runs without a clock; its tab value is the speed.
  assert.match(app,/startAiGame\(newGame\(true,\{\.\.\.nextGameOptions\(aiHandicap\),\.\.\.\(watchChoice\?\{timeControl:null\}:\{\}\)\}\),watchChoice,aiSideChoice\);/);
  assert.equal(TEXT.newGame.timeValue("","") ,"なし");
  assert.equal(TEXT.newGame.timeValue("10分","30秒"),"10分+30秒");
  assert.equal(TEXT.newGame.timeValue("","30秒"),"秒読み30秒");
});
