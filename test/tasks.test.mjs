// End-to-end tests for tasks (step 4): challenges, cheating guards, progress,
// witnessed tasks, Shade fakes, bots working, and the Keepers' win.
import assert from "node:assert/strict";
import { Client, createRoom, sleep, test, done } from "./helpers.mjs";

const PATHS = {
  dock: ["market", "lighthouse", "netloft"],
  lighthouse: ["dock", "clocktower"],
  netloft: ["dock", "market", "chapel"],
  market: ["dock", "netloft", "clocktower", "chapel"],
  clocktower: ["lighthouse", "market"],
  chapel: ["netloft", "market"],
};
const MIN_MS = { lighthouse: 2500, chapel: 3000, market: 1500, netloft: 2500, dock: 2000, clocktower: 3000 };

function route(a, b) {
  const prev = { [a]: null };
  const q = [a];
  while (q.length) {
    const c = q.shift();
    if (c === b) break;
    for (const n of PATHS[c]) if (!(n in prev)) { prev[n] = c; q.push(n); }
  }
  const path = [];
  for (let at = b; at !== a; at = prev[at]) path.unshift(at);
  return path;
}

const last = (c, t) => [...c.msgs].reverse().find((m) => m.t === t);
const here = (c) => last(c, "view")?.here;
const roleOf = (c) => last(c, "role")?.role;
const tasksOf = (c) => last(c, "tasks")?.tasks ?? [];
const progress = (c) => last(c, "lobby")?.progress;

function solve(ch) {
  switch (ch.kind) {
    case "sequence": return ch.data.order;
    case "match": return ch.data.options.findIndex((o) => o.join() === ch.data.target.join());
    case "connect": return [0, 1, 2, 3, 4, 5];
    default: return null;
  }
}

async function walkTo(c, dest) {
  for (const step of route(here(c), dest)) {
    const ready = last(c, "view");
    const wait = Math.max(0, ready.readyAt - ready.now) + 60;
    await sleep(wait);
    c.send({ t: "move", to: step });
    await c.waitFor((m) => m.t === "view" && m.here === step && m === last(c, "view"), 8000);
  }
}

async function doTask(c, task) {
  await walkTo(c, task.loc);
  c.msgs = c.msgs.filter((m) => m.t !== "taskChallenge" && m.t !== "taskResult");
  c.send({ t: "taskStart", id: task.id });
  const ch = await c.waitFor((m) => m.t === "taskChallenge");
  await sleep(MIN_MS[task.loc] + 80);
  c.send({ t: "taskDone", id: ch.id, nonce: ch.nonce, answer: solve(ch) });
  return c.waitFor((m) => m.t === "taskResult");
}

/** Deal games until `want(clients)` is satisfied, then wait for play to start. */
async function dealUntil(humans, bots, want, tries = 25) {
  const code = await createRoom();
  const clients = [];
  for (let i = 0; i < humans; i++) clients.push(await new Client(code, "H" + (i + 1)).join());
  const host = clients[0];
  for (let i = 0; i < bots; i++) host.send({ t: "addBot" });
  await host.lobbyWhere((m) => m.players.length === humans + bots);
  for (let i = 0; i < tries; i++) {
    for (const c of clients) c.msgs.length = 0;
    host.send({ t: "start" });
    await Promise.all(clients.map((c) => c.waitFor((m) => m.t === "tasks", 8000)));
    await Promise.all(clients.map((c) => c.waitFor((m) => m.t === "role", 8000)));
    if (want(clients)) {
      await Promise.all(clients.map((c) => c.lobbyWhere((m) => m.phase === "playing", 12_000)));
      await Promise.all(clients.map((c) => c.waitFor((m) => m.t === "view", 8000)));
      return { code, clients, host };
    }
    host.send({ t: "endGame" });
    await host.lobbyWhere((m) => m.phase === "lobby");
    await sleep(120);
  }
  throw new Error("couldn't deal the game this test needs");
}

const closeAll = (cs) => cs.forEach((c) => c.close());

console.log("Shadow Haven task tests");

await test("everyone gets 5 tasks in 5 different places, privately", async () => {
  const { clients } = await dealUntil(3, 1, () => true);
  for (const c of clients) {
    const ts = tasksOf(c);
    assert.equal(ts.length, 5);
    assert.equal(new Set(ts.map((t) => t.loc)).size, 5);
    assert.ok(ts.every((t) => !t.done && t.name));
    assert.equal(c.msgs.filter((m) => m.t === "tasks").length >= 1, true);
  }
  assert.equal(progress(clients[0]), 0);
  closeAll(clients);
});

