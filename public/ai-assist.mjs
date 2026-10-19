import {initialGame,play} from "./core.mjs";
import {legalAiMoves} from "./ai-opponent.mjs";

/** Take back the human's latest move (and the AI reply after it) in an AI game.
 * The position is rebuilt by replaying the remaining moves, so captures, ko
 * history and pass counts stay consistent with the rules engine.
 * Returns null when nothing can be taken back.
 */
export function takeBackForHuman(state, humanColor) {
  if(state.status!=="playing" || state.endProposal)return null;
  let cut=-1;
  for(let i=state.moves.length-1;i>=0;i--)
    if(state.moves[i].color===humanColor){cut=i;break;}
  if(cut<0)return null;
  let game=initialGame(state);
  for(const move of state.moves.slice(0,cut))game=play(game,move.position);
  const last=game.moves.at(-1)?.position;
  return {game,lastPosition:Number.isInteger(last)?last:null};
}

/** KataGo policy hints for the player to move: the top legal points, with
 * their share of the policy among legal moves. Policy is "shape intuition"
 * without reading, so it is a suggestion, not a guaranteed best move.
 */
export function policyHints(state, logits, count=3) {
  if(!Array.isArray(logits) || logits.length!==81)return [];
  const legal=legalAiMoves(state).filter(p=>Number.isFinite(logits[p]));
  if(!legal.length)return [];
  const top=Math.max(...legal.map(p=>logits[p]));
  const total=legal.reduce((sum,p)=>sum+Math.exp(logits[p]-top),0);
  return legal.map(position=>({position,share:Math.exp(logits[position]-top)/total}))
    .sort((a,b)=>b.share-a.share).slice(0,count);
}
