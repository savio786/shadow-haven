// Shadow Haven — browser client.
import { keeperSVG, shadeSVG, coldLanternSVG, wispSVG, bellSVG, LANTERNS } from "./lanterns.js";
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
      if (msg.phase === "lobby" && lobby?.phase !== "lobby") { myRole = null; allies = []; view = null; myTasks = []; }
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
      if (msg.kind === "snuff") flashScreen();
      break;
    case "snuffed":
      showSnuffed(msg.by);
      break;
    case "view": {
      // Convert the server's "ready at" into our own clock.
      const wait = Math.max(0, msg.readyAt - msg.now);
      const arrived = view && view.here !== msg.here;
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
    if ($("meeting").hidden) renderMeeting();
    show("meeting");
  } else if (lobby.phase === "ended" && lobby.result) {
    show("over");
    renderOver();
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

// ---------- The bell ----------
function renderMeeting() {
  const m = lobby.meeting;
  $("bell-art").innerHTML = bellSVG({ size: 120 });
  const place = PLACES[m.loc]?.name ?? m.loc;
  const found = m.found.map(nameOf);
  $("meeting-title").textContent = `${nameOf(m.reporter)} rang the bell`;
  $("meeting-text").textContent = found.length
    ? `${found.join(" and ")}'s lantern${found.length > 1 ? "s were" : " was"} found cold at the ${place}.`
    : `Something was found at the ${place}.`;
  const list = $("meeting-cold");
  list.innerHTML = "";
  for (const id of m.snuffed) {
    const p = playerOf(id);
    const li = document.createElement("li");
    li.innerHTML = coldLanternSVG({ shape: p?.shape, size: 52 });
    const n = document.createElement("span");
    n.textContent = (p?.name ?? "Someone") + (id === me ? " (you)" : "");
    li.append(n);
    list.append(li);
  }
  const total = Math.max(1, m.endsAt - Date.now());
  const bar = $("meeting-bar");
  bar.style.transition = "none";
  bar.style.width = "100%";
  requestAnimationFrame(() => requestAnimationFrame(() => {
    bar.style.transition = `width ${total}ms linear`;
    bar.style.width = "0%";
  }));
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
function renderOver() {
  const r = lobby.result;
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
