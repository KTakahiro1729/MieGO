
import {isFree,isGomoku,isJapanese,play} from "./core.mjs";
import {personalityFeatures,stanceOf,STYLE_AXES,styleSignal} from "./ai-personality.mjs";
import {clamp,samplePolicyCandidate} from "./ai-policy-sampling.mjs";
import {AI_STRENGTHS,pickWeakenedMove} from "./ai-strength.mjs";
import {OWNERSHIP_BANDS} from "./territory-view.mjs";
export {personalityFeatures,STYLE_AXES} from "./ai-personality.mjs";

const bounded = v => clamp(Number(v) || 0, 0, 100);

// Every candidate, including policy and preference candidates, goes through the
// Chinese move-legality engine. Personas cannot override ko or suicide.
export function legalAiMoves(state) {
  if (state.status !== "playing") return [];
  const moves = [];
  for (let p=0; p<state.board.length; p++) {
    if (state.board[p]) continue;
    try { play(state,p); moves.push(p); } catch {}
  }
  return moves;
}

export function scorePolicyCandidates(state, logits, ownership, options={}) {
  if(!logits || logits.length!==state.board.length)throw new Error("Invalid KataGo policy logits");
  const legal=legalAiMoves(state).filter(p=>Number.isFinite(logits[p]));
  if(!legal.length)return [];
  const best=Math.max(...legal.map(p=>logits[p]));
  // Weakened levels sample from every legal move, so keep the long tail.
  const window=options.allMoves ? Infinity : 8;
  // Each axis is 0..100 with 50 neutral and adds at most ±3 to a logit.
  const values={...options,stance:stanceOf(options)};
  const weights=Object.fromEntries(STYLE_AXES.map(axis=>
    [axis,(bounded(values[axis] ?? 50)-50)/50 * 3]));
  return legal.filter(p=>logits[p]>=best-window).map(position=>{
    const f=personalityFeatures(state,position,ownership);
    const bonus=STYLE_AXES.reduce((sum,axis)=>sum+weights[axis]*styleSignal[axis](f),0);
    return {position,raw:logits[position],score:logits[position]+bonus,...f};
  });
}

/** Like a person, the AI starts to think about passing once the board has
 * settled (EndgameAdvisor's "near" or "ready": the last moves shift the
 * estimate by at most about two points), whatever the move number or board
 * size. A pass by the other side counts the same way: on an unsettled board
 * the AI plays on. A pass is only a candidate; KataGo's pass logit decides.
 */
export function canConsiderAiPass(stage="playing") {
  return stage==="near" || stage==="ready";
}
/** After the other side passed on a settled board, a move on a point KataGo
 * already gives to one side (inside either area, or taking stones it calls
 * dead) cannot change the result: the count settles those stones the same
 * way (area scoring). Like a person, the AI passes back instead of playing them out; a
 * point still open (a dame, an unclosed border) is still played.
 */
export function answersPass(state, position, ownership, stage) {
  // Under Japanese rules the AI already passes back: each move there costs a point.
  if(position===null || isJapanese(state) || !canConsiderAiPass(stage) ||
    state.moves.at(-1)?.position!==null)return false;
  if(!Array.isArray(ownership) || !Number.isFinite(ownership[position]))return false;
  return Math.abs(ownership[position])>=OWNERSHIP_BANDS.SETTLED;
}
export function choosePolicyMove(state, logits, passLogit, options={}) {
  const position=pickPolicyMove(state,logits,passLogit,options);
  return answersPass(state,position,options.ownership,options.endgameStage) ? null : position;
}
function pickPolicyMove(state, logits, passLogit, options) {
  const weakened=Number.isFinite(AI_STRENGTHS[options.strength]?.kyu);
  const candidates=scorePolicyCandidates(state,logits,options.ownership,
    {...options,allMoves:weakened});
  if(!candidates.length)return null;
  const passAllowed=canConsiderAiPass(options.endgameStage);
  if(weakened)return pickWeakenedMove(candidates,passLogit,{...options,state,passAllowed});
  // 最強 trusts the network: its top move, with no personality or sampling,
  // or the move its read found best when it was behind.
  if(options.strength==="strongest"){
    const top=candidates.reduce((a,b)=>b.raw>a.raw?b:a);
    if(passAllowed && Number.isFinite(passLogit) && passLogit>top.raw)return null;
    return candidates.some(c=>c.position===options.readMove) ? options.readMove : top.position;
  }
  if(passAllowed && Number.isFinite(passLogit)){
    candidates.push({position:null,score:passLogit-0.3});
  }
  return samplePolicyCandidate(candidates,options);
}

/** 終局の提案: how far behind a COM must be to see its game lost and offer to
 * end it, by its setting (0 plays every game out). The setting keeps its old
 * key, resign: the COM once resigned here. Both the win rate and the score
 * lead must agree, since the small network's win rate alone is far from
 * calibrated on 9x9. Like KataGo's own resignation default (resignConsecTurns
 * 3), it takes three of its turns in a row that look hopeless, and not in the
 * opening, where estimates swing most. */
export const RESIGN_LEVELS = Object.freeze({
  50: Object.freeze({winRate:.03, boardShare:1/4}),
  100: Object.freeze({winRate:.1, boardShare:1/8}),
});
export const RESIGN_TURNS = 3;
export function createResignWatch() {
  let streak = {};
  return {
    reset() { streak = {}; },
    /** Whether `color`'s game has looked lost for long enough. */
    lost(color) { return (streak[color] || 0) >= RESIGN_TURNS; },
    /** True when the COM to move sees its game lost. winRate and lead are Black's. */
    observe(state, resign, {winRate, lead}) {
      const level = RESIGN_LEVELS[resign], color = state.next;
      if (!level || !Number.isFinite(winRate) || !Number.isFinite(lead) || isGomoku(state) || isFree(state)) {
        streak[color] = 0; return false;
      }
      const mine = color > 0 ? winRate : 1 - winRate, behind = -color * lead;
      const area = state.board.length;
      const hopeless = state.moveNumber >= area / 4 && mine <= level.winRate && behind >= area * level.boardShare;
      streak[color] = hopeless ? (streak[color] || 0) + 1 : 0;
      return streak[color] >= RESIGN_TURNS;
    },
  };
}
