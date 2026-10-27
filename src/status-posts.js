const HISTORY_PAGE_SIZE = 100
const HISTORY_PAGE_LIMIT = 5

function isUnknownMessage(error) {
  return Number(error?.code) === 10008
}

function compareMessageIds(left, right) {
  const a = BigInt(left.id)
  const b = BigInt(right.id)
  return a < b ? -1 : a > b ? 1 : 0
}

export function isManagedStatusMessage(message, bot) {
  if (!message || !bot.client.user?.id || message.author?.id !== bot.client.user.id) return false
  // An on-demand /status reply has the same embed, but is never a persistent post.
  if (message.interactionMetadata || message.interaction || message.webhookId) return false
  if (message.type === 20 || message.type === 23) return false
  const footer = message.embeds?.[0]?.footer?.text || ''
  const expected = `44th Commando Regiment • WARDOGS Server #${bot.number}`
  return footer === expected || footer === `${expected} • Map imagery © BULKHEAD`
}

/**
 * Coordinates all configured status accounts in this one Node.js process.
 * buildPayload(snapshot, bot) must return the complete message payload.
 * Recovery searches at most 500 recent channel messages per account; use a
 * dedicated status channel so managed posts remain within that window.
 */
export function createStatusPostManager({ bots, buildPayload, logger = console }) {
  const groups = new Map()
  const knownMessages = new Map()
  const waitingChannels = new Set()
  let queue = Promise.resolve()

  for (const bot of [...bots].sort((a, b) => a.number - b.number)) {
    if (!bot.statusChannelId) continue
    const members = groups.get(bot.statusChannelId) || []
    members.push(bot)
    groups.set(bot.statusChannelId, members)
  }

  function exclusive(operation) {
    const pending = queue.then(operation)
    queue = pending.catch(() => {})
    return pending
  }

  function invalidate(members) {
    for (const bot of members) {
      knownMessages.delete(bot)
      bot.statusMessage = null
    }
  }

  async function fetchChannel(bot) {
    const channel = await bot.client.channels.fetch(bot.statusChannelId)
    if (!channel?.isTextBased() || !channel.messages || typeof channel.send !== 'function') {
      throw new Error(`Status channel ${bot.statusChannelId} is not a text channel Server #${bot.number} can use.`)
    }
    if (typeof channel.permissionsFor === 'function') {
      const permissions = channel.permissionsFor(bot.client.user)
      const sendPermission = channel.isThread?.() ? 'SendMessagesInThreads' : 'SendMessages'
      if (!permissions?.has(['ViewChannel', sendPermission, 'EmbedLinks', 'ReadMessageHistory'])) {
        throw new Error(`Server #${bot.number} needs View Channel, Send Messages, Embed Links and Read Message History in this status channel.`)
      }
    }
    return channel
  }

  async function findMessages(bot, channel, rescan) {
    const known = knownMessages.get(bot)
    if (!rescan && known) {
      try {
        // Force REST verification: a Discord.js cache entry may outlive a deletion.
        const current = await channel.messages.fetch({ message: known.id, force: true, cache: false })
        if (!isManagedStatusMessage(current, bot)) {
          throw new Error(`The saved Server #${bot.number} message is no longer a managed status post.`)
        }
        return [current]
      } catch (error) {
        if (!isUnknownMessage(error)) throw error
        knownMessages.delete(bot)
        bot.statusMessage = null
      }
    }

    const matches = []
    let before
    let complete = false
    for (let pageNumber = 0; pageNumber < HISTORY_PAGE_LIMIT; pageNumber++) {
      const page = await channel.messages.fetch({ limit: HISTORY_PAGE_SIZE, ...(before ? { before } : {}), cache: false })
      const messages = [...page.values()]
      matches.push(...messages.filter((message) => isManagedStatusMessage(message, bot)))
      if (messages.length < HISTORY_PAGE_SIZE) {
        complete = true
        break
      }
      before = messages.sort(compareMessageIds)[0].id
    }
    if (!complete && !matches.length) {
      throw new Error(`No Server #${bot.number} status post was found within the last 500 messages. Use a dedicated status channel so an older post is not duplicated.`)
    }
    // Keep the oldest recovered post, and remove any recovered duplicate copies.
    return matches.sort(compareMessageIds)
  }

  async function removeMessage(message) {
    try {
      await message.delete()
    } catch (error) {
      if (!isUnknownMessage(error)) throw error
    }
  }

  function repairStart(records, reorder) {
    if (reorder) return 0
    let previous
    for (let index = 0; index < records.length; index++) {
      const current = records[index].messages[0]
      if (!current || (previous && compareMessageIds(previous, current) >= 0)) return index
      previous = current
    }
    return records.length
  }

  async function reconcile(channelId, members, snapshot, reorder) {
    const unavailable = members.filter((bot) => !bot.client.isReady())
    if (unavailable.length) {
      const message = `Waiting for Server ${unavailable.map((bot) => `#${bot.number}`).join(', ')} to connect before ordering status posts in channel ${channelId}.`
      if (reorder) throw new Error(message)
      if (!waitingChannels.has(channelId)) logger.warn(message)
      waitingChannels.add(channelId)
      // A disconnected account must not freeze its neighbours' existing posts.
      // Editing in place cannot change their order; creation and deletion wait.
      for (const bot of members) {
        if (!bot.client.isReady()) continue
        try {
          const channel = await fetchChannel(bot)
          const messages = await findMessages(bot, channel, false)
          if (!messages.length) continue
          const updated = await messages[0].edit(buildPayload(snapshot, bot))
          knownMessages.set(bot, updated)
          bot.statusMessage = updated
        } catch (error) {
          invalidate([bot])
          logger.error(`[Discord Server #${bot.number}] existing status post update failed while waiting for other accounts: ${error.message}`)
        }
      }
      return { channelId, status: 'waiting', serverNumbers: members.map((bot) => bot.number) }
    }
    const resumed = waitingChannels.delete(channelId)

    const records = []
    // Read all accounts' channels/messages and build all payloads before deleting
    // anything. Each message is fetched through its own bot so deletion needs no
    // Manage Messages permission, even when several accounts share one channel.
    for (const bot of members) {
      const channel = await fetchChannel(bot)
      const messages = await findMessages(bot, channel, reorder || resumed)
      records.push({ bot, channel, messages, payload: buildPayload(snapshot, bot) })
    }

    const start = repairStart(records, reorder)
    for (const { bot, messages, payload } of records.slice(0, start)) {
      const message = await messages[0].edit(payload)
      knownMessages.set(bot, message)
      bot.statusMessage = message
    }

    // Existing messages cannot move. Repost only the suffix that is missing or
    // out of order; an explicit reorder rebuilds the entire configured group.
    for (let index = 0; index < records.length; index++) {
      const { bot, messages } = records[index]
      for (const message of messages.slice(index < start ? 1 : 0)) await removeMessage(message)
      if (index >= start) {
        knownMessages.delete(bot)
        bot.statusMessage = null
      }
    }

    for (const { bot, channel, payload } of records.slice(start)) {
      const message = await channel.send(payload)
      knownMessages.set(bot, message)
      bot.statusMessage = message
      logger.log(`[Discord Server #${bot.number}] created persistent status post ${message.id} in channel ${channelId}`)
    }
    return { channelId, status: 'updated', serverNumbers: members.map((bot) => bot.number) }
  }

  return {
    update(snapshot) {
      return exclusive(async () => {
        const results = []
        for (const [channelId, members] of groups) {
          try {
            results.push(await reconcile(channelId, members, snapshot, false))
          } catch (error) {
            // A failed send may have reached Discord. Re-scan before the next
            // attempt, rather than blindly sending a duplicate replacement.
            invalidate(members)
            logger.error(`[Discord status channel ${channelId}] update failed: ${error.message}`)
            results.push({ channelId, status: 'failed', serverNumbers: members.map((bot) => bot.number), error })
          }
        }
        return results
      })
    },
    reorder(channelId, snapshot) {
      return exclusive(async () => {
        const members = groups.get(channelId)
        if (!members) throw new Error('This channel is not configured for persistent status posts. Run /status-order in the configured status channel.')
        try {
          return await reconcile(channelId, members, snapshot, true)
        } catch (error) {
          invalidate(members)
          throw error
        }
      })
    },
  }
}
