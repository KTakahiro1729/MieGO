// The endgame bar under the board: the advice, a pass just played, an end
// offer or a friend's 待った request, with the buttons that answer them.
// endgameBarView() only works out what the bar says; app.mjs puts it on the page.
import { BLACK, boardHash, isFree, isGomoku } from "./core.mjs";
import { endgameHint } from "./endgame.mjs";
import { forbiddenLines } from "./illegal-moves.mjs";
import { TEXT } from "./texts.mjs";

const BUTTONS = ["endPropose", "endAccept", "endDecline"];

/** The pass just played, if the last move was one: who passed, and whether the bar asks for the second. */
export function passNotice({game, room, gameMode, watching, color}) {
  if(game.passes!==1 || game.moves.at(-1)?.position!==null)return null;
  const by=game.moves.at(-1).color;
  if(!room && gameMode!=="ai")return {text:TEXT.endgame.passedLocal(by===BLACK?"B":"W"),second:true};
  if(watching)return {text:TEXT.endgame.passedWatch(by===BLACK?"B":"W"),second:false};
  if(by===color)return {text:TEXT.endgame.passedSelf,second:false};
  return {text:room?TEXT.endgame.passedOpponent:TEXT.endgame.passedAi,second:true};
}

/**
 * What the bar shows, as {text, hidden, disabled, classes, help} keyed by
 * element id; an element left out keeps what it shows. `color` is this
 * player's colour (null for a spectator), `room` whether it is a friend's game,
 * `notices` the one-off texts a 待った or an answered offer left for this position.
 */
export function endgameBarView({game, color, room, connected, gameMode, watching, endExpanded, aiPassAsks,
  katagoReady, fallbackMode, advisor, aiThinking, notices, keptPlaying, illegalCandidate, resignWish=null}) {
  const view={text:{},hidden:{},disabled:{},classes:{},help:null};
  const playing=game.status==="playing";
  const offer=playing?game.endProposal:null;
  // A friend's 待った request borrows the same in-bar answer buttons as an end offer.
  const takebackRequest=playing && room?game.takebackRequest:null;
  if(takebackRequest){
    const asked=color!==null && takebackRequest.from!==color;
    view.text.endStatus=asked?TEXT.takeback.requested:TEXT.takeback.waiting;
    Object.assign(view.hidden,{endPropose:true,endAccept:!asked,endDecline:false});
    view.text.endAccept=TEXT.common.accept;
    view.text.endDecline=asked?TEXT.takeback.decline:TEXT.common.withdraw;
    for(const id of BUTTONS)view.disabled[id]=!connected || color===null;
    view.text.endDetail=asked?TEXT.takeback.detailAsked:TEXT.takeback.detailWaiting;
    view.classes.endgameBar={"is-calling":asked};
    return view;
  }
  // 自由に置く has no end: the bar only says how the board works.
  if(isFree(game)){
    view.text.endStatus=room && (!connected || color===null)?TEXT.endgame.offline:TEXT.endgame.free;
    for(const id of BUTTONS)view.hidden[id]=true;
    view.classes.endgameBar={"is-calling":false,"has-illegal":false};
    view.classes.actionRow={"end-prompt-open":false};
    view.help="rules";
    return view;
  }
  const incoming=!!(offer && room && color!==null && offer.from!==color);
  const localPrompt=playing && !room && endExpanded && !offer;
  const waiting=!!(offer && !incoming);
  const offline=!!room && (!connected || color===null);
  // While KataGo loads there is no estimate yet; the slot stays quiet rather than saying so.
  const hint=!katagoReady && !fallbackMode && !advisor.previous ? "" :
    endgameHint(game,advisor,{unavailable:fallbackMode});
  const passed=playing && !offer && !localPrompt && !offline ?
    passNotice({game,room,gameMode,watching,color}) : null;
  // Scoring an unsettled board counts its open areas for nobody (the playout only fills
  // dame): the same question then keeps the advice above it.
  const unsettled=localPrompt && hint===TEXT.endgame.playing;
  const aiPassed=localPrompt && aiPassAsks;
  let status=!playing?"":offline?TEXT.endgame.offline:
    incoming?TEXT.endgame.proposed:
    waiting?TEXT.endgame.waiting:
    aiPassed?TEXT.endgame.askAiPassed:
    localPrompt?(unsettled?hint+"\n"+TEXT.endgame.askLocal:TEXT.endgame.askLocal):
    passed?passed.text:hint;
  view.hidden.endPropose=!playing||!!offer||localPrompt||isGomoku(game);
  view.hidden.endAccept=!playing||!(incoming||localPrompt);
  view.hidden.endDecline=!playing||!(incoming||localPrompt||waiting);
  view.text.endPropose=!room?TEXT.endgame.startScoring:TEXT.endgame.propose;
  view.text.endAccept=!room?TEXT.endgame.goScoring:TEXT.common.accept;
  view.text.endDecline=waiting?TEXT.common.withdraw:TEXT.common.keepPlaying;
  for(const id of BUTTONS)view.disabled[id]=offline;
  // A move being computed is about to arrive; scoring waits for it instead of pausing the AI.
  // While watching, a COM is nearly always thinking, so 採点を始める stops it instead.
  if(aiThinking && !watching)view.disabled.endPropose=true;
  // Answering an opponent's offer is a negotiation: neither choice is emphasized.
  view.classes.endAccept={primary:!room};
  view.classes.actionRow={"end-prompt-open":localPrompt};
  view.text.endDetail=incoming?TEXT.endgame.detailIncoming:
    aiPassed?TEXT.endgame.detailAiPassed:
    localPrompt?(unsettled?TEXT.endgame.detailUnsettled:gameMode==="ai"?TEXT.endgame.detailLocalAi:
      TEXT.endgame.detailLocal):
    waiting?TEXT.endgame.detailWaiting:
    room?TEXT.endgame.detailOnline:
    TEXT.endgame.detailOffline;
  if(playing && isGomoku(game) && !offline && !offer && !localPrompt)status=TEXT.endgame.gomoku;
  const notice=notices.find(n=>n?.number===game.moveNumber && n.hash===boardHash(game.board));
  if(playing && !offer && !localPrompt && !passed && notice)status=notice.text;
  // While watching, a COM that would resign plays on, and the bar says it wants to.
  if(playing && watching && resignWish && !offer && !localPrompt && !passed && !notice)
    status=TEXT.endgame.wantsResign(resignWish===BLACK?"B":"W");
  // A decision is asked of this player: an offer, the other side's pass, or the advice to end.
  view.classes.endgameBar={"is-asking":localPrompt,"is-calling":playing && !offline &&
    (incoming || (!!passed?.second && !keptPlaying) || status===TEXT.endgame.ready)};
  // The stable left-hand status slot doubles as a rule explanation for illegal previews.
  // 五目並べ's forbidden moves are explained with its rules, not with ko and suicide.
  view.help=isGomoku(game)?"rules":playing && illegalCandidate?"illegal":"endgame";
  if(playing && illegalCandidate)status=forbiddenLines(illegalCandidate.reason);
  view.text.endStatus=status;
  return view;
}
