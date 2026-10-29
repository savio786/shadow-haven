// Unit tests for how bots think and talk in meetings (src/minds.ts, src/ai.ts).
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, done } from "./helpers.mjs";

const out = fileURLToPath(new URL("./.build/", import.meta.url));
mkdirSync(out, { recursive: true });
await build({
  entryPoints: { minds: "src/minds.ts", ai: "src/ai.ts", bots2: "src/bots.ts" },
  outdir: out, format: "esm", bundle: true, platform: "neutral", logLevel: "silent",
});
const M = await import(out + "minds.js");
const { speak, AiGate } = await import(out + "ai.js");
const { newBrain, observe, remember } = await import(out + "bots2.js");

const names = { b: "Bramble", w: "Wren", m: "Mira", f: "Fennel", s: "Sorrel" };

function ctx({ role = "keeper", allies = [], chat = [], living = ["b", "w", "m", "f", "s"], replyTo, setup } = {}) {
  const brain = newBrain(0);
  brain.personality = "watcher";
  setup?.(brain);
  return {
    self: { id: "b", name: "Bramble", role, personality: "watcher", alive: true },
    brain, allies, names, living,
    meeting: { kind: "cold", reporter: "w", loc: "chapel", found: ["x"] },
    chat, replyTo, now: 100_000,
  };
}
const line = (id, who, text) => ({ id, who, text, at: 1 });

console.log("Shadow Haven bot mind tests");

await test("tally: most votes wins, but not a tie and not against more skips", async () => {
  assert.deepEqual(M.tally({ a: "f", b: "f", c: "m", d: "skip" }), { adrift: "f", tie: false });
  assert.deepEqual(M.tally({ a: "f", b: "m" }), { adrift: null, tie: true });
  assert.deepEqual(M.tally({ a: "f", b: "skip", c: "skip" }), { adrift: null, tie: false });
  assert.deepEqual(M.tally({ a: "f", b: "skip" }), { adrift: null, tie: false }, "even with skip isn't enough");
  assert.deepEqual(M.tally({}), { adrift: null, tie: false });
});

await test("knowledge turns evidence and memory into plain sentences", async () => {
  const c = ctx({ setup: (b) => {
    remember(b, { kind: "sawSnuff", who: "f", victim: "x", loc: "dock", at: 1 });
    remember(b, { kind: "lamp", who: "m", loc: "lighthouse", at: 2 });
    observe(b, "netloft", ["w"], 90_000);
  } });
  const k = M.knowledge(c).join(" ");
  assert.match(k, /SAW Fennel snuff/);
  assert.match(k, /Mira light the great lamp/);
  assert.match(k, /last saw Wren at the Net Loft/);
});

