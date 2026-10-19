import { BLACK, play, sizeOf } from "./core.mjs";
import { formatBoardForAi, formatBoardSection } from "./board-text.mjs";
import { shareableReviewUrl } from "./sgf-link.mjs";

export const ILLEGAL_SUICIDE = "suicide";
export const ILLEGAL_KO = "ko";
const reasons = {
  [ILLEGAL_SUICIDE]: "自殺手は禁止です",
  [ILLEGAL_KO]: "コウで直前の局面に戻せません"
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
    throw Error("説明する禁止手がありません");
  const color=game.next===BLACK?"黒":"白";
  const url=shareableReviewUrl(reviewUrl);
  let before="";
  if(forbidden.reason===ILLEGAL_KO && game.history?.length>=2) {
    const hash=game.history.at(-2);
    if(typeof hash==="string" && hash.length===game.board.length && /^[012]+$/.test(hash)) {
      const previous=[...hash].map(n=>Number(n)-1);
      before="\n\n直前の着手前の盤面：\n"+formatBoardForAi(previous);
    }
  }
  return [
    "MieGO・"+sizeOf(game.board)+"路盤の着手確認",
    "手番："+color+"、選択した空点は図中の◇です。",
    "禁止理由："+reasons[forbidden.reason],
    "なぜこの手が打てないのか、盤面と囲碁のルールに沿って説明してください。",
    "棋譜URL: "+url.href,
    "",
    formatBoardSection("現在の盤面",game.board,{selectedPosition:forbidden.position})+before
  ].join("\n");
}
