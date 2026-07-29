import type {
  ExecuteQueryRequest,
  ExecuteQueryResponse
} from '@sql-builder/shared'
import {
  cloneQueryModel,
  compileQuery,
  isQueryModel
} from '@sql-builder/shared'
import type { FastifyInstance } from 'fastify'

import type { SchemaDataSource } from '../schema/schema-repository.js'
import type { QueryExecutor } from './query-executor.js'

export interface QueryRouteOptions {
  repository: SchemaDataSource
  queryExecutor: QueryExecutor
}

const maximumResultRows = 200

function isNamedParameterValues(value: unknown): boolean {
  if (
    typeof value !== 'object'
    || value === null
    || Array.isArray(value)
  ) {
    return false
  }

  return Object.entries(value).every(([name, parameterValue]) =>
    /^[A-Za-z_][A-Za-z0-9_$]*$/.test(name)
    && (
      parameterValue === null
      || typeof parameterValue === 'string'
      || typeof parameterValue === 'boolean'
      || (
        typeof parameterValue === 'number'
        && Number.isFinite(parameterValue)
      )
    )
  )
}

export async function registerQueryRoutes(
  app: FastifyInstance,
  options: QueryRouteOptions
): Promise<void> {
  app.post<{ Body: ExecuteQueryRequest }>(
    '/api/query/run',
    async (request, reply): Promise<ExecuteQueryResponse> => {
      const body = request.body

      if (
        !body
        || typeof body.schema !== 'string'
        || !body.schema.trim()
        || !isQueryModel(body.model)
        || (
          body.namedParameters !== undefined
          && !isNamedParameterValues(body.namedParameters)
        )
      ) {
        return reply.code(400).send({
          message: 'Invalid Query Model.'
        })
      }

      const schemaName = body.schema.trim()
      const databases = await options.repository.listDatabases()

      if (!databases.includes(schemaName)) {
        return reply.code(404).send({
          message: `Database not found: ${schemaName}`
        })
      }

      const executionModel = cloneQueryModel(body.model)

      if (
        executionModel.pagination.limit === null
        || executionModel.pagination.limit > maximumResultRows
      ) {
        executionModel.pagination.limit = maximumResultRows + 1
      }

      const compileResult = compileQuery(
        executionModel,
        body.namedParameters
      )

      if (compileResult.status !== 'valid') {
        return reply.code(400).send({
          message: compileResult.issues[0]?.message
            ?? 'Query Model cannot be compiled.'
        })
      }

      if (compileResult.namedParameters.length > 0) {
        return reply.code(400).send({
          message: 'Custom query parameters require values before execution.'
        })
      }

      const startedAt = performance.now()

      try {
        const result = await options.queryExecutor.execute(
          schemaName,
          compileResult.sql,
          compileResult.parameters
        )
        const truncated = result.rows.length > maximumResultRows
        const rows = truncated
          ? result.rows.slice(0, maximumResultRows)
          : result.rows

        return {
          columns: result.columns,
          rows,
          rowCount: rows.length,
          truncated,
          durationMs: Math.round(performance.now() - startedAt)
        }
      } catch (error) {
        request.log.error(error)
        return reply.code(400).send({
          message: error instanceof Error
            ? `Query execution failed: ${error.message}`
            : 'Query execution failed.'
        })
      }
    }
  )
}
