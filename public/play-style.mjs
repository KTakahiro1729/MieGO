import {BLACK,group,isFree,isGomoku,neighbors} from "./core.mjs";
import {personalityFeatures} from "./ai-personality.mjs";
import {replayLine} from "./ownership-prefetch.mjs";
import {leadFromOwnership} from "./score-graph.mjs";

// 棋風診断: a playful four-letter type for one player of a game, read from
// that player's own moves with the measures the COM's style axes use
// (personalityFeatures). One game is a small sample, so it is a game's
// flavour, not a verdict on the player.
//   A 攻め / G 守り   attack and invasion against reinforcement (the COM's 戦い方)
//   H 模様 / L 実利   the 4th line and above against the 2nd and 3rd (序盤)
//   F 自由 / R 律儀   early quiet moves away from the opponent's stones or close to them
//   T 粘り強い / Q 潔い  playing on 10 points behind, or resigning (the sooner the more) and passing first

// The middle of each axis, so that players split about evenly between the two
// letters; the mean, not the median, so a share of a few opening moves never lands on it.
//   attack: share of moves with attack >= 0.6, used where no ownership was kept
//   stance: (attack >= 0.6 + invasion >= 0.5)/2 - reinforcement >= 0.3, per move
//   low: share of the opening moves (2nd line and up) on the 2nd or 3rd line
//   apart: per quiet move (see APART), how far from the opponent's stones
// 9路: a neutral COM (normal strength, all axes ふつう) over 48 sides of self-play.
const NEUTRAL_SMALL = Object.freeze({apart:1.413, attack:0.341, stance:-0.078, low:0.713});
// 13路 and 19路: people, over 7,401 sides of even 19路 games on the Fox server,
// 15級 to 3段 alike (the stance needs ownership, which those games lack, so it
// stays the COM's); apart is the median over 32,854 sides of the same ranks.
const NEUTRAL_LARGE = Object.freeze({apart:1.462, attack:0.224, stance:-0.078, low:0.566});
const neutralFor = state => state.board.length<=81 ? NEUTRAL_SMALL : NEUTRAL_LARGE;
const OPENING = 16;
// Fewer own moves than this reads nothing.
export const MIN_MOVES = 10;
// The 17th type: a player near the middle of all four axes.
export const BALANCE = "BLNC";
export const PLAY_STYLE_RE = /^(?:[AG][HL][FR][TQ]|BLNC)$/;
const BEHIND = 10;
// 自由/律儀 reads the own moves that attack nothing while at least APART.empty of
// the board is empty: how far each is from the nearest opponent stone, in lines,
// counting APART.far and more as APART.far. Answering the opponent's last move
// nearby, as this axis read before, was mostly strength: on Fox the share of
// 自由 rose from 22% at 15級 to 88% at 9段 (rank correlation 0.46, 21% of the
// variance between ranks). Distance from the opponent's stones correlates 0.01
// with rank (1.8% between ranks), and within a rank a player's 5 games agree
// with 5 others more (0.76 against 0.58). Leaving out attacking moves keeps it
// apart from 攻め/守り (-0.04 within a rank; -0.37 with them). Halved, it
// spreads among people about as replies did.
const APART = Object.freeze({empty:0.6, far:4, scale:0.5});
// The /style page's reason for 自由/律儀: FAR_REASON + ten times the mean distance.
// Below it, a link made before reads the share of replies within two lines, in percent.
export const FAR_REASON = 2000;
// The most games one 棋風診断 reads together.
export const MAX_POOLED = 20;

const lineOf = (point, size) => {
  const x=point%size, y=Math.floor(point/size);
  return Math.min(x,y,size-1-x,size-1-y)+1;
};

