import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { killfeedConfig, warconReader, collectNewKills, feedEmbed, createFeedPump, discordDelivery } from '../src/killfeed.js'
import { openFeedStore } from '../src/killfeed-store.js'

const baseTime = Date.parse('2026-09-22T10:00:00Z')
const row = (id, time = Number(id)) => ({ eventId: String(id), ts: new Date(baseTime + time * 1000).toISOString(),
  eventTime: time, killer: { name: 'Killer' }, victim: { name: 'Victim' }, cause: 'AK74M', distanceM: 120,
  headshot: false, teamKill: false, suicide: false })
const valid = { DISCORD_WARDOGS_SERVER_1_KILLFEED_ENABLED: '1', WARCON_KILLFEED_URL: 'https://warcon.example',
  WARCON_KILLFEED_API_KEY: `wck_${'x'.repeat(43)}` }
const initial = () => ({ version: 1, scope: 'test', cursor: { ts: baseTime, ids: ['0'] }, pending: null, queue: [] })
function harness(saved = initial()) {
  let disk = structuredClone(saved), rows = [], sends = [], recoveries = 0, reads = 0
  const store = { read: async () => structuredClone(disk), write: async (s) => { disk = structuredClone(s) } }
  const delivery = { send: async (pending) => { sends.push(structuredClone(pending)) }, recover: async () => { recoveries++; return true } }
  const read = async (before) => { reads++; return [...rows].filter((r) => before === undefined || Date.parse(r.ts) < before)
    .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts) || b.eventTime - a.eventTime).slice(0, 200) }
  const pump = () => createFeedPump({ read, store, delivery, scope: 'test', now: () => baseTime + 100_000 })
  return { store, delivery, read, pump, rows: (r) => { rows = r }, disk: () => disk, sends, recoveries: () => recoveries, reads: () => reads }
}

