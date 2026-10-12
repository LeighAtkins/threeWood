# ThreeWood at 10,000 players: accounts, servers, costs, pricing, marketing

Written October 2026. Prices are from the providers' public pages at that date
(sources at the end) and will drift. Figures are estimates, marked as such.

## Where we are

- The game is static files on Vercel. There is no backend: saves, outfits and
  the camper live in the phone's localStorage.
- Rooms are peer-to-peer (PeerJS over WebRTC). The host's phone is the hub:
  it relays every message, decides GO and NEXT, and now runs the bots. The
  public PeerJS broker only introduces phones to each other.
- **Done in this step:** rooms of eight, with bots (Easy / Par / Pro) that
  the host seats from the lobby. One person can play a full group tonight.

What breaks first as players arrive, in order:

1. **The public PeerJS broker.** It is a free, best-effort service with no
   uptime promise. At a few hundred concurrent rooms it will be the thing that
   fails, and we cannot fix it.
2. **Host-as-hub.** The round dies when the host's phone sleeps, loses signal
   or gets a call. Phones behind strict NATs (some mobile carriers) cannot
   connect peer-to-peer at all; today they simply fail to join.
3. **No accounts.** Progress is on one phone; a new phone starts from zero.
   No leaderboards, no friends list, nothing to come back to.

## Architecture for 10,000 players

Three small pieces, each a managed service, none of them a server we have to
keep awake ourselves.

```
phone (PWA, static)  ──►  Cloudflare Pages          static files, free bandwidth
                     ──►  Supabase Auth + Postgres   accounts, saves, leaderboards
                     ──►  Cloudflare Durable Objects one object per room, WebSockets
```

### 1. Accounts: Supabase Auth

- Sign-in with Apple, Google, and a magic link by email. No passwords.
- The free tier covers 50,000 monthly active users; Pro ($25/month) is worth
  it from day one because free projects pause after a week idle.
- What we store per player: the camper look, outfits unlocked, stats, best
  rounds, daily results, friends. One row each; a few KB per player.
- Guest play stays: you can play without an account, exactly as now. An
  account is offered after the first finished round ("keep your camper").

### 2. Rooms: Cloudflare Durable Objects

- One object per room code, reached by WebSocket at `/room/ABCD`. It holds
  the roster, stamps every message with who sent it, and relays. This is
  precisely what the host's phone does today, so **the client swap is small:
  a `Room` class that opens one WebSocket instead of a PeerJS mesh.** The
  server skeleton is in `server/room.js` (not deployed).
- The object hibernates between messages, so an idle room costs nothing.
  Incoming WebSocket messages bill at 20:1 and outgoing are free.
- The room outlives the host: if the host drops, the next person in becomes
  host. Later, bots move into the object too, so a round with bots never
  stops.
- Phones behind strict NATs work, because it is a plain WebSocket.

### 3. Static hosting: Cloudflare Pages

Vercel Hobby is non-commercial and capped at 100 GB/month; Pro is $20/user.
Cloudflare Pages is free with no bandwidth cap, and we are on Cloudflare for
the rooms anyway. Moving is a build setting.

### Traffic estimate at 10,000 players (assumptions stated)

- 10,000 registered, ~30% play on a given day: 3,000 daily players.
- One round each, half of them in rooms, average 4 to a room: ~375 rooms/day.
- A round is ~70 shots per player; each shot is ~5 messages (at, ready,
  swing, shot, done): 8 × 70 × 5 = 2,800 incoming messages per full room,
  billed 20:1 = 140 requests. 375 rooms × 140 × 30 days ≈ **1.6M requests a
  month.**
- First load is ~5 MB (game + sounds); the service worker caches it, so
  updates are the only repeat cost. ~10,000 × 5 MB + updates ≈ **100 GB/month.**

## Monthly cost

| | 10,000 players | 100,000 players |
|---|---|---|
| Cloudflare Workers paid plan (rooms) | $5 + ~$0.10 overage | ~$8 |
| Supabase Pro (auth, database) | $25 | $25 + MAU overage ≈ $190 |
| Cloudflare Pages (static) | $0 | $0 |
| Domain, email sending (Resend free tier) | ~$2 | ~$20 |
| **Total** | **≈ $32/month** | **≈ $240/month** |

A one-person studio's time is the real cost; the infrastructure is cheap
because the game runs on the phone and the server only passes notes.

## Pricing: free tier first

The free game must stay a whole game. People came for the mushrooms, the
fishing and the dog; paywalling the golf would kill the word of mouth that
makes the business work.

**Free, for ever**
- All 18 holes, every world, the daily course, bots in rooms, fishing,
  grilling, Kuri, the hot pot.
- Rooms of up to 4 people.
- One camper, the base outfits earned in play.

