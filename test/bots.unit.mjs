// Unit tests for the bot brains (src/bots.ts) and harbor routing (src/harbor.ts).
// Bundles the TypeScript with esbuild (installed with wrangler), then tests it.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, done } from "./helpers.mjs";

const out = fileURLToPath(new URL("./.build/", import.meta.url));
mkdirSync(out, { recursive: true });
await build({
  entryPoints: { bots: "src/bots.ts", harbor: "src/harbor.ts" },
  outdir: out, format: "esm", bundle: true, platform: "neutral", logLevel: "silent",
});
const { decide, newBrain, observe, lastSeen, vouch, chooseSnuff, chooseReport, foundCold, remember, chooseFog, chooseRelight } = await import(out + "bots.js");
const { route, PATHS, LOCATIONS } = await import(out + "harbor.js");

console.log("Shadow Haven bot brain tests");

await test("routes are shortest paths along real paths", async () => {
  assert.deepEqual(route("market", "market"), []);
  assert.deepEqual(route("market", "dock"), ["dock"]);
  assert.equal(route("lighthouse", "chapel").length, 3);
  for (const a of LOCATIONS) for (const b of LOCATIONS) {
    let at = a;
    for (const step of route(a, b)) { assert.ok(PATHS[at].includes(step)); at = step; }
    assert.equal(at, b);
  }
});

await test("bots remember who they saw, where", async () => {
  const brain = newBrain(0);
  observe(brain, "market", ["x", "y"], 1000);
  observe(brain, "market", ["y", "x"], 2000); // same scene → refreshed, not duplicated
  observe(brain, "dock", ["y"], 3000);
  assert.equal(brain.memory.length, 2);
  const seen = lastSeen(brain);
  assert.deepEqual(seen.get("x"), { loc: "market", at: 2000 });
  assert.deepEqual(seen.get("y"), { loc: "dock", at: 3000 });
});

await test("a Shade bot hunts a Keeper it last saw alone", async () => {
  for (let i = 0; i < 25; i++) {
    const brain = newBrain(0);
    observe(brain, "chapel", ["keeper1"], 10_000);
    observe(brain, "dock", [], 11_000);
    const d = decide(brain, "dock", "shade", [], 12_000);
    assert.equal(brain.goal, "chapel");
    assert.ok(["market", "netloft"].includes(d.to), `stepped toward the chapel, got ${d.to}`);
  }
});

await test("…ignores its fellow Shade, and won't chase a crowd", async () => {
  const brain = newBrain(0);
  brain.personality = "homebody";
  brain.favorite = "dock";
  observe(brain, "chapel", ["ally", "k1", "k2"], 10_000);
  const d = decide(brain, "dock", "shade", ["ally"], 11_000);
  assert.notEqual(brain.goal, "chapel");
  // With only the ally + one Keeper, that Keeper counts as alone.
  observe(brain, "chapel", ["ally", "k1"], 12_000);
  decide(brain, "dock", "shade", ["ally"], 13_000);
  assert.equal(brain.goal, "chapel");
  assert.ok(d);
});

await test("a Shade waits beside a lone Keeper instead of walking off", async () => {
  const brain = newBrain(0);
  observe(brain, "lighthouse", ["k1"], 10_000);
  const d = decide(brain, "lighthouse", "shade", [], 11_000);
  assert.equal(d.to, null);
});

await test("stale sightings don't count", async () => {
  const brain = newBrain(0);
  brain.personality = "homebody";
  brain.favorite = "dock";
  observe(brain, "chapel", ["k1"], 1_000);
  decide(brain, "dock", "shade", [], 60_000);
  assert.notEqual(brain.goal, "chapel");
});

await test("Keeper bots never hunt", async () => {
  const brain = newBrain(0);
  brain.personality = "homebody";
  brain.favorite = "dock";
  observe(brain, "chapel", ["k1"], 10_000);
  const d = decide(brain, "dock", "keeper", [], 11_000);
  assert.notEqual(brain.goal, "chapel");
  assert.ok(d.dwellMs > 0);
});

await test("homebodies head home; social bots follow the crowd", async () => {
  const home = newBrain(0);
  home.personality = "homebody";
  home.favorite = "lighthouse";
  const d1 = decide(home, "market", "keeper", [], 1000);
  assert.ok(["dock", "clocktower"].includes(d1.to));
  assert.equal(home.goal, "lighthouse");

  const social = newBrain(0);
  social.personality = "social";
  observe(social, "netloft", ["a", "b", "c"], 5000);
  observe(social, "dock", ["d"], 6000);
  const d2 = decide(social, "dock", "keeper", [], 7000);
  assert.equal(d2.to, "netloft");
});

await test("wanderers keep moving and don't pace straight back", async () => {
  let back = 0;
  for (let i = 0; i < 200; i++) {
    const b = newBrain(0);
    b.personality = "wanderer";
    b.cameFrom = "dock";
    const d = decide(b, "market", "keeper", [], 1000);
    assert.ok(PATHS.market.includes(d.to));
    if (d.to === "dock") back++;
  }
  assert.equal(back, 0);
});

