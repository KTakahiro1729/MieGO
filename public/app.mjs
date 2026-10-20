import { BLACK, WHITE, BOARD_SIZES, sizeOf, maxHandicap, newGame, play, toggleDead, resume, agreeScore, beginSoloScoring, finalizeSoloScore, boardHash, handicapOf, komiOf, proposeEnd, answerEndProposal, setDeadCandidates } from "./core.mjs";
import { suggestDeadStones } from "./dead-stones.mjs";
import { EndgameAdvisor, endgameHint } from "./endgame.mjs";
import { copyInviteText } from "./invite.mjs";
import { ROOM_PATTERN, selectColor, playerColor, colorLabel, guestUrl, ownUrl, readCheckpoint, saveCheckpoint, reconcileGame, isPeerAction, storageKey, roomUrl, newPeerSignins } from "./p2p-session.mjs";
import { createP2PTransport } from "./p2p-transport.mjs";
import { isPaletteChoice, normalizePalette, showsOwnership, paletteGradient, countingGradient, interpolateOwnership, PALETTE_CUSTOM, COLOUR_KEYS, paletteColours, setCustomColours, setOpacityShape, opacityShape, DEFAULT_OPACITY_SHAPE } from "./territory-view.mjs";
import { DEFAULT_BOARD_THEME, isBoardTheme, surfaceCss, boardTheme as boardLook } from "./board-theme.mjs";
import { choosePolicyMove } from "./ai-opponent.mjs";
import { AI_STRENGTHS, DEFAULT_AI_STRENGTH, normalizeStrength } from "./ai-strength.mjs";
import { policyHints } from "./ai-assist.mjs";
import { takebackCut, takeBack, requestTakeback, answerTakeback } from "./takeback.mjs";
import { createBoardRenderer } from "./board-renderer.mjs";
import { scoreBreakdown, scoreRows } from "./scoring-regions.mjs";
import { createBoardZoom } from "./board-zoom.mjs";
import {inspectProvisionalMove,makeIllegalMovePrompt,ILLEGAL_KO} from "./illegal-moves.mjs";
import { freshLocalGame } from "./mode-state.mjs";
import { GameLibrary } from "./game-library.mjs";
import { replaySteps, forkReview, exportSGF } from "./sgf.mjs";
import { shareLabels, shareFrameSize, paintShareFrame, buildGameAnimation, loadShareFonts } from "./share-image.mjs";
import { OwnershipStore } from "./ownership-store.mjs";
import { replayLine, prefetchOrder } from "./ownership-prefetch.mjs";
import { resultLabel, resultWinner } from "./result-label.mjs";
import { influence } from "./influence.mjs";
import { createHistoryPanel } from "./history-panel.mjs";
import { navigationState } from "./history-navigation.mjs";
import { makeReviewUrl, readReviewUrl, makeAiHandoff } from "./sgf-link.mjs";
import { makeRulesPrompt, makePositionPrompt } from "./beginner-prompts.mjs";
import { activeReviewSnapshot, proposeReviewStone, commitReviewStone, variationForSharing } from "./review-variation.mjs";
import { canApproveScoring, canApplyAutomatedReview, deadSignature } from "./scoring-flow.mjs";
import { TEXT } from "./texts.mjs";
const $ = id => document.getElementById(id);
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
  if (gameMode === "ai") $("aiMatchStatus").textContent = TEXT.ai.unavailable;
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
  (connected || game.moveNumber>0 || (sizeOf(game.board)===boardSize && handicapOf(game)===onlineHandicap));