**Camp Pass: $3.99/month or $24.99/year** (sold on the web, through Stripe)
- Rooms of 8 with friends, and private weekly leagues with a leaderboard.
- Cloud save across phones (the account), round history and stats.
- The outfit wardrobe: every outfit in the game plus a monthly new one, extra
  hairstyles, Kuri's collars and bandanas, camp photo frames.
- Name reservation and a badge in rooms.

**One-off: Supporter pack, $4.99** (for people who hate subscriptions)
- A golden tee, one outfit, a Kuri collar. Pure thank-you cosmetics.

Why these prices: cosmetics in a cozy game sell on affection, not need, and
small monthly amounts convert far better than $10+. Selling on the web (the
game is a PWA) keeps Stripe's 2.9% + $0.30 instead of the app stores'
15–30%; if we later ship store builds, their 15% small-business rate applies
to purchases made in those builds only.

### Does it pay?

Assumptions: 3% of registered players take the Pass (cozy mobile games
convert 2–5%), half of them yearly.

| | 10,000 players | 100,000 players |
|---|---|---|
| Pass subscribers (3%) | 300 | 3,000 |
| Monthly revenue (blend ≈ $3.00/sub after annual discount) | ~$900 | ~$9,000 |
| Supporter packs (1%/month of free players, $4.99) | ~$480 | ~$4,800 |
| Stripe fees (~4%) | −$55 | −$550 |
| Infrastructure | −$32 | −$240 |
| **Margin** | **≈ $1,300/month** | **≈ $13,000/month** |

So the business is profitable from the first thousand paying players; what it
needs is players, not servers. Everything below is about that.

## Marketing

The hook is specific: **cozy camping golf with a dog**. Lead with that, never
with "procedural golf game".

1. **Clips, not ads.** Fifteen-second vertical clips of the parts people
   already love: a drive through the sky rings, Kuri catching the stick, the
   hot pot at night, a hole-in-one into the bucket. TikTok, Shorts, Reels,
   three a week. The game records 540×960 clips itself (`scripts/dev`);
   production cost is near zero.
2. **The daily course is the retention loop.** One shared course a day,
   a leaderboard (needs accounts), and a "CHALLENGE A FRIEND" link that
   opens the same course. Add a one-tap share of the result card as an
   image with the link in it.
3. **Rooms are the growth loop.** A room link opens the game in a browser
   with no install; the person who was invited is a player before they
   decide anything. Reward it: finish a round with someone who joined by
   your link and you both unlock an outfit (the code already counts "play a
   hole with a friend").
4. **Communities that match the vibe:** r/CozyGamers, r/WebGames,
   r/golf's casual threads, the Yuru Camp fandom, cozy-game Discords.
   Post the game, not a pitch; answer every comment for the first month.
5. **Launch beats:** itch.io page (its cozy audience is exactly ours),
   Product Hunt, Hacker News "Show HN" (a Three.js game that runs in the
   browser is their kind of thing), and the Three.js forum showcase.
6. **Install prompt.** After the second finished round, offer "add to home
   screen". A PWA on the home screen is retained like an app, and the
   service worker already makes it work offline.
7. **Monthly content:** one new world, toy or minigame a month, announced
   with a clip. The Pass's monthly outfit ships the same day, so there is
   always a reason to come back and a reason to subscribe.

Targets to decide the next round of investment: day-7 retention above 20%,
and 3% Pass conversion among players with an account. If retention is there
and conversion is not, the pricing is wrong; if retention is not there, no
pricing fixes it.

## Order of work

1. ✅ Rooms of eight with bots (shipped).
2. Room server: deploy `server/room.js`, add a WebSocket `Room` client,
   keep PeerJS as a fallback for a release, then remove it. ~1 week.
3. Accounts: Supabase Auth, sync the camper and stats, leaderboards for the
   daily course. ~1–2 weeks.
4. Move static hosting to Cloudflare Pages. ~1 day.
5. Camp Pass: Stripe Checkout + webhook that flags the account; the client
   reads the flag. ~1 week.
6. Bots into the room object, so rounds survive the host leaving. ~1 week.

## Sources

- Cloudflare Durable Objects pricing: https://developers.cloudflare.com/durable-objects/platform/pricing
- Supabase pricing (free tier 50k MAU, Pro $25, overages): https://makerkit.dev/blog/saas/supabase-pricing
- Vercel plans and bandwidth: https://makerkit.dev/blog/saas/vercel-cost
- Fly.io machine pricing (considered, not chosen): https://costbench.com/software/developer-tools/flyio
- Stripe fees and App Store Small Business Program: https://ecomcalctools.com/blog/stripe-fees-2026/ and https://techcrunch.com/2020/11/18/apple-to-reduce-app-store-fees-for-small-businesses-with-under-1-million-in-revenues
