// The harbor: six locations joined by paths. The server owns these rules;
// the client only draws them.

export const LOCATIONS = ["dock", "lighthouse", "netloft", "market", "clocktower", "chapel"] as const;
export type Loc = (typeof LOCATIONS)[number];

export const START: Loc = "market";

export const PATHS: Record<Loc, Loc[]> = {
  dock: ["market", "lighthouse", "netloft"],
  lighthouse: ["dock", "clocktower"],
  netloft: ["dock", "market", "chapel"],
  market: ["dock", "netloft", "clocktower", "chapel"],
  clocktower: ["lighthouse", "market"],
  chapel: ["netloft", "market"],
};

export function isLoc(x: unknown): x is Loc {
  return typeof x === "string" && (LOCATIONS as readonly string[]).includes(x);
}

export function adjacent(a: Loc, b: Loc) {
  return PATHS[a].includes(b);
}

/** Shortest path from a to b (breadth-first). Returns the steps after a. */
export function route(a: Loc, b: Loc): Loc[] {
  if (a === b) return [];
  const prev = new Map<Loc, Loc>([[a, a]]);
  const queue: Loc[] = [a];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of PATHS[cur]) {
      if (prev.has(next)) continue;
      prev.set(next, cur);
      if (next === b) {
        const path: Loc[] = [b];
        for (let at = cur; at !== a; at = prev.get(at)!) path.unshift(at);
        return path;
      }
      queue.push(next);
    }
  }
  return [];
}
