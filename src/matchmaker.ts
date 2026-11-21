// Quick match: one small Durable Object that knows which public rooms are
// open and how full they are. "Play now" asks it for a seat; it hands out the
// fullest open room that still has space, or opens a new one.
//
// Public rooms tell it about themselves whenever their lobby changes. A seat
// handed out is held for a few seconds (until the player has surely arrived),
// so a burst of quick players can't overfill a room.

import { DurableObject } from "cloudflare:workers";
import { CODE_ALPHABET, MAX_PLAYERS } from "./shared";
import type { Env } from "./worker";

export interface OpenRoom {
  code: string;
  open: boolean;      // in the lobby and accepting strangers
  humans: number;
  players: number;    // people and bots
  startsAt: number | null;
  updatedAt: number;
}

const STALE_MS = 2 * 60_000;   // a room that hasn't spoken up in this long is forgotten
const HOLD_MS = 15_000;        // how long a handed-out seat is kept for its player
const LAST_CALL_MS = 4_000;    // don't send people into a room about to start

export class Matchmaker extends DurableObject<Env> {
  private rooms = new Map<string, OpenRoom>();
  private holds = new Map<string, number[]>(); // code → hold expiry times
  private loaded = false;

  private async load() {
    if (this.loaded) return;
    const saved = await this.ctx.storage.get<OpenRoom[]>("rooms");
    for (const r of saved ?? []) this.rooms.set(r.code, r);
    this.loaded = true;
  }

  private async persist() {
    await this.ctx.storage.put("rooms", [...this.rooms.values()]);
  }

  /** A public room reports its state (or that it closed, with open: false). */
  async update(room: Omit<OpenRoom, "updatedAt">): Promise<void> {
    await this.load();
    if (!room.open) this.rooms.delete(room.code);
    else this.rooms.set(room.code, { ...room, updatedAt: Date.now() });
    await this.persist();
  }

  /** Find a seat in an open room, or open a new public room. Returns its code. */
  async quick(): Promise<{ code: string; fresh: boolean }> {
    await this.load();
    const now = Date.now();
    let best: OpenRoom | null = null;
    for (const r of this.rooms.values()) {
      if (now - r.updatedAt > STALE_MS) { this.rooms.delete(r.code); continue; }
      const held = (this.holds.get(r.code) ?? []).filter((t) => t > now);
      this.holds.set(r.code, held);
      if (!r.open || r.players + held.length >= MAX_PLAYERS) continue;
      if (r.startsAt && r.startsAt - now < LAST_CALL_MS) continue;
      // Prefer rooms with more people (more fun), then the one starting soonest.
      if (!best || r.humans > best.humans || (r.humans === best.humans && (r.startsAt ?? Infinity) < (best.startsAt ?? Infinity))) best = r;
    }
    if (best) {
      this.hold(best.code, now);
      return { code: best.code, fresh: false };
    }

    // Nothing open: make a new public room.
    for (let i = 0; i < 8; i++) {
      const code = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
      const stub = this.env.ROOMS.get(this.env.ROOMS.idFromName(code));
      const res = await stub.fetch(new Request(`https://room/api/room/${code}/create?public=1`, { method: "POST" }));
      if (res.status === 409) continue;
      if (!res.ok) throw new Error(`create failed: ${res.status}`);
      this.rooms.set(code, { code, open: true, humans: 0, players: 0, startsAt: null, updatedAt: now });
      this.hold(code, now);
      await this.persist();
      return { code, fresh: true };
    }
    throw new Error("no free room code");
  }

  /** How many public rooms are waiting for players (for the home screen). */
  async openCount(): Promise<{ rooms: number; waiting: number }> {
    await this.load();
    const now = Date.now();
    const open = [...this.rooms.values()].filter((r) => r.open && now - r.updatedAt <= STALE_MS && r.humans > 0);
    return { rooms: open.length, waiting: open.reduce((t, r) => t + r.humans, 0) };
  }

  private hold(code: string, now: number) {
    const held = (this.holds.get(code) ?? []).filter((t) => t > now);
    held.push(now + HOLD_MS);
    this.holds.set(code, held);
  }
}
