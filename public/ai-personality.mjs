import {play,neighbors,group} from "./core.mjs";

const clamp = (v,a,b) => Math.max(a,Math.min(b,v));

/** The two scores are distinct, approximate style signals (0..1).
 * A neural ownership map is a control tendency, not a guarantee of life.
 */
export function personalityFeatures(state, point, ownership) {
  if (!Number.isInteger(point) || point<0 || point>=81 || state.board[point])
    throw new Error("Invalid personality candidate");
  if (!ownership || ownership.length!==81) return {invasion:0, reinforcement:0};
  const side=state.next;
  const control=clamp(side * (Number(ownership[point]) || 0),-1,1);
  const invasion=clamp((-control-0.15)/0.85,0,1);
  const adjacent=neighbors(point);
  const own=adjacent.filter(n=>state.board[n]===side);
  const opponent=adjacent.filter(n=>state.board[n]===-side);
  if (!own.length) return {invasion,reinforcement:0};
  const after=play(state,point);
  const afterLib=group(after.board,point).liberties.size;
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
  return {invasion,reinforcement};
}

