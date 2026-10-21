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
    jobCurrent:id => id === 1, knownOwnership:() => known, onUnavailable:() => heard.push("unavailable"), onSettled:run => heard.push(run),
  });
  return {control, posted, heard};
}

test("a playout asks KataGo about the scoring position and shows it over the real stones", () => {
  const {control, posted} = setup();
  control.start(1);
  assert.deepEqual(posted.map(m => [m.id, m.kind]), [[1, "settle"]]);
  assert.equal(control.busy(), true);
  assert.equal(control.view().moves, 0);
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

test("the playout plays on at once, out of sight", () => {
  const {control, posted} = setup();
  control.start(1);
  control.receive({id:1, engine:"katago", ownership:Array(81).fill(0), policy:Array(81).fill(0)});
  assert.equal(posted.at(-1).state.passes, 1);
  assert.deepEqual(control.view(), {moves:1, dead:[]});
});

test("meanwhile the board counts with the stones an estimate kept for the board calls dead", () => {
  const game = {...newGame(true, {size:9}), status:"scoring"};
  game.board = [...game.board]; game.board[0] = -1; game.board[40] = 1;
  const known = Array(81).fill(0.95);
  const control = createSettleControl({getGame:() => game, isReviewing:() => false, post() {}, show() {}, draw() {},
    jobCurrent:() => true, onUnavailable() {}, onSettled() {}, knownOwnership:() => known});
  control.start(1);
  assert.deepEqual(control.view().dead, [0]);
});
