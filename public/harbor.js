// The harbor map: original illustrated layout. The server decides the rules
// (which paths exist, where you are, who you can see); this file only draws.

export const PLACES = {
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

const PATHS = [
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
const BUILDINGS = {
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
  if (self) out += miniLantern(p.x, p.y + 15, flame, { wisp: self.wisp, scale: 1.15 });
  return out;
}

export function harborSVG(view) {
  const { here, neighbors = [], canMove, flame, tasks = [], fog = false } = view;

  const paths = PATHS.map(([a, b]) => {
    const A = PLACES[a], B = PLACES[b];
    const live = here && ((a === here && neighbors.includes(b)) || (b === here && neighbors.includes(a)));
    const mx = (A.x + B.x) / 2 + (A.y - B.y) * 0.08, my = (A.y + B.y) / 2 + (B.x - A.x) * 0.08;
    return `<path d="M${A.x} ${A.y + 10} Q${mx} ${my + 10} ${B.x} ${B.y + 10}" class="path${live ? " live" : ""}"/>`;
  }).join("");

  const nodes = Object.entries(PLACES).map(([id, p]) => {
    const isHere = id === here;
    const isNext = neighbors.includes(id);
    const cls = ["place", isHere ? "here" : "", isNext ? "next" : "", isNext && !canMove ? "wait" : ""].join(" ").trim();
    const label = `${p.name}${isHere ? " (you are here)" : isNext ? " — walk here" : ""}`;
    const interactive = isNext ? ` role="button" tabindex="0" data-place="${id}" aria-label="${label}"` : ` aria-label="${label}"`;
    const w = p.name.length * 5.6 + 14;
    return `<g class="${cls}" transform="translate(${p.x} ${p.y})"${interactive}>
      <ellipse class="halo" cx="0" cy="6" rx="30" ry="26"/>
      <g class="building">${BUILDINGS[id]}</g>
      ${isHere ? `<ellipse class="ring" cx="0" cy="14" rx="26" ry="7" style="stroke:${flame}"/>` : ""}
      <g class="label" transform="translate(0 30)"><rect x="${-w / 2}" y="-9" width="${w}" height="14" rx="7"/><text y="1.5">${p.name}</text></g>
      ${tasks.includes(id) ? `<g class="task-pin" transform="translate(20 -22)"><circle r="6"/><path d="M-2.5 0l1.8 1.8 3.2-3.6"/></g>` : ""}
    </g>`;
  }).join("");

  const stars = [[300, 18], [330, 40], [352, 14], [270, 30], [246, 12], [366, 58], [318, 66], [150, 16], [120, 34], [182, 28]]
    .map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 3 ? 0.9 : 1.3}" class="star" style="animation-delay:${i * 0.4}s"/>`).join("");

  return `<svg class="harbor-map${fog ? " fogged" : ""}" viewBox="0 0 380 290" role="group" aria-label="Harbor map">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1222"/><stop offset="1" stop-color="#152238"/></linearGradient>
      <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#112840"/><stop offset="1" stop-color="#0a1626"/></linearGradient>
      <linearGradient id="lhbeam" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="#ffe2a8" stop-opacity=".55"/><stop offset="1" stop-color="#ffe2a8" stop-opacity="0"/></linearGradient>
      <radialGradient id="moonglow"><stop offset="0" stop-color="#e8eefc" stop-opacity=".35"/><stop offset="1" stop-color="#e8eefc" stop-opacity="0"/></radialGradient>
      <radialGradient id="fogpuff"><stop offset="0" stop-color="#b7c6dd" stop-opacity=".22"/><stop offset="1" stop-color="#b7c6dd" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="380" height="290" fill="url(#sea)"/>
    <path class="land" d="M30 0 H380 V290 H150 C140 262 112 250 70 258 C40 262 20 245 18 215 C16 180 40 160 34 130 C28 100 8 80 14 50 C18 26 26 12 30 0Z"/>
    <path d="M30 0 H380 V96 C300 110 220 92 140 104 C90 110 40 96 22 70 C16 40 24 14 30 0Z" fill="url(#sky)" opacity=".55"/>
    <circle cx="342" cy="34" r="34" fill="url(#moonglow)"/><circle cx="342" cy="34" r="11" fill="#e8eefc"/><circle cx="346" cy="31" r="10" fill="#c9d4ea" opacity=".35"/>
    ${stars}
    <path class="shore" d="M150 290 C140 262 112 250 70 258 C40 262 20 245 18 215 C16 180 40 160 34 130 C28 100 8 80 14 50 C18 26 26 12 30 0"/>
    <g class="waves"><path d="M8 272q8-5 16 0t16 0t16 0"/><path d="M56 284q8-5 16 0t16 0"/><path d="M2 240q6-4 12 0t12 0"/><path d="M4 150q5-3 10 0"/></g>
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
