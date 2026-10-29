// Bot Keepers' brains. Bots see only what a human in their place would see
// (who is in the same location) and remember it. They decide where to go from
// their personality and that memory — never from hidden server knowledge.
// The same memory will later feed the AI that lets bots talk in meetings.

import { LOCATIONS, PATHS, route, type Loc } from "./harbor";
import type { BotLevel, Role } from "./shared";
import { TASKS } from "./tasks";

export type Personality = "wanderer" | "homebody" | "social" | "watcher";

export interface Sighting {
  at: number;     // when (ms)
  loc: Loc;       // where
  ids: string[];  // who else was there
}

/** Something a bot saw that matters when the harbor gathers to talk. */
export interface Evidence {
  kind: "sawSnuff" | "nearCold" | "lastWith" | "lamp";
  who: string;        // the player it points at (or vouches for, for "lamp")
  victim?: string;
  loc: Loc;
  at: number;
}

export interface Brain {
  personality: Personality;
  favorite: Loc;          // homebodies keep coming back here
  nextMoveAt: number;
  cameFrom: Loc | null;   // avoid pacing back and forth
  memory: Sighting[];     // newest last, capped
  goal: Loc | null;       // where it's heading, if anywhere
  vouched: string[];      // players it saw prove themselves (witnessed tasks)
  evidence: Evidence[];   // what it will bring up when everyone gathers
}

const MEMORY_CAP = 60;
const RECENT_MS = 25_000;

const PERSONALITIES: Personality[] = ["wanderer", "homebody", "social", "watcher"];

const rand = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
const between = (lo: number, hi: number) => lo + rand() * (hi - lo);

export function newBrain(now: number): Brain {
  return {
    personality: pick(PERSONALITIES),
    favorite: pick(LOCATIONS),
    nextMoveAt: now + between(1500, 4500),
    cameFrom: null,
    memory: [],
    goal: null,
    vouched: [],
    evidence: [],
  };
}

const EVIDENCE_CAP = 30;
const NEAR_COLD_MS = 30_000;

export function remember(brain: Brain, ev: Evidence) {
  const known = brain.evidence.some((e) => e.kind === ev.kind && e.who === ev.who && e.victim === ev.victim);
  if (known) return;
  brain.evidence.push(ev);
  if (brain.evidence.length > EVIDENCE_CAP) brain.evidence.splice(0, brain.evidence.length - EVIDENCE_CAP);
  if (ev.kind === "lamp") vouch(brain, ev.who);
}

/**
 * The bot has found a cold lantern. Note everyone it remembers seeing at that
 * place shortly before — they were near the scene.
 */
export function foundCold(brain: Brain, loc: Loc, victim: string, now: number, self: string) {
  const near = new Set<string>();
  for (const s of brain.memory) {
    if (s.loc !== loc || now - s.at > NEAR_COLD_MS) continue;
    for (const id of s.ids) if (id !== victim && id !== self) near.add(id);
  }
  for (const who of near) remember(brain, { kind: "nearCold", who, victim, loc, at: now });

  // Who did it last see alone with the victim? That's the sharpest clue a bot can have.
  for (let i = brain.memory.length - 1; i >= 0; i--) {
    const s = brain.memory[i];
    if (now - s.at > LAST_WITH_MS) break;
    if (!s.ids.includes(victim)) continue;
    const others = s.ids.filter((id) => id !== victim && id !== self);
    if (others.length === 1) {
      remember(brain, { kind: "lastWith", who: others[0], victim, loc: s.loc, at: s.at });
      break;
    }
  }
}

const LAST_WITH_MS = 60_000;

/**
 * Should a Shade bot snuff someone here? Only when exactly one Keeper is in
 * sight (a fellow Shade watching doesn't count) — never in front of a crowd.
 * @param visible living players here, not counting the bot
 */
export function chooseSnuff(visible: string[], allies: string[], level: BotLevel = "normal"): string | null {
  const keepers = visible.filter((id) => !allies.includes(id));
  if (keepers.length !== 1) return null;
  return rand() < SNUFF_CHANCE[level] ? keepers[0] : null;
}

const SNUFF_CHANCE: Record<BotLevel, number> = { easy: 0.45, normal: 0.85, cunning: 0.97 };

/** Each turn, how likely a Shade bot is to call the fog when it can. */
export function chooseFog(level: BotLevel): boolean {
  return rand() < ({ easy: 0, normal: 0.1, cunning: 0.3 } as const)[level];
}

/** In the fog, will this bot head for the lamp (Keepers) — or relight it for cover (Shades)? */
export function chooseRelight(role: Role, level: BotLevel): boolean {
  if (role === "keeper") return rand() < ({ easy: 0.4, normal: 0.75, cunning: 0.95 } as const)[level];
  return rand() < ({ easy: 0, normal: 0.12, cunning: 0.3 } as const)[level];
}

/** Will this bot report a cold lantern it's standing over? */
export function chooseReport(role: Role, snuffedItItself: boolean): boolean {
  if (role === "keeper") return true;
  // A Shade sometimes reports to look innocent — rarely its own work.
  return rand() < (snuffedItItself ? 0.25 : 0.6);
}

/** How keen each personality is to get on with its tasks. */
// Kept well below 1: real people dawdle, chat and look around between tasks, and
// that's what gives the Shades their chances (and the Keepers their alibis).
const DILIGENCE: Record<Personality, number> = { homebody: 0.45, watcher: 0.4, wanderer: 0.35, social: 0.3 };

