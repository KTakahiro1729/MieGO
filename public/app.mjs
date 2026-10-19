import { SIZE, BLACK, WHITE, newGame, play, toggleDead, resume, agreeScore, areaScore, setAssisted, boardHash, proposeEnd, answerEndProposal } from "./core.mjs";
import { EndgameAdvisor } from "./endgame.mjs";
import { createRoomId, makeInviteUrl, copyInviteText } from "./invite.mjs";
import { PALETTES, paletteAt, paletteGradient, interpolateOwnership } from "./territory-view.mjs";
import { choosePolicyMove } from "./ai-opponent.mjs";
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
  const label=!playing?(game.status==="scoring"?"採点中":"対局終了"):
    offer?(incoming?"相手から終局の提案":!room?"終局の確認":"相手の返答待ち"):
    fallbackMode?"終局の目安 · 判定不可":
    endgameStage==="ready" && game.moveNumber>endHintSuppressedUntil?"終局を検討できます":
    endgameStage==="near"?"終局が近いかもしれません":"終局の目安 · 対局中";
  $("endStatus").textContent=label;
  $("endToggle").disabled=!playing;
  const expanded=playing && endExpanded;
  $("endActions").hidden=!expanded;
  $("endToggle").setAttribute("aria-expanded",String(expanded));
  $("endPropose").hidden=!!offer;
  $("endAccept").hidden=!offer || (!!room && !incoming);
  $("endDecline").hidden=!offer;
  for(const id of ["endPropose","endAccept","endDecline"])
    $(id).disabled=!!room && (!connected || color===null);
  $("endAccept").textContent=room?"同意して採点へ":"確認して採点へ";
  $("endDecline").textContent=incoming?"対局を続ける":"提案を取り下げる";
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
  analysisContext=null;
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
    const c=paletteAt(displayedOwnership[i],palette);
    const p=i*4;
    data.data[p]=c[0]; data.data[p+1]=c[1]; data.data[p+2]=c[2]; data.data[p+3]=Math.round(opacity*255);
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
function draw() {
  const d = canvas.width, gap = d / (SIZE + 1), pad = gap, b = candidate?.board || game.board;
  ctx.clearRect(0,0,d,d); ctx.fillStyle="#e5c58c";ctx.fillRect(0,0,d,d);
  ctx.strokeStyle="#685537";ctx.lineWidth=2;
  for(let i=0;i<SIZE;i++){const p=pad+i*gap;ctx.beginPath();ctx.moveTo(pad,p);ctx.lineTo(d-pad,p);ctx.moveTo(p,pad);ctx.lineTo(p,d-pad);ctx.stroke();}
  paintOwnership(d,gap,pad);
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
      if(isAiTurn())requestAnalysis();
    } else {
      switchToFallback(result.error || "KataGo初期化に失敗しました");
    }
    return;
  }
  if(result.id!==pending)return;
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
  $("startAi").disabled=!!room || !katagoReady || fallbackMode;
  $("startAi").textContent=fallbackMode?"KataGoが利用できません":
    !katagoReady?"KataGo準備中…":gameMode==="ai"?"設定して再戦":"AIと対局を始める";
  $("returnLocal").classList.toggle("hidden",!!room || gameMode!=="ai");
  $("aiColor").disabled=!!room;
  $("aiLevel").disabled=!!room;
  $("aiInvasion").disabled=!!room;
  $("aiReinforcement").disabled=!!room;
  $("turn").classList.toggle("white-to-play",game.next===WHITE);
  $("turn").textContent=game.status==="finished"?"対局終了":
    game.status==="scoring"?"死石を確認":
    room?(connected?(myTurn?"あなたの番":"相手の番"):"対局相手を待っています"):
    gameMode==="ai"?(isAiTurn()?"AIの番です":"あなたの番です"):
    (game.next===BLACK?"黒の番です":"白の番です");
  if(!room)$("netStatus").textContent=gameMode==="ai"?"対AI戦":"ローカル練習";
  $("netStatus").classList.toggle("online",connected);
  $("moveLabel").textContent=game.moveNumber+"手目";
  $("hint").textContent=candidate?
    (room?"仮置き中 · 確定すると相手に届きます":"仮置き中 · 確定すると着手します"):
    game.status==="scoring"?"死石をタップして指定":
    isAiTurn()?(fallbackMode?"KataGo利用不可。対AI戦は停止中":"AIが着手を計算しています…"):
    "交点をタップして仮置き";
  $("confirm").disabled=!candidate || !myTurn;
  $("cancel").disabled=!candidate;
  $("pass").disabled=!myTurn || game.status!=="playing";
  $("resign").disabled=!myTurn || game.status!=="playing";
  $("assisted").checked=game.assisted;$("assisted").disabled=game.moveNumber>0 || (room&&seat!=="host");
  $("scoreBox").classList.toggle("hidden",game.status!=="scoring");
  $("scoreInstruction").textContent=gameMode==="ai"
    ?"死石を人間が指定して採点します。AI独自の生死判定・異議申し立ては行いません。"
    :"死石をタップして指定し、双方で結果を確認してください。";
  if(game.status==="scoring"){
    const score=areaScore(game);
    $("scoreText").textContent="黒 "+score.black+"目 / 白 "+score.white+"目（コミ込み）";
    $("agree").disabled=room&&!connected;
    const agreeing=room?(seat==="guest"?"white":"black"):
      gameMode==="ai"?(humanColor===BLACK?"black":"white"):"black";
    $("agree").textContent=game.agreed[agreeing]?"確認済み":"この計算に同意";
    $("resume").disabled=room&&!connected;
  }
  updateEndUi();
  draw();
}
function apply(action, remote=false) {
  try{
    if(action.type==="move"){
      if(action.number!==game.moveNumber+1) throw new Error("手順が一致しません");
      if(action.before!==boardHash(game.board)) throw new Error("盤面が一致しません");
      game=play(game,action.position);
      if(action.after!==boardHash(game.board)) throw new Error("局面の検証に失敗しました");
      lastPosition=Number.isInteger(action.position)?action.position:null;
    } else if(action.type==="dead") game=toggleDead(game,action.position);
    else if(action.type==="agree") game=agreeScore(game,action.color);
    else if(action.type==="resume") game=resume(game);
    else if(action.type==="mode") game=setAssisted(game,action.value);
    else if(action.type==="end_offer") {
      if(action.number!==game.moveNumber || action.before!==boardHash(game.board))
        throw new Error("終局の提案時点が一致しません");
      game=proposeEnd(game,action.color);
      if(remote)endExpanded=true;
    } else if(action.type==="end_answer") {
      if(action.number!==game.moveNumber || action.before!==boardHash(game.board))
        throw new Error("終局の返答時点が一致しません");
      game=answerEndProposal(game,action.color,Boolean(action.accept));
      if(!action.accept)endHintSuppressedUntil=game.moveNumber+4;
      endExpanded=false;
    }
    else return;
    if(action.type==="move")endExpanded=false;
    candidate=null;save();show();
    if(!["end_offer","end_answer"].includes(action.type))requestAnalysis();
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
  if(game.status==="scoring"){if(room&&!connected)return;apply({type:"dead",position});return;}
  if(game.status!=="playing" || !isHumanTurn())return;
  try{candidate=play(game,position);show();requestAnalysis();}catch(error){$("hint").textContent=error.message;}
});
$("confirm").onclick=()=>{if(candidate){const p=candidate.moves.at(-1).position;submitMove(p);}};
$("cancel").onclick=()=>{candidate=null;show();requestAnalysis();};
$("pass").onclick=()=>{if(confirm("パスしますか？"))submitMove(null);};
$("resign").onclick=()=>{if(confirm("投了しますか？"))submitMove("resign");};
$("agree").onclick=()=>{
  if(room&&!connected)return;
  const color=room?(seat==="guest"?WHITE:BLACK):gameMode==="ai"?humanColor:BLACK;
  if(game.agreed[color===BLACK?"black":"white"])return;
  apply({type:"agree",color});
  // Human adjudicates life and death; the AI does not claim to verify it.
  if(gameMode==="ai" && game.status==="scoring")apply({type:"agree",color:-humanColor});
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
  endExpanded=true;updateEndUi();
};
$("endAccept").onclick=()=>{
  if(game.status!=="playing" || !game.endProposal)return;
  const color=myColorForEnd();
  if(room && (color===null || !connected || game.endProposal.from===color))return;
  // Solo/AI players perform the confirmation themselves; no AI dead-stone
  // adjudication or fictitious consecutive passes are inserted in the record.
  const responder=room?color:-game.endProposal.from;
  apply({type:"end_answer",color:responder,accept:true,
    number:game.moveNumber,before:boardHash(game.board)});
};
$("endDecline").onclick=()=>{
  if(game.status!=="playing" || !game.endProposal)return;
  const color=myColorForEnd();
  if(!color || (room&&!connected))return;
  apply({type:"end_answer",color,accept:false,
    number:game.moveNumber,before:boardHash(game.board)});
};
$("assisted").onchange=e=>apply({type:"mode",value:e.target.checked});
$("palette").onchange=e=>{palette=Object.hasOwn(PALETTES,e.target.value)?e.target.value:"mono";localStorage.setItem("miego-palette",palette);draw();updateGradient();};
$("opacity").oninput=e=>{opacity=Number(e.target.value)/100;localStorage.setItem("miego-opacity",String(opacity));$("opacityValue").textContent=e.target.value+"%";draw();};
function updateGradient(){$("gradient").style.background=paletteGradient(palette);}
function save(){if(!room)try{
    localStorage.setItem("miego-local",JSON.stringify(game));
    rememberSettings();
  }catch{}}
