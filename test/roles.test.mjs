// End-to-end tests for secret roles (step 2).
import assert from "node:assert/strict";
import { Client, createRoom, sleep, test, done } from "./helpers.mjs";

async function room(humans, bots = 0) {
  const code = await createRoom();
  const clients = [];
  for (let i = 0; i < humans; i++) clients.push(await new Client(code, "P" + (i + 1)).join());
  for (let i = 0; i < bots; i++) clients[0].send({ t: "addBot" });
  await clients[0].lobbyWhere((m) => m.players.length === humans + bots);
  return { code, clients, host: clients[0] };
}

const roleOf = (c) => c.msgs.filter((m) => m.t === "role");
const closeAll = (cs) => cs.forEach((c) => c.close());

console.log("Shadow Haven role tests");

await test("4 Keepers → 1 Shade; each human hears only their own role", async () => {
  const { clients, host } = await room(2, 2);
  host.send({ t: "start" });
  for (const c of clients) {
    await c.waitFor((m) => m.t === "role");
    const l = await c.lobbyWhere((m) => m.phase === "reveal");
    assert.equal(l.shades, 1);
    assert.ok(l.revealEndsAt > Date.now());
  }
  for (const c of clients) {
    assert.equal(roleOf(c).length, 1, "exactly one role message");
    const r = roleOf(c)[0];
    assert.ok(["keeper", "shade"].includes(r.role));
    assert.deepEqual(r.allies, [], "lone Shade / Keepers have no allies");
    // Nothing public ever carries a role.
    for (const m of c.msgs) {
      if (m.t === "lobby") for (const p of m.players) assert.equal("role" in p, false);
    }
  }
  closeAll(clients);
});

await test("7 Keepers → 2 Shades who know each other; Keepers learn nothing", async () => {
  const { clients, host } = await room(7);
  host.send({ t: "start" });
  await Promise.all(clients.map((c) => c.waitFor((m) => m.t === "role")));
  const shades = clients.filter((c) => roleOf(c)[0].role === "shade");
  const keepers = clients.filter((c) => roleOf(c)[0].role === "keeper");
  assert.equal(shades.length, 2);
  assert.equal(keepers.length, 5);
  assert.deepEqual(roleOf(shades[0])[0].allies, [shades[1].id.playerId]);
  assert.deepEqual(roleOf(shades[1])[0].allies, [shades[0].id.playerId]);
  for (const k of keepers) {
    assert.deepEqual(roleOf(k)[0].allies, []);
    assert.equal(JSON.stringify(k.msgs).includes('"shade"'), false, "a Keeper never sees the word shade as a role");
    const shadeIds = shades.map((s) => s.id.playerId);
    assert.equal(roleOf(k)[0].allies.some((id) => shadeIds.includes(id)), false);
  }
  closeAll(clients);
});

await test("Shades are picked fairly (bots included)", async () => {
  // 40 four-player games: each seat should be the Shade sometimes.
  const { clients, host } = await room(1, 3);
  const counts = { human: 0 };
  for (let i = 0; i < 40; i++) {
    host.msgs.length = 0;
    host.send({ t: "start" });
    const r = await host.waitFor((m) => m.t === "role");
    if (r.role === "shade") counts.human++;
    host.send({ t: "endGame" });
    await host.lobbyWhere((m) => m.phase === "lobby");
    await sleep(150); // stay under the room's 20 msg/s flood guard
  }
  // Expected ~10 of 40. Allow a wide band so the test isn't flaky.
  assert.ok(counts.human >= 2 && counts.human <= 22, `human was Shade ${counts.human}/40`);
  closeAll(clients);
});

await test("rejoining mid-game returns your same role; newcomers are kept out", async () => {
  const { code, clients, host } = await room(2, 2);
  host.send({ t: "start" });
  const guest = clients[1];
  const first = await guest.waitFor((m) => m.t === "role");
  guest.close();
  await sleep(100);
  const back = await new Client(code, "P2", guest.id).join();
  const again = await back.waitFor((m) => m.t === "role");
  assert.deepEqual(again, first);

  const late = await new Client(code, "Late").join();
  assert.equal(late.last("error")?.code, "in_progress");
  closeAll([...clients, back, late]);
});

await test("only the host can end the game; ending clears roles for a fresh start", async () => {
  const { clients, host } = await room(2, 2);
  host.send({ t: "start" });
  await host.waitFor((m) => m.t === "role");
  const guest = clients[1];
  guest.send({ t: "endGame" });
  await guest.waitFor((m) => m.t === "error" && m.code === "not_host");

  host.send({ t: "endGame" });
  await guest.lobbyWhere((m) => m.phase === "lobby");
  await guest.waitFor((m) => m.t === "notice");

  guest.msgs.length = 0;
  host.send({ t: "start" });
  await guest.waitFor((m) => m.t === "role");
  closeAll(clients);
});

await test("leaving mid-game keeps your seat; reveal turns into play", async () => {
  const { clients, host } = await room(2, 2);
  host.send({ t: "start" });
  const guest = clients[1];
  await guest.waitFor((m) => m.t === "role");
  guest.send({ t: "leave" });
  const l = await host.lobbyWhere((m) => m.players.some((p) => p.id === guest.id.playerId && !p.connected));
  assert.equal(l.players.length, 4);
  const playing = await host.lobbyWhere((m) => m.phase === "playing", 10_000);
  assert.equal(playing.revealEndsAt, null);
  closeAll(clients);
});

done("roles");
