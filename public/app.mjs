import { SIZE, BLACK, WHITE, newGame, play, toggleDead, resume, agreeScore, areaScore, setAssisted, boardHash } from "./core.mjs";
import { createRoomId, makeInviteUrl, copyInviteText } from "./invite.mjs";
import { choosePolicyMove } from "./ai-opponent.mjs";
const $ = id => document.getElementById(id);
const canvas = $("board"), ctx = canvas.getContext("2d");
let worker = new Worker("/katago-worker.bundle.mjs", { type: "module" });
let fallbackMode = false;
function switchToFallback(reason) {
  if (fallbackMode) return;
  fallbackMode = true;
  katagoReady = false;
  aiThinking = false;
  aiJob = null;
  $("aiMatchStatus").textContent = "KataGoが利用できないため、対AI戦を開始・続行できません。";
  console.warn("KataGo unavailable; switching to transparent approximation:", reason);
  worker.terminate();
  worker = new Worker("/analysis-worker.mjs", { type: "module" });
  worker.onmessage = handleAnalysis;
  worker.onerror = e => { $("analysisStatus").textContent = "解析を利用できません"; console.error(e); };
  show();
  requestAnalysis();
}
worker.onerror = e => switchToFallback(e.message || "worker startup error");
const params = new URLSearchParams(location.search);
let room = params.get("room"), seat = room ? null : "host", ws, rtc, channel;
let game = newGame(), candidate = null, analysis = null, seq = 0, pending = null, lastPosition = null;
let palette = "blueRed", opacity = .55, connected = false, roomCount = 0;
let gameMode = room ? "online" : "local";
let humanColor = BLACK;
let aiLevel = "standard";
let aiThinking = false, aiJob = null, aiMoveTimer = null;
let katagoReady = false;
const isAiTurn = () => !room && gameMode === "ai" &&
  game.status === "playing" && game.next === -humanColor;
const isHumanTurn = () => !room
  ? (gameMode !== "ai" || (katagoReady && !fallbackMode && game.next === humanColor))
  : (connected && (seat === "host" ? game.next === BLACK : game.next === WHITE));
function stopAiTask() {
  clearTimeout(aiMoveTimer);
  aiJob = null;
  aiThinking = false;
  pending = ++seq;
}

