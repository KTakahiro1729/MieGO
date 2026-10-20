import {
  BLACK,
  boardFromHash,
  isGomoku,
  play,
  sizeOf,
} from "./core.mjs";
import { formatBoardForAi, formatBoardSection } from "./board-text.mjs";
import { shareableReviewUrl } from "./sgf-link.mjs";
import { TEXT } from "./texts.mjs";

export const ILLEGAL_SUICIDE = "suicide";
export const ILLEGAL_KO = "ko";
// 五目並べ's forbidden moves (gomoku.mjs) use their own names as reasons.
const reasons = {
  [ILLEGAL_SUICIDE]: TEXT.rules.suicide,
  [ILLEGAL_KO]: TEXT.rules.ko,
  ...TEXT.rules.gomoku
};
/** What to tell the player about a forbidden point. */
export const forbiddenMessage = reason => reasons[reason] ?? TEXT.rules.suicide;
/** The same in two lines, what to do and then why, for the status beside the board. */
export const forbiddenLines = reason => forbiddenMessage(reason).replace(/。(?=.)/, "。\n");

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
  const color=game.next===BLACK?TEXT.common.black:TEXT.common.white;
  const url=shareableReviewUrl(reviewUrl);
  let before="";
  if(forbidden.reason===ILLEGAL_KO && game.history?.length>=2) {
    const previous=boardFromHash(game.history.at(-2),game.board.length);
    if(previous)before=TEXT.prompts.illegalBefore+formatBoardForAi(previous);
  }
  return [
    TEXT.prompts.illegalTitle(sizeOf(game.board)),
    TEXT.prompts.illegalTurn(color),
    TEXT.prompts.illegalReason(TEXT.prompts.illegalReasons[forbidden.reason]),
    isGomoku(game)?TEXT.prompts.illegalAskGomoku:TEXT.prompts.illegalAsk,
    TEXT.prompts.reviewUrl(url.href),
    "",
    formatBoardSection(TEXT.prompts.currentBoard,game.board,{selectedPosition:forbidden.position})+before
  ].join("\n");
}
