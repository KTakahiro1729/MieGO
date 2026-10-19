
import {play,SIZE} from "./core.mjs";
import {personalityFeatures} from "./ai-personality.mjs";
import {samplePolicyCandidate} from "./ai-policy-sampling.mjs";
import {AI_STRENGTHS,pickWeakenedMove} from "./ai-strength.mjs";
export {personalityFeatures} from "./ai-personality.mjs";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const bounded = v => clamp(Number(v) || 0, 0, 100);

// Every candidate, including policy and preference candidates, goes through the
// Chinese move-legality engine. Personas cannot override ko or suicide.
export function legalAiMoves(state) {
  if (state.status !== "playing") return [];
  const moves = [];
  for (let p=0; p<SIZE*SIZE; p++) {
    if (state.board[p]) continue;
    try { play(state,p); moves.push(p); } catch {}
  }
  return moves;
}

export function scorePolicyCandidates(state, logits, ownership, options={}) {
  if(!logits || logits.length!==81)throw new Error("Invalid KataGo policy logits");
  const legal=legalAiMoves(state).filter(p=>Number.isFinite(logits[p]));
  if(!legal.length)return [];
  const best=Math.max(...legal.map(p=>logits[p]));
  // Weakened levels sample from every legal move, so keep the long tail.
  const window=options.allMoves ? Infinity : 8;
  const invasionWeight=(bounded(options.invasion ?? 50)-50)/50 * 3;
  const reinforceWeight=(bounded(options.reinforcement ?? 50)-50)/50 * 3;
  return legal.filter(p=>logits[p]>=best-window).map(position=>{
    const f=personalityFeatures(state,position,ownership);
    return {position,raw:logits[position],
      score:logits[position]+invasionWeight*f.invasion+reinforceWeight*f.reinforcement,
      invasion:f.invasion,reinforcement:f.reinforcement};
  });
}

/** Ownership advice changes only the earliest time a NN pass is
 * considered; it never forces an automatic pass.
 */
export function canConsiderAiPass(state,stage="playing") {
  if(state.passes===1 && state.moveNumber>=18)return true;
  const minimum=stage==="ready"?45:stage==="near"?52:58;
  return state.moveNumber>=minimum;
}
export function choosePolicyMove(state, logits, passLogit, options={}) {
  if (state.status!=="playing") throw new Error("対局中ではありません");
  const weakened=Number.isFinite(AI_STRENGTHS[options.strength]?.kyu);
  const candidates=scorePolicyCandidates(state,logits,options.ownership,
    {...options,allMoves:weakened});
  if(!candidates.length)return null;
  const passAllowed=canConsiderAiPass(state,options.endgameStage);
  if(weakened)return pickWeakenedMove(candidates,passLogit,{...options,state,passAllowed});
  if(passAllowed && Number.isFinite(passLogit)){
    candidates.push({position:null,score:passLogit-0.3});
  }
  return samplePolicyCandidate(candidates,options);
}
