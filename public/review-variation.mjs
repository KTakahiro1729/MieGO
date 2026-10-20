import { play } from "./core.mjs";
import { forkReview, replaySteps } from "./sgf.mjs";
import { TEXT } from "./texts.mjs";

// Variation is transient analysis data, never an edit to a live or saved game.
// A variation stores the original shared prefix plus its own moves; the
// caller keeps the untouched source separately to navigate between lines.
export function activeReviewSnapshot(review,liveGame) {
  return review.activeLine==="variation" && review.variation
    ? review.variation.snapshot
    : review.source==="live" ? liveGame : review.snapshot;
}

export function proposeReviewStone(review,liveGame,position) {
  const line=activeReviewSnapshot(review,liveGame);
  if(!Number.isInteger(review.step) || review.step<0 || review.step>line.moves.length)
    throw Error(TEXT.rules.badMoveCount);
  // Applying Go rules to a fork preserves ko and captured-stone histories.
  const base=forkReview(line,review.step);
  return play(base,position);
}

export function commitReviewStone(review,liveGame,position) {
  const line=activeReviewSnapshot(review,liveGame);
  const proposed=proposeReviewStone(review,liveGame,position);
  const following=line.moves[review.step];
  // Playing the same next move follows the existing line, not a new branch.
  if(following?.position===position && following.color===proposed.moves.at(-1).color) {
    return {variation:review.variation,activeLine:review.activeLine,
      step:review.step+1,display:replaySteps(line,review.step+1),created:false};
  }
  const variation={baseStep:review.activeLine==="variation"?review.variation?.baseStep??review.step:review.step,
    snapshot:proposed};
  return {variation,activeLine:"variation",step:proposed.moves.length,
    display:proposed,created:true};
}

export function variationForSharing(review,liveGame) {
  const snapshot=activeReviewSnapshot(review,liveGame);
  return {snapshot,metadata:review.activeLine==="variation"?null:review.metadata,
    step:Math.min(review.step,snapshot.moves.filter(m=>m.position!=="resign").length)};
}
