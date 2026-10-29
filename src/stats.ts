// Play statistics: one anonymous line per game, kept in a single Durable
// Object with its own SQLite database. No names, no addresses — only how the
// game went — so the host can see what players enjoy and keep the game fair.
//
// Rooms send a record when a game ends (or is called off, or abandoned); the
// stats page asks for a summary over the last N days.

import { DurableObject } from "cloudflare:workers";
import type { Env } from "./worker";

export type Outcome = "keepers" | "shades" | "ended" | "abandoned";
export type Why = "tasks" | "adrift" | "dark" | "host" | "empty";

export interface GameRecord {
  id: string;            // unique per game
  at: number;            // when it ended (ms)
  outcome: Outcome;
  why: Why;
  level: string;         // bot cunning: easy | normal | cunning
  auto: boolean;         // the level was picked automatically
  players: number;
  humans: number;
  bots: number;
  shades: number;
  humanShades: number;   // how many of the Shades were people
  durationMs: number;    // time in play (after the role reveal)
  meetings: number;
  bells: number;         // emergency bells (meetings not called over a cold lantern)
  snuffs: number;
  shadesAdrift: number;  // Shades voted out
  keepersAdrift: number; // Keepers voted out by mistake
  fogs: number;
  relights: number;
  progress: number;      // share of Keeper tasks done, 0..1
  aiLines: number;       // bot lines written by the AI
  fallbackLines: number; // bot lines from the built-in fallback
}

const KEEP_DAYS = 400;
const DAY = 86_400_000;

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : null);
const mins = (ms: number) => Math.round((ms / 60_000) * 10) / 10;

