import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The Worker runs on workerd; only its base class comes from "cloudflare:workers".
const source = readFileSync(new URL("../src/worker.mjs", import.meta.url), "utf8")
  .replace('import { DurableObject } from "cloudflare:workers";',
    "class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }");
const { default: worker, GameRoom } = await import("data:text/javascript," + encodeURIComponent(source));

function room() {
  const items = new Map(), sockets = [];
  let alarm = null;
  const storage = {
    async get(key) { return items.get(key); },
    async put(key, value) { items.set(key, structuredClone(value)); },
    async delete(keys) { for (const key of [keys].flat()) items.delete(key); },
    async deleteAll() { items.clear(); alarm = null; },
    async list({ prefix }) { return new Map([...items].filter(([key]) => key.startsWith(prefix))); },
    async getAlarm() { return alarm; },
    async setAlarm(time) { alarm = time; }
  };
  const ctx = { storage, getWebSockets: () => sockets };
  return { room: new GameRoom(ctx, {}), items, sockets, alarm: () => alarm };
}
const post = (target, path, data) => target.fetch(new Request("https://room.internal" + path, {
  method: "POST", body: JSON.stringify(data) }));
const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
  new TextEncoder().encode(value))), b => b.toString(16).padStart(2, "0")).join("");

async function created() {
  const r = room(), session = "a".repeat(48);
  const response = await post(r.room, "/init", { ownerKeyHash: await hash("k".repeat(48)),
    guestKeyHash: await hash("g".repeat(48)), ownerSessionHash: await hash(session), ownerColor: "black" });
  assert.equal(response.status, 200);
  return { ...r, session };
}

test("a new room schedules its own deletion at expiry", async () => {
  const r = await created();
  const meta = r.items.get("meta");
  assert.equal(r.alarm(), meta.expires);
  const closed = [];
  r.sockets.push({ deserializeAttachment: () => ({ role: "guest" }), close: (code) => closed.push(code) });
  meta.expires = Date.now() - 1; r.items.set("meta", meta);
  await r.room.alarm();
  assert.equal(r.items.size, 0, "expired rooms keep no storage");
  assert.equal(r.alarm(), null);
  assert.deepEqual(closed, [4003]);
});

test("an alarm before expiry keeps the room and re-arms", async () => {
  const r = await created();
  await r.room.alarm();
  assert.ok(r.items.has("meta"));
  assert.equal(r.alarm(), r.items.get("meta").expires);
});

test("revoking deletes the room, and an expired room is deleted on its next request", async () => {
  const r = await created();
  assert.equal((await post(r.room, "/revoke", { role: "owner", session: r.session })).status, 200);
  assert.equal(r.items.size, 0);
  assert.equal((await post(r.room, "/ticket", { role: "owner", session: r.session })).status, 410);

  const late = await created();
  const meta = late.items.get("meta"); meta.expires = Date.now() - 1; late.items.set("meta", meta);
  assert.equal((await post(late.room, "/ticket", { role: "owner", session: late.session })).status, 410);
  assert.equal(late.items.size, 0);
});

test("unredeemed tickets are dropped once they lapse, and older rooms gain an alarm", async () => {
  const r = await created();
  r.items.set("ticket:old", { role: "owner", expires: Date.now() - 1 });
  r.items.set("ticket:live", { role: "owner", expires: Date.now() + 60000 });
  const response = await post(r.room, "/ticket", { role: "owner", session: r.session });
  assert.equal(response.status, 200);
  assert.equal(r.items.has("ticket:old"), false);
  assert.equal(r.items.has("ticket:live"), true);
  assert.equal([...r.items.keys()].filter(k => k.startsWith("ticket:")).length, 2);

  const legacy = await created();
  await legacy.room.ctx.storage.setAlarm(null);
  await post(legacy.room, "/ticket", { role: "owner", session: legacy.session });
  assert.equal(legacy.alarm(), legacy.items.get("meta").expires);
});

test("a JSON body that is not an object is rejected, not thrown", async () => {
  const r = await created();
  assert.equal((await r.room.fetch(new Request("https://room.internal/ticket", { method: "POST", body: "null" }))).status, 400);
});

test("a seat signed in on another device is counted and the other player told", async () => {
  const r = await created();
  const sent = [], closed = [];
  r.sockets.push({ deserializeAttachment: () => ({ role: "owner" }), send: m => sent.push(JSON.parse(m)), close: c => closed.push(c) });
  const claim = () => post(r.room, "/claim", { role: "guest", key: "g".repeat(48) });
  assert.equal((await claim()).status, 200);
  assert.deepEqual(sent, [], "a guest's first sign-in is not a takeover");
  assert.deepEqual(r.items.get("meta").signins, { owner: 0, guest: 0 });
  assert.equal((await claim()).status, 200);
  assert.deepEqual(sent, [{ type: "signin", signins: { owner: 0, guest: 1 } }]);
  assert.deepEqual(closed, [], "only the replaced seat's own device is closed");
  // The owner's seat link opened on a new device replaces the creator's session.
  r.sockets.length = 0;
  r.sockets.push({ deserializeAttachment: () => ({ role: "owner" }), send: () => {}, close: c => closed.push(c) });
  await post(r.room, "/claim", { role: "owner", key: "k".repeat(48) });
  assert.deepEqual(closed, [4001]);
  assert.deepEqual(r.items.get("meta").signins, { owner: 1, guest: 1 });
});

test("a preview without the GameRoom namespace says so instead of failing", async () => {
  const env = { TURNSTILE_SECRET: "s", TURNSTILE_SITE_KEY: "k" };
  const config = await (await worker.fetch(new Request("https://p.example/api/p2p/config"), env)).json();
  assert.equal(config.rooms, false);
  const response = await worker.fetch(new Request("https://p.example/api/rooms", {
    method: "POST", headers: { Origin: "https://p.example" }, body: "{}" }), env);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "rooms_unavailable");
});
