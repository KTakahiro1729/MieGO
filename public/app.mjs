import { BLACK, WHITE, BOARD_SIZES, sizeOf, maxHandicap, newGame, play, toggleDead, resume, agreeScore, beginSoloScoring, finalizeSoloScore, boardHash, handicapOf, komiOf, proposeEnd, answerEndProposal, setDeadCandidates } from "./core.mjs";
import { suggestDeadStones } from "./dead-stones.mjs";
import { EndgameAdvisor, endgameHint } from "./endgame.mjs";
import { copyInviteText } from "./invite.mjs";
import { ROOM_PATTERN, selectColor, playerColor, colorLabel, guestUrl, ownUrl, readCheckpoint, saveCheckpoint, reconcileGame } from "./p2p-session.mjs";
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
import { resultLabel, resultWinner } from "./result-label.mjs";
import { influence } from "./influence.mjs";
import { createHistoryPanel } from "./history-panel.mjs";
import { navigationState } from "./history-navigation.mjs";
import { makeReviewUrl, readReviewUrl, makeAiHandoff } from "./sgf-link.mjs";
import { makeRulesPrompt, makePositionPrompt } from "./beginner-prompts.mjs";
import { activeReviewSnapshot, proposeReviewStone, commitReviewStone, variationForSharing } from "./review-variation.mjs";
import { canApproveScoring, canApplyAutomatedReview, deadSignature } from "./scoring-flow.mjs";
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
  worker.onmessage = handleAnalysis;
  worker.onerror = e => { $("analysisStatus").textContent = "解析を利用できません"; console.error(e); };
  if (gameMode === "ai") $("aiMatchStatus").textContent = "KataGoが利用できません。対AI戦は開始・続行できません。";
  show();
  requestAnalysis();
}
worker.onerror = e => switchToFallback(e.message || "worker startup error");
const params = new URLSearchParams(location.search);
let room = params.get("room"), seat = room ? null : "host";
const inviteFragment=new URLSearchParams(location.hash.slice(1));
let p2pRole=inviteFragment.get("role")==="guest"?"guest":"owner";
let inviteKey=inviteFragment.get("key");
let ownerColor=null,onlineSession=null,guestInviteKey=null,issuedSide=null,onlineRevision=0;
let p2pTransport;
const myOnlineColor=()=>ownerColor===null?null:playerColor(p2pRole,ownerColor);
const currentSideSelection=()=>document.querySelector('input[name="onlineSide"]:checked')?.value||"random";
// Before play starts, a changed side, board size or handicap calls for a new invitation.
const inviteMatchesChoice=()=>issuedSide===currentSideSelection() &&
  (connected || game.moveNumber>0 || (sizeOf(game.board)===boardSize && handicapOf(game)===onlineHandicap));
