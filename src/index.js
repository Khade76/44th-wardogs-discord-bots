import 'dotenv/config'
import {
  ActivityType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  SlashCommandBuilder,
} from 'discord.js'

const DEFAULT_REFRESH_MS = 30_000
const MIN_REFRESH_MS = 15_000
const REQUEST_TIMEOUT_MS = 8_000

function env(name, fallback = '') {
  return String(process.env[name] ?? fallback).trim()
}

function statusApiUrl() {
  return env('DISCORD_STATUS_API_URL')
}

function refreshInterval() {
  const configured = Number(process.env.DISCORD_STATUS_REFRESH_MS || DEFAULT_REFRESH_MS)
  if (!Number.isFinite(configured)) return DEFAULT_REFRESH_MS
  return Math.max(MIN_REFRESH_MS, configured)
}

const STATUS_COMMAND = new SlashCommandBuilder()
  .setName('status')
  .setDescription('Show the current WARDOGS server status')
  .toJSON()

const botDefinitions = [
  {
    number: 1,
    token: env('DISCORD_WARDOGS_SERVER_1_BOT_TOKEN'),
    serverIdentifier: env('DISCORD_WARDOGS_SERVER_1_IDENTIFIER', '278c7bc5'),
    statusChannelId: env('DISCORD_WARDOGS_SERVER_1_STATUS_CHANNEL_ID'),
  },
  {
    number: 2,
    token: env('DISCORD_WARDOGS_SERVER_2_BOT_TOKEN'),
    serverIdentifier: env('DISCORD_WARDOGS_SERVER_2_IDENTIFIER', '9290beb1'),
    statusChannelId: env('DISCORD_WARDOGS_SERVER_2_STATUS_CHANNEL_ID'),
  },
  {
    number: 3,
    token: env('DISCORD_WARDOGS_SERVER_3_BOT_TOKEN'),
    serverIdentifier: env('DISCORD_WARDOGS_SERVER_3_IDENTIFIER', 'hardcore'),
    statusChannelId: env('DISCORD_WARDOGS_SERVER_3_STATUS_CHANNEL_ID'),
  },
]

const bots = botDefinitions
  .filter((definition) => definition.token)
  .map((definition) => ({
    ...definition,
    client: new Client({ intents: [GatewayIntentBits.Guilds] }),
    statusMessage: null,
    statusMessagePromise: null,
  }))

function findServer(servers, definition) {
  return servers.find((server) => server?.identifier === definition.serverIdentifier)
    || servers.find((server) => server?.id === `wardogs-${definition.serverIdentifier}`)
    || null
}

function normalisedStatus(server) {
  return String(server?.status || '').trim().toLowerCase()
}

function presenceFor(server) {
  if (!server) return { status: 'idle', activity: 'Status unavailable' }

  const current = Number.isFinite(server.playerCount) ? server.playerCount : null
  const max = Number.isFinite(server.maxPlayers) ? server.maxPlayers : null
  const players = current !== null && max !== null
    ? `${current}/${max} players`
    : String(server.players || 'players unavailable')

  const status = normalisedStatus(server)

  if (status === 'online') return { status: 'online', activity: `Online • ${players}` }
  if (['starting', 'booting', 'restarting'].includes(status)) return { status: 'idle', activity: `Starting • ${players}` }
  if (['offline', 'unavailable', 'stopped'].includes(status)) return { status: 'dnd', activity: `Offline • ${players}` }

  return { status: 'idle', activity: `${server.status || 'Unavailable'} • ${players}` }
}

function statusColour(server) {
  const status = normalisedStatus(server)
  if (status === 'online') return 0x22c55e
  if (['starting', 'booting', 'restarting'].includes(status)) return 0xf59e0b
  return 0xef4444
}

function scoreValue(value) {
  return Number.isFinite(value) ? String(value) : '—'
}

