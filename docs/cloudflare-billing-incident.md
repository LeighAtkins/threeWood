# Cloudflare room billing incident — 2026-11-07

Affected Worker: `threewood-rooms`, Durable Object class `RoomObject`, namespace `4e52c2a9cb33472b97dcff9d1f287913`.

## Cause

The deployed source was retrieved from Cloudflare before containment. Empty-room cleanup set `emptySince` only in memory, then scheduled a wake-up in 60 seconds. Hibernation/eviction discarded that timestamp; the next constructor restored the room but not its cleanup deadline. The next alarm could restart the countdown indefinitely. Bot ticks also ran without connected humans and rooms had no absolute lifetime. The dashboard's steady requests/storage pattern is consistent with that loop. Invoice line-item attribution has not been independently retrieved.

## Containment and safeguards

Multiplayer is disabled in production. `ROOMS_ENABLED` must explicitly equal `true` to run; missing configuration fails closed. The outer Worker returns 503 before accessing the namespace. Existing object constructors, alarms and messages cancel alarms and close sockets. Close/error events cannot rearm disabled rooms. Solo gameplay is hosted separately.

Cleanup timestamps now persist in storage. Every room has a hard two-hour lifetime, checked before bot work, messages and upgrades. Destruction explicitly cancels alarms before clearing storage (required with the current compatibility date). Bots cannot tick without an attached human socket. CPU limit: 50 ms per invocation. This CPU setting is not a dollar spending cap and may require tuning before multiplayer is restored.

Regression coverage: `node --test tests/room-billing.test.js`.

## Re-enable policy

Keep `ROOMS_ENABLED = "false"` in `server/wrangler.toml` until a separate change adds and validates admission/rate controls and a usage budget shutdown mechanism. Do not turn it on merely to test the public deployment. Validate room cleanup through actual Cloudflare hibernation in a staging namespace first. Billing notifications are alerts, not a hard spending cap. These controls apply to this Worker; they do not cap spending for the whole Cloudflare account or arbitrary future deployments.

The original deployed bundle, settings and sampled metrics were saved locally in `/tmp/threewood-incident` for investigation. They contain no credentials. Preserve elsewhere if long-term evidence is needed.

## Follow-up audit (2026-11-07, approximately 11:40 UTC)

User confirmed the 10k page-view notification was from Cloudflare. Queried the authenticated GraphQL API for the entire deployed period, October 12 through November 7 (last day partial). These are analytics aggregates, some adaptively sampled, not exact invoice line items or unique human counts. Daily export: `docs/cloudflare-usage.csv`.

| Metric | Reported total |
| --- | ---: |
| threewood.app zone page views, all hostnames | 18,158 |
| Zone HTTP requests | 29,794 |
| Outer threewood-rooms Worker requests | 4,883 |
| Room alarm invocations | 86,032,282 |
| Room HTTP invocations | 130 |
| Room hibernation events | 13,904 |
| Room invocation errors (all statuses) | 381,196 |
| Room SQLite rows written | 67,695,359 |
| Room SQLite rows read | 14,453,307 |
| Room billed-duration metric | 1,140,087.76 GB-seconds |

Alarm invocations account for about 99.984% of room events. November 6 alone had 3,433,622 alarm invocations and only 9 outer Worker requests. Periodic metrics show zero maximum active WebSocket connections on every day from October 16 onward, despite roughly 3.4 million alarms daily. The 102 objects returned for November 6 onward generated only alarm events in that interval. This strongly attributes the sustained work to autonomous stale rooms rather than ongoing player traffic.

A second eviction bug was identified: `away()` saved a player's away timestamp before `lostAt` was assigned, but the removal condition used transient `lostAt`. Eviction could reset that removal countdown too. It now uses the persisted `away` deadline. Six targeted billing regression tests pass. The updated version was deployed with multiplayer still disabled: `f9835278-69d0-47fc-801c-40e062763191`.

