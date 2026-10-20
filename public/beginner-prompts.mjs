import {
  BLACK,
  handicapOf,
  hasGomokuForbidden,
  isFree,
  isGomoku,
  isJapanese,
  komiOf,
  sizeOf,
} from "./core.mjs";
import { formatBoardSection } from "./board-text.mjs";
import { shareableReviewUrl } from "./sgf-link.mjs";
import { TEXT } from "./texts.mjs";

// Questions a beginner can paste into any AI chat. Like the forbidden-move
// question they carry a public SGF replay URL at most, never a P2P room URL.
const AFTERWARDS=TEXT.prompts.afterwards;

// 自由に置く has no rules of its own, so its questions are about 囲碁 on that board.
const asBeginner=game=>isGomoku(game)?TEXT.prompts.asBeginnerGomoku:TEXT.prompts.asBeginner;

function playingLine(game) {
  const size=sizeOf(game.board);
  if(isGomoku(game))return TEXT.prompts.playingGomoku(size,hasGomokuForbidden(game));
  if(isFree(game))return TEXT.prompts.playingFree(size);
  return TEXT.prompts.playing(size,TEXT.prompts.ruleLine(komiOf(game),handicapOf(game),isJapanese(game)));
}

export function makeRulesPrompt(game) {
  const gomoku=isGomoku(game);
  return [
    asBeginner(game),
    playingLine(game),
    gomoku?TEXT.prompts.rulesAskGomoku:TEXT.prompts.rulesAsk,
    ...(gomoku?TEXT.prompts.rulesTopicsGomoku(hasGomokuForbidden(game)):TEXT.prompts.rulesTopics),
    AFTERWARDS
  ].join("\n");
}

/** reviewUrl is optional; a long game may not fit in a URL. */
export function makePositionPrompt(game,reviewUrl=null) {
  const url=reviewUrl===null?null:shareableReviewUrl(reviewUrl);
  const color=game.next===BLACK?TEXT.common.black:TEXT.common.white;
  // A free board has no turn: the players pick the colour of each stone.
  const free=isFree(game);
  const state=free?TEXT.prompts.stateFree(game.board.filter(Boolean).length):
    game.status==="playing"?TEXT.prompts.turn(color,game.moveNumber):
    game.status==="scoring"?TEXT.prompts.stateScoring:TEXT.prompts.stateFinished;
  const ask=free?TEXT.prompts.positionAskFree:
    game.status==="playing"?TEXT.prompts.positionAskPlaying(color):
    isGomoku(game)?TEXT.prompts.positionAskEndedGomoku:TEXT.prompts.positionAskEnded;
  return [
    asBeginner(game),
    playingLine(game),
    state,
    ask,
    TEXT.prompts.coordinates,
    AFTERWARDS,
    ...(url?[TEXT.prompts.reviewUrl(url.href)]:[]),
    "",
    formatBoardSection(TEXT.prompts.currentBoard,game.board)
  ].join("\n");
}
