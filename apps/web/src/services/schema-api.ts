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

import {
  getApiClientConfig,
  resolveApiUrl
} from './api-client-config'
import {
  getLaravelAccessToken,
  LaravelAuthenticationRequiredError,
  LaravelSessionAuthenticationRequiredError,
  refreshLaravelAccessToken
} from './laravel-auth'

async function sendRequest(
  url: string,
  options: RequestInit | undefined,
  useConfiguredProvider: boolean
): Promise<Response> {
  const headers = new Headers(options?.headers)
  const config = getApiClientConfig()

  headers.set('Accept', 'application/json')

  if (useConfiguredProvider && config.provider === 'laravel') {
    const accessToken = getLaravelAccessToken()

    if (accessToken) {
      headers.set('Authorization', `Bearer ${accessToken}`)
    }
  }

  return fetch(
    useConfiguredProvider ? resolveApiUrl(url) : url,
    {
      ...options,
      ...(useConfiguredProvider && config.provider === 'session'
        ? { credentials: 'include' as const }
        : {}),
      headers
    }
  )
}

async function requestJson<ResponseType>(
  url: string,
  options?: RequestInit,
  useConfiguredProvider = true
): Promise<ResponseType> {
  let response = await sendRequest(
    url,
    options,
    useConfiguredProvider
  )
  const config = getApiClientConfig()

  if (
    response.status === 401
    && useConfiguredProvider
    && config.provider === 'laravel'
  ) {
    try {
      await refreshLaravelAccessToken()
      response = await sendRequest(url, options, useConfiguredProvider)
    } catch {
      throw new LaravelAuthenticationRequiredError()
    }

    if (response.status === 401) {
      throw new LaravelAuthenticationRequiredError()
    }
  }

  if (
    response.status === 401
    && useConfiguredProvider
    && config.provider === 'session'
  ) {
    throw new LaravelSessionAuthenticationRequiredError()
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null) as {
      message?: string
    } | null

    if (
      response.status === 401
      && useConfiguredProvider
      && config.provider === 'laravel'
    ) {
      throw new LaravelAuthenticationRequiredError()
    }

    if (
      response.status === 401
      && useConfiguredProvider
      && config.provider === 'session'
    ) {
      throw new LaravelSessionAuthenticationRequiredError()
    }

    throw new Error(body?.message ?? `Request failed: ${response.status}`)
  }

  return response.json() as Promise<ResponseType>
}

function getJson<ResponseType>(url: string): Promise<ResponseType> {
  return requestJson<ResponseType>(url)
}

function getFastifyJson<ResponseType>(url: string): Promise<ResponseType> {
  return requestJson<ResponseType>(url, undefined, false)
}

export function getHealth(): Promise<HealthResponse> {
  return getJson<HealthResponse>('/api/health')
}

export function getDatabases(): Promise<SchemaDatabasesResponse> {
  return getJson<SchemaDatabasesResponse>('/api/schema/databases')
}

export function getDatabaseConnectionSettings():
  Promise<DatabaseConnectionSettings> {
  return getFastifyJson<DatabaseConnectionSettings>(
    '/api/settings/database'
  )
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
    },
    false
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
    },
    false
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
  model: QueryModel,
  namedParameters: ExecuteQueryRequest['namedParameters'] = {}
): Promise<ExecuteQueryResponse> {
  const body: ExecuteQueryRequest = {
    schema,
    model,
    namedParameters
  }

  return requestJson<ExecuteQueryResponse>('/api/query/run', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
}
