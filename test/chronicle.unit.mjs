// Unit tests for the end of the night: honors and the tale (src/chronicle.ts).
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, done } from "./helpers.mjs";

const out = fileURLToPath(new URL("./.build/", import.meta.url));
mkdirSync(out, { recursive: true });
await build({ entryPoints: { chronicle: "src/chronicle.ts" }, outdir: out, format: "esm", bundle: true, platform: "neutral", logLevel: "silent" });
const C = await import(out + "chronicle.js");

const names = { a: "Wren", b: "Mira", c: "Fennel", d: "Bramble", e: "Sorrel" };
const P = (id, role, fate = "survived", extra = {}) => ({ id, role, fate, where: null, tasksDone: 0, tasksTotal: role === "keeper" ? 4 : 0, snuffs: 0, sharpVotes: 0, ...extra });

const players = [
  P("a", "keeper", "survived", { tasksDone: 4, sharpVotes: 1 }),
  P("b", "keeper", "snuffed", { where: "chapel", tasksDone: 1 }),
  P("c", "shade", "adrift", { snuffs: 1 }),
  P("d", "keeper", "survived", { tasksDone: 2, sharpVotes: 1 }),
];
const log = [
  { at: 30000, kind: "snuff", who: "c", victim: "b", loc: "chapel" },
  { at: 52000, kind: "report", who: "d", loc: "chapel", found: ["b"] },
  { at: 120000, kind: "adrift", who: "c", wasShade: true },
];

console.log("Shadow Haven end-of-night tests");

await test("honors come from what really happened, spread across players", async () => {
  const h = C.computeHonors({ players, names, log, lamps: ["a"], winner: "keepers" });
  const by = Object.fromEntries(h.map((x) => [x.id, x]));
  assert.equal(by.bright.who, "a");
  assert.match(by.bright.why, /4 of 4/);
  assert.equal(by.sharp.who, "d", "a different player when there's a tie-worthy alternative");
  assert.equal(by.shadow.who, "c");
  assert.equal(by.shadow.title, "Busy shadow", "a caught Shade gets the humbler title");
  assert.ok(h.length <= 4);
  assert.ok(!h.some((x) => x.id === "bell") || by.bell.who === "d");
});

await test("the bell ringer who caught a Shade is honored", async () => {
  const quiet = players.map((p) => ({ ...p, tasksDone: 0, sharpVotes: 0, snuffs: 0 }));
  const h = C.computeHonors({ players: quiet, names, log, lamps: [], winner: "keepers" });
  assert.deepEqual(h.map((x) => x.id), ["bell", "survivor"]);
  assert.equal(h[0].who, "d");
});

await test("a quiet night can have no honors", async () => {
  const quiet = players.map((p) => ({ ...p, tasksDone: 0, sharpVotes: 0, snuffs: 0, fate: "snuffed" }));
  assert.deepEqual(C.computeHonors({ players: quiet, names, log: [], lamps: [], winner: "shades" }), []);
});

await test("the storyteller is given the facts, in order, with names", async () => {
  const facts = C.taleFacts({ players, names, log, reason: "Every Shade has been set adrift.", winner: "keepers" });
  assert.match(facts[1], /Shade was Fennel/);
  assert.match(facts.join(" "), /Fennel snuffed Mira's lantern at the Chapel\..*Bramble found Mira's cold lantern.*set Fennel adrift\. Fennel was a Shade/);
  assert.match(facts.at(-1), /Keepers won/);
  const { system, user } = C.talePrompt(facts);
  assert.match(system, /ONLY the facts/);
  assert.equal(user, facts.join("\n"));
});

await test("without the AI, the tale is still about this game", async () => {
  const tale = C.fallbackTale({ players, names, log, winner: "keepers" });
  assert.match(tale, /Mira's lantern guttered/);
  assert.match(tale, /Bramble found it/);
  assert.match(tale, /Fennel was a Shade/);
  assert.match(tale, /dawn/i);
  const dark = C.fallbackTale({ players, names, log: [], winner: "shades" });
  assert.match(dark, /harbor was dark/);
});

await test("what the model writes is tidied, and nonsense is refused", async () => {
  assert.equal(C.cleanTale({ response: 'Title: The Night\n"Fog rolled in."  The Keepers  held firm and lit every lantern before the dawn came.' }),
    "Fog rolled in. The Keepers held firm and lit every lantern before the dawn came.");
  assert.equal(C.cleanTale({ response: "Too short." }), null);
  assert.equal(C.cleanTale("As an AI language model I cannot write stories about harbors, lanterns, or anything else."), null);
  assert.ok(C.cleanTale("word ".repeat(400)).length <= 900);
});

done("chronicle");
