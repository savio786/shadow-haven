// Shadow Haven — browser client.
import { keeperSVG, shadeSVG, coldLanternSVG, wispSVG, bellSVG, boatSVG, endSceneSVG, honorIcon, LANTERNS } from "./lanterns.js";
import { sfx, buzz, isMuted, setMuted } from "./sound.js";
import { harborSVG, crowdSVG, PLACES } from "./harbor.js";
import { runTask } from "./tasks.js";

const MIN_PLAYERS = 4;
const REVEAL_MS = 7000;
const $ = (id) => document.getElementById(id);

// ---------- Small storage helpers (storage can be blocked; never crash) ----------
const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} },
};

function identity() {
  let id = store.get("sh.identity");
  if (!id?.playerId || !id?.token) {
    const rand = () => crypto.getRandomValues(new Uint8Array(16)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "");
    id = { playerId: "p-" + rand().slice(0, 20), token: rand() + rand() };
    store.set("sh.identity", id);
  }
  return id;
}

// ---------- State ----------
let ws = null;
let roomCode = null;
let me = null;
let lobby = null;
let myRole = null;   // "keeper" | "shade" — only ever our own
let allies = [];     // fellow Shades' ids (only if we're a Shade)
let view = null;     // { here, neighbors, present, readyAtLocal } — what we can see
let readyTimer = null;
let myTasks = [];    // our task list (a Shade's is fake)
let activeTask = null; // { id, nonce, cleanup } while a mini-game is open
let snuffTimer = null;  // ticks the Shade's countdown on the snuff button
let fogTimer = null;    // ticks the fog banner
let clockOffset = 0;    // server clock minus ours
const serverNow = () => Date.now() + clockOffset;
// What you've experienced this game — used for smart quick lines in meetings.
let myTrail = [];       // places you've been, most recent last
let mySaw = [];         // things you witnessed: { kind, who, victim }
// Meeting UI state.
let chatShown = new Set();
let myVote = null;      // what you voted (the server keeps votes secret)
let voteChoice = null;  // who you've tapped but not yet confirmed
let timerRaf = 0;
let typingTimer = 0;
let shownStage = null;
let retry = 0;
let retryTimer = null;
let pingTimer = null;
let leaving = false;

// ---------- Screens ----------
const SCREENS = ["home", "lobby", "reveal", "game", "meeting", "over"];
function show(screen) {
  for (const s of SCREENS) $(s).hidden = s !== screen;
  document.body.dataset.screen = screen;
}

function banner(text, withRetry = false) {
  const el = $("banner");
  el.textContent = text || "";
  if (text && withRetry) {
    const b = document.createElement("button");
    b.className = "banner-retry";
    b.textContent = "Retry now";
    b.addEventListener("click", () => { retry = Math.max(retry, 1); connect(); });
    el.append(" ", b);
  }
  el.hidden = !text;
}

let toastTimer;
const nameOf = (id) => lobby?.players.find((p) => p.id === id)?.name ?? "Someone";
const playerOf = (id) => lobby?.players.find((p) => p.id === id);

function toast(text, kind = "") {
  $("toast").textContent = text;
  $("toast").className = "toast" + (kind ? " " + kind : "");
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 3500);
}

function homeError(text) { $("home-error").textContent = text || ""; }

// ---------- Home ----------
function initHowTo() {
  const art = {
    keeper: () => keeperSVG({ lantern: "amber", shape: "hex", size: 34 }),
    shade: () => shadeSVG({ shape: "round", size: 34 }),
    fog: () => `<svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true"><path d="M4 16h22M10 22h26M2 28h20" stroke="#9fb4d6" stroke-width="3" stroke-linecap="round" opacity=".7"/></svg>`,
    cold: () => coldLanternSVG({ shape: "hex", size: 46 }),
    fogcall: () => `<svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true"><ellipse cx="20" cy="22" rx="16" ry="8" fill="#9fb4d6" opacity=".35"/><ellipse cx="14" cy="17" rx="3" ry="6" fill="#0c0f18"/><ellipse cx="26" cy="18" rx="3" ry="6" fill="#0c0f18"/><path d="M4 28h30M8 33h24" stroke="#b7c6dd" stroke-width="2.5" stroke-linecap="round" opacity=".6"/></svg>`,
    lamp: () => `<svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true"><path d="M15 36h10l-2-18h-6z" fill="#8a93a6"/><rect x="14" y="12" width="12" height="6" rx="1" fill="#ffb347"/><path d="M26 15l12-6M26 15l12 6" stroke="#ffd59a" stroke-width="2" stroke-linecap="round"/></svg>`,
  };
  const open = () => {
    document.querySelectorAll("#howto .howto-art").forEach((el) => { el.innerHTML = art[el.dataset.art]?.() ?? ""; });
    $("howto").hidden = false;
    $("howto-done").focus();
  };
  const close = () => ($("howto").hidden = true);
  $("howto-open").addEventListener("click", open);
  $("howto-close").addEventListener("click", close);
  $("howto-done").addEventListener("click", close);
  $("howto").addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  $("howto").addEventListener("click", (e) => { if (e.target === $("howto")) close(); });
  // First visit: show it once, unasked.
  if (!store.get("sh.seenHowTo")) {
    store.set("sh.seenHowTo", true);
    setTimeout(open, 400);
  }
}

function initHome() {
  $("hero-keeper").innerHTML = keeperSVG({ lantern: "amber", shape: "hex", size: 90 });
  $("name").value = store.get("sh.name") || "";

  $("code").addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
  });

  $("create").addEventListener("click", async () => {
    const name = readName();
    if (!name) return;
    $("create").disabled = true;
    homeError("");
    try {
      const res = await fetch("/api/rooms", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.text || "Couldn't create a room.");
      enterRoom(body.code);
    } catch (e) {
      homeError(e.message);
    } finally {
      $("create").disabled = false;
    }
  });

  $("home-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = readName();
    if (!name) return;
    const code = $("code").value.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(code)) return homeError("Room codes are 4 letters.");
    homeError("");
    const res = await fetch(`/api/room/${code}`).catch(() => null);
    if (!res) return homeError("Can't reach the harbor. Check your connection.");
    if (res.status === 404) return homeError(`No room called ${code}. Check the code with your host.`);
    if (res.status === 429) return homeError("Lots of activity from your network — wait a moment and try again.");
    enterRoom(code);
  });
}

function readName() {
  const name = $("name").value.replace(/\s+/g, " ").trim().slice(0, 16);
  if (!name) {
    homeError("Pick a name first.");
    $("name").focus();
    return null;
  }
  store.set("sh.name", name);
  return name;
}

// ---------- Room connection ----------
function enterRoom(code) {
  roomCode = code;
  leaving = false;
  store.set("sh.lastRoom", code);
  if (location.pathname !== `/r/${code}`) history.pushState({}, "", `/r/${code}`);
  $("room-code").textContent = code;
  $("players").innerHTML = "";
  $("lobby-status").textContent = "Lighting your lantern…";
  show("lobby");
  connect();
}

const HEARTBEAT_MS = 20_000;   // how often we check the line is alive
const PONG_WITHIN = 8_000;     // no answer by then → treat the connection as dead
let lastPong = 0;
let wasConnected = false;

