import {
  agreeDead,
  agreeScore,
  answerEndProposal,
  areaScore,
  backToDead,
  beginSoloScoring,
  BLACK,
  BOARD_SIZES,
  boardHash,
  confirmDeadSolo,
  fillStones,
  finalizeSoloScore,
  handicapOf,
  hasGomokuForbidden,
  isGomoku,
  isJapanese,
  komiOf,
  maxHandicap,
  newGame,
  play,
  proposeEnd,
  resume,
  RULESETS,
  rulesOf,
  scoringStepOf,
  setDeadCandidates,
  sizeOf,
  toggleDead,
  WHITE,
  withPlayoutFill,
} from "./core.mjs";
import { suggestDeadStones } from "./dead-stones.mjs";
import {
  deadFromPlayout,
  pickSettleMove,
  replayPlayout,
  settleLimit,
  settleMax,
  settleStart,
  settleStep,
  settleStepMs,
} from "./settle-playout.mjs";
import { EndgameAdvisor, endgameHint } from "./endgame.mjs";
import { copyInviteText } from "./invite.mjs";
import {
  colorLabel,
  guestUrl,
  isPeerAction,
  newPeerSignins,
  ownUrl,
  playerColor,
  readCheckpoint,
  reconcileGame,
  ROOM_PATTERN,
  roomUrl,
  saveCheckpoint,
  selectColor,
  storageKey,
} from "./p2p-session.mjs";
import { createP2PTransport } from "./p2p-transport.mjs";
import { interpolateOwnership } from "./territory-view.mjs";
import { createAppearanceSettings } from "./appearance-settings.mjs";
import { choosePolicyMove } from "./ai-opponent.mjs";
import { gomokuMove } from "./gomoku.mjs";
import { AI_STRENGTHS, DEFAULT_AI_STRENGTH, normalizeStrength } from "./ai-strength.mjs";
import { policyHints } from "./ai-assist.mjs";
import {
  answerTakeback,
  requestTakeback,
  takeBack,
  takebackCut,
} from "./takeback.mjs";
import { createBoardRenderer } from "./board-renderer.mjs";
import { scoreBreakdown, scoreRows, PRISONER_OUTLINE } from "./scoring-regions.mjs";
import { createBoardZoom } from "./board-zoom.mjs";
import {forbiddenLines,inspectProvisionalMove,makeIllegalMovePrompt} from "./illegal-moves.mjs";
import { freshLocalGame } from "./mode-state.mjs";
import { GameLibrary } from "./game-library.mjs";
import { replaySteps, forkReview, exportSGF } from "./sgf.mjs";
import { createShareImages, downloadBlob } from "./share-images.mjs";
import { OwnershipStore } from "./ownership-store.mjs";
import { replayLine, prefetchOrder } from "./ownership-prefetch.mjs";
import { resultLabel, resultWinner } from "./result-label.mjs";
import { createHistoryPanel } from "./history-panel.mjs";
import { navigationState } from "./history-navigation.mjs";
import { makeReviewUrl, readReviewUrl, makeAiHandoff } from "./sgf-link.mjs";
import { createHelpSheet } from "./help-sheet.mjs";
import {
  activeReviewSnapshot,
  commitReviewStone,
  proposeReviewStone,
  variationForSharing,
} from "./review-variation.mjs";
import { canApproveScoring, canApplyAutomatedReview, deadSignature } from "./scoring-flow.mjs";
import { TEXT } from "./texts.mjs";
import { UserError, messageFor } from "./user-error.mjs";
import { writeClipboard, copyWithFallback } from "./clipboard.mjs";
import { createRetapConfirm } from "./confirm-retap.mjs";
const $ = id => document.getElementById(id);
// 投了 and leaving a friend's match need a second tap on the same button.
const {confirmByRetap,keepArmedLabel,disarmConfirm:resetArmedButtons}=createRetapConfirm();
const canvas = $("board");
let worker = new Worker("/katago-worker.bundle.mjs", { type: "module" });
let fallbackMode = false;
function switchToFallback(reason) {
  if (fallbackMode) return;
  fallbackMode = true;
  endgameAdvisor.reset();endgameStage="playing";
  katagoReady = false;
  aiThinking = false;
  aiJob = null;
  console.warn("KataGo unavailable; switching to transparent approximation:", reason);
  worker.terminate();
  worker = new Worker("/analysis-worker.mjs", { type: "module" });
  workerWaiting = null; prefetch = null;
  worker.onmessage = onWorkerMessage;
  worker.onerror = e => { $("analysisStatus").textContent = TEXT.analysis.unavailable; console.error(e); };
  if (gameMode === "ai" && !isGomoku(game)) $("aiMatchStatus").textContent = TEXT.ai.unavailable;
  show();
  requestAnalysis();
}
worker.onerror = e => switchToFallback(e.message || "worker startup error");
// The worker answers only its newest request, so one waiting id tells whether it is busy.
let workerWaiting = null;
// Background estimates of a replayed line (see planPrefetch).
let prefetch = null;
function postToWorker(message) {
  // A newer request supersedes a background estimate, which is then asked again.
  if (prefetch?.inflight) { prefetch.queue.unshift(prefetch.inflight.step); prefetch.inflight = null; }
  workerWaiting = message.id;
  worker.postMessage(message);
}
const params = new URLSearchParams(location.search);
let room = params.get("room"), seat = room ? null : "host";
const inviteFragment=new URLSearchParams(location.hash.slice(1));
let p2pRole=inviteFragment.get("role")==="guest"?"guest":"owner";
let inviteKey=inviteFragment.get("key");
// A seat link opened on this page may take the seat over once if a stored session no longer works.
let linkKey=inviteKey;
let ownerColor=null,onlineSession=null,guestInviteKey=null,issuedSide=null,onlineRevision=0;
// The other seat's count of sign-ins on another device that this player has seen.
let seenPeerSignins=null;
let p2pTransport;
const myOnlineColor=()=>ownerColor===null?null:playerColor(p2pRole,ownerColor);
const currentSideSelection=()=>document.querySelector('input[name="onlineSide"]:checked')?.value||"random";
// Before play starts, a changed side, board size or handicap calls for a new invitation.
const inviteMatchesChoice=()=>issuedSide===currentSideSelection() &&
  (connected || game.moveNumber>0 || (sizeOf(game.board)===boardSize && handicapOf(game)===onlineHandicap &&
    rulesOf(game)===gameRules && hasGomokuForbidden(game)===(gameRules==="gomoku" && gomokuForbiddenChoice)));
// The player's own seat link moves the game to another device; it never sits in the address bar.
function ownSeatLink() {
  try{return room && inviteKey ? (p2pRole==="owner"?ownUrl:guestUrl)(location.origin,room,inviteKey) : null;}
  catch{return null;}
}
function renderInviteButton() {
  $("seatLinkBox").hidden=!ownSeatLink();
  // Only the owner's device that created the room holds the guest's key, and
  // the side cannot change once the game has started.
  $("copy").disabled=!!room && (p2pRole!=="owner" || !guestInviteKey);
  const locked=!!room && (connected || game.moveNumber>0);
  for(const input of document.querySelectorAll('input[name="onlineSide"]')) {
    input.disabled=locked;
    if(locked && issuedSide!==null)input.checked=input.value===issuedSide;
  }
  $("copy").textContent=!room?TEXT.online.prepareInvite:
    issuedSide!==null && !inviteMatchesChoice()?
      TEXT.online.renewInvite:TEXT.online.copyInvite;
  keepArmedLabel($("copy"));
}
function persistOnline(){
  if(!room || !ROOM_PATTERN.test(room))return;
  if(!saveCheckpoint(roomingStorage,room,{role:p2pRole,ownerColor,session:onlineSession,
    inviteKey,guestInviteKey,issuedSide,revision:onlineRevision,game,lastPosition,seenPeerSignins}))
    storageError(new UserError(TEXT.online.checkpointFailed));
}
let game = newGame(), candidate = null, illegalCandidate = null, analysis = null, seq = 0, pending = null, lastPosition = null;
let illegalPromptCopied = false;
// "石を隠す" is fixed for a whole game: the 新規対戦 choice applies to the
// next game, which carries it (so a friend's game shows it to both players).
// A replayed board follows its game; a shared SGF shows its stones.
let hideStonesChoice = false;
// 五目並べ's 禁じ手 (renju's forbidden moves for Black), for the next game.
let gomokuForbiddenChoice = false;
const hidingStones = () => (boardReview ? boardReview.snapshot : game)?.hideStones===true;
const appearance = createAppearanceSettings({$,canvas,getGame:()=>game,hidingStones,isCounting,show,draw,
  onOverlayOn:()=>boardReview?requestReviewOwnership():requestAnalysis()});
const {shownPalette,overlayOn,updateGradient}=appearance;
let connected = false;
// A first visit starts against the COM; later visits restore the saved mode.
let gameMode = room ? "online" : "ai";
let humanColor = BLACK, invasion = 50, reinforcement = 50;
let aiStrength = DEFAULT_AI_STRENGTH, aiHints = false, hints = null, takebackNotice = null;
// What a friend's answer did to an end offer, shown once in the bar like takebackNotice.
let endNotice = null;
let aiSideChoice = "black";
let aiHandicap = 0, localHandicap = 0, onlineHandicap = 0;
// The ruleset for the next new game, shared by every mode like the board size.
let gameRules = "chinese";
const toRules = value => RULESETS.includes(value) ? value : "chinese";
// Up to nine stones; newGame() caps the count for the chosen board (9x9: five).
const toHandicap = value => handicapOf({handicap:Number(value)},19);
// The board size for the next new game in any mode; a running game keeps its own.
let boardSize = 9;
const toBoardSize = value => BOARD_SIZES.includes(Number(value)) ? Number(value) : 9;
const shownSize = () => sizeOf((boardReview?.display||game).board);
let katagoReady = false, aiThinking = false, aiJob = null;
const endgameAdvisor = new EndgameAdvisor();
let endgameStage = "playing", endExpanded = false, analysisContext = null;
let lastOfferKey = null, endHintSuppressedUntil = -1;
let deadEvaluation=null, deadReview="idle", deadReviewTouched=false;
// 決着手順: KataGo's playout shown on the board while it settles the dead
// stones (settle), and the last playout kept for 再生 (settlePlayout).
let settle=null, settlePlayout=null, settleShow=null;
const SETTLE_HOLD_MS=1100;
const reducedMotion=()=>window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
function scoringReviewAction(type, extra={}) {
  return {type,number:game.moveNumber,before:boardHash(game.board),
    deadBefore:deadSignature(game.dead),...extra};
}
function reviewUnavailable() {
  if(game.status!=="scoring" || deadReviewTouched ||
     game.agreed.black || game.agreed.white)return;
  apply(scoringReviewAction("dead_unavailable"));
}
// When storage is full, the oldest saved games that are not favourites make
// room; the current game and the active 1台/AI games always stay.
let evictedGames=0;
const gameLibrary=new GameLibrary(localStorage,undefined,undefined,{
  keep:()=>currentGameId?[currentGameId]:[],
  onRemove:record=>{
    ownershipStore.forget(record.id);
    if(record.mode==="online" && record.roomId!==room)
      try{localStorage.removeItem(storageKey(record.roomId));}catch{}
    evictedGames++;
  }
});
// Friend-game checkpoints make room the same way.
const roomingStorage={getItem:key=>localStorage.getItem(key),setItem:(key,value)=>gameLibrary.write(key,value)};
// The ownership shown for each committed position: every position of the
// current game, the final board (its thumbnail) of every other saved game.
const ownershipStore=new OwnershipStore(localStorage,{write:(key,value)=>gameLibrary.write(key,value)});
let ownershipCompactedFor;
function compactOwnership(){
  if(ownershipCompactedFor===currentGameId)return;
  ownershipCompactedFor=currentGameId;
  try{ownershipStore.compact(currentGameId,new Map(gameLibrary.list().map(r=>[r.id,r.snapshot.board])));}
  catch(error){console.warn("Ownership compaction failed",error);}
}
function showEvictionNotice(){
  if(!evictedGames)return;
  showNotice(TEXT.history.evicted(evictedGames));
  evictedGames=0;
}
let currentGameId=null,currentRevision=null;
const historyPanel=createHistoryPanel({$,gameLibrary,storageError,onSelect:openSavedBoard,getBoardTheme:appearance.boardTheme,
  getThumbnailOverlay:record=>{
    if(!overlayOn())return null;
    const ownership=ownershipStore.recall(record.id,record.snapshot.board);
    return ownership?{ownership,palette:shownPalette(),opacity:appearance.opacity()}:null;
  }});
