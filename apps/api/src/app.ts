import Fastify, { type FastifyInstance } from 'fastify'

import type {
  DatabaseConnectionController
} from './database/database-connection-manager.js'
import type { QueryExecutor } from './modules/query/query-executor.js'
import { registerQueryRoutes } from './modules/query/query-routes.js'
import type { SchemaDataSource } from './modules/schema/schema-repository.js'
import { registerSchemaRoutes } from './modules/schema/schema-routes.js'
import {
  registerDatabaseSettingsRoutes
} from './modules/settings/database-settings-routes.js'

export interface CreateApplicationOptions {
  repository: SchemaDataSource
  queryExecutor: QueryExecutor
  schemaName: string | (() => string)
  databaseConnectionController?: DatabaseConnectionController
}

export function createApplication(
  options: CreateApplicationOptions
): FastifyInstance {
  const app = Fastify({
    logger: true
  })

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error)
    reply.code(500).send({
      message: 'Unable to read the MariaDB schema.'
    })
  })

  void app.register(registerSchemaRoutes, options)
  void app.register(registerQueryRoutes, options)

  if (options.databaseConnectionController) {
    void app.register(registerDatabaseSettingsRoutes, {
      controller: options.databaseConnectionController
    })
  }

  return app
}
