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
const WARCON_MAP_ART_BASE = 'https://raw.githubusercontent.com/warcon-app/warcon/main/static/maps'
const MAP_ART_DIRECTORIES = Object.freeze({
  Kavkazi: 'Kavkazi',
  Bakurani: 'Kavkazi',
  Europe: 'Europe',
  Ozeti: 'Europe',
  NorthAmerica: 'NorthAmerica',
  Zestafona: 'NorthAmerica',
})
const MAP_ART_LIGHTING = new Set([
  'DayStartClear',
  'DayEarlyClear',
  'DayEarlyFog',
  'DayClear',
  'DayLateClear',
  'DayLateGray',
  'DayLateGrayFog',
  'DayEndClear',
])

function env(name, fallback = '') {
  return String(process.env[name] ?? fallback).trim()
}

function statusApiUrl() {
  return env('DISCORD_STATUS_API_URL')
}

function statsApiUrl() {
  return env('DISCORD_STATS_API_URL', 'https://44thwardogs.com/api/player-stats.php')
}

function refreshInterval() {
  const configured = Number(process.env.DISCORD_STATUS_REFRESH_MS || DEFAULT_REFRESH_MS)
  if (!Number.isFinite(configured)) return DEFAULT_REFRESH_MS
  return Math.max(MIN_REFRESH_MS, configured)
}

const GROUP_CHOICES = [
  { name: 'Normal', value: 'normal' },
  { name: 'Hardcore', value: 'hardcore' },
]

const STATUS_COMMAND = new SlashCommandBuilder()
  .setName('status')
  .setDescription('Show the current WARDOGS server status')
  .toJSON()

const STATS_COMMAND = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('Show WARDOGS player statistics for a SteamID64')
  .addStringOption((option) =>
    option
      .setName('steamid')
      .setDescription('SteamID64, for example 76561198000000000')
      .setRequired(true)
      .setMinLength(17)
      .setMaxLength(17)
  )
  .addStringOption((option) =>
    option
      .setName('group')
      .setDescription('Stats pool; defaults to this bot server group')
      .addChoices(...GROUP_CHOICES)
  )
  .toJSON()

const TOP10_COMMAND = new SlashCommandBuilder()
  .setName('top10')
  .setDescription('Show the WARDOGS top 10 player leaderboard')
  .addStringOption((option) =>
    option
      .setName('group')
      .setDescription('Stats pool; defaults to this bot server group')
      .addChoices(...GROUP_CHOICES)
  )
  .toJSON()

const COMMANDS = [STATUS_COMMAND, STATS_COMMAND, TOP10_COMMAND]

