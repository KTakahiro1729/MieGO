import test from "node:test";
import assert from "node:assert/strict";
import { newGame } from "../public/core.mjs";
import { createSettleControl } from "../public/settle-control.mjs";

function setup(known = null) {
  const game = {...newGame(true, {size:9}), status:"scoring"};
  const posted = [], heard = [];
  const control = createSettleControl({
    getGame:() => game, isReviewing:() => false,
    post:m => posted.push(m), show() {}, draw:() => heard.push("draw"),
    jobCurrent:id => id === 1, onUnavailable:() => heard.push("unavailable"), onSettled:run => heard.push(run),
    knownOwnership:() => known,
  });
  return {control, posted, heard};
}

test("a playout asks KataGo about the scoring position and shows it over the real stones", () => {
  const {control, posted} = setup();
  control.start(1);
  assert.deepEqual(posted.map(m => [m.id, m.kind]), [[1, "settle"]]);
  assert.equal(control.busy(), true);
  assert.equal(control.view().moves, 0);
  assert.equal(control.current(), null);
});

test("an answer KataGo could not give leaves the dead stones to the player", () => {
  const {control, heard} = setup();
  control.start(1);
  control.receive({id:1, error:"no"});
  assert.deepEqual(heard, ["unavailable"]);
  assert.equal(control.busy(), false);
});

test("a stone tapped during the playout is taken by it; with no playout the tap is the player's", () => {
  const {control} = setup();
  assert.equal(control.tap(3), false);
  control.start(1);
  assert.equal(control.tap(3), true);
});

test("the territory colours already known for the board stay on until KataGo's first answer", () => {
  const known = Array(81).fill(0.9);
  const {control} = setup(known);
  control.start(1);
  assert.equal(control.view().ownership, known);
  const answer = Array(81).fill(-0.9);
  control.receive({id:1, engine:"katago", ownership:answer, policy:Array(81).fill(0)});
  assert.equal(control.view().ownership, answer);
});

test("an estimate for another board is not shown during the playout", () => {
  const {control} = setup(Array(361).fill(0.9));
  control.start(1);
  assert.equal(control.view().ownership, null);
});
