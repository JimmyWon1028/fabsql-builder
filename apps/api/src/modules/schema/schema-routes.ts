import type {
  HealthResponse,
  SchemaColumnsResponse,
  SchemaDatabasesResponse,
  SchemaTablesResponse
} from '@sql-builder/shared'
import type { FastifyInstance } from 'fastify'

import type { SchemaDataSource } from './schema-repository.js'

interface TableParams {
  tableName: string
}

interface SchemaQuerystring {
  schema?: string
}

export interface SchemaRouteOptions {
  repository: SchemaDataSource
  schemaName: string | (() => string)
}

function getDefaultSchemaName(options: SchemaRouteOptions): string {
  return typeof options.schemaName === 'function'
    ? options.schemaName()
    : options.schemaName
}

async function resolveSchemaName(
  repository: SchemaDataSource,
  defaultSchemaName: string,
  requestedSchemaName?: string
): Promise<string | null> {
  const schemaName = typeof requestedSchemaName === 'string'
    ? requestedSchemaName.trim() || defaultSchemaName
    : defaultSchemaName
  const databases = await repository.listDatabases()

  return databases.includes(schemaName) ? schemaName : null
}

export async function registerSchemaRoutes(
  app: FastifyInstance,
  options: SchemaRouteOptions
): Promise<void> {
  app.get('/api/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    database: {
      name: getDefaultSchemaName(options),
      version: await options.repository.getVersion()
    }
  }))

  app.get(
    '/api/schema/databases',
    async (): Promise<SchemaDatabasesResponse> => ({
      databases: await options.repository.listDatabases(),
      defaultDatabase: getDefaultSchemaName(options)
    })
  )

  app.get<{ Querystring: SchemaQuerystring }>(
    '/api/schema/tables',
    async (request, reply): Promise<SchemaTablesResponse> => {
      const schemaName = await resolveSchemaName(
        options.repository,
        getDefaultSchemaName(options),
        request.query.schema
      )

      if (!schemaName) {
        return reply.code(404).send({
          message: `Database not found: ${request.query.schema}`
        })
      }

      const tables = await options.repository.listTables(schemaName)

      return {
        schema: schemaName,
        tables,
        total: tables.length
      }
    }
  )

  app.get<{
    Params: TableParams
    Querystring: SchemaQuerystring
  }>(
    '/api/schema/tables/:tableName/columns',
    async (request, reply): Promise<SchemaColumnsResponse> => {
      const schemaName = await resolveSchemaName(
        options.repository,
        getDefaultSchemaName(options),
        request.query.schema
      )

      if (!schemaName) {
        return reply.code(404).send({
          message: `Database not found: ${request.query.schema}`
        })
      }

      const columns = await options.repository.listColumns(
        request.params.tableName,
        schemaName
      )

      if (columns.length === 0) {
        return reply.code(404).send({
          message: `Table not found: ${request.params.tableName}`
        })
      }

      return {
        schema: schemaName,
        table: request.params.tableName,
        columns
      }
    }
  )
}