const botDefinitions = [
  {
    number: 1,
    token: env('DISCORD_WARDOGS_SERVER_1_BOT_TOKEN'),
    serverIdentifier: env('DISCORD_WARDOGS_SERVER_1_IDENTIFIER', '278c7bc5'),
    joinCode: env('DISCORD_WARDOGS_SERVER_1_JOIN_CODE', '89607037-07ad-4039-8f7d-1fb9a46e707b'),
    statusChannelId: env('DISCORD_WARDOGS_SERVER_1_STATUS_CHANNEL_ID'),
  },
  {
    number: 2,
    token: env('DISCORD_WARDOGS_SERVER_2_BOT_TOKEN'),
    serverIdentifier: env('DISCORD_WARDOGS_SERVER_2_IDENTIFIER', '9290beb1'),
    joinCode: env('DISCORD_WARDOGS_SERVER_2_JOIN_CODE', '6eccb2c4-4e2a-4cf2-b2d5-67faf8e283b1'),
    statusChannelId: env('DISCORD_WARDOGS_SERVER_2_STATUS_CHANNEL_ID'),
  },
  {
    number: 3,
    token: env('DISCORD_WARDOGS_SERVER_3_BOT_TOKEN'),
    serverIdentifier: env('DISCORD_WARDOGS_SERVER_3_IDENTIFIER', '9f71e8ef'),
    joinCode: env('DISCORD_WARDOGS_SERVER_3_JOIN_CODE', '529de475-7326-4178-81f0-f720aa9c9206'),
    statusChannelId: env('DISCORD_WARDOGS_SERVER_3_STATUS_CHANNEL_ID'),
    fallbackServer: {
      id: 'wardogs-9f71e8ef',
      name: '44th Commandos #3 | New Player Friendly | discord.gg/44thwardogs',
      status: 'Unavailable',
      region: 'Europe / UK',
      players: '— / 100',
      playerCount: null,
      maxPlayers: 100,
      map: '—',
      mode: '—',
      joinCode: '529de475-7326-4178-81f0-f720aa9c9206',
      joinId: '529de475-7326-4178-81f0-f720aa9c9206',
      scores: { valkyra: null, lonestar: null, manticore: null },
      notes: 'Live status is currently unavailable from the website API.',
    },
  },
  {
    number: 4,
    token: env('DISCORD_WARDOGS_SERVER_4_BOT_TOKEN'),
    serverIdentifier: env('DISCORD_WARDOGS_SERVER_4_IDENTIFIER', '12577'),
    joinCode: env('DISCORD_WARDOGS_SERVER_4_JOIN_CODE', '7f15ef51-2673-4eab-b3c8-d8176a3b41e4'),
    statusChannelId: env('DISCORD_WARDOGS_SERVER_4_STATUS_CHANNEL_ID'),
    fallbackServer: {
      id: 'wardogs-12577',
      name: '44th Commandos #4 | Hardcore | discord.gg/44thwardogs',
      status: 'Unavailable',
      region: 'XRealm',
      players: '—',
      playerCount: null,
      maxPlayers: null,
      map: '—',
      mode: 'Hardcore',
      scores: { valkyra: null, lonestar: null, manticore: null },
      notes: 'Live XRealm status is currently unavailable from the website API.',
    },
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
    || definition.fallbackServer
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

function persistentJoinCode(server, definition) {
  const apiCode = String(server?.joinCode || server?.joinId || '').trim()
  const configuredCode = String(definition?.joinCode || '').trim()
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

  if (uuid.test(apiCode)) return apiCode
  if (uuid.test(configuredCode)) return configuredCode
  return ''
}

function statusMapArtUrl(server) {
  const map = String(server?.map || '').trim()
  const directory = MAP_ART_DIRECTORIES[map]
  if (!directory) return null

  const requestedLighting = String(server?.lighting || '').trim()
  const lighting = MAP_ART_LIGHTING.has(requestedLighting) ? requestedLighting : 'DayClear'

  return `${WARCON_MAP_ART_BASE}/${encodeURIComponent(directory)}/${encodeURIComponent(lighting)}-720.webp`
}

function statusEmbed(server, definition) {
  const joinCode = persistentJoinCode(server, definition)

  if (!server) {
    const embed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle(`44th WARDOGS Server #${definition.number}`)
      .setDescription('Server status is currently unavailable.')
      .setFooter({ text: `44th Commando Regiment • WARDOGS Server #${definition.number}` })
      .setTimestamp()

    if (joinCode) {
      embed.addFields({ name: 'Persistent Join Code', value: `\`${joinCode}\``, inline: false })
    }

    return embed
  }

  const scores = server.scores || {}
  const factionScores = [
    `🔴 **Valkyra:** ${scoreValue(scores.valkyra)}`,
    `🔵 **Lonestar:** ${scoreValue(scores.lonestar)}`,
    `🟢 **Manticore:** ${scoreValue(scores.manticore)}`,
  ].join('\n')
  const mapArtUrl = statusMapArtUrl(server)
  const footer = mapArtUrl
    ? `44th Commando Regiment • WARDOGS Server #${definition.number} • Map imagery © BULKHEAD`
    : `44th Commando Regiment • WARDOGS Server #${definition.number}`

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
    .setFooter({ text: footer })
    .setTimestamp(server.updatedAt ? new Date(server.updatedAt) : new Date())

  if (server.address) {
    embed.addFields({ name: 'Server Address', value: String(server.address), inline: true })
  }

  if (joinCode) {
    embed.addFields({ name: 'Persistent Join Code', value: `\`${joinCode}\``, inline: false })
  }

  if (server.lighting) {
    embed.addFields({ name: 'Lighting', value: String(server.lighting), inline: true })
  }

  if (mapArtUrl) {
    embed.setImage(mapArtUrl)
  }

  return embed
}

function defaultStatsGroup(bot) {
  return bot.number === 4 ? 'hardcore' : 'normal'
}

function groupLabel(group) {
  return group === 'hardcore' ? 'Hardcore' : 'Normal'
}

function formatNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toLocaleString('en-GB') : '0'
}

function formatDuration(seconds) {
  let remaining = Math.max(0, Math.floor(Number(seconds) || 0))
  const days = Math.floor(remaining / 86_400)
  remaining %= 86_400
  const hours = Math.floor(remaining / 3_600)
  remaining %= 3_600
  const minutes = Math.floor(remaining / 60)

  const parts = []
  if (days) parts.push(`${days}d`)
  if (hours || days) parts.push(`${hours}h`)
  parts.push(`${minutes}m`)
  return parts.join(' ')
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `<t:${Math.floor(date.getTime() / 1000)}:R>`
}

function truncate(value, max = 1024) {
  const text = String(value ?? '')
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`
}

async function loadJson(url) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })

    let payload = null
    try {
      payload = await response.json()
    } catch {
      // handled below
    }

    if (!response.ok) {
      const message = payload?.error?.message || payload?.error || `HTTP ${response.status}`
      throw new Error(String(message))
    }

    if (!payload || typeof payload !== 'object') {
      throw new Error('API returned invalid JSON')
    }

    return payload
  } finally {
    clearTimeout(timeout)
  }
}

async function loadServers() {
  const url = statusApiUrl()
  if (!url) throw new Error('DISCORD_STATUS_API_URL is not configured')

  const payload = await loadJson(url)
  if (!Array.isArray(payload?.servers)) {
    throw new Error('server API response did not contain a servers array')
  }

  return payload.servers
}

async function loadPlayerStats({ group, search = '', sort = 'kills', limit = 10 }) {
  const base = statsApiUrl()
  if (!base) throw new Error('DISCORD_STATS_API_URL is not configured')

  const url = new URL(base)
  url.searchParams.set('group', group)
  url.searchParams.set('sort', sort)
  url.searchParams.set('limit', String(limit))
  if (search) url.searchParams.set('search', search)

  const payload = await loadJson(url)
  if (!Array.isArray(payload?.players)) {
    throw new Error('stats API response did not contain a players array')
  }
  return payload
}

function statsEmbed(player, group) {
  const online = Boolean(player.online)
  const aliases = Array.isArray(player.aliases) ? player.aliases.filter(Boolean) : []
  const servers = Array.isArray(player.serversPlayed) ? player.serversPlayed.filter(Boolean) : []

  const embed = new EmbedBuilder()
    .setColor(online ? 0x22c55e : 0x5865f2)
    .setTitle(player.name || player.id || 'WARDOGS Player')
    .setDescription(`${online ? '🟢 **Online**' : '⚫ **Offline**'} • ${groupLabel(group)}`)
    .addFields(
      { name: 'SteamID64', value: String(player.id || '—'), inline: false },
      { name: 'Kills', value: formatNumber(player.totalKills), inline: true },
      { name: 'Deaths', value: formatNumber(player.totalDeaths), inline: true },
      { name: 'K/D', value: String(player.kd ?? '0'), inline: true },
      { name: 'Playtime', value: formatDuration(player.secondsTracked), inline: true },
      { name: 'Matches', value: formatNumber(player.matchesSeen), inline: true },
      { name: 'Sessions', value: formatNumber(player.sessionsSeen), inline: true },
      { name: 'First Seen', value: formatDate(player.firstSeen), inline: true },
      { name: 'Last Seen', value: formatDate(player.lastSeen), inline: true },
    )
    .setFooter({ text: '44th Commando Regiment • WARDOGS Player Stats' })
    .setTimestamp()

  if (online) {
    embed.addFields(
      { name: 'Current Server', value: truncate(player.currentServerName || '—'), inline: true },
      { name: 'Faction', value: truncate(player.currentFaction || '—'), inline: true },
      { name: 'Cash', value: player.currentCash === null || player.currentCash === undefined ? '—' : formatNumber(player.currentCash), inline: true },
    )
  }

  if (aliases.length) {
    embed.addFields({ name: 'Known Aliases', value: truncate(aliases.join(', ')), inline: false })
  }

  if (servers.length) {
    embed.addFields({ name: 'Servers Played', value: truncate(servers.join('\n')), inline: false })
  }

  return embed
}

function top10Embed(payload, group) {
  const players = payload.players.slice(0, 10)
  const summary = payload.summary || {}

  const description = players.length
    ? players.map((player, index) => {
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `**${index + 1}.**`
      return `${medal} **${truncate(player.name || player.id, 48)}**\n` +
        `Kills **${formatNumber(player.totalKills)}** • Deaths **${formatNumber(player.totalDeaths)}** • K/D **${player.kd ?? 0}** • ${formatDuration(player.secondsTracked)}`
    }).join('\n\n')
    : 'No tracked players were found for this stats group.'

  return new EmbedBuilder()
    .setColor(group === 'hardcore' ? 0xef4444 : 0x5865f2)
    .setTitle(`44th WARDOGS Top 10 • ${group === 'hardcore' ? 'Hardcore' : 'Normal'}`)
    .setDescription(description)
    .addFields(
      { name: 'Tracked Players', value: formatNumber(summary.trackedPlayers ?? payload.total), inline: true },
      { name: 'Online Now', value: formatNumber(summary.onlinePlayers), inline: true },
      { name: 'Total Recorded Kills', value: formatNumber(summary.totalKillsRecorded), inline: true },
    )
    .setFooter({ text: `${groupLabel(group)} • Ranked by total kills` })
    .setTimestamp(payload.generatedAt ? new Date(payload.generatedAt) : new Date())
}

function errorEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(0xef4444)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: '44th Commando Regiment • WARDOGS' })
    .setTimestamp()
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
    await guild.commands.set(COMMANDS)
    console.log(`[Discord Server #${bot.number}] registered /status, /stats and /top10 in guild ${guildId}`)
    return
  }

  await bot.client.application.commands.set(COMMANDS)
  console.log(`[Discord Server #${bot.number}] registered global /status, /stats and /top10 commands`)
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
      embeds: [errorEmbed(
        `44th WARDOGS Server #${bot.number}`,
        'Unable to load the current server status. Please try again shortly.',
      )],
    })
  }
}

