// The end of the night: honors worked out from what really happened, and the
// facts the storyteller (Workers AI, or a written fallback) turns into a tale.

import type { Honor, MatchEvent, PlayerSummary } from "./shared";

export const PLACE: Record<string, string> = {
  dock: "the Dock", lighthouse: "the Lighthouse", netloft: "the Net Loft",
  market: "the Market Square", clocktower: "the Clock Tower", chapel: "the Chapel",
};

export interface HonorInput {
  players: PlayerSummary[];
  names: Record<string, string>;
  log: MatchEvent[];
  lamps: string[];   // who lit the great lamp while alive
  winner: "keepers" | "shades";
}

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** Up to four honors, each to a different player where possible. */
export function computeHonors({ players, log, lamps, winner }: HonorInput): Honor[] {
  const honors: Honor[] = [];
  const given = new Set<string>();
  const best = (list: PlayerSummary[], key: (p: PlayerSummary) => number, min: number) => {
    const sorted = list.filter((p) => key(p) >= min).sort((a, b) => key(b) - key(a));
    return sorted.find((p) => !given.has(p.id)) ?? sorted[0];
  };
  const add = (h: Honor | null) => { if (h && honors.length < 4) { honors.push(h); given.add(h.who); } };

  // The Keeper who did the most to light the harbor.
  const bright = best(players.filter((p) => p.role === "keeper"), (p) => p.tasksDone, 2);
  if (bright) add({ id: "bright", title: "Brightest lantern", who: bright.id, why: `lit ${bright.tasksDone} of ${bright.tasksTotal} tasks` });

  // Whoever voted for Shades most often.
  const sharp = best(players, (p) => p.sharpVotes, 1);
  if (sharp) add({ id: "sharp", title: "Sharp eye", who: sharp.id, why: `voted for a Shade ${plural(sharp.sharpVotes, "time")}` });

  // The deadliest Shade.
  const shadow = best(players.filter((p) => p.role === "shade"), (p) => p.snuffs, 1);
  if (shadow) add({ id: "shadow", title: winner === "shades" ? "Silent shadow" : "Busy shadow", who: shadow.id, why: `snuffed ${plural(shadow.snuffs, "lantern")}` });

  // Whoever rang a bell that ended with a Shade adrift.
  for (let i = 0; i < log.length; i++) {
    const e = log[i];
    if (e.kind !== "report" && e.kind !== "bell") continue;
    const verdict = log.slice(i + 1).find((x) => x.kind === "adrift" || x.kind === "spared" || x.kind === "report" || x.kind === "bell");
    if (verdict?.kind === "adrift" && verdict.wasShade && e.who && !given.has(e.who)) {
      add({ id: "bell", title: "Bell ringer", who: e.who, why: "called the meeting that caught a Shade" });
      break;
    }
  }

  // Proved themselves at the great lamp.
  const lamp = lamps.find((id) => !given.has(id)) ?? lamps[0];
  if (lamp) add({ id: "lamp", title: "Lamplighter", who: lamp, why: "lit the great lamp for all to see" });

  // A Keeper who made it to the end of a Keepers' win.
  if (winner === "keepers") {
    const survivor = players.find((p) => p.role === "keeper" && p.fate === "survived" && !given.has(p.id));
    if (survivor) add({ id: "survivor", title: "Last light", who: survivor.id, why: "kept their lantern burning all night" });
  }
  return honors;
}

