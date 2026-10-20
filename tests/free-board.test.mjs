import test from "node:test";
import assert from "node:assert/strict";
import {newGame,play,at,isFree,initialGame,rulesOf,BLACK,WHITE} from "../public/core.mjs";
import {replaySteps,parseSGF,exportSGF} from "../public/sgf.mjs";
import {makeReviewUrl,readReviewUrl} from "../public/sgf-link.mjs";
import {replayLine} from "../public/ownership-prefetch.mjs";
import {takeBack} from "../public/takeback.mjs";
import {toKataGoPosition} from "../src/katago/position.mjs";
import {TEXT} from "../public/texts.mjs";

const choose=(game,color)=>({...game,next:color});

test("自由に置く is a ruleset with no handicap and no hidden stones",()=>{
  const game=newGame(true,{size:9,rules:"free",handicap:4,hideStones:true});
  assert.equal(isFree(game),true);
  assert.equal(rulesOf(game),"free");
  assert.equal(game.handicap,0);
  assert.equal(game.hideStones,undefined);
  assert.ok(game.board.every(v=>v===0));
  assert.equal(rulesOf(initialGame(game)),"free");
});

test("a tap places the chosen colour on an empty point and takes a stone off",()=>{
  let game=newGame(true,{rules:"free"});
  game=play(game,at(4,4));
  assert.equal(game.board[at(4,4)],BLACK);
  assert.equal(game.next,BLACK,"the chosen colour stays chosen");
  game=play(game,at(3,3));
  game=play(choose(game,WHITE),at(4,3));
  assert.equal(game.board[at(4,3)],WHITE);
  // Taking off works whatever colour is chosen.
  game=play(game,at(4,4));
  assert.equal(game.board[at(4,4)],0);
  assert.equal(game.moveNumber,4);
  assert.equal(game.status,"playing");
});

test("a free board captures nothing and allows any shape, even without liberties",()=>{
  let game=newGame(true,{rules:"free"});
  for(const p of [at(1,0),at(0,1)])game=play(game,p);
  game=play(choose(game,WHITE),at(0,0));
  assert.equal(game.board[at(0,0)],WHITE,"a stone without liberties stays");
  game=play(choose(game,BLACK),at(1,1));
  assert.deepEqual(game.captures,{black:0,white:0});
  assert.throws(()=>play(game,null));
  assert.throws(()=>play(game,"resign"));
});

test("replays, 待った and the background replay follow the colour of each recorded stone",()=>{
  let game=newGame(true,{rules:"free"});
  game=play(game,at(2,2));
  game=play(choose(game,WHITE),at(6,6));
  game=play(game,at(6,7));
  game=play(game,at(2,2)); // take the black stone off with White chosen
  assert.deepEqual(replaySteps(game).board,game.board);
  assert.equal(replaySteps(game,2).board[at(6,6)],WHITE);
  assert.deepEqual(replayLine(game).at(-1).board,game.board);
  const undone=takeBack(game,{scope:"ply"});
  assert.equal(undone.game.board[at(2,2)],BLACK,"待った puts the stone back");
  assert.equal(undone.game.next,WHITE,"the chosen colour survives 待った");
});

test("a free board is saved and shared as its position in setup stones",()=>{
  let game=newGame(true,{size:13,rules:"free"});
  game=play(game,at(3,3,13));
  game=play(choose(game,WHITE),at(9,9,13));
  game=play(game,at(9,10,13));
  game=play(game,at(9,10,13));
  const sgf=exportSGF({snapshot:game});
  assert.match(sgf,/^\(;GM\[1\]FF\[4\]CA\[UTF-8\]SZ\[13\]RU\[Free\]AB\[dd\]AW\[jj\]PL\[W\]\)$/);
  const {snapshot}=parseSGF(sgf);
  assert.equal(isFree(snapshot),true);
  assert.deepEqual(snapshot.board,game.board);
  assert.equal(snapshot.next,WHITE);
  // A link shows the position at the chosen step.
  const link=readReviewUrl(makeReviewUrl("https://miego.example",{snapshot:game},1));
  assert.equal(isFree(link.snapshot),true);
  assert.equal(link.snapshot.board[at(3,3,13)],BLACK);
  assert.equal(link.snapshot.board[at(9,9,13)],0);
  assert.equal(link.step,link.snapshot.moves.length);
});

test("an SGF with setup stones and no moves opens as a free board",()=>{
  const {snapshot}=parseSGF("(;GM[1]FF[4]SZ[9]AB[cc][dc]AW[cd])");
  assert.equal(isFree(snapshot),true);
  assert.equal(snapshot.board[at(2,2)],BLACK);
  assert.equal(snapshot.board[at(2,3)],WHITE);
  // Handicap stones with moves stay an ordinary game.
  assert.equal(rulesOf(parseSGF("(;GM[1]FF[4]SZ[9]HA[2]AB[gc][cg];W[ee])").snapshot),"chinese");
});

test("KataGo reads a free board as a position without a move history",()=>{
  let game=newGame(true,{rules:"free"});
  game=play(game,at(4,4));
  game=play(game,at(4,4));
  game=play(choose(game,WHITE),at(2,2));
  const position=toKataGoPosition(game);
  assert.deepEqual(position.moveHistory,[]);
  assert.equal(position.previousBoard,undefined);
  assert.equal(position.currentPlayer,"white");
});

test("the free board has its own wording",()=>{
  assert.equal(TEXT.newGame.rulesChoices.free,"自由");
  assert.match(TEXT.game.ruleLabel(9,"free",0,0),/自由に置く/);
  assert.match(TEXT.game.ruleSummary(9,0,0,"free"),/取り除く/);
});
