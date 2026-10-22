import test from "node:test";
import assert from "node:assert/strict";
import {BLACK,WHITE} from "../public/core.mjs";
import {readCom} from "../public/ai-characters.mjs";
import {comNote,matchOf,sameSeats,seatsChanged,seatsOf,seatSummary} from "../public/seat-sheet.mjs";
import {TEXT} from "../public/texts.mjs";

const chick=readCom({character:"plain"},"beginner"),raider=readCom({character:"raider",strength:"easy"});

test("the seats are what each mode already holds",()=>{
  assert.deepEqual(seatsOf({mode:"local"}),{black:null,white:null});
  assert.deepEqual(seatsOf({mode:"ai",humanColor:WHITE,aiCom:raider}),{black:raider,white:null});
  assert.deepEqual(seatsOf({mode:"ai",watching:true,watchAi:{black:chick,white:raider}}),{black:chick,white:raider});
});

test("the mode is what the two seats add up to",()=>{
  assert.deepEqual(matchOf({black:null,white:null}),{mode:"local",watching:false});
  assert.deepEqual(matchOf({black:null,white:raider}),{mode:"ai",watching:false,humanColor:BLACK,aiCom:raider});
  assert.deepEqual(matchOf({black:raider,white:null}),{mode:"ai",watching:false,humanColor:WHITE,aiCom:raider});
  assert.deepEqual(matchOf({black:chick,white:raider}),{mode:"ai",watching:true,watchAi:{black:chick,white:raider}});
  for(const seats of [{black:null,white:raider},{black:chick,white:raider}])
    assert.ok(sameSeats(seatsOf(matchOf(seats)),seats));
});

test("the summary says what changes, who moves at once, and that the record goes on",()=>{
  const local={black:null,white:null};
  assert.equal(seatSummary(local,local,BLACK),TEXT.seats.unchanged);
  assert.equal(seatSummary(local,{black:chick,white:raider},WHITE),
    TEXT.seats.becomes(TEXT.seats.modes.local,TEXT.seats.modes.watch)+TEXT.seats.comMoves(TEXT.common.white)+TEXT.seats.record);
  // Changing only the COM that is not to move keeps the mode and starts nothing.
  assert.equal(seatSummary({black:null,white:chick},{black:null,white:raider},BLACK),
    TEXT.seats.stays(TEXT.seats.modes.ai(TEXT.common.black))+TEXT.seats.record);
});

test("a COM's note is its character's sentence, and 最強 says it drops the style",()=>{
  assert.equal(comNote(raider),TEXT.ai.characters.raider.note);
  assert.equal(comNote({...raider,strength:"strongest"}),TEXT.ai.characters.raider.note+TEXT.ai.strongestNoStyle);
  assert.equal(comNote(readCom({character:"plain"},"strongest")),TEXT.ai.characters.plain.note);
});

test("観戦's speed counts as a change only while both seats are COMs",()=>{
  const watch={black:chick,white:raider},vsCom={black:null,white:raider};
  assert.equal(seatsChanged(watch,watch,"normal","fast"),true);
  assert.equal(seatsChanged(vsCom,vsCom,"normal","fast"),false);
  assert.equal(seatSummary(watch,watch,BLACK,"normal","fast"),TEXT.seats.speed(TEXT.newGame.watchSpeeds.fast));
  assert.equal(seatSummary(vsCom,vsCom,BLACK,"normal","fast"),TEXT.seats.unchanged);
});
