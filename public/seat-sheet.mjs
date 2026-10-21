// この対局の打ち手: who plays each colour of the game on the board, a person
// or a COM. 1台で打つ, 対COM and 観戦 are what the two seats add up to, so the
// sheet changes the mode by changing a seat, and the game record carries on.
import { BLACK, WHITE } from "./core.mjs";
import { characterNote, COM_AXES, comSummary, CUSTOM_CHARACTER, pickCharacter, setComValue } from "./ai-characters.mjs";
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

/** What pressing この打ち手で続ける does, in one or two sentences. next is the colour to move. */
export function seatSummary(before, after, next) {
  if(sameSeats(before, after))return TEXT.seats.unchanged;
  const from=modeLabel(before), to=modeLabel(after);
  const side=next===BLACK ? "black" : "white";
  const moves=after[side] && !sameCom(before[side], after[side]) ? TEXT.seats.comMoves(colorName(next)) : "";
  return (from===to ? TEXT.seats.stays(to) : TEXT.seats.becomes(from, to)) + moves + TEXT.seats.record;
}

/** A COM's strength and its one-sentence character; カスタム names its values instead. */
export const comNote = com => com.character===CUSTOM_CHARACTER ? comSummary(com) :
  TEXT.ai.strengths[com.strength] + "・" + characterNote(com.character);

/**
 * The sheet's controls. The app opens and closes the panel; this keeps the
 * seats being edited until onApply(match) takes them or the sheet is opened again.
 */
export function createSeatSheet({$, onApply, onKeep}) {
  let current={black:null, white:null}, draft=current, next=BLACK, comAvailable=true;
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
      $(name+"Strength").value=com.strength;
      $(name+"Character").value=com.character;
      $(name+"Note").textContent=comNote(com);
    }
    $("seatSummary").textContent=!comAvailable && !current.black && !current.white ?
      TEXT.seats.comUnavailable : seatSummary(current, draft, next);
    $("seatApply").disabled=sameSeats(current, draft);
  }
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
    $(name+"Strength").onchange=e=>change(setComValue(draft[side], "strength", e.target.value));
    $(name+"Character").onchange=e=>change(pickCharacter(draft[side], e.target.value));
  }
  $("seatApply").onclick=()=>{if(!sameSeats(current, draft))onApply(matchOf(draft));};
  $("seatKeep").onclick=onKeep;
  return {
    /** fallback(side) is the COM a person's seat gets when switched to COM. */
    load(seats, {next:toMove, available, fallback}) {
      current=seats;draft=seats;next=toMove;comAvailable=available;
      lastCom={black:seats.black ?? fallback("black"), white:seats.white ?? fallback("white")};
      render();
    },
  };
}
