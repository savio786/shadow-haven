// The maps: original illustrated layouts. The server decides the rules
// (which paths exist, where you are, who you can see); this file only draws.

const HARBOR_PLACES = {
  lighthouse: { name: "Lighthouse", x: 70, y: 74,
    text: "The great lamp turns overhead. From up here you can hear the whole bay." },
  clocktower: { name: "Clock Tower", x: 214, y: 58,
    text: "Gears tick in the dark. The clock has always run a little slow." },
  chapel: { name: "Chapel", x: 318, y: 132,
    text: "Candle stubs and cold pews. Footsteps echo for a long time here." },
  market: { name: "Market Square", x: 196, y: 162,
    text: "Shuttered stalls and a dry fountain. Everyone passes through the square — and the bell hangs here." },
  netloft: { name: "Net Loft", x: 276, y: 236,
    text: "Nets hang like curtains. Every corner smells of salt and tar." },
  dock: { name: "Dock", x: 96, y: 226,
    text: "Rope-creak and black water. Boats knock softly against the pilings." },
};

const HARBOR_PATHS = [
  ["dock", "market"], ["dock", "lighthouse"], ["dock", "netloft"],
  ["lighthouse", "clocktower"], ["market", "netloft"], ["market", "clocktower"],
  ["market", "chapel"], ["netloft", "chapel"],
];

const LANTERN_FLAMES = {
  ember: "#ff7a45", amber: "#ffb347", moss: "#9bd36a", tide: "#4fc3d9", frost: "#cfe8ff",
  plum: "#b57edc", rose: "#ff8fb1", gold: "#ffd84d", ivy: "#3fbf8f", ash: "#b8b2a7",
};

// Building silhouettes, drawn around (0,0) with their base near y = 12.
const WIN = "#ffcf7a";
const HARBOR_BUILDINGS = {
  lighthouse: `
    <path class="beam" d="M0 -24 L-70 -48 L-70 -16 Z" fill="url(#lhbeam)"/>
    <path d="M-7 12 L-5 -20 H5 L7 12Z" fill="#d9d2c3"/>
    <path d="M-6.2 2 H6.2 M-5.6 -9 H5.6" stroke="#b94a48" stroke-width="4"/>
    <rect x="-7" y="-29" width="14" height="9" rx="1.5" fill="#2a3043" stroke="#59627a"/>
    <rect x="-4.5" y="-27" width="9" height="5" fill="${WIN}" class="lit"/>
    <path d="M-8 -29 L0 -36 L8 -29Z" fill="#59627a"/>
    <path d="M-16 12 Q0 6 16 12Z" fill="#3a4258"/>`,
  clocktower: `
    <rect x="-9" y="-22" width="18" height="34" fill="#3a4258"/>
    <path d="M-11 -22 L0 -36 L11 -22Z" fill="#59627a"/>
    <circle cx="0" cy="-12" r="6.5" fill="#efe6d2" stroke="#59627a" stroke-width="1.5"/>
    <path d="M0 -12 V-16.5 M0 -12 H3.5" stroke="#2a3043" stroke-width="1.4" stroke-linecap="round" class="hands"/>
    <rect x="-3" y="2" width="6" height="10" rx="3" fill="${WIN}" class="lit"/>`,
  chapel: `
    <path d="M-15 12 V-6 L0 -20 L15 -6 V12Z" fill="#3a4258"/>
    <path d="M-17 -5 L0 -21 L17 -5" fill="none" stroke="#59627a" stroke-width="3"/>
    <rect x="-2" y="-34" width="4" height="14" fill="#59627a"/><path d="M-5 -29 H5" stroke="#59627a" stroke-width="2.5"/>
    <path d="M-4 12 V2 A4 4 0 0 1 4 2 V12Z" fill="${WIN}" class="lit"/>
    <circle cx="0" cy="-7" r="3" fill="${WIN}" class="lit" opacity=".8"/>`,
  market: `
    <path d="M-20 -6 H-2 L-4 -12 H-18Z" fill="#b94a48"/><path d="M-20 -6 h3 v3 h-3z M-14 -6 h3 v3 h-3z M-8 -6 h3 v3 h-3z" fill="#efe6d2"/>
    <rect x="-19" y="-3" width="16" height="15" fill="#3a4258"/>
    <path d="M2 -4 H20 L18 -10 H4Z" fill="#3f8fd9"/><path d="M2 -4 h3 v3 h-3z M8 -4 h3 v3 h-3z M14 -4 h3 v3 h-3z" fill="#efe6d2"/>
    <rect x="3" y="-1" width="16" height="13" fill="#3a4258"/>
    <path d="M-22 -16 Q0 -22 22 -16" fill="none" stroke="#8a7a5a" stroke-width=".8"/>
    <circle cx="-12" cy="-18" r="1.6" fill="${WIN}" class="lit"/><circle cx="0" cy="-19.5" r="1.6" fill="${WIN}" class="lit"/><circle cx="12" cy="-18" r="1.6" fill="${WIN}" class="lit"/>`,
  netloft: `
    <path d="M-17 12 V-8 L-4 -18 L17 -10 V12Z" fill="#3a4258"/>
    <path d="M-19 -7 L-4 -19 L19 -10" fill="none" stroke="#59627a" stroke-width="3"/>
    <path d="M-12 -4 V10 M-7 -6 V10 M-2 -8 V10 M-12 0 H-2 M-12 5 H-2" stroke="#8a93a6" stroke-width=".8" opacity=".8"/>
    <rect x="5" y="-4" width="7" height="7" fill="${WIN}" class="lit"/>`,
  dock: `
    <path d="M-24 6 H22 V10 H-24Z" fill="#6b4f33"/>
    <path d="M-20 10 V18 M-6 10 V18 M8 10 V18 M20 10 V18" stroke="#4a3624" stroke-width="2.5"/>
    <g class="bob"><path d="M-14 -2 H8 L4 4 H-10Z" fill="#7a5634"/><path d="M-3 -2 V-16 L7 -4Z" fill="#d9d2c3"/></g>
    <rect x="16" y="-4" width="4" height="10" fill="#4a3624"/><circle cx="18" cy="-6" r="2.4" fill="${WIN}" class="lit"/>`,
};


