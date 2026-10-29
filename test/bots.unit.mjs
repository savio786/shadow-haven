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
const { decide, newBrain, observe, lastSeen } = await import(out + "bots.js");
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

done("bots");