// The player's own seat link moves the game to another device; it never sits in the address bar.
function ownSeatLink() {
  try{return room && inviteKey ? (p2pRole==="owner"?ownUrl:guestUrl)(location.origin,room,inviteKey) : null;}
  catch{return null;}
}
function renderInviteButton() {
  $("seatLinkBox").hidden=!ownSeatLink();
  $("copy").disabled=!!room && p2pRole!=="owner";
  $("copy").textContent=!room?TEXT.online.prepareInvite:
    issuedSide!==null && !inviteMatchesChoice()?
      TEXT.online.renewInvite:TEXT.online.copyInvite;
  keepArmedLabel($("copy"));
}
function persistOnline(){
  if(!room || !ROOM_PATTERN.test(room))return;
  if(!saveCheckpoint(roomingStorage,room,{role:p2pRole,ownerColor,session:onlineSession,
    inviteKey,guestInviteKey,issuedSide,revision:onlineRevision,game,lastPosition,seenPeerSignins}))
    storageError(Error(TEXT.online.checkpointFailed));
}
let game = newGame(), candidate = null, illegalCandidate = null, analysis = null, seq = 0, pending = null, lastPosition = null;
let illegalPromptCopied = false;
let palette = normalizePalette(localStorage.getItem("miego-palette"));
// The player's own colours and the opacity curve live in territory-view.
try{setCustomColours(JSON.parse(localStorage.getItem("miego-custom-colours")||"null"));}catch{}
setOpacityShape(localStorage.getItem("miego-opacity-shape"));
const storedBoardTheme = localStorage.getItem("miego-board");
let boardTheme = isBoardTheme(storedBoardTheme) ? storedBoardTheme : DEFAULT_BOARD_THEME;
const overlayOn = () => showsOwnership(palette);
const storedOpacity = Number(localStorage.getItem("miego-opacity"));
let opacity = Number.isFinite(storedOpacity) && storedOpacity>=0 && storedOpacity<=1 && localStorage.getItem("miego-opacity")!==null ? storedOpacity : .55;
let connected = false;
let gameMode = room ? "online" : "local";
let humanColor = BLACK, invasion = 50, reinforcement = 50;
let aiStrength = DEFAULT_AI_STRENGTH, aiHints = false, hints = null, takebackNotice = null;
let aiSideChoice = "black";
let aiHandicap = 0, localHandicap = 0, onlineHandicap = 0;
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
const historyPanel=createHistoryPanel({$,gameLibrary,storageError,onSelect:openSavedBoard,getBoardTheme:()=>boardTheme,
  getThumbnailOverlay:record=>{
    if(!overlayOn())return null;
    const ownership=ownershipStore.recall(record.id,record.snapshot.board);
    return ownership?{ownership,palette,opacity}:null;
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
  $("historySaveNotice").textContent=error?.message||TEXT.game.saveFailedShort;
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
    return;
  }
  const incoming=!!(offer && room && color!==null && offer.from!==color);
  const localPrompt=playing && !room && endExpanded && !offer;
  const waiting=!!(offer && !incoming);
  const offline=!!room && (!connected || color===null);
  $("endStatus").textContent=!playing?"":offline?TEXT.endgame.offline:
    incoming?TEXT.endgame.proposed:
    waiting?TEXT.endgame.waiting:
    localPrompt?TEXT.endgame.askLocal:
    endgameHint(game,endgameAdvisor,{
      unavailable:fallbackMode,suppressedUntil:endHintSuppressedUntil
    });
  $("endPropose").hidden=!playing||!!offer||localPrompt;
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
  if(playing && !offer && !localPrompt && takebackNotice?.number===game.moveNumber &&
     takebackNotice.hash===boardHash(game.board))
    $("endStatus").textContent=takebackNotice.text;
  // The stable left-hand status slot doubles as a rule explanation for illegal previews.
  $("endHelp").dataset.help=playing && illegalCandidate?"illegal":"endgame";
  if(playing && illegalCandidate){
    $("endStatus").textContent=illegalCandidate.reason===ILLEGAL_KO?
      TEXT.endgame.koIllegal:TEXT.endgame.suicideIllegal;
  }
}

const isAiTurn = () => !room && gameMode === "ai" && game.status === "playing" && game.next === -humanColor;
const isHumanTurn = () => room
  ? (connected && (myOnlineColor()!==null && game.next===myOnlineColor()))
  : (gameMode !== "ai" || (katagoReady && !fallbackMode && game.next === humanColor));
function stopAiTurn() {
  aiThinking = false; aiJob = null;
  analysisContext=null;deadEvaluation=null;
  pending = ++seq;
  clearTimeout(analysisTimer);
}
function rememberSettings() {
  try {
    localStorage.setItem("miego-local-settings", JSON.stringify({
      mode:gameMode,humanColor,aiSide:aiSideChoice,invasion,reinforcement,aiStrength,aiHints,aiHandicap,localHandicap,onlineHandicap,boardSize
    }));
  } catch {}
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
const personaLabel=value=>value<50?TEXT.ai.persona.low:value>50?TEXT.ai.persona.high:TEXT.ai.strengths.normal;
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
  getView:()=>({game,boardReview,candidate,illegalCandidate,lastPosition,displayedOwnership,palette,opacity,boardTheme,
    humanTurn:isHumanTurn(),hints:visibleHints()})
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
    postToWorker({id,kind:"scoring",state:game});
    show();return;
  }
  if(game.status!=="playing") {
    pending=++seq;
    endgameAdvisor.reset();endgameStage="playing";
    updateEndUi();
    return;
  }
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
  $("startAi").disabled=!katagoReady || fallbackMode;
  $("startAi").textContent=fallbackMode?TEXT.ai.startUnavailable:
    !katagoReady?TEXT.ai.startLoading:gameMode==="ai"?TEXT.ai.restart:TEXT.ai.start;
  keepArmedLabel($("startAi"));
  $("aiInvasion").disabled=false;
  $("aiReinforcement").disabled=false;
  $("turn").classList.toggle("white-to-play",game.next===WHITE);
  // Nobody is to move while scoring or after the game, so no turn stone.
  $("turn").classList.toggle("no-stone",game.status!=="playing");
  $("turn").textContent=game.status==="finished"?TEXT.scoring.finishedResign:
    game.status==="scoring"?TEXT.common.scoring:
    room?(connected?(myTurn?TEXT.game.yourTurn:TEXT.game.opponentTurn):TEXT.game.waitingOpponent):
    gameMode==="ai"?(fallbackMode?TEXT.game.aiStopped:!katagoReady?TEXT.game.aiPreparing:
      isAiTurn()?TEXT.game.aiTurn:TEXT.game.yourTurnAi):
    (game.next===BLACK?TEXT.game.turnBlack:TEXT.game.turnWhite);
  if(!room)$("netStatus").textContent=gameMode==="ai"?TEXT.common.modeAi:TEXT.common.modeLocal;
  $("netStatus").classList.toggle("online",connected);
  $("moveLabel").textContent=TEXT.game.moveLabel(game.moveNumber);
  $("hint").textContent=illegalCandidate?TEXT.game.hintIllegal:
    candidate?TEXT.game.hintCandidate:
    game.status==="scoring"?TEXT.game.hintScoring:
    gameMode==="ai" && fallbackMode?TEXT.game.hintAiStopped:
    gameMode==="ai" && !katagoReady?TEXT.game.hintAiLoading:
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
  const handicap=handicapOf(game),size=sizeOf(game.board);
  canvas.setAttribute("aria-label",TEXT.game.boardLabel(shownSize()));
  $("ruleSummary").textContent=TEXT.game.ruleSummary(size,komiOf(game),handicap);
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
  $("confirm").hidden=isScoring || isFinished;
  $("copyIllegalPrompt").hidden=isScoring || isFinished || !blocked;
  $("actionRow").classList.toggle("finished-actions",isFinished);
  $("scoreBox").querySelector("strong").textContent=isFinished?TEXT.scoring.resultTitle:TEXT.scoring.title;
  $("scoreInstruction").textContent=isFinished?
    (game.result?.endsWith("+R")?TEXT.scoring.finishedResign:TEXT.scoring.finishedScore):
    deadReview==="pending"?TEXT.scoring.reviewPending:
    deadReview==="loading"?TEXT.scoring.reviewLoading:
    deadReview==="awaiting"?TEXT.scoring.reviewAwaiting:
    deadReview==="complete"?TEXT.scoring.reviewComplete:
    deadReview==="none"?TEXT.scoring.reviewNone:
    deadReview==="modified"?TEXT.scoring.reviewModified:
    deadReview==="unavailable"?TEXT.scoring.reviewUnavailable:
    TEXT.scoring.reviewChecking;
  // The scoring controls live in the existing sticky action row.
  $("scoreStone").className="score-stone";
  $("scoreText").hidden=false;
  if(isScoring){
    renderScoreboard();
    const ready=canApproveScoring(game,deadReview,room,connected);
    $("agree").disabled=!ready;
    const agreeing=room?(myOnlineColor()===WHITE?"white":"black"):
      gameMode==="ai"?(humanColor===BLACK?"black":"white"):"black";
    $("agree").textContent=game.agreed[agreeing]?TEXT.scoring.agreedWaiting:
      ready?TEXT.scoring.agree:TEXT.scoring.waitingDead;
    if(game.agreed[agreeing])$("agree").disabled=true;
    $("resume").disabled=room&&!connected;
  }
  if(isFinished) {
    const result=game.result;
    $("scoreBox").querySelector("strong").textContent=resultLabel(result)||TEXT.scoring.ended;
    const winner=resultWinner(result);
    if(winner)$("scoreStone").classList.add(winner==="B"?"black":"white");
    if(result?.endsWith("+R")) {
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
  // without tearing down the live Go DataChannel.
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
      peerIsOwner:p2pRole==="guest"}))throw new Error(TEXT.online.peerActionRejected);
    const wasScoring=game.status==="scoring";
    if(action.type==="move"){
      if(action.number!==game.moveNumber+1) throw new Error(TEXT.game.moveMismatch);
      if(action.before!==boardHash(game.board)) throw new Error(TEXT.game.boardMismatch);
      game=play(game,action.position);
      if(action.after!==boardHash(game.board)) throw new Error(TEXT.game.verifyFailed);
      lastPosition=Number.isInteger(action.position)?action.position:null;
    } else if(action.type==="solo_scoring") {
      if(room || remote || action.number!==game.moveNumber ||
         action.before!==boardHash(game.board))
        throw new Error(TEXT.game.cannotScore);
      stopAiTurn(); // Invalidate pending AI workers on the old position.
      game=beginSoloScoring(game);
      endExpanded=false;
    } else if(action.type==="solo_score") {
      if(room || remote || !canApproveScoring(game,deadReview,room,connected))
        throw new Error(TEXT.game.cannotFinalize);
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
      deadReview=action.type==="dead_unavailable"?"unavailable":
        action.positions.length?"complete":"none";
    }
    else if(action.type==="agree") {
      // UI disables this while analysis is pending; retain an action guard.
      if(!canApproveScoring(game,deadReview,room,connected)) {
        if(!remote)throw new Error(TEXT.game.finalizeAfterReview);
        return;
      }
      game=agreeScore(game,action.color);
    }
    else if(action.type==="resume") game=resume(game);
    // "mode" (the removed per-game overlay switch) from older peers is ignored below.
    else if(action.type==="end_offer") {
      if(action.number!==game.moveNumber || action.before!==boardHash(game.board))
        throw new Error(TEXT.game.endProposalMismatch);
      game=proposeEnd(game,action.color);
      if(remote)endExpanded=false;
    } else if(action.type==="end_answer") {
      if(action.number!==game.moveNumber || action.before!==boardHash(game.board) ||
         action.proposalFrom!==game.endProposal?.from)
        throw new Error(TEXT.game.endAnswerMismatch);
      game=answerEndProposal(game,action.color,Boolean(action.accept));
      if(!action.accept)endHintSuppressedUntil=game.moveNumber+4;
      endExpanded=false;
    } else if(action.type==="takeback_request") {
      if(action.number!==game.moveNumber || action.before!==boardHash(game.board))
        throw new Error(TEXT.game.takebackRequestMismatch);
      game=requestTakeback(game,action.color);
      endExpanded=false;
    } else if(action.type==="takeback_answer") {
      if(action.number!==game.moveNumber || action.before!==boardHash(game.board) ||
         action.proposalFrom!==game.takebackRequest?.from)
        throw new Error(TEXT.game.takebackAnswerMismatch);
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
  }catch(error){showNotice(error.message); if(remote){$("netStatus").textContent=TEXT.game.syncError;p2pTransport.refresh();}}
}
function submitMove(position,fromAi=false){
  if(boardReview && !fromAi)return;
  if(!fromAi && !isHumanTurn())return;
  if(fromAi && !isAiTurn())return;
  const before=boardHash(game.board);
  let next;
  try{next=play(game,position);}catch(error){showNotice(error.message);return;}
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
      reviewFeedback(error.message);show();requestReviewOwnership();
    }
    return;
  }
  if(game.status==="scoring"){
    if(room&&!connected)return;
    // Counting stones are drawn on empty territory; only real stones can be marked dead.
    if(!game.board[position])return;
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
// Every copy of text meant for an AI chat (or a plain link) uses the async
// Clipboard API; when the browser refuses, the text is left selected instead.
const MANUAL_COPY=TEXT.common.manualCopy;
async function writeClipboard(text) {
  if(typeof navigator.clipboard?.writeText!=="function")throw Error("Clipboard API unavailable");
  await navigator.clipboard.writeText(text);
}
async function copyWithFallback(text,status,field,copied=TEXT.common.copied) {
  try{
    await writeClipboard(text);
    field.hidden=true;status.textContent=copied;
  }catch{
    field.value=text;field.hidden=false;field.focus();field.select();
    try{field.setSelectionRange(0,text.length);}catch{}
    status.textContent=MANUAL_COPY;
  }
}
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
    $("endStatus").textContent=TEXT.game.reviewUrlFailed(error.message);
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
// Irreversible actions (投了, leaving a friend's match) are confirmed in place:
// the first tap arms the button itself (danger color and a trailing ？ on its
// label), optionally explaining below it; only a second tap on it proceeds.
let armedConfirm=null;
function confirmByRetap(button,message=null,armedAria=null) {
  if(armedConfirm?.button===button){disarmConfirm();return true;}
  disarmConfirm();
  armedConfirm={button,note:null,label:button.textContent,aria:button.getAttribute("aria-label")};
  if(message){
    const note=document.createElement("p");
    note.id="armedConfirmNote";note.className="armed-note";note.setAttribute("role","status");
    note.textContent=TEXT.confirm.retap(message);
    button.setAttribute("aria-describedby",note.id);
    button.after(note);
    armedConfirm.note=note;
  }
  if(armedAria)button.setAttribute("aria-label",armedAria);
  button.classList.add("danger-armed");
  button.textContent=TEXT.confirm.armedLabel(armedConfirm.label);
  return false;
}
// Renderers rewrite these labels; keep the armed ？ on whatever they wrote.
function keepArmedLabel(button) {
  if(armedConfirm?.button!==button)return;
  armedConfirm.label=button.textContent;
  button.textContent=TEXT.confirm.armedLabel(armedConfirm.label);
}
function disarmConfirm() {
  if(!armedConfirm)return;
  armedConfirm.button.classList.remove("danger-armed");
  armedConfirm.button.removeAttribute("aria-describedby");
  armedConfirm.button.textContent=armedConfirm.label;
  if(armedConfirm.aria!==null)armedConfirm.button.setAttribute("aria-label",armedConfirm.aria);
  armedConfirm.note?.remove();
  armedConfirm=null;
}
function resetArmedButtons(){disarmConfirm();}
document.addEventListener("pointerdown",e=>{
  if(armedConfirm && !armedConfirm.button.contains(e.target))disarmConfirm();
});
// Signals computed for the abandoned line must not survive a rewind.
function afterTakeback() {
  const last=game.moves.at(-1)?.position;
  lastPosition=Number.isInteger(last)?last:null;
  candidate=null;illegalCandidate=null;hints=null;
  if(transitionFrame!==null)cancelAnimationFrame(transitionFrame);
  transitionFrame=null;analysis=null;displayedOwnership=null;
  endgameAdvisor.reset();endgameStage="playing";endExpanded=false;
  lastOfferKey=null;endHintSuppressedUntil=-1;
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
  lastOfferKey=null;endHintSuppressedUntil=-1;
  deadEvaluation=null;deadReview="idle";deadReviewTouched=false;
  game=freshLocalGame(game,localHandicap,boardSize);currentGameId=null;currentRevision=null;
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
  if(!room)apply({type:"solo_score"});
  else apply({type:"agree",color});
};
$("resume").onclick=()=>apply({type:"resume"});
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
// Choosing "表示しない" hides the overlay; the next colour map brings it back.
document.querySelectorAll('input[name="palette"]').forEach(input => {
  input.onchange = e => {
    if (!e.target.checked) return;
    const wasOn=overlayOn();
    palette=isPaletteChoice(e.target.value)?e.target.value:"mono";
    try{localStorage.setItem("miego-palette",palette);}catch{}
    fillColourInputs();updateGradient();show();
    if(wasOn!==overlayOn()){
      if(boardReview)requestReviewOwnership();else requestAnalysis();
    }
  };
});
document.querySelectorAll('input[name="boardTheme"]').forEach(input => {
  input.onchange = e => {
    if (!e.target.checked) return;
    boardTheme=isBoardTheme(e.target.value)?e.target.value:DEFAULT_BOARD_THEME;
    try{localStorage.setItem("miego-board",boardTheme);}catch{}
    updateGradient();draw();
  };
});
// The colour pickers show the chosen map; editing one turns it into "カスタム".
function fillColourInputs(){
  const shown=paletteColours(showsOwnership(palette)?palette:PALETTE_CUSTOM);
  for(const key of COLOUR_KEYS)$("colour-"+key).value=shown[key];
}
for(const key of COLOUR_KEYS)$("colour-"+key).oninput=()=>{
  const wasOn=overlayOn();
  const chosen=Object.fromEntries(COLOUR_KEYS.map(k=>[k,$("colour-"+k).value]));
  if(!setCustomColours(chosen))return;
  try{localStorage.setItem("miego-custom-colours",JSON.stringify(chosen));}catch{}
  palette=PALETTE_CUSTOM;
  try{localStorage.setItem("miego-palette",palette);}catch{}
  const radio=document.querySelector('input[name="palette"][value="custom"]');
  if(radio)radio.checked=true;
  updateGradient();show();
  if(!wasOn){if(boardReview)requestReviewOwnership();else requestAnalysis();}
};
document.querySelectorAll('input[name="opacityShape"]').forEach(input=>{
  input.onchange=e=>{
    if(!e.target.checked)return;
    try{localStorage.setItem("miego-opacity-shape",setOpacityShape(e.target.value));}catch{}
    updateGradient();draw();
  };
});
$("opacity").oninput=e=>{
  opacity=Number(e.target.value)/100;
  localStorage.setItem("miego-opacity",String(opacity));
  $("opacityValue").textContent=e.target.value+"%";
  updateGradient();draw();
};
$("resetAppearance").onclick=()=>{
  const wasOn=overlayOn();
  palette="mono";opacity=.55;boardTheme=DEFAULT_BOARD_THEME;
  localStorage.setItem("miego-palette",palette);
  localStorage.setItem("miego-opacity","0.55");
  localStorage.setItem("miego-board",boardTheme);
  const selected=document.querySelector('input[name="palette"][value="mono"]');
  if(selected)selected.checked=true;
  const selectedBoard=document.querySelector('input[name="boardTheme"][value="'+boardTheme+'"]');
  if(selectedBoard)selectedBoard.checked=true;
  $("opacity").value="55";$("opacityValue").textContent="55%";
  setOpacityShape(DEFAULT_OPACITY_SHAPE);
  try{localStorage.setItem("miego-opacity-shape",DEFAULT_OPACITY_SHAPE);}catch{}
  const shapeRadio=document.querySelector('input[name="opacityShape"][value="'+DEFAULT_OPACITY_SHAPE+'"]');
  if(shapeRadio)shapeRadio.checked=true;
  fillColourInputs();
  updateGradient();show();
  if(!wasOn){if(boardReview)requestReviewOwnership();else requestAnalysis();}
};
// The legend, the colour-map swatches and the board frame follow the chosen board.
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
    game.status==="finished" && !game.result?.endsWith("+R"));
}
// Layers for a strip of the chosen board under an optional colour layer.
function onBoardStrip(colour){
  const look=boardLook(boardTheme);
  const grid=dir=>"repeating-linear-gradient("+dir+",transparent 0 9px,"+look.line+" 9px 10.5px,transparent 10.5px 20px)";
  const fill="linear-gradient(135deg,"+(look.fill.length>1?look.fill.join(","):look.fill[0]+","+look.fill[0])+")";
  return [colour,grid("90deg"),grid("0deg"),fill].filter(Boolean).join(",");
}
function updateGradient(){
  const surface=surfaceCss(boardTheme);
  $("gradient").style.backgroundColor=surface;
  // While counting, the same legend explains the flat area colours instead.
  const counting=isCounting();
  $("gradient").style.backgroundImage=counting?countingGradient(palette,opacity,boardTheme):
    paletteGradient(palette,opacity,boardTheme);
  $("legendNeutral").hidden=!counting;
  $("ownershipLegend").classList.toggle("overlay-off",!counting && !overlayOn() ||
    game.status==="finished" && !counting);
  // Colour and strength mean nothing while the overlay is hidden.
  $("ownershipSettings").classList.toggle("is-off",!showsOwnership(palette));
  for(const input of document.querySelectorAll(".ownership-tuning input"))input.disabled=!showsOwnership(palette);
  // The V and U icons rise as high as the slider lets the colour go.
  const top=17-14*opacity;
  document.querySelector('input[name="opacityShape"][value="V"]+span path')?.setAttribute("d","M3 "+top+" 20 17 37 "+top);
  document.querySelector('input[name="opacityShape"][value="U"]+span path')?.setAttribute("d","M3 "+top+"C10 "+top+" 13 17 20 17S30 "+top+" 37 "+top);
  // The editor's ramp and the colour-map swatches lie on a strip of the
  // chosen board, grid lines and all, at the chosen strength, so every
  // colour is seen as it is on the board.
  $("rampPreview").style.backgroundColor=surface;
  $("rampPreview").style.backgroundImage=onBoardStrip(paletteGradient(showsOwnership(palette)?palette:PALETTE_CUSTOM,opacity));
  document.querySelectorAll(".swatch[data-palette]").forEach(swatch=>{
    const name=swatch.dataset.palette;
    swatch.style.backgroundColor=surface;
    swatch.style.backgroundImage=onBoardStrip(showsOwnership(name)?paletteGradient(name,opacity):null);
  });
  canvas.closest(".board-frame")?.setAttribute("data-board-theme",boardTheme);
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
  if(!config.siteKey)throw Error(TEXT.online.turnstileMissing);
  if(!window.turnstile){
    await new Promise((resolve,reject)=>{
      const script=document.createElement("script");
      script.src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.onload=resolve;script.onerror=()=>reject(Error(TEXT.online.verifyLoadFailed));
      document.head.append(script);
    });
  }
  return new Promise((resolve,reject)=>{
    $("p2pTurnstile").replaceChildren();
    window.turnstile.render($("p2pTurnstile"),{sitekey:config.siteKey,action:"miego_p2p",
      callback:resolve,"error-callback":()=>reject(Error(TEXT.online.verifyFailed)),
      "expired-callback":()=>reject(Error(TEXT.online.verifyExpired))});
  });
}
function onPeerSync(message){
  const result=reconcileGame(game,onlineRevision,message.game,message.revision,
    {localIsOwner:p2pRole==="owner",localColor:myOnlineColor()});
  if(result.kind==="conflict"||result.kind==="invalid"){
    connected=false;$("netStatus").textContent=TEXT.online.mismatch;
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
      $("netStatus").textContent=TEXT.online.roomGone;
    }else $("netStatus").textContent=error.message||TEXT.online.connectionError;
    show();
  },
  getSnapshot:()=>({game,revision:onlineRevision,lastPosition,
    scoringReview:game.status==="scoring" &&
    ["complete","none","modified","unavailable"].includes(deadReview)?deadReview:null})
});
async function joinRoom(){
  if(!ROOM_PATTERN.test(room)){$("netStatus").textContent=TEXT.online.badInvite;return;}
  const targetRoom=room;
  try{
    await p2pTransport.join({room,role:p2pRole,session:onlineSession,inviteKey});
    if(targetRoom!==room)return;
  }catch(error){if(targetRoom===room){$("netStatus").textContent=error.message;show();}}
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
  if(room&&p2pRole!=="owner")throw Error(TEXT.online.ownerOnly);
  if(room&&inviteMatchesChoice())return showInviteLink();
  if(room&&(connected||game.moveNumber>0))throw Error(TEXT.online.lockedAfterStart);
  if(room&&!confirmByRetap($("copy"),TEXT.confirm.renewInvite))return null;
  if(!room && game.moveNumber>0 &&
     !confirmByRetap($("copy"),TEXT.confirm.leaveForOnline))return null;
  const color=selectColor(choice),token=await verifyP2P();
  const created=await p2pTransport.post("/api/rooms",
    {color:color===BLACK?"black":"white",turnstileToken:token});
  if(room){
    try{await p2pTransport.post("/api/rooms/"+room+"/revoke",{role:"owner",session:onlineSession});}
    catch(error){$("inviteStatus").textContent=TEXT.online.revokeFailed;throw error;}
    leaveOnlineRoom();
  }else if(!save())return null;
  room=created.room;p2pRole="owner";seat="host";ownerColor=color;
  onlineSession=created.ownerSession;inviteKey=created.ownerKey;
  guestInviteKey=created.guestKey;issuedSide=choice;onlineRevision=0;seenPeerSignins=0;linkKey=null;
  clearBoardReview();
  gameMode="online";stopAiTurn();
  game=newGame(true,{handicap:onlineHandicap,size:boardSize});candidate=null;lastPosition=null;
  currentGameId=null;currentRevision=null;
  deadReview="idle";deadReviewTouched=false;deadEvaluation=null;
  endgameAdvisor.reset();endgameStage="playing";endExpanded=false;lastOfferKey=null;
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
    if(!url)throw Error(TEXT.online.inviteUnavailable);
    const copied=await copyInviteText(url,{clipboard:navigator.clipboard,input:$("inviteUrl"),document});
    $("inviteStatus").textContent=copied?TEXT.online.inviteCopied:TEXT.online.inviteManual;
  }catch(error){$("inviteStatus").textContent=error.message;}
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
const newGameModeKind=()=>document.querySelector('input[name="newGameMode"]:checked')?.value||"local";
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
  }catch(error){reviewFeedback(error.message);}
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
  }catch(error){reviewFeedback(error.message);}
}
function saveReviewVariation(){
  if(!boardReview?.variation)return;
  try{
    gameLibrary.save({mode:"local",snapshot:boardReview.variation.snapshot,source:"variation"});
    $("reviewNotice").textContent=TEXT.review.variationSaved;
  }catch(error){$("reviewNotice").textContent=TEXT.review.variationSaveFailed(error.message);}
}
function renderBoardReview() {
  if(!boardReview)return;
  // The live match may advance over WebRTC or AI while the chosen step stays fixed.
  if(boardReview.source==="live")boardReview.snapshot=game;
  const {step,source}=boardReview;
  const line=activeReviewSnapshot(boardReview,game),count=line.moves.length;
  const variationActive=boardReview.activeLine==="variation" && !!boardReview.variation;
  const isPreview=!!boardReview.preview;
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
  const updates=source==="live"?Math.max(0,game.moveNumber-boardReview.openedAt):0;
  $("reviewNewMoves").hidden=updates===0;
  $("reviewNewMoves").textContent=updates>0?TEXT.review.newMoves(updates):"";
  $("moveLabel").textContent=TEXT.review.moveLabel(variationActive,step,count);
  $("moveLabel").setAttribute("aria-label",TEXT.review.stop);
  $("turn").classList.toggle("white-to-play",boardReview.display.next===WHITE);
  $("turn").classList.remove("no-stone");
  $("turn").textContent=isPreview?TEXT.review.provisional:variationActive?TEXT.history.statusVariation:TEXT.review.checking;
  $("gamePanel").classList.remove("is-scoring","is-finished");
  $("netStatus").textContent=source==="archive"?TEXT.game.savedGames:source==="url"?TEXT.review.sourceUrl:
    gameMode==="ai"?TEXT.common.modeAi:room?TEXT.review.sourceOnline:TEXT.common.modeLocal;
  $("reviewResume").hidden=!canResumeSelectedReview();
  $("reviewBack").textContent=variationActive?TEXT.review.backOriginal:source==="live"?TEXT.review.backLatest:TEXT.review.backGame;
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
  if(!overlayOn()){draw();return;}
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
  }catch(error){$("reviewNotice").textContent=TEXT.history.replayFailed(error.message);}
}
function clearBoardReview() {
  if(!boardReview)return;
  const wasUrl=boardReview.source==="url";
  boardReview=null;reviewSequence++;
  if(wasUrl)clearImportedReviewUrl();
  $("moveLabel").setAttribute("aria-label",TEXT.review.play);
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
function forkBoardReview() {
  if(!boardReview)return;
  let fork;
  try{fork=forkReview(activeReviewSnapshot(boardReview,game),boardReview.step);}
  catch(error){$("reviewNotice").textContent=TEXT.review.branchFailed(error.message);return;}
  if(room && connected && !confirmByRetap($("reviewBranch"),TEXT.confirm.leaveForReview))return;
  if(!save())return;
  if(room)leaveOnlineRoom();
  stopAiTurn();gameMode="local";game=fork;
  currentGameId=null;currentRevision=null;
  const last=game.moves.at(-1)?.position;
  lastPosition=Number.isInteger(last)?last:null;
  candidate=null;analysis=null;displayedOwnership=null;
  endgameAdvisor.reset();endgameStage="playing";endExpanded=false;
  lastOfferKey=null;endHintSuppressedUntil=-1;
  deadEvaluation=null;deadReview="idle";deadReviewTouched=false;
  clearImportedReviewUrl();
  boardReview=null;reviewSequence++;
  save();show();requestAnalysis();
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
  }catch(error){$("shareNotice").textContent=TEXT.share.urlFailed(error.message);}
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
    $("historySaveNotice").textContent=TEXT.history.showFailed(error.message);
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
  }catch(error){$("shareNotice").textContent=TEXT.share.sgfFailed(error.message);}
}
function downloadBlob(blob,name){
  const url=URL.createObjectURL(blob);
  const link=document.createElement("a");
  link.href=url;link.download=name;
  document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
// Shared images end on the board exactly as drawn (board look, ownership
// colours, marks and labels come from the canvas itself), set in a card
// naming the moves, the result, where to play and where it is developed.
// Both kinds are made when the sheet opens so each choice shows its image.
const SHARE_KINDS=["still","animation"];
let shareImageKind="still",shareImageJob=0;
let shareImages={},sharePreviewUrls=[];
let frameRenderer=null,frameState=null,frameOwnership=null;
const ANIMATION_SIZE=600;
// Every frame of a shared animation carries the colours seen while playing.
function rememberOwnership(board,values){
  try{ownershipStore.remember(currentGameId,board,values);}catch(error){console.warn("Ownership not kept",error);}
}
const frameCanvas=(width,height)=>Object.assign(document.createElement("canvas"),{width,height});
function shareImageDetails(animated){
  const {snapshot,metadata,step,gameId}=sharedPosition();
  const total=snapshot.moves.filter(m=>m.position!=="resign").length;
  const result=metadata?.result || (snapshot.status==="finished" ? snapshot.result : null);
  // The legend explains colours only when the image carries them: every
  // animation frame is coloured, a still only what the board now shows.
  const coloured=overlayOn() && (animated ||
    (boardReview ? !!boardReview.ownership : game.status==="playing" && !!displayedOwnership));
  return {snapshot,step,gameId,labels:{...shareLabels({step,total,result,animated,
      komi:Number.isFinite(Number(metadata?.komi)) ? Number(metadata.komi) : komiOf(snapshot),
      handicap:handicapOf(snapshot)}),boardSize:sizeOf(snapshot.board),
    theme:boardTheme,legend:coloured ? {palette,opacity} : null}};
}
// An animation frame: the replayed position with the ownership recorded for
// it, or the replay view's quick estimate where none was recorded.
function renderFrameBoard(state,gameId){
  if(!frameRenderer){
    const board=frameCanvas(ANIMATION_SIZE,ANIMATION_SIZE);
    frameRenderer={board,...createBoardRenderer({canvas:board,getView:()=>({game:frameState,
      boardReview:{display:frameState,ownership:frameOwnership},candidate:null,illegalCandidate:null,
      lastPosition:null,displayedOwnership:null,palette,opacity,boardTheme,hints:null})})};
  }
  frameState=state;
  frameOwnership=overlayOn() ? ownershipStore.recall(gameId,state.board) ?? influence(state.board) : null;
  frameRenderer.draw();
  return frameRenderer.board;
}
async function makeShareImage(kind,job){
  await loadShareFonts();
  draw();
  const animated=kind==="animation";
  const {snapshot,step,gameId,labels}=shareImageDetails(animated);
  if(animated){
    frameRenderer=null;
    const bytes=await buildGameAnimation({snapshot,step,size:ANIMATION_SIZE,
      renderBoard:state=>renderFrameBoard(state,gameId),finalBoard:canvas,createCanvas:frameCanvas,labels,
      onProgress:(i,total)=>{
        if(job!==shareImageJob)throw Error(TEXT.share.aborted);
        shareImages.animation={progress:TEXT.share.progress(i,total)};renderShareImages();
      }});
    return new File([bytes],"miego-moves"+step+".gif",{type:"image/gif"});
  }
  const {width,height}=shareFrameSize(canvas.width);
  const target=frameCanvas(width,height);
  paintShareFrame(target,canvas,labels);
  const blob=await new Promise((resolve,reject)=>
    target.toBlob(b=>b?resolve(b):reject(Error(TEXT.share.imageFailedMake)),"image/png"));
  return new File([blob],"miego-move"+step+".png",{type:"image/png"});
}
const canShareFile=file=>{
  try{return typeof navigator.share==="function" && !!navigator.canShare?.({files:[file]});}
  catch{return false;}
};
function renderShareImages(){
  for(const kind of SHARE_KINDS){
    const entry=shareImages[kind]||{},id=kind==="still"?"Still":"Animation";
    const preview=$("share"+id+"Preview"),status=$("share"+id+"Status");
    preview.hidden=!entry.url;
    if(entry.url && preview.getAttribute("src")!==entry.url)preview.src=entry.url;
    status.hidden=!!entry.url;
    status.textContent=entry.failed?TEXT.share.failedShort:TEXT.common.creating+(entry.progress?" "+entry.progress:"");
  }
  // Saving always works; sharing appears where the device can take the file.
  const file=shareImages[shareImageKind]?.file;
  $("saveImage").disabled=$("shareImage").disabled=!file;
  $("saveImage").textContent=file ? TEXT.share.saveImage :
    shareImages[shareImageKind]?.failed ? TEXT.share.imageFailed : TEXT.share.imageCreating;
  $("shareImage").hidden=!file || !canShareFile(file);
}
function clearShareImages(){
  shareImageJob++;shareImages={};
  sharePreviewUrls.forEach(url=>URL.revokeObjectURL(url));sharePreviewUrls=[];
}
// The images are made before the tap: sharing must start straight from the
// tap, and a long game's animation takes a moment to encode.
async function prepareShareImages(){
  clearShareImages();
  const job=shareImageJob;
  renderShareImages();
  for(const kind of SHARE_KINDS){
    try{
      const file=await makeShareImage(kind,job);
      if(job!==shareImageJob)return;
      const url=URL.createObjectURL(file);sharePreviewUrls.push(url);
      shareImages[kind]={file,url};
    }catch(error){
      if(job!==shareImageJob)return;
      shareImages[kind]={failed:true};
      $("shareNotice").textContent=TEXT.share.imageError(error.message);
    }
    renderShareImages();
  }
}
function saveImage(){
  const file=shareImages[shareImageKind]?.file;
  if(!file)return;
  downloadBlob(file,file.name);
  $("shareNotice").textContent=TEXT.share.imageSaved;
}
async function shareImage(){
  const file=shareImages[shareImageKind]?.file;
  if(!file || !canShareFile(file))return;
  try{await navigator.share({files:[file]});$("shareNotice").textContent="";}
  catch(error){
    if(error?.name!=="AbortError")$("shareNotice").textContent=TEXT.share.imageShareFailed(error.message);
  }
}
function openSharePanel(){
  openPanel("share");
  $("shareNotice").textContent="";
  $("shareCopyFallback").hidden=true;
  void prepareShareImages();
}
$("moveLabel").onclick=()=>{
  if(boardReview){leaveBoardReview();return;}
  try{enterBoardReview(game,game.moves.length,"live");}
  catch(error){$("saveStatus").hidden=false;$("saveStatus").textContent=TEXT.history.replayFailed(error.message);}
};
$("reviewStepToggle").onclick=()=>{$("reviewMenu").open=true;$("reviewStepRange").focus();};
$("reviewFirst").onclick=()=>setBoardReviewStep(0);
$("reviewPrevious").onclick=()=>boardReview&&setBoardReviewStep(boardReview.step-1);
$("reviewNext").onclick=()=>boardReview&&setBoardReviewStep(boardReview.step+1);
$("reviewLast").onclick=()=>boardReview&&setBoardReviewStep(boardReview.snapshot.moves.length);
$("reviewStepRange").oninput=e=>setBoardReviewStep(Number(e.target.value));
$("reviewBack").onclick=leaveBoardReview;
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
$("reviewBranch").onclick=forkBoardReview;
$("saveImage").onclick=saveImage;
$("shareImage").onclick=()=>void shareImage();
document.querySelectorAll('input[name="shareImageKind"]').forEach(input=>{
  input.onchange=e=>{
    if(!e.target.checked)return;
    shareImageKind=e.target.value==="animation"?"animation":"still";
    renderShareImages();
  };
});
$("shareLink").onclick=()=>void copyShareUrl(false);
$("shareAiLink").onclick=()=>void copyShareUrl(true);
$("shareSgf").onclick=exportSharedSGF;
function resumeSelectedReview(){
  if(!canResumeSelectedReview())return;
  const selected=boardReview.record;
  if(room && connected &&
    !confirmByRetap($("reviewResume"),TEXT.confirm.leaveForArchive))return;
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
  lastOfferKey=null;deadReview=game.status==="scoring" &&
    (game.dead.length || game.agreed.black || game.agreed.white)?"modified":"idle";
  deadEvaluation=null;deadReviewTouched=deadReview==="modified";
  analysis=null;displayedOwnership=null;
  try{gameLibrary.setActive(gameMode,currentGameId);}
  catch(error){storageError(error);return;}
  clearBoardReview();rememberSettings();
  closePanels();show();requestAnalysis();
}
$("reviewResume").onclick=resumeSelectedReview;
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
  clearShareImages();
  $("modePanel").hidden=true;
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
// The full help sheet opens from the header and stacks above any open sheet.
let helpOwnsBackdrop=false;
function openHelp() {
  closeHelpPopover(false);
  helpOwnsBackdrop=$("settingsBackdrop").hidden;
  if(helpOwnsBackdrop){setBackgroundInert(true);$("settingsBackdrop").hidden=false;}
  $("helpPanel").hidden=false;
  $("helpToggle").setAttribute("aria-expanded","true");
  for(const item of $("helpPanel").querySelectorAll("details"))item.open=false;
  $("beginnerPromptStatus").textContent="";$("beginnerPromptFallback").hidden=true;
  $("helpPanel").scrollTop=0;
  $("closeHelp").focus();
}
function closeHelp() {
  $("helpPanel").hidden=true;
  $("helpToggle").setAttribute("aria-expanded","false");
  if(helpOwnsBackdrop)closePanels();
  else $("helpToggle").focus();
}
// A local ? shows only its own topic, beside the button. The text is copied
// from the help sheet so each explanation is written once.
let helpPopoverOpener=null;
function openHelpPopover(topic,opener) {
  const source=$("help-"+topic);
  if(!source)return;
  const pop=$("helpPopover"),body=$("helpPopoverBody");
  $("helpPopoverTitle").textContent=source.querySelector("summary").textContent;
  body.replaceChildren(...[...source.children].filter(node=>node.tagName!=="SUMMARY").map(node=>{
    const copy=node.cloneNode(true);
    for(const el of [copy,...copy.querySelectorAll("[id]")])el.removeAttribute("id");
    return copy;
  }));
  helpPopoverOpener=opener;
  pop.hidden=false;
  const margin=12,gap=8,r=opener.getBoundingClientRect();
  const width=pop.offsetWidth,height=pop.offsetHeight;
  const below=r.bottom+gap,above=r.top-gap-height;
  pop.style.top=(below+height<=innerHeight-margin||above<margin?
    Math.max(margin,Math.min(below,innerHeight-margin-height)):above)+"px";
  pop.style.left=Math.max(margin,Math.min(r.left+r.width/2-width/2,innerWidth-margin-width))+"px";
  $("closeHelpPopover").focus();
}
function closeHelpPopover(restoreFocus=true) {
  if($("helpPopover").hidden)return;
  $("helpPopover").hidden=true;
  if(restoreFocus)helpPopoverOpener?.focus();
  helpPopoverOpener=null;
}
// Beginner questions describe the live game, never the board being replayed.
async function copyBeginnerPrompt(make) {
  const status=$("beginnerPromptStatus"),area=$("beginnerPromptFallback");
  let link=null,question;
  try{link=makeReviewUrl(location.origin,{snapshot:game},game.moves.length);}catch{}
  try{question=make(game,link);}
  catch(error){status.textContent=TEXT.prompts.failed(error.message);return;}
  await copyWithFallback(question,status,area,TEXT.prompts.copiedForAi);
}
$("copyRulesPrompt").onclick=()=>void copyBeginnerPrompt(makeRulesPrompt);
$("copyPositionPrompt").onclick=()=>void copyBeginnerPrompt(makePositionPrompt);
$("helpToggle").onclick=()=>$("helpPanel").hidden?openHelp():closeHelp();
$("closeHelp").onclick=closeHelp;
$("closeHelpPopover").onclick=()=>closeHelpPopover();
// Every local ? names its topic in data-help, so one listener serves them all.
document.addEventListener("click",e=>{
  const button=e.target.closest?.("[data-help]");
  if(!button)return;
  if(helpPopoverOpener===button)closeHelpPopover();
  else openHelpPopover(button.dataset.help,button);
});
// A tap anywhere else, or a layout change, dismisses the popover.
document.addEventListener("pointerdown",e=>{
  if(!e.target.closest?.("#helpPopover,[data-help]"))closeHelpPopover(false);
});
addEventListener("resize",()=>closeHelpPopover(false));
$("settingsBackdrop").onclick=()=>$("helpPanel").hidden?closePanels():closeHelp();
document.addEventListener("keydown",e=>{
  if(e.key!=="Escape")return;
  if(!$("helpPopover").hidden){closeHelpPopover();return;}
  if($("settingsBackdrop").hidden)return;
  if(!$("helpPanel").hidden)closeHelp();else closePanels();
});
$("newGameButton").onclick=()=>openPanel(room?"online":gameMode);
$("startAi").onclick=()=>{
  if(!katagoReady || fallbackMode){
    $("aiMatchStatus").textContent=TEXT.ai.cannotStart;
    return;
  }
  if(room && connected &&
     !confirmByRetap($("startAi"),TEXT.confirm.leaveForAi))return;
  if(!save())return;
  if(room)leaveOnlineRoom();
  clearBoardReview();
  stopAiTurn();
  gameMode="ai";
  // Handicap stones always belong to the human, who therefore plays Black.
  // Otherwise: the same choices and the same random draw as a friend invitation.
  try{humanColor=aiHandicap?BLACK:selectColor(aiSideChoice);}
  catch(error){$("aiMatchStatus").textContent=error.message;return;}
  aiStrength=strengthAt($("aiStrength").value);
  hints=null;takebackNotice=null;
  game=newGame(true,{handicap:aiHandicap,size:boardSize});currentGameId=null;currentRevision=null;lastPosition=null;candidate=null;
  endgameAdvisor.reset();endgameStage="playing";endExpanded=false;lastOfferKey=null;
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
  // One set of handicap buttons shows the stored choice of the selected mode.
  const kind=newGameModeKind(),ai=kind==="ai";
  const shown=ai?aiHandicap:kind==="online"?onlineHandicap:localHandicap;
  for(const option of $("handicap").options)option.disabled=Number(option.value)>maxHandicap(boardSize);
  $("handicap").value=String(shown);
  // The note only appears when stones are placed, so an even game shows no extra text.
  $("handicapNote").hidden=!shown;
  $("handicapNote").textContent=(ai?TEXT.handicap.noteAi:
    kind==="online"?TEXT.handicap.noteOnline:TEXT.handicap.noteLocal)+
    TEXT.handicap.noteRule+(boardSize===9?TEXT.handicap.note9:"");
  // With handicap the human is Black; the saved side preference returns afterwards.
  for(const input of document.querySelectorAll('input[name="aiSide"]'))
    input.disabled=!!aiHandicap && input.value!=="black";
  if(aiHandicap){
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
    aiHandicap=toHandicap(settings.aiHandicap);localHandicap=toHandicap(settings.localHandicap);
    onlineHandicap=toHandicap(settings.onlineHandicap);
    boardSize=toBoardSize(settings.boardSize);
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
const selectedPalette=document.querySelector('input[name="palette"][value="'+palette+'"]');
if(selectedPalette)selectedPalette.checked=true;
const selectedBoardTheme=document.querySelector('input[name="boardTheme"][value="'+boardTheme+'"]');
if(selectedBoardTheme)selectedBoardTheme.checked=true;
{const shapeRadio=document.querySelector('input[name="opacityShape"][value="'+opacityShape()+'"]');
if(shapeRadio)shapeRadio.checked=true;}
fillColourInputs();
$("opacity").value=String(Math.round(opacity*100));
$("opacityValue").textContent=Math.round(opacity*100)+"%";
updateGradient();
if(!room && currentGameId===null)save();
if(!room && params.has("sgf")){
  try{
    const imported=readReviewUrl(location.href);
    if(imported.kind==="review")
      enterBoardReview(imported.snapshot,imported.step,"url",imported.metadata);
  }catch(error){
    $("saveStatus").hidden=false;
    $("saveStatus").textContent=TEXT.history.sharedLoadFailed(error.message);
  }
}
compactOwnership();
show();requestAnalysis();
