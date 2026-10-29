// End-to-end tests for step 7: the full result, the tale, and playing again.
import assert from "node:assert/strict";
import { sleep, test, done } from "./helpers.mjs";
import { closeAll, dealUntil, last, roleOf } from "./game.mjs";

const stage = (c, s, ms = 12_000) => c.lobbyWhere((m) => m.phase === "meeting" && m.meeting?.stage === s, ms);

console.log("Shadow Haven end-of-night tests (live)");

await test("catching the Shade: who was who, honors, the log, the tale — then play again", async () => {
  const { clients, host } = await dealUntil(4, 0);
  const shade = clients.find((c) => roleOf(c) === "shade");
  const keepers = clients.filter((c) => c !== shade);

  await sleep(300);
  keepers[1].send({ t: "bell" });
  await Promise.all(clients.map((c) => stage(c, "discuss")));
  for (const c of clients) c.send({ t: "ready" });
  await Promise.all(clients.map((c) => stage(c, "vote")));
  for (const k of keepers) k.send({ t: "vote", target: shade.id.playerId });
  shade.send({ t: "vote", target: keepers[0].id.playerId });

  const end = await host.lobbyWhere((m) => m.phase === "ended", 15_000);
  const r = end.result;
  assert.equal(r.winner, "keepers");
  assert.match(r.gameId, /-1-/);
  assert.ok(r.durationMs > 5000);

  // Who was who.
  assert.equal(r.players.length, 4);
  const sh = r.players.find((p) => p.id === shade.id.playerId);
  assert.deepEqual([sh.role, sh.fate], ["shade", "adrift"]);
  for (const k of keepers) {
    const p = r.players.find((x) => x.id === k.id.playerId);
    assert.deepEqual([p.role, p.fate, p.tasksTotal, p.sharpVotes], ["keeper", "survived", 5, 1]);
  }

  // Honors and the log.
  assert.ok(r.honors.some((h) => h.id === "sharp"));
  assert.ok(r.honors.some((h) => h.id === "bell" && h.who === keepers[1].id.playerId));
  assert.deepEqual(r.log.map((e) => e.kind), ["bell", "adrift"]);
  assert.equal(r.log[1].wasShade, true);

  // The tale arrives a moment later (the written fallback when there's no AI here).
  const told = await host.lobbyWhere((m) => m.phase === "ended" && m.result?.tale, 20_000);
  assert.ok(told.result.tale.length > 60);
  assert.ok(["ai", "fallback"].includes(told.result.taleBy));
  assert.match(told.result.tale, new RegExp(last(host, "lobby").players.find((p) => p.id === shade.id.playerId).name));

  // Only the host can start again — and it's straight into a fresh game.
  keepers[1].send({ t: "playAgain" });
  await keepers[1].waitFor((m) => m.code === "not_host");
  for (const c of clients) c.msgs.length = 0;
  host.send({ t: "playAgain" });
  await Promise.all(clients.map((c) => c.waitFor((m) => m.t === "role")));
  const again = await host.lobbyWhere((m) => m.phase === "reveal");
  assert.equal(again.result, null);
  assert.equal(again.players.every((p) => !p.adrift && !p.snuffed), true, "everyone's lantern is lit again");
  const tasks = await host.waitFor((m) => m.t === "tasks");
  assert.ok(tasks.tasks.every((t) => !t.done));

  // Back to the lobby works from the end screen too.
  await host.lobbyWhere((m) => m.phase === "playing", 12_000);
  closeAll(clients);
});

await test("play again lets go of players who left, and asks for more if too few remain", async () => {
  const { clients, host } = await dealUntil(4, 0);
  const shade = clients.find((c) => roleOf(c) === "shade");
  await sleep(300);
  host.send({ t: "bell" });
  await Promise.all(clients.map((c) => stage(c, "discuss")));
  for (const c of clients) c.send({ t: "ready" });
  await Promise.all(clients.map((c) => stage(c, "vote")));
  for (const c of clients) c.send({ t: "vote", target: c === shade ? "skip" : shade.id.playerId });
  await host.lobbyWhere((m) => m.phase === "ended", 15_000);

  const goner = clients.find((c) => c !== host);
  goner.send({ t: "leave" });
  await host.lobbyWhere((m) => m.players.some((p) => p.id === goner.id.playerId && !p.connected));
  for (const c of clients) c.msgs.length = 0;
  host.send({ t: "playAgain" });
  const l = await host.lobbyWhere((m) => m.phase === "lobby");
  assert.equal(l.players.length, 3);
  await host.waitFor((m) => m.t === "notice" && /add bots/.test(m.text));
  closeAll(clients);
});

done("end");