const {renderHistoryList,importHistoryFile}=historyPanel;
// Sheets are aria-modal: keep Tab and taps out of the board behind them.
function setBackgroundInert(on){
  for(const el of document.querySelectorAll(".topbar,.game-layout"))el.inert=on;
}
function openHistoryPanel(){openPanel("history");}
// The actual match always remains in 'game'; only the visible board is replayed.
let boardReview=null,reviewWorker=null,reviewSequence=0;
try {gameLibrary.migrateLegacy();}
catch(error){console.warn("Saved-game migration failed",error);}
function storageError(error){
  $("saveStatus").hidden=false;
  $("saveStatus").textContent=TEXT.game.saveFailed;
  $("historySaveNotice").textContent=messageFor(error,TEXT.game.saveFailedShort);
  console.error("MieGO autosave",error);
}
function clearStorageError() {
  $("saveStatus").hidden=true;$("historySaveNotice").textContent="";
}
// Non-blocking replacement for alert(); cleared by the next successful save or a tap.
function showNotice(message) {
  $("saveStatus").hidden=false;
  $("saveStatus").textContent=message;
}
// Seat notices stay until tapped: a save does not clear them.
function showSeatNotice(message) {
  $("seatNotice").hidden=false;
  $("seatNotice").textContent=TEXT.online.tapToClose(message);
}
function myColorForEnd() {
  if(room)return myOnlineColor();
  return gameMode==="ai"?humanColor:BLACK;
}
function updateEndUi() {
  const playing=game.status==="playing";
  const offer=playing?game.endProposal:null;
  const color=myColorForEnd();
  // A friend's 待った request borrows the same in-bar answer buttons as an end offer.
  const takebackRequest=playing && room?game.takebackRequest:null;
  if(takebackRequest){
    const asked=color!==null && takebackRequest.from!==color;
    $("endStatus").textContent=asked?TEXT.takeback.requested:TEXT.takeback.waiting;
    $("endPropose").hidden=true;
    $("endAccept").hidden=!asked;
    $("endDecline").hidden=false;
    $("endAccept").textContent=TEXT.common.accept;
    $("endDecline").textContent=asked?TEXT.takeback.decline:TEXT.common.withdraw;
    for(const id of ["endPropose","endAccept","endDecline"])
      $(id).disabled=!connected || color===null;
    $("endDetail").textContent=asked?TEXT.takeback.detailAsked:
      TEXT.takeback.detailWaiting;
    $("endgameBar").classList.toggle("is-calling",asked);
    return;
  }
  const incoming=!!(offer && room && color!==null && offer.from!==color);
  const localPrompt=playing && !room && endExpanded && !offer;
  const waiting=!!(offer && !incoming);
  const offline=!!room && (!connected || color===null);
  const hint=endgameHint(game,endgameAdvisor,{
    unavailable:fallbackMode,suppressedUntil:endHintSuppressedUntil
  });
  const passed=playing && !offer && !localPrompt && !offline ? passNotice() : null;
  $("endStatus").textContent=!playing?"":offline?TEXT.endgame.offline:
    incoming?TEXT.endgame.proposed:
    waiting?TEXT.endgame.waiting:
    localPrompt?TEXT.endgame.askLocal:
    passed?passed.text:hint;
  $("endPropose").hidden=!playing||!!offer||localPrompt||isGomoku(game);
  $("endAccept").hidden=!playing||!(incoming||localPrompt);
  $("endDecline").hidden=!playing||!(incoming||localPrompt||waiting);
  $("endPropose").textContent=!room?TEXT.endgame.startScoring:TEXT.endgame.propose;
  $("endAccept").textContent=!room?TEXT.endgame.goScoring:TEXT.common.accept;
  $("endDecline").textContent=waiting?TEXT.common.withdraw:TEXT.common.keepPlaying;
  for(const id of ["endPropose","endAccept","endDecline"])
    $(id).disabled=offline;
  // A move being computed is about to arrive; scoring waits for it instead of pausing the AI.
  if(aiThinking)$("endPropose").disabled=true;
  // Answering an opponent's offer is a negotiation: neither choice is emphasized.
  $("endAccept").classList.toggle("primary",!room);
  $("actionRow").classList.toggle("end-prompt-open",localPrompt);
  $("endDetail").textContent=incoming?TEXT.endgame.detailIncoming:
    localPrompt?(gameMode==="ai"?TEXT.endgame.detailLocalAi:
      TEXT.endgame.detailLocal):
    waiting?TEXT.endgame.detailWaiting:
    room?TEXT.endgame.detailOnline:
    TEXT.endgame.detailOffline;
  if(playing && isGomoku(game) && !offline && !offer && !localPrompt)
    $("endStatus").textContent=TEXT.endgame.gomoku;
  const notice=[takebackNotice,endNotice].find(n=>n?.number===game.moveNumber &&
    n.hash===boardHash(game.board));
  if(playing && !offer && !localPrompt && !passed && notice)
    $("endStatus").textContent=notice.text;
  // A decision is asked of this player: an offer, the other side's pass, or the advice to end.
  $("endgameBar").classList.toggle("is-calling",playing && !offline &&
    (incoming || !!passed?.second || $("endStatus").textContent===TEXT.endgame.ready));
  // The stable left-hand status slot doubles as a rule explanation for illegal previews.
  // 五目並べ's forbidden moves are explained with its rules, not with ko and suicide.
  $("endHelp").dataset.help=isGomoku(game)?"rules":playing && illegalCandidate?"illegal":"endgame";
  if(playing && illegalCandidate){
    $("endStatus").textContent=forbiddenLines(illegalCandidate.reason);
  }
}

/** A friend has agreed to the count (or the dead stones) and this player has not yet. */
function peerAgreed() {
  if(!room || game.status!=="scoring" || myOnlineColor()===null)return false;
  const [mine,theirs]=myOnlineColor()===WHITE?["white","black"]:["black","white"];
  return game.agreed[theirs] && !game.agreed[mine];
}
/** After one pass: who passed, and whether this player's pass would start scoring. */
function passNotice() {
  if(game.passes!==1 || game.moves.at(-1)?.position!==null)return null;
  const by=game.moves.at(-1).color;
  if(!room && gameMode!=="ai")return {text:TEXT.endgame.passedLocal(by===BLACK?"B":"W"),second:true};
  const me=myColorForEnd();
  if(by===me)return {text:TEXT.endgame.passedSelf,second:false};
  return {text:room?TEXT.endgame.passedOpponent:TEXT.endgame.passedAi,second:true};
}
const isAiTurn = () => !room && gameMode === "ai" && game.status === "playing" && game.next === -humanColor;
const isHumanTurn = () => room
  ? (connected && (myOnlineColor()!==null && game.next===myOnlineColor()))
  : (gameMode !== "ai" || (game.next === humanColor && (isGomoku(game) || katagoReady && !fallbackMode)));
function stopAiTurn() {
  aiThinking = false; aiJob = null;
  analysisContext=null;deadEvaluation=null;
  pending = ++seq;
  clearTimeout(analysisTimer);
}
// One remembered choice per line, in alphabetical order, so that two
// branches adding different choices touch different lines.
function rememberSettings() {
  try {
    localStorage.setItem("miego-local-settings", JSON.stringify({
      aiHandicap,
      aiHints,
      aiSide:aiSideChoice,
      aiStrength,
      boardSize,
      gameRules,
      gomokuForbidden:gomokuForbiddenChoice,
      hideStones:hideStonesChoice,
      humanColor,
      invasion,
      localHandicap,
      mode:gameMode,
      onlineHandicap,
      reinforcement,
    }));
  } catch {}
}
// What every new game takes from the 新規対戦 sheet, whatever the mode.
// A new per-game option is added here only, one per line, alphabetically.
function nextGameOptions(handicap) {
  return {
    gomokuForbidden:gomokuForbiddenChoice,
    handicap,
    hideStones:hideStonesChoice,
    rules:gameRules,
    size:boardSize,
  };
}
// Step sliders name each stop under the bar and show the chosen stop's note below it.
function syncStepSlider(id) {
  const input=$(id),stops=[...$(id+"Row").querySelectorAll(".step-ticks span")];
  const index=Math.round((Number(input.value)-Number(input.min))/Number(input.step));
  stops.forEach((stop,i)=>stop.classList.toggle("is-current",i===index));
  $(id+"Value").textContent=stops[index]?.textContent||"";
  $(id+"Note").textContent=stops[index]?.dataset.note||"";
}
// Invasion and reinforcement have three stops; older saves with any 0-100 value snap to the nearest.
const personaStep=value=>Math.round(Math.max(0,Math.min(100,Number(value??50)||0))/50)*50;
const personaLabel=value=>value<50?TEXT.ai.persona.low:value>50?TEXT.ai.persona.high:TEXT.ai.persona.mid;
function updatePersonaUi() {
  $("aiInvasion").value=String(invasion);
  $("aiReinforcement").value=String(reinforcement);
  syncStepSlider("aiInvasion");syncStepSlider("aiReinforcement");
}

let displayedOwnership = null, transitionFrame = null;
const boardZoom=createBoardZoom({
  frame:$("boardFrame"),canvas,bleed:$("boardBleed"),resetButton:$("boardZoomReset"),
  hint:$("pinchHint"),getSize:shownSize,redraw:()=>draw()
});
const boardRenderer = createBoardRenderer({
  canvas,
  // One input per line, alphabetically.
  getView:()=>({
    boardReview,
    boardTheme:appearance.boardTheme(),
    candidate,
    displayedOwnership,
    game,
    hideStones:hidingStones(),
    hints:visibleHints(),
    humanTurn:isHumanTurn(),
    illegalCandidate,
    keptPlayout:keptPlayout(),
    lastPosition,
    opacity:appearance.opacity(),
    palette:shownPalette(),
    settle:settleView(),
  })
});
function draw(){boardRenderer.draw();boardZoom.paintBleed();}
// Hints belong to one committed position and are only drawn on the human's turn.
function visibleHints() {
  if(!aiHints || room || gameMode!=="ai" || boardReview || candidate || illegalCandidate ||
     game.status!=="playing" || !isHumanTurn())return null;
  return hints && hints.number===game.moveNumber && hints.hash===boardHash(game.board)
    ? hints.moves : null;
}
// 待った: one shared board undoes the latest move; AI and friend games undo
// the player's own latest move together with any reply after it.
const takebackOptions = () => room ? {color:myOnlineColor(),scope:"own"} :
  gameMode==="ai" ? {color:humanColor,scope:"own"} : {scope:"ply"};
const canTakeBack = () => !boardReview && game.status==="playing" &&
  (!room || (connected && myOnlineColor()!==null && !game.takebackRequest)) &&
  takebackCut(game,takebackOptions())>=0;
function transitionOwnership(next) {
  if (transitionFrame!==null) cancelAnimationFrame(transitionFrame);
  const from=displayedOwnership;
  if (!from || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    displayedOwnership=[...next];
    draw(); return;
  }
  let begin=null;
  const tick=time=>{
    if(begin===null) begin=time;
    const p=Math.min(1,(time-begin)/260);
    const eased=p*p*(3-2*p);
    displayedOwnership=interpolateOwnership(from,next,eased);
    draw();
    transitionFrame=p<1?requestAnimationFrame(tick):null;
  };
  transitionFrame=requestAnimationFrame(tick);
}
let analysisTimer = null;
function requestAnalysis() {
  clearTimeout(analysisTimer);
  analysisContext=null;
  if(game.status==="scoring") {
    pending=++seq;
    analysisContext=null;
    endgameAdvisor.reset();endgameStage="playing";
    if(game.agreed.black || game.agreed.white) {
      deadReviewTouched=true;deadReview="modified";show();return;
    }
    if(deadReviewTouched || ["complete","none","modified","unavailable"].includes(deadReview)) {
      show();return;
    }
    if(room && (p2pRole!=="owner" || !connected)) {
      deadReview="awaiting";show();return;
    }
    if(fallbackMode) {reviewUnavailable();return;}
    if(!katagoReady) {deadReview="loading";show();return;}
    deadReview="pending";
    const id=pending;
    deadEvaluation={id,number:game.moveNumber,hash:boardHash(game.board),
      dead:deadSignature(game.dead)};
    startSettle(id);
    show();return;
  }
  if(game.status!=="playing") {
    pending=++seq;
    endgameAdvisor.reset();endgameStage="playing";
    updateEndUi();
    return;
  }
  if(isGomoku(game)){requestGomokuTurn();return;}
  if (isAiTurn()) {
    // A visible human confirmation must not initiate a new AI turn.
    if(endExpanded)return;
    if (aiThinking) return;
    if (fallbackMode) {
      analysis = null;
      displayedOwnership = null;
      $("analysisStatus").textContent = TEXT.analysis.stoppedAi;
      $("aiMatchStatus").textContent = TEXT.ai.unavailableContinue;
      show();return;
    }
    if (!katagoReady) {
      $("analysisStatus").textContent = TEXT.analysis.starting;
      $("aiMatchStatus").textContent = TEXT.ai.waitingLoad;
      show();return;
    }
    const id = ++seq;
    pending=id;
    aiThinking=true;
    aiJob={id,number:game.moveNumber,hash:boardHash(game.board)};
    $("analysisStatus").textContent = TEXT.analysis.thinking;
    $("aiMatchStatus").textContent = TEXT.ai.thinking;
    postToWorker({id,kind:"move",state:game});
    show();return;
  }
  pending=++seq;
  if(!overlayOn()) {
    analysis=null;
    if(transitionFrame!==null)cancelAnimationFrame(transitionFrame);
    transitionFrame=null; displayedOwnership=null;
    $("analysisStatus").textContent=TEXT.analysis.off;
    draw();
    // Endgame evaluation runs independently of the ownership overlay.
    // Avoid evaluating every preview tap when the overlay is disabled.
    if(candidate || fallbackMode)return;
  }
  const state=overlayOn()?(candidate || game):game, id=pending;
  analysisContext={id,number:state.moveNumber,hash:boardHash(state.board),committed:!candidate};
  if(overlayOn())$("analysisStatus").textContent=fallbackMode?TEXT.analysis.updatingFallback:TEXT.analysis.updating;
  analysisTimer=setTimeout(()=>postToWorker({id,state,board:state.board}),180);
}
// 五目並べ has no territory to estimate, and its computer player needs no KataGo.
const GOMOKU_AI_DELAY_MS=420;
function requestGomokuTurn() {
  pending=++seq;
  analysis=null;displayedOwnership=null;
  if(!isAiTurn() || endExpanded || aiThinking){draw();return;}
  const id=pending;
  aiThinking=true;
  aiJob={id,number:game.moveNumber,hash:boardHash(game.board)};
  $("aiMatchStatus").textContent=TEXT.ai.playingGomoku;
  show();
  const job=aiJob;
  setTimeout(()=>{
    if(aiJob!==job)return;
    aiThinking=false;aiJob=null;
    if(!isAiTurn() || game.moveNumber!==job.number || boardHash(game.board)!==job.hash){show();return;}
    submitMove(gomokuMove(game.board,game.next,Math.random,{forbidden:hasGomokuForbidden(game)}),true);
  },GOMOKU_AI_DELAY_MS);
}
/** The automatic dead-stone job still belongs to the position on the board. */
function scoringJobCurrent(job) {
  return !!job && game.status==="scoring" && game.moveNumber===job.number &&
    boardHash(game.board)===job.hash && deadSignature(game.dead)===job.dead &&
    !deadReviewTouched && !game.agreed.black && !game.agreed.white;
}
function startSettle(id, from=null) {
  stopSettleShow();
  const positions=from?[...from.positions]:[];
  settle={id,state:from?from.state:settleStart(game),positions,ownership:null,
    initialOwnership:from?.initialOwnership??null,shownAt:0,timer:null,
    limit:Math.min(settleMax(sizeOf(game.board)),positions.length+settleLimit(sizeOf(game.board)))};
  postToWorker({id,kind:"settle",state:settle.state});
}
/** The kept playout stopped at its move limit and can be carried on from where it stopped. */
function extendablePlayout() {
  const playout=currentPlayout();
  if(!playout || settle || settleShow || deadReviewTouched || game.agreed.black || game.agreed.white)return null;
  if((room && (p2pRole!=="owner" || !connected)) || fallbackMode || !katagoReady)return null;
  if(playout.positions.length>=settleMax(sizeOf(game.board)))return null;
  const frames=replayPlayout(game,playout.positions);
  return frames && frames.at(-1).status==="playing" ? {...playout,state:frames.at(-1)} : null;
}
/** 「AIに続きを打たせる」: another limit's worth of playout moves, then the dead stones again. */
function extendSettle() {
  const from=extendablePlayout();
  if(!from)return;
  pending=++seq;
  const id=pending;
  deadReview="pending";
  deadEvaluation={id,number:game.moveNumber,hash:boardHash(game.board),dead:deadSignature(game.dead)};
  startSettle(id,from);
  show();
}
function cancelSettle() {
  if(settle?.timer)clearTimeout(settle.timer);
  settle=null;
}
/** One KataGo answer during the playout: play its best move, or finish. */
function continueSettle(result) {
  const job=deadEvaluation;
  if(!settle || settle.id!==result.id || !job || job.id!==result.id || !scoringJobCurrent(job)) {
    cancelSettle();draw();return;
  }
  if(result.error || result.engine!=="katago" || !Array.isArray(result.ownership) ||
     result.ownership.length!==game.board.length || !result.ownership.every(Number.isFinite)) {
    cancelSettle();deadEvaluation=null;reviewUnavailable();return;
  }
  settle.ownership=result.ownership;
  settle.initialOwnership??=result.ownership;
  if(settle.state.status!=="playing" || settle.positions.length>=settle.limit)return finishSettle();
  const position=pickSettleMove(settle.state,result.policy,result.passLogit,result.ownership);
  const step=settle.skip || reducedMotion()?0:settleStepMs(sizeOf(game.board));
  const wait=Math.max(0,settle.shownAt+step-performance.now());
  settle.timer=setTimeout(()=>{
    if(!settle || settle.id!==result.id)return;
    settle.timer=null;
    settle.state=settleStep(settle.state,position);
    settle.positions.push(position);settle.shownAt=performance.now();
    show();
    postToWorker({id:settle.id,kind:"settle",state:settle.state});
  },wait);
}
/** The playout is over: hold its final board briefly, then mark the dead stones. */
function finishSettle() {
  const run=settle;
  let positions;
  try {
    // Groups the playout captured, plus the conservative estimate on the real board.
    const marked=new Set([...deadFromPlayout(game,run.state.board,run.ownership),
      ...suggestDeadStones(game,run.initialOwnership)]);
    positions=[...marked].sort((a,b)=>a-b);
  }catch(error) {
    console.error("KataGo dead-stone candidates",error);
    cancelSettle();deadEvaluation=null;reviewUnavailable();return;
  }
  // A playout stopped at its move limit is not a finished game; the text says so.
  run.cut=run.state.status==="playing";
  run.dead=positions;run.finished=true;show();
  run.timer=setTimeout(()=>commitSettle(run),run.skip || reducedMotion()?0:SETTLE_HOLD_MS);
}
function commitSettle(run) {
  if(settle!==run)return;
  const job=deadEvaluation;
  settle=null;deadEvaluation=null;
  if(!scoringJobCurrent(job)){show();return;}
  settlePlayout={number:game.moveNumber,hash:boardHash(game.board),positions:run.positions,
    board:run.state.board,initialOwnership:run.initialOwnership};
  apply(scoringReviewAction("dead_auto",{positions:run.dead,playout:run.positions}));
  // Stones tapped during the playout are corrections to its result, applied on top of it.
  for(const position of run.taps||[])
    apply({type:"dead",position,selected:!game.dead.includes(position)});
}
/** 再生: the kept playout again, without asking KataGo. */
function skipSettle() {
  if(!settle)return;
  settle.skip=true;
  if(settle.timer && !settle.finished){
    // The pending move plays at once; later ones follow without the pause.
    clearTimeout(settle.timer);settle.timer=null;
    postToWorker({id:settle.id,kind:"settle",state:settle.state});
  } else if(settle.finished){
    clearTimeout(settle.timer);
    commitSettle(settle);
  }
}
function replaySettle() {
  if(!currentPlayout() || settle)return;
  const frames=replayPlayout(game,settlePlayout.positions);
  if(!frames)return;
  stopSettleShow();
  const run={frames,index:0,timer:null};settleShow=run;
  const tick=()=>{
    if(settleShow!==run)return;
    if(run.index>=frames.length-1 || game.status!=="scoring"){
      run.finished=true;show();
      run.timer=setTimeout(()=>{if(settleShow===run){settleShow=null;show();}},SETTLE_HOLD_MS);
      return;
    }
    run.index++;show();
    run.timer=setTimeout(tick,reducedMotion()?0:settleStepMs(sizeOf(game.board)));
  };
  show();run.timer=setTimeout(tick,settleStepMs(sizeOf(game.board)));
}
function stopSettleShow() {
  if(settleShow?.timer)clearTimeout(settleShow.timer);
  settleShow=null;
}
const currentPlayout=()=>settlePlayout && game.status==="scoring" &&
  settlePlayout.number===game.moveNumber && settlePlayout.hash===boardHash(game.board) &&
  settlePlayout.positions.length ? settlePlayout : null;
