// Maps: the host picks the harbor or Frostmere, and the game follows that map's paths and names.
import assert from "node:assert/strict";
import { Client, createRoom, test, done } from "./helpers.mjs";
import { closeAll, tasksOf, view } from "./game.mjs";

console.log("Shadow Haven map tests (live)");

async function play(map) {
  const code = await createRoom();
  const host = await new Client(code, "Mapper").join();
  for (let i = 0; i < 3; i++) host.send({ t: "addBot" });
  await host.lobbyWhere((m) => m.players.length === 4);
  if (map) {
    host.send({ t: "settings", map });
    await host.lobbyWhere((m) => m.settings.map === map);
  }
  host.send({ t: "start" });
  await host.waitFor((m) => m.t === "tasks", 8000);
  await host.lobbyWhere((m) => m.phase === "playing", 12_000);
  await host.waitFor((m) => m.t === "view" && m.here === "market", 8000);
  return host;
}

await test("the harbor is the default map", async () => {
  const host = await play(null);
  assert.equal(host.last("lobby").settings.map, "harbor");
  assert.deepEqual([...view(host).neighbors].sort(), ["chapel", "clocktower", "dock", "netloft"]);
  closeAll([host]);
});

await test("Frostmere: its own paths, its own task names", async () => {
  const host = await play("frostmere");
  assert.deepEqual([...view(host).neighbors].sort(), ["dock", "netloft"], "the Ice Market only joins the pier and the barn");
  const names = tasksOf(host).map((t) => t.name);
  assert.ok(names.every((n) => ["Kindle the great beacon", "Light the ship's lamps", "Sort the frozen catch", "Untangle the harness", "Chip the ice", "Stoke the stove"].includes(n)), names.join(", "));
  // A path that exists on the harbor doesn't exist here.
  host.msgs.length = 0;
  host.send({ t: "move", to: "chapel" });
  assert.equal((await host.waitFor((m) => m.t === "error")).code, "bad_move");
  host.send({ t: "move", to: "dock" });
  await host.waitFor((m) => m.t === "view" && m.here === "dock");
  assert.deepEqual([...view(host).neighbors].sort(), ["chapel", "market"]);
  closeAll([host]);
});

await test("only real maps can be picked", async () => {
  const code = await createRoom();
  const host = await new Client(code, "Mapper").join();
  host.msgs.length = 0;
  host.send({ t: "settings", map: "atlantis" });
  assert.equal((await host.waitFor((m) => m.t === "error")).code, "bad_setting");
  closeAll([host]);
});

done("maps");
