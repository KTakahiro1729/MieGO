// Signaling and WebRTC transport. Game rules and UI belong to app.mjs.
export function createP2PTransport({verify,onSession,onSync,onAction,onConnected,onDisconnected,onError,getSnapshot}) {
  let current=null, socket=null, peer=null, channel=null, timer=null, generation=0, attempt=0;
  let pendingIce=[],ready=false;
  async function post(path, data) {
    const response=await fetch(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(data)});
    let result;try{result=await response.json();}catch{throw Error("サーバーの応答が不正です");}
    if(!response.ok){const err=Error(result.error||"通信に失敗しました");err.status=response.status;throw err;}
    return result;
  }
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
    try{old?.close();}catch{}
    try{peer?.close();}catch{}
    peer=null;
  }
  async function startRTC(epoch) {
    // ICE can arrive before an offer. Preserve candidates for the first guest offer.
    const earlyIce=current?.role==="guest"&&!peer?pendingIce.slice():[];
    closeRTC();pendingIce=earlyIce;
    if(epoch!==generation||!current)return;
    const rtc=new RTCPeerConnection({iceServers:[{urls:"stun:stun.cloudflare.com:3478"}]});
    peer=rtc;
    rtc.onicecandidate=e=>{if(epoch===generation&&e.candidate)signal("ice",e.candidate.toJSON());};
    rtc.onconnectionstatechange=()=>{
      if(epoch!==generation||peer!==rtc)return;
      if(["failed","disconnected","closed"].includes(rtc.connectionState)){
        ready=false;onDisconnected("接続待機中");
      }
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
      ready=false;onDisconnected("局面を同期中");
      sendSync();
    };
    c.onclose=()=>{
      if(epoch!==generation||channel!==c)return;
      ready=false;onDisconnected("接続待機中");
    };
    c.onmessage=e=>{
      if(epoch!==generation||channel!==c||!current)return;
      let msg;try{msg=JSON.parse(e.data);}catch{return;}
      if(msg?.type==="sync"){
        try{ready=onSync(msg)!==false;if(ready)onConnected();}
        catch(error){ready=false;onError(error);}
      }else if(msg?.type==="action"&&ready)onAction(msg.action);
    };
  }
  function schedule(epoch){
    if(epoch!==generation||!current||timer)return;
    const ms=Math.min(30000,1000*2**Math.min(attempt++,5));
    timer=setTimeout(()=>{timer=null;void connect(epoch);},ms);
  }
  async function connect(epoch) {
    if(epoch!==generation||!current)return;
    try{
      const {room,role,session}=current;
      const ticket=await post("/api/rooms/"+room+"/ticket",{role,session});
      if(epoch!==generation)return;
      closeRTC();
      const scheme=location.protocol==="https:"?"wss:":"ws:";
      const s=new WebSocket(scheme+"//"+location.host+"/api/rooms/"+room+"/ws?ticket="+encodeURIComponent(ticket.ticket));
      socket=s;
      s.onopen=()=>{if(epoch===generation)attempt=0;};
      s.onmessage=async event=>{
        if(epoch!==generation||socket!==s)return;
        let msg;try{msg=JSON.parse(event.data);}catch{return;}
        try{
          if(msg.type==="roster"&&msg.count===2&&role==="owner"&&!ready)await startRTC(epoch);
          if(msg.type==="offer"&&role==="guest"){
            if(!peer)await startRTC(epoch);
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
        }catch(error){onError(error);}
      };
      s.onclose=()=>{
        if(epoch!==generation||socket!==s)return;
        ready=false;closeRTC();onDisconnected("接続待機中");schedule(epoch);
      };
    }catch(error){
      if(epoch!==generation)return;
      onError(error);
      if(![401,403,404,410].includes(error.status))schedule(epoch);
    }
  }
  async function join({room,role,session,inviteKey}){
    leave();
    const epoch=generation;
    current={room,role,session};
    if(!current.session){
      if(!inviteKey)throw Error("招待URLの参加情報がありません");
      const token=await verify();
      const claim=await post("/api/rooms/"+room+"/claim",{role,key:inviteKey,turnstileToken:token});
      if(epoch!==generation)return;
      current.session=claim.session;
      onSession({session:claim.session,ownerColor:claim.ownerColor,role});
    }
    if(epoch===generation)await connect(epoch);
  }
  function leave(){
    generation++;clearTimeout(timer);timer=null;attempt=0;
    current=null;closeRTC();const old=socket;socket=null;try{old?.close();}catch{}
  }
  function refresh(){
    if(!current)return;
    const options={...current};leave();current=options;
    void connect(generation);
  }
  return {post,join,leave,refresh,sendAction:action=>ready&&send({type:"action",action}),sendSync,isReady:()=>ready};
}
