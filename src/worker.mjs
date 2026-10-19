import { DurableObject } from "cloudflare:workers";

const ROOM_RE = /^[a-f0-9]{32}$/;
const STUN = [{ urls: ["stun:stun.cloudflare.com:3478"] }];
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health" && request.method === "GET") {
      // Assert that Cloudflare Builds really published the generated AI assets.
      const assetIsPresent = async (path) => {
        try {
          const target = new URL(path, url.origin);
          const response = await env.ASSETS.fetch(new Request(target, { method: "HEAD" }));
          return response.ok;
        } catch { return false; }
      };
      const [katagoWorkerReady, katagoModelReady] = await Promise.all([
        assetIsPresent("/katago-worker.bundle.mjs"),
        assetIsPresent("/models/katago-small.bin.gz")
      ]);
      return json({
        status: katagoWorkerReady && katagoModelReady ? "ok" : "degraded",
        app: "MieGO",
        durableObjectBinding: Boolean(env.ROOMS),
        turnConfigured: Boolean(env.TURN_KEY_ID && env.TURN_API_TOKEN),
        katagoWorkerReady, katagoModelReady
      });
    }
    if (url.pathname === "/api/rooms" && request.method === "POST") {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      const room = [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
      return json({ room, url: new URL("/?room=" + room, url.origin).href }, 201);
    }
    const match = url.pathname.match(/^\/api\/rooms\/([a-f0-9]{32})\/ws$/);
    if (match && request.method === "GET") {
      if (request.headers.get("Origin") !== url.origin) return json({ error: "Forbidden origin" }, 403);
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return json({ error: "WebSocket upgrade required" }, 426);
      }
      const stub = env.ROOMS.get(env.ROOMS.idFromName(match[1]));
      return stub.fetch(request);
    }
    if (url.pathname === "/api/ice" && request.method === "GET") {
      const room = url.searchParams.get("room");
      if (!room || !ROOM_RE.test(room)) return json({ error: "Invalid room" }, 400);
      if (!env.TURN_KEY_ID || !env.TURN_API_TOKEN) return json({ iceServers: STUN, turnEnabled: false });
      try {
        const result = await fetch(
          "https://rtc.live.cloudflare.com/v1/turn/keys/" + encodeURIComponent(env.TURN_KEY_ID) + "/credentials/generate-ice-servers",
          { method: "POST", headers: {
            Authorization: "Bearer " + env.TURN_API_TOKEN,
            "Content-Type": "application/json"
          }, body: JSON.stringify({ ttl: 14400 }) }
        );
        if (!result.ok) throw new Error("TURN API " + result.status);
        const data = await result.json();
        return json({ iceServers: data.iceServers, turnEnabled: true });
      } catch (error) {
        return json({ iceServers: STUN, turnEnabled: false, warning: "TURN temporarily unavailable" });
      }
    }
    if (url.pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);
    return env.ASSETS.fetch(request);
  }
};

export class GameRoom extends DurableObject {
  peers() {
    return this.ctx.getWebSockets().map(ws => ({ ws, info: ws.deserializeAttachment() })).filter(p => p.info?.seat);
  }
  broadcastRoster() {
    const peers = this.peers();
    for (const p of peers) {
      try { p.ws.send(JSON.stringify({ type: "roster", count: peers.length })); } catch {}
    }
  }
  async fetch(request) {
    const url = new URL(request.url);
    const token = url.searchParams.get("token");
    if (!token || !/^[a-zA-Z0-9-]{12,100}$/.test(token)) return json({ error: "Invalid seat token" }, 400);
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return json({ error: "Upgrade required" }, 426);
    const peers = this.peers();
    const existing = peers.find(p => p.info.token === token);
    if (!existing && peers.length >= 2) return json({ error: "Room is full" }, 409);
    const seat = existing?.info.seat ?? (peers.some(p => p.info.seat === "host") ? "guest" : "host");
    if (existing) {
      try { existing.ws.close(4000, "Reconnected"); } catch {}
    }
    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ seat, token });
    server.send(JSON.stringify({ type: "joined", seat }));
    this.broadcastRoster();
    return new Response(null, { status: 101, webSocket: client });
  }
  webSocketMessage(ws, data) {
    if (typeof data !== "string" || data.length > 64_000) return;
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (!["offer", "answer", "ice"].includes(msg?.type)) return;
    const self = ws.deserializeAttachment();
    for (const peer of this.peers()) {
      if (peer.ws !== ws && peer.info.seat !== self.seat) {
        try { peer.ws.send(JSON.stringify({ type: msg.type, payload: msg.payload })); } catch {}
      }
    }
  }
  webSocketClose() { this.broadcastRoster(); }
  webSocketError() { this.broadcastRoster(); }
}
