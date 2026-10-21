import { createScoreGraph } from "../public/review-estimates.mjs";
import { newGame } from "../public/core.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {renderIndex} from "../scripts/build-html.mjs";
import {source} from "./helpers/source.mjs";

const app=source("app.mjs");
const html=await renderIndex();
const choices=name=>[...html.matchAll(new RegExp('name="'+name+'" value="([a-z]+)"',"g"))].map(m=>m[1]);
const body=name=>app.slice(app.indexOf("function "+name+"("),app.indexOf("\n}\n",app.indexOf("function "+name+"(")));
const between=(from,to)=>html.slice(html.indexOf(from),html.indexOf(to,html.indexOf(from)));

test("観戦 is a mode beside 対COM; its first tab is the speed of the moves",()=>{
  // UX policy: 対COM and 対友人 share ● 黒／ランダム／○ 白; 観戦 has no side, so it is not among them.
  assert.deepEqual(choices("aiSide"),choices("onlineSide"));
  assert.deepEqual(choices("onlineSide"),["black","random","white"]);
  assert.match(app,/const SIDE_CHOICES=\["black","random","white"\];/);
  assert.deepEqual(choices("newGameMode"),["history","ai","watch","online","local"]);
  assert.doesNotMatch(html,/name="onlineWatch"|value="watch" disabled/);
  // 観戦 starts a COM game, so the sheet treats it as 対COM, with the choice kept apart from the colour.
  assert.match(app,/return kind==="watch"\?"ai":kind;/);
  assert.match(app,/watchChoice=e\.target\.value==="watch";rememberSettings\(\);/);
  // 観戦's speed sits under the 時間 tab: three paces, applied to a running game too.
  assert.deepEqual(choices("watchSpeed"),["slow","normal","fast"]);
  assert.match(app,/const WATCH_STEP_MS = \{fast:250, normal:1100, slow:2200\};/);
  assert.match(body("watchDue"),/lastWatchMoveAt\+watchStep\(\)-performance\.now\(\)/);
  assert.match(body("showNewGameMode"),/\$\("watchSpeedChoices"\)\.disabled=!watch;/);
  assert.match(html,/id="setupPanelTime"[^>]*>[\s\S]*id="timeControlSetup"[\s\S]*id="watchSpeedRow"/);
  // Settings saved while 観戦 was a side choice open as 観戦.
  assert.match(app,/watchChoice=settings\.watch===true \|\| settings\.aiSide==="watch";/);
});

test("while watching, the row holds 介入する and 一時停止; stepping in brings back × and ここに打つ",()=>{
  const row=between('id="actionRow"','id="illegalPromptFallbackPanel"');
  assert.match(row,/id="watchIntervene" class="secondary" type="button" hidden>介入する<\/button>\s*<button id="watchToggle" class="primary" type="button"[^>]* hidden/);
  const view=body("show");
  assert.match(view,/\$\("watchToggle"\)\.hidden=\$\("watchIntervene"\)\.hidden=!watchingPlay \|\| intervening;/);
  assert.match(view,/if\(watchingPlay && !intervening\)for\(const id of \["cancel","confirm"\]\)\$\(id\)\.hidden=true;/);
});

