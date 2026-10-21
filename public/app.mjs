import {
  agreeDead,
  agreeScore,
  answerEndProposal,
  areaScore,
  backToDead,
  beginSoloScoring,
  BLACK,
  boardHash,
  colorOf,
  confirmDeadSolo,
  fillStones,
  finalizeSoloScore,
  HANDICAP_KOMI,
  handicapOf,
  hasGomokuForbidden,
  initialGame,
  isFree,
  isGomoku,
  isJapanese,
  komiOf,
  loseOnTime,
  maxHandicap,
  newGame,
  play,
  playFreeStone,
  proposeEnd,
  resume,
  RULES_KOMI,
  rulesOf,
  scoringStepOf,
  setDeadCandidates,
  sideKey,
  sizeOf,
  toggleDead,
  WHITE,
  withPlayoutFill,
} from "./core.mjs";
import { replayPlayout } from "./settle-playout.mjs";
import { createSettleControl } from "./settle-control.mjs";
import { EndgameAdvisor } from "./endgame.mjs";
import { endgameBarView } from "./endgame-bar.mjs";
import {
  BYOYOMI_CHOICES,
  clockOf,
  clockSeconds,
  clockText,
  createGameClock,
  MAIN_TIME_CHOICES,
  readClock,
  spendTime,
} from "./game-clock.mjs";
import {
  copyInviteText,
  inviteButtonView,
  seatLink,
} from "./invite.mjs";
import {
  colorLabel,
  guestUrl,
  isPeerAction,
  newPeerSignins,
  playerColor,
  readCheckpoint,
  reconcileGame,
  requestRematch,
  ROOM_PATTERN,
  roundOf,
  roomUrl,
  saveCheckpoint,
  selectColor,
  storageKey,
} from "./p2p-session.mjs";
import { createP2PTransport } from "./p2p-transport.mjs";
import { verifyP2P } from "./p2p-verify.mjs";
import { interpolateOwnership, prisonerOutline } from "./territory-view.mjs";
import { createAppearanceSettings } from "./appearance-settings.mjs";
import {
  CALM_VOICES,
  countdownSound,
  createSoundEffects,
  DOPA_VOICES,
  moveSound,
  proposalArrived,
} from "./sound.mjs";
import {
  createDopaMode,
  dopaEvent,
  goodMove,
} from "./dopa-mode.mjs";
import { choosePolicyMove, createResignWatch } from "./ai-opponent.mjs";
import { gomokuMove } from "./gomoku.mjs";
import { cleanName, createPlayerName } from "./player-name.mjs";
import { playerSides, recordNames } from "./player-row.mjs";
import { DEFAULT_AI_STRENGTH } from "./ai-strength.mjs";
import {
  CUSTOM_CHARACTER,
  DEFAULT_AI_CHARACTER,
  characterLabel,
  comSummary,
  pickCharacter,
  readCom,
  setComValue,
} from "./ai-characters.mjs";
import { createStrongWorkers } from "./strong-worker.mjs";
import {
  answerTakeback,
  requestTakeback,
  takeBack,
  takebackCut,
} from "./takeback.mjs";
import { createBoardRenderer } from "./board-renderer.mjs";
import { scoreBreakdown, scoreRows } from "./scoring-regions.mjs";
import { createBoardZoom } from "./board-zoom.mjs";
import {inspectProvisionalMove,makeIllegalMovePrompt} from "./illegal-moves.mjs";
import { freshLocalGame } from "./mode-state.mjs";
import {
  capHandicaps,
  readSettings,
  toBoardSize,
  toHandicap,
  toRules,
  toSeconds,
  writeSettings,
} from "./next-game-settings.mjs";
import { cleanWatchAi, GameLibrary } from "./game-library.mjs";
import { replaySteps, forkReview, exportSGF } from "./sgf.mjs";
import { createShareImages, downloadBlob } from "./share-images.mjs";
import { OwnershipStore } from "./ownership-store.mjs";
import { replayLine } from "./ownership-prefetch.mjs";
import { createReviewPrefetch, createScoreGraph } from "./review-estimates.mjs";
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
import {
  canApplyAutomatedReview,
  canApproveScoring,
  deadSignature,
  REVIEW_DONE,
} from "./scoring-flow.mjs";
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
  endgameAdvisor.reset();resignWatch.reset();
  katagoReady = false;
  aiThinking = false;
  aiJob = null;
  console.warn("KataGo unavailable; switching to transparent approximation:", reason);
  worker.terminate();
  worker = new Worker("/analysis-worker.mjs", { type: "module" });
  workerWaiting = null; reviewPrefetch.stop();
  worker.onmessage = onWorkerMessage;
  worker.onerror = e => { $("analysisStatus").textContent = TEXT.analysis.unavailable; console.error(e); };
  // The turn row has room for the first words only; the notice gives the whole sentence.
  if (gameMode === "ai" && !isGomoku(game)) {
    $("aiMatchStatus").textContent = TEXT.ai.unavailable;
    showNotice(TEXT.ai.unavailable);
  }
  show();
  requestAnalysis();
}
worker.onerror = e => switchToFallback(e.message || "worker startup error");
// The worker answers only its newest request, so one waiting id tells whether it is busy.
let workerWaiting = null;
// Background estimates of a replayed line (see planPrefetch).
const reviewPrefetch = createReviewPrefetch({
  post:message=>postToWorker(message),
  nextId:()=>++seq,
  canAsk:()=>workerWaiting===null && !aiThinking && katagoReady && !fallbackMode &&
    (overlayOn() || scoreGraph.shown()),
  recall:(gameId,board)=>ownershipStore.recall(gameId,board),
  owner:()=>reviewOwner(),
  onKept:(owner,board,values)=>{keepReviewOwnership(owner,board,values);scoreGraph.render();},
});
function postToWorker(message) {
  reviewPrefetch.giveWay();
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
// The friend's 表示名, as their device last sent it; "" until it does.
let peerName="";
// The room whose friend this page has already rung in.
let peerMetRoom=null;
let p2pTransport;
const myOnlineColor=()=>ownerColor===null?null:playerColor(p2pRole,ownerColor);
const currentSideSelection=()=>document.querySelector('input[name="onlineSide"]:checked')?.value||"random";
// Before play starts, a changed side, board size or handicap calls for a new invitation.
const inviteMatchesChoice=()=>issuedSide===currentSideSelection() &&
  (connected || game.moveNumber>0 || (sizeOf(game.board)===boardSize && handicapOf(game)===onlineHandicap &&
    rulesOf(game)===gameRules && hasGomokuForbidden(game)===(gameRules==="gomoku" && gomokuForbiddenChoice)));
// The player's own seat link moves the game to another device; it never sits in the address bar.
const ownSeatLink=()=>seatLink({origin:location.origin,room,role:p2pRole,inviteKey});
function renderInviteButton() {
  $("seatLinkBox").hidden=!ownSeatLink();
  const view=inviteButtonView({room,role:p2pRole,guestInviteKey,connected,moveNumber:game.moveNumber,issuedSide,
    matches:inviteMatchesChoice()});
  $("copy").disabled=view.copyDisabled;
  for(const input of document.querySelectorAll('input[name="onlineSide"]')) {
    input.disabled=view.sideLocked;
    if(view.sideLocked && issuedSide!==null)input.checked=input.value===issuedSide;
  }
  $("copy").textContent=view.label;
  keepArmedLabel($("copy"));
}
function persistOnline(){
  if(!room || !ROOM_PATTERN.test(room))return;
  if(!saveCheckpoint(roomingStorage,room,{role:p2pRole,ownerColor,session:onlineSession,
    inviteKey,guestInviteKey,issuedSide,revision:onlineRevision,game,lastPosition,seenPeerSignins}))
    storageError(new UserError(TEXT.online.checkpointFailed));
}
let game = newGame(), candidate = null, illegalCandidate = null, seq = 0, pending = null, lastPosition = null;
let illegalPromptCopied = false;
/** Drops the provisional stone, legal or forbidden, and the forbidden-move prompt. */
function clearProvisional() {
  candidate=null;illegalCandidate=null;illegalPromptCopied=false;
  $("illegalPromptFallbackPanel").hidden=true;
}
// "石を隠す" is fixed for a whole game: the 新規対戦 choice applies to the
// next game, which carries it (so a friend's game shows it to both players).
// A replayed board follows its game; a shared SGF shows its stones.
let hideStonesChoice = false;
// The colour a tap places on a free board (自由に置く), remembered for this player.
let freeColor = BLACK;
// 五目並べ's 禁じ手 (renju's forbidden moves for Black), for the next game.
let gomokuForbiddenChoice = false;
// The next game's 持ち時間 and 秒読み in seconds (0: none); both 0 plays without a clock.
let mainTimeChoice = 0, byoyomiChoice = 0;
const hidingStones = () => (boardReview ? boardReview.snapshot : game)?.hideStones===true;
const appearance = createAppearanceSettings({$,canvas,getGame:()=>game,hidingStones,isCounting,show,draw,
  onOverlayOn:()=>boardReview?requestReviewOwnership():requestAnalysis()});
const {shownPalette,overlayOn,updateGradient}=appearance;
// 表示名: the player's own name in the turn row, in a friend's game and in saved games.
const playerName = createPlayerName({$,onChange:()=>{
  show();
  if(room && connected)p2pTransport.sendSync();
}});
// 効果音: off until the 設定 sheet turns them on. ドパガキモード swaps in louder voices.
const sound = createSoundEffects({$,voices:()=>dopa.level()==="off"?CALM_VOICES:DOPA_VOICES});
const dopa = createDopaMode({$,stage:$("dopaStage"),frame:$("boardFrame"),graph:$("reviewGraph"),
  score:()=>$("scoreBox").querySelector("strong")});
// Whom ドパガキモード cheers for a win: the player's own colour, or either side
// when watching the COMs or sharing one board.
// The policy KataGo gave the position on the board, kept for judging the move played from it.
let positionPolicy=null;
const dopaViewer = () => isWatching() || (gameMode!=="ai" && !room) ? null : room ? myOnlineColor() : humanColor;
let connected = false;
// The friend game dropped and the transport is getting it back by itself.
let reconnecting = false;
// A first visit starts against the COM; later visits restore the saved mode.
let gameMode = room ? "online" : "ai";
let humanColor = BLACK;
// The COM opponent: a character, or カスタム with its own strength and style.
let aiCom = readCom({character:DEFAULT_AI_CHARACTER});
let takebackNotice = null;
// What a friend's answer did to an end offer, shown once in the bar like takebackNotice.
let endNotice = null;
// 打ち続ける over the COM's pass: the position where the player said so.
let keptPlayingAt = null;
const keptPlaying = () => keptPlayingAt?.number===game.moveNumber && keptPlayingAt.hash===boardHash(game.board);
let aiSideChoice = "black";
// Set while 「ここから打つ」 shows the 新規対戦 sheet: the replayed line and its step.
let continueFrom = null;
// COM同士 (the 観戦 mode): the AI plays both colours with a pause between
// moves, so each one can be followed; the player can pause and resume it.
let watching = false, watchPaused = false, watchTimer = null, lastWatchMoveAt = 0;
// The 新規対戦 sheet's 観戦 choice, kept apart from the colour 対COM plays.
let watchChoice = false;
// Each colour's COM when two COMs play.
const newCom = (com={character:DEFAULT_AI_CHARACTER}) => readCom(com,DEFAULT_AI_STRENGTH);
// A saved game's COM. Games saved before characters kept strength, 侵入度 and
// 補強度 on their own, and games from before strength levels played at full strength.
const recordCom = record => readCom(record.aiCom ?? {strength:record.aiStrength,
  invasion:record.invasion,reinforcement:record.reinforcement},"strong");
let watchAi = {black:newCom(), white:newCom()};
// The pause between watched moves, chosen under 観戦's 速さ tab; a running game follows it.
const WATCH_STEP_MS = {fast:250, normal:1100, slow:2200};
const toWatchSpeed = value => Object.hasOwn(WATCH_STEP_MS,value) ? value : "normal";
let watchSpeed = "normal";
const watchStep = () => WATCH_STEP_MS[watchSpeed];
// 介入する steps in: the COMs wait while the viewer places a provisional stone
// for the side to move. ここに打つ takes that colour over; × goes back to
// watching after a slightly longer pause, which the turn line announces.
let intervening = false;
const WATCH_RESUME_MS = 1800;
// True during that pause, so the turn line says watching is about to resume.
let watchReturning = false;
/** Starts or stops 観戦 at the beginning of a game, unpaused and with no 介入. */
function setWatching(on) {
  watching=on;watchPaused=false;intervening=false;watchReturning=false;
}
let aiHandicap = 0, localHandicap = 0, onlineHandicap = 0;
// The ruleset for the next new game, shared by every mode like the board size.
let gameRules = "chinese";
// The board size for the next new game in any mode; a running game keeps its own.
let boardSize = 9;
const shownSize = () => sizeOf((boardReview?.display||game).board);
let katagoReady = false, aiThinking = false, aiJob = null;
const endgameAdvisor = new EndgameAdvisor();
// A COM set to 投了 resigns once its game has looked lost for a few turns.
const resignWatch = createResignWatch();
let endExpanded = false, analysisContext = null;
let deadEvaluation=null, deadReview="idle", deadReviewTouched=false;
// 決着手順: KataGo's playout of the scoring position, and the one kept for 再生.
const settleControl = createSettleControl({
  getGame:()=>game,
  isReviewing:()=>!!boardReview,
  post:postToWorker,
  show,
  draw,
  jobCurrent:id=>deadEvaluation?.id===id && scoringJobCurrent(deadEvaluation),
  knownOwnership:board=>ownershipStore.recall(currentGameId,board),
  onUnavailable() {
    deadEvaluation=null;reviewUnavailable();
  },
  onSettled(run) {
    const job=deadEvaluation;
    deadEvaluation=null;
    if(!scoringJobCurrent(job)){show();return;}
    apply(scoringReviewAction("dead_auto",{positions:run.dead,playout:run.positions}));
    // Stones tapped during the playout are corrections to its result, applied on top of it.
    for(const position of run.taps||[])
      apply({type:"dead",position,selected:!game.dead.includes(position)});
  },
});
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
  showNotice(TEXT.game.saveFailed);
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
  const view=endgameBarView({game,color:myColorForEnd(),room:!!room,connected,gameMode,watching:isWatching(),
    endExpanded,aiPassAsks:aiPassAsks(),katagoReady,fallbackMode,advisor:endgameAdvisor,aiThinking,
    notices:[takebackNotice,endNotice],keptPlaying:keptPlaying(),illegalCandidate});
  for(const [id,text] of Object.entries(view.text))$(id).textContent=text;
  for(const [id,hidden] of Object.entries(view.hidden))$(id).hidden=hidden;
  for(const [id,disabled] of Object.entries(view.disabled))$(id).disabled=disabled;
  for(const [id,classes] of Object.entries(view.classes))
    for(const [name,on] of Object.entries(classes))$(id).classList.toggle(name,on);
  if(view.help)$("endHelp").dataset.help=view.help;
}

