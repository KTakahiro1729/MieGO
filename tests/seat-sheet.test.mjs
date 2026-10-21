import test from "node:test";
import assert from "node:assert/strict";
import {BLACK,WHITE} from "../public/core.mjs";
import {readCom} from "../public/ai-characters.mjs";
import {comNote,matchOf,sameSeats,seatsOf,seatSummary} from "../public/seat-sheet.mjs";
import {TEXT} from "../public/texts.mjs";

const chick=readCom({character:"chick"}),raider=readCom({character:"raider"});

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

test("a COM's note is its strength and character, or カスタム's values",()=>{
  assert.equal(comNote(raider),TEXT.ai.strengths.easy+"・"+TEXT.ai.characters.raider.note);
  assert.match(comNote(readCom({character:"custom",strength:"normal",stance:100})),/ふつう/);
});
