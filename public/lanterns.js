// Original Lantern Keeper art, drawn as SVG.
// Each Keeper = a cloaked figure whose head is a lantern. Players differ by
// flame color and lantern shape (round, hex, tall, caged).

/** Flame color for each lantern id. */
export const LANTERNS = {
  ember: "#ff7a45", amber: "#ffb347", moss: "#9bd36a", tide: "#4fc3d9", frost: "#cfe8ff",
  plum: "#b57edc", rose: "#ff8fb1", gold: "#ffd84d", ivy: "#3fbf8f", ash: "#b8b2a7",
};

const FRAME = "#8a93a6";
const IRON = "#3a3f4b";

function cage(shape) {
  switch (shape) {
    case "round":
      return `<circle cx="30" cy="32" r="15" fill="#1d2230" stroke="${FRAME}" stroke-width="2.5"/>
              <path d="M17 32h26" stroke="${FRAME}" stroke-width="1.2" opacity=".5"/>`;
    case "tall":
      return `<rect x="19" y="14" width="22" height="38" rx="6" fill="#1d2230" stroke="${FRAME}" stroke-width="2.5"/>`;
    case "caged":
      return `<rect x="16" y="17" width="28" height="31" rx="3" fill="#1d2230" stroke="${FRAME}" stroke-width="2.5"/>
              <path d="M23 17v31M30 17v31M37 17v31" stroke="${FRAME}" stroke-width="1.4" opacity=".55"/>`;
    default: // hex
      return `<path d="M20 17h20l4 15-4 16H20l-4-16z" fill="#1d2230" stroke="${FRAME}" stroke-width="2.5"/>`;
  }
}

/**
 * A Shade: the same cloaked figure, but the lantern holds a cold violet
 * "anti-flame" that drinks the light, with smoke curling off the cage.
 */
export function shadeSVG({ shape = "hex", size = 120 } = {}) {
  const gid = "s" + Math.random().toString(36).slice(2, 8);
  const h = Math.round(size * 1.6);
  return `<svg class="keeper-svg shade-svg" viewBox="0 0 60 96" width="${size}" height="${h}" aria-hidden="true">
    <defs><radialGradient id="${gid}"><stop offset="0" stop-color="#7b4dff" stop-opacity=".45"/><stop offset="1" stop-color="#7b4dff" stop-opacity="0"/></radialGradient></defs>
    <circle cx="30" cy="32" r="28" fill="url(#${gid})"/>
    <path class="smoke" d="M24 12c-4-4 2-7-1-11M36 12c4-4-2-7 1-11" stroke="#6c5a8f" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".7"/>
    <rect x="23" y="10" width="14" height="4" rx="1.5" fill="#26222f"/>
    ${cage(shape).replaceAll(FRAME, "#5d5378")}
    <path class="flame" d="M30 22c6 8 6 16 0 20-6-4-6-12 0-20z" fill="#0b0912" stroke="#9b7bff" stroke-width="1.4"/>
    <circle cx="27.5" cy="34" r="1.2" fill="#c9b6ff"/><circle cx="32.5" cy="34" r="1.2" fill="#c9b6ff"/>
    <rect x="22" y="50" width="16" height="4" rx="1.5" fill="#26222f"/>
    <path d="M30 54c-11 2-15 15-16 42h32c-1-27-5-40-16-42z" fill="#1a1626"/>
    <path d="M30 54c-4 10-5 26-4 42h8c1-16 0-32-4-42z" fill="#120f1b"/>
  </svg>`;
}

/**
 * @param {{lantern: string, shape: string, dim?: boolean, size?: number}} opts
 */
export function keeperSVG({ lantern, shape, dim = false, size = 64 }) {
  const flame = LANTERNS[lantern] ?? LANTERNS.amber;
  const gid = "g" + Math.random().toString(36).slice(2, 8);
  const h = Math.round(size * 1.6);
  return `<svg class="keeper-svg${dim ? " dim" : ""}" viewBox="0 0 60 96" width="${size}" height="${h}" aria-hidden="true">
    <defs><radialGradient id="${gid}"><stop offset="0" stop-color="${flame}" stop-opacity=".5"/><stop offset="1" stop-color="${flame}" stop-opacity="0"/></radialGradient></defs>
    <circle cx="30" cy="32" r="28" fill="url(#${gid})" class="glow"/>
    <path d="M30 4l3 6h-6z" fill="${IRON}"/>
    <rect x="23" y="10" width="14" height="4" rx="1.5" fill="${IRON}"/>
    ${cage(shape)}
    <path class="flame" d="M30 22c6 8 6 16 0 20-6-4-6-12 0-20z" fill="${flame}"/>
    <path d="M30 31c2.5 3.5 2 7 0 8.5-2-1.5-2.5-5 0-8.5z" fill="#fff6dc" opacity=".85"/>
    <rect x="22" y="50" width="16" height="4" rx="1.5" fill="${IRON}"/>
    <path d="M30 54c-11 2-15 15-16 42h32c-1-27-5-40-16-42z" fill="#2b3550"/>
    <path d="M30 54c-4 10-5 26-4 42h8c1-16 0-32-4-42z" fill="#232c44"/>
  </svg>`;
}
