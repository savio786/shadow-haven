// Play statistics: finished and called-off games land in the Harbor Log,
// anonymously, and the stats page is served.
import assert from "node:assert/strict";
import { BASE, sleep, test, done } from "./helpers.mjs";
import { closeAll, dealUntil, roleOf } from "./game.mjs";

const stats = async (days = 30) => (await fetch(`${BASE}/api/stats?days=${days}`)).json();
const stage = (c, s, ms = 12_000) => c.lobbyWhere((m) => m.phase === "meeting" && m.meeting?.stage === s, ms);

/** Stats are recorded a moment after the game ends; wait until they show. */
async function statsWhere(pred, ms = 8000) {
  const until = Date.now() + ms;
  let s;
  while (Date.now() < until) {
    s = await stats();
    if (pred(s)) return s;
    await sleep(250);
  }
  return s;
}

console.log("Shadow Haven play statistics tests (live)");

await test("a finished game is logged: who won, how, and how it went", async () => {
  const before = await stats();
  const { clients, host } = await dealUntil(4, 0);
  const shade = clients.find((c) => roleOf(c) === "shade");
  const keepers = clients.filter((c) => c !== shade);
  await sleep(300);
  keepers[0].send({ t: "bell" });
  await Promise.all(clients.map((c) => stage(c, "discuss")));
  for (const c of clients) c.send({ t: "ready" });
  await Promise.all(clients.map((c) => stage(c, "vote")));
  for (const k of keepers) k.send({ t: "vote", target: shade.id.playerId });
  shade.send({ t: "vote", target: keepers[0].id.playerId });
  await host.lobbyWhere((m) => m.phase === "ended", 15_000);

  const after = await statsWhere((s) => s.totals.finished === before.totals.finished + 1);
  assert.equal(after.totals.finished, before.totals.finished + 1);
  assert.equal(after.totals.keepers, before.totals.keepers + 1);
  assert.equal(after.endings.adrift, before.endings.adrift + 1, "ended by setting the Shade adrift");
  assert.equal(after.people.asShade.games, before.people.asShade.games + 1, "a person played the Shade");
  assert.equal(after.people.withFriends, before.people.withFriends + 1);
  const g = after.recent[0];
  assert.deepEqual([g.outcome, g.why, g.players, g.humans, g.meetings], ["keepers", "adrift", 4, 4, 1]);
  assert.ok(g.minutes >= 0);
  // Anonymous: nothing that names or identifies anyone.
  const raw = JSON.stringify(after);
  for (const c of clients) assert.ok(!raw.includes(c.id.playerId) && !raw.includes(c.name), "no ids or names in the log");
  closeAll(clients);
});

await test("a game the host calls off is logged as called off — once", async () => {
  const before = await stats();
  const { clients, host } = await dealUntil(4, 0);
  await sleep(300);
  host.send({ t: "endGame" });
  await host.lobbyWhere((m) => m.phase === "lobby");
  const after = await statsWhere((s) => s.totals.calledOff === before.totals.calledOff + 1);
  assert.equal(after.totals.calledOff, before.totals.calledOff + 1);
  assert.equal(after.totals.finished, before.totals.finished, "not counted as finished");
  host.send({ t: "endGame" }); // already in the lobby: nothing more is logged
  await sleep(800);
  assert.equal((await stats()).totals.calledOff, after.totals.calledOff);
  closeAll(clients);
});

await test("the summary answers for each range, and the page is served", async () => {
  for (const days of [7, 30, 90, 365]) {
    const s = await stats(days);
    assert.equal(s.days, days);
    assert.equal(s.perDay.length, Math.min(days, 90));
    assert.equal(s.perDay.at(-1).day, new Date().toISOString().slice(0, 10), "ends today");
  }
  assert.equal((await stats(12345)).days, 30, "odd ranges fall back to 30 days");
  const page = await fetch(`${BASE}/stats`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /The Harbor Log/);
});

done("stats");
