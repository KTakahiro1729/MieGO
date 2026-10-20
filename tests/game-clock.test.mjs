import test from "node:test";
import assert from "node:assert/strict";
import {BLACK,WHITE,at,loseOnTime,newGame,play} from "../public/core.mjs";
import {clockOf,clockSeconds,clockText,createGameClock,readClock,spendTime,timeControlOf} from "../public/game-clock.mjs";
import {replaySteps} from "../public/sgf.mjs";
import {takeBack} from "../public/takeback.mjs";
import {resultLabel} from "../public/result-label.mjs";

const timed=(main,byoyomi)=>newGame(true,{size:9,timeControl:{main,byoyomi}});

test("a game keeps its 持ち時間 through moves, replays and 待った; none is written when off",()=>{
  let game=timed(600,30);
  assert.deepEqual(game.timeControl,{main:600,byoyomi:30});
  game=play(play(game,at(2,2)),at(6,6));
  assert.deepEqual(replaySteps(game,1).timeControl,{main:600,byoyomi:30});
  assert.equal(Object.hasOwn(newGame(true,{timeControl:{main:0,byoyomi:0}}),"timeControl"),false);
  assert.equal(Object.hasOwn(newGame(true,{rules:"free",timeControl:{main:600,byoyomi:0}}),"timeControl"),false);
  assert.equal(timeControlOf({main:42,byoyomi:30}).main,0);
});

test("time spent comes off the main time, then each move has the 秒読み",()=>{
  let game=timed(60,30);
  assert.deepEqual(clockOf(game),{black:60000,white:60000});
  game={...game,clock:spendTime(game,BLACK,45000)};
  assert.equal(clockOf(game).black,15000);
  // 20 s more uses up the main time and 5 s of the 秒読み, which starts again next move.
  assert.equal(readClock(game,BLACK,20000).byoyomi,25000);
  game={...game,clock:spendTime(game,BLACK,20000)};
  assert.equal(readClock(game,BLACK).byoyomi,30000);
  assert.equal(spendTime(game,BLACK,29000).black,0);
  assert.equal(spendTime(game,BLACK,30000),null);
  // 切れ負け: no 秒読み, so the main time running out is the end.
  const sudden=timed(60,0);
  assert.equal(readClock(sudden,WHITE,60000).out,true);
  assert.equal(readClock(sudden,WHITE,59000).out,false);
});

test("待った keeps the time already spent",()=>{
  let game=play(timed(600,0),at(2,2));
  game={...play(game,at(6,6)),clock:{black:500000,white:400000}};
  assert.deepEqual(takeBack(game,{scope:"ply"}).game.clock,{black:500000,white:400000});
});

test("a loss on time ends the game with a T result",()=>{
  const game=loseOnTime(timed(60,0),BLACK);
  assert.equal(game.status,"finished");
  assert.equal(game.result,"W+T");
  assert.equal(resultLabel(game.result),"黒の時間切れで白が勝利");
});

test("the running clock ticks by whole seconds and reports a time-out to its listeners",()=>{
  let time=0;
  const timers=[];
  const clock=createGameClock({now:()=>time,schedule:(fn,ms)=>{timers.push({fn,at:time+ms});return timers.length;},cancel:()=>{}});
  const readings=[],outs=[];
  clock.subscribe(reading=>readings.push(reading));
  clock.onTimeout(side=>outs.push(side));
  clock.run(timed(0,10),WHITE);
  assert.equal(readings.at(-1).byoyomi,10000);
  for(let i=0;i<10;i++){
    const next=timers.shift();
    time=next.at;next.fn();
  }
  assert.deepEqual(outs,[WHITE]);
  assert.equal(readings.at(-1),null);
  assert.equal(clock.running,null);
});

test("stop() returns the time used and the clock text counts down by seconds",()=>{
  let time=1000;
  const clock=createGameClock({now:()=>time,schedule:()=>1,cancel:()=>{}});
  clock.run(timed(300,0),BLACK);
  time+=4200;
  assert.equal(clock.stop(),4200);
  assert.equal(clockText(295800),"4:56");
  assert.equal(clockText(9100),"0:10");
  assert.equal(clockSeconds(9100),10);
});
