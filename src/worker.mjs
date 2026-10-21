import { DurableObject } from "cloudflare:workers";

// No TURN credentials are generated. Game positions and moves never enter this Worker.
const MAX_ROOM_AGE = 7 * 24 * 60 * 60 * 1000;
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
const randomHex = length => hex(crypto.getRandomValues(new Uint8Array(length)));
const random = () => randomHex(24);
const hash = async value => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});
async function body(request) {
  if (Number(request.headers.get("content-length") || 0) > 4096) throw Error("Request too large");
  const text = await request.text();
  if (text.length > 4096) throw Error("Request too large");
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid request");
  return value;
}
const sameOrigin = (request, url) => request.headers.get("Origin") === url.origin;

async function verifyHuman(token, request, env) {
  if (!env.TURNSTILE_SECRET || !env.TURNSTILE_SITE_KEY || typeof token !== "string" || token.length > 2048 || token.length < 10) return false;
  let response;
  try {
    response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET, response: token,
        remoteip: request.headers.get("CF-Connecting-IP") || ""
      })
    });
    if (!response.ok) return false;
    const data = await response.json();
    return data.success === true && data.hostname === new URL(request.url).hostname && data.action === "miego_p2p";
  } catch { return false; }
}
// How many times each seat was taken over by another device.
const signinsOf = meta => ({ owner: Number(meta.signins?.owner) || 0, guest: Number(meta.signins?.guest) || 0 });
const roomStub = (env, room) => env.ROOMS.get(env.ROOMS.idFromName(room));
const callRoom = (stub, path, data) => stub.fetch(new Request("https://room.internal" + path, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data)
}));
// The only shape /api/stat takes (public/play-style.mjs statPayload).
function playStyleStat(value) {
  const { size, rules, styles } = value;
  if (![9, 13, 19].includes(size) || !["chinese", "japanese"].includes(rules)) return null;
  if (!Array.isArray(styles) || styles.length < 1 || styles.length > 2) return null;
  if (!styles.every(s => s && ["B", "W"].includes(s.color) && /^[AG][HL][FR][TQ]$/.test(s.type))) return null;
  if (new Set(styles.map(s => s.color)).size !== styles.length) return null;
  return { size, rules, styles: styles.map(({ color, type }) => ({ color, type })) };
}
const inputError = () => json({ error: "Invalid request" }, 400);
export default {
  async fetch(request, env) {
    const url = new URL(request.url), path = url.pathname;
    if (path === "/api/health" && request.method === "GET") {
      const assetIsPresent = async path => {
        try { return (await env.ASSETS.fetch(new Request(new URL(path, url.origin), { method: "HEAD" }))).ok; }
        catch { return false; }
      };
      const [katagoWorkerReady, katagoModelReady] = await Promise.all([
        assetIsPresent("/katago-worker.bundle.mjs"), assetIsPresent("/models/katago-small.f16.bin.gz")
      ]);
      return json({status:katagoWorkerReady&&katagoModelReady?"ok":"degraded",app:"MieGO",
        durableObjectBinding:Boolean(env.ROOMS), turnConfigured:false,
        turnstileConfigured:Boolean(env.TURNSTILE_SECRET&&env.TURNSTILE_SITE_KEY),
        katagoWorkerReady,katagoModelReady});
    }
    if (path === "/api/p2p/config" && request.method === "GET") {
      return json({ siteKey: env.TURNSTILE_SECRET && env.TURNSTILE_SITE_KEY ? env.TURNSTILE_SITE_KEY : null, rooms: Boolean(env.ROOMS) });
    }
    // 棋風診断 counts: board size, rules and each shown type, written to Workers
    // Analytics Engine. No IP, device or game is kept; previews have no STATS and count nothing.
    if (path === "/api/stat" && request.method === "POST") {
      if (!sameOrigin(request,url)) return json({error:"Forbidden origin"},403);
      let payload; try { payload = await body(request); } catch { return inputError(); }
      const stat = playStyleStat(payload);
      if (!stat) return inputError();
      for (const { color, type } of stat.styles)
        env.STATS?.writeDataPoint({ indexes: [type], blobs: [type, color, stat.rules], doubles: [stat.size] });
      return new Response(null, { status: 204 });
    }
    // Branch previews deploy without the GameRoom namespace (wrangler.preview.jsonc).
    if (path.startsWith("/api/rooms") && !env.ROOMS) return json({error:"Rooms unavailable",code:"rooms_unavailable"},503);
    // No API endpoint creates rooms without a successful Turnstile validation.
    if (path === "/api/rooms" && request.method === "POST") {
      if (!sameOrigin(request,url)) return json({error:"Forbidden origin"},403);
      let payload; try { payload = await body(request); } catch { return inputError(); }
      if (!["black","white"].includes(payload.color)) return inputError();
      if (!await verifyHuman(payload.turnstileToken,request,env)) return json({error:"Human verification failed",code:"verification"},403);
      const room = randomHex(16);
      const ownerKey = random(), guestKey = random(), ownerSession = random();
      const setup = await callRoom(roomStub(env,room), "/init", {
        ownerKeyHash:await hash(ownerKey),guestKeyHash:await hash(guestKey),
        ownerSessionHash:await hash(ownerSession), ownerColor:payload.color
      });
      if (!setup.ok) return json({error:"Could not create room",code:"create_failed"},503);
      return json({room, ownerKey, guestKey, ownerSession, ownerColor:payload.color},201);
    }
    const op = path.match(/^\/api\/rooms\/([a-f0-9]{32})\/(claim|ticket|revoke|ws)$/);
    if (op) {
      const [, room, action] = op;
      const stub = roomStub(env,room);
      if (action === "ws" && request.method === "GET") {
        if (!sameOrigin(request,url)) return json({error:"Forbidden origin"},403);
        if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return json({error:"Upgrade required"},426);
        // Only one-time short-lived tickets are placed in WebSocket URLs.
        const ticket = url.searchParams.get("ticket");
        if (!ticket || !/^[a-f0-9]{48}$/.test(ticket)) return json({error:"Invalid ticket"},403);
        return stub.fetch(request);
      }
      if (!["claim","ticket","revoke"].includes(action) || request.method !== "POST") return inputError();
      if (!sameOrigin(request,url)) return json({error:"Forbidden origin"},403);
      let data; try { data = await body(request); } catch { return inputError(); }
      if (action === "claim" && !await verifyHuman(data.turnstileToken,request,env)) return json({error:"Human verification failed",code:"verification"},403);
      return callRoom(stub,"/"+action,data);
    }
    // Legacy clients cannot use the unprotected TURN/STUN discovery API.
    if (path.startsWith("/api/")) return json({error:"Not found"},404);
    return env.ASSETS.fetch(request);
  }
};

