
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
