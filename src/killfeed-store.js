import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

// One process per state file on the same host. Keep this directory on persistent
// storage. Never reset an unreadable checkpoint or silently replay from scratch.
export async function openFeedStore(path) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const lockPath = `${path}.lock`
  let lock
  try { lock = await open(lockPath, 'wx', 0o600) }
  catch (error) {
    if (error.code !== 'EEXIST') throw error
    // Stale locks are intentionally operator-reviewed: PID reuse and concurrent
    // stale-lock removal can otherwise allow two publishers to post duplicates.
    throw new Error('Kill feed state is locked; verify no other instance is running before removing its .lock file.')
  }
  try { await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); await lock.sync() }
  catch (error) { await lock.close(); await unlink(lockPath); throw error }
  return {
    async read() {
      try {
        const state = JSON.parse(await readFile(path, 'utf8'))
        if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Invalid kill feed checkpoint')
        return state
      }
      catch (error) { if (error.code === 'ENOENT') return null; throw error }
    },
    async write(state) {
      const tmp = `${path}.${randomUUID()}.tmp`
      const file = await open(tmp, 'wx', 0o600)
      try {
        await file.writeFile(JSON.stringify(state)); await file.sync(); await file.close()
        await rename(tmp, path)
        if (process.platform !== 'win32') {
          const directory = await open(dirname(path), 'r')
          try { await directory.sync() } finally { await directory.close() }
        }
      } catch (error) {
        await file.close().catch(() => {}); await unlink(tmp).catch(() => {}); throw error
      }
    },
    async close() { await lock.close(); await unlink(lockPath) },
  }
}