function connect() {
  clearTimeout(retryTimer);
  if (ws && ws.readyState <= 1) { try { ws.close(); } catch {} }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const sock = new WebSocket(`${proto}://${location.host}/api/room/${roomCode}/ws`);
  ws = sock;

  sock.addEventListener("open", () => {
    const recovered = retry > 0 && wasConnected;
    retry = 0;
    wasConnected = true;
    banner("");
    const { playerId, token } = identity();
    sock.send(JSON.stringify({ t: "join", playerId, token, name: store.get("sh.name") || "Keeper" }));
    if (recovered) toast("Back in the harbor.");
    // Heartbeat: a ping the server answers without waking the room. No pong → the line is dead.
    lastPong = Date.now();
    clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (sock !== ws || sock.readyState !== 1) return;
      if (Date.now() - lastPong > HEARTBEAT_MS + PONG_WITHIN) {
        try { sock.close(4100, "heartbeat lost"); } catch {}
        return;
      }
      sock.send("ping");
    }, HEARTBEAT_MS);
  });

  sock.addEventListener("message", (e) => {
    lastPong = Date.now(); // any message proves the line is alive
    if (e.data === "pong") return;
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    onMessage(msg);
  });

  sock.addEventListener("close", async (e) => {
    clearInterval(pingTimer);
    if (sock !== ws || leaving) return;
    if (e.code === 4000 || e.code === 4001) return; // replaced by another tab / removed by host
    // The room may have been closed while we were away.
    const info = await fetch(`/api/room/${roomCode}`).catch(() => null);
    if (sock !== ws || leaving) return;
    if (info?.status === 404 || info?.status === 400) {
      leaving = true;
      return backHome(`Room ${roomCode} has closed.`);
    }
    retry++;
    const wait = info?.status === 429 ? 15_000 : Math.min(10_000, 500 * 2 ** retry);
    const why = !navigator.onLine ? "You're offline — we'll reconnect as soon as you're back."
      : info?.status === 429 ? "Lots of activity on your network — reconnecting shortly…"
      : retry > 5 ? "Still trying to reach the harbor…"
      : "Lost the signal — reconnecting…";
    banner(why, true);
    retryTimer = setTimeout(connect, wait);
  });
}

/** Come straight back when the phone wakes up or the network returns. */
function reconnectNow() {
  if (!roomCode || leaving) return;
  if (ws && ws.readyState === 1) {
    // The tab may have slept or the network blinked: prove the line is alive, or reconnect.
    const sock = ws;
    if (Date.now() - lastPong > HEARTBEAT_MS + PONG_WITHIN) { try { sock.close(4100, "stale"); } catch {} return; }
    banner("");
    const sent = Date.now();
    try { sock.send("ping"); } catch {}
    setTimeout(() => {
      if (sock === ws && sock.readyState === 1 && lastPong < sent) { try { sock.close(4100, "no answer"); } catch {} }
    }, PONG_WITHIN);
    return;
  }
  if (ws && ws.readyState === 0) return; // already connecting
  retry = Math.max(retry, 1);
  connect();
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reconnectNow(); });
window.addEventListener("online", reconnectNow);
window.addEventListener("offline", () => roomCode && banner("You're offline — we'll reconnect as soon as you're back.", true));


function send(msg) {
  if (ws?.readyState === 1) ws.send(JSON.stringify(msg));
}

function onMessage(msg) {
  switch (msg.t) {
    case "welcome":
      me = msg.you;
      break;
    case "lobby":
      // Back in the lobby means last game's role is gone. (Roles arrive just
      // before the "reveal" update, so only clear when the room says lobby.)
      clockOffset = (msg.now ?? Date.now()) - Date.now();
      if (msg.phase === "lobby" && lobby?.phase !== "lobby") { myRole = null; allies = []; view = null; myTasks = []; }
      if (msg.phase === "reveal" && lobby?.phase !== "reveal") { myTrail = []; mySaw = []; }
      if (msg.phase === "meeting" && lobby?.phase !== "meeting") { resetMeetingUI(); sfx.bell(); buzz([90, 60, 90]); }
      if (msg.phase !== "playing") closeTask();
      if (msg.phase === "lobby") $("snuffed-overlay").hidden = true;
      lobby = msg;
      renderPhase();
      break;
    case "role":
      myRole = msg.role;
      allies = msg.allies || [];
      if (lobby && lobby.phase !== "lobby") renderPhase();
      break;
    case "tasks":
      myTasks = msg.tasks;
      if (lobby?.phase === "playing") { renderHarbor(); renderTasks(); }
      break;
    case "taskChallenge":
      openTask(msg);
      break;
    case "taskResult":
      onTaskResult(msg);
      break;
    case "witness":
      toast(msg.text, msg.kind === "snuff" ? "danger" : "witness");
      mySaw.push({ kind: msg.kind, who: msg.who, victim: msg.victim });
      if (msg.kind === "snuff") { flashScreen(); sfx.snuff(); buzz([60, 40, 120]); }
      else sfx.chime(true);
      break;
    case "snuffed":
      sfx.snuff();
      buzz([200, 80, 200]);
      showSnuffed(msg.by);
      break;
    case "chat":
      if (lobby?.meeting) {
        if (!lobby.meeting.chat.some((l) => l.id === msg.line.id)) lobby.meeting.chat.push(msg.line);
        appendChat(msg.line);
        if (msg.line.who && msg.line.who !== me) sfx.tick();
        if (msg.line.who === typingWho) hideTyping();
      }
      break;
    case "typing":
      showTyping(msg.who);
      break;
    case "view": {
      // Convert the server's "ready at" into our own clock.
      const wait = Math.max(0, msg.readyAt - msg.now);
      const arrived = view && view.here !== msg.here;
      if (myTrail[myTrail.length - 1] !== msg.here && lobby?.phase === "playing") myTrail.push(msg.here);
      if (myTrail.length > 8) myTrail.shift();
      view = {
        here: msg.here, neighbors: msg.neighbors, present: msg.present, wisps: msg.wisps ?? [],
        cold: msg.cold ?? [], alive: msg.alive !== false,
        fog: !!msg.fog, shapes: msg.shapes ?? 0, fogReadyAt: msg.fogReadyAt ?? null,
        readyAtLocal: Date.now() + wait,
        snuffReadyAtLocal: msg.snuffReadyAt == null ? null : Date.now() + Math.max(0, msg.snuffReadyAt - msg.now),
      };
      clearTimeout(readyTimer);
      if (wait > 0) readyTimer = setTimeout(renderHarbor, wait + 30);
      if (lobby?.phase === "playing") {
        renderHarbor();
        if (arrived) $("here-name").classList.add("arrive");
      }
      break;
    }
    case "notice":
      toast(msg.text);
      break;
    case "error":
      if (["no_room", "full", "in_progress", "bad_identity", "removed", "replaced"].includes(msg.code)) {
        leaving = true;
        try { ws.close(); } catch {}
        backHome(msg.text);
      } else {
        $("lobby-error").textContent = msg.text;
        setTimeout(() => ($("lobby-error").textContent = ""), 4000);
      }
      break;
  }
}

function backHome(error) {
  ws = null;
  me = null;
  lobby = null;
  myRole = null;
  allies = [];
  view = null;
  myTasks = [];
  closeTask();
  stopGameTimers();
  roomCode = null;
  banner("");
  if (location.pathname !== "/") history.pushState({}, "", "/");
  document.body.classList.remove("is-shade", "is-wisp");
  if (error) store.set("sh.lastRoom", null); // removed, full or closed: don't offer it again
  show("home");
  homeError(error || "");
  renderWelcome();
}

