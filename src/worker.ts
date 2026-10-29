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

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, game: "Shadow Haven", step: 4 });
    }

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      // Pick an unused code. Collisions are rare (24^4 ≈ 330k codes); retry a few times.
      for (let i = 0; i < 8; i++) {
        const code = randomCode();
        const res = await roomStub(env, code).fetch(
          new Request(`https://room/api/room/${code}/create`, { method: "POST" }),
        );
        if (res.ok) return Response.json({ code }, { status: 201 });
      }
      return Response.json({ error: "busy", text: "Couldn't find a free room code. Try again." }, { status: 503 });
    }

    const match = url.pathname.match(/^\/api\/room\/([^/]+)(?:\/(ws))?\/?$/);
    if (match) {
      const code = match[1].toUpperCase();
      if (!CODE_PATTERN.test(code)) {
        return Response.json({ error: "bad_code", text: "Room codes are 4 letters." }, { status: 400 });
      }
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
      const path = `/api/room/${code}${match[2] ? "/ws" : ""}`;
      return roomStub(env, code).fetch(new Request(new URL(path, url), request));
    }

    return Response.json({ error: "not_found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;

function roomStub(env: Env, code: string) {
  return env.ROOMS.get(env.ROOMS.idFromName(code));
}

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}
