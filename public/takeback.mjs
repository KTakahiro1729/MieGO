import { BLACK, WHITE, resume } from "./core.mjs";
import { replaySteps } from "./sgf.mjs";

/** 待った for every mode. The position is rebuilt by replaying the remaining
 * moves, so captures, ko history and pass counts stay consistent with the rules.
 *
 * scope "ply": the latest move only (one shared board, either side may undo).
 * scope "own": `color`'s latest move plus any reply after it (AI and friend games).
 * Returns how many moves remain afterwards, or -1 when nothing can be taken back.
 */
export function takebackCut(state, {color=null, scope="own"}={}) {
  if(state?.status!=="playing" || !Array.isArray(state.moves))return -1;
  if(scope==="ply")return state.moves.length-1;
  for(let i=state.moves.length-1;i>=0;i--)
    if(state.moves[i].color===color)return i;
  return -1;
}
export function takeBackTo(state, keep) {
  if(state?.status!=="playing" || !Number.isInteger(keep) || keep<0 || keep>=state.moves.length)
    throw new Error("Nothing to take back");
  let game=replaySteps(state,keep);
  // Two passes followed by 対局を再開 must come back as a playable position.
  if(game.status==="scoring")game=resume(game);
  // The counter lets reconnecting peers tell a rewound line from a stale one.
  return {...game,takebacks:(state.takebacks||0)+1};
}
export function takeBack(state, options) {
  const keep=takebackCut(state,options);
  if(keep<0)return null;
  const game=takeBackTo(state,keep);
  const last=game.moves.at(-1)?.position;
  return {game,lastPosition:Number.isInteger(last)?last:null};
}

/** Friend games: a takeback is a request the other side must accept, like an end offer. */
export function requestTakeback(state, color) {
  if(state.status!=="playing" || ![BLACK, WHITE].includes(color))
    throw new Error("No takeback outside play");
  if(takebackCut(state,{color})<0)throw new Error("Nothing to take back");
  const current=state.takebackRequest;
  // Simultaneous requests converge on both peers: Black's request is kept.
  if(current && (current.from===color || color===WHITE))return state;
  // Asking to replay a move implies the game continues, so it replaces an end offer.
  return {...state,endProposal:null,takebackRequest:{from:color,atMove:state.moveNumber}};
}
export function answerTakeback(state, color, accept) {
  const request=state.takebackRequest;
  if(state.status!=="playing" || !request || ![BLACK, WHITE].includes(color))
    throw new Error("No takeback request to answer");
  if(color===request.from && accept)throw new Error("Cannot accept own takeback request");
  const {takebackRequest, ...rest}=state;
  if(!accept)return rest; // declined, or withdrawn by the requester
  return takeBackTo(rest,takebackCut(rest,{color:request.from}));
}