// How 潔い a resignation is, from -1 (most) to -0.5, half from each of two
// timings, both scaled to 19路 by board area. How far behind: up to 10 points
// is the earliest, DEFICIT_LATE and more the latest. How long after the game
// was lost: own moves played since falling DECIDED points or more behind for
// good; none is the earliest, LATE_MOVES and more the latest. Each runs from
// about the 10th to the 75th percentile of resigning players on Fox (see
// below). A timing with no ownership kept to read it reads halfway.
const DECIDED = 20, DEFICIT_LATE = 90, LATE_MOVES = 45;
const ramp = (value, from, to) => value===null ? 0.5 : Math.max(0,Math.min(1,(value-from)/(to-from)));
const resignGrit = (deficit, late) => -1+(ramp(deficit,10,DEFICIT_LATE)+ramp(late,0,LATE_MOVES))/4;

// A resignation's reason for the /style page, as one negative number: -1 when
// nothing is known, else -2 less the points behind (to 999) less 1000 times
// one more than the own moves played since falling far behind (0: unknown).
const resignReason = (deficit, late) => deficit===null ? -1 :
  -2-Math.min(999,Math.max(0,Math.round(deficit)))-1000*(late===null ? 0 : late+1);
/** The points behind and own moves played far behind of a resignation's reason; null where unknown. */
export function readResignReason(n) {
  if(n>=-1)return {deficit:null,late:null};
  const v=-n-2;
  return {deficit:v%1000,late:v<1000 ? null : Math.floor(v/1000)-1};
}

/**
 * At the resignation (the last of `states`): how many points `color` was
 * behind, and how many of its own moves it had played since falling DECIDED
 * (scaled to the board) or more behind for good; null where no ownership tells.
 */
function resignTiming(states, moves, color, recall) {
  const decided=DECIDED*states[0].board.length/361;
  const deficitAt=state=>{
    const lead=state ? leadFromOwnership(state,recall(state) ?? null) : null;
    return lead===null ? null : -lead*color;
  };
  const deficit=deficitAt(states.at(-1));
  if(deficit===null || deficit<decided)return {deficit,late:deficit===null ? null : 0};
  // Back from the resignation over own moves, to the last one known to be closer.
  let late=0, unknown=false;
  for(let i=moves.length-1;i>=0;i--){
    if(moves[i].color!==color || !Number.isInteger(moves[i].position))continue;
    const behind=deficitAt(states[i]);
    if(behind!==null && behind<decided)return {deficit,late};
    unknown||=behind===null;
    late++;
  }
  // Far behind from the first move, or never known to be closer.
  return {deficit,late:unknown ? null : late};
}

const groupOwnership = (stones, ownership, color) =>
  stones.reduce((total,stone)=>total+Number(ownership[stone])*color,0)/stones.length;

/**
 * Where `color` let its own weak groups go: for each, its stones' mean
 * ownership, -1 to 0, at the last own move next to it. A group is weak while
 * that mean is below 0. Groups that lived count as well as those that died,
 * which keeps the reading nearly apart from strength (see LET_GO).
 */
function letGoPoints(states, moves, color, recall) {
  const size=Math.round(Math.sqrt(states[0].board.length));
  const touches=[];
  moves.forEach((move,i)=>{
    const state=states[i], ownership=state ? recall(state) ?? null : null;
    if(move.color!==color || !Number.isInteger(move.position) || !state || ownership?.length!==state.board.length)return;
    const seen=new Set();
    for(const point of neighbors(move.position,size)){
      if(state.board[point]!==color || seen.has(point))continue;
      const stones=[...group(state.board,point).stones];
      stones.forEach(stone=>seen.add(stone));
      const mean=groupOwnership(stones,ownership,color);
      if(mean<0)touches.push({i,mean,stones});
    }
  });
  // Touches sharing a stone follow one group; its last touch is where the player let go.
  const lastOf=new Map(), owner=new Map();
  touches.forEach((touch,k)=>{
    const joined=new Set(touch.stones.filter(stone=>owner.has(stone)).map(stone=>owner.get(stone)));
    for(const old of joined)lastOf.delete(old);
    touch.stones.forEach(stone=>owner.set(stone,k));
    for(const [stone,o] of owner)if(joined.has(o))owner.set(stone,k);
    lastOf.set(k,touch);
  });
  return [...lastOf.values()].map(touch=>touch.mean);
}

