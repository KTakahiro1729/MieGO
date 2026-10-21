import test from "node:test";
import assert from "node:assert/strict";
import {createP2PTransport} from "../public/p2p-transport.mjs";

function fixture(t) {
  const original={fetch:globalThis.fetch,WebSocket:globalThis.WebSocket,location:globalThis.location};
  const calls=[],sockets=[];
  class Socket {
    static OPEN=1;
    constructor(url) {this.url=url;this.readyState=1;this.closed=false;sockets.push(this);}
    close() {this.closed=true;this.readyState=3;}
    send(data){calls.push(["ws",JSON.parse(data)]);}
  }
  globalThis.WebSocket=Socket;
  globalThis.location={protocol:"https:",host:"miego.example"};
  globalThis.fetch=async(url,options)=>{
    calls.push(["http",url,JSON.parse(options.body)]);
    const item=url.endsWith("/claim")?{session:"3".repeat(48),ownerColor:"white"}:
      url.endsWith("/ticket")?{ticket:"5".repeat(48),ownerColor:"white"}:{ok:true};
    return {ok:true,json:async()=>item};
  };
  t.after(()=>{globalThis.fetch=original.fetch;globalThis.WebSocket=original.WebSocket;globalThis.location=original.location;});
  return {calls,sockets};
}
const settings={onSync:()=>true,onAction:()=>{},onConnected:()=>{},
  onDisconnected:()=>{},onError:error=>{throw error;},
  getSnapshot:()=>({game:{board:[]},revision:0})};

test("saved session reconnects without a second human verification",async t=>{
  const {calls,sockets}=fixture(t);let checks=0;
  const transport=createP2PTransport({...settings,verify:async()=>{checks++;return "turnstile";},onSession:()=>{}});
  await transport.join({room:"1".repeat(32),role:"owner",session:"2".repeat(48),inviteKey:"4".repeat(48)});
  assert.equal(checks,0);
  assert.equal(calls.filter(c=>c[0]==="http").length,1);
  assert.match(calls[0][1],/\/ticket$/);
  assert.equal(sockets.length,1);
  transport.leave();
});
test("first guest claim verifies once and stale socket events cannot reconnect or modify game",async t=>{
  const {calls,sockets}=fixture(t);let checks=0,sessions=0,actions=0;
  const transport=createP2PTransport({...settings,
    verify:async()=>{checks++;return "verified";},
    onSession:({ownerColor})=>{sessions++;assert.equal(ownerColor,"white");},
    onAction:()=>{actions++}
  });
  await transport.join({room:"1".repeat(32),role:"guest",session:null,inviteKey:"4".repeat(48)});
  assert.equal(checks,1);assert.equal(sessions,1);
  assert.equal(calls.filter(c=>c[0]==="http").length,2);
  const old=sockets[0];
  transport.leave();
  assert.equal(old.closed,true);
  await old.onmessage?.({data:JSON.stringify({type:"roster",count:2})});
  assert.equal(actions,0);
  assert.equal(sockets.length,1,"leaving must invalidate old event callbacks");
});

test("sign-in counts reach the app, and a refused ticket is reported once without retrying",async t=>{
  const {sockets}=fixture(t);
  const seen=[];
  const transport=createP2PTransport({...settings,verify:async()=>"x",onSession:()=>{},onSignins:s=>seen.push(s)});
  await transport.join({room:"1".repeat(32),role:"owner",session:"2".repeat(48)});
  await sockets[0].onmessage({data:JSON.stringify({type:"joined",role:"owner",signins:{owner:0,guest:1}})});
  await sockets[0].onmessage({data:JSON.stringify({type:"signin",signins:{owner:0,guest:2}})});
  assert.deepEqual(seen,[{owner:0,guest:1},{owner:0,guest:2}]);
  transport.leave();

  globalThis.fetch=async()=>({ok:false,status:403,json:async()=>({error:"Session expired"})});
  const errors=[];
  const refused=createP2PTransport({...settings,verify:async()=>"x",onSession:()=>{},onError:e=>errors.push(e)});
  await refused.join({room:"1".repeat(32),role:"guest",session:"2".repeat(48)});
  assert.equal(errors.length,1);
  assert.equal(errors[0].stage,"ticket");
  assert.equal(errors[0].status,403);
  assert.equal(sockets.length,1,"no socket is opened for a refused seat");
  refused.leave();
});

