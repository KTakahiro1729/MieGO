import test from "node:test";
import assert from "node:assert/strict";
import {BLACK, WHITE, newGame, play} from "../public/core.mjs";
import {endgameBarView, passNotice} from "../public/endgame-bar.mjs";
import {forbiddenLines} from "../public/illegal-moves.mjs";
import {TEXT} from "../public/texts.mjs";

// The advisor has read the position once, and the board is still being played out.
const reading={previous:{move:0},stage:"playing",held:false};
const bar=(options={})=>endgameBarView({game:newGame(),color:BLACK,room:false,connected:true,gameMode:"ai",
  watching:false,endExpanded:false,aiPassAsks:false,katagoReady:true,fallbackMode:false,advisor:reading,
  aiThinking:false,notices:[],keptPlaying:false,illegalCandidate:null,...options});

test("the meter on 採点を始める never claims 'not yet' until KataGo has evaluated a position",()=>{
  // The advice reads as the meter's lit steps and in the button's spoken name, never as a sentence.
  const label=view=>view.attributes.endPropose["aria-label"];
  const loading=bar({katagoReady:false,advisor:{previous:null}});
  assert.equal(loading.text.endStatus,"");
  assert.equal(loading.hidden.endStage,true);
  assert.equal(label(loading),TEXT.endgame.startScoring);
  assert.equal(label(bar({advisor:{previous:null}})),TEXT.endgame.startScoring+"（"+TEXT.endgame.checking+"）");
  assert.equal(label(bar({fallbackMode:true})),TEXT.endgame.startScoring+"（"+TEXT.endgame.unavailable+"）");
  const playing=bar();
  assert.equal(playing.text.endStatus,"");
  assert.equal(playing.hidden.endStage,false);
  assert.equal(playing.attributes.endStage["data-stage"],"1");
});
test("after one pass the bar says who passed, and asks for the second when it is this player's",()=>{
  const passed=play(newGame(),null);
  assert.equal(bar({game:passed,color:WHITE}).text.endStatus,TEXT.endgame.passedAi);
  assert.equal(bar({game:passed,color:WHITE}).classes.endgameBar["is-calling"],true);
  assert.equal(bar({game:passed,color:WHITE,keptPlaying:true}).classes.endgameBar["is-calling"],false);
  assert.equal(bar({game:passed}).text.endStatus,TEXT.endgame.passedSelf);
  assert.equal(bar({game:passed,gameMode:"local"}).text.endStatus,TEXT.endgame.passedLocal("B"));
});

test("a COM's pass while watching says what happened, without asking the viewer to pass",()=>{
  const passed=play(newGame(),null);
  assert.deepEqual(passNotice({game:passed,room:false,gameMode:"ai",watching:true,color:WHITE}),
    {text:TEXT.endgame.passedWatch("B"),second:false});
});

test("採点を始める waits for a computing move, except while watching",()=>{
  // While watching, 採点を始める stops the COM instead (com-watch.test.mjs).
  assert.equal(bar({aiThinking:true}).disabled.endPropose,true);
  assert.equal(bar({aiThinking:true,watching:true}).disabled.endPropose,false);
});

test("the solo prompt asks to score, names the COM only in COM games, and holds the board's buttons",()=>{
  const prompt=bar({endExpanded:true,advisor:{previous:{move:0},stage:"near"}});
  assert.equal(prompt.text.endStatus,TEXT.endgame.askLocal);
  assert.equal(prompt.text.endDetail,TEXT.endgame.detailLocalAi);
  assert.equal(bar({endExpanded:true,gameMode:"local",advisor:{previous:{move:0},stage:"near"}}).text.endDetail,
    TEXT.endgame.detailLocal);
  assert.deepEqual(prompt.classes.actionRow,{"end-prompt-open":true});
  assert.equal(prompt.classes.endgameBar["is-asking"],true);
  assert.deepEqual([prompt.text.endProposeLabel,prompt.text.endAccept],[TEXT.endgame.startScoring,TEXT.endgame.goScoring]);
  assert.equal(prompt.hidden.endPropose,true);
  assert.equal(prompt.hidden.endAccept,false);
});

test("starting scoring before the board has settled keeps the advice above the question",()=>{
  const prompt=bar({endExpanded:true});
  assert.equal(prompt.text.endStatus,TEXT.endgame.playing+"\n"+TEXT.endgame.askLocal);
  assert.equal(prompt.text.endDetail,TEXT.endgame.detailUnsettled);
});

test("only a solo accept is gold; a friend's offer gets two equal choices",()=>{
  assert.deepEqual(bar().classes.endAccept,{primary:true});
  const offered={...newGame(),endProposal:{from:WHITE,atMove:0}};
  const incoming=bar({game:offered,room:true});
  assert.deepEqual(incoming.classes.endAccept,{primary:false});
  assert.equal(incoming.text.endStatus,TEXT.endgame.proposed);
  assert.equal(incoming.text.endAccept,TEXT.common.accept);
  assert.equal(incoming.classes.endgameBar["is-calling"],true);
  assert.equal(bar({room:true}).text.endProposeLabel,TEXT.endgame.propose);
});

test("a disconnected friend's game says why its buttons are disabled",()=>{
  for(const offline of [bar({room:true,connected:false}),bar({room:true,color:null})]){
    assert.equal(offline.text.endStatus,TEXT.endgame.offline);
    assert.deepEqual(offline.disabled,{endPropose:true,endAccept:true,endDecline:true});
  }
  assert.equal(TEXT.endgame.offline,"相手を待っています");
});

test("the help button explains the rules for 五目並べ and an illegal preview, and the endgame otherwise",()=>{
  assert.equal(bar().help,"endgame");
  const illegal=bar({illegalCandidate:{reason:"ko"}});
  assert.equal(illegal.help,"illegal");
  assert.equal(illegal.text.endStatus,forbiddenLines("ko"));
  assert.equal(bar({game:newGame(true,{rules:"gomoku"})}).help,"rules");
});

test("while watching, the bar says when a COM wants to resign",()=>{
  assert.equal(bar({watching:true,resignWish:WHITE}).text.endStatus,TEXT.endgame.wantsResign("W"));
  assert.equal(bar({watching:true}).text.endStatus,"");
  // A pass just played is still what the bar reports.
  const passed=play(newGame(),null);
  assert.equal(bar({game:passed,watching:true,resignWish:WHITE}).text.endStatus,TEXT.endgame.passedWatch("B"));
});
