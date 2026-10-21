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

test("the bar's advice never claims 'not yet' until KataGo has evaluated a position",()=>{
  // endgameHint reports 確認中／判定できません instead (see tests/endgame.test.mjs).
  assert.equal(bar({katagoReady:false,advisor:{previous:null}}).text.endStatus,"");
  assert.equal(bar({advisor:{previous:null}}).text.endStatus,TEXT.endgame.checking);
  assert.equal(bar({fallbackMode:true}).text.endStatus,TEXT.endgame.unavailable);
  assert.equal(bar().text.endStatus,TEXT.endgame.playing);
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

test("the solo prompt asks to score, and against the COM the answer is the player's pass",()=>{
  const prompt=bar({endExpanded:true,advisor:{previous:{move:0},stage:"near"}});
  assert.equal(prompt.text.endStatus,TEXT.endgame.askLocal);
  assert.equal(prompt.text.endDetail,TEXT.endgame.detailLocalAi);
  assert.equal(bar({endExpanded:true,gameMode:"local",advisor:{previous:{move:0},stage:"near"}}).text.endDetail,
    TEXT.endgame.detailLocal);
  assert.deepEqual(prompt.classes.actionRow,{"end-prompt-open":true});
  assert.equal(prompt.classes.endgameBar["is-asking"],true);
  assert.deepEqual([prompt.text.endPropose,prompt.text.endAccept],[TEXT.endgame.startScoring,TEXT.endgame.passToEnd]);
  // On one board, while watching or without KataGo, the count is the viewer's own decision.
  assert.equal(bar({endExpanded:true,gameMode:"local"}).text.endAccept,TEXT.endgame.goScoring);
  const watched=bar({endExpanded:true,watching:true,advisor:{previous:{move:0},stage:"near"}});
  assert.deepEqual([watched.text.endAccept,watched.text.endDetail],[TEXT.endgame.goScoring,TEXT.endgame.detailWatchScoring]);
  assert.equal(bar({endExpanded:true,fallbackMode:true}).text.endAccept,TEXT.endgame.goScoring);
  assert.equal(bar().text.endDetail,TEXT.endgame.detailAi);
  assert.equal(prompt.hidden.endPropose,true);
  assert.equal(prompt.hidden.endAccept,false);
});

test("starting scoring before the board has settled keeps the advice above the question",()=>{
  const prompt=bar({endExpanded:true});
  assert.equal(prompt.text.endStatus,TEXT.endgame.playing+"\n"+TEXT.endgame.askLocal);
  assert.equal(prompt.text.endDetail,TEXT.endgame.detailUnsettledAi);
  assert.equal(bar({endExpanded:true,gameMode:"local"}).text.endDetail,TEXT.endgame.detailUnsettled);
});

test("only a solo accept is gold; a friend's offer gets two equal choices",()=>{
  assert.deepEqual(bar().classes.endAccept,{primary:true});
  const offered={...newGame(),endProposal:{from:WHITE,atMove:0}};
  const incoming=bar({game:offered,room:true});
  assert.deepEqual(incoming.classes.endAccept,{primary:false});
  assert.equal(incoming.text.endStatus,TEXT.endgame.proposed);
  assert.equal(incoming.text.endAccept,TEXT.common.accept);
  assert.equal(incoming.classes.endgameBar["is-calling"],true);
  assert.equal(bar({room:true}).text.endPropose,TEXT.endgame.propose);
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

// A record whose last stone brought back an earlier board, Black to move both times.
const cycled=()=>({...newGame(),moves:[0,1,2,3].map((position,i)=>({color:i%2?WHITE:BLACK,position})),
  moveNumber:4,next:BLACK,history:["h0","h1","h2","h3","h2"]});

test("a repeated position offers 無勝負 in place of the count, and a friend's offer says so",()=>{
  const ai=bar({game:cycled()});
  assert.equal(ai.text.endStatus,TEXT.endgame.repeated);
  assert.equal(ai.text.endPropose,TEXT.endgame.void);
  assert.equal(ai.classes.endgameBar["is-calling"],true);
  const asked=bar({game:cycled(),endExpanded:true});
  assert.equal(asked.text.endStatus,TEXT.endgame.askVoid);
  assert.equal(asked.text.endAccept,TEXT.endgame.void);
  assert.equal(asked.text.endDetail,TEXT.endgame.detailVoidAi);
  assert.equal(bar({game:cycled(),endExpanded:true,gameMode:"local"}).text.endDetail,TEXT.endgame.detailVoidLocal);
  assert.equal(bar({game:cycled(),room:true}).text.endPropose,TEXT.endgame.proposeVoid);
  const offered={...cycled(),endProposal:{from:WHITE,atMove:4,kind:"void"}};
  const incoming=bar({game:offered,room:true});
  assert.equal(incoming.text.endStatus,TEXT.endgame.voidProposed);
  assert.equal(incoming.text.endDetail,TEXT.endgame.detailVoidIncoming);
  // A watched COM同士 game is not asked: it ends by itself.
  assert.notEqual(bar({game:cycled(),watching:true}).text.endStatus,TEXT.endgame.repeated);
});
