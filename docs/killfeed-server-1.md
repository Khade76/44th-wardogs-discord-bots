# Server #1 kill feed

Disabled by default. Bots #2–#5 and existing status/stats commands are unchanged.
Server #1 maps to WARCON ID `0fd87c16-6a76-4011-8531-089506b045d4` and Discord channel
`1551932117750120509`. The WARCON ID is not the website/Bisect ID `278c7bc5` or join code.
This mapping and configured feed were verified read-only on 22 September 2026.

## Private configuration (after approved deployment)

Keep the existing Server #1 bot token and add this block to its private `.env`:

```dotenv
DISCORD_WARDOGS_SERVER_1_KILLFEED_ENABLED=1
DISCORD_WARDOGS_SERVER_1_KILLFEED_CHANNEL_ID=1551932117750120509
DISCORD_WARDOGS_SERVER_1_WARCON_ID=0fd87c16-6a76-4011-8531-089506b045d4
WARCON_KILLFEED_URL=https://YOUR-WARCON-HOST
WARCON_KILLFEED_API_KEY=YOUR-DEDICATED-READ-ONLY-KEY
WARCON_KILLFEED_STATE_FILE=./data/killfeed-server-1.json
```

Use an organisation API key with **only `server.view`**, restricted to Server #1. This is
not the game's ingest token. Keep it private; never commit it. Use the HTTPS panel origin
without an API path, credentials, query or fragment. Grant the Server #1 bot View Channel,
Send Messages, Embed Links and Read Message History in the destination text channel.
Threads are not supported. If `DISCORD_GUILD_ID` is set, the channel must belong to it.

## Behaviour and resource limits

The relay reads `GET /api/servers/:id/kills?limit=200` every 15 seconds when idle. It does not
request history counts, leaderboards, database writes or a watched stream that raises WARCON's
observation tier. Events are queued oldest-first and drained in embeds of up to eight, spaced
two seconds apart while backlogged. Each entry includes receipt time, killer/victim,
weapon/cause tag, available distance and headshot/team-kill/suicide context. Mentions are
disabled and display names sanitized. Team kills retain WARCON's observed-faction inference.

First enable skips existing receipts. A persisted cursor, deduplication IDs, queue and pending
batch survive graceful restart. New arrivals at the watermark timestamp are still checked.
The queue is saved before publishing, and progress advances only after delivery. A stable
Discord nonce plus batch-marker/history recovery protects against duplicates after an
interrupted send. This is **not an absolute exactly-once guarantee**: deletion/editing of a
pending delivery message can prevent recovery. Run only one publisher for this channel.

Limits stop and log rather than silently skip data:

- Up to 20 history pages per catch-up, roughly 4,000 events (less with overlap). An excessive
  backlog requires operator review, not automatic discarding or a full-history replay.
- WARCON's `(receipt time, match-clock time)` cursor is not unique. The relay overlaps entire
  receipt timestamps to retain tied events. If one timestamp fills a 200-event page, it cannot
  be paged safely: `killfeed_timestamp_page_overflow` needs a better WARCON cursor or an
  explicitly approved reset. It does not silently omit the remaining kills.
- Interrupted-send recovery scans at most 2,000 Discord messages. If it cannot establish
  whether a batch was delivered, it stops rather than blindly sending it again.

Runtime HTTP, permission, feed-disabled and disk failures preserve progress and retry with
backoff up to five minutes. Startup/configuration failures require correcting the issue and
restarting. Neither failure path stops the other status bots. No new slash commands are added.

## State, updates and rollback

Preserve the `data` directory across AMP updates, container replacement and rollback. It is
git-ignored; the queue contains player display data, not keys. Writes use a synced temporary
file and rename, plus directory sync on Linux. A `.lock` prevents simultaneous use of one state
file on the same host; it is not a distributed lock. Do not run copies with different state
files against the same channel.

A crash/forced termination leaves `.lock` behind. Stop all copies, inspect its recorded PID,
verify that process is no longer running, then remove **only the stale `.lock`**. Preserve the
JSON checkpoint. Never auto-delete corrupt checkpoints or a lock on a potentially running bot.
Changing the origin/server/channel/bot identity requires reviewing the old queue and choosing
a new state file intentionally. An accidental mapping change is refused.

Disable with `DISCORD_WARDOGS_SERVER_1_KILLFEED_ENABLED=0` and restart through the normal process.
Retain state for re-enabling/catch-up. Deleting state deliberately starts fresh and skips
outstanding history. A rollback to the old bot code leaves this state unused but intact.

## Verification

Run `npm test` before release. Automated tests use fake HTTP/Discord services, real Discord.js
builders and isolated temporary state files; they never log in or post to Discord.
After approved configuration/deployment, generate a real Server #1 kill, confirm a single
embed arrives in the chosen channel, verify normal status cards still update, and test a
graceful restart. Live channel permissions and API-key access must be verified at that stage.

References: [Discord nonce behaviour](https://github.com/discord/discord-api-docs/blob/main/developers/resources/message.mdx)
and [rate limits](https://github.com/discord/discord-api-docs/blob/main/developers/topics/rate-limits.mdx).
