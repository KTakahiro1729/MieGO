import { group, BLACK, WHITE } from "./core.mjs";

/** Conservatively propose dead *groups* from KataGo NN ownership.
 * These are not proven dead stones, and are never accepted as final without
 * the players' scoring confirmation. Positive ownership means Black.
 */
export function suggestDeadStones(state, ownership) {
  if(!Array.isArray(ownership) || ownership.length!==state.board.length ||
      ownership.some(v=>!Number.isFinite(v) || Math.abs(v)>1.001)) {
    throw new Error("Invalid KataGo ownership");
  }
  const result=new Set(),visited=new Set();
  for(let i=0;i<state.board.length;i++) {
    const color=state.board[i];
    if((color!==BLACK && color!==WHITE) || visited.has(i))continue;
    const g=group(state.board,i);
    for(const p of g.stones)visited.add(p);
    const control=[...g.stones].map(p=>color*ownership[p]);
    const avg=control.reduce((x,y)=>x+y,0)/control.length;
    // Mark only groups strongly predicted to belong to the *opponent*.
    // Favor small groups under direct pressure; uncertain stones remain live.
    if(avg<=-0.88 && control.every(v=>v<=-0.67) &&
       g.liberties.size<=4) {
      for(const p of g.stones)result.add(p);
    }
  }
  return [...result].sort((a,b)=>a-b);
}