async function handleStatsCommand(interaction, bot) {
  await interaction.deferReply()

  const steamId = interaction.options.getString('steamid', true).trim()
  const group = interaction.options.getString('group') || defaultStatsGroup(bot)

  if (!/^\d{17}$/.test(steamId)) {
    await interaction.editReply({
      embeds: [errorEmbed('Invalid SteamID64', 'Please provide a 17-digit SteamID64.')],
    })
    return
  }

  try {
    const payload = await loadPlayerStats({ group, search: steamId, limit: 20 })
    const player = payload.players.find((candidate) => String(candidate?.id) === steamId)

    if (!player) {
      await interaction.editReply({
        embeds: [errorEmbed(
          'WARDOGS Player Not Found',
          `No ${group === 'hardcore' ? 'Hardcore' : 'Normal'} stats were found for SteamID64 \`${steamId}\`.`,
        )],
      })
      return
    }

    await interaction.editReply({ embeds: [statsEmbed(player, group)] })
  } catch (error) {
    console.error(`[Discord Server #${bot.number}] /stats failed:`, error.message)
    await interaction.editReply({
      embeds: [errorEmbed(
        'WARDOGS Stats Unavailable',
        'Unable to load player statistics from the 44th website. Please try again shortly.',
      )],
    })
  }
}