const colors = {
  blueRed: [[73,126,189],[230,230,220],[204,110,88]],
  purpleGreen: [[150,100,185],[230,230,220],[66,157,114]],
  gray: [[60,60,60],[170,170,170],[245,245,245]]
};
function colorFor(v) {
  const c = colors[palette], t = Math.max(0,Math.min(1,(v+1)/2)), a = t < .5 ? c[0] : c[1], b = t < .5 ? c[1] : c[2], u = t < .5 ? t*2 : (t-.5)*2;
  return a.map((x,i)=>Math.round(x*(1-u)+b[i]*u));
}
function draw() {
  const d = canvas.width, gap = d / (SIZE + 1), pad = gap, b = candidate?.board || game.board;
  ctx.clearRect(0,0,d,d); ctx.fillStyle="#e5c58c";ctx.fillRect(0,0,d,d);
  ctx.strokeStyle="#685537";ctx.lineWidth=2;
  for(let i=0;i<SIZE;i++){const p=pad+i*gap;ctx.beginPath();ctx.moveTo(pad,p);ctx.lineTo(d-pad,p);ctx.moveTo(p,pad);ctx.lineTo(p,d-pad);ctx.stroke();}
  if(game.assisted && analysis) for(let i=0;i<SIZE*SIZE;i++){
    const x=pad+(i%SIZE)*gap,y=pad+Math.floor(i/SIZE)*gap;
    const c=colorFor(analysis.ownership[i]);
    ctx.fillStyle="rgba("+c.join(",")+","+opacity+")";
    ctx.fillRect(x-gap*.48,y-gap*.48,gap*.96,gap*.96);
  }
  for(const [x,y] of [[2,2],[6,2],[4,4],[2,6],[6,6]]){
    ctx.beginPath();ctx.arc(pad+x*gap,pad+y*gap,4,0,Math.PI*2);ctx.fillStyle="#725b39";ctx.fill();
  }
  for(let i=0;i<b.length;i++){
    if(!b[i])continue;
    const x=pad+(i%SIZE)*gap,y=pad+Math.floor(i/SIZE)*gap;
    const r=gap*.44;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);
    const grad=ctx.createRadialGradient(x-r*.3,y-r*.3,2,x,y,r*1.2);
    if(b[i]===BLACK){grad.addColorStop(0,"#555b5a");grad.addColorStop(1,"#101718");}
    else{grad.addColorStop(0,"#fff");grad.addColorStop(1,"#b8b8b1");}
    ctx.fillStyle=grad;ctx.fill();ctx.strokeStyle=b[i]===BLACK?"#1a2626":"#a1a29c";ctx.lineWidth=1.5;ctx.stroke();
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
  if (isAiTurn()) {
    if (fallbackMode || !katagoReady) {
      aiThinking = false;
      aiJob = null;
      analysis = null;
      $("analysisStatus").textContent = "KataGo利用不可：対AI戦は続行できません";
      $("aiMatchStatus").textContent = "KataGoが利用できないため、対AI戦を続行できません。";
      show();
      return;
    }
    if (aiThinking) return;
    analysis = null;
    draw();
    for (const key of ["blackEstimate","whiteEstimate","leadEstimate","winEstimate"]) $(key).textContent="—";
    const id = ++seq;
    pending = id;
    aiThinking = true;
    aiJob = { id, board: boardHash(game.board), number:game.moveNumber };
    $("analysisStatus").textContent = "KataGoが着手を計算中…";
    $("aiMatchStatus").textContent = $("analysisStatus").textContent;
    worker.postMessage({id,kind:"move",state:game});
    show();
    return;
  }
  pending = ++seq;
  if (!game.assisted) {
    analysis = null;
    for (const key of ["blackEstimate","whiteEstimate","leadEstimate","winEstimate"]) $(key).textContent="—";
    $("analysisStatus").textContent="AI補助オフ";
    draw(); return;
  }
  const state = candidate || game;
  const id = pending;
  $("analysisStatus").textContent=fallbackMode?"簡易推定を計算中…":"KataGoの推論中…（初回はモデルを読み込みます）";
  analysisTimer = setTimeout(() => {
    worker.postMessage({id,state,board:state.board});
  },180);
}
function finishAiMove(result) {
  const job = aiJob;
  if (!job || job.id !== result.id) return;
  aiThinking = false;
  aiJob = null;
  if (!isAiTurn() || game.moveNumber !== job.number || boardHash(game.board) !== job.board) return;
  try {
    if (result.engine !== "katago") throw new Error("KataGoの応答ではありません");
    const nextMove = choosePolicyMove(game,result.policy,result.passLogit,{
      temperature: aiLevel === "gentle" ? 1.05 : 0.38
    });
    $("aiMatchStatus").textContent = "KataGoのニューラル着手方針で対局中（MCTS探索なし）。";
    submitMove(nextMove,true);
  } catch (error) {
    console.error("AI move",error);
    switchToFallback(error.message);
    $("aiMatchStatus").textContent = "AIの着手に失敗しました。KataGoが復旧するまで対AI戦はできません。";
    show();
  }
}
function handleAnalysis(e) {
  const result = e.data;
  if (result.kind === "availability") {
    if (fallbackMode) return;
    if (result.available) {
      katagoReady = true;
      $("aiMatchStatus").textContent = gameMode === "ai"
        ? "KataGo対局の準備ができました。"
        : "KataGo準備完了。AI対局を開始できます。";
      show();
    } else {
      switchToFallback(result.error || "KataGo初期化に失敗しました");
    }
    return;
  }
  if (result.id !== pending) return;
  if (result.kind === "move") {
    if (result.error) { switchToFallback(result.error); return; }
    finishAiMove(result);
    return;
  }
  if(result.error) { switchToFallback(result.error); return; }
  if(!Array.isArray(result.ownership)||result.ownership.length!==81) {
    switchToFallback("Invalid ownership output"); return;
  }
  analysis=result;
  $("blackEstimate").textContent=result.black.toFixed(1)+"目";
  $("whiteEstimate").textContent=result.white.toFixed(1)+"目";
  $("leadEstimate").textContent=(result.lead>=0?"黒 +":"白 +")+Math.abs(result.lead).toFixed(1)+"目";
  $("winEstimate").textContent=Number.isFinite(result.winRate)?(result.winRate*100).toFixed(1)+"%":"—";
  $("analysisStatus").textContent=result.engine==="katago"
    ?"KataGo NN単独評価 · "+result.backend+" · 小型テストモデル（探索なし）"
    :"近傍影響モデルによる簡易推定（KataGoは利用不可）";
  draw();
}
worker.onmessage=handleAnalysis;
function show() {
  $("turn").textContent=game.status==="finished"?"終局 "+game.result:game.status==="scoring"?"死石確認中":(game.next===BLACK?"● 黒番":"○ 白番");
  $("moveLabel").textContent=game.moveNumber+"手目";
  $("hint").textContent=candidate?"仮置き中 · 確定するまで相手に送られません":game.status==="scoring"?"死石をタップして指定":"交点をタップして仮置き";
  const myTurn = isHumanTurn();
  $("netStatus").textContent = !room ? (gameMode === "ai" ? "AI対局" : "ローカル練習") : $("netStatus").textContent;
  $("startAi").disabled = !!room || !katagoReady || fallbackMode;
  $("returnLocal").classList.toggle("hidden", gameMode !== "ai" || !!room);
  $("startAi").textContent = fallbackMode ? "KataGo利用不可" : !katagoReady
    ? "KataGoを準備中…" : gameMode === "ai" ? "設定してAIと再戦" : "AIと対局を始める";
  $("scoreInstruction").textContent = gameMode === "ai"
    ? "AIは死石判定を行いません。死石を自分で指定して確認すると、AI側も同意し、中国式面積計算で終局します。"
    : "死石をタップして指定してください。双方が確認すると面積計算で勝敗を決定します。";
  if (gameMode !== "ai" && !room && !fallbackMode && !katagoReady)
    $("aiMatchStatus").textContent = "KataGoモデルを読み込んでいます…";

  $("confirm").disabled=!candidate || !myTurn;
  $("cancel").disabled=!candidate;
  $("pass").disabled=!myTurn || game.status!=="playing";
  $("resign").disabled=!myTurn || game.status!=="playing";
  $("assisted").checked=game.assisted;$("assisted").disabled=game.moveNumber>0 || (room&&seat!=="host");
  if (isAiTurn()) {
    $("turn").textContent += "（AI）";
    $("hint").textContent = fallbackMode ? "KataGo利用不可。AI対局を続行できません。" : "AIの着手を計算しています…";
  }

  $("scoreBox").classList.toggle("hidden",game.status!=="scoring");
  if(game.status==="scoring"){
    const score=areaScore(game);
    $("scoreText").textContent="黒 "+score.black+"目 / 白 "+score.white+"目（コミ込み）";
    $("agree").disabled=room&&!connected;
    const scorer = room ? (seat==="guest"?"white":"black")
      : gameMode==="ai" ? (humanColor===BLACK?"black":"white") : "black";
    $("agree").textContent=game.agreed[scorer]?"確認済み":"この計算に同意";
    $("resume").disabled=room&&!connected;
  }
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
    else return;
    candidate=null;save();show();requestAnalysis();
    if(!remote&&room) send({type:"action",action});
  }catch(error){alert(error.message); if(remote){$("netStatus").textContent="同期エラー";channel?.close();}}
}
function submitMove(position, fromAi=false){
  if (!fromAi && !isHumanTurn()) return;
  if (fromAi && !isAiTurn()) return;
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
  if (room && !connected) return;
  const color = room ? (seat==="guest"?WHITE:BLACK) : gameMode==="ai" ? humanColor : BLACK;
  if (game.agreed[color===BLACK?"black":"white"]) return;
  apply({type:"agree",color});
  // A local AI has no independent dead-stone judgment: explicitly let
  // the human mark dead stones and accept the score on behalf of the AI.
  if (gameMode==="ai" && game.status==="scoring") apply({type:"agree",color:-humanColor});
};
$("resume").onclick=()=>apply({type:"resume"});
$("assisted").onchange=e=>apply({type:"mode",value:e.target.checked});
$("palette").onchange=e=>{palette=e.target.value;draw();updateGradient();};
$("opacity").oninput=e=>{opacity=Number(e.target.value)/100;$("opacityValue").textContent=e.target.value+"%";draw();};
function updateGradient(){$("gradient").style.background="linear-gradient(90deg,"+colors[palette].map(c=>"rgb("+c.join(",")+")").join(",")+")";}
function save(){if(!room)try{
  localStorage.setItem("miego-local",JSON.stringify(game));
  localStorage.setItem("miego-local-settings",JSON.stringify({mode:gameMode,humanColor,aiLevel}));
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
      game=msg.game;lastPosition=msg.lastPosition;candidate=null;show();requestAnalysis();
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
  gameMode = "online";
  stopAiTask();
  const link = makeInviteUrl(location.origin, room);
  history.replaceState(null, "", new URL(link));
  game = newGame(game.assisted);
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
}
$("startAi").onclick = () => {
  if (room || !katagoReady || fallbackMode) {
    $("aiMatchStatus").textContent = "KataGoの準備ができていないため、対AI戦を開始できません。";
    return;
  }
  if (game.moveNumber > 0 && !confirm("現在の対局を終了してAIと新しく対局しますか？")) return;
  stopAiTask();
  gameMode = "ai";
  humanColor = Number($("aiColor").value) === WHITE ? WHITE : BLACK;
  aiLevel = $("aiLevel").value === "gentle" ? "gentle" : "standard";
  game = newGame(game.assisted);
  lastPosition = null;
  candidate = null;
  $("aiMatchStatus").textContent = "AI対局を開始しました。";
  save();show();requestAnalysis();
};
$("returnLocal").onclick = () => {
  if (room || !confirm("AI対局を終了してローカル練習に戻りますか？")) return;
  stopAiTask();
  gameMode = "local";
  game = newGame(game.assisted);
  lastPosition = null;
  candidate = null;
  save();show();requestAnalysis();
};
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
  if(saved?.board?.length===81&&Array.isArray(saved.moves))game=saved;
  const settings=JSON.parse(localStorage.getItem("miego-local-settings")||"null");
  if(settings?.mode==="ai") {
    gameMode="ai";
    humanColor=settings.humanColor===WHITE?WHITE:BLACK;
    aiLevel=settings.aiLevel==="gentle"?"gentle":"standard";
  }
}catch{}
$("aiColor").value=String(humanColor);
$("aiLevel").value=aiLevel;
updateGradient();show();requestAnalysis();
