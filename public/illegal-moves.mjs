import { BLACK, play, sizeOf } from "./core.mjs";
import { formatBoardForAi, formatBoardSection } from "./board-text.mjs";
import { shareableReviewUrl } from "./sgf-link.mjs";
import { TEXT } from "./texts.mjs";

export const ILLEGAL_SUICIDE = "suicide";
export const ILLEGAL_KO = "ko";
const reasons = {
  [ILLEGAL_SUICIDE]: TEXT.rules.suicide,
  [ILLEGAL_KO]: TEXT.rules.ko
};

export function forbiddenMoveReason(error) {
  if(!(error instanceof Error))return null;
  return Object.entries(reasons).find(([,message])=>error.message===message)?.[0]||null;
}

/** The rules engine remains the only authority for whether a move is legal.
 * A forbidden preview is separate from committed game state. */
export function inspectProvisionalMove(game,position) {
  if(game.status!=="playing" || !Number.isInteger(position) ||
     position<0 || position>=game.board.length || game.board[position]!==0)
    return {candidate:null,forbidden:null};
  try {return {candidate:play(game,position),forbidden:null};}
  catch(error) {
    const reason=forbiddenMoveReason(error);
    if(!reason)throw error;
    return {candidate:null,forbidden:{position,reason,source:game}};
  }
}

/** Kept as a rules-only helper; never used to draw marks on the board. */
export function illegalMoveReasons(state) {
  const result=new Map();
  if(state.status!=="playing")return result;
  for(let i=0;i<state.board.length;i++) {
    if(state.board[i])continue;
    const {forbidden}=inspectProvisionalMove(state,i);
    if(forbidden)result.set(i,forbidden.reason);
  }
  return result;
}

/** A self-contained Japanese question for a user to paste into an AI chat.
 * Includes a public SGF replay URL and a highlighted glyph board, but never
 * a private P2P invitation URL or an on-board coordinate label. */
export function makeIllegalMovePrompt(game,forbidden,reviewUrl) {
  if(!forbidden || !Object.hasOwn(reasons,forbidden.reason) ||
     game.board?.[forbidden.position]!==0 || game.status!=="playing")
    throw Error(TEXT.prompts.illegalNothing);
  const color=game.next===BLACK?TEXT.common.black:TEXT.common.white;
  const url=shareableReviewUrl(reviewUrl);
  let before="";
  if(forbidden.reason===ILLEGAL_KO && game.history?.length>=2) {
    const hash=game.history.at(-2);
    if(typeof hash==="string" && hash.length===game.board.length && /^[012]+$/.test(hash)) {
      const previous=[...hash].map(n=>Number(n)-1);
      before=TEXT.prompts.illegalBefore+formatBoardForAi(previous);
    }
  }
  return [
    TEXT.prompts.illegalTitle(sizeOf(game.board)),
    TEXT.prompts.illegalTurn(color),
    TEXT.prompts.illegalReason(reasons[forbidden.reason]),
    TEXT.prompts.illegalAsk,
    TEXT.prompts.reviewUrl(url.href),
    "",
    formatBoardSection(TEXT.prompts.currentBoard,game.board,{selectedPosition:forbidden.position})+before
  ].join("\n");
}
