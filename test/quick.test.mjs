// Quick match: Play now finds a seat at an open public table, and a public
// table starts by itself, filling empty seats with bots.
import assert from "node:assert/strict";
import { BASE, Client, createRoom, sleep, test, done } from "./helpers.mjs";

const quick = async () => (await fetch(`${BASE}/api/quick`, { method: "POST" })).json();
const waiting = async () => (await fetch(`${BASE}/api/quick`)).json();

console.log("Shadow Haven quick match tests (live)");

let shared = null;

await test("players who tap Play now together land at the same table", async () => {
  const a = await quick();
  const b = await quick();
  assert.match(a.code, /^[A-Z]{4}$/);
  assert.equal(b.code, a.code, "the second player is sent to the first player's table");
  const p1 = await new Client(a.code, "Quick1").join();
  const p2 = await new Client(b.code, "Quick2").join();
  const l = await p1.lobbyWhere((m) => m.players.length === 2);
  assert.equal(l.settings.public, true);
  assert.ok(l.autoStartAt && l.autoStartAt > l.now, "an open table counts down to its start");
  assert.ok(l.autoStartAt - l.now <= 41_000);
  const w = await waiting();
  assert.ok(w.waiting >= 2, `the home screen can say people are waiting (${w.waiting})`);
  shared = { code: a.code, p1, p2 };
});

await test("a private room is never handed to strangers — until its host opens it", async () => {
  const code = await createRoom();
  const host = await new Client(code, "Private").join();
  for (let i = 0; i < 4; i++) assert.notEqual((await quick()).code, code);
  // Opening it: with more people waiting than any other table, it's the pick.
  const friends = [host];
  for (let i = 0; i < 3; i++) friends.push(await new Client(code, "Friend" + i).join());
  host.send({ t: "settings", public: true });
  const l = await host.lobbyWhere((m) => m.settings.public && m.players.length === 4);
  assert.ok(l.autoStartAt, "opening the room starts its countdown");
  await sleep(300);
  assert.equal((await quick()).code, code);
  // Closing it again takes it off the list.
  host.send({ t: "settings", public: false });
  const closed = await host.lobbyWhere((m) => !m.settings.public);
  assert.equal(closed.autoStartAt, null);
  await sleep(300);
  assert.notEqual((await quick()).code, code);
  friends.forEach((c) => c.close());
});

await test("an open table starts by itself, bots filling the empty seats", async () => {
  const { p1, p2 } = shared;
  const l = await p1.lobbyWhere((m) => m.phase === "reveal", 60_000);
  assert.equal(l.players.length, 6, "filled to six with bots");
  assert.equal(l.players.filter((p) => !p.isBot).length, 2);
  assert.ok(p2.msgs.some((m) => m.t === "role"), "everyone got a role");
  // A table in play isn't offered to anyone else.
  assert.notEqual((await quick()).code, shared.code);
  p1.close(); p2.close();
});

done("quick");
