import test from "node:test";
import assert from "node:assert/strict";
import {newGame,play,at} from "../public/core.mjs";
import {parseSGF,exportSGF,replaySteps,forkReview} from "../public/sgf.mjs";

test("SGF reads and writes standard 9x9 moves, passes and results",()=>{
  const g=play(play(play(newGame(false),at(3,3)),at(4,4)),null);
  const source=exportSGF({snapshot:g});
  assert.match(source,/SZ\[9\]/);
  assert.match(source,/;B\[dd\];W\[ee\];B\[\]/);
  const imported=parseSGF(source);
  assert.deepEqual(imported.snapshot.board,g.board);
  assert.equal(imported.snapshot.assisted,true);
  assert.equal(imported.steps,3);
  assert.equal(imported.snapshot.next,g.next);
});
test("SGF mainline picks first variation and handles escaped metadata safely",()=>{
 const parsed=parseSGF("(;FF[4]GM[1]SZ[9]PB[White\\]\\\\Black]KM[6.5];B[dd](;W[ee])(;W[ff]))");
 assert.equal(parsed.variationsIgnored,true);
 assert.equal(parsed.steps,2);
 assert.equal(parsed.metadata.blackName,"White]\\Black");
 assert.equal(parsed.metadata.komi,"6.5");
 const text=exportSGF({snapshot:parsed.snapshot,sgfMeta:parsed.metadata});
 assert.match(text,/KM\[6\.5\]/);
 assert.ok(text.includes("PB[White\\]\\\\Black]"));
});
test("reject unsupported sizes, setup stones, illegal order, suicidal moves and malformed syntax",()=>{
 for(const sample of [
   "(;GM[1]SZ[19];B[dd])",
   "(;GM[1]SZ[9]AB[aa];W[ee])",
   "(;GM[1]SZ[9];B[aa];B[bb])",
   "(;GM[1]SZ[9];B[zz])",
   "(;GM[1]SZ[9];B[aa];W[bb];B[aa])",
   "(;GM[1]SZ[9]", "(;GM[1]SZ[9])(;GM[1]SZ[9])"
 ])assert.throws(()=>parseSGF(sample));
});
test("replay traverses legal positions, captures, passes and scoring transitions",()=>{
 let s=newGame();
 for(const p of [0,1,null,null])s=play(s,p);
 assert.equal(s.status,"scoring");
 assert.equal(replaySteps(s,0).moveNumber,0);
 assert.equal(replaySteps(s,2).moveNumber,2);
 assert.equal(replaySteps(s,4).status,"scoring");
 const mid=forkReview(s,4);
 assert.equal(mid.status,"playing");assert.equal(mid.passes,0);
 assert.equal(mid.moves.length,4);
 const branch=play(mid,2);
 assert.equal(branch.moveNumber,5);
 assert.equal(s.status,"scoring");
});
test("resignation exports as RE and reviewing its final board can be branched",()=>{
 const s=play(play(newGame(),40),"resign");
 const sgf=exportSGF({snapshot:s});
 assert.match(sgf,/RE\[B\+R\]/);
 assert.equal((sgf.match(/;B\[/g)||[]).length,1);
 const fork=forkReview(s,s.moves.length);
 assert.equal(fork.status,"playing");
 assert.equal(fork.moves.length,1);
 assert.equal(fork.next,-1);
 assert.equal(fork.result,null);
});
test("imported result and alternate komi are metadata, not new score calculations",()=>{
 const parsed=parseSGF("(;GM[1]FF[4]SZ[9]KM[6.5]RE[W+R];B[dd])");
 assert.equal(parsed.snapshot.status,"finished");
 assert.equal(parsed.snapshot.result,"W+R");
 assert.ok(exportSGF({snapshot:parsed.snapshot,sgfMeta:parsed.metadata}).includes("KM[6.5]"));
});
