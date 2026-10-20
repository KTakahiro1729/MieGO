import { isFree } from "./core.mjs";
import { exportSGF, parseSGF, replaySteps } from "./sgf.mjs";
import { formatBoardSection } from "./board-text.mjs";
import { TEXT } from "./texts.mjs";
import { UserError } from "./user-error.mjs";

// A human- and AI-readable SGF (9x9, 13x13 or 19x19) is carried in the URL query string.
// Keep the uncompressed SGF, rather than inventing a proprietary binary code.
export const MAX_SHARE_URL_LENGTH = 8192;

export function makeReviewUrl(origin, record, step) {
  const source=record?.snapshot||record;
  // A free board is shared as the position at that step, which opens on its last stone.
  if(isFree(source)){
    if(!Number.isSafeInteger(step) || step<0 || step>source.moves.length)
      throw Error("Step outside the record");
    record={snapshot:replaySteps(source,step)};
  }
  const sgf=exportSGF(record);
  const {snapshot}=parseSGF(sgf);
  const total=snapshot.moves.length;
  if(isFree(source))step=total;
  if(!Number.isSafeInteger(step) || step<0 || step>total)
    throw Error("Step outside the record");
  const url=new URL("/",origin);
  url.searchParams.set("sgf",sgf);
  url.searchParams.set("move",String(step));
  if(url.href.length>MAX_SHARE_URL_LENGTH)
    throw new UserError(TEXT.link.tooLong);
  return url.href;
}

export function readReviewUrl(input) {
  const url=new URL(input);
  // A live invitation must never be mistaken for a static SGF replay.
  if(url.searchParams.has("room"))return {kind:"room"};
  if(!url.searchParams.has("sgf"))return {kind:"none"};
  const source=url.searchParams.get("sgf");
  // A cut-off or edited link is one problem to the person opening it.
  if(url.href.length>MAX_SHARE_URL_LENGTH || !source ||
     url.searchParams.getAll("sgf").length!==1 || url.searchParams.getAll("move").length>1)
    throw Error("Broken review link");
  const parsed=parseSGF(source);
  const stepValue=url.searchParams.get("move");
  const step=stepValue===null?parsed.snapshot.moves.length:
    /^(0|[1-9][0-9]*)$/.test(stepValue)?Number(stepValue):NaN;
  if(!Number.isSafeInteger(step) || step<0 || step>parsed.snapshot.moves.length)
    throw Error("Broken review link");
  return {kind:"review",snapshot:parsed.snapshot,step,sgf:source,metadata:parsed.metadata};
}

/** The only URL any text meant for an AI chat may carry: a public SGF replay,
 * never a live P2P invitation whose query holds the room's credentials. */
export function shareableReviewUrl(input) {
  const url=new URL(input);
  if(!["https:","http:"].includes(url.protocol) || url.searchParams.has("room") ||
     !url.searchParams.get("sgf") || !url.searchParams.has("move"))
    throw Error("Not a public replay URL");
  return url;
}

export function makeAiHandoff(reviewUrl) {
  const url=shareableReviewUrl(reviewUrl);
  const guide=new URL("/ai.md",url.origin);
  const review=readReviewUrl(url.href);
  const shown=replaySteps(review.snapshot,review.step);
  return [
    TEXT.prompts.handoffIntro,
    "",
    TEXT.prompts.reviewUrl(url.href),
    "",
    formatBoardSection(TEXT.prompts.handoffBoard(review.step),shown.board),
    "",
    ...TEXT.prompts.handoffSpec,
    "",
    TEXT.prompts.handoffGuide(guide.href)
  ].join("\n");
}