export class GameRoom extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.rate = new Map(); }
  peers() {
    return this.ctx.getWebSockets().map(ws=>({ws,info:ws.deserializeAttachment()})).filter(p=>p.info?.role);
  }
  async metadata() {
    const m = await this.ctx.storage.get("meta");
    if (!m) return null;
    if (m.revoked || Date.now()>m.expires) { await this.destroy(); return null; }
    // Rooms created before expiry alarms existed get one on their next use.
    if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(m.expires);
    return m;
  }
  // An expired or revoked room keeps nothing: its sockets close and its storage
  // (alarm included, since compatibility date 2026-02-24) is deleted.
  async destroy(code=4003, reason="Room expired") {
    for (const p of this.peers()) try { p.ws.close(code, reason); } catch {}
    await this.ctx.storage.deleteAll();
  }
  async alarm() {
    const m = await this.ctx.storage.get("meta");
    if (m && !m.revoked && Date.now() < m.expires) { await this.ctx.storage.setAlarm(m.expires); return; }
    await this.destroy();
  }
  // One-time tickets nobody redeemed are dropped once they lapse.
  async dropExpiredTickets() {
    const now = Date.now(), lapsed = [];
    for (const [key, value] of await this.ctx.storage.list({ prefix: "ticket:" }))
      if (!value || now > value.expires) lapsed.push(key);
    if (lapsed.length) await this.ctx.storage.delete(lapsed);
  }
  allowed(kind, max, interval=60000) {
    const now=Date.now(), old=this.rate.get(kind) || {time:now,count:0};
    if (now-old.time>interval) {old.time=now;old.count=0;}
    old.count++;
    this.rate.set(kind,old);
    return old.count<=max;
  }
  broadcastRoster() {
    const count=this.peers().length;
    for (const p of this.peers()) {try{p.ws.send(JSON.stringify({type:"roster",count}));}catch{}}
  }
  async fetch(request) {
    const url=new URL(request.url);
    if (request.method==="POST") {
      let data; try {data=await body(request);} catch {return inputError();}
      if (url.pathname==="/init") {
        if (await this.ctx.storage.get("meta")) return json({error:"Exists"},409);
        if (!["black","white"].includes(data.ownerColor)) return inputError();
        const expires=Date.now()+MAX_ROOM_AGE;
        await this.ctx.storage.put("meta", {...data, expires,revoked:false});
        await this.ctx.storage.setAlarm(expires);
        return json({ok:true});
      }
      let meta=await this.metadata();
      if (!meta) return json({error:"Room expired or removed",code:"room_gone"},410);
      if (url.pathname==="/claim") {
        if (!this.allowed("claim",12)) return json({error:"Too many attempts",code:"rate_limited"},429);
        if (!["owner","guest"].includes(data.role) || typeof data.key!=="string" || data.key.length!==48) return inputError();
        if (await hash(data.key)!==meta[data.role+"KeyHash"]) return json({error:"Invalid invitation",code:"invalid_invitation"},403);
        const session=random();
        // A seat that already had a device is now signed in elsewhere: the
        // other player is told (now, or when it next joins), as is every device.
        const replaced=Boolean(meta[data.role+"SessionHash"]);
        meta[data.role+"SessionHash"]=await hash(session);
        meta.signins=signinsOf(meta);
        if(replaced)meta.signins[data.role]++;
        await this.ctx.storage.put("meta",meta);
        // A new claim replaces any existing device's session for that seat.
        for(const peer of this.peers()){
          if(peer.info.role===data.role)try{peer.ws.close(4001,"New sign-in");}catch{}
          else if(replaced)try{peer.ws.send(JSON.stringify({type:"signin",signins:meta.signins}));}catch{}
        }
        return json({session,role:data.role,ownerColor:meta.ownerColor});
      }
      if (!this.allowed("ticket",30)) return json({error:"Reconnect rate exceeded",code:"rate_limited"},429);
      if (!["owner","guest"].includes(data.role) || typeof data.session!=="string" || data.session.length!==48) return inputError();
      if (await hash(data.session)!==meta[data.role+"SessionHash"]) return json({error:"Session expired",code:"session_expired"},403);
      if (url.pathname==="/revoke") {
        if (data.role!=="owner") return json({error:"Only creator may revoke"},403);
        await this.destroy(4002,"Invitation replaced");
        return json({ok:true});
      }
      if (url.pathname==="/ticket") {
        await this.dropExpiredTickets();
        const ticket=random();
        await this.ctx.storage.put("ticket:"+await hash(ticket),{role:data.role,expires:Date.now()+60000});
        return json({ticket,role:data.role,ownerColor:meta.ownerColor});
      }
      return inputError();
    }
    if (request.headers.get("Upgrade")?.toLowerCase()!=="websocket") return json({error:"Upgrade required"},426);
    const meta=await this.metadata();
    if (!meta || !this.allowed("websocket",30)) return json({error:"Room unavailable"},403);
    const ticket=new URL(request.url).searchParams.get("ticket");
    if (typeof ticket!=="string") return json({error:"Invalid ticket"},403);
    const key="ticket:"+await hash(ticket);
    const claim=await this.ctx.storage.get(key);
    if (!claim || Date.now()>claim.expires) return json({error:"Ticket expired"},403);
    await this.ctx.storage.delete(key);
    for(const p of this.peers())if(p.info.role===claim.role)try{p.ws.close(4000,"Reconnected");}catch{}
    const pair=new WebSocketPair(),client=pair[0],server=pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({role:claim.role});
    server.send(JSON.stringify({type:"joined",role:claim.role,ownerColor:meta.ownerColor,signins:signinsOf(meta)}));
    this.broadcastRoster();
    return new Response(null,{status:101,webSocket:client});
  }
  webSocketMessage(ws,data) {
    if(typeof data!=="string"||data.length>12000)return;
    const role=ws.deserializeAttachment()?.role;
    if(!role||!this.allowed("signal:"+role,120)) {try{ws.close(4008,"Too many signals");}catch{}return;}
    let msg;try{msg=JSON.parse(data);}catch{return;}
    if(!["offer","answer","ice"].includes(msg?.type))return;
    if(msg.type==="offer"&&role!=="owner")return;
    if(msg.type==="answer"&&role!=="guest")return;
    if(JSON.stringify(msg.payload||{}).length>11000)return;
    for(const p of this.peers())if(p.ws!==ws && p.info.role!==role)
      try{p.ws.send(JSON.stringify({type:msg.type,payload:msg.payload}));}catch{}
  }
  webSocketClose(){this.broadcastRoster();}
  webSocketError(){this.broadcastRoster();}
}