// ---------- Frostmere: a frozen port under the northern lights ----------
const FROST_PLACES = {
  lighthouse: { name: "Beacon Hill", the: "Beacon Hill", x: 76, y: 70,
    text: "A great iron brazier and a wind that bites. From up here you can see the whole frozen bay." },
  clocktower: { name: "Lodge", the: "the Lodge", x: 300, y: 62,
    text: "The stove ticks as it cools. Snow piles against the window." },
  chapel: { name: "Icebreaker", the: "the Icebreaker", x: 176, y: 136,
    text: "A ship frozen fast in the middle of the bay. The deck creaks under every step." },
  market: { name: "Ice Market", the: "the Ice Market", x: 206, y: 234,
    text: "Frost-rimed stalls around the market cross. Everyone gathers here — and the bell hangs here." },
  netloft: { name: "Sled Barn", the: "the Sled Barn", x: 314, y: 180,
    text: "Harnesses, runners and the smell of straw. The dogs are restless tonight." },
  dock: { name: "Frozen Pier", the: "the Frozen Pier", x: 70, y: 204,
    text: "The boats are locked in the ice. Every footstep carries a long way out here." },
};

const FROST_PATHS = [
  ["market", "dock"], ["dock", "chapel"], ["chapel", "lighthouse"], ["lighthouse", "clocktower"],
  ["clocktower", "netloft"], ["netloft", "market"], ["netloft", "chapel"],
];

