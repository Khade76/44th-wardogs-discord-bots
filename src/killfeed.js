import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { EmbedBuilder, PermissionFlagsBits } from 'discord.js'
import { openFeedStore } from './killfeed-store.js'

const PAGE_SIZE = 200
const MAX_PAGES = 20
const BATCH_SIZE = 8
const fail = (code) => Object.assign(new Error(code), { code })
const clean = (value, max = 65) => String(value ?? '').replace(/[\r\n\t\\`*_~|<>@\u0000-\u001f\u007f]/g, ' ').slice(0, max)
const stamp = (row) => Date.parse(row.ts)

export function killfeedConfig(env = process.env) {
  const enabled = String(env.DISCORD_WARDOGS_SERVER_1_KILLFEED_ENABLED ?? '0')
  if (!['0', '1'].includes(enabled)) throw fail('killfeed_invalid_enabled')
  if (enabled === '0') return null
  const url = new URL(env.WARCON_KILLFEED_URL)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw fail('killfeed_requires_https_origin')
  const token = String(env.WARCON_KILLFEED_API_KEY ?? '')
  if (!/^wck_[A-Za-z0-9_-]{43}$/.test(token)) throw fail('killfeed_invalid_read_key')
  const serverId = env.DISCORD_WARDOGS_SERVER_1_WARCON_ID || '0fd87c16-6a76-4011-8531-089506b045d4'
  const channelId = env.DISCORD_WARDOGS_SERVER_1_KILLFEED_CHANNEL_ID || '1551932117750120509'
  if (!/^[a-f0-9-]{36}$/i.test(serverId) || !/^\d{17,20}$/.test(channelId)) throw fail('killfeed_invalid_mapping')
  return { origin: url.origin, token, serverId, channelId, interval: 15_000,
    statePath: resolve(env.WARCON_KILLFEED_STATE_FILE || 'data/killfeed-server-1.json') }
}

export function warconReader(config, request = fetch) {
  return async (before) => {
    const url = new URL(`/api/servers/${config.serverId}/kills`, config.origin)
    url.searchParams.set('limit', String(PAGE_SIZE))
    if (before !== undefined) url.searchParams.set('before', new Date(before).toISOString())
    // Never request counts or use the live stream, which raises WARCON's observation tier.
    const response = await request(url, { headers: { Authorization: `Bearer ${config.token}` },
      redirect: 'error', signal: AbortSignal.timeout(8000) })
    if (!response.ok) throw fail(`killfeed_warcon_http_${response.status}`)
    // Bound responses even from a misconfigured endpoint; never print credentials/body.
    const reader = response.body.getReader()
    const chunks = []
    let bytes = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > 2_000_000) throw fail('killfeed_response_too_large')
        chunks.push(Buffer.from(value))
      }
    } finally { await reader.cancel().catch(() => {}) }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (data.ok !== true || !Array.isArray(data.kills) || data.kills.length > PAGE_SIZE)
      throw fail('killfeed_invalid_response')
    if (!data.configured) throw fail('killfeed_not_configured_in_warcon')
    for (const row of data.kills) {
      if (typeof row.eventId !== 'string' || !row.eventId || row.eventId.length > 200 ||
          !Number.isFinite(stamp(row)) || !row.victim || typeof row.victim.name !== 'string')
        throw fail('killfeed_invalid_event')
    }
    // Persist only fields used by Discord, not Steam IDs or unrelated event data.
    return data.kills.map((r) => ({ eventId: r.eventId, ts: r.ts,
      eventTime: Number.isFinite(r.eventTime) ? r.eventTime : 0,
      killer: r.killer ? { name: clean(r.killer.name) } : null, victim: { name: clean(r.victim.name) },
      cause: r.cause ? clean(r.cause, 80) : null, distanceM: Number.isFinite(r.distanceM) ? r.distanceM : null,
      headshot: r.headshot === true, teamKill: r.teamKill === true, suicide: r.suicide === true }))
  }
}

// Page by receipt time with a one-millisecond overlap. WARCON's (ts,eventTime)
// cursor is not unique: overlapping the whole boundary timestamp avoids silently
// skipping equal-clock kills. If a single timestamp fills a page, stop explicitly.
export async function collectNewKills(read, cursor) {
  const found = new Map()
  let before
  for (let page = 0; page < MAX_PAGES; page++) {
    const rows = await read(before)
    if (!rows.length) return [...found.values()].sort(order)
    const oldest = Math.min(...rows.map(stamp))
    const newest = Math.max(...rows.map(stamp))
    for (const row of rows) if (stamp(row) >= cursor.ts && !cursor.ids.includes(row.eventId)) found.set(row.eventId, row)
    if (rows.length < PAGE_SIZE || oldest < cursor.ts) return [...found.values()].sort(order)
    if (oldest === newest || (before !== undefined && oldest + 1 >= before))
      throw fail('killfeed_timestamp_page_overflow')
    before = oldest + 1
  }
  throw fail('killfeed_catchup_limit_reached')
}
const order = (a, b) => stamp(a) - stamp(b) || (Number(a.eventTime) || 0) - (Number(b.eventTime) || 0) || a.eventId.localeCompare(b.eventId)

export function feedEmbed(rows, marker) {
  const lines = rows.map((r) => {
    const kind = r.suicide ? '☠ Suicide' : r.teamKill ? '⚠ Team kill' : r.headshot ? '🎯 Headshot' : '⚔ Kill'
    const weapon = clean(r.cause || 'Unknown cause', 80)
    const distance = Number.isFinite(r.distanceM) ? ` · ${Math.round(r.distanceM)} m` : ''
    return `**${kind}** · <t:${Math.floor(stamp(r) / 1000)}:T>\n` +
      `${clean(r.killer?.name || 'Environment')} → ${clean(r.victim.name)}\n${weapon}${distance}`
  })
  return new EmbedBuilder().setTitle('44th Server #1 — Kill feed').setColor(0xc0392b)
    .setDescription(lines.join('\n\n')).setFooter({ text: `WARCON • ${marker}` })
}

export function discordDelivery(bot, config) {
  async function channel() {
    if (!bot.client.isReady()) throw fail('killfeed_bot_not_ready')
    const c = await bot.client.channels.fetch(config.channelId)
    if (!c?.isTextBased() || c.isThread() || !c.guild || !c.messages || typeof c.send !== 'function')
      throw fail('killfeed_invalid_channel')
    if (process.env.DISCORD_GUILD_ID && c.guild.id !== process.env.DISCORD_GUILD_ID)
      throw fail('killfeed_wrong_guild')
    const permissions = c.permissionsFor(bot.client.user)
    if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory])) throw fail('killfeed_missing_channel_permissions')
    return c
  }
  return {
    async recover(pending) {
      const c = await channel()
      let before
      // Recover a send accepted by Discord before our local checkpoint completed.
      for (let page = 0; page < 20; page++) {
        const messages = [...(await c.messages.fetch({ limit: 100, ...(before ? { before } : {}) })).values()]
        if (messages.some((m) => m.author.id === bot.client.user.id &&
            m.embeds.some((e) => e.footer?.text === `WARCON • ${pending.marker}`))) return true
        if (messages.length < 100 || Math.min(...messages.map((m) => m.createdTimestamp)) < pending.attemptedAt - 60_000) return false
        before = messages.reduce((a, b) => BigInt(a.id) < BigInt(b.id) ? a : b).id
      }
      throw fail('killfeed_delivery_history_limit')
    },
    async send(pending) {
      return (await channel()).send({ embeds: [feedEmbed(pending.rows, pending.marker)],
        allowedMentions: { parse: [] }, nonce: pending.marker, enforceNonce: true })
    },
  }
}

export function createFeedPump({ read, store, delivery, scope, now = Date.now }) {
  let state
  let running = false
  let active = Promise.resolve()
  const save = async (next) => { await store.write(next); state = next }
  async function flush() {
    if (!state.pending) return
    if (state.pending.attemptedAt === null) {
      await save({ ...state, pending: { ...state.pending, attemptedAt: now() } })
      await delivery.send(state.pending)
    } else if (!(await delivery.recover(state.pending))) await delivery.send(state.pending)
    const ids = new Set(state.cursor.ids)
    let ts = state.cursor.ts
    for (const row of state.pending.rows) { ts = Math.max(ts, stamp(row)); ids.add(row.eventId) }
    const delivered = new Set(state.pending.rows.map((r) => r.eventId))
    await save({ ...state, cursor: { ts, ids: [...ids].slice(-10_000) }, pending: null,
      queue: state.queue.filter((r) => !delivered.has(r.eventId)) })
  }
  async function tick() {
    if (running) return
    running = true
    active = (async () => {
      state = await store.read()
      if (!state) {
        const rows = await read()
        // First enable starts at the newest receipt, never replays existing history.
        await save({ version: 1, scope, cursor: { ts: rows.length ? Math.max(...rows.map(stamp)) : 0,
          ids: rows.map((r) => r.eventId) }, pending: null, queue: [] })
        return
      }
      if (state.version !== 1 || state.scope !== scope || !Number.isFinite(state.cursor?.ts) ||
          !Array.isArray(state.cursor.ids) || state.cursor.ids.length > 10_000 ||
          state.cursor.ids.some((id) => typeof id !== 'string') || !Array.isArray(state.queue) ||
          state.queue.length > PAGE_SIZE * MAX_PAGES || state.queue.some((r) => !r ||
            typeof r.eventId !== 'string' || !Number.isFinite(stamp(r)) || typeof r.victim?.name !== 'string') ||
          (state.pending && (!Array.isArray(state.pending.rows) || state.pending.rows.length > BATCH_SIZE ||
            typeof state.pending.marker !== 'string' || !/^[a-f0-9]{24}$/.test(state.pending.marker))))
        throw fail('killfeed_invalid_state_or_mapping_changed')
      if (state.pending) { await flush(); return }
      if (!state.queue.length) {
        const rows = await collectNewKills(read, state.cursor)
        if (rows.length) await save({ ...state, queue: rows })
      }
      // Persist the queue, then drain at most one embed per tick without rereading
      // WARCON for every message. Status updates run independently.
      if (state.queue.length) {
        const batch = state.queue.slice(0, BATCH_SIZE)
        const marker = createHash('sha256').update(JSON.stringify([scope, batch.map((r) => r.eventId)])).digest('hex').slice(0, 24)
        await save({ ...state, pending: { marker, rows: batch, attemptedAt: null } })
        await flush()
      }
    })()
    try { await active } finally { running = false }
  }
  return { tick, queued: () => Boolean(state?.pending || state?.queue?.length), idle: () => active.catch(() => {}) }
}

export async function startKillfeed(bot, config, log = console) {
  const scope = `${config.origin}/${config.serverId}/${config.channelId}/${bot.client.user.id}`
  const store = await openFeedStore(config.statePath)
  const pump = createFeedPump({ read: warconReader(config), store, delivery: discordDelivery(bot, config), scope })
  let stopped = false, timer, failures = 0
  async function run() {
    try { await pump.tick(); failures = 0 }
    catch (error) {
      failures++
      // Do not log response bodies, headers, token, raw network error, or player data.
      const code = typeof error.code === 'string' && /^killfeed_[a-z0-9_]+$/.test(error.code) ? error.code : 'killfeed_read_send_or_state_failed'
      log.error(`[Kill feed #1] ${code}; progress retained, retrying`)
    }
    if (!stopped) {
      timer = setTimeout(run, failures ? Math.min(300_000, config.interval * 2 ** Math.min(failures, 5))
        : pump.queued() ? 2000 : config.interval)
      timer.unref?.()
    }
  }
  void run()
  log.log(`[Kill feed #1] enabled for channel ${config.channelId}; no historical replay on first start`)
  return { async stop() { stopped = true; clearTimeout(timer); await pump.idle(); await store.close() } }
}