function send(msg){if(channel?.readyState==="open")channel.send(JSON.stringify(msg));}
function signal(type,payload){if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type,payload}));}
async function startRTC(){
  if(rtc){rtc.close();rtc=null;}
  const config=await fetch("/api/ice?room="+room).then(r=>r.json());
  rtc=new RTCPeerConnection({iceServers:config.iceServers});
  rtc.onicecandidate=e=>{if(e.candidate)signal("ice",e.candidate.toJSON());};
  rtc.onconnectionstatechange=()=>{
    if(["failed","disconnected","closed"].includes(rtc.connectionState)){
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
    if(seat==="host")send({type:"snapshot",game,lastPosition});
    show();
  };
  c.onclose=()=>{connected=false;$("netStatus").textContent="接続待機中";show();};
  c.onmessage=e=>{
    let msg;try{msg=JSON.parse(e.data);}catch{return;}
    if(msg.type==="snapshot"&&seat==="guest"){
      if(!msg.game||!Array.isArray(msg.game.board)||msg.game.board.length!==81)return;
      game=msg.game;lastPosition=msg.lastPosition;candidate=null;
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
  ws.onclose=()=>{$("netStatus").textContent="ルーム切断";connected=false;show();};
  $("roomInfo").textContent="招待URLを共有してください。ホストが黒、参加者が白です。";
}
function showInviteLink() {
  if (!room) return;
  const link = makeInviteUrl(location.origin, room);
  $("inviteDetails").classList.remove("hidden");
  $("inviteUrl").value = link;
  $("share").textContent = "招待リンクをコピー";
  $("roomInfo").textContent = "このURLを友人に共有してください。ホストが黒番、参加者が白番です。";
  $("nativeShare").classList.toggle("hidden", typeof navigator.share !== "function");
  return link;
}
function ensureRoom() {
  if (room) return showInviteLink();
  if (game.moveNumber > 0 && !confirm("現在のローカル対局を終了して、新しい友人対局を作成しますか？")) return null;
  // This room ID is purely random: the Durable Object room is created lazily by
  // the first WebSocket connection. No async fetch is required here, preserving
  // the browser's transient user activation for navigator.clipboard.writeText.
  room = createRoomId();
  gameMode="online";
  stopAiTurn();
  const link = makeInviteUrl(location.origin, room);
  history.replaceState(null, "", new URL(link));
  game = newGame(game.assisted);
  endgameAdvisor.reset();endgameStage="playing";endExpanded=false;lastOfferKey=null;
  candidate = null;
  showInviteLink();
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
  openSettings();
}
function openSettings() {
  $("settingsBackdrop").hidden=false;
  $("settingsPanel").hidden=false;
  $("settingsToggle").setAttribute("aria-expanded","true");
  $("settingsToggle").setAttribute("aria-label","設定を閉じる");
}
function closeSettings() {
  $("settingsBackdrop").hidden=true;
  $("settingsPanel").hidden=true;
  $("settingsToggle").setAttribute("aria-expanded","false");
  $("settingsToggle").setAttribute("aria-label","設定を開く");
  $("settingsToggle").focus();
}
$("settingsToggle").onclick=()=>$("settingsPanel").hidden?openSettings():closeSettings();
$("closeSettings").onclick=closeSettings;
$("settingsBackdrop").onclick=closeSettings;
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("settingsPanel").hidden)closeSettings();});
$("aiMenu").onclick=()=>{
  openSettings();
  $("aiSettings").scrollIntoView({block:"start",behavior:"smooth"});
};
$("startAi").onclick=()=>{
  if(room || !katagoReady || fallbackMode) {
    $("aiMatchStatus").textContent="KataGoが利用できないため対AI戦は開始できません。";
    return;
  }
  if(game.moveNumber>0 && !confirm("現在の対局を終了してAIと新しく対局しますか？"))return;
  stopAiTurn();
  gameMode="ai";
  humanColor=Number($("aiColor").value)===WHITE?WHITE:BLACK;
  aiLevel=$("aiLevel").value==="gentle"?"gentle":"standard";
  game=newGame(game.assisted);
  endgameAdvisor.reset();endgameStage="playing";endExpanded=false;lastOfferKey=null;
  lastPosition=null;candidate=null;
  $("aiMatchStatus").textContent="対AI戦を開始しました。";
  save();closeSettings();show();requestAnalysis();
};
$("returnLocal").onclick=()=>{
  if(room || !confirm("対AI戦を終了してローカル練習に戻りますか？"))return;
  stopAiTurn();
  gameMode="local";game=newGame(game.assisted);
  endgameAdvisor.reset();endgameStage="playing";endExpanded=false;lastOfferKey=null;
  lastPosition=null;candidate=null;
  save();closeSettings();show();requestAnalysis();
};
for(const [id,key] of [["aiInvasion","invasion"],["aiReinforcement","reinforcement"]]) {
  $(id).oninput=e=>{
    const value=Math.max(0,Math.min(100,Number(e.target.value)||0));
    if(key==="invasion")invasion=value;else reinforcement=value;
    updatePersonaUi();rememberSettings();
    $("aiMatchStatus").textContent="棋風設定を更新しました。次のAI着手から反映します。";
  };
}
$("aiLevel").onchange=e=>{aiLevel=e.target.value==="gentle"?"gentle":"standard";rememberSettings();};
$("aiColor").onchange=e=>{humanColor=Number(e.target.value)===WHITE?WHITE:BLACK;rememberSettings();};
$("share").onclick = copyLink;
$("copy").onclick = copyLink;
$("inviteUrl").onclick = e => e.currentTarget.select();
$("nativeShare").onclick = async () => {
  const link = ensureRoom();
  if (!link || typeof navigator.share !== "function") return;
  try { await navigator.share({ title: "MieGO 友人対局", url: link }); }
  catch (error) {
    if (error.name !== "AbortError") {
      $("inviteStatus").textContent = "共有できませんでした。URLを選択してコピーしてください。";
    }
  }
};
if (room) { showInviteLink(); void joinRoom(); }
else try{
  const saved=JSON.parse(localStorage.getItem("miego-local")||"null");
  if(saved?.board?.length===81&&Array.isArray(saved.moves)){
    game=saved;endExpanded=!!game.endProposal;
  }
  const settings=JSON.parse(localStorage.getItem("miego-local-settings")||"null");
  if(settings) {
    gameMode=settings.mode==="ai"?"ai":"local";
    humanColor=settings.humanColor===WHITE?WHITE:BLACK;
    aiLevel=settings.aiLevel==="gentle"?"gentle":"standard";
    invasion=Math.max(0,Math.min(100,Number(settings.invasion??50)));
    reinforcement=Math.max(0,Math.min(100,Number(settings.reinforcement??50)));
  }
}catch{}
$("aiColor").value=String(humanColor);
$("aiLevel").value=aiLevel;
$("aiInvasion").value=String(invasion);
$("aiReinforcement").value=String(reinforcement);
updatePersonaUi();
$("palette").value=palette;
$("opacity").value=String(Math.round(opacity*100));
$("opacityValue").textContent=Math.round(opacity*100)+"%";
updateGradient();show();requestAnalysis();
