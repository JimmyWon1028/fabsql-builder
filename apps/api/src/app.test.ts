import type {
  DatabaseConnectionInput,
  DatabaseConnectionSettings,
  QueryModel,
  SchemaColumn,
  SchemaTable
} from '@sql-builder/shared'
import { createEmptyQueryModel } from '@sql-builder/shared'
import { afterEach, describe, expect, test } from 'vitest'

import { createApplication } from './app.js'
import type {
  DatabaseConnectionController
} from './database/database-connection-manager.js'
import type { QueryExecutor } from './modules/query/query-executor.js'
import type { SchemaDataSource } from './modules/schema/schema-repository.js'

const tables: SchemaTable[] = [
  {
    name: 'ord',
    type: 'BASE TABLE'
  }
]

const columns: SchemaColumn[] = [
  {
    name: 'ordno',
    ordinalPosition: 1,
    dataType: 'varchar',
    columnType: 'varchar(13)',
    nullable: false,
    primaryKey: true,
    indexed: true,
    extra: '',
    comment: ''
  }
]

const repository: SchemaDataSource = {
  async getVersion() {
    return '12.3.2-MariaDB'
  },
  async listDatabases() {
    return ['archive', 'lysm']
  },
  async listTables(schemaName) {
    return schemaName === 'lysm' ? tables : []
  },
  async listColumns(tableName, schemaName) {
    return schemaName === 'lysm' && tableName === 'ord' ? columns : []
  }
}

const queryExecutions: Array<{
  schemaName: string
  sql: string
  parameters: unknown[]
}> = []

const queryExecutor: QueryExecutor = {
  async execute(schemaName, sql, parameters) {
    queryExecutions.push({
      schemaName,
      sql,
      parameters
    })

    return {
      columns: ['ordno'],
      rows: [
        ['A001'],
        ['A002']
      ]
    }
  }
}

const initialConnectionSettings: DatabaseConnectionSettings = {
  mode: 'socket',
  database: 'lysm',
  user: 'tester',
  host: '127.0.0.1',
  port: 3306,
  socketPath: '/tmp/mysql.sock',
  passwordConfigured: true
}
let connectionSettings = { ...initialConnectionSettings }
const testedConnectionSettings: DatabaseConnectionInput[] = []
const appliedConnectionSettings: DatabaseConnectionInput[] = []

const databaseConnectionController: DatabaseConnectionController = {
  getSettings() {
    return connectionSettings
  },
  async test(input) {
    testedConnectionSettings.push(input)
    return {
      status: 'ok',
      version: '12.3.2-MariaDB',
      databases: ['archive', 'lysm']
    }
  },
  async apply(input) {
    appliedConnectionSettings.push(input)
    connectionSettings = {
      mode: input.mode,
      database: input.database,
      user: input.user,
      host: input.host,
      port: input.port,
      socketPath: input.socketPath,
      passwordConfigured: Boolean(input.password)
    }

    return {
      status: 'ok',
      version: '12.3.2-MariaDB',
      databases: ['archive', 'lysm'],
      settings: connectionSettings
    }
  }
}

const applications: ReturnType<typeof createApplication>[] = []

afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.close()))
  queryExecutions.length = 0
  testedConnectionSettings.length = 0
  appliedConnectionSettings.length = 0
  connectionSettings = { ...initialConnectionSettings }
})

function createTestApplication(
  executor: QueryExecutor = queryExecutor
) {
  const app = createApplication({
    repository,
    queryExecutor: executor,
    schemaName: 'lysm',
    databaseConnectionController
  })
  applications.push(app)
  return app
}

function executableQueryModel(): QueryModel {
  const model = createEmptyQueryModel()
  model.tables.push({
    id: 'ord-table',
    name: 'ord',
    alias: 'ord',
    position: {
      x: 0,
      y: 0
    }
  })
  model.selectedFields.push({
    id: 'ordno-field',
    field: {
      tableId: 'ord-table',
      columnName: 'ordno'
    },
    alias: '',
    aggregate: 'none',
    distinct: false
  })
  return model
}