/** The playout's border stones stay on the board, as fill stones, and count. */
function keptPlayout() {
  if(boardReview || settle || settleShow)return null;
  const counted=game.status==="scoring" || game.status==="finished" && !game.result?.endsWith("+R");
  return counted?fillStones(game):null;
}
/** What the board shows during a playout: its position over the real stones. */
function settleView() {
  if(boardReview || game.status!=="scoring")return null;
  if(settle)return {board:settle.state.board,base:game.board,last:settle.positions.at(-1)??null,
    moves:settle.positions.length,ownership:settle.ownership,finished:!!settle.finished,cut:!!settle.cut};
  if(settleShow && currentPlayout()){
    const frame=settleShow.frames[settleShow.index];
    return {board:frame.board,base:game.board,last:frame.moves.at(-1)?.position??null,
      moves:settleShow.index,ownership:null,finished:!!settleShow.finished};
  }
  return null;
}
function finishAiMove(result) {
  const job=aiJob;
  if(!job || job.id!==result.id)return;
  aiThinking=false;aiJob=null;
  if(!isAiTurn() || game.moveNumber!==job.number || boardHash(game.board)!==job.hash)return;
  // Discard an in-flight move while the human is deciding whether to score.
  if(endExpanded)return;
  if(result.engine!=="katago") {
    switchToFallback("non-KataGo move response");
    return;
  }
  try {
    // This is an NN evaluation of the committed position, not a preview.
    const valid=Array.isArray(result.ownership) &&
      result.ownership.length===game.board.length &&
      result.ownership.every(v=>Number.isFinite(v)&&Math.abs(v)<=1.001);
    const passStage=valid?endgameAdvisor.observe(game,result.ownership):"playing";
    if(valid){endgameStage=passStage;rememberOwnership(game.board,result.ownership);}
    const next=choosePolicyMove(game,result.policy,result.passLogit,{
      ownership:result.ownership,endgameStage:passStage,
      invasion,reinforcement,strength:aiStrength,
      temperature:0.38
    });
    $("aiMatchStatus").textContent = TEXT.ai.playingWith(AI_STRENGTHS[aiStrength].label,personaLabel(invasion),
      personaLabel(reinforcement));
    submitMove(next,true);
  } catch(error) {
    switchToFallback(error instanceof Error?error.message:String(error));
  }
}
function onWorkerMessage(event) {
  if(event.data?.id!==undefined && event.data.id===workerWaiting)workerWaiting=null;
  handleAnalysis(event);
  pumpPrefetch();
}
function handleAnalysis(event) {
  const result=event.data;
  const validFor=state=>!result.error && result.engine==="katago" && Array.isArray(result.ownership) &&
    result.ownership.length===state.board.length && result.ownership.every(Number.isFinite);
  if(prefetch?.inflight && result.id===prefetch.inflight.id) {
    const state=prefetch.states[prefetch.inflight.step];
    prefetch.inflight=null;
    if(validFor(state))keepReviewOwnership(prefetch,state.board,result.ownership);
    else prefetch=null; // A failing estimate is not retried in the background.
    return;
  }
  if(boardReview && result.id!==undefined && result.id===boardReview.katagoId) {
    const state=boardReview.preview||boardReview.display;
    if(validFor(state)) {
      boardReview.ownership=result.ownership;
      if(!boardReview.preview)keepReviewOwnership(reviewOwner(),state.board,result.ownership);
      draw();
    }
    return;
  }
  if(result.kind==="availability") {
    if(fallbackMode)return;
    if(result.available) {
      katagoReady=true;
      $("aiMatchStatus").textContent=TEXT.ai.ready;
      show();
      if(isAiTurn() || (game.status==="scoring" && ["idle","loading"].includes(deadReview)))
        requestAnalysis();
    } else {
      switchToFallback(result.error || TEXT.analysis.initFailed);
    }
    return;
  }
  if(result.id!==pending)return;
  if(result.kind==="settle") {
    continueSettle(result);
    return;
  }
  if(result.kind==="scoring") {
    const job=deadEvaluation;
    deadEvaluation=null;
    if(!job || job.id!==result.id || game.status!=="scoring" ||
      game.moveNumber!==job.number || boardHash(game.board)!==job.hash ||
      deadSignature(game.dead)!==job.dead || deadReviewTouched ||
      game.agreed.black || game.agreed.white)return;
    if(result.error || result.engine!=="katago") {
      reviewUnavailable();return;
    }
    try {
      const positions=suggestDeadStones(game,result.ownership);
      apply(scoringReviewAction("dead_auto",{positions}));
    }catch(error) {
      console.error("KataGo dead-stone candidates",error);
      reviewUnavailable();
    }
    return;
  }
  if(result.kind==="move") {
    if(result.error) { switchToFallback(result.error);return; }
    finishAiMove(result);
    return;
  }
  if(result.error) { switchToFallback(result.error);return; }
  if(!Array.isArray(result.ownership) || result.ownership.length!==game.board.length) {
    switchToFallback("Invalid ownership output");return;
  }
  if(game.status!=="playing")return;
  const context=analysisContext;
  if(context?.id===result.id && context.committed && !candidate &&
    context.number===game.moveNumber && context.hash===boardHash(game.board))
    rememberOwnership(game.board,result.ownership);
  // Sandbox positions and stale asynchronous results must never generate advice.
  if(context?.id===result.id && context.committed && !candidate &&
    context.number===game.moveNumber && context.hash===boardHash(game.board) &&
    result.engine==="katago") {
    endgameStage=endgameAdvisor.observe(game,result.ownership);
    updateEndUi();
    if(gameMode==="ai" && !room && game.next===humanColor && Array.isArray(result.policy)) {
      hints={number:context.number,hash:context.hash,moves:policyHints(game,result.policy)};
      draw();
    }
  }
  if(!overlayOn())return;
  analysis=result;
  $("analysisStatus").textContent=result.engine==="katago"
    ?TEXT.analysis.showingKatago
    :TEXT.analysis.showingFallback;
  transitionOwnership(result.ownership);
}
worker.onmessage=onWorkerMessage;
function show() {
  if(boardReview){renderBoardReview();return;}
  // The forbidden stone is a provisional UI selection, never part of game state.
  if(illegalCandidate && (illegalCandidate.source!==game || game.status!=="playing")) {
    illegalCandidate=null;illegalPromptCopied=false;
    $("illegalPromptFallbackPanel").hidden=true;
  }
  $("actionRow").hidden=false;
  $("reviewPanel").hidden=true;
  $("endgameBar").hidden=false;
  $("scoreBox").hidden=false;
  const myTurn=isHumanTurn();
  const gomoku=isGomoku(game);
  // The 五目並べ computer needs no KataGo, so it can start at once.
  const needsKatago=gameRules!=="gomoku";
  $("startAi").disabled=needsKatago && (!katagoReady || fallbackMode);
  renderInviteButton();
  $("startAi").textContent=needsKatago && fallbackMode?TEXT.ai.startUnavailable:
    needsKatago && !katagoReady?TEXT.ai.startLoading:gameMode==="ai"?TEXT.ai.restart:TEXT.ai.start;
  keepArmedLabel($("startAi"));
  $("aiInvasion").disabled=false;
  $("aiReinforcement").disabled=false;
  $("turn").classList.toggle("white-to-play",game.next===WHITE);
  // Nobody is to move while scoring or after the game, so no turn stone.
  $("turn").classList.toggle("no-stone",game.status!=="playing");
  $("turn").textContent=game.status==="finished"?TEXT.scoring.finishedResign:
    game.status==="scoring"?TEXT.common.scoring:
    room?(connected?(myTurn?TEXT.game.yourTurn:TEXT.game.opponentTurn):TEXT.game.waitingOpponent):
    gameMode==="ai"?(gomoku?(isAiTurn()?TEXT.game.aiTurn:TEXT.game.yourTurnAi):
      fallbackMode?TEXT.game.aiStopped:!katagoReady?TEXT.game.aiPreparing:
      isAiTurn()?TEXT.game.aiTurn:TEXT.game.yourTurnAi):
    (game.next===BLACK?TEXT.game.turnBlack:TEXT.game.turnWhite);
  if(!room)$("netStatus").textContent=gameMode==="ai"?TEXT.common.modeAi:TEXT.common.modeLocal;
  $("netStatus").classList.toggle("online",connected);
  $("moveLabel").textContent=TEXT.game.moveLabel(game.moveNumber);
  $("moveLabel").disabled=!game.moves.length;
  $("hint").textContent=illegalCandidate?TEXT.game.hintIllegal:
    candidate?TEXT.game.hintCandidate:
    game.status==="scoring"?TEXT.game.hintScoring:
    gameMode==="ai" && !gomoku && fallbackMode?TEXT.game.hintAiStopped:
    gameMode==="ai" && !gomoku && !katagoReady?TEXT.game.hintAiLoading:
    isAiTurn()?TEXT.game.hintAiThinking:"";
  const blocked=!!illegalCandidate;
  $("confirm").disabled=!candidate || !myTurn || blocked;
  // The stone on the button shows the colour that will be placed.
  $("confirmStone").classList.toggle("white",game.next===WHITE);
  $("copyIllegalPrompt").hidden=!blocked;
  $("copyIllegalPrompt").classList.toggle("is-copied",illegalPromptCopied);
  // With a provisional stone the button discards it; otherwise it is 待った.
  const provisional=!!candidate || blocked;
  const takeBack=!provisional && canTakeBack();
  $("cancel").classList.toggle("is-takeback",!provisional);
  $("cancel").disabled=!provisional && !takeBack;
  const cancelLabel=provisional?TEXT.takeback.undoProvisional:
    room?TEXT.takeback.labelOnline:
    gameMode==="ai"?TEXT.takeback.labelAi:TEXT.takeback.labelLocal;
  $("cancel").setAttribute("aria-label",cancelLabel);
  $("cancel").title=cancelLabel;
  $("endgameBar").classList.toggle("has-illegal",blocked);
  $("pass").disabled=!myTurn || game.status!=="playing";
  $("resign").disabled=!myTurn || game.status!=="playing";
  updateGradient();
  // 五目並べ has no territory, so no ownership bar.
  $("ownershipLegend").hidden=gomoku;
  const handicap=handicapOf(game),size=sizeOf(game.board);
  canvas.setAttribute("aria-label",TEXT.game.boardLabel(shownSize()));
  const japanese=isJapanese(game);
  const forbidden=hasGomokuForbidden(game);
  $("ruleSummary").textContent=TEXT.game.ruleSummary(size,komiOf(game),handicap,gomoku?"gomoku":japanese,forbidden);
  $("ruleLabel").textContent=TEXT.game.ruleLabel(size,rulesOf(game),komiOf(game),handicap,forbidden);
  // Japanese territory scoring counts prisoners, so they sit under the ownership bar.
  $("captureCounts").hidden=!japanese;
  // While counting, the dead stones taken off the board are prisoners too.
  const counted=game.status==="scoring" || game.status==="finished" && !game.result?.endsWith("+R");
  const prisoners=japanese && counted?
    areaScore(game).prisoners:{black:game.captures?.black||0,white:game.captures?.white||0};
  // Black's prisoners are White stones: that pill shows White stones, in the
  // outline colour of the White stones filled into White's territory.
  $("whitePrisoners").textContent=String(prisoners.black);
  $("blackPrisoners").textContent=String(prisoners.white);
  $("whitePrisonerPill").style.borderColor=PRISONER_OUTLINE.white;
  $("blackPrisonerPill").style.borderColor=PRISONER_OUTLINE.black;
  $("captureCounts").setAttribute("aria-label",TEXT.game.capturesAria(prisoners.black,prisoners.white));
  const isScoring=game.status==="scoring",isFinished=game.status==="finished";
  $("gamePanel").classList.toggle("is-scoring",isScoring);
  $("gamePanel").classList.toggle("is-finished",isFinished);
  $("endgameBar").classList.toggle("is-scoring",isScoring);
  $("endgameBar").classList.toggle("is-finished",isFinished);
  $("scoreBox").classList.toggle("hidden",!isScoring && !isFinished);
  $("endgameBar").hidden=isScoring || isFinished;
  $("resign").hidden=isScoring || isFinished;
  $("newMatch").hidden=!isFinished;
  $("newMatch").textContent=room?TEXT.game.newMatchOnline:TEXT.game.newMatchLocal;
  $("openHistory").hidden=!isFinished;
  if(isScoring)$("analysisStatus").textContent=TEXT.scoring.title;
  if(isFinished)$("analysisStatus").textContent="";
  $("scoringActions").hidden=!isScoring;
  for(const id of ["cancel","pass"])$(id).hidden=isScoring || isFinished;
  // 五目並べ has no pass (it ends on five in a row, a full board or 投了). The
  // button stays greyed out in its place, so the row keeps the same layout.
  if(gomoku)$("pass").disabled=true;
  $("confirm").hidden=isScoring || isFinished;
  $("copyIllegalPrompt").hidden=isScoring || isFinished || !blocked;
  $("actionRow").classList.toggle("finished-actions",isFinished);
  $("scoreBox").querySelector("strong").textContent=isFinished?TEXT.scoring.resultTitle:
    scoringStepOf(game)==="count"?TEXT.scoring.countTitle:TEXT.scoring.title;
  const playout=settleView();
  $("settleSkip").hidden=!playout;
  // A cut playout asks for one thing first: carrying it on. Its replay comes back once it is settled.
  const extendable=!playout && isScoring && !!extendablePlayout();
  $("settleExtend").hidden=!extendable;
  $("settleReplay").hidden=!!playout || !isScoring || !currentPlayout() || extendable;
  $("scoreInstruction").textContent=playout?
    (playout.finished?(playout.cut?TEXT.scoring.settleCut(playout.moves):TEXT.scoring.settleDone(playout.moves)):
      TEXT.scoring.settling(playout.moves)):
    isFinished?
    (game.result?.endsWith("+R")?TEXT.scoring.finishedResign:
      gomoku?(game.result==="0"?TEXT.scoring.finishedGomokuDraw:TEXT.scoring.finishedGomoku):
      japanese?TEXT.scoring.finishedScoreJapanese:TEXT.scoring.finishedScore):
    peerAgreed()?(scoringStepOf(game)==="dead"?TEXT.scoring.peerAgreedDead:TEXT.scoring.peerAgreed):
    deadReview==="pending"?TEXT.scoring.reviewPending:
    deadReview==="loading"?TEXT.scoring.reviewLoading:
    deadReview==="awaiting"?TEXT.scoring.reviewAwaiting:
    scoringStepOf(game)==="count"?TEXT.scoring.countStep:
    extendable?TEXT.scoring.settleExtendHint(currentPlayout().positions.length):
    deadReview==="complete"?(japanese?TEXT.scoring.reviewCompleteJapanese:TEXT.scoring.reviewComplete):
    deadReview==="none"?(japanese?TEXT.scoring.reviewNoneJapanese:TEXT.scoring.reviewNone):
    deadReview==="modified"?(japanese?TEXT.scoring.reviewModifiedJapanese:TEXT.scoring.reviewModified):
    deadReview==="unavailable"?TEXT.scoring.reviewUnavailable:
    TEXT.scoring.reviewChecking;
  // The scoring controls live in the existing sticky action row.
  $("scoreStone").className="score-stone";
  $("scoreBox").querySelector(".help-button").dataset.help=gomoku?"rules":"scoring";
  $("scoreText").hidden=false;
  if(isScoring){
    renderScoreboard();
    const ready=canApproveScoring(game,deadReview,room,connected);
    $("agree").disabled=!ready;
    const agreeing=room?(myOnlineColor()===WHITE?"white":"black"):
      gameMode==="ai"?(humanColor===BLACK?"black":"white"):"black";
    $("agree").textContent=game.agreed[agreeing]?TEXT.scoring.agreedWaiting:
      !ready?TEXT.scoring.waitingDead:
      scoringStepOf(game)==="dead"?TEXT.scoring.agreeDead:TEXT.scoring.agree;
    $("backToDead").hidden=scoringStepOf(game)!=="count";
    $("backToDead").disabled=room&&!connected;
    if(game.agreed[agreeing])$("agree").disabled=true;
    $("resume").disabled=room&&!connected;
  }
  if(isFinished) {
    const result=game.result;
    $("scoreBox").querySelector("strong").textContent=resultLabel(result)||TEXT.scoring.ended;
    const winner=resultWinner(result);
    if(winner)$("scoreStone").classList.add(winner==="B"?"black":"white");
    if(result?.endsWith("+R") || gomoku) {
      $("scoreText").hidden=true;
    } else {
      renderScoreboard();
    }
  }
  updateEndUi();
  draw();
}
function apply(action, remote=false, isAiMove=false) {
  // End-offer messages can race with an actual stone. Ignore stale metadata
  // without tearing down the live Go DataChannel. Local actions are built from
  // the current position, so only a peer's can be stale.
  if(remote && ["end_offer","end_answer","takeback_request","takeback_answer",
                 "dead_auto","dead_unavailable"].includes(action?.type)) {
    if(action.number!==game.moveNumber || action.before!==boardHash(game.board))return;
    if(action.type==="end_answer" && action.proposalFrom!==game.endProposal?.from)return;
    if(action.type==="takeback_answer" && action.proposalFrom!==game.takebackRequest?.from)return;
  }
  let rewound=false;
  try{
    // The friend's client acts only for the friend's color.
    if(remote && !isPeerAction(action,game,{peerColor:myOnlineColor()===null?null:-myOnlineColor(),
      peerIsOwner:p2pRole==="guest"}))throw new Error("Not the peer's action");
    const wasScoring=game.status==="scoring";
    if(action.type==="move"){
      if(action.number!==game.moveNumber+1) throw new Error("Move number mismatch");
      if(action.before!==boardHash(game.board)) throw new Error("Board mismatch before the move");
      const offerBefore=game.endProposal;
      game=play(game,action.position);
      if(remote && offerBefore?.from===myOnlineColor())
        endNotice={number:game.moveNumber,hash:boardHash(game.board),text:TEXT.endgame.cancelledByMove};
      if(action.after!==boardHash(game.board)) throw new Error("Board mismatch after the move");
      lastPosition=Number.isInteger(action.position)?action.position:null;
    } else if(action.type==="solo_scoring") {
      stopAiTurn(); // Invalidate pending AI workers on the old position.
      game=beginSoloScoring(game);
      endExpanded=false;
    } else if(action.type==="solo_score") {
      game=finalizeSoloScore(game);
    } else if(action.type==="dead") {
      if(game.status!=="scoring")return;
      // Send the desired group state, not a toggle, to avoid double toggles
      // when simultaneous manual edits and a delayed AI proposal cross.
      const selected=typeof action.selected==="boolean"?action.selected:
        !game.dead.includes(action.position);
      if(game.dead.includes(action.position)!==selected)
        game=toggleDead(game,action.position);
      deadReviewTouched=true;
      deadReview="modified";deadEvaluation=null;
      pending=++seq;
    } else if(action.type==="dead_auto" || action.type==="dead_unavailable") {
      if(!canApplyAutomatedReview(game,deadReviewTouched,action))return;
      if(action.type==="dead_auto")game=setDeadCandidates(game,action.positions);
      // The friend who ran the playout sends it along, so both boards can replay it.
      // Its stones on the empty points close the borders for the count.
      const frames=action.type==="dead_auto" && Array.isArray(action.playout) ?
        replayPlayout(game,action.playout) : null;
      game=withPlayoutFill(game,frames?.at(-1).board);
      if(frames) {
        settlePlayout={number:game.moveNumber,hash:boardHash(game.board),positions:[...action.playout],
          board:frames.at(-1).board,initialOwnership:settlePlayout?.initialOwnership};
        if(remote)setTimeout(replaySettle,0);
      }
      deadReview=action.type==="dead_unavailable"?"unavailable":
        action.positions.length?"complete":"none";
    }
    else if(action.type==="agree") {
      // The button checks this too; a peer may agree before our review ends.
      if(!canApproveScoring(game,deadReview,room,connected))return;
      game=agreeScore(game,action.color);
    }
    else if(action.type==="agree_dead" || action.type==="solo_dead") {
      // 日本式: the dead stones are agreed first; then the prisoners fill territory.
      // The button checks this too; a peer may agree before our review ends.
      if(!canApproveScoring(game,deadReview,room,connected))return;
      game=action.type==="solo_dead"?confirmDeadSolo(game):agreeDead(game,action.color);
    }
    else if(action.type==="back_to_dead") game=backToDead(game);
    else if(action.type==="resume") game=resume(game);
    // "mode" (the removed per-game overlay switch) from older peers is ignored below.
    else if(action.type==="end_offer") {
      game=proposeEnd(game,action.color);
      if(remote)endExpanded=false;
    } else if(action.type==="end_answer") {
      const offerFrom=game.endProposal?.from;
      game=answerEndProposal(game,action.color,Boolean(action.accept));
      if(!action.accept)endHintSuppressedUntil=game.moveNumber+4;
      if(remote && !action.accept)endNotice={number:game.moveNumber,hash:boardHash(game.board),
        text:action.color===offerFrom?TEXT.endgame.withdrawnByPeer:TEXT.endgame.declinedByPeer};
      endExpanded=false;
    } else if(action.type==="takeback_request") {
      game=requestTakeback(game,action.color);
      endExpanded=false;
    } else if(action.type==="takeback_answer") {
      rewound=Boolean(action.accept);
      game=answerTakeback(game,action.color,rewound);
      if(rewound)afterTakeback();
    }
    else return;
    if(action.type==="move")endExpanded=false;
    if(!wasScoring && game.status==="scoring") {
      deadReview="idle";deadReviewTouched=false;deadEvaluation=null;
    }
    if(action.type==="resume" || game.status==="playing") {
      deadReview="idle";deadReviewTouched=false;deadEvaluation=null;
    }
    const hadCandidate=!!candidate;
    if(room)onlineRevision++;
    // The opponent's move may land anywhere, so show the whole board again.
    if(action.type==="move" && (remote || isAiMove))boardZoom.reset();
    candidate=null;save();show();
    // Evaluate once, when a play/pass or accepted offer enters scoring.
    if(["move","resume","mode","solo_scoring"].includes(action.type) || rewound ||
       (action.type==="end_answer" && game.status==="scoring") ||
       (hadCandidate && game.status==="playing"))
      requestAnalysis();
    if(!remote&&room)p2pTransport.sendAction(action);
  }catch(error){
    // The UI offers only actions that apply, so a failure is a peer out of
    // step (or a bug): the position is resynchronised, not explained.
    console.warn("MieGO action rejected",action?.type,error);
    if(remote){showNotice(TEXT.online.peerOutOfSync);$("netStatus").textContent=TEXT.online.syncing;p2pTransport.refresh();}
  }
}
function submitMove(position,fromAi=false){
  if(boardReview && !fromAi)return;
  if(!fromAi && !isHumanTurn())return;
  if(fromAi && !isAiTurn())return;
  const before=boardHash(game.board);
  let next;
  try{next=play(game,position);}catch(error){showNotice(messageFor(error,TEXT.common.retry));return;}
  apply({type:"move",position,number:game.moveNumber+1,before,after:boardHash(next.board)},false,fromAi);
}
canvas.addEventListener("click",e=>{
  const SIZE=shownSize();
  const rect=canvas.getBoundingClientRect(),x=Math.round(((e.clientX-rect.left)/rect.width*canvas.width-canvas.width/(SIZE+1))/(canvas.width/(SIZE+1))),
    y=Math.round(((e.clientY-rect.top)/rect.height*canvas.height-canvas.height/(SIZE+1))/(canvas.height/(SIZE+1)));
  // A click that ends a pan or pinch is navigation, not a stone placement.
  if(boardZoom.consumeGestureClick())return;
  if(x<0||x>=SIZE||y<0||y>=SIZE)return;
  boardZoom.noteTap(x,y);
  const position=y*SIZE+x;
  if(boardReview){
    try{
      boardReview.preview=proposeReviewStone(boardReview,game,position);
      boardReview.previewPosition=position;
      reviewFeedback("");show();requestReviewOwnership();
    }catch(error){
      boardReview.preview=null;boardReview.previewPosition=null;
      reviewFeedback(messageFor(error,TEXT.common.retry));show();requestReviewOwnership();
    }
    return;
  }
  if(game.status==="scoring"){
    if(room&&!connected)return;
    // Counting stones are drawn on empty territory; only real stones can be marked dead.
    if(!game.board[position])return;
    // A tap on a stone during the playout skips ahead to its result and corrects
    // that stone, as it would once the playout is over (UX方針 4: 死石解析中).
    if(settleShow)stopSettleShow();
    else if(settle){settle.taps=[...(settle.taps||[]),position];skipSettle();return;}
    apply({type:"dead",position,selected:!game.dead.includes(position)});return;
  }
  if(game.status!=="playing" || !isHumanTurn())return;
  if(!room && endExpanded)endExpanded=false;
  // Occupied intersections cannot hold a provisional stone.
  if(game.board[position]!==0)return;
  const selected=inspectProvisionalMove(game,position);
  candidate=selected.candidate;illegalCandidate=selected.forbidden;
  illegalPromptCopied=false;
  $("illegalPromptFallbackPanel").hidden=true;
  show();
  // Invalidate any earlier legal-preview analysis before showing a forbidden point.
  requestAnalysis();
});
$("confirm").onclick=()=>{
  if(candidate && !illegalCandidate && isHumanTurn()){
    const position=candidate.moves.at(-1).position;
    submitMove(position);
  }
};
$("cancel").onclick=()=>{
  if(!candidate && !illegalCandidate) {
    if(!canTakeBack())return;
    // A takeback is itself reversible by replaying the move, so no second tap.
    if(room)apply({type:"takeback_request",color:myOnlineColor(),
      number:game.moveNumber,before:boardHash(game.board)});
    else takeBackMove();
    return;
  }
  candidate=null;illegalCandidate=null;illegalPromptCopied=false;
  $("illegalPromptFallbackPanel").hidden=true;
  show();requestAnalysis();
};
$("copyIllegalPrompt").onclick=async()=>{
  const selected=illegalCandidate;
  if(!selected || selected.source!==game)return;
  let question;
  try {
    // Reuse the same SGF replay URL implementation as "AI向けにコピー".
    // Do not use location.href: a live P2P room URL contains private credentials.
    const link=makeReviewUrl(location.origin,{snapshot:game},game.moves.length);
    question=makeIllegalMovePrompt(game,selected,link);
  }catch(error){
    $("endStatus").textContent=messageFor(error,TEXT.common.retry);
    return;
  }
  try{
    await writeClipboard(question);
    if(illegalCandidate===selected){
      illegalPromptCopied=true;
      $("copyIllegalPrompt").classList.add("is-copied");
      $("illegalPromptFallbackPanel").hidden=true;
    }
  }catch(error){
    if(illegalCandidate!==selected)return;
    const area=$("illegalPromptFallback");
    area.value=question;
    $("illegalPromptFallbackPanel").hidden=false;
    area.focus();area.select();
  }
};
$("closeIllegalPromptFallback").onclick=()=>{
  $("illegalPromptFallbackPanel").hidden=true;
  $("copyIllegalPrompt").focus();
};
// A mistaken pass is undone with 待った, so every mode passes on one tap.
$("pass").onclick=()=>submitMove(null);
// The armed label names the action ("投了？"): a bare "確定" reads like the
// adjacent move confirmation.
$("resign").onclick=()=>{
  if(!confirmByRetap($("resign"),null,TEXT.game.resignConfirmAria))return;
  submitMove("resign");
};
// Signals computed for the abandoned line must not survive a rewind.
function afterTakeback() {
  const last=game.moves.at(-1)?.position;
  lastPosition=Number.isInteger(last)?last:null;
  candidate=null;illegalCandidate=null;hints=null;
  if(transitionFrame!==null)cancelAnimationFrame(transitionFrame);
  transitionFrame=null;analysis=null;displayedOwnership=null;
  endgameAdvisor.reset();endgameStage="playing";endExpanded=false;
  lastOfferKey=null;endNotice=null;endHintSuppressedUntil=-1;
  deadEvaluation=null;deadReview="idle";deadReviewTouched=false;
  takebackNotice={number:game.moveNumber,hash:boardHash(game.board),
    text:TEXT.takeback.done(game.moveNumber)};
}
function takeBackMove() {
  const undone=takeBack(game,takebackOptions());
  if(!undone)return;
  stopAiTurn();
  game=undone.game;afterTakeback();
  if(gameMode==="ai")$("aiMatchStatus").textContent=TEXT.takeback.doneAi;
  save();show();requestAnalysis();
}
function resetLocalBoard() {
  if (room || gameMode!=="local") return;
  // The current match stays in the saved-game library; no modal is needed.
  if(!save())return;
  freshLocalBoard();
}
/** A new empty local board with the chosen size and handicap (callers save first). */
function freshLocalBoard() {
  resetArmedButtons();
  clearTimeout(analysisTimer);
  analysisTimer=null;
  // Discard late analysis results and animation frames belonging to the old board.
  pending=++seq;analysisContext=null;
  if(transitionFrame!==null)cancelAnimationFrame(transitionFrame);
  transitionFrame=null;displayedOwnership=null;analysis=null;
  candidate=null;lastPosition=null;
  // New endgame/dead-stone signals must not survive a local board reset.
  endgameAdvisor.reset();endgameStage="playing";endExpanded=false;
  lastOfferKey=null;endNotice=null;endHintSuppressedUntil=-1;
  deadEvaluation=null;deadReview="idle";deadReviewTouched=false;
  game=freshLocalGame(game,nextGameOptions(localHandicap));currentGameId=null;currentRevision=null;
  save();show();requestAnalysis();
}
/** 新規対戦 → 1台で打つ: leaves an AI or friend match (kept in the library). */
function startLocalGame() {
  if(room && connected &&
    !confirmByRetap($("startLocal"),TEXT.confirm.leaveForLocal))return;
  if(!save())return;
  if(room)leaveOnlineRoom();
  clearBoardReview();stopAiTurn();gameMode="local";
  freshLocalBoard();closePanels();
}
$("startLocal").onclick=startLocalGame;
$("newMatch").onclick=()=>{
  if(room){openPanel("online");return;}
  if(gameMode==="ai"){$("startAi").click();return;}
  resetLocalBoard();
};
$("agree").onclick=()=>{
  if(!canApproveScoring(game,deadReview,room,connected))return;
  const color=room?myOnlineColor():gameMode==="ai"?humanColor:BLACK;
  if(game.agreed[color===BLACK?"black":"white"])return;
  const deadStep=scoringStepOf(game)==="dead";
  if(!room)apply({type:deadStep?"solo_dead":"solo_score"});
  else apply({type:deadStep?"agree_dead":"agree",color});
};
$("resume").onclick=()=>apply({type:"resume"});
$("backToDead").onclick=()=>apply({type:"back_to_dead"});
$("endPropose").onclick=()=>{
  if(game.status!=="playing" || game.endProposal || game.takebackRequest)return;
  const color=myColorForEnd();
  if(!color || (room&&!connected))return;
  if(!room){
    if(aiThinking)return;
    // The prompt replaces any provisional stone; the board is not half-committed.
    candidate=null;illegalCandidate=null;illegalPromptCopied=false;
    $("illegalPromptFallbackPanel").hidden=true;
    endExpanded=true;show();requestAnalysis();return;
  }
  apply({type:"end_offer",color,number:game.moveNumber,before:boardHash(game.board)});
};
function answerTakebackRequest(accept) {
  const request=game.takebackRequest,color=myColorForEnd();
  if(!request || !room || !connected || color===null || (accept && request.from===color))return;
  apply({type:"takeback_answer",color,accept,proposalFrom:request.from,
    number:game.moveNumber,before:boardHash(game.board)});
}
$("endAccept").onclick=()=>{
  if(game.status!=="playing")return;
  if(game.takebackRequest){answerTakebackRequest(true);return;}
  const color=myColorForEnd();
  if(!room && endExpanded && !game.endProposal){
    // One human decision, not a fabricated AI response.
    apply({type:"solo_scoring",number:game.moveNumber,before:boardHash(game.board)});
    return;
  }
  if(!game.endProposal || !room || !connected || game.endProposal.from===color)return;
  apply({type:"end_answer",color,accept:true,proposalFrom:game.endProposal.from,
    number:game.moveNumber,before:boardHash(game.board)});
};
$("endDecline").onclick=()=>{
  if(game.status!=="playing")return;
  if(game.takebackRequest){answerTakebackRequest(false);return;}
  if(!room && endExpanded && !game.endProposal){
    // As with a friend's answer, the strongest advice waits a few moves.
    endHintSuppressedUntil=game.moveNumber+4;
    endExpanded=false;updateEndUi();
    if(isAiTurn())requestAnalysis();
    return;
  }
  if(!game.endProposal)return;
  const color=myColorForEnd();
  if(!color || (room&&!connected))return;
  apply({type:"end_answer",color,accept:false,proposalFrom:game.endProposal.from,
    number:game.moveNumber,before:boardHash(game.board)});
};
$("hideStones").onchange=e=>{hideStonesChoice=e.target.checked;rememberSettings();};
$("gomokuForbidden").onchange=e=>{gomokuForbiddenChoice=e.target.checked;rememberSettings();renderInviteButton();};
// Two aligned rows: stone, name, what is added to the board area, total.
function renderScoreboard(){
  const rows=scoreRows(game);
  const cell=(className,text)=>{
    const span=document.createElement("span");
    span.className=className;span.textContent=text;return span;
  };
  $("scoreText").replaceChildren(...["black","white"].map(color=>{
    const row=document.createElement("div");
    row.className="score-row"+(rows.leader===color?" leads":"");
    row.append(cell("score-stone "+color,""),cell("score-name",color==="black"?TEXT.common.black:TEXT.common.white),
      cell("score-detail",rows[color].detail),cell("score-total",String(rows[color].total)));
    return row;
  }));
  $("scoreText").setAttribute("aria-label",TEXT.scoring.breakdownAria(scoreBreakdown(game)));
}
function isCounting(){
  return !boardReview && (game.status==="scoring" ||
    game.status==="finished" && !game.result?.endsWith("+R") && !isGomoku(game));
}
function save(){
  try {
    const record=gameLibrary.save({id:currentGameId,mode:room?"online":gameMode,
      roomId:room||null,snapshot:game,lastPosition,humanColor,aiStrength,invasion,reinforcement,seat},currentRevision);
    currentGameId=record.id;currentRevision=record.revision;
    if(!room)gameLibrary.setActive(gameMode,record.id);
    if(room)persistOnline();
    rememberSettings();clearStorageError();
    compactOwnership();showEvictionNotice();
    return true;
  }catch(error){storageError(error);return false;}
}
function savedGame(mode) {
  let record=null;
  try{record=gameLibrary.active(mode);}catch(error){storageError(error);}
  currentGameId=record?.id||null;currentRevision=record?.revision||null;
  lastPosition=record?.lastPosition??null;
  if(mode==="ai" && record){
    humanColor=record.humanColor===WHITE?WHITE:BLACK;
    aiStrength=normalizeStrength(record.aiStrength);
    invasion=personaStep(record.invasion);reinforcement=personaStep(record.reinforcement);
  }
  return record?.snapshot||newGame(true,{size:boardSize});
}
function leaveOnlineRoom() {
  resetArmedButtons();
  if(!room)return;
  save();
  p2pTransport?.leave();
  const oldUrl=new URL(location.href);oldUrl.searchParams.delete("room");oldUrl.hash="";
  room=null;seat="host";connected=false;ownerColor=null;onlineSession=null;
  inviteKey=null;guestInviteKey=null;issuedSide=null;onlineRevision=0;p2pRole="owner";
  linkKey=null;seenPeerSignins=null;
  history.replaceState(null,"",oldUrl.pathname+oldUrl.search);
  $("inviteDetails").classList.add("hidden");
  $("inviteStatus").textContent="";
  $("roomInfo").textContent="";
}
/** Resume the unfinished saved game of another offline mode (1台 or AI). */
function resumeModeGame(mode) {
  if(room && connected &&
    !confirmByRetap($("returnToGame"),TEXT.confirm.leaveFor(mode)))return;
  if(!save())return;
  if(room)leaveOnlineRoom();
  clearBoardReview();
  stopAiTurn();gameMode=mode;
  game=savedGame(mode);candidate=null;
  endgameAdvisor.reset();endgameStage="playing";endExpanded=!!game.endProposal;
  save();closePanels();show();requestAnalysis();
}
/**
 * The 新規対戦 sheet's way back: the game on the board for the current mode
 * (leaving any replay), or the unfinished saved game of another offline mode.
 */
