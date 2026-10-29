// One Durable Object instance = one game room.
//
// Lobby → reveal → playing ⇄ meeting → ended. Players connect over WebSockets
// (Hibernation API). While playing, players walk the harbor and only ever learn
// who is in the same location as them ("fog"). Shades can snuff a Keeper's
// lantern; the snuffed become wisps the living can't see. Finding a cold
// lantern and reporting it gathers everyone at the Harbor Bell. Bots think on
// a timer driven by the room's alarm and see exactly what a human would.

import { DurableObject } from "cloudflare:workers";
import type { Env } from "./worker";
import {
  BOT_NAMES, CHAT_MAX, DISCUSS_MS, FIRST_SNUFF_MS, GATHER_MS, LANTERNS, MAX_PLAYERS, MIN_PLAYERS,
  MOVE_COOLDOWN_MS, NAME_MAX, RESULT_MS, REVEAL_MS, SHAPES, SNUFF_COOLDOWN_MS, VOTE_MS, shadeCount,
  type ChatLine, type ClientMsg, type GameResult, type MatchEvent, type Meeting, type Phase, type PlayerSummary,
  type PublicPlayer, type PublicTask, type Role, type ServerMsg,
} from "./shared";
import { PATHS, START, adjacent, isLoc, type Loc } from "./harbor";
import { chooseReport, chooseSnuff, decide, foundCold, newBrain, observe, remember, type Brain } from "./bots";
import { TASKS, assignTasks, checkAnswer, makeChallenge, type Attempt, type Task } from "./tasks";
import { chooseVote, mentions, tally, type MindContext } from "./minds";
import { AiGate, DEFAULT_MODEL, speak, write } from "./ai";
import { cleanTale, computeHonors, fallbackTale, taleFacts, talePrompt } from "./chronicle";

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
  tasks: Task[];                 // a Shade's tasks are fake
  alive: boolean;                // false once snuffed (a wisp) or set adrift
  adrift?: boolean;              // set adrift by vote
  bellUsed?: boolean;            // rang the emergency bell this game
  lastSaidAt?: number;
  stats?: PlayerStats;           // this game only
  snuffedAt?: Loc | null;
  snuffReadyAt: number;          // Shades: can't snuff again before this
  attempt?: Attempt;             // a task mini-game in progress (humans)
  brain?: Brain;                 // bots only
  working?: { loc: Loc; until: number }; // a bot busy on a task
}

interface PlayerStats {
  tasks: number;   // real tasks done
  snuffs: number;
  sharp: number;   // votes cast for a Shade
  lamp: boolean;   // lit the great lamp while alive
}

const freshStats = (): PlayerStats => ({ tasks: 0, snuffs: 0, sharp: 0, lamp: false });

interface RoomState {
  code: string;
  created: boolean;
  createdAt: number;
  phase: Phase;
  hostId: string | null;
  players: Player[];
  revealEndsAt: number | null;
  result: GameResult | null;
  cold: ColdLantern[];           // snuffed lanterns lying where they fell
  meeting: Meeting | null;
  revealed: string[];            // snuffed players everyone has been told about
  votes: Record<string, string>; // secret until the verdict: voter → target or "skip"
  chatSeq: number;
  log: MatchEvent[];             // what happened this game, for the end screen
  gameNo: number;
  startedAt: number;             // when play began (after the reveal)
}

interface ColdLantern {
  victim: string;
  by: string;
  loc: Loc;
  at: number;
}

