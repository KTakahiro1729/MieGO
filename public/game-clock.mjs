// 持ち時間 (time control): each player's main time, then 秒読み. Once the
// main time is used up, every move must be played within the 秒読み seconds,
// which start again on each move (one period, as in most amateur games).
// With no 秒読み the main time running out loses at once (切れ負け); with no
// main time every move has the 秒読み seconds from the start.
//
// The game keeps {main, byoyomi} (seconds) as state.timeControl and each
// side's main time left (ms) as state.clock. createGameClock() runs the side
// to move, and other code (the turn line, later ドパガキモード's 秒読み effects)
// follows it through subscribe() and onTimeout() rather than reading its insides.

/** Seconds offered in the 新規対戦 sheet; 0 is none. */
export const MAIN_TIME_CHOICES = [0, 60, 300, 600, 1200, 1800];
export const BYOYOMI_CHOICES = [0, 10, 30, 60];

const seconds = (value, choices) => choices.includes(Number(value)) ? Number(value) : 0;
/** A game's time control, or null for no clock. */
export function timeControlOf(value) {
  const main=seconds(value?.main,MAIN_TIME_CHOICES),byoyomi=seconds(value?.byoyomi,BYOYOMI_CHOICES);
  return main || byoyomi ? {main,byoyomi} : null;
}
const sideKey = side => side===-1 ? "white" : "black";
/** Each side's main time left (ms), as stored in the game; a full clock when missing. */
export function clockOf(state) {
  const control=timeControlOf(state?.timeControl);
  if(!control)return null;
  const full=control.main*1000,stored=state.clock||{};
  const left=value=>Number.isFinite(value) ? Math.max(0,Math.min(full,value)) : full;
  return {black:left(stored.black),white:left(stored.white)};
}

/**
 * What `side`'s clock shows `elapsed` ms into its turn:
 * main (ms of main time left), byoyomi (ms of the 秒読み left, or null before it),
 * left (ms until the time runs out) and out (the time has run out).
 */
export function readClock(state, side, elapsed=0) {
  const control=timeControlOf(state?.timeControl),clock=clockOf(state);
  if(!control)return null;
  const mainLeft=clock[sideKey(side)]-elapsed;
  if(mainLeft>0)return {side,main:mainLeft,byoyomi:null,left:mainLeft+control.byoyomi*1000,out:false};
  const byoyomi=control.byoyomi*1000+mainLeft;
  return {side,main:0,byoyomi:control.byoyomi?Math.max(0,byoyomi):null,left:Math.max(0,byoyomi),out:byoyomi<=0};
}
/** The clock after `side` took `spent` ms over a move, or null when that ran out its time. */
export function spendTime(state, side, spent) {
  const reading=readClock(state,side,spent);
  if(!reading || reading.out)return null;
  return {...clockOf(state),[sideKey(side)]:reading.main};
}

/** Main time as "9:58", counting down by whole seconds. */
export function clockText(ms) {
  const total=clockSeconds(ms);
  return Math.floor(total/60)+":"+String(total%60).padStart(2,"0");
}
/** Whole seconds left, as a 秒読み is called out. */
export const clockSeconds = ms => Math.ceil(Math.max(0,ms)/1000);

/**
 * Runs the clock of the side to move. run() starts it for a position, stop()
 * halts it and returns the ms that side has used. Listeners hear every
 * whole second (and each start and stop) with readClock()'s reading, or
 * null when no clock runs; onTimeout() listeners hear the side whose time ran out.
 */
export function createGameClock({now=()=>performance.now(), schedule=setTimeout, cancel=clearTimeout}={}) {
  let running=null,timer=null;
  const tickers=new Set(),timeouts=new Set();
  const elapsed=()=>running ? now()-running.startedAt : 0;
  const reading=()=>running ? readClock(running.state,running.side,elapsed()) : null;
  function notify() {
    const current=reading();
    for(const listener of tickers)listener(current);
    return current;
  }
  function tick() {
    timer=null;
    const current=notify();
    if(!current)return;
    if(current.out){
      const {side}=running;
      running=null;notify();
      for(const listener of timeouts)listener(side);
      return;
    }
    // Wake when the shown second changes, or right when the time runs out.
    const shown=current.byoyomi ?? current.main;
    timer=schedule(tick,Math.min(current.left,(shown-1)%1000+1));
  }
  function halt() {
    if(timer!==null)cancel(timer);
    timer=null;
  }
  return {
    /** Starts `side`'s clock for this position of `state` (which holds timeControl and clock). */
    run(state, side) {
      halt();
      running=timeControlOf(state?.timeControl) ? {state,side,startedAt:now()} : null;
      if(running)tick();else notify();
    },
    stop() {
      const spent=elapsed();
      halt();
      const was=running;
      running=null;
      if(was)notify();
      return spent;
    },
    reading,
    get running() { return running ? {state:running.state,side:running.side} : null; },
    subscribe(listener) { tickers.add(listener); return () => tickers.delete(listener); },
    onTimeout(listener) { timeouts.add(listener); return () => timeouts.delete(listener); },
  };
}