function returnTarget(kind) {
  if(kind==="history" || kind===(room?"online":gameMode))
    return {mode:null,label:TEXT.history.returnCurrent};
  if(kind==="online")return null; // friend rooms reopen from the saved games
  let record=null;
  try{record=gameLibrary.active(kind);}catch{}
  if(!record || record.snapshot.status==="finished")return null;
  return {mode:kind,label:kind==="ai"?TEXT.history.returnAi:TEXT.history.returnLocal};
}
function syncReturnButton(kind) {
  const target=returnTarget(kind);
  $("returnToGame").hidden=!target;
  if(target){$("returnToGame").textContent=target.label;keepArmedLabel($("returnToGame"));}
}
$("returnToGame").onclick=()=>{
  const target=returnTarget(newGameModeKind());
  if(!target)return;
  if(target.mode){resumeModeGame(target.mode);return;}
  if(boardReview){clearBoardReview();show();requestAnalysis();}
  closePanels();$("newGameButton").focus();
};
async function verifyP2P(){
  $("p2pVerify").hidden=false;
  if($("onlineSetup").hidden)openPanel("online");
  const config=await fetch("/api/p2p/config").then(r=>r.json());
  if(!config.siteKey)throw new UserError(TEXT.online.turnstileMissing);
  if(!window.turnstile){
    await new Promise((resolve,reject)=>{
      const script=document.createElement("script");
      script.src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.onload=resolve;script.onerror=()=>reject(new UserError(TEXT.online.verifyLoadFailed));
      document.head.append(script);
    });
  }
  return new Promise((resolve,reject)=>{
    $("p2pTurnstile").replaceChildren();
    window.turnstile.render($("p2pTurnstile"),{sitekey:config.siteKey,action:"miego_p2p",
      callback:resolve,"error-callback":()=>reject(new UserError(TEXT.online.verifyFailed)),
      "expired-callback":()=>reject(new UserError(TEXT.online.verifyExpired))});
  });
}
function onPeerSync(message){
  const result=reconcileGame(game,onlineRevision,message.game,message.revision,
    {localIsOwner:p2pRole==="owner",localColor:myOnlineColor()});
  if(result.kind==="conflict"||result.kind==="invalid"){
    connected=false;$("netStatus").textContent=TEXT.online.statusStopped;
    showSeatNotice(TEXT.online.mismatch);
    show();return false;
  }
  if(result.kind==="adopt"){
    game=result.game;onlineRevision=result.revision;lastPosition=message.lastPosition??null;
    candidate=null;endgameAdvisor.reset();endgameStage="playing";
    endExpanded=!!game.endProposal && game.endProposal.from!==myColorForEnd();
    deadReviewTouched=false;deadEvaluation=null;
    save();requestAnalysis();
  }
  if(game.status==="scoring"){
    const review=message.scoringReview;
    if(["complete","none","modified","unavailable"].includes(review)){
      deadReview=review;deadReviewTouched=review==="modified";deadEvaluation=null;
    }else if(p2pRole==="guest" && !["complete","none","modified","unavailable"].includes(deadReview))deadReview="awaiting";
  }
  if(result.kind==="send")p2pTransport.sendSync();
  connected=true;$("netStatus").textContent=TEXT.online.connected;show();return true;
}
p2pTransport=createP2PTransport({
  verify:verifyP2P,
  onSession:({session,ownerColor:chosen,role})=>{
    onlineSession=session;p2pRole=role;ownerColor=chosen==="black"?BLACK:WHITE;linkKey=null;
    seat=role==="owner"?"host":"guest";persistOnline();show();
  },
  onSignins:signins=>{
    linkKey=null; // The stored session worked.
    const {seen,notify}=newPeerSignins(signins,p2pRole,seenPeerSignins);
    if(notify)showSeatNotice(TEXT.online.peerSigninNotice);
    if(seen!==seenPeerSignins){seenPeerSignins=seen;persistOnline();}
  },
  onSync:onPeerSync,
  onAction:action=>apply(action,true),
  onConnected:()=>{connected=true;$("netStatus").textContent=TEXT.online.connected;show();},
  onDisconnected:message=>{connected=false;$("netStatus").textContent=message;show();},
  onError:error=>{
    console.warn("P2P",error);
    if(error.stage==="ticket" && error.status===403){
      // An opened seat link takes the seat back once; otherwise another device holds it.
      if(linkKey){inviteKey=linkKey;linkKey=null;onlineSession=null;persistOnline();void joinRoom();return;}
      $("netStatus").textContent=TEXT.online.seatElsewhere;
      showSeatNotice(TEXT.online.seatTakenNotice);
    }else if(error.stage==="ticket" && error.status===410){
      $("netStatus").textContent=TEXT.online.statusCannotJoin;
      showSeatNotice(TEXT.online.roomGone);
    }else{
      $("netStatus").textContent=TEXT.online.statusOffline;
      showNotice(messageFor(error,TEXT.online.requestFailed));
    }
    show();
  },
  getSnapshot:()=>({game,revision:onlineRevision,lastPosition,
    scoringReview:game.status==="scoring" &&
    ["complete","none","modified","unavailable"].includes(deadReview)?deadReview:null})
});
async function joinRoom(){
  if(!ROOM_PATTERN.test(room)){
    $("netStatus").textContent=TEXT.online.statusCannotJoin;showSeatNotice(TEXT.online.badInvite);return;
  }
  const targetRoom=room;
  try{
    await p2pTransport.join({room,role:p2pRole,session:onlineSession,inviteKey});
    if(targetRoom!==room)return;
  }catch(error){
    if(targetRoom!==room)return;
    $("netStatus").textContent=TEXT.online.statusOffline;showNotice(messageFor(error,TEXT.online.requestFailed));show();
  }
}
function showInviteLink() {
  if(!room||p2pRole!=="owner"||!guestInviteKey)return null;
  const url=guestUrl(location.origin,room,guestInviteKey);
  $("inviteDetails").classList.remove("hidden");$("inviteUrl").value=url;
  $("roomInfo").textContent=TEXT.online.roomInfo(colorLabel(ownerColor));
  $("nativeShare").classList.toggle("hidden",typeof navigator.share!=="function");
  renderInviteButton();return url;
}
async function beginOnlineRoom(){
  const choice=currentSideSelection();
  if(room&&inviteMatchesChoice())return showInviteLink();
  if(room&&!confirmByRetap($("copy"),TEXT.confirm.renewInvite))return null;
  if(!room && game.moveNumber>0 &&
     !confirmByRetap($("copy"),TEXT.confirm.leaveForOnline))return null;
  const color=selectColor(choice),token=await verifyP2P();
  const created=await p2pTransport.post("/api/rooms",
    {color:color===BLACK?"black":"white",turnstileToken:token});
  if(room){
    try{await p2pTransport.post("/api/rooms/"+room+"/revoke",{role:"owner",session:onlineSession});}
    catch{throw new UserError(TEXT.online.revokeFailed);}
    leaveOnlineRoom();
  }else if(!save())return null;
  room=created.room;p2pRole="owner";seat="host";ownerColor=color;
  onlineSession=created.ownerSession;inviteKey=created.ownerKey;
  guestInviteKey=created.guestKey;issuedSide=choice;onlineRevision=0;seenPeerSignins=0;linkKey=null;
  clearBoardReview();
  gameMode="online";stopAiTurn();
  game=newGame(true,nextGameOptions(onlineHandicap));candidate=null;lastPosition=null;
  currentGameId=null;currentRevision=null;
  deadReview="idle";deadReviewTouched=false;deadEvaluation=null;
  endgameAdvisor.reset();endgameStage="playing";endExpanded=false;lastOfferKey=null;endNotice=null;
  history.replaceState(null,"",roomUrl(location.origin,room));
  save();show();requestAnalysis();
  void joinRoom();return showInviteLink();
}
async function copyLink(){
  try{
    if(!room||(issuedSide!==null&&!inviteMatchesChoice())){
      $("copy").disabled=true;
      const url=await beginOnlineRoom();
      if(url)$("inviteStatus").textContent=TEXT.online.inviteReady;
      return;
    }
    const url=showInviteLink();
    const copied=await copyInviteText(url,{clipboard:navigator.clipboard,input:$("inviteUrl"),document});
    $("inviteStatus").textContent=copied?TEXT.online.inviteCopied:TEXT.online.inviteManual;
  }catch(error){$("inviteStatus").textContent=messageFor(error,TEXT.online.requestFailed);}
  finally{renderInviteButton();}
}
/** kind: "settings", "share", or a 新規対戦 tab ("local", "ai", "online", "history"). */
function openPanel(kind) {
  setBackgroundInert(true);
  $("settingsBackdrop").hidden=false;
  $("settingsPanel").hidden=kind!=="settings";
  $("sharePanel").hidden=kind!=="share";
  const newGame=kind!=="settings" && kind!=="share";
  $("modePanel").hidden=!newGame;
  $("settingsToggle").setAttribute("aria-expanded",String(kind==="settings"));
  $("shareToggle").setAttribute("aria-expanded",String(kind==="share"));
  $("newGameButton").setAttribute("aria-expanded",String(newGame));
  if(newGame)showNewGameMode(kind);
  const panel=kind==="settings"?$("settingsPanel"):kind==="share"?$("sharePanel"):$("modePanel");
  panel.querySelector(".settings-head .icon-button").focus();
}
// The 新規対戦 sheet: common board size and handicap, then the chosen mode's options.
function showNewGameMode(kind) {
  const choice=document.querySelector('input[name="newGameMode"][value="'+kind+'"]');
  if(choice)choice.checked=true;
  $("localSetup").hidden=kind!=="local";
  $("onlineSetup").hidden=kind!=="online";
  $("aiSetup").hidden=kind!=="ai";
  // 履歴 swaps the game options for the saved-game list in the same sheet.
  $("historySetup").hidden=kind!=="history";
  $("newGameSetup").hidden=kind==="history";
  $("modePanel").scrollTop=0;
  if(kind==="history")historyPanel.showHistory();
  $("aiSideRow").hidden=$("aiStrengthRow").hidden=$("aiOptions").hidden=kind!=="ai";
  $("onlineSideRow").hidden=kind!=="online";
  $("modeHelp").dataset.help=kind;
  syncReturnButton(kind);
  syncHandicapUi();
  if(kind==="online" && room)showInviteLink();
  if(kind==="online")renderInviteButton();
}
const newGameModeKind=()=>document.querySelector('input[name="newGameMode"]:checked')?.value||"ai";
for(const input of document.querySelectorAll('input[name="newGameMode"]'))
  input.onchange=e=>{if(e.target.checked)showNewGameMode(e.target.value);};
