// Special roles: the Lamplighter (one look into a lantern) and the Locksmith (barred doors).
import assert from "node:assert/strict";
import { sleep, test, done } from "./helpers.mjs";
import { closeAll, dealUntil, last, roleOf, view } from "./game.mjs";

const special = (c) => last(c, "role")?.special ?? null;

console.log("Shadow Haven special role tests (live)");

await test("one Lamplighter among the Keepers, one Locksmith among the Shades — each told only their own", async () => {
  const { clients } = await dealUntil(5, 0, (cs) => cs.some((c) => special(c) === "lamplighter"));
  const lamps = clients.filter((c) => special(c) === "lamplighter");
  const locks = clients.filter((c) => special(c) === "locksmith");
  assert.equal(lamps.length, 1);
  assert.equal(roleOf(lamps[0]), "keeper");
  assert.equal(locks.length, 1);
  assert.equal(roleOf(locks[0]), "shade");
  for (const c of clients) if (c !== lamps[0] && c !== locks[0]) assert.equal(special(c), null);
  assert.equal(view(lamps[0]).canCheck, true);
  assert.equal(view(clients.find((c) => c !== lamps[0])).canCheck, false);
  closeAll(clients);
});

await test("the Lamplighter's one look tells the truth, privately — and only once", async () => {
  const { clients } = await dealUntil(5, 0, (cs) => cs.some((c) => special(c) === "lamplighter"));
  const lamp = clients.find((c) => special(c) === "lamplighter");
  const shade = clients.find((c) => roleOf(c) === "shade");
  const other = clients.find((c) => c !== lamp && c !== shade);
  // Someone else can't look.
  other.msgs.length = 0;
  other.send({ t: "check", target: shade.id.playerId });
  assert.equal((await other.waitFor((m) => m.t === "error")).code, "cant_check");
  // The Lamplighter looks at the Shade (everyone starts in the market square).
  for (const c of clients) c.msgs.length = 0;
  lamp.send({ t: "check", target: shade.id.playerId });
  const seen = await lamp.waitFor((m) => m.t === "checked");
  assert.deepEqual([seen.who, seen.role], [shade.id.playerId, "shade"]);
  await sleep(300);
  for (const c of clients) if (c !== lamp) assert.ok(!c.msgs.some((m) => m.t === "checked"), "nobody else learns it");
  assert.equal(view(lamp).canCheck, false);
  lamp.send({ t: "check", target: other.id.playerId });
  assert.equal((await lamp.waitFor((m) => m.t === "error")).code, "used");
  closeAll(clients);
});

await test("the Locksmith bars the doors: nobody in or out, everyone sees it, the bell opens them", async () => {
  const { clients } = await dealUntil(4, 0, (cs) => cs.some((c) => special(c) === "locksmith"));
  const lock = clients.find((c) => special(c) === "locksmith");
  const keeper = clients.find((c) => c !== lock);
  // Not before the bolts are ready.
  const v = view(lock);
  const ready = v.barReadyAt - v.now;
  lock.msgs.length = 0;
  lock.send({ t: "bar" });
  assert.equal((await lock.waitFor((m) => m.t === "error")).code, "cooldown");
  assert.ok(ready > 15_000 && ready <= 26_000, `bolts ready ~25s into play (${ready})`);
  await sleep(ready + 400);
  lock.send({ t: "bar" });
  const l = await keeper.lobbyWhere((m) => m.barred?.loc === "market");
  assert.ok(l.barred.until - l.now > 10_000);
  assert.ok(keeper.msgs.some((m) => m.t === "notice" && /barred/.test(m.text)), "everyone hears the bolts");
  keeper.msgs.length = 0;
  keeper.send({ t: "move", to: "dock" });
  assert.equal((await keeper.waitFor((m) => m.t === "error")).code, "barred");
  lock.send({ t: "bar" });
  assert.equal((await lock.waitFor((m) => m.t === "error" && m.code !== "cooldown")).code, "barred", "one barring at a time");
  // Ringing the bell calls everyone out.
  keeper.send({ t: "bell" });
  const m = await keeper.lobbyWhere((x) => x.phase === "meeting");
  assert.equal(m.barred, null);
  closeAll(clients);
});

await test("with special roles off, nobody gets one", async () => {
  const { clients, host } = await dealUntil(5, 0, () => true);
  host.send({ t: "endGame" });
  await host.lobbyWhere((m) => m.phase === "lobby");
  host.send({ t: "settings", specials: false });
  await host.lobbyWhere((m) => m.settings.specials === false);
  for (const c of clients) c.msgs.length = 0;
  host.send({ t: "start" });
  await Promise.all(clients.map((c) => c.waitFor((m) => m.t === "role", 8000)));
  for (const c of clients) assert.equal(special(c), null);
  closeAll(clients);
});

done("specials");
