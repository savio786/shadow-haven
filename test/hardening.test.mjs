// Step 9: hardening — limits, idle connections, and a fuzz pass that throws
// junk at the server in every phase of a game. The room must keep working.
import assert from "node:assert/strict";
import { BASE, WS_BASE, Client, createRoom, sleep, test, done } from "./helpers.mjs";
import { closeAll, dealUntil, last, roleOf } from "./game.mjs";

console.log("Shadow Haven hardening tests");

await test("a connection that never joins is closed after a while", async () => {
  const code = await createRoom();
  const closed = await new Promise((resolve) => {
    const ws = new WebSocket(`${WS_BASE}/api/room/${code}/ws`);
    ws.onclose = (e) => resolve(e.code);
    setTimeout(() => resolve("still open"), 45_000); // local alarms are coarser than production
  });
  assert.equal(closed, 4002);
});

await test("a room refuses a flood of connections", async () => {
  const code = await createRoom();
  const socks = [];
  let refused = 0;
  for (let i = 0; i < 45; i++) {
    const ok = await new Promise((resolve) => {
      const ws = new WebSocket(`${WS_BASE}/api/room/${code}/ws`);
      ws.onopen = () => { socks.push(ws); resolve(true); };
      ws.onerror = () => resolve(false);
    });
    if (!ok) refused++;
  }
  assert.ok(socks.length <= 40, `opened ${socks.length}`);
  assert.ok(refused >= 5);
  socks.forEach((s) => s.close());
});

await test("saying the same thing twice in a row is blocked", async () => {
  const { clients } = await dealUntil(4, 0);
  const [a] = clients;
  await sleep(300);
  a.send({ t: "bell" });
  await a.lobbyWhere((m) => m.phase === "meeting");
  a.send({ t: "say", text: "It was the baker" });
  await a.waitFor((m) => m.t === "chat" && m.line.who === a.id.playerId);
  await sleep(1300);
  a.send({ t: "say", text: "it was the BAKER" });
  await a.waitFor((m) => m.code === "repeat");
  await sleep(1300);
  a.send({ t: "say", text: "No really, the baker" });
  await a.waitFor((m) => m.t === "chat" && /No really/.test(m.line.text));
  closeAll(clients);
});

// Every kind of message, with every kind of wrong value.
const junkValues = [null, undefined, 0, -1, 1e309, "", " ", "x".repeat(3000), "<script>", "../../", [], [1, 2], {}, { a: 1 }, true, "skip", "market", "lighthouse", "bot-0000"];
const kinds = ["join", "rename", "addBot", "removePlayer", "start", "endGame", "playAgain", "settings", "move", "taskStart", "taskDone",
  "taskCancel", "snuff", "report", "bell", "say", "ready", "vote", "fog", "relight", "leave", "nonsense", "__proto__", "constructor"];

function junkFor(kind, i) {
  const v = junkValues[i % junkValues.length];
  return { t: kind, id: v, to: v, target: v, text: v, name: v, nonce: v, answer: v, botLevel: v, auto: v, playerId: v, token: v };
}

await test("fuzz: junk in every phase never breaks the room", async () => {
  const { clients, host } = await dealUntil(3, 3);
  const [a, b] = clients;
  const spray = async (c, rounds) => {
    for (let r = 0; r < rounds; r++) {
      for (const k of kinds) {
        if (k === "leave" || k === "endGame" || k === "bell") continue; // valid moves that would end or pause the game
        c.ws.send(JSON.stringify(junkFor(k, r * 7 + k.length)));
      }
      c.ws.send("not json at all {");
      c.ws.send(JSON.stringify([1, 2, 3]));
      c.ws.send(JSON.stringify("just a string"));
      c.ws.send(new Uint8Array([1, 2, 3, 4]));
      await sleep(1100); // stay under the flood guard so the junk is actually processed
    }
  };
  await spray(b, 3);              // while playing
  // The room still answers properly.
  a.msgs.length = 0;
  a.send({ t: "move", to: "dock" });
  await a.waitFor((m) => m.t === "view" && m.here === "dock", 8000);

  await sleep(1600); // the short rest after walking
  a.send({ t: "move", to: "market" });
  await a.waitFor((m) => m.t === "view" && m.here === "market", 8000);
  await sleep(300);
  a.send({ t: "bell" });
  await a.lobbyWhere((m) => m.phase === "meeting", 8000);
  await spray(b, 3);              // during a meeting
  await sleep(1500);              // junk can include valid chat; respect the slow-down rule
  // Speak as someone still alive (a bot Shade may have snuffed one of us).
  const meet = last(a, "lobby").meeting;
  const speaker = [a, b, clients[2]].find((c) => !meet.snuffed.includes(c.id.playerId));
  const listener = [a, b, clients[2]].find((c) => c !== speaker);
  speaker.msgs.length = 0;
  speaker.send({ t: "say", text: "still here" });
  await listener.waitFor((m) => m.t === "chat" && m.line.text === "still here", 8000);

  // A stranger with a forged identity gets nowhere.
  const stranger = new Client(last(a, "lobby") ? a.code : a.code, "Mallory", { playerId: a.id.playerId, token: "x".repeat(32) });
  await stranger.join();
  assert.equal(stranger.last("error")?.code, "bad_identity");

  // And the health check is still fine.
  const h = await (await fetch(`${BASE}/api/health`)).json();
  assert.equal(h.ok, true);
  closeAll([...clients, stranger]);
  void host; void roleOf;
});

done("hardening");
