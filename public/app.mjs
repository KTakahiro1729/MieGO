import { SIZE, BLACK, WHITE, newGame, play, toggleDead, resume, agreeScore, areaScore, setAssisted, boardHash, proposeEnd, answerEndProposal, setDeadCandidates } from "./core.mjs";
import { suggestDeadStones } from "./dead-stones.mjs";
import { EndgameAdvisor } from "./endgame.mjs";
import { createRoomId, makeInviteUrl, copyInviteText } from "./invite.mjs";
import { PALETTES, ownershipPixel, paletteGradient, interpolateOwnership } from "./territory-view.mjs";
import { choosePolicyMove } from "./ai-opponent.mjs";
import { illegalMoveReasons, drawIllegalMoveMarker } from "./illegal-moves.mjs";
import { needsSwitchConfirmation, freshLocalGame } from "./mode-state.mjs";
import { GameLibrary } from "./game-library.mjs";
import { parseSGF, exportSGF, replaySteps, forkReview } from "./sgf.mjs";
import { canApproveScoring, canApplyAutomatedReview, deadSignature } from "./scoring-flow.mjs";
const $ = id => document.getElementById(id);
const canvas = $("board"), ctx = canvas.getContext("2d");
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
let room = params.get("room"), seat = room ? null : "host", ws, rtc, channel;
let game = newGame(), candidate = null, analysis = null, seq = 0, pending = null, lastPosition = null;
const storedPalette = localStorage.getItem("miego-palette");
let palette = Object.hasOwn(PALETTES, storedPalette) ? storedPalette : "mono";
const storedOpacity = Number(localStorage.getItem("miego-opacity"));
let opacity = Number.isFinite(storedOpacity) && storedOpacity>=0 && storedOpacity<=1 && localStorage.getItem("miego-opacity")!==null ? storedOpacity : .55;
let connected = false, roomCount = 0;
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
let currentGameId=null,currentRevision=null,historySelection=null,historyStep=0;
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
  if(room)return seat==="host"?BLACK:seat==="guest"?WHITE:null;
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
  ? (connected && (seat === "host" ? game.next === BLACK : game.next === WHITE))
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
const overlayCanvas = document.createElement("canvas");
overlayCanvas.width = SIZE; overlayCanvas.height = SIZE;
const overlayContext = overlayCanvas.getContext("2d");

