import assert from 'node:assert/strict'
import test from 'node:test'
import { createStatusPostManager, isManagedStatusMessage } from '../src/status-posts.js'

const footer = (number) => `44th Commando Regiment • WARDOGS Server #${number}`
const discordError = (code, message = `Discord error ${code}`) => Object.assign(new Error(message), { code })

function fixture(numbers = [1, 2, 3], channelIds = {}) {
  const channels = new Map()
  const calls = []
  const failures = []
  const logs = []
  let nextId = 1_000_000_000_000_000_000n
  let hook = async () => {}

  function records(channelId) {
    if (!channels.has(channelId)) channels.set(channelId, new Map())
    return channels.get(channelId)
  }

  async function action(operation, number, id, phase = 'before') {
    if (phase === 'before') {
      calls.push({ operation, number, id })
      await hook(operation, number, id)
    }
    const match = failures.findIndex((failure) => failure.operation === operation && failure.number === number && (failure.phase || 'before') === phase)
    if (match >= 0) throw failures.splice(match, 1)[0].error
  }

  function seed(number, options = {}) {
    const channelId = options.channelId || channelIds[number] || 'shared'
    const record = {
      id: String(options.id ?? ++nextId),
      author: { id: options.authorId || `bot-${number}` },
      embeds: [{ footer: { text: options.footer || footer(number) } }],
      ...options,
    }
    record.id = String(record.id)
    records(channelId).set(record.id, record)
    return record
  }

  function wrap(record, number, channelId) {
    return {
      ...record,
      async edit(payload) {
        await action('edit', number, record.id)
        if (!records(channelId).has(record.id)) throw discordError(10008)
        if (record.author.id !== `bot-${number}`) throw discordError(50013)
        Object.assign(record, payload)
        await action('edit', number, record.id, 'after')
        return wrap(record, number, channelId)
      },
      async delete() {
        await action('delete', number, record.id)
        if (!records(channelId).has(record.id)) throw discordError(10008)
        if (record.author.id !== `bot-${number}`) throw discordError(50013)
        records(channelId).delete(record.id)
        await action('delete', number, record.id, 'after')
      },
    }
  }

  const bots = numbers.map((number) => {
    const bot = { number, statusChannelId: channelIds[number] || 'shared', ready: true, statusMessage: null }
    bot.client = {
      user: { id: `bot-${number}` },
      isReady: () => bot.ready,
      channels: {
        async fetch(channelId) {
          await action('channel', number, channelId)
          return {
            isTextBased: () => true,
            permissionsFor: () => ({ has: () => bot.permissions !== false }),
            messages: {
              async fetch(options) {
                if (options.message) {
                  assert.equal(options.force, true, 'cached status messages must be REST-verified')
                  await action('fetch', number, options.message)
                  const record = records(channelId).get(options.message)
                  if (!record) throw discordError(10008)
                  return wrap(record, number, channelId)
                }
                await action('history', number, options.before)
                const selected = [...records(channelId).values()]
                  .filter((record) => !options.before || BigInt(record.id) < BigInt(options.before))
                  .sort((a, b) => BigInt(a.id) > BigInt(b.id) ? -1 : 1)
                  .slice(0, options.limit)
                return new Map(selected.map((record) => [record.id, wrap(record, number, channelId)]))
              },
            },
            async send(payload) {
              await action('send', number)
              const record = seed(number, { channelId, ...payload })
              await action('send', number, record.id, 'after')
              return wrap(record, number, channelId)
            },
          }
        },
      },
    }
    return bot
  })
  const manager = createStatusPostManager({
    bots,
    buildPayload: (snapshot, bot) => ({ content: snapshot, embeds: [{ footer: { text: footer(bot.number) } }] }),
    logger: { log: (message) => logs.push(message), warn: (message) => logs.push(message), error: (message) => logs.push(message) },
  })

  return {
    bots, manager, calls, failures, logs, seed, records,
    setHook: (callback) => { hook = callback },
    live(channelId = 'shared') {
      return [...records(channelId).values()]
        .filter((record) => bots.some((bot) => isManagedStatusMessage(record, bot)))
        .sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1)
    },
    order(channelId = 'shared') { return this.live(channelId).map((record) => Number(record.author.id.replace('bot-', ''))) },
    mutations() { return calls.filter((call) => ['send', 'edit', 'delete'].includes(call.operation)) },
  }
}

test('waits for every account sharing a channel, while another ready channel still updates', async () => {
  const f = fixture([3, 2, 1, 4], { 4: 'separate' })
  f.bots.find((bot) => bot.number === 1).ready = false
  const results = await f.manager.update('initial')
  assert.equal(results[0].status, 'waiting')
  assert.deepEqual(f.order(), [])
  assert.deepEqual(f.order('separate'), [4])
  f.bots.find((bot) => bot.number === 1).ready = true
  await f.manager.update('ready')
  assert.deepEqual(f.order(), [1, 2, 3])
  assert.deepEqual(f.calls.filter((call) => call.operation === 'send').map((call) => call.number), [4, 1, 2, 3])
})