/** A warm hello for returning players, their record, and a way back into their game. */
async function renderWelcome() {
  const name = store.get("sh.name");
  const rec = loadRecord();
  const box = $("welcome");
  box.hidden = !name;
  if (!name) return;
  const hour = new Date().getHours();
  const greet = hour < 5 ? "Still up" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const playedToday = rec.lastDay === today();
  const keepStreak = rec.days > 1 && !playedToday && rec.lastDay === today(new Date(Date.now() - 86400000));
  $("welcome-hi").textContent = !rec.games
    ? `${greet}, ${name}. Ready for your first night?`
    : keepStreak
      ? `${greet}, ${name}. Play tonight to keep your ${rec.days}-day streak alive.`
      : `${greet}, ${name}. The harbor remembers you.`;
  const rank = rankFor(rec.xp);
  $("welcome-rank").hidden = !rec.games;
  $("welcome-rank-name").textContent = `${rank.name} · ${rec.xp} XP` + (rank.next ? ` · ${rank.toNext} to ${rank.next}` : "");
  $("welcome-rank-fill").style.width = `${rank.progress * 100}%`;
  const meta = $("welcome-record");
  meta.innerHTML = "";
  if (rec.games) {
    for (const [label, value] of [["games", rec.games], ["wins", rec.wins], [rec.days > 1 ? "days in a row" : "best streak", rec.days > 1 ? rec.days : rec.best]]) {
      const li = document.createElement("li");
      li.innerHTML = `<span class="meta-value"></span><span class="meta-label"></span>`;
      li.firstChild.textContent = value;
      li.lastChild.textContent = label;
      meta.append(li);
    }
  }
  meta.hidden = !rec.games;

  // Is your last room still open? Offer the way back in.
  const btn = $("welcome-return");
  btn.hidden = true;
  const code = store.get("sh.lastRoom");
  if (!code) return;
  const info = await fetch(`/api/room/${code}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!info || roomCode) return;
  btn.textContent = info.phase === "lobby" ? `Return to room ${code}` : `Rejoin your game in room ${code}`;
  btn.hidden = false;
  btn.onclick = () => enterRoom(code);
}

// ---------- Phase switching ----------
function renderPhase() {
  if (!lobby) return;
  if (lobby.phase === "lobby") {
    show("lobby");
    renderLobby();
  } else if (lobby.phase === "reveal" && myRole) {
    if ($("reveal").hidden) renderReveal();
    show("reveal");
  } else if (lobby.phase === "playing" && myRole) {
    show("game");
    renderGame();
  } else if (lobby.phase === "meeting" && lobby.meeting) {
    stopGameTimers();
    show("meeting");
    renderMeeting();
  } else if (lobby.phase === "ended" && lobby.result) {
    stopGameTimers();
    const firstTime = $("over").hidden;
    show("over");
    renderOver(firstTime);
  }
}

// ---------- Role reveal ----------
function renderReveal() {
  const self = lobby.players.find((p) => p.id === me);
  const shade = myRole === "shade";
  document.body.classList.toggle("is-shade", shade);
  $("reveal").classList.toggle("shade", shade);
  $("reveal-keeper").innerHTML = shade
    ? shadeSVG({ shape: self?.shape, size: 110 })
    : keeperSVG({ lantern: self?.lantern, shape: self?.shape, size: 110 });
  $("reveal-title").textContent = shade ? "You are a Shade" : "You are a Lantern Keeper";
  $("reveal-text").textContent = shade
    ? "Snuff the harbor lights one by one. Blend in, lie well, and don't get set adrift."
    : `Keep the harbor lit and finish your tasks. ${lobby.shades === 1 ? "One Shade hides" : `${lobby.shades} Shades hide`} among you — find them.`;

  $("reveal-allies").hidden = !(shade && allies.length);
  $("allies-list").innerHTML = "";
  for (const id of allies) {
    const p = lobby.players.find((x) => x.id === id);
    if (!p) continue;
    const li = document.createElement("li");
    li.innerHTML = keeperSVG({ lantern: p.lantern, shape: p.shape, size: 40 });
    const n = document.createElement("span");
    n.textContent = p.name;
    li.append(n);
    $("allies-list").append(li);
  }

  // Countdown bar: drain over the time left in the reveal.
  const left = Math.max(0, Math.min(REVEAL_MS, (lobby.revealEndsAt ?? Date.now()) - Date.now()));
  const bar = $("countdown-bar");
  bar.style.transition = "none";
  bar.style.width = (left / REVEAL_MS) * 100 + "%";
  requestAnimationFrame(() => requestAnimationFrame(() => {
    bar.style.transition = `width ${left}ms linear`;
    bar.style.width = "0%";
  }));
}

// ---------- The harbor ----------
function renderHarbor() {
  if (!view || !lobby) return;
  const self = lobby.players.find((p) => p.id === me);
  const canMove = Date.now() >= view.readyAtLocal;
  const flame = !view.alive ? "#9fc3e8" : myRole === "shade" ? "#9b7bff" : (LANTERNS[self?.lantern] ?? "#ffb347");
  document.body.classList.toggle("is-wisp", !view.alive);

  // Only rebuild the map when it actually looks different, so a tap is never
  // lost to a redraw caused by someone else walking past.
  const todo = myTasks.filter((t) => !t.done).map((t) => t.loc);
  const mapKey = [view.here, view.neighbors.join(), canMove, flame, todo.join(), view.fog].join("|");
  if ($("map").dataset.key !== mapKey) {
    $("map").innerHTML = harborSVG({ here: view.here, neighbors: view.neighbors, canMove, flame, tasks: todo, fog: view.fog });
    $("map").dataset.key = mapKey;
  }
  // The lanterns around you update on their own layer, so a tap is never lost to a redraw.
  const crowd = $("map").querySelector(".crowd-layer");
  if (crowd) {
    crowd.innerHTML = crowdSVG({
      here: view.here, flame, fog: view.fog, shapes: view.shapes,
      company: view.present.map((id) => ({ lantern: playerOf(id)?.lantern, wisp: view.wisps.includes(id) })),
      self: { lantern: self?.lantern, wisp: !view.alive },
    });
  }
  $("walking").hidden = canMove;
  $("move-hint").textContent = canMove
    ? "Tap a glowing place to walk there."
    : "Catching your breath…";

  const place = PLACES[view.here];
  const nameEl = $("here-name");
  nameEl.textContent = place?.name ?? view.here;
  $("here-text").textContent = place?.text ?? "";

  const taskHere = myTasks.find((t) => t.loc === view.here && !t.done);
  $("task-here").hidden = !taskHere;
  if (taskHere) {
    $("task-here").textContent = taskHere.name;
    $("task-here").dataset.id = taskHere.id;
  }

  const list = $("here-list");
  list.innerHTML = "";
  const company = view.present.map((id) => lobby.players.find((p) => p.id === id)).filter(Boolean);
  if (view.fog) {
    const li = document.createElement("li");
    li.className = "alone shapes";
    li.textContent = view.shapes
      ? `${view.shapes} ${view.shapes === 1 ? "shape" : "shapes"} in the fog. You can't make out who.`
      : "Nobody — as far as you can tell.";
    list.append(li);
  } else if (!company.length) {
    const li = document.createElement("li");
    li.className = "alone";
    li.textContent = "Nobody. Just you and the fog.";
    list.append(li);
  }
  for (const p of company) {
    const li = document.createElement("li");
    li.innerHTML = view.wisps.includes(p.id)
      ? wispSVG({ lantern: p.lantern, size: 24 })
      : keeperSVG({ lantern: p.lantern, shape: p.shape, dim: !p.connected, size: 30 });
    if (view.wisps.includes(p.id)) li.classList.add("is-wisp");
    const n = document.createElement("span");
    n.textContent = p.name;
    li.append(n);
    if (allies.includes(p.id)) li.append(tag("Shade", "shade"));
    if (p.isBot) li.append(tag("Bot", "bot"));
    list.append(li);
  }
  requestAnimationFrame(() => nameEl.classList.remove("arrive"));
  renderSituation(company);
}

// What you can do right here, explained in plain words.
function stopGameTimers() {
  clearInterval(snuffTimer);
  clearInterval(fogTimer);
  document.body.classList.remove("in-fog");
}