/** Lines from `point` to the nearest stone of the opponent of `color`, up to APART.far. */
function nearestOpponent(board, point, color) {
  const size=Math.round(Math.sqrt(board.length)), x=point%size, y=Math.floor(point/size);
  let far=APART.far;
  board.forEach((stone,at)=>{
    if(stone===-color)far=Math.min(far,Math.max(Math.abs(at%size-x),Math.abs(Math.floor(at/size)-y)));
  });
  return far;
}

/**
 * Whether a move had no real choice to it: saving an own group from atari,
 * or taking back the stone the opponent just played into atari.
 */
function obvious(state, point, color) {
  const size=Math.round(Math.sqrt(state.board.length)), last=state.moves.at(-1)?.position;
  return neighbors(point,size).some(n=>{
    if(state.board[n]===0)return false;
    const {stones,liberties}=group(state.board,n);
    return liberties.size===1 && (state.board[n]===color || stones.has(last));
  });
}

/** One side's tallies over one game, or null for too few moves. */
function tallyMoves(states, moves, color, recall, resigned=false) {
  let count=0, stance=0, attack=0, attacks=0, opening=0, height=0, lows=0, quiet=0, tenuki=0, apart=0, behind=0;
  // Each own move's share of the first three axes, for styleMoves: null where it is not counted.
  const leans=[];
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
    const lean={i,line:lineOf(move.position,Math.round(Math.sqrt(state.board.length))),far:null,
      attack:f.attack>=0.6,invasion:!!ownership && f.invasion>=0.5,reinforcement:!!ownership && f.reinforcement>=0.3,
      stance:ownership ? ((f.attack>=0.6)+(f.invasion>=0.5))/2-(f.reinforcement>=0.3)-NEUTRAL.stance :
        ((f.attack>=0.6)-NEUTRAL.attack)/2,height:null,tenuki:null,obvious:obvious(state,move.position,color),
      alone:!state.board.includes(-color)};
    stance+=lean.stance;
    const line=lean.line;
    // Each move is read against its own board's middle, so games of two sizes pool.
    if(i<OPENING && line>1){opening++; lows+=line<=3; height+=lean.height=NEUTRAL.low-(line<=3);}
    if(f.attack<0.3 && state.board.filter(v=>v===0).length>=APART.empty*state.board.length){
      const far=lean.far=nearestOpponent(state.board,move.position,color);
      quiet++; apart+=far; tenuki+=lean.tenuki=(far-NEUTRAL.apart)*APART.scale;
    }
    leans.push(lean);
    const lead=leadFromOwnership(state,ownership);
    if(lead!==null && lead*color<=-BEHIND)behind++;
  });
  if(count<MIN_MOVES)return null;
  // Resigning is 潔い, the more so the sooner (resignGrit); playing on behind
  // is 粘り強い; otherwise whoever passed first let go first.
  const resignAt=moves.findIndex(m=>m.color===color && m.position==="resign");
  const shown=resignAt>=0 ? moves.slice(0,resignAt) : resigned ? moves : null;
  const firstPass=moves.find(m=>m.position===null)?.color;
  let grit=behind/count>=0.2 ? 1 : firstPass===color ? -0.5 : firstPass===-color ? 0.5 : 0, reason=grit===1 ? Math.round(behind/count*100) : null;
  if(shown){
    const {deficit,late}=resignTiming(states.slice(0,shown.length+1),shown,color,recall);
    const scale=361/states[0].board.length;
    grit=resignGrit(deficit===null ? null : deficit*scale,late===null ? null : late*scale);
    reason=resignReason(deficit,late);
  }
  const letGo=letGoPoints(states,moves,color,recall);
  return {count,stance,attack,attacks,opening,height,lows,quiet,tenuki,apart,grit,reason,letGo,leans};
}

