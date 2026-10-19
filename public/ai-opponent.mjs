
import { play, neighbors, group, SIZE } from "./core.mjs";

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

export function scorePolicyCandidates(state, logits, ownership, options={}) {
  if(!logits || logits.length!==81)throw new Error("Invalid KataGo policy logits");
  const legal=legalAiMoves(state).filter(p=>Number.isFinite(logits[p]));
  if(!legal.length)return [];
  const best=Math.max(...legal.map(p=>logits[p]));
  const invasionWeight=(bounded(options.invasion ?? 50)-50)/50 * 3;
  const reinforceWeight=(bounded(options.reinforcement ?? 50)-50)/50 * 3;
  return legal.filter(p=>logits[p]>=best-8).map(position=>{
    const f=personalityFeatures(state,position,ownership);
    return {position,raw:logits[position],
      score:logits[position]+invasionWeight*f.invasion+reinforceWeight*f.reinforcement,
      invasion:f.invasion,reinforcement:f.reinforcement};
  });
}

export function choosePolicyMove(state, logits, passLogit, options={}) {
  if (state.status!=="playing") throw new Error("対局中ではありません");
  if(state.moveNumber>=145)return null;
  const candidates=scorePolicyCandidates(state,logits,options.ownership,options);
  if(!candidates.length)return null;
  const passAllowed=state.moveNumber>=58 || (state.passes===1 && state.moveNumber>=18);
  if(passAllowed && Number.isFinite(passLogit)){
    candidates.push({position:null,score:passLogit-0.3});
  }
  const temp=clamp(Number(options.temperature)||0.4,0.05,2);
  const top=Math.max(...candidates.map(c=>c.score));
  const weights=candidates.map(c=>Math.exp((c.score-top)/temp));
  const total=weights.reduce((a,b)=>a+b,0);
  const random=options.random || Math.random;
  let sample=clamp(Number(random()),0,1-Number.EPSILON)*total;
  for(let i=0;i<candidates.length;i++){
    sample-=weights[i];
    if(sample<=0)return candidates[i].position;
  }
  return candidates.at(-1).position;
}
