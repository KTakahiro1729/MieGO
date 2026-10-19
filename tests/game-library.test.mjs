import test from "node:test";
import assert from "node:assert/strict";
import {GameLibrary} from "../public/game-library.mjs";
import {newGame,play,BLACK} from "../public/core.mjs";
class MemoryStorage {
  constructor(){this.items=new Map();}
  get length(){return this.items.size;}
  key(i){return [...this.items.keys()][i]??null;}
  getItem(k){return this.items.has(k)?this.items.get(k):null;}
  setItem(k,v){this.items.set(k,String(v));}
}
const setup=()=>{
 const storage=new MemoryStorage();
 let counter=0,clock=0;
 const lib=new GameLibrary(storage,()=>`game-test-${++counter}`,()=>new Date(Date.UTC(2026,0,1,0,0,++clock)).toISOString());
 return {lib,storage};
};
test("each new game creates an independent record and latest first ordering",()=>{
 const {lib}=setup();
 const first=lib.save({mode:"local",snapshot:play(newGame(),40)});
 const second=lib.save({mode:"local",snapshot:newGame()});
 assert.notEqual(first.id,second.id);
 assert.equal(lib.load(first.id).snapshot.moveNumber,1);
 assert.deepEqual(lib.list().map(x=>x.id),[second.id,first.id]);
 lib.setActive("local",second.id);
 assert.equal(lib.active("local").id,second.id);
});
test("AI saves retain own parameters separately from local",()=>{
 const {lib}=setup();
 const local=lib.save({mode:"local",snapshot:newGame()});
 const ai=lib.save({mode:"ai",snapshot:play(newGame(),40),humanColor:-1,
   aiLevel:"gentle",invasion:75,reinforcement:35});
 lib.setActive("local",local.id);
 lib.setActive("ai",ai.id);
 assert.equal(lib.active("local").mode,"local");
 assert.equal(lib.active("ai").humanColor,-1);
 assert.equal(lib.active("ai").snapshot.moveNumber,1);
});
test("confirmed updates replace one record without mutating an older snapshot",()=>{
 const {lib}=setup();
 const old=newGame(false);
 const a=lib.save({mode:"local",snapshot:old});
 const next=lib.save({id:a.id,mode:"local",snapshot:play(old,40)},a.revision);
 assert.equal(next.revision,2);
 assert.equal(lib.load(a.id).snapshot.moveNumber,1);
 assert.equal(old.board[40],0);
 assert.throws(()=>lib.save({id:a.id,mode:"local",snapshot:old},a.revision),/別のタブ/);
});
test("online matches are archived locally, not marked as resumable active games",()=>{
 const {lib}=setup();
 const r=lib.save({mode:"online",roomId:"a".repeat(32),snapshot:play(newGame(),40),seat:"guest"});
 assert.equal(lib.load(r.id).seat,"guest");
 assert.equal(lib.active("online"),null);
 assert.equal(lib.load(r.id).snapshot.board[40],BLACK);
 assert.throws(()=>lib.save({mode:"online",snapshot:newGame()}),/ルームID/);
});
test("migrate legacy snapshots once without deleting original keys",()=>{
 const {lib,storage}=setup();
 storage.setItem("miego-local",JSON.stringify(play(newGame(false),12)));
 storage.setItem("miego-game-ai",JSON.stringify(play(newGame(),40)));
 storage.setItem("miego-local-settings",JSON.stringify({humanColor:-1,aiLevel:"gentle"}));
 lib.migrateLegacy();
 assert.equal(lib.list().length,2);
 assert.equal(lib.active("local").snapshot.assisted,false);
 assert.equal(lib.active("ai").humanColor,-1);
 assert.equal(lib.active("ai").snapshot.moveNumber,1);
 const firstIds=lib.list().map(x=>x.id);
 lib.migrateLegacy();
 assert.deepEqual(lib.list().map(x=>x.id),firstIds);
 assert.ok(storage.getItem("miego-local"));
});
test("invalid records cannot be loaded or indexed as games",()=>{
 const {lib,storage}=setup();
 storage.setItem("miego:game:v1:fake-0000","bad json");
 storage.setItem("miego:game:v1:fake-1111",JSON.stringify({version:1,id:"fake-1111",mode:"local",snapshot:{}}));
 assert.deepEqual(lib.list(),[]);
 assert.equal(lib.load("fake-0000"),null);
 assert.equal(lib.active("local"),null);
});

test("imported SGF records are read-only and keep source metadata",()=>{
 const {lib}=setup();
 const imported=lib.save({mode:"local",snapshot:play(newGame(),40),source:"sgf",
   sgfMeta:{komi:"6.5",rules:"Japanese",result:"W+R",blackName:"B",whiteName:"W"}});
 const fetched=lib.load(imported.id);
 assert.equal(fetched.source,"sgf");
 assert.equal(fetched.sgfMeta.komi,"6.5");
 assert.equal(fetched.sgfMeta.result,"W+R");
 assert.equal(lib.active("local"),null);
 const normal=lib.save({mode:"local",snapshot:newGame()});
 assert.equal(normal.source,"played");
 assert.equal(normal.sgfMeta,null);
});
test("SGF import/replay is exposed in saved game sheet without changing live game",async()=>{
 const {readFileSync}=await import("node:fs");
 const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
 const app=readFileSync(new URL("../public/app.mjs",import.meta.url),"utf8");
 for(const id of ["historyImportFile","historyExport","historyFirst","historyPrevious",
  "historyNext","historyLast","historyStepRange","historyBranch"]){
  assert.match(html,new RegExp('id="'+id+'"'));
 }
 assert.match(app,/source==="sgf"/);
 assert.match(app,/gameLibrary\.save\(\{mode:"local",snapshot:parsed\.snapshot,source:"sgf"/);
 assert.match(app,/forkReview\(selected\.snapshot,historyStep\)/);
 assert.match(app,/replaySteps\(record\.snapshot,historyStep\)/);
});

test("AI resumption distinguishes model initialization, a pending AI move and model failure",async()=>{
 const {readFileSync}=await import("node:fs");
 const app=readFileSync(new URL("../public/app.mjs",import.meta.url),"utf8");
 assert.match(app,/!katagoReady\?"AIを準備中/);
 assert.match(app,/KataGoの準備ができるまで待機中/);
 assert.match(app,/AI対局を停止しました/);
 assert.match(app,/gameMode=record.mode;game=JSON\.parse\(JSON\.stringify\(record\.snapshot\)\)/);
});

test("phase-two sheet keeps scoring UX, contextual feedback, and keyboard focus",async()=>{
 const {readFileSync}=await import("node:fs");
 const h=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
 const a=readFileSync(new URL("../public/app.mjs",import.meta.url),"utf8");
 const css=readFileSync(new URL("../public/style.css",import.meta.url),"utf8");
 for(const id of ["historyActionNotice","historySaveNotice","scoringActions","openCurrentMode","historyStepRange"])
   assert.match(h,new RegExp('id="'+id+'"'));
 assert.match(a,/\$\("openCurrentMode"\)\.onclick/);
 assert.match(a,/\$\("historyBack"\)\.focus\(\)/);
 assert.match(a,/\$\("gameMenu"\)\.querySelector\("summary"\)\.focus\(\)/);
 assert.match(a,/\$\("historyActionNotice"\)\.textContent="SGFを書き出しました/);
 assert.match(css,/\.history-back\{min-height:44px\}/);
});
