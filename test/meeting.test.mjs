// End-to-end tests for step 6: meetings — the emergency bell, chat, voting,
// verdicts, wins, and bots that talk, answer and vote.
import assert from "node:assert/strict";
import { sleep, test, done } from "./helpers.mjs";
import { closeAll, dealUntil, last, roleOf, view } from "./game.mjs";

const meetingOf = (c) => last(c, "lobby")?.meeting;
const stage = (c, s, ms = 12_000) => c.lobbyWhere((m) => m.phase === "meeting" && m.meeting?.stage === s, ms);

/** Ring the emergency bell (everyone starts in the market) and get to the discussion. */
async function bell(clients, ringer = clients[0]) {
  await sleep(300);
  ringer.send({ t: "bell" });
  await Promise.all(clients.map((c) => stage(c, "gather")));
}

async function toVote(clients) {
  await Promise.all(clients.map((c) => stage(c, "discuss")));
  for (const c of clients) if (view(c)?.alive !== false) c.send({ t: "ready" });
  await Promise.all(clients.map((c) => stage(c, "vote")));
}

console.log("Shadow Haven meeting tests");

await test("the emergency bell: once each, only in the square, only while playing", async () => {
  const { clients } = await dealUntil(4, 0);
  const [a, b] = clients;
  await sleep(1600);
  b.send({ t: "move", to: "dock" });
  await b.waitFor((m) => m.t === "view" && m.here === "dock");
  b.send({ t: "bell" });
  await b.waitFor((m) => m.code === "not_here");

  await bell(clients, a);
  const m = meetingOf(a);
  assert.equal(m.kind, "bell");
  assert.equal(m.reporter, a.id.playerId);
  assert.deepEqual(m.found, []);
  a.send({ t: "bell" });
  await a.waitFor((x) => x.code === "cant_bell");
  closeAll(clients);
});

await test("chat: everyone hears it, it's cleaned up, and it has manners", async () => {
  const { clients } = await dealUntil(4, 0);
  const [a, b] = clients;
  a.send({ t: "say", text: "too early" });
  await a.waitFor((m) => m.code === "not_meeting");
  await bell(clients);

  a.send({ t: "say", text: "  <b>Hello</b>   harbor  " });
  for (const c of clients) {
    const got = await c.waitFor((m) => m.t === "chat" && m.line.who === a.id.playerId);
    assert.equal(got.line.text, "bHello/b harbor");
  }
  a.send({ t: "say", text: "again!" });
  await a.waitFor((m) => m.code === "slow_down");
  await sleep(1300);
  b.send({ t: "say", text: "x".repeat(400) });
  const long = await a.waitFor((m) => m.t === "chat" && m.line.who === b.id.playerId);
  assert.equal(long.line.text.length, 140);
  closeAll(clients);
});

await test("votes stay secret until the verdict; catching the Shade wins", async () => {
  const { clients } = await dealUntil(4, 0);
  const shade = clients.find((c) => roleOf(c) === "shade");
  const keepers = clients.filter((c) => c !== shade);
  await bell(clients);
  await toVote(clients);

  keepers[0].send({ t: "vote", target: keepers[0].id.playerId });
  await keepers[0].waitFor((m) => m.code === "bad_vote", 3000);
  for (const k of keepers) k.send({ t: "vote", target: shade.id.playerId });
  const mid = await shade.lobbyWhere((m) => m.meeting?.voted.length === 3);
  assert.equal(mid.meeting.result, null);
  assert.ok(!JSON.stringify(mid).includes(`"votes"`), "nobody learns who voted for whom yet");
  keepers[0].send({ t: "vote", target: "skip" });
  await keepers[0].waitFor((m) => m.code === "voted");

  shade.send({ t: "vote", target: "skip" });
  const verdict = await keepers[1].lobbyWhere((m) => m.meeting?.stage === "result");
  const r = verdict.meeting.result;
  assert.equal(r.adrift, shade.id.playerId);
  assert.equal(r.wasShade, true);
  assert.equal(Object.keys(r.votes).length, 4);
  assert.equal(r.votes[shade.id.playerId], "skip");

  const end = await keepers[1].lobbyWhere((m) => m.phase === "ended", 12_000);
  assert.equal(end.result.winner, "keepers");
  assert.ok(end.players.find((p) => p.id === shade.id.playerId).adrift);
  closeAll(clients);
});