test('serializes overlapping refreshes and reorder calls without duplicate posts', async () => {
  const f = fixture([3, 1, 2])
  let activeSends = 0
  let maximumActiveSends = 0
  f.setHook(async (operation) => {
    if (operation !== 'send') return
    activeSends++
    maximumActiveSends = Math.max(maximumActiveSends, activeSends)
    await new Promise((resolve) => setTimeout(resolve, 2))
    activeSends--
  })
  await Promise.all([f.manager.update('a'), f.manager.update('b'), f.manager.reorder('shared', 'c')])
  assert.equal(maximumActiveSends, 1)
  assert.deepEqual(f.order(), [1, 2, 3])
  assert.equal(f.calls.filter((call) => call.operation === 'send').length, 6)
  assert.ok(f.live().every((record) => record.content === 'c'))
})

test('keeps ready accounts current while waiting, isolates edit errors, and rescans on reconnect', async () => {
  const f = fixture([1, 2, 3, 4], { 4: 'separate' })
  const one = f.seed(1)
  const three = f.seed(3)
  f.bots.find((bot) => bot.number === 2).ready = false
  await f.manager.update('waiting')
  assert.equal(one.content, 'waiting')
  assert.equal(three.content, 'waiting')
  assert.deepEqual(f.order('separate'), [4])
  assert.ok(f.mutations().filter((call) => call.number !== 4).every((call) => call.operation === 'edit'))

  // This copy appears after #1 is cached. Reconnection must rescan all members
  // rather than relying on their cached primary posts and missing the duplicate.
  const duplicate = f.seed(1)
  f.calls.length = 0
  f.failures.push({ operation: 'edit', number: 3, error: discordError(50013) })
  await f.manager.update('still waiting')
  assert.equal(one.content, 'still waiting')
  assert.equal(three.content, 'waiting')
  assert.equal(f.live('separate')[0].content, 'still waiting')
  assert.ok(f.mutations().every((call) => call.operation === 'edit'))
  assert.equal(f.records('shared').has(duplicate.id), true)

  f.calls.length = 0
  f.bots.find((bot) => bot.number === 2).ready = true
  await f.manager.update('connected')
  assert.deepEqual(f.order(), [1, 2, 3])
  assert.equal(f.live()[0].id, one.id)
  assert.equal(f.records('shared').has(duplicate.id), false)
  assert.ok(f.live().every((record) => record.content === 'connected'))
  assert.ok(f.calls.some((call) => call.operation === 'history' && call.number === 1))
})

test('read failures or deleted posts while waiting do not create replacements or block peers', async () => {
  const f = fixture()
  const one = f.seed(1)
  const three = f.seed(3)
  f.bots[1].ready = false
  f.failures.push({ operation: 'history', number: 1, error: discordError(50013) })
  await f.manager.update('waiting')
  assert.equal(one.content, undefined)
  assert.equal(three.content, 'waiting')
  f.records('shared').delete(three.id)
  f.calls.length = 0
  await f.manager.update('next')
  assert.equal(one.content, 'next')
  assert.ok(f.mutations().every((call) => call.operation === 'edit'))
  assert.deepEqual(f.order(), [1])
})

test('reuses ordered legacy posts and leaves slash replies, other bot messages and users alone', async () => {
  const f = fixture()
  const original = [1, 2, 3].map((number) => f.seed(number))
  const slash = f.seed(1, { interactionMetadata: { id: 'interaction' } })
  const oldSlash = f.seed(2, { interaction: { id: 'interaction' } })
  const wrongNumber = f.seed(1, { footer: footer(10) })
  const user = f.seed(2, { authorId: 'user' })
  await f.manager.update('updated')
  assert.deepEqual(f.live().map((message) => message.id), original.map((message) => message.id))
  assert.ok(f.mutations().every((call) => call.operation === 'edit'))
  for (const record of [slash, oldSlash, wrongNumber, user]) assert.equal(record.content, undefined)
})

test('matches map-imagery footers and excludes interaction types or webhooks', () => {
  const f = fixture([1])
  const bot = f.bots[0]
  assert.equal(isManagedStatusMessage(f.seed(1, { footer: `${footer(1)} • Map imagery © BULKHEAD` }), bot), true)
  assert.equal(isManagedStatusMessage(f.seed(1, { type: 20 }), bot), false)
  assert.equal(isManagedStatusMessage(f.seed(1, { type: 23 }), bot), false)
  assert.equal(isManagedStatusMessage(f.seed(1, { webhookId: 'webhook' }), bot), false)
  assert.equal(isManagedStatusMessage(f.seed(1, { footer: `${footer(1)}0` }), bot), false)
})