async function handleTop10Command(interaction, bot) {
  await interaction.deferReply()

  const group = interaction.options.getString('group') || defaultStatsGroup(bot)

  try {
    const payload = await loadPlayerStats({ group, sort: 'kills', limit: 10 })
    await interaction.editReply({ embeds: [top10Embed(payload, group)] })
  } catch (error) {
    console.error(`[Discord Server #${bot.number}] /top10 failed:`, error.message)
    await interaction.editReply({
      embeds: [errorEmbed(
        'WARDOGS Leaderboard Unavailable',
        'Unable to load the WARDOGS leaderboard from the 44th website. Please try again shortly.',
      )],
    })
  }
}

async function handleInteraction(interaction, bot) {
  if (!interaction.isChatInputCommand()) return

  if (interaction.commandName === 'status') {
    await handleStatusCommand(interaction, bot)
    return
  }

  if (interaction.commandName === 'stats') {
    await handleStatsCommand(interaction, bot)
    return
  }

  if (interaction.commandName === 'top10') {
    await handleTop10Command(interaction, bot)
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

if (!statsApiUrl()) {
  console.error('DISCORD_STATS_API_URL is required in .env.')
  process.exit(1)
}

console.log(`Configured bots: ${bots.map((bot) => `#${bot.number}`).join(', ')}`)
console.log(`Discord status source: ${statusApiUrl()}`)
console.log(`Discord stats source: ${statsApiUrl()}`)
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
    handleInteraction(interaction, bot).catch((error) => {
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
