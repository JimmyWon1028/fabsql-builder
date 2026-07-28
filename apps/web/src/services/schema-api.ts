import type {
  DatabaseConnectionApplyResponse,
  DatabaseConnectionInput,
  DatabaseConnectionSettings,
  DatabaseConnectionTestResponse,
  ExecuteQueryRequest,
  ExecuteQueryResponse,
  HealthResponse,
  QueryModel,
  SchemaColumnsResponse,
  SchemaDatabasesResponse,
  SchemaTablesResponse
} from '@sql-builder/shared'

async function requestJson<ResponseType>(
  url: string,
  options?: RequestInit
): Promise<ResponseType> {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...options?.headers
    }
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null) as {
      message?: string
    } | null

    throw new Error(body?.message ?? `Request failed: ${response.status}`)
  }

  return response.json() as Promise<ResponseType>
}

function getJson<ResponseType>(url: string): Promise<ResponseType> {
  return requestJson<ResponseType>(url)
}

export function getHealth(): Promise<HealthResponse> {
  return getJson<HealthResponse>('/api/health')
}

export function getDatabases(): Promise<SchemaDatabasesResponse> {
  return getJson<SchemaDatabasesResponse>('/api/schema/databases')
}

export function getDatabaseConnectionSettings():
Promise<DatabaseConnectionSettings> {
  return getJson<DatabaseConnectionSettings>('/api/settings/database')
}

export function testDatabaseConnection(
  settings: DatabaseConnectionInput
): Promise<DatabaseConnectionTestResponse> {
  return requestJson<DatabaseConnectionTestResponse>(
    '/api/settings/database/test',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(settings)
    }
  )
}

export function applyDatabaseConnection(
  settings: DatabaseConnectionInput
): Promise<DatabaseConnectionApplyResponse> {
  return requestJson<DatabaseConnectionApplyResponse>(
    '/api/settings/database',
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(settings)
    }
  )
}

function addSchemaQuery(url: string, schemaName: string): string {
  const query = new URLSearchParams({
    schema: schemaName
  })

  return `${url}?${query.toString()}`
}

export function getTables(
  schemaName: string
): Promise<SchemaTablesResponse> {
  return getJson<SchemaTablesResponse>(
    addSchemaQuery('/api/schema/tables', schemaName)
  )
}

export function getColumns(
  tableName: string,
  schemaName: string
): Promise<SchemaColumnsResponse> {
  return getJson<SchemaColumnsResponse>(
    addSchemaQuery(
      `/api/schema/tables/${encodeURIComponent(tableName)}/columns`,
      schemaName
    )
  )
}

export function executeQuery(
  schema: string,
  model: QueryModel
): Promise<ExecuteQueryResponse> {
  const body: ExecuteQueryRequest = {
    schema,
    model
  }

  return requestJson<ExecuteQueryResponse>('/api/query/run', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
}
