import { group } from "./core.mjs";
import { OWNERSHIP_BANDS } from "./territory-view.mjs";

/** Non-authoritative endgame advice for 9x9 Chinese rules.
 * Evaluations must be from committed positions (never sandbox/preview moves).
 * Stable ownership is only a necessary hint, not a life-and-death proof.
 */
/** No KataGo evaluation is not the same thing as 'far from endgame'. */
export function endgameHint(state,advisor,{unavailable=false,suppressedUntil=-1}={}) {
  if(unavailable)return "終局の目安を判定できません";
  if(!advisor.previous)return "終局の目安を確認中";
  if(state.moveNumber-advisor.previous.move>3)return "終局の目安を更新中";
  return (advisor.stage==="near"||advisor.stage==="ready") &&
    state.moveNumber>suppressedUntil?"終局はいかがですか？":"終局はまだのようです";
}
/** Board area relative to 9x9: the unit for move-count thresholds. */
export const boardScale = points => Number.isFinite(points) && points>0 ? points/81 : 1;
export class EndgameAdvisor {
  constructor() { this.reset(); }
  reset() {
    this.previous = null;
    this.streak = 0;
    this.stage = "playing";
  }
  observe(state, ownership) {
    if (state.status !== "playing") { this.reset(); return this.stage; }
    if (!Array.isArray(ownership) || ownership.length !== state.board.length ||
      ownership.some(x => !Number.isFinite(x) || Math.abs(x)>1.001)) {
      return this.stage;
    }
    if (this.previous && state.moveNumber <= this.previous.move) return this.stage;
    if (this.previous && state.moveNumber - this.previous.move > 3) this.streak = 0;
    const free = [];
    let occupied = 0;
    for (let i=0;i<state.board.length;i++) {
      if (state.board[i]) occupied++; else free.push(i);
    }
    // A group in atari is an open fight. For the stable ("ready") check only,
    // a group the estimate shows wholly in the opponent's settled colour is a
    // dead group waiting to be removed at scoring, not a reason to keep
    // playing; the repeated, unchanged estimates guard against a live fight.
    let atari=false,fight=false;
    const visited=new Set();
    for(let i=0;i<state.board.length;i++){
      if(!state.board[i] || visited.has(i))continue;
      const g=group(state.board,i);
      for(const j of g.stones)visited.add(j);
      if(g.liberties.size>1)continue;
      atari=true;
      if(![...g.stones].every(j=>state.board[j]*ownership[j]<=-OWNERSHIP_BANDS.SETTLED))fight=true;
    }
    const settled = free.length
      ? free.filter(i=>Math.abs(ownership[i])>=OWNERSHIP_BANDS.SETTLED).length/free.length : 1;
    let change = Infinity;
    if(this.previous) {
      change = free.length
        ? free.reduce((s,i)=>s+Math.abs(ownership[i]-this.previous.ownership[i]),0)/free.length
        : 0;
    }
    // Move and stone counts were tuned on 9x9; larger boards scale them by area.
    const scale = boardScale(state.board.length);
    const stable = state.moveNumber>=45*scale && occupied>=24*scale &&
      free.length>0 && settled>=.8 && change<=.09 && !fight;
    this.streak = stable ? this.streak+1 : 0;
    this.stage = this.streak>=2 ? "ready"
      : state.moveNumber>=30*scale && settled>=.65 && !atari ? "near" : "playing";
    this.previous={move:state.moveNumber,ownership:[...ownership]};
    return this.stage;
  }
}
