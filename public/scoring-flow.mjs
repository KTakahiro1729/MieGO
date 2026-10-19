/** A score must never be accepted before NN review finishes or is explicitly
 * unavailable. Guest clients wait for the host to distribute its result.
 */
export const REVIEW_DONE = new Set(["complete","none","modified","unavailable"]);
export function canApproveScoring(game, review, room, connected) {
  return game.status === "scoring" && (!room || connected) && REVIEW_DONE.has(review);
}
export function deadSignature(dead=[]) {
  return [...dead].sort((a,b)=>a-b).join(",");
}
export function canApplyAutomatedReview(game, reviewTouched, action) {
  return game.status === "scoring" &&
    !reviewTouched &&
    !game.agreed?.black && !game.agreed?.white &&
    action.number === game.moveNumber &&
    action.before === game.board.map(n=>n+1).join("") &&
    action.deadBefore === deadSignature(game.dead);
}
