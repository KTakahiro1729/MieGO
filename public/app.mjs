import { SIZE, BLACK, WHITE, newGame, play, toggleDead, resume, agreeScore, areaScore, setAssisted, boardHash, proposeEnd, answerEndProposal, setDeadCandidates } from "./core.mjs";
import { suggestDeadStones } from "./dead-stones.mjs";
import { EndgameAdvisor } from "./endgame.mjs";
import { copyInviteText } from "./invite.mjs";
import { ROOM_PATTERN, selectColor, playerColor, colorLabel, guestUrl, ownUrl, readCheckpoint, saveCheckpoint, reconcileGame } from "./p2p-session.mjs";
import { createP2PTransport } from "./p2p-transport.mjs";
import { PALETTES, paletteGradient, interpolateOwnership } from "./territory-view.mjs";
import { choosePolicyMove } from "./ai-opponent.mjs";
import { createBoardRenderer } from "./board-renderer.mjs";
import { freshLocalGame } from "./mode-state.mjs";
import { GameLibrary } from "./game-library.mjs";
import { replaySteps, forkReview } from "./sgf.mjs";
import { createHistoryPanel } from "./history-panel.mjs";
import { makeReviewUrl, readReviewUrl, makeAiHandoff } from "./sgf-link.mjs";
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
function renderInviteButton() {
  $("copy").disabled=!!room && p2pRole!=="owner";
  $("copy").textContent=!room?"招待リンクを準備する":
    issuedSide!==null && currentSideSelection()!==issuedSide?
      "新しい設定で招待リンクを作り直す":"招待リンクをコピー";
}
function persistOnline(){
  if(!room || !ROOM_PATTERN.test(room))return;
  if(!saveCheckpoint(localStorage,room,{role:p2pRole,ownerColor,session:onlineSession,
    inviteKey,guestInviteKey,issuedSide,revision:onlineRevision,game,lastPosition}))
    storageError(Error("再接続用の局面を保存できません"));
}
let game = newGame(), candidate = null, analysis = null, seq = 0, pending = null, lastPosition = null;
const storedPalette = localStorage.getItem("miego-palette");
let palette = Object.hasOwn(PALETTES, storedPalette) ? storedPalette : "mono";
const storedOpacity = Number(localStorage.getItem("miego-opacity"));
let opacity = Number.isFinite(storedOpacity) && storedOpacity>=0 && storedOpacity<=1 && localStorage.getItem("miego-opacity")!==null ? storedOpacity : .55;
let connected = false;
let gameMode = room ? "online" : "local";
let humanColor = BLACK, aiLevel = "standard", invasion = 50, reinforcement = 50;
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
const historyPanel=createHistoryPanel({$,gameLibrary,storageError});
const {renderHistoryList,updateHistoryPosition,setHistoryStep,showHistoryRecord,
  openHistoryPanel,importHistoryFile,exportHistorySGF}=historyPanel;
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
function myColorForEnd() {
  if(room)return myOnlineColor();
  return gameMode==="ai"?humanColor:BLACK;
}
function updateEndUi() {
  const playing=game.status==="playing";
  const offer=playing?game.endProposal:null;
  const color=myColorForEnd();
  const incoming=!!(offer && room && color!==null && offer.from!==color);
  const key=offer?offer.from+":"+offer.atMove:null;
  if(incoming && key!==lastOfferKey)endExpanded=true;
  lastOfferKey=key;
  const expanded=playing && endExpanded;
  const label=!playing?(game.status==="scoring"?"採点中":"対局終了"):
    offer?(incoming?"終局の提案あり":!room?"採点へ":"返答待ち"):
    endgameStage==="ready" && game.moveNumber>endHintSuppressedUntil?"終局を検討":"終局を相談";
  $("endStatus").textContent=expanded?"閉じる":label;
  $("endToggle").disabled=!playing;
  $("endActions").hidden=!expanded;
  $("endgameBar").classList.toggle("is-expanded",expanded);
  $("endToggle").setAttribute("aria-expanded",String(expanded));
  $("endPropose").hidden=!!offer;
  $("endAccept").hidden=!offer || (!!room && !incoming);
  $("endDecline").hidden=!offer;
  for(const id of ["endPropose","endAccept","endDecline"])
    $(id).disabled=!!room && (!connected || color===null);
  $("endPropose").textContent=room?"終局を提案":"採点へ進む";
  $("endAccept").textContent="採点へ";
  $("endDecline").textContent=incoming?"続ける":"取り下げる";
  $("endDetail").textContent=offer
    ? incoming?"同意すると死石の確認へ進みます。拒否して打ち続けられます。":
      !room?"採点に進むか、そのまま打ち続けるか選べます。":
      "相手の返答を待っています。提案中でも着手できます。"
    : "終局の提案はパスではありません。相手の同意までは対局を続けられます。";
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
      mode:gameMode,humanColor,aiLevel,invasion,reinforcement
    }));
  } catch {}
}
function updatePersonaUi() {
  $("aiInvasionValue").textContent = invasion + "%";
  $("aiReinforcementValue").textContent = reinforcement + "%";
}

