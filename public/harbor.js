// The harbor map: original layout and art. The server decides the rules
// (which paths exist, where you are); this file only draws them.

export const PLACES = {
  lighthouse: { name: "Lighthouse", x: 70, y: 70,
    text: "The great lamp turns overhead. From up here you can hear the whole bay." },
  clocktower: { name: "Clock Tower", x: 215, y: 52,
    text: "Gears tick in the dark. The clock has always run a little slow." },
  chapel: { name: "Chapel", x: 312, y: 128,
    text: "Candle stubs and cold pews. Footsteps echo for a long time here." },
  market: { name: "Market Square", x: 192, y: 158,
    text: "Shuttered stalls and a dry fountain. Everyone passes through the square." },
  netloft: { name: "Net Loft", x: 268, y: 236,
    text: "Nets hang like curtains. Every corner smells of salt and tar." },
  dock: { name: "Dock", x: 92, y: 222,
    text: "Rope-creak and black water. Boats knock softly against the pilings." },
};

const PATHS = [
  ["dock", "market"], ["dock", "lighthouse"], ["dock", "netloft"],
  ["lighthouse", "clocktower"], ["market", "netloft"], ["market", "clocktower"],
  ["market", "chapel"], ["netloft", "chapel"],
];

// Small original glyphs for each place, centred on 0,0.
const ICONS = {
  lighthouse: `<path d="M-5 9h10l-2-14h-6z M-4 -5h8v-3h-8z" /><path d="M-3 -8l3-4 3 4" />`,
  clocktower: `<rect x="-6" y="-4" width="12" height="13" rx="1"/><circle cx="0" cy="-6" r="5"/><path d="M0 -6v-3M0 -6h2.5" class="hand"/>`,
  chapel: `<path d="M-7 9v-9l7-7 7 7v9z"/><path d="M-2 9v-5a2 2 0 0 1 4 0v5" class="cut"/>`,
  market: `<path d="M-8 -3h16l-2-5h-12z"/><path d="M-6 -3v11M6 -3v11M-8 8h16"/>`,
  netloft: `<path d="M-8 -7h16v15h-16z"/><path d="M-8 -2h16M-8 3h16M-3 -7v15M3 -7v15" class="cut"/>`,
  dock: `<path d="M-9 2h18M-9 6h18"/><path d="M-6 -6v14M6 -6v14"/><circle cx="0" cy="-5" r="2.5"/>`,
};

/**
 * @param {{here: string|null, neighbors: string[], canMove: boolean, flame: string, tasks?: string[]}} view
 */
export function harborSVG(view) {
  const { here, neighbors = [], canMove, flame, tasks = [] } = view;
  const paths = PATHS.map(([a, b]) => {
    const A = PLACES[a], B = PLACES[b];
    const live = here && ((a === here && neighbors.includes(b)) || (b === here && neighbors.includes(a)));
    return `<line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" class="path${live ? " live" : ""}"/>`;
  }).join("");

  const nodes = Object.entries(PLACES).map(([id, p]) => {
    const isHere = id === here;
    const isNext = neighbors.includes(id);
    const cls = ["place", isHere ? "here" : "", isNext ? "next" : "", isNext && !canMove ? "wait" : ""].join(" ").trim();
    const label = `${p.name}${isHere ? " (you are here)" : isNext ? " — walk here" : ""}`;
    const interactive = isNext ? ` role="button" tabindex="0" data-place="${id}" aria-label="${label}"` : ` aria-label="${label}"`;
    return `<g class="${cls}" transform="translate(${p.x} ${p.y})"${interactive}>
      <circle r="22" class="halo"/>
      <circle r="17" class="disc"/>
      <g class="icon">${ICONS[id]}</g>
      ${isHere ? `<circle r="22" class="ring" style="stroke:${flame}"/>` : ""}
      ${tasks.includes(id) ? `<g class="task-pin" transform="translate(14 -14)"><circle r="6"/><path d="M-2.5 0l1.8 1.8 3.2-3.6"/></g>` : ""}
      <text y="34" class="label">${p.name}</text>
    </g>`;
  }).join("");

  return `<svg class="harbor-map" viewBox="0 0 380 290" role="group" aria-label="Harbor map">
    <defs>
      <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#10233a"/><stop offset="1" stop-color="#0a1626"/>
      </linearGradient>
      <radialGradient id="fog" cx=".5" cy=".5" r=".6">
        <stop offset="0" stop-color="#9fb4d6" stop-opacity="0"/><stop offset="1" stop-color="#9fb4d6" stop-opacity=".10"/>
      </radialGradient>
    </defs>
    <rect width="380" height="290" fill="url(#sea)"/>
    <path class="land" d="M30 0 H380 V290 H150 C140 262 112 250 70 258 C40 262 20 245 18 215 C16 180 40 160 34 130 C28 100 8 80 14 50 C18 26 26 12 30 0Z"/>
    <path class="shore" d="M150 290 C140 262 112 250 70 258 C40 262 20 245 18 215 C16 180 40 160 34 130 C28 100 8 80 14 50 C18 26 26 12 30 0"/>
    <g class="waves"><path d="M20 275q8-5 16 0t16 0"/><path d="M60 282q8-5 16 0t16 0"/><path d="M4 245q6-4 12 0"/></g>
    ${paths}
    ${nodes}
    <rect width="380" height="290" fill="url(#fog)" pointer-events="none"/>
  </svg>`;
}