test('disabled by default and server #1/channel mapping exact', () => {
  assert.equal(killfeedConfig({}), null)
  const c = killfeedConfig(valid)
  assert.equal(c.serverId, '0fd87c16-6a76-4011-8531-089506b045d4')
  assert.equal(c.channelId, '1551932117750120509')
  assert.equal(c.interval, 15000)
})
test('configuration refuses token leaks, paths, non-HTTPS and malformed IDs', () => {
  for (const url of ['http://example.com', 'https://u:p@example.com', 'https://example.com/api', 'https://example.com/?key=x', 'https://example.com/#x'])
    assert.throws(() => killfeedConfig({ ...valid, WARCON_KILLFEED_URL: url }))
  for (const override of [{ WARCON_KILLFEED_API_KEY: 'bad' }, { DISCORD_WARDOGS_SERVER_1_WARCON_ID: '278c7bc5' },
    { DISCORD_WARDOGS_SERVER_1_KILLFEED_CHANNEL_ID: '12' }, { DISCORD_WARDOGS_SERVER_1_KILLFEED_ENABLED: 'yes' }])
    assert.throws(() => killfeedConfig({ ...valid, ...override }))
})
test('reader uses only bounded per-server history, bearer header and no redirects/counts', async () => {
  const c = killfeedConfig(valid)
  const read = warconReader(c, async (url, options) => {
    assert.equal(url.pathname, `/api/servers/${c.serverId}/kills`)
    assert.equal(url.searchParams.get('limit'), '200')
    assert.equal(url.searchParams.has('count'), false)
    assert.equal(url.searchParams.get('before'), new Date(baseTime).toISOString())
    assert.equal(options.headers.Authorization, `Bearer ${c.token}`)
    assert.equal(options.redirect, 'error')
    return Response.json({ ok: true, configured: true, kills: [row(1)] })
  })
  assert.equal((await read(baseTime)).length, 1)
})
test('reader rejects error pages, disabled feeds, malformed rows and large responses', async () => {
  for (const response of [new Response('secret', { status: 403 }), Response.json({ ok: true, configured: false, kills: [] }),
    Response.json({ ok: true, configured: true, kills: [{}] }), new Response('x'.repeat(2_000_001)),
    Response.json({ ok: true, configured: true, kills: Array.from({ length: 201 }, () => row(1)) })])
    await assert.rejects(warconReader(killfeedConfig(valid), async () => response)())
})
test('reader omits Steam IDs and unrelated player data from persisted events', async () => {
  const read = warconReader(killfeedConfig(valid), async () => Response.json({ ok: true, configured: true,
    kills: [{ ...row(1), killer: { name: 'Player', steamId: '76561198000000000' }, extraPrivateData: 'not-needed' }] }))
  const result = await read()
  assert.equal(result[0].killer.name, 'Player')
  assert.equal(result[0].killer.steamId, undefined)
  assert.equal(result[0].extraPrivateData, undefined)
})
test('first start skips existing history, then forwards new kills only', async () => {
  const h = harness(null); h.rows([row(1), row(2)])
  const p = h.pump(); await p.tick()
  assert.equal(h.sends.length, 0)
  h.rows([row(1), row(2), row(3)]); await p.tick()
  assert.deepEqual(h.sends[0].rows.map((r) => r.eventId), ['3'])
})
test('empty first start does not use a future local clock watermark', async () => {
  const h = harness(null); const p = h.pump(); await p.tick()
  assert.equal(h.disk().cursor.ts, 0)
  h.rows([row(1)]); await p.tick(); assert.equal(h.sends.length, 1)
})
test('queue is persisted, sent chronologically in eights, and drains without rereading WARCON', async () => {
  const h = harness(); h.rows(Array.from({ length: 21 }, (_, i) => row(i + 1)))
  const p = h.pump(); await p.tick(); assert.equal(h.sends[0].rows.length, 8)
  assert.equal(h.disk().queue.length, 13); assert.equal(p.queued(), true)
  await p.tick(); await p.tick()
  assert.equal(h.reads(), 1)
  assert.deepEqual(h.sends.flatMap((b) => b.rows.map((r) => r.eventId)), Array.from({ length: 21 }, (_, i) => String(i + 1)))
  assert.equal(p.queued(), false)
})
test('restart resumes the queue and does not duplicate completed batches', async () => {
  const h = harness(); h.rows(Array.from({ length: 20 }, (_, i) => row(i + 1)))
  await h.pump().tick(); const resumed = h.pump(); await resumed.tick(); await resumed.tick(); await resumed.tick()
  assert.equal(h.sends.flatMap((b) => b.rows).length, 20)
  assert.equal(new Set(h.sends.flatMap((b) => b.rows.map((r) => r.eventId))).size, 20)
})
test('duplicate receipt IDs and late events on the watermark timestamp are handled', async () => {
  const h = harness(); h.rows([row(1), row(1)])
  const p = h.pump(); await p.tick()
  h.rows([row(1), row('late', 1)]); await p.tick()
  assert.deepEqual(h.sends.flatMap((b) => b.rows.map((r) => r.eventId)), ['1', 'late'])
})
test('history pagination overlaps full timestamp groups without losing equal-clock events', async () => {
  const h = harness(); h.rows(Array.from({ length: 530 }, (_, i) => row(i + 1, Math.floor(i / 3) + 1)))
  const found = await collectNewKills(h.read, initial().cursor)
  assert.equal(found.length, 530); assert.equal(new Set(found.map((r) => r.eventId)).size, 530)
  assert.ok(h.reads() >= 3)
})
test('unpageable equal-timestamp bursts stop without advancing or sending partial history', async () => {
  const h = harness(); h.rows(Array.from({ length: 210 }, (_, i) => row(i + 1, 1)))
  await assert.rejects(h.pump().tick(), /timestamp_page_overflow/)
  assert.equal(h.disk().cursor.ts, baseTime); assert.equal(h.sends.length, 0)
})
test('catch-up is bounded and never silently discards excessive backlog', async () => {
  const h = harness(); h.rows(Array.from({ length: 4500 }, (_, i) => row(i + 1)))
  await assert.rejects(h.pump().tick(), /catchup_limit_reached/)
  assert.equal(h.reads(), 20); assert.equal(h.sends.length, 0); assert.equal(h.disk().cursor.ts, baseTime)
})
test('failed sends keep a durable pending intent and recover accepted messages on restart', async () => {
  const h = harness(); h.rows([row(1)])
  h.delivery.send = async () => { throw Error('network disconnected after acceptance') }
  await assert.rejects(h.pump().tick())
  const marker = h.disk().pending.marker
  assert.equal(marker.length, 24); assert.equal(h.disk().cursor.ts, baseTime)
  await h.pump().tick()
  assert.equal(h.recoveries(), 1); assert.equal(h.disk().pending, null)
  assert.equal(h.disk().cursor.ts, baseTime + 1000)
})
test('unaccepted send is retried with identical nonce/marker and payload', async () => {
  const h = harness(); h.rows([row(1)])
  h.delivery.send = async () => { throw Error('not accepted') }
  await assert.rejects(h.pump().tick()); const marker = h.disk().pending.marker
  h.delivery.recover = async () => false
  h.delivery.send = async (p) => { h.sends.push(p) }
  await h.pump().tick(); assert.equal(h.sends[0].marker, marker)
})
test('disk failure before intent persistence prevents sending', async () => {
  const h = harness(); h.rows([row(1)])
  h.store.write = async () => { throw Error('disk full') }
  await assert.rejects(h.pump().tick()); assert.equal(h.sends.length, 0)
})
test('disk failure after Discord acceptance is recovered without another send', async () => {
  const h = harness(); h.rows([row(1)]); const write = h.store.write
  h.store.write = async (s) => { if (!s.pending && s.cursor.ts > baseTime) throw Error('disk full'); return write(s) }
  await assert.rejects(h.pump().tick()); assert.equal(h.sends.length, 1)
  h.store.write = write; await h.pump().tick(); assert.equal(h.sends.length, 1); assert.equal(h.recoveries(), 1)
})
test('changed destination and corrupt state fail closed', async () => {
  for (const state of [{ ...initial(), scope: 'different-channel' }, { ...initial(), cursor: null }, { ...initial(), queue: [{}] }]) {
    const h = harness(state); await assert.rejects(h.pump().tick()); assert.equal(h.sends.length, 0)
  }
})
test('overlapping ticks cannot duplicate messages', async () => {
  const h = harness(); h.rows([row(1)]); const p = h.pump()
  await Promise.all([p.tick(), p.tick(), p.tick()]); assert.equal(h.sends.length, 1)
})
test('embed renders combat details safely within Discord limits', () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ ...row(i), killer: { name: '@everyone **'.repeat(200) },
    victim: { name: '<@123>'.repeat(200) }, cause: 'Vehicle *'.repeat(200), headshot: i === 0, teamKill: i === 1, suicide: i === 2 }))
  const embed = feedEmbed(rows, 'f'.repeat(24)).toJSON()
  assert.ok(embed.description.length < 4096)
  assert.doesNotMatch(embed.description, /@everyone|<@123>/)
  for (const label of ['Headshot', 'Team kill', 'Suicide', '120 m']) assert.ok(embed.description.includes(label))
})
test('environmental deaths and unknown distance render clearly', () => {
  const embed = feedEmbed([{ ...row(1), killer: null, distanceM: null, cause: null }], 'f'.repeat(24)).toJSON()
  assert.match(embed.description, /Environment/); assert.match(embed.description, /Unknown cause/)
})