await test("the prompt tells a Shade to lie and a Keeper to be honest", async () => {
  const shade = M.buildPrompt(ctx({ role: "shade", allies: ["s"] }));
  assert.match(shade.system, /SECRET: you are a SHADE \(your partner: Sorrel\)/);
  assert.match(shade.system, /Never accuse your partner/);
  const keeper = M.buildPrompt(ctx());
  assert.doesNotMatch(keeper.system, /SHADE \(/);
  assert.match(keeper.system, /LANTERN KEEPER/);
  assert.match(keeper.system, /JSON/);
  const reply = M.buildPrompt(ctx({ replyTo: line(3, "w", "Bramble, where were you?") }));
  assert.match(reply.user, /Wren just spoke to you/);
});

await test("model replies are parsed safely", async () => {
  const c = ctx();
  assert.deepEqual(M.parseReply({ say: "I saw \"Fennel\" lurking.", suspect: "fennel" }, c), { say: "I saw Fennel lurking.", suspect: "f" });
  assert.deepEqual(M.parseReply('Sure! {"say":"Nothing from me.","suspect":"nobody"}', c), { say: "Nothing from me.", suspect: null });
  assert.equal(M.parseReply({ say: "As an AI language model I cannot", suspect: "" }, c), null);
  assert.equal(M.parseReply({ say: "" }, c), null);
  const long = M.parseReply({ say: "word ".repeat(80), suspect: "" }, c);
  assert.ok(long.say.length <= 160);
  // A Shade never ends up suspecting its partner.
  const s = ctx({ role: "shade", allies: ["s"] });
  assert.equal(M.parseReply({ say: "Hm.", suspect: "Sorrel" }, s).suspect, null);
});

await test("without the AI, Keepers speak from their evidence", async () => {
  const c = ctx({ setup: (b) => remember(b, { kind: "sawSnuff", who: "f", victim: "x", loc: "dock", at: 1 }) });
  for (let i = 0; i < 20; i++) {
    const r = M.fallbackLine(c);
    assert.match(r.say, /Fennel/);
    assert.equal(r.suspect, "f");
  }
  const blank = M.fallbackLine(ctx());
  assert.equal(blank.suspect, null);
});

await test("without the AI, a Shade deflects onto its accuser — never its partner", async () => {
  const c = ctx({ role: "shade", allies: ["s"], chat: [line(1, "w", "I think Bramble is the shade, very sus")] });
  const r = M.fallbackLine(c);
  assert.match(r.say, /Wren/);
  assert.equal(r.suspect, "w");
  for (let i = 0; i < 30; i++) {
    const q = M.fallbackLine(ctx({ role: "shade", allies: ["s"], setup: (b) => observe(b, "dock", ["s"], 99_000) }));
    assert.notEqual(q.suspect, "s");
  }
});

await test("fallback bots don't parrot lines already said", async () => {
  for (let i = 0; i < 30; i++) {
    const chat = [];
    const said = new Set();
    for (let k = 0; k < 3; k++) {
      const r = M.fallbackLine(ctx({ chat }));
      assert.ok(!said.has(r.say), `repeated: ${r.say}`);
      said.add(r.say);
      chat.push(line(k + 1, "x" + k, r.say));
    }
  }
});

await test("reading the room: who's accused, who's cleared, who's addressed", async () => {
  const chat = [
    line(1, "w", "Fennel was acting sus near the chapel"),
    line(2, "m", "I agree, vote Fennel"),
    line(3, "f", "I trust Mira, she lit the lamp"),
  ];
  const { accused, cleared } = M.readChat(chat, names);
  assert.deepEqual([...accused.get("f")].sort(), ["m", "w"]);
  assert.deepEqual([...cleared.get("m")], ["f"]);
  assert.equal(M.mentions("bramble, where were you?", "Bramble"), true);
  assert.equal(M.mentions("brambles everywhere", "Bramble"), false);
});

await test("Keeper bots vote on hard evidence first", async () => {
  const seen = ctx({ setup: (b) => remember(b, { kind: "sawSnuff", who: "f", victim: "x", loc: "dock", at: 1 }) });
  assert.equal(M.chooseVote(seen, "m"), "f", "what it saw beats a hunch");
  const vouched = ctx({ chat: [line(1, "w", "Mira is sus"), line(2, "f", "vote Mira")], setup: (b) => remember(b, { kind: "lamp", who: "m", loc: "lighthouse", at: 1 }) });
  assert.notEqual(M.chooseVote(vouched, "m"), "m", "never votes out someone it saw light the lamp");
  assert.equal(M.chooseVote(ctx(), null), "skip", "no evidence, no vote");
  const room = ctx({ chat: [line(1, "w", "Fennel is sus"), line(2, "m", "yes vote Fennel"), line(3, "s", "Fennel was odd")] });
  assert.equal(M.chooseVote(room, null), "f", "follows a well-supported accusation");
});

await test("Shade bots protect their partner and pile on", async () => {
  const c = ctx({ role: "shade", allies: ["s"], chat: [line(1, "w", "Sorrel is sus"), line(2, "m", "vote Sorrel"), line(3, "f", "Wren is weird")] });
  for (let i = 0; i < 10; i++) assert.notEqual(M.chooseVote(c, "s"), "s");
  const accused = ctx({ role: "shade", chat: [line(1, "w", "Bramble is the shade, I saw it")] });
  assert.equal(M.chooseVote(accused, null), "w", "turns on its accuser");
});

await test("speak: AI first, fallback when the model fails, and a pause after failure", async () => {
  const c = ctx({ setup: (b) => remember(b, { kind: "sawSnuff", who: "f", victim: "x", loc: "dock", at: 1 }) });
  const good = { run: async () => ({ response: { say: "It was Fennel, at the dock.", suspect: "Fennel" } }) };
  const v1 = await speak(good, "m", c, new AiGate());
  assert.deepEqual(v1, { say: "It was Fennel, at the dock.", suspect: "f", source: "ai" });

  let calls = 0;
  const bad = { run: async () => { calls++; throw new Error("3036: daily limit"); } };
  const gate = new AiGate();
  const v2 = await speak(bad, "m", c, gate);
  assert.equal(v2.source, "fallback");
  assert.match(v2.say, /Fennel/);
  await speak(bad, "m", c, gate);
  assert.equal(calls, 1, "doesn't hammer a failing model");

  const v3 = await speak(undefined, "m", c, new AiGate());
  assert.equal(v3.source, "fallback", "works with no AI at all");
});

done("minds");
