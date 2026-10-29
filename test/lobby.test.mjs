// End-to-end lobby test against a running server.
// Usage: BASE=http://localhost:8787 node test/lobby.test.mjs
import assert from "node:assert/strict";

const BASE = process.env.BASE ?? "http://localhost:8787";
const WS_BASE = BASE.replace(/^http/, "ws");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = () => Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

class Client {
  constructor(code, name, id = { playerId: "p-" + rand().slice(0, 16), token: rand() + rand() }) {
    this.code = code; this.name = name; this.id = id; this.msgs = []; this.closed = null;
  }
  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${WS_BASE}/api/room/${this.code}/ws`);
      this.ws.onmessage = (e) => { if (e.data !== "pong") this.msgs.push(JSON.parse(e.data)); };
      this.ws.onclose = (e) => { this.closed = e.code; };
      this.ws.onopen = () => resolve(this);
      this.ws.onerror = () => reject(new Error("ws error"));
    });
  }
  async join() {
    await this.open();
    this.send({ t: "join", ...this.id, name: this.name });
    await this.waitFor((m) => m.t === "welcome" || m.t === "error");
    return this;
  }
  send(m) { this.ws.send(typeof m === "string" ? m : JSON.stringify(m)); }
  last(t) { return [...this.msgs].reverse().find((m) => m.t === t); }
  async waitFor(pred, ms = 3000) {
    const start = Date.now();
    while (Date.now() - start < ms) {
      const m = this.msgs.find(pred);
      if (m) return m;
      await sleep(25);
    }
    throw new Error(`${this.name}: timed out; got ${JSON.stringify(this.msgs.slice(-3))}`);
  }
  async lobbyWhere(pred) { return this.waitFor((m) => m.t === "lobby" && pred(m)); }
  close() { try { this.ws.close(); } catch {} }
}

async function createRoom() {
  const res = await fetch(`${BASE}/api/rooms`, { method: "POST" });
  assert.equal(res.status, 201);
  const { code } = await res.json();
  assert.match(code, /^[A-HJ-NP-Z]{4}$/);
  return code;
}

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ✓", name); }
  catch (e) { console.log("  ✗", name, "\n   ", e.message); process.exitCode = 1; }
}

console.log("Shadow Haven lobby tests");

await test("health", async () => {
  const r = await (await fetch(`${BASE}/api/health`)).json();
  assert.equal(r.ok, true);
});

await test("unknown and malformed room codes", async () => {
  assert.equal((await fetch(`${BASE}/api/room/ZZZZ`)).status, 404);
  assert.equal((await fetch(`${BASE}/api/room/12`)).status, 400);
  const opened = await new Promise((resolve) => {
    const ws = new WebSocket(`${WS_BASE}/api/room/ZZZZ/ws`);
    ws.onopen = () => { ws.close(); resolve(true); };
    ws.onerror = () => resolve(false);
  });
  assert.equal(opened, false, "can't open a socket into a room that doesn't exist");
});

await test("invite links serve the app", async () => {
  const html = await (await fetch(`${BASE}/r/ABCD`)).text();
  assert.match(html, /<title>Shadow Haven<\/title>/);
});

await test("create, join, host, colors, live list", async () => {
  const code = await createRoom();
  const info = await (await fetch(`${BASE}/api/room/${code}`)).json();
  assert.equal(info.players, 0);

  const a = await new Client(code, "Wren").join();
  const welcome = a.last("welcome");
  assert.equal(welcome.code, code);
  let l = await a.lobbyWhere((m) => m.players.length === 1);
  assert.equal(l.hostId, a.id.playerId);

  const b = await new Client(code, "wren").join(); // duplicate name, different case
  l = await a.lobbyWhere((m) => m.players.length === 2);
  const names = l.players.map((p) => p.name);
  assert.deepEqual(names, ["Wren", "wren 2"]);
  assert.notEqual(l.players[0].lantern, l.players[1].lantern);
  a.close(); b.close();
});

await test("only the host can add bots; bots fill to start; cap at 10", async () => {
  const code = await createRoom();
  const host = await new Client(code, "Host").join();
  const guest = await new Client(code, "Guest").join();

  guest.send({ t: "addBot" });
  const err = await guest.waitFor((m) => m.t === "error" && m.code === "not_host");
  assert.ok(err);

  host.send({ t: "start" });
  await host.waitFor((m) => m.t === "error" && m.code === "not_enough");

  for (let i = 0; i < 10; i++) host.send({ t: "addBot" });
  const full = await host.lobbyWhere((m) => m.players.length === 10);
  const bots = full.players.filter((p) => p.isBot);
  assert.equal(bots.length, 8);
  assert.ok(bots.every((p) => p.connected));
  assert.equal(new Set(full.players.map((p) => p.lantern)).size, 10);
  await host.waitFor((m) => m.t === "error" && m.code === "full");

  const late = await new Client(code, "Late").join();
  assert.equal(late.last("error")?.code, "full");

  host.send({ t: "removePlayer", id: bots[0].id });
  await host.lobbyWhere((m) => m.players.length === 9);

  host.send({ t: "start" });
  await guest.waitFor((m) => m.t === "notice");
  host.close(); guest.close(); late.close();
});

await test("refresh keeps your seat; wrong token can't steal it", async () => {
  const code = await createRoom();
  const a = await new Client(code, "Ada").join();
  const watcher = await new Client(code, "Watcher").join();
  a.close();
  await watcher.lobbyWhere((m) => m.players.find((p) => p.name === "Ada" && !p.connected));

  const thief = await new Client(code, "Thief", { playerId: a.id.playerId, token: rand() + rand() }).join();
  assert.equal(thief.last("error")?.code, "bad_identity");

  const again = await new Client(code, "Ada", a.id).join();
  assert.equal(again.last("welcome")?.you, a.id.playerId);
  const l = await watcher.lobbyWhere((m) => m.players.find((p) => p.name === "Ada" && p.connected));
  assert.equal(l.players.length, 2);
  assert.equal(l.hostId, a.id.playerId, "host keeps host after a quick refresh");
  again.close(); watcher.close(); thief.close();
});

await test("second tab replaces the first", async () => {
  const code = await createRoom();
  const tab1 = await new Client(code, "Twin").join();
  const tab2 = await new Client(code, "Twin", tab1.id).join();
  await tab1.waitFor((m) => m.t === "error" && m.code === "replaced");
  await sleep(200);
  assert.equal(tab1.closed, 4000);
  const l = tab2.last("lobby");
  assert.equal(l.players.length, 1);
  tab2.close();
});

await test("host leaving hands host to the next human", async () => {
  const code = await createRoom();
  const host = await new Client(code, "Host").join();
  const next = await new Client(code, "Next").join();
  host.send({ t: "addBot" });
  await next.lobbyWhere((m) => m.players.length === 3);
  host.send({ t: "leave" });
  const l = await next.lobbyWhere((m) => !m.players.some((p) => p.id === host.id.playerId));
  assert.equal(l.players.length, 2);
  assert.equal(l.hostId, next.id.playerId);
  next.close();
});

await test("bad input is rejected", async () => {
  const code = await createRoom();
  const c = new Client(code, "x");
  await c.open();
  c.send({ t: "addBot" });
  await c.waitFor((m) => m.code === "not_joined");
  c.send("not json");
  await c.waitFor((m) => m.code === "bad_message");
  c.send({ t: "join", ...c.id, name: "   " });
  await c.waitFor((m) => m.code === "bad_name");
  c.send({ t: "join", ...c.id, name: "<b>Evil</b>Name!!!!!!!!" });
  const l = await c.waitFor((m) => m.t === "lobby");
  assert.equal(l.players[0].name, "bEvil/bName!!!!!");
  c.send("ping");
  c.close();
});

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
process.exit(process.exitCode ?? 0);
