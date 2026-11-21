// Host settings: number of Shades, meeting length, tasks each.
import assert from "node:assert/strict";
import { Client, createRoom, sleep, test, done } from "./helpers.mjs";
import { closeAll, tasksOf } from "./game.mjs";

console.log("Shadow Haven host settings tests (live)");

async function room(humans, bots) {
  const code = await createRoom();
  const clients = [];
  for (let i = 0; i < humans; i++) clients.push(await new Client(code, "S" + (i + 1)).join());
  const host = clients[0];
  for (let i = 0; i < bots; i++) host.send({ t: "addBot" });
  await host.lobbyWhere((m) => m.players.length === humans + bots);
  return { code, clients, host };
}

await test("defaults, and only the host may change them — with sane values only", async () => {
  const { clients, host } = await room(2, 2);
  const [, guest] = clients;
  const l = host.last("lobby");
  assert.deepEqual([l.settings.shades, l.settings.meeting, l.settings.tasks], [0, "normal", 5]);
  guest.msgs.length = 0;
  guest.send({ t: "settings", tasks: 3 });
  assert.equal((await guest.waitFor((m) => m.t === "error")).code, "not_host");
  for (const bad of [{ shades: 4 }, { shades: -1 }, { shades: 1.5 }, { tasks: 2 }, { tasks: 7 }, { meeting: "forever" }, { botLevel: "genius" }]) {
    host.msgs.length = 0;
    host.send({ t: "settings", ...bad });
    assert.equal((await host.waitFor((m) => m.t === "error")).code, "bad_setting", JSON.stringify(bad));
  }
  // One change leaves the others alone.
  host.send({ t: "settings", botLevel: "cunning" });
  await host.lobbyWhere((m) => m.settings.botLevel === "cunning");
  host.send({ t: "settings", meeting: "quick" });
  const after = await host.lobbyWhere((m) => m.settings.meeting === "quick");
  assert.equal(after.settings.botLevel, "cunning");
  closeAll(clients);
});

await test("Shades: the host's pick, capped at a third of the table", async () => {
  const { clients, host } = await room(1, 3);
  host.send({ t: "settings", shades: 2 });
  let l = await host.lobbyWhere((m) => m.settings.shades === 2);
  assert.equal(l.shades, 1, "4 players can only hold 1 Shade");
  for (let i = 0; i < 2; i++) host.send({ t: "addBot" });
  l = await host.lobbyWhere((m) => m.players.length === 6);
  assert.equal(l.shades, 2, "6 players can hold 2");
  host.send({ t: "settings", shades: 1 });
  l = await host.lobbyWhere((m) => m.settings.shades === 1);
  assert.equal(l.shades, 1, "the host can ask for fewer than usual");
  host.send({ t: "settings", shades: 3 });
  for (let i = 0; i < 3; i++) host.send({ t: "addBot" });
  l = await host.lobbyWhere((m) => m.players.length === 9 && m.settings.shades === 3);
  assert.equal(l.shades, 3);
  host.send({ t: "start" });
  l = await host.lobbyWhere((m) => m.phase === "reveal", 8000);
  assert.equal(l.shades, 3, "three Shades were dealt");
  closeAll(clients);
});

await test("tasks each and meeting length apply in the game", async () => {
  const { clients, host } = await room(1, 3);
  host.send({ t: "settings", tasks: 3, meeting: "quick" });
  await host.lobbyWhere((m) => m.settings.tasks === 3 && m.settings.meeting === "quick");
  host.send({ t: "start" });
  await host.waitFor((m) => m.t === "tasks", 8000);
  assert.equal(tasksOf(host).length, 3);
  await host.lobbyWhere((m) => m.phase === "playing", 12_000);
  await sleep(300);
  host.send({ t: "bell" });
  const m = await host.lobbyWhere((x) => x.meeting?.stage === "discuss", 15_000);
  assert.equal(m.meeting.stageMs, 30_000, "quick meetings talk for 30s");
  assert.ok(Math.abs(m.meeting.stageEndsAt - m.now - 30_000) < 2500);
  // Settings are locked once the game is on.
  host.msgs.length = 0;
  host.send({ t: "settings", tasks: 6 });
  assert.equal((await host.waitFor((x) => x.t === "error")).code, "in_progress");
  closeAll(clients);
});

done("settings");
