const assert = require('node:assert/strict')
const test = require('node:test')

const apiClientConfig = import(
  '../apps/web/src/services/api-client-config.ts'
)

test('resolves session API and database launch parameters', async () => {
  const {
    configureApiClient,
    resolveApiUrl,
    resolveSessionApiUrl,
    resolveSessionDatabaseName
  } = await apiClientConfig
  const search = '?session=api.waysia.com/fabsql&db=wsi'
  const sessionApiUrl = resolveSessionApiUrl(search, 'https:')

  assert.equal(sessionApiUrl, 'https://api.waysia.com/fabsql')
  assert.equal(resolveSessionDatabaseName(search), 'wsi')

  configureApiClient({
    provider: 'session',
    laravelUrl: sessionApiUrl
  })

  assert.equal(
    resolveApiUrl('/api/health'),
    'https://api.waysia.com/fabsql/health'
  )
  assert.equal(
    resolveApiUrl('/api/schema/tables'),
    'https://api.waysia.com/fabsql/schema/tables'
  )
})

test('rejects an invalid session database launch parameter', async () => {
  const { resolveSessionDatabaseName } = await apiClientConfig

  assert.equal(resolveSessionDatabaseName('?db='), null)
  assert.equal(resolveSessionDatabaseName('?db=%00wsi'), null)
  assert.equal(
    resolveSessionDatabaseName(`?db=${'a'.repeat(257)}`),
    null
  )
})
