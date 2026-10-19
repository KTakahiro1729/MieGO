import test from "node:test";
import assert from "node:assert/strict";
import {newGame,play,at,BLACK,WHITE} from "../public/core.mjs";
import {activeReviewSnapshot,proposeReviewStone,commitReviewStone,variationForSharing} from "../public/review-variation.mjs";
const gameWithMoves=(...positions)=>positions.reduce((g,p)=>play(g,p),newGame());
const reviewAt=(snapshot,step)=>({source:"archive",snapshot,step,activeLine:"main",variation:null,metadata:null});
test("a different move creates a variation without touching the source snapshot",()=>{
 const original=gameWithMoves(at(2,2),at(3,3),at(4,4));
 const r=reviewAt(original,1);
 const alt=commitReviewStone(r,original,at(4,4));
 assert.equal(alt.created,true);
 assert.equal(alt.variation.baseStep,1);
 assert.equal(alt.step,2);
 assert.equal(alt.display.board[at(4,4)],WHITE);
 assert.equal(original.board[at(4,4)],BLACK);
 assert.equal(original.moves.length,3);
 assert.equal(alt.variation.snapshot.moves.length,2);
 assert.equal(activeReviewSnapshot({...r,...alt},original).moves.length,2);
 assert.equal(activeReviewSnapshot({...r,...alt,activeLine:"main"},original).moves.length,3);
});
test("existing next move follows mainline without producing a fork",()=>{
 const g=gameWithMoves(at(2,2),at(3,3));
 const r=reviewAt(g,1);
 const result=commitReviewStone(r,g,at(3,3));
 assert.equal(result.created,false);
 assert.equal(result.variation,null);
 assert.equal(result.step,2);
});
test("continue and revise a variation from any earlier node",()=>{
 const main=gameWithMoves(at(2,2),at(3,3),at(4,4),at(5,5));
 let r=reviewAt(main,2);
 r={...r,...commitReviewStone(r,main,at(6,6))};
 r={...r,...commitReviewStone(r,main,at(6,5))};
 assert.equal(r.variation.snapshot.moves.length,4);
 r.step=2;
 r={...r,...commitReviewStone(r,main,at(7,7))};
 assert.equal(r.variation.baseStep,2);
 assert.equal(r.variation.snapshot.moves.length,3);
 assert.equal(r.variation.snapshot.board[at(6,6)],0);
 assert.equal(main.board[at(4,4)],BLACK);
});
test("illegal variations are rejected while preserving the original",()=>{
 const g=gameWithMoves(at(2,2),at(3,3));
 const r=reviewAt(g,2);
 assert.throws(()=>proposeReviewStone(r,g,at(2,2)),/すでに|着手|打てません/);
 assert.equal(g.moves.length,2);
});
test("pass is supported as a legal alternative move",()=>{
 const g=gameWithMoves(at(2,2),at(3,3));
 const r=reviewAt(g,1);
 const result=commitReviewStone(r,g,null);
 assert.equal(result.display.moves[1].position,null);
 assert.equal(result.display.next,BLACK);
 assert.equal(g.moves[1].position,at(3,3));
});
test("live game progression remains independent and selectable",()=>{
 const old=gameWithMoves(at(2,2));
 const r={...reviewAt(old,0),source:"live"};
 const newer=play(old,at(3,3));
 assert.equal(activeReviewSnapshot(r,newer).moves.length,2);
 const branch=commitReviewStone(r,newer,at(4,4));
 assert.equal(branch.variation.snapshot.moves.length,1);
 assert.equal(newer.moves.length,2);
 const share=variationForSharing({...r,...branch},newer);
 assert.equal(share.snapshot.moves.length,1);
 assert.equal(share.step,1);
});
test("hypothetical SGF uses current branch, not real result or metadata",()=>{
 const game=gameWithMoves(at(2,2),at(3,3));
 const r={...reviewAt(game,1),metadata:{result:"B+R",komi:"6.5"}};
 const branch=commitReviewStone(r,game,at(5,5));
 const info=variationForSharing({...r,...branch},game);
 assert.equal(info.metadata,null);
 assert.equal(info.snapshot.moves.at(-1).position,at(5,5));
});