await test("a tie sets nobody adrift; voting out a Keeper lets the game go on", async () => {
  const { clients } = await dealUntil(4, 0);
  const shade = clients.find((c) => roleOf(c) === "shade");
  const [k1, k2, k3] = clients.filter((c) => c !== shade);

  await bell(clients, k1);
  await toVote(clients);
  k1.send({ t: "vote", target: k2.id.playerId });
  k2.send({ t: "vote", target: k1.id.playerId });
  k3.send({ t: "vote", target: "skip" });
  shade.send({ t: "vote", target: "skip" });
  const tie = await k1.lobbyWhere((m) => m.meeting?.stage === "result");
  assert.equal(tie.meeting.result.adrift, null);
  for (const c of clients) c.msgs.length = 0;
  await Promise.all(clients.map((c) => c.lobbyWhere((m) => m.phase === "playing", 12_000)));

  // Second meeting: the Shade and two misled Keepers vote k3 out.
  await bell(clients, k2);
  await toVote(clients);
  shade.send({ t: "vote", target: k3.id.playerId });
  k1.send({ t: "vote", target: k3.id.playerId });
  k2.send({ t: "vote", target: k3.id.playerId });
  k3.send({ t: "vote", target: "skip" });
  const out = await k1.lobbyWhere((m) => m.meeting?.stage === "result");
  assert.equal(out.meeting.result.adrift, k3.id.playerId);
  assert.equal(out.meeting.result.wasShade, false);
  for (const c of clients) c.msgs.length = 0;
  const back = await k1.lobbyWhere((m) => m.phase === "playing", 12_000);
  assert.ok(back.players.find((p) => p.id === k3.id.playerId).adrift);
  const v = await k3.waitFor((m) => m.t === "view" && m.alive === false);
  assert.equal(v.alive, false, "set adrift: now a wisp");

  // Adrift players can't speak or vote in the next meeting.
  for (const c of clients) c.msgs = c.msgs.filter((m) => m.t === "view").slice(-1);
  await bell(clients, shade);
  k3.send({ t: "say", text: "it was them!" });
  await k3.waitFor((m) => m.code === "wisp");
  closeAll(clients);
});

await test("bots speak up, answer when named, and vote", async () => {
  const { clients } = await dealUntil(1, 4, (cs) => roleOf(cs[0]) === "keeper");
  const me = clients[0];
  await bell(clients);
  await stage(me, "discuss");
  const lobby = last(me, "lobby");
  const bots = lobby.players.filter((p) => p.isBot);

  // They talk on their own…
  await me.waitFor((m) => m.t === "typing", 8000);
  const first = await me.waitFor((m) => m.t === "chat" && bots.some((b) => b.id === m.line.who), 12_000);
  assert.ok(first.line.text.length > 0);

  // …and answer when spoken to.
  const target = bots[2];
  me.send({ t: "say", text: `${target.name}, where were you just now?` });
  const answer = await me.waitFor((m) => m.t === "chat" && m.line.who === target.id && m.line.at > first.line.at, 12_000);
  assert.ok(answer.line.text.length > 0);

  // Ready → vote; bots cast their votes without being asked.
  me.send({ t: "ready" });
  await stage(me, "vote");
  await me.lobbyWhere((m) => m.meeting?.voted.length === 4, 20_000);
  me.send({ t: "vote", target: "skip" });
  const verdict = await me.lobbyWhere((m) => m.meeting?.stage === "result", 8000);
  assert.equal(Object.keys(verdict.meeting.result.votes).length, 5);
  closeAll(clients);
});

done("meeting");
