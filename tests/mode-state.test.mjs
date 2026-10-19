import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {gameStorageKey,parseGameSnapshot,needsSwitchConfirmation} from "../public/mode-state.mjs";
const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
const app=readFileSync(new URL("../public/app.mjs",import.meta.url),"utf8");
test("three modes use the header native select",()=>{
  for(const value of ["local","online","ai"])assert.match(html,new RegExp('option value="'+value+'"'));
  assert.match(html,/id="modePicker"/);
});
test("settings is presentation-only, with credits and no board rotation",()=>{
  const [common] = html.split('<aside id="modePanel"');
  assert.match(common,/id="settingsPanel"/);
  assert.match(common,/name="palette"/);
  assert.match(common,/id="opacity"/);
  assert.match(common,/id="resetAppearance"/);
  assert.match(common,/クレジット/);
  assert.doesNotMatch(common,/盤面を回転|id="aiLevel"|id="aiInvasion"|id="copy"/);
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
  assert.match(app,/if\(!room \|\| c!==channel\)return;/);
  assert.match(app,/function leaveOnlineRoom\(\)/);
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
test("the game menu shares the action row with pass and keeps reset local-only",()=>{
  const row=html.slice(html.indexOf('<div class="action-row">'),html.indexOf('</div>',html.indexOf('<div class="action-row">')));
  assert.ok(row.indexOf('id="pass"') < row.indexOf('id="gameMenu"'));
  assert.match(row,/id="resetLocalGame"/);
  assert.match(row,/id="resign"/);
  assert.match(html,/id="cancel"[^>]*aria-label="仮置きを戻す"/);
  assert.match(app,/if \(room \|\| gameMode!=="local"\) return;/);
  assert.match(app,/resetLocalGame"\)\.hidden=!!room \|\| gameMode!=="local"/);
  assert.match(app,/game=freshLocalGame\(game\);\s*save\(\);show\(\);requestAnalysis\(\);/);
});
test("settings button shows a toothed gear and is labeled",()=>{
  const gear=html.slice(html.indexOf('id="settingsToggle"'),html.indexOf('</button>',html.indexOf('id="settingsToggle"')));
  assert.match(gear,/aria-label="設定を開く"/);
  assert.match(gear,/circle/);
  assert.match(gear,/m9\.7 2\.5/);
  assert.match(gear,/<circle cx="11\.5" cy="12\.5"/);
});

test("reset discards endgame and dead-stone hints",()=>{
  const block=app.slice(app.indexOf("function resetLocalBoard()"),app.indexOf('$("resetLocalGame").onclick'));
  assert.match(block,/endgameAdvisor\.reset\(\)/);
  assert.match(block,/deadReview="idle"/);
  assert.match(block,/deadEvaluation=null/);
  assert.match(block,/analysisContext=null/);
});
