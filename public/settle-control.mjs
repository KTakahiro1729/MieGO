// 決着手順: KataGo's playout that settles the dead stones, played out of sight.
import { sizeOf } from "./core.mjs";
import { suggestDeadStones } from "./dead-stones.mjs";
import {
  deadFromPlayout,
  pickSettleMove,
  settleMax,
  settleStart,
  settleStep,
} from "./settle-playout.mjs";

/**
 * Runs one playout at a time for the scoring position. The parent owns the
 * dead-stone job: `jobCurrent(id)` tells whether a playout still belongs to it,
 * `onUnavailable()` hears that KataGo could not settle the board, and
 * `onSettled(run)` receives a finished playout ({dead, positions, taps, ...}).
 * The board meanwhile shows the count with the stones an estimate already calls
 * dead (`knownOwnership(board)`, kept for the board, else KataGo's first
 * answer), so once the result is in only the stones and dame it adds change.
 */
export function createSettleControl({getGame, isReviewing, post, show, draw, jobCurrent, onUnavailable, onSettled,
  knownOwnership=()=>null}) {
  let settle=null;
  /** The stones an estimate calls dead, sorted; null if it does not fit the board. */
  function deadBy(ownership) {
    try { return [...suggestDeadStones(getGame(),ownership)].sort((a,b)=>a-b); } catch { return null; }
  }
  function start(id) {
    const game=getGame();
    settle={id,state:settleStart(game),positions:[],ownership:null,initialOwnership:null,
      shownDead:deadBy(knownOwnership(game.board)),
      limit:settleMax(sizeOf(game.board))};
    post({id,kind:"settle",state:settle.state});
  }
  function cancel() {
    settle=null;
  }
  /** One KataGo answer during the playout: play its best move, or finish. */
  function receive(result) {
    const game=getGame();
    if(!settle || settle.id!==result.id || !jobCurrent(result.id)) {
      cancel();draw();return;
    }
    if(result.error || result.engine!=="katago" || !Array.isArray(result.ownership) ||
       result.ownership.length!==game.board.length || !result.ownership.every(Number.isFinite)) {
      cancel();onUnavailable();return;
    }
    settle.ownership=result.ownership;
    if(!settle.initialOwnership){
      settle.initialOwnership=result.ownership;
      if(!settle.shownDead){settle.shownDead=deadBy(result.ownership);show();}
    }
    if(settle.state.status!=="playing" || settle.positions.length>=settle.limit)return finish();
    const position=pickSettleMove(settle.state,result.policy,settle.initialOwnership);
    settle.state=settleStep(settle.state,position);
    settle.positions.push(position);
    show();
    post({id:settle.id,kind:"settle",state:settle.state});
  }
  /** The playout is over: mark the dead stones. */
  function finish() {
    const game=getGame(), run=settle;
    let positions;
    try {
      // Groups the playout captured, plus the conservative estimate on the real board.
      const marked=new Set([...deadFromPlayout(game,run.state.board,run.ownership),
        ...suggestDeadStones(game,run.initialOwnership)]);
      positions=[...marked].sort((a,b)=>a-b);
    }catch(error) {
      console.error("KataGo dead-stone candidates",error);
      cancel();onUnavailable();return;
    }
    run.dead=positions;
    settle=null;
    onSettled(run);
  }
  /**
   * A tap on a stone during the playout corrects that stone once the playout
   * is over, on top of its result (UX方針 4: 死石解析中).
   * True when the playout took the tap.
   */
  function tap(position) {
    if(!settle)return false;
    settle.taps=[...(settle.taps||[]),position];return true;
  }
  /** A playout is running. */
  const busy=()=>!!settle;
  /** The playout in progress: its moves for the text, and the dead stones the board shows meanwhile. */
  function view() {
    const game=getGame();
    if(!settle || isReviewing() || game.status!=="scoring")return null;
    return {moves:settle.positions.length,dead:settle.shownDead||[]};
  }
  return {busy,receive,start,tap,view};
}