export class Stats extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY, at INTEGER NOT NULL, day TEXT NOT NULL,
      outcome TEXT NOT NULL, why TEXT NOT NULL, level TEXT NOT NULL, auto INTEGER NOT NULL,
      players INTEGER NOT NULL, humans INTEGER NOT NULL, bots INTEGER NOT NULL,
      shades INTEGER NOT NULL, human_shades INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL, meetings INTEGER NOT NULL, bells INTEGER NOT NULL,
      snuffs INTEGER NOT NULL, shades_adrift INTEGER NOT NULL, keepers_adrift INTEGER NOT NULL,
      fogs INTEGER NOT NULL, relights INTEGER NOT NULL, progress REAL NOT NULL,
      ai_lines INTEGER NOT NULL, fallback_lines INTEGER NOT NULL
    )`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS games_at ON games(at)");
  }

  /** Remember one game. Recording the same game twice keeps the first. */
  async record(r: GameRecord): Promise<void> {
    const at = n(r.at) || Date.now();
    this.sql.exec(
      `INSERT OR IGNORE INTO games VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      String(r.id).slice(0, 80), at, new Date(at).toISOString().slice(0, 10),
      r.outcome, r.why, String(r.level).slice(0, 12), r.auto ? 1 : 0,
      n(r.players), n(r.humans), n(r.bots), n(r.shades), n(r.humanShades),
      Math.round(n(r.durationMs)), n(r.meetings), n(r.bells), n(r.snuffs),
      n(r.shadesAdrift), n(r.keepersAdrift), n(r.fogs), n(r.relights),
      Math.max(0, Math.min(1, n(r.progress))), n(r.aiLines), n(r.fallbackLines),
    );
    this.sql.exec("DELETE FROM games WHERE at < ?", Date.now() - KEEP_DAYS * DAY);
  }

  /** Everything the stats page shows, for the last `days` days. */
  async summary(days: number) {
    const since = Date.now() - days * DAY;
    const rows = this.sql.exec("SELECT * FROM games WHERE at >= ? ORDER BY at", since).toArray() as Record<string, number | string>[];
    const finished = rows.filter((r) => r.outcome === "keepers" || r.outcome === "shades");
    const won = (rs: typeof rows, side: string) => rs.filter((r) => r.outcome === side).length;
    const avg = (rs: typeof rows, key: string) => (rs.length ? rs.reduce((t, r) => t + Number(r[key]), 0) / rs.length : null);
    const median = (xs: number[]) => {
      if (!xs.length) return null;
      const s = [...xs].sort((a, b) => a - b);
      const m = s.length >> 1;
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
    const split = (rs: typeof rows) => ({
      games: rs.length,
      keepers: won(rs, "keepers"),
      shades: won(rs, "shades"),
      shadeWinPct: pct(won(rs, "shades"), rs.length),
      medianMinutes: rs.length ? mins(median(rs.map((r) => Number(r.duration_ms)))!) : null,
    });

    // Days, oldest first, including quiet ones (so the chart has no gaps).
    const perDay: { day: string; finished: number; other: number }[] = [];
    for (let t = Date.UTC(...ymd(Date.now() - (Math.min(days, 90) - 1) * DAY)); t <= Date.now(); t += DAY) {
      const day = new Date(t).toISOString().slice(0, 10);
      const today = rows.filter((r) => r.day === day);
      const f = today.filter((r) => r.outcome === "keepers" || r.outcome === "shades").length;
      perDay.push({ day, finished: f, other: today.length - f });
    }

    const humanShadeGames = finished.filter((r) => Number(r.human_shades) > 0);
    const humanKeeperGames = finished.filter((r) => Number(r.humans) - Number(r.human_shades) > 0);
    const aiLines = rows.reduce((t, r) => t + Number(r.ai_lines), 0);
    const fallbackLines = rows.reduce((t, r) => t + Number(r.fallback_lines), 0);
    const why = (w: string) => finished.filter((r) => r.why === w).length;

    return {
      days,
      generatedAt: Date.now(),
      totals: {
        started: rows.length,
        finished: finished.length,
        calledOff: rows.filter((r) => r.outcome === "ended").length,
        abandoned: rows.filter((r) => r.outcome === "abandoned").length,
        finishPct: pct(finished.length, rows.length),
        people: rows.reduce((t, r) => t + Number(r.humans), 0),
        ...split(finished),
        avgPlayers: avg(finished, "players"),
        avgSnuffs: avg(finished, "snuffs"),
        avgMeetings: avg(finished, "meetings"),
        avgProgressPct: finished.length ? Math.round(avg(finished, "progress")! * 100) : null,
        fogPct: pct(finished.filter((r) => Number(r.fogs) > 0).length, finished.length),
        wrongVotePct: pct(finished.filter((r) => Number(r.keepers_adrift) > 0).length, finished.length),
      },
      endings: { tasks: why("tasks"), adrift: why("adrift"), dark: why("dark") },
      byLevel: ["easy", "normal", "cunning"].map((level) => ({ level, ...split(finished.filter((r) => r.level === level)) })),
      byPlayers: [4, 5, 6, 7, 8, 9, 10]
        .map((players) => ({ players, ...split(finished.filter((r) => Number(r.players) === players)) }))
        .filter((b) => b.games > 0),
      people: {
        asShade: { games: humanShadeGames.length, won: won(humanShadeGames, "shades"), winPct: pct(won(humanShadeGames, "shades"), humanShadeGames.length) },
        asKeeper: { games: humanKeeperGames.length, won: won(humanKeeperGames, "keepers"), winPct: pct(won(humanKeeperGames, "keepers"), humanKeeperGames.length) },
        withFriends: finished.filter((r) => Number(r.humans) > 1).length,
        solo: finished.filter((r) => Number(r.humans) === 1).length,
      },
      ai: { lines: aiLines, fallback: fallbackLines, aiPct: pct(aiLines, aiLines + fallbackLines) },
      perDay,
      recent: rows.slice(-12).reverse().map((r) => ({
        at: Number(r.at), outcome: r.outcome, why: r.why, level: r.level, players: Number(r.players),
        humans: Number(r.humans), minutes: mins(Number(r.duration_ms)), snuffs: Number(r.snuffs), meetings: Number(r.meetings),
      })),
    };
  }
}

function ymd(t: number): [number, number, number] {
  const d = new Date(t);
  return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()];
}

export type StatsSummary = Awaited<ReturnType<Stats["summary"]>>;
