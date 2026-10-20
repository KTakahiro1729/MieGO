
import test from "node:test";
import assert from "node:assert/strict";
import {source} from "./helpers/source.mjs";
test("AI games are strictly KataGo-only",()=>{
 const app=source("app.mjs");
 const worker=source("../src/katago/neural-worker.ts");
 assert.match(app,/katagoReady/);
 assert.match(app,/result\.kind\s*===\s*"availability"/);
 assert.doesNotMatch(app,/chooseFallbackMove/);
 assert.match(worker,/kind: "availability", available: true/);
});
test("the player can move while KataGo is still loading",async()=>{
 const app=source("app.mjs");
 const humanTurn=app.match(/const isHumanTurn = [^;]+;/s)[0];
 assert.doesNotMatch(humanTurn,/katagoReady/);
 // The AI answers once the model reports it is ready.
 assert.match(app,/katagoReady=true;[\s\S]{0,200}if\(isAiTurn\(\)/);
 // Loading is brief, so the turn label and status read as usual meanwhile.
 assert.doesNotMatch(app,/TEXT\.game\.aiPreparing|preparingNotice/);
});