function renderSituation(company) {
  // A countdown can still tick after the game screen has gone (game over, back to lobby).
  if (!view || !lobby || lobby.phase !== "playing") return stopGameTimers();
  const alive = view.alive;
  const shade = myRole === "shade";

  $("goal").textContent = !alive
    ? (shade ? "Your shadow is spent. Watch the harbor." : "Keep doing your tasks — they still count.")
    : shade
      ? "Snuff Keepers when nobody's watching. Fake tasks to blend in."
      : "Do your tasks. Notice who you see where. Find the Shade.";
  $("wisp-banner").hidden = alive;
  if (!alive && !$("wisp-art").innerHTML) {
    const self = playerOf(me);
    $("wisp-art").innerHTML = wispSVG({ lantern: self?.lantern, size: 42 });
  }

  // The Shades' fog.
  const fogOn = !!lobby.fogUntil && lobby.phase === "playing";
  document.body.classList.toggle("in-fog", fogOn);
  $("fog-banner").hidden = !fogOn;
  clearInterval(fogTimer);
  if (fogOn) {
    const tickFog = () => {
      const left = Math.max(0, (lobby?.fogUntil ?? 0) - serverNow());
      $("fog-secs").textContent = `${Math.ceil(left / 1000)}s`;
      if (!left) clearInterval(fogTimer);
    };
    tickFog();
    fogTimer = setInterval(tickFog, 500);
    $("fog-text").textContent = shade && alive
      ? "Your fog is down. The Keepers can't see faces — strike unseen."
      : view.here === "lighthouse" && alive
        ? "Fog! You're at the Lighthouse — relight the great lamp."
        : "Fog! Faces are hidden. Relight the great lamp at the Lighthouse.";
  }

  // Cold lanterns lying here.
  const cold = $("cold-here");
  cold.innerHTML = "";
  cold.hidden = !view.cold.length;
  for (const id of view.cold) {
    const p = playerOf(id);
    const row = document.createElement("div");
    row.className = "cold-row";
    row.innerHTML = coldLanternSVG({ shape: p?.shape, size: 64 });
    const t = document.createElement("span");
    t.textContent = id === me ? "Your own lantern lies cold here." : `${p?.name ?? "Someone"}'s lantern lies cold here.`;
    row.append(t);
    cold.append(row);
  }

  // Buttons for what you can actually do.
  const actions = $("actions");
  actions.innerHTML = "";
  let hint = "";
  if (alive && view.cold.length) {
    const b = document.createElement("button");
    b.className = "report wide";
    b.innerHTML = `${bellSVG({ size: 26 })}<span>Ring the bell — report it</span>`;
    b.addEventListener("click", () => send({ t: "report" }));
    actions.append(b);
    hint = "Everyone will gather in the square and hear whose lantern you found.";
  }
  const self = playerOf(me);
  if (fogOn && alive && view.here === "lighthouse") {
    const b = document.createElement("button");
    b.className = "relight-btn wide";
    b.textContent = "Relight the great lamp";
    b.addEventListener("click", () => { send({ t: "relight" }); sfx.chime(true); });
    actions.append(b);
    if (!hint) hint = shade ? "Relighting it yourself would look very innocent…" : "Everyone will know you lifted the fog.";
  }
  if (alive && shade && lobby.phase === "playing" && !fogOn && view.fogReadyAt) {
    const wait = Math.max(0, view.fogReadyAt - serverNow());
    const b = document.createElement("button");
    b.className = "fog-btn wide";
    b.disabled = wait > 0;
    b.textContent = wait > 0 ? `Call the fog · ready in ${Math.ceil(wait / 1000)}s` : "Call the fog";
    b.addEventListener("click", () => {
      if (confirm("Hide every face from the Keepers for 30 seconds? Anyone can lift it at the Lighthouse.")) send({ t: "fog" });
    });
    actions.append(b);
  }
  if (alive && view.here === "market" && lobby.phase === "playing" && !self?.bellUsed && !view.cold.length) {
    const b = document.createElement("button");
    b.className = "bell-btn wide";
    b.innerHTML = `${bellSVG({ size: 22 })}<span>Ring the emergency bell</span>`;
    b.addEventListener("click", () => {
      if (confirm("Call everyone to the square now? You can only ring the bell once per game.")) send({ t: "bell" });
    });
    actions.append(b);
  }
  clearInterval(snuffTimer);
  if (alive && shade && lobby.phase === "playing") {
    const targets = company.filter((p) => !allies.includes(p.id) && !view.wisps.includes(p.id));
    const wait = Math.max(0, (view.snuffReadyAtLocal ?? 0) - Date.now());
    for (const p of targets) {
      const b = document.createElement("button");
      b.className = "snuff wide";
      b.disabled = wait > 0;
      b.textContent = wait > 0 ? `Snuff ${p.name} · ready in ${Math.ceil(wait / 1000)}s` : `Snuff ${p.name}'s lantern`;
      b.addEventListener("click", () => {
        if (targets.length > 1 && !confirm(`${targets.length - 1} other Keeper${targets.length > 2 ? "s" : ""} will see you do it. Snuff ${p.name} anyway?`)) return;
        send({ t: "snuff", target: p.id });
      });
      actions.append(b);
    }
    if (targets.length === 1 && !hint) hint = wait > 0
      ? `You're alone with ${targets[0].name}. Your shadow is still gathering…`
      : `You're alone with ${targets[0].name}. Nobody would see.`;
    else if (targets.length > 1 && !hint) hint = `${targets.length} Keepers here — anyone left standing would see you.`;
    const fogWait = view.fogReadyAt ? view.fogReadyAt - serverNow() : 0;
    if ((targets.length && wait > 0) || (!fogOn && fogWait > 0)) snuffTimer = setInterval(() => renderSituation(company), 1000);
  }
  $("hint").textContent = hint;
  $("hint").hidden = !hint;
}

function flashScreen() {
  document.body.classList.remove("flash");
  void document.body.offsetWidth;
  document.body.classList.add("flash");
}

function showSnuffed(by) {
  closeTask();
  const self = playerOf(me);
  $("snuffed-art").innerHTML = coldLanternSVG({ shape: self?.shape, size: 120 });
  $("snuffed-text").textContent = `${nameOf(by)} snuffed your lantern. You're a wisp now: nobody living can see you, but your tasks still light the harbor.`;
  $("snuffed-overlay").hidden = false;
  $("snuffed-ok").focus();
}

function onMapActivate(e) {
  const target = e.target.closest("[data-place]");
  if (!target) return;
  if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
  e.preventDefault();
  if (!view || Date.now() < view.readyAtLocal) return;
  send({ t: "move", to: target.dataset.place });
  // Show the step straight away; the server's reply confirms it.
  view.readyAtLocal = Date.now() + 1500;
  renderHarbor();
}

// ---------- The meeting ----------
const STAGE_MS = { gather: 6000, discuss: 45000, vote: 25000, result: 8000 };
const STAGE_LABEL = { gather: "The Harbor Bell rings", discuss: "Talk it over", vote: "Vote", result: "The verdict" };

function resetMeetingUI() {
  closeTask();
  chatShown = new Set();
  myVote = null;
  voteChoice = null;
  shownStage = null;
  $("chat").innerHTML = "";
  $("chat-input").value = "";
  $("snuffed-overlay").hidden = true;
  hideTyping();
}

function renderMeeting() {
  const m = lobby.meeting;
  const meAlive = !lobby.players.find((p) => p.id === me)?.snuffed && !lobby.players.find((p) => p.id === me)?.adrift && view?.alive !== false;
  const stageChanged = shownStage !== m.stage;
  shownStage = m.stage;

  if (!$("bell-art").innerHTML) $("bell-art").innerHTML = bellSVG({ size: 64 });
  $("meet-stage").textContent = STAGE_LABEL[m.stage];
  const place = PLACES[m.loc]?.name ?? m.loc;
  if (m.kind === "bell") {
    $("meeting-title").textContent = `${nameOf(m.reporter)} rang the emergency bell`;
    $("meeting-text").textContent = "No lantern was found — they've called everyone together.";
  } else {
    const found = m.found.map(nameOf);
    $("meeting-title").textContent = `${nameOf(m.reporter)} rang the bell`;
    $("meeting-text").textContent = found.length
      ? `${found.join(" and ")}'s lantern${found.length > 1 ? "s were" : " was"} found cold at the ${place}.`
      : `Something was found at the ${place}.`;
  }

  // The snuffed, so far.
  const cold = $("meeting-cold");
  cold.hidden = m.stage === "result" || !m.snuffed.length;
  if (stageChanged || !cold.childElementCount) {
    cold.innerHTML = "";
    for (const id of m.snuffed) {
      const p = playerOf(id);
      const li = document.createElement("li");
      li.innerHTML = coldLanternSVG({ shape: p?.shape, size: 44 });
      const n = document.createElement("span");
      n.textContent = (p?.name ?? "Someone") + (id === me ? " (you)" : "");
      li.append(n);
      cold.append(li);
    }
  }

  // Chat: everything so far, then whatever arrives.
  for (const line of m.chat) appendChat(line);
  $("chat-wrap").hidden = m.stage === "result";
  $("chat-form").hidden = !meAlive;
  $("quick").hidden = !meAlive;
  $("wisp-note").hidden = meAlive;
  if (meAlive && stageChanged) renderQuick();

  // Ready to vote early.
  const ready = $("ready-btn");
  ready.hidden = !(m.stage === "discuss" && meAlive);
  const iAmReady = m.ready.includes(me);
  ready.disabled = iAmReady;
  ready.textContent = iAmReady ? "Waiting for the others to be ready…" : "I'm ready to vote";

  // Voting.
  $("vote-wrap").hidden = m.stage !== "vote";
  if (m.stage === "vote") renderVote(meAlive);

  // The verdict.
  $("verdict").hidden = m.stage !== "result";
  if (m.stage === "result" && stageChanged) renderVerdict();

  startTimer(m);
}

