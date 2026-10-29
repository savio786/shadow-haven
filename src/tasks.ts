// Tasks: one kind of job per harbor location, each with its own mini-game.
// The server issues each attempt as a challenge and checks the answer, the
// place, and that it didn't finish faster than a person could.

import { LOCATIONS, type Loc } from "./harbor";

export type TaskKind = "timing" | "sequence" | "match" | "connect" | "mash" | "hold";

export interface TaskDef {
  loc: Loc;
  name: string;
  kind: TaskKind;
  minMs: number;       // fastest a human could plausibly finish
  witnessed: boolean;  // others in the room can see it happen
  botWorkMs: [number, number]; // how long a bot spends on it
}

export const TASKS: Record<Loc, TaskDef> = {
  lighthouse: { loc: "lighthouse", name: "Light the great lamp", kind: "timing", minMs: 2500, witnessed: true, botWorkMs: [12000, 16000] },
  chapel: { loc: "chapel", name: "Light the candles", kind: "sequence", minMs: 3000, witnessed: false, botWorkMs: [11000, 15000] },
  market: { loc: "market", name: "Sort the signal flags", kind: "match", minMs: 1500, witnessed: false, botWorkMs: [8000, 12000] },
  netloft: { loc: "netloft", name: "Mend the net", kind: "connect", minMs: 2500, witnessed: false, botWorkMs: [10000, 14000] },
  dock: { loc: "dock", name: "Haul in the rope", kind: "mash", minMs: 2000, witnessed: false, botWorkMs: [8000, 12000] },
  clocktower: { loc: "clocktower", name: "Wind the clock", kind: "hold", minMs: 3000, witnessed: false, botWorkMs: [8000, 11000] },
};

export const TASKS_PER_PLAYER = 5;

export interface Task {
  id: string;
  loc: Loc;
  done: boolean;
}

/** An attempt in progress: what was asked and what the right answer is. */
export interface Attempt {
  taskId: string;
  nonce: string;
  startedAt: number;
  answer: number[] | number | null;
}

const rand = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
const randInt = (n: number) => Math.floor(rand() * n);

function shuffled<T>(xs: readonly T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A random set of tasks in different places. */
export function assignTasks(): Task[] {
  return shuffled(LOCATIONS).slice(0, TASKS_PER_PLAYER).map((loc, i) => ({ id: `t${i}-${loc}`, loc, done: false }));
}

const FLAG_COLORS = ["#d94f4f", "#f2c14e", "#3f8fd9", "#f4f1e8", "#2f9e6a", "#22262f"];

/** Build a fresh challenge. `data` goes to the player; `answer` stays on the server. */
export function makeChallenge(kind: TaskKind): { data: unknown; answer: number[] | number | null } {
  switch (kind) {
    case "sequence": {
      // Five candles; remember and repeat the order four of them light up in.
      const order = Array.from({ length: 4 }, () => randInt(5));
      for (let i = 1; i < order.length; i++) if (order[i] === order[i - 1]) order[i] = (order[i] + 1 + randInt(4)) % 5;
      return { data: { candles: 5, order }, answer: order };
    }
    case "match": {
      // Pick the flag that matches the signal.
      const flag = () => shuffled(FLAG_COLORS).slice(0, 3);
      const target = flag();
      const options: string[][] = [target];
      while (options.length < 4) {
        const f = flag();
        if (!options.some((o) => o.join() === f.join())) options.push(f);
      }
      const order = shuffled([0, 1, 2, 3]);
      const shown = order.map((i) => options[i]);
      return { data: { target, options: shown }, answer: order.indexOf(0) };
    }
    case "connect": {
      // Six knots scattered on the net; tie them 1 → 6.
      const points: { x: number; y: number }[] = [];
      while (points.length < 6) {
        const p = { x: 12 + randInt(76), y: 12 + randInt(76) };
        if (points.every((q) => Math.hypot(q.x - p.x, q.y - p.y) > 18)) points.push(p);
      }
      return { data: { points }, answer: [0, 1, 2, 3, 4, 5] };
    }
    case "timing":
      return { data: { hits: 3, zone: 0.18 + rand() * 0.06, speed: 0.9 + rand() * 0.5 }, answer: null };
    case "mash":
      return { data: { pulls: 12 }, answer: null };
    case "hold":
      return { data: { ms: 3000 }, answer: null };
  }
}

/** Does the submitted answer solve the challenge? */
export function checkAnswer(expected: Attempt["answer"], given: unknown): boolean {
  if (expected === null) return true;
  if (typeof expected === "number") return given === expected;
  return Array.isArray(given) && given.length === expected.length && given.every((v, i) => v === expected[i]);
}
