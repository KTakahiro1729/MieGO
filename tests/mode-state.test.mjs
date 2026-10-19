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