/**
 * Each axis below 0 for the second letter, at or above 0 for the first.
 * Several games pool their moves, so a longer game counts for more; 引き際,
 * read once a game, is their mean.
 */
function scoreTallies(tallies) {
  const sum=key=>tallies.reduce((total,tally)=>total+tally[key],0);
  const opening=sum("opening"), quiet=sum("quiet");
  return {stance:sum("stance")/sum("count"),attack:sum("attack")/sum("count"),height:opening ? sum("height")/opening : 0,
    tenuki:quiet ? sum("tenuki")/quiet : 0,grit:withLetGo(sum("grit")/tallies.length,tallies.flatMap(tally=>tally.letGo)),
    // What the /style page shows as the reasons: shares of the player's own moves, in percent,
    // and how far from the opponent's stones (FAR_REASON).
    shares:[sum("attacks")/sum("count"),opening ? sum("lows")/opening : null]
      .map(v=>v===null ? null : Math.round(v*100)).concat(quiet ? FAR_REASON+Math.round(sum("apart")/quiet*10) : null,tallies.length===1 ? tallies[0].reason ?? letGoReason(tallies[0].letGo) : null)};
}

// Letting weak stones go early is 潔い, reaching for them till they are gone
// 粘り強い: with MIN_LET_GO groups or more, where the median of letGoPoints
// stands among people (LET_GO) moves 引き際 by up to half, as far as
// resigning, playing on or passing first left it open.
const MIN_LET_GO = 2;
const median = values => {
  const sorted=[...values].sort((a,b)=>a-b), mid=sorted.length>>1;
  return sorted.length%2 ? sorted[mid] : (sorted[mid-1]+sorted[mid])/2;
};
const withLetGo = (grit, points) => points.length<MIN_LET_GO ? grit :
  grit+(0.5-shareBelow(LET_GO,median(points)))*(1-Math.abs(grit));
// The /style page's reason for letting go when the stones were n% likely lost: LET_GO_REASON + n.
export const LET_GO_REASON = 1000;
const letGoReason = points => points.length<MIN_LET_GO ? null : LET_GO_REASON+Math.round((1-median(points))/2*100);

const letter = (value, high, low) => value>=0 ? high : low;
// Within half a standard deviation of people on the first three axes (Fox, as PEOPLE).
// 引き際 is in the middle with no resignation, playing on or passing first, and letting go as most do.
const MIDDLE = Object.freeze({attack:0.040, height:0.104, tenuki:0.039, grit:0.25});
const balanced = score => Math.abs(score.attack)<MIDDLE.attack && Math.abs(score.height)<MIDDLE.height &&
  Math.abs(score.tenuki)<MIDDLE.tenuki && Math.abs(score.grit)<=MIDDLE.grit;
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

/** Whether this page shows 棋風診断: production builds leave it out (scripts/build-html.mjs). */
export const playStyleShown = () => !globalThis.document?.documentElement?.hasAttribute("data-no-play-style");

