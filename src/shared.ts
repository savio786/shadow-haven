// Shared constants and message shapes for Shadow Haven.
// The client (public/app.js) mirrors these by hand; keep them in sync.

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 10;
export const NAME_MAX = 16;

// Room codes avoid letters that are easy to confuse (I, O).
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export const CODE_PATTERN = /^[A-Z]{4}$/;

// Each Keeper has a flame color and a lantern shape. 10 colors = 10 seats.
export const LANTERNS = [
  { id: "ember", label: "Ember", flame: "#ff7a45" },
  { id: "amber", label: "Amber", flame: "#ffb347" },
  { id: "moss", label: "Moss", flame: "#9bd36a" },
  { id: "tide", label: "Tide", flame: "#4fc3d9" },
  { id: "frost", label: "Frost", flame: "#cfe8ff" },
  { id: "plum", label: "Plum", flame: "#b57edc" },
  { id: "rose", label: "Rose", flame: "#ff8fb1" },
  { id: "gold", label: "Gold", flame: "#ffd84d" },
  { id: "ivy", label: "Ivy", flame: "#3fbf8f" },
  { id: "ash", label: "Ash", flame: "#b8b2a7" },
] as const;

export const SHAPES = ["round", "hex", "tall", "caged"] as const;

export const BOT_NAMES = [
  "Old Wick", "Bramble", "Tally", "Fennel", "Marlow",
  "Pell", "Quill", "Sorrel", "Juniper", "Oakum",
];

export type Phase = "lobby" | "reveal" | "playing" | "meeting" | "ended";

export interface GameResult {
  winner: "keepers" | "shades";
  reason: string;
  shades: string[];          // revealed at the end
  gameId: string;            // unique per game, so a device counts it once
  durationMs: number;
  players: PlayerSummary[];  // who was who, and how it went for them
  honors: Honor[];
  log: MatchEvent[];         // what happened, in order
  tale: string | null;       // the story of the night (arrives a moment after the end)
  taleBy: "ai" | "fallback" | null;
}

export interface PlayerSummary {
  id: string;
  role: Role;
  special?: Special | null;
  fate: "survived" | "snuffed" | "adrift";
  where: string | null;      // where they were snuffed
  tasksDone: number;         // real tasks (Shades' fakes don't count)
  tasksTotal: number;
  snuffs: number;
  sharpVotes: number;        // votes cast for a Shade
}

export interface Honor {
  id: string;                // stable key for the icon
  title: string;
  who: string;
  why: string;
}

export interface MatchEvent {
  at: number;                // ms since play began
  kind: "snuff" | "report" | "bell" | "adrift" | "spared" | "fog" | "relight" | "check" | "bar";
  who?: string;              // snuffer / reporter / ringer / the one set adrift
  victim?: string;
  loc?: string;
  found?: string[];
  wasShade?: boolean;
}

export interface PublicTask {
  id: string;
  loc: string;
  name: string;
  done: boolean;
}
export type Role = "keeper" | "shade";
/** Special roles: one Keeper may be the Lamplighter, one Shade the Locksmith. */
export type Special = "lamplighter" | "locksmith";

/** The Lamplighter appears from this many players up (at 4 it would decide the game alone). */
export const LAMPLIGHTER_MIN_PLAYERS = 5;
/** The Locksmith bars the doors of where they stand: nobody in or out for this long… */
export const BAR_MS = 12_000;
/** …first usable this long into play (and after each gathering)… */
export const FIRST_BAR_MS = 25_000;
/** …then rests this long after the doors open again. */
export const BAR_COOLDOWN_MS = 40_000;

/** How long the private role reveal stays on screen before play begins. */
export const REVEAL_MS = 7000;

/** Walking between locations takes this long before you can move again. */
export const MOVE_COOLDOWN_MS = 1500;

/** A Shade can't snuff until this long into play (and after each gathering)… */
export const FIRST_SNUFF_MS = 20_000;
/** …and then has to wait this long between snuffs. */
export const SNUFF_COOLDOWN_MS = 30_000;

