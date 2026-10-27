import assert from 'node:assert/strict'
import test from 'node:test'
import { ButtonStyle } from 'discord.js'
import { joinInstructionsPayload, persistentJoinCode, statusComponents } from '../src/status-join.js'

const firstCode = '89607037-07ad-4039-8f7d-1fb9a46e707b'
const secondCode = '6eccb2c4-4e2a-4cf2-b2d5-67faf8e283b1'
const configuredCode = '3500961c-24df-40b1-b299-6a897eddc2bd'
const definition = { number: 5, joinCode: configuredCode }
const bridgeUrl = (code) => `https://wardogserverlist.com/join?key=id%7C${code}`
const buttons = (server, bot) => statusComponents(server, bot).flatMap((row) => row.toJSON().components)

test('validates each public join field separately before using configured fallback', () => {
  assert.equal(persistentJoinCode({ joinCode: firstCode, joinId: secondCode }, definition), firstCode)
  assert.equal(persistentJoinCode({ joinCode: 'invalid', joinId: secondCode }, definition), secondCode)
  assert.equal(persistentJoinCode({ joinCode: 'invalid', joinId: 'invalid' }, definition), configuredCode)
  assert.equal(persistentJoinCode(null, definition), configuredCode)
})

test('normalizes canonical UUIDs and never substitutes an instance, host or arbitrary ID', () => {
  assert.equal(persistentJoinCode({ joinCode: ` ${firstCode.toUpperCase()} ` }, definition), firstCode)
  assert.equal(persistentJoinCode({ instanceId: firstCode, serverId: firstCode, id: firstCode }, {}), '')
  assert.equal(persistentJoinCode(undefined, undefined), '')
  for (const value of [123456, {}, [], '123456', '127.0.0.1:7777', `{${firstCode}}`, firstCode.replaceAll('-', ''), '00000000-0000-0000-0000-000000000000']) {
    assert.equal(persistentJoinCode({ joinCode: value }, {}), '')
  }
})

test('serializes a Discord-compatible join link and the matching server code action', () => {
  const rows = statusComponents({ joinCode: firstCode }, definition)
  assert.equal(rows.length, 1)
  const row = rows[0].toJSON()
  assert.equal(row.type, 1)
  assert.equal(row.components.length, 2)
  assert.equal(row.components[0].style, ButtonStyle.Link)
  assert.equal(row.components[0].label, 'Join game')
  assert.equal(row.components[0].url, bridgeUrl(firstCode))
  assert.equal(row.components[0].custom_id, undefined)
  assert.equal(row.components[1].style, ButtonStyle.Secondary)
  assert.equal(row.components[1].label, 'Join code')
  assert.equal(row.components[1].custom_id, 'wardogs:join:5')
  assert.equal(row.components[1].url, undefined)
})

test('keeps the known configured link available when live status is unavailable', () => {
  assert.equal(buttons(null, definition)[0].url, bridgeUrl(configuredCode))
  assert.equal(buttons({ status: 'Unavailable' }, definition)[0].url, bridgeUrl(configuredCode))
})

test('supports credential-free HTTP(S) overrides and keeps code fallback when known', () => {
  for (const joinUrl of ['https://44thwardogs.com/join?server=5', 'http://example.test/join/5']) {
    const result = buttons(null, { ...definition, joinUrl })
    assert.equal(result[0].url, joinUrl)
    assert.equal(result[1].custom_id, 'wardogs:join:5')
  }
  const result = buttons(null, { number: 5, joinUrl: ' https://example.test/join ' })
  assert.equal(result.length, 1)
  assert.equal(result[0].url, 'https://example.test/join')
})

test('invalid URL overrides fall back safely to a known join code', () => {
  const invalidUrls = [
    '', 'not a URL', '//example.test/join', 'https:example.test/join', 'https://',
    'steam://connect/127.0.0.1:7777', 'javascript:alert(1)', 'discord://example.test',
    'https://user:password@example.test/join', 'https://user@example.test/join',
    'https://example.test/\njoin', 'https://example.test/' + 'a'.repeat(512),
    'https://example.test/' + 'é'.repeat(100), {}, 42,
  ]
  for (const joinUrl of invalidUrls) {
    assert.equal(buttons(null, { ...definition, joinUrl })[0].url, bridgeUrl(configuredCode))
  }
})

test('omits buttons when neither a valid code nor a valid override is available', () => {
  assert.deepEqual(statusComponents(null, { number: 1 }), [])
  assert.deepEqual(statusComponents({ instanceId: firstCode }, { number: 1 }), [])
  assert.deepEqual(statusComponents({ joinCode: 'invalid' }, { number: 1, joinUrl: 'steam://run/1867240' }), [])
})

test('manual join response supplies the current code and instructions without pinging anyone', () => {
  const payload = joinInstructionsPayload({ joinCode: firstCode }, definition)
  assert.match(payload.content, /Server #5/)
  assert.ok(payload.content.includes(`\`\`\`\n${firstCode}\n\`\`\``))
  for (const step of ['Deploy', 'Community', 'Join by ID', 'Lookup', 'Join Match']) assert.ok(payload.content.includes(step))
  assert.doesNotMatch(payload.content, /copied|clipboard/i)
  assert.deepEqual(payload.allowedMentions, { parse: [] })
  assert.equal(payload.flags, undefined)
  assert.equal(payload.ephemeral, undefined)
  assert.ok(payload.content.length < 2000)
})

test('an old code button remains useful after the join code is removed', () => {
  const payload = joinInstructionsPayload({}, { number: 2 })
  assert.match(payload.content, /currently unavailable/)
  assert.match(payload.content, /44th Commandos #2/)
  assert.doesNotMatch(payload.content, /undefined|```/)
  assert.deepEqual(payload.allowedMentions, { parse: [] })
})
