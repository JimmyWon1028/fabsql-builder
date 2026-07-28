import { createApplication } from './app.js'
import { loadApplicationConfig } from './config/environment.js'
import {
  DatabaseConnectionManager
} from './database/database-connection-manager.js'

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

app.addHook('onClose', async () => {
  await databaseConnectionManager.close()
})

try {
  await app.listen(config.api)
} catch (error) {
  app.log.error(error)
  await databaseConnectionManager.close()
  process.exitCode = 1
}