const SNOW = "#e8eef7";
const FROST_BUILDINGS = {
  lighthouse: `
    <circle class="beacon-glow lit" cx="0" cy="-30" r="22" fill="url(#beaconglow)"/>
    <path d="M-26 12 Q0 -8 26 12Z" fill="#c9d3e3" opacity=".85"/>
    <rect x="-1.6" y="-20" width="3.2" height="26" fill="#59627a"/>
    <path d="M-9 -22 H9 L6 -15 H-6Z" fill="#3a4258" stroke="#8a93a6" stroke-width=".8"/>
    <path class="lit flicker" d="M0 -40 C6 -32 6 -27 0 -22 C-6 -27 -6 -32 0 -40Z" fill="#ffb347"/>
    <path class="lit flicker" d="M0 -33 C3 -29 3 -26 0 -23 C-3 -26 -3 -29 0 -33Z" fill="#fff0c2"/>`,
  clocktower: `
    <path d="M-17 12 V-4 H17 V12Z" fill="#5a4330"/>
    <path d="M-17 -1 H17 M-17 4 H17 M-17 9 H17" stroke="#4a3624" stroke-width="1"/>
    <rect x="8" y="-21" width="5" height="12" fill="#4a3624"/>
    <path d="M-21 -3 L0 -19 L21 -3Z" fill="${SNOW}"/>
    <g class="smoke"><circle cx="10.5" cy="-26" r="3" fill="#9aa4ba" opacity=".4"/><circle cx="13" cy="-32" r="4" fill="#9aa4ba" opacity=".25"/></g>
    <rect x="-11" y="0" width="7" height="6" fill="${WIN}" class="lit"/>
    <rect x="3" y="2" width="6" height="10" fill="#3a2a1c"/>`,
  chapel: `
    <path d="M-30 14 l6 -5 l5 5z M20 15 l6 -6 l6 6z M-8 16 l4 -3 l4 3z" fill="#cfe2f5" opacity=".75"/>
    <path d="M-27 3 L23 3 L16 14 H-21Z" fill="#7a2f2f"/>
    <path d="M-27 3 H23" stroke="${SNOW}" stroke-width="2"/>
    <rect x="-13" y="-9" width="19" height="12" fill="${SNOW}"/>
    <rect x="-10" y="-6" width="4" height="4" fill="${WIN}" class="lit"/><rect x="-3" y="-6" width="4" height="4" fill="${WIN}" class="lit"/>
    <rect x="9" y="-22" width="6" height="16" fill="#3a4258"/><rect x="9" y="-18" width="6" height="3" fill="#b94a48"/>
    <path d="M-24 3 V-14 M-24 -12 L-12 -4" stroke="#8a93a6" stroke-width="1"/>`,
  market: `
    <path d="M-20 -6 H-2 L-4 -12 H-18Z" fill="${SNOW}"/>
    <rect x="-19" y="-5" width="16" height="17" fill="#3a4258"/>
    <path d="M2 -4 H20 L18 -10 H4Z" fill="${SNOW}"/>
    <rect x="3" y="-3" width="16" height="15" fill="#3a4258"/>
    <rect x="-14" y="0" width="6" height="5" fill="${WIN}" class="lit"/><rect x="8" y="2" width="6" height="5" fill="${WIN}" class="lit"/>
    <path d="M0 12 V-24 M-5 -19 H5" stroke="#8a93a6" stroke-width="1.6"/>
    <path d="M-2.6 -17 H2.6 L3.4 -12 H-3.4Z" fill="#c9a46a"/>
    <path d="M-22 -14 Q-10 -19 -1 -18 M1 -18 Q10 -19 22 -14" fill="none" stroke="#8a7a5a" stroke-width=".8"/>
    <circle cx="-12" cy="-16.5" r="1.5" fill="${WIN}" class="lit"/><circle cx="12" cy="-16.5" r="1.5" fill="${WIN}" class="lit"/>`,
  netloft: `
    <path d="M-18 12 V-6 L0 -18 L18 -6 V12Z" fill="#6b2f2f"/>
    <path d="M-20 -5 L0 -20 L20 -5" fill="none" stroke="${SNOW}" stroke-width="3.5"/>
    <path d="M-7 12 V-1 H7 V12Z" fill="#3a2020"/><path d="M-7 -1 L7 12 M7 -1 L-7 12" stroke="#8a5a4a" stroke-width="1"/>
    <rect x="-3" y="-12" width="6" height="5" fill="${WIN}" class="lit"/>
    <path d="M20 11 H32 Q35 11 35 8 M22 11 V7 H31 V11" stroke="#c9a46a" stroke-width="1.5" fill="none"/>`,
  dock: `
    <path d="M-24 4 H22 V8 H-24Z" fill="#6b4f33"/>
    <path d="M-24 4 H22" stroke="${SNOW}" stroke-width="1.8"/>
    <path d="M-18 8 v5 M-6 8 v6 M8 8 v4 M19 8 v6" stroke="#cfe2f5" stroke-width="1.3" stroke-linecap="round"/>
    <path d="M-15 -5 H5 L2 1 H-12Z" fill="#7a5634"/><path d="M-5 -5 V-18 L3 -7Z" fill="#d9d2c3" opacity=".8"/>
    <path d="M-15 -5 H5" stroke="${SNOW}" stroke-width="1.2"/>
    <rect x="16" y="-8" width="4" height="12" fill="#4a3624"/><circle cx="18" cy="-10" r="2.4" fill="${WIN}" class="lit"/>`,
};