function renderInviteButton() {
  $("copy").disabled=!!room && p2pRole!=="owner";
  $("copy").textContent=!room?"招待リンクを準備する":
    issuedSide!==null && !inviteMatchesChoice()?
      "新しい設定で招待リンクを作り直す":"招待リンクをコピー";
}
function persistOnline(){
  if(!room || !ROOM_PATTERN.test(room))return;
  if(!saveCheckpoint(localStorage,room,{role:p2pRole,ownerColor,session:onlineSession,
    inviteKey,guestInviteKey,issuedSide,revision:onlineRevision,game,lastPosition}))
    storageError(Error("再接続用の局面を保存できません"));
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
const gameLibrary=new GameLibrary(localStorage);
let currentGameId=null,currentRevision=null;
const historyPanel=createHistoryPanel({$,gameLibrary,storageError,onSelect:openSavedBoard,getBoardTheme:()=>boardTheme});
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
  $("saveStatus").textContent="棋譜を保存できませんでした。容量や別のタブを確認してください。";
  $("historySaveNotice").textContent=error?.message||"保存に失敗しました";
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
    $("endStatus").textContent=asked?"待ったの申し出があります":"待ったの返答を待っています";
    $("endPropose").hidden=true;
    $("endAccept").hidden=!asked;
    $("endDecline").hidden=false;
    $("endAccept").textContent="受け入れる";
    $("endDecline").textContent=asked?"断る":"取り下げる";
    for(const id of ["endPropose","endAccept","endDecline"])
      $(id).disabled=!connected || color===null;
    $("endDetail").textContent=asked?"受け入れると相手の直前の手まで戻ります。":
      "相手が受け入れると、あなたの直前の手まで戻ります。";
    return;
  }
  const incoming=!!(offer && room && color!==null && offer.from!==color);
  const localPrompt=playing && !room && endExpanded && !offer;
  const waiting=!!(offer && !incoming);
  const offline=!!room && (!connected || color===null);
  $("endStatus").textContent=!playing?"":offline?"接続を待っています":
    incoming?"終局が提案されました":
    waiting?"相手の返答を待っています":
    localPrompt?"採点を始めますか？":
    endgameHint(game,endgameAdvisor,{
      unavailable:fallbackMode,suppressedUntil:endHintSuppressedUntil
    });
  $("endPropose").hidden=!playing||!!offer||localPrompt;
  $("endAccept").hidden=!playing||!(incoming||localPrompt);
  $("endDecline").hidden=!playing||!(incoming||localPrompt||waiting);
  $("endPropose").textContent=!room?"採点を始める":"終局を提案";
  $("endAccept").textContent=!room?"採点へ進む":"受け入れる";
  $("endDecline").textContent=waiting?"取り下げる":"打ち続ける";
  for(const id of ["endPropose","endAccept","endDecline"])
    $(id).disabled=offline;
  // A move being computed is about to arrive; scoring waits for it instead of pausing the AI.
  if(aiThinking)$("endPropose").disabled=true;
  // Answering an opponent's offer is a negotiation: neither choice is emphasized.
  $("endAccept").classList.toggle("primary",!room);
  $("actionRow").classList.toggle("end-prompt-open",localPrompt);
  $("endDetail").textContent=incoming?"受け入れると採点に進みます。打ち続けることもできます。":
    localPrompt?(gameMode==="ai"?"あなたの判断で採点へ進みます。AIが終局を承認するわけではありません。":
      "採点に進み、死石を確認します。対局の再開もできます。"):
    waiting?"相手の返答待ちです。提案は取り下げられます。":
    room?"終局はいつでも提案できます。提案はパスと異なります。":
    "採点はいつでも始められます。パスとは別の操作です。";
  if(playing && !offer && !localPrompt && takebackNotice?.number===game.moveNumber &&
     takebackNotice.hash===boardHash(game.board))
    $("endStatus").textContent=takebackNotice.text;
  // The stable left-hand status slot doubles as a rule explanation for illegal previews.
  $("endHelp").dataset.help=playing && illegalCandidate?"illegal":"endgame";
  if(playing && illegalCandidate){
    $("endStatus").textContent=illegalCandidate.reason===ILLEGAL_KO?
      "コウのため打てません":"自殺手なので打てません";
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
const personaLabel=value=>value<50?"控える":value>50?"重視":"ふつう";
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
    worker.postMessage({id,kind:"scoring",state:game});
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
      $("analysisStatus").textContent = "KataGoを利用できないためAI対局は停止しました";
      $("aiMatchStatus").textContent = "KataGoが利用できません。対AI戦は続行できません。";
      show();return;
    }
    if (!katagoReady) {
      $("analysisStatus").textContent = "KataGoを起動中…";
      $("aiMatchStatus").textContent = "KataGoの読み込みが終わるまで待機しています。";
      show();return;
    }
    const id = ++seq;
    pending=id;
    aiThinking=true;
    aiJob={id,number:game.moveNumber,hash:boardHash(game.board)};
    $("analysisStatus").textContent = "KataGoが次の手を計算中…";
    $("aiMatchStatus").textContent = "KataGoが着手を計算中…";
    worker.postMessage({id,kind:"move",state:game});
    show();return;
  }
  pending=++seq;
  if(!overlayOn()) {
    analysis=null;
    if(transitionFrame!==null)cancelAnimationFrame(transitionFrame);
    transitionFrame=null; displayedOwnership=null;
    $("analysisStatus").textContent="地合いの表示オフ";
    draw();
    // Endgame evaluation runs independently of the ownership overlay.
    // Avoid evaluating every preview tap when the overlay is disabled.
    if(candidate || fallbackMode)return;
  }
  const state=overlayOn()?(candidate || game):game, id=pending;
  analysisContext={id,number:state.moveNumber,hash:boardHash(state.board),committed:!candidate};
  if(overlayOn())$("analysisStatus").textContent=fallbackMode?"簡易表示を更新中…":"地合いを更新中…";
  analysisTimer=setTimeout(()=>worker.postMessage({id,state,board:state.board}),180);
}
function finishAiMove(result) {
  const job=aiJob;
  if(!job || job.id!==result.id)return;
  aiThinking=false;aiJob=null;
  if(!isAiTurn() || game.moveNumber!==job.number || boardHash(game.board)!==job.hash)return;
  // Discard an in-flight move while the human is deciding whether to score.
  if(endExpanded)return;
  if(result.engine!=="katago") {
    switchToFallback("KataGo以外の着手応答");
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
    $("aiMatchStatus").textContent = "強さ「"+AI_STRENGTHS[aiStrength].label+"」・侵入度「"+personaLabel(invasion)+
      "」・補強度「"+personaLabel(reinforcement)+"」で対局中（探索なし）";
    submitMove(next,true);
  } catch(error) {
    switchToFallback(error instanceof Error?error.message:String(error));
  }
}
function handleAnalysis(event) {
  const result=event.data;
  if(boardReview && result.id!==undefined && result.id===boardReview.katagoId) {
    const state=boardReview.preview||boardReview.display;
    if(!result.error && result.engine==="katago" && Array.isArray(result.ownership) &&
       result.ownership.length===state.board.length) {
      boardReview.ownership=result.ownership;
      draw();
    }
    return;
  }
  if(result.kind==="availability") {
    if(fallbackMode)return;
    if(result.available) {
      katagoReady=true;
      $("aiMatchStatus").textContent="KataGo準備完了。AI対局を開始できます。";
      show();
      if(isAiTurn() || (game.status==="scoring" && ["idle","loading"].includes(deadReview)))
        requestAnalysis();
    } else {
      switchToFallback(result.error || "KataGo初期化に失敗しました");
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
    ?"地合いを表示中 · KataGoによる試験的推定"
    :"地合いを表示中 · 簡易影響モデル";
  transitionOwnership(result.ownership);
}
worker.onmessage=handleAnalysis;
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
  $("startAi").textContent=fallbackMode?"KataGoが利用できません":
    !katagoReady?"KataGo準備中…":gameMode==="ai"?"設定して再戦":"AIと対局を始める";
  $("aiInvasion").disabled=false;
  $("aiReinforcement").disabled=false;
  $("turn").classList.toggle("white-to-play",game.next===WHITE);
  // Nobody is to move while scoring or after the game, so no turn stone.
  $("turn").classList.toggle("no-stone",game.status!=="playing");
  $("turn").textContent=game.status==="finished"?"対局終了":
    game.status==="scoring"?"採点中":
    room?(connected?(myTurn?"あなたの番":"相手の番"):"対局相手を待っています"):
    gameMode==="ai"?(fallbackMode?"AI対局を停止しました":!katagoReady?"AIを準備中…":
      isAiTurn()?"AIの番です":"あなたの番です"):
    (game.next===BLACK?"黒の番です":"白の番です");
  if(!room)$("netStatus").textContent=gameMode==="ai"?"AIと対戦":"1台で打つ";
  $("netStatus").classList.toggle("online",connected);
  $("moveLabel").textContent=game.moveNumber+"手目 ‹ ›";
  $("hint").textContent=illegalCandidate?"禁止手の仮置き中。確定せず、理由を質問する文をコピーできます":
    candidate?"仮置き中。確定か取り消しを選べます":
    game.status==="scoring"?"盤上の石をタップすると死石を指定できます":
    gameMode==="ai" && fallbackMode?"KataGoを利用できないためAI対局は停止中":
    gameMode==="ai" && !katagoReady?"KataGoの準備ができるまで待機中":
    isAiTurn()?"AIが着手を計算しています":"";
  const blocked=!!illegalCandidate;
  $("confirm").disabled=!candidate || !myTurn || blocked;
  $("confirm").hidden=blocked;
  // The stone on the button shows the colour that will be placed.
  $("confirmStone").classList.toggle("white",game.next===WHITE);
  $("copyIllegalPrompt").hidden=!blocked;
  $("copyIllegalPrompt").textContent=illegalPromptCopied?"コピーしました":"AIへの質問をコピー";
  // With a provisional stone the button discards it; otherwise it is 待った.
  const provisional=!!candidate || blocked;
  const takeBack=!provisional && canTakeBack();
  $("cancel").classList.toggle("is-takeback",!provisional);
  $("cancel").disabled=!provisional && !takeBack;
  const cancelLabel=provisional?"仮置きを戻す":
    room?"待った：相手の了承を得て、自分の直前の手まで戻す":
    gameMode==="ai"?"待った：自分の直前の手まで戻す":"待った：直前の1手を戻す";
  $("cancel").setAttribute("aria-label",cancelLabel);
  $("cancel").title=cancelLabel;
  $("endgameBar").classList.toggle("has-illegal",blocked);
  $("pass").disabled=!myTurn || game.status!=="playing";
  $("resign").disabled=!myTurn || game.status!=="playing";
  $("openCurrentMode").hidden=!room && gameMode!=="ai";
  $("openCurrentMode").textContent=room?"招待URLを表示":"AIの設定・再戦";
  updateGradient();
  const handicap=handicapOf(game),size=sizeOf(game.board);
  canvas.setAttribute("aria-label",shownSize()+"路盤。交点を選ぶと石を仮置きできます。2本の指で広げると拡大できます。");
  $("ruleSummary").textContent=size+"路盤 · 中国式ルール · "+(handicap?
    "置き石"+handicap+"子 · コミ"+komiOf(game)+"＋置き石補正"+handicap+"目":"コミ"+komiOf(game));
  const isScoring=game.status==="scoring",isFinished=game.status==="finished";
  $("gamePanel").classList.toggle("is-scoring",isScoring);
  $("gamePanel").classList.toggle("is-finished",isFinished);
  $("endgameBar").classList.toggle("is-scoring",isScoring);
  $("endgameBar").classList.toggle("is-finished",isFinished);
  $("scoreBox").classList.toggle("hidden",!isScoring && !isFinished);
  $("endgameBar").hidden=isScoring || isFinished;
  $("resign").hidden=isScoring || isFinished;
  $("newMatch").hidden=!isFinished;
  $("newMatch").textContent=room?"新しい対局":"もう一局";
  $("openHistory").hidden=!isFinished;
  if(isScoring)$("analysisStatus").textContent="死石を確認";
  if(isFinished)$("analysisStatus").textContent="";
  $("scoringActions").hidden=!isScoring;
  for(const id of ["cancel","pass"])$(id).hidden=isScoring || isFinished;
  $("confirm").hidden=isScoring || isFinished || blocked;
  $("copyIllegalPrompt").hidden=isScoring || isFinished || !blocked;
  $("actionRow").classList.toggle("finished-actions",isFinished);
  $("scoreBox").querySelector("strong").textContent=isFinished?"対局結果":"死石を確認";
  $("scoreInstruction").textContent=isFinished?
    (game.result?.endsWith("+R")?"対局終了":"中国式で採点確定"):
    deadReview==="pending"?"死石を自動判定中…":
    deadReview==="loading"?"KataGoを準備中。石の手動指定もできます":
    deadReview==="awaiting"?"相手側で死石を判定中…":
    deadReview==="complete"?"数字は石＋地。死石はタップで修正":
    deadReview==="none"?"数字は石＋地。必要なら石をタップ":
    deadReview==="modified"?"数字は石＋地。点数を確認してください":
    deadReview==="unavailable"?"AI判定不可。石をタップして指定":
    "死石を確認しています…";
  // The scoring controls live in the existing sticky action row.
  $("scoreStone").className="score-stone";
  $("scoreText").hidden=false;
  if(isScoring){
    renderScoreboard();
    const ready=canApproveScoring(game,deadReview,room,connected);
    $("agree").disabled=!ready;
    const agreeing=room?(myOnlineColor()===WHITE?"white":"black"):
      gameMode==="ai"?(humanColor===BLACK?"black":"white"):"black";
    $("agree").textContent=game.agreed[agreeing]?"確認済み · 相手待ち":
      ready?"この計算に同意":"死石判定を待っています";
    if(game.agreed[agreeing])$("agree").disabled=true;
    $("resume").disabled=room&&!connected;
  }
  if(isFinished) {
    const result=game.result;
    $("scoreBox").querySelector("strong").textContent=resultLabel(result)||"終局";
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
    const wasScoring=game.status==="scoring";
    if(action.type==="move"){
      if(action.number!==game.moveNumber+1) throw new Error("手順が一致しません");
      if(action.before!==boardHash(game.board)) throw new Error("盤面が一致しません");
      game=play(game,action.position);
      if(action.after!==boardHash(game.board)) throw new Error("局面の検証に失敗しました");
      lastPosition=Number.isInteger(action.position)?action.position:null;
    } else if(action.type==="solo_scoring") {
      if(room || remote || action.number!==game.moveNumber ||
         action.before!==boardHash(game.board))
        throw new Error("採点を開始できません");
      stopAiTurn(); // Invalidate pending AI workers on the old position.
      game=beginSoloScoring(game);
      endExpanded=false;
    } else if(action.type==="solo_score") {
      if(room || remote || !canApproveScoring(game,deadReview,room,connected))
        throw new Error("採点を確定できません");
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
        if(!remote)throw new Error("死石判定が終わってから採点を確定してください");
        return;
      }
      game=agreeScore(game,action.color);
    }
    else if(action.type==="resume") game=resume(game);
    // "mode" (the removed per-game overlay switch) from older peers is ignored below.
    else if(action.type==="end_offer") {
      if(action.number!==game.moveNumber || action.before!==boardHash(game.board))
        throw new Error("終局の提案時点が一致しません");
      game=proposeEnd(game,action.color);
      if(remote)endExpanded=false;
    } else if(action.type==="end_answer") {
      if(action.number!==game.moveNumber || action.before!==boardHash(game.board) ||
         action.proposalFrom!==game.endProposal?.from)
        throw new Error("終局の返答時点が一致しません");
      game=answerEndProposal(game,action.color,Boolean(action.accept));
      if(!action.accept)endHintSuppressedUntil=game.moveNumber+4;
      endExpanded=false;
    } else if(action.type==="takeback_request") {
      if(action.number!==game.moveNumber || action.before!==boardHash(game.board))
        throw new Error("待ったの申し出時点が一致しません");
      game=requestTakeback(game,action.color);
      endExpanded=false;
    } else if(action.type==="takeback_answer") {
      if(action.number!==game.moveNumber || action.before!==boardHash(game.board) ||
         action.proposalFrom!==game.takebackRequest?.from)
        throw new Error("待ったの返答時点が一致しません");
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
  }catch(error){showNotice(error.message); if(remote){$("netStatus").textContent="同期エラー";p2pTransport.refresh();}}
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
const MANUAL_COPY="自動でコピーできませんでした。下の文章を選択してコピーしてください。";
async function writeClipboard(text) {
  if(typeof navigator.clipboard?.writeText!=="function")throw Error("Clipboard API unavailable");
  await navigator.clipboard.writeText(text);
}
async function copyWithFallback(text,status,field,copied="コピーしました。") {
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
    $("endStatus").textContent="棋譜URLを作れません："+error.message;
    return;
  }
  try{
    await writeClipboard(question);
    if(illegalCandidate===selected){
      illegalPromptCopied=true;
      $("copyIllegalPrompt").textContent="コピーしました";
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
let resignArmed=false;
function resetResignButton() {
  resignArmed=false;
  $("resign").textContent="投了";
  $("resign").setAttribute("aria-label","投了する。確認のため二度押し");
  $("resign").classList.remove("danger-armed");
}
$("resign").onclick=()=>{
  if(!resignArmed){
    resignArmed=true;
    // Name the action: a bare "確定" reads like the adjacent move confirmation.
    $("resign").textContent="投了？";
    $("resign").setAttribute("aria-label","もう一度押すと投了します");
    $("resign").classList.add("danger-armed");
    return;
  }
  resetResignButton();submitMove("resign");
};
function resetArmedButtons(){resetResignButton();}
document.addEventListener("pointerdown",e=>{
  if(resignArmed && e.target!==$("resign"))resetResignButton();
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
    text:"待った："+game.moveNumber+"手目に戻しました"};
}
function takeBackMove() {
  const undone=takeBack(game,takebackOptions());
  if(!undone)return;
  stopAiTurn();
  game=undone.game;afterTakeback();
  if(gameMode==="ai")$("aiMatchStatus").textContent="待ったをしました。";
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
    !confirm("友人との対局から離れて、1台で新しい対局を始めますか？"))return;
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
    row.append(cell("score-stone "+color,""),cell("score-name",color==="black"?"黒":"白"),
      cell("score-detail",rows[color].detail),cell("score-total",String(rows[color].total)));
    return row;
  }));
  $("scoreText").setAttribute("aria-label",scoreBreakdown(game).replace("\n","、"));
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
  history.replaceState(null,"",oldUrl.pathname+oldUrl.search);
  $("inviteDetails").classList.add("hidden");
  $("inviteStatus").textContent="";
  $("roomInfo").textContent="";
}
/** Resume the unfinished saved game of another offline mode (1台 or AI). */
function resumeModeGame(mode) {
  resetArmedButtons();
  if(room && connected &&
    !confirm("友人との対局から離れて、"+(mode==="ai"?"AIとの対局":"1台の対局")+"に戻りますか？"))return;
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
    return {mode:null,label:"現在の対局に戻る"};
  if(kind==="online")return null; // friend rooms reopen from the saved games
  let record=null;
  try{record=gameLibrary.active(kind);}catch{}
  if(!record || record.snapshot.status==="finished")return null;
  return {mode:kind,label:kind==="ai"?"途中のAI対局に戻る":"途中の1台の対局に戻る"};
}
function syncReturnButton(kind) {
  const target=returnTarget(kind);
  $("returnToGame").hidden=!target;
  if(target)$("returnToGame").textContent=target.label;
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
  if(!config.siteKey)throw Error("CloudflareのTurnstile設定が必要です");
  if(!window.turnstile){
    await new Promise((resolve,reject)=>{
      const script=document.createElement("script");
      script.src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.onload=resolve;script.onerror=()=>reject(Error("本人確認を読み込めません"));
      document.head.append(script);
    });
  }
  return new Promise((resolve,reject)=>{
    $("p2pTurnstile").replaceChildren();
    window.turnstile.render($("p2pTurnstile"),{sitekey:config.siteKey,action:"miego_p2p",
      callback:resolve,"error-callback":()=>reject(Error("本人確認に失敗しました")),
      "expired-callback":()=>reject(Error("本人確認の期限が切れました"))});
  });
}
function onPeerSync(message){
  const result=reconcileGame(game,onlineRevision,message.game,message.revision,
    {localIsOwner:p2pRole==="owner"});
  if(result.kind==="conflict"||result.kind==="invalid"){
    connected=false;$("netStatus").textContent="局面が一致しません。自動上書きを停止しました";
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
  connected=true;$("netStatus").textContent="P2P接続中";show();return true;
}
p2pTransport=createP2PTransport({
  verify:verifyP2P,
  onSession:({session,ownerColor:chosen,role})=>{
    onlineSession=session;p2pRole=role;ownerColor=chosen==="black"?BLACK:WHITE;
    seat=role==="owner"?"host":"guest";persistOnline();show();
  },
  onSync:onPeerSync,
  onAction:action=>apply(action,true),
  onConnected:()=>{connected=true;$("netStatus").textContent="P2P接続中";show();},
  onDisconnected:message=>{connected=false;$("netStatus").textContent=message;show();},
  onError:error=>{$("netStatus").textContent=error.message||"接続エラー";console.warn("P2P",error);show();},
  getSnapshot:()=>({game,revision:onlineRevision,lastPosition,
    scoringReview:game.status==="scoring" &&
    ["complete","none","modified","unavailable"].includes(deadReview)?deadReview:null})
});
async function joinRoom(){
  if(!ROOM_PATTERN.test(room)){$("netStatus").textContent="招待URLが無効です";return;}
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
  $("roomInfo").textContent="あなたは"+colorLabel(ownerColor)+"です。相手に招待URLを送ってください。";
  $("nativeShare").classList.toggle("hidden",typeof navigator.share!=="function");
  renderInviteButton();return url;
}
async function beginOnlineRoom(){
  const choice=currentSideSelection();
  if(room&&p2pRole!=="owner")throw Error("作成者だけが招待を更新できます");
  if(room&&inviteMatchesChoice())return showInviteLink();
  if(room&&(connected||game.moveNumber>0))throw Error("対局開始後は設定を変更できません");
  if(room&&!confirm("古い招待URLを無効化して、新しい設定で作り直しますか？"))return null;
  if(!room && game.moveNumber>0 &&
     !confirm("現在の対局を離れて、友人と新しく対局しますか？"))return null;
  const color=selectColor(choice),token=await verifyP2P();
  const created=await p2pTransport.post("/api/rooms",
    {color:color===BLACK?"black":"white",turnstileToken:token});
  if(room){
    try{await p2pTransport.post("/api/rooms/"+room+"/revoke",{role:"owner",session:onlineSession});}
    catch(error){$("inviteStatus").textContent="古い招待の無効化に失敗しました。";throw error;}
    leaveOnlineRoom();
  }else if(!save())return null;
  room=created.room;p2pRole="owner";seat="host";ownerColor=color;
  onlineSession=created.ownerSession;inviteKey=created.ownerKey;
  guestInviteKey=created.guestKey;issuedSide=choice;onlineRevision=0;
  clearBoardReview();
  gameMode="online";stopAiTurn();
  game=newGame(true,{handicap:onlineHandicap,size:boardSize});candidate=null;lastPosition=null;
  currentGameId=null;currentRevision=null;
  deadReview="idle";deadReviewTouched=false;deadEvaluation=null;
  endgameAdvisor.reset();endgameStage="playing";endExpanded=false;lastOfferKey=null;
  history.replaceState(null,"",ownUrl(location.origin,room,inviteKey));
  save();show();requestAnalysis();
  void joinRoom();return showInviteLink();
}
async function copyLink(){
  try{
    if(!room||(issuedSide!==null&&!inviteMatchesChoice())){
      $("copy").disabled=true;
      const url=await beginOnlineRoom();
      if(url)$("inviteStatus").textContent="招待を準備しました。もう一度押すとコピーできます。";
      return;
    }
    const url=showInviteLink();
    if(!url)throw Error("招待リンクを表示できません");
    const copied=await copyInviteText(url,{clipboard:navigator.clipboard,input:$("inviteUrl"),document});
    $("inviteStatus").textContent=copied?"招待URLをコピーしました。":"URLを選択して手動でコピーしてください。";
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
    $("reviewNotice").textContent=result.created?"変化図を作成しました。元棋譜は変更されません。":"";
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
    reviewFeedback("パスを仮置き中");show();requestReviewOwnership();
  }catch(error){reviewFeedback(error.message);}
}
function saveReviewVariation(){
  if(!boardReview?.variation)return;
  try{
    gameLibrary.save({mode:"local",snapshot:boardReview.variation.snapshot,source:"variation"});
    $("reviewNotice").textContent="変化図を保存した棋譜に追加しました。";
  }catch(error){$("reviewNotice").textContent="変化図を保存できません："+error.message;}
}
function renderBoardReview() {
  if(!boardReview)return;
  // The live match may advance over WebRTC or AI while the chosen step stays fixed.
  if(boardReview.source==="live")boardReview.snapshot=game;
  const {step,source}=boardReview;
  const line=activeReviewSnapshot(boardReview,game),count=line.moves.length;
  const variationActive=boardReview.activeLine==="variation" && !!boardReview.variation;
  const isPreview=!!boardReview.preview;
  $("reviewTitle").textContent=variationActive?"変化図を確認中":source==="url"?"共有棋譜を確認中":"棋譜を確認中";
  $("reviewStepText").textContent=step+" / "+count+"手";
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
  $("reviewNewMoves").textContent=updates>0?"新着 +"+updates:"";
  $("moveLabel").textContent=(variationActive?"変化図 ":"")+step+" / "+count+"手";
  $("moveLabel").setAttribute("aria-label","棋譜再生を終了する");
  $("turn").classList.toggle("white-to-play",boardReview.display.next===WHITE);
  $("turn").classList.remove("no-stone");
  $("turn").textContent=isPreview?"仮置き中":variationActive?"変化図":"棋譜を確認中";
  $("gamePanel").classList.remove("is-scoring","is-finished");
  $("netStatus").textContent=source==="archive"?"保存した棋譜":source==="url"?"共有棋譜":
    gameMode==="ai"?"AIと対戦":room?"URLで対戦":"1台で打つ";
  $("reviewResume").hidden=!canResumeSelectedReview();
  $("reviewBack").textContent=variationActive?"元棋譜":source==="live"?"最新に戻る":"対局に戻る";
  $("actionRow").hidden=true;
  $("endgameBar").hidden=true;
  $("scoreBox").hidden=true;
  $("reviewPanel").hidden=false;
  draw();
}
// A replayed position shows the same KataGo estimate as during play: the one
// kept for it then, or a fresh KataGo evaluation. The simple influence model
// is only the fallback when KataGo is unavailable.
function requestReviewOwnership() {
  if(!boardReview)return;
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
    worker.postMessage({id:boardReview.katagoId,state,board:state.board});
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
      $("reviewNotice").textContent="過去局面の地合い推定を表示できません。";
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
  }catch(error){$("reviewNotice").textContent="棋譜を再生できません："+error.message;}
}
function clearBoardReview() {
  if(!boardReview)return;
  const wasUrl=boardReview.source==="url";
  boardReview=null;reviewSequence++;
  if(wasUrl)clearImportedReviewUrl();
  $("moveLabel").setAttribute("aria-label","棋譜を再生する");
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
  catch(error){$("reviewNotice").textContent="この局面から検討できません："+error.message;return;}
  if(room && connected && !confirm("友人との対局から離れて、この局面を1台で検討しますか？"))return;
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
  }catch(error){$("shareNotice").textContent="共有URLを作れません："+error.message;}
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
    $("historySaveNotice").textContent="棋譜を表示できません："+error.message;
    if($("historySetup").hidden)openHistoryPanel();
  }
}
function exportSharedSGF(){
  try{
    const details=sharedPosition();
    const contents=exportSGF({snapshot:details.snapshot,sgfMeta:details.metadata});
    const id=boardReview?boardReview.record?.id||"shared":currentGameId||"game";
    downloadBlob(new Blob([contents],{type:"application/x-go-sgf;charset=utf-8"}),"miego-"+id+".sgf");
    $("shareNotice").textContent="SGFを書き出しました。";
  }catch(error){$("shareNotice").textContent="SGFを書き出せません："+error.message;}
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
// The ownership shown for each committed position, kept per saved game so
// every frame of a shared animation carries the colours seen while playing.
const ownershipStore=new OwnershipStore(localStorage);
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
        if(job!==shareImageJob)throw Error("中断しました");
        shareImages.animation={progress:i+"/"+total+"手"};renderShareImages();
      }});
    return new File([bytes],"miego-moves"+step+".gif",{type:"image/gif"});
  }
  const {width,height}=shareFrameSize(canvas.width);
  const target=frameCanvas(width,height);
  paintShareFrame(target,canvas,labels);
  const blob=await new Promise((resolve,reject)=>
    target.toBlob(b=>b?resolve(b):reject(Error("画像を作れません")),"image/png"));
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
    status.textContent=entry.failed?"作れませんでした":"作成中…"+(entry.progress?" "+entry.progress:"");
  }
  // Saving always works; sharing appears where the device can take the file.
  const file=shareImages[shareImageKind]?.file;
  $("saveImage").disabled=$("shareImage").disabled=!file;
  $("saveImage").textContent=file ? "画像を保存" :
    shareImages[shareImageKind]?.failed ? "画像を作れませんでした" : "画像を作成中…";
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
      $("shareNotice").textContent="画像を作れません："+error.message;
    }
    renderShareImages();
  }
}
function saveImage(){
  const file=shareImages[shareImageKind]?.file;
  if(!file)return;
  downloadBlob(file,file.name);
  $("shareNotice").textContent="画像を保存しました。";
}
async function shareImage(){
  const file=shareImages[shareImageKind]?.file;
  if(!file || !canShareFile(file))return;
  try{await navigator.share({files:[file]});$("shareNotice").textContent="";}
  catch(error){
    if(error?.name!=="AbortError")$("shareNotice").textContent="画像を共有できません："+error.message;
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
  catch(error){$("saveStatus").hidden=false;$("saveStatus").textContent="棋譜を再生できません："+error.message;}
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
    !confirm("友人との対局から離れ、保存した棋譜を再開しますか？"))return;
  // Reload the record before mutating anything; another tab may have advanced it.
  let record=gameLibrary.load(selected.id);
  if(!record || (record.revision!==selected.revision &&
    !(selected.id===currentGameId && selected.mode===gameMode))){
    $("reviewNotice").textContent="棋譜が別のタブで更新されました。棋譜一覧から選び直してください。";
    return;
  }
  if(!save())return;
  record=gameLibrary.load(selected.id);
  if(!record){
    $("reviewNotice").textContent="棋譜を読み込めません。";
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
$("openCurrentMode").onclick=()=>{
  if(room)openPanel("online");else if(gameMode==="ai")openPanel("ai");
};
$("openHistory").onclick=openHistoryPanel;
$("saveStatus").onclick=()=>{$("saveStatus").hidden=true;};
$("openHistorySettings").onclick=openHistoryPanel;
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
  catch(error){status.textContent="質問文を作れません："+error.message;return;}
  await copyWithFallback(question,status,area,"コピーしました。AIのチャットに貼り付けてください。");
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
    $("aiMatchStatus").textContent="AI対局を開始できません。";
    return;
  }
  if(room && connected &&
     !confirm("友人との対局から離れて、AIと新しい対局を始めますか？"))return;
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
  $("aiMatchStatus").textContent="対局を開始しました。あなたは"+colorLabel(humanColor)+"です。";
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
  $("handicapNote").textContent=(ai?"あなたが黒、AIが白で、白が先に打ちます。":
    kind==="online"?"黒を持つ側が置き石を受け、白が先に打ちます。":"白が先に打ちます。")+
    "コミ0.5目、白に置き石の数だけ加点（中国式）。"+(boardSize===9?"9路は5子まで。":"");
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
        "置き石"+aiHandicap+"子で次の対局を始めます（あなたは黒）。":"互先で次の対局を始めます。";
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
    $("aiMatchStatus").textContent="次のAI着手から反映します。";
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
  $("aiMatchStatus").textContent="次のAI着手から「"+AI_STRENGTHS[aiStrength].label+"」で打ちます。";
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
  try{await navigator.share({title:"MieGO 友人対局",url:link});}
  catch(error){if(error.name!=="AbortError")$("inviteStatus").textContent="共有できませんでした。URLを選択してコピーしてください。";}
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
    $("saveStatus").textContent="共有棋譜を読み込めません："+error.message;
  }
}
show();requestAnalysis();
