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

test("while watching, the row holds 一時停止 alone; stepping in brings back × and ここに打つ",()=>{
  const row=between('id="actionRow"','id="illegalPromptFallbackPanel"');
  assert.match(row,/id="watchToggle" class="primary" type="button"[^>]* hidden/);
  assert.doesNotMatch(row,/watchTake/);
  const view=body("show");
  assert.match(view,/\$\("watchToggle"\)\.hidden=!watchingPlay \|\| intervening;/);
  assert.match(view,/if\(watchingPlay && !intervening\)for\(const id of \["cancel","confirm"\]\)\$\(id\)\.hidden=true;/);
});

test("a tap while watching steps in; ここに打つ takes the colour over and × resumes watching",()=>{
  // The COMs play both colours unless the viewer has stepped in, and the viewer plays only then.
  assert.match(app,/const isAiTurn = \(\) => [^;]*\(watching \? !intervening : game\.next === -humanColor\)/);
  assert.match(app,/const isHumanTurn = [^;]*\(watching \? intervening : game\.next === humanColor\)/);
  // A tap on an empty point while watching stops the COM's pending move and steps in.
  assert.match(app,/isWatching\(\) && !intervening[^{]*game\.board\[position\]===0\)\{\s*stopAiTurn\(\);[^\n]*\n\s*intervening=true;/);
  // ここに打つ hands the side to move to the viewer before the stone is played.
  assert.match(app,/if\(isWatching\(\) && intervening\)takeOverWatchedGame\(game\.next\);\s*submitMove\(position\);/);
  assert.match(body("takeOverWatchedGame"),/stopAiTurn\(\);[\s\S]*watching=false;[\s\S]*humanColor=color;[\s\S]*save\(\);/);
  // × ends the step-in, and the COMs wait a little longer than between moves.
  assert.match(app,/intervening=false;lastWatchMoveAt=performance\.now\(\)\+WATCH_RESUME_MS-WATCH_STEP_MS;/);
});

test("a watched game is saved and resumed as watched",()=>{
  assert.match(app,/watch:gameMode==="ai" && watching,watchAi\}/);
  assert.match(app,/watching=mode==="ai" && record\?\.watch===true;/);
});

test("each COM of a watched game plays with its own strength and personality",()=>{
  // The move is chosen with the settings of the colour to play.
  assert.match(body("finishAiMove"),/const com=watching\?watchAi\[game\.next===BLACK\?"black":"white"\]/);
  assert.match(body("finishAiMove"),/invasion:com\.invasion,reinforcement:com\.reinforcement,strength:com\.strength/);
  // 「AIの強さ」 stays one bar; 詳細設定 holds one card per COM, shown only for two COMs.
  const advanced=between('id="newGameAdvanced"','</details>');
  const cards=[...advanced.matchAll(/<fieldset class="com-card">([\s\S]*?)<\/fieldset>/g)].map(m=>m[1]);
  assert.equal(cards.length,2);
  for(const [card,side] of [[cards[0],"Black"],[cards[1],"White"]])
    assert.deepEqual([...card.matchAll(/name="(com[A-Za-z]+)"/g)].map(m=>m[1]).filter((v,i,a)=>a.indexOf(v)===i),
      ["com"+side+"Strength","com"+side+"Invasion","com"+side+"Reinforcement"]);
  assert.deepEqual(choices("comBlackStrength"),["beginner","easy","normal","strong"]);
  assert.match(app,/\$\("watchAiOptions"\)\.hidden=!two;/);
  // The COM left playing after a take-over keeps its own settings.
  assert.match(body("takeOverWatchedGame"),/=watchAi\[color===BLACK\?"white":"black"\]/);
});
