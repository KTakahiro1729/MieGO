import {legalAiMoves} from "./ai-opponent.mjs";

/** KataGo policy hints for the player to move: the top legal points, with
 * their share of the policy among legal moves. Policy is "shape intuition"
 * without reading, so it is a suggestion, not a guaranteed best move.
 */
export function policyHints(state, logits, count=3) {
  if(!Array.isArray(logits) || logits.length!==state.board.length)return [];
  const legal=legalAiMoves(state).filter(p=>Number.isFinite(logits[p]));
  if(!legal.length)return [];
  const top=Math.max(...legal.map(p=>logits[p]));
  const total=legal.reduce((sum,p)=>sum+Math.exp(logits[p]-top),0);
  return legal.map(position=>({position,share:Math.exp(logits[position]-top)/total}))
    .sort((a,b)=>b.share-a.share).slice(0,count);
}
