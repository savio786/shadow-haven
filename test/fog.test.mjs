// End-to-end tests for step 8: bot cunning settings and the Shades' fog.
import assert from "node:assert/strict";
import { Client, createRoom, sleep, test, done } from "./helpers.mjs";
import { closeAll, dealUntil, last, roleOf, view, walkTo } from "./game.mjs";

console.log("Shadow Haven fog and cunning tests");

await test("only the host sets how sharp the bots are, and only in the lobby", async () => {
  const code = await createRoom();
  const host = await new Client(code, "Host").join();
  const guest = await new Client(code, "Guest").join();
  assert.deepEqual(last(host, "lobby").settings, { botLevel: "normal", auto: false });
  guest.send({ t: "settings", botLevel: "cunning" });
  await guest.waitFor((m) => m.code === "not_host");
  host.send({ t: "settings", botLevel: "wizard" });
  await host.waitFor((m) => m.code === "bad_setting");
  host.send({ t: "settings", botLevel: "cunning", auto: true });
  const l = await guest.lobbyWhere((m) => m.settings.botLevel === "cunning");
  assert.equal(l.settings.auto, true);
  closeAll([host, guest]);
});

await test("the fog: faces vanish for Keepers, a snuff goes unseen, and relighting the lamp lifts it", async () => {
  const { clients } = await dealUntil(4, 0);
  const shade = clients.find((c) => roleOf(c) === "shade");
  const [victim, w1, lamplighter] = clients.filter((c) => c !== shade);

  // Too early, and Keepers can't call it.
  shade.send({ t: "fog" });
  await shade.waitFor((m) => m.code === "cooldown");
  w1.send({ t: "fog" });
  await w1.waitFor((m) => m.code === "cant_fog");
  w1.send({ t: "relight" });
  await w1.waitFor((m) => m.code === "no_fog");

  // The lamplighter heads for the Lighthouse while we wait for the fog.
  await sleep(1600);
  await walkTo(lamplighter, "lighthouse");
  const v0 = view(shade);
  await sleep(Math.max(0, v0.fogReadyAt - v0.now) + 100);

  shade.send({ t: "fog" });
  await w1.waitFor((m) => m.t === "notice" && /fog rolls in/i.test(m.text));
  const kv = await w1.waitFor((m) => m.t === "view" && m.fog === true);
  assert.deepEqual(kv.present, [], "Keepers can't make out faces");
  assert.equal(kv.shapes, 2, "…but they see two shapes");
  const sv = await shade.waitFor((m) => m.t === "view" && m.shapes === 2 && m === view(shade));
  assert.equal(sv.fog, false, "the Shade sees clearly");
  assert.equal(sv.present.length, 2);
  const fogged = await w1.lobbyWhere((m) => m.fogUntil);
  assert.ok(fogged.fogUntil > Date.now());
  shade.send({ t: "fog" });
  await shade.waitFor((m) => m.code === "fog_on");

  // A snuff in the fog: the witness doesn't see who.
  shade.send({ t: "snuff", target: victim.id.playerId });
  const seen = await w1.waitFor((m) => m.t === "witness" && m.kind === "snuff");
  assert.equal(seen.who, "", "who did it is hidden");
  assert.equal(seen.victim, victim.id.playerId);
  assert.match(seen.text, /shape in the fog/);

  // Relighting only works at the Lighthouse.
  w1.send({ t: "relight" });
  await w1.waitFor((m) => m.code === "not_here");
  lamplighter.send({ t: "relight" });
  const lifted = await w1.waitFor((m) => m.t === "notice" && /relit the great lamp/.test(m.text));
  assert.match(lifted.text, new RegExp(last(w1, "lobby").players.find((p) => p.id === lamplighter.id.playerId).name));
  const clear = await w1.waitFor((m) => m.t === "view" && m.fog === false && m.present.length === 1);
  assert.equal(clear.present[0], shade.id.playerId, "faces are back — the Shade is standing right there");
  await w1.lobbyWhere((m) => m.fogUntil === null);

  // And it needs time before it can come back.
  shade.send({ t: "fog" });
  await shade.waitFor((m) => m.code === "cooldown");
  closeAll(clients);
});

done("fog");