for(const input of document.querySelectorAll('input[name="boardSize"]')) {
  input.onchange=e=>{
    if(!e.target.checked)return;
    boardSize=toBoardSize(e.target.value);
    // 9x9 has five star points, so a larger handicap is reduced to five.
    localHandicap=Math.min(localHandicap,maxHandicap(boardSize));
    aiHandicap=Math.min(aiHandicap,maxHandicap(boardSize));
    onlineHandicap=Math.min(onlineHandicap,maxHandicap(boardSize));
    syncHandicapUi();rememberSettings();renderInviteButton();
  };
}
for(const input of document.querySelectorAll('input[name="gameRules"]')) {
  input.onchange=e=>{
    if(!e.target.checked)return;
    gameRules=toRules(e.target.value);
    syncHandicapUi();rememberSettings();renderInviteButton();
  };
}
function reviewFeedback(message){
  $("reviewFeedback").textContent=message;$("reviewFeedback").hidden=!message;
}
function discardReviewPreview(){
  if(!boardReview?.preview)return;
  boardReview.preview=null;boardReview.previewPosition=null;
  reviewFeedback("");show();requestReviewOwnership();
}
function confirmReviewPreview(){
  if(!boardReview?.preview)return;
  try{
    const result=commitReviewStone(boardReview,game,boardReview.previewPosition);
    Object.assign(boardReview,result);
    boardReview.preview=null;boardReview.previewPosition=null;
    reviewFeedback("");
    $("reviewNotice").textContent=result.created?TEXT.review.variationCreated:"";
    $("reviewMenu").open=false;
    show();requestReviewOwnership();
  }catch(error){reviewFeedback(messageFor(error,TEXT.common.retry));}
}
function selectOriginalLine(){
  if(!boardReview)return;
  boardReview.activeLine="main";
  boardReview.preview=null;boardReview.previewPosition=null;
  const original=boardReview.source==="live"?game:boardReview.snapshot;
  boardReview.step=Math.min(boardReview.step,original.moves.length);
  boardReview.display=replaySteps(original,boardReview.step);
  $("reviewMenu").open=false;
  reviewFeedback("");show();requestReviewOwnership();
}
function selectVariationLine(){
  if(!boardReview?.variation)return;
  boardReview.activeLine="variation";
  boardReview.preview=null;boardReview.previewPosition=null;
  const line=boardReview.variation.snapshot;
  boardReview.step=Math.min(boardReview.step,line.moves.length);
  boardReview.display=replaySteps(line,boardReview.step);
  $("reviewMenu").open=false;
  reviewFeedback("");show();requestReviewOwnership();
}
function previewReviewPass(){
  if(!boardReview)return;
  try{
    boardReview.preview=proposeReviewStone(boardReview,game,null);
    boardReview.previewPosition=null;
    $("reviewMenu").open=false;
    reviewFeedback(TEXT.review.passPreview);show();requestReviewOwnership();
  }catch(error){reviewFeedback(messageFor(error,TEXT.common.retry));}
}
function saveReviewVariation(){
  if(!boardReview?.variation)return;
  try{
    gameLibrary.save({mode:"local",snapshot:boardReview.variation.snapshot,source:"variation"});
    $("reviewNotice").textContent=TEXT.review.variationSaved;
  }catch(error){$("reviewNotice").textContent=messageFor(error,TEXT.review.variationSaveFailed);}
}
function renderBoardReview() {
  if(!boardReview)return;
  // The live match may advance over WebRTC or AI while the chosen step stays fixed.
  if(boardReview.source==="live")boardReview.snapshot=game;
  const {step,source}=boardReview;
  const line=activeReviewSnapshot(boardReview,game),count=line.moves.length;
  const variationActive=boardReview.activeLine==="variation" && !!boardReview.variation;
  const isPreview=!!boardReview.preview;
  $("ownershipLegend").hidden=isGomoku(line);
  $("reviewTitle").textContent=variationActive?TEXT.review.checkingVariation:source==="url"?TEXT.review.checkingShared:TEXT.review.checking;
  $("reviewStepText").textContent=TEXT.review.step(step,count);
  $("reviewStepRange").max=String(count);
  $("reviewStepRange").value=String(step);
  $("reviewFirst").disabled=step===0 || isPreview;
  $("reviewPrevious").disabled=step===0 || isPreview;
  $("reviewNext").disabled=step>=count || isPreview;
  $("reviewLast").disabled=step>=count || isPreview;
  $("reviewStepRange").disabled=isPreview;
  $("reviewStepToggle").disabled=isPreview;
  $("reviewPrevious").hidden=isPreview;
  $("reviewNext").hidden=isPreview;
  $("reviewStepToggle").hidden=isPreview;
  $("reviewPlayActions").hidden=!isPreview;
  $("reviewConfirmStone").classList.toggle("white",boardReview.preview?.moves.at(-1)?.color===WHITE);
  $("reviewOriginal").hidden=!variationActive;
  $("reviewVariation").hidden=variationActive || !boardReview.variation;
  $("reviewSaveVariation").hidden=!boardReview.variation;
  $("reviewPass").disabled=isPreview;
  $("reviewPass").hidden=isGomoku(line); // 五目並べ has no pass.
  const updates=source==="live"?Math.max(0,game.moveNumber-boardReview.openedAt):0;
  $("reviewNewMoves").hidden=updates===0;
  $("reviewNewMoves").textContent=updates>0?TEXT.review.newMoves(updates):"";
  // The move chip is the way back: to the latest move, the original line, or the game.
  const back=variationActive?TEXT.review.backOriginal:source==="live"?TEXT.review.backLatest:TEXT.review.backGame;
  $("moveLabel").textContent=back+" ›";
  $("moveLabel").setAttribute("aria-label",back);$("moveLabel").title=back;
  $("moveLabel").classList.add("is-returning");$("gamePanel").classList.add("is-reviewing");
  $("moveLabel").disabled=false;
  $("turn").classList.toggle("white-to-play",boardReview.display.next===WHITE);
  $("turn").classList.remove("no-stone");
  $("turn").textContent=isPreview?TEXT.review.trying(step+1):variationActive?TEXT.review.trying(step):TEXT.review.showing(step);
  $("gamePanel").classList.remove("is-scoring","is-finished");
  $("netStatus").textContent=source==="archive"?TEXT.game.savedGames:source==="url"?TEXT.review.sourceUrl:
    gameMode==="ai"?TEXT.common.modeAi:room?TEXT.review.sourceOnline:TEXT.common.modeLocal;
  // One primary slot: resume the saved game at its end, otherwise start from here.
  $("reviewContinue").textContent=canResumeSelectedReview()?TEXT.review.resume:TEXT.review.continue;
  $("reviewContinue").hidden=isPreview;
  $("actionRow").hidden=true;
  $("endgameBar").hidden=true;
  $("scoreBox").hidden=true;
  $("reviewPanel").hidden=false;
  draw();
}
// A replayed position shows the same KataGo estimate as during play: the one
// kept for it then, or a fresh KataGo evaluation. The simple influence model
// is only the fallback when KataGo is unavailable.
// Whose estimates a replayed line holds: the current game keeps every position,
// another saved game only its final board (its thumbnail), a variation or a
// shared URL nothing beyond this page.
function reviewOwner() {
  const variation=boardReview.activeLine==="variation" && !!boardReview.variation;
  const record=boardReview.source==="archive" ? boardReview.record : null;
  const gameId=variation ? null : boardReview.source==="live" ? currentGameId : record?.id ?? null;
  return {gameId,finalHash:record && !variation ? boardHash(record.snapshot.board) : null};
}
function keepReviewOwnership({gameId,finalHash},board,values) {
  try{
    if(gameId && (gameId===currentGameId || boardHash(board)===finalHash))
      ownershipStore.remember(gameId,board,values);
    else ownershipStore.keep(board,values);
  }catch(error){console.warn("Ownership not kept",error);}
}
// While a game is replayed, KataGo estimates its other positions in the
// background, nearest to the one on screen first, whenever the worker is idle.
function planPrefetch() {
  if(!boardReview){prefetch=null;return;}
  const line=activeReviewSnapshot(boardReview,game);
  if(prefetch?.line!==line){
    let states;
    try{states=replayLine(line);}catch{prefetch=null;return;}
    prefetch={line,states,queue:[],inflight:null,...reviewOwner()};
  }
  prefetch.queue=prefetchOrder(prefetch.states.length-1,boardReview.step)
    .filter(step=>step!==prefetch.inflight?.step);
  pumpPrefetch();
}
function pumpPrefetch() {
  if(!boardReview){prefetch=null;return;}
  if(!prefetch || prefetch.inflight || workerWaiting!==null || aiThinking ||
     !katagoReady || fallbackMode || !overlayOn())return;
  while(prefetch.queue.length){
    const step=prefetch.queue.shift(),state=prefetch.states[step];
    if(!state || ownershipStore.recall(prefetch.gameId,state.board))continue;
    const id=++seq;
    postToWorker({id,state,board:state.board});
    prefetch.inflight={id,step};
    return;
  }
}
function requestReviewOwnership() {
  if(!boardReview)return;
  try{showReviewOwnership();}finally{planPrefetch();}
}
function showReviewOwnership() {
  boardReview.ownership=null;
  boardReview.analysisId=++reviewSequence;
  boardReview.katagoId=null;
  if(!overlayOn() || isGomoku(boardReview.display)){draw();return;}
  const state=boardReview.preview||boardReview.display;
  const gameId=boardReview.source==="live" ? currentGameId : boardReview.record?.id ?? null;
  const kept=ownershipStore.recall(gameId,state.board);
  if(kept){boardReview.ownership=kept;draw();return;}
  if(katagoReady && !fallbackMode){
    boardReview.katagoId=++seq;
    postToWorker({id:boardReview.katagoId,state,board:state.board});
    draw();return;
  }
  if(!reviewWorker){
    reviewWorker=new Worker("/analysis-worker.mjs",{type:"module"});
    reviewWorker.onmessage=e=>{
      if(!boardReview || e.data.id!==boardReview.analysisId ||
         !Array.isArray(e.data.ownership) || e.data.ownership.length!==boardReview.display.board.length)return;
      boardReview.ownership=e.data.ownership;
      draw();
    };
    reviewWorker.onerror=e=>{
      console.warn("Review ownership unavailable",e);
      $("reviewNotice").textContent=TEXT.review.ownershipFailed;
      reviewWorker?.terminate();reviewWorker=null;
    };
  }
  reviewWorker.postMessage({id:boardReview.analysisId,board:boardReview.preview?.board||boardReview.display.board});
}
function enterBoardReview(snapshot,step,source="live",metadata=null,record=null) {
  const display=replaySteps(snapshot,step);
  boardReview={snapshot,display,step,source,metadata,record,ownership:null,
    activeLine:"main",variation:null,preview:null,previewPosition:null,
    openedAt:game.moveNumber,analysisId:0};
  $("reviewNotice").textContent="";
  show();requestReviewOwnership();
}
function setBoardReviewStep(step) {
  if(!boardReview)return;
  const snapshot=activeReviewSnapshot(boardReview,game);
  if(!Number.isInteger(step)||step<0||step>snapshot.moves.length)return;
  if(boardReview.source==="live" && boardReview.activeLine!=="variation" &&
    step===snapshot.moves.length){
    leaveBoardReview();return;
  }
  try{
    const display=replaySteps(snapshot,step);
    boardReview.display=display;boardReview.step=step;
    boardReview.preview=null;boardReview.previewPosition=null;
    reviewFeedback("");$("reviewNotice").textContent="";
    show();requestReviewOwnership();
  }catch(error){$("reviewNotice").textContent=TEXT.history.replayFailed;}
}
function clearBoardReview() {
  if(!boardReview)return;
  const wasUrl=boardReview.source==="url";
  boardReview=null;reviewSequence++;
  if(wasUrl)clearImportedReviewUrl();
  $("moveLabel").classList.remove("is-returning");$("gamePanel").classList.remove("is-reviewing");
  $("moveLabel").setAttribute("aria-label",TEXT.review.play);$("moveLabel").title=TEXT.review.play;
}
function leaveBoardReview() {
  if(!boardReview)return;
  if(boardReview.activeLine==="variation"){selectOriginalLine();return;}
  clearBoardReview();
  show();requestAnalysis();
  $("moveLabel").focus();
}
function clearImportedReviewUrl() {
  const url=new URL(location.href);
  if(!url.searchParams.has("sgf"))return;
  url.searchParams.delete("sgf");url.searchParams.delete("move");
  history.replaceState(null,"",url.pathname+url.search+url.hash);
}
// 「ここから打つ」: the shown position starts a new game record. The game it came
// from is saved as it stands and stays in the saved-game list.
// 五目並べ's COM is a small line counter and needs no KataGo.
const canContinueWithAi=()=>!!boardReview && isGomoku(activeReviewSnapshot(boardReview,game)) || katagoReady && !fallbackMode;
function continueChoice(name){return document.querySelector('input[name="'+name+'"]:checked')?.value;}
function syncContinueSide(){$("continueSideRow").hidden=continueChoice("continueKind")!=="ai";}
function openContinuePanel(){
  if(!boardReview)return;
  // The players default to those of the game being replayed.
  // A 1台 game continues on one board; anything else (AI, friend, SGF, a shared URL) against the AI.
  const live=boardReview.source==="live",record=live?null:boardReview.record;
  const fromLocal=live?!room && gameMode==="local":record?.mode==="local" && record.source==="played";
  const side=live && !room && gameMode==="ai"?humanColor:record?.mode==="ai"?record.humanColor:BLACK;
  const ai=canContinueWithAi();
  document.querySelector('input[name="continueKind"][value="ai"]').disabled=!ai;
  document.querySelector('input[name="continueKind"][value="'+(ai && !fromLocal?"ai":"local")+'"]').checked=true;
  document.querySelector('input[name="continueSide"][value="'+(side===WHITE?"white":"black")+'"]').checked=true;
  syncContinueSide();
  $("continueTitle").textContent=TEXT.review.continueTitle(boardReview.step);
  setBackgroundInert(true);
  $("settingsBackdrop").hidden=false;$("continuePanel").hidden=false;
  $("closeContinue").focus();
}
function forkBoardReview(kind="local",side=BLACK) {
  if(!boardReview)return;
  let fork;
  try{fork=forkReview(activeReviewSnapshot(boardReview,game),boardReview.step);}
  catch{$("reviewNotice").textContent=TEXT.review.branchFailed;closePanels();return;}
  if(kind==="ai" && !canContinueWithAi())return; // The choice is disabled meanwhile.
  if(room && connected && !confirmByRetap($("startContinue"),TEXT.confirm.leaveForReview))return;
  if(!save())return;
  if(room)leaveOnlineRoom();
  stopAiTurn();gameMode=kind;game=fork;
  if(kind==="ai"){humanColor=side;hints=null;takebackNotice=null;}
  currentGameId=null;currentRevision=null;
  const last=game.moves.at(-1)?.position;
  lastPosition=Number.isInteger(last)?last:null;
  candidate=null;analysis=null;displayedOwnership=null;
  endgameAdvisor.reset();endgameStage="playing";endExpanded=false;
  lastOfferKey=null;endNotice=null;endHintSuppressedUntil=-1;
  deadEvaluation=null;deadReview="idle";deadReviewTouched=false;
  clearImportedReviewUrl();
  clearBoardReview();
  save();closePanels();show();requestAnalysis();
}
// Everything in the share sheet works on the displayed board: the replayed
// line and step while replaying, otherwise the live game as it stands.
function sharedPosition() {
  if(boardReview)return {...variationForSharing(boardReview,game),
    gameId:boardReview.source==="live" ? currentGameId : boardReview.record?.id ?? null};
  return {snapshot:game,metadata:null,step:game.moves.filter(m=>m.position!=="resign").length,
    gameId:currentGameId};
}
function sharedUrl() {
  const {snapshot,metadata,step}=sharedPosition();
  return makeReviewUrl(location.origin,{snapshot,sgfMeta:metadata},step);
}
async function copyShareUrl(ai) {
  try{
    const url=sharedUrl();
    await copyWithFallback(ai?makeAiHandoff(url):url,$("shareNotice"),$("shareCopyFallback"));
  }catch(error){$("shareNotice").textContent=messageFor(error,TEXT.share.urlFailed);}
}
function canResumeSelectedReview(){
  const review=boardReview,record=review?.record;
  return !!(review?.source==="archive" && record &&
    review.activeLine!=="variation" && !review.preview &&
    navigationState(record,review.step).resumable);
}
function openSavedBoard(record) {
  // Selecting a record only changes the displayed board. The live P2P/AI
  // game remains untouched until the user explicitly resumes or forks.
  try{
    const count=record.snapshot.moves.length;
    replaySteps(record.snapshot,count);
    // If the previous board came from a shared SGF URL, do not leave that
    // old URL in the address bar after opening another saved record.
    if(boardReview?.source==="url")clearImportedReviewUrl();
    closePanels();
    enterBoardReview(record.snapshot,count,"archive",record.sgfMeta,record);
    $("moveLabel").focus();
  }catch(error){
    $("historySaveNotice").textContent=TEXT.history.showFailed;
    if($("historySetup").hidden)openHistoryPanel();
  }
}
function exportSharedSGF(){
  try{
    const details=sharedPosition();
    const contents=exportSGF({snapshot:details.snapshot,sgfMeta:details.metadata});
    const id=boardReview?boardReview.record?.id||"shared":currentGameId||"game";
    downloadBlob(new Blob([contents],{type:"application/x-go-sgf;charset=utf-8"}),"miego-"+id+".sgf");
    $("shareNotice").textContent=TEXT.share.sgfSaved;
  }catch(error){$("shareNotice").textContent=TEXT.share.sgfFailed;}
}
// Every frame of a shared animation carries the colours seen while playing.
function rememberOwnership(board,values){
  try{ownershipStore.remember(currentGameId,board,values);}catch(error){console.warn("Ownership not kept",error);}
}
const shareImages=createShareImages({$,canvas,draw,sharedPosition,ownershipStore,appearance,
  stillColoured:()=>boardReview ? !!boardReview.ownership : game.status==="playing" && !!displayedOwnership});
