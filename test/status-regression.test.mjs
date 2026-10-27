import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { killfeedConfig } from '../src/killfeed.js'
import { createStatusPostManager, isManagedStatusMessage } from '../src/status-posts.js'
import { joinInstructionsPayload, persistentJoinCode, statusComponents } from '../src/status-join.js'

const app = new URL('../src/index.js', import.meta.url)
const require = createRequire(app)
const discord = require('discord.js')
const source = readFileSync(app, 'utf8')
  .replace("import 'dotenv/config'", '')
  .replace("import { killfeedConfig, startKillfeed } from './killfeed.js'", '')
  .replace("import { createStatusPostManager } from './status-posts.js'", '')
  .replace("import { joinInstructionsPayload, persistentJoinCode, statusComponents } from './status-join.js'", '')
  .replace(/import \{[\s\S]*?\} from 'discord\.js'/, '')
let checks = 0
function check(value, expected) { assert.deepEqual(value, expected); checks++ }

function boot(numbers, overrides = {}) {
  const clients = []
  const feeds = []
  const env = { DISCORD_STATUS_API_URL: 'https://example.test/status', ...overrides }
  for (const number of numbers) env[`DISCORD_WARDOGS_SERVER_${number}_BOT_TOKEN`] = `test-${number}`
  class Client {
    constructor() { clients.push(this); this.handlers = {}; this.presences = []; this.commands = [] }
    once(event, callback) { this.handlers[event] = callback }
    on(event, callback) { this.handlers[event] = callback }
    async login(token) {
      this.token = token
      this.user = { id: token, tag: token, setPresence: (value) => this.presences.push(value) }
      this.application = { commands: { set: async (value) => this.commands.push(value) } }
    }
    isReady() { return true }
  }
  const context = vm.createContext({
    ...discord, Client, createStatusPostManager, isManagedStatusMessage,
    joinInstructionsPayload, persistentJoinCode, statusComponents,
    killfeedConfig: () => killfeedConfig(env),
    startKillfeed: async (bot, config) => { feeds.push({ number: bot.number, channelId: config.channelId }); return { stop: async () => {} } },
    process: { env, version: process.version, cwd: () => 'test', once() {}, exit(code) { throw Error(`exit ${code}`) } },
    console: { log() {}, warn() {}, error() {} }, URL, AbortController, Date,
    setTimeout, clearTimeout, setInterval: () => ({ unref() {} }), clearInterval() {},
  })
  vm.runInContext(source, context, { filename: 'src/index.js' })
  return { clients, feeds, context, run: (expression) => vm.runInContext(expression, context) }
}

const all = boot([1, 2, 3, 4])
check(all.clients.map((client) => client.token), ['test-1', 'test-2', 'test-3', 'test-4'])
check(boot([1, 2, 3]).clients.length, 3)
check(boot([4]).clients.length, 1)
check(all.run('bots.map(() => statsScopeLabel(null)).join(",")'), 'All five servers,All five servers,All five servers,All five servers')
check(all.run('bots[2].serverIdentifier'), '9f71e8ef')
check(all.run('bots[3].serverIdentifier'), '12577')

all.run(`globalThis.live = [
  {id: 'wardogs-278c7bc5', name: 'One', status: 'Online', playerCount: 11, maxPlayers: 100},
  {id: 'wardogs-9290beb1', name: 'Two', status: 'Online', playerCount: 22, maxPlayers: 100},
  {id: 'wardogs-9f71e8ef', name: 'Three', status: 'Online', playerCount: 33, maxPlayers: 100},
  {id: 'wardogs-12577', name: '44th Commandos #4 | New Player Friendly | discord.gg/44thwardogs', status: 'Online', playerCount: 44, maxPlayers: 100, players: '44 / 100', map: 'Ozeti', mode: 'KOTH', scores: {valkyra: 1, lonestar: 2, manticore: 3}}
]`)
all.context.fetch = async () => ({ ok: true, json: async () => ({ servers: all.context.live }) })
await all.run('refreshStatus()')
check(all.clients.map((client) => client.presences[0].activities[0].name), [
  'Online • 11/100 players', 'Online • 22/100 players', 'Online • 33/100 players', 'Online • 44/100 players',
])
check(all.run('findServer([{identifier: "12577", name: "Identifier match"}], bots[3]).name'), 'Identifier match')
check(all.run('findServer([], bots[3]).status'), 'Unavailable')
check(all.run('findServer([], bots[3]).playerCount'), null)
check(all.run('statusEmbed(findServer([], bots[3]), bots[3]).toJSON().fields.find(f => f.name === "Persistent Join Code").value'), '`7f15ef51-2673-4eab-b3c8-d8176a3b41e4`')
check(all.run('statusEmbed(findServer([], bots[3]), bots[3]).toJSON().fields.some(f => f.name === "Server Address")'), false)
check(all.run('isManagedStatusMessage({author: {id: "test-4"}, embeds: [{footer: {text: "44th Commando Regiment • WARDOGS Server #4"}}]}, bots[3])'), true)
check(all.run('isManagedStatusMessage({author: {id: "test-3"}, embeds: [{footer: {text: "44th Commando Regiment • WARDOGS Server #3"}}]}, bots[3])'), false)

