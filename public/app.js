// Shadow Haven — browser client (step 1: home + lobby).
import { keeperSVG, shadeSVG } from "./lanterns.js";

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
let retry = 0;
let retryTimer = null;
let pingTimer = null;
let leaving = false;

// ---------- Screens ----------
const SCREENS = ["home", "lobby", "reveal", "game"];
function show(screen) {
  for (const s of SCREENS) $(s).hidden = s !== screen;
  document.body.dataset.screen = screen;
}

function banner(text) {
  $("banner").textContent = text || "";
  $("banner").hidden = !text;
}

let toastTimer;
function toast(text) {
  $("toast").textContent = text;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 3500);
}

function homeError(text) { $("home-error").textContent = text || ""; }

// ---------- Home ----------
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
      if (msg.phase === "lobby" && lobby?.phase !== "lobby") { myRole = null; allies = []; }
      lobby = msg;
      renderPhase();
      break;
    case "role":
      myRole = msg.role;
      allies = msg.allies || [];
      if (lobby && lobby.phase !== "lobby") renderPhase();
      break;
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

// ---------- In game (placeholder until the harbor map) ----------
function renderGame() {
  const isHost = lobby.hostId === me;
  $("game-code").textContent = roomCode;
  $("game-host").hidden = !isHost;
  document.body.classList.toggle("is-shade", myRole === "shade");

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
  document.body.classList.remove("is-shade");
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
initLobby();
window.addEventListener("popstate", route);
route();