let displayedOwnership = null, transitionFrame = null;
const {draw} = createBoardRenderer({
  canvas,
  getView:()=>({game,boardReview,candidate,lastPosition,displayedOwnership,palette,opacity,
    humanTurn:isHumanTurn()})
});
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
  if(!game.assisted) {
    analysis=null;
    if(transitionFrame!==null)cancelAnimationFrame(transitionFrame);
    transitionFrame=null; displayedOwnership=null;
    $("analysisStatus").textContent="地合い補助オフ";
    draw();
    // Endgame evaluation runs independently of the ownership overlay.
    // Avoid evaluating every preview tap when the overlay is disabled.
    if(candidate || fallbackMode)return;
  }
  const state=game.assisted?(candidate || game):game, id=pending;
  analysisContext={id,number:state.moveNumber,hash:boardHash(state.board),committed:!candidate};
  if(game.assisted)$("analysisStatus").textContent=fallbackMode?"簡易表示を更新中…":"地合いを更新中…";
  analysisTimer=setTimeout(()=>worker.postMessage({id,state,board:state.board}),180);
}
function finishAiMove(result) {
  const job=aiJob;
  if(!job || job.id!==result.id)return;
  aiThinking=false;aiJob=null;
  if(!isAiTurn() || game.moveNumber!==job.number || boardHash(game.board)!==job.hash)return;
  if(result.engine!=="katago") {
    switchToFallback("KataGo以外の着手応答");
    return;
  }
  try {
    const next=choosePolicyMove(game,result.policy,result.passLogit,{
      ownership:result.ownership,
      invasion,reinforcement,
      temperature:aiLevel==="gentle"?1.05:0.38
    });
    $("aiMatchStatus").textContent = "侵入度 "+invasion+"% / 補強度 "+reinforcement+"% で対局中（探索なし）";
    submitMove(next,true);
  } catch(error) {
    switchToFallback(error instanceof Error?error.message:String(error));
  }
}
function handleAnalysis(event) {
  const result=event.data;
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
  if(!Array.isArray(result.ownership) || result.ownership.length!==81) {
    switchToFallback("Invalid ownership output");return;
  }
  if(game.status!=="playing")return;
  const context=analysisContext;
  // Sandbox positions and stale asynchronous results must never generate advice.
  if(context?.id===result.id && context.committed && !candidate &&
    context.number===game.moveNumber && context.hash===boardHash(game.board) &&
    result.engine==="katago") {
    endgameStage=endgameAdvisor.observe(game,result.ownership);
    updateEndUi();
  }
  if(!game.assisted)return;
  analysis=result;
  $("analysisStatus").textContent=result.engine==="katago"
    ?"地合いを表示中 · KataGoによる試験的推定"
    :"地合いを表示中 · 簡易影響モデル";
  transitionOwnership(result.ownership);
}
worker.onmessage=handleAnalysis;
function show() {
  if(boardReview){renderBoardReview();return;}
  $("actionRow").hidden=false;
  $("reviewPanel").hidden=true;
  $("endgameBar").hidden=false;
  $("scoreBox").hidden=false;
  $("modePicker").disabled=false;
  const myTurn=isHumanTurn();
  $("modePicker").value=room ? "online" : gameMode;
  $("startAi").disabled=!katagoReady || fallbackMode;
  $("startAi").textContent=fallbackMode?"KataGoが利用できません":
    !katagoReady?"KataGo準備中…":gameMode==="ai"?"設定して再戦":"AIと対局を始める";
  $("aiColor").disabled=false;
  $("aiLevel").disabled=false;
  $("aiInvasion").disabled=false;
  $("aiReinforcement").disabled=false;
  $("turn").classList.toggle("white-to-play",game.next===WHITE);
  $("turn").textContent=game.status==="finished"?"対局終了":
    game.status==="scoring"?"死石を確認":
    room?(connected?(myTurn?"あなたの番":"相手の番"):"対局相手を待っています"):
    gameMode==="ai"?(fallbackMode?"AI対局を停止しました":!katagoReady?"AIを準備中…":
      isAiTurn()?"AIの番です":"あなたの番です"):
    (game.next===BLACK?"黒の番です":"白の番です");
  if(!room)$("netStatus").textContent=gameMode==="ai"?"AIと対戦":"1台で打つ";
  $("netStatus").classList.toggle("online",connected);
  $("moveLabel").textContent=game.moveNumber+"手目 ‹ ›";
  $("hint").textContent=candidate?"仮置き中。確定か取り消しを選べます":
    game.status==="scoring"?"盤上の石をタップすると死石を指定できます":
    gameMode==="ai" && fallbackMode?"KataGoを利用できないためAI対局は停止中":
    gameMode==="ai" && !katagoReady?"KataGoの準備ができるまで待機中":
    isAiTurn()?"AIが着手を計算しています":"";
  $("confirm").disabled=!candidate || !myTurn;
  $("cancel").disabled=!candidate;
  $("pass").disabled=!myTurn || game.status!=="playing";
  $("resign").disabled=!myTurn || game.status!=="playing";
  $("resetLocalGame").hidden=!!room || gameMode!=="local";
  $("openCurrentMode").hidden=!room && gameMode!=="ai";
  $("openCurrentMode").textContent=room?"招待URLを表示":"AIの設定・再戦";
  $("assisted").checked=game.assisted;$("assisted").disabled=game.moveNumber>0 || (room&&p2pRole!=="owner");
  const isScoring=game.status==="scoring",isFinished=game.status==="finished";
  $("gamePanel").classList.toggle("is-scoring",isScoring);
  $("gamePanel").classList.toggle("is-finished",isFinished);
  $("endgameBar").classList.toggle("is-scoring",isScoring);
  $("endgameBar").classList.toggle("is-finished",isFinished);
  $("scoreBox").classList.toggle("hidden",!isScoring && !isFinished);
  if(isScoring)$("analysisStatus").textContent="死石を確認";
  if(isFinished)$("analysisStatus").textContent="";
  $("scoringActions").hidden=!isScoring;
  for(const id of ["cancel","confirm","pass"])$(id).hidden=isScoring || isFinished;
  $("actionRow").classList.toggle("finished-actions",isFinished);
  $("scoreBox").querySelector("strong").textContent=isFinished?"対局結果":"死石を確認";
  $("scoreInstruction").textContent=isFinished?
    (game.result?.endsWith("+R")?"対局終了":"中国式で採点確定"):
    deadReview==="pending"?"死石を自動判定中…":
    deadReview==="loading"?"KataGoを準備中。石の手動指定もできます":
    deadReview==="awaiting"?"相手側で死石を判定中…":
    deadReview==="complete"?"AI候補を確認。違う石はタップで修正":
    deadReview==="none"?"死石候補なし。必要なら石をタップ":
    deadReview==="modified"?"修正済み。点数を確認してください":
    deadReview==="unavailable"?"AI判定不可。石をタップして指定":
    "死石を確認しています…";
  // The scoring controls live in the existing sticky action row.
  if(isScoring){
    const score=areaScore(game);
    $("scoreText").textContent="黒 "+score.black+"目 / 白 "+score.white+"目（コミ込み）";
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
    if(result?.endsWith("+R")) {
      $("scoreBox").querySelector("strong").textContent=(result.startsWith("B+")?"黒":"白")+"の投了勝ち";
      $("scoreText").textContent="投了により終局";
    } else {
      const score=areaScore(game);
      $("scoreBox").querySelector("strong").textContent=
        (result?.startsWith("B+")?"黒":result?.startsWith("W+")?"白":"引き分け")+
        (result?.startsWith("B+")||result?.startsWith("W+")?
          "の"+Math.abs(score.difference).toFixed(1)+"目勝ち":"");
      $("scoreText").textContent="黒 "+score.black+"目 / 白 "+score.white+"目（コミ込み）";
    }
  }
  updateEndUi();
  draw();
}
function apply(action, remote=false) {
  // End-offer messages can race with an actual stone. Ignore stale metadata
  // without tearing down the live Go DataChannel.
  if(remote && (action?.type==="end_offer" || action?.type==="end_answer" ||
                action?.type==="dead_auto" || action?.type==="dead_unavailable")) {
    if(action.number!==game.moveNumber || action.before!==boardHash(game.board))return;
    if(action.type==="end_answer" && action.proposalFrom!==game.endProposal?.from)return;
  }
  try{
    const wasScoring=game.status==="scoring";
    if(action.type==="move"){
      if(action.number!==game.moveNumber+1) throw new Error("手順が一致しません");
      if(action.before!==boardHash(game.board)) throw new Error("盤面が一致しません");
      game=play(game,action.position);
      if(action.after!==boardHash(game.board)) throw new Error("局面の検証に失敗しました");
      lastPosition=Number.isInteger(action.position)?action.position:null;
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
    else if(action.type==="mode") game=setAssisted(game,action.value);
    else if(action.type==="end_offer") {
      if(action.number!==game.moveNumber || action.before!==boardHash(game.board))
        throw new Error("終局の提案時点が一致しません");
      game=proposeEnd(game,action.color);
      if(remote)endExpanded=true;
    } else if(action.type==="end_answer") {
      if(action.number!==game.moveNumber || action.before!==boardHash(game.board) ||
         action.proposalFrom!==game.endProposal?.from)
        throw new Error("終局の返答時点が一致しません");
      game=answerEndProposal(game,action.color,Boolean(action.accept));
      if(!action.accept)endHintSuppressedUntil=game.moveNumber+4;
      endExpanded=false;
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
    candidate=null;save();show();
    // Evaluate once, when a play/pass or accepted offer enters scoring.
    if(["move","resume","mode"].includes(action.type) ||
       (action.type==="end_answer" && game.status==="scoring") ||
       (hadCandidate && game.status==="playing"))
      requestAnalysis();
    if(!remote&&room)p2pTransport.sendAction(action);
  }catch(error){alert(error.message); if(remote){$("netStatus").textContent="同期エラー";p2pTransport.refresh();}}
}
function submitMove(position,fromAi=false){
  if(boardReview && !fromAi)return;
  if(!fromAi && !isHumanTurn())return;
  if(fromAi && !isAiTurn())return;
  const before=boardHash(game.board);
  let next;
  try{next=play(game,position);}catch(error){alert(error.message);return;}
  apply({type:"move",position,number:game.moveNumber+1,before,after:boardHash(next.board)});
}
canvas.addEventListener("click",e=>{
  if(boardReview)return;
  const rect=canvas.getBoundingClientRect(),x=Math.round(((e.clientX-rect.left)/rect.width*canvas.width-canvas.width/(SIZE+1))/(canvas.width/(SIZE+1))),
    y=Math.round(((e.clientY-rect.top)/rect.height*canvas.height-canvas.height/(SIZE+1))/(canvas.height/(SIZE+1)));
  if(x<0||x>=SIZE||y<0||y>=SIZE)return;
  const position=y*SIZE+x;
  if(game.status==="scoring"){
    if(room&&!connected)return;
    apply({type:"dead",position,selected:!game.dead.includes(position)});return;
  }
  if(game.status!=="playing" || !isHumanTurn())return;
  try{candidate=play(game,position);show();requestAnalysis();}
  catch(error){$("hint").textContent=error.message;$("analysisStatus").textContent=error.message;}
});
$("confirm").onclick=()=>{if(candidate){const p=candidate.moves.at(-1).position;submitMove(p);}};
$("cancel").onclick=()=>{candidate=null;show();requestAnalysis();};
$("pass").onclick=()=>submitMove(null);
let resignArmed=false;
function resetResignButton() {
  resignArmed=false;
  $("resign").textContent="投了する";
}
$("gameMenu").addEventListener("toggle",()=>{
  if(!$("gameMenu").open)resetResignButton();
});
$("resign").onclick=()=>{
  if(!resignArmed) {
    resignArmed=true;
    $("resign").textContent="もう一度押すと投了";
    return;
  }
  resetResignButton();
  $("gameMenu").open=false;
  submitMove("resign");
};
function resetLocalBoard() {
  if (room || gameMode!=="local") return;
  // The current match stays in the saved-game library; no modal is needed.
  if(!save())return;
  $("gameMenu").open=false;
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
  game=freshLocalGame(game);currentGameId=null;currentRevision=null;
  save();show();requestAnalysis();
}
$("resetLocalGame").onclick=resetLocalBoard;
document.addEventListener("pointerdown",e=>{
  const menu=$("gameMenu");
  if(menu.open && !menu.contains(e.target))menu.open=false;
});
document.addEventListener("keydown",e=>{
  if(e.key==="Escape" && $("gameMenu").open){
    $("gameMenu").open=false;
    $("gameMenu").querySelector("summary").focus();
  }
});
$("agree").onclick=()=>{
  if(!canApproveScoring(game,deadReview,room,connected))return;
  const color=room?myOnlineColor():gameMode==="ai"?humanColor:BLACK;
  if(game.agreed[color===BLACK?"black":"white"])return;
  apply({type:"agree",color});
  // Single-player modes require one human confirmation. No claim is made that
  // KataGo independently approved the life-and-death judgment.
  if(!room && game.status==="scoring")
    apply({type:"agree",color:gameMode==="ai"?-humanColor:WHITE});
};
$("resume").onclick=()=>apply({type:"resume"});
$("endToggle").onclick=()=>{
  if(game.status!=="playing")return;
  endExpanded=!endExpanded;updateEndUi();
};
$("endPropose").onclick=()=>{
  if(game.status!=="playing" || game.endProposal)return;
  const color=myColorForEnd();
  if(!color || (room&&!connected))return;
  apply({type:"end_offer",color,number:game.moveNumber,before:boardHash(game.board)});
  if(!room && game.status==="playing" && game.endProposal?.from===color) {
    // On one device there is no remote recipient: one tap proceeds to scoring.
    apply({type:"end_answer",color:-color,accept:true,
      proposalFrom:color,number:game.moveNumber,before:boardHash(game.board)});
  } else {
    endExpanded=true;updateEndUi();
  }
};
$("endAccept").onclick=()=>{
  if(game.status!=="playing" || !game.endProposal)return;
  const color=myColorForEnd();
  if(room && (color===null || !connected || game.endProposal.from===color))return;
  // Solo/AI players perform the confirmation themselves; no AI dead-stone
  // adjudication or fictitious consecutive passes are inserted in the record.
  const responder=room?color:-game.endProposal.from;
  apply({type:"end_answer",color:responder,accept:true,
    proposalFrom:game.endProposal.from,
    number:game.moveNumber,before:boardHash(game.board)});
};
$("endDecline").onclick=()=>{
  if(game.status!=="playing" || !game.endProposal)return;
  const color=myColorForEnd();
  if(!color || (room&&!connected))return;
  apply({type:"end_answer",color,accept:false,
    proposalFrom:game.endProposal.from,
    number:game.moveNumber,before:boardHash(game.board)});
};

$("assisted").onchange=e=>apply({type:"mode",value:e.target.checked});
document.querySelectorAll('input[name="palette"]').forEach(input => {
  input.onchange = e => {
    if (!e.target.checked) return;
    palette=Object.hasOwn(PALETTES,e.target.value)?e.target.value:"mono";
    localStorage.setItem("miego-palette",palette);
    draw();updateGradient();
  };
});
$("opacity").oninput=e=>{
  opacity=Number(e.target.value)/100;
  localStorage.setItem("miego-opacity",String(opacity));
  $("opacityValue").textContent=e.target.value+"%";
  updateGradient();draw();
};
$("resetAppearance").onclick=()=>{
  palette="mono";opacity=.55;
  localStorage.setItem("miego-palette",palette);
  localStorage.setItem("miego-opacity","0.55");
  const selected=document.querySelector('input[name="palette"][value="mono"]');
  if(selected)selected.checked=true;
  $("opacity").value="55";$("opacityValue").textContent="55%";
  updateGradient();draw();
};
function updateGradient(){$("gradient").style.backgroundImage=paletteGradient(palette,opacity);}
function save(){
  try {
    const record=gameLibrary.save({id:currentGameId,mode:room?"online":gameMode,
      roomId:room||null,snapshot:game,lastPosition,humanColor,aiLevel,invasion,reinforcement,seat},currentRevision);
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
    aiLevel=record.aiLevel==="gentle"?"gentle":"standard";
    invasion=record.invasion;reinforcement=record.reinforcement;
  }
  return record?.snapshot||newGame(game.assisted);
}
function leaveOnlineRoom() {
  $("gameMenu").open=false;
  if(!room)return;
  save();
  p2pTransport?.leave();
  const oldUrl=new URL(location.href);oldUrl.searchParams.delete("room");oldUrl.hash="";
  room=null;seat="host";connected=false;ownerColor=null;onlineSession=null;
  inviteKey=null;guestInviteKey=null;issuedSide=null;onlineRevision=0;p2pRole="owner";
  history.replaceState(null,"",oldUrl.pathname+oldUrl.search);
  $("inviteDetails").classList.add("hidden");
  $("inviteStatus").textContent="";
  $("roomInfo").textContent="URLを共有すると、別の端末から対局に参加できます。";
}
function switchToLocal() {
  $("gameMenu").open=false;
  if(gameMode==="local" && !room){closePanels();return;}
  if(room && connected &&
    !confirm("友人との対局から離れて、1台で打つモードに切り替えますか？"))return;
  if(!save())return;
  if(room)leaveOnlineRoom();
  stopAiTurn();gameMode="local";
  game=savedGame("local");candidate=null;
  endgameAdvisor.reset();endgameStage="playing";endExpanded=!!game.endProposal;
  save();closePanels();show();requestAnalysis();
}
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
  const result=reconcileGame(game,onlineRevision,message.game,message.revision);
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
  if(room&&issuedSide===choice)return showInviteLink();
  if(room&&(connected||game.moveNumber>0))throw Error("対局開始後は色を変更できません");
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
  gameMode="online";stopAiTurn();
  game=newGame(game.assisted);candidate=null;lastPosition=null;
  currentGameId=null;currentRevision=null;
  deadReview="idle";deadReviewTouched=false;deadEvaluation=null;
  endgameAdvisor.reset();endgameStage="playing";endExpanded=false;lastOfferKey=null;
  history.replaceState(null,"",ownUrl(location.origin,room,inviteKey));
  save();show();requestAnalysis();
  void joinRoom();return showInviteLink();
}
async function copyLink(){
  try{
    if(!room||(issuedSide!==null&&issuedSide!==currentSideSelection())){
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
function openPanel(kind) {
  $("settingsBackdrop").hidden=false;
  $("settingsPanel").hidden=kind!=="settings";
  $("modePanel").hidden=kind==="settings";
  $("onlineSetup").hidden=kind!=="online";
  $("aiSetup").hidden=kind!=="ai";
  $("modeTitle").textContent=kind==="online"?"URLで対戦":"AIと対戦";
  $("settingsToggle").setAttribute("aria-expanded",String(kind==="settings"));
  if(kind==="online" && room)showInviteLink();
  if(kind==="online")renderInviteButton();
  const panel=kind==="settings"?$("settingsPanel"):$("modePanel");
  panel.querySelector(".settings-head button").focus();
}
function renderBoardReview() {
  if(!boardReview)return;
  // The live match may advance over WebRTC or AI while the chosen step stays fixed.
  if(boardReview.source==="live")boardReview.snapshot=game;
  const {snapshot,step,source}=boardReview, count=snapshot.moves.length;
  $("reviewTitle").textContent=source==="url"?"共有棋譜を確認中":"棋譜を確認中";
  $("reviewStepText").textContent=step+" / "+count+"手";
  $("reviewStepRange").max=String(count);
  $("reviewStepRange").value=String(step);
  $("reviewFirst").disabled=step===0;
  $("reviewPrevious").disabled=step===0;
  $("reviewNext").disabled=step>=count;
  $("reviewLast").disabled=step>=count;
  $("reviewBack").textContent=source==="url"?"閉じる":"戻る";
  const updates=source==="live"?Math.max(0,game.moveNumber-boardReview.openedAt):0;
  $("reviewNewMoves").hidden=updates===0;
  $("reviewNewMoves").textContent=updates>0?"新着 +"+updates:"";
  $("moveLabel").textContent=step+" / "+count+"手";
  $("moveLabel").setAttribute("aria-label","棋譜再生を終了する");
  $("turn").classList.toggle("white-to-play",boardReview.display.next===WHITE);
  $("turn").textContent="棋譜を確認中";
  $("modePicker").disabled=true;
  $("actionRow").hidden=true;
  $("endgameBar").hidden=true;
  $("scoreBox").hidden=true;
  $("reviewPanel").hidden=false;
  draw();
}
function requestReviewOwnership() {
  if(!boardReview)return;
  boardReview.ownership=null;
  boardReview.analysisId=++reviewSequence;
  if(!boardReview.display.assisted){draw();return;}
  if(!reviewWorker){
    reviewWorker=new Worker("/analysis-worker.mjs",{type:"module"});
    reviewWorker.onmessage=e=>{
      if(!boardReview || e.data.id!==boardReview.analysisId ||
         !Array.isArray(e.data.ownership) || e.data.ownership.length!==SIZE*SIZE)return;
      boardReview.ownership=e.data.ownership;
      draw();
    };
    reviewWorker.onerror=e=>{
      console.warn("Review ownership unavailable",e);
      $("reviewNotice").textContent="過去局面の地合い推定を表示できません。";
      reviewWorker?.terminate();reviewWorker=null;
    };
  }
  reviewWorker.postMessage({id:boardReview.analysisId,board:boardReview.display.board});
}
function enterBoardReview(snapshot,step,source="live",metadata=null) {
  const display=replaySteps(snapshot,step);
  boardReview={snapshot,display,step,source,metadata,ownership:null,
    openedAt:game.moveNumber,analysisId:0};
  $("reviewNotice").textContent="";
  $("reviewCopyFallback").hidden=true;
  $("reviewMenu").open=false;
  show();requestReviewOwnership();
}
function setBoardReviewStep(step) {
  if(!boardReview)return;
  const snapshot=boardReview.source==="live"?game:boardReview.snapshot;
  if(!Number.isInteger(step)||step<0||step>snapshot.moves.length)return;
  try{
    const display=replaySteps(snapshot,step);
    boardReview.snapshot=snapshot;
    boardReview.display=display;boardReview.step=step;
    $("reviewNotice").textContent="";
    $("reviewCopyFallback").hidden=true;
    show();requestReviewOwnership();
  }catch(error){$("reviewNotice").textContent="棋譜を再生できません："+error.message;}
}
function leaveBoardReview() {
  if(!boardReview)return;
  const wasUrl=boardReview.source==="url";
  boardReview=null;reviewSequence++;
  if(wasUrl)clearImportedReviewUrl();
  $("reviewCopyFallback").hidden=true;
  $("reviewMenu").open=false;
  $("moveLabel").setAttribute("aria-label","棋譜を再生する");
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
  try{fork=forkReview(boardReview.snapshot,boardReview.step);}
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
  $("reviewMenu").open=false;
  save();show();requestAnalysis();
}
async function copyReviewText(text,statusId,fallbackId) {
  const status=$(statusId),field=$(fallbackId);
  try{
    if(typeof navigator.clipboard?.writeText!=="function")throw Error("clipboard unavailable");
    await navigator.clipboard.writeText(text);
    field.hidden=true;status.textContent="コピーしました。";
  }catch{
    field.value=text;field.hidden=false;field.focus();field.select();
    try{field.setSelectionRange(0,text.length);}catch{}
    status.textContent="自動コピーできませんでした。選択された文章を手動でコピーしてください。";
  }
}
function selectedBoardReviewUrl() {
  const {snapshot,metadata,step}=boardReview;
  const moves=snapshot.moves.filter(m=>m.position!=="resign").length;
  return makeReviewUrl(location.origin,{snapshot,sgfMeta:metadata},Math.min(step,moves));
}
async function shareBoardReview(ai) {
  if(!boardReview)return;
  try{
    const url=selectedBoardReviewUrl();
    await copyReviewText(ai?makeAiHandoff(url):url,"reviewNotice","reviewCopyFallback");
  }catch(error){$("reviewNotice").textContent="共有URLを作れません："+error.message;}
}
async function shareHistoryReview(ai) {
  if(!historyPanel.selection)return;
  try{
    const moves=historyPanel.selection.snapshot.moves.filter(m=>m.position!=="resign").length;
    const link=makeReviewUrl(location.origin,historyPanel.selection,Math.min(historyPanel.step,moves));
    await copyReviewText(ai?makeAiHandoff(link):link,"historyActionNotice","historyCopyFallback");
  }catch(error){$("historyActionNotice").textContent="共有URLを作れません："+error.message;}
}
$("moveLabel").onclick=()=>{
  if(boardReview){leaveBoardReview();return;}
  try{enterBoardReview(game,game.moves.length,"live");}
  catch(error){$("saveStatus").hidden=false;$("saveStatus").textContent="棋譜を再生できません："+error.message;}
};
$("reviewStepToggle").onclick=()=>{
  const menu=$("reviewMenu");
  menu.open=!menu.open;
  if(menu.open)$("reviewStepRange").focus();
};
$("reviewMenu").addEventListener("toggle",()=>{
  if(!$("reviewMenu").open)$("reviewCopyFallback").hidden=true;
});
document.addEventListener("pointerdown",e=>{
  const menu=$("reviewMenu");
  if(menu.open && !menu.contains(e.target) && e.target!==$("reviewStepToggle"))menu.open=false;
});
document.addEventListener("keydown",e=>{
  if(e.key==="Escape" && $("reviewMenu").open){
    $("reviewMenu").open=false;
    $("reviewStepToggle").focus();
  }
});
$("reviewFirst").onclick=()=>setBoardReviewStep(0);
$("reviewPrevious").onclick=()=>boardReview&&setBoardReviewStep(boardReview.step-1);
$("reviewNext").onclick=()=>boardReview&&setBoardReviewStep(boardReview.step+1);
$("reviewLast").onclick=()=>boardReview&&setBoardReviewStep(boardReview.snapshot.moves.length);
$("reviewStepRange").oninput=e=>setBoardReviewStep(Number(e.target.value));
$("reviewBack").onclick=leaveBoardReview;
$("reviewBranch").onclick=forkBoardReview;
$("reviewLink").onclick=()=>void shareBoardReview(false);
$("reviewAiLink").onclick=()=>void shareBoardReview(true);
$("historyBoard").addEventListener("click",()=>{
  if(!historyPanel.selection)return;
  try{
    const record=historyPanel.selection;
    const step=historyPanel.step;
    closePanels();
    enterBoardReview(record.snapshot,step,"archive",record.sgfMeta);
  }catch(error){$("historyActionNotice").textContent="盤面を開けません："+error.message;}
});
$("historyBoard").addEventListener("keydown",e=>{
  if(e.key==="Enter"||e.key===" "){e.preventDefault();$("historyBoard").click();}
});
$("historyLink").onclick=()=>void shareHistoryReview(false);
$("historyAiLink").onclick=()=>void shareHistoryReview(true);
function resumeHistoryRecord() {
  const selected=historyPanel.selection;
  if(!selected || selected.mode==="online" || selected.source==="sgf" ||
     selected.snapshot.status==="finished" || historyPanel.step!==selected.snapshot.moves.length)return;
  if(room && connected && !confirm("友人との対局から離れ、保存した棋譜を開きますか？"))return;
  // Save the current board before replacing it with the selected position.
  const same=selected.id===currentGameId && selected.mode===gameMode;
  if(!save())return;
  if(room)leaveOnlineRoom();
  const record=gameLibrary.load(selected.id);
  if(!record || (!same && record.revision!==selected.revision)){
    $("historyActionNotice").textContent="この棋譜が別のタブで更新されました。一覧を開き直してください。";
    return;
  }
  stopAiTurn();
  gameMode=record.mode;game=JSON.parse(JSON.stringify(record.snapshot));
  currentGameId=record.id;currentRevision=record.revision;
  lastPosition=record.lastPosition;candidate=null;
  if(gameMode==="ai"){
    humanColor=record.humanColor===WHITE?WHITE:BLACK;
    aiLevel=record.aiLevel;invasion=record.invasion;reinforcement=record.reinforcement;
    $("aiColor").value=String(humanColor);
    const side=document.querySelector('input[name="aiSide"][value="'+humanColor+'"]');
    if(side)side.checked=true;
    $("aiLevel").value=aiLevel;
    $("aiInvasion").value=String(invasion);
    $("aiReinforcement").value=String(reinforcement);updatePersonaUi();
  }
  endgameAdvisor.reset();endgameStage="playing";endExpanded=!!game.endProposal;
  lastOfferKey=null;deadReview=game.status==="scoring" &&
    (game.dead.length || game.agreed.black || game.agreed.white)?"modified":"idle";
  deadEvaluation=null;deadReviewTouched=deadReview==="modified";
  analysis=null;displayedOwnership=null;
  try{gameLibrary.setActive(gameMode,currentGameId);}catch(error){storageError(error);return;}
  rememberSettings();
  closePanels();show();requestAnalysis();
}
function branchHistoryPosition(){
  if(!historyPanel.selection)return;
  const selected=historyPanel.selection;
  let fork;
  try{fork=forkReview(selected.snapshot,historyPanel.step);}
  catch(error){$("historyActionNotice").textContent="この局面は検討できません："+error.message;return;}
  if(room && connected && !confirm("友人との対局から離れて、この局面を1台で検討しますか？"))return;
  if(!save())return;
  if(room)leaveOnlineRoom();
  stopAiTurn();gameMode="local";
  game=fork;currentGameId=null;currentRevision=null;
  const previous=selected.snapshot.moves.slice(0,historyPanel.step).at(-1)?.position;
  lastPosition=Number.isInteger(previous)?previous:null;
  candidate=null;analysis=null;displayedOwnership=null;
  endgameAdvisor.reset();endgameStage="playing";endExpanded=false;
  lastOfferKey=null;endHintSuppressedUntil=-1;
  deadEvaluation=null;deadReview="idle";deadReviewTouched=false;
  if(!save())return;
  closePanels();show();requestAnalysis();
}
$("historyFirst").onclick=()=>setHistoryStep(0);
$("historyPrevious").onclick=()=>setHistoryStep(historyPanel.step-1);
$("historyNext").onclick=()=>setHistoryStep(historyPanel.step+1);
$("historyLast").onclick=()=>historyPanel.selection&&setHistoryStep(historyPanel.selection.snapshot.moves.length);
$("historyStepRange").oninput=e=>setHistoryStep(Number(e.target.value));
$("historyImportFile").onchange=e=>{void importHistoryFile(e.target.files?.[0]);};
$("historyExport").onclick=exportHistorySGF;
$("historyBranch").onclick=branchHistoryPosition;
$("openHistory").onclick=openHistoryPanel;
$("openCurrentMode").onclick=()=>{
  $("gameMenu").open=false;
  if(room)openPanel("online");
  else if(gameMode==="ai")openPanel("ai");
};
$("closeHistory").onclick=()=>{closePanels();$("gameMenu").querySelector("summary").focus();};
$("historyBack").onclick=()=>{
  renderHistoryList();
  ($("historyList").querySelector("button")||$("historyImportFile")).focus();
};
$("historyResume").onclick=resumeHistoryRecord;
document.addEventListener("storage",e=>{
  if(e.key?.startsWith("miego:game:v1:") && !$("historyPanel").hidden &&
     $("historyDetail").hidden)renderHistoryList();
});
function openSettings(){openPanel("settings");}
function closePanels() {
  $("gameMenu").open=false;
  $("settingsBackdrop").hidden=true;
  $("settingsPanel").hidden=true;
  $("modePanel").hidden=true;
  $("historyPanel").hidden=true;
  $("onlineSetup").hidden=true;
  $("aiSetup").hidden=true;
  $("settingsToggle").setAttribute("aria-expanded","false");
  $("modePicker").value=room?"online":gameMode;
}
function closeSettings(){closePanels();$("settingsToggle").focus();}
$("settingsToggle").onclick=()=>$("settingsPanel").hidden?openSettings():closeSettings();
$("closeSettings").onclick=closeSettings;
$("closeMode").onclick=()=>{closePanels();$("modePicker").focus();};
$("settingsBackdrop").onclick=closePanels;
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("settingsBackdrop").hidden)closePanels();});
$("modePicker").onchange=e=>{
  const selected=e.target.value;
  e.target.value=room?"online":gameMode;
  if(selected==="local")switchToLocal();
  else if(selected==="online")openPanel("online");
  else if(selected==="ai")openPanel("ai");
};
$("startAi").onclick=()=>{
  if(!katagoReady || fallbackMode){
    $("aiMatchStatus").textContent="AI対局を開始できません。";
    return;
  }
  if(room && connected &&
     !confirm("友人との対局から離れて、AIと新しい対局を始めますか？"))return;
  if(!save())return;
  if(room)leaveOnlineRoom();
  stopAiTurn();
  gameMode="ai";
  humanColor=Number($("aiColor").value)===WHITE?WHITE:BLACK;
  aiLevel=$("aiLevel").value==="gentle"?"gentle":"standard";
  game=newGame(game.assisted);currentGameId=null;currentRevision=null;lastPosition=null;candidate=null;
  endgameAdvisor.reset();endgameStage="playing";endExpanded=false;lastOfferKey=null;
  $("aiMatchStatus").textContent="対局を開始しました。";
  save();closePanels();show();requestAnalysis();
};
for (const input of document.querySelectorAll('input[name="aiSide"]')) {
  input.onchange=e=>{if(e.target.checked)$("aiColor").value=e.target.value;};
}
for(const [id,key] of [["aiInvasion","invasion"],["aiReinforcement","reinforcement"]]) {
  $(id).oninput=e=>{
    const value=Math.max(0,Math.min(100,Number(e.target.value)||0));
    if(key==="invasion")invasion=value;else reinforcement=value;
    updatePersonaUi();rememberSettings();
    $("aiMatchStatus").textContent="次のAI着手から反映します。";
  };
}
$("aiLevel").onchange=e=>{aiLevel=e.target.value==="gentle"?"gentle":"standard";rememberSettings();};
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
    aiLevel=settings.aiLevel==="gentle"?"gentle":"standard";
    invasion=Math.max(0,Math.min(100,Number(settings.invasion??50)));
    reinforcement=Math.max(0,Math.min(100,Number(settings.reinforcement??50)));
  }
  game=savedGame(gameMode);endExpanded=!!game.endProposal;
}catch{}
$("aiColor").value=String(humanColor);
const aiSide=document.querySelector('input[name="aiSide"][value="'+humanColor+'"]');
if(aiSide)aiSide.checked=true;
$("aiLevel").value=aiLevel;
$("aiInvasion").value=String(invasion);
$("aiReinforcement").value=String(reinforcement);
updatePersonaUi();
const selectedPalette=document.querySelector('input[name="palette"][value="'+palette+'"]');
if(selectedPalette)selectedPalette.checked=true;
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
