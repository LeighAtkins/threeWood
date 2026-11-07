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
