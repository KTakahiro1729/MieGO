// Stable temperature-weighted selection shared across AI policy callers.
// Candidate ordering and the injected random source are significant.
export const clamp = (v,a,b) => Math.max(a,Math.min(b,v));

export function samplePolicyCandidate(candidates, options={}) {
  if(!candidates.length)return null;
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