function fakeRTC(t){
  const original=globalThis.RTCPeerConnection,peers=[];
  class Channel {
    constructor(){this.readyState="connecting";this.sent=[];}
    send(data){this.sent.push(JSON.parse(data));}
    close(){this.readyState="closed";}
  }
  globalThis.RTCPeerConnection=class {
    constructor(){this.connectionState="new";this.remoteDescription=null;this.closed=false;peers.push(this);}
    createDataChannel(){return this.channel=new Channel();}
    async createOffer(){return {type:"offer",sdp:"o"+peers.length};}
    async createAnswer(){return {type:"answer",sdp:"a"+peers.length};}
    async setLocalDescription(d){this.localDescription={toJSON:()=>d};}
    async setRemoteDescription(d){this.remoteDescription=d;}
    async addIceCandidate(){}
    close(){this.closed=true;}
    state(s){this.connectionState=s;this.onconnectionstatechange();}
  };
  t.after(()=>{globalThis.RTCPeerConnection=original;});
  return peers;
}
async function connectedOwner(t){
  const net=fixture(t),peers=fakeRTC(t),seen=[];
  t.mock.timers.enable({apis:["setTimeout"]});
  const transport=createP2PTransport({...settings,verify:async()=>"x",onSession:()=>{},
    onConnected:()=>seen.push("connected"),onDisconnected:(message,retrying)=>seen.push([message,retrying])});
  await transport.join({room:"1".repeat(32),role:"owner",session:"2".repeat(48)});
  await net.sockets[0].onmessage({data:JSON.stringify({type:"roster",count:2})});
  const channel=peers[0].channel;
  channel.readyState="open";channel.onopen();
  channel.onmessage({data:JSON.stringify({type:"sync",game:{board:[]},revision:0})});
  assert.equal(transport.isReady(),true);
  seen.length=0;
  return {...net,peers,seen,transport};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test("a failed direct link rebuilds itself through signaling, not only after reopening",async t=>{
  const {sockets,peers,seen,transport}=await connectedOwner(t);
  peers[0].state("failed");
  assert.equal(peers[0].closed,true);
  assert.equal(sockets[0].closed,true,"signaling is rejoined so the owner offers again");
  assert.deepEqual(seen,[["つながりません",true]]);
  t.mock.timers.tick(1000);await flush();await flush();
  assert.equal(sockets.length,2);
  await sockets[1].onmessage({data:JSON.stringify({type:"roster",count:2})});
  assert.equal(peers.length,2,"a fresh connection is offered");
  transport.leave();
});

test("a direct link that comes back from disconnected restores the game, and one that stays down is rebuilt",async t=>{
  const {sockets,peers,seen,transport}=await connectedOwner(t);
  peers[0].state("disconnected");
  assert.deepEqual(seen,[["つながりません",true]]);
  peers[0].state("connected");
  assert.deepEqual(seen.at(-1),"connected");
  assert.equal(transport.isReady(),true);
  peers[0].state("disconnected");
  t.mock.timers.tick(9999);
  assert.equal(sockets[0].closed,false);
  t.mock.timers.tick(1);
  assert.equal(sockets[0].closed,true);
  assert.equal(peers[0].closed,true);
  transport.leave();
});

test("the other player leaving reads as waiting, and the guest takes a fresh offer as a new connection",async t=>{
  const {sockets,seen,transport}=await connectedOwner(t);
  await sockets[0].onmessage({data:JSON.stringify({type:"roster",count:1})});
  assert.deepEqual(seen.at(-1),["相手を待っています",false]);
  assert.equal(transport.isReady(),false);
  transport.leave();

  const peers=fakeRTC(t);
  const guest=createP2PTransport({...settings,verify:async()=>"x",onSession:()=>{}});
  await guest.join({room:"1".repeat(32),role:"guest",session:"2".repeat(48)});
  const socket=sockets.at(-1);
  await socket.onmessage({data:JSON.stringify({type:"offer",payload:{type:"offer",sdp:"1"}})});
  await socket.onmessage({data:JSON.stringify({type:"offer",payload:{type:"offer",sdp:"2"}})});
  assert.equal(peers.length,2);
  assert.equal(peers[0].closed,true);
  assert.equal(peers[1].remoteDescription.sdp,"2");
  guest.leave();
});

test("a failed request that will be retried says so to the app",async t=>{
  fixture(t);
  t.mock.timers.enable({apis:["setTimeout"]});
  globalThis.fetch=async()=>{throw new TypeError("offline");};
  const errors=[];
  const transport=createP2PTransport({...settings,verify:async()=>"x",onSession:()=>{},onError:e=>errors.push(e)});
  await transport.join({room:"1".repeat(32),role:"guest",session:"2".repeat(48)});
  assert.equal(errors[0].retrying,true);
  transport.leave();
});