function paintOwnership(d, gap, pad) {
  if (!game.assisted || !displayedOwnership) return;
  const data = overlayContext.createImageData(SIZE,SIZE);
  for (let i=0;i<SIZE*SIZE;i++) {
    const [r,g,b,a]=ownershipPixel(displayedOwnership[i],palette,opacity);
    const p=i*4;
    data.data[p]=r; data.data[p+1]=g; data.data[p+2]=b; data.data[p+3]=a;
  }
  overlayContext.putImageData(data,0,0);
  ctx.save();
  ctx.imageSmoothingEnabled=true;
  ctx.imageSmoothingQuality="high";
  ctx.drawImage(overlayCanvas,pad-gap/2,pad-gap/2,gap*SIZE,gap*SIZE);
  ctx.restore();
}
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
let illegalCacheGame=null,illegalCache=new Map();
function draw() {
  const d = canvas.width, gap = d / (SIZE + 1), pad = gap, b = candidate?.board || game.board;
  ctx.clearRect(0,0,d,d); ctx.fillStyle="#e5c58c";ctx.fillRect(0,0,d,d);
  ctx.strokeStyle="#685537";ctx.lineWidth=2;
  for(let i=0;i<SIZE;i++){const p=pad+i*gap;ctx.beginPath();ctx.moveTo(pad,p);ctx.lineTo(d-pad,p);ctx.moveTo(p,pad);ctx.lineTo(p,d-pad);ctx.stroke();}
  paintOwnership(d,gap,pad);
  if(game.status==="playing" && isHumanTurn()) {
    // This state is immutable; cache legal checks during heatmap animation.
    if(illegalCacheGame!==game) {
      illegalCacheGame=game;
      illegalCache=illegalMoveReasons(game);
    }
    for(const [position,reason] of illegalCache) {
      const x=pad+(position%SIZE)*gap;
      const y=pad+Math.floor(position/SIZE)*gap;
      drawIllegalMoveMarker(ctx,x,y,gap,reason);
    }
  }
  for(const [x,y] of [[2,2],[6,2],[4,4],[2,6],[6,6]]){
    ctx.beginPath();ctx.arc(pad+x*gap,pad+y*gap,4,0,Math.PI*2);ctx.fillStyle="#725b39";ctx.fill();
  }
  const preview = candidate?.moves.at(-1)?.position;
  for(let i=0;i<b.length;i++){
    if(!b[i])continue;
    const x=pad+(i%SIZE)*gap,y=pad+Math.floor(i/SIZE)*gap;
    const r=gap*.44;ctx.save();
    if (i===preview) ctx.globalAlpha=.68;
    ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);
    const grad=ctx.createRadialGradient(x-r*.3,y-r*.3,2,x,y,r*1.2);
    if(b[i]===BLACK){grad.addColorStop(0,"#555b5a");grad.addColorStop(1,"#101718");}
    else{grad.addColorStop(0,"#fff");grad.addColorStop(1,"#b8b8b1");}
    ctx.fillStyle=grad;ctx.fill();ctx.strokeStyle=b[i]===BLACK?"#1a2626":"#a1a29c";ctx.lineWidth=1.5;ctx.stroke();
    ctx.restore();
    if (i===preview) {
      ctx.save();ctx.strokeStyle="#f5d58b";ctx.lineWidth=3;ctx.setLineDash([7,5]);
      ctx.beginPath();ctx.arc(x,y,r+4,0,Math.PI*2);ctx.stroke();ctx.restore();
    }
    if(game.status==="scoring"&&game.dead.includes(i)){ctx.strokeStyle="#d95a4e";ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(x-r*.45,y-r*.45);ctx.lineTo(x+r*.45,y+r*.45);ctx.moveTo(x+r*.45,y-r*.45);ctx.lineTo(x-r*.45,y+r*.45);ctx.stroke();}
  }
  if(lastPosition!==null && !candidate && game.status==="playing"){
    const x=pad+(lastPosition%SIZE)*gap,y=pad+Math.floor(lastPosition/SIZE)*gap;
    ctx.fillStyle="#d0b25c";ctx.fillRect(x-4,y-4,8,8);
  }
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
    if(room && (seat!=="host" || !connected)) {
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
  $("moveLabel").textContent=game.moveNumber+"手目";
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
  $("assisted").checked=game.assisted;$("assisted").disabled=game.moveNumber>0 || (room&&seat!=="host");
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
    const agreeing=room?(seat==="guest"?"white":"black"):
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
    candidate=null;save();show();
    // Evaluate once, when a play/pass or accepted offer enters scoring.
    if(["move","resume","mode"].includes(action.type) ||
       (action.type==="end_answer" && game.status==="scoring") ||
       (hadCandidate && game.status==="playing"))
      requestAnalysis();
    if(!remote&&room) send({type:"action",action});
  }catch(error){alert(error.message); if(remote){$("netStatus").textContent="同期エラー";channel?.close();}}
}
function submitMove(position,fromAi=false){
  if(!fromAi && !isHumanTurn())return;
  if(fromAi && !isAiTurn())return;
  const before=boardHash(game.board);
  let next;
  try{next=play(game,position);}catch(error){alert(error.message);return;}
  apply({type:"move",position,number:game.moveNumber+1,before,after:boardHash(next.board)});
}
canvas.addEventListener("click",e=>{
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
$("resign").onclick=()=>{
  $("gameMenu").open=false;
  if(confirm("投了しますか？"))submitMove("resign");
};
function resetLocalBoard() {
  if (room || gameMode!=="local") return;
  if((game.moveNumber>0 || candidate!==null || game.status!=="playing") &&
     !confirm("新しい対局を始めますか？ 現在の棋譜は履歴に保存されます。"))return;
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
  const color=room?(seat==="guest"?WHITE:BLACK):gameMode==="ai"?humanColor:BLACK;
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
  const oldUrl=new URL(location.href);
  oldUrl.searchParams.delete("room");
  room=null;roomCount=0;seat="host";connected=false;
  try{channel?.close();}catch{}
  try{rtc?.close();}catch{}
  try{ws?.close();}catch{}
  channel=null;rtc=null;ws=null;
  history.replaceState(null,"",oldUrl.pathname+oldUrl.search+oldUrl.hash);
  $("inviteDetails").classList.add("hidden");
  $("inviteStatus").textContent="";
  $("roomInfo").textContent="URLを共有すると、別の端末から対局に参加できます。";
}
function switchToLocal() {
  $("gameMenu").open=false;
  if(gameMode==="local" && !room){closePanels();return;}
  if(needsSwitchConfirmation(game,gameMode,"local",connected) &&
    !confirm("現在の対局を離れて、1台で打つモードに切り替えますか？"))return;
  if(!save())return;
  if(room)leaveOnlineRoom();
  stopAiTurn();gameMode="local";
  game=savedGame("local");candidate=null;
  endgameAdvisor.reset();endgameStage="playing";endExpanded=!!game.endProposal;
  save();closePanels();show();requestAnalysis();
}
function send(msg){if(channel?.readyState==="open")channel.send(JSON.stringify(msg));}
function signal(type,payload){if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type,payload}));}
async function startRTC(){
  if(rtc){rtc.close();rtc=null;}
  const config=await fetch("/api/ice?room="+room).then(r=>r.json());
  rtc=new RTCPeerConnection({iceServers:config.iceServers});
  rtc.onicecandidate=e=>{if(e.candidate)signal("ice",e.candidate.toJSON());};
  rtc.onconnectionstatechange=()=>{
    if(["failed","disconnected","closed"].includes(rtc.connectionState)){
      if(!room)return;
      connected=false;$("netStatus").textContent="接続待機中";show();
    }
  };
  rtc.ondatachannel=e=>setupChannel(e.channel);
  if(seat==="host"){
    setupChannel(rtc.createDataChannel("moves",{ordered:true}));
    const offer=await rtc.createOffer();await rtc.setLocalDescription(offer);signal("offer",rtc.localDescription.toJSON());
  }
}
function setupChannel(c){
  channel=c;
  c.onopen=()=>{
    connected=true;$("netStatus").textContent="P2P接続中";
    if(seat==="host")send({type:"snapshot",game,lastPosition,
      scoringReview:game.status==="scoring" &&
        ["complete","none","modified","unavailable"].includes(deadReview)?deadReview:null});
    show();
  };
  c.onclose=()=>{if(!room)return;connected=false;$("netStatus").textContent="接続待機中";show();};
  c.onmessage=e=>{
    // Ignore late packets from a room that was left before the event arrived.
    if(!room || c!==channel)return;
    let msg;try{msg=JSON.parse(e.data);}catch{return;}
    if(msg.type==="snapshot"&&seat==="guest"){
      if(!msg.game||!Array.isArray(msg.game.board)||msg.game.board.length!==81)return;
      game=msg.game;lastPosition=msg.lastPosition;candidate=null;
      deadReview=game.status==="scoring" &&
        ["complete","none","modified","unavailable"].includes(msg.scoringReview)
        ?msg.scoringReview:"idle";
      deadReviewTouched=deadReview==="modified";
      deadEvaluation=null;
      save();
      endgameAdvisor.reset();endgameStage="playing";
      endExpanded=!!game.endProposal && game.endProposal.from!==myColorForEnd();
      show();requestAnalysis();
    }
    if(msg.type==="action")apply(msg.action,true);
  };
}
async function joinRoom(){
  if(!/^[a-f0-9]{32}$/.test(room)){alert("無効なルームIDです");return;}
  const tokenKey="miego-token-"+room;
  let token=sessionStorage.getItem(tokenKey);
  if(!token){token=crypto.randomUUID();sessionStorage.setItem(tokenKey,token);}
  const scheme=location.protocol==="https:"?"wss:":"ws:";
  ws=new WebSocket(scheme+"//"+location.host+"/api/rooms/"+room+"/ws?token="+encodeURIComponent(token));
  ws.onmessage=async e=>{
    let msg;try{msg=JSON.parse(e.data);}catch{return;}
    try{
      if(msg.type==="joined"){seat=msg.seat;$("netStatus").textContent=seat==="host"?"黒番 · 接続待機":"白番 · 接続待機";show();}
      if(msg.type==="roster"){roomCount=msg.count;if(roomCount===2&&seat==="host"&&!connected)await startRTC();}
      if(msg.type==="offer"&&seat==="guest"){
        if(!rtc)await startRTC();
        await rtc.setRemoteDescription(msg.payload);
        const answer=await rtc.createAnswer();await rtc.setLocalDescription(answer);signal("answer",rtc.localDescription.toJSON());
      }
      if(msg.type==="answer"&&seat==="host"&&rtc)await rtc.setRemoteDescription(msg.payload);
      if(msg.type==="ice"&&rtc)await rtc.addIceCandidate(msg.payload);
    }catch(err){console.error("WebRTC",err);$("netStatus").textContent="接続エラー";}
  };
  ws.onclose=()=>{if(!room)return;$("netStatus").textContent="ルーム切断";connected=false;show();};
  $("roomInfo").textContent="招待URLを共有してください。ホストが黒、参加者が白です。";
}
function showInviteLink() {
  if (!room) return;
  const link = makeInviteUrl(location.origin, room);
  $("inviteDetails").classList.remove("hidden");
  $("inviteUrl").value = link;
  $("copy").textContent = "招待リンクをコピー";
  $("roomInfo").textContent = "このURLを友人に共有してください。ホストが黒番、参加者が白番です。";
  $("nativeShare").classList.toggle("hidden", typeof navigator.share !== "function");
  return link;
}
function ensureRoom() {
  if (room) return showInviteLink();
  if (needsSwitchConfirmation(game,gameMode,"online",connected) && !confirm("現在の対局を離れて、友人対局を開始しますか？")) return null;
  if(!save())return null;
  // This room ID is purely random: the Durable Object room is created lazily by
  // the first WebSocket connection. No async fetch is required here, preserving
  // the browser's transient user activation for navigator.clipboard.writeText.
  room = createRoomId();
  gameMode="online";
  stopAiTurn();
  const link = makeInviteUrl(location.origin, room);
  history.replaceState(null, "", new URL(link));
  game = newGame(game.assisted);currentGameId=null;currentRevision=null;
  endgameAdvisor.reset();endgameStage="playing";endExpanded=false;lastOfferKey=null;
  candidate = null;
  save();showInviteLink();
  void joinRoom();
  show();
  requestAnalysis();
  return link;
}
async function copyLink() {
  let link;
  try { link = ensureRoom(); }
  catch (error) { $("inviteStatus").textContent = "ルームの作成に失敗しました: " + error.message; return; }
  if (!link) return;
  $("inviteStatus").textContent = "";
  // Invoke the clipboard API directly in the click handler without awaiting an
  // HTTP request first. Safari/mobile browsers may revoke activation across awaits.
  const copied = await copyInviteText(link, {
    clipboard: navigator.clipboard,
    input: $("inviteUrl"),
    document
  });
  $("inviteStatus").textContent = copied
    ? "招待URLをコピーしました。友人に貼り付けてください。"
    : "自動コピーできませんでした。上のURLを長押ししてコピーしてください。";
  openPanel("online");
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
  const panel=kind==="settings"?$("settingsPanel"):$("modePanel");
  panel.querySelector(".settings-head button").focus();
}
function recordName(record) {
  if(record.source==="sgf")return "SGFから読み込んだ棋譜";
  return record.mode==="ai"?"AIと対戦":record.mode==="online"?"友人と対戦":"1台で打つ";
}
function recordStatus(record) {
  if(record.source==="sgf")return "読み込み済み";
  return record.snapshot.status==="finished"?"終局済み":record.snapshot.status==="scoring"?"採点中":"対局中";
}
function dateLabel(timestamp) {
  const date=new Date(timestamp);
  return Number.isNaN(date.getTime())?"日時不明":date.toLocaleString("ja-JP",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"});
}
function drawHistoryBoard(record) {
  const canvas=$("historyBoard"), ctx=canvas.getContext("2d"),d=canvas.width;
  const gap=d/(SIZE+1),pad=gap;
  ctx.fillStyle="#e5c58c";ctx.fillRect(0,0,d,d);
  ctx.lineWidth=1.5;ctx.strokeStyle="#6c5638";
  for(let i=0;i<SIZE;i++){
    const p=pad+i*gap;
    ctx.beginPath();ctx.moveTo(pad,p);ctx.lineTo(d-pad,p);
    ctx.moveTo(pad,p);ctx.lineTo(d-pad,p);
    ctx.moveTo(p,pad);ctx.lineTo(p,d-pad);ctx.stroke();
  }
  for(const [x,y] of [[2,2],[6,2],[4,4],[2,6],[6,6]]){
    ctx.beginPath();ctx.arc(pad+x*gap,pad+y*gap,2.5,0,Math.PI*2);
    ctx.fillStyle="#755d3a";ctx.fill();
  }
  record.snapshot.board.forEach((stone,i)=>{
    if(!stone)return;
    const x=pad+(i%SIZE)*gap,y=pad+Math.floor(i/SIZE)*gap;
    ctx.beginPath();ctx.arc(x,y,gap*.44,0,Math.PI*2);
    ctx.fillStyle=stone===BLACK?"#161b20":"#faf8f3";
    ctx.strokeStyle=stone===BLACK?"#080a0a":"#88857c";
    ctx.lineWidth=1.3;ctx.fill();ctx.stroke();
  });
}
function renderHistoryList() {
  historySelection=null;historyStep=0;
  $("historyDetail").hidden=true;$("historyList").hidden=false;
  $("historyPanel").scrollTop=0;
  const list=$("historyList");list.replaceChildren();
  let records=[];
  try{records=gameLibrary.list();}catch(error){storageError(error);}
  $("historyEmpty").hidden=records.length!==0;
  for(const record of records){
    const item=document.createElement("button");item.type="button";item.className="history-list-item";
    const icon=document.createElement("span");icon.className="history-list-icon";
    icon.textContent=record.source==="sgf"?"SGF":record.mode==="online"?"↗":record.mode==="ai"?"AI":"●";
    const copy=document.createElement("span");copy.className="history-item-copy";
    const title=document.createElement("span");title.className="history-item-name";
    title.textContent=recordName(record);
    const desc=document.createElement("span");desc.className="history-item-meta";
    desc.textContent=recordStatus(record)+" · "+record.snapshot.moveNumber+"手 · "+dateLabel(record.updatedAt);
    copy.append(title,desc);item.append(icon,copy);
    item.onclick=()=>showHistoryRecord(record.id);
    list.append(item);
  }
}
function updateHistoryPosition() {
  const record=historySelection;
  if(!record)return;
  const count=record.snapshot.moves.length;
  historyStep=Math.min(count,Math.max(0,historyStep));
  $("historyStepLabel").textContent=historyStep+" / "+count;
  $("historyStepRange").max=String(count);
  $("historyStepRange").value=String(historyStep);
  $("historyFirst").disabled=historyStep===0;
  $("historyPrevious").disabled=historyStep===0;
  $("historyNext").disabled=historyStep===count;
  $("historyLast").disabled=historyStep===count;
  $("historyResume").hidden=record.mode==="online" || record.source==="sgf" ||
    record.snapshot.status==="finished" || historyStep!==count;
  try {
    const state=replaySteps(record.snapshot,historyStep);
    drawHistoryBoard({snapshot:state});
    $("historyBranch").disabled=false;
    $("historyActionNotice").textContent="";
  } catch(error) {
    $("historyBranch").disabled=true;
    $("historyResume").hidden=true;
    $("historyActionNotice").textContent="棋譜を再生できません："+error.message;
  }
}
function setHistoryStep(value){
  historyStep=Number(value);
  updateHistoryPosition();
}
function showHistoryRecord(id) {
  let record=null;
  try{record=gameLibrary.load(id);}catch(error){storageError(error);return;}
  if(!record)return;
  historySelection=record;historyStep=record.snapshot.moves.length;
  $("historyList").hidden=true;$("historyEmpty").hidden=true;
  $("historyDetail").hidden=false;
  $("historyPanel").scrollTop=0;
  $("historyActionNotice").textContent="";
  $("historySelectionName").textContent=recordName(record);
  $("historyMeta").textContent=recordStatus(record)+" · "+record.snapshot.moveNumber+"手 · "+
    dateLabel(record.updatedAt)+(record.sgfMeta?" · コミ "+record.sgfMeta.komi:"");
  $("historyReadOnlyHint").textContent=record.source==="sgf"?
    "SGFの主変化のみを読み込みました。置き石・9路盤以外には未対応。検討はMieGOの中国式・コミ7.5で新しい対局として始まります。":
    record.mode==="online"?"友人対局は閲覧専用です。途中局面の検討は別の1台対局として開始します。":
    record.snapshot.status==="finished"?"終局した棋譜です。途中局面から新しい1台対局を始められます。":
    "最後の局面から元の対局を再開するか、別の1台対局として検討できます。";
  updateHistoryPosition();
  $("historyBack").focus();
}
function openHistoryPanel() {
  $("gameMenu").open=false;
  $("settingsBackdrop").hidden=false;
  $("settingsPanel").hidden=true;$("modePanel").hidden=true;
  $("historyPanel").hidden=false;
  $("historyActionNotice").textContent="";
  $("historyPanel").scrollTop=0;
  $("settingsToggle").setAttribute("aria-expanded","false");
  renderHistoryList();
  $("closeHistory").focus();
}
function resumeHistoryRecord() {
  const selected=historySelection;
  if(!selected || selected.mode==="online" || selected.source==="sgf" ||
     selected.snapshot.status==="finished" || historyStep!==selected.snapshot.moves.length)return;
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
async function importHistoryFile(file) {
  if(!file)return;
  try{
    if(file.size>512*1024)throw Error("SGFファイルは512KB以内にしてください。");
    const parsed=parseSGF(await file.text());
    const record=gameLibrary.save({mode:"local",snapshot:parsed.snapshot,source:"sgf",sgfMeta:parsed.metadata,
      lastPosition:parsed.snapshot.moves.at(-1)?.position??null});
    // Import does not change the active game or its board.
    renderHistoryList();showHistoryRecord(record.id);
    $("historySaveNotice").textContent=parsed.variationsIgnored?
      "SGFの分岐は最初の変化だけ読み込みました。":"SGFを保存しました。";
  }catch(error){
    $("historyPanel").scrollTop=0;
    $("historySaveNotice").textContent="SGFを読み込めません："+error.message;
  }finally{$("historyImportFile").value="";}
}
function exportHistorySGF() {
  if(!historySelection)return;
  try{
    const text=exportSGF(historySelection);
    const blob=new Blob([text],{type:"application/x-go-sgf;charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const link=document.createElement("a");link.href=url;
    link.download="miego-"+historySelection.id+".sgf";
    document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    $("historyActionNotice").textContent="SGFを書き出しました。";
  }catch(error){$("historyActionNotice").textContent="SGFの書き出しに失敗："+error.message;}
}
function branchHistoryPosition(){
  if(!historySelection)return;
  const selected=historySelection;
  let fork;
  try{fork=forkReview(selected.snapshot,historyStep);}
  catch(error){$("historyActionNotice").textContent="この局面は検討できません："+error.message;return;}
  if(room && connected && !confirm("友人との対局から離れて、この局面を1台で検討しますか？"))return;
  if(!save())return;
  if(room)leaveOnlineRoom();
  stopAiTurn();gameMode="local";
  game=fork;currentGameId=null;currentRevision=null;
  const previous=selected.snapshot.moves.slice(0,historyStep).at(-1)?.position;
  lastPosition=Number.isInteger(previous)?previous:null;
  candidate=null;analysis=null;displayedOwnership=null;
  endgameAdvisor.reset();endgameStage="playing";endExpanded=false;
  lastOfferKey=null;endHintSuppressedUntil=-1;
  deadEvaluation=null;deadReview="idle";deadReviewTouched=false;
  if(!save())return;
  closePanels();show();requestAnalysis();
}
$("historyFirst").onclick=()=>setHistoryStep(0);
$("historyPrevious").onclick=()=>setHistoryStep(historyStep-1);
$("historyNext").onclick=()=>setHistoryStep(historyStep+1);
$("historyLast").onclick=()=>historySelection&&setHistoryStep(historySelection.snapshot.moves.length);
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
  if((game.moveNumber>0 || connected) &&
     !confirm("現在の対局を離れて、AIと新しい対局を始めますか？"))return;
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
  const link=ensureRoom();
  if(!link||typeof navigator.share!=="function")return;
  try{await navigator.share({title:"MieGO 友人対局",url:link});}
  catch(error){if(error.name!=="AbortError")$("inviteStatus").textContent="共有できませんでした。URLを選択してコピーしてください。";}
};
if (room) { gameMode="online";save();showInviteLink(); void joinRoom(); }
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
updateGradient();if(!room && currentGameId===null)save();show();requestAnalysis();