/** A friend has agreed to the count (or the dead stones) and this player has not yet. */
function peerAgreed() {
  if(!room || game.status!=="scoring" || myOnlineColor()===null)return false;
  const [mine,theirs]=myOnlineColor()===WHITE?["white","black"]:["black","white"];
  return game.agreed[theirs] && !game.agreed[mine];
}
/** After one pass: who passed, and whether this player's pass would start scoring. */
/** Against a COM, its pass is its way of suggesting the end: the player is asked
 * 採点を始めますか？ at once, and 採点へ進む is the player's own pass. */
const aiPassAsks = () => !room && gameMode === "ai" && !watching && game.status === "playing" &&
  !game.endProposal && game.passes === 1 && game.moves.at(-1)?.position === null &&
  game.moves.at(-1).color === -humanColor;
const isAiTurn = () => !room && gameMode === "ai" && game.status === "playing" &&
  (watching ? !intervening : game.next === -humanColor);
const isHumanTurn = () => room
  ? (connected && (myOnlineColor()!==null && (isFree(game) || game.next===myOnlineColor())))
  // The player moves while KataGo is still loading, and the AI answers once it is ready.
  : (gameMode !== "ai" || ((isGomoku(game) || !fallbackMode) &&
    (watching ? intervening : game.next === humanColor)));
const isWatching = () => !room && gameMode === "ai" && watching;
// The COM whose turn it is: in COM同士 each side has its own settings.
const comToMove = () => watching ? watchAi[sideKey(game.next)] : aiCom;
const gameUsesStrongest = () => !room && gameMode==="ai" && game.status==="playing" && !isGomoku(game) &&
  (watching ? watchAi.black.strength==="strongest" || watchAi.white.strength==="strongest" : aiCom.strength==="strongest");
const strongWorkers = createStrongWorkers({
  boardSize:()=>sizeOf(game.board),
  onProgress(progress) {
    if(isAiTurn() && !aiThinking && comToMove().strength==="strongest"){
      $("aiMatchStatus").textContent=TEXT.ai.strongestLoading(progress);
      show();
    }
  },
  onReady() {
    if(isAiTurn())requestAnalysis();
  },
  onFailed() {
    if(aiJob?.strong){aiThinking=false;aiJob=null;}
    // The player row still reads 最強, so the notice says it plays with the small network.
    if(gameMode==="ai"){$("aiMatchStatus").textContent=TEXT.ai.strongestFailed;showNotice(TEXT.ai.strongestFailed);}
    if(isAiTurn())requestAnalysis();
  },
  onReading(result) {
    if(aiJob?.id!==result.id)return;
    aiJob.read={depth:result.depth,done:result.done,total:result.total,
      remainingMs:Math.max(0,result.total-result.done)*(Number(result.evalMs)||0)};
    $("aiMatchStatus").textContent=TEXT.ai.strongestReading;
    show();
  },
  onMove:result=>finishAiMove(result),
});
/** While 最強 is to move: what it is doing, with how far along it is, in full
 * and short enough for its side of the turn row; null for any other move. */
function strongWait() {
  if(!isAiTurn() || isGomoku(game) || comToMove().strength!=="strongest")return null;
  const net=strongWorkers.current();
  if(net.state==="loading")return net.progress<100?
    {text:TEXT.game.thinkDownloading(net.progress),short:TEXT.game.sideDownloading(net.progress)}:
    {text:TEXT.game.thinkPreparing,short:TEXT.game.sidePreparing};
  if(net.state!=="ready")return null;
  const read=aiJob?.strong && aiJob.read;
  // The time left needs one timed evaluation of this read first.
  if(read?.total>0){
    const percent=Math.floor(100*read.done/read.total);
    return {text:TEXT.game.thinkReading(read.depth,percent,read.done>0 && Math.max(1,Math.round(read.remainingMs/1000))),
      short:TEXT.game.sideReading(percent)};
  }
  return {text:TEXT.game.thinkMove,short:TEXT.game.comThinking};
}
function stopAiTurn() {
  aiThinking = false; aiJob = null;
  analysisContext=null;deadEvaluation=null;
  pending = ++seq;
  clearTimeout(analysisTimer);
  clearTimeout(watchTimer);watchTimer=null;
}
/** COM同士 asks for the next move only once the pause after the last one is
 * over, and not at all while paused; meanwhile the board shows its estimate. */
