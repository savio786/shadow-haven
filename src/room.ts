// One Durable Object instance = one game room.
//
// Lobby → reveal → playing. Players connect over WebSockets (Hibernation API).
// While playing, players walk the harbor and only ever learn who is in the
// same location as them ("fog"). Bots think on a timer driven by the room's
// alarm and see exactly what a human in their place would see.

import { DurableObject } from "cloudflare:workers";
import type { Env } from "./worker";
import {
  BOT_NAMES, LANTERNS, MAX_PLAYERS, MIN_PLAYERS, MOVE_COOLDOWN_MS, NAME_MAX, REVEAL_MS, SHAPES, shadeCount,
  type ClientMsg, type Phase, type PublicPlayer, type Role, type ServerMsg,
} from "./shared";
import { PATHS, START, adjacent, isLoc, type Loc } from "./harbor";
import { decide, newBrain, observe, type Brain } from "./bots";

interface Player {
  id: string;
  name: string;
  tokenHash: string | null; // null for bots
  lantern: string;
  shape: PublicPlayer["shape"];
  isBot: boolean;
  joinedAt: number;
  disconnectedAt: number | null; // humans only
  role: Role | null;             // secret; only ever sent to this player
  loc: Loc | null;               // secret; only shared with people in the same place
  readyAt: number;               // can't move again before this (ms)
  brain?: Brain;                 // bots only
}

interface RoomState {
  code: string;
  created: boolean;
  createdAt: number;
  phase: Phase;
  hostId: string | null;
  players: Player[];
  revealEndsAt: number | null;
}

function emptyRoom(): RoomState {
  return { code: "", created: false, createdAt: 0, phase: "lobby", hostId: null, players: [], revealEndsAt: null };
}

interface SocketInfo {
  pid: string | null; // set after a successful "join"
  win: number;        // rate-limit window start (ms)
  n: number;          // messages in window
}

const EMPTY_ROOM_TTL = 10 * 60_000;   // delete a room nobody is connected to
const LOBBY_SEAT_HOLD = 2 * 60_000;   // keep a dropped player's seat this long
const HOST_HANDOVER = 60_000;         // pass host on if the host is gone this long
const SAVE_EVERY = 10_000;            // during play, persist at most this often
const MAX_MSG_BYTES = 2048;
const MAX_MSGS_PER_SEC = 20;