/** The night, as plain facts the storyteller may use (and nothing else). */
export function taleFacts(input: { players: PlayerSummary[]; names: Record<string, string>; log: MatchEvent[]; reason: string; winner: "keepers" | "shades" }) {
  const n = (id?: string) => (id && input.names[id]) || "someone";
  const shades = input.players.filter((p) => p.role === "shade").map((p) => n(p.id));
  const keepers = input.players.filter((p) => p.role === "keeper").map((p) => n(p.id));
  const facts = [
    `The Lantern Keepers were ${keepers.join(", ")}.`,
    `The secret ${shades.length === 1 ? "Shade was" : "Shades were"} ${shades.join(" and ")}.`,
  ];
  for (const e of input.log) {
    if (e.kind === "snuff") facts.push(`${n(e.who)} snuffed ${n(e.victim)}'s lantern at ${PLACE[e.loc ?? ""] ?? "the harbor"}.`);
    if (e.kind === "report") facts.push(`${n(e.who)} found ${(e.found ?? []).map(n).join(" and ")}'s cold lantern at ${PLACE[e.loc ?? ""] ?? "the harbor"} and rang the Harbor Bell.`);
    if (e.kind === "bell") facts.push(`${n(e.who)} rang the emergency bell in the square.`);
    if (e.kind === "adrift") facts.push(`The town voted to set ${n(e.who)} adrift. ${n(e.who)} was ${e.wasShade ? "a Shade" : "an innocent Keeper"}.`);
    if (e.kind === "spared") facts.push(`The town could not agree, and nobody was set adrift.`);
  }
  facts.push(input.winner === "keepers" ? `In the end the Keepers won. ${input.reason}` : `In the end the Shades won. ${input.reason}`);
  return facts;
}

export function talePrompt(facts: string[]) {
  return {
    system:
      "You are the old storyteller of Shadow Haven, a fog-bound harbor town where Lantern Keepers tend the lights " +
      "and hidden Shades snuff them. Retell tonight's game as a short, atmospheric tale of 70 to 110 words. " +
      "Use ONLY the facts given, in order, naming the players. Past tense, simple vivid English, one paragraph, " +
      "no title, no lists, no emojis, no quotation marks. End on who won.",
    user: facts.join("\n"),
  };
}

/** The tale, written without the AI: still specific to this game. */
export function fallbackTale(input: { players: PlayerSummary[]; names: Record<string, string>; log: MatchEvent[]; winner: "keepers" | "shades" }) {
  const n = (id?: string) => (id && input.names[id]) || "someone";
  const shades = input.players.filter((p) => p.role === "shade").map((p) => n(p.id));
  const parts = [`Fog rolled over Shadow Haven, and somewhere in it ${shades.length === 1 ? "a Shade" : "two Shades"} waited.`];
  for (const e of input.log) {
    if (e.kind === "snuff") parts.push(`At ${PLACE[e.loc ?? ""] ?? "the harbor"}, ${n(e.victim)}'s lantern guttered and went cold.`);
    if (e.kind === "report") parts.push(`${n(e.who)} found it and rang the Harbor Bell.`);
    if (e.kind === "bell") parts.push(`${n(e.who)} rang the bell in the square on a hunch.`);
    if (e.kind === "adrift") parts.push(e.wasShade
      ? `The town set ${n(e.who)} adrift — and the fog thinned, for ${n(e.who)} was a Shade.`
      : `The town set ${n(e.who)} adrift, but ${n(e.who)} was only a Keeper, and the shadows smiled.`);
    if (e.kind === "spared") parts.push("Nobody could agree, and the boats stayed tied.");
  }
  parts.push(input.winner === "keepers"
    ? `By dawn every lantern that mattered was burning, and ${shades.join(" and ")} had nowhere left to hide.`
    : `By dawn the harbor was dark, and ${shades.join(" and ")} slipped away into the fog.`);
  return parts.join(" ");
}

/** Tidy what the model wrote: one paragraph, no stray quotes, sensible length. */
export function cleanTale(raw: unknown): string | null {
  const text = String((raw as any)?.response ?? raw ?? "")
    .replace(/["“”]/g, "")
    .replace(/^\s*(title|tale)\s*:.*$/gim, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length < 60 || /\b(as an ai|language model)\b/i.test(text)) return null;
  return text.length > 900 ? text.slice(0, 897).replace(/\s+\S*$/, "") + "…" : text;
}
