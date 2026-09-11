# 44th WARDOGS Discord Bots

Standalone Node.js Discord status bots for the 44th Commando Regiment WARDOGS servers.

## Features

- Two Discord bot accounts from one Node.js process
- Per-server Discord presence updates
- `/status` slash command
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

## Configuration

Copy `.env.example` to `.env` and fill in the values:

```env
DISCORD_STATUS_API_URL=https://YOUR-DOMAIN/api/servers.php
DISCORD_STATUS_REFRESH_MS=30000

DISCORD_GUILD_ID=YOUR_DISCORD_SERVER_ID

DISCORD_WARDOGS_SERVER_1_BOT_TOKEN=BOT_1_TOKEN
DISCORD_WARDOGS_SERVER_1_IDENTIFIER=278c7bc5

DISCORD_WARDOGS_SERVER_2_BOT_TOKEN=BOT_2_TOKEN
DISCORD_WARDOGS_SERVER_2_IDENTIFIER=9290beb1
```

`DISCORD_GUILD_ID` is recommended while testing because `/status` is then registered immediately in that guild. Leave it blank if you want a global slash command instead.

Never commit the real `.env` file or Discord tokens.

## Run normally

```bash
npm install
npm start
```

The process logs each bot login, slash-command registration and presence refresh.

## AMP Node.js App Runner

Create a new Node.js App Runner instance in AMP and use this repository:

```text
https://github.com/Khade76/44th-wardogs-discord-bots.git
```

Recommended settings:

```text
Branch: main
Node.js: 20.19 or newer
Startup command: npm start
```

If the AMP template asks for a Node application/entry file instead of a package script, use:

```text
src/bootstrap.js
```

The bootstrap loads `.env` and starts the Discord bot service.

After AMP downloads the repository:

1. Run/install dependencies with `npm install` using AMP's dependency/update task.
2. In AMP File Manager, create `.env` in the repository root from `.env.example`.
3. Put the two Discord bot tokens, Discord guild ID and website API URL in `.env`.
4. Start the AMP instance.

No inbound game/network port is required for the Discord bots. They make outbound connections to Discord and the 44th website API.

## `/status`

Each bot registers one slash command:

```text
/status
```

The bot returns an embed for the WARDOGS server it represents containing:

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