describe('schema API', () => {
  test('reports the connected database', async () => {
    const app = createTestApplication()
    const response = await app.inject({
      method: 'GET',
      url: '/api/health'
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      status: 'ok',
      database: {
        name: 'lysm',
        version: '12.3.2-MariaDB'
      }
    })
  })

  test('returns tables and columns', async () => {
    const app = createTestApplication()
    const tableResponse = await app.inject({
      method: 'GET',
      url: '/api/schema/tables'
    })
    const columnResponse = await app.inject({
      method: 'GET',
      url: '/api/schema/tables/ord/columns'
    })

    expect(tableResponse.json()).toEqual({
      schema: 'lysm',
      tables,
      total: 1
    })
    expect(columnResponse.json()).toEqual({
      schema: 'lysm',
      table: 'ord',
      columns
    })
  })

  test('returns selectable databases', async () => {
    const app = createTestApplication()
    const response = await app.inject({
      method: 'GET',
      url: '/api/schema/databases'
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      databases: ['archive', 'lysm'],
      defaultDatabase: 'lysm'
    })
  })

  test('reads metadata from the selected database', async () => {
    const app = createTestApplication()
    const response = await app.inject({
      method: 'GET',
      url: '/api/schema/tables?schema=archive'
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      schema: 'archive',
      tables: [],
      total: 0
    })
  })

  test('trims the selected database name', async () => {
    const app = createTestApplication()
    const response = await app.inject({
      method: 'GET',
      url: '/api/schema/tables?schema=%20lysm%20'
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      schema: 'lysm',
      tables,
      total: 1
    })
  })

  test('rejects an unknown database', async () => {
    const app = createTestApplication()
    const response = await app.inject({
      method: 'GET',
      url: '/api/schema/tables?schema=missing'
    })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({
      message: 'Database not found: missing'
    })
  })

  test('returns 404 for an unknown table', async () => {
    const app = createTestApplication()
    const response = await app.inject({
      method: 'GET',
      url: '/api/schema/tables/missing/columns'
    })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({
      message: 'Table not found: missing'
    })
  })
})