function harborScenery() {
  const stars = [[300, 18], [330, 40], [352, 14], [270, 30], [246, 12], [366, 58], [318, 66], [150, 16], [120, 34], [182, 28]]
    .map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 3 ? 0.9 : 1.3}" class="star" style="animation-delay:${i * 0.4}s"/>`).join("");
  return `<rect width="380" height="290" fill="url(#sea)"/>
    <path class="land" d="M30 0 H380 V290 H150 C140 262 112 250 70 258 C40 262 20 245 18 215 C16 180 40 160 34 130 C28 100 8 80 14 50 C18 26 26 12 30 0Z"/>
    <path d="M30 0 H380 V96 C300 110 220 92 140 104 C90 110 40 96 22 70 C16 40 24 14 30 0Z" fill="url(#sky)" opacity=".55"/>
    <circle cx="342" cy="34" r="34" fill="url(#moonglow)"/><circle cx="342" cy="34" r="11" fill="#e8eefc"/><circle cx="346" cy="31" r="10" fill="#c9d4ea" opacity=".35"/>
    ${stars}
    <path class="shore" d="M150 290 C140 262 112 250 70 258 C40 262 20 245 18 215 C16 180 40 160 34 130 C28 100 8 80 14 50 C18 26 26 12 30 0"/>
    <g class="waves"><path d="M8 272q8-5 16 0t16 0t16 0"/><path d="M56 284q8-5 16 0t16 0"/><path d="M2 240q6-4 12 0t12 0"/><path d="M4 150q5-3 10 0"/></g>`;
}

function frostScenery() {
  const stars = [[40, 16], [120, 10], [160, 30], [236, 14], [262, 34], [350, 20], [372, 44], [96, 40], [206, 40]]
    .map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 3 ? 0.8 : 1.2}" class="star" style="animation-delay:${i * 0.5}s"/>`).join("");
  const pine = (x, y, k = 1) => `<g transform="translate(${x} ${y}) scale(${k})" class="pine"><path d="M0 -22 L8 -8 H4 L10 2 H-10 L-4 -8 H-8Z" fill="#1c2b3a"/><path d="M0 -22 L5 -13 L-5 -13Z" fill="${SNOW}" opacity=".8"/><rect x="-1.2" y="2" width="2.4" height="4" fill="#2a2018"/></g>`;
  const flakes = Array.from({ length: 22 }, (_, i) => {
    const x = (i * 53) % 380, y = (i * 37) % 290, r = i % 4 ? 0.9 : 1.4;
    return `<circle cx="${x}" cy="${y}" r="${r}" class="flake" style="animation-delay:${(i % 7) * -1.3}s;animation-duration:${7 + (i % 5)}s"/>`;
  }).join("");
  return `<rect width="380" height="290" fill="url(#snowland)"/>
    <path d="M0 0 H380 V78 C300 92 220 70 140 84 C80 94 30 80 0 70Z" fill="url(#frostsky)"/>
    <g class="aurora">
      <path d="M-10 46 C60 10 120 52 190 24 C250 0 300 34 390 12" stroke="url(#aurora1)"/>
      <path d="M-10 60 C70 30 140 66 210 40 C270 18 320 48 390 30" stroke="url(#aurora2)"/>
    </g>
    ${stars}
    <path class="ice" d="M0 104 C60 92 126 90 204 102 C252 110 266 150 240 176 C216 200 156 196 122 216 C92 234 40 240 0 236Z"/>
    <g class="cracks"><path d="M30 120 l26 14 l18 -6 l20 18"/><path d="M140 186 l22 -10 l26 8"/><path d="M210 120 l-14 22 l8 18"/><path d="M20 210 l30 -8 l14 10"/></g>
    ${pine(26, 74, .9)}${pine(44, 82, .7)}${pine(350, 120, 1)}${pine(366, 134, .8)}${pine(338, 252, .9)}${pine(120, 272, .8)}${pine(140, 280, .6)}${pine(250, 92, .7)}
    <g class="snowfall">${flakes}</g>`;
}

// ---------- The map in play ----------
const MAPS = {
  harbor: {
    places: HARBOR_PLACES, paths: HARBOR_PATHS, buildings: HARBOR_BUILDINGS, scenery: harborScenery,
    text: { lampName: "the great lamp", lampAction: "Relight the great lamp", lampTask: "lit the great lamp", bellPlace: "the Market Square", setting: "harbor", title: "The harbor at night" },
  },
  frostmere: {
    places: FROST_PLACES, paths: FROST_PATHS, buildings: FROST_BUILDINGS, scenery: frostScenery,
    text: { lampName: "the great beacon", lampAction: "Rekindle the great beacon", lampTask: "kindled the great beacon", bellPlace: "the Ice Market", setting: "frozen port", title: "Frostmere at night" },
  },
};
for (const p of Object.values(HARBOR_PLACES)) p.the ??= "the " + p.name;

