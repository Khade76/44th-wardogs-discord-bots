# 44th WARDOGS Discord Bots

Standalone Node.js Discord status bots for the 44th Commando Regiment WARDOGS servers.

## Features

- Three Discord bot accounts from one Node.js process
- Server #1 and #2 for the standard 44th WARDOGS servers
- Server #3 for the Qonzer-hosted Hardcore server
- Per-server Discord presence updates every 30 seconds by default
- Optional persistent per-server status embeds that edit themselves on the same refresh cycle
- `/status` slash command for an on-demand snapshot
- Live player count, map, mode and faction scores when supplied by the website status API
- Uses the public 44th website status API
- No RCON passwords are required in this repository
- AMP Node.js App Runner friendly

## Requirements

- Node.js 20.19+
- One Discord bot token per bot you want to run
- The public 44th server status endpoint, for example:

```text
https://YOUR-DOMAIN/api/servers.php
```

For persistent status posts, each bot also needs permission in its configured Discord channel to **View Channel**, **Send Messages**, **Embed Links**, and **Read Message History**.

## Configuration

Copy `.env.example` to `.env` and fill in the values:

```env
DISCORD_STATUS_API_URL=https://YOUR-DOMAIN/api/servers.php
DISCORD_STATUS_REFRESH_MS=30000

DISCORD_GUILD_ID=YOUR_DISCORD_SERVER_ID

DISCORD_WARDOGS_SERVER_1_BOT_TOKEN=BOT_1_TOKEN
DISCORD_WARDOGS_SERVER_1_IDENTIFIER=278c7bc5
DISCORD_WARDOGS_SERVER_1_STATUS_CHANNEL_ID=CHANNEL_ID_FOR_SERVER_1_STATUS

DISCORD_WARDOGS_SERVER_2_BOT_TOKEN=BOT_2_TOKEN
DISCORD_WARDOGS_SERVER_2_IDENTIFIER=9290beb1
DISCORD_WARDOGS_SERVER_2_STATUS_CHANNEL_ID=CHANNEL_ID_FOR_SERVER_2_STATUS

DISCORD_WARDOGS_SERVER_3_BOT_TOKEN=BOT_3_TOKEN
DISCORD_WARDOGS_SERVER_3_IDENTIFIER=hardcore
DISCORD_WARDOGS_SERVER_3_STATUS_CHANNEL_ID=CHANNEL_ID_FOR_HARDCORE_STATUS
```

All three status channel IDs may point to the same Discord channel if you want the three server embeds together.

`DISCORD_GUILD_ID` is recommended while testing because `/status` is then registered immediately in that guild. Leave it blank if you want a global slash command instead.

Never commit the real `.env` file or Discord tokens.

## Hardcore server

Server #3 is the 44th Hardcore server hosted by Qonzer:

```text
216.144.249.76:7779
```

The bot has a built-in fallback record for this server, so it will identify itself correctly even before Qonzer's WARDOGS HTTP RCON/API allocation is connected to the website status API.

Until that live API endpoint is configured, the Hardcore bot will show the server as unavailable with the known server address. Once Qonzer RCON is connected to the website API, the same bot will automatically begin using its live player count, map, mode and faction scores.

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

The process logs Node.js version, working directory, bot configuration, status channel configuration, each bot login, slash-command registration and every persistent status-post update.

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

Put your bot tokens, Discord guild ID, website API URL and optional persistent status channel IDs in `.env`.

### Start

Run **Update Application** first. AMP should clone the repository and run `npm i`. Then press **Start**.

The first console lines should look similar to:

```text
44th WARDOGS Discord bot service starting...
Node.js v22.x.x
Working directory: .../node-server/app
Configured bots: #1, #2, #3
Discord status source: https://YOUR-DOMAIN/api/servers.php
Refresh interval: 30000ms
[Discord Server #1] persistent status channel: ...
[Discord Server #2] persistent status channel: ...
[Discord Server #3] persistent status channel: ...
```

No inbound game/network port is required. The bots only make outbound connections to Discord and the 44th website API.
