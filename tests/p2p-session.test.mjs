import test from "node:test";
import assert from "node:assert/strict";
import { newGame, play, agreeScore, answerEndProposal, loseOnTime, proposeEnd, BLACK, WHITE } from "../public/core.mjs";
import { selectColor, playerColor, readCheckpoint, saveCheckpoint, reconcileGame, guestUrl, ownUrl, isPeerAction, isConsistentSnapshot, roomUrl, newPeerSignins } from "../public/p2p-session.mjs";

test("creator's choice fixes color and guest receives opposite color",()=>{
  assert.equal(selectColor("black"),BLACK);
  assert.equal(selectColor("white"),WHITE);
  assert.equal(selectColor("random",{getRandomValues:b=>{b[0]=0;return b;}}),BLACK);
  assert.equal(selectColor("random",{getRandomValues:b=>{b[0]=255;return b;}}),WHITE);
  assert.equal(playerColor("owner",WHITE),WHITE);
  assert.equal(playerColor("guest",WHITE),BLACK);
});
test("role-specific URLs keep secrets in fragments",()=>{
  const room="1".repeat(32),key="2".repeat(48);
  const url=guestUrl("https://miego.example",room,key);
  assert.equal(new URL(url).searchParams.get("key"),null);
  assert.equal(new URL(url).hash,"#role=guest&key="+key);
  assert.match(ownUrl("https://miego.example",room,key),/#role=owner&key=/);
  assert.throws(()=>guestUrl("https://miego.example",room,"weak"));
});
test("localStorage checkpoint restores a complete online match",()=>{
  const state=new Map(),storage={getItem:key=>state.get(key)||null,setItem:(key,v)=>state.set(key,v)};
  const room="f".repeat(32),game=play(newGame(),0);
  assert.equal(saveCheckpoint(storage,room,{role:"guest",revision:1,game,lastPosition:0,session:"token"}),true);
  const checkpoint=readCheckpoint(storage,room);
  assert.equal(checkpoint.game.moveNumber,1);
  assert.equal(checkpoint.session,"token");
});
test("newer matching history adopts, older history asks sender to sync",()=>{
  const start=newGame(), next=play(start,0);
  assert.equal(reconcileGame(start,0,next,1).kind,"adopt");
  assert.equal(reconcileGame(next,1,start,0).kind,"send");
  assert.equal(reconcileGame(next,1,next,1).kind,"equal");
});
test("conflicting moves or equal-revision scoring changes are not silently overwritten",()=>{
  const first=play(newGame(),0),second=play(newGame(),1);
  assert.equal(reconcileGame(first,1,second,2).kind,"conflict");
  assert.equal(reconcileGame(first,1,{...first,passes:1},1).kind,"conflict");
});

test("before the first move the inviter's board size wins over a guest's default board", () => {
  const host = newGame(true, { size: 19 }), guest = newGame();
  assert.equal(reconcileGame(host, 0, guest, 0, { localIsOwner: true }).kind, "send");
  const adopted = reconcileGame(guest, 0, host, 0, { localIsOwner: false });
  assert.equal(adopted.kind, "adopt");
  assert.equal(adopted.game.board.length, 361);
  // Once play has started, a size mismatch is a real conflict.
  const played = play(host, 0);
  assert.equal(reconcileGame(played, 1, guest, 1, { localIsOwner: true }).kind, "conflict");
});

test("before the first move the inviter's handicap wins over a guest's even board", () => {
  const host = newGame(true, { handicap: 3 }), guest = newGame();
  assert.equal(reconcileGame(host, 0, guest, 0, { localIsOwner: true }).kind, "send");
  const adopted = reconcileGame(guest, 0, host, 0, { localIsOwner: false });
  assert.equal(adopted.kind, "adopt");
  assert.equal(adopted.game.handicap, 3);
  assert.equal(adopted.game.next, WHITE);
});

test("a friend's client may act only for the friend's color", () => {
  const game = newGame(); // Black to play
  const peer = { peerColor: WHITE };
  assert.equal(isPeerAction({ type: "move", position: 0 }, game, peer), false);
  assert.equal(isPeerAction({ type: "move", position: "resign" }, game, peer), false);
  assert.equal(isPeerAction({ type: "move", position: 0 }, game, { peerColor: BLACK }), true);
  for (const type of ["agree", "end_offer", "end_answer", "takeback_request", "takeback_answer"]) {
    assert.equal(isPeerAction({ type, color: BLACK }, game, peer), false, type);
    assert.equal(isPeerAction({ type, color: WHITE }, game, peer), true, type);
  }
  // Automated dead-stone reviews come from the room owner only.
  assert.equal(isPeerAction({ type: "dead_auto", positions: [] }, game, peer), false);
  assert.equal(isPeerAction({ type: "dead_auto", positions: [] }, game, { ...peer, peerIsOwner: true }), true);
  assert.equal(isPeerAction({ type: "dead", position: 0 }, game, peer), true);
  for (const type of ["solo_scoring", "solo_score"])
    assert.equal(isPeerAction({ type }, game, { ...peer, peerIsOwner: true }), false, type);
  assert.equal(isPeerAction({ type: "move", position: 0 }, game, { peerColor: null }), false);
});

test("a synced snapshot must be the position its moves produce", () => {
  const start = newGame(), next = play(start, 0);
  assert.equal(isConsistentSnapshot(next), true);
  const board = [...next.board]; board[40] = WHITE;
  assert.equal(reconcileGame(start, 1, { ...next, board }, 2).kind, "conflict");
  assert.equal(reconcileGame(start, 1, { ...next, komi: 100 }, 2).kind, "conflict");
  assert.equal(reconcileGame(start, 1, { ...next, status: "finished", result: "B+R" }, 2).kind, "conflict");
  assert.equal(reconcileGame(start, 1, { ...next, agreed: null }, 2).kind, "conflict");
  // A count is finished only when both agreed and the result matches the board.
  let scored = answerEndProposal(proposeEnd(next, BLACK), WHITE, true);
  scored = agreeScore(agreeScore(scored, BLACK), WHITE);
  assert.equal(isConsistentSnapshot(scored), true);
  assert.equal(isConsistentSnapshot({ ...scored, result: "W+80.0" }), false);
  assert.equal(isConsistentSnapshot({ ...scored, agreed: { black: true, white: false } }), false);
});

test("a device that has synced rejects stones or agreements claimed in its name", () => {
  const start = newGame(), mine = play(start, 0), theirs = play(mine, 1);
  // Black's device adopts White's reply, but never a Black stone it did not play.
  assert.equal(reconcileGame(mine, 1, theirs, 2, { localColor: BLACK }).kind, "adopt");
  assert.equal(reconcileGame(start, 1, mine, 2, { localColor: BLACK }).kind, "conflict");
  const resigned = play(theirs, "resign"); // Black to move, so Black "resigns"
  assert.equal(reconcileGame(theirs, 2, resigned, 3, { localColor: BLACK }).kind, "conflict");
  assert.equal(reconcileGame(theirs, 2, resigned, 3, { localColor: WHITE }).kind, "adopt");
  // A fresh device (revision 0) still takes over its seat's moves from the friend.
  assert.equal(reconcileGame(start, 0, theirs, 2, { localColor: BLACK }).kind, "adopt");
  const counting = answerEndProposal(proposeEnd(theirs, BLACK), WHITE, true);
  const agreedForBlack = agreeScore(agreeScore(counting, WHITE), BLACK);
  assert.equal(reconcileGame(counting, 3, agreedForBlack, 5, { localColor: BLACK }).kind, "conflict");
  assert.equal(reconcileGame(agreeScore(counting, BLACK), 4, agreedForBlack, 5, { localColor: BLACK }).kind, "adopt");
});

test("the address bar names only the room; seat keys never appear in it", () => {
  const room = "1".repeat(32);
  assert.equal(roomUrl("https://miego.example", room), "https://miego.example/?room=" + room);
  assert.throws(() => roomUrl("https://miego.example", "bad"));
});

test("only new sign-ins of the other seat on another device are reported", () => {
  // A device that has never seen the count records it without a notice.
  assert.deepEqual(newPeerSignins({ owner: 2, guest: 1 }, "owner", null), { seen: 1, notify: false });
  assert.deepEqual(newPeerSignins({ owner: 2, guest: 1 }, "owner", 1), { seen: 1, notify: false });
  assert.deepEqual(newPeerSignins({ owner: 2, guest: 2 }, "owner", 1), { seen: 2, notify: true });
  // The guest hears about the owner's seat, not its own.
  assert.deepEqual(newPeerSignins({ owner: 3, guest: 9 }, "guest", 2), { seen: 3, notify: true });
  assert.deepEqual(newPeerSignins({ owner: "x" }, "guest", 2), { seen: 2, notify: false });
});

test("the inviter's 石を隠す reaches a guest who has not received the game yet",()=>{
  const host=newGame(true,{hideStones:true}), guest=newGame();
  const adopted=reconcileGame(guest,0,host,0,{localIsOwner:false});
  assert.equal(adopted.kind,"adopt");
  assert.equal(adopted.game.hideStones,true);
  assert.equal(reconcileGame(host,0,guest,0,{localIsOwner:true}).kind,"send");
  assert.equal(isConsistentSnapshot(play(host,0)),true);
});
test("a friend game's 持ち時間 is the inviter's, and only the player out of time calls it",()=>{
  const timeControl={main:300,byoyomi:30};
  const host=newGame(true,{timeControl}), guest=newGame();
  const adopted=reconcileGame(guest,0,host,0,{localIsOwner:false});
  assert.equal(adopted.kind,"adopt");
  assert.deepEqual(adopted.game.timeControl,timeControl);
  assert.equal(reconcileGame(host,0,guest,0,{localIsOwner:true}).kind,"send");
  // A loss on time has no move: the side to move ran out.
  const moved={...play(host,0),clock:{black:290000,white:300000}};
  const out=loseOnTime(moved,WHITE);
  assert.equal(isConsistentSnapshot(out),true);
  assert.equal(isConsistentSnapshot({...out,result:"W+T"}),false);
  assert.equal(isConsistentSnapshot({...loseOnTime(play(newGame(),0),WHITE)}),false);
  // White's device calls White's time; Black's device cannot.
  assert.equal(isPeerAction({type:"time_out",color:WHITE},moved,{peerColor:WHITE}),true);
  assert.equal(isPeerAction({type:"time_out",color:WHITE},moved,{peerColor:BLACK}),false);
  assert.equal(reconcileGame(moved,1,out,2,{localColor:WHITE}).kind,"conflict");
  assert.equal(reconcileGame(moved,1,out,2,{localColor:BLACK}).kind,"adopt");
});

test("もう一局 waits for the other player, then starts the same settings as a newer game both boards adopt",async()=>{
  const {requestRematch,roundOf}=await import("../public/p2p-session.mjs");
  const settings={size:13,rules:"japanese",timeControl:{main:600,byoyomi:30,periods:1}};
  const finished=play(play(newGame(true,settings),0),"resign");
  assert.equal(finished.status,"finished");
  assert.throws(()=>requestRematch(newGame(),BLACK));

  const asked=requestRematch(finished,BLACK);
  assert.deepEqual(asked.rematchRequest,{from:BLACK});
  assert.equal(requestRematch(asked,BLACK),asked,"pressing again changes nothing");
  assert.equal(isConsistentSnapshot(asked),true);

  const next=requestRematch(asked,WHITE);
  assert.equal(next.status,"playing");
  assert.equal(next.moveNumber,0);
  assert.equal(next.board.length,169);
  assert.equal(next.rules,"japanese");
  assert.deepEqual(next.timeControl,finished.timeControl);
  assert.equal(next.rematchRequest,undefined);
  assert.equal(roundOf(next),1);
  assert.equal(roundOf(requestRematch(requestRematch(play(next,"resign"),WHITE),BLACK)),2);

  // A device that missed the agreement takes the new game, and the one that has it sends it.
  assert.deepEqual(reconcileGame(asked,4,next,5),{kind:"adopt",game:next,revision:5});
  assert.equal(reconcileGame(next,5,asked,4).kind,"send");
  // Black's request crossed with white's: each side starts it, so both hold the same game.
  const crossed=requestRematch(requestRematch(finished,WHITE),BLACK);
  assert.equal(reconcileGame(next,5,crossed,5).kind,"equal");
  assert.equal(isPeerAction({type:"rematch",color:WHITE},asked,{peerColor:WHITE}),true);
  assert.equal(isPeerAction({type:"rematch",color:BLACK},asked,{peerColor:WHITE}),false);
});
