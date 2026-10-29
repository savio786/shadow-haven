// End-to-end tests for step 5: snuffing, wisps, cold lanterns, the bell, and the Shades' win.
import assert from "node:assert/strict";
import { sleep, test, done } from "./helpers.mjs";
import { closeAll, dealUntil, doTask, here, last, roleOf, snuffReady, tasksOf, view, walkTo } from "./game.mjs";

console.log("Shadow Haven snuff tests");

await test("only a Shade, only when ready, only someone right here", async () => {
  const { clients } = await dealUntil(4, 0);
  const shade = clients.find((c) => roleOf(c) === "shade");
  const [k1, k2] = clients.filter((c) => c !== shade);

  assert.ok(view(shade).snuffReadyAt > view(shade).now, "a Shade sees its countdown");
  assert.equal(view(k1).snuffReadyAt, null, "Keepers don't");

  shade.send({ t: "snuff", target: k1.id.playerId });
  await shade.waitFor((m) => m.code === "cooldown");
  k1.send({ t: "snuff", target: k2.id.playerId });
  await k1.waitFor((m) => m.code === "cant_snuff");
  k1.send({ t: "report" });
  await k1.waitFor((m) => m.code === "nothing_here");

  await sleep(1600);
  k1.send({ t: "move", to: "dock" });
  await k1.waitFor((m) => m.t === "view" && m.here === "dock");
  await snuffReady(shade);
  shade.send({ t: "snuff", target: k1.id.playerId });
  await shade.waitFor((m) => m.code === "bad_target");
  closeAll(clients);
});

await test("a snuff, its witnesses, a wisp, the bell — and the Shades' win", async () => {
  const { clients } = await dealUntil(4, 0);
  const shade = clients.find((c) => roleOf(c) === "shade");
  const [victim, w1, w2] = clients.filter((c) => c !== shade);

  // --- The snuff, in front of two witnesses. ---
  await snuffReady(shade);
  shade.send({ t: "snuff", target: victim.id.playerId });
  const told = await victim.waitFor((m) => m.t === "snuffed");
  assert.equal(told.by, shade.id.playerId);
  for (const w of [w1, w2]) {
    const seen = await w.waitFor((m) => m.t === "witness" && m.kind === "snuff");
    assert.equal(seen.who, shade.id.playerId);
    assert.equal(seen.victim, victim.id.playerId);
    const v = await w.waitFor((m) => m.t === "view" && m.cold.length === 1);
    assert.deepEqual(v.cold, [victim.id.playerId], "the cold lantern lies here");
    assert.ok(!v.present.includes(victim.id.playerId), "the living can't see the wisp");
  }
  assert.equal(shade.msgs.some((m) => m.t === "witness"), false, "the Shade doesn't witness itself");

  const wv = await victim.waitFor((m) => m.t === "view" && m.alive === false);
  assert.equal(wv.present.length, 3, "a wisp still sees everyone");
  assert.deepEqual(wv.wisps, []);

  // It isn't public yet.
  const l = last(w1, "lobby");
  assert.equal(l.players.find((p) => p.id === victim.id.playerId).snuffed, false);

  // Straight away again? The shadow needs to gather.
  shade.send({ t: "snuff", target: w1.id.playerId });
  await shade.waitFor((m) => m.code === "cooldown");

  // --- Wisps can't ring the bell, but their tasks still count. ---
  victim.send({ t: "report" });
  await victim.waitFor((m) => m.code === "cant_report");
  const before = last(w1, "lobby").progress;
  const r = await doTask(victim, tasksOf(victim)[0]);
  assert.equal(r.ok, true);
  await w1.lobbyWhere((m) => m.progress > before);

  // A wisp walking in isn't seen; it sees who's there.
  await sleep(200);
  await walkTo(w2, here(victim));
  const v2 = view(w2);
  assert.ok(!v2.present.includes(victim.id.playerId));

  // --- Ring the bell. ---
  w1.msgs.length = 0;
  w1.send({ t: "report" });
  const meet = await w2.lobbyWhere((m) => m.phase === "meeting");
  assert.equal(meet.meeting.reporter, w1.id.playerId);
  assert.equal(meet.meeting.loc, "market");
  assert.deepEqual(meet.meeting.found, [victim.id.playerId]);
  assert.deepEqual(meet.meeting.snuffed, [victim.id.playerId]);
  assert.equal(meet.players.find((p) => p.id === victim.id.playerId).snuffed, true, "now everyone knows");
  for (const c of clients) {
    const v = await c.waitFor((m) => m.t === "view" && m.here === "market" && m === view(c));
    assert.equal(v.here, "market", "everyone gathers in the square");
  }
  w2.send({ t: "move", to: "dock" });
  await w2.waitFor((m) => m.code === "not_playing");

  // Talk, agree to vote, skip — then back to the harbor, the cold lantern cleared away.
  await w1.lobbyWhere((m) => m.meeting?.stage === "discuss", 12_000);
  for (const c of [shade, w1, w2]) c.send({ t: "ready" });
  await w1.lobbyWhere((m) => m.meeting?.stage === "vote");
  for (const c of [shade, w1, w2]) c.send({ t: "vote", target: "skip" });
  const back = await w1.lobbyWhere((m) => m.phase === "playing" && m.meeting === null, 15_000);
  assert.ok(back);
  const after = await w1.waitFor((m) => m.t === "view" && m === view(w1));
  assert.deepEqual(after.cold, []);

  // --- One more snuff and the Shade matches the Keepers. ---
  await snuffReady(shade);
  assert.equal(here(shade), here(w1));
  shade.send({ t: "snuff", target: w1.id.playerId });
  const end = await w2.lobbyWhere((m) => m.phase === "ended");
  assert.equal(end.result.winner, "shades");
  assert.deepEqual(end.result.shades, [shade.id.playerId]);
  assert.ok(end.players.find((p) => p.id === w1.id.playerId).snuffed);
  closeAll(clients);
});

await test("with bots, sooner or later a Shade strikes and someone rings the bell", async () => {
  const { clients } = await dealUntil(1, 6, (cs) => roleOf(cs[0]) === "keeper");
  const me = clients[0];
  // Stay out of the way in the chapel so the bots have the harbor.
  await sleep(1600);
  await walkTo(me, "chapel");
  const l = await me.lobbyWhere((m) => m.phase === "meeting" || m.phase === "ended", 120_000);
  if (l.phase === "meeting") {
    assert.ok(l.meeting.found.length >= 1);
    const reporter = l.players.find((p) => p.id === l.meeting.reporter);
    assert.ok(reporter, "someone rang it");
  }
  closeAll(clients);
});

done("snuff");
