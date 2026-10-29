// Shared helpers for the end-to-end tests.
import assert from "node:assert/strict";

export const BASE = process.env.BASE ?? "http://localhost:8787";
export const WS_BASE = BASE.replace(/^http/, "ws");
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const rand = () => Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

export class Client {
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
  async lobbyWhere(pred, ms) { return this.waitFor((m) => m.t === "lobby" && pred(m), ms); }
  close() { try { this.ws.close(); } catch {} }
}

export async function createRoom() {
  const res = await fetch(`${BASE}/api/rooms`, { method: "POST" });
  assert.equal(res.status, 201);
  const { code } = await res.json();
  assert.match(code, /^[A-HJ-NP-Z]{4}$/);
  return code;
}

export const results = { passed: 0 };
export async function test(name, fn) {
  try { await fn(); results.passed++; console.log("  ✓", name); }
  catch (e) { console.log("  ✗", name, "\n   ", e.message); process.exitCode = 1; }
}

export function done(label) {
  console.log(`\n${label}: ${results.passed} passed${process.exitCode ? ", some FAILED" : ""}`);
}