/** Whether `color`'s moves in `snapshot` are enough for a 棋風診断. */
export const canReadStyle = (snapshot, color) => {
  if(!playStyleShown() || isGomoku(snapshot) || isFree(snapshot))return false;
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

// あなたらしかった手: the own moves where the type showed most. 引き際 is read
// from how a game ended, not from single moves, so only the first three axes
// count. On each, a move's lean towards the type's letter is taken over the
// game's furthest such lean (so 0 to 1), weighted by how few people lean that
// far (styleRanks: 1% weighs 1, 50% 0.2). On 攻め/守り only a move that
// attacked, invaded or reinforced counts. Moves with no real choice (obvious)
// are left out, and the second pick lies STYLE_MOVE_GAP moves or more from the
// first, the first pick's strongest axis counting half, so the two show
// different moments and, where they can, different sides of the type. The
// balanced type shows one move leaning each way on the first axis where it has both.
export const STYLE_MOVES = 2;
const STYLE_MOVE_GAP = 10;
const LEAN_KEYS = ["stance","height","tenuki"];

/**
 * Up to STYLE_MOVES of `color`'s moves that are most like `style` (from
 * playStyle, read with the same options), the most like it first: each
 * {step, reasons}, step being the move's number (the replay step showing it)
 * and reasons [{axis, high, ...what the move did}] strongest first.
 */
export function styleMoves(snapshot, color, style, options) {
  const tally=style ? styleTally(snapshot,color,options) : null;
  if(!tally)return [];
  const leans=tally.leans.filter(lean=>!lean.obvious);
  // 攻め/守り counts a move that attacked, invaded or reinforced, and 自由/律儀 one
  // with an opponent stone to be far from: the rest only tell by being many.
  const acted=(lean, axis, high) => axis===1 || (axis===2 ? !lean.alone : high ? lean.attack || lean.invasion : lean.reinforcement);
  const toward=(lean, axis, high) => lean[LEAN_KEYS[axis]]===null || !acted(lean,axis,high) ? 0 :
    Math.max(0,(high ? 1 : -1)*lean[LEAN_KEYS[axis]]);
  const reason=(lean, axis, high) => ({axis,high,attack:lean.attack,invasion:lean.invasion,
    reinforcement:lean.reinforcement,line:lean.line,far:lean.far});
  const pick=(lean, reasons) => ({step:lean.i+1,reasons});
  const apart=(lean, first) => Math.abs(lean.i-first.i)>=STYLE_MOVE_GAP;
  const best=(scored) => scored.filter(([,score])=>score>0).sort((a,b)=>b[1]-a[1] || a[0].i-b[0].i)[0]?.[0] ?? null;
  if(style.type===BALANCE){
    for(const axis of [0,1,2]){
      const high=best(leans.map(lean=>[lean,toward(lean,axis,true)]));
      const low=high && best(leans.filter(lean=>apart(lean,high)).map(lean=>[lean,toward(lean,axis,false)]));
      if(low)return [pick(high,[reason(high,axis,true)]),pick(low,[reason(low,axis,false)])];
    }
    return [];
  }
  const highs=[0,1,2].map(axis=>style.type[axis]===HIGHS[axis]);
  const most=[0,1,2].map(axis=>Math.max(0,...leans.map(lean=>toward(lean,axis,highs[axis]))));
  const ranks=styleRanks(style.score);
  const weight=ranks.slice(0,3).map(rank=>rank===null ? 0.6 : 0.2+0.8*(50-rank)/49);
  const parts=lean => [0,1,2].map(axis=>most[axis] ? weight[axis]*toward(lean,axis,highs[axis])/most[axis] : 0);
  const sum=values => values.reduce((total,value)=>total+value,0);
  const reasonsOf=lean => parts(lean).map((part,axis)=>[part,axis]).filter(([part])=>part>0)
    .sort((a,b)=>b[0]-a[0]).map(([,axis])=>reason(lean,axis,highs[axis]));
  const first=best(leans.map(lean=>[lean,sum(parts(lean))]));
  if(!first)return [];
  const main=reasonsOf(first)[0].axis;
  const second=best(leans.filter(lean=>apart(lean,first))
    .map(lean=>[lean,sum(parts(lean).map((part,axis)=>axis===main ? part/2 : part))]));
  return [first,second].filter(Boolean).map(lean=>pick(lean,reasonsOf(lean)));
}

// The /style page shows them from the link's fragment, which never reaches the
// server: k= each pick as its step and reasons, the strongest first, and sgf= the game.
// A reason is its side's letter with what the move did: A with a (attacked),
// i (invaded) or b (both), G (reinforced), H or L with the line, F or R with
// the lines to the nearest opponent stone.
const reasonToken = r => r.axis===0 ? (r.high ? "A"+(r.attack && r.invasion ? "b" : r.attack ? "a" : "i") : "G") :
  (r.axis===1 ? (r.high ? "H" : "L")+r.line : (r.high ? "F" : "R")+r.far);
const REASON_RE = /^(?:A[abi]|G|[HL]\d{1,2}|[FR][1-4])$/;
function readReason(token) {
  const axis="AGHLFR".indexOf(token[0])>>1, high="AHF".includes(token[0]), value=Number(token.slice(1));
  return {axis,high,attack:"ab".includes(token[1] ?? "-"),invasion:"ib".includes(token[1] ?? "-"),
    reinforcement:token==="G",line:axis===1 ? value : null,far:axis===2 ? value : null};
}

/** The fragment carrying `picks` (from styleMoves) and their game's SGF to the /style page; "" for none. */
export function styleMovesHash(picks, sgf, com=false) {
  if(!picks?.length || !sgf)return "";
  return "#k="+picks.map(pick=>pick.step+"_"+pick.reasons.map(reasonToken).join(".")).join(",")+
    (com ? "&com=1" : "")+"&sgf="+encodeURIComponent(sgf);
}

/** The picks, SGF and whether a COM played them from a /style fragment, or null. */
export function readStyleMovesHash(hash) {
  const query=new URLSearchParams((hash ?? "").replace(/^#/,""));
  const sgf=query.get("sgf"), given=query.get("k");
  if(!sgf || !given)return null;
  const picks=given.split(",").slice(0,STYLE_MOVES).map(part=>{
    const [step,reasons=""]=part.split("_"), tokens=reasons.split(".");
    return /^[1-9]\d{0,3}$/.test(step) && tokens.every(token=>REASON_RE.test(token)) ?
      {step:Number(step),reasons:tokens.map(readReason)} : null;
  });
  return picks.every(Boolean) ? {picks,sgf,com:query.get("com")==="1"} : null;
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

// Where people stand on each axis, every 2.5%: 攻め and 模様 over 7,401
// sides of even 19路 games on the Fox server, 攻め read by attacking alone,
// and 自由 over 32,854 sides of the same ranks (15級 to 3段);
// 引き際 put together from the resignations, playing on and LET_GO below.
const PEOPLE = Object.freeze({
  attack:[-0.224,-0.153,-0.127,-0.112,-0.098,-0.088,-0.078,-0.071,-0.064,-0.057,-0.052,-0.045,-0.04,-0.035,-0.03,-0.024,-0.02,-0.015,-0.01,-0.005,-0.001,0.004,0.009,0.014,0.019,0.024,0.028,0.034,0.04,0.045,0.05,0.057,0.063,0.07,0.077,0.085,0.096,0.109,0.126,0.155,0.519],
  grit:[-1,-1,-0.983,-0.942,-0.896,-0.85,-0.793,-0.739,-0.683,-0.631,-0.569,-0.506,-0.483,-0.448,-0.4,-0.35,-0.318,-0.275,-0.2,-0.133,-0.05,0,0,0,0,0,0,0,0.083,0.175,0.261,0.343,0.45,1,1,1,1,1,1,1,1],
  height:[-0.434,-0.309,-0.309,-0.309,-0.309,-0.184,-0.184,-0.184,-0.184,-0.184,-0.184,-0.184,-0.059,-0.059,-0.059,-0.059,-0.059,-0.059,-0.059,-0.059,-0.059,-0.005,0.066,0.066,0.066,0.066,0.066,0.066,0.066,0.066,0.191,0.191,0.191,0.191,0.191,0.191,0.316,0.316,0.316,0.441,0.566],
  tenuki:[-0.231,-0.113,-0.092,-0.081,-0.071,-0.064,-0.057,-0.052,-0.047,-0.042,-0.038,-0.034,-0.029,-0.025,-0.022,-0.018,-0.015,-0.011,-0.007,-0.003,0,0.003,0.007,0.01,0.014,0.019,0.023,0.027,0.032,0.036,0.042,0.047,0.054,0.061,0.069,0.08,0.093,0.112,0.142,0.204,1.169],
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

// 引き際 among people, from KataGo's small network on Fox 19路 games (15級 to
// 1段). LET_GO every 5%: the median of letGoPoints over the 429 of 574 sides
// with two or more weak groups. Its correlation with the Fox rank is 0.14;
// over groups that died alone it was 0.28 (15級 -0.77, 1段 -0.54), and the
// game's own loss per move, standing for strength, took little of it away
// (0.25). Resignations: 661 of 931 games, 52 points behind and 18
// own moves since falling 20 behind at the median. 17.9% of sides played on
// behind like 粘り強い's first rule.
const LET_GO = [-1,-0.87,-0.74,-0.67,-0.6,-0.51,-0.46,-0.42,-0.36,-0.33,-0.3,-0.26,-0.24,-0.21,-0.17,-0.13,-0.11,-0.07,-0.05,-0.03,0];

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
    towards(PEOPLE.grit,score.grit,score.grit>=0)];
  return ranks.map(rank=>rank===null ? null : Math.max(1,Math.min(50,Math.round(rank*100))));
}

/** The reasons behind each axis, as the /style link carries them (see scoreTallies). */
export const evidence = score => (score.shares ?? [null,null,null,null]).map(v=>v ?? "");

// Each type's share of people, in percent: Fox 19路, the first three axes as
// PEOPLE and 引き際 as PEOPLE.grit (52% Q), read as independent.
const TYPE_SHARES = Object.freeze({AHFQ:5.5,AHFT:5,AHRQ:6.2,AHRT:5.7,ALFQ:7,ALFT:6.5,ALRQ:6.2,ALRT:5.7,BLNC:3.4,
  GHFQ:5,GHFT:4.7,GHRQ:6.9,GHRT:6.4,GLFQ:6.6,GLFT:6.1,GLRQ:6.8,GLRT:6.3});
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
    // The partner from the same game is carried whole, so the page shows both players.
    (partner ? "&u="+partner.type+(partner.color==="B" || partner.color==="W" ? "&uc="+partner.color : "")+
      (partner.score ? "&ul="+leanings(partner.score).join(",")+"&up="+styleRanks(partner.score).map(v=>v ?? "").join(",")+
        "&ue="+evidence(partner.score).join(",") :
      partner.leans ? "&ul="+partner.leans.join(",") : "") : "");
}

/**
 * What a /style URL asks for: a known type, or null, with its colour,
 * leanings, ranks, reasons and games if valid, and the partner's type and
 * leanings when the link reads two players together.
 */
export function readStyleLink(search) {
  const query=new URLSearchParams(search);
  const four = (key, ok) => {
    const values=ints(query.get(key),ok);
    return values?.length===4 && values.every(v=>v!==null) ? values : null;
  };
  // One player's part of the link, under its own keys.
  const side = (t, c, s, p, e) => {
    const type=query.get(t);
    if(!PLAY_STYLE_RE.test(type ?? ""))return null;
    // A rank may be missing (null) where people were not measured, but not all of them.
    const ranked=ints(query.get(p),v=>v>=1 && v<=50);
    const shown=ints(query.get(e),v=>v>=-999999 && v<=FAR_REASON+10*APART.far);
    return {type,color:["B","W"].includes(query.get(c)) ? query.get(c) : null,leans:four(s,v=>Math.abs(v)<=100),
      ranks:ranked?.length===4 && ranked.some(v=>v!==null) ? ranked : null,evidence:shown?.length===4 ? shown : null};
  };
  const found=side("t","c","s","p","e");
  if(!found)return null;
  const games=Number(query.get("n"));
  return {...found,games:Number.isInteger(games) && games>1 && games<=MAX_POOLED ? games : 1,
    partner:side("u","uc","ul","up","ue")};
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
