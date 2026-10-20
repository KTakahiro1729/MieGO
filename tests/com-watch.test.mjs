import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {renderIndex} from "../scripts/build-html.mjs";

const app=readFileSync(new URL("../public/app.mjs",import.meta.url),"utf8");
const html=await renderIndex();
const choices=name=>[...html.matchAll(new RegExp('name="'+name+'" value="([a-z]+)"',"g"))].map(m=>m[1]);
const between=(from,to)=>html.slice(html.indexOf(from),html.indexOf(to,html.indexOf(from)));

test("COM同士 is its own 対局者 row, so 自分の石 stays the same as with a friend",()=>{
  // UX policy: 対COM and 対友人 offer the same ランダム／● 黒／○ 白.
  assert.deepEqual(choices("aiSide"),choices("onlineSide"));
  assert.deepEqual(choices("aiPlayers"),["human","watch"]);
  assert.ok(html.indexOf('id="aiPlayersRow"')<html.indexOf('id="aiSideRow"'));
  // The row shows with the other 対COM rows only.
  assert.match(app,/\$\("aiSideRow"\)\.hidden=\$\("aiPlayersRow"\)\.hidden=/);
});

test("a watched game swaps the playing controls for take-over and pause in the same row",()=>{
  const row=between('id="actionRow"','id="illegalPromptFallbackPanel"');
  for(const id of ["watchTakeBlack","watchTakeWhite","watchToggle"])
    assert.match(row,new RegExp('id="'+id+'" class="(secondary|primary)" type="button"[^>]* hidden'));
  // One gold button per row, and it is the rightmost of the watch controls.
  assert.match(row,/id="watchToggle" class="primary"/);
  assert.ok(row.indexOf('id="watchTakeWhite"')<row.indexOf('id="watchToggle"'));
  assert.match(app,/if\(watchingPlay\)for\(const id of \["cancel","confirm","pass","resign"\]\)\$\(id\)\.hidden=true;/);
});

test("the human never plays, and the AI plays both colours, while watching",()=>{
  assert.match(app,/const isAiTurn = \(\) => [^;]*\(watching \|\| game\.next === -humanColor\)/);
  assert.match(app,/const isHumanTurn = [^;]*!watching && game\.next === humanColor/);
  // Taking a colour over drops a move being computed for it and ends the watching.
  assert.match(app,/function takeOverWatchedGame\(color\) \{[^}]*stopAiTurn\(\);[^}]*watching=false;[^}]*humanColor=color;[^}]*save\(\);/);
});

test("the 対局者 choice is remembered with the other settings, alphabetically",()=>{
  const remembered=app.slice(app.indexOf("function rememberSettings"),app.indexOf("}));",app.indexOf("function rememberSettings")));
  const keys=[...remembered.matchAll(/^\s+([a-zA-Z]+)[:,]/gm)].map(m=>m[1]);
  assert.ok(keys.includes("aiWatch"));
  assert.deepEqual(keys,[...keys].sort());
  assert.match(app,/aiWatchChoice=settings\.aiWatch===true;/);
});