await all.run('registerCommands(bots[3])')
check(Array.from(all.clients[3].commands[0], (command) => command.name), ['status', 'stats', 'top10', 'status-order'])
check(all.clients[3].commands[0][3].default_member_permissions, String(discord.PermissionFlagsBits.ManageMessages))
check(all.clients[3].commands[0][3].dm_permission, false)
check(all.clients[3].commands[0][1].options.map((option) => option.name), ['steamid', 'server'])
check(all.clients[3].commands[0][2].options.map((option) => option.name), ['server'])
let reply
all.context.interaction = {
  deferReply: async () => {}, editReply: async (value) => { reply = value },
  options: { getString: (name) => name === 'steamid' ? '76561198091536028' : null },
}
await all.run('handleStatusCommand(interaction, bots[3])')
check(reply.embeds[0].toJSON().title, '44th Commandos #4 | New Player Friendly | discord.gg/44thwardogs')
check(reply.embeds[0].toJSON().fields.find((field) => field.name === 'Players').value, '44 / 100')
check(reply.components[0].toJSON().components[0].url, 'https://44thwardogs.com/join?server=4')
check(reply.components[0].toJSON().components[1].custom_id, 'wardogs:join:4')
const queries = []
all.context.fetch = async (url) => {
  const params = new URL(url).searchParams
  queries.push([params.get('group'), params.get('server')])
  return { ok: true, json: async () => ({
    group: 'all',
    server: params.has('server') ? Number(params.get('server')) : null,
    players: [{ id: '76561198091536028', name: 'Player', totalKills: 10, totalDeaths: 2, kd: 5 }],
    summary: { trackedPlayers: 1, onlinePlayers: 0, totalKillsRecorded: 10 },
  }) }
}
await all.run('handleStatsCommand(interaction, bots[3])')
check(reply.embeds[0].toJSON().description, '⚫ **Offline** • All five servers')
await all.run('handleTop10Command(interaction, bots[3])')
await all.run('handleTop10Command(interaction, bots[2])')
check(queries, [['all', null], ['all', null], ['all', null]])
all.context.interaction.options.getString = (name) => name === 'steamid' ? '76561198091536028' : name === 'server' ? '4' : null
await all.run('handleStatsCommand(interaction, bots[3])')
check(reply.embeds[0].toJSON().description, '⚫ **Offline** • Server #4')
await all.run('handleTop10Command(interaction, bots[3])')
check(queries.slice(-2), [['all', '4'], ['all', '4']])

const override = boot([4], {
  DISCORD_WARDOGS_SERVER_4_IDENTIFIER: 'custom-four',
  DISCORD_WARDOGS_SERVER_4_JOIN_CODE: '89607037-07ad-4039-8f7d-1fb9a46e707b',
})
check(override.run('findServer([{id: "wardogs-custom-four", name: "Custom"}], bots[0]).name'), 'Custom')
check(override.run('persistentJoinCode(findServer([], bots[0]), bots[0])'), '89607037-07ad-4039-8f7d-1fb9a46e707b')
const fallbackOverride = boot([3, 5], {
  DISCORD_WARDOGS_SERVER_3_JOIN_CODE: '89607037-07ad-4039-8f7d-1fb9a46e707b',
  DISCORD_WARDOGS_SERVER_5_JOIN_CODE: '6eccb2c4-4e2a-4cf2-b2d5-67faf8e283b1',
  DISCORD_WARDOGS_SERVER_5_JOIN_URL: 'https://join.example.test/five',
})
check(fallbackOverride.run('persistentJoinCode(findServer([], bots[0]), bots[0])'), '89607037-07ad-4039-8f7d-1fb9a46e707b')
check(fallbackOverride.run('persistentJoinCode(findServer([], bots[1]), bots[1])'), '6eccb2c4-4e2a-4cf2-b2d5-67faf8e283b1')
check(fallbackOverride.run('statusMessagePayload(findServer([], bots[1]), bots[1]).components[0].toJSON().components[0].url'), 'https://join.example.test/five')
console.log(`${checks} offline checks passed: account activation, status routing, fallback, join code, commands, global stats and server filters. No Discord login or messages sent.`)


