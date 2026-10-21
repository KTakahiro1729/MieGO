import test from "node:test";
import assert from "node:assert/strict";
import {BLACK,WHITE} from "../public/core.mjs";
import {playerSides} from "../public/player-row.mjs";
import {readCom} from "../public/ai-characters.mjs";
import {TEXT} from "../public/texts.mjs";

test("a COM goes by its character name, with its strength under it",()=>{
  const sides=playerSides({mode:"ai",humanColor:BLACK,aiCom:readCom({character:"wide",strength:"strongest"})});
  assert.deepEqual(sides[BLACK],{name:TEXT.game.you,detail:"",com:false});
  assert.deepEqual(sides[WHITE],{name:TEXT.ai.characters.wide.name,detail:TEXT.ai.strengths.strongest,com:true});
});

test("watching names both COMs; one device and a friend game name people",()=>{
  const watch=playerSides({mode:"ai",watching:true,watchAi:{black:readCom({character:"plain"}),white:readCom({character:"brawler"})}});
  assert.equal(watch[BLACK].name,TEXT.ai.characters.plain.name);
  assert.equal(watch[WHITE].name,TEXT.ai.characters.brawler.name);
  const local=playerSides({mode:"local"});
  assert.deepEqual([local[BLACK].name,local[WHITE].name],[TEXT.game.black,TEXT.game.white]);
  const online=playerSides({mode:"online",onlineColor:WHITE});
  assert.deepEqual([online[BLACK].name,online[WHITE].name],[TEXT.game.opponent,TEXT.game.you]);
});