/** The Shades' fog: Keepers can't make out faces until it lifts or the lamp is relit. */
export const FOG_FIRST_MS = 30_000;    // not in the first 30s of play (or after a meeting)
export const FOG_MS = 30_000;          // how long it lasts if nobody relights the lamp
export const FOG_COOLDOWN_MS = 60_000; // rest after it lifts

export type BotLevel = "easy" | "normal" | "cunning";
export type MeetingPace = "quick" | "normal" | "long";
export interface Settings {
  botLevel: BotLevel;
  auto: boolean;        // the host's device picked the level from their record
  shades: number;       // 0 = pick for the table size; else 1–3 (capped by table size)
  meeting: MeetingPace; // how long the harbor talks and votes
  tasks: number;        // tasks each, TASKS_MIN–TASKS_MAX
  public: boolean;      // open to anyone through Play now
  specials: boolean;    // deal the Lamplighter and the Locksmith
}

export const DEFAULT_SETTINGS: Settings = { botLevel: "normal", auto: false, shades: 0, meeting: "normal", tasks: 5, public: false, specials: true };

/** Public rooms start by themselves: this long after the first person arrives… */
export const AUTO_START_MS = 40_000;
/** …a little later if someone else arrives near the end… */
export const AUTO_START_GRACE_MS = 12_000;
/** …but never more than this after the first person arrived… */
export const AUTO_START_MAX_MS = 90_000;
/** …and seats left empty are filled with bots up to this many players. */
export const AUTO_START_FILL = 6;
export const TASKS_MIN = 3;
export const TASKS_MAX = 6;

/** Talk and vote time for each meeting pace. */
export const MEETING_PACE: Record<MeetingPace, { discuss: number; vote: number }> = {
  quick: { discuss: 30_000, vote: 20_000 },
  normal: { discuss: 45_000, vote: 25_000 },
  long: { discuss: 75_000, vote: 35_000 },
};

/** A meeting: gather at the bell, talk it over, vote, hear the verdict. */
export const GATHER_MS = 6000;
export const DISCUSS_MS = 45_000;
export const VOTE_MS = 25_000;
export const RESULT_MS = 8000;

export const CHAT_MAX = 140;

export type MeetingStage = "gather" | "discuss" | "vote" | "result";

export interface ChatLine {
  id: number;
  who: string;        // player id ("" for the harbor itself)
  text: string;
  at: number;
}

export interface VoteResult {
  adrift: string | null;          // who was set adrift, if anyone
  wasShade: boolean | null;
  votes: Record<string, string>;  // voter → target id or "skip"
  tie: boolean;
}

export interface Meeting {
  kind: "cold" | "bell";
  reporter: string;  // who rang the bell
  loc: string;       // where it was rung / the cold lantern was found
  found: string[];   // whose lanterns were found there
  snuffed: string[]; // everyone snuffed so far (now public)
  stage: MeetingStage;
  stageEndsAt: number;
  stageMs: number;   // how long this stage lasts in all (for the timer ring)
  endsAt: number;    // same as stageEndsAt (kept for older clients)
  chat: ChatLine[];  // the most recent lines
  voted: string[];   // who has voted (not for whom, until the result)
  ready: string[];   // who is ready to vote early
  result: VoteResult | null;
}

/** The most Shades a table can hold and still be a fair fight: a third of the players. */
export function maxShades(players: number) {
  return Math.max(1, Math.min(3, Math.floor(players / 3)));
}

/** How many Shades: the host's choice (capped by table size), or 1 for 4–6 players and 2 for 7–10. */
export function shadeCount(players: number, wanted = 0) {
  if (wanted >= 1) return Math.min(Math.floor(wanted), maxShades(players));
  return players >= 7 ? 2 : 1;
}

export interface PublicPlayer {
  snuffed?: boolean; // only once it's public (after a gathering)
  adrift?: boolean;  // set adrift by vote
  bellUsed?: boolean; // has rung the emergency bell
  id: string;
  name: string;
  lantern: string; // LANTERNS[].id
  shape: (typeof SHAPES)[number];
  isBot: boolean;
  isHost: boolean;
  connected: boolean;
}

