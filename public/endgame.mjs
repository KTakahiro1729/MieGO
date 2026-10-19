import { group, SIZE } from "./core.mjs";

/** Non-authoritative endgame advice for 9x9 Chinese rules.
 * Evaluations must be from committed positions (never sandbox/preview moves).
 * Stable ownership is only a necessary hint, not a life-and-death proof.
 */
export class EndgameAdvisor {
  constructor() { this.reset(); }
  reset() {
    this.previous = null;
    this.streak = 0;
    this.stage = "playing";
  }
  observe(state, ownership) {
    if (state.status !== "playing") { this.reset(); return this.stage; }
    if (!Array.isArray(ownership) || ownership.length !== SIZE*SIZE ||
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
    let dangerous=false;
    const visited=new Set();
    for(let i=0;i<state.board.length;i++){
      if(!state.board[i] || visited.has(i))continue;
      const g=group(state.board,i);
      for(const j of g.stones)visited.add(j);
      if(g.liberties.size<=1){dangerous=true;break;}
    }
    const settled = free.length
      ? free.filter(i=>Math.abs(ownership[i])>=.72).length/free.length : 1;
    let change = Infinity;
    if(this.previous) {
      change = free.length
        ? free.reduce((s,i)=>s+Math.abs(ownership[i]-this.previous.ownership[i]),0)/free.length
        : 0;
    }
    const stable = state.moveNumber>=45 && occupied>=24 &&
      free.length>0 && settled>=.8 && change<=.09 && !dangerous;
    this.streak = stable ? this.streak+1 : 0;
    this.stage = this.streak>=2 ? "ready"
      : state.moveNumber>=30 && settled>=.65 && !dangerous ? "near" : "playing";
    this.previous={move:state.moveNumber,ownership:[...ownership]};
    return this.stage;
  }
}
