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
src/harbor.ts    the harbor's locations and paths, route finding
src/bots.ts      bot brains: personalities, memory, decisions
src/tasks.ts     task definitions, challenges and answer checking
src/minds.ts     how bots think in meetings: knowledge, prompts, fallback lines, votes
src/ai.ts        Workers AI voices and the tale, with timeouts and fallback
src/chronicle.ts end of the night: honors, the facts of the match, the tale
public/app.js    browser client (home + lobby)
public/lanterns.js  original Lantern Keeper SVG art
public/harbor.js original harbor map art
public/tasks.js  the six task mini-games
public/lanterns.js  also: cold lanterns, wisps, the Harbor Bell, the drifting boat
public/sound.js  synthesized sounds (Web Audio) and phone haptics, with mute
test/            unit tests (bot brains, bot minds, chronicle) + end-to-end tests (lobby, roles, harbor, tasks, snuff, meetings, end)
wrangler.jsonc   Worker, Durable Object, assets and custom-domain config
```

## Local development

```bash
npm install
npm run dev        # http://localhost:8787 (needs `npx wrangler login` for the AI)
npm run dev:local  # fully offline; bots use their fallback lines
npm run check      # typecheck + dry-run build
npm test           # end-to-end tests (needs `npm run dev` running in another terminal)
```

## Bots

The host can add bot Keepers to fill seats, so a full game can be tested with
one person. Bots run on the server inside the room's Durable Object, so they
can't be seen through or cheated with from the browser.

Bots play fair: they only see who is in the same place as them, exactly like a
human. Each bot has a personality (wanderer, homebody, social, watcher) and a
memory of who it saw, where and when. Shade bots use that memory to hunt
Keepers they last saw alone. In meetings (step 6) the same memory will feed a
Workers AI language model so bots can argue, accuse and lie, with a rule-based
fallback if the daily AI allowance runs out.

## Tasks

Every player gets four tasks in four different places, each a short mini-game:

| Place | Task | Mini-game |
|---|---|---|
| Lighthouse | Light the great lamp | catch the spark on the wick, 3 times |
| Chapel | Light the candles | watch the order, repeat it |
| Market Square | Sort the signal flags | pick the matching flag |
| Net Loft | Mend the net | tie the knots 1 to 6 |
| Dock | Haul in the rope | pull, pull, pull |
| Clock Tower | Wind the clock | hold the crank until it's wound |

The server issues every attempt as a challenge and checks that you're in the
right place, the answer is right, and you didn't finish faster than a person
could. Shades get fake tasks that look identical but add nothing.

Lighting the great lamp is **witnessed**: everyone at the Lighthouse sees the
beam sweep the bay. Only a Keeper's lamp lights, so it's real evidence. Bots
remember who they saw do it.

When every Keeper task is done, the Keepers win.

## Snuffing, wisps and the Harbor Bell

A Shade can snuff the lantern of a Keeper in the same place (not in the first
15 seconds, then once every 25 seconds). Anyone else alive there sees it happen.
The snuffed Keeper becomes a **wisp**: the living can't see them, but their
tasks still light the harbor.

A snuffed lantern lies **cold** where it fell. Anyone alive who finds one can
ring the **Harbor Bell**: everyone gathers in the square, learns whose lanterns
were found and who has been snuffed, and the cold lanterns are cleared away.
If the Shades ever match the living Keepers in number, the Shades win.

Bots keep an **evidence log**: who they saw snuff someone, who they remember
near a cold lantern, and who they watched light the lamp. Shade bots strike
only when they catch a Keeper alone; Keeper bots always ring the bell.

## Meetings and AI bots

Reporting a cold lantern — or ringing the **emergency bell** in the Market
Square (once per player per game) — calls a meeting:

1. **Gather** (6s): everyone learns what was found and who has been snuffed.
2. **Discuss** (45s, or sooner if every living player is ready): chat, with
   one-tap quick lines built from what *you* actually saw this game.
3. **Vote** (25s, or sooner once everyone has voted): pick someone or skip.
   You can see who has voted, but not for whom, until the verdict.
4. **Verdict** (8s): votes are revealed and the chosen player's lantern
   drifts out to sea. Everyone learns whether they were a Shade. A tie, or
   no more votes than skips, sets nobody adrift.

Keepers win by setting every Shade adrift (or lighting every lantern);
Shades win when they match the living Keepers.

**Bots talk with Workers AI.** Each bot's line is generated by
`@cf/meta/llama-3.1-8b-instruct` (change it with an `AI_MODEL` variable) from
its personality, its evidence log and memory turned into plain sentences, and
the chat so far. Keeper bots share what they really saw; Shade bots lie and
deflect, and never accuse their partner. Name a bot in chat and it answers.
The model also returns who the bot suspects, which feeds its vote together
with hard evidence and what the room is saying — so a bot that saw a snuff
always votes for the culprit, and never votes out someone it saw light the lamp.

If the model is slow (over 7s), errors, or the daily free allowance is used
up, bots switch to evidence-based lines for a minute and the game carries on.

## The end of the night

When a side wins, everyone gets an end screen with:

- **The result**, with original art (the harbor at dawn, or gone dark) and a
  personal line: whether *you* won, and as what.
- **Who was who**: every player's role and fate (survived, snuffed and where,
  set adrift), with tasks done.
- **Honors** worked out from what actually happened: Brightest lantern, Sharp
  eye, Silent shadow, Bell ringer, Lamplighter, Last light.
- **The tale**: a short story of the match written by Workers AI from the real
  events (with a written fallback), typed out like a storybook, a timeline,
  and a **Share** button (the phone's share sheet, or copy to clipboard).
- **Your record** on this device: games, wins and win streak.
- **Play again** (host): same players, fresh roles, straight back in — anyone
  who left is let go. **Lobby** to change seats or bots.

The home screen welcomes returning players by name, shows their record, and
offers a way back into a game in progress.

## Fog, cunning and ranks

- **The fog.** A Shade can call a cold fog (not in the first 30s of play or
  after a meeting; then it rests 60s). For up to 30s, living Keepers see only
  *shapes* — no names, and a snuff in the fog doesn't show who did it. Anyone
  alive can lift it by relighting the great lamp at the Lighthouse (a Shade
  doing so looks very innocent). The bell cuts through the fog.
- **Bot cunning.** The host picks Easy, Normal or Cunning. Cunning Shade bots
  strike faster, call the fog and frame Keepers with confident AI-written
  lies; cunning Keeper bots rush to relight the lamp and catch contradictions.
  **Auto** picks the level from the host's record so games stay close.
- **XP and ranks.** Each game earns XP (playing, winning, tasks, sharp votes,
  snuffs, honors) toward six ranks, Deckhand to Lighthouse Legend, with a
  rank-up moment; the home screen shows your rank and a daily streak.
- **Art.** An illustrated harbor (buildings with lit windows, moon, waves,
  drifting fog, everyone you can see gathered around you), Fraunces and Inter
  type, and a softly drifting fog behind every screen.

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
3. ~~Harbor map: six locations, fog (you only see who's with you), smart bots that roam and hunt~~
4. ~~Tasks: six mini-games, server-checked, witnessed lamp, fake tasks for Shades, bots that work, Keepers' task win~~
5. ~~Snuffing, wisps, cold lanterns, the Harbor Bell, Shades' win, bot evidence, How to play~~
6. ~~Meetings: emergency bell, chat with smart quick lines, voting, verdict, AI-voiced bots that answer and vote on evidence, sound~~
7. ~~End of the night: who was who, honors, AI-written tale and timeline, share, personal record, play again, welcome back~~
8. ~~Art pass, the fog, bot cunning (with Auto), XP, ranks and daily streaks~~
9. Reconnects, host handover, rate limits, tests