Recent zone HTTP aggregates show probes for `/wp-admin/install.php`, `/wp-login.php`, assorted unrelated favicon paths, and a self-identifying Palo Alto scanner. Some nonexistent paths received 200, consistent with a fallback response; this is not evidence those applications exist or were compromised. Scanner traffic contributes to the zone traffic figures; the percentage of human page views cannot be determined from these aggregates. No evidence from this audit establishes a room endpoint flood as the sustained billing cause.

The original Worker settings did not show observability enabled and had logpush disabled. The historical Workers Observability endpoint returned HTTP 403 (`no_access_to_workers_observability`) with the available credential. Thus request-level historical logs, exception messages, and stacks were not available in this investigation. GraphQL still exposed event types, outcomes, dates, object IDs, storage work, and duration. Of the November 6 alarm errors, 14,669 were classified clientDisconnected and 2 scriptThrewException; do not interpret all errors as thrown exceptions or infer their exact cause without traces.

A follow-up namespace query for events since 11:34 UTC (19:34 Singapore) returned no rows. Analytics reporting can lag; this is a point-in-time confirmation, not ongoing monitoring. Both public room endpoints were verified returning the disabled 503 response in the initial containment.

The page-view milestone and room bill are distinct. A 10k page-view alert is not a 10k-player count or a Durable Object usage cap. The recorded alarm invocations, storage writes, and duration explain substantial chargeable work, but no invoice or billing-cycle reconciliation was performed.

## Parked deployment (2026-11-07)

To minimize future exposure while the game is inactive, disabled `workers_dev` and `preview_urls`, and set `routes = []` in Wrangler. Deployed version `053a538f-d14c-46ea-95c9-e4e890920c22`. Wrangler did not remove the existing custom domain automatically, so explicitly removed only the `rooms.threewood.app` Worker domain through the Cloudflare API. Verified the account Worker-domain list is empty and the script subdomain reports both enabled and previews_enabled false. The workers.dev URL now returns 404; the former custom-domain URL returned a Cloudflare 522 after detachment, rather than executing the Worker. DNS/error propagation may vary. The main website's routing was not modified.

Existing room records were retained; disabled code cancels alarms but does not purge data. Retained Durable Object data can still incur storage charges beyond the account's included storage allocation. No stored-byte metric was returned, so its exact size/cost is unverified. This is not an account-wide spend cap: other Workers and products share the account and remain outside this containment. The paid Workers subscription, if active, remains an account-level charge. Do not downgrade the account without checking the other deployed applications.

Correction after checking the live Cloudflare Pages API: the frontend is hosted on Cloudflare Pages project `threewood` (`threewood.pages.dev`), with `threewood.app` and `www.threewood.app` attached. Its canonical production deployment is `9c747e61-8d97-4929-86c8-fcb47479c46c`, created October 15, and reports `uses_functions: false`. Static Pages asset requests are free and unlimited. The earlier Vercel hosting claim was based on legacy repository configuration and was incorrect for current production. No Vercel account billing settings were verified or changed; any legacy subscription is a separate, unverified exposure. Domain registration renewals and already-accrued usage remain payable.

## Invoice reconciliation and account audit (2026-11-07)

User supplied invoice IN-87619432, total USD 89.21, issued November 7. Usage period October 7–November 6; base subscription November 7–December 6. All seven PDF pages were extracted and checked. Only these six lines are nonzero:

| Invoice line | USD |
| --- | ---: |
| Durable Objects storage rows written | 17.00 |
| Durable Objects compute duration | 12.50 |
| Durable Objects compute requests | 12.60 |
| Workers AI regular neurons | 42.05 |
| Workers Paid subscription | 5.00 |
| R2 data storage | 0.06 |
| Total | 89.21 |

The Durable Object subtotal is USD 42.10, not the full USD 89.21. Other metered invoice lines are USD 0.00, including ordinary Worker requests/CPU, KV, D1, Images transformations/delivery, containers, queues, and logs. Enabled product lines with a zero-dollar amount are not extra paid subscriptions on this invoice. Metered quantities and charges use billing rounding and do not exactly match sampled GraphQL aggregates.