describe('query execution API', () => {
  test('compiles and runs a Query Model with a result limit', async () => {
    const app = createTestApplication()
    const response = await app.inject({
      method: 'POST',
      url: '/api/query/run',
      payload: {
        schema: 'lysm',
        model: executableQueryModel()
      }
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      columns: ['ordno'],
      rows: [
        ['A001'],
        ['A002']
      ],
      rowCount: 2,
      truncated: false,
      durationMs: expect.any(Number)
    })
    expect(queryExecutions).toEqual([
      expect.objectContaining({
        schemaName: 'lysm',
        sql: expect.stringContaining('Limit ?'),
        parameters: [201]
      })
    ])
  })

  test('rejects an invalid runtime Query Model', async () => {
    const app = createTestApplication()
    const model = executableQueryModel() as unknown as {
      selectedFields: Array<Record<string, unknown>>
    }
    model.selectedFields[0]!.aggregate = 'COUNT); DROP TABLE ord; --'
    const response = await app.inject({
      method: 'POST',
      url: '/api/query/run',
      payload: {
        schema: 'lysm',
        model
      }
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({
      message: 'Invalid Query Model.'
    })
    expect(queryExecutions).toEqual([])
  })

  test('trims the database name before query execution', async () => {
    const app = createTestApplication()
    const response = await app.inject({
      method: 'POST',
      url: '/api/query/run',
      payload: {
        schema: '  lysm  ',
        model: executableQueryModel()
      }
    })

    expect(response.statusCode).toBe(200)
    expect(queryExecutions[0]?.schemaName).toBe('lysm')
  })

  test('rejects a blank database name', async () => {
    const app = createTestApplication()
    const response = await app.inject({
      method: 'POST',
      url: '/api/query/run',
      payload: {
        schema: '   ',
        model: executableQueryModel()
      }
    })

    expect(response.statusCode).toBe(400)
    expect(queryExecutions).toEqual([])
  })

  test('rejects unresolved custom query parameters', async () => {
    const app = createTestApplication()
    const model = executableQueryModel()
    model.filters.children.push({
      id: 'custom-date',
      kind: 'condition',
      field: {
        tableId: model.tables[0]!.id,
        columnName: 'orddt'
      },
      operator: '>=',
      value: {
        kind: 'parameter',
        name: 'orddt'
      }
    })
    const response = await app.inject({
      method: 'POST',
      url: '/api/query/run',
      payload: {
        schema: 'lysm',
        model
      }
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({
      message: 'Custom query parameters require values before execution.'
    })
    expect(queryExecutions).toEqual([])
  })

  test('runs with provided custom query parameter values', async () => {
    const app = createTestApplication()
    const model = executableQueryModel()
    model.filters.children.push({
      id: 'custom-date',
      kind: 'condition',
      field: {
        tableId: model.tables[0]!.id,
        columnName: 'orddt'
      },
      operator: '>=',
      value: {
        kind: 'parameter',
        name: 'orddt'
      }
    })
    const response = await app.inject({
      method: 'POST',
      url: '/api/query/run',
      payload: {
        schema: 'lysm',
        model,
        namedParameters: {
          orddt: '20260701'
        }
      }
    })

    expect(response.statusCode).toBe(200)
    expect(queryExecutions[0]?.parameters).toEqual([
      '20260701',
      201
    ])
  })

  test('limits large result sets to 200 rows', async () => {
    const largeResultExecutor: QueryExecutor = {
      async execute() {
        return {
          columns: ['ordno'],
          rows: Array.from(
            { length: 201 },
            (_, index) => [`A${index}`]
          )
        }
      }
    }
    const app = createTestApplication(largeResultExecutor)
    const response = await app.inject({
      method: 'POST',
      url: '/api/query/run',
      payload: {
        schema: 'lysm',
        model: executableQueryModel()
      }
    })
    const result = response.json()

    expect(response.statusCode).toBe(200)
    expect(result.rows).toHaveLength(200)
    expect(result.rowCount).toBe(200)
    expect(result.truncated).toBe(true)
  })
})

describe('database settings API', () => {
  test('returns connection settings without the password', async () => {
    const app = createTestApplication()
    const response = await app.inject({
      method: 'GET',
      url: '/api/settings/database'
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(initialConnectionSettings)
    expect(response.body).not.toContain('password\":\"')
  })

  test('tests database connection settings', async () => {
    const app = createTestApplication()
    const input: DatabaseConnectionInput = {
      mode: 'network',
      database: 'lysm',
      user: 'fab',
      host: 'db.internal',
      port: 3307,
      socketPath: '/tmp/mysql.sock',
      password: 'secret'
    }
    const response = await app.inject({
      method: 'POST',
      url: '/api/settings/database/test',
      payload: input
    })

    expect(response.statusCode).toBe(200)
    expect(testedConnectionSettings).toEqual([input])
  })

  test('applies valid database connection settings', async () => {
    const app = createTestApplication()
    const input: DatabaseConnectionInput = {
      mode: 'socket',
      database: 'archive',
      user: 'fab',
      host: '127.0.0.1',
      port: 3306,
      socketPath: '/var/run/mysqld/mysqld.sock',
      clearPassword: true
    }
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/database',
      payload: input
    })

    expect(response.statusCode).toBe(200)
    expect(appliedConnectionSettings).toEqual([input])
    expect(response.json()).toEqual(expect.objectContaining({
      settings: expect.objectContaining({
        database: 'archive',
        passwordConfigured: false
      })
    }))
  })

  test('rejects invalid database connection settings', async () => {
    const app = createTestApplication()
    const response = await app.inject({
      method: 'POST',
      url: '/api/settings/database/test',
      payload: {
        mode: 'network',
        database: '',
        user: 'fab',
        host: '',
        port: 70000,
        socketPath: ''
      }
    })

    expect(response.statusCode).toBe(400)
    expect(testedConnectionSettings).toEqual([])
  })
})
