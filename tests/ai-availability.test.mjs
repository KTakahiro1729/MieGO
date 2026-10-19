import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("AI matches require KataGo and never fall back to approximate AI moves", () => {
  const app=readFileSync(new URL("../public/app.mjs", import.meta.url),"utf8");
  const neural=readFileSync(new URL("../src/katago/neural-worker.ts", import.meta.url),"utf8");
  assert.match(app, /!katagoReady \|\| fallbackMode/);
  assert.match(app, /result\.kind === "availability"/);
  assert.doesNotMatch(app, /chooseFallbackMove/);
  assert.match(neural, /kind: "availability", available: true/);
});
