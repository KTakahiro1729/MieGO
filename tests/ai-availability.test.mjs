
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
test("AI games are strictly KataGo-only",()=>{
 const app=readFileSync(new URL("../public/app.mjs",import.meta.url),"utf8");
 const worker=readFileSync(new URL("../src/katago/neural-worker.ts",import.meta.url),"utf8");
 assert.match(app,/katagoReady/);
 assert.match(app,/result\.kind\s*===\s*"availability"/);
 assert.doesNotMatch(app,/chooseFallbackMove/);
 assert.match(worker,/kind: "availability", available: true/);
});
test("the player can move while KataGo is still loading",async()=>{
 const {TEXT}=await import("../public/texts.mjs");
 const app=readFileSync(new URL("../public/app.mjs",import.meta.url),"utf8");
 const humanTurn=app.match(/const isHumanTurn = [^;]+;/s)[0];
 assert.doesNotMatch(humanTurn,/katagoReady/);
 // The AI answers once the model reports it is ready.
 assert.match(app,/katagoReady=true;[\s\S]{0,200}if\(isAiTurn\(\)/);
 assert.match(app,/function preparingNotice\(\)/);
 for(const key of ["preparingAi","preparingAiTurn","preparingOverlay"])assert.ok(TEXT.endgame[key]);
});