function startTimer(m) {
  cancelAnimationFrame(timerRaf);
  const total = STAGE_MS[m.stage] ?? 10000;
  const fill = $("timer-fill");
  const secs = $("timer-secs");
  const tick = () => {
    const left = Math.max(0, m.stageEndsAt - serverNow());
    fill.style.strokeDashoffset = String(100 - Math.min(1, left / total) * 100);
    secs.textContent = Math.ceil(left / 1000);
    document.querySelector(".timer").classList.toggle("urgent", left < 6000 && m.stage !== "result");
    if (left > 0 && lobby?.meeting === m) timerRaf = requestAnimationFrame(tick);
  };
  tick();
}

function appendChat(line) {
  if (chatShown.has(line.id)) return;
  chatShown.add(line.id);
  const li = document.createElement("li");
  const list = $("chat");
  if (!line.who) {
    li.className = "line system";
    li.textContent = line.text;
  } else {
    const p = playerOf(line.who);
    li.className = "line" + (line.who === me ? " mine" : "") + (p?.isBot ? " bot" : "");
    const av = document.createElement("span");
    av.className = "avatar";
    av.innerHTML = keeperSVG({ lantern: p?.lantern, shape: p?.shape, size: 20 });
    const body = document.createElement("div");
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = p?.name ?? "Someone";
    who.style.color = LANTERNS[p?.lantern] ?? "";
    body.append(who);
    if (allies.includes(line.who)) body.append(tag("Shade", "shade"));
    const text = document.createElement("p");
    text.textContent = line.text;
    body.append(text);
    li.append(av, body);
  }
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
  list.append(li);
  if (atBottom || line.who === me) list.scrollTop = list.scrollHeight;
}

let typingWho = null;
function showTyping(who) {
  typingWho = who;
  $("typing").textContent = `${nameOf(who)} is thinking…`;
  $("typing").hidden = false;
  clearTimeout(typingTimer);
  typingTimer = setTimeout(hideTyping, 9000);
}
function hideTyping() {
  typingWho = null;
  $("typing").hidden = true;
}

// Quick lines, built from what you actually experienced this game.
function renderQuick() {
  const lines = [];
  for (const e of mySaw.slice().reverse()) {
    if (e.kind === "snuff" && playerOf(e.who) && !playerOf(e.who).adrift) lines.push(`I saw ${nameOf(e.who)} snuff ${nameOf(e.victim)}!`);
    if (e.kind === "lamp" && playerOf(e.who) && !playerOf(e.who).snuffed) lines.push(`${nameOf(e.who)} lit the great lamp — they're a Keeper.`);
  }
  const trail = [...new Set(myTrail.slice(-3).reverse())].map((l) => PLACES[l]?.name).filter(Boolean);
  if (trail.length) lines.push(`I was at the ${trail.reverse().join(", then the ")}.`);
  lines.push("I didn't see anything.", "Where was everyone?", "Let's skip — not enough to go on.");
  const box = $("quick");
  box.innerHTML = "";
  for (const text of [...new Set(lines)].slice(0, 5)) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = text;
    b.addEventListener("click", () => say(text));
    box.append(b);
  }
}

function say(text) {
  const t = text.trim();
  if (!t) return;
  send({ t: "say", text: t });
}

function renderVote(meAlive) {
  const m = lobby.meeting;
  const voted = m.voted.includes(me);
  const living = lobby.players.filter((p) => !p.snuffed && !p.adrift && !m.snuffed.includes(p.id));
  const grid = $("vote-grid");
  grid.innerHTML = "";
  for (const p of living) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "vote-card" + (voteChoice === p.id ? " chosen" : "") + (myVote === p.id ? " mine" : "");
    b.disabled = !meAlive || voted || p.id === me;
    b.innerHTML = keeperSVG({ lantern: p.lantern, shape: p.shape, size: 34 });
    const n = document.createElement("span");
    n.className = "vote-name";
    n.textContent = p.name + (p.id === me ? " (you)" : "");
    b.append(n);
    if (m.voted.includes(p.id)) {
      const c = document.createElement("span");
      c.className = "voted-badge";
      c.textContent = "voted";
      b.append(c);
    }
    if (allies.includes(p.id)) b.append(tag("Shade", "shade"));
    b.addEventListener("click", () => { voteChoice = p.id; renderVote(meAlive); });
    li.append(b);
    grid.append(li);
  }
  const go = $("vote-go");
  go.disabled = !voteChoice || voted || !meAlive;
  go.textContent = voteChoice ? `Set ${nameOf(voteChoice)} adrift` : "Choose someone";
  $("vote-skip").disabled = voted || !meAlive;
  $("vote-prompt").textContent = meAlive ? "Who should be set adrift?" : "The living are voting…";
  $("vote-status").textContent = voted
    ? `You voted${myVote === "skip" ? " to skip" : ` for ${nameOf(myVote)}`}. ${m.voted.length} of ${living.length} have voted…`
    : `${m.voted.length} of ${living.length} have voted.`;
}

function castVote(target) {
  myVote = target;
  voteChoice = null;
  send({ t: "vote", target });
  sfx.tick();
}

function renderVerdict() {
  const r = lobby.meeting.result;
  const who = playerOf(r.adrift);
  if (who) {
    $("verdict-art").innerHTML = boatSVG({ lantern: who.lantern, shade: r.wasShade, size: 200 });
    $("verdict-title").textContent = `${who.name}${who.id === me ? " (you)" : ""} is set adrift`;
    $("verdict-text").textContent = r.wasShade ? `${who.name} was a Shade.` : `${who.name} was a Lantern Keeper.`;
    $("verdict").className = "verdict " + (r.wasShade ? "caught" : "wrong");
    sfx.chime(!!r.wasShade);
  } else {
    $("verdict-art").innerHTML = `<div class="fog-art" aria-hidden="true"></div>`;
    $("verdict-title").textContent = r.tie ? "A tie — nobody is set adrift" : "Nobody is set adrift";
    $("verdict-text").textContent = "The fog keeps its secrets a little longer.";
    $("verdict").className = "verdict none";
    sfx.chime(false);
  }
  // Who voted for whom.
  const groups = new Map();
  for (const [voter, target] of Object.entries(r.votes)) {
    if (!groups.has(target)) groups.set(target, []);
    groups.get(target).push(voter);
  }
  const rows = [...groups].sort((a, b) => b[1].length - a[1].length);
  const list = $("tally");
  list.innerHTML = "";
  rows.forEach(([target, voters], i) => {
    const li = document.createElement("li");
    li.style.animationDelay = `${0.25 + i * 0.25}s`;
    const label = document.createElement("span");
    label.className = "tally-target";
    label.textContent = target === "skip" ? "Skipped" : nameOf(target);
    const dots = document.createElement("span");
    dots.className = "tally-voters";
    for (const v of voters) {
      const p = playerOf(v);
      const d = document.createElement("span");
      d.className = "tally-voter";
      d.title = p?.name ?? "";
      d.innerHTML = keeperSVG({ lantern: p?.lantern, shape: p?.shape, size: 16 });
      dots.append(d);
    }
    li.append(label, dots);
    list.append(li);
  });
}

// ---------- Tasks ----------
function renderTasks() {
  const list = $("task-list");
  list.innerHTML = "";
  for (const t of myTasks) {
    const li = document.createElement("li");
    li.className = t.done ? "done" : (view && view.here === t.loc ? "here" : "");
    const name = document.createElement("span");
    name.textContent = t.name;
    const where = document.createElement("span");
    where.className = "muted small";
    where.textContent = t.done ? "done" : PLACES[t.loc]?.name ?? t.loc;
    li.append(name, where);
    list.append(li);
  }
  if (myRole === "shade" && myTasks.length) {
    const note = document.createElement("li");
    note.className = "fake-note muted small";
    note.textContent = "Yours are fake: doing them adds nothing, but helps you blend in. Faking the lamp would be seen through.";
    list.append(note);
  }
}

