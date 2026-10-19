import test from "node:test";
import assert from "node:assert/strict";
import { newGame, play, BLACK, WHITE } from "../public/core.mjs";
import { selectColor, playerColor, readCheckpoint, saveCheckpoint, reconcileGame, guestUrl, ownUrl } from "../public/p2p-session.mjs";

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