const feedEnabled = boot([1, 2, 3, 4, 5], {
  DISCORD_WARDOGS_SERVER_1_KILLFEED_ENABLED: '1', WARCON_KILLFEED_URL: 'https://example.test',
  WARCON_KILLFEED_API_KEY: 'wck_' + 'x'.repeat(43),
})
feedEnabled.context.fetch = async () => ({ ok: true, json: async () => ({ servers: [] }) })
for (const client of feedEnabled.clients) await client.handlers[discord.Events.ClientReady](client)
check(feedEnabled.feeds, [{ number: 1, channelId: '1551932117750120509' }])
check(feedEnabled.clients.length, 5)
check(feedEnabled.run('bots[4].serverIdentifier'), '12648')
check(boot([1]).feeds.length, 0)
const brokenFeed = boot([1, 2], { DISCORD_WARDOGS_SERVER_1_KILLFEED_ENABLED: '1' })
check(brokenFeed.run('killfeedSettings'), null)
check(brokenFeed.clients.length, 2)
check(boot([2], { DISCORD_WARDOGS_SERVER_1_KILLFEED_ENABLED: '1', WARCON_KILLFEED_URL: 'https://example.test', WARCON_KILLFEED_API_KEY: 'wck_' + 'x'.repeat(43) }).run('killfeedSettings'), null)
// Button clicks are private, use fresh status data, and retain configured codes
// when the website is temporarily unavailable.
let deferredFlags
all.context.buttonInteraction = {
  isButton: () => true,
  customId: 'wardogs:join:4',
  deferReply: async (options) => { deferredFlags = options.flags },
  editReply: async (value) => { reply = value },
}
all.context.fetch = async () => ({ ok: true, json: async () => ({ servers: [{
  id: 'wardogs-12577', joinCode: '89607037-07ad-4039-8f7d-1fb9a46e707b',
}] }) })
await all.run('handleInteraction(buttonInteraction, bots[3])')
check(deferredFlags, discord.MessageFlags.Ephemeral)
check(reply.content.includes('89607037-07ad-4039-8f7d-1fb9a46e707b'), true)
check(reply.allowedMentions.parse.length, 0)
all.context.fetch = async () => { throw new Error('website unavailable') }
await all.run('handleInteraction(buttonInteraction, bots[3])')
check(reply.content.includes('7f15ef51-2673-4eab-b3c8-d8176a3b41e4'), true)
all.context.buttonInteraction.customId = 'wardogs:join:3'
reply = null
await all.run('handleInteraction(buttonInteraction, bots[3])')
check(reply, null)

// The runtime permission check still protects /status-order if Discord command
// permissions are changed. Only the selected channel is passed to the manager.
all.run(`globalThis.reorderCalls = [];
  statusPosts.reorder = async (channelId, servers) => {
    reorderCalls.push({channelId, servers});
    return {channelId, serverNumbers: [1, 2, 3, 4]};
  }`)
all.context.orderInteraction = {
  isButton: () => false,
  isChatInputCommand: () => true,
  commandName: 'status-order',
  inGuild: () => true,
  channelId: 'shared-status-channel',
  memberPermissions: { has: () => false },
  reply: async (value) => { reply = value },
  deferReply: async (options) => { deferredFlags = options.flags },
  editReply: async (value) => { reply = value },
}
await all.run('handleInteraction(orderInteraction, bots[0])')
check(reply.flags, discord.MessageFlags.Ephemeral)
check(reply.content.includes('Manage Messages'), true)
check(all.run('reorderCalls.length'), 0)
all.context.orderInteraction.memberPermissions.has = (permission) => permission === discord.PermissionFlagsBits.ManageMessages
all.context.fetch = async () => ({ ok: true, json: async () => ({ servers: all.context.live }) })
await all.run('handleInteraction(orderInteraction, bots[0])')
check(deferredFlags, discord.MessageFlags.Ephemeral)
check(all.run('reorderCalls[0].channelId'), 'shared-status-channel')
check(all.run('reorderCalls[0].servers[0].name'), 'One')
check(reply.content.includes('Server #1 → Server #2 → Server #3 → Server #4'), true)
all.context.orderInteraction.inGuild = () => false
await all.run('handleInteraction(orderInteraction, bots[0])')
check(all.run('reorderCalls.length'), 1)

let releaseFetch
let fetchCount = 0
const pendingFetch = new Promise((resolve) => { releaseFetch = resolve })
all.context.fetch = async () => {
  fetchCount++
  await pendingFetch
  return { ok: true, json: async () => ({ servers: all.context.live }) }
}
const firstRefresh = all.run('refreshStatus()')
const overlappingRefresh = all.run('refreshStatus()')
check(firstRefresh === overlappingRefresh, true)
check(fetchCount, 1)
releaseFetch()
await firstRefresh
console.log(`${checks} total status/integration checks passed, including join buttons, private replies, reorder permissions and overlapping refreshes. No external calls.`)