// Client → server
export type ClientMsg =
  | { t: "join"; playerId: string; token: string; name: string }
  | { t: "rename"; name: string }
  | { t: "addBot" }
  | { t: "removePlayer"; id: string }
  | { t: "start" }
  | { t: "endGame" }
  | { t: "playAgain" }
  | { t: "settings"; botLevel?: BotLevel; auto?: boolean; shades?: number; meeting?: MeetingPace; tasks?: number; public?: boolean; specials?: boolean }
  | { t: "check"; target: string }
  | { t: "bar" }
  | { t: "fog" }
  | { t: "relight" }
  | { t: "move"; to: string }
  | { t: "taskStart"; id: string }
  | { t: "taskDone"; id: string; nonce: string; answer?: unknown }
  | { t: "taskCancel" }
  | { t: "snuff"; target: string }
  | { t: "report" }
  | { t: "bell" }
  | { t: "say"; text: string }
  | { t: "ready" }
  | { t: "vote"; target: string }
  | { t: "leave" }
  | { t: "ping" };

// Server → client
export type ServerMsg =
  | { t: "welcome"; you: string; code: string }
  | {
      t: "lobby";
      phase: Phase;
      hostId: string | null;
      players: PublicPlayer[];
      min: number;
      max: number;
      shades: number;              // how many Shades this game has / will have
      revealEndsAt: number | null; // epoch ms, during "reveal"
      progress: number | null;     // 0..1 share of Keeper tasks done, while a game is on
      result: GameResult | null;   // once the game has ended
      meeting: Meeting | null;     // while everyone is gathered at the bell
      now: number;                 // server clock, so timers line up
      settings: Settings;
      fogUntil: number | null;     // the fog is down until then (everyone knows)
      autoStartAt: number | null;  // a public room starts by itself then
      barred: { loc: string; until: number } | null; // a place whose doors the Locksmith has barred
    }
  // Sent privately to one player. Never broadcast.
  | { t: "role"; role: Role; allies: string[]; special: Special | null }
  // Private: what the Lamplighter saw in someone's lantern.
  | { t: "checked"; who: string; role: Role }
  // Private: where you are, where you can go, and who is here with you.
  | {
      t: "view";
      here: string;
      neighbors: string[];
      present: string[];        // who you can see here (the living can't see wisps)
      cold: string[];           // whose cold lanterns lie here
      alive: boolean;           // false once you're a wisp
      wisps: string[];          // (wisps only) which of those present are wisps too
      readyAt: number;          // when you can walk again
      snuffReadyAt: number | null; // Shades only: when you can snuff again
      fog: boolean;                // you're in the fog: names hidden
      shapes: number;              // in the fog: how many shapes are here
      fogReadyAt: number | null;   // Shades only: when the fog can be called
      canCheck: boolean;           // the Lamplighter still has their one look
      barReadyAt: number | null;   // the Locksmith only: when the doors can be barred again
      now: number;
    }
  // Private: your lantern was snuffed.
  | { t: "snuffed"; by: string }
  // Private: your task list (a Shade's is fake, and looks the same).
  | { t: "tasks"; tasks: PublicTask[] }
  // Private: the mini-game for the task you just started.
  | { t: "taskChallenge"; id: string; nonce: string; kind: string; name: string; data: unknown }
  | { t: "taskResult"; id: string; ok: boolean; text?: string }
  // Sent to everyone in a place when something there is plain to see.
  | { t: "witness"; kind: "lamp" | "snuff"; who: string; victim?: string; loc: string; text: string }
  // A new line in the meeting chat (everyone gets it; only the living may speak).
  | { t: "chat"; line: ChatLine }
  // A bot is composing a line.
  | { t: "typing"; who: string }
  | { t: "notice"; text: string }
  | { t: "error"; code: string; text: string }
  | { t: "pong" };