function discordHarness() {
  const sent = [], queries = []
  let messages = []
  const c = { isTextBased: () => true, isThread: () => false, guild: { id: process.env.DISCORD_GUILD_ID || 'guild' },
    permissionsFor: () => ({ has: () => true }), send: async (p) => sent.push(p),
    messages: { fetch: async (q) => { queries.push(q); return new Map(messages.map((m) => [m.id, m])) } } }
  const bot = { client: { isReady: () => true, user: { id: 'bot1' }, channels: { fetch: async (id) => { assert.equal(id, '1551932117750120509'); return c } } } }
  return { c, bot, sent, queries, messages: (v) => { messages = v }, delivery: discordDelivery(bot, killfeedConfig(valid)) }
}
test('Discord delivery routes only to #1 channel with mentions disabled and stable nonce', async () => {
  const h = discordHarness(); await h.delivery.send({ rows: [row(1)], marker: 'f'.repeat(24) })
  assert.equal(h.sent[0].enforceNonce, true); assert.equal(h.sent[0].nonce, 'f'.repeat(24))
  assert.deepEqual(h.sent[0].allowedMentions, { parse: [] })
})
test('Discord permissions, readiness and thread checks block publishing', async () => {
  for (const kind of ['permissions', 'ready', 'thread', 'guild']) {
    const h = discordHarness()
    if (kind === 'permissions') h.c.permissionsFor = () => ({ has: () => false })
    if (kind === 'ready') h.bot.client.isReady = () => false
    if (kind === 'thread') h.c.isThread = () => true
    if (kind === 'guild') h.c.guild = null
    await assert.rejects(h.delivery.send({ rows: [row(1)], marker: 'f'.repeat(24) })); assert.equal(h.sent.length, 0)
  }
})
test('history recovery trusts only this bot and exact batch marker', async () => {
  const h = discordHarness(), marker = 'f'.repeat(24)
  h.messages([{ id: '1', author: { id: 'someone-else' }, embeds: [{ footer: { text: `WARCON • ${marker}` } }] }])
  assert.equal(await h.delivery.recover({ marker, attemptedAt: baseTime }), false)
  h.messages([{ id: '2', author: { id: 'bot1' }, embeds: [{ footer: { text: `WARCON • ${marker}` } }] }])
  assert.equal(await h.delivery.recover({ marker, attemptedAt: baseTime }), true)
})
test('history recovery fails closed if lookback cannot establish whether delivery happened', async () => {
  const h = discordHarness()
  h.messages(Array.from({ length: 100 }, (_, i) => ({ id: String(1000 + i), author: { id: 'other' },
    createdTimestamp: baseTime + 1000, embeds: [] })))
  await assert.rejects(h.delivery.recover({ marker: 'f'.repeat(24), attemptedAt: baseTime }), /history_limit/)
  assert.equal(h.queries.length, 20)
})
test('file store saves atomically, survives reopen, and blocks concurrent publishers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wardogs-killfeed-test-'))
  try {
    const path = join(dir, 'state.json'); const store = await openFeedStore(path)
    assert.equal(await store.read(), null)
    await assert.rejects(openFeedStore(path), /locked/)
    await store.write(initial()); assert.deepEqual(await store.read(), initial())
    await store.close(); const reopened = await openFeedStore(path)
    assert.deepEqual(await reopened.read(), initial()); await reopened.close()
    assert.equal(JSON.parse(await readFile(path, 'utf8')).scope, 'test')
  } finally { await rm(dir, { recursive: true, force: true }) }
})
test('corrupt checkpoint is not replaced with an empty history', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wardogs-killfeed-test-'))
  try {
    const path = join(dir, 'state.json'); await writeFile(path, '{broken')
    const store = await openFeedStore(path)
    await assert.rejects(store.read()); assert.equal(await readFile(path, 'utf8'), '{broken'); await store.close()
  } finally { await rm(dir, { recursive: true, force: true }) }
})
test('null checkpoint is corruption, not permission to reseed history', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wardogs-killfeed-test-'))
  try {
    const path = join(dir, 'state.json'); await writeFile(path, 'null')
    const store = await openFeedStore(path)
    await assert.rejects(store.read(), /Invalid kill feed checkpoint/); await store.close()
  } finally { await rm(dir, { recursive: true, force: true }) }
})
