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

// The middle of each axis, so that players split about evenly between the two
// letters; the mean, not the median, so a share of a few opening moves never lands on it.
//   attack: share of moves with attack >= 0.6, used where no ownership was kept
//   stance: (attack >= 0.6 + invasion >= 0.5)/2 - reinforcement >= 0.3, per move
//   low: share of the opening moves (2nd line and up) on the 2nd or 3rd line
//   near: share of replies within two lines of the opponent's last move
// 9路: a neutral COM (normal strength, all axes ふつう) over 48 sides of self-play.
const NEUTRAL_SMALL = Object.freeze({attack:0.341, stance:-0.078, low:0.713, near:0.44});
// 13路 and 19路: people, over 7,401 sides of even 19路 games on the Fox server,
// 15級 to 3段 alike (the stance needs ownership, which those games lack, so it
// stays the COM's). People answer locally far more often than the COM does.
const NEUTRAL_LARGE = Object.freeze({attack:0.224, stance:-0.078, low:0.566, near:0.654});
const neutralFor = state => state.board.length<=81 ? NEUTRAL_SMALL : NEUTRAL_LARGE;
const OPENING = 16;
// Fewer own moves than this reads nothing.
export const MIN_MOVES = 10;
// The 17th type: a player near the middle of all four axes.
export const BALANCE = "BLNC";
export const PLAY_STYLE_RE = /^(?:[AG][HL][FR][TQ]|BLNC)$/;
const BEHIND = 10;
// The most games one 棋風診断 reads together.
export const MAX_POOLED = 20;

const lineOf = (point, size) => {
  const x=point%size, y=Math.floor(point/size);
  return Math.min(x,y,size-1-x,size-1-y)+1;
};

/** One side's tallies over one game, or null for too few moves. */
function tallyMoves(states, moves, color, recall, resigned=false) {
  let count=0, stance=0, attack=0, attacks=0, opening=0, height=0, lows=0, replies=0, tenuki=0, nears=0, behind=0;
  moves.forEach((move,i)=>{
    const state=states[i];
    if(move.color!==color || !Number.isInteger(move.position) || !state)return;
    const NEUTRAL=neutralFor(state);
    const ownership=recall(state) ?? null;
    const f=personalityFeatures(state,move.position,ownership);
    count++;
    // Attacking alone, read the same with or without ownership, places the player among people.
    attack+=(f.attack>=0.6)-NEUTRAL.attack; attacks+=f.attack>=0.6;
    // As the COM's 戦い方: attacking and invading half each, against reinforcing.
    // Where no ownership was kept, attacking alone tells.
    stance+=ownership ? ((f.attack>=0.6)+(f.invasion>=0.5))/2-(f.reinforcement>=0.3)-NEUTRAL.stance :
      ((f.attack>=0.6)-NEUTRAL.attack)/2;
    const line=lineOf(move.position,Math.round(Math.sqrt(state.board.length)));
    // Each move is read against its own board's middle, so games of two sizes pool.
    if(i<OPENING && line>1){opening++; lows+=line<=3; height+=NEUTRAL.low-(line<=3);}
    if(Number.isInteger(state.moves.at(-1)?.position)){replies++; nears+=f.tenuki<0; tenuki+=NEUTRAL.near-(f.tenuki<0);}
    const lead=leadFromOwnership(state,ownership);
    if(lead!==null && lead*color<=-BEHIND)behind++;
  });
  if(count<MIN_MOVES)return null;
  // Resigning is 潔い; playing on behind is 粘り強い; otherwise whoever passed first let go first.
  const resign=resigned || moves.some(m=>m.color===color && m.position==="resign");
  const firstPass=moves.find(m=>m.position===null)?.color;
  const grit=resign ? -1 : behind/count>=0.2 ? 1 : firstPass===color ? -0.5 : firstPass===-color ? 0.5 : 0;
  // The reason the /style page gives: resigned (-1), or how often played on behind.
  const reason=resign ? -1 : grit===1 ? Math.round(behind/count*100) : null;
  return {count,stance,attack,attacks,opening,height,lows,replies,tenuki,nears,grit,reason};
}

/**
 * Each axis below 0 for the second letter, at or above 0 for the first.
 * Several games pool their moves, so a longer game counts for more; 引き際,
 * read once a game, is their mean.
 */
function scoreTallies(tallies) {
  const sum=key=>tallies.reduce((total,tally)=>total+tally[key],0);
  const opening=sum("opening"), replies=sum("replies");
  return {stance:sum("stance")/sum("count"),attack:sum("attack")/sum("count"),height:opening ? sum("height")/opening : 0,
    tenuki:replies ? sum("tenuki")/replies : 0,grit:sum("grit")/tallies.length,
    // What the /style page shows as the reasons: shares of the player's own moves, in percent.
    shares:[sum("attacks")/sum("count"),opening ? sum("lows")/opening : null,replies ? sum("nears")/replies : null]
      .map(v=>v===null ? null : Math.round(v*100)).concat(tallies.length===1 ? tallies[0].reason : null)};
}

