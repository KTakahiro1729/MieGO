import {BLACK,isFree,isGomoku} from "./core.mjs";
import {personalityFeatures} from "./ai-personality.mjs";
import {replayLine} from "./ownership-prefetch.mjs";
import {leadFromOwnership} from "./score-graph.mjs";

// 棋風診断: a playful four-letter type for one player of a game, read from
// that player's own moves with the measures the COM's style axes use
// (personalityFeatures). One game is a small sample, so it is a game's
// flavour, not a verdict on the player.
//   A 攻め / G 守り   attack and invasion against reinforcement (the COM's 戦い方)
//   H 模様 / L 実利   the 4th line and above against the 2nd and 3rd (序盤)
//   F 自由 / R 律儀   playing away from the opponent's last move or next to it
//   T 粘り強い / Q 潔い  playing on 10 points behind, or resigning and passing first

// What a neutral COM plays, counted as measure.mjs counts it
// (docs/AI_PERSONALITIES.md): 42% of its moves attack (attack ≥ 0.6), 11%
// invade (invasion ≥ 0.5) and 27% reinforce (reinforcement ≥ 0.3); 60% of
// the game's opening moves are on the 2nd or 3rd line, 4th and above the rest;
// 44% of its replies are within two lines of the opponent's last move.
const NEUTRAL = Object.freeze({attack:0.42, invasion:0.11, reinforcement:0.27, low:0.6, near:0.44});
const OPENING = 16;
// Fewer own moves than this reads nothing.
export const MIN_MOVES = 10;
export const PLAY_STYLE_RE = /^[AG][HL][FR][TQ]$/;
const BEHIND = 10;

const lineOf = (point, size) => {
  const x=point%size, y=Math.floor(point/size);
  return Math.min(x,y,size-1-x,size-1-y)+1;
};

/** Each axis below 0 for the second letter, at or above 0 for the first. */
function scoreMoves(states, moves, color, recall) {
  let count=0, stance=0, opening=0, low=0, replies=0, near=0, behind=0;
  moves.forEach((move,i)=>{
    const state=states[i];
    if(move.color!==color || !Number.isInteger(move.position) || !state)return;
    const ownership=recall(state) ?? null;
    const f=personalityFeatures(state,move.position,ownership);
    count++;
    // As the COM's 戦い方: attacking and invading half each, against reinforcing.
    // Where no ownership was kept, attacking alone tells.
    stance+=((f.attack>=0.6)-NEUTRAL.attack)/2;
    if(ownership)stance+=((f.invasion>=0.5)-NEUTRAL.invasion)/2-((f.reinforcement>=0.3)-NEUTRAL.reinforcement);
    const line=lineOf(move.position,Math.round(Math.sqrt(state.board.length)));
    if(i<OPENING && line>1){opening++; low+=line<=3;}
    if(Number.isInteger(state.moves.at(-1)?.position)){replies++; near+=f.tenuki<0;}
    const lead=leadFromOwnership(state,ownership);
    if(lead!==null && lead*color<=-BEHIND)behind++;
  });
  if(count<MIN_MOVES)return null;
  // Resigning is 潔い; playing on behind is 粘り強い; otherwise whoever passed first let go first.
  const firstPass=moves.find(m=>m.position==="pass")?.color;
  const grit=moves.some(m=>m.color===color && m.position==="resign") ? -1 :
    behind/count>=0.2 ? 1 : firstPass===color ? -0.5 : firstPass===-color ? 0.5 : 0;
  return {stance:stance/count,height:opening ? NEUTRAL.low-low/opening : 0,
    tenuki:replies ? NEUTRAL.near-near/replies : 0,grit};
}

const letter = (value, high, low) => value>=0 ? high : low;

/**
 * The play style of `color` over the first `through` moves of `snapshot`
 * (a resignation right after them counts), or null for 五目並べ, a free board
 * or too few moves. `recall(state)` gives a position's kept ownership, if any.
 */
export function playStyle(snapshot, color, {through=snapshot.moves.length, recall=()=>null}={}) {
  if(isGomoku(snapshot) || isFree(snapshot))return null;
  const shown=snapshot.moves.slice(0,through);
  if(snapshot.moves[through]?.position==="resign")shown.push(snapshot.moves[through]);
  const states=replayLine({...snapshot,moves:shown});
  const score=scoreMoves(states,shown,color,recall);
  if(!score)return null;
  const type=letter(score.stance,"A","G")+letter(score.height,"H","L")+
    letter(score.tenuki,"F","R")+letter(score.grit,"T","Q");
  return {color:color===BLACK ? "B" : "W",type,score};
}

/** What /api/stat counts for one shown 棋風診断: no player, game or device is named. */
export function statPayload(snapshot, styles) {
  return {size:Math.round(Math.sqrt(snapshot.board.length)),rules:snapshot.rules==="japanese" ? "japanese" : "chinese",
    styles:styles.map(({color,type})=>({color,type}))};
}

// Each game and position is counted once per page load, however often its share sheet opens.
const reported=new Set();
/** Counts the shown types; never throws, and sends nothing without a beacon. */
export function reportPlayStyles(key, snapshot, styles, send=globalThis.navigator?.sendBeacon?.bind(globalThis.navigator)) {
  if(!styles.length || !send || reported.has(key))return false;
  reported.add(key);
  try{
    return send("/api/stat",new Blob([JSON.stringify(statPayload(snapshot,styles))],{type:"text/plain"}));
  }catch{return false;}
}

// How far each axis leans, -100 (the second letter) to 100 (the first), for
// the /style page's bars. The first three rarely pass ±0.5, so they are doubled.
const lean = value => Math.round(Math.max(-1,Math.min(1,value))*100);
export const leanings = ({stance,height,tenuki,grit}) =>
  [lean(stance*2),lean(height*2),lean(tenuki*2),lean(grit)];

/** The /style page for one player's style: its type, colour and leanings. */
export function styleLink({type,color,score}) {
  // Every part is letters, digits, "-" or ",", so nothing needs escaping.
  return "/style?t="+type+(color==="B" || color==="W" ? "&c="+color : "")+
    (score ? "&s="+leanings(score).join(",") : "");
}

/** What a /style URL asks for: a known type, or null, with its colour and leanings if valid. */
export function readStyleLink(search) {
  const query=new URLSearchParams(search);
  const type=query.get("t");
  if(!PLAY_STYLE_RE.test(type ?? ""))return null;
  const color=["B","W"].includes(query.get("c")) ? query.get("c") : null;
  const values=(query.get("s") ?? "").split(",").map(Number);
  const leans=values.length===4 && values.every(v=>Number.isInteger(v) && Math.abs(v)<=100) ? values : null;
  return {type,color,leans};
}
