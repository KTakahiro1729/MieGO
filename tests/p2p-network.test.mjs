import test from "node:test";
import assert from "node:assert/strict";
import {postP2PJson,reconnectDelay,isTerminalTicketFailure,signalingUrl} from "../public/p2p-network.mjs";
import { TEXT } from "../public/texts.mjs";

test("P2P JSON API sends unchanged POST envelopes and handles server errors",async()=>{
  const requests=[];
  const fetchRequest=async(path,options)=>{
    requests.push({path,options});
    return {ok:true,status:200,json:async()=>({ticket:"abc"})};
  };
  assert.deepEqual(await postP2PJson("/api/rooms/xyz/ticket",{role:"guest",session:"t"},fetchRequest),{ticket:"abc"});
  assert.equal(requests[0].path,"/api/rooms/xyz/ticket");
  assert.equal(requests[0].options.method,"POST");
  assert.equal(requests[0].options.headers["content-type"],"application/json");
  assert.deepEqual(JSON.parse(requests[0].options.body),{role:"guest",session:"t"});
  // The server's English text is kept for logs; its code picks the player's message.
  await assert.rejects(()=>postP2PJson("/bad",{},async()=>({ok:false,status:403,json:async()=>({error:"Too many attempts",code:"rate_limited"})})),
    error=>error.message===TEXT.online.rateLimited&&error.status===403&&error.serverError==="Too many attempts");
  await assert.rejects(()=>postP2PJson("/bad",{},async()=>({ok:false,status:403,json:async()=>({error:"forbidden"})})),
    error=>error.message===TEXT.online.requestFailed);
  await assert.rejects(()=>postP2PJson("/bad",{},async()=>{throw TypeError("Failed to fetch");}),
    error=>error.message===TEXT.online.requestFailed);
  await assert.rejects(()=>postP2PJson("/bad",{},async()=>({ok:false,status:500,json:async()=>({})})),
    error=>error.message===TEXT.online.requestFailed&&error.status===500);
  await assert.rejects(()=>postP2PJson("/bad",{},async()=>({ok:false,json:async()=>{throw Error("unparseable");}})),
    error=>error.message===TEXT.online.requestFailed);
});

test("retry policy maintains exponential delay, cap and terminal HTTP statuses",()=>{
  assert.deepEqual([0,1,2,3,4,5,6,10].map(reconnectDelay),
    [1000,2000,4000,8000,16000,30000,30000,30000]);
  for(const status of [401,403,404,410])assert.equal(isTerminalTicketFailure(status),true);
  for(const status of [undefined,429,500,503])assert.equal(isTerminalTicketFailure(status),false);
});

test("signaling URL selects WSS on HTTPS and encodes the ticket as a parameter",()=>{
  const location={protocol:"https:",host:"miego.example"};
  assert.equal(signalingUrl(location,"abc","part/with?special"),"wss://miego.example/api/rooms/abc/ws?ticket=part%2Fwith%3Fspecial");
  assert.equal(signalingUrl({protocol:"http:",host:"localhost:8787"},"abc","value"),
    "ws://localhost:8787/api/rooms/abc/ws?ticket=value");
});

test("every server error code the client explains is sent by the worker",async()=>{
  const {readFileSync}=await import("node:fs");
  const worker=readFileSync(new URL("../src/worker.mjs",import.meta.url),"utf8");
  const client=readFileSync(new URL("../public/p2p-network.mjs",import.meta.url),"utf8");
  const codes=[...client.slice(client.indexOf("SERVER_ERRORS"),client.indexOf("};")).matchAll(/^\s*(\w+):/gm)].map(m=>m[1]);
  assert.ok(codes.length>=5);
  for(const code of codes)assert.match(worker,new RegExp('code:"'+code+'"'),code);
});
