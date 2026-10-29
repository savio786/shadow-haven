// Shadow Haven — Worker entry point.
// Static files in public/ are served by Workers Static Assets; only /api/*
// reaches this code.
//
//   GET  /api/health              → liveness check
//   POST /api/rooms               → create a room, returns { code }
//   GET  /api/room/:code          → room info (exists? full? started?)
//   GET  /api/room/:code/ws       → WebSocket into that room

import { CODE_ALPHABET, CODE_PATTERN } from "./shared";
import type { Room } from "./room";

export { Room } from "./room";

interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  ASSETS: Fetcher;
  /** Workers AI, which gives bots their voices in meetings (optional: bots fall back without it). */
  AI?: { run(model: string, input: unknown): Promise<unknown> };
  /** Which Workers AI text model to use (defaults to Llama 3.1 8B Instruct). */
  AI_MODEL?: string;
  /** Per-address limits on creating rooms and on connecting/looking rooms up. */
  CREATE_LIMIT?: RateLimiter;
  CONNECT_LIMIT?: RateLimiter;
  /** Set to "off" to disable rate limits (local test runs only). */
  RATE_LIMITS?: string;
  /** Set to "on" to report per-room counters in room info (local performance checks only). */
  DEBUG_STATS?: string;
}

const API_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: API_HEADERS });
}

/** Is this address within its limit? Missing limiters (or limits switched off) always allow. */
async function allowed(env: Env, limiter: RateLimiter | undefined, request: Request, bucket: string) {
  if (!limiter || env.RATE_LIMITS === "off") return true;
  const ip = request.headers.get("CF-Connecting-IP") ?? "local";
  try {
    return (await limiter.limit({ key: `${bucket}:${ip}` })).success;
  } catch {
    return true; // never lock players out because the limiter itself failed
  }
}

const SLOW_DOWN = { error: "rate_limited", text: "Lots of activity from your network — wait a moment and try again." };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true, game: "Shadow Haven", step: 9 });
    }

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      if (!(await allowed(env, env.CREATE_LIMIT, request, "create"))) return json(SLOW_DOWN, 429);
      // Pick an unused code. Collisions are rare (24^4 ≈ 330k codes); retry a few times.
      for (let i = 0; i < 8; i++) {
        const code = randomCode();
        const res = await roomStub(env, code).fetch(
          new Request(`https://room/api/room/${code}/create`, { method: "POST" }),
        );
        if (res.ok) return json({ code }, 201);
      }
      return json({ error: "busy", text: "Couldn't find a free room code. Try again." }, 503);
    }

    const match = url.pathname.match(/^\/api\/room\/([^/]+)(?:\/(ws))?\/?$/);
    if (match) {
      const code = match[1].toUpperCase();
      if (!CODE_PATTERN.test(code)) {
        return json({ error: "bad_code", text: "Room codes are 4 letters." }, 400);
      }
      if (request.method !== "GET") return json({ error: "method" }, 405);
      // Guessing room codes or flooding connections is limited per address.
      if (!(await allowed(env, env.CONNECT_LIMIT, request, "room"))) return json(SLOW_DOWN, 429);
      const path = `/api/room/${code}${match[2] ? "/ws" : ""}`;
      return roomStub(env, code).fetch(new Request(new URL(path, url), request));
    }

    return json({ error: "not_found" }, 404);
  },
} satisfies ExportedHandler<Env>;

function roomStub(env: Env, code: string) {
  return env.ROOMS.get(env.ROOMS.idFromName(code));
}

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}
