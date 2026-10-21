import { initialGame, replayMove, resume } from "./core.mjs";

// Background ownership for a replayed game: the positions nearest the one on
// screen are estimated first, while the KataGo worker has nothing else to do.

/** Every position of a line, replayed once (step 0 is the starting board). */
export function replayLine(snapshot) {
  let state=initialGame(snapshot);
  const states=[state];
  for(const move of snapshot.moves){
    if(state.status==="scoring")state=resume(state,-move.color);
    if(state.status!=="playing")break;
    state=replayMove(state,move);
    states.push(state);
  }
  return states;
}

/** Steps 0..last by distance from the step on screen; on ties the later step,
 * the usual direction of replay, comes first. */
export function prefetchOrder(last, current) {
  const from=Math.max(0,Math.min(last,Math.trunc(Number(current)||0)));
  const order=[from];
  for(let d=1;from+d<=last||from-d>=0;d++){
    if(from+d<=last)order.push(from+d);
    if(from-d>=0)order.push(from-d);
  }
  return order;
}
