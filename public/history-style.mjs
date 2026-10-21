import {BLACK,WHITE} from "./core.mjs";
import {
  MAX_POOLED,
  canReadStyle,
  poolTallies,
  styleLink,
  styleTally
} from "./play-style.mjs";
import { TEXT } from "./texts.mjs";

// 棋風診断 over saved games: in the 履歴 list the player picks a side in each
// game they want read, and one type comes from all of them together.
// The person's own side is picked to begin with in the latest games where it is
// known (against the COM, or with a friend); on one device either side may be theirs.
const T = TEXT.playStyle;
const FIRST_PICKS = 10;

/**
 * ownSide(record) is the colour the person played in a saved game, or null when
 * either could be theirs; recall(record) gives a lookup of its kept ownership.
 * onChange() redraws the list.
 */
export function createHistoryStyle({$,gameLibrary,ownSide=()=>null,recall=()=>()=>null,onChange=()=>{},
                                    open=url=>window.open(url,"_blank","noopener")}) {
  let picks=null;
  // Reading a game replays it, so each side of each saved revision is read once.
  const tallies=new Map();
  const tallyOf = (record,color) => {
    const key=record.id+":"+record.revision+":"+color;
    if(!tallies.has(key))tallies.set(key,styleTally(record.snapshot,color,{recall:recall(record)}));
    return tallies.get(key);
  };
  const sides = record => {
    if(record.mode==="ai" && record.watch)return [];
    const own=ownSide(record);
    return (own ? [own] : [BLACK,WHITE]).filter(color=>canReadStyle(record.snapshot,color));
  };
  function listed() {
    try{return gameLibrary.list();}catch{return [];}
  }
  function pooled() {
    if(!picks?.size)return null;
    const records=new Map(listed().map(record=>[record.id,record]));
    return poolTallies([...picks].map(([id,color])=>records.has(id) ? tallyOf(records.get(id),color) : null));
  }
  function renderBar() {
    $("historyStyleBar").hidden=!picks;
    $("historyStyle").hidden=!!picks;
    if(!picks)return;
    const style=pooled();
    const readable=listed().some(record=>sides(record).length);
    $("historyStyleResult").textContent=style ?
      T.historyResult(style.type,T.types[style.type].name,style.games) : readable ? T.historyNone : T.historyEmpty;
    $("historyStyleOpen").disabled=!style;
    $("historyStyleOpen").onclick=()=>{if(style)open(styleLink(style));};
  }
  function start() {
    picks=new Map();
    for(const record of listed()) {
      if(picks.size>=FIRST_PICKS)break;
      const own=ownSide(record);
      if(own && sides(record).includes(own))picks.set(record.id,own);
    }
    onChange();
    renderBar();
  }
  function stop() {
    picks=null;
    onChange();
    renderBar();
  }
  function toggle(record,color) {
    if(picks.get(record.id)===color)picks.delete(record.id);
    else if(picks.has(record.id) || picks.size<MAX_POOLED)picks.set(record.id,color);
    onChange();
    renderBar();
  }
  /** While picking, a row's own button picks its first side and the sides sit beside it. */
  function decorateRow(row,record,item) {
    if(!picks)return;
    row.classList.add("is-picking");
    const choices=sides(record);
    item.onclick=()=>{if(choices.length)toggle(record,picks.get(record.id) ?? choices[0]);};
    item.setAttribute("aria-pressed",String(picks.has(record.id)));
    // A game that cannot be read (watched, too short, 五目並べ) is hidden while picking.
    if(!choices.length){row.classList.add("is-unreadable");return;}
    const group=document.createElement("span");
    group.className="history-style-sides";
    group.append(Object.assign(document.createElement("span"),{className:"history-style-sides-label",textContent:T.sidePrompt}));
    for(const color of choices) {
      const chip=document.createElement("button");
      chip.type="button";chip.className="history-style-side";
      const key=color===BLACK ? "B" : "W";
      chip.textContent=(key==="B" ? "● " : "○ ")+T.sideLabel(key);
      const on=picks.get(record.id)===color;
      chip.setAttribute("aria-pressed",String(on));
      chip.disabled=!on && !picks.has(record.id) && picks.size>=MAX_POOLED;
      chip.onclick=()=>toggle(record,color);
      group.append(chip);
    }
    row.append(group);
  }
  $("historyStyle").onclick=start;
  $("historyStyleCancel").onclick=stop;
  return {decorateRow,start,stop,picking:()=>!!picks};
}