Workers AI history identifies 443 Flux 2 Dev REST API calls and about 4.127 million neurons during the invoice period; voice-model usage is negligible by comparison. The latest reported AI calls are November 4 at 04:00 UTC. User explicitly confirmed this image generation was intentional. No AI services or credentials were disabled. The REST source does not identify the originating application or credential, so exact client attribution remains unknown.

Inventory: 11 Worker scripts, 3 Durable Object namespaces, 5 R2 buckets, 2 KV namespaces, no D1 databases, and no queues. The other Durable Objects are the SofaPaint budget trackers; their recorded activity is negligible compared with RoomObject. No comparable second alarm loop was found. Active cron schedules: promote-feedback daily at 02:00 UTC and sofapaint-mcp hourly. sofapaint-auto and threewood-rooms have no cron schedules. These unrelated applications were left intact. Some Workers have no explicit CPU limit override; default platform limits still apply, and absence of an override alone is not evidence of runaway usage.

A final GraphQL check returned no room invocations after 11:34 UTC November 7, and no AI inference rows since November 5. Analytics can lag and this is not continuous monitoring. Existing stored room data was retained; invoice SQL storage charge is USD 0.00. R2 has USD 0.06 of storage overage, so destructive bucket deletion is not warranted for this incident. Workers Paid base fee remains shared across other applications. Account subscription/billing-profile API calls returned 403; the supplied invoice is the billing evidence and does not establish that no separate invoices or subscriptions exist elsewhere.

## Owner-authorized retirement and follow-up (2026-11-07, 12:18–12:26 UTC)

The owner explicitly chose: “Retire backend and delete room data (lowest cost).” Deployed migration `v2-retire-rooms` with `deleted_classes = ["RoomObject"]`, no Durable Object binding and no RoomObject class shipped by the production entrypoint. Cloudflare's namespace list now contains only the two SofaPaint UsageBudget namespaces. ThreeWood's old namespace and all room data are deleted. Worker version `4a0efff6-3042-4b48-80d7-e9e065dcc18d` exports a stateless 410 retirement response, has no bindings, no public routes and no cron. Reference room source/tests remain in the repository but are not bundled into production. Do not redeploy the old configuration or reintroduce a new class/binding without a separate architecture review.

This resolves the screenshot's room admission, room-budget and lifecycle monitoring items by removing their workload entirely. The old deadline fixes remain unit tested; live Cloudflare eviction validation is no longer needed for a deleted service, but remains a prerequisite for any future rewrite. There is no new metered collector or room budget object.

The browser defaults to solo-only: the friends button is absent and host/join/connect paths fail locally when multiplayer is disabled. All 37 tests passed and the frontend build passed. Pages remains static (`uses_functions: false`). First solo-only deployment: `f29e524f-509c-486b-bfbe-7004cefe709d`; subsequent static crawler-policy/404 deployment: `b43bfc8b.threewood.pages.dev`.

Engagement signals are GETs to three static files: `/play-events/round-started.txt`, `/play-events/hole-completed.txt`, `/play-events/round-completed.txt`. No IDs, scores, seeds, cookies, custom query values, collector Worker or database are sent/created. Respect DNT and Global Privacy Control; skip offline users; deduplicate by round/event/hole within the page; cap at 120 signals per page. The service worker never caches or replays these paths. The query helper is `scripts/security/report_engagement.py`. After an initial API rate-budget failure and cooldown, its GraphQL query succeeded and reported the known deployment-check hit. These counts are approximate signals, not unique players or verified humans; offline/opt-out users are missed, scrapers can spoof the paths, and HEAD/GET health checks may appear. They cannot retroactively establish historic gameplay.

Added a top-level static `404.html` so Pages no longer serves the entire game to arbitrary nonexistent paths. Verified live: `/` and `/?seed=TEST` return 200; `/wp-admin/install.php`, `/wp-login.php`, `/.git/config`, and `/.env` return 404. Published `robots.txt` disallowing GPTBot, ClaudeBot, CCBot and Google-Extended, while allowing ordinary indexing and excluding engagement/scanner paths. This is a cooperative policy, not an enforced crawler ban.

