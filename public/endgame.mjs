import { group } from "./core.mjs";
import { OWNERSHIP_BANDS } from "./territory-view.mjs";
import { TEXT } from "./texts.mjs";

/** Non-authoritative endgame advice, the same on every board size.
 * Evaluations must be from committed positions (never sandbox/preview moves).
 * Stable ownership is only a necessary hint, not a life-and-death proof.
 */
export const ENDGAME_HINTS = Object.freeze({
  playing:TEXT.endgame.playing,
  near:TEXT.endgame.near,
  ready:TEXT.endgame.ready
});
/** No KataGo evaluation is not the same thing as 'far from endgame'. */
export function endgameHint(state,advisor,{unavailable=false,suppressedUntil=-1}={}) {
  if(unavailable)return TEXT.endgame.unavailable;
  if(!advisor.previous)return TEXT.endgame.checking;
  if(state.moveNumber-advisor.previous.move>3)return TEXT.endgame.updating;
  // Three steps. After the player chose to keep playing, the strongest one
  // waits for the next move and the milder one stands in for it.
  if(advisor.stage==="ready" && state.moveNumber>suppressedUntil)return ENDGAME_HINTS.ready;
  if(advisor.stage==="ready" || advisor.stage==="near")return ENDGAME_HINTS.near;
  return ENDGAME_HINTS.playing;
}
/** The advice reads the feel of the position, not move or stone counts: how
 * many points one stone moves in the estimate. Σ|Δv|/2 over the board is the
 * number of points that change hands (v going from -1 to +1 is one point).
 * Opening and middle game move 4-9 points a stone; "near" is when the last
 * moves shift at most about 2 points, "ready" when they shift at most 1.
 * Tuned on self-play: at "ready", scoring gives the estimate's result within
 * a few points, before the first pass. */
export const ENDGAME_SWING = Object.freeze({near:2, ready:1, window:2});
export class EndgameAdvisor {
  constructor() { this.reset(); }
  reset() {
    this.previous = null;
    this.swings = [];
    this.stage = "playing";
  }
  observe(state, ownership) {
    if (state.status !== "playing") { this.reset(); return this.stage; }
    if (!Array.isArray(ownership) || ownership.length !== state.board.length ||
      ownership.some(x => !Number.isFinite(x) || Math.abs(x)>1.001)) {
      return this.stage;
    }
    if (this.previous && state.moveNumber <= this.previous.move) return this.stage;
    // Estimates far apart say nothing about what one stone does.
    if (this.previous && state.moveNumber - this.previous.move > 3) this.swings = [];
    if (this.previous) {
      const swing = ownership.reduce((s,v,i)=>s+Math.abs(v-this.previous.ownership[i]),0)/2;
      this.swings = [...this.swings, swing].slice(-ENDGAME_SWING.window);
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
    const full = this.swings.length >= ENDGAME_SWING.window;
    const swing = full ? Math.max(...this.swings) : Infinity;
    this.stage = swing <= ENDGAME_SWING.ready && !fight ? "ready"
      : swing <= ENDGAME_SWING.near ? "near" : "playing";
    this.previous={move:state.moveNumber,ownership:[...ownership]};
    return this.stage;
  }
}
