// End-to-end tests for the harbor (step 3): movement, fog, and bots walking.
import assert from "node:assert/strict";
import { Client, createRoom, sleep, test, done } from "./helpers.mjs";

const PATHS = {
  dock: ["market", "lighthouse", "netloft"],
  lighthouse: ["dock", "clocktower"],
  netloft: ["dock", "market", "chapel"],
  market: ["dock", "netloft", "clocktower", "chapel"],
  clocktower: ["lighthouse", "market"],
  chapel: ["netloft", "market"],
};

const lastView = (c) => [...c.msgs].reverse().find((m) => m.t === "view");

/** Create a room, start it, and wait until play begins. */
async function playingRoom(humans, bots = 0) {
  const code = await createRoom();
  const clients = [];
  for (let i = 0; i < humans; i++) clients.push(await new Client(code, "H" + (i + 1)).join());
  const host = clients[0];
  for (let i = 0; i < bots; i++) host.send({ t: "addBot" });
  await host.lobbyWhere((m) => m.players.length === humans + bots);
  host.send({ t: "start" });
  await Promise.all(clients.map((c) => c.lobbyWhere((m) => m.phase === "playing", 12_000)));
  await Promise.all(clients.map((c) => c.waitFor((m) => m.t === "view", 3000)));
  return { code, clients, host };
}

const closeAll = (cs) => cs.forEach((c) => c.close());

console.log("Shadow Haven harbor tests");

await test("can't walk before play starts", async () => {
  const code = await createRoom();
  const a = await new Client(code, "A").join();
  a.send({ t: "move", to: "dock" });
  await a.waitFor((m) => m.code === "not_playing");
  a.close();
});

await test("everyone starts in the market and sees each other there", async () => {
  const { clients } = await playingRoom(4);
  for (const c of clients) {
    const v = lastView(c);
    assert.equal(v.here, "market");
    assert.deepEqual([...v.neighbors].sort(), [...PATHS.market].sort());
    assert.equal(v.present.length, 3);
    assert.ok(!v.present.includes(c.id.playerId), "you aren't listed as your own company");
  }
  closeAll(clients);
});

await test("fog: you only learn who is where you are", async () => {
  const { clients } = await playingRoom(4);
  const [a, b, c, d] = clients;
  await sleep(1600); // starting cooldown
  a.send({ t: "move", to: "dock" });
  const av = await a.waitFor((m) => m.t === "view" && m.here === "dock");
  assert.deepEqual(av.present, [], "nobody at the dock yet");
  // The others see A leave the market…
  for (const o of [b, c, d]) {
    const v = await o.waitFor((m) => m.t === "view" && m.here === "market" && m.present.length === 2);
    assert.ok(!v.present.includes(a.id.playerId));
  }
  // …and B follows A to the dock: both see each other; C and D don't see the dock.
  b.send({ t: "move", to: "dock" });
  await a.waitFor((m) => m.t === "view" && m.here === "dock" && m.present.includes(b.id.playerId));
  await b.waitFor((m) => m.t === "view" && m.here === "dock" && m.present.includes(a.id.playerId));
  await sleep(200);
  for (const o of [c, d]) {
    const v = lastView(o);
    assert.equal(v.here, "market");
    assert.equal(v.present.length, 1);
  }
  // Nothing public ever says where anyone is.
  for (const cl of clients) {
    for (const m of cl.msgs) {
      if (m.t === "lobby") for (const p of m.players) assert.equal("loc" in p, false);
      if (m.t === "view") assert.ok(m.present.every((id) => typeof id === "string"));
    }
  }
  closeAll(clients);
});

await test("only real paths, and a short rest between steps", async () => {
  const { clients } = await playingRoom(2, 2);
  const a = clients[0];
  await sleep(1600);
  a.send({ t: "move", to: "lighthouse" }); // no path from the market
  await a.waitFor((m) => m.code === "bad_move");
  a.send({ t: "move", to: "atlantis" });
  await a.waitFor((m) => m.code === "bad_move" && a.msgs.filter((x) => x.code === "bad_move").length === 2);

  a.send({ t: "move", to: "dock" });
  await a.waitFor((m) => m.t === "view" && m.here === "dock");
  a.msgs.length = 0;
  a.send({ t: "move", to: "lighthouse" }); // too soon
  const v = await a.waitFor((m) => m.t === "view");
  assert.equal(v.here, "dock", "still catching breath");
  assert.ok(v.readyAt > v.now);
  await sleep(1600);
  a.send({ t: "move", to: "lighthouse" });
  await a.waitFor((m) => m.t === "view" && m.here === "lighthouse");
  closeAll(clients);
});

await test("bots wander off on their own, and their minds stay private", async () => {
  const { clients } = await playingRoom(1, 5);
  const a = clients[0];
  const start = lastView(a);
  assert.equal(start.present.length, 5);
  // Within ~15s some bots should have left the market.
  await a.waitFor((m) => m.t === "view" && m.here === "market" && m.present.length < 5, 15_000);
  const all = JSON.stringify(a.msgs);
  for (const secret of ["memory", "personality", "brain", "nextMoveAt", '"role":"shade"', "cameFrom"]) {
    if (secret === '"role":"shade"' && a.msgs.some((m) => m.t === "role" && m.role === "shade")) continue;
    assert.equal(all.includes(secret), false, `leaked ${secret}`);
  }
  closeAll(clients);
});

await test("rejoining mid-game puts you back where you stood", async () => {
  const { code, clients } = await playingRoom(2, 2);
  const a = clients[0];
  await sleep(1600);
  a.send({ t: "move", to: "chapel" });
  await a.waitFor((m) => m.t === "view" && m.here === "chapel");
  a.close();
  await sleep(150);
  const back = await new Client(code, "H1", a.id).join();
  const v = await back.waitFor((m) => m.t === "view");
  assert.equal(v.here, "chapel");
  closeAll([...clients, back]);
});

done("harbor");