const letter = (value, high, low) => value>=0 ? high : low;
// Within half a standard deviation of people on the first three axes (Fox, as PEOPLE).
const MIDDLE = Object.freeze({attack:0.040, height:0.104, tenuki:0.038});
const balanced = score => Math.abs(score.attack)<MIDDLE.attack && Math.abs(score.height)<MIDDLE.height &&
  Math.abs(score.tenuki)<MIDDLE.tenuki && score.grit===0;
const typeOf = score => balanced(score) ? BALANCE : letter(score.stance,"A","G")+letter(score.height,"H","L")+
  letter(score.tenuki,"F","R")+letter(score.grit,"T","Q");

/** One side's tallies over one game, kept to read again with other games; null when too short. */
export function styleTally(snapshot, color, {through=snapshot.moves.length, recall=()=>null}={}) {
  if(isGomoku(snapshot) || isFree(snapshot))return null;
  const shown=snapshot.moves.slice(0,through);
  if(snapshot.moves[through]?.position==="resign")shown.push(snapshot.moves[through]);
  // A resignation read from an SGF is its result, not a move.
  const resigned=through>=snapshot.moves.length && snapshot.result===(color===BLACK ? "W+R" : "B+R");
  return tallyMoves(replayLine({...snapshot,moves:shown}),shown,color,recall,resigned);
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

// Where people stand on the first three axes: every 2.5% of the scores of 7,401
// sides of even 19路 games on the Fox server, 攻め read by attacking alone.
const PEOPLE = Object.freeze({
  attack:[-0.224,-0.153,-0.127,-0.112,-0.098,-0.088,-0.078,-0.071,-0.064,-0.057,-0.052,-0.045,-0.04,-0.035,-0.03,-0.024,-0.02,-0.015,-0.01,-0.005,-0.001,0.004,0.009,0.014,0.019,0.024,0.028,0.034,0.04,0.045,0.05,0.057,0.063,0.07,0.077,0.085,0.096,0.109,0.126,0.155,0.519],
  height:[-0.434,-0.309,-0.309,-0.309,-0.309,-0.184,-0.184,-0.184,-0.184,-0.184,-0.184,-0.184,-0.059,-0.059,-0.059,-0.059,-0.059,-0.059,-0.059,-0.059,-0.059,-0.005,0.066,0.066,0.066,0.066,0.066,0.066,0.066,0.066,0.191,0.191,0.191,0.191,0.191,0.191,0.316,0.316,0.316,0.441,0.566],
  tenuki:[-0.346,-0.137,-0.114,-0.101,-0.091,-0.082,-0.073,-0.066,-0.06,-0.054,-0.048,-0.043,-0.038,-0.034,-0.03,-0.025,-0.02,-0.016,-0.013,-0.008,-0.004,0.001,0.005,0.01,0.015,0.019,0.025,0.029,0.034,0.039,0.045,0.051,0.058,0.065,0.072,0.08,0.091,0.104,0.124,0.154,0.654],
});

/** The share of people below `value`; a value many share sits in the middle of them. */
function shareBelow(points, value) {
  const last=points.length-1;
  const below=points.findLastIndex(point=>point<value), above=points.findIndex(point=>point>value);
  const lo=below, hi=above<0 ? last+1 : above;
  if(hi-lo>1)return (lo+hi)/2/last;
  if(lo<0)return 0;
  if(hi>last)return 1;
  return (lo+(value-points[lo])/(points[hi]-points[lo]))/last;
}

// 引き際 among people: 35.7% of sides resigned. How often people play on
// behind, or pass first, is not measured yet, so those have no rank.
const RESIGNED = 0.357;
const gritShare = grit => grit<=-1 ? RESIGNED : null;

/**
 * Where the player stands among people on each axis, towards their own letter:
 * the percentage of people who lean that way as far or further (1 to 50), or
 * null where people were not measured.
 */
export function styleRanks(score) {
  const towards = (points, value, high) => {
    const below=shareBelow(points,value);
    return high ? 1-below : below;
  };
  const ranks=[towards(PEOPLE.attack,score.attack ?? score.stance,score.stance>=0),
    towards(PEOPLE.height,score.height,score.height>=0),towards(PEOPLE.tenuki,score.tenuki,score.tenuki>=0),
    gritShare(score.grit)];
  return ranks.map(rank=>rank===null ? null : Math.max(1,Math.min(50,Math.round(rank*100))));
}

/** The reasons behind each axis, as the /style link carries them (see scoreTallies). */
export const evidence = score => (score.shares ?? [null,null,null,null]).map(v=>v ?? "");

// Each type's share of people, in percent: Fox 19路, the first three axes as
// PEOPLE and 引き際 as RESIGNED, read as independent.
const TYPE_SHARES = Object.freeze({AHFQ:3.9,AHFT:6.4,AHRQ:4.4,AHRT:7.3,ALFQ:4.9,ALFT:8.3,ALRQ:4.3,ALRT:7.3,BLNC:5.3,
  GHFQ:3.6,GHFT:5.9,GHRQ:4.9,GHRT:8.1,GLFQ:4.6,GLFT:7.8,GLRQ:4.8,GLRT:8});
export const typeShare = type => TYPE_SHARES[type] ?? null;
/** How often two people of these types meet, in percent, to one decimal (at least 0.1). */
export function pairShare(a, b) {
  if(!(a in TYPE_SHARES) || !(b in TYPE_SHARES))return null;
  return Math.max(0.1,Math.round(TYPE_SHARES[a]*TYPE_SHARES[b]*(a===b ? 1 : 2)/10)/10);
}

// How far each axis leans, -100 (the second letter) to 100 (the first), for
// the /style page's bars. The first three rarely pass ±0.5, so they are doubled.
const lean = value => Math.round(Math.max(-1,Math.min(1,value))*100);
export const leanings = ({stance,height,tenuki,grit}) =>
  [lean(stance*2),lean(height*2),lean(tenuki*2),lean(grit)];

const ints = (values, ok) => {
  const found=(values ?? "").split(",").map(v=>v==="" ? null : Number(v));
  return found.every(v=>v===null || (Number.isInteger(v) && ok(v))) ? found : null;
};

/**
 * The /style page for one player's style: its type, colour, leanings, where it
 * stands among people and the shares behind it; with `partner` (another
 * style), the page reads the two together.
 */
export function styleLink({type,color,score,games}, partner=null) {
  // Every part is letters, digits, "-" or ",", so nothing needs escaping.
  return "/style?t="+type+(color==="B" || color==="W" ? "&c="+color : "")+
    (score ? "&s="+leanings(score).join(",")+"&p="+styleRanks(score).map(v=>v ?? "").join(",")+
      "&e="+evidence(score).join(",") : "")+(games>1 ? "&n="+games : "")+
    (partner ? "&u="+partner.type+(partner.score ? "&ul="+leanings(partner.score).join(",") :
      partner.leans ? "&ul="+partner.leans.join(",") : "") : "");
}

/**
 * What a /style URL asks for: a known type, or null, with its colour,
 * leanings, ranks, reasons and games if valid, and the partner's type and
 * leanings when the link reads two players together.
 */
export function readStyleLink(search) {
  const query=new URLSearchParams(search);
  const type=query.get("t");
  if(!PLAY_STYLE_RE.test(type ?? ""))return null;
  const color=["B","W"].includes(query.get("c")) ? query.get("c") : null;
  const four = (key, ok) => {
    const values=ints(query.get(key),ok);
    return values?.length===4 && values.every(v=>v!==null) ? values : null;
  };
  const leans=four("s",v=>Math.abs(v)<=100);
  // A rank may be missing (null) where people were not measured, but not all of them.
  const ranked=ints(query.get("p"),v=>v>=1 && v<=50);
  const ranks=ranked?.length===4 && ranked.some(v=>v!==null) ? ranked : null;
  const shown=ints(query.get("e"),v=>Math.abs(v)<=999);
  const games=Number(query.get("n"));
  const partner=PLAY_STYLE_RE.test(query.get("u") ?? "") ? {type:query.get("u"),leans:four("ul",v=>Math.abs(v)<=100)} : null;
  return {type,color,leans,ranks,evidence:shown?.length===4 ? shown : null,
    games:Number.isInteger(games) && games>1 && games<=MAX_POOLED ? games : 1,partner};
}

const HIGHS = "AHFT";
/**
 * 相性診断 of two styles, each {type, leans?}: a percentage, a headline key and,
 * per axis, whether the two lean the same way ("same"), apart ("differ"), or
 * one is the balanced type ("balance"). Every pair is told what it shares or
 * makes up for, so no pair comes out below 70%.
 */
export function compatibility(a, b) {
  const lean = (style, i) => style.leans?.[i] ?? (style.type===BALANCE ? 0 : style.type[i]===HIGHS[i] ? 50 : -50);
  const axes=[0,1,2,3].map(i=>{
    if(a.type===BALANCE || b.type===BALANCE)return {relation:"balance",points:7};
    const la=lean(a,i), lb=lean(b,i);
    return a.type[i]===b.type[i] ? {relation:"same",points:6+3*Math.min(Math.abs(la),Math.abs(lb))/100} :
      {relation:"differ",points:5+4*Math.abs(la-lb)/200};
  });
  const points=axes.reduce((total,axis)=>total+axis.points,0);
  const percent=Math.max(70,Math.min(99,Math.round(70+(points-20)/16*29)));
  const differ=axes.flatMap((axis,i)=>axis.relation==="differ" ? [i] : []);
  const headline=axes[0].relation==="balance" ? "balance" : differ.length===0 ? "mirror" :
    differ.length===4 ? "opposite" : differ.length===1 ? "differ"+differ[0] : "many";
  return {percent,headline,relations:axes.map(axis=>axis.relation)};
}