function statusEmbed(server, definition) {
  if (!server) {
    return new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle(`44th WARDOGS Server #${definition.number}`)
      .setDescription('Server status is currently unavailable.')
      .setFooter({ text: `44th Commando Regiment • WARDOGS Server #${definition.number}` })
      .setTimestamp()
  }

  const scores = server.scores || {}
  const factionScores = [
    `🔴 **Valkyra:** ${scoreValue(scores.valkyra)}`,
    `🔵 **Lonestar:** ${scoreValue(scores.lonestar)}`,
    `🟢 **Manticore:** ${scoreValue(scores.manticore)}`,
  ].join('\n')

  const embed = new EmbedBuilder()
    .setColor(statusColour(server))
    .setTitle(server.name || `44th WARDOGS Server #${definition.number}`)
    .setDescription(`**${server.status || 'Unavailable'}**`)
    .addFields(
      { name: 'Players', value: String(server.players || '—'), inline: true },
      { name: 'Map', value: String(server.map || '—'), inline: true },
      { name: 'Mode', value: String(server.mode || '—'), inline: true },
      { name: 'Faction Scores', value: factionScores, inline: false },
    )
    .setFooter({ text: `44th Commando Regiment • WARDOGS Server #${definition.number}` })
    .setTimestamp(server.updatedAt ? new Date(server.updatedAt) : new Date())

  if (server.address) {
    embed.addFields({ name: 'Server Address', value: String(server.address), inline: true })
  }

  if (server.lighting) {
    embed.addFields({ name: 'Lighting', value: String(server.lighting), inline: true })
  }

  return embed
}

async function loadServers() {
  const url = statusApiUrl()
  if (!url) throw new Error('DISCORD_STATUS_API_URL is not configured')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })

    if (!response.ok) throw new Error(`server API returned HTTP ${response.status}`)

    const payload = await response.json()
    if (!Array.isArray(payload?.servers)) {
      throw new Error('server API response did not contain a servers array')
    }

    return payload.servers
  } finally {
    clearTimeout(timeout)
  }
}

function isManagedStatusMessage(message, bot) {
  if (!message || message.author?.id !== bot.client.user?.id) return false
  const footer = message.embeds?.[0]?.footer?.text || ''
  return footer.includes(`WARDOGS Server #${bot.number}`)
}

async function resolveStatusMessage(bot, channel) {
  if (bot.statusMessage) {
    try {
      return await channel.messages.fetch(bot.statusMessage.id)
    } catch {
      bot.statusMessage = null
    }
  }

  try {
    const recent = await channel.messages.fetch({ limit: 50 })
    const existing = recent.find((message) => isManagedStatusMessage(message, bot))
    if (existing) {
      bot.statusMessage = existing
      return existing
    }
  } catch (error) {
    console.warn(`[Discord Server #${bot.number}] unable to search for an existing status post:`, error.message)
  }

  return null
}

async function updatePersistentStatusPost(bot, server) {
  if (!bot.statusChannelId || !bot.client.isReady()) return
  if (bot.statusMessagePromise) return bot.statusMessagePromise

  bot.statusMessagePromise = (async () => {
    const channel = await bot.client.channels.fetch(bot.statusChannelId)
    if (!channel?.isTextBased() || !channel.messages || typeof channel.send !== 'function') {
      throw new Error(`status channel ${bot.statusChannelId} is not a text channel the bot can post in`)
    }

    const payload = { embeds: [statusEmbed(server, bot)] }
    let message = await resolveStatusMessage(bot, channel)

    if (message) {
      try {
        message = await message.edit(payload)
        bot.statusMessage = message
        console.log(`[Discord Server #${bot.number}] updated status post ${message.id}`)
        return
      } catch (error) {
        console.warn(`[Discord Server #${bot.number}] could not edit status post ${message.id}; creating a replacement:`, error.message)
        bot.statusMessage = null
      }
    }

    message = await channel.send(payload)
    bot.statusMessage = message
    console.log(`[Discord Server #${bot.number}] created persistent status post ${message.id} in channel ${bot.statusChannelId}`)
  })()

  try {
    await bot.statusMessagePromise
  } finally {
    bot.statusMessagePromise = null
  }
}

