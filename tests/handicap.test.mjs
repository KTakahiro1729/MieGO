import test from "node:test";
import assert from "node:assert/strict";
import {newGame,play,at,areaScore,scoreResult,whiteCompensation,initialGame,HANDICAP_POINTS,KOMI,BLACK,WHITE} from "../public/core.mjs";
import {parseSGF,exportSGF,replaySteps,forkReview} from "../public/sgf.mjs";
import {takeBack} from "../public/takeback.mjs";
import {freshLocalGame} from "../public/mode-state.mjs";
import {toKataGoPosition} from "../src/katago/position.mjs";

test("handicap games start with stones on star points and White to move",()=>{
  const g=newGame(true,{handicap:4});
  assert.equal(g.next,WHITE);
  assert.equal(g.handicap,4);
  assert.equal(g.komi,0);
  assert.deepEqual(g.board.flatMap((v,i)=>v===BLACK?[i]:[]).sort((a,b)=>a-b),
    HANDICAP_POINTS.slice(0,4).sort((a,b)=>a-b));
  assert.equal(g.board[at(4,4)],0,"tengen is the fifth stone");
  assert.equal(newGame(true,{handicap:5}).board[at(4,4)],BLACK);
  // One stone is not a handicap game; invalid counts fall back to an even game.
  for(const n of [1,6,-2,2.5,undefined]){
    const even=newGame(true,{handicap:n});
    assert.equal(even.handicap,0);assert.equal(even.next,BLACK);assert.equal(even.komi,KOMI);
  }
});

test("Chinese handicap scoring gives White no komi, only one point per stone",()=>{
  const g=newGame(true,{handicap:3});
  assert.equal(whiteCompensation(g),3);
  // Old snapshots without the new fields keep the even-game 7.5 komi.
  const legacy={...newGame()};delete legacy.komi;delete legacy.handicap;
  assert.equal(whiteCompensation(legacy),7.5);
  // Board with only the three black stones: Black owns all 81 points.
  const s=areaScore({...g,dead:[]});
  assert.equal(s.black,81);assert.equal(s.white,3);
});

test("without komi a handicap game can end in a draw (持碁)",()=>{
  const g={...newGame(true,{handicap:2,rules:"japanese"}),status:"scoring",board:Array(81).fill(0)};
  assert.equal(scoreResult(areaScore(g)),"0");
  const record=parseSGF(exportSGF({...g,status:"finished",result:"0"}));
  assert.equal(record.snapshot.result,"0");
  assert.match(exportSGF({...g,status:"finished",result:"0"}),/RE\[0\]/);
});

test("replay, fork and takeback start from the handicap position",()=>{
  let g=newGame(true,{handicap:2});
  g=play(g,at(4,4));g=play(g,at(3,4));g=play(g,at(5,5));
  assert.deepEqual(replaySteps(g).board,g.board);
  assert.deepEqual(replaySteps(g,0).board,initialGame(g).board);
  const fork=forkReview(g,1);
  assert.equal(fork.handicap,2);assert.equal(fork.next,BLACK);
  const back=takeBack(g,{color:BLACK});
  assert.equal(back.game.moveNumber,1);
  assert.equal(back.game.board[HANDICAP_POINTS[0]],BLACK);
  assert.equal(back.game.next,BLACK);
  const allBack=takeBack(play(newGame(true,{handicap:2}),at(4,4)),{color:WHITE});
  assert.equal(allBack.game.moveNumber,0);assert.equal(allBack.game.next,WHITE);
  assert.equal(freshLocalGame(g,{handicap:3}).handicap,3);
  assert.equal(freshLocalGame(g).handicap,0);
});

test("SGF round-trips MieGO handicap games and rejects other setups",()=>{
  let g=newGame(true,{handicap:3});
  g=play(g,at(4,4));g=play(g,at(3,3));
  const text=exportSGF(g);
  assert.match(text,/KM\[0\]RU\[Chinese\]HA\[3\]AB\[gc\]\[cg\]\[gg\]/);
  const back=parseSGF(text);
  assert.equal(back.snapshot.handicap,3);
  assert.deepEqual(back.snapshot.board,g.board);
  assert.equal(back.metadata.komi,"0");
  assert.throws(()=>parseSGF("(;GM[1]FF[4]SZ[9]HA[2]AB[aa][ii];W[ee])"),/置き石/);
  assert.throws(()=>parseSGF("(;GM[1]FF[4]SZ[9]AB[gc];W[ee])"),/置き石/);
  assert.throws(()=>parseSGF("(;GM[1]FF[4]SZ[9]AW[gc];B[ee])"),/白石/);
  assert.throws(()=>parseSGF("(;GM[1]FF[4]SZ[9]HA[2]AB[gc][cg];B[ee])"),/交互/);
});

test("KataGo sees the handicap stones and White to move",()=>{
  const pos=toKataGoPosition(newGame(true,{handicap:2}));
  assert.equal(pos.currentPlayer,"white");
  assert.equal(pos.board[2][6],"black");
  assert.equal(pos.moveHistory.length,0);
});
