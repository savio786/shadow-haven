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

export type Phase = "lobby";

export interface PublicPlayer {
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
  | { t: "leave" }
  | { t: "ping" };

// Server → client
export type ServerMsg =
  | { t: "welcome"; you: string; code: string }
  | { t: "lobby"; phase: Phase; hostId: string | null; players: PublicPlayer[]; min: number; max: number }
  | { t: "notice"; text: string }
  | { t: "error"; code: string; text: string }
  | { t: "pong" };
