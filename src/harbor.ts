// The maps. Every map has the same six location "slots" — one where the bell
// hangs and everyone gathers (START), one with the great lamp (the witnessed
// task, and where the fog is lifted), and four more — but each map names them,
// joins them with its own paths, and gives them its own tasks. The server owns
// these rules; the client only draws them.

export const LOCATIONS = ["dock", "lighthouse", "netloft", "market", "clocktower", "chapel"] as const;
export type Loc = (typeof LOCATIONS)[number];

export type MapId = "harbor" | "frostmere";
export const MAP_IDS: MapId[] = ["harbor", "frostmere"];

export interface MapDef {
  id: MapId;
  name: string;
  setting: string;                 // for the storyteller and the bots: where this is
  start: Loc;                      // where everyone gathers and the bell hangs
  lamp: Loc;                       // the great lamp (witnessed task; lifts the fog)
  lampName: string;                // "the great lamp"
  paths: Record<Loc, Loc[]>;
  places: Record<Loc, string>;     // "the Market Square" — for sentences
  tasks: Record<Loc, string>;      // task names
}

export const MAPS: Record<MapId, MapDef> = {
  harbor: {
    id: "harbor",
    name: "The Harbor",
    setting: "a foggy harbor town at night",
    start: "market",
    lamp: "lighthouse",
    lampName: "the great lamp",
    paths: {
      dock: ["market", "lighthouse", "netloft"],
      lighthouse: ["dock", "clocktower"],
      netloft: ["dock", "market", "chapel"],
      market: ["dock", "netloft", "clocktower", "chapel"],
      clocktower: ["lighthouse", "market"],
      chapel: ["netloft", "market"],
    },
    places: {
      dock: "the Dock", lighthouse: "the Lighthouse", netloft: "the Net Loft",
      market: "the Market Square", clocktower: "the Clock Tower", chapel: "the Chapel",
    },
    tasks: {
      lighthouse: "Light the great lamp", chapel: "Light the candles", market: "Sort the signal flags",
      netloft: "Mend the net", dock: "Haul in the rope", clocktower: "Wind the clock",
    },
  },
  // A frozen port: a ring of places with one shortcut across the ice. People
  // drift further apart here — lonelier, and kinder to the Shades.
  frostmere: {
    id: "frostmere",
    name: "Frostmere",
    setting: "a frozen port town under the northern lights",
    start: "market",
    lamp: "lighthouse",
    lampName: "the great beacon",
    paths: {
      market: ["dock", "netloft"],
      dock: ["market", "chapel"],
      chapel: ["dock", "lighthouse", "netloft"],
      lighthouse: ["chapel", "clocktower"],
      clocktower: ["lighthouse", "netloft"],
      netloft: ["clocktower", "market", "chapel"],
    },
    places: {
      market: "the Ice Market", dock: "the Frozen Pier", chapel: "the Icebreaker",
      lighthouse: "Beacon Hill", clocktower: "the Lodge", netloft: "the Sled Barn",
    },
    tasks: {
      lighthouse: "Kindle the great beacon", chapel: "Light the ship's lamps", market: "Sort the frozen catch",
      netloft: "Untangle the harness", dock: "Chip the ice", clocktower: "Stoke the stove",
    },
  },
};

export const mapOf = (id: unknown): MapDef => MAPS[id as MapId] ?? MAPS.harbor;
export const isMapId = (x: unknown): x is MapId => typeof x === "string" && (MAP_IDS as string[]).includes(x);

// The harbor's own layout, kept for code and tests that predate other maps.
export const START: Loc = MAPS.harbor.start;
export const PATHS: Record<Loc, Loc[]> = MAPS.harbor.paths;

export function isLoc(x: unknown): x is Loc {
  return typeof x === "string" && (LOCATIONS as readonly string[]).includes(x);
}

export function adjacent(a: Loc, b: Loc, map: MapId = "harbor") {
  return mapOf(map).paths[a].includes(b);
}

/** Shortest path from a to b (breadth-first). Returns the steps after a. */
export function route(a: Loc, b: Loc, map: MapId = "harbor"): Loc[] {
  if (a === b) return [];
  const paths = mapOf(map).paths;
  const prev = new Map<Loc, Loc>([[a, a]]);
  const queue: Loc[] = [a];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of paths[cur]) {
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
