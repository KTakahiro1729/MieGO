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

// The middle of each axis: the mean of a neutral COM (normal strength, all
// axes ふつう) over 48 sides of 9路 self-play, measured with the readings below.
// Centring on it splits a neutral player about evenly between the two letters;
// the mean, not the median, so a share of a few opening moves never lands on it.
//   attack: share of moves with attack >= 0.6, used where no ownership was kept
//   stance: (attack >= 0.6 + invasion >= 0.5)/2 - reinforcement >= 0.3, per move
//   low: share of the opening moves (2nd line and up) on the 2nd or 3rd line
//   near: share of replies within two lines of the opponent's last move
const NEUTRAL = Object.freeze({attack:0.341, stance:-0.078, low:0.713, near:0.44});
const OPENING = 16;
// Fewer own moves than this reads nothing.
export const MIN_MOVES = 10;
export const PLAY_STYLE_RE = /^[AG][HL][FR][TQ]$/;
const BEHIND = 10;
// The most games one 棋風診断 reads together.
export const MAX_POOLED = 20;

const lineOf = (point, size) => {
  const x=point%size, y=Math.floor(point/size);
  return Math.min(x,y,size-1-x,size-1-y)+1;
};

/** One side's tallies over one game, or null for too few moves. */
function tallyMoves(states, moves, color, recall) {
  let count=0, stance=0, opening=0, low=0, replies=0, near=0, behind=0;
  moves.forEach((move,i)=>{
    const state=states[i];
    if(move.color!==color || !Number.isInteger(move.position) || !state)return;
    const ownership=recall(state) ?? null;
    const f=personalityFeatures(state,move.position,ownership);
    count++;
    // As the COM's 戦い方: attacking and invading half each, against reinforcing.
    // Where no ownership was kept, attacking alone tells.
    stance+=ownership ? ((f.attack>=0.6)+(f.invasion>=0.5))/2-(f.reinforcement>=0.3)-NEUTRAL.stance :
      ((f.attack>=0.6)-NEUTRAL.attack)/2;
    const line=lineOf(move.position,Math.round(Math.sqrt(state.board.length)));
    if(i<OPENING && line>1){opening++; low+=line<=3;}
    if(Number.isInteger(state.moves.at(-1)?.position)){replies++; near+=f.tenuki<0;}
    const lead=leadFromOwnership(state,ownership);
    if(lead!==null && lead*color<=-BEHIND)behind++;
  });
  if(count<MIN_MOVES)return null;
  // Resigning is 潔い; playing on behind is 粘り強い; otherwise whoever passed first let go first.
  const firstPass=moves.find(m=>m.position===null)?.color;
  const grit=moves.some(m=>m.color===color && m.position==="resign") ? -1 :
    behind/count>=0.2 ? 1 : firstPass===color ? -0.5 : firstPass===-color ? 0.5 : 0;
  return {count,stance,opening,low,replies,near,grit};
}

/**
 * Each axis below 0 for the second letter, at or above 0 for the first.
 * Several games pool their moves, so a longer game counts for more; 引き際,
 * read once a game, is their mean.
 */
function scoreTallies(tallies) {
  const sum=key=>tallies.reduce((total,tally)=>total+tally[key],0);
  const opening=sum("opening"), replies=sum("replies");
  return {stance:sum("stance")/sum("count"),height:opening ? NEUTRAL.low-sum("low")/opening : 0,
    tenuki:replies ? NEUTRAL.near-sum("near")/replies : 0,grit:sum("grit")/tallies.length};
}

const letter = (value, high, low) => value>=0 ? high : low;
const typeOf = score => letter(score.stance,"A","G")+letter(score.height,"H","L")+
  letter(score.tenuki,"F","R")+letter(score.grit,"T","Q");

/** One side's tallies over one game, kept to read again with other games; null when too short. */
export function styleTally(snapshot, color, {through=snapshot.moves.length, recall=()=>null}={}) {
  if(isGomoku(snapshot) || isFree(snapshot))return null;
  const shown=snapshot.moves.slice(0,through);
  if(snapshot.moves[through]?.position==="resign")shown.push(snapshot.moves[through]);
  return tallyMoves(replayLine({...snapshot,moves:shown}),shown,color,recall);
}

/**
 * The play style of `color` over the first `through` moves of `snapshot`
 * (a resignation right after them counts), or null for 五目並べ, a free board
 * or too few moves. `recall(state)` gives a position's kept ownership, if any.
 */
export function playStyle(snapshot, color, options) {
  const tally=styleTally(snapshot,color,options);
  if(!tally)return null;
  const score=scoreTallies([tally]);
  return {color:color===BLACK ? "B" : "W",type:typeOf(score),score};
}

/** Whether `color`'s moves in `snapshot` are enough for a 棋風診断. */
export const canReadStyle = (snapshot, color) => {
  if(isGomoku(snapshot) || isFree(snapshot))return false;
  return snapshot.moves.filter(m=>m.color===color && Number.isInteger(m.position)).length>=MIN_MOVES;
};

/**
 * One play style over several games, each {snapshot, color, recall}: the
 * same person's sides, read together. Games too short to read are left out;
 * null when none is left.
 */
export const pooledPlayStyle = games =>
  poolTallies(games.map(({snapshot,color,recall})=>styleTally(snapshot,color,{recall})));

/** The same from each game's styleTally. */
export function poolTallies(found) {
  const tallies=found.filter(Boolean);
  if(!tallies.length)return null;
  const score=scoreTallies(tallies);
  return {type:typeOf(score),score,games:tallies.length};
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
export function styleLink({type,color,score,games}) {
  // Every part is letters, digits, "-" or ",", so nothing needs escaping.
  return "/style?t="+type+(color==="B" || color==="W" ? "&c="+color : "")+
    (score ? "&s="+leanings(score).join(",") : "")+(games>1 ? "&n="+games : "");
}

/** What a /style URL asks for: a known type, or null, with its colour, leanings and games if valid. */
export function readStyleLink(search) {
  const query=new URLSearchParams(search);
  const type=query.get("t");
  if(!PLAY_STYLE_RE.test(type ?? ""))return null;
  const color=["B","W"].includes(query.get("c")) ? query.get("c") : null;
  const values=(query.get("s") ?? "").split(",").map(Number);
  const leans=values.length===4 && values.every(v=>Number.isInteger(v) && Math.abs(v)<=100) ? values : null;
  const games=Number(query.get("n"));
  return {type,color,leans,games:Number.isInteger(games) && games>1 && games<=MAX_POOLED ? games : 1};
}