await test("Keeper bots work on a task where they stand, and head for the nearest one", async () => {
  const b = newBrain(0);
  const d = decide(b, "chapel", "keeper", [], 1000, ["chapel", "dock"]);
  assert.equal(d.work, "chapel");
  assert.equal(d.to, null);
  assert.ok(d.dwellMs >= 6000, "lighting candles takes a while");

  // Diligent bots usually set off toward the nearest task.
  let toward = 0;
  for (let i = 0; i < 200; i++) {
    const k = newBrain(0);
    k.personality = "homebody";
    k.favorite = "market";
    const r = decide(k, "market", "keeper", [], 1000, ["lighthouse", "netloft"]);
    if (r.to === "netloft") toward++;
  }
  assert.ok(toward > 110, `homebody went for the nearest task ${toward}/200 times`);
});

await test("Shade bots fake tasks to blend in — never the witnessed lamp", async () => {
  let worked = 0;
  for (let i = 0; i < 300; i++) {
    const b = newBrain(0);
    const d1 = decide(b, "lighthouse", "shade", [], 1000, ["lighthouse"]);
    assert.notEqual(d1.work, "lighthouse");
    const d2 = decide(b, "dock", "shade", [], 1000, ["dock", "lighthouse"]);
    if (d2.work === "dock") worked++;
  }
  assert.ok(worked > 100, `faked the dock task ${worked}/300 times`);
});

await test("bots remember who they saw prove themselves", async () => {
  const b = newBrain(0);
  vouch(b, "wren");
  vouch(b, "wren");
  assert.deepEqual(b.vouched, ["wren"]);
});

await test("Shade bots strike only when exactly one Keeper is in sight", async () => {
  let struck = 0;
  for (let i = 0; i < 200; i++) if (chooseSnuff(["k1"], []) === "k1") struck++;
  assert.ok(struck > 140, `struck ${struck}/200`);
  for (let i = 0; i < 50; i++) {
    assert.equal(chooseSnuff(["k1", "k2"], []), null, "never in front of a witness");
    assert.equal(chooseSnuff([], []), null);
    assert.equal(chooseSnuff(["ally"], ["ally"]), null, "never a fellow Shade");
    const t = chooseSnuff(["ally", "k1"], ["ally"]);
    assert.ok(t === null || t === "k1", "a partner watching doesn't count");
  }
});

await test("Keeper bots always ring the bell; Shades only sometimes", async () => {
  for (let i = 0; i < 50; i++) assert.equal(chooseReport("keeper", false), true);
  let own = 0, other = 0;
  for (let i = 0; i < 400; i++) { if (chooseReport("shade", true)) own++; if (chooseReport("shade", false)) other++; }
  assert.ok(own < other, `own work ${own} < someone else's ${other}`);
});

await test("finding a cold lantern, bots note who was near it — once", async () => {
  const b = newBrain(0);
  observe(b, "chapel", ["victim", "x", "y"], 10_000);
  observe(b, "dock", ["z"], 12_000);
  observe(b, "chapel", ["y"], 20_000);
  foundCold(b, "chapel", "victim", 25_000, "me");
  foundCold(b, "chapel", "victim", 26_000, "me");
  const near = b.evidence.filter((e) => e.kind === "nearCold").map((e) => e.who).sort();
  assert.deepEqual(near, ["x", "y"], "not the victim, not someone seen elsewhere, no duplicates");

  // Long-ago sightings don't count.
  const c = newBrain(0);
  observe(c, "chapel", ["old"], 1_000);
  foundCold(c, "chapel", "victim", 90_000, "me");
  assert.equal(c.evidence.length, 0);
});

await test("evidence is remembered, and the lamp vouches", async () => {
  const b = newBrain(0);
  remember(b, { kind: "sawSnuff", who: "s", victim: "v", loc: "dock", at: 1 });
  remember(b, { kind: "sawSnuff", who: "s", victim: "v", loc: "dock", at: 2 });
  remember(b, { kind: "lamp", who: "k", loc: "lighthouse", at: 3 });
  assert.equal(b.evidence.length, 2);
  assert.deepEqual(b.vouched, ["k"]);
});

await test("cunning sets how eagerly Shade bots strike and call the fog", async () => {
  const count = (fn) => { let n = 0; for (let i = 0; i < 2000; i++) if (fn()) n++; return n; };
  const easy = count(() => chooseSnuff(["k"], [], "easy"));
  const normal = count(() => chooseSnuff(["k"], [], "normal"));
  const cunning = count(() => chooseSnuff(["k"], [], "cunning"));
  assert.ok(easy < normal && normal < cunning, `${easy} < ${normal} < ${cunning}`);
  assert.equal(count(() => chooseFog("easy")), 0, "easy Shades never call the fog");
  assert.ok(count(() => chooseFog("cunning")) > count(() => chooseFog("normal")));
  assert.ok(count(() => chooseRelight("keeper", "normal")) > count(() => chooseRelight("shade", "normal")),
    "Keepers rush to the lamp; Shades only sometimes relight it for cover");
  assert.equal(count(() => chooseRelight("shade", "easy")), 0);
});

done("bots");
