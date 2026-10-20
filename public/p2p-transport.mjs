import {postP2PJson,reconnectDelay,isTerminalTicketFailure,signalingUrl} from "./p2p-network.mjs";
import { TEXT } from "./texts.mjs";
import { UserError } from "./user-error.mjs";

// How long a disconnected direct link may take to come back before it is rebuilt.
const STALL_MS=10000;

// Signaling and WebRTC transport. Game rules and UI belong to app.mjs.
// onSignins({owner,guest}) reports how often each seat moved to another device.
// onDisconnected(message,retrying): retrying is true while the transport reconnects by itself,
// false while the other player is away, and left out while the peers compare boards.
export function createP2PTransport({verify,onSession,onSync,onAction,onConnected,onDisconnected,onError,getSnapshot,onSignins=()=>{}}) {
  let current=null, socket=null, peer=null, channel=null, timer=null, generation=0, attempt=0;
  let pendingIce=[],ready=false,stall=null,relinks=0;
  const post=postP2PJson;
  function signal(type,payload){
    if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type,payload}));
  }
  function send(data){
    if(channel?.readyState!=="open")return false;
    channel.send(JSON.stringify(data));return true;
  }
  function sendSync(){return send({type:"sync",...getSnapshot()});}
  function closeRTC(){
    const old=channel;channel=null;ready=false;pendingIce=[];
    clearTimeout(stall);stall=null;
    try{old?.close();}catch{}
    try{peer?.close();}catch{}
    peer=null;
  }
  // Only the direct link failed while signaling may still be up. Rejoining signaling makes
  // the server send a new roster, which has the owner offer a fresh connection.
  function relink(epoch){
    if(epoch!==generation||!current)return;
    closeRTC();relinks++;
    const old=socket;socket=null;try{old?.close();}catch{}
    onDisconnected(TEXT.online.statusOffline,true);schedule(epoch);
  }
  async function startRTC(epoch) {
    // ICE can arrive before an offer. Preserve candidates for the first guest offer.
    const earlyIce=current?.role==="guest"&&!peer?pendingIce.slice():[];
    closeRTC();pendingIce=earlyIce;
    if(epoch!==generation||!current)return;
    const rtc=new RTCPeerConnection({iceServers:[{urls:"stun:stun.cloudflare.com:3478"}]});
    peer=rtc;
    rtc.onicecandidate=e=>{if(epoch===generation&&e.candidate)signal("ice",e.candidate.toJSON());};
    let lost=false;
    rtc.onconnectionstatechange=()=>{
      if(epoch!==generation||peer!==rtc)return;
      const state=rtc.connectionState;
      clearTimeout(stall);stall=null;
      // disconnected may pass: the open channel keeps its order, so the game resumes without a new sync.
      if(state==="disconnected"){
        lost=true;onDisconnected(TEXT.online.statusOffline,true);
        stall=setTimeout(()=>{stall=null;relink(epoch);},STALL_MS);
      }else if(state==="connected"&&lost){
        lost=false;if(ready)onConnected();
      }else if(state==="failed"||state==="closed")relink(epoch);
    };
    rtc.ondatachannel=e=>setupChannel(e.channel,epoch);
    if(current.role==="owner"){
      setupChannel(rtc.createDataChannel("moves",{ordered:true}),epoch);
      const offer=await rtc.createOffer();await rtc.setLocalDescription(offer);
      if(epoch===generation)signal("offer",rtc.localDescription.toJSON());
    }
  }
  function setupChannel(c,epoch){
    channel=c;
    c.onopen=()=>{
      if(epoch!==generation||channel!==c)return;
      ready=false;onDisconnected(TEXT.online.syncing);
      sendSync();
    };
    c.onclose=()=>{
      if(epoch!==generation||channel!==c)return;
      relink(epoch);
    };
    c.onmessage=e=>{
      if(epoch!==generation||channel!==c||!current)return;
      let msg;try{msg=JSON.parse(e.data);}catch{return;}
      if(msg?.type==="sync"){
        try{ready=onSync(msg)!==false;if(ready){relinks=0;onConnected();}}
        catch(error){ready=false;onError(error);}
      }else if(msg?.type==="action"&&ready)onAction(msg.action);
    };
  }
  function schedule(epoch){
    if(epoch!==generation||!current||timer)return;
    const ms=reconnectDelay(attempt++);
    timer=setTimeout(()=>{timer=null;void connect(epoch);},ms);
  }
  async function connect(epoch) {
    if(epoch!==generation||!current)return;
    try{
      const {room,role,session}=current;
      let ticket;
      try{ticket=await post("/api/rooms/"+room+"/ticket",{role,session});}
      catch(error){error.stage="ticket";throw error;}
      if(epoch!==generation)return;
      closeRTC();
      const prev=socket;socket=null;try{prev?.close();}catch{}
      const s=new WebSocket(signalingUrl(location,room,ticket.ticket));
      socket=s;
      // A direct link that keeps failing backs off like signaling does.
      s.onopen=()=>{if(epoch===generation)attempt=relinks;};
      s.onmessage=async event=>{
        if(epoch!==generation||socket!==s)return;
        let msg;try{msg=JSON.parse(event.data);}catch{return;}
        try{
          if((msg.type==="joined"||msg.type==="signin") && msg.signins)onSignins(msg.signins);
          if(msg.type==="roster"&&msg.count<2){closeRTC();onDisconnected(TEXT.online.waitingConnection,false);}
          if(msg.type==="roster"&&msg.count===2&&role==="owner"&&!ready)await startRTC(epoch);
          if(msg.type==="offer"&&role==="guest"){
            // An offer after an earlier one comes from the owner's fresh connection.
            if(!peer||peer.remoteDescription)await startRTC(epoch);
            if(epoch!==generation)return;
            await peer.setRemoteDescription(msg.payload);
            for(const ice of pendingIce.splice(0))await peer.addIceCandidate(ice);
            const answer=await peer.createAnswer();await peer.setLocalDescription(answer);
            if(epoch===generation)signal("answer",peer.localDescription.toJSON());
          }
          if(msg.type==="answer"&&role==="owner"&&peer){
            await peer.setRemoteDescription(msg.payload);
            for(const ice of pendingIce.splice(0))await peer.addIceCandidate(ice);
          }
          if(msg.type==="ice"){
            if(!peer?.remoteDescription)pendingIce.push(msg.payload);
            else await peer.addIceCandidate(msg.payload);
          }
        }catch(error){console.warn("P2P signaling",error);relink(epoch);}
      };
      s.onclose=()=>{
        if(epoch!==generation||socket!==s)return;
        closeRTC();onDisconnected(TEXT.online.statusOffline,true);schedule(epoch);
      };
    }catch(error){
      if(epoch!==generation)return;
      error.retrying=!isTerminalTicketFailure(error.status);
      onError(error);
      if(error.retrying)schedule(epoch);
    }
  }
  async function join({room,role,session,inviteKey}){
    leave();
    const epoch=generation;
    current={room,role,session};
    if(!current.session){
      if(!inviteKey)throw new UserError(TEXT.online.noInviteKey);
      const token=await verify();
      const claim=await post("/api/rooms/"+room+"/claim",{role,key:inviteKey,turnstileToken:token});
      if(epoch!==generation)return;
      current.session=claim.session;
      onSession({session:claim.session,ownerColor:claim.ownerColor,role});
    }
    if(epoch===generation)await connect(epoch);
  }
  function leave(){
    generation++;clearTimeout(timer);timer=null;attempt=0;relinks=0;
    current=null;closeRTC();const old=socket;socket=null;try{old?.close();}catch{}
  }
  function refresh(){
    if(!current)return;
    const options={...current};leave();current=options;
    void connect(generation);
  }
  return {post,join,leave,refresh,sendAction:action=>ready&&send({type:"action",action}),sendSync,isReady:()=>ready};
}
