import test from "node:test";
import assert from "node:assert/strict";
import { isQuotaError } from "../public/game-library.mjs";
import { MemoryStorage, testLibrary } from "./helpers/storage.mjs";
import { OwnershipStore } from "../public/ownership-store.mjs";
import { replayLine, prefetchOrder } from "../public/ownership-prefetch.mjs";
import { boardThumbnailSvg } from "../public/board-thumbnail.mjs";
import { replaySteps } from "../public/sgf.mjs";
import { newGame, play, boardHash, at } from "../public/core.mjs";

let longGame=newGame();
for(const p of [0,10,20,30,40,50,60,70])longGame=play(longGame,p);

test("a full storage deletes the oldest games that are not favourites", () => {
  const removed=[];
  const {lib,storage}=testLibrary(Infinity,{onRemove:record=>removed.push(record.id)});
  const first=lib.save({mode:"local",snapshot:longGame});
  const second=lib.save({mode:"local",snapshot:longGame});
  const third=lib.save({mode:"local",snapshot:longGame});
  lib.setFavorite(first.id,true);
  storage.limit=storage.used()+100; // room for no further game
  const fourth=lib.save({mode:"local",snapshot:longGame});
  assert.deepEqual(removed,[second.id],"the oldest non-favourite goes first");
  assert.deepEqual(lib.list().map(r=>r.id).sort(),[first.id,third.id,fourth.id].sort());
  assert.equal(lib.load(first.id).favorite,true);
});

test("active, kept and favourite games are never deleted; nothing else to delete still fails", () => {
  const {lib,storage}=testLibrary(Infinity,{keep:()=>["game-test-2"]});
  const active=lib.save({mode:"local",snapshot:longGame});
  lib.setActive("local",active.id);
  lib.save({mode:"ai",snapshot:longGame}); // game-test-2, kept by the app
  const favourite=lib.save({mode:"local",snapshot:longGame});
  lib.setFavorite(favourite.id,true);
  storage.limit=storage.used()+100;
  assert.throws(()=>lib.save({mode:"local",snapshot:longGame}),error=>isQuotaError(error));
  assert.equal(lib.list().length,3);
});

test("marking a favourite changes neither the order nor the revision, and saves keep it", () => {
  const {lib}=testLibrary();
  const older=lib.save({mode:"local",snapshot:newGame()});
  const newer=lib.save({mode:"local",snapshot:newGame()});
  const marked=lib.setFavorite(older.id,true);
  assert.equal(marked.revision,older.revision);
  assert.deepEqual(lib.list().map(r=>r.id),[newer.id,older.id]);
  const resaved=lib.save({id:older.id,mode:"local",snapshot:play(newGame(),40)},older.revision);
  assert.equal(resaved.favorite,true);
  assert.equal(lib.setFavorite(older.id,false).favorite,false);
});

test("deleting a game clears an active pointer to it", () => {
  const {lib}=testLibrary();
  const record=lib.save({mode:"local",snapshot:newGame()});
  lib.setActive("local",record.id);
  assert.equal(lib.remove(record.id),true);
  assert.equal(lib.active("local"),null);
  assert.equal(lib.remove(record.id),false);
});

const values=n=>Array.from({length:n},(_,i)=>((i%9)-4)/4);
test("other games keep only their final board's estimate; unsaved games keep none", () => {
  const storage=new MemoryStorage();
  const store=new OwnershipStore(storage);
  const start=newGame(), end=play(start,40);
  store.remember("current-1234",start.board,values(81));
  store.remember("current-1234",end.board,values(81));
  store.remember("other-12345",start.board,values(81));
  store.remember("other-12345",end.board,values(81));
  store.remember("removed-1234",end.board,values(81));
  store.compact("current-1234",new Map([["current-1234",end.board],["other-12345",end.board]]));
  const kept=id=>Object.keys(JSON.parse(storage.getItem("miego:ownership:v1:"+id)||"{}"));
  assert.equal(kept("current-1234").length,2,"the current game keeps every position");
  assert.deepEqual(kept("other-12345"),[boardHash(end.board)],"another game keeps its thumbnail");
  assert.equal(storage.getItem("miego:ownership:v1:removed-1234"),null);
  const fresh=new OwnershipStore(storage);
  assert.ok(fresh.recall("other-12345",end.board));
  assert.equal(fresh.recall("other-12345",start.board),null);
});

test("estimates computed while replaying stay in memory, bounded", () => {
  const storage=new MemoryStorage(), store=new OwnershipStore(storage);
  const board=newGame().board;
  store.keep(board,values(81));
  assert.equal(storage.length,0);
  assert.ok(store.recall(null,board));
  for(let i=0;i<1600;i++)store.keep(Array.from({length:81},(_,j)=>j===i%81?1:(i>>3)%3-1),values(81));
  assert.ok(store.memory.size<=1500);
});

test("background estimates start at the step on screen and spread out", () => {
  assert.deepEqual(prefetchOrder(5,2),[2,3,1,4,0,5]);
  assert.deepEqual(prefetchOrder(3,3),[3,2,1,0]);
  assert.deepEqual(prefetchOrder(0,0),[0]);
  let game=newGame();
  for(const p of [at(2,2),null,at(6,6),null,null])game=play(game,p);
  const states=replayLine(game);
  assert.equal(states.length,game.moves.length+1);
  states.forEach((state,i)=>assert.equal(boardHash(state.board),boardHash(replaySteps(game,i).board)));
});

test("a thumbnail tints each point with its kept estimate", () => {
  const board=play(newGame(),40).board;
  const plain=boardThumbnailSvg(board,40,undefined);
  const tinted=boardThumbnailSvg(board,40,undefined,{ownership:values(81),palette:"mono",opacity:.55});
  const tints=svg=>svg.match(/fill-opacity=/g)?.length??0;
  assert.equal(tints(plain),0);
  assert.equal(tints(tinted),81-9,"neutral points stay clear");
  assert.equal(boardThumbnailSvg(board,40,undefined,{ownership:[1],palette:"mono",opacity:1}),plain);
});
