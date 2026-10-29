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

/** A snuffed lantern lying on its side: no flame, rimed with frost. */
export function coldLanternSVG({ shape = "hex", size = 56 } = {}) {
  const h = Math.round(size * 0.75);
  return `<svg class="cold-svg" viewBox="0 0 80 60" width="${size}" height="${h}" aria-hidden="true">
    <ellipse cx="40" cy="52" rx="30" ry="5" fill="#000" opacity=".35"/>
    <g transform="translate(40 33) rotate(-78) scale(1.08) translate(-30 -32)">
      <circle cx="30" cy="6" r="4.5" fill="none" stroke="#5a6275" stroke-width="2"/>
      <rect x="23" y="10" width="14" height="4" rx="1.5" fill="#4a5163"/>
      ${cage(shape).replaceAll(FRAME, "#a9c4dd").replace('fill="#1d2230"', 'fill="#1a2433"')}
      <path d="M30 26c3 4 3 9 0 11-3-2-3-7 0-11z" fill="#3b4a5e"/>
      <rect x="22" y="50" width="16" height="4" rx="1.5" fill="#4a5163"/>
    </g>
    <g class="frost" stroke="#d8ecff" stroke-width="1.1" stroke-linecap="round" opacity=".85">
      <path d="M18 18v8M14 22h8M15.5 19.5l5 5M20.5 19.5l-5 5"/>
      <path d="M61 30v6M58 33h6"/>
      <path d="M50 12v5M47.5 14.5h5"/>
    </g>
    <path class="breath" d="M44 14c-2-4 2-6 0-10" stroke="#9fb4d6" stroke-width="1.3" fill="none" stroke-linecap="round" opacity=".5"/>
  </svg>`;
}

/** A wisp: what's left of a Keeper after the lantern is snuffed. */
export function wispSVG({ lantern = "amber", size = 40 } = {}) {
  const flame = LANTERNS[lantern] ?? LANTERNS.amber;
  const gid = "w" + Math.random().toString(36).slice(2, 8);
  const h = Math.round(size * 1.4);
  return `<svg class="wisp-svg" viewBox="0 0 50 70" width="${size}" height="${h}" aria-hidden="true">
    <defs><radialGradient id="${gid}" cx=".5" cy=".4"><stop offset="0" stop-color="#e8f3ff" stop-opacity=".95"/><stop offset=".55" stop-color="${flame}" stop-opacity=".45"/><stop offset="1" stop-color="#7fa8d6" stop-opacity="0"/></radialGradient></defs>
    <path d="M25 6c12 10 15 24 9 36-3 6-1 12 3 18-8-2-12-6-12-12 0 6-4 10-12 12 4-6 6-12 3-18-6-12-3-26 9-36z" fill="url(#${gid})"/>
    <circle cx="21" cy="28" r="1.8" fill="#0e1220" opacity=".55"/><circle cx="29" cy="28" r="1.8" fill="#0e1220" opacity=".55"/>
  </svg>`;
}

/** A little rowing boat carrying someone's lantern out into the fog. */
export function boatSVG({ lantern = "amber", shade = false, size = 160 } = {}) {
  const flame = shade ? "#9b7bff" : (LANTERNS[lantern] ?? LANTERNS.amber);
  const h = Math.round(size * 0.6);
  return `<svg class="boat-svg" viewBox="0 0 160 96" width="${size}" height="${h}" aria-hidden="true">
    <g class="boat">
      <circle cx="80" cy="34" r="22" fill="${flame}" opacity=".18"/>
      <rect x="77" y="18" width="6" height="3" rx="1" fill="#3a3f4b"/>
      <path d="M72 22h16l2 12-2 12H72l-2-12z" fill="#1d2230" stroke="#8a93a6" stroke-width="2"/>
      <path class="flame" d="M80 26c4 5 4 10 0 13-4-3-4-8 0-13z" fill="${flame}"/>
      <path d="M40 56h80l-12 16H52z" fill="#5a3f26"/>
      <path d="M40 56h80l-3 4H43z" fill="#7a5634"/>
      <path d="M80 46v10" stroke="#3a3f4b" stroke-width="2"/>
    </g>
    <g class="water" stroke="#2e5578" stroke-width="2" fill="none" stroke-linecap="round">
      <path d="M20 80q10-6 20 0t20 0t20 0t20 0t20 0t20 0"/>
      <path d="M30 90q10-5 20 0t20 0t20 0t20 0t20 0" opacity=".6"/>
    </g>
  </svg>`;
}

/** The Harbor Bell. */
export function bellSVG({ size = 120 } = {}) {
  return `<svg class="bell-svg" viewBox="0 0 120 120" width="${size}" height="${size}" aria-hidden="true">
    <path d="M20 20h80" stroke="#5c4a2e" stroke-width="6" stroke-linecap="round"/>
    <path d="M60 20v10" stroke="#5c4a2e" stroke-width="4"/>
    <g class="bell-swing">
      <path d="M60 30c-18 0-26 14-26 32 0 14-6 20-12 26h76c-6-6-12-12-12-26 0-18-8-32-26-32z" fill="#c9923e"/>
      <path d="M60 30c-18 0-26 14-26 32 0 14-6 20-12 26h18c4-6 6-14 6-26 0-16 4-28 14-32z" fill="#e6b45e"/>
      <rect x="20" y="86" width="80" height="7" rx="3" fill="#a87630"/>
      <circle cx="60" cy="98" r="6" fill="#8a5f24"/>
    </g>
    <g class="bell-waves" stroke="#ffd59a" stroke-width="2.5" fill="none" stroke-linecap="round">
      <path d="M12 50q-6 12 0 24"/><path d="M108 50q6 12 0 24"/><path d="M4 44q-8 18 0 36"/><path d="M116 44q8 18 0 36"/>
    </g>
  </svg>`;
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
