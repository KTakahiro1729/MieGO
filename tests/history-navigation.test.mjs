import test from "node:test";
import assert from "node:assert/strict";
import {newGame,play} from "../public/core.mjs";
import {
  recordName,recordStatus,recordIcon,recordSummary,readOnlyHint,navigationState,dateLabel
} from "../public/history-navigation.mjs";
import {createHistoryPanel} from "../public/history-panel.mjs";

const saved=(overrides={})=>({
  mode:"local",source:"played",snapshot:play(newGame(),40),
  updatedAt:"2026-10-19T07:30:00Z",sgfMeta:null,...overrides
});

test("history navigator clamps steps and only permits resuming a current live record",()=>{
  const record=saved();
  assert.deepEqual(navigationState(record,1),{
    count:1,step:1,firstDisabled:false,lastDisabled:true,resumable:true
  });
  assert.deepEqual(navigationState(record,0),{
    count:1,step:0,firstDisabled:true,lastDisabled:false,resumable:false
  });
  assert.equal(navigationState(record,-20).step,0);
  assert.equal(navigationState(record,99).step,1);
  assert.equal(navigationState(record,0.9).step,0);
  assert.equal(navigationState(record,NaN).step,1);
  assert.equal(navigationState(record,Infinity).step,1);
});

test("online, imported, and finished archives cannot be resumed",()=>{
  for(const record of [
    saved({mode:"online"}),
    saved({source:"sgf"}),
    saved({snapshot:{...saved().snapshot,status:"finished"}})
  ]) {
    const nav=navigationState(record,record.snapshot.moves.length);
    assert.equal(nav.lastDisabled,true);
    assert.equal(nav.resumable,false);
  }
});

test("labels and hints retain the display distinctions for saved records",()=>{
  const local=saved(),ai=saved({mode:"ai"}),online=saved({mode:"online"});
  const imported=saved({source:"sgf",sgfMeta:{komi:"6.5"}});
  assert.equal(recordName(local),"1台で打つ");
  assert.equal(recordName(ai),"AIと対戦");
  assert.equal(recordName(online),"友人と対戦");
  assert.equal(recordName(imported),"SGFから読み込んだ棋譜");
  assert.deepEqual([recordIcon(local),recordIcon(ai),recordIcon(online),recordIcon(imported)],
    ["●","AI","↗","SGF"]);
  assert.equal(recordStatus(imported),"読み込み済み");
  assert.equal(recordStatus(saved({snapshot:{...local.snapshot,status:"scoring"}})),"採点中");
  assert.equal(recordStatus(saved({snapshot:{...local.snapshot,status:"finished"}})),"終局済み");
  assert.match(recordSummary(imported,true),/コミ 6\.5$/);
  assert.doesNotMatch(recordSummary(imported),/コミ/);
  assert.match(readOnlyHint(imported),/分岐のある棋譜/);
  assert.match(readOnlyHint(online),/友人対局は閲覧専用/);
  assert.match(readOnlyHint(saved({snapshot:{...local.snapshot,status:"finished"}})),/終局した棋譜/);
  assert.match(readOnlyHint(local),/元の対局を再開/);
  assert.equal(dateLabel("invalid-date"),"日時不明");
});

test("a saved variation is labelled separately and cannot resume as the real match",()=>{
 const sample={source:"variation",mode:"local",snapshot:{moves:[{color:1,position:40}],moveNumber:1,status:"playing"},updatedAt:"2026-10-19T00:00:00Z"};
 assert.equal(recordName(sample),"保存した試し打ち");
 assert.equal(recordIcon(sample),"↪");
 assert.equal(recordStatus(sample),"試し打ち");
 assert.equal(navigationState(sample,1).resumable,false);
});

test("history panel is only a list and importer; main board owns replay state",()=>{
  const history=createHistoryPanel({
    $:()=>{throw Error("DOM not needed during construction");},
    gameLibrary:{},storageError:()=>{},onSelect:()=>{}
  });
  assert.equal(typeof history.renderHistoryList,"function");
  assert.equal(typeof history.showHistory,"function");
  assert.equal(typeof history.importHistoryFile,"function");
  assert.equal("selection" in history,false);
  assert.equal("step" in history,false);
});