function startTaskHere() {
  const id = $("task-here").dataset.id;
  if (id) send({ t: "taskStart", id });
}

function openTask(msg) {
  closeTask();
  $("task-title").textContent = msg.name;
  $("task-modal").hidden = false;
  const cleanup = runTask(msg.kind, msg.data, $("task-root"), (answer) => {
    send({ t: "taskDone", id: msg.id, nonce: msg.nonce, answer });
  });
  activeTask = { id: msg.id, nonce: msg.nonce, cleanup };
}

function closeTask(tellServer = false) {
  if (!activeTask) return;
  try { activeTask.cleanup?.(); } catch {}
  activeTask = null;
  $("task-modal").hidden = true;
  $("task-root").innerHTML = "";
  if (tellServer) send({ t: "taskCancel" });
}

function onTaskResult(msg) {
  if (msg.ok) {
    closeTask();
    toast(myRole === "shade" ? "Done. Nobody saw through it." : "Task done. The harbor glows a little brighter.");
    return;
  }
  if (activeTask && activeTask.id === msg.id) {
    closeTask();
    toast(msg.text || "That didn't work. Try again.");
  } else if (msg.text) {
    toast(msg.text);
  }
}

// ---------- Game over ----------
let overTab = "who";
let taleShown = null;   // the tale text we've already typed out

function renderOver(firstTime = false) {
  const r = lobby.result;
  const keepersWon = r.winner === "keepers";
  const mine = r.players.find((p) => p.id === me);
  const myRoleEnd = mine?.role ?? myRole;
  const iWon = myRoleEnd ? (myRoleEnd === "shade") !== keepersWon : null;

  if (firstTime) {
    sfx.chime(keepersWon);
    overTab = "who";
    taleShown = null;
    if (iWon !== null) recordGame(r, iWon, myRoleEnd);
  }

  document.body.classList.toggle("is-shade", !keepersWon);
  $("over").classList.toggle("shade", !keepersWon);
  if (firstTime || !$("over-art").innerHTML) {
    $("over-art").innerHTML = endSceneSVG({ keepersWon, lanterns: lobby.players.map((p) => p.lantern) });
  }
  $("over-title").textContent = keepersWon ? "The Keepers win" : "The Shades win";
  $("over-reason").textContent = r.reason;

  const you = $("over-you");
  if (iWon === null) {
    you.hidden = true;
  } else {
    you.hidden = false;
    you.className = "over-you " + (iWon ? "won" : "lost");
    const as = myRoleEnd === "shade" ? "a Shade" : "a Lantern Keeper";
    you.textContent = iWon ? `You won as ${as}` : `You played as ${as} — so close`;
  }

  // This game, and your record on this device.
  const rec = loadRecord();
  const meta = $("over-meta");
  meta.innerHTML = "";
  const chip = (label, value) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="meta-value"></span><span class="meta-label"></span>`;
    li.firstChild.textContent = value;
    li.lastChild.textContent = label;
    meta.append(li);
  };
  chip("game length", minutes(r.durationMs));
  if (rec.games) {
    chip(rec.wins === 1 ? "win" : "wins", `${rec.wins}/${rec.games}`);
    if (rec.streak > 1) chip("win streak", rec.streak);
    if (rec.days > 1) chip("days in a row", rec.days);
  }

  renderXP(r, firstTime);
  renderFates(r);
  renderHonors(r);
  renderTale(r);
  selectTab(overTab, false);

  // What happens next.
  const isHost = lobby.hostId === me;
  $("over-host").hidden = !isHost;
  $("over-wait").hidden = isHost;
  $("over-wait").textContent = `Waiting for ${nameOf(lobby.hostId)} to start another night…`;
}

const minutes = (ms) => {
  const m = Math.max(1, Math.round(ms / 60000));
  return `${m} min`;
};

function renderFates(r) {
  const list = $("over-players");
  list.innerHTML = "";
  // Shades first, then the Keepers — survivors before the fallen.
  const order = { shade: 0, keeper: 1 };
  const fateOrder = { survived: 0, adrift: 1, snuffed: 2 };
  const rows = [...r.players].sort((a, b) => order[a.role] - order[b.role] || fateOrder[a.fate] - fateOrder[b.fate]);
  for (const s of rows) {
    const p = playerOf(s.id);
    const li = document.createElement("li");
    li.className = `fate ${s.role} ${s.fate}` + (s.id === me ? " me" : "");
    const art = document.createElement("span");
    art.className = "fate-art";
    art.innerHTML = s.fate === "snuffed"
      ? coldLanternSVG({ shape: p?.shape, size: 46 })
      : s.role === "shade" ? shadeSVG({ shape: p?.shape, size: 30 }) : keeperSVG({ lantern: p?.lantern, shape: p?.shape, size: 30 });
    const body = document.createElement("div");
    body.className = "fate-body";
    const name = document.createElement("strong");
    name.textContent = (p?.name ?? "Someone") + (s.id === me ? " (you)" : "");
    const role = document.createElement("span");
    role.className = "role-pill " + s.role;
    role.textContent = s.role === "shade" ? "Shade" : "Keeper";
    const line = document.createElement("span");
    line.className = "fate-line";
    const what = s.fate === "survived" ? "Made it through the night"
      : s.fate === "adrift" ? "Set adrift by the town"
      : `Snuffed at the ${PLACES[s.where]?.name ?? "harbor"}`;
    const extra = s.role === "keeper" ? ` · ${s.tasksDone}/${s.tasksTotal} tasks` : s.snuffs ? ` · snuffed ${s.snuffs}` : "";
    line.textContent = what + extra;
    if (p?.isBot) name.append(" ", tag("Bot", "bot"));
    body.append(name, role, line);
    li.append(art, body);
    list.append(li);
  }
}

function renderHonors(r) {
  const list = $("over-honors");
  list.innerHTML = "";
  if (!r.honors.length) {
    const li = document.createElement("li");
    li.className = "honor empty";
    li.textContent = "A quiet night — no honors this time.";
    list.append(li);
    return;
  }
  r.honors.forEach((h, i) => {
    const li = document.createElement("li");
    li.className = "honor" + (h.who === me ? " me" : "");
    li.style.animationDelay = `${i * 0.12}s`;
    const icon = document.createElement("span");
    icon.className = "honor-icon";
    icon.innerHTML = honorIcon(h.id);
    const body = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = h.title;
    const who = document.createElement("span");
    who.className = "honor-who";
    who.textContent = `${nameOf(h.who)}${h.who === me ? " (you)" : ""} — ${h.why}`;
    body.append(title, who);
    li.append(icon, body);
    list.append(li);
  });
}

let typeTimer = 0;
function renderTale(r) {
  const el = $("tale-text");
  $("share").disabled = !r.tale;
  if (!r.tale) {
    el.className = "tale-text waiting";
    el.textContent = "The storyteller is gathering the night's events…";
    $("tale-by").textContent = "";
  } else if (taleShown !== r.tale) {
    taleShown = r.tale;
    el.className = "tale-text";
    $("tale-by").textContent = r.taleBy === "ai" ? "Told by the harbor's storyteller · written with Workers AI" : "Told by the harbor's storyteller";
    typeOut(el, r.tale, overTab === "tale");
  }

  const tl = $("timeline");
  tl.innerHTML = "";
  const n = (id) => nameOf(id);
  const where = (loc) => PLACES[loc]?.name ?? "harbor";
  const events = [{ at: 0, kind: "start" }, ...r.log, { at: r.durationMs, kind: "end" }];
  for (const e of events) {
    const text = {
      start: "Night falls. The lanterns are lit.",
      snuff: `${n(e.who)} snuffed ${n(e.victim)} at the ${where(e.loc)}`,
      report: `${n(e.who)} found the cold lantern and rang the bell`,
      bell: `${n(e.who)} rang the emergency bell`,
      adrift: `${n(e.who)} was set adrift — ${e.wasShade ? "a Shade!" : "a Keeper"}`,
      spared: "The town couldn't agree. Nobody was set adrift.",
      fog: `${n(e.who)} called the fog`,
      relight: `${n(e.who)} relit the great lamp`,
      end: r.winner === "keepers" ? "Dawn. The Keepers win." : "Darkness. The Shades win.",
    }[e.kind];
    if (!text) continue;
    const li = document.createElement("li");
    li.className = "tl " + e.kind;
    const t = document.createElement("time");
    const sec = Math.round(e.at / 1000);
    t.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
    const span = document.createElement("span");
    span.textContent = text;
    li.append(t, span);
    tl.append(li);
  }
}

/** Type the tale out letter by letter (instantly if motion is reduced). */
function typeOut(el, text, animate) {
  clearInterval(typeTimer);
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (!animate || reduce) { el.textContent = text; return; }
  el.textContent = "";
  let i = 0;
  const step = Math.max(1, Math.ceil(text.length / 160)); // about 3 seconds in all
  typeTimer = setInterval(() => {
    i += step;
    el.textContent = text.slice(0, i);
    if (i >= text.length) clearInterval(typeTimer);
  }, 18);
}

function selectTab(tab, userChose = true) {
  const was = overTab;
  overTab = tab;
  for (const t of ["who", "honors", "tale"]) {
    $("tab-" + t).hidden = t !== tab;
    $("tabbtn-" + t).setAttribute("aria-selected", String(t === tab));
    $("tabbtn-" + t).tabIndex = t === tab ? 0 : -1;
  }
  // Opening the tale for the first time types it out.
  if (userChose && tab === "tale" && was !== "tale" && lobby?.result?.tale) typeOut($("tale-text"), lobby.result.tale, true);
}

async function shareTale() {
  const r = lobby?.result;
  if (!r?.tale) return;
  const link = location.origin;
  const text = `${r.tale}\n\n— a night in Shadow Haven. Play: ${link}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: "A night in Shadow Haven", text });
      return;
    }
  } catch (e) {
    if (e?.name === "AbortError") return;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast("The tale is copied — paste it anywhere.");
  } catch {
    prompt("Copy the tale:", text);
  }
}