**Still pending authenticated access:** an enforced targeted WAF scanner rule and `ai_bots_protection=block` setting are fully prepared in `scripts/security/cloudflare-restrictions.json`, with an idempotent preserving apply/readback script. Existing Wrangler OAuth credentials return HTTP 403 on WAF, Bot Management and notification/billing APIs. A shared dashboard tab was attempted at the user's request to use the logged-in session; it redirects to login and remains on Cloudflare security verification. User was asked to sign in; no token was received and no security/billing mutation was claimed as successful.

Current Cloudflare API documentation exposes `/accounts/{account}/billing/spend-policies` for per-product `workers` or `durable_objects` notification/usage-block policies. The properly spelled endpoint also returned 403. Availability, thresholds and enforcement state in this account remain unverified. This is not a universal hard cap across Workers AI, R2 and every product; balances/enforcement are asynchronous. No account-wide cap, product cap or billing alert has been configured by this follow-up, and other apps were not shut off. The account-wide-cap row must remain explicitly unresolved until authenticated access and the intended shared-account budget are established.

For manual no-token setup in an already signed-in browser: select `threewood.app` → Security → Security rules → create a custom rule. Use the exact expression and Block action from `scripts/security/cloudflare-restrictions.json`. Under Security settings, set AI crawler blocking to block recognized AI crawlers; avoid switching on broad Bot Fight Mode accidentally. Billing → Billable Usage → Budget alerts can configure a separate account-wide informational alert. A budget alert is not an enforced cap. Do not change shared-product spending cutoffs without reviewing how they affect SofaPaint and intentional AI work.

## Approved edge security controls applied (2026-11-08)

The owner approved only the prepared scanner-path WAF rule and recognized AI-crawler block; billing changes were excluded. The usable signed-in session was Windows **Chrome (agent)**, running with profile `C:\chrome-agent` and a localhost debugging endpoint on port 9333. The server-side preview was a different, logged-out browser; its earlier 403s did not establish that the owner's Chrome session was logged out. No API token was needed or extracted.

Before mutation, authenticated reads showed no custom-phase entrypoint ruleset (404) and `ai_bots_protection=disabled`, with broad Bot Fight Mode off. Created ruleset `16ccb10d05314b02a5752788ee3a5a7c`, rule `3acfa08d69b64f13aceb509a617254df`, ref `threewood_block_scanner_paths_v1`, enabled with action Block. It applies only to threewood.app and www.threewood.app and the exact CMS/repository/environment-probe expression in `scripts/security/cloudflare-restrictions.json`. Readback matched the approved expression/action/enabled flag; the ruleset contains one rule. There were no pre-existing custom rules to overwrite.

Set `ai_bots_protection=block` using a partial settings update. The returned settings and immediate separate GET both confirmed Block. Cloudflare automatically changed the linked `ai_training` setting from disabled to disallow; every other returned setting was preserved, including `fight_mode=false`. No broad Bot Fight Mode, personal-agent block, AI-search block, country block, asset rate limit or paid upgrade was enabled.

An initial composite request timed out; readback showed neither change applied. The tab was reloaded to cancel that attempt before separate mutations. Both separate mutations returned HTTP 200/success. A later redundant bot GET transiently failed, but the update plus immediate GET provided successful readback; WAF readback independently matched the reviewed rule. Live checks through the actual Chrome page confirmed `/` → HTTP 200 with the ThreeWood title and `/wp-login.php` → HTTP 403 with Cloudflare's block-page title. A temporary navigation was restored to the owner's existing Cloudflare page. These probes verify the observed path, not every possible scraper or evasion technique.

Billing subscriptions, budgets, spend policies, recipients and notification settings were not changed. No room cleanup/migration was repeated. Billing controls remain a separate review/approval item, and the earlier postmortem's “WAF not applied” statements are historical snapshots superseded by this section. Local sanitized evidence is in `/tmp/threewood-incident/approved-waf-create.json`, `approved-ai-crawler-update.json`, `security-final-verified.json`, and `security-runtime-response-checks.json`; it contains no extracted credentials.
