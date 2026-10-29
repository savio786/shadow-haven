# Shadow Haven

A multiplayer social-deduction game set in a fog-bound harbor town. The **Lantern Keepers** keep the town's lights burning through the night — but one or two of them are secretly **Shades** who want the harbor to go dark.

All names, characters and art in this project are original.

Live at **https://game2.sedigitaltransformation.com**

## Tech

- **Cloudflare Workers** serves the frontend (`public/`, via Workers Static Assets) and the API (`/api/*`).
- **Durable Objects** — one `Room` instance per game, addressed by its 4-letter room code.
- **TypeScript**, deployed with **Wrangler** from **GitHub Actions**.

```
public/          static frontend (HTML, CSS, SVG art)
src/worker.ts    entry point: /api/health, POST /api/rooms, /api/room/:code[/ws]
src/room.ts      the Room Durable Object (one per game): lobby, players, bots
src/shared.ts    constants and message types shared by server and client
public/app.js    browser client (home + lobby)
public/lanterns.js  original Lantern Keeper SVG art
test/            end-to-end tests (lobby, roles)
wrangler.jsonc   Worker, Durable Object, assets and custom-domain config
```

## Local development

```bash
npm install
npm run dev        # http://localhost:8787
npm run check      # typecheck + dry-run build
npm test           # end-to-end tests (needs `npm run dev` running in another terminal)
```

## Bots

The host can add bot Keepers to fill seats, so a full game can be tested with
one person. Bots run on the server inside the room's Durable Object, so they
can't be seen through or cheated with from the browser. In later steps they
move around the harbor, do tasks, play as a Shade, and talk and vote in meetings.

## Deploying

Pushing to `main` deploys automatically. The workflow needs two repository secrets
(GitHub → Settings → Secrets and variables → Actions):

| Secret | Where to find it |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages → Account ID in the sidebar |
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → Create Token → **Edit Cloudflare Workers** template, scoped to your account and the `sedigitaltransformation.com` zone |

You can also deploy by hand with `npx wrangler login` then `npm run deploy`.

On the first deploy, Cloudflare creates the DNS record and certificate for
`game2.sedigitaltransformation.com` automatically. It must not already have a DNS
record pointing somewhere else.

## Roadmap

0. ~~Skeleton: hello page live on the custom domain, auto-deployed~~
1. ~~Rooms and lobby: create/join by code, invite links, live player list, bots~~
2. ~~Secret roles: fair Shade picking, private reveal, Shade partners, rejoin keeps your role~~
3. Harbor map: move between locations
4. Tasks and the shared progress lantern
5. Snuffing, cold lanterns and reporting
6. Meetings: Harbor Bell, chat, voting, setting adrift
7. Win conditions and play again
8. Art pass
9. Reconnects, host handover, rate limits, tests
