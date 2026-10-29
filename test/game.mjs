// Helpers for end-to-end tests that play real games.
import { Client, createRoom, sleep } from "./helpers.mjs";

export const PATHS = {
  dock: ["market", "lighthouse", "netloft"],
  lighthouse: ["dock", "clocktower"],
  netloft: ["dock", "market", "chapel"],
  market: ["dock", "netloft", "clocktower", "chapel"],
  clocktower: ["lighthouse", "market"],
  chapel: ["netloft", "market"],
};
export const MIN_MS = { lighthouse: 2500, chapel: 3000, market: 1500, netloft: 2500, dock: 2000, clocktower: 3000 };

export function route(a, b) {
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

export const last = (c, t) => [...c.msgs].reverse().find((m) => m.t === t);
export const view = (c) => last(c, "view");
export const here = (c) => view(c)?.here;
export const roleOf = (c) => last(c, "role")?.role;
export const tasksOf = (c) => last(c, "tasks")?.tasks ?? [];

export function solve(ch) {
  switch (ch.kind) {
    case "sequence": return ch.data.order;
    case "match": return ch.data.options.findIndex((o) => o.join() === ch.data.target.join());
    case "connect": return [0, 1, 2, 3, 4, 5];
    default: return null;
  }
}

export async function walkTo(c, dest) {
  for (const step of route(here(c), dest)) {
    const v = view(c);
    await sleep(Math.max(0, v.readyAt - v.now) + 60);
    c.send({ t: "move", to: step });
    await c.waitFor((m) => m.t === "view" && m.here === step && m === view(c), 8000);
  }
}

export async function doTask(c, task) {
  await walkTo(c, task.loc);
  c.msgs = c.msgs.filter((m) => m.t !== "taskChallenge" && m.t !== "taskResult");
  c.send({ t: "taskStart", id: task.id });
  const ch = await c.waitFor((m) => m.t === "taskChallenge");
  await sleep(MIN_MS[task.loc] + 80);
  c.send({ t: "taskDone", id: ch.id, nonce: ch.nonce, answer: solve(ch) });
  return c.waitFor((m) => m.t === "taskResult");
}

/** Wait until a Shade's snuff is ready (by its own view). */
export async function snuffReady(c) {
  const v = view(c);
  await sleep(Math.max(0, v.snuffReadyAt - v.now) + 80);
}

/** Deal games until `want(clients)` is satisfied, then wait for play to start. */
export async function dealUntil(humans, bots, want = () => true, tries = 25) {
  const code = await createRoom();
  const clients = [];
  for (let i = 0; i < humans; i++) clients.push(await new Client(code, "H" + (i + 1)).join());
  const host = clients[0];
  for (let i = 0; i < bots; i++) host.send({ t: "addBot" });
  await host.lobbyWhere((m) => m.players.length === humans + bots);
  for (let i = 0; i < tries; i++) {
    for (const c of clients) c.msgs.length = 0;
    host.send({ t: "start" });
    await Promise.all(clients.map((c) => c.waitFor((m) => m.t === "tasks")));
    await Promise.all(clients.map((c) => c.waitFor((m) => m.t === "role")));
    if (want(clients)) {
      await Promise.all(clients.map((c) => c.lobbyWhere((m) => m.phase === "playing", 12_000)));
      await Promise.all(clients.map((c) => c.waitFor((m) => m.t === "view")));
      return { code, clients, host };
    }
    host.send({ t: "endGame" });
    await host.lobbyWhere((m) => m.phase === "lobby");
    await sleep(120);
  }
  throw new Error("couldn't deal the game this test needs");
}

export const closeAll = (cs) => cs.forEach((c) => c.close());
