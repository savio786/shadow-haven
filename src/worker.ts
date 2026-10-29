// Shadow Haven — Worker entry point.
// Static files in public/ are served by Workers Static Assets before this runs;
// only /api/* reaches this code.

export { Room } from "./room";

export interface Env {
  ROOMS: DurableObjectNamespace<import("./room").Room>;
  ASSETS: Fetcher;
}

const ROOM_CODE = /^[A-Z]{4}$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, game: "Shadow Haven", step: 0 });
    }

    // /api/room/ABCD/... → forwarded to that room's Durable Object.
    const match = url.pathname.match(/^\/api\/room\/([^/]+)(\/.*)?$/);
    if (match) {
      const code = match[1].toUpperCase();
      if (!ROOM_CODE.test(code)) {
        return Response.json({ error: "Room codes are 4 letters." }, { status: 400 });
      }
      const room = env.ROOMS.get(env.ROOMS.idFromName(code));
      return room.fetch(request);
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
