// Soak test: full games with one human and nine bots, start to finish, twice
// in the same room (Play again). Measures what a game costs to run.
// Needs the server started with --var DEBUG_STATS:on to report counters.
import assert from "node:assert/strict";
import { BASE, Client, createRoom, sleep, test, done } from "./helpers.mjs";

const json = (o) => JSON.stringify(o);
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

/** Play along as a quiet human: ready up and skip in meetings; just watch otherwise. */
async function playUntilEnd(me, maxMs) {
  const start = Date.now();
  const seen = { meetings: 0, msgs: 0, bytes: 0, snuffs: 0 };
  let lastStage = null;
  me.ws.addEventListener("message", (e) => { seen.msgs++; seen.bytes += String(e.data).length; });
  let nextNote = start + 60_000;
  while (Date.now() - start < maxMs) {
    const l = me.last("lobby");
    if (process.env.SOAK_VERBOSE && Date.now() > nextNote) {
      nextNote += 60_000;
      console.log(`    ${Math.round((Date.now() - start) / 1000)}s ${l?.phase} lights ${Math.round((l?.progress ?? 0) * 100)}% ${l?.meeting?.stage ?? ""}`);
    }
    if (l?.phase === "ended") return { ...seen, ms: Date.now() - start, result: l.result };
    const m = l?.meeting;
    if (m && m.stage !== lastStage) {
      lastStage = m.stage;
      if (m.stage === "gather") seen.meetings++;
      if (m.stage === "discuss") me.send({ t: "ready" });
      if (m.stage === "vote") { await sleep(4000); me.send({ t: "vote", target: "skip" }); }
    }
    if (!m) lastStage = null;
    await sleep(250);
  }
  return { ...seen, ms: Date.now() - start, result: null };
}

console.log("Shadow Haven soak test (two full games, 1 human + 9 bots)");

await test("two whole games run to an ending, cheaply", async () => {
  const code = await createRoom();
  const me = await new Client(code, "Soak").join();
  for (let i = 0; i < 9; i++) me.send({ t: "addBot" });
  await me.lobbyWhere((m) => m.players.length === 10);
  me.send({ t: "settings", botLevel: "cunning" });
  await me.lobbyWhere((m) => m.settings.botLevel === "cunning");

  const results = [];
  for (const level of ["cunning", "normal"]) {
    if (level === "normal") {
      me.send({ t: "endGame" });
      await me.lobbyWhere((m) => m.phase === "lobby" && m.result === null);
      me.send({ t: "settings", botLevel: "normal" });
      await me.lobbyWhere((m) => m.settings.botLevel === "normal" && m.phase === "lobby");
      me.msgs.length = 0;
      me.send({ t: "start" });
    } else {
      me.send({ t: "start" });
    }
    await me.lobbyWhere((m) => m.phase === "playing", 15_000);
    const before = (await (await fetch(`${BASE}/api/room/${code}`)).json()).meter ?? {};
    const run = await playUntilEnd(me, 8 * 60_000);
    if (!run.result) {
      const info = await (await fetch(`${BASE}/api/room/${code}`)).json();
      console.log("    stalled:", json({ phase: me.last("lobby")?.phase, progress: me.last("lobby")?.progress, bots: info.bots }));
    }
    assert.ok(run.result, `the ${level} game reached an ending within 8 minutes`);
    const told = await me.lobbyWhere((m) => m.phase === "ended" && m.result?.tale, 20_000);
    assert.ok(told.result.tale.length > 60, "the tale was told");
    const after = (await (await fetch(`${BASE}/api/room/${code}`)).json()).meter ?? {};
    const d = (k) => (after[k] ?? 0) - (before[k] ?? 0);
    const mins = run.ms / 60000;
    const r = {
      level,
      winner: run.result.winner,
      minutes: mins.toFixed(1),
      meetings: run.meetings,
      snuffs: run.result.log.filter((e) => e.kind === "snuff").length,
      fogs: run.result.log.filter((e) => e.kind === "fog").length,
      roomWakeups: d("alarms"),
      storageWrites: d("saves"),
      messagesOut: d("sends"),
      dataOut: kb(d("bytes")),
      oneClientIn: `${run.msgs} msgs / ${kb(run.bytes)}`,
      botLines: d("botLines"),
      tales: d("tales"),
      stateSize: kb(after.stateBytes ?? 0),
    };
    results.push(r);
    console.log("   ", json(r));
  }
  me.close();
  for (const r of results) {
    // Budgets: generous ceilings that would flag a regression, not targets.
    assert.ok(r.storageWrites < 400, `storage writes ${r.storageWrites}`);
    assert.ok(parseInt(r.stateSize) < 128, `state ${r.stateSize}`);
  }
});

done("soak");
