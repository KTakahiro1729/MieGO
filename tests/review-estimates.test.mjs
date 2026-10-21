import test from "node:test";
import assert from "node:assert/strict";
import { newGame, play } from "../public/core.mjs";
import { createReviewPrefetch } from "../public/review-estimates.mjs";

function setup() {
  let line = newGame(true, {size:9});
  for (const position of [20, 30, 40]) line = play(line, position);
  const posted = [], kept = [];
  let id = 0;
  const prefetch = createReviewPrefetch({post:m => posted.push(m), nextId:() => ++id, canAsk:() => true,
    recall:() => null, owner:() => ({gameId:"g"}), onKept:(owner, board) => kept.push([owner.gameId, board])});
  return {line, prefetch, posted, kept};
}

test("a replayed line is estimated one position at a time, and a valid answer is kept", () => {
  const {line, prefetch, posted, kept} = setup();
  prefetch.plan(line, 3);
  assert.equal(posted.length, 1);
  assert.equal(prefetch.receive({id:posted[0].id}, () => true), true);
  assert.deepEqual(kept, [["g", posted[0].board]]);
  assert.equal(prefetch.receive({id:99}, () => true), false);
});

test("a newer request puts the background estimate back in the queue; a failed one stops it", () => {
  const {line, prefetch, posted} = setup();
  prefetch.plan(line, 3);
  prefetch.giveWay();
  prefetch.pump();
  assert.equal(posted.length, 2);
  assert.equal(posted[1].board, posted[0].board);
  prefetch.receive({id:posted[1].id}, () => false);
  prefetch.pump();
  assert.equal(posted.length, 2);
});
