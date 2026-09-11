# 44th WARDOGS Discord Bots

Standalone Node.js Discord status bots for the 44th Commando Regiment WARDOGS servers.

## Features

- Two Discord bot accounts from one Node.js process
- Per-server Discord presence updates every 30 seconds by default
- Optional persistent per-server status embeds that edit themselves on the same refresh cycle
- `/status` slash command for an on-demand snapshot
- Live player count, map, mode and faction scores
- Uses the public 44th website status API
- No RCON passwords are required in this repository
- AMP Node.js App Runner friendly

## Requirements

- Node.js 20.19+
- Two Discord bot tokens
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
```

Both status channel IDs may point to the same Discord channel if you want the two server embeds together.

`DISCORD_GUILD_ID` is recommended while testing because `/status` is then registered immediately in that guild. Leave it blank if you want a global slash command instead.

Never commit the real `.env` file or Discord tokens.

## Persistent status posts

When `DISCORD_WARDOGS_SERVER_1_STATUS_CHANNEL_ID` and/or `DISCORD_WARDOGS_SERVER_2_STATUS_CHANNEL_ID` is set, the appropriate bot maintains one status embed in that channel.

On startup the bot searches recent messages for its previous managed status post. If it finds one, it reuses it. If not, it creates one. Every refresh cycle the same message is edited with the latest:

- online / starting / offline state
- player count
- current map
- mode
- Valkyra score
- Lonestar score
- Manticore score
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
Configured bots: #1, #2
Discord status source: https://YOUR-DOMAIN/api/servers.php
Refresh interval: 30000ms
[Discord Server #1] persistent status channel: 123456789012345678
[Discord Server #2] persistent status channel: 123456789012345678
[Discord Server #1] logged in as ...
[Discord Server #2] logged in as ...
[Discord Server #1] created persistent status post ...
[Discord Server #2] created persistent status post ...
```

Future refreshes should show:

```text
[Discord Server #1] updated status post ...
[Discord Server #2] updated status post ...
```

If it stops immediately, the console now tells you why. The most common messages are:

```text
No Discord bot tokens are configured.
```

or:

```text
DISCORD_STATUS_API_URL is required in .env.
```

If AMP reports `Cannot find package 'discord.js'` or `Cannot find package 'dotenv'`, run **Update Application** and make sure **npm Install Type** is set to `npm i`.

No inbound game/network port is required. The bots only make outbound connections to Discord and the 44th website API.

## `/status`

Each bot registers one slash command:

```text
/status
```

The bot returns an on-demand embed for the WARDOGS server it represents containing:

- online/starting/offline state
- player count
- current map
- current mode
- Valkyra score
- Lonestar score
- Manticore score
- lighting when available

## Presence

Example:

```text
Server #1: Online • 99/100 players
Server #2: Online • 1/100 players
```

Offline servers use Discord DND/red status and starting/restarting servers use idle/amber status.