function openSharePanel(){
  openPanel("share");
  $("shareNotice").textContent="";
  $("shareCopyFallback").hidden=true;
  void shareImages.prepare();
}
$("moveLabel").onclick=()=>{
  if(boardReview){leaveBoardReview();return;}
  // Opening the replay steps back one move at once, so the tap visibly changes the board.
  if(!game.moves.length)return;
  try{enterBoardReview(game,game.moves.length-1,"live");}
  catch{$("saveStatus").hidden=false;$("saveStatus").textContent=TEXT.history.replayFailed;}
};
$("reviewStepToggle").onclick=()=>{$("reviewMenu").open=true;$("reviewStepRange").focus();};
$("reviewFirst").onclick=()=>setBoardReviewStep(0);
$("reviewPrevious").onclick=()=>boardReview&&setBoardReviewStep(boardReview.step-1);
$("reviewNext").onclick=()=>boardReview&&setBoardReviewStep(boardReview.step+1);
$("reviewLast").onclick=()=>boardReview&&setBoardReviewStep(boardReview.snapshot.moves.length);
$("reviewStepRange").oninput=e=>setBoardReviewStep(Number(e.target.value));
$("reviewConfirm").onclick=confirmReviewPreview;
$("reviewCancel").onclick=discardReviewPreview;
$("reviewOriginal").onclick=selectOriginalLine;
$("reviewVariation").onclick=selectVariationLine;
$("reviewPass").onclick=previewReviewPass;
$("reviewSaveVariation").onclick=saveReviewVariation;
document.addEventListener("keydown",e=>{
  if(e.key==="Escape" && boardReview?.preview){discardReviewPreview();return;}
  if(e.key==="Escape" && $("reviewMenu").open)$("reviewMenu").open=false;
});
$("reviewContinue").onclick=()=>canResumeSelectedReview()?resumeSelectedReview():openContinuePanel();
for(const input of document.querySelectorAll('input[name="continueKind"]'))input.onchange=syncContinueSide;
$("closeContinue").onclick=closePanels;
$("startContinue").onclick=()=>forkBoardReview(continueChoice("continueKind")==="ai"?"ai":"local",
  continueChoice("continueSide")==="white"?WHITE:BLACK);
