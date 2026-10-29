// Bot Keepers' brains. Bots see only what a human in their place would see
// (who is in the same location) and remember it. They decide where to go from
// their personality and that memory — never from hidden server knowledge.
// The same memory will later feed the AI that lets bots talk in meetings.

import { LOCATIONS, PATHS, route, type Loc } from "./harbor";
import type { Role } from "./shared";
import { TASKS } from "./tasks";

export type Personality = "wanderer" | "homebody" | "social" | "watcher";

export interface Sighting {
  at: number;     // when (ms)
  loc: Loc;       // where
  ids: string[];  // who else was there
}

export interface Brain {
  personality: Personality;
  favorite: Loc;          // homebodies keep coming back here
  nextMoveAt: number;
  cameFrom: Loc | null;   // avoid pacing back and forth
  memory: Sighting[];     // newest last, capped
  goal: Loc | null;       // where it's heading, if anywhere
  vouched: string[];      // players it saw prove themselves (witnessed tasks)
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
  };
}

/** How keen each personality is to get on with its tasks. */
const DILIGENCE: Record<Personality, number> = { homebody: 0.75, watcher: 0.65, wanderer: 0.55, social: 0.5 };

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
export function decide(brain: Brain, here: Loc, role: Role, allies: string[], now: number, todo: Loc[] = []): Decision {
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
    if (rand() < DILIGENCE[brain.personality]) {
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