await test("guards: wrong place, too fast, wrong answer, walking away", async () => {
  // Need a human with a task that has a real answer (chapel/market/netloft), not in the market.
  const { clients } = await dealUntil(2, 2, (cs) => tasksOf(cs[0]).some((t) => ["chapel", "netloft"].includes(t.loc)));
  const a = clients[0];
  const task = tasksOf(a).find((t) => ["chapel", "netloft"].includes(t.loc));

  a.send({ t: "taskStart", id: task.id });
  let r = await a.waitFor((m) => m.t === "taskResult");
  assert.equal(r.ok, false, "can't do it from the market");

  a.send({ t: "taskStart", id: "t9-nowhere" });
  await a.waitFor((m) => m.code === "bad_task");

  await walkTo(a, task.loc);
  a.msgs.length = 0;
  a.send({ t: "taskStart", id: task.id });
  let ch = await a.waitFor((m) => m.t === "taskChallenge");
  a.send({ t: "taskDone", id: ch.id, nonce: ch.nonce, answer: solve(ch) });
  r = await a.waitFor((m) => m.t === "taskResult");
  assert.equal(r.ok, false);
  assert.match(r.text, /fast/i);

  await sleep(MIN_MS[task.loc] + 50);
  a.msgs.length = 0;
  const wrong = ch.kind === "connect" ? [5, 4, 3, 2, 1, 0] : [9, 9, 9, 9];
  a.send({ t: "taskDone", id: ch.id, nonce: ch.nonce, answer: wrong });
  r = await a.waitFor((m) => m.t === "taskResult");
  assert.equal(r.ok, false, "wrong answer rejected");

  // A fresh attempt, then walking away, abandons it.
  a.msgs.length = 0;
  a.send({ t: "taskStart", id: task.id });
  ch = await a.waitFor((m) => m.t === "taskChallenge");
  await sleep(MIN_MS[task.loc] + 50);
  const out = PATHS[task.loc][0];
  a.send({ t: "move", to: out });
  await a.waitFor((m) => m.t === "view" && m.here === out);
  a.send({ t: "taskDone", id: ch.id, nonce: ch.nonce, answer: solve(ch) });
  r = await a.waitFor((m) => m.t === "taskResult");
  assert.equal(r.ok, false, "walked away");
  // Still not done: going back, it can be started again.
  await walkTo(a, task.loc);
  a.msgs.length = 0;
  a.send({ t: "taskStart", id: task.id });
  await a.waitFor((m) => m.t === "taskChallenge");
  closeAll(clients);
});

await test("a Keeper's task lights the harbor; a Shade's fake doesn't", async () => {
  const { clients } = await dealUntil(4, 0, () => true);
  const keeper = clients.find((c) => roleOf(c) === "keeper");
  const shade = clients.find((c) => roleOf(c) === "shade");

  const sTask = tasksOf(shade).find((t) => t.loc !== "lighthouse");
  const sr = await doTask(shade, sTask);
  assert.equal(sr.ok, true, "the fake looks like it worked");
  await sleep(300);
  assert.equal(progress(keeper), 0, "…but the harbor is no brighter");
  assert.equal(tasksOf(shade).find((t) => t.id === sTask.id).done, true);

  const kTask = tasksOf(keeper)[0];
  const kr = await doTask(keeper, kTask);
  assert.equal(kr.ok, true);
  const l = await keeper.lobbyWhere((m) => m.progress > 0);
  assert.equal(l.progress, 1 / 15, "1 of 3 Keepers × 5 tasks");
  closeAll(clients);
});

await test("lighting the great lamp is witnessed — but only when a Keeper does it", async () => {
  const { clients } = await dealUntil(3, 1, (cs) =>
    roleOf(cs[0]) === "keeper" && tasksOf(cs[0]).some((t) => t.loc === "lighthouse"));
  const [keeper, watcher] = clients;
  const lamp = tasksOf(keeper).find((t) => t.loc === "lighthouse");
  await walkTo(watcher, "lighthouse");
  const r = await doTask(keeper, lamp);
  assert.equal(r.ok, true);
  const w = await watcher.waitFor((m) => m.t === "witness");
  assert.equal(w.who, keeper.id.playerId);
  assert.equal(keeper.msgs.some((m) => m.t === "witness"), false, "you don't witness yourself");
  closeAll(clients);
});

await test("a Shade faking the lamp shows nothing to onlookers", async () => {
  const { clients } = await dealUntil(3, 1, (cs) =>
    roleOf(cs[0]) === "shade" && tasksOf(cs[0]).some((t) => t.loc === "lighthouse"));
  const [shade, watcher] = clients;
  await walkTo(watcher, "lighthouse");
  const r = await doTask(shade, tasksOf(shade).find((t) => t.loc === "lighthouse"));
  assert.equal(r.ok, true);
  await sleep(500);
  assert.equal(watcher.msgs.some((m) => m.t === "witness"), false);
  closeAll(clients);
});

await test("bots get on with their tasks", async () => {
  const { clients } = await dealUntil(1, 5, () => true);
  const l = await clients[0].lobbyWhere((m) => m.progress > 0, 45_000);
  assert.ok(l.progress > 0);
  closeAll(clients);
});

await test("when every Keeper task is done, the Keepers win and the Shades are revealed", async () => {
  const { clients } = await dealUntil(4, 0, () => true);
  const keepers = clients.filter((c) => roleOf(c) === "keeper");
  const shade = clients.find((c) => roleOf(c) === "shade");
  await Promise.all(keepers.map(async (k) => {
    for (const t of tasksOf(k)) {
      const r = await doTask(k, t);
      assert.equal(r.ok, true, `task at ${t.loc}: ${r.text}`);
    }
  }));
  const end = await shade.lobbyWhere((m) => m.phase === "ended", 5000);
  assert.equal(end.result.winner, "keepers");
  assert.deepEqual(end.result.shades, [shade.id.playerId]);
  assert.equal(end.progress, 1);

  // Nothing more can happen once it's over.
  keepers[0].send({ t: "move", to: PATHS[here(keepers[0])][0] });
  await keepers[0].waitFor((m) => m.code === "not_playing");

  // The host takes everyone back to the lobby.
  clients[0].send({ t: "endGame" });
  await shade.lobbyWhere((m) => m.phase === "lobby" && m.result === null);
  closeAll(clients);
});

done("tasks");