function watchDue() {
  clearTimeout(watchTimer);watchTimer=null;
  if(!watching)return true;
  if(watchPaused){$("aiMatchStatus").textContent=TEXT.ai.watchPaused;return false;}
  const wait=lastWatchMoveAt+watchStep()-performance.now();
  if(wait<=0){watchReturning=false;return true;}
  watchTimer=setTimeout(()=>{watchTimer=null;requestAnalysis();},wait);
  return false;
}
// A watched game never waits on a move nobody is computing: when neither a
// move nor the pause before one is pending, the next move is asked for, and a
// move the small network has left unanswered for long is asked for again.
const WATCH_STALL_MS = 20000;
setInterval(()=>{
  if(!isWatching() || !isAiTurn() || watchPaused || endExpanded || boardReview || fallbackMode || document.hidden)return;
  if(comToMove().strength==="strongest" && strongWorkers.current().state!=="ready")return;
  if(aiThinking){
    if(!aiJob || aiJob.strong || performance.now()-aiJob.at<WATCH_STALL_MS)return;
    stopAiTurn();
  } else if(watchTimer || !katagoReady && !isGomoku(game))return;
  requestAnalysis();
},3000);
// One remembered choice per line, in alphabetical order, so that two
// branches adding different choices touch different lines.
function rememberSettings() {
  writeSettings(localStorage, {
    aiHandicap,
    aiCom,
    aiSide:aiSideChoice,
    boardSize,
    byoyomi:byoyomiChoice,
    freeColor:sideKey(freeColor),
    gameRules,
    gomokuForbidden:gomokuForbiddenChoice,
    hideStones:hideStonesChoice,
    humanColor,
    localHandicap,
    mainTime:mainTimeChoice,
    mode:gameMode,
    onlineHandicap,
    watch:watchChoice,
    watchAi,
    watchSpeed,
  });
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
    timeControl:{main:mainTimeChoice,byoyomi:byoyomiChoice},
  };
}
// The sheet's choices set the COM opponent. In 観戦, the COMのキャラ tab holds a
// card for each colour's COM in place of the character list.
// The sheet's 観戦 choice follows a watched game, so the choices always set
// what the next game, and a running one, use.
const editsWatchAi = () => watchChoice;
const COM_SLOTS = {Black:"black", White:"white"};
// Each value a カスタム COM sets, by the name suffix of its choices.
const COM_FIELDS = {
  Height:"height",
  Resign:"resign",
  Stance:"stance",
  Strength:"strength",
  Tenuki:"tenuki",
};
function checkComChoices(prefix, com) {
  for(const [field,key] of Object.entries(COM_FIELDS)){
    const input=document.querySelector('input[name="'+prefix+field+'"][value="'+com[key]+'"]');
    if(input)input.checked=true;
  }
}
function syncComCards() {
  for(const [slot,side] of Object.entries(COM_SLOTS)){
    $("com"+slot+"Character").value=watchAi[side].character;
    $("com"+slot+"Custom").hidden=watchAi[side].character!==CUSTOM_CHARACTER;
    checkComChoices("com"+slot,watchAi[side]);
  }
}
// 観戦's COMのキャラ tab holds a card per COM in place of the character list.
function syncWatchSliderRows() {
  const two=editsWatchAi();
  $("watchAiOptions").hidden=!two;
  $("aiStrengthRow").hidden=two;
  // カスタム's own rows show only for the one COM it sets.
  $("aiCustom").hidden=two || aiCom.character!==CUSTOM_CHARACTER;
}
function readWatchAi(value, fallback) {
  const clean=cleanWatchAi(value);
  if(!clean)return {black:{...fallback},white:{...fallback}};
  return {black:newCom(clean.black),white:newCom(clean.white)};
}
function updatePersonaUi() {
  checkComChoices("ai",aiCom);
  syncComCards();syncWatchSliderRows();
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
    burst:dopa.level(),
    candidate,
    displayedOwnership,
    game:shownGame(),
    hideStones:hidingStones(),
    humanTurn:isHumanTurn(),
    illegalCandidate,
    keptPlayout:keptPlayout(),
    lastPosition,
    opacity:appearance.opacity(),
    palette:shownPalette(),
    sampleStones:appearance.editingBoard(),
  })
});
function draw(){boardRenderer.draw();boardZoom.paintBleed();}
/** While KataGo settles the dead stones, the board counts with the ones an estimate already gives. */
function shownGame() {
  const playout=settleControl.view();
  return playout && !game.dead.length ? {...game,dead:playout.dead} : game;
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
  // The 最強 network downloads while the player thinks about the first move.
  if(gameUsesStrongest())strongWorkers.start();
  if(game.status==="scoring") {
    pending=++seq;
    analysisContext=null;
    endgameAdvisor.reset();resignWatch.reset();
    if(game.agreed.black || game.agreed.white) {
      deadReviewTouched=true;deadReview="modified";show();return;
    }
    if(deadReviewTouched || REVIEW_DONE.has(deadReview)) {
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
    settleControl.start(id);
    show();return;
  }
  if(game.status!=="playing") {
    pending=++seq;
    endgameAdvisor.reset();resignWatch.reset();
    updateEndUi();
    return;
  }
  if(isGomoku(game)){requestGomokuTurn();return;}
  if (isAiTurn()) {
    // A visible human confirmation must not initiate a new AI turn.
    if(endExpanded)return;
    if (aiThinking) return;
    if (fallbackMode) {
      displayedOwnership = null;
      $("analysisStatus").textContent = TEXT.analysis.stoppedAi;
      $("aiMatchStatus").textContent = TEXT.ai.unavailableContinue;
      show();return;
    }
    const net = strongWorkers.current(), strong = comToMove().strength==="strongest" && net.state!=="failed";
    if (strong && net.state!=="ready") {
      strongWorkers.start(net);
      $("aiMatchStatus").textContent = TEXT.ai.strongestLoading(net.progress);
      requestOwnership(); show(); return;
    }
    if (!strong && !katagoReady) {
      $("analysisStatus").textContent = TEXT.analysis.starting;
      $("aiMatchStatus").textContent = TEXT.ai.waitingLoad;
      show();return;
    }
    if (!watchDue()) { requestOwnership(); show(); return; }
    const id = ++seq;
    pending=id;
    aiThinking=true;
    aiJob={id,number:game.moveNumber,hash:boardHash(game.board),strong,at:performance.now()};
    $("analysisStatus").textContent = TEXT.analysis.thinking;
    $("aiMatchStatus").textContent = TEXT.ai.thinking;
    if(strong)strongWorkers.requestMove(net,id,game);
    else postToWorker({id,kind:"move",state:game});
    show();return;
  }
  requestOwnership();
}
/** The ownership estimate of the shown position, which also feeds the endgame advice. */
function requestOwnership() {
  pending=++seq;
  if(!overlayOn()) {
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
// The COM answers no sooner than this after a person's move, so the stone
// (and its sound) lands as a reply rather than on top of the person's own.
const AI_REPLY_MS=800;
let personMovedAt=0;
function requestGomokuTurn() {
  pending=++seq;
  displayedOwnership=null;
  if(!isAiTurn() || endExpanded || aiThinking){draw();return;}
  if(!watchDue()){show();return;}
  const id=pending;
  aiThinking=true;
  aiJob={id,number:game.moveNumber,hash:boardHash(game.board),at:performance.now()};
  $("aiMatchStatus").textContent=TEXT.ai.playingGomoku;
  show();
  const job=aiJob;
  setTimeout(()=>{
    if(aiJob!==job)return;
    aiThinking=false;aiJob=null;
    if(!isAiTurn() || game.moveNumber!==job.number || boardHash(game.board)!==job.hash){show();return;}
    lastWatchMoveAt=performance.now();
    submitMove(gomokuMove(game.board,game.next,Math.random,{forbidden:hasGomokuForbidden(game)}),true);
  },AI_REPLY_MS);
}
/** The automatic dead-stone job still belongs to the position on the board. */
function scoringJobCurrent(job) {
  return !!job && game.status==="scoring" && game.moveNumber===job.number &&
    boardHash(game.board)===job.hash && deadSignature(game.dead)===job.dead &&
    !deadReviewTouched && !game.agreed.black && !game.agreed.white;
}

/** The playout's border stones stay on the board, as fill stones, and count. */
function keptPlayout() {
  if(boardReview || settleControl.busy())return null;
  const counted=game.status==="scoring" || game.status==="finished" && !game.result?.endsWith("+R");
  return counted?fillStones(game):null;
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
  // A paused COM同士 stops at once: the move is asked for again on 再開.
  if(watching && watchPaused){requestAnalysis();return;}
  // The job stays open while it waits, so a new position or 待った drops the move.
  const wait=watching?0:personMovedAt+AI_REPLY_MS-performance.now();
  if(wait>0){aiThinking=true;aiJob=job;setTimeout(()=>finishAiMove(result),wait);return;}
  try {
    // This is an NN evaluation of the committed position, not a preview.
    const valid=Array.isArray(result.ownership) &&
      result.ownership.length===game.board.length &&
      result.ownership.every(v=>Number.isFinite(v)&&Math.abs(v)<=1.001);
    const passStage=valid?endgameAdvisor.observe(game,result.ownership):"playing";
    if(valid)rememberOwnership(game.board,result.ownership);
    // Two COMs each play with their own settings.
    const com=comToMove();
    if(resignWatch.observe(game,com.resign,result)){submitMove("resign",true);return;}
    const next=choosePolicyMove(game,result.policy,result.passLogit,{
      ...com,ownership:result.ownership,endgameStage:passStage,
      readMove:result.readMove,temperature:0.38
    });
    $("aiMatchStatus").textContent = com.strength==="strongest" ?
      (job.strong?TEXT.ai.playingStrongest(result.readDepth):TEXT.ai.strongestFailed) :
      TEXT.ai.playingWith(characterLabel(com.character),comSummary(com));
    if(watching)lastWatchMoveAt=performance.now();
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
  if(reviewPrefetch.receive(result,validFor))return;
  if(boardReview && result.id!==undefined && result.id===boardReview.katagoId) {
    const state=boardReview.preview||boardReview.display;
    if(validFor(state)) {
      boardReview.ownership=result.ownership;
      if(!boardReview.preview){keepReviewOwnership(reviewOwner(),state.board,result.ownership);scoreGraph.render();}
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
    settleControl.receive(result);
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
  // ドパガキモード judges the player's next move by this position's policy.
  if(context?.id===result.id && context.committed && result.engine==="katago" &&
    context.number===game.moveNumber && context.hash===boardHash(game.board))
    positionPolicy={number:context.number,hash:context.hash,policy:result.policy};
  // Sandbox positions and stale asynchronous results must never generate advice.
  if(context?.id===result.id && context.committed && !candidate &&
    context.number===game.moveNumber && context.hash===boardHash(game.board) &&
    result.engine==="katago") {
    if(!isFree(game))endgameAdvisor.observe(game,result.ownership);
    updateEndUi();
  }
  if(!overlayOn())return;
  $("analysisStatus").textContent=result.engine==="katago"
    ?TEXT.analysis.showingKatago
    :TEXT.analysis.showingFallback;
  transitionOwnership(result.ownership);
}
worker.onmessage=onWorkerMessage;
function show() {
  // A replay leaves the game's clock running.
  syncClock();
  if(boardReview){renderBoardReview();return;}
  // The forbidden stone is a provisional UI selection, never part of game state.
  if(illegalCandidate && (illegalCandidate.source!==game || game.status!=="playing")) {
    illegalCandidate=null;illegalPromptCopied=false;
    $("illegalPromptFallbackPanel").hidden=true;
  }
  $("actionRow").hidden=false;
  $("reviewPanel").hidden=true;$("reviewTools").hidden=true;
  $("endgameBar").hidden=false;
  $("scoreBox").hidden=false;
  const myTurn=isHumanTurn();
  const gomoku=isGomoku(game);
  syncStartButtons();
  renderInviteButton();
  const spectating=isWatching();
  $("turn").classList.toggle("white-to-play",game.next===WHITE);
  // Nobody is to move while scoring or after the game, so no turn stone.
  $("turn").classList.toggle("no-stone",game.status!=="playing" ||
    isWatching() && watchReturning && !watchPaused && !intervening);
  // 最強 can take a while: the turn says it is thinking, its stone pulses, and
  // the line under it says what it is doing and how far along.
  const waiting=strongWait();
  $("turn").classList.toggle("is-waiting",!!waiting);
  $("turn").textContent=waiting?TEXT.game.aiThinking:game.status==="finished"?finishedTitle():
    // The scoring step names itself here, so the score box keeps its one line for the instruction.
    game.status==="scoring"?(scoringStepOf(game)==="count"?TEXT.scoring.countTitle:TEXT.scoring.title):
    room && !connected?(reconnecting?TEXT.game.reconnecting:TEXT.game.waitingOpponent):
    isFree(game)?(freeColor===BLACK?TEXT.game.freeBlack:TEXT.game.freeWhite):
    room?(myTurn?TEXT.game.yourTurn:TEXT.game.opponentTurn):
    // COM同士 shows whose move it is; 「COM同士」 under it says who plays.
    gameMode==="ai"?(spectating?(watchReturning && !watchPaused && !intervening?TEXT.game.watchReturning:
        game.next===BLACK?TEXT.game.turnBlack:TEXT.game.turnWhite):
      gomoku?(isAiTurn()?TEXT.game.aiTurn:TEXT.game.yourTurnAi):
      fallbackMode?TEXT.game.aiStopped:
      isAiTurn()?TEXT.game.aiTurn:TEXT.game.yourTurnAi):
    (game.next===BLACK?TEXT.game.turnBlack:TEXT.game.turnWhite);
  if(!room)$("netStatus").textContent=waiting?.text || (spectating?TEXT.common.modeWatch:
    gameMode==="ai"?TEXT.common.modeAi:TEXT.common.modeLocal);
  $("netStatus").classList.toggle("online",connected);
  $("moveLabel").textContent=TEXT.game.moveLabel(game.moveNumber);
  // The sentence above stays for the states it explains (scoring, the result, waiting, a stopped AI).
  renderPlayers(game.status==="playing" && !isFree(game) && !(room && !connected) &&
    !(spectating && watchReturning && !watchPaused && !intervening) &&
    !(gameMode==="ai" && !gomoku && fallbackMode),waiting);
  // ◁ opens the replay one move back; ▷ only moves within a replay, so it rests disabled here.
  $("stepBack").disabled=!game.moves.length;
  $("stepForward").disabled=true;
  $("hint").textContent=illegalCandidate?TEXT.game.hintIllegal:
    candidate?TEXT.game.hintCandidate:
    game.status==="scoring"?TEXT.game.hintScoring:
    gameMode==="ai" && !gomoku && fallbackMode?TEXT.game.hintAiStopped:
    spectating && game.status==="playing"?(intervening?TEXT.game.hintIntervening:
      watchPaused?TEXT.game.hintWatchPaused:TEXT.game.hintWatching):
    isAiTurn()?TEXT.game.hintAiThinking:"";
  const blocked=!!illegalCandidate;
  $("confirm").disabled=!candidate || !myTurn || blocked;
  // While it cannot be pressed, the button says why instead of showing a dim ここに打つ.
  $("confirmLabel").textContent=blocked?TEXT.game.confirmBlocked:
    !myTurn?(gameMode==="ai" && !gomoku && fallbackMode?TEXT.ai.startUnavailable:
      gameMode==="ai" && !gomoku && (!katagoReady || waiting && strongWorkers.current().state==="loading")?
      TEXT.game.confirmPreparing:TEXT.game.confirmWait):
    candidate?TEXT.common.playHere:TEXT.game.confirmPick;
  // The stone on the button shows the colour that will be placed.
  $("confirmStone").classList.toggle("white",game.next===WHITE);
  $("copyIllegalPrompt").hidden=!blocked;
  $("copyIllegalPrompt").classList.toggle("is-copied",illegalPromptCopied);
  // With a provisional stone the button discards it; otherwise it is 待った.
  const provisional=!!candidate || blocked;
  const takeBack=!provisional && canTakeBack();
  // After 介入する, × goes back to watching, with or without a provisional stone.
  const stepIn=spectating && intervening;
  $("cancel").classList.toggle("is-takeback",!provisional && !stepIn);
  $("cancel").disabled=!provisional && !takeBack && !stepIn;
  const cancelLabel=stepIn?TEXT.game.watchBack:provisional?TEXT.takeback.undoProvisional:
    room?TEXT.takeback.labelOnline:
    gameMode==="ai"?TEXT.takeback.labelAi:TEXT.takeback.labelLocal;
  $("cancel").setAttribute("aria-label",cancelLabel);
  $("cancel").title=cancelLabel;
  $("endgameBar").classList.toggle("has-illegal",blocked);
  $("pass").disabled=!myTurn || game.status!=="playing";
  $("resign").disabled=!myTurn || game.status!=="playing";
  updateGradient();
  // 五目並べ has no territory, so no ownership bar.
  $("ownershipLegend").classList.toggle("no-territory",gomoku);
  // No colours are on the board yet, so the bar stays in place but faint.
  $("ownershipLegend").classList.toggle("is-preparing",!katagoReady && !fallbackMode && !gomoku);
  const handicap=handicapOf(game),size=sizeOf(game.board);
  canvas.setAttribute("aria-label",TEXT.game.boardLabel(shownSize()));
  const japanese=isJapanese(game);
  const forbidden=hasGomokuForbidden(game);
  $("ruleSummary").textContent=TEXT.game.ruleSummary(size,komiOf(game),handicap,
    isFree(game)?"free":gomoku?"gomoku":japanese,forbidden);
  $("ruleLabel").textContent=TEXT.game.ruleLabel(size,rulesOf(game),komiOf(game),handicap,forbidden);
  // Japanese territory scoring counts prisoners, so they sit under the ownership bar.
  $("captureCounts").hidden=!japanese;
  // While counting, the dead stones taken off the board are prisoners too.
  const counted=game.status==="scoring" || game.status==="finished" && !game.result?.endsWith("+R");
  const prisoners=japanese && counted?
    areaScore(game).prisoners:{black:game.captures?.black||0,white:game.captures?.white||0};
  // Black's prisoners are White stones: that pill shows White stones, in
  // Black's area colour, as the White stones filled into White's territory are.
  $("whitePrisoners").textContent=String(prisoners.black);
  $("blackPrisoners").textContent=String(prisoners.white);
  const outline=prisonerOutline(shownPalette());
  $("whitePrisonerPill").style.borderColor=outline.white;
  $("blackPrisonerPill").style.borderColor=outline.black;
  $("captureCounts").setAttribute("aria-label",TEXT.game.capturesAria(prisoners.black,prisoners.white));
  const isScoring=game.status==="scoring",isFinished=game.status==="finished";
  $("gamePanel").classList.toggle("is-scoring",isScoring);
  $("gamePanel").classList.toggle("is-finished",isFinished);
  $("endgameBar").classList.toggle("is-scoring",isScoring);
  $("endgameBar").classList.toggle("is-finished",isFinished);
  $("scoreBox").classList.toggle("hidden",!isScoring && !isFinished);
  $("endgameBar").hidden=isScoring || isFinished;
  $("resign").hidden=isScoring || isFinished;
  $("newMatchSheet").hidden=!isFinished;
  $("newMatch").hidden=!isFinished;
  // A friend's もう一局 waits for the other player to press it too.
  const rematchAsked=!!room && game.rematchRequest?.from===myOnlineColor();
  $("newMatch").querySelector("small").textContent=rematchAsked?TEXT.online.rematchWaiting:TEXT.game.rematchNote;
  for(const name of ["aria-label","title"])
    $("newMatch").setAttribute(name,rematchAsked?TEXT.online.rematchWaitingAria:TEXT.game.rematchAria);
  $("newMatch").disabled=gameMode==="ai" && !room && !canRematchAi() || !!room && (!connected || rematchAsked);
  $("openHistory").hidden=!isFinished;
  $("openShare").hidden=!isFinished;
  if(isScoring)$("analysisStatus").textContent=TEXT.scoring.title;
  if(isFinished)$("analysisStatus").textContent="";
  $("scoringActions").hidden=!isScoring;
  for(const id of ["cancel","pass"])$(id).hidden=isScoring || isFinished;
  // 五目並べ has no pass (it ends on five in a row, a full board or 投了). The
  // button stays greyed out in its place, so the row keeps the same layout.
  if(gomoku)$("pass").disabled=true;
  $("confirm").hidden=isScoring || isFinished;
  $("copyIllegalPrompt").hidden=isScoring || isFinished || !blocked;
  // 自由に置く: the colour to place takes the place of 投了, パス and ここに打つ.
  const free=isFree(game);
  $("freeColors").hidden=!free;
  if(free){
    for(const id of ["resign","pass","confirm"])$(id).hidden=true;
    for(const input of document.querySelectorAll('input[name="freeColor"]'))
      input.checked=input.value===sideKey(freeColor);
  }
  $("actionRow").classList.toggle("finished-actions",isFinished);
  // COM同士: 介入する and 一時停止 (再開); stepping in shows × and ここに打つ instead.
  const watchingPlay=spectating && game.status==="playing";
  $("watchToggle").hidden=$("watchIntervene").hidden=!watchingPlay || intervening;
  $("watchIntervene").disabled=!isGomoku(game) && (!katagoReady || fallbackMode);
  if(watchingPlay)for(const id of ["pass","resign"])$(id).hidden=true;
  if(watchingPlay && !intervening)for(const id of ["cancel","confirm"])$(id).hidden=true;
  $("watchToggle").textContent=watchPaused?TEXT.game.watchResume:TEXT.game.watchPause;
  $("watchToggle").setAttribute("aria-pressed",String(watchPaused));
  $("scoreBox").querySelector("strong").textContent=isFinished?TEXT.scoring.resultTitle:
    scoringStepOf(game)==="count"?TEXT.scoring.countTitle:TEXT.scoring.title;
  const playout=settleControl.view();
  $("scoreInstruction").textContent=playout?TEXT.scoring.settling(playout.moves):
    isFinished?
    (endedEarly(game.result)?TEXT.scoring.finishedResign:
      gomoku?(game.result==="0"?TEXT.scoring.finishedGomokuDraw:TEXT.scoring.finishedGomoku):
      japanese?TEXT.scoring.finishedScoreJapanese:TEXT.scoring.finishedScore):
    peerAgreed()?(scoringStepOf(game)==="dead"?TEXT.scoring.peerAgreedDead:TEXT.scoring.peerAgreed):
    deadReview==="pending"?TEXT.scoring.reviewPending:
    deadReview==="loading"?TEXT.scoring.reviewLoading:
    deadReview==="awaiting"?TEXT.scoring.reviewAwaiting:
    scoringStepOf(game)==="count"?TEXT.scoring.countStep:
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
    const agreeing=room?sideKey(myOnlineColor()):
      gameMode==="ai"?sideKey(humanColor):"black";
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
    if(endedEarly(result) || gomoku) {
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
                 "dead_auto","dead_unavailable","rematch","time_out"].includes(action?.type)) {
    if(action.number!==game.moveNumber || action.before!==boardHash(game.board))return;
    if(action.type==="end_answer" && action.proposalFrom!==game.endProposal?.from)return;
    if(action.type==="takeback_answer" && action.proposalFrom!==game.takebackRequest?.from)return;
  }
  let rewound=false,rematchOffered=false;
  try{
    // The friend's client acts only for the friend's color.
    if(remote && !isPeerAction(action,game,{peerColor:myOnlineColor()===null?null:-myOnlineColor(),
      peerIsOwner:p2pRole==="guest"}))throw new Error("Not the peer's action");
    const wasScoring=game.status==="scoring";
    const before=game;
    if(action.type==="move"){
      if(action.number!==game.moveNumber+1) throw new Error("Move number mismatch");
      if(action.before!==boardHash(game.board)) throw new Error("Board mismatch before the move");
      const offerBefore=game.endProposal;
      // The mover's clock pays for the move; one that ran out first loses instead.
      // A friend's move carries their clock, as their own device timed it.
      const clock=remote?peerClock(action.clock):chargeClock();
      if(clock===false){timeOut(game.next);return;}
      if(clock && room && !remote)action={...action,clock};
      game=isFree(game)?playFreeStone(game,action.position,action.color):play(game,action.position);
      if(clock)game={...game,clock};
      if(remote && offerBefore?.from===myOnlineColor())
        endNotice={number:game.moveNumber,hash:boardHash(game.board),text:TEXT.endgame.cancelledByMove};
      if(action.after!==boardHash(game.board)) throw new Error("Board mismatch after the move");
      lastPosition=Number.isInteger(action.position)?action.position:null;
      if(!remote && !isAiMove)personMovedAt=performance.now();
      if(isAiMove && aiPassAsks()){
        candidate=null;illegalCandidate=null;illegalPromptCopied=false;
        $("illegalPromptFallbackPanel").hidden=true;
      }
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
      // The friend who ran the playout sends it along: its stones on the empty
      // points close the borders for the count.
      const frames=action.type==="dead_auto" && Array.isArray(action.playout) ?
        replayPlayout(game,action.playout) : null;
      game=withPlayoutFill(game,frames?.at(-1).board);
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
    else if(action.type==="time_out") {
      if(action.color!==game.next)return;
      stopAiTurn();
      game=loseOnTime(game,action.color);
    }
    else if(action.type==="resume") game=resume(game,action.color);
    else if(action.type==="rematch") {
      const round=roundOf(game);
      game=requestRematch(game,action.color);
      if(roundOf(game)!==round)startNextRound();
      else rematchOffered=remote;
    }
    // "mode" (the removed per-game overlay switch) from older peers is ignored below.
    else if(action.type==="end_offer") {
      game=proposeEnd(game,action.color);
      if(remote)endExpanded=false;
    } else if(action.type==="end_answer") {
      const offerFrom=game.endProposal?.from;
      game=answerEndProposal(game,action.color,Boolean(action.accept));
      if(!action.accept)endgameAdvisor.hold();
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
    // The COM's pass asks at once; any other move closes the question.
    if(action.type==="move")endExpanded=isAiMove && aiPassAsks();
    if(!wasScoring && game.status==="scoring") {
      deadReview="idle";deadReviewTouched=false;deadEvaluation=null;
    }
    if(action.type==="resume" || game.status==="playing") {
      deadReview="idle";deadReviewTouched=false;deadEvaluation=null;
    }
    const hadCandidate=!!candidate;
    if(room)onlineRevision++;
    // The opponent's move may land anywhere, so show the whole board again.
    // A watched COM同士 game keeps the zoom the viewer chose.
    if(action.type==="move" && (remote || isAiMove && !watching))boardZoom.reset();
    candidate=null;save();show();
    // After save(), which clears the notice line.
    if(rematchOffered)showNotice(TEXT.online.rematchOffered);
    const cue=moveSound(before,game,action.type==="move"?action.position:null);
    const cheer=dopaEvent(before,game,dopaViewer());
    // Only this device's own move, judged from the position it was played in.
    const good=action.type==="move" && !remote && !isAiMove && !isFree(before) &&
      positionPolicy?.number===before.moveNumber && positionPolicy.hash===boardHash(before.board) &&
      goodMove(positionPolicy.policy,before.board,action.position);
    // ドパガキモード's voices grow with the capture, and cheer only a win.
    if(cue)sound.play(cue,cheer??undefined);
    if(good)sound.play("good");
    // A question for this player: the friend's もう一局, end or 待った, the COM's pass,
    // or a watched COM同士 game reaching the count.
    if(remote && proposalArrived(before,game) || isAiMove && endExpanded ||
       isAiMove && isWatching() && before.status==="playing" && game.status==="scoring")sound.play("offer");
    // Evaluate once, when a play/pass or accepted offer enters scoring.
    if(["move","resume","mode","solo_scoring"].includes(action.type) || rewound ||
       (action.type==="rematch" && game.status==="playing") ||
       (action.type==="end_answer" && game.status==="scoring") ||
       (hadCandidate && game.status==="playing"))
      requestAnalysis();
    if(!remote&&room)p2pTransport.sendAction(action);
    // Show last: an effect must never keep the move from being analysed or sent.
    if(good)dopa.praise();
    dopa.celebrate(cheer);
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
  // A free board's move carries the colour this player chose.
  const free=isFree(game)?{color:freeColor}:{};
  let next;
  try{next=free.color?playFreeStone(game,position,free.color):play(game,position);}
  catch(error){showNotice(messageFor(error,TEXT.common.retry));return;}
  apply({type:"move",position,...free,number:game.moveNumber+1,before,after:boardHash(next.board)},false,fromAi);
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
    if(settleControl.tap(position))return;
    apply({type:"dead",position,selected:!game.dead.includes(position)});return;
  }
  // While watching, the board takes stones only after 介入する.
  if(game.status!=="playing" || !isHumanTurn())return;
  // A free board places or takes off a stone at once; 待った undoes it.
  if(isFree(game)){submitMove(position);return;}
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
    if(isWatching() && intervening)takeOverWatchedGame(game.next);
    submitMove(position);
  }
};
$("cancel").onclick=()=>{
  if(isWatching() && intervening){
    // Back to watching: the COMs resume after a pause a little longer than a move's.
    clearProvisional();
    intervening=false;watchReturning=!watchPaused;lastWatchMoveAt=performance.now()+WATCH_RESUME_MS-watchStep();
    show();requestAnalysis();return;
  }
  if(!candidate && !illegalCandidate) {
    if(!canTakeBack())return;
    // A takeback is itself reversible by replaying the move, so no second tap.
    if(room)apply({type:"takeback_request",color:myOnlineColor(),
      number:game.moveNumber,before:boardHash(game.board)});
    else takeBackMove();
    return;
  }
  clearProvisional();
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
// Each player picks the colour to place on a free board; it is remembered, not shared.
for(const input of document.querySelectorAll('input[name="freeColor"]'))
  input.onchange=e=>{
    if(!e.target.checked)return;
    freeColor=colorOf(e.target.value);
    rememberSettings();show();
  };
// A mistaken pass is undone with 待った, so every mode passes on one tap.
$("pass").onclick=()=>submitMove(null);
// The armed label names the action ("投了？"): a bare "確定" reads like the
// adjacent move confirmation.
$("resign").onclick=()=>{
  if(!confirmByRetap($("resign"),null,TEXT.game.resignConfirmAria))return;
  submitMove("resign");
};
/**
 * Called whenever `game` is replaced by another position (a new or resumed game,
 * a rewind, a fork): nothing computed for the previous one may carry over, late
 * analysis results and a running territory animation included. A scoring game
 * resumed with dead stones or an agreement already marked keeps them as edited.
 */
function resetPositionState() {
  clearTimeout(analysisTimer);analysisTimer=null;
  pending=++seq;analysisContext=null;
  if(transitionFrame!==null)cancelAnimationFrame(transitionFrame);
  transitionFrame=null;displayedOwnership=null;
  clearProvisional();
  restoreEndgameAdvice();endExpanded=!!game.endProposal || aiPassAsks();
  endNotice=null;takebackNotice=null;
  deadReview=game.status==="scoring" &&
    (game.dead.length || game.agreed.black || game.agreed.white)?"modified":"idle";
  deadReviewTouched=deadReview==="modified";deadEvaluation=null;
}
// Signals computed for the abandoned line must not survive a rewind.
function afterTakeback() {
  const last=game.moves.at(-1)?.position;
  lastPosition=Number.isInteger(last)?last:null;
  resetPositionState();
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
/** A new empty local board, by default with the sheet's choices (callers save first). */
function freshLocalBoard(fresh=freshLocalGame(game,nextGameOptions(localHandicap))) {
  resetArmedButtons();
  game=fresh;currentGameId=null;currentRevision=null;lastPosition=null;
  resetPositionState();
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
$("startLocal").onclick=()=>continueFrom?forkBoardReview("local"):startLocalGame();
// After a game: 新規対戦 opens the sheet on this mode; もう一局 starts the same game again at once,
// with the finished game's board, rules and options (and, against the COM, the same COM and side).
$("newMatchSheet").onclick=()=>openPanel(room?"online":gameMode);
$("newMatch").onclick=()=>{
  if(game.status!=="finished")return;
  if(room){
    if(connected)apply({type:"rematch",color:myOnlineColor(),number:game.moveNumber,before:boardHash(game.board)});
    return;
  }
  if(gameMode==="ai"){
    if(!canRematchAi())return;
    startAiGame(initialGame(game),watching,aiSideChoice==="random"?"random":sideKey(humanColor));
    return;
  }
  if(!save())return;
  clearBoardReview();freshLocalBoard(initialGame(game));
};
/** A friend's もう一局 was agreed: the finished game stays in the library, and the next one is a new record. */
function startNextRound(){
  currentGameId=null;currentRevision=null;lastPosition=null;candidate=null;
  resetArmedButtons();resetPositionState();
}
// The KataGo opponent must be ready; 五目並べ's needs none.
function canRematchAi(){return isGomoku(game) || katagoReady && !fallbackMode;}
$("agree").onclick=()=>{
  if(!canApproveScoring(game,deadReview,room,connected))return;
  const color=room?myOnlineColor():gameMode==="ai"?humanColor:BLACK;
  if(game.agreed[sideKey(color)])return;
  const deadStep=scoringStepOf(game)==="dead";
  if(!room)apply({type:deadStep?"solo_dead":"solo_score"});
  else apply({type:deadStep?"agree_dead":"agree",color});
};
// 日本囲碁規約 第九条: the opponent of the side that resumes moves first. On one
// board for two players (or while watching) nobody in particular asks, so the turn stays.
$("resume").onclick=()=>{
  const color=room?myOnlineColor():gameMode==="ai" && !isWatching()?humanColor:null;
  apply(color?{type:"resume",color}:{type:"resume"});
};
$("backToDead").onclick=()=>apply({type:"back_to_dead"});
$("endPropose").onclick=()=>{
  if(game.status!=="playing" || game.endProposal || game.takebackRequest)return;
  const color=myColorForEnd();
  if(!color || (room&&!connected))return;
  // While watching, the COM's move waits for the answer; 打ち続ける asks for it again.
  if(isWatching()){stopAiTurn();intervening=false;watchReturning=false;}
  if(!room){
    if(aiThinking)return;
    // The prompt replaces any provisional stone; the board is not half-committed.
    clearProvisional();
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
  if(!room && endExpanded && aiPassAsks()){
    endExpanded=false;submitMove(null);return;
  }
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
    // As with a friend's answer, the strongest advice waits for the board to settle again.
    if(aiPassAsks())keptPlayingAt={number:game.moveNumber,hash:boardHash(game.board)};
    endgameAdvisor.hold();
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
$("mainTime").onchange=e=>{mainTimeChoice=toSeconds(e.target.value,MAIN_TIME_CHOICES);rememberSettings();};
$("byoyomi").onchange=e=>{byoyomiChoice=toSeconds(e.target.value,BYOYOMI_CHOICES);rememberSettings();};
$("gomokuForbidden").onchange=e=>{gomokuForbiddenChoice=e.target.checked;rememberSettings();renderInviteButton();};
// A player reads their own result first; a 1台 game or COM同士 has no "you".
// A resignation or a loss on time ends the game before any count.
const endedEarly = result => /\+[RT]$/.test(result||"");
// 持ち時間: only a person's clock runs. COMs, a watched game and a free board
// play without one. In a friend game both devices run the clock of the side
// to move while connected; a dropped connection gives the turn's time back.
const gameClock=createGameClock();
let clockMoves=null,clockSide=null;
function clockedSide() {
  if(!game.timeControl || game.status!=="playing" || isFree(game) || room && !connected)return null;
  if(gameMode==="ai" && (watching || game.next!==humanColor))return null;
  return game.next;
}
// The clock follows the position: a new move, 待った or another game restarts it.
// A clock that ran out stays out until the position changes.
function syncClock() {
  const side=clockedSide();
  if(!side){if(gameClock.running)gameClock.stop();clockMoves=null;clockSide=null;renderClock();return;}
  if(clockMoves!==game.moves || clockSide!==side){
    clockMoves=game.moves;clockSide=side;
    gameClock.run(game,side);
  }
  renderClock();
}
/** The clock after the side to move's move, null with no clock, false when its time ran out. */
function chargeClock() {
  const running=gameClock.running;
  if(!running || clockMoves!==game.moves || running.side!==game.next)return null;
  clockMoves=null;
  return spendTime(game,running.side,gameClock.stop()) || false;
}
/** A friend's clock after their move: only their own time may go down, never below 0. */
function peerClock(clock) {
  const before=clockOf(game);
  if(!before)return null;
  const key=game.next===BLACK?"black":"white",other=game.next===BLACK?"white":"black";
  if(!Number.isFinite(clock?.[key]) || clock[key]<0 || clock[key]>before[key] || clock[other]!==before[other])
    throw new Error("Clock mismatch");
  return {...before,[key]:clock[key]};
}
// Each device calls only its own player's time; the friend's loss on time comes over the connection.
function timeOut(side) {
  if(clockedSide()!==side)return;
  if(room && side!==myOnlineColor())return;
  clockMoves=null;
  candidate=null;
  apply({type:"time_out",color:side,number:game.moveNumber,before:boardHash(game.board)});
}
gameClock.onTimeout(timeOut);
// Each person's time under their name in the turn row: the side to move counts down.
// A COM has no clock, so its side keeps its strength or 考え中.
const clockShown = side => !!game.timeControl && !boardReview && !isFree(game) &&
  !(gameMode==="ai" && (isWatching() || side!==humanColor));
function renderClock() {
  const running=gameClock.reading();
  const hurry=dopa.countdown(running && clockShown(running.side) ? running : null);
  for(const side of [BLACK,WHITE]){
    const cell=$(side===BLACK?"clockBlack":"clockWhite");
    cell.hidden=!clockShown(side);
    if(cell.hidden)continue;
    // A friend's clock that ran out shows 0 until their device calls it.
    const reading=running?.side===side?running:readClock(game,side,clockedSide()===side?Infinity:0);
    cell.textContent=reading.main>0?clockText(reading.main):
      reading.byoyomi===null?clockText(0):TEXT.game.byoyomi(clockSeconds(reading.byoyomi));
    cell.classList.toggle("is-running",running?.side===side);
    cell.classList.toggle("is-low",running?.side===side && reading.left<=10000);
    cell.classList.toggle("dopa-hurry",running?.side===side && hurry);
  }
}
gameClock.subscribe(renderClock);
// 秒読み: one beep for each of the last seconds of the running clock.
let lastCountdown=null;
gameClock.subscribe(reading=>{
  const cue=countdownSound(reading);
  const key=cue && reading.side+":"+game.moveNumber+":"+clockSeconds(reading.left);
  if(cue && key!==lastCountdown)sound.play(cue);
  lastCountdown=key;
});
function finishedTitle(){
  const mine=room?myOnlineColor():gameMode==="ai" && !isWatching()?humanColor:null;
  const winner=resultWinner(game.result);
  if(!mine || !winner)return TEXT.scoring.finishedResign;
  return winner===(mine===BLACK?"B":"W")?TEXT.scoring.finishedWin:TEXT.scoring.finishedLoss;
}
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
      roomId:room||null,snapshot:game,lastPosition,humanColor,aiCom,seat,names:recordNames(playersShown()),
      watch:gameMode==="ai" && watching,watchAi},currentRevision);
    currentGameId=record.id;currentRevision=record.revision;
    if(!room)gameLibrary.setActive(gameMode,record.id);
    if(room)persistOnline();
    rememberSettings();clearStorageError();
    compactOwnership();showEvictionNotice();
    return true;
  }catch(error){storageError(error);return false;}
}
/** The player's colour and the COMs of a saved 対COM game (call setWatching first). */
function restoreAiOptions(record) {
  humanColor=record.humanColor===WHITE?WHITE:BLACK;
  aiCom=recordCom(record);
  if(watching)watchAi=readWatchAi(record.watchAi,aiCom);
}
function savedGame(mode) {
  let record=null;
  try{record=gameLibrary.active(mode);}catch(error){storageError(error);}
  currentGameId=record?.id||null;currentRevision=record?.revision||null;
  lastPosition=record?.lastPosition??null;
  setWatching(mode==="ai" && record?.watch===true);
  if(mode==="ai" && record)restoreAiOptions(record);
  return record?.snapshot||newGame(true,{size:boardSize});
}
function leaveOnlineRoom() {
  resetArmedButtons();
  if(!room)return;
  save();
  p2pTransport?.leave();
  const oldUrl=new URL(location.href);oldUrl.searchParams.delete("room");oldUrl.hash="";
  room=null;seat="host";connected=false;reconnecting=false;ownerColor=null;onlineSession=null;
  inviteKey=null;guestInviteKey=null;issuedSide=null;onlineRevision=0;p2pRole="owner";
  linkKey=null;seenPeerSignins=null;peerName="";
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
  game=savedGame(mode);resetPositionState();
  save();closePanels();show();requestAnalysis();
}
// The room whose 友人対局に戻る was closed is not offered again.
const RESUME_DISMISSED_KEY="miego-friend-resume-dismissed";
// The server forgets a room a week after it was made.
const ROOM_LIFETIME_MS=7*24*60*60*1000;
/** The newest friend game on this device, when it is unfinished and this browser still holds its seat. */
function resumableRoom(){
  let record=null,dismissed=null;
  try{record=gameLibrary.list().find(r=>r.mode==="online");dismissed=localStorage.getItem(RESUME_DISMISSED_KEY);}catch{}
  if(!record || record.roomId===room || record.roomId===dismissed)return null;
  if(!(Date.now()-Date.parse(record.updatedAt)<ROOM_LIFETIME_MS))return null;
  const stored=readCheckpoint(localStorage,record.roomId);
  return stored?.session && stored.game.status!=="finished"?record.roomId:null;
}
/** Reopens a friend room the way its address does: the saved seat rejoins and reconnects. */
function openFriendRoom(target){
  save();
  location.assign(roomUrl(location.origin,target));
}
/**
 * The 新規対戦 sheet's way back, shown in every mode at the same place: the
 * unfinished saved game of the chosen offline mode when another mode is on the
 * board, otherwise the game on the board (leaving any replay).
 */
function returnTarget(kind) {
  // A finished game has nothing to continue, so the button names the board instead.
  const current={mode:null,label:!boardReview && game.status==="finished"?TEXT.history.returnBoard:TEXT.history.returnCurrent};
  if(kind==="online" && !room){
    const target=resumableRoom();
    if(target)return {mode:null,room:target,label:TEXT.online.resumeOpen};
  }
  if(kind==="history" || kind==="online" || kind===(room?"online":gameMode))return current;
  let record=null;
  try{record=gameLibrary.active(kind);}catch{}
  if(!record || record.snapshot.status==="finished")return current;
  return {mode:kind,label:kind==="ai"?TEXT.history.returnAi:TEXT.history.returnLocal};
}
function syncReturnButton(kind) {
  const target=returnTarget(kind);
  $("returnToGame").textContent=target.label;keepArmedLabel($("returnToGame"));
}
$("returnToGame").onclick=()=>{
  const target=returnTarget(newGameModeKind());
  if(target.room){openFriendRoom(target.room);return;}
  if(target.mode){resumeModeGame(target.mode);return;}
  if(boardReview){clearBoardReview();show();requestAnalysis();}
  closePanels();$("newGameButton").focus();
};
function onPeerSync(message){
  const result=reconcileGame(game,onlineRevision,message.game,message.revision,
    {localIsOwner:p2pRole==="owner",localColor:myOnlineColor()});
  if(result.kind==="conflict"||result.kind==="invalid"){
    connected=false;reconnecting=false;$("netStatus").textContent=TEXT.online.statusStopped;
    showSeatNotice(TEXT.online.mismatch);
    show();return false;
  }
  // A device from before 表示名 sends none, and its player stays 相手.
  const theirName=typeof message.name==="string"?cleanName(message.name):peerName;
  if(theirName!==peerName){peerName=theirName;if(result.kind!=="adopt")save();}
  if(result.kind==="adopt"){
    // A もう一局 agreed while this device was away starts a new record, too.
    if(roundOf(result.game)!==roundOf(game)){currentGameId=null;currentRevision=null;}
    game=result.game;onlineRevision=result.revision;lastPosition=message.lastPosition??null;
    candidate=null;endgameAdvisor.reset();resignWatch.reset();
    endExpanded=!!game.endProposal && game.endProposal.from!==myColorForEnd();
    deadReviewTouched=false;deadEvaluation=null;
    save();requestAnalysis();
  }
  if(game.status==="scoring"){
    const review=message.scoringReview;
    if(REVIEW_DONE.has(review)){
      deadReview=review;deadReviewTouched=review==="modified";deadEvaluation=null;
    }else if(p2pRole==="guest" && !REVIEW_DONE.has(deadReview))deadReview="awaiting";
  }
  if(result.kind==="send")p2pTransport.sendSync();
  connected=true;$("netStatus").textContent=TEXT.online.connected;show();return true;
}
const verifyHuman=()=>verifyP2P({$,openSheet:()=>openPanel("online"),closeSheet:closePanels});
p2pTransport=createP2PTransport({
  verify:verifyHuman,
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
  onConnected:()=>{
    // The friend who opened the invite arrives: once per room, before the first move.
    if(p2pRole==="owner" && peerMetRoom!==room && game.moveNumber===0)sound.play("offer");
    peerMetRoom=room;
    connected=true;reconnecting=false;$("netStatus").textContent=TEXT.online.connected;
    // A failed retry left 電波やWi-Fiを確認して…, which no longer applies once the peers meet again.
    if($("saveStatus").textContent===TEXT.online.retrying)$("saveStatus").hidden=true;
    show();
  },
  onDisconnected:(message,retrying)=>{
    connected=false;if(retrying!==undefined)reconnecting=retrying;
    $("netStatus").textContent=message;show();
  },
  onError:error=>{
    console.warn("P2P",error);
    reconnecting=!!error.retrying;
    if(error.stage==="ticket" && error.status===403){
      // An opened seat link takes the seat back once; otherwise another device holds it.
      if(linkKey){inviteKey=linkKey;linkKey=null;onlineSession=null;persistOnline();void joinRoom();return;}
      $("netStatus").textContent=TEXT.online.seatElsewhere;
      showSeatNotice(TEXT.online.seatTakenNotice);
    }else if(error.stage==="ticket" && error.status===410){
      $("netStatus").textContent=TEXT.online.statusCannotJoin;
      showSeatNotice(TEXT.online.roomGone);
    }else{
      // The transport tries again by itself, so the notice asks only to check the network.
      $("netStatus").textContent=TEXT.online.statusOffline;
      showNotice(error.retrying?TEXT.online.retrying:messageFor(error,TEXT.online.requestFailed));
    }
    show();
  },
  getSnapshot:()=>({game,revision:onlineRevision,lastPosition,name:playerName.name(),
    scoringReview:game.status==="scoring" &&
    REVIEW_DONE.has(deadReview)?deadReview:null})
});
async function joinRoom(){
  if(!ROOM_PATTERN.test(room)){
    $("netStatus").textContent=TEXT.online.statusCannotJoin;showSeatNotice(TEXT.online.badInvite);return;
  }
  const targetRoom=room;reconnecting=false;
  // show() names the mode only outside a room, so the previous mode's name would stay here.
  $("netStatus").textContent=TEXT.online.waitingConnection;
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
  const color=selectColor(choice),token=await verifyHuman();
  const created=await p2pTransport.post("/api/rooms",
    {color:sideKey(color),turnstileToken:token});
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
  game=newGame(true,nextGameOptions(onlineHandicap));lastPosition=null;
  currentGameId=null;currentRevision=null;
  resetPositionState();
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
// Every mode's start button reads the same 新しい対局を始める (ここから打つ when continuing a replay).
function syncStartButtons() {
  // The 五目並べ computer needs no KataGo, so it can start at once.
  const needsKatago=continueFrom?!isGomoku(continueFrom.line):gameRules!=="gomoku";
  $("startAi").disabled=needsKatago && (!katagoReady || fallbackMode);
  $("startAi").textContent=needsKatago && fallbackMode?TEXT.ai.startUnavailable:
    needsKatago && !katagoReady?TEXT.ai.startLoading:startLabel();
  keepArmedLabel($("startAi"));
  $("startLocal").textContent=startLabel();
  keepArmedLabel($("startLocal"));
}
function startLabel(){return continueFrom?TEXT.review.continue:TEXT.newGame.start;}
// 自分の石, COMのキャラ, 盤, ルール and 時間 are one row of underlined tabs, the colour first; the selected
// tab's choices fill the one panel under it, one per line with a note beside it.
const SETUP_TABS=["Side","Strength","Board","Rules","Time"];
function selectSetupTab(key, focus=false) {
  for(const other of SETUP_TABS){
    const tab=$("setupTab"+other),selected=other===key;
    tab.setAttribute("aria-selected",String(selected));
    tab.tabIndex=selected?0:-1;
    $("setupPanel"+other).hidden=!selected;
  }
  if(focus)$("setupTab"+key).focus();
}
SETUP_TABS.forEach((key,index)=>{
  $("setupTab"+key).onclick=()=>selectSetupTab(key);
  $("setupTab"+key).onkeydown=e=>{
    const step=e.key==="ArrowRight"?1:e.key==="ArrowLeft"?-1:0;
    if(step){e.preventDefault();selectSetupTab(SETUP_TABS[(index+step+SETUP_TABS.length)%SETUP_TABS.length],true);}
  };
});
// A tab whose setting the chosen mode does not use is greyed out; its panel still opens.
function syncSetupValues() {
  const kind=newGameModeKind(),watch=kind==="ai" && watchChoice;
  $("setupTabSide").classList.toggle("is-unused",kind==="local" || watch);
  // While watching, the tab still holds each COM's card.
  $("setupTabStrength").classList.toggle("is-unused",kind!=="ai");
  // 時間 holds the clock and 観戦's speed; a free board uses neither.
  $("setupTabTime").classList.toggle("is-unused",!watch && untimedRules(kind));
  $("sideNote").textContent=kind==="local"?TEXT.newGame.sideNotes.local:watch?TEXT.newGame.sideNotes.watch:"";
  syncSetupTabValues();
}
// Each tab shows its chosen value under its name, so the game to start reads without opening every tab.
function syncSetupTabValues() {
  for(const key of SETUP_TABS){
    const tab=$("setupTab"+key),panel=$("setupPanel"+key);
    // 自分の石 holds a row for 対COM and one for 対友人; the shown one counts.
    const checked=[...panel.querySelectorAll("input:checked")].find(input=>input.closest("[hidden]")===panel || !panel.contains(input.closest("[hidden]")));
    // ここから打つ fixes 盤 and ルール to the record's, so those still show the value.
    const fixed=continueFrom && (key==="Board" || key==="Rules");
    if(key==="Time" && !tab.classList.contains("is-unused")){$("setupValueTime").textContent=timeTabValue();continue;}
    $("setupValue"+key).textContent=key==="Strength" && editsWatchAi() && !tab.classList.contains("is-unused")?TEXT.newGame.watchStrengthValue:
      !checked || tab.classList.contains("is-unused") && !fixed?"—":checked.nextElementSibling.textContent.trim();
  }
}
$("newGameSetup").addEventListener("change",syncSetupTabValues);
// 観戦 shows its speed; the other modes their clock.
function timeTabValue() {
  if(newGameModeKind()==="ai" && watchChoice)return TEXT.newGame.watchSpeeds[watchSpeed];
  const label=(id,value)=>value?$(id).selectedOptions[0]?.textContent.trim()||"":"";
  return TEXT.newGame.timeValue(label("mainTime",mainTimeChoice),label("byoyomi",byoyomiChoice));
}
// A free board has no turns to time, and 観戦 its speed instead.
const untimedRules=kind=>gameRules==="free" || kind==="ai" && watchChoice;
// The 新規対戦 sheet shows the same rows in every mode, so its height stays put;
// a row the chosen mode does not use is greyed out.
function showNewGameMode(kind) {
  // 観戦 is 対COM with two COMs: it opens as 観戦 while that is the sheet's choice.
  if(kind==="ai" && watchChoice)kind="watch";
  const watch=kind==="watch";
  const choice=document.querySelector('input[name="newGameMode"][value="'+kind+'"]');
  if(choice)choice.checked=true;
  if(watch)kind="ai";
  $("localSetup").hidden=kind!=="local";
  $("onlineSetup").hidden=$("onlineStart").hidden=kind!=="online";
  $("aiSetup").hidden=kind!=="ai";
  // 履歴 swaps the game options for the saved-game list in the same sheet.
  $("historySetup").hidden=$("historyActions").hidden=kind!=="history";
  $("newGameSetup").hidden=kind==="history";
  $("modePanel").scrollTop=0;
  if(kind==="history")historyPanel.showHistory();
  // 1台で打つ and 観戦 have no side to choose: they show 対COM's row greyed out.
  $("aiSideRow").hidden=kind==="online";
  $("onlineSideRow").hidden=kind!=="online";
  $("aiSideChoices").disabled=kind!=="ai" || watch;
  // 観戦's speed sits under 時間 in every mode, greyed out outside 観戦.
  $("watchSpeedChoices").disabled=!watch;
  $("watchSpeedRow").classList.toggle("is-off",!watch);
  syncSideUi();syncStrengthUi();updatePersonaUi();
  // 自由に置く has no computer opponent: under 対COM it is greyed out and the default rules apply.
  if(kind==="ai" && gameRules==="free" && !continueFrom){gameRules="chinese";rememberSettings();}
  $("modeHelp").dataset.help=kind;
  syncReturnButton(kind);
  syncHandicapUi();
  if(kind==="online" && room)showInviteLink();
  if(kind==="online")renderInviteButton();
}
// 観戦 starts a game against the COM, so the sheet treats it as 対COM.
const newGameModeKind=()=>{
  const kind=document.querySelector('input[name="newGameMode"]:checked')?.value||"ai";
  return kind==="watch"?"ai":kind;
};
for(const input of document.querySelectorAll('input[name="newGameMode"]'))
  input.onchange=e=>{
    if(!e.target.checked)return;
    if(e.target.value==="ai" || e.target.value==="watch"){watchChoice=e.target.value==="watch";rememberSettings();}
    showNewGameMode(e.target.value);
  };
for(const input of document.querySelectorAll('input[name="watchSpeed"]'))
  input.onchange=e=>{
    if(!e.target.checked)return;
    watchSpeed=toWatchSpeed(e.target.value);rememberSettings();
  };
for(const input of document.querySelectorAll('input[name="boardSize"]')) {
  input.onchange=e=>{
    if(!e.target.checked)return;
    boardSize=toBoardSize(e.target.value);
    ({aiHandicap,localHandicap,onlineHandicap}=capHandicaps({aiHandicap,localHandicap,onlineHandicap},boardSize));
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
  reviewFeedback("");show();requestReviewOwnership();
}
function selectVariationLine(){
  if(!boardReview?.variation)return;
  boardReview.activeLine="variation";
  boardReview.preview=null;boardReview.previewPosition=null;
  const line=boardReview.variation.snapshot;
  boardReview.step=Math.min(boardReview.step,line.moves.length);
  boardReview.display=replaySteps(line,boardReview.step);
  reviewFeedback("");show();requestReviewOwnership();
}
function saveReviewVariation(){
  if(!boardReview?.variation)return;
  try{
    gameLibrary.save({mode:"local",snapshot:boardReview.variation.snapshot,source:"variation"});
    $("reviewNotice").textContent=TEXT.review.variationSaved;
  }catch(error){$("reviewNotice").textContent=messageFor(error,TEXT.review.variationSaveFailed);}
}
/** Who plays each colour, for the turn row and the names a saved game keeps. */
function playersShown(){
  return {mode:room?"online":gameMode,watching:isWatching(),humanColor,aiCom,watchAi,
    onlineColor:room?myOnlineColor():null,myName:playerName.name(),peerName};
}
/** Both players in the turn row: who each colour is, and whether it is to move. */
function renderPlayers(shown, waiting=null) {
  $("players").hidden=!shown;
  $("statusRow").querySelector(".status-main").classList.toggle("has-players",shown);
  if(!shown)return;
  const sides=playerSides(playersShown());
  for(const color of [BLACK,WHITE]){
    const side=sides[color],box=$(color===BLACK?"playerBlack":"playerWhite");
    const toMove=game.next===color;
    const thinking=toMove && side.com && !watchPaused && !intervening;
    box.classList.toggle("is-turn",toMove);
    box.querySelector(".player-wait").hidden=!thinking;
    // A person's 持ち時間 takes the place of their line.
    box.querySelector(".player-name").textContent=side.name;
    // The connection stays in the line under the turn, which takes this row's place when it drops.
    box.querySelector(".player-detail-text").textContent=
      thinking?(waiting?.short || TEXT.game.comThinking):clockShown(color)?"":toMove && !side.com?TEXT.game.toMove:side.detail;
  }
  $("playersMove").textContent=TEXT.game.moveLabel(game.moveNumber);
}
function renderBoardReview() {
  if(!boardReview)return;
  renderPlayers(false);
  // The live match may advance over WebRTC or AI while the chosen step stays fixed.
  if(boardReview.source==="live")boardReview.snapshot=game;
  const {step,source}=boardReview;
  const line=activeReviewSnapshot(boardReview,game),count=line.moves.length;
  const variationActive=boardReview.activeLine==="variation" && !!boardReview.variation;
  const isPreview=!!boardReview.preview;
  $("ownershipLegend").classList.toggle("no-territory",isGomoku(line));
  $("reviewTitle").textContent=variationActive?TEXT.review.checkingVariation:source==="url"?TEXT.review.checkingShared:TEXT.review.checking;
  $("moveLabel").textContent=TEXT.review.step(step,count);
  $("reviewStepRange").max=String(count);
  $("reviewStepRange").value=String(step);
  $("stepBack").disabled=step===0 || isPreview;
  $("stepForward").disabled=step>=count || isPreview;
  $("reviewStepRange").disabled=isPreview;
  scoreGraph.render();
  // One way back: at the live game's latest move 続きを打つ already returns to it.
  $("reviewBack").hidden=isPreview || atLiveLatest();
  $("reviewPlayActions").hidden=!isPreview;
  $("reviewConfirmStone").classList.toggle("white",boardReview.preview?.moves.at(-1)?.color===WHITE);
  $("reviewVariation").hidden=variationActive || !boardReview.variation;
  $("reviewSaveVariation").hidden=!boardReview.variation;
  const updates=source==="live"?Math.max(0,game.moveNumber-boardReview.openedAt):0;
  $("reviewNewMoves").hidden=updates===0;
  $("reviewNewMoves").textContent=updates>0?TEXT.review.newMoves(updates):"";
  // The way back: to the latest move, the original line, or the game.
  $("reviewBack").firstChild.textContent=variationActive?TEXT.review.backOriginal:TEXT.review.backGame;
  $("turn").classList.toggle("white-to-play",boardReview.display.next===WHITE);
  $("turn").classList.remove("no-stone");
  $("turn").textContent=isPreview?TEXT.review.trying(step+1):variationActive?TEXT.review.trying(step):TEXT.review.showing(step);
  $("gamePanel").classList.remove("is-scoring","is-finished");
  $("netStatus").textContent=source==="archive"?TEXT.game.savedGames:source==="url"?TEXT.review.sourceUrl:
    isWatching()?TEXT.common.modeWatch:gameMode==="ai"?TEXT.common.modeAi:room?TEXT.review.sourceOnline:TEXT.common.modeLocal;
  // One primary slot: resume the saved game at its end, otherwise start from here.
  $("reviewContinue").textContent=canResumeSelectedReview()||atLiveLatest()?TEXT.review.resume:TEXT.review.continue;
  $("reviewContinue").hidden=isPreview;
  $("actionRow").hidden=true;
  $("endgameBar").hidden=true;
  $("scoreBox").hidden=true;
  $("reviewPanel").hidden=false;$("reviewTools").hidden=false;
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
  if(!boardReview){reviewPrefetch.stop();return;}
  reviewPrefetch.plan(activeReviewSnapshot(boardReview,game),boardReview.step);
}
function pumpPrefetch() {
  if(!boardReview){reviewPrefetch.stop();return;}
  reviewPrefetch.pump();
}
const scoreGraph = createScoreGraph({
  $,
  getReview:()=>boardReview,
  getGame:()=>game,
  isWatching,
  recall:(gameId,board)=>ownershipStore.recall(gameId,board),
  gameId:()=>reviewOwner().gameId,
  setStep:step=>setBoardReviewStep(step),
});
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
  // Stepping back through a watched game pauses it, so the shown line stays put; 再開 carries it on.
  if(source==="live" && isWatching() && game.status==="playing"){
    stopAiTurn();watchPaused=true;intervening=false;watchReturning=false;candidate=null;
  }
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
  try{
    const display=replaySteps(snapshot,step);
    const moved=step!==boardReview.step;
    boardReview.display=display;boardReview.step=step;
    boardReview.preview=null;boardReview.previewPosition=null;
    reviewFeedback("");$("reviewNotice").textContent="";
    show();requestReviewOwnership();
    if(moved && scoreGraphShown() && scoreGraph?.marks.includes(step)){dopa.don();sound.play("don");}
  }catch(error){$("reviewNotice").textContent=TEXT.history.replayFailed;}
}
function clearBoardReview() {
  if(!boardReview)return;
  const wasUrl=boardReview.source==="url";
  boardReview=null;reviewSequence++;
  if(wasUrl)clearImportedReviewUrl();
}
function leaveBoardReview() {
  if(!boardReview)return;
  if(boardReview.activeLine==="variation"){selectOriginalLine();return;}
  clearBoardReview();
  show();requestAnalysis();
  $("stepBack").focus();
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
// A free board has no COM; 五目並べ's COM is a small line counter and needs no KataGo.
function canContinueWithAi(){
  const line=continueFrom?.line||(boardReview?activeReviewSnapshot(boardReview,game):game);
  return !isFree(line) && (isGomoku(line) || katagoReady && !fallbackMode);
}
// 「ここから打つ」 opens the 新規対戦 sheet itself, so continuing offers the same
// choices in the same places. The record fixes the board and rules.
function openContinuePanel(){
  if(!boardReview)return;
  // A 1台 game continues on one board; anything else (AI, friend, SGF, a shared URL) against the AI.
  const live=boardReview.source==="live",record=live?null:boardReview.record;
  const fromLocal=live?!room && gameMode==="local":record?.mode==="local" && record.source==="played";
  continueFrom={step:boardReview.step,line:activeReviewSnapshot(boardReview,game)};
  openPanel(fromLocal || !canContinueWithAi()?"local":"ai");
}
// Greys out what continuing cannot change, or restores the sheet for a new game.
function syncContinueSheet(){
  const line=continueFrom?.line;
  $("modeTitle").textContent=line?TEXT.review.continueTitle(continueFrom.step):TEXT.header.newGame;
  // A friend game and the saved-game list cannot start from a position.
  for(const input of document.querySelectorAll('input[name="newGameMode"]'))
    input.disabled=!!line && (input.value==="online" || input.value==="history" ||
      (input.value==="ai" || input.value==="watch") && !canContinueWithAi());
  if(line){
    for(const [name,value] of [["boardSize",sizeOf(line.board)],["gameRules",rulesOf(line)]])
      for(const input of document.querySelectorAll('input[name="'+name+'"]')){
        input.disabled=true;input.checked=input.value===String(value);
      }
    for(const [row,input] of [["handicapSetup","handicap"],["hideStonesRow","hideStones"],["gomokuForbiddenRow","gomokuForbidden"],
      ["timeControlSetup","mainTime"],["timeControlSetup","byoyomi"]]){
      $(input).disabled=true;$(row).classList.add("is-off");
    }
    // Handicap stones are already on the board or not, so every side stays open.
    for(const input of document.querySelectorAll('input[name="aiSide"]'))input.disabled=false;
    syncSideUi();
  }else{
    for(const input of document.querySelectorAll('input[name="boardSize"],input[name="gameRules"]'))
      input.disabled=input.value==="free" && newGameModeKind()==="ai";
  }
  $("setupTabBoard").classList.toggle("is-unused",!!line);
  $("setupTabRules").classList.toggle("is-unused",!!line);
  syncSetupTabValues();
  syncStartButtons();
}
function forkBoardReview(kind="local") {
  if(!boardReview)return;
  let fork;
  try{fork=forkReview(activeReviewSnapshot(boardReview,game),boardReview.step);}
  catch{$("reviewNotice").textContent=TEXT.review.branchFailed;closePanels();return;}
  const ai=kind==="ai";
  if(ai && !canContinueWithAi())return; // The choice is disabled meanwhile.
  if(room && connected && !confirmByRetap($(ai?"startAi":"startLocal"),TEXT.confirm.leaveForReview))return;
  let side=BLACK;
  if(ai && !watchChoice){
    try{side=selectColor(aiSideChoice);}catch{$("aiMatchStatus").textContent=TEXT.common.retry;return;}
  }
  if(!save())return;
  if(room)leaveOnlineRoom();
  stopAiTurn();gameMode=kind;game=fork;
  // 観戦 lets the two COMs set in the sheet play on from the shown position.
  setWatching(ai && watchChoice);
  if(watching)lastWatchMoveAt=performance.now();
  if(ai)humanColor=side;
  currentGameId=null;currentRevision=null;
  const last=game.moves.at(-1)?.position;
  lastPosition=Number.isInteger(last)?last:null;
  resetPositionState();
  clearImportedReviewUrl();
  clearBoardReview();
  save();closePanels();show();requestAnalysis();
}
/** SGF's PB and PW from a game's names, or null when it has none. */
function namesMetadata(names){
  return names?.black || names?.white?{blackName:names.black,whiteName:names.white}:null;
}
// Everything in the share sheet works on the displayed board: the replayed
// line and step while replaying, otherwise the live game as it stands.
function sharedPosition() {
  if(boardReview)return {...variationForSharing(boardReview,game),
    gameId:boardReview.source==="live" ? currentGameId : boardReview.record?.id ?? null};
  return {snapshot:game,metadata:namesMetadata(recordNames(playersShown())),
    step:game.moves.filter(m=>m.position!=="resign").length,
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
// At the live game's latest move, continuing is just going back to the game.
function atLiveLatest(){
  const review=boardReview;
  return !!(review?.source==="live" && review.activeLine!=="variation" &&
    !review.preview && review.step===game.moves.length);
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
    enterBoardReview(record.snapshot,count,"archive",record.sgfMeta||namesMetadata(record.names),record);
    $("reviewBack").focus();
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
/** A restored game carries on the endgame advice from the estimates kept while it was played. */
function restoreEndgameAdvice(){
  endgameAdvisor.reset();resignWatch.reset();
  if(game.status!=="playing" || isFree(game) || isGomoku(game))return;
  let states=[];
  try{states=replayLine(game);}catch{return;}
  endgameAdvisor.restore(states,state=>ownershipStore.recall(currentGameId,state.board));
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
// ◁ in the live game opens the replay one move back; stepping ▷ onto the
// latest move of the live game leaves it again (setBoardReviewStep).
$("stepBack").onclick=()=>{
  if(boardReview){setBoardReviewStep(boardReview.step-1);return;}
  if(!game.moves.length)return;
  try{enterBoardReview(game,game.moves.length-1,"live",namesMetadata(recordNames(playersShown())));}
  catch{showNotice(TEXT.history.replayFailed);}
};
$("stepForward").onclick=()=>boardReview&&setBoardReviewStep(boardReview.step+1);
$("reviewBack").onclick=leaveBoardReview;
$("reviewStepRange").oninput=e=>setBoardReviewStep(Number(e.target.value));
$("reviewGraph").addEventListener("pointerdown",e=>{
  if(!scoreGraph.shown())return;
  $("reviewGraph").setPointerCapture(e.pointerId);
  scoreGraph.pick(e);
});
$("reviewGraph").addEventListener("pointermove",e=>{
  if($("reviewGraph").hasPointerCapture(e.pointerId))scoreGraph.pick(e);
});
new ResizeObserver(()=>{if(boardReview)scoreGraph.render();}).observe($("reviewGraph"));
$("reviewConfirm").onclick=confirmReviewPreview;
$("reviewCancel").onclick=discardReviewPreview;
$("reviewVariation").onclick=selectVariationLine;
$("reviewSaveVariation").onclick=saveReviewVariation;
document.addEventListener("keydown",e=>{
  if(e.key==="Escape" && boardReview?.preview){discardReviewPreview();return;}
});
$("reviewContinue").onclick=()=>canResumeSelectedReview()?resumeSelectedReview():atLiveLatest()?leaveBoardReview():openContinuePanel();
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
  lastPosition=record.lastPosition;resetPositionState();
  setWatching(gameMode==="ai" && record.watch===true);
  if(gameMode==="ai"){
    restoreAiOptions(record);
    syncStrengthUi();
    // A random preference stays random; a fixed one follows the resumed game.
    watchChoice=watching;
    if(aiSideChoice!=="random" && !watching)aiSideChoice=sideKey(humanColor);
    syncSideUi();
    updatePersonaUi();
  }
  // Who passed is known only once the resumed game's sides are back.
  endExpanded=!!game.endProposal || aiPassAsks();
  try{gameLibrary.setActive(gameMode,currentGameId);}
  catch(error){storageError(error);return;}
  clearBoardReview();rememberSettings();
  closePanels();show();requestAnalysis();
}
$("historyImportFile").onchange=e=>void importHistoryFile(e.target.files?.[0]);
$("openHistory").onclick=openHistoryPanel;
$("openShare").onclick=openSharePanel;
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
  $("helpPanel").hidden=true;
  $("helpToggle").setAttribute("aria-expanded","false");
  closeHelpPopover(false);
  $("historySetup").hidden=$("historyActions").hidden=true;
  $("onlineSetup").hidden=$("onlineStart").hidden=true;
  $("aiSetup").hidden=true;
  $("localSetup").hidden=true;
  $("settingsToggle").setAttribute("aria-expanded","false");
  $("shareToggle").setAttribute("aria-expanded","false");
  $("newGameButton").setAttribute("aria-expanded","false");
  if(continueFrom){continueFrom=null;syncContinueSheet();}
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
$("startAi").onclick=()=>{
  if(continueFrom){forkBoardReview("ai");return;}
  // The button is disabled meanwhile, except for 五目並べ, which needs no KataGo.
  if(gameRules!=="gomoku" && (!katagoReady || fallbackMode))return;
  if(room && connected &&
     !confirmByRetap($("startAi"),TEXT.confirm.leaveForAi))return;
  // 観戦 runs at its own speed, without a clock.
  startAiGame(newGame(true,{...nextGameOptions(aiHandicap),...(watchChoice?{timeControl:null}:{})}),watchChoice,aiSideChoice);
};
/** A new AI game from the empty board `fresh`: watched, or with the human's side drawn from `side`. */
function startAiGame(fresh, watch, side) {
  if(!save())return;
  if(room)leaveOnlineRoom();
  clearBoardReview();
  stopAiTurn();
  gameMode="ai";
  setWatching(watch);
  // The empty board shows for a moment before the first watched move.
  lastWatchMoveAt=performance.now();
  // Handicap stones always belong to the human, who therefore plays Black.
  // Otherwise: the same choices and the same random draw as a friend invitation.
  try{humanColor=watching || fresh.handicap?BLACK:selectColor(side);}
  catch{$("aiMatchStatus").textContent=TEXT.common.retry;return;}
  game=fresh;currentGameId=null;currentRevision=null;lastPosition=null;
  resetPositionState();
  $("aiMatchStatus").textContent=watching?TEXT.ai.watchStarted:TEXT.ai.started(colorLabel(humanColor));
  save();closePanels();show();requestAnalysis();
}
const SIDE_CHOICES=["black","random","white"];
function syncSideUi() {
  const input=document.querySelector('input[name="aiSide"][value="'+aiSideChoice+'"]');
  if(input)input.checked=true;
  const speed=document.querySelector('input[name="watchSpeed"][value="'+watchSpeed+'"]');
  if(speed)speed.checked=true;
}
for (const input of document.querySelectorAll('input[name="aiSide"]')) {
  input.onchange=e=>{
    if(!e.target.checked)return;
    aiSideChoice=SIDE_CHOICES.includes(e.target.value)?e.target.value:"black";
    rememberSettings();syncSideUi();syncStrengthUi();updatePersonaUi();show();
  };
}
// Confirming a stone placed while watching takes that colour over; the COM keeps the other.
function takeOverWatchedGame(color) {
  if(!isWatching() || game.status!=="playing")return;
  stopAiTurn(); // A move being computed for the taken colour is dropped.
  setWatching(false);humanColor=color;
  // The COM left playing keeps its settings.
  aiCom=watchAi[color===BLACK?"white":"black"];
  watchChoice=false;
  if(aiSideChoice!=="random")aiSideChoice=sideKey(color);
  syncSideUi();syncStrengthUi();updatePersonaUi();
  $("aiMatchStatus").textContent=TEXT.ai.tookOver(colorLabel(color));
  save();show();requestAnalysis();
}
$("watchIntervene").onclick=()=>{
  if(!isWatching() || game.status!=="playing" || intervening)return;
  if(!isGomoku(game) && (!katagoReady || fallbackMode))return;
  stopAiTurn(); // The COM's move being computed waits for the viewer's decision.
  intervening=true;watchReturning=false;endExpanded=false;
  show();requestAnalysis();
};
$("watchToggle").onclick=()=>{
  if(!isWatching() || game.status!=="playing")return;
  watchPaused=!watchPaused;
  // 再開 plays the next move straight away.
  if(!watchPaused)lastWatchMoveAt=0;
  show();requestAnalysis();
};
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
  // Choices a rule does not use stay in place, greyed out.
  for(const [row,input,off] of [["handicapSetup","handicap",gameRules==="gomoku" || gameRules==="free"],
    ["hideStonesRow","hideStones",gameRules==="free"],["gomokuForbiddenRow","gomokuForbidden",gameRules!=="gomoku"]]){
    $(input).disabled=off;$(row).classList.toggle("is-off",off);
  }
  const untimed=untimedRules(kind);
  for(const input of ["mainTime","byoyomi"])$(input).disabled=untimed;
  $("timeControlSetup").classList.toggle("is-off",untimed);
  $("handicap").value=String(shown);
  // The note only appears when stones are placed, so an even game shows no extra text.
  $("handicapNote").hidden=!shown || gameRules==="gomoku" || gameRules==="free";
  // What komi is: the even-game value, or the handicap one when stones are placed.
  const go=gameRules==="chinese" || gameRules==="japanese";
  $("komiNote").hidden=!go;
  if(go)$("komiNote").textContent=shown?TEXT.newGame.komiNoteHandicap(HANDICAP_KOMI,gameRules==="japanese"):
    TEXT.newGame.komiNote(RULES_KOMI[gameRules]);
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
  syncSetupValues();
  syncContinueSheet();
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
// A change to a COM applies from its next move.
function comChanged(label) {
  syncStrengthUi();
  if(isWatching() || gameMode==="ai" && !editsWatchAi())save();else rememberSettings();
  $("aiMatchStatus").textContent=label?TEXT.ai.nextCharacter(label):TEXT.ai.nextMove;
}
for(const [slot,side] of Object.entries(COM_SLOTS)){
  $("com"+slot+"Character").onchange=e=>{
    watchAi[side]=pickCharacter(watchAi[side],e.target.value);
    comChanged();
  };
  for(const [field,key] of Object.entries(COM_FIELDS))
  for(const input of document.querySelectorAll('input[name="com'+slot+field+'"]'))
    input.onchange=e=>{
      if(!e.target.checked)return;
      watchAi[side]=setComValue(watchAi[side],key,e.target.value);
      comChanged();
    };
}
for(const input of document.querySelectorAll('input[name="aiCharacter"]')) {
  input.onchange=e=>{
    if(!e.target.checked)return;
    aiCom=pickCharacter(aiCom,e.target.value);
    comChanged(characterLabel(aiCom.character));
  };
}
for(const [field,key] of Object.entries(COM_FIELDS))
for(const input of document.querySelectorAll('input[name="ai'+field+'"]')) {
  input.onchange=e=>{
    if(!e.target.checked)return;
    aiCom=setComValue(aiCom,key,e.target.value);
    comChanged();
  };
}
// The character list shows the one COM; two COMs are set in their cards.
function syncStrengthUi() {
  const two=editsWatchAi(),off=newGameModeKind()!=="ai" || two;
  const input=document.querySelector('input[name="aiCharacter"][value="'+aiCom.character+'"]');
  if(input)input.checked=true;
  $("aiCharacterChoices").disabled=$("aiCustom").disabled=off;
  // One COM's line names its strength and the style it leans on, which カスタム's rows already show.
  $("aiStrengthNote").textContent=newGameModeKind()!=="ai" || two || aiCom.character===CUSTOM_CHARACTER?"":comSummary(aiCom);
  updatePersonaUi();
  syncSetupValues();
}
$("copy").onclick=copyLink;
$("inviteUrl").onclick=e=>e.currentTarget.select();
$("nativeShare").onclick=async()=>{
  const link=showInviteLink();
  if(!link||typeof navigator.share!=="function")return;
  try{await navigator.share({title:TEXT.online.shareTitle,url:link});}
  catch(error){if(error.name!=="AbortError")$("inviteStatus").textContent=TEXT.online.shareFailed;}
};
for(const input of document.querySelectorAll('input[name="onlineSide"]'))input.onchange=()=>{renderInviteButton();syncSetupValues();};
// The next game's "石を隠す" is read even in a room, where the other
// remembered choices are not, so leaving the room does not forget it.
try{hideStonesChoice=readSettings(localStorage)?.hideStones===true;}catch{}
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
    if(prior){
      currentGameId=prior.id;currentRevision=prior.revision;
      // Until the friend's device sends its 表示名 again, the one kept with the game stands.
      const theirs=myOnlineColor()===BLACK?prior.names?.white:prior.names?.black;
      peerName=cleanName(theirs);
    }
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
  const settings=readSettings(localStorage);
  if(settings){
    gameMode=settings.mode==="ai"?"ai":"local";
    humanColor=settings.humanColor===WHITE?WHITE:BLACK;
    // Older settings stored only the resolved color.
    aiSideChoice=SIDE_CHOICES.includes(settings.aiSide)?settings.aiSide:
      sideKey(humanColor);
    // Settings from before 観戦 was a mode kept it as a side choice.
    watchChoice=settings.watch===true || settings.aiSide==="watch";
    watchSpeed=toWatchSpeed(settings.watchSpeed);
    aiHandicap=toHandicap(settings.aiHandicap);
    localHandicap=toHandicap(settings.localHandicap);
    onlineHandicap=toHandicap(settings.onlineHandicap);
    boardSize=toBoardSize(settings.boardSize);
    gameRules=toRules(settings.gameRules);
    gomokuForbiddenChoice=settings.gomokuForbidden===true;
    mainTimeChoice=toSeconds(settings.mainTime,MAIN_TIME_CHOICES);
    byoyomiChoice=toSeconds(settings.byoyomi,BYOYOMI_CHOICES);
    freeColor=colorOf(settings.freeColor);
    ({aiHandicap,localHandicap,onlineHandicap}=capHandicaps({aiHandicap,localHandicap,onlineHandicap},boardSize));
    // Settings from before characters kept strength, 侵入度 and 補強度 on their own.
    aiCom=newCom(settings.aiCom ?? {strength:settings.aiStrength,invasion:settings.invasion,
      reinforcement:settings.reinforcement});
    watchAi=readWatchAi(settings.watchAi,aiCom);
  }
  game=savedGame(gameMode);restoreEndgameAdvice();endExpanded=!!game.endProposal || aiPassAsks();
}catch{}
syncSideUi();
updatePersonaUi();syncStrengthUi();syncHandicapUi();
appearance.syncControls();
$("hideStones").checked=hideStonesChoice;
$("gomokuForbidden").checked=gomokuForbiddenChoice;
$("mainTime").value=String(mainTimeChoice);
$("byoyomi").value=String(byoyomiChoice);
if(!room && currentGameId===null)save();
if(!room && params.has("sgf")){
  try{
    const imported=readReviewUrl(location.href);
    if(imported.kind==="review")
      enterBoardReview(imported.snapshot,imported.step,"url",imported.metadata);
  }catch(error){
    showNotice(TEXT.history.sharedLoadFailed);
  }
}
compactOwnership();
// An unfinished friend game is offered when the page opens on something else.
const resumeRoom=room?null:resumableRoom();
$("friendResume").hidden=!resumeRoom;
$("friendResumeOpen").onclick=()=>openFriendRoom(resumeRoom);
$("friendResumeClose").onclick=()=>{
  try{localStorage.setItem(RESUME_DISMISSED_KEY,resumeRoom);}catch{}
  $("friendResume").hidden=true;
};
show();requestAnalysis();