function emptyRoom(): RoomState {
  return {
    code: "", created: false, createdAt: 0, phase: "lobby", hostId: null, players: [],
    revealEndsAt: null, result: null, cold: [], meeting: null, revealed: [], votes: {}, chatSeq: 0,
    log: [], gameNo: 0, startedAt: 0,
  };
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

const MEETING_CHAT_KEEP = 60;
const MAX_BOT_REPLIES = 2;   // per bot per meeting, when someone speaks to it

interface BotTurn { id: string; at: number; replyTo?: ChatLine }

export class Room extends DurableObject<Env> {
  private state!: RoomState;
  private dirty = false;
  private lastSaveAt = 0;
  // Meeting bookkeeping that doesn't need to survive a restart.
  private botTurns: BotTurn[] = [];
  private botVotes: { id: string; at: number }[] = [];
  private hunches = new Map<string, string | null>();
  private replies = new Map<string, number>();
  private aiGate = new AiGate();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Keep-alive pings are answered by Cloudflare without waking the room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<RoomState>("state");
      // Fill in any fields added since the room was saved.
      this.state = { ...emptyRoom(), ...saved };
      this.state.players = this.state.players.map((p) => ({
        ...p, role: p.role ?? null, loc: p.loc ?? null, readyAt: p.readyAt ?? 0, tasks: p.tasks ?? [],
        alive: p.alive ?? true, snuffReadyAt: p.snuffReadyAt ?? 0,
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
      case "playAgain": return this.onPlayAgain(ws, me);
      case "move": return this.onMove(ws, me, msg.to);
      case "taskStart": return this.onTaskStart(ws, me, msg.id);
      case "taskDone": return this.onTaskDone(ws, me, msg);
      case "taskCancel": delete me.attempt; return;
      case "snuff": return this.onSnuff(ws, me, msg.target);
      case "report": return this.onReport(ws, me);
      case "bell": return this.onBell(ws, me);
      case "say": return this.onSay(ws, me, msg.text);
      case "ready": return this.onReady(ws, me);
      case "vote": return this.onVote(ws, me, msg.target);
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

    if (s.phase === "meeting" && s.meeting) {
      if (this.meetingTick(now)) lobbyChanged = true;
    }

    if (s.phase === "playing" && this.anyHumanHere()) {
      const progressBefore = this.progress();
      this.botTick(now);
      if (this.progress() !== progressBefore) lobbyChanged = true;
      if (this.checkWin()) lobbyChanged = true;
      if (s.phase !== "playing") lobbyChanged = true; // a bot rang the bell
    }

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
        tasks: [],
        alive: true,
        snuffReadyAt: 0,
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
    if ((this.state.phase === "playing" || this.state.phase === "meeting") && me.loc) this.sendView(ws, me);
    if (me.role && this.state.phase !== "lobby") this.sendTasks(ws, me);
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
      tasks: [],
      alive: true,
      snuffReadyAt: 0,
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
    await this.startGame();
  }

  /** Same players, fresh roles, straight back in. Anyone who has left is let go first. */
  private async onPlayAgain(ws: WebSocket, me: Player) {
    if (!this.requireHost(ws, me)) return;
    if (this.state.phase !== "ended") return;
    this.state.players = this.state.players.filter((p) => p.isBot || this.isConnected(p.id));
    if (this.state.players.length < MIN_PLAYERS) {
      this.resetToLobby();
      await this.save();
      this.broadcast({ t: "notice", text: `Some Keepers left — add bots or invite friends to reach ${MIN_PLAYERS}.` });
      this.broadcastLobby();
      return;
    }
    await this.startGame();
  }

  private async startGame() {
    // Pick the Shades uniformly at random from everyone, bots included.
    const order = shuffle(this.state.players.map((p) => p.id));
    const shades = new Set(order.slice(0, shadeCount(this.state.players.length)));
    const now = Date.now();
    const playFrom = now + REVEAL_MS;
    for (const p of this.state.players) {
      p.role = shades.has(p.id) ? "shade" : "keeper";
      p.loc = START;
      p.readyAt = playFrom;
      p.tasks = assignTasks();
      p.alive = true;
      p.adrift = false;
      p.bellUsed = false;
      p.snuffReadyAt = playFrom + FIRST_SNUFF_MS;
      p.stats = freshStats();
      p.snuffedAt = null;
      delete p.attempt;
      delete p.working;
      if (p.isBot) p.brain = newBrain(playFrom);
    }
    this.state.log = [];
    this.state.gameNo += 1;
    this.state.startedAt = playFrom;
    this.state.votes = {};

    this.state.phase = "reveal";
    this.state.result = null;
    this.state.cold = [];
    this.state.meeting = null;
    this.state.revealed = [];
    this.state.revealEndsAt = playFrom;
    await this.save();

    // Each human hears only their own role.
    for (const sock of this.ctx.getWebSockets()) {
      const p = this.player((sock.deserializeAttachment() as SocketInfo).pid);
      if (p) {
        this.sendRole(sock, p);
        this.sendTasks(sock, p);
      }
    }
    this.broadcastLobby();
    await this.scheduleAlarm();
  }

  private async onEndGame(ws: WebSocket, me: Player) {
    if (!this.requireHost(ws, me)) return;
    if (this.state.phase === "lobby") return;
    const wasPlaying = this.state.phase !== "ended";
    this.resetToLobby();
    await this.save();
    this.broadcast({ t: "notice", text: wasPlaying ? "The host called everyone back to the lobby." : "Back in the lobby. Ready for another night?" });
    this.broadcastLobby();
    await this.scheduleAlarm();
  }

  private resetToLobby() {
    this.state.phase = "lobby";
    this.state.revealEndsAt = null;
    this.state.result = null;
    this.state.cold = [];
    this.state.meeting = null;
    this.state.revealed = [];
    this.state.votes = {};
    for (const p of this.state.players) {
      p.alive = true;
      p.adrift = false;
      p.bellUsed = false;
      p.role = null;
      p.loc = null;
      p.readyAt = 0;
      p.tasks = [];
      delete p.attempt;
      delete p.working;
      delete p.brain;
      delete p.stats;
    }
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
    delete p.attempt;   // walking away abandons a task
    delete p.working;
    if (p.brain) p.brain.cameFrom = from;
    this.dirty = true;
    this.refresh(from ? [from, to] : [to], now);
  }

  /** Everyone standing in these places looks around again. */
  private refresh(locs: Loc[], now: number) {
    const sockets = this.socketsByPlayer();
    for (const p of this.state.players) {
      if (!p.loc || !locs.includes(p.loc)) continue;
      if (p.brain) observe(p.brain, p.loc, this.visibleTo(p), now);
      for (const ws of sockets.get(p.id) ?? []) this.sendView(ws, p);
    }
  }

  /** Let every bot whose turn has come decide what to do. */
  private botTick(now: number) {
    for (const bot of this.state.players) {
      if (!bot.brain || !bot.loc || !bot.role || now < bot.brain.nextMoveAt) continue;
      if (this.state.phase !== "playing") return; // the game ended mid-tick

      // Finish whatever it was working on.
      if (bot.working && now >= bot.working.until) {
        const task = bot.tasks.find((t) => t.loc === bot.working!.loc && !t.done);
        if (task && bot.loc === bot.working.loc) this.completeTask(bot, task);
        delete bot.working;
      }

      const allies = this.alliesOf(bot);

      if (bot.alive) {
        // A cold lantern at its feet? Remember who was around, maybe ring the bell.
        const cold = this.state.cold.filter((c) => c.loc === bot.loc);
        if (cold.length) {
          for (const c of cold) foundCold(bot.brain, c.loc, c.victim, now, bot.id);
          if (chooseReport(bot.role, cold.some((c) => c.by === bot.id))) {
            this.startMeeting(bot, now);
            return;
          }
        }
        // A Shade alone with a Keeper strikes.
        if (bot.role === "shade" && now >= bot.snuffReadyAt) {
          const target = chooseSnuff(this.visibleTo(bot), allies);
          const victim = this.player(target);
          if (victim) {
            this.snuff(bot, victim, now);
            bot.brain.nextMoveAt = now + 1500 + Math.random() * 2000; // then slip away
            if (this.checkWin()) return;
            continue;
          }
        }
      }

      // Wisps keep working (a Keeper's tasks still count) but can't hunt.
      const role: Role = bot.alive ? bot.role : "keeper";
      const todo = bot.alive || bot.role === "keeper" ? bot.tasks.filter((t) => !t.done).map((t) => t.loc) : [];
      const choice = decide(bot.brain, bot.loc, role, bot.alive ? allies : [], now, todo);
      if (choice.work) bot.working = { loc: choice.work, until: now + choice.dwellMs };
      else if (choice.to && adjacent(bot.loc, choice.to) && now >= bot.readyAt) this.moveTo(bot, choice.to, now);
      bot.brain.nextMoveAt = now + Math.max(choice.dwellMs, MOVE_COOLDOWN_MS);
      this.dirty = true;
    }
  }

  // ---------- Snuffing, cold lanterns and the bell ----------

  private async onSnuff(ws: WebSocket, me: Player, targetId: unknown) {
    const target = this.player(String(targetId ?? ""));
    const now = Date.now();
    if (this.state.phase !== "playing" || me.role !== "shade" || !me.alive) {
      return this.send(ws, { t: "error", code: "cant_snuff", text: "You can't do that." });
    }
    if (!target || !target.alive || target.role !== "keeper" || target.loc !== me.loc) {
      return this.send(ws, { t: "error", code: "bad_target", text: "They aren't here." });
    }
    if (now < me.snuffReadyAt) {
      return this.send(ws, { t: "error", code: "cooldown", text: "Your shadow hasn't gathered yet." });
    }
    this.snuff(me, target, now);
    this.checkWin();
    this.broadcastLobby();
    await this.save();
    await this.scheduleAlarm();
  }

  /** Put out a Keeper's lantern. Anyone else alive here sees it happen. */
  private snuff(shade: Player, victim: Player, now: number) {
    const loc = shade.loc!;
    victim.alive = false;
    delete victim.attempt;
    delete victim.working;
    shade.snuffReadyAt = now + SNUFF_COOLDOWN_MS;
    victim.snuffedAt = loc;
    if (shade.stats) shade.stats.snuffs++;
    this.logEvent({ kind: "snuff", who: shade.id, victim: victim.id, loc });
    this.state.cold.push({ victim: victim.id, by: shade.id, loc, at: now });
    this.dirty = true;

    const sockets = this.socketsByPlayer();
    for (const ws of sockets.get(victim.id) ?? []) this.send(ws, { t: "snuffed", by: shade.id });
    for (const other of this.state.players) {
      if (other.id === shade.id || other.id === victim.id || !other.alive || other.loc !== loc) continue;
      if (other.brain) remember(other.brain, { kind: "sawSnuff", who: shade.id, victim: victim.id, loc, at: now });
      const text = `You saw ${shade.name} snuff ${victim.name}'s lantern!`;
      for (const ws of sockets.get(other.id) ?? []) {
        this.send(ws, { t: "witness", kind: "snuff", who: shade.id, victim: victim.id, loc, text });
      }
    }
    this.refresh([loc], now);
  }

  private async onReport(ws: WebSocket, me: Player) {
    if (this.state.phase !== "playing" || !me.alive || !me.loc) {
      return this.send(ws, { t: "error", code: "cant_report", text: "You can't do that now." });
    }
    if (!this.state.cold.some((c) => c.loc === me.loc)) {
      return this.send(ws, { t: "error", code: "nothing_here", text: "There's nothing to report here." });
    }
    this.startMeeting(me, Date.now());
    await this.save();
    this.broadcastLobby();
    await this.scheduleAlarm();
  }

  /** The emergency bell hangs in the Market Square. Each player may ring it once. */
  private async onBell(ws: WebSocket, me: Player) {
    if (this.state.phase !== "playing" || !me.alive) {
      return this.send(ws, { t: "error", code: "cant_bell", text: "You can't ring the bell now." });
    }
    if (me.loc !== START) return this.send(ws, { t: "error", code: "not_here", text: "The bell hangs in the Market Square." });
    if (me.bellUsed) return this.send(ws, { t: "error", code: "bell_used", text: "You've already rung the bell this game." });
    me.bellUsed = true;
    this.startMeeting(me, Date.now(), "bell");
    await this.save();
    this.broadcastLobby();
    await this.scheduleAlarm();
  }

  /** Ring the Harbor Bell: everyone gathers in the square and the snuffed are named. */
  private startMeeting(reporter: Player, now: number, kind: "cold" | "bell" = "cold") {
    const s = this.state;
    const loc = reporter.loc!;
    const stageEndsAt = now + GATHER_MS;
    s.phase = "meeting";
    s.votes = {};
    s.meeting = {
      kind,
      reporter: reporter.id,
      loc,
      found: kind === "cold" ? s.cold.filter((c) => c.loc === loc).map((c) => c.victim) : [],
      snuffed: s.players.filter((p) => !p.alive && !p.adrift).map((p) => p.id),
      stage: "gather",
      stageEndsAt,
      endsAt: stageEndsAt,
      chat: [],
      voted: [],
      ready: [],
      result: null,
    };
    s.revealed = s.meeting.snuffed;
    this.logEvent(kind === "bell"
      ? { kind: "bell", who: reporter.id, loc }
      : { kind: "report", who: reporter.id, loc, found: s.meeting.found });
    // Bots that find out now who was found note who they saw nearby.
    for (const c of s.cold.filter((c) => c.loc === loc)) {
      for (const p of s.players) if (p.brain && p.alive && p.loc === loc) foundCold(p.brain, c.loc, c.victim, now, p.id);
    }
    s.cold = []; // the harbor is tidied while everyone talks
    for (const p of s.players) {
      p.loc = START;
      p.readyAt = Number.MAX_SAFE_INTEGER; // nobody walks during a meeting
      delete p.attempt;
      delete p.working;
    }
    this.botTurns = [];
    this.botVotes = [];
    this.hunches.clear();
    this.replies.clear();
    this.dirty = true;
    this.refresh([START], now);
  }

  /** Move the meeting along. Returns true when everyone should get a fresh update. */
  private meetingTick(now: number): boolean {
    const s = this.state;
    const m = s.meeting!;
    let changed = false;

    if (m.stage === "gather" && now >= m.stageEndsAt) {
      this.setStage("discuss", now + DISCUSS_MS);
      this.pushChat("", "Talk it over. Who do you suspect — and why?");
      this.scheduleBotTalk(now);
      changed = true;
    } else if (m.stage === "discuss" && now >= m.stageEndsAt) {
      this.startVote(now);
      changed = true;
    } else if (m.stage === "vote" && (now >= m.stageEndsAt || this.everyoneVoted())) {
      this.revealVerdict(now);
      changed = true;
    } else if (m.stage === "result" && now >= m.stageEndsAt) {
      this.endMeeting(now);
      return true;
    }

    // Bots speak when their turn comes (talking is allowed until the verdict).
    if ((m.stage === "discuss" || m.stage === "vote")) {
      const due = this.botTurns.filter((t) => t.at <= now);
      this.botTurns = this.botTurns.filter((t) => t.at > now);
      for (const turn of due) this.botSpeak(turn);
    }
    // Bots vote when their moment comes.
    if (m.stage === "vote") {
      const due = this.botVotes.filter((v) => v.at <= now);
      this.botVotes = this.botVotes.filter((v) => v.at > now);
      for (const v of due) {
        const bot = this.player(v.id);
        if (!bot?.alive || s.votes[bot.id]) continue;
        const target = chooseVote(this.mindFor(bot), this.hunches.get(bot.id) ?? null);
        this.castVote(bot, target);
        changed = true;
      }
      if (this.everyoneVoted()) {
        this.revealVerdict(now);
        changed = true;
      }
    }
    return changed;
  }

  private setStage(stage: Meeting["stage"], endsAt: number) {
    const m = this.state.meeting!;
    m.stage = stage;
    m.stageEndsAt = endsAt;
    m.endsAt = endsAt;
    this.dirty = true;
  }

  private scheduleBotTalk(now: number) {
    const bots = shuffle(this.state.players.filter((p) => p.isBot && p.alive));
    let at = now + 2500;
    for (const b of bots) {
      this.botTurns.push({ id: b.id, at });
      at += 3200 + Math.random() * 2400;
    }
    // Some speak again later, once there's more to react to.
    for (const b of bots) {
      if (Math.random() < 0.5) this.botTurns.push({ id: b.id, at: now + DISCUSS_MS * (0.55 + Math.random() * 0.3) });
    }
  }

  /** Ask a bot for a line (AI first, evidence-based fallback), then say it. */
  private botSpeak(turn: BotTurn) {
    const bot = this.player(turn.id);
    const m = this.state.meeting;
    if (!bot?.alive || !bot.brain || !m) return;
    this.broadcast({ t: "typing", who: bot.id });
    const ctx = this.mindFor(bot, turn.replyTo);
    const model = this.env.AI_MODEL || DEFAULT_MODEL;
    speak(this.env.AI, model, ctx, this.aiGate).then(async (voice) => {
      const live = this.state.meeting;
      if (!live || live !== m || (live.stage !== "discuss" && live.stage !== "vote") || !bot.alive) return;
      if (voice.suspect) this.hunches.set(bot.id, voice.suspect);
      this.pushChat(bot.id, voice.say);
      await this.scheduleAlarm();
    }).catch(() => {});
  }

  private mindFor(bot: Player, replyTo?: ChatLine): MindContext {
    const s = this.state;
    const m = s.meeting!;
    return {
      self: { id: bot.id, name: bot.name, role: bot.role!, personality: bot.brain!.personality, alive: bot.alive },
      brain: bot.brain!,
      allies: this.alliesOf(bot),
      names: Object.fromEntries(s.players.map((p) => [p.id, p.name])),
      living: s.players.filter((p) => p.alive).map((p) => p.id),
      meeting: { kind: m.kind, reporter: m.reporter, loc: m.loc as Loc, found: m.found },
      chat: m.chat,
      replyTo,
      now: Date.now(),
    };
  }

  private pushChat(who: string, text: string) {
    const m = this.state.meeting;
    if (!m) return;
    const line: ChatLine = { id: ++this.state.chatSeq, who, text, at: Date.now() };
    m.chat.push(line);
    if (m.chat.length > MEETING_CHAT_KEEP) m.chat.splice(0, m.chat.length - MEETING_CHAT_KEEP);
    this.dirty = true;
    this.broadcast({ t: "chat", line });
  }

  private async onSay(ws: WebSocket, me: Player, raw: unknown) {
    const m = this.state.meeting;
    if (this.state.phase !== "meeting" || !m || m.stage === "result") {
      return this.send(ws, { t: "error", code: "not_meeting", text: "You can talk when the bell rings." });
    }
    if (!me.alive) return this.send(ws, { t: "error", code: "wisp", text: "Wisps can't be heard by the living." });
    const now = Date.now();
    if (me.lastSaidAt && now - me.lastSaidAt < 1200) {
      return this.send(ws, { t: "error", code: "slow_down", text: "Slow down a little." });
    }
    const text = String(raw ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, CHAT_MAX);
    if (!text) return;
    me.lastSaidAt = now;
    const line = { id: this.state.chatSeq + 1, who: me.id, text, at: now };
    this.pushChat(me.id, text);
    // Speak to a bot by name and it will answer.
    for (const bot of this.state.players) {
      if (!bot.isBot || !bot.alive || !mentions(text, bot.name)) continue;
      const used = this.replies.get(bot.id) ?? 0;
      if (used >= MAX_BOT_REPLIES) continue;
      this.replies.set(bot.id, used + 1);
      this.botTurns = this.botTurns.filter((t) => t.id !== bot.id || t.at > now + 15_000);
      this.botTurns.push({ id: bot.id, at: now + 1800 + Math.random() * 1800, replyTo: line });
    }
    await this.scheduleAlarm();
  }

  /** Living humans can agree to vote early; bots never hold things up. */
  private async onReady(ws: WebSocket, me: Player) {
    const m = this.state.meeting;
    if (!m || m.stage !== "discuss" || !me.alive) return;
    if (!m.ready.includes(me.id)) m.ready.push(me.id);
    const waiting = this.state.players.filter((p) => !p.isBot && p.alive && this.isConnected(p.id) && !m.ready.includes(p.id));
    if (!waiting.length) this.startVote(Date.now());
    this.broadcastLobby();
    await this.scheduleAlarm();
  }

  private startVote(now: number) {
    this.setStage("vote", now + VOTE_MS);
    this.pushChat("", "Time to vote. Pick who to set adrift — or skip.");
    for (const b of this.state.players) {
      if (b.isBot && b.alive) this.botVotes.push({ id: b.id, at: now + 2500 + Math.random() * (VOTE_MS * 0.5) });
    }
  }

  private async onVote(ws: WebSocket, me: Player, target: unknown) {
    const s = this.state;
    const m = s.meeting;
    if (!m || m.stage !== "vote") return this.send(ws, { t: "error", code: "not_voting", text: "It isn't time to vote." });
    if (!me.alive) return this.send(ws, { t: "error", code: "wisp", text: "Wisps can't vote." });
    if (s.votes[me.id]) return this.send(ws, { t: "error", code: "voted", text: "You've already voted." });
    const t = String(target ?? "");
    const ok = t === "skip" || (t !== me.id && this.player(t)?.alive);
    if (!ok) return this.send(ws, { t: "error", code: "bad_vote", text: "You can't vote for them." });
    this.castVote(me, t);
    if (this.everyoneVoted()) this.revealVerdict(Date.now());
    this.broadcastLobby();
    await this.scheduleAlarm();
  }

  private castVote(p: Player, target: string) {
    const m = this.state.meeting!;
    this.state.votes[p.id] = target;
    if (!m.voted.includes(p.id)) m.voted.push(p.id);
    this.dirty = true;
  }

  private everyoneVoted() {
    return this.state.players.filter((p) => p.alive).every((p) => this.state.votes[p.id]);
  }

  /** Count the votes and set someone adrift (or not). The room learns if they were a Shade. */
  private revealVerdict(now: number) {
    const s = this.state;
    const m = s.meeting!;
    if (m.stage === "result") return;
    const { adrift, tie } = tally(s.votes);
    const who = this.player(adrift);
    if (who) {
      who.alive = false;
      who.adrift = true;
      if (!s.revealed.includes(who.id)) s.revealed = [...s.revealed, who.id];
    }
    m.result = { adrift: who?.id ?? null, wasShade: who ? who.role === "shade" : null, votes: { ...s.votes }, tie };
    for (const [voter, target] of Object.entries(s.votes)) {
      const v = this.player(voter);
      if (v?.stats && this.player(target)?.role === "shade") v.stats.sharp++;
    }
    this.logEvent(who ? { kind: "adrift", who: who.id, wasShade: who.role === "shade" } : { kind: "spared" });
    this.botVotes = [];
    this.botTurns = [];
    this.setStage("result", now + RESULT_MS);
  }

  private endMeeting(now: number) {
    const s = this.state;
    s.phase = "playing";
    s.meeting = null;
    s.votes = {};
    for (const p of s.players) {
      p.readyAt = now;
      if (p.role === "shade") p.snuffReadyAt = Math.max(p.snuffReadyAt, now + FIRST_SNUFF_MS);
      if (p.brain) p.brain.nextMoveAt = now + 600 + Math.random() * 2500;
    }
    this.dirty = true;
    if (!this.checkWin()) this.refresh([START], now);
  }

  /** Who this player can see where they stand: the living see the living; wisps see everyone. */
  private visibleTo(p: Player) {
    if (!p.loc) return [];
    return this.state.players
      .filter((o) => o.id !== p.id && o.loc === p.loc && (o.alive || !p.alive))
      .map((o) => o.id);
  }

  private alliesOf(p: Player) {
    return p.role === "shade"
      ? this.state.players.filter((o) => o.role === "shade" && o.id !== p.id).map((o) => o.id)
      : [];
  }

  // ---------- Tasks ----------

  private async onTaskStart(ws: WebSocket, me: Player, id: unknown) {
    const task = me.tasks.find((t) => t.id === id);
    if (this.state.phase !== "playing" || !task) {
      return this.send(ws, { t: "error", code: "bad_task", text: "That isn't one of your tasks." });
    }
    if (task.done) return this.send(ws, { t: "taskResult", id: task.id, ok: false, text: "Already done." });
    if (me.loc !== task.loc) {
      return this.send(ws, { t: "taskResult", id: task.id, ok: false, text: "You need to be there to do that." });
    }
    const def = TASKS[task.loc];
    const { data, answer } = makeChallenge(def.kind);
    const nonce = crypto.randomUUID();
    me.attempt = { taskId: task.id, nonce, startedAt: Date.now(), answer };
    this.send(ws, { t: "taskChallenge", id: task.id, nonce, kind: def.kind, name: def.name, data });
  }

  private async onTaskDone(ws: WebSocket, me: Player, msg: Extract<ClientMsg, { t: "taskDone" }>) {
    const a = me.attempt;
    const task = me.tasks.find((t) => t.id === msg.id);
    const fail = (text: string) => this.send(ws, { t: "taskResult", id: String(msg.id), ok: false, text });
    if (this.state.phase !== "playing" || !task || !a || a.taskId !== task.id || a.nonce !== msg.nonce) {
      return fail("That attempt has expired. Try again.");
    }
    if (me.loc !== task.loc) return fail("You walked away.");
    const now = Date.now();
    if (now - a.startedAt < TASKS[task.loc].minMs) return fail("Too fast — take a little more care.");
    if (!checkAnswer(a.answer, msg.answer)) {
      delete me.attempt;
      return fail("Not quite. Try again.");
    }
    delete me.attempt;
    this.completeTask(me, task);
    this.send(ws, { t: "taskResult", id: task.id, ok: true });
    this.checkWin();
    this.broadcastLobby();
    await this.scheduleAlarm();
  }

  /** Mark a task done. Only a Keeper's counts, and only a Keeper's can be witnessed. */
  private completeTask(p: Player, task: Task) {
    task.done = true;
    this.dirty = true;
    const real = p.role === "keeper";
    const def = TASKS[task.loc];
    if (real && p.stats) p.stats.tasks++;
    if (real && def.witnessed && p.alive && p.stats) p.stats.lamp = true;
    if (real && def.witnessed && p.alive && p.loc) {
      const text = `${p.name} lit the great lamp — the beam swept the bay.`;
      const sockets = this.socketsByPlayer();
      for (const other of this.state.players) {
        if (other.id === p.id || other.loc !== p.loc) continue;
        if (other.brain) remember(other.brain, { kind: "lamp", who: p.id, loc: p.loc, at: Date.now() });
        for (const ws of sockets.get(other.id) ?? []) this.send(ws, { t: "witness", kind: "lamp", who: p.id, loc: p.loc, text });
      }
    }
    for (const ws of this.socketsByPlayer().get(p.id) ?? []) this.sendTasks(ws, p);
  }

  /** Share of all Keeper tasks that are done (0..1). */
  private progress() {
    const tasks = this.state.players.filter((p) => p.role === "keeper").flatMap((p) => p.tasks);
    if (!tasks.length) return 0;
    return tasks.filter((t) => t.done).length / tasks.length;
  }

  /** End the game if a side has won. Returns true if it just ended. */
  private checkWin() {
    if (this.state.phase !== "playing") return false;
    if (this.progress() >= 1) {
      this.finish({ winner: "keepers", reason: "Every lantern in the harbor is burning. The Shades have nowhere left to hide." });
      return true;
    }
    const living = this.state.players.filter((p) => p.alive);
    const shades = living.filter((p) => p.role === "shade").length;
    const keepers = living.length - shades;
    if (shades === 0) {
      this.finish({ winner: "keepers", reason: "Every Shade has been set adrift. The harbor lights burn safe tonight." });
      return true;
    }
    if (shades >= keepers) {
      this.finish({ winner: "shades", reason: "The Shades now match the Keepers lantern for lantern. The harbor goes dark." });
      return true;
    }
    return false;
  }

  private finish(r: { winner: GameResult["winner"]; reason: string }) {
    const s = this.state;
    s.phase = "ended";
    s.meeting = null;
    for (const p of s.players) {
      delete p.attempt;
      delete p.working;
    }
    const players: PlayerSummary[] = s.players.filter((p) => p.role).map((p) => ({
      id: p.id,
      role: p.role!,
      fate: p.adrift ? "adrift" : p.alive ? "survived" : "snuffed",
      where: p.snuffedAt ?? null,
      tasksDone: p.stats?.tasks ?? 0,
      tasksTotal: p.role === "keeper" ? p.tasks.length : 0,
      snuffs: p.stats?.snuffs ?? 0,
      sharpVotes: p.stats?.sharp ?? 0,
    }));
    const names = Object.fromEntries(s.players.map((p) => [p.id, p.name]));
    const lamps = s.players.filter((p) => p.stats?.lamp).map((p) => p.id);
    s.result = {
      ...r,
      shades: players.filter((p) => p.role === "shade").map((p) => p.id),
      gameId: `${s.code}-${s.gameNo}-${s.startedAt}`,
      durationMs: Math.max(0, Date.now() - s.startedAt),
      players,
      honors: computeHonors({ players, names, log: s.log, lamps, winner: r.winner }),
      log: [...s.log],
      tale: null,
      taleBy: null,
    };
    this.dirty = true;
    this.tellTale(s.result, names);
  }

  /** The storyteller writes up the night (AI, with a written fallback), then everyone gets it. */
  private tellTale(result: GameResult, names: Record<string, string>) {
    const input = { players: result.players, names, log: result.log, reason: result.reason, winner: result.winner };
    const { system, user } = talePrompt(taleFacts(input));
    write(this.env.AI, this.env.AI_MODEL || DEFAULT_MODEL, system, user, cleanTale).then(async (text) => {
      if (this.state.result !== result) return; // a new game has begun
      result.tale = text ?? fallbackTale(input);
      result.taleBy = text ? "ai" : "fallback";
      this.dirty = true;
      await this.save();
      this.broadcastLobby();
    }).catch(() => {});
  }

  private logEvent(e: Omit<MatchEvent, "at">) {
    this.state.log.push({ ...e, at: Math.max(0, Date.now() - this.state.startedAt) });
  }

  private sendTasks(ws: WebSocket, p: Player) {
    const tasks: PublicTask[] = p.tasks.map((t) => ({ id: t.id, loc: t.loc, name: TASKS[t.loc].name, done: t.done }));
    this.send(ws, { t: "tasks", tasks });
  }

  private sendView(ws: WebSocket, p: Player) {
    if (!p.loc) return;
    this.send(ws, {
      t: "view",
      here: p.loc,
      neighbors: PATHS[p.loc],
      present: this.visibleTo(p),
      wisps: p.alive ? [] : this.visibleTo(p).filter((id) => !this.player(id)?.alive),
      cold: this.state.cold.filter((c) => c.loc === p.loc).map((c) => c.victim),
      alive: p.alive,
      readyAt: p.readyAt,
      snuffReadyAt: p.role === "shade" ? p.snuffReadyAt : null,
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
      progress: ["playing", "meeting", "ended"].includes(s.phase) ? this.progress() : null,
      result: s.result,
      meeting: s.meeting,
      now: Date.now(),
      players: this.state.players.map((p) => ({
        id: p.id,
        name: p.name,
        lantern: p.lantern,
        shape: p.shape,
        isBot: p.isBot,
        isHost: p.id === this.state.hostId,
        connected: p.isBot || this.isConnected(p.id, ignore),
        // Snuffs become public at the bell, and everyone's fate at the end.
        snuffed: !p.alive && !p.adrift && (s.phase === "ended" || s.revealed.includes(p.id)),
        adrift: !!p.adrift,
        bellUsed: !!p.bellUsed,
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
    if (s.meeting) {
      times.push(s.meeting.stageEndsAt);
      for (const t of this.botTurns) times.push(t.at);
      for (const v of this.botVotes) times.push(v.at);
    }
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