let current = "harbor";
/** Place names and positions for the map in play (swapped by setMap). */
export const PLACES = { ...HARBOR_PLACES };
/** Switch the map everything draws and names. */
export function setMap(id) {
  const next = MAPS[id] ? id : "harbor";
  if (next === current && PLACES.market === MAPS[next].places.market) return;
  current = next;
  for (const k of Object.keys(PLACES)) delete PLACES[k];
  Object.assign(PLACES, MAPS[current].places);
}
export const currentMap = () => current;
/** Words that depend on the map: what the great lamp is called, where the bell hangs. */
export const mapText = () => MAPS[current].text;
export const MAP_LIST = [
  { id: "harbor", name: "The Harbor", blurb: "A foggy harbor. The square is at the heart of everything." },
  { id: "frostmere", name: "Frostmere", blurb: "A frozen port: a ring of places around the ice. Lonelier — and kinder to Shades." },
];

function miniLantern(x, y, color, { wisp = false, scale = 1 } = {}) {
  if (wisp) {
    return `<g transform="translate(${x} ${y}) scale(${scale})" class="mini wisp"><path d="M0 -9c4 3 5 8 2 12 1 2 1 4 2 6-3-1-4-2-4-4 0 2-1 3-4 4 1-2 1-4 2-6-3-4-2-9 2-12z" fill="#cfe2f5" opacity=".7"/></g>`;
  }
  return `<g transform="translate(${x} ${y}) scale(${scale})" class="mini">
    <circle cy="-5" r="8" fill="${color}" opacity=".22"/>
    <path d="M0 2c-4 1-5 5-5 10h10c0-5-1-9-5-10z" fill="#2b3550"/>
    <rect x="-3.2" y="-9" width="6.4" height="9" rx="1.5" fill="#1d2230" stroke="#8a93a6" stroke-width=".9"/>
    <circle cy="-4.5" r="2" fill="${color}" class="mini-flame"/></g>`;
}

/**
 * @param {{here: string|null, neighbors: string[], canMove: boolean, flame: string, tasks?: string[],
 *          company?: {lantern: string, wisp?: boolean}[], shapes?: number, fog?: boolean, self?: {lantern: string, wisp?: boolean}}} view
 */
export function crowdSVG({ here, flame, company = [], shapes = 0, fog = false, self }) {
  if (!here) return "";
  const p = PLACES[here];
  // Around the building, clear of its name label below.
  const spots = [[-32, 4], [32, 4], [-44, -10], [44, -10], [-22, -22], [22, -22], [-50, 12], [50, 12], [0, -40]];
  const others = fog ? Array.from({ length: shapes }, () => ({ shape: true })) : company;
  let out = others.slice(0, spots.length).map((c, i) => {
    const [dx, dy] = spots[i];
    if (c.shape) return `<g transform="translate(${p.x + dx} ${p.y + dy})" class="mini shape"><ellipse cy="-2" rx="5" ry="9" fill="#0c0f18" opacity=".85"/><circle cy="-10" r="3.5" fill="#0c0f18" opacity=".85"/></g>`;
    return miniLantern(p.x + dx, p.y + dy, LANTERN_FLAMES[c.lantern] ?? "#ffb347", { wisp: c.wisp });
  }).join("");
  if (self) out += miniLantern(p.x, p.y + 5, flame, { wisp: self.wisp, scale: 1.15 });
  return out;
}