/** Remember that this player was seen doing something only a Keeper can do. */
export function vouch(brain: Brain, id: string) {
  if (!brain.vouched.includes(id)) brain.vouched.push(id);
}

/** Record what the bot can see where it stands. */
export function observe(brain: Brain, loc: Loc, ids: string[], now: number) {
  const last = brain.memory[brain.memory.length - 1];
  const key = [...ids].sort().join(",");
  if (last && last.loc === loc && [...last.ids].sort().join(",") === key) {
    last.at = now; // same scene, just refresh the time
    return;
  }
  brain.memory.push({ at: now, loc, ids: [...ids] });
  if (brain.memory.length > MEMORY_CAP) brain.memory.splice(0, brain.memory.length - MEMORY_CAP);
}

/** Where each player was last seen by this bot. */
export function lastSeen(brain: Brain): Map<string, { loc: Loc; at: number }> {
  const seen = new Map<string, { loc: Loc; at: number }>();
  for (const s of brain.memory) for (const id of s.ids) seen.set(id, { loc: s.loc, at: s.at });
  return seen;
}

export interface Decision {
  to: Loc | null;   // null = stay
  dwellMs: number;  // how long before thinking again
  work?: Loc;       // spend the dwell time on the task here
}

/**
 * Decide the bot's next step.
 * @param allies other Shades (only meaningful when the bot is a Shade)
 * @param todo   places where the bot still has a task (a Shade's are fake)
 */
export function decide(brain: Brain, here: Loc, role: Role, allies: string[], now: number, todo: Loc[] = [], focused = false): Decision {
  const step = (goal: Loc | null): Loc | null => {
    brain.goal = goal && goal !== here ? goal : null;
    return brain.goal ? route(here, brain.goal)[0] ?? null : null;
  };
  const workHere = (): Decision => {
    const [lo, hi] = TASKS[here].botWorkMs;
    brain.goal = null;
    return { to: null, dwellMs: between(lo, hi), work: here };
  };
  const nearest = (places: Loc[]) =>
    places.reduce<Loc | null>((best, l) => (best === null || route(here, l).length < route(here, best).length ? l : best), null);

  // --- Shades hunt: head for a Keeper last seen on their own. ---
  if (role === "shade") {
    const target = loneKeeperSighting(brain, allies, now);
    if (target && target !== here) {
      return { to: step(target), dwellMs: between(1800, 3200) };
    }
    if (target === here) {
      // Found them alone: linger (in step 5 this is where a Shade strikes).
      return { to: null, dwellMs: between(3000, 5000) };
    }
    // Nobody to hunt: pretend to work so it doesn't stand out — but never at
    // the lighthouse, where a fake would be seen through.
    const cover = todo.filter((l) => !TASKS[l].witnessed);
    if (cover.includes(here) && rand() < 0.6) return workHere();
    if (cover.length && rand() < 0.5) return { to: step(nearest(cover)), dwellMs: between(2500, 4000) };
  } else if (todo.length) {
    // Keepers get on with their tasks, more or less keenly.
    if (todo.includes(here)) return workHere();
    // Once on the way to a task, see it through (no pacing back and forth).
    if (brain.goal && todo.includes(brain.goal)) {
      return { to: step(brain.goal), dwellMs: between(1800, 3000) };
    }
    // Wisps have nothing better to do than their tasks.
    if (focused || rand() < DILIGENCE[brain.personality]) {
      return { to: step(brain.goal && todo.includes(brain.goal) ? brain.goal : nearest(todo)), dwellMs: between(1800, 3000) };
    }
  }

  switch (brain.personality) {
    case "homebody": {
      if (here !== brain.favorite) return { to: step(brain.favorite), dwellMs: between(2500, 4000) };
      if (rand() < 0.25) return { to: wander(brain, here), dwellMs: between(3000, 5000) };
      return { to: null, dwellMs: between(7000, 12000) };
    }
    case "social": {
      const crowd = busiestRecent(brain, now);
      if (crowd && crowd !== here) return { to: step(crowd), dwellMs: between(2500, 4500) };
      return { to: rand() < 0.4 ? wander(brain, here) : null, dwellMs: between(4000, 8000) };
    }
    case "watcher": {
      // Patrols the harbor's edges, lingering where paths meet.
      const quiet = rand() < 0.5;
      return { to: quiet ? null : wander(brain, here), dwellMs: between(5000, 9000) };
    }
    default: // wanderer
      return { to: wander(brain, here), dwellMs: between(3000, 6000) };
  }
}

/** A random neighbour, preferring not to walk straight back. */
function wander(brain: Brain, here: Loc): Loc {
  const options = PATHS[here].filter((l) => l !== brain.cameFrom);
  brain.goal = null;
  return pick(options.length ? options : PATHS[here]);
}

/** Location with the most people seen recently. */
function busiestRecent(brain: Brain, now: number): Loc | null {
  let best: Loc | null = null;
  let most = 0;
  for (const s of brain.memory) {
    if (now - s.at > RECENT_MS) continue;
    if (s.ids.length > most) { most = s.ids.length; best = s.loc; }
  }
  return best;
}

/** Most recent place a non-ally was seen with nobody else around. */
function loneKeeperSighting(brain: Brain, allies: string[], now: number): Loc | null {
  for (let i = brain.memory.length - 1; i >= 0; i--) {
    const s = brain.memory[i];
    if (now - s.at > RECENT_MS) break;
    const others = s.ids.filter((id) => !allies.includes(id));
    if (others.length === 1) return s.loc;
  }
  return null;
}
