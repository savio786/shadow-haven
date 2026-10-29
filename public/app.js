// Shadow Haven — browser client.
import { keeperSVG, shadeSVG, coldLanternSVG, wispSVG, bellSVG, boatSVG, LANTERNS } from "./lanterns.js";
import { sfx, buzz, isMuted, setMuted } from "./sound.js";
import { harborSVG, PLACES } from "./harbor.js";
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

function banner(text) {
  $("banner").textContent = text || "";
  $("banner").hidden = !text;
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
  if (location.pathname !== `/r/${code}`) history.pushState({}, "", `/r/${code}`);
  $("room-code").textContent = code;
  $("players").innerHTML = "";
  $("lobby-status").textContent = "Lighting your lantern…";
  show("lobby");
  connect();
}

function connect() {
  clearTimeout(retryTimer);
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const sock = new WebSocket(`${proto}://${location.host}/api/room/${roomCode}/ws`);
  ws = sock;

  sock.addEventListener("open", () => {
    retry = 0;
    banner("");
    const { playerId, token } = identity();
    sock.send(JSON.stringify({ t: "join", playerId, token, name: store.get("sh.name") || "Keeper" }));
    clearInterval(pingTimer);
    pingTimer = setInterval(() => sock.readyState === 1 && sock.send("ping"), 30_000);
  });

  sock.addEventListener("message", (e) => {
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
    const wait = Math.min(10_000, 500 * 2 ** retry);
    banner("Lost the signal — reconnecting…");
    retryTimer = setTimeout(connect, wait);
  });
}

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
  roomCode = null;
  banner("");
  if (location.pathname !== "/") history.pushState({}, "", "/");
  show("home");
  homeError(error || "");
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
    show("meeting");
    renderMeeting();
  } else if (lobby.phase === "ended" && lobby.result) {
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
  const mapKey = [view.here, view.neighbors.join(), canMove, flame, todo.join()].join("|");
  if ($("map").dataset.key !== mapKey) {
    $("map").innerHTML = harborSVG({ here: view.here, neighbors: view.neighbors, canMove, flame, tasks: todo });
    $("map").dataset.key = mapKey;
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
  if (!company.length) {
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
function renderSituation(company) {
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
    if (targets.length && wait > 0) snuffTimer = setInterval(() => renderSituation(company), 1000);
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
function renderOver(firstTime = false) {
  const r = lobby.result;
  if (firstTime) sfx.chime(r.winner === "keepers");
  const keepersWon = r.winner === "keepers";
  const iWon = (myRole === "shade") !== keepersWon;
  document.body.classList.toggle("is-shade", !keepersWon);
  $("over").classList.toggle("shade", !keepersWon);
  $("over-title").textContent = keepersWon ? "The Keepers win" : "The Shades win";
  $("over-reason").textContent = r.reason + (myRole ? (iWon ? " You won." : " You lost.") : "");
  $("over-shades").innerHTML = "";
  for (const id of r.shades) {
    const p = lobby.players.find((x) => x.id === id);
    if (!p) continue;
    const li = document.createElement("li");
    li.innerHTML = shadeSVG({ shape: p.shape, size: 44 });
    const n = document.createElement("span");
    n.textContent = p.name + (p.id === me ? " (you)" : "");
    li.append(n);
    $("over-shades").append(li);
  }
  const isHost = lobby.hostId === me;
  $("over-host").hidden = !isHost;
  $("over-wait").hidden = isHost;
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
  $("waiting").hidden = isHost;
  $("add-bot").disabled = count >= lobby.max;
  $("start").disabled = need > 0;
  $("start").textContent = need ? `Need ${need} more` : "Start";
}

function tag(text, kind) {
  const s = document.createElement("span");
  s.className = "tag tag-" + kind;
  s.textContent = text;
  return s;
}

function initLobby() {
  $("add-bot").addEventListener("click", () => send({ t: "addBot" }));
  $("start").addEventListener("click", () => send({ t: "start" }));
  const leave = () => {
    leaving = true;
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
