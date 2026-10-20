import test from "node:test";
import assert from "node:assert/strict";
import {at,BLACK,newGame,play,WHITE} from "../public/core.mjs";
import {libertyMarks} from "../public/liberty-view.mjs";
import {recordingBoard,baseView} from "./helpers/board-canvas.mjs";

test("仮置き中だけ marks the placed group's liberties and the opponent groups it puts in atari",()=>{
  const board=newGame().board;
  board[at(4,4)]=WHITE;board[at(3,4)]=BLACK;board[at(5,4)]=BLACK;board[at(4,3)]=BLACK;
  board[at(4,5)]=BLACK;
  const marks=libertyMarks(board,"candidate",at(4,5));
  assert.deepEqual(marks.filter(m=>m.kind==="dot").map(m=>m.position).sort((a,b)=>a-b),
    [at(3,5),at(5,5),at(4,6)].sort((a,b)=>a-b));
  assert.deepEqual(marks.filter(m=>m.kind==="atari"),[]);
  board[at(4,5)]=0;
  const atari=libertyMarks(board,"candidate",at(4,3));
  assert.deepEqual(atari.filter(m=>m.kind==="atari").map(m=>m.position),[at(4,5)]);
  assert.deepEqual(libertyMarks(board,"candidate",null),[]);
});

test("アタリだけ, すべて（点）and すべて（数）read the whole board",()=>{
  const board=newGame().board;
  board[at(0,0)]=BLACK;board[at(1,0)]=WHITE;
  assert.deepEqual(libertyMarks(board,"atari").map(m=>m.position),[at(0,1)]);
  const dots=libertyMarks(board,"dots");
  const shared=dots.find(m=>m.position===at(1,1));
  assert.deepEqual(shared,{kind:"dot",position:at(1,1),colors:[WHITE],atari:false});
  assert.equal(dots.find(m=>m.position===at(0,1)).atari,true);
  assert.deepEqual(libertyMarks(board,"count").map(m=>m.count),[1,2]);
  assert.deepEqual(libertyMarks(board,"off"),[]);
});

test("the renderer paints liberties only while playing or replaying",()=>{
  let game=play(newGame(),at(4,4)),liberties="dots";
  const {draw,calls}=recordingBoard(()=>({...baseView(game),liberties}));
  draw();
  const dots=calls.filter(c=>c.kind==="arc"&&Math.abs(c.args[2]-6)<1e-9);
  assert.ok(dots.length>=4,"a dot on each liberty");
  calls.length=0;liberties="off";draw();
  assert.equal(calls.some(c=>c.kind==="arc"&&Math.abs(c.args[2]-6)<1e-9),false);
});

test("危ないときだけ outlines groups down to two liberties and joins the placed stone to its liberties",()=>{
  const board=newGame().board;
  board[at(0,0)]=BLACK;board[at(1,0)]=WHITE;board[at(4,4)]=BLACK;
  const marks=libertyMarks(board,"danger");
  assert.deepEqual(marks.filter(m=>m.kind==="danger").map(m=>[m.stones,m.count]),[[[at(0,0)],1],[[at(1,0)],2]]);
  assert.deepEqual(marks.filter(m=>m.kind==="atari").map(m=>m.position),[at(0,1)]);
  assert.equal(marks.some(m=>m.kind==="tube"),false,"no tubes without a stone being placed");
  board[at(4,5)]=BLACK;
  const tubes=libertyMarks(board,"danger",at(4,5)).filter(m=>m.kind==="tube");
  assert.equal(tubes.length,6);
  assert.deepEqual(tubes.find(m=>m.position===at(3,4)).from,[at(4,4)]);
  assert.ok(tubes.every(m=>m.color===BLACK && !m.atari));
});
