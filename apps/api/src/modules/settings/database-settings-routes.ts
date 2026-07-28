import type {
  DatabaseConnectionInput,
  DatabaseConnectionMode
} from '@sql-builder/shared'
import type { FastifyInstance } from 'fastify'

import type {
  DatabaseConnectionController
} from '../../database/database-connection-manager.js'

export interface DatabaseSettingsRouteOptions {
  controller: DatabaseConnectionController
}

function isConnectionMode(value: unknown): value is DatabaseConnectionMode {
  return value === 'socket' || value === 'network'
}

function parseConnectionInput(
  value: unknown
): DatabaseConnectionInput | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const input = value as Partial<DatabaseConnectionInput>

  if (
    !isConnectionMode(input.mode)
    || typeof input.database !== 'string'
    || !input.database.trim()
    || typeof input.user !== 'string'
    || !input.user.trim()
    || typeof input.host !== 'string'
    || typeof input.socketPath !== 'string'
    || !Number.isInteger(input.port)
    || input.port! < 1
    || input.port! > 65535
    || (
      input.mode === 'network'
      && !input.host.trim()
    )
    || (
      input.mode === 'socket'
      && !input.socketPath.trim()
    )
    || (
      input.password !== undefined
      && typeof input.password !== 'string'
    )
    || (
      input.clearPassword !== undefined
      && typeof input.clearPassword !== 'boolean'
    )
  ) {
    return null
  }

  return {
    mode: input.mode,
    database: input.database.trim(),
    user: input.user.trim(),
    host: input.host.trim(),
    port: input.port!,
    socketPath: input.socketPath.trim(),
    ...(input.password ? { password: input.password } : {}),
    ...(input.clearPassword ? { clearPassword: true } : {})
  }
}

function connectionErrorMessage(error: unknown): string {
  return error instanceof Error
    ? `MariaDB connection failed: ${error.message}`
    : 'MariaDB connection failed.'
}

export async function registerDatabaseSettingsRoutes(
  app: FastifyInstance,
  options: DatabaseSettingsRouteOptions
): Promise<void> {
  app.get('/api/settings/database', async () =>
    options.controller.getSettings()
  )

  app.post<{ Body: DatabaseConnectionInput }>(
    '/api/settings/database/test',
    async (request, reply) => {
      const input = parseConnectionInput(request.body)

      if (!input) {
        return reply.code(400).send({
          message: 'Invalid database connection settings.'
        })
      }

      try {
        return await options.controller.test(input)
      } catch (error) {
        request.log.warn(error)
        return reply.code(400).send({
          message: connectionErrorMessage(error)
        })
      }
    }
  )

  app.put<{ Body: DatabaseConnectionInput }>(
    '/api/settings/database',
    async (request, reply) => {
      const input = parseConnectionInput(request.body)

      if (!input) {
        return reply.code(400).send({
          message: 'Invalid database connection settings.'
        })
      }

      try {
        return await options.controller.apply(input)
      } catch (error) {
        request.log.warn(error)
        return reply.code(400).send({
          message: connectionErrorMessage(error)
        })
      }
    }
  )
}
