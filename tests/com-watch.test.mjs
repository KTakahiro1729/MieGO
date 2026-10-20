import test from "node:test";
import assert from "node:assert/strict";
import {renderIndex} from "../scripts/build-html.mjs";
import {source} from "./helpers/source.mjs";

const app=source("app.mjs");
const html=await renderIndex();
const choices=name=>[...html.matchAll(new RegExp('name="'+name+'" value="([a-z]+)"',"g"))].map(m=>m[1]);
const body=name=>app.slice(app.indexOf("function "+name+"("),app.indexOf("\n}\n",app.indexOf("function "+name+"(")));
const between=(from,to)=>html.slice(html.indexOf(from),html.indexOf(to,html.indexOf(from)));

test("対COM's 自分の石 is 対友人's choices plus 観戦",()=>{
  // UX policy: the same ● 黒／ランダム／○ 白 in both, and 対COM adds 観戦 at the end.
  assert.deepEqual(choices("aiSide"),[...choices("onlineSide"),"watch"]);
  assert.deepEqual(choices("onlineSide"),["black","random","white"]);
  assert.match(app,/const SIDE_CHOICES=\["black","random","white","watch"\];/);
});

test("観戦 has one way in: its own button beside the colours, not a wide button",()=>{
  assert.doesNotMatch(html,/id="watchCurrent"/);
  const row=between('id="aiSideRow"','</fieldset>');
  // 黒・ランダム・白, then 観戦 set a little apart, each with its note beside it.
  assert.match(row,/value="white">[^]*?<label class="choice-row watch-choice"><input type="radio" name="aiSide" value="watch"><span class="choice">観戦<\/span><small class="choice-note">/);
  // 対友人 shows the same row with 観戦 greyed out.
  assert.match(between('id="onlineSideRow"','</fieldset>'),/value="watch" disabled>/);
  // With two COMs, the character choices are greyed out and each COM's character is set in 「COMの打ち方」.
  assert.match(body("syncStrengthUi"),/\$\("aiCharacterChoices"\)\.disabled=\$\("aiCustom"\)\.disabled=off;/);
  assert.match(body("syncStrengthUi"),/TEXT\.ai\.strengthInAdvanced/);
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
  assert.match(app,/intervening=false;watchReturning=true;lastWatchMoveAt=performance\.now\(\)\+WATCH_RESUME_MS-WATCH_STEP_MS;/);
  // During that pause the turn line says watching is about to resume, until the next COM move is asked for.
  assert.match(app,/spectating\?\(watchReturning && !watchPaused && !intervening\?TEXT\.game\.watchReturning:/);
  assert.match(body("watchDue"),/if\(wait<=0\)\{watchReturning=false;return true;\}/);
});

test("a watched game is saved and resumed as watched",()=>{
  assert.match(app,/watch:gameMode==="ai" && watching,watchAi\}/);
  assert.match(app,/watching=mode==="ai" && record\?\.watch===true;/);
});

test("each COM of a watched game plays with its own character",()=>{
  // The move is chosen with the settings of the colour to play.
  assert.match(app,/const comToMove = \(\) => watching \? watchAi\[game\.next===BLACK\?"black":"white"\] : aiCom;/);
  assert.match(body("finishAiMove"),/const com=comToMove\(\);/);
  assert.match(body("finishAiMove"),/choosePolicyMove\(game,result\.policy,result\.passLogit,\{\s*\.\.\.com,/);
  // 「COMの打ち方」 under the COMのキャラ tab holds one card per COM, shown only for two COMs:
  // a character, and カスタム's strength and four style rows.
  const advanced=between('id="watchAiOptions"','id="setupPanelBoard"');
  const cards=[...advanced.matchAll(/<fieldset class="com-card">([\s\S]*?)<\/fieldset>/g)].map(m=>m[1]);
  assert.equal(cards.length,2);
  for(const [card,side] of [[cards[0],"Black"],[cards[1],"White"]]){
    assert.match(card,new RegExp('<select id="com'+side+'Character"'));
    assert.deepEqual([...card.matchAll(/name="(com[A-Za-z]+)"/g)].map(m=>m[1]).filter((v,i,a)=>a.indexOf(v)===i),
      ["Strength","Stance","Height","Tenuki"].map(field=>"com"+side+field));
  }
  assert.deepEqual(choices("comBlackStrength"),["beginner","easy","normal","strong","strongest"]);
  assert.deepEqual([...cards[0].matchAll(/<option value="([a-z]+)"/g)].map(m=>m[1]),
    ["chick","steady","raider","brawler","wide","serious","master","custom"]);
  assert.match(app,/\$\("watchAiOptions"\)\.hidden=\$\("aiOptionsMore"\)\.hidden=!two;/);
  // The COM left playing after a take-over keeps its own settings.
  assert.match(body("takeOverWatchedGame"),/=watchAi\[color===BLACK\?"white":"black"\]/);
});
