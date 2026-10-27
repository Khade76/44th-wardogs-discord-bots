# 44th WARDOGS Discord Bots

Standalone Node.js Discord bots for the 44th Commando Regiment WARDOGS servers.

## Features

- Up to five Discord bot accounts from one Node.js process (only accounts with a token start)
- Servers #1, #2 and #3 for the 44th WARDOGS servers
- Server #4 for the XRealm-hosted WARDOGS server
- Server #5 for the XRealm-hosted WARDOGS server
- Per-server Discord presence updates every 30 seconds by default
- Optional persistent per-server status embeds that edit themselves on the same refresh cycle
- **Join game** link buttons using the 44th website's Steam join page, plus a private **Join code** fallback
- Persistent status posts ordered by server number within each channel
- `/status` slash command for an on-demand server snapshot
- `/status-order` admin command to rebuild the current channel's status posts in order
- `/stats <steamid>` slash command for persistent WARDOGS player statistics
- `/top10` slash command for the current lifetime-kills leaderboard
- Global lifetime totals come from the website/WARCON stats API, including historical Hardcore sessions
- Optional Server #1–#5 selector on `/stats` and `/top10`
- Live player count, map, mode and faction scores when supplied by the website status API
- Player kills, deaths, K/D, playtime, matches, sessions, aliases and current server/faction when supplied by the website stats API
- Uses the public 44th website APIs
- Status and stats need no RCON passwords or WARCON keys; the optional [Server #1 kill feed](docs/killfeed-server-1.md) requires a dedicated read-only key in private configuration
- AMP Node.js App Runner friendly

## Requirements

- Node.js 20.19+
- One Discord bot token per bot you want to run
- The public 44th server status endpoint, for example:

```text
https://44thwardogs.com/api/servers.php
```

- The public 44th player-stats endpoint:

```text
https://44thwardogs.com/api/player-stats.php
```

For persistent status posts, each bot also needs permission in its configured Discord channel to **View Channel**, **Send Messages**, **Embed Links**, and **Read Message History**.

## Configuration

Copy `.env.example` to `.env` and fill in the values:

```env
DISCORD_STATUS_API_URL=https://44thwardogs.com/api/servers.php
DISCORD_STATS_API_URL=https://44thwardogs.com/api/player-stats.php
DISCORD_STATUS_REFRESH_MS=30000

DISCORD_GUILD_ID=YOUR_DISCORD_SERVER_ID

DISCORD_WARDOGS_SERVER_1_BOT_TOKEN=BOT_1_TOKEN
DISCORD_WARDOGS_SERVER_1_IDENTIFIER=278c7bc5
DISCORD_WARDOGS_SERVER_1_JOIN_CODE=89607037-07ad-4039-8f7d-1fb9a46e707b
DISCORD_WARDOGS_SERVER_1_STATUS_CHANNEL_ID=CHANNEL_ID_FOR_SERVER_1_STATUS

DISCORD_WARDOGS_SERVER_2_BOT_TOKEN=BOT_2_TOKEN
DISCORD_WARDOGS_SERVER_2_IDENTIFIER=9290beb1
DISCORD_WARDOGS_SERVER_2_JOIN_CODE=6eccb2c4-4e2a-4cf2-b2d5-67faf8e283b1
DISCORD_WARDOGS_SERVER_2_STATUS_CHANNEL_ID=CHANNEL_ID_FOR_SERVER_2_STATUS

DISCORD_WARDOGS_SERVER_3_BOT_TOKEN=BOT_3_TOKEN
DISCORD_WARDOGS_SERVER_3_IDENTIFIER=9f71e8ef
DISCORD_WARDOGS_SERVER_3_JOIN_CODE=529de475-7326-4178-81f0-f720aa9c9206
DISCORD_WARDOGS_SERVER_3_STATUS_CHANNEL_ID=CHANNEL_ID_FOR_SERVER_3_STATUS

DISCORD_WARDOGS_SERVER_4_BOT_TOKEN=BOT_4_TOKEN
DISCORD_WARDOGS_SERVER_4_IDENTIFIER=12577
DISCORD_WARDOGS_SERVER_4_JOIN_CODE=7f15ef51-2673-4eab-b3c8-d8176a3b41e4
DISCORD_WARDOGS_SERVER_4_STATUS_CHANNEL_ID=CHANNEL_ID_FOR_SERVER_4_STATUS

DISCORD_WARDOGS_SERVER_5_BOT_TOKEN=BOT_5_TOKEN
DISCORD_WARDOGS_SERVER_5_IDENTIFIER=12648
DISCORD_WARDOGS_SERVER_5_JOIN_CODE=3500961c-24df-40b1-b299-6a897eddc2bd
DISCORD_WARDOGS_SERVER_5_STATUS_CHANNEL_ID=CHANNEL_ID_FOR_SERVER_5_STATUS
```

`DISCORD_STATS_API_URL` defaults to `https://44thwardogs.com/api/player-stats.php`, so it can be omitted once the production website endpoint is live. It is included explicitly in `.env.example` so the source is obvious.

All five status channel IDs may point to the same Discord channel if you want the server embeds together. They appear from top to bottom as **#1 → #2 → #3 → #4 → #5**. Only enabled accounts with a configured status channel participate. Run all five accounts in **one copy of this Node.js service** so it can coordinate their posts.

`DISCORD_GUILD_ID` is recommended while testing because slash-command updates are then registered immediately in that guild. Leave it blank if you want global slash commands instead.

Never commit the real `.env` file or Discord tokens.

## Slash commands

### `/status`

Shows an on-demand snapshot for the bot's WARDOGS server, including player count, map, mode, faction scores and join buttons.

### `/status-order`

Run this in the configured status channel to repost its managed server-status messages in ascending server-number order. You can choose the command from any of the bots: the running service coordinates all configured accounts in that channel.

The person running it needs **Manage Messages** in the channel. The command replies privately. Each bot deletes only its own recognised status posts, so the bots do **not** need Manage Messages themselves. Ordinary conversation, kill-feed posts and `/status` replies are left alone. Reposted messages get new IDs and appear at the bottom of the channel; links to the old messages and pins on them do not carry over.

Normally the refresh cycle repairs the order automatically. This command is useful when you deliberately want to rebuild the group. It reports an error if the channel is not configured or one of its configured accounts is not connected.

### `/stats steamid:<SteamID64> [server]`

Looks up a player through the 44th website stats API and displays:

- current player name
- SteamID64
- online/offline state
- total kills
- total deaths
- K/D
- tracked playtime
- matches
- connection sessions
- first seen / last seen
- current server, faction and cash when online
- known aliases
- servers played

The SteamID must be a 17-digit SteamID64.

Omitting `server` returns the player's total across all five tracked servers. Choose Server #1–#5 to see that server's contribution. Historical Hardcore sessions remain in the lifetime totals.

Examples:

```text
/stats steamid:76561198091536028
/stats steamid:76561198091536028 server:Server #4
```

### `/top10 [server]`

Shows the top 10 tracked WARDOGS players ranked by total kills. Each leaderboard entry includes kills, deaths, K/D and tracked playtime.

The embed also shows the number of tracked players, players online and total recorded kills for the selected scope.

As with `/stats`, the default is all five servers; the optional server selects one server's leaderboard.

## Join game buttons

Persistent status posts and `/status` replies include:

- **Join game** opens the 44th website's join page for the chosen WARDOGS server.
- **Join code** privately shows the server's persistent code and the manual joining steps. It does not write to the clipboard or post the instructions publicly.

The default link goes directly to the 44th website, with the bot's server number from 1 to 5:

```text
https://44thwardogs.com/join?server=1
```

The website handles the server lookup and Steam handoff using the server's **configured** Steam lobby. Set `steamLobbyId` or `steamJoinUrl` on the matching server in its private `wardogs-secrets.php`; update that setting when the lobby changes. Automatic Steam lobby discovery is not implemented. Without a valid lobby setting the website provides the manual join-code fallback. The bot's numbered link remains stable when the website's lobby setting changes. Steam and WARDOGS must be installed on the player's device; the browser may ask the player to select **Open in Steam**. The bot does not fetch or poll `/join`, and the default link has no dependency on an external join website.

The **Join game** button is available for each configured server number even if the bot has no valid join code, because the website resolves the target. The separate **Join code** button uses a valid `joinCode` or `joinId` from the status feed, falling back to `DISCORD_WARDOGS_SERVER_N_JOIN_CODE`. It never treats an RCON address, host identifier or game-instance ID as a join code. When no valid code is available, only the code button is omitted. No new bot `.env` entries are required for the default website link.

To override the default with another tested player-facing HTTP(S) join page for a particular server, optionally set:

```env
DISCORD_WARDOGS_SERVER_1_JOIN_URL=https://your-domain.example/join/server-1
```

The equivalent `_2_` through `_5_` variables apply to the other servers. Leave them blank for the 44th website link. **Clear any existing explicit external `JOIN_URL` overrides to switch those bots to the 44th website.** Valid overrides keep their existing behaviour and take precedence over the default. Invalid, credential-bearing or non-HTTP(S) URLs fall back to the website link for a known server number. Raw `steam://` URLs cannot be used directly in these Discord link buttons.

### Deploy the website before the bots

1. Deploy the 44th website's `/join` page and join API first, then configure each server's current Steam lobby on the website. Check that `https://44thwardogs.com/join?server=1` through `?server=5` load correctly and show either the configured Steam link or the manual fallback.
2. Clear old explicit external `DISCORD_WARDOGS_SERVER_N_JOIN_URL` values from the bot environment, or leave the optional values blank.
3. Update the bot application from GitHub and restart it. The next status refresh replaces the default buttons with the 44th website links.

Updating the bots before the website would send players to a page that may return 404. The bot update does not deploy the website.

Manual fallback: open WARDOGS, go to **Deploy → Community → Join by ID**, paste the code, select **Lookup**, then **Join Match**.

The link format and server lookups can be checked without a game client. Verify the final Discord → browser → Steam → WARDOGS handoff on a desktop with the game installed after deployment.

## Server #4: XRealm

- Current name: `44th Commandos #4 | New Player Friendly | discord.gg/44thwardogs`
- XRealm ID / default bot lookup identifier: `12577`
- Persistent join code: `7f15ef51-2673-4eab-b3c8-d8176a3b41e4`
- RCON endpoint: `84.32.103.104:20001` (management endpoint, not a player join address)

Server #4 is already registered in WARCON. The bots read live status from the website's `servers.php`, which has its own private RCON connections. Registering a server in WARCON does not automatically add it to that website feed.

### Add the website status connection

In the existing private `wardogs-secrets.php` (outside OVH's public `www` directory), append this record inside the `servers` array, keeping the other server records and settings:

```php
[
    'id' => 'wardogs-12577',
    'name' => '44th Commandos #4 | New Player Friendly | discord.gg/44thwardogs',
    'url' => 'http://84.32.103.104:20001',
    'password' => 'CHANGE_ME_SERVER_4_RCON_PASSWORD',
    'joinCode' => '7f15ef51-2673-4eab-b3c8-d8176a3b41e4',
],
```

Set the real RCON password only in that private website file. Use the same HTTP/HTTPS scheme as the working connection in WARCON; the snippet assumes HTTP. No RCON password is needed by the bots. A WARCON key is needed only for the optional Server #1 kill feed.

The website feed must return `id: "wardogs-12577"` or `identifier: "12577"`. The ID here is the agreed website lookup key based on the XRealm ID, not a WARCON database ID. If you use another website ID, set `DISCORD_WARDOGS_SERVER_4_IDENTIFIER` to its suffix after `wardogs-`.

Without a matching feed record, bot #4 displays an unavailable fallback with its name and persistent join code. It does not invent player counts or display the RCON endpoint as a join address. Once the feed supplies the record, the same bot uses its live status, players, map and faction scores.

### Enable the Discord account

Add the Server #4 block from `.env.example` to the existing AMP `.env`, set the fourth account's bot token, and optionally set its status channel ID. Invite that account to the Discord server with the `bot` and `applications.commands` scopes and the channel permissions listed above. Leave the token blank to keep running only the existing accounts.

Older `.env` files may still contain `DISCORD_WARDOGS_SERVER_3_IDENTIFIER=hardcore`. Change that value to `9f71e8ef` for the current Normal Server #3; existing environment values override the new code defaults.

## Server #5: XRealm

- Current name: `44th Commandos #5 | New Player Friendly | US East | discord.gg/44thwardogs`
- XRealm ID / default bot lookup identifier: `12648`
- Persistent join code: `3500961c-24df-40b1-b299-6a897eddc2bd`
- RCON endpoint: `88.216.222.131:20001` (management endpoint, not a player join address)

The bot looks for website status ID `wardogs-12648` (or `identifier: "12648"`). Add this to the private website `wardogs-secrets.php`:

```php
[
    'id' => 'wardogs-12648',
    'name' => '44th Commandos #5 | discord.gg/44thwardogs',
    'url' => 'http://88.216.222.131:20001',
    'password' => 'CHANGE_ME_SERVER_5_RCON_PASSWORD',
    'joinCode' => '3500961c-24df-40b1-b299-6a897eddc2bd',
    'region' => 'XRealm',
],
```

Keep the real RCON password only in the private website file. If the live feed has not yet been updated, bot #5 uses its unavailable fallback while still displaying the persistent join code.

To enable the fifth Discord account, add the Server #5 variables from `.env.example` to the AMP `.env`, set its bot token and optional status channel, run **Update Application**, then restart the bot service.

## Persistent status posts

When a `DISCORD_WARDOGS_SERVER_N_STATUS_CHANNEL_ID` is set, the appropriate bot maintains one status embed in that channel.

On startup the service searches recent messages for each bot's previous managed status post. Existing posts already in order are reused. Missing or out-of-order posts cause only the affected suffix of the group to be reposted in ascending order; for example, replacing a missing #2 also reposts #3–#5 after it. Further refreshes edit those messages in place.

All configured accounts sharing a channel must be connected before any messages are created, deleted or reordered. This prevents the account that happens to log in fastest from posting first. Ready accounts can still edit their existing posts while another account reconnects. Channels with different configurations are handled separately. Overlapping startup refreshes, timer refreshes and reorder commands are coordinated to avoid duplicate sends.

Recovery searches up to **500 recent channel messages** per account. Use a dedicated status channel so these posts stay within that window across restarts. If the search reaches the limit without locating a post, the service reports the issue and does not create a possible duplicate. It also stops replacement attempts on permission/network errors rather than treating every error as a deleted message. Run only one copy of this bot service for the configured accounts.

Every refresh cycle the same message is edited with the latest:

- online / starting / offline state
- player count
- current map
- mode
- Valkyra score
- Lonestar score
- Manticore score
- server address when supplied
- persistent join code
- Join game and Join code buttons
- lighting when available
- updated timestamp

The refresh interval is controlled by:

```env
DISCORD_STATUS_REFRESH_MS=30000
```

The minimum allowed interval is 15 seconds.

The `/status` slash command is still an on-demand snapshot; it does not itself create a continuously updating interaction reply. The persistent channel post is the auto-updating version.

## Run normally

```bash
npm install
npm start
```

The process logs Node.js version, working directory, bot configuration, website API sources, each bot login, slash-command registration, status refreshes and post creation/errors.

## AMP Node.js App Runner

Use the official **Node.js App Runner** template in AMP.

### Download settings

```text
App Download Type: Git repo
App Download Source: https://github.com/Khade76/44th-wardogs-discord-bots.git
Git Repo Branch: main
Git Repo Username: leave blank (public repo)
Git Repo Password/Token: leave blank (public repo)
```

After changing the download settings, run **Update Application** in AMP so the repository is actually downloaded.

### Node.js app settings

```text
Node.js Release Stream: 22 - LTS
Node.js Version: leave blank
npm Install Type: npm i
Run App Setup Commands: disabled
Run App Pre-start Commands: disabled
App Name: src/index.js
App Installation Location: leave blank
Node.js Command Line Arguments: leave blank
App Command Line Arguments: leave blank
```

AMP's Node.js App Runner launches Node directly as:

```text
node src/index.js
```

Do not set `npm start` as the **App Name**. AMP has a separate npm install setting and its App Name field expects the JavaScript entry file.

### `.env`

In AMP File Manager, create `.env` in the same directory as `package.json` and `src/`.

The directory should look like:

```text
package.json
.env
src/
  index.js
```

Put your bot tokens, Discord guild ID, website API URLs and optional persistent status channel IDs in `.env`.

### Updating an existing AMP bot

Because the bot is already installed from GitHub, use **Update Application** in AMP to pull the latest `main`, then restart the instance.

For the website join-button update, **deploy the website's `/join` page first**, then clear any old explicit external `JOIN_URL` overrides before updating and restarting the bots. Existing bot tokens and join codes remain sufficient. For ordered status posts, set all desired `DISCORD_WARDOGS_SERVER_N_STATUS_CHANNEL_ID` values to the same channel and run a single service instance. The first coordinated refresh will update the buttons and repair the post order. Use `/status-order` in that channel if you want to rebuild the whole group. If testing a feature branch before it is merged, change **Git Repo Branch** to that branch before **Update Application**.

If your existing `.env` already has the Discord tokens/status settings, you only need to add this line if you want to set the stats source explicitly:

```env
DISCORD_STATS_API_URL=https://44thwardogs.com/api/player-stats.php
```

The code defaults to that production endpoint when the line is absent.

After restart, with `DISCORD_GUILD_ID` configured, the console should show:

```text
registered /status, /stats, /top10 and /status-order in guild ...
```

The commands should then be available immediately in that Discord server.

### Start

Run **Update Application** first. AMP should pull the repository and run `npm i`. Then press **Start**.

The first console lines should look similar to:

```text
44th WARDOGS Discord bot service starting...
Node.js v22.x.x
Working directory: .../node-server/app
Configured bots: #1, #2, #3, #4, #5
Discord status source: https://44thwardogs.com/api/servers.php
Discord stats source: https://44thwardogs.com/api/player-stats.php
Refresh interval: 30000ms
[Discord Server #1] persistent status channel: ...
[Discord Server #2] persistent status channel: ...
[Discord Server #3] persistent status channel: ...
[Discord Server #4] persistent status channel: ...
[Discord Server #5] persistent status channel: ...
```

No inbound game/network port is required. The bots only make outbound connections to Discord and the public 44th website APIs.
