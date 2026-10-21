import { groups } from "./core.mjs";
import { OWNERSHIP_BANDS, shownOwnership } from "./territory-view.mjs";
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
export function endgameHint(state,advisor,{unavailable=false}={}) {
  if(unavailable)return TEXT.endgame.unavailable;
  if(!advisor.previous)return TEXT.endgame.checking;
  if(state.moveNumber-advisor.previous.move>3)return TEXT.endgame.updating;
  // Three steps. After the player chose to keep playing, the milder one
  // stands in for the strongest until the board has settled again.
  if(advisor.stage==="ready" && !advisor.held)return ENDGAME_HINTS.ready;
  if(endingNear(advisor))return ENDGAME_HINTS.near;
  return ENDGAME_HINTS.playing;
}
/** The advice reads the feel of the position, not move or stone counts: how
 * many points one stone moves in the estimate. Σ|Δv|/2 over the board is the
 * number of points that change hands (v going from -1 to +1 is one point).
 * Opening and middle game move 4-9 points a stone; "near" is when the last
 * moves shift at most about 2 points, "ready" when they shift at most 1.
 * Tuned on self-play: at "ready", scoring gives the estimate's result within
 * a few points, before the first pass.
 * Each estimate is weighed against the last one with the same side to move,
 * per stone played since: the small network reads the same board more or
 * less confidently depending on whose turn it is (a won 19x19 board moved
 * about 36 points between White and Black to move), and that is not a stone
 * moving anything. Closed areas count as settled, as the board shows them. */
export const ENDGAME_SWING = Object.freeze({near:2, ready:1, window:2});
/** そろそろ also lights once this share of the board reads settled: the fights
 * are over and what is left is closing borders, as 終盤 (ヨセ) is usually defined.
 * On 9x9 COM同士 games it holds from about 70% of the game, where the swing
 * alone (≤2) holds only from 75-80% and keeps going off again. It is advice
 * only: the COM's pass and its offer to end still read the swing. */
export const ENDGAME_SETTLED_SHARE = 0.7;
/** 序盤 (布石) is staking out the board before the fights; it is over once this
 * share of the board reads settled. On 9x9 COM同士 games that is around move
 * 15-20, a quarter to a third of the game. The opening does not come back, so
 * the advisor keeps it over until the next game. */
export const OPENING_SETTLED_SHARE = 0.2;
/** そろそろ, もう終盤 under 終局を提案, is also when the COM accepts the player's offer to end:
 * a stone moves at most 2 points and this share of the board reads settled, or
 * ENDGAME_SETTLED_SHARE reads settled whatever the swing. The share keeps a calm
 * moment in the middle game (a swing of 2 or less turns up from a quarter of the
 * way in) from showing もう終盤. On 9x9 COM同士 games it holds from about 20 moves
 * before the end, where the COM's own offer ("ready": a stone moves at most
 * 1 point) holds from about 3. */
export const ENDGAME_ACCEPT_SHARE = 0.6;
/** Whether the board reads as そろそろ: what shows もう終盤, and what the COM accepts an offer at. */
export const endingNear = advisor => advisor.stage !== "playing" &&
  (advisor.settledShare ?? 0) >= ENDGAME_ACCEPT_SHARE || !!advisor.mostlySettled;
export class EndgameAdvisor {
  constructor() { this.reset(); }
  reset() {
    this.previous = null;
    this.recent = [];
    this.swings = [];
    this.stage = "playing";
    this.held = false;
    this.fresh = 0;
    this.mostlySettled = false;
    this.opened = false;
    this.settledShare = 0;
  }

  /** 対局を続ける: the player sees something left to play. The strongest advice
   * comes back once it has been played and the board reads settled again,
   * a full window of new readings after this call. */
  hold() {
    this.held = true;
    this.fresh = 0;
  }
  /** Picks the advice up again for a restored game: the last positions'
   * kept estimates (ownershipOf(state) or null), oldest first, so a pass
   * right after a reload is weighed like one during play. */
  restore(states, ownershipOf) {
    this.reset();
    for (const state of states.slice(-(ENDGAME_SWING.window + 2))) {
      const ownership = ownershipOf(state);
      if (ownership) this.observe(state, ownership);
    }
    return this.stage;
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
    const values = shownOwnership(state.board, ownership);
    // The raw estimate, stones included, so 日本式 (no colour on live stones) reads the same.
    this.settledShare = ownership.filter(v => Math.abs(v) >= OWNERSHIP_BANDS.SETTLED).length / ownership.length;
    this.mostlySettled = this.settledShare >= ENDGAME_SETTLED_SHARE;
    this.opened ||= this.settledShare >= OPENING_SETTLED_SHARE;
    const same = this.recent.findLast(r => r.next === state.next && state.moveNumber - r.move <= 4);
    if (same) {
      const swing = values.reduce((s,v,i)=>s+Math.abs(v-same.values[i]),0)/2/(state.moveNumber-same.move);
      this.swings = [...this.swings, swing].slice(-ENDGAME_SWING.window);
    }
    // A group in atari is an open fight, unless the estimate shows every stone
    // of it in the opponent's settled colour: then it is a dead group waiting
    // to be removed at scoring, not a reason to keep playing.
    let fight=false;
    for(const g of groups(state.board)){
      if(g.liberties.size>1)continue;
      if(![...g.stones].every(j=>state.board[j]*values[j]<=-OWNERSHIP_BANDS.SETTLED))fight=true;
    }
    const full = this.swings.length >= ENDGAME_SWING.window;
    const swing = full ? Math.max(...this.swings) : Infinity;
    this.stage = swing <= ENDGAME_SWING.ready && !fight ? "ready"
      : swing <= ENDGAME_SWING.near ? "near" : "playing";
    if (this.held) {
      const last = same ? this.swings.at(-1) : Infinity;
      this.fresh = last <= ENDGAME_SWING.ready && !fight ? this.fresh + 1 : 0;
      if (this.fresh >= ENDGAME_SWING.window) this.held = false;
    }
    this.previous={move:state.moveNumber,ownership:[...ownership]};
    this.recent=[...this.recent,{move:state.moveNumber,next:state.next,values}].slice(-3);
    return this.stage;
  }
}