// ---------- Your record, XP and rank on this device ----------
const RANKS = [
  { name: "Deckhand", xp: 0 },
  { name: "Lamplighter", xp: 300 },
  { name: "Harbor Watch", xp: 800 },
  { name: "Fogwalker", xp: 1600 },
  { name: "Keeper of the Flame", xp: 3000 },
  { name: "Lighthouse Legend", xp: 5000 },
];

function rankFor(xp) {
  let i = 0;
  while (i + 1 < RANKS.length && xp >= RANKS[i + 1].xp) i++;
  const cur = RANKS[i], next = RANKS[i + 1];
  return { index: i, name: cur.name, next: next?.name ?? null, toNext: next ? next.xp - xp : 0,
    progress: next ? (xp - cur.xp) / (next.xp - cur.xp) : 1 };
}

function loadRecord() {
  return { games: 0, wins: 0, streak: 0, best: 0, keeper: 0, shade: 0, last: null,
    xp: 0, lastDay: null, days: 0, lastGain: null, ...(store.get("sh.record") || {}) };
}

const today = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/** What this game was worth, and why. */
function xpFor(r, won, role) {
  const mine = r.players.find((p) => p.id === me);
  const parts = [["Played the night", 40]];
  if (won) parts.push([`Won as ${role === "shade" ? "a Shade" : "a Keeper"}`, 100]);
  if (mine?.tasksDone) parts.push([`${mine.tasksDone} task${mine.tasksDone > 1 ? "s" : ""} lit`, mine.tasksDone * 10]);
  if (mine?.sharpVotes) parts.push([`Voted for a Shade${mine.sharpVotes > 1 ? ` ×${mine.sharpVotes}` : ""}`, mine.sharpVotes * 30]);
  if (mine?.snuffs) parts.push([`${mine.snuffs} lantern${mine.snuffs > 1 ? "s" : ""} snuffed`, mine.snuffs * 25]);
  for (const h of r.honors.filter((h) => h.who === me)) parts.push([h.title, 40]);
  return parts;
}

function recordGame(r, won, role) {
  const rec = loadRecord();
  if (rec.last === r.gameId) return; // already counted (e.g. after a refresh)
  rec.last = r.gameId;
  rec.games += 1;
  rec[role === "shade" ? "shade" : "keeper"] += 1;
  if (won) {
    rec.wins += 1;
    rec.streak += 1;
    rec.best = Math.max(rec.best, rec.streak);
  } else {
    rec.streak = 0;
  }
  // Days in a row you've played.
  const t = today(), y = today(new Date(Date.now() - 86400000));
  rec.days = rec.lastDay === t ? rec.days : rec.lastDay === y ? rec.days + 1 : 1;
  rec.lastDay = t;
  // XP.
  const parts = xpFor(r, won, role);
  const gained = parts.reduce((n, [, v]) => n + v, 0);
  rec.lastGain = { gameId: r.gameId, before: rec.xp, after: rec.xp + gained, parts };
  rec.xp += gained;
  store.set("sh.record", rec);
}

/** The XP card on the end screen: what you earned, your rank, and a rank-up moment. */
function renderXP(r, animate) {
  const rec = loadRecord();
  const g = rec.lastGain;
  const box = $("xp");
  if (!g || g.gameId !== r.gameId) { box.hidden = true; return; }
  box.hidden = false;
  const before = rankFor(g.before), after = rankFor(g.after);
  const ranked = after.index > before.index;
  box.classList.toggle("ranked", ranked);
  $("xp-rank").textContent = ranked ? `Rank up — ${after.name}!` : after.name;
  $("xp-gain").textContent = `+${g.after - g.before} XP`;
  $("xp-next").textContent = after.next ? `${after.toNext} XP to ${after.next}` : "The highest rank in the harbor.";
  const why = $("xp-why");
  why.innerHTML = "";
  for (const [label, v] of g.parts) {
    const li = document.createElement("li");
    li.innerHTML = `<span></span><span></span>`;
    li.firstChild.textContent = label;
    li.lastChild.textContent = `+${v}`;
    why.append(li);
  }
  const fill = $("xp-fill");
  const from = ranked ? 0 : before.progress;
  fill.style.transition = "none";
  fill.style.width = `${(animate ? from : after.progress) * 100}%`;
  if (animate) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      fill.style.transition = "width 1.6s cubic-bezier(.2,.8,.2,1) .4s";
      fill.style.width = `${after.progress * 100}%`;
    }));
    if (ranked) setTimeout(() => { sfx.chime(true); buzz([40, 30, 40, 30, 120]); }, 900);
  }
}

// ---------- In game ----------
function renderGame() {
  const isHost = lobby.hostId === me;
  $("game-code").textContent = roomCode;
  $("game-host").hidden = !isHost;
  document.body.classList.toggle("is-shade", myRole === "shade");
  renderHarbor();
  renderTasks();
  const pct = Math.round((lobby.progress ?? 0) * 100);
  $("lights-fill").style.width = pct + "%";
  $("lights-label").textContent = `Harbor lights ${pct}%`;

  $("game-players").innerHTML = "";
  for (const p of lobby.players) {
    const li = document.createElement("li");
    li.className = "player" + (p.id === me ? " me" : "") + (p.connected ? "" : " away");
    li.innerHTML = keeperSVG({ lantern: p.lantern, shape: p.shape, dim: !p.connected, size: 36 });
    const name = document.createElement("span");
    name.className = "player-name";
    name.textContent = p.name + (p.id === me ? " (you)" : "");
    li.append(name);
    const tags = document.createElement("span");
    tags.className = "tags";
    if (p.isHost) tags.append(tag("Host", "host"));
    if (p.isBot) tags.append(tag("Bot", "bot"));
    // Only a Shade's own screen marks their partners.
    if (allies.includes(p.id)) tags.append(tag("Shade", "shade"));
    if (p.snuffed) { tags.append(tag("Snuffed", "away")); li.classList.add("away"); }
    if (!p.connected) tags.append(tag("Away", "away"));
    li.append(tags);
    $("game-players").append(li);
  }
}

