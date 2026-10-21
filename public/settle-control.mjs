// 決着手順: KataGo's playout that settles the dead stones, played out of
// sight, and the last playout kept for 再生.
import { boardHash, sizeOf } from "./core.mjs";
import { suggestDeadStones } from "./dead-stones.mjs";
import {
  deadFromPlayout,
  pickSettleMove,
  replayPlayout,
  settleMax,
  settleStart,
  settleStep,
  settleStepMs,
} from "./settle-playout.mjs";

const SETTLE_HOLD_MS=1100;
const reducedMotion=()=>globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Runs one playout at a time for the scoring position. The parent owns the
 * dead-stone job: `jobCurrent(id)` tells whether a playout still belongs to it,
 * `onUnavailable()` hears that KataGo could not settle the board, and
 * `onSettled(run)` receives a finished playout ({dead, positions, taps, ...}).
 * The board keeps the real position and one estimate while it runs, so the
 * territory colours stay as they were: `knownOwnership(board)` is an estimate
 * already kept for the board, else KataGo's first answer is shown.
 */
export function createSettleControl({getGame, isReviewing, post, show, draw, jobCurrent, onUnavailable, onSettled,
  knownOwnership=()=>null}) {
  // The playout KataGo is playing (settle), the kept one (settlePlayout) and its 再生 (settleShow).
  let settle=null, settlePlayout=null, settleShow=null;
  const stepMs=()=>settleStepMs(sizeOf(getGame().board));
  function start(id) {
    const game=getGame();
    stopReplay();
    const known=knownOwnership(game.board);
    // Only shown: the dead stones come from KataGo's own answers.
    const shown=known?.length===game.board.length && known.every(Number.isFinite) ? known : null;
    settle={id,state:settleStart(game),positions:[],ownership:null,initialOwnership:null,shown,
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
      if(!settle.shown){settle.shown=result.ownership;show();}
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
    // A playout stopped at its move limit is not a finished game.
    run.cut=run.state.status==="playing";
    run.dead=positions;
    settle=null;
    onSettled(run);
  }
  /** Keeps a playout of the scoring position for 再生 and the count. */
  function keep({positions, board, initialOwnership=settlePlayout?.initialOwnership}) {
    const game=getGame();
    settlePlayout={number:game.moveNumber,hash:boardHash(game.board),positions,board,initialOwnership};
  }
  /** スキップ: a 再生 stops. */
  function skip() {
    if(settleShow){stopReplay();show();}
  }
  /**
   * A tap on a stone during the playout corrects that stone once the playout
   * is over, on top of its result (UX方針 4: 死石解析中).
   * True when the playout took the tap; a 再生 just stops.
   */
  function tap(position) {
    if(settleShow){stopReplay();return false;}
    if(!settle)return false;
    settle.taps=[...(settle.taps||[]),position];return true;
  }
  /** 再生: the kept playout again, without asking KataGo. */
  function replay() {
    const game=getGame();
    if(!current() || settle)return;
    const frames=replayPlayout(game,settlePlayout.positions);
    if(!frames)return;
    stopReplay();
    const run={frames,index:0,timer:null};settleShow=run;
    const tick=()=>{
      if(settleShow!==run)return;
      if(run.index>=frames.length-1 || getGame().status!=="scoring"){
        run.finished=true;show();
        run.timer=setTimeout(()=>{if(settleShow===run){settleShow=null;show();}},SETTLE_HOLD_MS);
        return;
      }
      run.index++;show();
      run.timer=setTimeout(tick,reducedMotion()?0:stepMs());
    };
    show();run.timer=setTimeout(tick,stepMs());
  }
  function stopReplay() {
    if(settleShow?.timer)clearTimeout(settleShow.timer);
    settleShow=null;
  }
  /** The kept playout, while it still belongs to the scoring position. */
  const current=()=>{
    const game=getGame();
    return settlePlayout && game.status==="scoring" &&
      settlePlayout.number===game.moveNumber && settlePlayout.hash===boardHash(game.board) &&
      settlePlayout.positions.length ? settlePlayout : null;
  };
  /** A playout or its 再生 is on the board. */
  const busy=()=>!!(settle || settleShow);
  /**
   * What the board shows during a playout: the real stones under one estimate
   * (`live`: the playout itself stays off the board), or a 再生's position over them.
   */
  function view() {
    const game=getGame();
    if(isReviewing() || game.status!=="scoring")return null;
    if(settle)return {board:game.board,base:game.board,last:null,live:true,
      moves:settle.positions.length,ownership:settle.shown,finished:false};
    if(settleShow && current()){
      const frame=settleShow.frames[settleShow.index];
      return {board:frame.board,base:game.board,last:frame.moves.at(-1)?.position??null,
        moves:settleShow.index,ownership:null,finished:!!settleShow.finished};
    }
    return null;
  }
  return {busy,current,keep,receive,replay,skip,start,tap,view};
}
