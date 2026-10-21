// この対局の打ち手: who plays each colour of the game on the board, a person
// or a COM. 1台で打つ, 対COM and 観戦 are what the two seats add up to, so the
// sheet changes the mode by changing a seat, and the game record carries on.
import { BLACK, WHITE } from "./core.mjs";
import {
  characterNote,
  COM_AXES,
  comSummary,
  CUSTOM_CHARACTER,
  pickCharacter,
  setComValue,
} from "./ai-characters.mjs";
import { TEXT } from "./texts.mjs";

const SIDES = Object.freeze({black:BLACK, white:WHITE});
const colorName = color => color===BLACK ? TEXT.common.black : TEXT.common.white;

/** Each colour's COM, or null where a person plays it. */
export function seatsOf({mode, watching=false, humanColor=BLACK, aiCom, watchAi}) {
  if(mode==="ai" && watching)return {black:watchAi.black, white:watchAi.white};
  if(mode==="ai")return humanColor===BLACK ? {black:null, white:aiCom} : {black:aiCom, white:null};
  return {black:null, white:null};
}

/** The mode the two seats make: 1台 with no COM, 対COM with one, 観戦 with two. */
export function matchOf(seats) {
  if(seats.black && seats.white)return {mode:"ai", watching:true, watchAi:{black:seats.black, white:seats.white}};
  if(seats.black || seats.white)
    return {mode:"ai", watching:false, humanColor:seats.black ? WHITE : BLACK, aiCom:seats.black || seats.white};
  return {mode:"local", watching:false};
}

const sameCom = (a, b) => !a===!b && (!a || a.character===b.character && a.strength===b.strength &&
  COM_AXES.every(axis=>a[axis]===b[axis]));
export const sameSeats = (a, b) => sameCom(a.black, b.black) && sameCom(a.white, b.white);

function modeLabel(seats) {
  const match=matchOf(seats);
  return match.watching ? TEXT.seats.modes.watch :
    match.mode==="ai" ? TEXT.seats.modes.ai(colorName(match.humanColor)) : TEXT.seats.modes.local;
}

// 観戦's speed shows, and counts, only when both seats are COMs.
const watched = seats => !!(seats.black && seats.white);
/** Whether pressing この打ち手で続ける changes anything: a seat, or a watched game's speed. */
export const seatsChanged = (before, after, speed, newSpeed) =>
  !sameSeats(before, after) || watched(after) && speed!==newSpeed;

/** What pressing この打ち手で続ける does, in one or two sentences. next is the colour to move;
 * speed and newSpeed are 観戦's pause between moves before and after. */
export function seatSummary(before, after, next, speed="normal", newSpeed=speed) {
  const faster=watched(after) && speed!==newSpeed ? TEXT.seats.speed(TEXT.newGame.watchSpeeds[newSpeed]) : "";
  if(sameSeats(before, after))return faster || TEXT.seats.unchanged;
  const from=modeLabel(before), to=modeLabel(after);
  const side=next===BLACK ? "black" : "white";
  const moves=after[side] && !sameCom(before[side], after[side]) ? TEXT.seats.comMoves(colorName(next)) : "";
  return (from===to ? TEXT.seats.stays(to) : TEXT.seats.becomes(from, to)) + faster + moves + TEXT.seats.record;
}

/** A character's one sentence, under the strength row that already names the strength; 最強 says it drops the style. */
export const comNote = com => characterNote(com.character) +
  (comSummary(com).endsWith(TEXT.ai.strongestNoStyle) ? TEXT.ai.strongestNoStyle : "");

/**
 * The sheet's controls. The app opens and closes the panel; this keeps the
 * seats being edited until onApply(match, speed) takes them or the sheet is opened again.
 */
export function createSeatSheet({$, onApply, onKeep}) {
  let current={black:null, white:null}, draft=current, next=BLACK, comAvailable=true;
  let speed="normal", draftSpeed=speed;
  // The COM a seat goes back to when switched from 人 to COM.
  let lastCom={black:null, white:null};
  const key = side => side[0].toUpperCase() + side.slice(1);
  function render() {
    for(const side of Object.keys(SIDES)){
      const com=draft[side], name="seat"+key(side);
      for(const input of document.querySelectorAll('input[name="'+name+'"]')){
        input.checked=input.value===(com ? "com" : "person");
        // Without KataGo a seat that has no COM cannot get one; a COM already playing stays.
        input.disabled=input.value==="com" && !comAvailable && !current[side];
      }
      $(name+"Com").hidden=!com;
      if(!com)continue;
      $(name+"Character").value=com.character;
      // As in 新規対戦's COM card: the strength row, the character, and カスタム's style rows in place of the note.
      const custom=com.character===CUSTOM_CHARACTER;
      $(name+"Note").hidden=custom;
      $(name+"Note").textContent=custom ? "" : comNote(com);
      $(name+"Custom").hidden=!custom;
      for(const [field, axis] of comFields(name))
        for(const input of document.querySelectorAll('input[name="'+field+'"]'))input.checked=input.value===String(com[axis]);
    }
    $("seatSpeedRow").hidden=!watched(draft);
    for(const input of document.querySelectorAll('input[name="seatSpeed"]'))input.checked=input.value===draftSpeed;
    $("seatSummary").textContent=!comAvailable && !current.black && !current.white ?
      TEXT.seats.comUnavailable : seatSummary(current, draft, next, speed, draftSpeed);
    $("seatApply").disabled=!seatsChanged(current, draft, speed, draftSpeed);
  }
  // Each row's radio name and the COM's value it shows: the strength, then カスタム's style.
  const comFields = name => [[name+"Strength", "strength"],
    ...COM_AXES.map(axis=>[name+axis[0].toUpperCase()+axis.slice(1), axis])];
  for(const side of Object.keys(SIDES)){
    const name="seat"+key(side);
    for(const input of document.querySelectorAll('input[name="'+name+'"]'))
      input.onchange=e=>{
        if(!e.target.checked)return;
        draft={...draft, [side]:e.target.value==="com" ? lastCom[side] : null};
        render();
      };
    // The strength and the character are chosen apart; either keeps the other.
    const change=com=>{
      lastCom={...lastCom, [side]:com};
      draft={...draft, [side]:com};
      render();
    };
    $(name+"Character").onchange=e=>change(pickCharacter(draft[side], e.target.value));
    for(const [field, axis] of comFields(name))
      for(const input of document.querySelectorAll('input[name="'+field+'"]'))
        input.onchange=e=>{if(e.target.checked)change(setComValue(draft[side], axis, e.target.value));};
  }
  for(const input of document.querySelectorAll('input[name="seatSpeed"]'))
    input.onchange=e=>{if(e.target.checked){draftSpeed=e.target.value;render();}};
  $("seatApply").onclick=()=>{
    if(seatsChanged(current, draft, speed, draftSpeed))onApply(matchOf(draft), draftSpeed);
  };
  $("seatKeep").onclick=onKeep;
  return {
    /** fallback(side) is the COM a person's seat gets when switched to COM; watchSpeed is 観戦's speed. */
    load(seats, {next:toMove, available, fallback, watchSpeed="normal"}) {
      current=seats;draft=seats;next=toMove;comAvailable=available;speed=watchSpeed;draftSpeed=watchSpeed;
      lastCom={black:seats.black ?? fallback("black"), white:seats.white ?? fallback("white")};
      render();
    },
  };
}
