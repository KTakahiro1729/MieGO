import { SIZE, BLACK, WHITE, newGame, play, toggleDead, resume, agreeScore, areaScore, setAssisted, boardHash } from "./core.mjs";
import { createRoomId, makeInviteUrl, copyInviteText } from "./invite.mjs";
import { PALETTES, paletteAt, paletteGradient, interpolateOwnership } from "./territory-view.mjs";
const $ = id => document.getElementById(id);
const canvas = $("board"), ctx = canvas.getContext("2d");
let worker = new Worker("/katago-worker.bundle.mjs", { type: "module" });
let fallbackMode = false;
function switchToFallback(reason) {
  if (fallbackMode) return;
  fallbackMode = true;
  console.warn("KataGo unavailable; switching to transparent approximation:", reason);
  worker.terminate();
  worker = new Worker("/analysis-worker.mjs", { type: "module" });
  worker.onmessage = handleAnalysis;
  worker.onerror = e => { $("analysisStatus").textContent = "解析を利用できません"; console.error(e); };
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
  pending = ++seq;
  if (!game.assisted) {
    analysis = null;
    if (transitionFrame!==null) cancelAnimationFrame(transitionFrame);
    transitionFrame=null;displayedOwnership=null;
    $("analysisStatus").textContent="地合い補助オフ";
    draw(); return;
  }
  const state = candidate || game;
  $("analysisStatus").textContent=fallbackMode?"簡易表示を更新中…":"地合いを更新中…";
  // Avoid queuing expensive neural network evals on every fast tap.
  analysisTimer = setTimeout(() => {
    worker.postMessage({id:pending,state,board:state.board});
  },180);
}
function handleAnalysis(e) {
  const result = e.data;
  if(result.id!==pending)return;
  if(result.error) { switchToFallback(result.error); return; }
  if(!Array.isArray(result.ownership)||result.ownership.length!==81) {
    switchToFallback("Invalid ownership output"); return;
  }
  analysis=result;
  $("analysisStatus").textContent=result.engine==="katago"
    ? "地合いを表示中 · KataGoによる試験的推定"
    : "地合いを表示中 · 簡易影響モデル";
  transitionOwnership(result.ownership);
}
worker.onmessage=handleAnalysis;
function show() {
  const myTurn=!room || (connected && (seat==="host"?game.next===BLACK:game.next===WHITE));
  $("turn").classList.toggle("white-to-play",game.next===WHITE);
  $("turn").textContent=game.status==="finished"?"対局終了":game.status==="scoring"?"死石を確認":room?(connected?(myTurn?"あなたの番":"相手の番"):"対局相手を待っています"):(game.next===BLACK?"黒の番です":"白の番です");
  $("netStatus").classList.toggle("online",connected);
  $("moveLabel").textContent=game.moveNumber+"手目";
  $("hint").textContent=candidate?"仮置き中 · 確定すると相手に届きます":game.status==="scoring"?"死石をタップして指定":"交点をタップして仮置き";
  $("confirm").disabled=!candidate || !myTurn;
  $("cancel").disabled=!candidate;
  $("pass").disabled=!myTurn || game.status!=="playing";
  $("resign").disabled=!myTurn || game.status!=="playing";
  $("assisted").checked=game.assisted;$("assisted").disabled=game.moveNumber>0 || (room&&seat!=="host");
  $("scoreBox").classList.toggle("hidden",game.status!=="scoring");
  if(game.status==="scoring"){
    const score=areaScore(game);
    $("scoreText").textContent="黒 "+score.black+"目 / 白 "+score.white+"目（コミ込み）";
    $("agree").disabled=room&&!connected;
    $("agree").textContent=game.agreed[seat==="guest"?"white":"black"]?"確認済み":"この計算に同意";
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
function submitMove(position){
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
  if(game.status!=="playing")return;
  if(room&&(!connected||(seat==="host"?game.next!==BLACK:game.next!==WHITE)))return;
  try{candidate=play(game,position);show();requestAnalysis();}catch(error){$("hint").textContent=error.message;}
});
$("confirm").onclick=()=>{if(candidate){const p=candidate.moves.at(-1).position;submitMove(p);}};
$("cancel").onclick=()=>{candidate=null;show();requestAnalysis();};
$("pass").onclick=()=>{if(confirm("パスしますか？"))submitMove(null);};
$("resign").onclick=()=>{if(confirm("投了しますか？"))submitMove("resign");};
$("agree").onclick=()=>apply({type:"agree",color:seat==="guest"?WHITE:BLACK});
$("resume").onclick=()=>apply({type:"resume"});
$("assisted").onchange=e=>apply({type:"mode",value:e.target.checked});
$("palette").onchange=e=>{palette=Object.hasOwn(PALETTES,e.target.value)?e.target.value:"mono";localStorage.setItem("miego-palette",palette);draw();updateGradient();};
$("opacity").oninput=e=>{opacity=Number(e.target.value)/100;localStorage.setItem("miego-opacity",String(opacity));$("opacityValue").textContent=e.target.value+"%";draw();};
function updateGradient(){$("gradient").style.background=paletteGradient(palette);}
function save(){if(!room)try{localStorage.setItem("miego-local",JSON.stringify(game));}catch{}}
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
}catch{}
$("palette").value=palette;
$("opacity").value=String(Math.round(opacity*100));
$("opacityValue").textContent=Math.round(opacity*100)+"%";
updateGradient();show();requestAnalysis();