let peekTimer;
function peek() {
  const el = $("peek-role");
  if (!el.hidden) return hidePeek();
  el.textContent = myRole === "shade"
    ? "You are a Shade. Snuff the lights without being caught."
    : "You are a Lantern Keeper. Keep the lights burning.";
  el.className = "peek-role " + myRole;
  el.hidden = false;
  $("peek").setAttribute("aria-pressed", "true");
  clearTimeout(peekTimer);
  peekTimer = setTimeout(hidePeek, 3000);
}
function hidePeek() {
  $("peek-role").hidden = true;
  $("peek").setAttribute("aria-pressed", "false");
}

// ---------- Lobby rendering ----------
function renderLobby() {
  if (!lobby) return;
  stopGameTimers();
  document.body.classList.remove("is-shade", "is-wisp");
  $("wisp-art").innerHTML = "";
  const isHost = lobby.hostId === me;
  const count = lobby.players.length;

  $("players").innerHTML = "";
  for (const p of lobby.players) {
    const li = document.createElement("li");
    li.className = "player" + (p.id === me ? " me" : "") + (p.connected ? "" : " away");
    li.innerHTML = keeperSVG({ lantern: p.lantern, shape: p.shape, dim: !p.connected, size: 52 });

    const name = document.createElement("span");
    name.className = "player-name";
    name.textContent = p.name + (p.id === me ? " (you)" : "");
    li.append(name);

    const tags = document.createElement("span");
    tags.className = "tags";
    if (p.isHost) tags.append(tag("Host", "host"));
    if (p.isBot) tags.append(tag("Bot", "bot"));
    if (!p.connected) tags.append(tag("Reconnecting", "away"));
    li.append(tags);

    if (isHost && p.id !== me) {
      const rm = document.createElement("button");
      rm.className = "remove";
      rm.title = `Remove ${p.name}`;
      rm.setAttribute("aria-label", `Remove ${p.name}`);
      rm.textContent = "×";
      rm.addEventListener("click", () => send({ t: "removePlayer", id: p.id }));
      li.append(rm);
    }
    $("players").append(li);
  }

  // Show the seats still needed to start, plus one open seat while there's room.
  const emptyToShow = Math.min(lobby.max - count, Math.max(MIN_PLAYERS - count, 1));
  for (let i = 0; i < emptyToShow; i++) {
    const li = document.createElement("li");
    li.className = "player empty";
    li.innerHTML = `<span class="seat"></span><span class="player-name">${count + i < MIN_PLAYERS ? "Needed" : "Open seat"}</span>`;
    $("players").append(li);
  }

  const need = Math.max(0, MIN_PLAYERS - count);
  $("lobby-status").textContent = need
    ? `${count} of ${lobby.max} Keepers. Need ${need} more to start${isHost ? " — invite friends or add bots." : "."}`
    : `${count} of ${lobby.max} Keepers aboard. ${lobby.shades === 1 ? "One Shade" : `${lobby.shades} Shades`} will hide among you.`;

  $("host-controls").hidden = !isHost;
  renderLevel(isHost, lobby.players.some((p) => p.isBot));
  $("waiting").hidden = isHost;
  $("add-bot").disabled = count >= lobby.max;
  $("start").disabled = need > 0;
  $("start").textContent = need ? `Need ${need} more` : "Start";
}

// ---------- How sharp are the bots? ----------
const LEVEL_NOTE = {
  easy: "Easy: slow to strike, easily fooled. Good for learning.",
  normal: "Normal: the bots play a fair, honest game.",
  cunning: "Cunning: Shade bots strike fast, call the fog, and frame Keepers with confident lies.",
};

/** Auto: pick the level that keeps games close, from this device's record. */
function autoLevel() {
  const rec = loadRecord();
  if (rec.games < 3) return "normal";
  const rate = rec.wins / rec.games;
  return rate >= 0.6 ? "cunning" : rate <= 0.3 ? "easy" : "normal";
}

function renderLevel(isHost, hasBots) {
  const st = lobby.settings ?? { botLevel: "normal", auto: false };
  const chosen = st.auto ? "auto" : st.botLevel;
  for (const b of document.querySelectorAll("#bot-level button")) {
    b.setAttribute("aria-checked", String(b.dataset.level === chosen));
    b.disabled = !isHost;
  }
  $("level-box").hidden = !hasBots && !isHost;
  const auto = st.auto ? `Auto picked ${st.botLevel} from the host's record. ` : "";
  $("level-note").textContent = auto + LEVEL_NOTE[st.botLevel] + (hasBots ? "" : " Add a bot to see it in action.");
}

function chooseLevel(level) {
  if (level === "auto") send({ t: "settings", botLevel: autoLevel(), auto: true });
  else send({ t: "settings", botLevel: level, auto: false });
}

function tag(text, kind) {
  const s = document.createElement("span");
  s.className = "tag tag-" + kind;
  s.textContent = text;
  return s;
}

function initLobby() {
  $("add-bot").addEventListener("click", () => send({ t: "addBot" }));
  for (const b of document.querySelectorAll("#bot-level button")) b.addEventListener("click", () => chooseLevel(b.dataset.level));
  $("start").addEventListener("click", () => send({ t: "start" }));
  const leave = () => {
    leaving = true;
    store.set("sh.lastRoom", null);
    send({ t: "leave" });
    const sock = ws;
    setTimeout(() => { try { sock?.close(); } catch {} }, 200);
    document.body.classList.remove("is-shade");
    backHome();
  };
  $("leave").addEventListener("click", leave);
  $("game-leave").addEventListener("click", () => {
    if (confirm("Leave this game? Your Keeper stays behind until you come back.")) leave();
  });
  $("end-game").addEventListener("click", () => {
    if (confirm("End this game for everyone and go back to the lobby?")) send({ t: "endGame" });
  });
  $("peek").addEventListener("click", peek);
  $("map").addEventListener("click", onMapActivate);
  $("task-here").addEventListener("click", startTaskHere);
  $("task-close").addEventListener("click", () => closeTask(true));
  $("task-modal").addEventListener("keydown", (e) => { if (e.key === "Escape") closeTask(true); });
  $("over-lobby").addEventListener("click", () => send({ t: "endGame" }));
  $("over-again").addEventListener("click", () => { $("over-again").disabled = true; send({ t: "playAgain" }); setTimeout(() => ($("over-again").disabled = false), 3000); });
  $("over-leave").addEventListener("click", leave);
  $("share").addEventListener("click", shareTale);
  const tabs = ["who", "honors", "tale"];
  for (const t of tabs) $("tabbtn-" + t).addEventListener("click", () => selectTab(t));
  document.querySelector(".tabs").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = (tabs.indexOf(overTab) + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
    selectTab(tabs[i]);
    $("tabbtn-" + tabs[i]).focus();
  });
  $("snuffed-ok").addEventListener("click", () => ($("snuffed-overlay").hidden = true));
  $("chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    say($("chat-input").value);
    $("chat-input").value = "";
  });
  $("ready-btn").addEventListener("click", () => send({ t: "ready" }));
  $("vote-go").addEventListener("click", () => voteChoice && castVote(voteChoice));
  $("vote-skip").addEventListener("click", () => castVote("skip"));
  const paintMute = () => {
    $("mute").textContent = isMuted() ? "🔇" : "🔊";
    $("mute").setAttribute("aria-label", isMuted() ? "Sound off" : "Sound on");
  };
  $("mute").addEventListener("click", () => { setMuted(!isMuted()); paintMute(); if (!isMuted()) sfx.tick(); });
  paintMute();
  $("map").addEventListener("keydown", onMapActivate);
  $("copy-link").addEventListener("click", async () => {
    const link = `${location.origin}/r/${roomCode}`;
    try {
      await navigator.clipboard.writeText(link);
      toast("Invite link copied.");
    } catch {
      prompt("Copy this invite link:", link);
    }
  });
}

// ---------- Routing ----------
function route() {
  const m = location.pathname.match(/^\/r\/([A-Za-z]{4})\/?$/);
  if (m) {
    const code = m[1].toUpperCase();
    if (!store.get("sh.name")) {
      // First visit from an invite link: ask for a name, code pre-filled.
      show("home");
      $("code").value = code;
      homeError("");
      $("name").focus();
      return;
    }
    if (code !== roomCode) enterRoom(code);
    return;
  }
  if (ws) { leaving = true; try { ws.close(); } catch {} }
  backHome();
}

initHome();
initHowTo();
initLobby();
window.addEventListener("popstate", route);
route();
