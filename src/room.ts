// One Durable Object instance = one game room.
// Step 0: a stub that proves routing and storage work.
// Step 1 will add WebSockets (Hibernation API) and the lobby.

import { DurableObject } from "cloudflare:workers";
import type { Env } from "./worker";

export class Room extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const code = url.pathname.split("/")[3]?.toUpperCase();

    // Counts how many times this room has been pinged, persisted in DO storage,
    // so we can confirm the same room instance is reached each time.
    const pings = ((await this.ctx.storage.get<number>("pings")) ?? 0) + 1;
    await this.ctx.storage.put("pings", pings);

    return Response.json({ room: code, pings });
  }
}
