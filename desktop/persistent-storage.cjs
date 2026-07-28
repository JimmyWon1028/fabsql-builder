const {
  mkdir,
  readFile,
  unlink,
  writeFile
} = require('node:fs/promises')
const path = require('node:path')

const storageFileNames = new Map([
  [
    'fabsql-builder.preferences.v1',
    'preferences.json'
  ],
  [
    'sql-builder.workspace-state.v1',
    'workspace-state.json'
  ]
])
const maximumStoredValueLength = 10 * 1024 * 1024

function validateStorageKey(key) {
  if (!storageFileNames.has(key)) {
    throw new Error('Unsupported persistent storage key.')
  }
}

function createPersistentStorage(storageDirectory) {
  const pendingOperations = new Map()

  function filePathForKey(key) {
    validateStorageKey(key)
    return path.join(storageDirectory, storageFileNames.get(key))
  }

  async function waitForPendingOperation(key) {
    const pendingOperation = pendingOperations.get(key)

    if (pendingOperation) {
      await pendingOperation
    }
  }

  function queueOperation(key, operation) {
    const previousOperation = pendingOperations.get(key)
      ?? Promise.resolve()
    const currentOperation = previousOperation
      .catch(() => undefined)
      .then(operation)

    pendingOperations.set(key, currentOperation)

    void currentOperation
      .finally(() => {
        if (pendingOperations.get(key) === currentOperation) {
          pendingOperations.delete(key)
        }
      })
      .catch(() => undefined)

    return currentOperation
  }

  return {
    async getItem(key) {
      validateStorageKey(key)
      await waitForPendingOperation(key)

      try {
        return await readFile(filePathForKey(key), 'utf8')
      } catch (error) {
        if (error?.code === 'ENOENT') {
          return null
        }

        throw error
      }
    },

    async removeItem(key) {
      validateStorageKey(key)

      return queueOperation(key, async () => {
        try {
          await unlink(filePathForKey(key))
        } catch (error) {
          if (error?.code !== 'ENOENT') {
            throw error
          }
        }
      })
    },

    async setItem(key, value) {
      validateStorageKey(key)

      if (
        typeof value !== 'string'
        || value.length > maximumStoredValueLength
      ) {
        throw new Error('Invalid persistent storage value.')
      }

      return queueOperation(key, async () => {
        await mkdir(storageDirectory, {
          recursive: true
        })
        await writeFile(filePathForKey(key), value, {
          encoding: 'utf8',
          mode: 0o600
        })
      })
    }
  }
}

module.exports = {
  createPersistentStorage
}