export function harborSVG(view) {
  const { here, neighbors = [], canMove, flame, tasks = [], fog = false, barred = null } = view;
  // Barred doors: nobody walks into or out of that place.
  const blocked = (id) => barred && (barred === id || barred === here);

  const M = MAPS[current];
  const paths = M.paths.map(([a, b]) => {
    const A = PLACES[a], B = PLACES[b];
    const live = here && ((a === here && neighbors.includes(b)) || (b === here && neighbors.includes(a))) && !blocked(a === here ? b : a);
    const mx = (A.x + B.x) / 2 + (A.y - B.y) * 0.08, my = (A.y + B.y) / 2 + (B.x - A.x) * 0.08;
    return `<path d="M${A.x} ${A.y + 10} Q${mx} ${my + 10} ${B.x} ${B.y + 10}" class="path${live ? " live" : ""}"/>`;
  }).join("");

  const nodes = Object.entries(M.places).map(([id, p]) => {
    const isHere = id === here;
    const isNext = neighbors.includes(id) && !blocked(id);
    const cls = ["place", isHere ? "here" : "", isNext ? "next" : "", isNext && !canMove ? "wait" : "", barred === id ? "barred" : ""].join(" ").trim();
    const label = `${p.name}${barred === id ? " (doors barred)" : ""}${isHere ? " (you are here)" : isNext ? " — walk here" : ""}`;
    const interactive = isNext ? ` role="button" tabindex="0" data-place="${id}" aria-label="${label}"` : ` aria-label="${label}"`;
    const w = p.name.length * 5.6 + 14;
    return `<g class="${cls}" transform="translate(${p.x} ${p.y})"${interactive}>
      <ellipse class="halo" cx="0" cy="6" rx="30" ry="26"/>
      <g class="building">${M.buildings[id]}</g>
      ${isHere ? `<ellipse class="ring" cx="0" cy="14" rx="26" ry="7" style="stroke:${flame}"/>` : ""}
      <g class="label" transform="translate(0 30)"><rect x="${-w / 2}" y="-9" width="${w}" height="14" rx="7"/><text y="1.5">${p.name}</text></g>
      ${tasks.includes(id) ? `<g class="task-pin" transform="translate(20 -22)"><circle r="6"/><path d="M-2.5 0l1.8 1.8 3.2-3.6"/></g>` : ""}
      ${barred === id ? `<g class="padlock-pin" transform="translate(-21 -20)"><circle r="9"/><path d="M-3.2 -1.5v-2.2a3.2 3.2 0 0 1 6.4 0v2.2"/><rect x="-4.6" y="-1.6" width="9.2" height="7" rx="1.6"/></g>` : ""}
    </g>`;
  }).join("");

  return `<svg class="harbor-map map-${current}${fog ? " fogged" : ""}" viewBox="0 0 380 290" role="group" aria-label="Map">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1222"/><stop offset="1" stop-color="#152238"/></linearGradient>
      <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#112840"/><stop offset="1" stop-color="#0a1626"/></linearGradient>
      <linearGradient id="lhbeam" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="#ffe2a8" stop-opacity=".55"/><stop offset="1" stop-color="#ffe2a8" stop-opacity="0"/></linearGradient>
      <radialGradient id="moonglow"><stop offset="0" stop-color="#e8eefc" stop-opacity=".35"/><stop offset="1" stop-color="#e8eefc" stop-opacity="0"/></radialGradient>
      <linearGradient id="snowland" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a2234"/><stop offset="1" stop-color="#232d42"/></linearGradient>
      <linearGradient id="frostsky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#070b16"/><stop offset="1" stop-color="#0d1424" stop-opacity="0"/></linearGradient>
      <linearGradient id="aurora1" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3fbf8f" stop-opacity="0"/><stop offset=".35" stop-color="#3fbf8f" stop-opacity=".55"/><stop offset=".7" stop-color="#4fc3d9" stop-opacity=".4"/><stop offset="1" stop-color="#b57edc" stop-opacity="0"/></linearGradient>
      <linearGradient id="aurora2" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4fc3d9" stop-opacity="0"/><stop offset=".5" stop-color="#9bd36a" stop-opacity=".3"/><stop offset="1" stop-color="#3fbf8f" stop-opacity="0"/></linearGradient>
      <radialGradient id="beaconglow"><stop offset="0" stop-color="#ffcf7a" stop-opacity=".55"/><stop offset="1" stop-color="#ff9d3c" stop-opacity="0"/></radialGradient>
      <radialGradient id="fogpuff"><stop offset="0" stop-color="#b7c6dd" stop-opacity=".22"/><stop offset="1" stop-color="#b7c6dd" stop-opacity="0"/></radialGradient>
    </defs>
    ${M.scenery()}
    ${paths}
    ${nodes}
    <g class="crowd-layer">${crowdSVG(view)}</g>
    <g class="fogbank" pointer-events="none">
      <ellipse cx="80" cy="190" rx="140" ry="28" fill="url(#fogpuff)"/>
      <ellipse cx="300" cy="90" rx="150" ry="26" fill="url(#fogpuff)"/>
    </g>
    ${fog ? `<rect class="fog-veil" width="380" height="290" pointer-events="none"/>` : ""}
  </svg>`;
}