async function refreshStatus() {
  if (!bots.some(({ client }) => client.isReady())) return

  let servers = []
  try {
    servers = await loadServers()
  } catch (error) {
    console.error(`Unable to load WARDOGS status from ${statusApiUrl() || '(not configured)'}:`, error.message)
  }

  for (const bot of bots) {
    if (!bot.client.isReady()) continue

    const server = findServer(servers, bot)
    const presence = presenceFor(server)

    bot.client.user.setPresence({
      status: presence.status,
      activities: [{ name: presence.activity, type: ActivityType.Watching }],
    })

    console.log(`[Discord Server #${bot.number}] ${bot.client.user.tag}: ${presence.activity}`)

    try {
      await updatePersistentStatusPost(bot, server)
    } catch (error) {
      console.error(`[Discord Server #${bot.number}] persistent status post update failed:`, error.message)
    }
  }
}

async function registerCommands(bot) {
  const guildId = env('DISCORD_GUILD_ID')

  if (guildId) {
    const guild = await bot.client.guilds.fetch(guildId)
    await guild.commands.set([STATUS_COMMAND])
    console.log(`[Discord Server #${bot.number}] registered /status in guild ${guildId}`)
    return
  }

  await bot.client.application.commands.set([STATUS_COMMAND])
  console.log(`[Discord Server #${bot.number}] registered global /status command`)
}

async function handleStatusCommand(interaction, bot) {
  await interaction.deferReply()

  try {
    const servers = await loadServers()
    const server = findServer(servers, bot)
    await interaction.editReply({ embeds: [statusEmbed(server, bot)] })
  } catch (error) {
    console.error(`[Discord Server #${bot.number}] /status failed:`, error.message)
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle(`44th WARDOGS Server #${bot.number}`)
          .setDescription('Unable to load the current server status. Please try again shortly.'),
      ],
    })
  }
}

console.log('44th WARDOGS Discord bot service starting...')
console.log(`Node.js ${process.version}`)
console.log(`Working directory: ${process.cwd()}`)

if (!bots.length) {
  console.error('No Discord bot tokens are configured.')
  console.error('Create a .env file in the AMP App Installation Location and set at least one bot token.')
  process.exit(1)
}

if (!statusApiUrl()) {
  console.error('DISCORD_STATUS_API_URL is required in .env.')
  process.exit(1)
}

console.log(`Configured bots: ${bots.map((bot) => `#${bot.number}`).join(', ')}`)
console.log(`Discord status source: ${statusApiUrl()}`)
console.log(`Refresh interval: ${refreshInterval()}ms`)
for (const bot of bots) {
  console.log(`[Discord Server #${bot.number}] persistent status channel: ${bot.statusChannelId || 'not configured'}`)
}

for (const bot of bots) {
  bot.client.once(Events.ClientReady, async (readyClient) => {
    console.log(`[Discord Server #${bot.number}] logged in as ${readyClient.user.tag}`)

    try {
      await registerCommands(bot)
    } catch (error) {
      console.error(`[Discord Server #${bot.number}] slash command registration failed:`, error.message)
    }

    refreshStatus().catch((error) => console.error('Initial status refresh failed:', error))
  })

  bot.client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'status') return
    handleStatusCommand(interaction, bot).catch((error) => {
      console.error(`[Discord Server #${bot.number}] interaction error:`, error)
    })
  })

  bot.client.on(Events.Error, (error) => {
    console.error(`[Discord Server #${bot.number}] client error:`, error)
  })

  bot.client.login(bot.token).catch((error) => {
    console.error(`[Discord Server #${bot.number}] login failed:`, error.message)
  })
}

const timer = setInterval(() => {
  refreshStatus().catch((error) => console.error('Discord status refresh failed:', error))
}, refreshInterval())

timer.unref?.()

async function shutdown(signal) {
  console.log(`Received ${signal}; shutting down Discord bots.`)
  clearInterval(timer)
  for (const { client } of bots) client.destroy()
  process.exit(0)
}

process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))
