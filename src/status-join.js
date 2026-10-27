import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function canonicalJoinCode(value) {
  if (typeof value !== 'string') return ''
  const code = value.trim()
  return UUID.test(code) ? code.toLowerCase() : ''
}

export function persistentJoinCode(server, definition) {
  // An invalid joinCode must not hide a valid joinId. Instance IDs are not join codes.
  for (const value of [server?.joinCode, server?.joinId, definition?.joinCode]) {
    const code = canonicalJoinCode(value)
    if (code) return code
  }
  return ''
}

function validatedJoinUrl(value) {
  if (typeof value !== 'string') return ''
  const input = value.trim()
  if (!/^https?:\/\//i.test(input) || input.length > 512 || /[\u0000-\u001f\u007f]/.test(input)) return ''

  try {
    const url = new URL(input)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return ''
    const result = url.href
    return result.length <= 512 ? result : ''
  } catch {
    return ''
  }
}

export function statusComponents(server, definition) {
  const code = persistentJoinCode(server, definition)
  const number = definition?.number
  const knownServer = Number.isInteger(number) && number >= 1 && number <= 5
  // The 44th website maps this stable server number to its configured Steam lobby.
  // The player-facing page remains available even if this bot has no join code.
  const url = validatedJoinUrl(definition?.joinUrl)
    || (knownServer ? `https://44thwardogs.com/join?server=${number}` : '')
  if (!url) return []

  const buttons = [new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Join game').setURL(url)]
  if (code && knownServer) {
    buttons.push(new ButtonBuilder()
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Join code')
      .setCustomId(`wardogs:join:${number}`))
  }
  return [new ActionRowBuilder().addComponents(...buttons)]
}

export function joinInstructionsPayload(server, definition) {
  const code = persistentJoinCode(server, definition)
  const heading = `**Join WARDOGS Server #${definition.number}**`
  const content = code
    ? `${heading}\n\nCopy this join code:\n\`\`\`\n${code}\n\`\`\`\nOpen **WARDOGS → Deploy → Community → Join by ID**, paste the code, choose **Lookup**, then **Join Match**.`
    : `${heading}\n\nThe persistent join code is currently unavailable. Open **WARDOGS → Deploy → Community** and search for **44th Commandos #${definition.number}**.`
  return { content, allowedMentions: { parse: [] } }
}
