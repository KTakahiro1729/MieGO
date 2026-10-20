import {play,neighbors,group,sizeOf} from "./core.mjs";

const clamp = (v,a,b) => Math.max(a,Math.min(b,v));

// The style axes a COM carries, each 0..100 with 50 neutral.
// height: 0 low, 100 high. stance: 0 defends, 100 attacks and invades.
// tenuki: 0 answers close by, 100 plays elsewhere.
export const STYLE_AXES = Object.freeze([
  "height",
  "stance",
  "tenuki",
]);
// What each axis rewards, from personalityFeatures. Attacking, invading and
// reinforcing each moved few moves alone, and attacking also invaded more
// (docs/AI_PERSONALITIES.md), so they share one axis.
export const styleSignal = Object.freeze({
  height: f => f.height,
  stance: f => f.attack + f.invasion - f.reinforcement,
  tenuki: f => f.tenuki,
});
// Saved settings from before 攻守 took in 侵入度 and 補強度: 攻守 is the mean of
// what is there, with 侵入 重視 and 補強 控える both reading as 攻める.
export function stanceOf(com) {
  const parts=[com.stance ?? (com.reinforcement==null ? null : 100-com.reinforcement),com.invasion]
    .filter(value=>value!=null && Number.isFinite(Number(value))).map(Number);
  return parts.length ? parts.reduce((a,b)=>a+b,0)/parts.length : 50;
}

/** Style signals for one candidate move. invasion and reinforcement read the
 * ownership map; attack, height and tenuki read only the board and the last move.
 * A neural ownership map is a control tendency, not a guarantee of life.
 * - invasion 0..1: the point lies in the opponent's sphere.
 * - reinforcement 0..1: adds liberties to a weak friendly group or firms a border.
 * - attack 0..1: takes liberties from an adjacent opponent group, captures, or cuts.
 * - height -1..1: -1 on the 2nd and 3rd lines, +1 on the 4th line and above,
 *   0 on the 1st line; it fades out as the board fills, since it is an opening taste.
 * - tenuki -1..1: -1 next to the opponent's last move, +1 five or more lines away.
 */
export function personalityFeatures(state, point, ownership) {
  if (!Number.isInteger(point) || point<0 || point>=state.board.length || state.board[point])
    throw new Error("Invalid personality candidate");
  const side=state.next;
  const adjacent=neighbors(point,sizeOf(state.board));
  const own=adjacent.filter(n=>state.board[n]===side);
  const opponent=adjacent.filter(n=>state.board[n]===-side);
  const after=play(state,point);
  const afterLib=group(after.board,point).liberties.size;
  const shape={attack:attackFeature(state,after,opponent,afterLib),
    height:heightFeature(state.board,point),tenuki:tenukiFeature(state,point)};
  if (!ownership || ownership.length!==state.board.length) return {invasion:0,reinforcement:0,...shape};
  const control=clamp(side * (Number(ownership[point]) || 0),-1,1);
  const invasion=clamp((-control-0.15)/0.85,0,1);
  if (!own.length) return {invasion,reinforcement:0,...shape};
  let rescue=0;
  const visited=new Set();
  for(const n of own) {
    if(visited.has(n))continue;
    const g=group(state.board,n);
    for(const stone of g.stones)visited.add(stone);
    const oldLib=g.liberties.size;
    const gains=Math.max(0,afterLib-oldLib);
    rescue=Math.max(rescue,clamp((4-oldLib)/3,0,1)*clamp(gains/2,0,1));
  }
  // Consolidate unsettled friendly borders, not fully controlled interior eyes.
  const border=control>0.05 && control<0.85
    ? clamp((control-0.05)/0.45,0,1) * (opponent.length ? 0.6 : 0.35)
    : 0;
  const insideEye=adjacent.length>=3 &&
    adjacent.every(n=>state.board[n]===side);
  const reinforcement=insideEye?0:Math.max(rescue,border);
  return {invasion,reinforcement,...shape};
}

// A capture scores 1, leaving a group in atari 1, on two liberties 0.3.
// Standing between two opponent groups is a cut (0.6). A move left in atari
// itself attacks nothing, so a fighter does not throw stones away.
function attackFeature(state, after, opponent, afterLib) {
  const captured=after.board.some((v,p)=>v===0 && state.board[p]===-state.next);
  if(captured)return 1;
  if(afterLib<=1)return 0;
  let pressure=0;
  const groups=new Set();
  for(const n of opponent) {
    const before=group(state.board,n);
    groups.add(Math.min(...before.stones));
    const left=group(after.board,n).liberties.size;
    if(left<before.liberties.size)pressure=Math.max(pressure,left<=1?1:left===2?0.3:0);
  }
  return Math.max(pressure,groups.size>=2?0.6:0);
}

function heightFeature(board, point) {
  const size=sizeOf(board),x=point%size,y=Math.floor(point/size);
  const line=Math.min(x,y,size-1-x,size-1-y)+1;
  const value=line===1?0:line<=3?-1:1;
  // Full strength while at least 80% of the board is empty, none at 40%.
  const empty=board.filter(v=>v===0).length/board.length;
  return value*clamp((empty-0.4)/0.4,0,1) || 0;
}

function tenukiFeature(state, point) {
  const last=state.moves?.at(-1);
  if(!last || last.color!==-state.next || !Number.isInteger(last.position))return 0;
  const size=sizeOf(state.board);
  const d=Math.max(Math.abs(point%size-last.position%size),
    Math.abs(Math.floor(point/size)-Math.floor(last.position/size)));
  return clamp((d-3)/2,-1,1);
}