test('repairs only an inverted suffix using exact snowflake order and removes own duplicates', async () => {
  const f = fixture()
  const oldThree = f.seed(3)
  const one = f.seed(1)
  const two = f.seed(2)
  const duplicateTwo = f.seed(2)
  const unrelated = f.seed(1, { authorId: 'someone-else' })
  await f.manager.update('fixed')
  assert.deepEqual(f.order(), [1, 2, 3])
  assert.equal(f.live()[0].id, one.id)
  assert.equal(f.live()[1].id, two.id)
  assert.equal(f.records('shared').has(oldThree.id), false)
  assert.equal(f.records('shared').has(duplicateTwo.id), false)
  assert.equal(f.records('shared').has(unrelated.id), true)
  assert.deepEqual(f.calls.filter((call) => call.operation === 'send').map((call) => call.number), [3])
})

test('repairs a deleted middle post without leaving the replacement below a later server', async () => {
  const f = fixture()
  await f.manager.update('initial')
  const [one, two, three] = f.live()
  f.records('shared').delete(two.id)
  f.calls.length = 0
  await f.manager.update('repaired')
  assert.deepEqual(f.order(), [1, 2, 3])
  assert.equal(f.live()[0].id, one.id)
  assert.equal(f.records('shared').has(three.id), false)
  assert.deepEqual(f.calls.filter((call) => call.operation === 'send').map((call) => call.number), [2, 3])
})

test('preflights every account before mutating and continues an unrelated channel on failure', async () => {
  const f = fixture([1, 2, 3, 4], { 4: 'separate' })
  f.bots.find((bot) => bot.number === 3).permissions = false
  const results = await f.manager.update('blocked')
  assert.equal(results[0].status, 'failed')
  assert.match(results[0].error.message, /Server #3 needs/)
  assert.deepEqual(f.order(), [])
  assert.deepEqual(f.order('separate'), [4])
})

test('history, cached-fetch and edit permission errors never trigger duplicate replacements', async () => {
  for (const operation of ['history', 'fetch', 'edit']) {
    const f = fixture()
    if (operation !== 'history') await f.manager.update('initial')
    f.calls.length = 0
    f.failures.push({ operation, number: 2, error: discordError(50013) })
    const [result] = await f.manager.update('failed')
    assert.equal(result.status, 'failed')
    assert.equal(f.calls.some((call) => ['send', 'delete'].includes(call.operation)), false)
    await f.manager.update('retry')
    assert.deepEqual(f.order(), [1, 2, 3])
  }
})

test('recovers an ambiguous send that succeeded remotely before the connection failed', async () => {
  const f = fixture()
  f.failures.push({ operation: 'send', number: 2, phase: 'after', error: new Error('connection reset') })
  const [failed] = await f.manager.update('first')
  assert.equal(failed.status, 'failed')
  assert.deepEqual(f.order(), [1, 2])
  await f.manager.update('retry')
  assert.deepEqual(f.order(), [1, 2, 3])
  assert.equal(f.calls.filter((call) => call.operation === 'send').length, 3)
})

test('partial deletion failure stops reposting and the next refresh repairs the group', async () => {
  const f = fixture()
  await f.manager.update('initial')
  f.calls.length = 0
  f.failures.push({ operation: 'delete', number: 2, error: discordError(50013) })
  await assert.rejects(f.manager.reorder('shared', 'reordered'), /Discord error 50013/)
  assert.equal(f.calls.some((call) => call.operation === 'send'), false)
  assert.deepEqual(f.order(), [2, 3])
  await f.manager.update('retry')
  assert.deepEqual(f.order(), [1, 2, 3])
})

test('a post disappearing during edit is recovered on the next refresh', async () => {
  const f = fixture()
  await f.manager.update('initial')
  let deleted = false
  f.setHook(async (operation, number, id) => {
    if (operation === 'edit' && number === 2 && !deleted) {
      deleted = true
      f.records('shared').delete(id)
    }
  })
  f.calls.length = 0
  const [failed] = await f.manager.update('disappeared')
  assert.equal(failed.status, 'failed')
  assert.equal(f.calls.some((call) => call.operation === 'send'), false)
  await f.manager.update('retry')
  assert.deepEqual(f.order(), [1, 2, 3])
})

test('explicit reorder checks channel configuration and account readiness without mutations', async () => {
  const f = fixture()
  await assert.rejects(f.manager.reorder('unknown', 'x'), /not configured/)
  f.bots[1].ready = false
  await assert.rejects(f.manager.reorder('shared', 'x'), /Waiting for Server #2/)
  assert.equal(f.mutations().length, 0)
})

test('recovers posts beyond the first history page, and refuses to guess beyond 500 messages', async () => {
  const f = fixture([1])
  const original = f.seed(1)
  for (let index = 0; index < 120; index++) f.seed(1, { authorId: 'user' })
  await f.manager.update('found')
  assert.equal(f.live()[0].id, original.id)
  assert.equal(f.calls.filter((call) => call.operation === 'history').length, 2)

  const crowded = fixture([1])
  for (let index = 0; index < 501; index++) crowded.seed(1, { authorId: 'user' })
  const [failed] = await crowded.manager.update('not found')
  assert.equal(failed.status, 'failed')
  assert.match(failed.error.message, /last 500 messages/)
  assert.equal(crowded.calls.filter((call) => call.operation === 'history').length, 5)
  assert.equal(crowded.mutations().length, 0)
})
