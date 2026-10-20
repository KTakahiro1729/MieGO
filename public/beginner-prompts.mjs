import { BLACK, sizeOf, handicapOf, komiOf } from "./core.mjs";
import { formatBoardSection } from "./board-text.mjs";
import { shareableReviewUrl } from "./sgf-link.mjs";
import { TEXT } from "./texts.mjs";

// Questions a beginner can paste into any AI chat. Like the forbidden-move
// question they carry a public SGF replay URL at most, never a P2P room URL.
const AS_BEGINNER=TEXT.prompts.asBeginner;
const AFTERWARDS=TEXT.prompts.afterwards;

function ruleLine(game) {
  const handicap=handicapOf(game);
  return TEXT.prompts.ruleLine(komiOf(game),handicap);
}

export function makeRulesPrompt(game) {
  return [
    AS_BEGINNER,
    TEXT.prompts.playing(sizeOf(game.board),ruleLine(game)),
    TEXT.prompts.rulesAsk,
    ...TEXT.prompts.rulesTopics,
    AFTERWARDS
  ].join("\n");
}

/** reviewUrl is optional; a long game may not fit in a URL. */
export function makePositionPrompt(game,reviewUrl=null) {
  const url=reviewUrl===null?null:shareableReviewUrl(reviewUrl);
  const color=game.next===BLACK?TEXT.common.black:TEXT.common.white;
  const state=game.status==="playing"?TEXT.prompts.turn(color,game.moveNumber):
    game.status==="scoring"?TEXT.prompts.stateScoring:TEXT.prompts.stateFinished;
  const ask=game.status==="playing"?
    TEXT.prompts.positionAskPlaying(color):
    TEXT.prompts.positionAskEnded;
  return [
    AS_BEGINNER,
    TEXT.prompts.playing(sizeOf(game.board),ruleLine(game)),
    state,
    ask,
    TEXT.prompts.coordinates,
    AFTERWARDS,
    ...(url?[TEXT.prompts.reviewUrl(url.href)]:[]),
    "",
    formatBoardSection(TEXT.prompts.currentBoard,game.board)
  ].join("\n");
}
