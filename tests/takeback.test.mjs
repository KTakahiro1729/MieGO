import test from "node:test";
import assert from "node:assert/strict";
import {newGame,play,proposeEnd,resume,at,BLACK,WHITE} from "../public/core.mjs";
import {takebackCut,takeBack,requestTakeback,answerTakeback} from "../public/takeback.mjs";
import {reconcileGame} from "../public/p2p-session.mjs";

const opening=()=>{
  let g=newGame();
  g=play(g,at(4,4));g=play(g,at(3,3));g=play(g,at(5,5));g=play(g,at(2,2));
  return g;
};

test("takeback removes the player's move and the reply, rebuilding captures",()=>{
  const g=opening();
  const back=takeBack(g,{color:BLACK});
  assert.equal(back.game.moveNumber,2);
  assert.equal(back.game.next,BLACK);
  assert.equal(back.lastPosition,at(3,3));
  assert.deepEqual(back.game.board,play(play(newGame(),at(4,4)),at(3,3)).board);
  // Playing White: only Black's opening move remains.
  const white=takeBack(g,{color:WHITE});
  assert.equal(white.game.moveNumber,3);
  assert.equal(white.game.next,WHITE);
  assert.equal(takeBack(newGame(),{color:BLACK}),null);
  assert.equal(takeBack({...g,status:"scoring"},{color:BLACK}),null);
});

test("one shared board takes back exactly the latest move, either color",()=>{
  const g=opening();
  const back=takeBack(g,{scope:"ply"});
  assert.equal(back.game.moveNumber,3);
  assert.equal(back.game.next,WHITE);
  assert.equal(back.lastPosition,at(5,5));
  assert.equal(takebackCut(newGame(),{scope:"ply"}),-1);
});

test("takeback is allowed while an end offer is pending and clears it",()=>{
  const g=proposeEnd(opening(),WHITE);
  const back=takeBack(g,{color:BLACK});
  assert.equal(back.game.endProposal,null);
  assert.equal(back.game.status,"playing");
});

test("taking back a move played after resumed scoring returns a playable position",()=>{
  let g=play(play(newGame(),null),null);
  assert.equal(g.status,"scoring");
  g=play(resume(g),at(4,4));
  const back=takeBack(g,{color:BLACK});
  assert.equal(back.game.status,"playing");
  assert.equal(back.game.moveNumber,2);
  assert.equal(back.game.passes,0);
});

test("friend takeback needs the other side's acceptance",()=>{
  let g=proposeEnd(opening(),BLACK);
  g=requestTakeback(g,WHITE);
  assert.equal(g.endProposal,null);
  assert.deepEqual(g.takebackRequest,{from:WHITE,atMove:4});
  // While a request is open, an end offer is ignored on both peers.
  assert.equal(proposeEnd(g,BLACK),g);
  assert.throws(()=>answerTakeback(g,WHITE,true));
  assert.equal(answerTakeback(g,BLACK,false).takebackRequest,undefined);
  assert.equal(answerTakeback(g,WHITE,false).takebackRequest,undefined);
  const accepted=answerTakeback(g,BLACK,true);
  assert.equal(accepted.moveNumber,3);
  assert.equal(accepted.next,WHITE);
  assert.equal(accepted.takebacks,1);
  assert.equal(accepted.takebackRequest,undefined);
});

test("a real move answers a pending request; simultaneous requests keep Black's",()=>{
  const g=requestTakeback(opening(),WHITE);
  assert.equal(play(g,at(6,6)).takebackRequest,undefined);
  assert.equal(requestTakeback(g,BLACK).takebackRequest.from,BLACK);
  const black=requestTakeback(opening(),BLACK);
  assert.equal(requestTakeback(black,WHITE).takebackRequest.from,BLACK);
  assert.throws(()=>requestTakeback(newGame(),BLACK));
});

test("reconnecting peers adopt the rewound line instead of reporting a conflict",()=>{
  const before=opening();
  const after=play(takeBack(before,{color:BLACK}).game,at(6,6));
  assert.equal(reconcileGame(before,4,after,6).kind,"adopt");
  assert.equal(reconcileGame(after,6,before,4).kind,"send");
  // Without the takeback counter, a diverged line is still a conflict.
  const {takebacks,...unmarked}=after;
  assert.equal(reconcileGame(before,4,unmarked,6).kind,"conflict");
});