$("shareLink").onclick=()=>void copyShareUrl(false);
$("shareAiLink").onclick=()=>void copyShareUrl(true);
$("shareSgf").onclick=exportSharedSGF;
function resumeSelectedReview(){
  if(!canResumeSelectedReview())return;
  const selected=boardReview.record;
  if(room && connected &&
    !confirmByRetap($("reviewContinue"),TEXT.confirm.leaveForArchive))return;
  // Reload the record before mutating anything; another tab may have advanced it.
  let record=gameLibrary.load(selected.id);
  if(!record || (record.revision!==selected.revision &&
    !(selected.id===currentGameId && selected.mode===gameMode))){
    $("reviewNotice").textContent=TEXT.history.otherTabReview;
    return;
  }
  if(!save())return;
  record=gameLibrary.load(selected.id);
  if(!record){
    $("reviewNotice").textContent=TEXT.history.loadFailed;
    return;
  }
  if(room)leaveOnlineRoom();
  stopAiTurn();
  gameMode=record.mode;game=JSON.parse(JSON.stringify(record.snapshot));
  currentGameId=record.id;currentRevision=record.revision;
  lastPosition=record.lastPosition;candidate=null;
  if(gameMode==="ai"){
    humanColor=record.humanColor===WHITE?WHITE:BLACK;
    invasion=personaStep(record.invasion);reinforcement=personaStep(record.reinforcement);
    aiStrength=normalizeStrength(record.aiStrength);syncStrengthUi();
    // A random preference stays random; a fixed one follows the resumed game.
    if(aiSideChoice!=="random")aiSideChoice=humanColor===WHITE?"white":"black";
    syncSideUi();
    updatePersonaUi();
  }
  endgameAdvisor.reset();endgameStage="playing";endExpanded=!!game.endProposal;
  lastOfferKey=null;endNotice=null;deadReview=game.status==="scoring" &&
    (game.dead.length || game.agreed.black || game.agreed.white)?"modified":"idle";
  deadEvaluation=null;deadReviewTouched=deadReview==="modified";
  analysis=null;displayedOwnership=null;
  try{gameLibrary.setActive(gameMode,currentGameId);}
  catch(error){storageError(error);return;}
  clearBoardReview();rememberSettings();
  closePanels();show();requestAnalysis();
}
$("historyImportFile").onchange=e=>void importHistoryFile(e.target.files?.[0]);
$("openHistory").onclick=openHistoryPanel;
$("saveStatus").onclick=()=>{$("saveStatus").hidden=true;};
$("seatNotice").onclick=()=>{$("seatNotice").hidden=true;};
$("copySeatLink").onclick=()=>{
  const link=ownSeatLink();
  if(link)void copyWithFallback(link,$("seatLinkStatus"),$("seatLinkFallback"),TEXT.online.seatLinkCopied);
};
document.addEventListener("storage",e=>{
  if(e.key?.startsWith("miego:game:v1:") && !$("historySetup").hidden)renderHistoryList();
});
function openSettings(){openPanel("settings");}
function closePanels() {
  resetArmedButtons();
  setBackgroundInert(false);
  $("settingsBackdrop").hidden=true;
  $("settingsPanel").hidden=true;
  $("sharePanel").hidden=true;
  shareImages.clear();
  $("modePanel").hidden=true;
  $("continuePanel").hidden=true;
  $("helpPanel").hidden=true;
  $("helpToggle").setAttribute("aria-expanded","false");
  closeHelpPopover(false);
  $("historySetup").hidden=true;
  $("onlineSetup").hidden=true;
  $("aiSetup").hidden=true;
  $("localSetup").hidden=true;
  $("settingsToggle").setAttribute("aria-expanded","false");
  $("shareToggle").setAttribute("aria-expanded","false");
  $("newGameButton").setAttribute("aria-expanded","false");
}
function closeSettings(){closePanels();$("settingsToggle").focus();}
$("settingsToggle").onclick=()=>$("settingsPanel").hidden?openSettings():closeSettings();
$("closeSettings").onclick=closeSettings;
$("shareToggle").onclick=()=>$("sharePanel").hidden?openSharePanel():closeShare();
function closeShare(){closePanels();$("shareToggle").focus();}
$("closeShare").onclick=closeShare;
$("closeMode").onclick=()=>{closePanels();$("newGameButton").focus();};
// The help sheet stacks above any open sheet; a local ? shows one topic of it.
const {closeHelpPopover}=createHelpSheet({$,getGame:()=>game,setBackgroundInert,closePanels});
$("newGameButton").onclick=()=>openPanel(room?"online":gameMode);
$("settleSkip").onclick=()=>{
  if(settleShow){stopSettleShow();show();}
  else skipSettle();
};
$("settleReplay").onclick=replaySettle;
$("settleExtend").onclick=extendSettle;
$("startAi").onclick=()=>{
  // The button is disabled meanwhile, except for 五目並べ, which needs no KataGo.
  if(gameRules!=="gomoku" && (!katagoReady || fallbackMode))return;
  if(room && connected &&
     !confirmByRetap($("startAi"),TEXT.confirm.leaveForAi))return;
  if(!save())return;
  if(room)leaveOnlineRoom();
  clearBoardReview();
  stopAiTurn();
  gameMode="ai";
  // Handicap stones always belong to the human, who therefore plays Black.
  // Otherwise: the same choices and the same random draw as a friend invitation.
  try{humanColor=aiHandicap && gameRules!=="gomoku"?BLACK:selectColor(aiSideChoice);}
  catch{$("aiMatchStatus").textContent=TEXT.common.retry;return;}
  aiStrength=strengthAt($("aiStrength").value);
  hints=null;takebackNotice=null;
  game=newGame(true,nextGameOptions(aiHandicap));currentGameId=null;currentRevision=null;lastPosition=null;candidate=null;
  endgameAdvisor.reset();endgameStage="playing";endExpanded=false;lastOfferKey=null;endNotice=null;
  $("aiMatchStatus").textContent=TEXT.ai.started(colorLabel(humanColor));
  save();closePanels();show();requestAnalysis();
};
const SIDE_CHOICES=["random","black","white"];
function syncSideUi() {
  const input=document.querySelector('input[name="aiSide"][value="'+aiSideChoice+'"]');
  if(input)input.checked=true;
}
for (const input of document.querySelectorAll('input[name="aiSide"]')) {
  input.onchange=e=>{
    if(!e.target.checked)return;
    aiSideChoice=SIDE_CHOICES.includes(e.target.value)?e.target.value:"black";
    rememberSettings();
  };
}
function syncHandicapUi() {
  const sizeChoice=document.querySelector('input[name="boardSize"][value="'+boardSize+'"]');
  if(sizeChoice)sizeChoice.checked=true;
  const rulesChoice=document.querySelector('input[name="gameRules"][value="'+gameRules+'"]');
  if(rulesChoice)rulesChoice.checked=true;
  // One set of handicap buttons shows the stored choice of the selected mode.
  const kind=newGameModeKind(),ai=kind==="ai";
  const shown=ai?aiHandicap:kind==="online"?onlineHandicap:localHandicap;
  for(const option of $("handicap").options)option.disabled=Number(option.value)>maxHandicap(boardSize);
  // 五目並べ takes no handicap stones (newGame() drops them); 禁じ手 is its own choice.
  $("handicapSetup").hidden=gameRules==="gomoku";
  $("gomokuForbiddenRow").hidden=gameRules!=="gomoku";
  $("handicap").value=String(shown);
  // The note only appears when stones are placed, so an even game shows no extra text.
  $("handicapNote").hidden=!shown || gameRules==="gomoku";
  $("handicapNote").textContent=(ai?TEXT.handicap.noteAi:
    kind==="online"?TEXT.handicap.noteOnline:TEXT.handicap.noteLocal)+
    (gameRules==="japanese"?TEXT.handicap.noteRuleJapanese:TEXT.handicap.noteRule)+(boardSize===9?TEXT.handicap.note9:"");
  // With handicap the human is Black; the saved side preference returns afterwards.
  for(const input of document.querySelectorAll('input[name="aiSide"]'))
    input.disabled=!!aiHandicap && gameRules!=="gomoku" && input.value!=="black";
  if(aiHandicap && gameRules!=="gomoku"){
    const black=document.querySelector('input[name="aiSide"][value="black"]');
    if(black)black.checked=true;
  }else syncSideUi();
}
{
  $("handicap").onchange=e=>{
    const value=toHandicap(e.target.value);
    if(newGameModeKind()==="ai"){
      aiHandicap=value;
      $("aiMatchStatus").textContent=aiHandicap?
        TEXT.ai.nextHandicap(aiHandicap):TEXT.ai.nextEven;
    }else if(newGameModeKind()==="online")onlineHandicap=value;
    else localHandicap=value;
    syncHandicapUi();rememberSettings();renderInviteButton();
  };
}
for(const [id,key] of [["aiInvasion","invasion"],["aiReinforcement","reinforcement"]]) {
  $(id).oninput=e=>{
    const value=personaStep(e.target.value);
    if(key==="invasion")invasion=value;else reinforcement=value;
    updatePersonaUi();rememberSettings();
    $("aiMatchStatus").textContent=TEXT.ai.nextMove;
  };
}
// The strength bar's stops follow AI_STRENGTHS from weakest to strongest.
const STRENGTH_ORDER=Object.keys(AI_STRENGTHS);
const strengthAt=index=>normalizeStrength(STRENGTH_ORDER[Number(index)],DEFAULT_AI_STRENGTH);
function syncStrengthUi() {
  $("aiStrength").value=String(STRENGTH_ORDER.indexOf(aiStrength));
  syncStepSlider("aiStrength");
  $("aiHints").checked=aiHints;
}
// Strength applies from the next AI move, like the personality sliders.
$("aiStrength").oninput=e=>{
  aiStrength=strengthAt(e.target.value);syncStepSlider("aiStrength");
  if(gameMode==="ai")save();else rememberSettings();
  $("aiMatchStatus").textContent=TEXT.ai.nextStrength(AI_STRENGTHS[aiStrength].label);
};
$("aiHints").onchange=e=>{
  aiHints=e.target.checked;rememberSettings();
  if(aiHints && !visibleHints())requestAnalysis();
  draw();
};
$("copy").onclick=copyLink;
$("inviteUrl").onclick=e=>e.currentTarget.select();
$("nativeShare").onclick=async()=>{
  const link=showInviteLink();
  if(!link||typeof navigator.share!=="function")return;
  try{await navigator.share({title:TEXT.online.shareTitle,url:link});}
  catch(error){if(error.name!=="AbortError")$("inviteStatus").textContent=TEXT.online.shareFailed;}
};
for(const input of document.querySelectorAll('input[name="onlineSide"]'))input.onchange=renderInviteButton;
// The next game's "石を隠す" is read even in a room, where the other
// remembered choices are not, so leaving the room does not forget it.
try{hideStonesChoice=JSON.parse(localStorage.getItem("miego-local-settings")||"null")?.hideStones===true;}catch{}
if(room){
  const stored=readCheckpoint(localStorage,room);
  const linkRole=inviteFragment.get("role");
  const safeStored=stored && (linkRole===null||linkRole===stored.role);
  if(safeStored){
    p2pRole=stored.role;ownerColor=stored.ownerColor;
    inviteKey=stored.inviteKey||inviteKey;guestInviteKey=stored.guestInviteKey;
    onlineSession=stored.session;issuedSide=stored.issuedSide;onlineRevision=stored.revision;
    seenPeerSignins=Number.isInteger(stored.seenPeerSignins)?stored.seenPeerSignins:null;
    game=stored.game;lastPosition=stored.lastPosition;
    const prior=gameLibrary.list().find(r=>r.mode==="online"&&r.roomId===room);
    if(prior){currentGameId=prior.id;currentRevision=prior.revision;}
    endExpanded=!!game.endProposal;
    if(issuedSide){
      const input=document.querySelector('input[name="onlineSide"][value="'+issuedSide+'"]');
      if(input)input.checked=true;
    }
  }
  if(linkRole==="owner"||linkRole==="guest")p2pRole=linkRole;
  seat=p2pRole==="owner"?"host":"guest";
  gameMode="online";
  if(p2pRole==="owner")showInviteLink();
  // Seat keys leave the address bar once read, so a copied address names only
  // the room. They are kept in this browser first, in case verification is cut short.
  if(inviteFragment.has("key") || inviteFragment.has("role")){
    if(inviteKey && (!stored || safeStored))persistOnline();
    if(ROOM_PATTERN.test(room))history.replaceState(null,"",roomUrl(location.origin,room));
  }
  renderInviteButton();
  void joinRoom();
}
else try {
  const settings=JSON.parse(localStorage.getItem("miego-local-settings")||"null");
  if(settings){
    gameMode=settings.mode==="ai"?"ai":"local";
    humanColor=settings.humanColor===WHITE?WHITE:BLACK;
    // Older settings stored only the resolved color.
    aiSideChoice=SIDE_CHOICES.includes(settings.aiSide)?settings.aiSide:
      humanColor===WHITE?"white":"black";
    aiStrength=normalizeStrength(settings.aiStrength,DEFAULT_AI_STRENGTH);
    aiHandicap=toHandicap(settings.aiHandicap);
    localHandicap=toHandicap(settings.localHandicap);
    onlineHandicap=toHandicap(settings.onlineHandicap);
    boardSize=toBoardSize(settings.boardSize);
    gameRules=toRules(settings.gameRules);
    gomokuForbiddenChoice=settings.gomokuForbidden===true;
    aiHandicap=Math.min(aiHandicap,maxHandicap(boardSize));
    localHandicap=Math.min(localHandicap,maxHandicap(boardSize));
    onlineHandicap=Math.min(onlineHandicap,maxHandicap(boardSize));
    aiHints=settings.aiHints===true;
    invasion=personaStep(settings.invasion);
    reinforcement=personaStep(settings.reinforcement);
  }
  game=savedGame(gameMode);endExpanded=!!game.endProposal;
}catch{}
syncSideUi();
updatePersonaUi();syncStrengthUi();syncHandicapUi();
appearance.syncControls();
$("hideStones").checked=hideStonesChoice;
$("gomokuForbidden").checked=gomokuForbiddenChoice;
if(!room && currentGameId===null)save();
if(!room && params.has("sgf")){
  try{
    const imported=readReviewUrl(location.href);
    if(imported.kind==="review")
      enterBoardReview(imported.snapshot,imported.step,"url",imported.metadata);
  }catch(error){
    $("saveStatus").hidden=false;
    $("saveStatus").textContent=TEXT.history.sharedLoadFailed;
  }
}
compactOwnership();
show();requestAnalysis();
