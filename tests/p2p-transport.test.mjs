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
