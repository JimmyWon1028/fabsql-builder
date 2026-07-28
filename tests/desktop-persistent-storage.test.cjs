const assert = require('node:assert/strict')
const {
  mkdtemp,
  rm
} = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  createPersistentStorage
} = require('../desktop/persistent-storage.cjs')

test('persists and removes supported desktop state', async (context) => {
  const storageDirectory = await mkdtemp(
    path.join(tmpdir(), 'fabsql-storage-')
  )
  context.after(async () => {
    await rm(storageDirectory, {
      force: true,
      recursive: true
    })
  })
  const storage = createPersistentStorage(storageDirectory)
  const key = 'sql-builder.workspace-state.v1'
  const value = JSON.stringify({
    version: 1,
    databaseName: 'example'
  })

  assert.equal(await storage.getItem(key), null)
  await storage.setItem(key, value)
  assert.equal(await storage.getItem(key), value)
  await storage.removeItem(key)
  assert.equal(await storage.getItem(key), null)
})

test('rejects unsupported desktop state keys', async () => {
  const storage = createPersistentStorage(tmpdir())

  await assert.rejects(
    storage.getItem('../unexpected'),
    /Unsupported persistent storage key/
  )
})
