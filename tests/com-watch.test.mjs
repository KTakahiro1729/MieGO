import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {renderIndex} from "../scripts/build-html.mjs";

const app=readFileSync(new URL("../public/app.mjs",import.meta.url),"utf8");
const html=await renderIndex();
const choices=name=>[...html.matchAll(new RegExp('name="'+name+'" value="([a-z]+)"',"g"))].map(m=>m[1]);
const body=name=>app.slice(app.indexOf("function "+name+"("),app.indexOf("\n}\n",app.indexOf("function "+name+"(")));
const between=(from,to)=>html.slice(html.indexOf(from),html.indexOf(to,html.indexOf(from)));

test("対COM's 自分の石 is 対友人's choices plus 観戦",()=>{
  // UX policy: the same ランダム／● 黒／○ 白 in both, and 対COM adds 観戦 at the end.
  assert.deepEqual(choices("aiSide"),[...choices("onlineSide"),"watch"]);
  assert.match(app,/const SIDE_CHOICES=\["random","black","white","watch"\];/);
});

test("a running AI game can switch to watching from the 対COM sheet",()=>{
  const ai=between('id="aiSetup"','</section>');
  assert.match(ai,/id="watchCurrent" class="secondary full" type="button" hidden/);
  assert.match(body("watchCurrentGame"),/watching=true;[\s\S]*save\(\);[\s\S]*requestAnalysis\(\);/);
  // Only an AI game still being played, and not already watched, offers it.
  assert.match(app,/\$\("watchCurrent"\)\.hidden=kind!=="ai" \|\| !!room \|\| gameMode!=="ai" \|\| watching \|\|/);
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
  assert.match(body("takeOverWatchedGame"),/stopAiTurn\(\);[\s\S]*watching=false;[\s\S]*humanColor=color;[\s\S]*save\(\);/);
});

test("a watched game is saved and resumed as watched",()=>{
  assert.match(app,/watch:gameMode==="ai" && watching,watchAi\}/);
  assert.match(app,/watching=mode==="ai" && record\?\.watch===true;/);
});

test("each COM of a watched game plays with its own strength and personality",()=>{
  // The move is chosen with the settings of the colour to play.
  assert.match(body("finishAiMove"),/const com=watching\?watchAi\[game\.next===BLACK\?"black":"white"\]/);
  assert.match(body("finishAiMove"),/invasion:com\.invasion,reinforcement:com\.reinforcement,strength:com\.strength/);
  // Both COMs' sliders show at once while watching; nothing toggles which one they set.
  for(const id of ["aiStrength","aiInvasion","aiReinforcement"])
    assert.match(html,new RegExp('id="'+id+'White"'));
  assert.doesNotMatch(html,/name="comTarget"/);
  assert.match(app,/\$\("aiInvasionWhiteRow"\)\.hidden=\$\("aiReinforcementWhiteRow"\)\.hidden=!two;/);
  // The COM left playing after a take-over keeps its own settings.
  assert.match(body("takeOverWatchedGame"),/=watchAi\[color===BLACK\?"white":"black"\]/);
});
