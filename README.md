# 44th WARDOGS Discord Bots

Standalone Node.js Discord bots for the 44th Commando Regiment WARDOGS servers.

## Features

- Up to five Discord bot accounts from one Node.js process (only accounts with a token start)
- Servers #1, #2 and #3 for the normal 44th WARDOGS servers
- Server #4 for the XRealm-hosted Hardcore server
- Server #5 for the XRealm-hosted WARDOGS server
- Per-server Discord presence updates every 30 seconds by default
- Optional persistent per-server status embeds that edit themselves on the same refresh cycle
- `/status` slash command for an on-demand server snapshot
- `/stats <steamid>` slash command for persistent WARDOGS player statistics
- `/top10` slash command for the current lifetime-kills leaderboard
- Normal/Hardcore stats pools are supplied by the website/WARCON stats API
- Optional Normal/Hardcore selector on `/stats` and `/top10`
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
DISCORD_WARDOGS_SERVER_4_STATUS_CHANNEL_ID=CHANNEL_ID_FOR_HARDCORE_STATUS

DISCORD_WARDOGS_SERVER_5_BOT_TOKEN=BOT_5_TOKEN
DISCORD_WARDOGS_SERVER_5_IDENTIFIER=12648
DISCORD_WARDOGS_SERVER_5_JOIN_CODE=3500961c-24df-40b1-b299-6a897eddc2bd
DISCORD_WARDOGS_SERVER_5_STATUS_CHANNEL_ID=CHANNEL_ID_FOR_SERVER_5_STATUS
```

`DISCORD_STATS_API_URL` defaults to `https://44thwardogs.com/api/player-stats.php`, so it can be omitted once the production website endpoint is live. It is included explicitly in `.env.example` so the source is obvious.

All five status channel IDs may point to the same Discord channel if you want the server embeds together.

`DISCORD_GUILD_ID` is recommended while testing because slash-command updates are then registered immediately in that guild. Leave it blank if you want global slash commands instead.

Never commit the real `.env` file or Discord tokens.

## Slash commands

### `/status`

Shows an on-demand snapshot for the bot's WARDOGS server, including player count, map, mode and faction scores.

### `/stats steamid:<SteamID64> [group]`

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

The optional `group` can be:

- **Normal** — the website/WARCON Normal stats pool
- **Hardcore** — the website/WARCON Hardcore stats pool

If `group` is omitted, Server #1, #2, #3 and #5 bots default to Normal, while Server #4 defaults to Hardcore. The upstream stats API determines which recorded matches belong to each pool; adding a bot does not change that classification.

Examples:

```text
/stats steamid:76561198091536028
/stats steamid:76561198091536028 group:Normal
/stats steamid:76561198091536028 group:Hardcore
```

### `/top10 [group]`

Shows the top 10 tracked WARDOGS players ranked by total kills. Each leaderboard entry includes kills, deaths, K/D and tracked playtime.

The embed also shows the number of tracked players, players online and total recorded kills for that stats group.

As with `/stats`, Server #1/#2/#3/#5 bots default to Normal and Server #4 defaults to Hardcore, or the user can explicitly select either group.

## Server #4: XRealm Hardcore

- Name: `44th Commandos #4 | Hardcore | discord.gg/44thwardogs`
- XRealm ID / default bot lookup identifier: `12577`
- Persistent join code: `7f15ef51-2673-4eab-b3c8-d8176a3b41e4`
- RCON endpoint: `84.32.103.104:20001` (management endpoint, not a player join address)

Server #4 is already registered in WARCON. The bots read live status from the website's `servers.php`, which has its own private RCON connections. Registering a server in WARCON does not automatically add it to that website feed.

### Add the website status connection

In the existing private `wardogs-secrets.php` (outside OVH's public `www` directory), append this record inside the `servers` array, keeping the other server records and settings:

```php
[
    'id' => 'wardogs-12577',
    'name' => '44th Commandos #4 | Hardcore | discord.gg/44thwardogs',
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

- Name: `44th Commandos #5 | discord.gg/44thwardogs`
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

On startup the bot searches recent messages for its previous managed status post. If it finds one, it reuses it. If not, it creates one. Every refresh cycle the same message is edited with the latest:

- online / starting / offline state
- player count
- current map
- mode
- Valkyra score
- Lonestar score
- Manticore score
- server address when supplied
- persistent join code
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

The process logs Node.js version, working directory, bot configuration, website API sources, each bot login, slash-command registration and every persistent status-post update.

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

If your existing `.env` already has the Discord tokens/status settings, you only need to add this line if you want to set the stats source explicitly:

```env
DISCORD_STATS_API_URL=https://44thwardogs.com/api/player-stats.php
```

The code defaults to that production endpoint when the line is absent.

After restart, with `DISCORD_GUILD_ID` configured, the console should show:

```text
registered /status, /stats and /top10 in guild ...
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
