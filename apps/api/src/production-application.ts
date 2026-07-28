import { access } from 'node:fs/promises'
import { resolve } from 'node:path'

import { createApplication } from './app.js'
import { loadApplicationConfig } from './config/environment.js'
import {
  DatabaseConnectionManager
} from './database/database-connection-manager.js'
import { registerStaticWebRoutes } from './static-web.js'

export async function createProductionApplication(webRoot: string) {
  await access(resolve(webRoot, 'index.html'))

  const config = loadApplicationConfig()
  const databaseConnectionManager = new DatabaseConnectionManager(
    config.database
  )
  const app = createApplication({
    repository: databaseConnectionManager,
    queryExecutor: databaseConnectionManager,
    schemaName: () => databaseConnectionManager.databaseName,
    databaseConnectionController: databaseConnectionManager
  })

  registerStaticWebRoutes(app, webRoot)

  app.addHook('onClose', async () => {
    await databaseConnectionManager.close()
  })

  return {
    app,
    listenOptions: config.api
  }
}
