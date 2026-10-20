import {neighbors,SIZE,sizeOf} from "./core.mjs";
import { TEXT } from "./texts.mjs";

// Beginner-friendly strength levels. "strong" keeps the original
// temperature-sampled KataGo policy. The weaker levels follow KaTrain's
// calibrated-rank "policy pick" idea: draw N random legal moves and play the
// one KataGo's policy likes best, so mistakes stay shape-like instead of the
// AI simply becoming random. KaTrain calibrated these constants on 19x19 with
// full-size networks; on MieGO's 9x9 test network they only order the levels
// and are NOT a kyu/dan rating.
// Formula adapted from KaTrain (MIT License, Copyright (c) 2020 Sander Land),
// katrain/core/ai.py RankStrategy.
export const AI_STRENGTHS = Object.freeze({
  beginner:{label:TEXT.ai.strengths.beginner,kyu:30},
  easy:{label:TEXT.ai.strengths.easy,kyu:20},
  normal:{label:TEXT.ai.strengths.normal,kyu:12},
  strong:{label:TEXT.ai.strengths.strong,kyu:null},
  // Plays the top policy move of KataGo's 9x9 network (kata9x9), which the
  // page downloads only once a game against it starts.
  strongest:{label:TEXT.ai.strengths.strongest,kyu:null,boardSize:9}
});
export const DEFAULT_AI_STRENGTH = "easy";
// Saved games from before strength levels existed used the full policy.
export const normalizeStrength = (value, fallback="strong") =>
  Object.hasOwn(AI_STRENGTHS,value) ? value : fallback;

/** The strength a game of this board size plays with: a level made for one
 * board size plays as 「つよい」 on the others. */
export const strengthForSize = (strength, size) =>
  AI_STRENGTHS[strength]?.boardSize && AI_STRENGTHS[strength].boardSize!==size ? "strong" : strength;

export function pickCount(kyu, legalCount, boardSquares=SIZE*SIZE) {
  const norm=legalCount/boardSquares;
  const orig=0.063015+0.7624*boardSquares/10**(-0.05737*kyu+1.9482);
  const exponent=3.002*norm*norm-norm-0.034889*kyu-0.5097;
  const modified=(0.3931+0.6559*norm*Math.exp(-(exponent**2))-0.01093*kyu)*orig;
  const denominator=1.31165*(modified+1)-0.082653;
  return Math.max(1,Math.round(boardSquares*norm/denominator));
}

// Filling a point surrounded only by your own stones almost never helps and
// confuses beginners when the AI destroys its own eyes.
export function fillsOwnEye(state, point) {
  const adjacent=neighbors(point,sizeOf(state.board));
  return adjacent.every(n=>state.board[n]===state.next);
}

function softmax(values) {
  const top=Math.max(...values);
  const weights=values.map(v=>Math.exp(v-top));
  const total=weights.reduce((a,b)=>a+b,0);
  return weights.map(w=>w/total);
}

/**
 * candidates: legal non-pass moves [{position, raw, score}], where raw is the
 * KataGo logit and score may include personality bonuses.
 * Returns a board position, or null for pass.
 */
export function pickWeakenedMove(candidates, passLogit, options={}) {
  if(!candidates.length)return null;
  const kyu=AI_STRENGTHS[options.strength]?.kyu;
  if(!Number.isFinite(kyu))throw new Error("Unknown weakened AI strength");
  const random=options.random || Math.random;
  const hasPass=Number.isFinite(passLogit);
  const passOk=!!options.passAllowed && hasPass;
  const probs=softmax([...candidates.map(c=>c.raw),hasPass?passLogit:-Infinity]);
  const passProb=probs.at(-1);
  const ranked=candidates.map((c,i)=>({...c,prob:probs[i]}))
    .sort((a,b)=>b.prob-a.prob);
  const top=ranked[0];
  const best=passOk && passProb>top.prob ? null : top.position;
  // KaTrain's overrides: near the end (pass among the top five), forced-looking
  // moves such as captures or urgent defence are answered with the top move.
  if(hasPass && (ranked.length<5 || passProb>=ranked[4].prob))return best;
  const squares=options.state?.board?.length || SIZE*SIZE;
  const filled=(squares-ranked.length)/squares;
  if(top.prob>0.8*(1-0.5*filled))return top.position;
  if(ranked.length>1 && top.prob+ranked[1].prob>0.85+Math.max(0,0.02*(kyu-8)))
    return top.position;
  const pool=ranked.filter((c,i)=>i===0 || !fillsOwnEye(options.state,c.position));
  const n=Math.min(pool.length,pickCount(kyu,ranked.length,squares));
  // Uniform sample without replacement (Fisher-Yates prefix).
  for(let i=0;i<n;i++){
    const r=Math.max(0,Math.min(Number(random())||0,1-Number.EPSILON));
    const j=i+Math.floor(r*(pool.length-i));
    [pool[i],pool[j]]=[pool[j],pool[i]];
  }
  const chosen=pool.slice(0,n).reduce((a,b)=>b.score>a.score?b:a);
  // A weak pick that is worse than passing would only fill the board; KaTrain
  // falls back to the top policy move here.
  if(hasPass && chosen.prob<passProb)return best;
  return chosen.position;
}
