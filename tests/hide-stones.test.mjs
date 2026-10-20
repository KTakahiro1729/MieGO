import test from "node:test";
import assert from "node:assert/strict";
import {newGame,play,at} from "../public/core.mjs";
import {replaySteps,forkReview} from "../public/sgf.mjs";
import {takeBack} from "../public/takeback.mjs";
import {freshLocalGame} from "../public/mode-state.mjs";

test("石を隠す stays with the game through moves, replays, 待った and branches",()=>{
  let game=freshLocalGame(null,{size:9,hideStones:true});
  assert.equal(game.hideStones,true);
  game=play(play(game,at(2,2)),at(6,6));
  assert.equal(game.hideStones,true);
  assert.equal(replaySteps(game,1).hideStones,true);
  assert.equal(takeBack(game,{scope:"ply"}).game.hideStones,true);
  assert.equal(forkReview(game,1).hideStones,true);
});

test("games without 石を隠す keep their previous shape",()=>{
  assert.equal(Object.hasOwn(newGame(),"hideStones"),false);
  assert.equal(Object.hasOwn(replaySteps(play(newGame(),at(2,2)),1),"hideStones"),false);
});
