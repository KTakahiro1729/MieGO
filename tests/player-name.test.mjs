import test from "node:test";
import assert from "node:assert/strict";
import {html} from "./helpers/source.mjs";
import {testLibrary} from "./helpers/storage.mjs";
import {BLACK,WHITE,newGame,play} from "../public/core.mjs";
import {readCom} from "../public/ai-characters.mjs";
import {cleanName,NAME_LIMIT} from "../public/player-name.mjs";
import {playerSides,recordNames} from "../public/player-row.mjs";
import {recordName} from "../public/history-navigation.mjs";
import {exportSGF,parseSGF} from "../public/sgf.mjs";
import {TEXT} from "../public/texts.mjs";

test("a 表示名 is one trimmed line of at most twelve characters, and empty means none",()=>{
  assert.equal(cleanName("  たろう\n 二段\u0000 "),"たろう 二段");
  assert.equal([...cleanName("😀".repeat(20))].length,NAME_LIMIT);
  assert.equal(cleanName("   "),"");
  assert.equal(cleanName(undefined),"");
  assert.equal(cleanName({toString:()=>"x"}),"");
});

test("the 設定 sheet has the 表示名 field, with あなた shown while it is empty",()=>{
  assert.match(html,/<label class="setting-label" for="playerName">表示名<\/label>\s*<input id="playerName" type="text"[^>]*placeholder="あなた"/);
});

test("the turn row names the player by 表示名 and a friend by theirs, or あなた and 相手 without",()=>{
  const ai=playerSides({mode:"ai",humanColor:WHITE,aiCom:readCom({character:"chick"}),myName:"たろう"});
  assert.equal(ai[WHITE].name,"たろう");
  assert.equal(ai[BLACK].name,TEXT.ai.characters.chick.name);
  const online=playerSides({mode:"online",onlineColor:BLACK,myName:"たろう",peerName:"はなこ"});
  assert.deepEqual([online[BLACK].name,online[WHITE].name],["たろう","はなこ"]);
  const unnamed=playerSides({mode:"online",onlineColor:BLACK});
  assert.deepEqual([unnamed[BLACK].name,unnamed[WHITE].name],[TEXT.game.you,TEXT.game.opponent]);
  // One device has no "you": the colours stay 黒 and 白.
  const local=playerSides({mode:"local",myName:"たろう"});
  assert.deepEqual([local[BLACK].name,local[WHITE].name],[TEXT.game.black,TEXT.game.white]);
});

test("a saved game keeps the names it was played under, never あなた or 相手",()=>{
  assert.deepEqual(recordNames({mode:"online",onlineColor:WHITE,myName:"たろう",peerName:"はなこ"}),{black:"はなこ",white:"たろう"});
  assert.deepEqual(recordNames({mode:"online",onlineColor:WHITE}),{black:null,white:null});
  assert.deepEqual(recordNames({mode:"ai",humanColor:BLACK,aiCom:readCom({character:"master"})}),
    {black:null,white:TEXT.ai.characters.master.name});
  assert.deepEqual(recordNames({mode:"local",myName:"たろう"}),{black:null,white:null});
  const {lib}=testLibrary();
  const first=lib.save({mode:"local",snapshot:newGame(),names:{black:"たろう",white:"はなこ"}});
  // A friend whose device has not said its name yet keeps the name from before.
  const again=lib.save({id:first.id,mode:"local",snapshot:play(newGame(),40),names:{black:"たろう2",white:null}});
  assert.deepEqual(again.names,{black:"たろう2",white:"はなこ"});
  assert.equal(lib.save({mode:"local",snapshot:newGame()}).names,null);
});

test("history titles and SGF name the players",()=>{
  const record={mode:"online",source:"played",snapshot:newGame(),names:{black:"たろう",white:"はなこ"}};
  assert.equal(recordName(record),TEXT.common.modeOnline+" · 黒 たろう・白 はなこ");
  assert.equal(recordName({...record,names:{black:null,white:"ひよこ"}}),TEXT.common.modeOnline+" · 白 ひよこ");
  assert.equal(recordName({...record,names:null}),TEXT.common.modeOnline);
  const sgf=exportSGF({snapshot:play(newGame(),40),sgfMeta:{blackName:"たろう",whiteName:"は]なこ"}});
  assert.match(sgf,/PB\[たろう\]PW\[は\\\]なこ\]/);
  assert.deepEqual([parseSGF(sgf).metadata.blackName,parseSGF(sgf).metadata.whiteName],["たろう","は]なこ"]);
});