test("介入する steps in; only then the board takes a stone; ここに打つ takes the colour over and × resumes watching",()=>{
  // The COMs play both colours unless the viewer has stepped in, and the viewer plays only then.
  assert.match(app,/const isAiTurn = \(\) => [^;]*\(watching \? !intervening : game\.next === -humanColor\)/);
  assert.match(app,/const isHumanTurn = [^;]*\(watching \? intervening : game\.next === humanColor\)/);
  // A tap on the board no longer steps in by itself; 介入する stops the COM's pending move.
  assert.doesNotMatch(app,/isWatching\(\) && !intervening[^{]*game\.board\[position\]===0\)/);
  const intervene=app.slice(app.indexOf('$("watchIntervene").onclick'),app.indexOf('$("watchToggle").onclick'));
  assert.match(intervene,/stopAiTurn\(\);[^\n]*\n\s*intervening=true;watchReturning=false;/);
  // ここに打つ hands the side to move to the viewer before the stone is played.
  assert.match(app,/if\(isWatching\(\) && intervening\)takeOverWatchedGame\(game\.next\);\s*submitMove\(position\);/);
  assert.match(body("takeOverWatchedGame"),/stopAiTurn\(\);[\s\S]*setWatching\(false\);[\s\S]*humanColor=color;[\s\S]*save\(\);/);
  // × ends the step-in, with or without a provisional stone, and the COMs wait a little longer than between moves.
  assert.match(app,/intervening=false;watchReturning=!watchPaused;lastWatchMoveAt=performance\.now\(\)\+WATCH_RESUME_MS-watchStep\(\);/);
  assert.match(body("show"),/\$\("cancel"\)\.disabled=!provisional && !takeBack && !stepIn;/);
  // During that pause the turn line says watching is about to resume, until the next COM move is asked for.
  assert.match(app,/spectating\?\(watchReturning && !watchPaused && !intervening\?TEXT\.game\.watchReturning:/);
  assert.match(body("watchDue"),/if\(wait<=0\)\{watchReturning=false;return true;\}/);
});

test("採点を始める works while a COM is thinking: it stops the watched game and asks",()=>{
  const propose=app.slice(app.indexOf('$("endPropose").onclick'),app.indexOf("function answerTakebackRequest"));
  assert.match(propose,/if\(isWatching\(\)\)\{stopAiTurn\(\);[^}]*\}\s*if\(!room\)\{\s*if\(aiThinking\)return;/);
});

test("stepping back through a watched game pauses it and shows the score graph",()=>{
  assert.match(body("enterBoardReview"),/if\(source==="live" && isWatching\(\) && game\.status==="playing"\)\{\s*stopAiTurn\(\);watchPaused=true;/);
  const graph=(status,watching)=>createScoreGraph({getReview:()=>({source:"live",display:newGame()}),
    getGame:()=>({status}),isWatching:()=>watching}).shown();
  assert.equal(graph("playing",true),true);
  assert.equal(graph("playing",false),false);
  assert.equal(graph("finished",false),true);
});

test("a watched game is saved and resumed as watched",()=>{
  assert.match(app,/watch:gameMode==="ai" && watching,watchAi\}/);
  assert.match(app,/setWatching\(mode==="ai" && record\?\.watch===true\);/);
});

test("each COM of a watched game plays with its own character",()=>{
  // The move is chosen with the settings of the colour to play.
  assert.match(app,/const comToMove = \(\) => watching \? watchAi\[sideKey\(game\.next\)\] : aiCom;/);
  assert.match(body("finishAiMove"),/const com=comToMove\(\);/);
  assert.match(body("finishAiMove"),/choosePolicyMove\(game,result\.policy,result\.passLogit,\{\s*\.\.\.com,/);
  // In 観戦 the COMのキャラ tab holds one card per COM in place of the character list:
  // a character, and カスタム's strength, three style rows and 投了.
  const advanced=between('id="watchAiOptions"','id="aiStrengthRow"');
  const cards=[...advanced.matchAll(/<fieldset class="com-card">([\s\S]*?)<\/fieldset>/g)].map(m=>m[1]);
  assert.equal(cards.length,2);
  for(const [card,side] of [[cards[0],"Black"],[cards[1],"White"]]){
    assert.match(card,new RegExp('<select id="com'+side+'Character"'));
    assert.deepEqual([...card.matchAll(/name="(com[A-Za-z]+)"/g)].map(m=>m[1]).filter((v,i,a)=>a.indexOf(v)===i),
      ["Strength","Stance","Height","Tenuki","Resign"].map(field=>"com"+side+field));
  }
  assert.deepEqual(choices("comBlackStrength"),["beginner","easy","normal","strong","strongest"]);
  assert.deepEqual([...cards[0].matchAll(/<option value="([a-z]+)"/g)].map(m=>m[1]),
    ["chick","steady","raider","brawler","wide","serious","master","custom"]);
  assert.match(body("syncWatchSliderRows"),/\$\("watchAiOptions"\)\.hidden=!two;\s*\$\("aiStrengthRow"\)\.hidden=two;/);
  // The COM left playing after a take-over keeps its own settings.
  assert.match(body("takeOverWatchedGame"),/=watchAi\[color===BLACK\?"white":"black"\]/);
});

test("a watched game that nobody is computing a move for asks for it again",()=>{
  // The pause before a move clears its timer when it fires, so a pending timer means a move is coming.
  assert.match(body("watchDue"),/watchTimer=setTimeout\(\(\)=>\{watchTimer=null;requestAnalysis\(\);\},wait\);/);
  const check=app.slice(app.indexOf("const WATCH_STALL_MS"),app.indexOf("},3000);"));
  assert.match(check,/if\(!isWatching\(\) \|\| !isAiTurn\(\) \|\| watchPaused \|\| endExpanded \|\| boardReview \|\| fallbackMode \|\| document\.hidden\)return;/);
  // A small-network move left unanswered is asked for again; 最強 reports its own progress.
  assert.match(check,/if\(!aiJob \|\| aiJob\.strong \|\| performance\.now\(\)-aiJob\.at<WATCH_STALL_MS\)return;\s*stopAiTurn\(\);/);
  assert.match(check,/else if\(watchTimer \|\| !katagoReady && !isGomoku\(game\)\)return;\s*requestAnalysis\(\);/);
  assert.match(app,/aiJob=\{id,number:game\.moveNumber,hash:boardHash\(game\.board\),strong,at:performance\.now\(\)\};/);
});