export class Room extends DurableObject<Env> {
  private state!: RoomState;
  private dirty = false;
  private lastSaveAt = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Keep-alive pings are answered by Cloudflare without waking the room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<RoomState>("state");
      // Fill in any fields added since the room was saved.
      this.state = { ...emptyRoom(), ...saved };
      this.state.players = this.state.players.map((p) => ({
        ...p, role: p.role ?? null, loc: p.loc ?? null, readyAt: p.readyAt ?? 0,
      }));
    });
  }

  // ---------- HTTP entry (forwarded by the Worker) ----------

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const [, , , code, action] = url.pathname.split("/"); // /api/room/CODE/action

    if (action === "create" && request.method === "POST") {
      if (this.state.created) return Response.json({ error: "taken" }, { status: 409 });
      this.state = { ...this.state, code, created: true, createdAt: Date.now() };
      await this.save();
      await this.scheduleAlarm();
      return Response.json({ code });
    }

    if (!this.state.created) {
      return Response.json({ error: "no_room", text: "No room with that code." }, { status: 404 });
    }

    if (action === "ws") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Expected a WebSocket", { status: 426 });
      }
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ pid: null, win: Date.now(), n: 0 } satisfies SocketInfo);
      return new Response(null, { status: 101, webSocket: client });
    }

    if (!action) {
      return Response.json({
        code: this.state.code,
        phase: this.state.phase,
        players: this.state.players.length,
        max: MAX_PLAYERS,
        full: this.state.players.length >= MAX_PLAYERS,
      });
    }

    return Response.json({ error: "not_found" }, { status: 404 });
  }

  // ---------- WebSocket events (Hibernation API) ----------

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const info = ws.deserializeAttachment() as SocketInfo;

    // Basic flood protection.
    const now = Date.now();
    if (now - info.win > 1000) { info.win = now; info.n = 0; }
    info.n++;
    ws.serializeAttachment(info);
    if (info.n > MAX_MSGS_PER_SEC) return;

    if (typeof raw !== "string" || raw.length > MAX_MSG_BYTES) {
      return this.send(ws, { t: "error", code: "bad_message", text: "Message too large." });
    }

    let msg: ClientMsg;
    try { msg = JSON.parse(raw); } catch {
      return this.send(ws, { t: "error", code: "bad_message", text: "Not JSON." });
    }

    if (msg.t === "ping") return this.send(ws, { t: "pong" });
    if (msg.t === "join") return this.onJoin(ws, info, msg);

    const me = info.pid ? this.player(info.pid) : undefined;
    if (!me) return this.send(ws, { t: "error", code: "not_joined", text: "Join the room first." });

    switch (msg.t) {
      case "rename": return this.onRename(ws, me, msg.name);
      case "addBot": return this.onAddBot(ws, me);
      case "removePlayer": return this.onRemove(ws, me, msg.id);
      case "start": return this.onStart(ws, me);
      case "endGame": return this.onEndGame(ws, me);
      case "move": return this.onMove(ws, me, msg.to);
      case "leave": return this.onLeave(ws, me);
      default: return this.send(ws, { t: "error", code: "unknown", text: "Unknown message." });
    }
  }

  async webSocketClose(ws: WebSocket) {
    await this.onSocketGone(ws);
  }

  async webSocketError(ws: WebSocket) {
    await this.onSocketGone(ws);
  }

  /**
   * The room's heartbeat: ends the reveal, lets bots think, frees seats of
   * players who dropped, hands over host, saves, and deletes empty rooms.
   */
  async alarm() {
    const now = Date.now();
    const s = this.state;
    let lobbyChanged = false;

    if (s.phase === "reveal" && s.revealEndsAt && now >= s.revealEndsAt) {
      s.phase = "playing";
      s.revealEndsAt = null;
      lobbyChanged = true;
      this.dirty = true;
      // Everyone opens their eyes in the market square.
      this.refresh([START], now);
    }

    if (s.phase === "playing" && this.anyHumanHere()) this.botTick(now);

    if (s.phase === "lobby") {
      const before = s.players.length;
      s.players = s.players.filter(
        (p) => p.isBot || this.isConnected(p.id) || !p.disconnectedAt || now - p.disconnectedAt < LOBBY_SEAT_HOLD,
      );
      if (s.players.length !== before) {
        lobbyChanged = true;
        this.dirty = true;
        if (!this.player(s.hostId)) s.hostId = null;
      }
    }

    const host = this.player(s.hostId);
    if (!host || (!this.isConnected(host.id) && host.disconnectedAt && now - host.disconnectedAt >= HOST_HANDOVER)) {
      const next = this.humans().find((p) => this.isConnected(p.id));
      if (next && next.id !== s.hostId) {
        s.hostId = next.id;
        lobbyChanged = true;
        this.dirty = true;
      }
    }

    if (!this.anyHumanHere() && now - this.lastHumanSeen() >= EMPTY_ROOM_TTL) {
      await this.ctx.storage.deleteAll();
      this.state = emptyRoom();
      this.dirty = false;
      return;
    }

    if (this.dirty && (lobbyChanged || s.phase !== "playing" || now - this.lastSaveAt >= SAVE_EVERY)) {
      await this.save();
    }
    if (lobbyChanged) this.broadcastLobby();
    await this.scheduleAlarm();
  }

  // ---------- Handlers ----------

  private async onJoin(ws: WebSocket, info: SocketInfo, msg: Extract<ClientMsg, { t: "join" }>) {
    const id = String(msg.playerId ?? "");
    const token = String(msg.token ?? "");
    if (!/^[\w-]{8,40}$/.test(id) || token.length < 16 || token.length > 64) {
      return this.send(ws, { t: "error", code: "bad_identity", text: "Bad player identity." });
    }
    const name = cleanName(msg.name);
    if (!name) return this.send(ws, { t: "error", code: "bad_name", text: "Pick a name (1–16 characters)." });

    const hash = await sha256(token);
    let me = this.player(id);

    if (me) {
      // Returning player (refresh / reconnect). Must prove it's them.
      if (me.tokenHash !== hash) {
        return this.send(ws, { t: "error", code: "bad_identity", text: "That seat belongs to someone else." });
      }
      // Close any older socket for this player.
      for (const other of this.ctx.getWebSockets()) {
        if (other !== ws && (other.deserializeAttachment() as SocketInfo).pid === id) {
          this.send(other, { t: "error", code: "replaced", text: "You joined from another tab." });
          try { other.close(4000, "replaced"); } catch {}
        }
      }
      me.name = this.uniqueName(name, me.id);
      me.disconnectedAt = null;
    } else {
      if (this.state.phase !== "lobby") {
        return this.send(ws, { t: "error", code: "in_progress", text: "That game has already started." });
      }
      if (this.state.players.length >= MAX_PLAYERS) {
        return this.send(ws, { t: "error", code: "full", text: "That room is full (10 Keepers)." });
      }
      me = {
        id,
        name: this.uniqueName(name),
        tokenHash: hash,
        ...this.nextLantern(),
        isBot: false,
        joinedAt: Date.now(),
        disconnectedAt: null,
        role: null,
        loc: null,
        readyAt: 0,
      };
      this.state.players.push(me);
    }

    // No host yet (new room, or the host left): the joining human takes over.
    if (!this.player(this.state.hostId)) this.state.hostId = me.id;

    info.pid = me.id;
    ws.serializeAttachment(info);
    await this.save();
    this.send(ws, { t: "welcome", you: me.id, code: this.state.code });
    // A player rejoining mid-game gets their own role and surroundings back.
    if (me.role) this.sendRole(ws, me);
    if (this.state.phase === "playing" && me.loc) this.sendView(ws, me);
    this.broadcastLobby();
    // Bots pause while nobody is connected; make sure they wake up again.
    await this.scheduleAlarm();
  }

  private async onRename(ws: WebSocket, me: Player, raw: string) {
    const name = cleanName(raw);
    if (!name) return this.send(ws, { t: "error", code: "bad_name", text: "Pick a name (1–16 characters)." });
    me.name = this.uniqueName(name, me.id);
    await this.save();
    this.broadcastLobby();
  }

  private async onAddBot(ws: WebSocket, me: Player) {
    if (!this.requireHost(ws, me) || !this.requireLobby(ws)) return;
    if (this.state.players.length >= MAX_PLAYERS) {
      return this.send(ws, { t: "error", code: "full", text: "The room is full." });
    }
    const used = new Set(this.state.players.map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? this.uniqueName("Keeper");
    this.state.players.push({
      id: "bot-" + crypto.randomUUID().slice(0, 8),
      name,
      tokenHash: null,
      ...this.nextLantern(),
      isBot: true,
      joinedAt: Date.now(),
      disconnectedAt: null,
      role: null,
      loc: null,
      readyAt: 0,
    });
    await this.save();
    this.broadcastLobby();
  }

  private async onRemove(ws: WebSocket, me: Player, targetId: string) {
    if (!this.requireHost(ws, me) || !this.requireLobby(ws)) return;
    const target = this.player(targetId);
    if (!target || target.id === me.id) return;
    this.state.players = this.state.players.filter((p) => p.id !== target.id);
    for (const other of this.ctx.getWebSockets()) {
      if ((other.deserializeAttachment() as SocketInfo).pid === target.id) {
        this.send(other, { t: "error", code: "removed", text: "The host removed you from the room." });
        try { other.close(4001, "removed"); } catch {}
      }
    }
    await this.save();
    this.broadcastLobby();
  }

  private async onStart(ws: WebSocket, me: Player) {
    if (!this.requireHost(ws, me) || !this.requireLobby(ws)) return;
    if (this.state.players.length < MIN_PLAYERS) {
      return this.send(ws, { t: "error", code: "not_enough", text: `Need at least ${MIN_PLAYERS} Keepers — add bots to fill seats.` });
    }

    // Pick the Shades uniformly at random from everyone, bots included.
    const order = shuffle(this.state.players.map((p) => p.id));
    const shades = new Set(order.slice(0, shadeCount(this.state.players.length)));
    const now = Date.now();
    const playFrom = now + REVEAL_MS;
    for (const p of this.state.players) {
      p.role = shades.has(p.id) ? "shade" : "keeper";
      p.loc = START;
      p.readyAt = playFrom;
      if (p.isBot) p.brain = newBrain(playFrom);
    }

    this.state.phase = "reveal";
    this.state.revealEndsAt = playFrom;
    await this.save();

    // Each human hears only their own role.
    for (const sock of this.ctx.getWebSockets()) {
      const p = this.player((sock.deserializeAttachment() as SocketInfo).pid);
      if (p) this.sendRole(sock, p);
    }
    this.broadcastLobby();
    await this.scheduleAlarm();
  }

  private async onEndGame(ws: WebSocket, me: Player) {
    if (!this.requireHost(ws, me)) return;
    if (this.state.phase === "lobby") return;
    this.state.phase = "lobby";
    this.state.revealEndsAt = null;
    for (const p of this.state.players) {
      p.role = null;
      p.loc = null;
      p.readyAt = 0;
      delete p.brain;
    }
    await this.save();
    this.broadcast({ t: "notice", text: "The host called everyone back to the lobby." });
    this.broadcastLobby();
    await this.scheduleAlarm();
  }

  private async onMove(ws: WebSocket, me: Player, to: unknown) {
    if (this.state.phase !== "playing" || !me.loc) {
      return this.send(ws, { t: "error", code: "not_playing", text: "You can't move right now." });
    }
    if (!isLoc(to) || !adjacent(me.loc, to)) {
      return this.send(ws, { t: "error", code: "bad_move", text: "There's no path from here to there." });
    }
    const now = Date.now();
    if (now < me.readyAt) {
      // Too soon: just remind them where they are and when they can go.
      return this.sendView(ws, me);
    }
    this.moveTo(me, to, now);
    await this.scheduleAlarm(); // make sure the move gets saved soon
  }

  private async onLeave(ws: WebSocket, me: Player) {
    if (this.state.phase !== "lobby") {
      // Mid-game the seat stays (your role is part of the game); you just disconnect.
      me.disconnectedAt = Date.now();
      if (this.state.hostId === me.id) {
        const next = this.humans().find((p) => p.id !== me.id && this.isConnected(p.id, ws));
        if (next) this.state.hostId = next.id;
      }
      const info = ws.deserializeAttachment() as SocketInfo;
      info.pid = null;
      ws.serializeAttachment(info);
      try { ws.close(1000, "left"); } catch {}
      await this.save();
      this.broadcastLobby(ws);
      await this.scheduleAlarm();
      return;
    }
    this.state.players = this.state.players.filter((p) => p.id !== me.id);
    if (this.state.hostId === me.id) {
      this.state.hostId = this.humans().find((p) => this.isConnected(p.id, ws))?.id ?? null;
    }
    const info = ws.deserializeAttachment() as SocketInfo;
    info.pid = null;
    ws.serializeAttachment(info);
    try { ws.close(1000, "left"); } catch {}
    await this.save();
    this.broadcastLobby(ws);
    await this.scheduleAlarm();
  }

  private async onSocketGone(ws: WebSocket) {
    try { ws.close(1000, "bye"); } catch {}
    const pid = (ws.deserializeAttachment() as SocketInfo | null)?.pid;
    const p = pid ? this.player(pid) : undefined;
    if (p && !this.isConnected(p.id, ws)) {
      p.disconnectedAt = Date.now();
      await this.save();
    }
    this.broadcastLobby(ws);
    await this.scheduleAlarm();
  }

  // ---------- The harbor ----------

  /** Move a player (human or bot) and update everyone who can see it happen. */
  private moveTo(p: Player, to: Loc, now: number) {
    const from = p.loc;
    p.loc = to;
    p.readyAt = now + MOVE_COOLDOWN_MS;
    if (p.brain) p.brain.cameFrom = from;
    this.dirty = true;
    this.refresh(from ? [from, to] : [to], now);
  }

  /** Everyone standing in these places looks around again. */
  private refresh(locs: Loc[], now: number) {
    const sockets = this.socketsByPlayer();
    for (const p of this.state.players) {
      if (!p.loc || !locs.includes(p.loc)) continue;
      if (p.brain) observe(p.brain, p.loc, this.idsAt(p.loc, p.id), now);
      for (const ws of sockets.get(p.id) ?? []) this.sendView(ws, p);
    }
  }

  /** Let every bot whose turn has come decide what to do. */
  private botTick(now: number) {
    for (const bot of this.state.players) {
      if (!bot.brain || !bot.loc || !bot.role || now < bot.brain.nextMoveAt) continue;
      const allies = bot.role === "shade"
        ? this.state.players.filter((o) => o.role === "shade" && o.id !== bot.id).map((o) => o.id)
        : [];
      const choice = decide(bot.brain, bot.loc, bot.role, allies, now);
      if (choice.to && adjacent(bot.loc, choice.to) && now >= bot.readyAt) this.moveTo(bot, choice.to, now);
      bot.brain.nextMoveAt = now + Math.max(choice.dwellMs, MOVE_COOLDOWN_MS);
      this.dirty = true;
    }
  }

  private idsAt(loc: Loc, except?: string) {
    return this.state.players.filter((o) => o.loc === loc && o.id !== except).map((o) => o.id);
  }

  private sendView(ws: WebSocket, p: Player) {
    if (!p.loc) return;
    this.send(ws, {
      t: "view",
      here: p.loc,
      neighbors: PATHS[p.loc],
      present: this.idsAt(p.loc, p.id),
      readyAt: p.readyAt,
      now: Date.now(), // lets the client correct for its own clock being off
    });
  }

  // ---------- Helpers ----------

  private player(id: string | null | undefined) {
    return id ? this.state.players.find((p) => p.id === id) : undefined;
  }

  private humans() {
    return this.state.players.filter((p) => !p.isBot);
  }

  private anyHumanHere() {
    return this.humans().some((p) => this.isConnected(p.id));
  }

  private lastHumanSeen() {
    return Math.max(this.state.createdAt, ...this.humans().map((p) => p.disconnectedAt ?? 0));
  }

  /** Is this player connected on any open socket (optionally ignoring one that's closing)? */
  private isConnected(pid: string, ignore?: WebSocket) {
    return this.ctx.getWebSockets().some(
      (ws) => ws !== ignore && ws.readyState === WebSocket.OPEN &&
        (ws.deserializeAttachment() as SocketInfo).pid === pid,
    );
  }

  private socketsByPlayer() {
    const map = new Map<string, WebSocket[]>();
    for (const ws of this.ctx.getWebSockets()) {
      const pid = (ws.deserializeAttachment() as SocketInfo).pid;
      if (!pid) continue;
      map.set(pid, [...(map.get(pid) ?? []), ws]);
    }
    return map;
  }

  private nextLantern(): Pick<Player, "lantern" | "shape"> {
    const used = new Set(this.state.players.map((p) => p.lantern));
    const i = LANTERNS.findIndex((l) => !used.has(l.id));
    const idx = i === -1 ? 0 : i;
    return { lantern: LANTERNS[idx].id, shape: SHAPES[idx % SHAPES.length] };
  }

  private uniqueName(name: string, selfId?: string) {
    const taken = new Set(this.state.players.filter((p) => p.id !== selfId).map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; ; i++) {
      const candidate = `${name.slice(0, NAME_MAX - 2)} ${i}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  private requireHost(ws: WebSocket, me: Player) {
    if (this.state.hostId === me.id) return true;
    this.send(ws, { t: "error", code: "not_host", text: "Only the host can do that." });
    return false;
  }

  private requireLobby(ws: WebSocket) {
    if (this.state.phase === "lobby") return true;
    this.send(ws, { t: "error", code: "in_progress", text: "The game has already started." });
    return false;
  }

  private sendRole(ws: WebSocket, p: Player) {
    if (!p.role) return;
    const allies = p.role === "shade"
      ? this.state.players.filter((o) => o.role === "shade" && o.id !== p.id).map((o) => o.id)
      : [];
    this.send(ws, { t: "role", role: p.role, allies });
  }

  private lobbyMsg(ignore?: WebSocket): ServerMsg {
    const s = this.state;
    return {
      t: "lobby",
      phase: s.phase,
      hostId: s.hostId,
      min: MIN_PLAYERS,
      max: MAX_PLAYERS,
      shades: s.phase === "lobby"
        ? shadeCount(Math.max(s.players.length, MIN_PLAYERS))
        : s.players.filter((p) => p.role === "shade").length,
      revealEndsAt: s.revealEndsAt,
      players: this.state.players.map((p) => ({
        id: p.id,
        name: p.name,
        lantern: p.lantern,
        shape: p.shape,
        isBot: p.isBot,
        isHost: p.id === this.state.hostId,
        connected: p.isBot || this.isConnected(p.id, ignore),
      })),
    };
  }

  private broadcastLobby(ignore?: WebSocket) {
    this.broadcast(this.lobbyMsg(ignore), ignore);
  }

  private broadcast(msg: ServerMsg, ignore?: WebSocket) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === ignore) continue;
      if (!(ws.deserializeAttachment() as SocketInfo).pid) continue;
      try { ws.send(data); } catch {}
    }
  }

  private send(ws: WebSocket, msg: ServerMsg) {
    try { ws.send(JSON.stringify(msg)); } catch {}
  }

  private async save() {
    await this.ctx.storage.put("state", this.state);
    this.dirty = false;
    this.lastSaveAt = Date.now();
  }

  /** Wake up when the next thing is due: a bot's turn, a save, or housekeeping. */
  private async scheduleAlarm() {
    const now = Date.now();
    const s = this.state;
    const times: number[] = [];
    if (s.revealEndsAt) times.push(s.revealEndsAt);
    if (s.phase === "playing" && this.anyHumanHere()) {
      for (const p of s.players) if (p.brain) times.push(p.brain.nextMoveAt);
    }
    if (this.dirty) times.push(this.lastSaveAt + SAVE_EVERY);
    for (const p of this.humans()) {
      if (p.disconnectedAt && !this.isConnected(p.id)) {
        times.push(p.disconnectedAt + HOST_HANDOVER, p.disconnectedAt + LOBBY_SEAT_HOLD);
      }
    }
    if (!this.anyHumanHere()) times.push(this.lastHumanSeen() + EMPTY_ROOM_TTL);

    if (!times.length) return;
    const next = Math.max(now + 50, Math.min(...times));
    await this.ctx.storage.setAlarm(next);
  }
}

/** Fisher–Yates shuffle using the platform's cryptographic random source. */
function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const r = crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
    const j = Math.floor(r * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function cleanName(raw: unknown) {
  return String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAME_MAX);
}

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
