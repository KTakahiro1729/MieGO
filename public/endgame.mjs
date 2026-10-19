import { group } from "./core.mjs";
import { OWNERSHIP_BANDS } from "./territory-view.mjs";

/** Non-authoritative endgame advice for 9x9 Chinese rules.
 * Evaluations must be from committed positions (never sandbox/preview moves).
 * Stable ownership is only a necessary hint, not a life-and-death proof.
 */
export const ENDGAME_HINTS = Object.freeze({
  playing:"終局まではまだまだです",
  near:"そろそろ終局です",
  ready:"終局をご検討ください"
});
/** No KataGo evaluation is not the same thing as 'far from endgame'. */
export function endgameHint(state,advisor,{unavailable=false,suppressedUntil=-1}={}) {
  if(unavailable)return "終局の目安を判定できません";
  if(!advisor.previous)return "終局の目安を確認中";
  if(state.moveNumber-advisor.previous.move>3)return "終局の目安を更新中";
  // Three steps. After the player chose to keep playing, the strongest one
  // waits for the next move and the milder one stands in for it.
  if(advisor.stage==="ready" && state.moveNumber>suppressedUntil)return ENDGAME_HINTS.ready;
  if(advisor.stage==="ready" || advisor.stage==="near")return ENDGAME_HINTS.near;
  return ENDGAME_HINTS.playing;
}
const DECIDED = .9;
/** Board area relative to 9x9: the unit for stone-count thresholds. */
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
    // A group in atari is an open fight, unless the estimate shows every stone
    // of it in the opponent's settled colour: then it is a dead group waiting
    // to be removed at scoring, not a reason to keep playing.
    let fight=false;
    const visited=new Set();
    for(let i=0;i<state.board.length;i++){
      if(!state.board[i] || visited.has(i))continue;
      const g=group(state.board,i);
      for(const j of g.stones)visited.add(j);
      if(g.liberties.size>1)continue;
      if(![...g.stones].every(j=>state.board[j]*ownership[j]<=-OWNERSHIP_BANDS.SETTLED))fight=true;
    }
    const share = line => free.length ? free.filter(i=>Math.abs(ownership[i])>=line).length/free.length : 1;
    const settled = share(OWNERSHIP_BANDS.SETTLED), decided = share(DECIDED);
    let change = Infinity;
    if(this.previous) {
      change = free.length
        ? free.reduce((s,i)=>s+Math.abs(ownership[i]-this.previous.ownership[i]),0)/free.length
        : 0;
    }
    // How far the game has gone is read from the stones on the board, not the
    // move number: a short, decisive game settles early. "ready" asks for most
    // empty points to be all but decided (|v| >= DECIDED) on two evaluations
    // in a row; tuned on self-play so that scoring at that point gives the
    // estimate's result within a few points. Counts were tuned on 9x9;
    // larger boards scale them by area.
    const scale = boardScale(state.board.length);
    const stable = occupied>=24*scale &&
      free.length>0 && decided>=.85 && change<=.09 && !fight;
    this.streak = stable ? this.streak+1 : 0;
    this.stage = this.streak>=2 ? "ready"
      : occupied>=20*scale && settled>=.65 && !fight ? "near" : "playing";
    this.previous={move:state.moveNumber,ownership:[...ownership]};
    return this.stage;
  }
}
